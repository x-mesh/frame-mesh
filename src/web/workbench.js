// 웹 작업실 호스트: 정적 HTML을 iframe에 열고 엔진과 패널을 직접 연결한다.
import { createEngine } from '../core/engine.js';
import { createPanel } from '../panel/panel.js';
import { createChat } from '../panel/chat.js';

const DEFAULT_SOURCE = 'fixtures/sample-plan.html';
const VIEWPORTS = [
  { key: 'desktop', label: '데스크톱', width: 1280 },
  { key: 'tablet', label: '태블릿', width: 834 },
  { key: 'mobile', label: '모바일', width: 390 },
];
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
    if (!state.engine) return Promise.reject(new Error('열린 문서가 없습니다'));
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
    btnUndo: $('btnUndo'), btnRedo: $('btnRedo'), modeSeg: $('modeSeg'), moveSeg: $('moveSeg'), btnHandoff: $('btnHandoff'), btnCopyLog: $('btnCopyLog'), btnMeasure: $('btnMeasure'), btnXray: $('btnXray'), btnFocus: $('btnFocus'), btnPeek: $('btnPeek'), btnDiffView: $('btnDiffView'), diff: $('diff'),
    btnSendLog: $('btnSendLog'), btnClearLog: $('btnClearLog'),
    notice: $('notice'),
    handoff: { dialog: $('handoffDialog'), text: $('handoffText'), summary: $('handoffSummary'), btnCopy: $('btnHandoffCopy'), btnMd: $('btnHandoffMd'), btnJson: $('btnHandoffJson'), btnClose: $('btnHandoffClose') },
  },
  bridge,
  receiver: { get: async () => '/handoff', set: async () => {} },
});

// 변경 로그를 문서 이름 단위로 보관해 새로고침 뒤 복원한다.
let saveTimer = 0;
function persistLog() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!state.engine) return;
    const data = state.engine.exportOps();
    if (!data.ops.length) localStorage.removeItem(logKey());
    else localStorage.setItem(logKey(), JSON.stringify({ savedAt: Date.now(), ...data }));
  }, SAVE_DEBOUNCE_MS);
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
  panel.notice(`이전 변경 ${r.restored}건을 복원했습니다${r.lost ? ` (${r.lost}건은 요소를 찾지 못함)` : ''}.`);
}

function viewportLabel(op) {
  const preset = VIEWPORTS.find((v) => v.key === op.viewport);
  return preset ? `${preset.label} ${op.width}` : `폭 ${op.width}`;
}

// ---------- 문서 로드 ----------
async function loadDefault() {
  let res;
  try {
    res = await fetch(DEFAULT_SOURCE);
  } catch (err) {
    panel.notice(`시안 요청 실패: ${err.message}. HTTP 서버(make dev)로 연 주소에서 다시 여세요.`);
    return;
  }
  if (!res.ok) {
    panel.notice(`시안을 불러오지 못했습니다: ${DEFAULT_SOURCE} (HTTP ${res.status})`);
    return;
  }
  loadHtml(await res.text(), DEFAULT_SOURCE);
}

function loadHtml(html, name) {
  if (state.snapshot && state.snapshot.total && !window.confirm('현재 변경 이력이 사라집니다. 새 문서를 열까요?')) return;
  state.sourceName = name;
  state.engine = null;
  state.snapshot = null;
  panel.clear();
  ui.iframe.srcdoc = html;
}

function onFrameLoaded() {
  const doc = ui.iframe.contentDocument;
  if (!doc || !doc.body) {
    panel.notice('미리보기 문서에 접근할 수 없습니다.');
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
    b.textContent = `${vp.label} ${vp.width}`;
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
    ui.status.textContent = '문서 없음';
    ui.statusRight.textContent = '';
    ui.overflowBadge.hidden = true;
    return;
  }
  ui.status.textContent = [`정적 HTML · ${state.sourceName}`, `요소 ${s.elementCount}개`, `뷰포트 ${state.viewportWidth}px`, `마지막 렌더 ${timeLabel(state.renderedAt)}`].join(' · ');
  const moveHint = s.moveMode === 'flow' ? '드래그: 흐름 이동 · ⌥드래그: 자유 위치' : '드래그: 자유 위치 · ⌥드래그: 흐름 이동';
  ui.statusRight.textContent = `${s.mode === 'select' ? `선택 모드 · 클릭: 상자 선택 · 더블클릭: 안으로 · ⌘클릭: 깊게 · 우클릭: 겹친 요소 · ${moveHint} · 방향키: 1px` : '동작 미리보기 모드'} · 미리보기 스크립트·폼 전송 차단`;
  const overflow = Math.round(state.overflowX);
  ui.overflowBadge.hidden = overflow < 1;
  ui.overflowBadge.textContent = `가로 넘침 ${overflow}px`;
}

// ---------- 초기화 ----------
function init() {
  renderViewportButtons();
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
