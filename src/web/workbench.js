// 웹 작업실 호스트: 정적 HTML을 iframe에 열고 엔진과 패널을 직접 연결한다.
import { createEngine } from '../core/engine.js';
import { createPanel } from '../panel/panel.js';
import { createChat } from '../panel/chat.js';
import { t, setLang, getLang, applyI18n, LANGS, LANG_NAMES } from '../core/i18n.js';

// 언어 우선순위: 주소의 ?lang=en|ko → ⋯ 메뉴에서 고른 값(localStorage) → 브라우저 언어.
// 패널을 만들기 전에 정해야 라벨이 그 언어로 그려진다.
const LANG_KEY = 'fm:lang';
const forcedLang = new URLSearchParams(location.search).get('lang') || localStorage.getItem(LANG_KEY);
if (forcedLang) setLang(forcedLang);
document.documentElement.lang = getLang();
document.title = t('wb.title');
applyI18n(document);

// 예제 시안도 화면 언어에 맞춘다.
const DEFAULT_SOURCE = getLang() === 'ko' ? 'fixtures/sample-plan.html' : 'fixtures/sample-plan.en.html';
const VIEWPORTS = [
  { key: 'desktop', width: 1280 },
  { key: 'tablet', width: 834 },
  { key: 'mobile', width: 390 },
];
const vpLabel = (vp) => t(`vp.${vp.key}`);
const VIEWPORT_MIN = 240;
const VIEWPORT_MAX = 3840;
const MIN_FRAME_HEIGHT = 480;
const CANVAS_GUTTER = 64;
const AUTOSCROLL_ZONE = 48;
const AUTOSCROLL_STEP = 14;
const SAVE_DEBOUNCE_MS = 300;
const logKey = () => `fm:log:${state.sourceName}`;

const $ = (id) => document.getElementById(id);
const ui = {
  iframe: $('preview'), canvas: $('canvas'), frameBox: $('frameBox'), frameWrap: $('frameWrap'),
  docName: $('docName'), zoomLabel: $('zoomLabel'), vpWidth: $('vpWidth'), vpSeg: $('vpSeg'),
  status: $('status'), statusRight: $('statusRight'), overflowBadge: $('overflowBadge'),
  btnOpen: $('btnOpen'), btnReload: $('btnReload'), fileInput: $('fileInput'),
};
const state = { engine: null, sourceName: '', viewportKey: 'desktop', viewportWidth: 1280, scale: 1, frameHeight: MIN_FRAME_HEIGHT, overflowX: 0, renderedAt: null, snapshot: null };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const timeLabel = (d) => d ? d.toTimeString().slice(0, 8) : '-';

const bridge = {
  call: (method, ...args) => {
    if (!state.engine) return Promise.reject(new Error(t('wb.noDocErr')));
    if (method === 'clearLog') {
      state.engine.clearHistory();
      localStorage.removeItem(logKey());
      return Promise.resolve(null);
    }
    return Promise.resolve(state.engine[method](...args));
  },
};

const panel = createPanel({
  els: {
    tree: $('tree'), props: $('props'), changes: $('changes'), changeCount: $('changeCount'),
    btnUndo: $('btnUndo'), btnRedo: $('btnRedo'), modeSeg: $('modeSeg'), moveToggle: $('moveToggle'), btnHandoff: $('btnHandoff'), btnCopyLog: $('btnCopyLog'), btnMeasure: $('btnMeasure'), btnXray: $('btnXray'), btnFocus: $('btnFocus'), btnPeek: $('btnPeek'), btnDiffView: $('btnDiffView'), diff: $('diff'),
    btnSendLog: $('btnSendLog'), btnClearLog: $('btnClearLog'),
    notice: $('notice'),
    handoff: { dialog: $('handoffDialog'), text: $('handoffText'), summary: $('handoffSummary'), btnCopy: $('btnHandoffCopy'), btnMd: $('btnHandoffMd'), btnJson: $('btnHandoffJson'), btnClose: $('btnHandoffClose') },
  },
  bridge,
  receiver: { get: async () => '/handoff', set: async () => {} },
});

// 변경 로그를 문서 이름 단위로 보관해 새로고침 뒤 복원한다.
let saveTimer = 0;
function saveLogNow() {
  clearTimeout(saveTimer);
  if (!state.engine) return;
  const data = state.engine.exportOps();
  if (!data.ops.length) localStorage.removeItem(logKey());
  else localStorage.setItem(logKey(), JSON.stringify({ savedAt: Date.now(), ...data }));
}

function persistLog() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLogNow, SAVE_DEBOUNCE_MS);
}

// ---------- ⋯ 메뉴: 언어 ----------
// 라벨을 모두 새 언어로 그리려면 작업실을 다시 열어야 한다. 직접 연 HTML은 다시 열면 사라지므로 그때만 확인한다.
function installMoreMenu() {
  const menu = $('moreMenu');
  const pop = menu.querySelector('.menu__pop');
  $('btnMore').setAttribute('aria-label', t('wb.settingsTitle'));
  $('btnMore').addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
  const seg = $('langSeg');
  LANGS.forEach((lang) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `seg__btn${lang === getLang() ? ' is-active' : ''}`;
    b.dataset.lang = lang;
    b.textContent = LANG_NAMES[lang];
    seg.appendChild(b);
  });
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg__btn');
    if (!b || b.dataset.lang === getLang()) return;
    if (state.sourceName && state.sourceName !== DEFAULT_SOURCE && !window.confirm(t('wb.langReloadConfirm'))) return;
    saveLogNow();
    localStorage.setItem(LANG_KEY, b.dataset.lang);
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url);
  });
}

function restoreLog() {
  const raw = localStorage.getItem(logKey());
  if (!raw) return;
  let stored;
  try {
    stored = JSON.parse(raw);
  } catch (_) {
    // 손상된 저장본은 버린다. 그대로 두면 매번 복원에 실패한다.
    localStorage.removeItem(logKey());
    return;
  }
  const r = state.engine.restoreOps(stored);
  panel.notice(`${t('ext.restored', { n: r.restored })}${r.lost ? t('ext.restoredLost', { n: r.lost }) : ''}.`);
}

function viewportLabel(op) {
  const preset = VIEWPORTS.find((v) => v.key === op.viewport);
  return preset ? `${vpLabel(preset)} ${op.width}` : t('op.width', { width: op.width });
}

// ---------- 문서 로드 ----------
async function loadDefault() {
  let res;
  try {
    res = await fetch(DEFAULT_SOURCE);
  } catch (err) {
    panel.notice(t('wb.fetchFailed', { msg: err.message }));
    return;
  }
  if (!res.ok) {
    panel.notice(t('wb.loadFailed', { src: DEFAULT_SOURCE, status: res.status }));
    return;
  }
  loadHtml(await res.text(), DEFAULT_SOURCE);
}

function loadHtml(html, name) {
  if (state.snapshot && state.snapshot.total && !window.confirm(t('wb.confirmOpen'))) return;
  state.sourceName = name;
  state.engine = null;
  state.snapshot = null;
  panel.clear();
  ui.iframe.srcdoc = html;
}

function onFrameLoaded() {
  const doc = ui.iframe.contentDocument;
  if (!doc || !doc.body) {
    panel.notice(t('wb.noAccess'));
    return;
  }
  const win = ui.iframe.contentWindow;
  const engine = createEngine({
    doc,
    win,
    source: state.sourceName,
    onChange: onEngineChange,
    onNotice: panel.notice,
    getViewport: () => ({ key: state.viewportKey, width: state.viewportWidth }),
    viewportLabel,
    autoScroll: canvasAutoScroll,
    rasterViaImage: true,
  });
  state.engine = engine;
  state.renderedAt = new Date();
  ui.docName.textContent = state.sourceName;
  engine.init();
  new win.ResizeObserver(() => syncFrame()).observe(doc.body);
  restoreLog();
  syncFrame();
}

function onEngineChange(ev) {
  const engine = state.engine;
  if (!engine) return;
  const needTree = ev.type === 'load' || ev.type === 'dom' || (ev.type === 'history' && (ev.kind === 'move' || ev.kind === 'clear'));
  state.snapshot = engine.getState({ tree: needTree });
  panel.update(state.snapshot);
  if (ev.type === 'history') {
    syncFrame();
    persistLog();
  }
  renderStatus();
}

// ---------- 프레임 크기와 뷰포트 ----------
function syncFrame() {
  const engine = state.engine;
  const doc = ui.iframe.contentDocument;
  if (!engine || !doc) return;
  const width = state.viewportWidth;
  ui.iframe.style.width = `${width}px`;
  ui.frameWrap.style.width = `${width}px`;
  // 높이를 0으로 둔 뒤 측정해야 줄어든 내용 높이도 반영된다.
  ui.iframe.style.height = '0px';
  const height = Math.max(MIN_FRAME_HEIGHT, doc.documentElement.scrollHeight);
  ui.iframe.style.height = `${height}px`;
  ui.frameWrap.style.height = `${height}px`;
  state.frameHeight = height;

  const avail = Math.max(VIEWPORT_MIN, ui.canvas.clientWidth - CANVAS_GUTTER);
  state.scale = Math.min(1, avail / width);
  ui.frameWrap.style.transform = `scale(${state.scale})`;
  ui.frameBox.style.width = `${width * state.scale}px`;
  ui.frameBox.style.height = `${height * state.scale}px`;
  ui.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  engine.setScale(state.scale);
  engine.refresh();

  state.overflowX = doc.documentElement.scrollWidth - width;
  renderStatus();
}

// 캔버스를 스크롤하고, 프레임 기준 좌표가 얼마나 밀렸는지(스케일 보정) 돌려준다.
function canvasAutoScroll(point) {
  const fr = ui.iframe.getBoundingClientRect();
  const cr = ui.canvas.getBoundingClientRect();
  const py = fr.top + point.y * state.scale;
  let dir = 0;
  if (py < cr.top + AUTOSCROLL_ZONE) dir = -1;
  else if (py > cr.bottom - AUTOSCROLL_ZONE) dir = 1;
  if (!dir) return null;
  const before = ui.canvas.scrollTop;
  ui.canvas.scrollTop += dir * AUTOSCROLL_STEP;
  const moved = ui.canvas.scrollTop - before;
  return moved ? moved / state.scale : null;
}

function renderViewportButtons() {
  VIEWPORTS.forEach((vp) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg__btn';
    b.dataset.key = vp.key;
    b.textContent = `${vpLabel(vp)} ${vp.width}`;
    b.addEventListener('click', () => setViewport(vp.key, vp.width));
    ui.vpSeg.appendChild(b);
  });
}

function setViewport(key, width) {
  state.viewportKey = key;
  state.viewportWidth = width;
  ui.vpWidth.value = width;
  ui.vpSeg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.key === key));
  syncFrame();
}

function renderStatus() {
  const s = state.snapshot;
  if (!s) {
    ui.status.textContent = t('wb.noDoc');
    ui.statusRight.textContent = '';
    ui.overflowBadge.hidden = true;
    return;
  }
  ui.status.textContent = [t('wb.status.static', { name: state.sourceName }), t('wb.status.elements', { n: s.elementCount }), t('wb.status.viewport', { w: state.viewportWidth }), t('wb.status.render', { time: timeLabel(state.renderedAt) })].join(' · ');
  const moveHint = s.moveMode === 'flow' ? t('wb.hint.flow') : t('wb.hint.free');
  ui.statusRight.textContent = t('wb.hint.blocked', { mode: s.mode === 'select' ? t('wb.hint.select', { move: moveHint }) : t('wb.hint.interact') });
  const overflow = Math.round(state.overflowX);
  ui.overflowBadge.hidden = overflow < 1;
  ui.overflowBadge.textContent = t('wb.overflow', { n: overflow });
}

// ---------- 초기화 ----------
function init() {
  renderViewportButtons();
  installMoreMenu();
  // 웹 작업실은 개발 서버와 같은 출처라 바로 요청한다.
  const transport = {
    request: async (method, path, body) => {
      const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return res.json();
    },
  };
  let chat = null;
  const showTab = (name) => {
    ['Log', 'Diff', 'Chat'].forEach((t) => $(`tab${t}`).classList.toggle('is-active', t.toLowerCase() === name));
    $('changes').hidden = name !== 'log';
    $('diff').hidden = name !== 'diff';
    $('chat').hidden = name !== 'chat';
    document.querySelector('.app').classList.toggle('is-chat', name === 'chat');
    if (name === 'chat') {
      if (!chat) chat = createChat({ root: $('chat'), transport, bridge, notice: panel.notice });
      chat.focus();
    }
    syncFrame();
  };
  $('tabLog').addEventListener('click', () => showTab('log'));
  $('tabDiff').addEventListener('click', () => {
    showTab('diff');
    if (state.engine) state.engine.setDiffView(true);
  });
  $('tabChat').addEventListener('click', () => showTab('chat'));
  ui.iframe.addEventListener('load', onFrameLoaded);
  ui.vpWidth.addEventListener('change', () => {
    const w = clamp(parseInt(ui.vpWidth.value, 10) || state.viewportWidth, VIEWPORT_MIN, VIEWPORT_MAX);
    const preset = VIEWPORTS.find((v) => v.width === w);
    setViewport(preset ? preset.key : 'custom', w);
  });
  ui.btnOpen.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', async () => {
    const file = ui.fileInput.files[0];
    if (file) loadHtml(await file.text(), file.name);
    ui.fileInput.value = '';
  });
  ui.btnReload.addEventListener('click', loadDefault);
  new ResizeObserver(() => syncFrame()).observe(ui.canvas);
  setViewport('desktop', 1280);
  loadDefault();
}

init();
