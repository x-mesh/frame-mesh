// 툴바 아이콘: 창의 사이드 패널을 열고 현재 탭에 편집 엔진을 주입한다.
// sidePanel.open은 사용자 동작 안에서만 허용되므로 await 없이 먼저 호출한다.
// 패널은 탭에 묶지 않는다. 열린 패널이 활성 탭을 따라가야 "지금 보는 페이지"와 어긋나지 않는다.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => console.warn('frame-mesh: could not open the side panel', err));
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extension/content.js'] })
    .catch((err) => console.warn('frame-mesh: injection failed', err));
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

// 대화 요청에 붙일 캡처. 보이는 탭을 찍고 선택 영역만 잘라 PNG data URL로 돌려준다.
// 자르기는 여기서 한다. 페이지 안(content script)에서 data URL 그림을 읽으면 페이지 CSP에 막힐 수 있다.
async function captureRegion(windowId, rect) {
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
  const scale = bitmap.width / rect.viewportWidth;
  const sx = Math.round(rect.left * scale);
  const sy = Math.round(rect.top * scale);
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * scale)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * scale)));
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { dataUrl: `data:image/png;base64,${btoa(bin)}`, width: sw, height: sh };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'capture' || !sender.tab || !msg.rect) return false;
  captureRegion(sender.tab.windowId, msg.rect)
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
