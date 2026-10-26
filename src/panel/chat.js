// frame-mesh 대화 화면. 실행 중인 AI 에이전트 세션과 개발 서버를 거쳐 대화하고, 변경 제안을 미리보고 수락한다.
// transport: { request(method, path, body?) } — 웹 작업실은 fetch, 확장은 사이드 패널이 대신 요청한다.
// bridge: 엔진 호출(getChatContext, previewProposal, acceptProposal, rejectProposal, getHandoff).

const STATUS_REFRESH_MS = 10000;
const RETRY_MS = 3000;
const MODE_TEXT = {
  relay: '자동 전달 · 실행 중인 에이전트 세션으로 바로 보냅니다',
  wait: '에이전트 대기 중 · 대기 중인 세션이 받아 갑니다',
  manual: '수동 전달 · 에이전트가 받을 준비가 되지 않았습니다',
};
const DELIVERY_TEXT = {
  submitted: '전달됨 · 응답 대기',
  queued: '대기열에 넣음',
  taken: '에이전트가 받음 · 응답 대기',
  error: '전달 실패',
};

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
  const modeBadge = el('span', 'chat__mode', '연결 확인 중…');
  const sessionSelect = el('select', 'chat__session');
  sessionSelect.hidden = true;
  sessionSelect.title = '보낼 에이전트 세션';
  head.append(modeBadge, sessionSelect);
  const list = el('div', 'chat__list');
  const empty = el('p', 'chat__empty', '선택한 요소와 변경 내용이 함께 전달됩니다. 예: "이 카드 여백을 줄여 줘", "버튼을 헤더 오른쪽으로 옮기는 안을 제안해 줘"');
  list.appendChild(empty);
  const form = el('div', 'chat__form');
  const input = el('textarea', 'chat__input');
  input.rows = 2;
  input.placeholder = '에이전트에게 요청 (Enter 보내기 · Shift+Enter 줄바꿈)';
  const btnSend = el('button', 'btn btn--primary', '보내기');
  btnSend.type = 'button';
  const btnApply = el('button', 'btn', '원본에 반영');
  btnApply.type = 'button';
  btnApply.title = '적용 중인 변경을 handoffs/latest.md에 저장하고, 원본 소스에 반영해 달라고 요청합니다';
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
      modeBadge.textContent = MODE_TEXT[st.mode] || st.mode;
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
      modeBadge.textContent = `개발 서버에 연결하지 못했습니다 · make dev를 실행하세요 (${err.message})`;
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
      if (!res.ok) throw new Error(res.error || '전송 실패');
      if (res.mode === 'manual') notice('에이전트가 아직 받을 준비가 안 돼 대기열에 넣었습니다. 에이전트에게 "frame-mesh 대화 받아 줘"라고 하면 받아 갑니다.');
      refreshStatus();
    } catch (err) {
      notice(`보내지 못했습니다: ${err.message}`);
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
      notice(`전달 묶음을 만들지 못했습니다: ${err.message}`);
      return;
    }
    try {
      const saved = await transport.request('POST', '/handoff', { source: handoff.json.source, markdown: handoff.markdown, json: handoff.json });
      if (!saved.ok) throw new Error(saved.error || '저장 실패');
    } catch (err) {
      notice(`handoffs/에 저장하지 못했습니다: ${err.message}`);
      return;
    }
    send('지금 적용된 변경을 원본 소스에 반영해 주세요. 변경 목록과 diff는 handoffs/latest.md에 있습니다. 인라인 스타일을 그대로 옮기지 말고 기존 CSS 규칙이나 컴포넌트를 고쳐 주세요.', 'apply');
  });

  // ---------- 제안 카드 ----------
  function proposalCard(p) {
    const card = el('div', 'chat__proposal');
    card.dataset.id = p.id;
    card.appendChild(el('div', 'chat__proposal-title', `제안 · ${p.summary || p.id}`));
    card.appendChild(el('div', 'chat__proposal-reason', p.reason ? `이유: ${p.reason}` : '이유가 함께 오지 않았습니다. 대화창에서 이유를 물어보세요.'));
    if (!p.reason) card.lastChild.classList.add('is-missing');
    const ul = el('ul', 'chat__ops');
    p.ops.forEach((o) => {
      const what = o.kind === 'style' ? `${o.prop}: ${o.value || '(원래 값)'}` : o.kind === 'text' ? `문구 → "${o.value}"` : `이동 → ${o.parentLabel || '?'} ${(o.index ?? 0) + 1}번째`;
      ul.appendChild(el('li', '', `${o.label} · ${what}`));
    });
    card.appendChild(ul);
    const row = el('div', 'chat__proposal-actions');
    const btnPreview = el('button', 'btn', '미리보기');
    const btnAccept = el('button', 'btn btn--primary', '수락');
    const btnReject = el('button', 'btn', '거절');
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
      const why = (res.errors || [res.error || '알 수 없는 오류']).join(' / ');
      state.textContent = `적용할 수 없습니다: ${why}`;
      state.classList.add('is-error');
      notice(`제안을 적용할 수 없습니다: ${why}`);
    };

    btnPreview.addEventListener('click', async () => {
      state.classList.remove('is-error');
      if (view.previewId === p.id) {
        await bridge.call('rejectProposal', p.id);
        view.previewId = null;
        btnPreview.textContent = '미리보기';
        state.textContent = '';
        return;
      }
      const res = await bridge.call('previewProposal', p.id, p.summary, p.ops, p.reason);
      if (!res.ok) return fail(res);
      view.previewId = p.id;
      btnPreview.textContent = '미리보기 끄기';
      state.textContent = '페이지에서 미리보는 중';
    });
    btnAccept.addEventListener('click', async () => {
      const res = await bridge.call('acceptProposal', p.id, p.summary, p.ops, p.reason);
      if (!res.ok) return fail(res);
      view.previewId = null;
      finish('accepted', '수락함 · 변경 로그에 추가');
      transport.request('POST', '/chat/proposal', { proposal_id: p.id, status: 'accepted' }).catch(() => {});
    });
    btnReject.addEventListener('click', async () => {
      await bridge.call('rejectProposal', p.id);
      view.previewId = null;
      finish('rejected', '거절함');
      transport.request('POST', '/chat/proposal', { proposal_id: p.id, status: 'rejected' }).catch(() => {});
    });
    if (p.status && p.status !== 'pending') finish(p.status, p.status === 'accepted' ? '수락함' : '거절함');
    return card;
  }

  // ---------- 이벤트 ----------
  function handle(e) {
    if (e.kind === 'user') {
      const meta = el('div', 'chat__meta', '보내는 중…');
      view.deliveries.set(e.request_id, meta);
      bubble('user', e.request_kind === 'apply' ? `[원본에 반영] ${e.text}` : e.text, meta);
    } else if (e.kind === 'delivery') {
      const meta = view.deliveries.get(e.request_id);
      if (meta) meta.textContent = e.state === 'error' ? `${DELIVERY_TEXT.error}: ${e.error || ''} · 다른 방식으로 넘깁니다` : (DELIVERY_TEXT[e.state] || e.state);
    } else if (e.kind === 'assistant') {
      const meta = view.deliveries.get(e.request_id);
      if (meta) meta.textContent = '답변 받음';
      bubble('assistant', e.text);
    } else if (e.kind === 'proposal') {
      const meta = view.deliveries.get(e.proposal.request_id);
      if (meta) meta.textContent = '제안 받음';
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
