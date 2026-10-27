// 확장 시연 녹화: 실제 사이트(Wikipedia 문서) 탭과 사이드 패널(일반 탭으로 연 panel.html)을 함께 찍는다.
// 문서 본문은 CC BY-SA 4.0이므로 README에 출처를 밝힌다. 로그인하지 않은 상태로 찍어야 계정 정보가 나오지 않는다.
// 실행: ego-browser nodejs -e "await import('file://<repo>/tools/demo/extension.mjs')"  (make demo가 대신 실행)
import { createRecorder, center, sleep } from './lib.mjs';

const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);
const task = await taskSpace('frame-mesh demo');
const page = task.page('p1');
const pages = await task.pages();
const panel = pages.find((p) => p.label === 'p2') || (await task.newPage());

// 압축 해제로 설치한 확장의 ID는 설치 경로마다 달라, 확장 관리 화면에서 이름으로 찾는다.
const extPage = await task.newPage();
await extPage.goto('chrome://extensions');
await sleep(600);
const extId = await extPage.evaluate(() => {
  const list = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list');
  const item = [...list.shadowRoot.querySelectorAll('extensions-item')].find((i) => /frame-mesh/i.test(i.shadowRoot.querySelector('#name')?.textContent || ''));
  return item ? item.id : null;
});
await extPage.close();
log('ext id');
if (!extId) throw new Error('frame-mesh 확장을 찾지 못했습니다. chrome://extensions에서 저장소 루트를 먼저 로드하세요.');

const W = 1040, H = 760, PW = 360;
const TARGET = 'https://en.wikipedia.org/wiki/Web_browser';
const url = `${TARGET}?demo=${Date.now()}`;
const logKey = `fm:log:${new URL(url).origin}${new URL(url).pathname}${new URL(url).search}`;

await panel.goto(`chrome-extension://${extId}/extension/panel.html`);
await sleep(500);
// 녹화 중에만 도크 높이를 낮춘다. 끝나면 원래 설정으로 되돌린다.
const savedDock = await panel.evaluate(async () => (await chrome.storage.local.get('fm:dock'))['fm:dock'] ?? null);
await panel.evaluate(async () => chrome.storage.local.set({ 'fm:dock': { height: 190, collapsed: false } }));
const restore = async () => {
  await panel.evaluate(async ([saved, key]) => {
    if (saved) await chrome.storage.local.set({ 'fm:dock': saved });
    else await chrome.storage.local.remove('fm:dock');
    await chrome.storage.local.remove(key);
  }, [savedDock, logKey]);
  for (const p of [page, panel]) await p.cdp('Emulation.clearDeviceMetricsOverride').catch(() => {});
};

await page.goto(url);
await sleep(1200);
// 패널을 일반 탭으로 열면 활성 탭을 따라가 다른 탭에 붙을 수 있어, ?tab=으로 시안 탭에 고정한다.
const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
const loggedIn = await page.evaluate(() => !document.querySelector('#pt-login, #pt-login-2, a[href*="Special:UserLogin"]'));
if (loggedIn) { await restore(); throw new Error('Wikipedia에 로그인된 상태입니다. 계정 이름이 찍히지 않도록 로그아웃한 뒤 다시 실행하세요.'); }
if (!tabId) { await restore(); throw new Error(`대상 탭을 찾지 못했습니다: ${url}`); }
await panel.goto(`chrome-extension://${extId}/extension/panel.html?tab=${tabId}`);
log('panel connected');
await sleep(1200);

// 녹화가 중간에 실패해도 브라우저 설정과 로그를 녹화 전 상태로 되돌린다.
let result;
try {
  const rec = await createRecorder({ name: 'extension', captionOn: 'page', surfaces: { page: { page, w: W, h: H }, panel: { page: panel, w: PW, h: H } } });
  await rec.setup();
  log('recorder ready');
  await sleep(600);

  const elRect = (sel, text) => page.evaluate(([s, t]) => {
    const e = [...document.querySelectorAll(s)].find((n) => n.textContent.includes(t));
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, [sel, text]);
  const dock = (key) => page.evaluate((k) => {
    const sr = document.querySelector('fm-dock').shadowRoot;
    const e = k.startsWith('#') ? sr.querySelector(k) : [...sr.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(k) && b.getBoundingClientRect().width > 0);
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, key);
  const field = (prop) => panel.evaluate((p) => {
    const input = document.querySelector(`#props .field__label[title="${p}"]`).parentElement.querySelector('input, select');
    input.scrollIntoView({ block: 'center' });
    const r = input.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, prop);
  const panelButton = (text) => panel.evaluate((t) => {
  const b = [...document.querySelectorAll('#props button')].find((n) => n.textContent.trim().startsWith(t) && n.getBoundingClientRect().width > 0);
  b.scrollIntoView({ block: 'nearest' });
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, text);
const selected = () => panel.evaluate(() => document.querySelector('.props__head')?.textContent.trim() || '');

  await rec.caption('Edit a live page, then hand the changes to your AI coding agent');
  await rec.hold(2200);

  // 1. 선택
  await rec.caption('Click to select an element. Double-click to go one level deeper.');
  const title = await elRect('h1', 'Web browser');
  const tp = { x: title.x + 60, y: center(title).y };
  await rec.click('page', tp.x, tp.y, { after: 700 });
  for (let i = 0; i < 3 && !(await selected()).startsWith('h1'); i += 1) await rec.dblclick('page', tp.x, tp.y, { after: 700 });
  await rec.hold(500);

  log('step 2');
  // 2. 속성 변경
  await rec.caption('Change styles in the side panel. The page updates as you type.');
  const fs = await field('font-size');
  await rec.click('panel', fs.x + 40, center(fs).y, { after: 250 });
  await panel.keyboard.press('ControlOrMeta+a');
  await rec.type('panel', '40');
  await rec.press('panel', 'Enter', 900);
  await panel.evaluate(() => document.querySelector('#props').scrollTo({ top: 0 }));
  await rec.hold(1500);

  log('step 3');
  // 3. 핸들로 크기 바꾸기, 부모 고르기, 구조 버튼으로 옮기기
  // 끌기는 포인터 아래의 선택 단위를 옮긴다. 이 문서에서 사진 카드는 img·링크가 먼저 잡혀 통째로 끌 수 없어, 크기는 핸들로 바꾸고 이동은 구조 버튼으로 한다.
  await rec.caption('Drag a handle to resize. Hold Shift to keep the aspect ratio.');
  const img = await elRect('figure img', '');
  await rec.click('page', Math.round(img.x + img.w / 2), Math.round(img.y + img.h / 2), { after: 500 });
  if (!(await selected()).startsWith('img')) throw new Error(`사진 대신 다른 요소가 선택되었습니다: ${(await selected()).slice(0, 40)}`);
  const corner = { x: Math.round(img.x + img.w), y: Math.round(img.y + img.h) };
  await page.keyboard.down('Shift');
  await rec.drag('page', corner, { x: corner.x + 60, y: corner.y + 60 });
  await page.keyboard.up('Shift');
  await rec.hold(900);

  await rec.caption('Select the parent, then move it with the structure buttons.');
  // 사진과 카드 사이에 링크(a)가 있어, 카드가 선택될 때까지 부모로 올라간다.
  for (let i = 0; i < 3 && !(await selected()).startsWith('figure'); i += 1) {
    const parentBtn = await panelButton('↑ 부모');
    await rec.click('panel', center(parentBtn).x, center(parentBtn).y, { after: 600 });
  }
  if (!(await selected()).startsWith('figure')) throw new Error(`사진 카드가 선택되지 않았습니다: ${(await selected()).slice(0, 40)}`);
  const down = await panelButton('▼ 뒤로');
  await rec.click('panel', center(down).x, center(down).y, { after: 1500 });

  log('step 4');
  // 4. 편집 스위치
  await rec.caption('Press E to use the page as usual. Press E again to edit.');
  const toggle = await dock('#modeToggle');
  await rec.move('page', center(toggle).x + 70, center(toggle).y - 40);
  await rec.press('page', 'e', 1300);
  await rec.press('page', 'e', 900);

  log('step 5');
  // 5. 차이 표시
  await rec.caption('Show where each change came from.');
  const view = await dock('보기');
  await rec.click('page', center(view).x, center(view).y, { after: 300 });
  const diffBtn = await dock('#btnDiffView');
  await rec.click('page', center(diffBtn).x, center(diffBtn).y, { after: 300 });
  await rec.click('page', center(view).x, center(view).y, { after: 2000 });

  log('step 6');
  // 6. 변경 요약과 전달
  await rec.caption('Review the diff, then copy a handoff for your agent.');
  const summary = await dock('변경 요약');
  await rec.click('page', center(summary).x, center(summary).y, { after: 1800 });
  const copy = await dock('#btnCopyLog');
  await rec.click('page', center(copy).x, center(copy).y, { after: 1800 });

  log('step 7');
  // 7. 처음 상태로
  await rec.caption('Reset to the original page at any time.');
  await rec.click('page', center(view).x, center(view).y, { after: 200 });
  const diffOff = await dock('#btnDiffView');
  await rec.click('page', center(diffOff).x, center(diffOff).y, { after: 200 });
  await rec.click('page', center(view).x, center(view).y, { after: 300 });
  const reset = await dock('#btnReset');
  await rec.click('page', center(reset).x, center(reset).y, { after: 2000 });

  await rec.caption(null);
  await rec.hold(800);
  result = await rec.finish();
} finally {
  await restore();
}

console.log(JSON.stringify(result));
