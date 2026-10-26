// 대상 페이지에 편집 엔진을 붙이고, 패널과 포트 메시지로 대화한다.
(() => {
  // 웹 작업실 페이지는 자체 엔진을 쓰므로 건너뛴다. 반환값은 executeScript 결과로 패널에 전달된다.
  if (document.querySelector('meta[name="frame-mesh"][content="host"]')) return 'host';
  if (window.__frameMesh) {
    const prev = window.__frameMesh;
    // 확장을 새로고침하면 이전 스크립트는 런타임 연결이 끊긴 채 남는다. 살아 있을 때만 재사용하고, 아니면 걷어 내고 새로 붙인다.
    if (typeof prev.alive === 'function' && prev.alive() && prev.engine) {
      prev.announce();
      return 'present';
    }
    try { if (prev.engine) prev.engine.destroy(); } catch (_) { /* 이미 끊긴 엔진 */ }
    document.querySelectorAll('fm-overlay, fm-dock').forEach((n) => n.remove());
    delete window.__frameMesh;
  }
  // 확장을 새로고침하면 새 스크립트는 다른 격리 공간에서 돌아 이전 인스턴스의 변수를 볼 수 없다.
  // 페이지 DOM(소유자 속성 + 이벤트)으로 이전 인스턴스를 끄고, 남은 UI와 요소 ID를 걷어 낸다.
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.documentElement.setAttribute('data-fm-owner', instanceId);
  document.dispatchEvent(new CustomEvent('fm:shutdown'));
  document.querySelectorAll('fm-overlay, fm-dock').forEach((n) => n.remove());
  const boot = { ports: new Set(), engine: null, dock: null, restored: false, saveTimer: 0 };
  document.addEventListener('fm:shutdown', () => {
    if (document.documentElement.getAttribute('data-fm-owner') === instanceId) return;
    try { if (boot.engine) boot.engine.destroy(); } catch (_) { /* 이미 끊긴 엔진 */ }
    if (boot.dock) boot.dock.host.remove();
    boot.engine = null;
    boot.dock = null;
    // 종료된 인스턴스가 남아 있으면 다음 주입이 재사용하려다 멈춘다.
    if (window.__frameMesh === boot) delete window.__frameMesh;
    boot.ports.forEach((port) => { try { port.disconnect(); } catch (_) { /* 끊긴 포트 */ } });
  });
  const RECEIVER_KEY = 'fm:receiver';
  const DOCK_KEY = 'fm:dock';
  const DEFAULT_RECEIVER = 'http://127.0.0.1:4173/handoff';
  window.__frameMesh = boot;
  boot.alive = () => {
    try { return !!chrome.runtime.id; } catch (_) { return false; }
  };
  // 변경 로그는 URL 단위로 저장한다. 같은 페이지를 다시 열면(F5 포함) 패널이 붙을 때 복원한다.
  const LOG_KEY = `fm:log:${location.origin}${location.pathname}${location.search}`;
  const SAVE_DEBOUNCE_MS = 300;

  function persist() {
    clearTimeout(boot.saveTimer);
    boot.saveTimer = setTimeout(async () => {
      if (!boot.engine) return;
      const data = boot.engine.exportOps();
      if (!data.ops.length) {
        await chrome.storage.local.remove(LOG_KEY);
        return;
      }
      await chrome.storage.local.set({ [LOG_KEY]: { url: location.href, savedAt: Date.now(), ...data } });
    }, SAVE_DEBOUNCE_MS);
  }

  function notify(message) {
    boot.ports.forEach((port) => port.postMessage({ type: 'notice', message }));
    if (boot.dock) boot.dock.notice(message);
  }

  async function restoreOnce() {
    if (boot.restored || !boot.engine) return;
    boot.restored = true;
    const stored = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY];
    if (!stored || !stored.ops || !stored.ops.length) return;
    const r = boot.engine.restoreOps(stored);
    notify(`이전 변경 ${r.restored}건을 복원했습니다${r.lost ? ` (${r.lost}건은 아직 요소를 찾지 못함)` : ''}.`);
  }

  // 엔진 메서드 앞에서 가로채는 호스트 명령
  const hostMethods = {
    clearLog: async () => {
      boot.engine.clearHistory();
      clearTimeout(boot.saveTimer);
      await chrome.storage.local.remove(LOG_KEY);
      return null;
    },
  };

  const treeNeeded = (ev) => !ev || ev.type === 'load' || ev.type === 'dom' || (ev.type === 'history' && (ev.kind === 'move' || ev.kind === 'clear'));

  function broadcast(ev) {
    if (!boot.engine) return;
    const state = boot.engine.getState({ tree: treeNeeded(ev) });
    boot.ports.forEach((port) => port.postMessage({ type: 'state', state }));
    if (boot.dock) {
      boot.dock.update(state);
      boot.dock.setVisible(state.mode === 'select');
    }
    chrome.runtime.sendMessage({ type: 'badge', count: state.applied }).catch(() => {});
    if (ev && ev.type === 'history') persist();
  }

  // 대화 요청은 사이드 패널이 대신 보낸다. https 페이지에서 127.0.0.1로 직접 요청하면 브라우저가 막을 수 있다.
  const chatPending = new Map();
  let chatSeq = 0;
  const chatTransport = {
    request: (method, path, body) => new Promise((resolve, reject) => {
      const port = [...boot.ports][0];
      if (!port) {
        reject(new Error('사이드 패널이 연결되어 있지 않습니다'));
        return;
      }
      const id = ++chatSeq;
      chatPending.set(id, { resolve, reject });
      port.postMessage({ type: 'chat', id, method, path, body });
    }),
  };

  const callEngine = (method, ...args) => {
    const fn = hostMethods[method] || ((...rest) => boot.engine[method](...rest));
    return fn(...args);
  };

  // 페이지 아래 도크: 도구 모음·변경 로그·전달. 엔진과 같은 세계에 있어 포트 없이 직접 부른다.
  async function mountDock(engine) {
    const [{ createDock }, css] = await Promise.all([
      import(chrome.runtime.getURL('src/panel/dock.js')),
      fetch(chrome.runtime.getURL('src/panel/panel.css')).then((r) => r.text()),
    ]);
    const dock = createDock({
      doc: document,
      win: window,
      panelCss: css,
      bridge: { call: (method, ...args) => Promise.resolve(callEngine(method, ...args)) },
      receiver: {
        get: async () => (await chrome.storage.local.get(RECEIVER_KEY))[RECEIVER_KEY] || DEFAULT_RECEIVER,
        set: async (url) => chrome.storage.local.set({ [RECEIVER_KEY]: url || DEFAULT_RECEIVER }),
        post: (payload) => chatTransport.request('POST', '/handoff', payload),
      },
      prefs: {
        get: async () => (await chrome.storage.local.get(DOCK_KEY))[DOCK_KEY] || null,
        set: async (p) => chrome.storage.local.set({ [DOCK_KEY]: p }),
      },
      chatTransport,
      // 사이드 패널은 사용자 동작 안에서만 열 수 있어, 클릭 처리 중에 바로 요청한다.
      onOpenPanel: () => chrome.runtime.sendMessage({ type: 'open-panel' }).catch(() => {}),
    });
    engine.registerUiRoot(dock.host);
    boot.dock = dock;
    const state = engine.getState({ tree: false });
    dock.update(state);
    dock.setVisible(state.mode === 'select');
  }
  boot.announce = () => broadcast(null);

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'fm-panel') return;
    boot.ports.add(port);
    // 패널이 붙어 있는 동안만 선택 모드. 떨어지면 페이지를 원래대로 쓸 수 있게 대기 모드로 돌아간다.
    if (boot.engine && boot.ports.size === 1) boot.engine.setMode('select');
    if (boot.engine) restoreOnce();
    port.onDisconnect.addListener(() => {
      boot.ports.delete(port);
      if (boot.engine && boot.ports.size === 0) boot.engine.setMode('interact');
    });
    port.onMessage.addListener(async (msg) => {
      if (msg && msg.type === 'chat-result') {
        const p = chatPending.get(msg.id);
        if (!p) return;
        chatPending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.value);
        return;
      }
      if (!msg || msg.type !== 'call') return;
      if (!boot.engine) {
        port.postMessage({ type: 'result', id: msg.id, error: '아직 페이지를 준비하는 중입니다. 잠시 뒤 다시 시도하세요.' });
        return;
      }
      try {
        const value = await callEngine(msg.method, ...(msg.args || []));
        port.postMessage({ type: 'result', id: msg.id, value: value === undefined ? null : value });
      } catch (err) {
        port.postMessage({ type: 'result', id: msg.id, error: err.message });
      }
    });
    if (boot.engine) port.postMessage({ type: 'state', state: boot.engine.getState({ tree: true }) });
  });

  import(chrome.runtime.getURL('src/core/engine.js')).then(({ createEngine }) => {
    const engine = createEngine({
      doc: document,
      win: window,
      source: location.href,
      onChange: broadcast,
      onNotice: (message) => notify(message),
      initialMode: boot.ports.size ? 'select' : 'interact',
      blockNavigation: false,
    });
    boot.engine = engine;
    engine.init();
    if (boot.ports.size) restoreOnce();
    mountDock(engine).catch((err) => console.error('frame-mesh: 도크 로드 실패', err));
  }).catch((err) => console.error('frame-mesh: 엔진 로드 실패', err));
  return 'injected';
})();
