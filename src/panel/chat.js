// frame-mesh 대화 화면. 실행 중인 AI 에이전트 세션과 개발 서버를 거쳐 대화하고, 변경 제안을 미리보고 수락한다.
// transport: { request(method, path, body?) } — 웹 작업실은 fetch, 확장은 사이드 패널이 대신 요청한다.
// bridge: 엔진 호출(getChatContext, selectTargets, previewProposal, acceptProposal, rejectProposal, getHandoff).
// page: 대상 페이지의 origin을 돌려주는 함수. 서버 하나가 여러 프로젝트를 받으므로 모든 요청에 실어 프로젝트를 고르게 한다. 없으면 서버 기본 대상을 쓴다.
import { t } from '../core/i18n.js';
import { resolvePreset, MODE_DRAWS } from './thinking-orbs.js';

const STATUS_REFRESH_MS = 10000;
const RETRY_MS = 3000;
// 서버가 알려 주는 전달 방식과 상태. 모르는 값은 서버가 보낸 이름을 그대로 보여 준다.
const MODES = ['relay', 'wait', 'manual'];
// ambiguous는 이름과 PID가 필요해 statusTail이 따로 다룬다.
const MANUAL_REASONS = ['no_session', 'no_relay'];
const SESSION_NAME_LEN = 8;
const DELIVERY_STATES = ['submitted', 'queued', 'taken', 'error'];
// 에이전트의 답을 기다리는 전달 상태에만 대기 표시를 붙인다.
const WAITING_STATES = ['submitted', 'taken'];
// thinking-orbs는 64px과 20px 프리셋만 있다. 20px은 점이 성겨 잘 보이지 않아, 64px 프리셋으로 그려 ORB_DISPLAY 크기로 줄여 보인다.
const ORB_PRESET = 64;
const ORB_DISPLAY = 40;
// 목록 끝에서 이 거리 안이면 맨 아래를 보고 있다고 본다.
const STICK_PX = 24;
// 입력창 위 선택 줄에 이름표로 보여 줄 최대 개수. 넘으면 +n으로 줄인다.
const PICKED_SHOWN = 4;
// 움직임 줄이기 설정일 때 보여 줄 시점. ThinkingOrb 컴포넌트와 같은 값이다.
const ORB_STILL_AT = 0.6;
// xm이 알려 주는 세션 상태. 모르는 값은 표시하지 않는다.
const PROC_STATES = ['busy', 'idle'];

// 세션 이름 뒤에 CLI, 지정, 중복 순으로 플래그를 붙인다. 상태줄과 선택 목록이 같은 표기를 쓴다.
// proc이 있으면 중복 세션의 터미널 하나를 가리키므로 이름을 "이름 (PID n)"으로 바꾸고, 터미널을 이미 가려냈으니 중복 플래그는 뺀다.
function sessionLabel(s, proc) {
  const flags = [s.channel === 'cli' && 'chat.flag.cli', s.pinned && (!proc || (s.pid_chosen && proc.pid === s.pid)) && 'chat.flag.pinned', !proc && s.ambiguous && 'chat.flag.ambiguous'].filter(Boolean).map((key) => t(key));
  const name = proc ? t('chat.terminal', { name: proc.name, pid: proc.pid }) : s.name;
  return flags.length ? `${name} (${flags.join(', ')})` : name;
}

const pad2 = (n) => String(n).padStart(2, '0');
// 시작 시각은 오늘이면 시:분, 아니면 월/일 시:분으로 줄인다.
function shortTime(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${hm}`;
}

// 같은 대화를 연 터미널은 이름만으로 구분하기 어려워, 작업 상태·터미널 장치·시작 시각을 덧붙인다.
function terminalLabel(s, proc) {
  const details = [
    PROC_STATES.includes(proc.status) && t(`chat.proc.${proc.status}`),
    proc.tty,
    proc.started_at && t('chat.proc.started', { time: shortTime(proc.started_at) }),
  ].filter(Boolean);
  return [sessionLabel(s, proc), ...details].join(' · ');
}

// 중복 세션은 터미널마다 option 하나다. value는 `${session_id}@${pid}`로 두어 같은 세션의 터미널끼리 구분한다.
const PID_SEP = '@';
const terminalValue = (s, pid) => `${s.session_id}${PID_SEP}${pid}`;
const procOf = (s) => (s.procs || []).find((p) => p.pid === s.pid) || { name: s.name, pid: s.pid };
// 서버가 보낼 수 있는 대상이다(중복이면 터미널을 골랐어야 한다).
const isUsable = (s) => !s.ambiguous || s.pid_chosen;

// 응답 대기 표시(thinking-orbs의 connecting). 사용자 말풍선 배경이 어두워 밝은 잉크로 그린다.
// 화면 밖이거나 탭이 숨겨지면 그리기를 멈추고, stop()은 캔버스를 지운다.
function waitingOrb(doc) {
  const win = doc.defaultView;
  const canvas = doc.createElement('canvas');
  canvas.className = 'chat__orb';
  canvas.setAttribute('aria-hidden', 'true');
  // 화면 픽셀 수만큼만 그리면 충분하다. 64px 좌표계를 그 크기로 줄여 그린다.
  const px = Math.round(ORB_DISPLAY * Math.min(2, win.devicePixelRatio || 1));
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  const { mode, speed, opts } = resolvePreset('connecting', ORB_PRESET);
  const scale = px / ORB_PRESET;
  const draw = (at) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, ORB_PRESET, ORB_PRESET);
    MODE_DRAWS[mode](ctx, ORB_PRESET, at, true, opts);
  };
  if (win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(ORB_STILL_AT);
    return { el: canvas, stop: () => canvas.remove() };
  }
  let frame = 0;
  let running = false;
  let visible = true;
  const tick = () => {
    draw((performance.now() / 1000) * speed);
    if (running) frame = win.requestAnimationFrame(tick);
  };
  const start = () => {
    if (running || !visible || doc.visibilityState === 'hidden') return;
    running = true;
    frame = win.requestAnimationFrame(tick);
  };
  const pause = () => {
    running = false;
    win.cancelAnimationFrame(frame);
  };
  const io = win.IntersectionObserver ? new win.IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start(); else pause();
  }) : null;
  const onVisibility = () => (doc.visibilityState === 'hidden' ? pause() : start());
  doc.addEventListener('visibilitychange', onVisibility);
  draw((performance.now() / 1000) * speed);
  if (io) io.observe(canvas);
  start();
  return {
    el: canvas,
    stop() {
      pause();
      if (io) io.disconnect();
      doc.removeEventListener('visibilitychange', onVisibility);
      canvas.remove();
    },
  };
}

export function createChat({ root, transport, bridge, notice = () => {}, page = null }) {
  const doc = root.ownerDocument;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // epoch: 대상이 바뀔 때마다 올라간다. 이전 대상으로 보낸 이벤트 조회가 늦게 돌아와도 버리기 위해서다.
  const view = { since: 0, alive: true, status: null, connected: false, proposals: new Map(), deliveries: new Map(), orbs: new Map(), previewId: null, target: null, epoch: 0 };

  // 전달 상태 문구를 바꾼다. 응답 대기 상태면 문구 앞에 대기 표시를 두고, 다른 상태로 바뀌면 그리기를 멈춘다.
  function setMeta(meta, text, waiting = false) {
    // 대기 표시가 붙거나 빠지면 말풍선 높이가 바뀐다. 맨 아래를 보고 있었다면 바뀐 뒤에도 맨 아래를 보여 준다.
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_PX;
    view.orbs.get(meta)?.stop();
    view.orbs.delete(meta);
    meta.textContent = text;
    meta.classList.toggle('is-waiting', waiting);
    if (waiting) {
      // 메타 줄의 흐림은 글자에만 두고 대기 표시는 또렷하게 보이도록 글자를 따로 감싼다.
      meta.textContent = '';
      const orb = waitingOrb(doc);
      meta.append(orb.el, el('span', 'chat__meta-text', text));
      view.orbs.set(meta, orb);
    }
    if (atBottom) scrollDown();
  }

  function stopOrbs() {
    view.orbs.forEach((orb) => orb.stop());
    view.orbs.clear();
  }

  // 모든 GET에는 page 쿼리, 모든 POST에는 page 본문 필드를 붙인다. origin을 모르면 붙이지 않는다.
  function request(method, path, body) {
    const origin = page ? page() : null;
    if (!origin) return transport.request(method, path, body);
    if (method === 'GET') return transport.request(method, `${path}${path.includes('?') ? '&' : '?'}page=${encodeURIComponent(origin)}`);
    return transport.request(method, path, { ...body, page: origin });
  }

  // ---------- 화면 ----------
  root.textContent = '';
  root.classList.add('chat');
  const head = el('div', 'chat__head');
  const modeBadge = el('span', 'chat__mode', t('chat.checking'));
  const targetSelect = el('select', 'chat__session chat__target');
  targetSelect.hidden = true;
  targetSelect.title = t('chat.targetTitle');
  const sessionSelect = el('select', 'chat__session');
  sessionSelect.hidden = true;
  sessionSelect.title = t('chat.sessionTitle');
  head.append(modeBadge, targetSelect, sessionSelect);
  const list = el('div', 'chat__list');
  const empty = el('p', 'chat__empty', t('chat.empty'));
  list.appendChild(empty);
  const form = el('div', 'chat__form');
  const input = el('textarea', 'chat__input');
  input.rows = 2;
  input.placeholder = t('chat.placeholder');
  const btnSend = el('button', 'btn btn--primary', t('chat.send'));
  btnSend.type = 'button';
  const btnApply = el('button', 'btn', t('chat.apply'));
  btnApply.type = 'button';
  btnApply.title = t('chat.applyTitle');
  const pickedRow = el('div', 'chat__picked');
  pickedRow.hidden = true;
  form.append(pickedRow, input, el('div', 'chat__actions'));
  form.lastChild.append(btnSend, btnApply);
  root.append(head, list, form);

  const scrollDown = () => { list.scrollTop = list.scrollHeight; };

  // 개체 이름표 글자. 이름이 없으면 경로나 ID로 대신한다.
  const targetName = (item) => item.label || item.path || item.id || '?';
  // 같은 이름의 개체끼리 구분되도록 글자 일부를 덧붙인다. 전체 글자는 title로 본다.
  const targetChipText = (item) => (item.excerpt ? `${targetName(item)} · ${item.excerpt}` : targetName(item));

  // 입력창 위 선택 줄. 상태가 바뀔 때마다 불리므로 이름이 같으면 다시 그리지 않는다.
  let pickedKey = '';
  function setSelection(items) {
    const current = Array.isArray(items) ? items : [];
    const key = JSON.stringify(current.map((s) => [s.id, targetChipText(s)]));
    if (key === pickedKey) return;
    pickedKey = key;
    // 줄이 생기거나 사라지면 목록 높이가 바뀐다. 맨 아래를 보고 있었다면 바뀐 뒤에도 맨 아래를 보여 준다.
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_PX;
    pickedRow.textContent = '';
    pickedRow.hidden = !current.length;
    if (current.length) {
      pickedRow.appendChild(el('span', 'chat__picked-label', t('chat.picked')));
      current.slice(0, PICKED_SHOWN).forEach((s) => {
        const chip = el('span', 'chat__picked-chip', targetChipText(s));
        chip.title = targetChipText(s);
        pickedRow.appendChild(chip);
      });
      if (current.length > PICKED_SHOWN) {
        const more = el('span', 'chat__picked-more', t('chat.pickedMore', { n: current.length - PICKED_SHOWN }));
        more.title = current.map(targetChipText).join(', ');
        pickedRow.appendChild(more);
      }
    }
    if (atBottom) scrollDown();
  }

  // 보낸 요청이 가리킨 개체 줄. 이름표를 누르면 그 개체들을 다시 고른다.
  function targetsRow(selection) {
    const row = el('div', 'chat__targets');
    row.appendChild(el('span', 'chat__targets-label', t('chat.about')));
    selection.forEach((s) => {
      const chip = el('button', 'chat__target-chip', targetChipText(s));
      chip.type = 'button';
      chip.title = `${targetChipText(s)} · ${t('chat.reselectTitle')}`;
      chip.addEventListener('click', () => reselect(selection));
      row.appendChild(chip);
    });
    return row;
  }

  async function reselect(selection) {
    try {
      const res = await bridge.call('selectTargets', selection);
      if (res && res.found === 0) notice(t('chat.targetsGone'));
      else if (res && res.missing > 0) notice(t('chat.targetsPartial', { n: res.missing }));
    } catch (err) {
      notice(err.message);
    }
  }

  function bubble(role, text, meta, selection) {
    empty.remove();
    const b = el('div', `chat__msg chat__msg--${role}`);
    b.appendChild(el('div', 'chat__text', text));
    if (selection && selection.length) b.appendChild(targetsRow(selection));
    if (meta) b.appendChild(meta);
    list.appendChild(b);
    scrollDown();
    return b;
  }

  // ---------- 상태 ----------
  function statusTail(st) {
    if (st.mode === 'relay' || st.mode === 'wait') {
      // 고른 세션이 목록에서 빠진 순간에도 어느 세션인지 보이도록 ID 앞부분으로 대신한다.
      const picked = (st.sessions || []).find((s) => s.session_id === st.session_id) || { name: String(st.session_id || '').slice(0, SESSION_NAME_LEN), pinned: st.pinned };
      if (picked.ambiguous && picked.pid_chosen) return t('chat.session', { name: sessionLabel(picked, procOf(picked)) });
      return picked.name ? t('chat.session', { name: sessionLabel(picked) }) : '';
    }
    if (st.mode !== 'manual') return '';
    if (st.reason === 'ambiguous' && st.ambiguous) return t('chat.reason.ambiguous', { name: st.ambiguous.name, pids: st.ambiguous.pids.join(', ') });
    return MANUAL_REASONS.includes(st.reason) ? t(`chat.reason.${st.reason}`, { target: st.target }) : st.reason;
  }

  // 대상 프로젝트가 바뀌면 이전 프로젝트의 대화·제안·전달 표시를 모두 버리고 새 대상의 이벤트를 처음부터 받는다.
  function resetConversation() {
    view.epoch += 1;
    // 미리보기는 페이지에 남아 있고 그 카드는 사라지므로 함께 끈다.
    if (view.previewId) Promise.resolve().then(() => bridge.call('rejectProposal', view.previewId)).catch(() => {});
    view.previewId = null;
    view.since = 0;
    view.proposals.clear();
    stopOrbs();
    view.deliveries.clear();
    list.textContent = '';
    list.appendChild(empty);
  }

  function renderTargets(st) {
    const targets = st.targets || [];
    // page를 모르면 서버가 고른 대상을 기억시킬 열쇠가 없어, 골라도 적용되지 않으므로 숨긴다.
    targetSelect.hidden = !(page && page()) || targets.length < 2;
    if (targetSelect.hidden) return;
    targetSelect.textContent = '';
    targets.forEach((x) => targetSelect.append(new Option(x.target_name, x.target)));
    targetSelect.value = st.target;
  }

  function renderSessions(st, sessions) {
    const options = [];
    sessions.forEach((s) => {
      if (s.ambiguous) (s.procs || []).forEach((p) => options.push(new Option(terminalLabel(s, p), terminalValue(s, p.pid))));
      else options.push(new Option(sessionLabel(s), s.session_id));
    });
    sessionSelect.hidden = options.length < 2;
    if (sessionSelect.hidden) return;
    const cur = sessionSelect.value;
    const picked = sessions.find((s) => s.session_id === st.session_id);
    // 중복 세션에서 터미널을 아직 고르지 않았으면 어느 option도 고르지 않은 채 안내 문구를 보인다.
    const needsTerminal = picked ? picked.ambiguous && !picked.pid_chosen : st.mode === 'manual' && st.reason === 'ambiguous';
    sessionSelect.textContent = '';
    if (needsTerminal) sessionSelect.append(new Option(t('chat.chooseTerminal'), ''));
    options.forEach((o) => sessionSelect.append(o));
    if (needsTerminal) sessionSelect.value = '';
    else if (picked && picked.ambiguous) sessionSelect.value = terminalValue(picked, picked.pid);
    else sessionSelect.value = st.session_id || cur || (sessions.find(isUsable) || sessions[0]).session_id;
  }

  async function refreshStatus() {
    try {
      const st = await request('GET', '/chat/status');
      if (view.target != null && st.target !== view.target) resetConversation();
      view.target = st.target;
      view.status = st;
      const sessions = st.sessions || [];
      const modeLabel = MODES.includes(st.mode) ? t(`chat.mode.${st.mode}`) : st.mode;
      const hint = st.hint === 'choose' ? t('chat.hint.choose', { n: sessions.filter(isUsable).length }) : '';
      modeBadge.textContent = [modeLabel, st.target_name, statusTail(st), hint].filter(Boolean).join(' · ');
      modeBadge.title = st.target || '';
      modeBadge.dataset.mode = st.mode;
      renderTargets(st);
      renderSessions(st, sessions);
      btnApply.disabled = false;
      // 상태 조회는 10초마다 되풀이되므로, 알림은 연결되거나 다시 연결된 순간에만 띄운다.
      if (!view.connected) notice([t('chat.connected', { target: st.target_name }), statusTail(st)].filter(Boolean).join(' · '));
      view.connected = true;
    } catch (err) {
      view.connected = false;
      modeBadge.textContent = t('chat.offline', { msg: err.message });
      modeBadge.title = '';
      modeBadge.dataset.mode = 'offline';
    }
  }

  sessionSelect.addEventListener('change', () => {
    const value = sessionSelect.value;
    if (!value) return;
    const at = value.lastIndexOf(PID_SEP);
    const body = at < 0 ? { session_id: value, pid: null } : { session_id: value.slice(0, at), pid: Number.parseInt(value.slice(at + 1), 10) };
    request('POST', '/chat/session', body).then(refreshStatus).catch(() => {});
  });

  targetSelect.addEventListener('change', () => {
    request('POST', '/chat/target', { target: targetSelect.value }).then(refreshStatus).catch(() => {});
  });

  // ---------- 보내기 ----------
  async function send(text, kind = 'chat') {
    let context = {};
    try {
      context = await bridge.call('getChatContext');
    } catch (_) {
      // 문맥 없이도 보낼 수 있다. 엔진이 아직 준비되지 않은 경우다.
    }
    try {
      const res = await request('POST', '/chat/send', { text, context, kind });
      if (!res.ok) throw new Error(res.error || t('chat.sendFailedBody'));
      if (res.mode === 'manual') notice(t('chat.queuedNotice'));
      refreshStatus();
    } catch (err) {
      notice(t('chat.sendFailed', { msg: err.message }));
    }
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  }
  btnSend.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
    e.stopPropagation();
  });

  btnApply.addEventListener('click', async () => {
    let handoff;
    try {
      handoff = await bridge.call('getHandoff');
    } catch (err) {
      notice(t('panel.handoffFailed', { msg: err.message }));
      return;
    }
    try {
      const saved = await request('POST', '/handoff', { source: handoff.json.source, markdown: handoff.markdown, json: handoff.json });
      if (!saved.ok) throw new Error(saved.error || t('panel.saveFailed'));
    } catch (err) {
      notice(t('chat.saveFailed', { msg: err.message }));
      return;
    }
    send(t('chat.applyRequest'), 'apply');
  });

  // ---------- 제안 카드 ----------
  function proposalCard(p) {
    const card = el('div', 'chat__proposal');
    card.dataset.id = p.id;
    card.appendChild(el('div', 'chat__proposal-title', t('chat.proposal', { summary: p.summary || p.id })));
    card.appendChild(el('div', 'chat__proposal-reason', p.reason ? t('chat.reason', { reason: p.reason }) : t('chat.noReason')));
    if (!p.reason) card.lastChild.classList.add('is-missing');
    const ul = el('ul', 'chat__ops');
    p.ops.forEach((o) => {
      const what = o.kind === 'style' ? `${o.prop}: ${o.value || t('chat.opOriginal')}` : o.kind === 'text' ? t('chat.opText', { value: o.value }) : t('chat.opMove', { parent: o.parentLabel || '?', index: (o.index ?? 0) + 1 });
      ul.appendChild(el('li', '', `${o.label} · ${what}`));
    });
    card.appendChild(ul);
    const row = el('div', 'chat__proposal-actions');
    const btnPreview = el('button', 'btn', t('chat.preview'));
    const btnAccept = el('button', 'btn btn--primary', t('chat.accept'));
    const btnReject = el('button', 'btn', t('chat.reject'));
    [btnPreview, btnAccept, btnReject].forEach((b) => { b.type = 'button'; });
    const state = el('span', 'chat__proposal-state', '');
    row.append(btnPreview, btnAccept, btnReject, state);
    card.appendChild(row);

    const finish = (status, text) => {
      card.dataset.status = status;
      state.textContent = text;
      [btnPreview, btnAccept, btnReject].forEach((b) => { b.disabled = true; });
    };
    // 실패 이유는 카드 안에 남긴다. 알림만 띄우면 놓치기 쉽다.
    const fail = (res) => {
      const why = (res.errors || [res.error || t('chat.unknownError')]).join(' / ');
      state.textContent = t('chat.cannotApply', { why });
      state.classList.add('is-error');
      notice(t('chat.cannotApplyNotice', { why }));
    };

    btnPreview.addEventListener('click', async () => {
      state.classList.remove('is-error');
      if (view.previewId === p.id) {
        await bridge.call('rejectProposal', p.id);
        view.previewId = null;
        btnPreview.textContent = t('chat.preview');
        state.textContent = '';
        return;
      }
      const res = await bridge.call('previewProposal', p.id, p.summary, p.ops, p.reason);
      if (!res.ok) return fail(res);
      view.previewId = p.id;
      btnPreview.textContent = t('chat.previewOff');
      state.textContent = t('chat.previewing');
    });
    btnAccept.addEventListener('click', async () => {
      const res = await bridge.call('acceptProposal', p.id, p.summary, p.ops, p.reason);
      if (!res.ok) return fail(res);
      view.previewId = null;
      finish('accepted', t('chat.accepted'));
      request('POST', '/chat/proposal', { proposal_id: p.id, status: 'accepted' }).catch(() => {});
    });
    btnReject.addEventListener('click', async () => {
      await bridge.call('rejectProposal', p.id);
      view.previewId = null;
      finish('rejected', t('chat.rejected'));
      request('POST', '/chat/proposal', { proposal_id: p.id, status: 'rejected' }).catch(() => {});
    });
    if (p.status && p.status !== 'pending') finish(p.status, p.status === 'accepted' ? t('chat.acceptedShort') : t('chat.rejected'));
    return card;
  }

  // ---------- 이벤트 ----------
  function handle(e) {
    if (e.kind === 'user') {
      const meta = el('div', 'chat__meta', t('chat.sending'));
      view.deliveries.set(e.request_id, meta);
      bubble('user', e.request_kind === 'apply' ? t('chat.applyTag', { text: e.text }) : e.text, meta, e.selection);
    } else if (e.kind === 'delivery') {
      const meta = view.deliveries.get(e.request_id);
      if (meta) setMeta(meta, e.state === 'error' ? t('chat.deliveryFallback', { label: t('chat.delivery.error'), error: e.error || '' }) : (DELIVERY_STATES.includes(e.state) ? t(`chat.delivery.${e.state}`) : e.state), WAITING_STATES.includes(e.state));
    } else if (e.kind === 'assistant') {
      const meta = view.deliveries.get(e.request_id);
      if (meta) setMeta(meta, t('chat.replied'));
      bubble('assistant', e.text);
    } else if (e.kind === 'proposal') {
      const meta = view.deliveries.get(e.proposal.request_id);
      if (meta) setMeta(meta, t('chat.proposed'));
      empty.remove();
      const card = proposalCard(e.proposal);
      view.proposals.set(e.proposal.id, card);
      list.appendChild(card);
      scrollDown();
    } else if (e.kind === 'status') {
      refreshStatus();
    }
  }

  async function loop() {
    while (view.alive) {
      try {
        const epoch = view.epoch;
        const res = await request('GET', `/chat/events?since=${view.since}&timeout=20`);
        if (epoch !== view.epoch) continue;
        // 서버가 다시 시작되면 번호가 처음부터 다시 매겨진다. 그대로 두면 그 사이 이벤트를 건너뛰므로 처음부터 받는다.
        if (typeof res.seq === 'number' && res.seq < view.since) {
          view.since = 0;
          continue;
        }
        (res.events || []).forEach(handle);
        view.since = res.seq ?? view.since;
      } catch (_) {
        // 개발 서버가 꺼져 있으면 잠시 뒤 다시 붙는다.
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
  }

  refreshStatus();
  const statusTimer = setInterval(refreshStatus, STATUS_REFRESH_MS);
  loop();

  return {
    destroy() {
      view.alive = false;
      clearInterval(statusTimer);
      stopOrbs();
    },
    focus() { input.focus(); },
    setSelection,
  };
}
