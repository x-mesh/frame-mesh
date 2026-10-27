// 확장 패널 호스트: 대상 탭의 콘텐츠 스크립트와 포트로 연결해 패널을 그린다.
// 사이드 패널은 지금 보는(활성) 탭을 따라간다. 일반 탭으로 열었을 때만 ?tab=<id>로 고정하거나 탭 선택기를 쓴다.
import { createPanel } from '../src/panel/panel.js';
import { t, setLang, getLang, applyI18n } from '../src/core/i18n.js';

// 언어는 브라우저 언어를 따른다. chrome.storage의 fm:lang('en' | 'ko')이 있으면 그 값을 쓴다(시연 녹화 등).
const storedLang = (await chrome.storage.local.get('fm:lang'))['fm:lang'];
if (storedLang) setLang(storedLang);
document.documentElement.lang = getLang();
applyI18n(document);

const $ = (id) => document.getElementById(id);
// 새로고침 직후에는 콘텐츠 스크립트가 아직 뜨기 전일 수 있어 연결을 몇 번 다시 시도한다.
const RECONNECT_TRIES = 4;
const RECONNECT_DELAY_MS = 600;
const params = new URLSearchParams(location.search);
const conn = { port: null, tabId: null, seq: 0, pending: new Map(), selfTabId: null, windowId: null, followActive: false, fixedTabId: Number(params.get('tab')) || null };

const bridge = {
  call: (method, ...args) => new Promise((resolve, reject) => {
    if (!conn.port) {
      reject(new Error(t('ext.notTabConnected')));
      return;
    }
    const id = ++conn.seq;
    conn.pending.set(id, { resolve, reject });
    conn.port.postMessage({ type: 'call', id, method, args });
  }),
};

// 사이드 패널은 레이어와 속성만 그린다. 도구 모음·변경 로그·전달은 페이지 안 도크(content.js)가 맡는다.
const panel = createPanel({
  els: { tree: $('tree'), props: $('props'), notice: $('notice') },
  bridge,
});

const setStatus = (text) => { $('status').textContent = text; };
// 연결이 끊겼을 때만 "다시 연결"을 보인다. 평소에는 패널이 활성 탭에 자동으로 붙는다.
const showReconnect = (on) => { $('btnConnect').hidden = !on; };
const isWebUrl = (url) => /^https?:/.test(url || '');
const canEdit = (tab) => tab && tab.id !== conn.selfTabId && isWebUrl(tab.url);

// ---------- 대상 표시 ----------
function showTarget(tab) {
  const label = $('tabLabel');
  label.hidden = false;
  if (!tab) {
    label.textContent = t('ext.noPage');
    label.classList.add('is-blocked');
    label.title = '';
  } else if (!canEdit(tab)) {
    label.textContent = t('ext.cannotEditUrl', { url: tab.url || tab.title || '' });
    label.classList.add('is-blocked');
    label.title = tab.url || '';
  } else {
    label.textContent = tab.title || tab.url;
    label.classList.remove('is-blocked');
    label.title = tab.url || '';
  }
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => isWebUrl(t.url) && t.id !== conn.selfTabId);
}

async function renderTabOptions(selectedId) {
  const select = $('tabSelect');
  const tabs = await listTabs();
  select.hidden = false;
  select.textContent = '';
  tabs.forEach((t) => {
    const opt = new Option(`${t.title || t.url}`.slice(0, 60), String(t.id));
    opt.title = t.url;
    select.appendChild(opt);
  });
  if (selectedId && tabs.some((t) => t.id === selectedId)) select.value = String(selectedId);
  return tabs;
}

// ---------- 연결 ----------
function disconnect() {
  if (conn.port) {
    try { conn.port.disconnect(); } catch (_) { /* 이미 끊긴 포트 */ }
  }
  conn.port = null;
  conn.pending.forEach((p) => p.reject(new Error(t('ext.disconnectedErr'))));
  conn.pending.clear();
}

const RECEIVER_KEY = 'fm:receiver';
const DEFAULT_RECEIVER = 'http://127.0.0.1:4173/handoff';
async function serverBase() {
  const url = (await chrome.storage.local.get(RECEIVER_KEY))[RECEIVER_KEY] || DEFAULT_RECEIVER;
  return url.replace(/\/handoff\/?$/, '');
}

// 페이지의 도크가 보낸 대화 요청을 개발 서버로 대신 보낸다.
async function relayChat(port, msg) {
  try {
    const base = await serverBase();
    const res = await fetch(base + msg.path, { method: msg.method, headers: { 'Content-Type': 'application/json' }, body: msg.body ? JSON.stringify(msg.body) : undefined });
    const value = await res.json();
    port.postMessage({ type: 'chat-result', id: msg.id, value });
  } catch (err) {
    port.postMessage({ type: 'chat-result', id: msg.id, error: err.message });
  }
}

function onMessage(msg) {
  if (!msg) return;
  if (msg.type === 'chat') {
    if (conn.port) relayChat(conn.port, msg);
    return;
  }
  if (msg.type === 'state') {
    showReconnect(false);
    panel.update(msg.state);
    const n = msg.state.applied || 0;
    const chip = $('appliedChip');
    chip.classList.toggle('is-clean', !n);
    chip.textContent = n ? t('ext.chipN', { n }) : t('ext.chipClean');
    setStatus(t('ext.status', { source: msg.state.source, n: msg.state.elementCount, mode: msg.state.mode === 'select' ? t('ext.modeSelect') : t('ext.modeInteract') }));
  } else if (msg.type === 'notice') {
    panel.notice(msg.message);
  } else if (msg.type === 'result') {
    const p = conn.pending.get(msg.id);
    if (!p) return;
    conn.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.value);
  }
}

function connect(tabId, attempt = 0) {
  disconnect();
  conn.tabId = tabId;
  if (!tabId) {
    panel.clear();
    setStatus(t('ext.noPageRetry'));
    return;
  }
  const port = chrome.tabs.connect(tabId, { name: 'fm-panel' });
  conn.port = port;
  let gotState = false;
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'state') gotState = true;
    onMessage(msg);
  });
  port.onDisconnect.addListener(() => {
    // 주입 전 탭에 연결하면 lastError가 남는다. 읽지 않으면 확장 오류 목록에 쌓인다.
    void chrome.runtime.lastError;
    if (conn.port !== port) return;
    conn.port = null;
    if (!gotState && attempt < RECONNECT_TRIES) {
      setStatus(t('ext.retry', { n: attempt + 1, max: RECONNECT_TRIES }));
      setTimeout(() => {
        if (conn.tabId === tabId && !conn.port) connect(tabId, attempt + 1);
      }, RECONNECT_DELAY_MS);
      return;
    }
    panel.clear();
    setStatus(t('ext.disconnected'));
    showReconnect(true);
  });
  setStatus(attempt ? t('ext.retry', { n: attempt, max: RECONNECT_TRIES }) : t('ext.connecting'));
}

async function inject(tabId) {
  const res = await chrome.runtime.sendMessage({ type: 'inject', tabId });
  if (!res || !res.ok) throw new Error(res ? res.error : t('ext.noResponse'));
  return res.result;
}

// 따라간 탭에 엔진을 넣고 연결한다. 이미 들어 있으면 content.js가 다시 알리기만 한다.
async function attach(tabId) {
  let result;
  try {
    result = await inject(tabId);
  } catch (err) {
    panel.clear();
    setStatus(t('ext.cannotStart', { msg: err.message }));
    showReconnect(true);
    return;
  }
  if (result === 'host') {
    panel.clear();
    setStatus(t('ext.hostPage'));
    showReconnect(false);
    return;
  }
  connect(tabId);
}

async function startEditing() {
  const tabId = conn.followActive ? conn.tabId : (Number($('tabSelect').value) || conn.tabId);
  if (!tabId) {
    panel.notice(t('ext.noHttpTab'));
    return;
  }
  await attach(tabId);
}

// ---------- 활성 탭 추종 (사이드 패널) ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId: conn.windowId });
  return tab || null;
}

function followTab(tab) {
  showTarget(tab);
  if (!canEdit(tab)) {
    disconnect();
    conn.tabId = null;
    panel.clear();
    setStatus(tab ? t('ext.cannotEdit') : t('ext.noPage'));
    showReconnect(false);
    return;
  }
  if (tab.id === conn.tabId && conn.port) return;
  attach(tab.id);
}

function installSectionToggles() {
  document.querySelectorAll('.ext__section-head').forEach((head) => {
    head.addEventListener('click', () => $(head.dataset.toggle).classList.toggle('is-collapsed'));
  });
  installSplitter();
}

const TREE_HEIGHT_KEY = 'fm:panel:treeHeight';
const TREE_MIN_PX = 80;
const PROPS_MIN_PX = 160;

// 레이어와 속성 사이 경계를 끌어 레이어 높이를 정한다. 높이는 이 브라우저에만 기억한다.
function installSplitter() {
  const splitter = $('splitter');
  const tree = $('treeSection');
  const setHeight = (px) => {
    const max = window.innerHeight - PROPS_MIN_PX - tree.getBoundingClientRect().top;
    tree.style.flexBasis = `${Math.max(TREE_MIN_PX, Math.min(px, max))}px`;
  };
  try {
    const saved = Number(localStorage.getItem(TREE_HEIGHT_KEY));
    if (saved) setHeight(saved);
  } catch {
    // 저장소를 쓸 수 없으면 기본 높이로 둔다.
  }
  let drag = null;
  splitter.addEventListener('pointerdown', (e) => {
    drag = { pointerId: e.pointerId, startY: e.clientY, startH: tree.getBoundingClientRect().height };
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('is-active');
    e.preventDefault();
  });
  splitter.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.pointerId) setHeight(drag.startH + e.clientY - drag.startY);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    splitter.classList.remove('is-active');
    try {
      localStorage.setItem(TREE_HEIGHT_KEY, String(Math.round(tree.getBoundingClientRect().height)));
    } catch {
      // 저장하지 못해도 이번 창에서는 바꾼 높이가 유지된다.
    }
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  splitter.addEventListener('dblclick', () => {
    tree.style.flexBasis = '';
    try {
      localStorage.removeItem(TREE_HEIGHT_KEY);
    } catch {
      // 저장소를 쓸 수 없으면 이번 창만 원래대로 돌린다.
    }
  });
}

async function init() {
  installSectionToggles();
  $('btnConnect').addEventListener('click', startEditing);
  const self = await chrome.tabs.getCurrent();
  conn.selfTabId = self ? self.id : null;
  conn.windowId = (await chrome.windows.getCurrent()).id;
  // 사이드 패널에는 자기 탭이 없다. 자동화용 탭 모드는 ?follow=1로 같은 동작을 시험한다.
  conn.followActive = !self || params.get('follow') === '1';

  chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (conn.followActive && tab.active && tab.windowId === conn.windowId && (info.url || info.status === 'complete')) {
      followTab(tab);
      return;
    }
    if (tabId === conn.tabId && info.status === 'complete') attach(tabId);
  });

  if (conn.followActive) {
    chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
      if (windowId !== conn.windowId) return;
      followTab(await chrome.tabs.get(tabId));
    });
    followTab(await activeTab());
    return;
  }

  if (conn.fixedTabId) {
    let tab = null;
    try { tab = await chrome.tabs.get(conn.fixedTabId); } catch (_) { /* 닫힌 탭 */ }
    showTarget(tab);
    if (canEdit(tab)) attach(tab.id);
    else setStatus(t('ext.fixedCannotEdit'));
    return;
  }

  $('tabSelect').addEventListener('change', () => attach(Number($('tabSelect').value)));
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === conn.tabId) renderTabOptions(null);
  });
  const tabs = await renderTabOptions(null);
  if (tabs.length) {
    $('tabSelect').value = String(tabs[0].id);
    attach(tabs[0].id);
  } else {
    setStatus(t('ext.noPageRetry'));
  }
}

init();
