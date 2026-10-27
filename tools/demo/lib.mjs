// 시연 녹화기. 동작 한 단계마다 화면을 찍고 그 프레임을 보여 줄 시간을 기록한다.
// 실시간 녹화 대신 단계별로 찍으므로 페이지와 사이드 패널 두 화면이 어긋나지 않고, 캡처 속도와 무관하게 영상 속도가 일정하다.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SERVER = 'http://127.0.0.1:4173';

// 화면 캡처에는 실제 포인터가 찍히지 않아 가짜 포인터와 자막을 페이지에 그린다.
// <body> 밖(<html> 바로 아래)에 붙여 frame-mesh 레이어 목록에 나오지 않게 하고, pointer-events: none으로 클릭을 가로막지 않게 한다.
function installOverlay(captionTop = 18) {
  if (document.getElementById('__demo_cursor')) return;
  const cursor = document.createElement('div');
  cursor.id = '__demo_cursor';
  cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5l13.5 9.2-6.2 1.1 3.4 7.3-2.9 1.3-3.3-7.4L5 18.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', display: 'none', transform: 'translate(-3px,-2px)' });
  const ring = document.createElement('div');
  ring.id = '__demo_ring';
  Object.assign(ring.style, { position: 'fixed', width: '34px', height: '34px', marginLeft: '-17px', marginTop: '-17px', borderRadius: '50%', border: '3px solid rgba(37,99,235,0.85)', background: 'rgba(37,99,235,0.18)', zIndex: '2147483646', pointerEvents: 'none', display: 'none' });
  const caption = document.createElement('div');
  caption.id = '__demo_caption';
  Object.assign(caption.style, { position: 'fixed', left: '50%', top: `${captionTop}px`, transform: 'translateX(-50%)', maxWidth: '86%', padding: '10px 18px', borderRadius: '10px', background: 'rgba(17,17,24,0.88)', color: '#fff', font: '600 17px/1.35 -apple-system, "Segoe UI", sans-serif', letterSpacing: '0.1px', zIndex: '2147483647', pointerEvents: 'none', display: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', textAlign: 'center' });
  document.documentElement.append(ring, cursor, caption);
}

function setOverlay({ x, y, show, ring, caption }) {
  const c = document.getElementById('__demo_cursor');
  const r = document.getElementById('__demo_ring');
  const cap = document.getElementById('__demo_caption');
  if (!c) return;
  if (show !== undefined) c.style.display = show ? 'block' : 'none';
  if (x !== undefined) { c.style.left = `${x}px`; c.style.top = `${y}px`; r.style.left = `${x}px`; r.style.top = `${y}px`; }
  if (ring !== undefined) r.style.display = ring ? 'block' : 'none';
  if (caption !== undefined) { cap.textContent = caption || ''; cap.style.display = caption ? 'block' : 'none'; }
}

export async function createRecorder({ name, surfaces, captionOn, captionTop = 18 }) {
  const dir = path.join(ROOT, '.demo-frames', name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const keys = Object.keys(surfaces);
  const pos = Object.fromEntries(keys.map((k) => [k, { x: surfaces[k].w / 2, y: surfaces[k].h / 2 }]));
  const frames = [];
  let active = null;

  const sync = (k) => surfaces[k].page.evaluate(setOverlay, { x: pos[k].x, y: pos[k].y, show: active === k });

  const rec = {
    async setup() {
      for (const k of keys) {
        const s = surfaces[k];
        await s.page.cdp('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
        // 뒤쪽 탭은 렌더링이 멈출 수 있어, 모든 탭을 보이는 상태로 취급하게 한다.
        await s.page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
        await s.page.evaluate(installOverlay, captionTop);
      }
      await new Promise((r) => setTimeout(r, 400));
    },
    async reinstall(k) {
      await surfaces[k].page.evaluate(installOverlay, captionTop);
      await sync(k);
    },
    async shot(ms) {
      const n = String(frames.length).padStart(4, '0');
      const entry = { ms };
      for (const k of keys) {
        const { data } = await surfaces[k].page.cdp('Page.captureScreenshot', { format: 'png' });
        const file = `${n}-${k}.png`;
        await writeFile(path.join(dir, file), Buffer.from(data, 'base64'));
        entry[k] = file;
      }
      frames.push(entry);
    },
    hold(ms) { return rec.shot(ms); },
    async focus(k) {
      if (active === k) return;
      const prev = active;
      active = k;
      if (prev) await sync(prev);
      await sync(k);
    },
    async move(k, x, y, { steps = 12, stepMs = 33 } = {}) {
      await rec.focus(k);
      const from = { ...pos[k] };
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        pos[k] = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
        await surfaces[k].page.mouse.move(pos[k].x, pos[k].y);
        await sync(k);
        await rec.shot(stepMs);
      }
    },
    async click(k, x, y, { after = 350 } = {}) {
      await rec.move(k, x, y);
      const p = surfaces[k].page;
      await p.evaluate(setOverlay, { ring: true });
      await rec.shot(90);
      await p.mouse.click(x, y);
      await new Promise((r) => setTimeout(r, 250));
      await p.evaluate(setOverlay, { ring: false });
      await rec.reinstall(k);
      await rec.shot(after);
    },
    async dblclick(k, x, y, opts = {}) {
      await rec.move(k, x, y);
      const p = surfaces[k].page;
      await p.evaluate(setOverlay, { ring: true });
      await rec.shot(90);
      await p.mouse.click(x, y, { clickCount: 1 });
      await p.mouse.click(x, y, { clickCount: 2 });
      await new Promise((r) => setTimeout(r, 300));
      await p.evaluate(setOverlay, { ring: false });
      await rec.shot(opts.after ?? 350);
    },
    async drag(k, from, to, { steps = 22 } = {}) {
      const p = surfaces[k].page;
      await rec.move(k, from.x, from.y);
      await p.mouse.down();
      await p.evaluate(setOverlay, { ring: true });
      await rec.shot(120);
      await rec.move(k, to.x, to.y, { steps, stepMs: 40 });
      await rec.shot(250);
      await p.mouse.up();
      await new Promise((r) => setTimeout(r, 300));
      await p.evaluate(setOverlay, { ring: false });
      await rec.shot(400);
    },
    async type(k, text, { charMs = 110 } = {}) {
      for (const ch of text) {
        await surfaces[k].page.keyboard.type(ch);
        await rec.shot(charMs);
      }
    },
    async press(k, key, after = 300) {
      await surfaces[k].page.keyboard.press(key);
      await new Promise((r) => setTimeout(r, 250));
      await rec.shot(after);
    },
    async caption(text) {
      await surfaces[captionOn].page.evaluate(setOverlay, { caption: text });
    },
    async finish() {
      await writeFile(path.join(dir, 'frames.json'), JSON.stringify({ surfaces: keys, sizes: Object.fromEntries(keys.map((k) => [k, [surfaces[k].w, surfaces[k].h]])), frames }, null, 1));
      const total = frames.reduce((a, f) => a + f.ms, 0);
      return { dir, frames: frames.length, seconds: Math.round(total / 100) / 10 };
    },
  };
  return rec;
}

export const center = (r) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
