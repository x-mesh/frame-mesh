// 툴바 아이콘: 창의 사이드 패널을 열고 현재 탭에 편집 엔진을 주입한다.
// sidePanel.open은 사용자 동작 안에서만 허용되므로 await 없이 먼저 호출한다.
// 패널은 탭에 묶지 않는다. 열린 패널이 활성 탭을 따라가야 "지금 보는 페이지"와 어긋나지 않는다.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => console.warn('frame-mesh: 사이드 패널 열기 실패', err));
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extension/content.js'] })
    .catch((err) => console.warn('frame-mesh: 주입 실패', err));
});

// 패널이 따라간 탭에 엔진을 주입한다. content.js의 반환값('host'면 작업실 페이지)을 그대로 돌려준다.
// 페이지의 "변경 적용 중" 알림을 누르면 그 창의 사이드 패널을 연다.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'open-panel' || !sender.tab) return false;
  chrome.sidePanel.open({ windowId: sender.tab.windowId })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

// 툴바 아이콘에 탭별 적용 중 변경 수를 표시한다.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'badge' || !sender.tab) return false;
  const text = msg.count ? String(msg.count) : '';
  chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#f59e0b' });
  chrome.action.setBadgeText({ tabId: sender.tab.id, text });
  return false;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'inject') return false;
  chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['extension/content.js'] })
    .then((results) => sendResponse({ ok: true, result: results && results[0] ? results[0].result : null }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
