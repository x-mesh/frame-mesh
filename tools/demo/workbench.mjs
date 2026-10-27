// 웹 작업실 시연 녹화: index.html에서 예제 시안을 편집하고 뷰포트를 바꿔 본다.
// 실행: ego-browser nodejs -e "await import('file://<repo>/tools/demo/workbench.mjs')"  (make demo가 대신 실행)
import { createRecorder, center, sleep, SERVER } from './lib.mjs';

const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);
const task = await taskSpace('frame-mesh demo');
const page = task.page('p1');
const W = 1600, H = 880;

await page.cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// 작업실은 시안 이름별로 변경 로그를 localStorage에 저장해 다시 열면 복원한다. 깨끗한 화면에서 녹화하고, 끝나면 원래 값을 되돌린다.
const LOG_KEY = 'fm:log:fixtures/sample-plan.en.html';
await page.goto(`${SERVER}/index.html?lang=en&demo=${Date.now()}`);
const savedLog = await page.evaluate((k) => { const v = localStorage.getItem(k); localStorage.removeItem(k); return v; }, LOG_KEY);
await page.reload();
await page.waitForFunction(() => document.getElementById('preview')?.contentDocument?.querySelector('h1'), undefined, { timeout: 10_000 });
await sleep(800);

// 녹화가 중간에 실패해도 브라우저 설정과 로그를 녹화 전 상태로 되돌린다.
let result;
try {
  const rec = await createRecorder({ name: 'workbench', captionOn: 'page', captionTop: 92, surfaces: { page: { page, w: W, h: H } } });
  await rec.setup();
  log('recorder ready');

  const rect = (sel, text) => page.evaluate(([s, t]) => {
    const e = [...document.querySelectorAll(s)].find((n) => !t || n.textContent.includes(t));
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, [sel, text]);
  // 미리보기 iframe은 축소해 보여 주므로, 안쪽 요소 좌표에 축소 비율을 곱하고 iframe 위치를 더한다.
  const inPreview = (sel, text) => page.evaluate(([s, t]) => {
    const frame = document.getElementById('preview');
    const fr = frame.getBoundingClientRect();
    const scale = fr.width / frame.offsetWidth;
    const e = [...frame.contentDocument.querySelectorAll(s)].find((n) => n.textContent.includes(t));
    const r = e.getBoundingClientRect();
    return { x: fr.x + r.x * scale, y: fr.y + r.y * scale, w: r.width * scale, h: r.height * scale };
  }, [sel, text]);
  const field = (prop) => page.evaluate((p) => {
    const input = document.querySelector(`#props .field__label[title="${p}"]`).parentElement.querySelector('input, select');
    input.scrollIntoView({ block: 'center' });
    const r = input.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, prop);
  const selected = () => page.evaluate(() => document.querySelector('#props .props__head')?.textContent.trim() || '');

  await rec.caption('Open a static HTML mockup and edit it in the web workbench');
  await rec.hold(2200);

  // 1. 선택
  await rec.caption('Click to select an element. Double-click to go one level deeper.');
  const title = await inPreview('h1', 'checkout flow');
  const tp = { x: Math.round(title.x + title.w * 0.3), y: Math.round(center(title).y) };
  await rec.click('page', tp.x, tp.y, { after: 600 });
  for (let i = 0; i < 3 && !(await selected()).startsWith('h1'); i += 1) await rec.dblclick('page', tp.x, tp.y, { after: 600 });
  await rec.hold(400);

  // 2. 속성 변경
  log('step 2');
  await rec.caption('Change styles in the property panel.');
  const fs = await field('font-size');
  await rec.click('page', fs.x + 40, center(fs).y, { after: 250 });
  await page.keyboard.press('ControlOrMeta+a');
  await rec.type('page', '40');
  await rec.press('page', 'Enter', 900);
  await page.evaluate(() => document.querySelector('#props').scrollTo({ top: 0 }));
  await rec.hold(1300);

  // 3. 끌어서 순서 바꾸기
  log('step 3');
  await rec.caption('Drag an element to reorder it.');
  const card = await inPreview('li', 'Choose a design');
  const first = await inPreview('li', 'Approve the scope');
  const from = { x: Math.round(card.x + card.w * 0.4), y: Math.round(card.y + 20) };
  await rec.click('page', from.x, from.y, { after: 400 });
  await rec.drag('page', from, { x: from.x, y: Math.round(first.y + 8) });
  await rec.hold(1200);

  // 4. 뷰포트
  log('step 4');
  await rec.caption('Check the result at tablet and mobile widths.');
  const tablet = await rect('#vpSeg [data-key="tablet"]');
  await rec.click('page', center(tablet).x, center(tablet).y, { after: 1400 });
  const mobile = await rect('#vpSeg [data-key="mobile"]');
  await rec.click('page', center(mobile).x, center(mobile).y, { after: 1600 });
  const desktop = await rect('#vpSeg [data-key="desktop"]');
  await rec.click('page', center(desktop).x, center(desktop).y, { after: 900 });

  // 5. 차이 표시
  log('step 5');
  await rec.caption('Show where each change came from.');
  const diff = await rect('#btnDiffView');
  await rec.click('page', center(diff).x, center(diff).y, { after: 2200 });

  // 6. 변경 요약과 전달
  log('step 6');
  await rec.caption('Review the diff, then copy a handoff for your AI coding agent.');
  const summary = await rect('#tabDiff');
  await rec.click('page', center(summary).x, center(summary).y, { after: 1800 });
  const copy = await rect('#btnCopyLog');
  await rec.click('page', center(copy).x, center(copy).y, { after: 2000 });

  await rec.caption(null);
  await rec.click('page', center(diff).x, center(diff).y, { after: 900 });
  result = await rec.finish();
} finally {
  // 작업실은 페이지를 떠날 때도 로그를 저장하므로, 작업실이 없는 같은 출처 주소로 옮긴 뒤 되돌린다.
  await page.goto(`${SERVER}/manifest.json`);
  await page.evaluate(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)), [LOG_KEY, savedLog]);
  await page.cdp('Emulation.clearDeviceMetricsOverride').catch(() => {});
}
console.log(JSON.stringify(result));
