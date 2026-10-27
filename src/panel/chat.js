// frame-mesh 대화 화면. 실행 중인 AI 에이전트 세션과 개발 서버를 거쳐 대화하고, 변경 제안을 미리보고 수락한다.
// transport: { request(method, path, body?) } — 웹 작업실은 fetch, 확장은 사이드 패널이 대신 요청한다.
// bridge: 엔진 호출(getChatContext, previewProposal, acceptProposal, rejectProposal, getHandoff).
import { t } from '../core/i18n.js';

const STATUS_REFRESH_MS = 10000;
const RETRY_MS = 3000;
// 서버가 알려 주는 전달 방식과 상태. 모르는 값은 서버가 보낸 이름을 그대로 보여 준다.
const MODES = ['relay', 'wait', 'manual'];
const DELIVERY_STATES = ['submitted', 'queued', 'taken', 'error'];

export function createChat({ root, transport, bridge, notice = () => {} }) {
  const doc = root.ownerDocument;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const view = { since: 0, alive: true, status: null, proposals: new Map(), deliveries: new Map(), previewId: null };

  // ---------- 화면 ----------
  root.textContent = '';
  root.classList.add('chat');
  const head = el('div', 'chat__head');
  const modeBadge = el('span', 'chat__mode', t('chat.checking'));
  const sessionSelect = el('select', 'chat__session');
  sessionSelect.hidden = true;
  sessionSelect.title = t('chat.sessionTitle');
  head.append(modeBadge, sessionSelect);
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
  form.append(input, el('div', 'chat__actions'));
  form.lastChild.append(btnSend, btnApply);
  root.append(head, list, form);

  const scrollDown = () => { list.scrollTop = list.scrollHeight; };

  function bubble(role, text, meta) {
    empty.remove();
    const b = el('div', `chat__msg chat__msg--${role}`);
    b.appendChild(el('div', 'chat__text', text));
    if (meta) b.appendChild(meta);
    list.appendChild(b);
    scrollDown();
    return b;
  }

  // ---------- 상태 ----------
  async function refreshStatus() {
    try {
      const st = await transport.request('GET', '/chat/status');
      view.status = st;
      modeBadge.textContent = MODES.includes(st.mode) ? t(`chat.mode.${st.mode}`) : st.mode;
      modeBadge.dataset.mode = st.mode;
      const sessions = st.sessions || [];
      sessionSelect.hidden = sessions.length < 2;
      if (sessions.length > 1) {
        const cur = sessionSelect.value;
        sessionSelect.textContent = '';
        sessions.forEach((s) => sessionSelect.append(new Option(`${s.name} · ${s.status}`, s.session_id)));
        sessionSelect.value = st.session_id || cur || sessions[0].session_id;
      }
      btnApply.disabled = false;
    } catch (err) {
      modeBadge.textContent = t('chat.offline', { msg: err.message });
      modeBadge.dataset.mode = 'offline';
    }
  }

  sessionSelect.addEventListener('change', () => {
    transport.request('POST', '/chat/session', { session_id: sessionSelect.value }).then(refreshStatus).catch(() => {});
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
      const res = await transport.request('POST', '/chat/send', { text, context, kind });
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
      const saved = await transport.request('POST', '/handoff', { source: handoff.json.source, markdown: handoff.markdown, json: handoff.json });
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
      transport.request('POST', '/chat/proposal', { proposal_id: p.id, status: 'accepted' }).catch(() => {});
    });
    btnReject.addEventListener('click', async () => {
      await bridge.call('rejectProposal', p.id);
      view.previewId = null;
      finish('rejected', t('chat.rejected'));
      transport.request('POST', '/chat/proposal', { proposal_id: p.id, status: 'rejected' }).catch(() => {});
    });
    if (p.status && p.status !== 'pending') finish(p.status, p.status === 'accepted' ? t('chat.acceptedShort') : t('chat.rejected'));
    return card;
  }

  // ---------- 이벤트 ----------
  function handle(e) {
    if (e.kind === 'user') {
      const meta = el('div', 'chat__meta', t('chat.sending'));
      view.deliveries.set(e.request_id, meta);
      bubble('user', e.request_kind === 'apply' ? t('chat.applyTag', { text: e.text }) : e.text, meta);
    } else if (e.kind === 'delivery') {
      const meta = view.deliveries.get(e.request_id);
      if (meta) meta.textContent = e.state === 'error' ? t('chat.deliveryFallback', { label: t('chat.delivery.error'), error: e.error || '' }) : (DELIVERY_STATES.includes(e.state) ? t(`chat.delivery.${e.state}`) : e.state);
    } else if (e.kind === 'assistant') {
      const meta = view.deliveries.get(e.request_id);
      if (meta) meta.textContent = t('chat.replied');
      bubble('assistant', e.text);
    } else if (e.kind === 'proposal') {
      const meta = view.deliveries.get(e.proposal.request_id);
      if (meta) meta.textContent = t('chat.proposed');
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
        const res = await transport.request('GET', `/chat/events?since=${view.since}&timeout=20`);
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
    },
    focus() { input.focus(); },
  };
}
