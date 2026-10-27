// 버튼에 마우스를 올리고 잠시 지나면 title 문구를 말풍선으로 보여 준다.
// 브라우저 기본 툴팁은 늦게 뜨고 모양이 운영체제마다 달라, 말풍선이 보이는 동안만 title을 치워 두었다가 되돌린다.
const SHOW_DELAY_MS = 400;
const GAP = 6;
const EDGE = 4;
// iframe의 title은 접근성용 이름이라 말풍선을 띄우지 않는다.
const SKIP = 'iframe';

export function installTooltips(root, { container, doc, win }) {
  const tip = doc.createElement('div');
  tip.className = 'fm-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  container.appendChild(tip);
  let target = null;
  let saved = null;
  let timer = 0;

  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
    // 말풍선이 떠 있는 동안 코드가 title을 새로 넣었다면 그 값을 남긴다.
    if (target && saved !== null && !target.hasAttribute('title')) target.setAttribute('title', saved);
    target = null;
    saved = null;
  };

  const place = (el) => {
    const r = el.getBoundingClientRect();
    tip.hidden = false;
    const t = tip.getBoundingClientRect();
    let top = r.bottom + GAP;
    if (top + t.height > win.innerHeight - EDGE) top = r.top - GAP - t.height;
    const left = Math.max(EDGE, Math.min(r.left + r.width / 2 - t.width / 2, win.innerWidth - t.width - EDGE));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(EDGE, top))}px`;
  };

  const onOver = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[title]') : null;
    if (el && el === target) return;
    hide();
    if (!el || el.matches(SKIP) || !el.getAttribute('title')) return;
    target = el;
    saved = el.getAttribute('title');
    el.removeAttribute('title');
    timer = setTimeout(() => {
      if (target !== el) return;
      tip.textContent = saved;
      place(el);
    }, SHOW_DELAY_MS);
  };
  const onOut = (e) => {
    if (target && !(e.relatedTarget && target.contains(e.relatedTarget))) hide();
  };

  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('pointerdown', hide, true);
  doc.addEventListener('keydown', hide, true);
  win.addEventListener('scroll', hide, true);
  win.addEventListener('blur', hide);

  return {
    destroy() {
      hide();
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('pointerdown', hide, true);
      doc.removeEventListener('keydown', hide, true);
      win.removeEventListener('scroll', hide, true);
      win.removeEventListener('blur', hide);
      tip.remove();
    },
  };
}
