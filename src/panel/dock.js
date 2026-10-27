// 확장용 페이지 안 하단 도크: 도구 모음과 변경 로그, 전달 버튼을 전체 폭으로 둔다. 사이드 패널은 레이어·속성만 맡는다.
import { createPanel } from './panel.js';
import { createChat } from './chat.js';
import { t } from '../core/i18n.js';

const DOCK_MIN_H = 96;
const DOCK_DEFAULT_H = 180;
const DOCK_MAX_RATIO = 0.6;

// panel.css의 토큰은 :root에 있어 Shadow DOM 안에 닿지 않으므로 host에 다시 정의한다.
const DOCK_CSS = `
:host { all: initial; display: block; --bg: #e9e9ee; --panel: #ffffff; --line: #e2e2e8; --ink: #1d1d22; --ink-2: #5c5c66; --ink-3: #9a9aa6; --accent: #0d99ff; --accent-soft: rgba(13, 153, 255, 0.12); --hover: #7c3aed; --modified: #f59e0b; --warn-bg: #fff4e5; --warn-ink: #9a4b00; --font: -apple-system, "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif; --mono: "SF Mono", Menlo, Consolas, monospace; --dock-h: 180px; }
:host([hidden]) { display: none; }
.dock { position: fixed; left: 0; right: 0; bottom: 0; height: var(--dock-h); display: flex; flex-direction: column; background: var(--panel); color: var(--ink); border-top: 1px solid var(--line); box-shadow: 0 -6px 24px rgba(0,0,0,0.12); font: 12px/1.45 var(--font); z-index: 2147483647; }
.dock.is-collapsed { height: auto; }
/* 되돌리기는 자주 쓰므로 글자와 함께 진하게 보이고, 누를 수 없을 때만 흐리게 한다. */
.btn--history { display: inline-flex; align-items: center; gap: 4px; color: var(--ink); font-weight: 600; }
.btn--history .btn__glyph { font-size: 15px; line-height: 1; }
.btn--reset:not(:disabled) { color: #b42318; border-color: #f3c3bd; }
.btn--reset:not(:disabled):hover { background: #fef3f2; }
.btn--history:disabled { color: var(--ink-3); font-weight: 400; opacity: 0.6; }
/* 편집 중에는 위 테두리를 파란색으로 칠해 버튼을 보지 않아도 모드를 알 수 있게 한다. */
.dock.is-editing { border-top: 3px solid var(--accent); }
.mode-switch { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px 4px 6px; border: 1px solid var(--line); border-radius: 999px; background: #f1f1f4; color: var(--ink-2); font: 600 12px/1.2 var(--font); cursor: pointer; }
.mode-switch__track { position: relative; width: 30px; height: 18px; border-radius: 999px; background: #c4c4cc; transition: background 0.12s; flex: none; }
.mode-switch__track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.25); transition: transform 0.12s; }
.mode-switch[aria-checked="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.mode-switch[aria-checked="true"] .mode-switch__track { background: rgba(255,255,255,0.35); }
.mode-switch[aria-checked="true"] .mode-switch__track::after { transform: translateX(12px); }
.mode-switch kbd { font: 11px var(--mono); padding: 0 4px; border-radius: 3px; background: rgba(0,0,0,0.08); }
.mode-switch[aria-checked="true"] kbd { background: rgba(255,255,255,0.25); }
.dock.is-collapsed .changes, .dock.is-collapsed .dock__grip, .dock.is-collapsed .dock__status { display: none; }
.dock__grip { height: 6px; cursor: ns-resize; flex: none; }
.dock__grip:hover, .dock__grip.is-active { background: var(--accent-soft); }
.dock__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; flex: none; }
.dock__group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dock__title { font-weight: 600; color: var(--ink-2); margin-right: 4px; }
.dock__title span { color: var(--ink-3); font-weight: 400; font-family: var(--mono); font-size: 11px; }
.dock .changes, .dock .diff { flex: 1; overflow: auto; margin: 0; min-height: 0; }
.dock .diff[hidden], .dock .changes[hidden], .dock .chat-host[hidden] { display: none; }
.dock .chat-host { flex: 1; min-height: 0; overflow: hidden; }
/* 대화는 메시지·카드·입력란이 함께 들어가야 해서, 대화 탭에서는 도크를 최소 340px로 높인다. */
.dock.is-chat:not(.is-collapsed) { height: max(var(--dock-h), 340px); }
.dock.is-collapsed .chat-host { display: none; }
.dock.is-collapsed .diff { display: none; }
.dock__tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.dock__tab { padding: 3px 8px; border: 0; background: var(--panel); color: var(--ink-2); font: inherit; cursor: pointer; }
.dock__tab + .dock__tab { border-left: 1px solid var(--line); }
.dock__tab.is-active { background: var(--ink); color: #fff; }
.dock__bar { gap: 8px; padding: 5px 10px; }
.dock__group { gap: 6px; flex-wrap: nowrap; }
.dock .brand { font-size: 11px; color: var(--ink-3); font-weight: 600; margin-right: 2px; }
.sep { width: 1px; height: 18px; background: var(--line); margin: 0 2px; }
.icon { min-width: 28px; padding: 4px 6px; text-align: center; }
.applied { padding: 2px 8px; font-size: 11px; }
.applied::before { content: "●"; margin-right: 4px; color: #f59e0b; }
.applied.is-clean::before { color: #22c55e; }
.dock__tab span { margin-left: 4px; color: var(--ink-3); font-family: var(--mono); font-size: 10px; }
.dock__tab.is-active span { color: rgba(255,255,255,0.7); }
.menu { position: relative; display: inline-block; }
.menu__pop { position: absolute; bottom: calc(100% + 6px); min-width: 210px; padding: 6px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.16); z-index: 2; }
.menu__pop[hidden] { display: none; }
.menu--left .menu__pop { left: 0; }
.menu--right .menu__pop { right: 0; }
.menu__label { padding: 4px 6px 2px; color: var(--ink-3); font-size: 10px; }
.menu__item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: 5px; background: none; text-align: left; font: inherit; color: var(--ink); cursor: pointer; }
.menu__item:hover:not(:disabled) { background: #f4f4f7; }
.menu__item:disabled { color: var(--ink-3); cursor: default; }
.menu__item::before { content: ""; width: 14px; color: var(--accent); font-weight: 700; flex: none; }
.menu__item.is-active::before { content: "✓"; }
.menu__item--danger { color: #b42318; }
.menu__seg { padding: 2px 6px 6px; }
.menu__seg .seg { display: flex; width: 100%; }
.menu__seg .seg__btn { flex: 1; }
.menu__div { height: 1px; margin: 4px 0; background: var(--line); }
.dock .change { grid-template-columns: 22px 58px minmax(80px, 180px) 1fr; padding: 3px 12px; }
.dock .change__vp { display: none; }
.dock .change__target { color: var(--ink-2); }
.peekbar { padding: 4px 10px; background: #1d1d22; color: #fbbf24; font-weight: 600; flex: none; }
.peekbar[hidden] { display: none; }
.dock__status { padding: 3px 10px; color: var(--ink-3); font-size: 11px; border-top: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
.notice { bottom: calc(var(--dock-h) + 12px); z-index: 2147483647; }
.dock.is-chat ~ .notice { bottom: calc(max(var(--dock-h), 340px) + 12px); }
.dock[hidden] { display: none; }
.applied { padding: 2px 8px; border-radius: 999px; background: #fff4e5; color: #9a4b00; font-weight: 600; white-space: nowrap; }
.applied.is-clean { background: #eef7ee; color: #1e7a3a; font-weight: 400; }
.pill { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-radius: 999px; background: #1d1d22; color: #fff; font: 12px/1.4 var(--font); box-shadow: 0 6px 20px rgba(0,0,0,0.25); z-index: 2147483647; }
.pill[hidden] { display: none; }
.pill b { color: #fbbf24; }
.pill { cursor: pointer; }
.pill:hover { background: #2a2a31; }
/* 어두운 알림 위의 버튼: 기본 .btn은 흰 배경이라 상속된 흰 글씨가 보이지 않는다. */
.pill .btn { padding: 2px 10px; font-size: 11px; background: transparent; color: #fff; border-color: rgba(255,255,255,0.35); }
.pill .btn:hover { background: rgba(255,255,255,0.12); }
.pill .btn--open { background: #fff; color: #1d1d22; border-color: #fff; }
.pill .btn--open:hover { background: #e9e9ee; }
.handoff { font: 12px/1.45 var(--font); }
.handoff__receiver { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--ink-2); }
.handoff__receiver input { flex: 1; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; font-family: var(--mono); font-size: 11px; }
`;

function h(doc, tag, attrs = {}, children = []) {
  const el = doc.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  });
  children.forEach((c) => el.appendChild(c));
  return el;
}

export function createDock({ doc, win, panelCss, bridge, receiver, prefs, chatTransport, onOpenPanel }) {
  const host = doc.createElement('fm-dock');
  host.setAttribute('data-fm-ui', '');
  const root = host.attachShadow({ mode: 'open' });
  root.appendChild(h(doc, 'style', { text: panelCss }));
  root.appendChild(h(doc, 'style', { text: DOCK_CSS }));

  const el = (tag, attrs, children) => h(doc, tag, attrs, children);
  const btn = (id, text, title, extra = '') => el('button', { class: `btn${extra}`, id, type: 'button', title, text });
  const segBtn = (attr, value, text, active) => el('button', { class: `seg__btn${active ? ' is-active' : ''}`, type: 'button', [attr]: value, text });

  const menuItem = (id, text, title, extra = '') => el('button', { class: `menu__item${extra}`, id, type: 'button', title, text });
  // 버튼을 누르면 위로 펼쳐지는 메뉴. 바깥을 누르거나 Esc를 누르면 닫힌다.
  const menus = [];
  const menu = (id, label, title, side, children) => {
    const trigger = el('button', { class: 'btn', id, type: 'button', title, text: label });
    const pop = el('div', { class: 'menu__pop' }, children);
    pop.hidden = true;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      menus.forEach((m) => { m.hidden = true; });
      pop.hidden = !open;
    });
    menus.push(pop);
    return el('div', { class: `menu menu--${side}` }, [trigger, pop]);
  };
  root.addEventListener('click', (e) => {
    if (!e.composedPath().some((n) => n.classList && n.classList.contains('menu'))) menus.forEach((m) => { m.hidden = true; });
  });
  doc.addEventListener('click', (e) => { if (!e.composedPath().includes(host)) menus.forEach((m) => { m.hidden = true; }); }, true);

  const modeLabel = el('span', { text: t('mode.editing') });
  const modeToggle = el('button', { class: 'mode-switch', id: 'modeToggle', type: 'button', role: 'switch', 'aria-checked': 'true', title: t('dock.modeTitle') }, [el('span', { class: 'mode-switch__track' }), modeLabel, el('kbd', { text: 'E' })]);
  const moveSeg = el('div', { class: 'seg', id: 'moveSeg', title: t('move.title') }, [segBtn('data-move', 'flow', t('move.flow'), true), segBtn('data-move', 'free', t('move.free'))]);
  const btnMeasure = menuItem('btnMeasure', t('view.measure'), t('view.measureTitle'));
  const btnXray = menuItem('btnXray', t('view.xray'), t('view.xrayTitle'));
  const btnFocus = menuItem('btnFocus', t('view.focus'), t('view.focusTitle'));
  const btnDiffView = menuItem('btnDiffView', t('view.diff'), t('view.diffTitle'));
  const viewMenu = menu('btnView', t('dock.view'), t('dock.viewTitle'), 'left', [
    el('div', { class: 'menu__label', text: t('dock.overlays') }), btnMeasure, btnXray, btnFocus, btnDiffView,
    el('div', { class: 'menu__div' }),
    el('div', { class: 'menu__label', text: t('dock.dragMode') }), el('div', { class: 'menu__seg' }, [moveSeg]),
  ]);
  const btnPeek = btn('btnPeek', t('panel.peek'), t('peek.title'));
  const historyBtn = (id, glyph, text, title) => el('button', { class: 'btn btn--history', id, type: 'button', title }, [el('span', { class: 'btn__glyph', text: glyph }), el('span', { text })]);
  const btnUndo = historyBtn('btnUndo', '↶', t('dock.undo'), t('dock.undoTitle'));
  const btnRedo = historyBtn('btnRedo', '↷', t('dock.redo'), t('dock.redoTitle'));
  const btnReset = historyBtn('btnReset', '⟲', t('dock.reset'), t('dock.resetTitle'));
  btnReset.classList.add('btn--reset');
  btnReset.disabled = true;
  btnUndo.disabled = true;
  btnRedo.disabled = true;
  const changeCount = el('span', { id: 'changeCount' });
  const applied = el('span', { class: 'applied is-clean', text: t('applied.clean') });
  const tabLog = el('button', { class: 'dock__tab is-active', id: 'tabLog', type: 'button', text: t('tab.log') }, [changeCount]);
  const tabDiff = el('button', { class: 'dock__tab', id: 'tabDiff', type: 'button', text: t('tab.diff') });
  const tabChat = el('button', { class: 'dock__tab', id: 'tabChat', type: 'button', text: t('tab.chat') });
  const tabs = el('div', { class: 'dock__tabs' }, [tabLog, tabDiff, tabChat]);
  const btnCopyLog = btn('btnCopyLog', t('dock.copy'), t('dock.copyTitle'), ' btn--primary');
  const btnSendLog = menuItem('btnSendLog', t('dock.save'), t('dock.saveTitle'));
  const btnHandoff = menuItem('btnHandoff', t('dock.viewFile'), t('dock.viewFileTitle'));
  const btnClearLog = menuItem('btnClearLog', t('dock.clear'), t('dock.clearTitle'), ' menu__item--danger');
  [btnSendLog, btnHandoff, btnClearLog].forEach((b) => b.addEventListener('click', () => menus.forEach((m) => { m.hidden = true; })));
  const moreMenu = menu('btnMore', '⋯', t('dock.moreTitle'), 'right', [btnSendLog, btnHandoff, el('div', { class: 'menu__div' }), btnClearLog]);
  const btnCollapse = btn('btnCollapse', '▾', t('dock.collapseTitle'), ' icon');
  const bar = el('div', { class: 'dock__bar' }, [
    el('div', { class: 'dock__group' }, [modeToggle, el('span', { class: 'brand', text: 'frame-mesh' }), viewMenu, el('span', { class: 'sep' }), btnPeek, btnUndo, btnRedo, btnReset]),
    el('div', { class: 'dock__group' }, [applied, tabs, btnCopyLog, moreMenu, btnCollapse]),
  ]);
  const grip = el('div', { class: 'dock__grip', title: t('dock.grip') });
  const changes = el('ol', { class: 'changes', id: 'changes' });
  const diffView = el('div', { class: 'diff' });
  diffView.hidden = true;
  const peekbar = el('div', { class: 'peekbar', text: t('dock.peekbar') });
  peekbar.hidden = true;
  const chatView = el('div', { class: 'chat-host' });
  chatView.hidden = true;
  let chat = null;
  const showTab = (name) => {
    tabLog.classList.toggle('is-active', name === 'log');
    tabDiff.classList.toggle('is-active', name === 'diff');
    tabChat.classList.toggle('is-active', name === 'chat');
    changes.hidden = name !== 'log';
    diffView.hidden = name !== 'diff';
    chatView.hidden = name !== 'chat';
    dock.classList.toggle('is-chat', name === 'chat');
    if (name === 'chat') {
      if (!chat && chatTransport) chat = createChat({ root: chatView, transport: chatTransport, bridge, notice: (m) => panel.notice(m) });
      if (chat) chat.focus();
    }
  };
  tabLog.addEventListener('click', () => showTab('log'));
  // 요약 탭을 열면 페이지 위 차이 표시도 함께 켠다.
  tabDiff.addEventListener('click', () => { showTab('diff'); bridge.call('setDiffView', true); });
  tabChat.addEventListener('click', () => showTab('chat'));
  const status = el('div', { class: 'dock__status', id: 'status', text: '' });
  const dock = el('div', { class: 'dock' }, [grip, peekbar, bar, changes, diffView, chatView, status]);

  const handoffText = el('textarea', { id: 'handoffText', readonly: '', spellcheck: 'false' });
  const handoffSummary = el('span', { id: 'handoffSummary' });
  const receiverInput = el('input', { id: 'receiverUrl', type: 'url', spellcheck: 'false', placeholder: 'http://127.0.0.1:4173/handoff' });
  const btnHandoffCopy = btn('btnHandoffCopy', t('handoff.copy'), '', ' btn--primary');
  const btnHandoffMd = btn('btnHandoffMd', t('handoff.saveMd'), '');
  const btnHandoffJson = btn('btnHandoffJson', t('handoff.saveJson'), '');
  const btnHandoffClose = btn('btnHandoffClose', t('handoff.close'), '');
  const dialog = el('dialog', { class: 'handoff', id: 'handoffDialog' }, [
    el('div', { class: 'handoff__head' }, [el('strong', { text: t('handoff.dialogTitle') }), handoffSummary]),
    el('p', { class: 'handoff__desc', text: t('handoff.desc') }),
    handoffText,
    el('label', { class: 'handoff__receiver', text: t('handoff.receiver') }, [receiverInput]),
    el('div', { class: 'handoff__actions' }, [btnHandoffCopy, btnHandoffMd, btnHandoffJson, btnHandoffClose]),
  ]);
  const notice = el('div', { class: 'notice', id: 'notice' });
  notice.hidden = true;
  const pillText = el('span');
  const pillOpen = btn('pillOpen', t('pill.open'), t('pill.openTitle'), ' btn--open');
  const pillUndo = btn('pillUndo', t('pill.undo'), t('pill.undoTitle'));
  const pill = el('div', { class: 'pill', title: t('pill.title') }, [pillText, pillOpen, pillUndo]);
  pill.hidden = true;
  root.append(dock, dialog, notice, pill);
  doc.documentElement.appendChild(host);

  const panel = createPanel({
    els: {
      tree: el('div'), props: el('div'), changes, diff: diffView, btnPeek, btnDiffView, changeCount, btnUndo, btnRedo, btnReset, modeToggle, modeLabel, moveSeg,
      btnHandoff, btnCopyLog, btnSendLog, btnClearLog, btnMeasure, btnXray, btnFocus, notice,
      handoff: { dialog, text: handoffText, summary: handoffSummary, btnCopy: btnHandoffCopy, btnMd: btnHandoffMd, btnJson: btnHandoffJson, btnClose: btnHandoffClose, receiverInput },
    },
    bridge,
    receiver,
    keyboard: false,
  });

  // ---------- 접기와 높이 ----------
  const applyPrefs = (p) => {
    const height = Math.max(DOCK_MIN_H, Math.min(p.height || DOCK_DEFAULT_H, win.innerHeight * DOCK_MAX_RATIO));
    host.style.setProperty('--dock-h', `${height}px`);
    dock.classList.toggle('is-collapsed', !!p.collapsed);
    btnCollapse.textContent = p.collapsed ? '▴' : '▾';
  };
  let current = { height: DOCK_DEFAULT_H, collapsed: false };
  prefs.get().then((p) => {
    current = { ...current, ...(p || {}) };
    applyPrefs(current);
  });
  const save = () => { prefs.set(current); };
  btnCollapse.addEventListener('click', () => {
    current.collapsed = !current.collapsed;
    applyPrefs(current);
    save();
  });
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('is-active');
    drag = { pointerId: e.pointerId };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    current.height = Math.round(win.innerHeight - e.clientY);
    applyPrefs(current);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    grip.classList.remove('is-active');
    save();
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);

  let lastState = null;
  let panelOpen = false;
  // 알림을 누르면 사이드 패널을 연다. 되돌리기 버튼은 제외한다.
  pill.addEventListener('click', (e) => {
    if (e.composedPath().includes(pillUndo)) return;
    if (onOpenPanel) onOpenPanel();
  });
  pillUndo.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!window.confirm(t('pill.confirm', { n: lastState ? lastState.applied : 0 }))) return;
    await bridge.call('clearLog');
  });

  function renderApplied() {
    const n = lastState ? lastState.applied : 0;
    const peeking = !!(lastState && lastState.peek);
    applied.classList.toggle('is-clean', !n || peeking);
    applied.textContent = peeking ? t('applied.peek', { n }) : n ? t('applied.n', { n }) : t('applied.clean');
    applied.title = peeking ? t('applied.peekTitle') : n ? t('applied.nTitle') : t('applied.cleanTitle');
    peekbar.hidden = !peeking;
    pill.hidden = panelOpen || !n;
    pillText.textContent = '';
    pillText.append('frame-mesh ', Object.assign(doc.createElement('b'), { textContent: t('pill.applied', { n }) }), t('pill.notOriginal'));
  }

  function update(state) {
    lastState = state;
    dock.classList.toggle('is-editing', state.mode === 'select');
    renderApplied();
    panel.update({ ...state, tree: undefined });
    status.textContent = t('dock.status', { source: state.source, n: state.elementCount });
    status.title = t('dock.statusTitle');
  }

  // 패널이 닫히면 도크는 숨기되, 적용 중인 변경이 있으면 알약을 남긴다.
  function setVisible(on) {
    panelOpen = on;
    host.hidden = false;
    dock.hidden = !on;
    renderApplied();
  }

  return { host, update, setVisible, notice: panel.notice };
}
