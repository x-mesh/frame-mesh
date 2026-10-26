// 변경 이력과 대상 문서를 LLM에 전달할 형태로 정리한다.
const UI_ATTR = 'data-fm-ui';
const SNIPPET_LIMIT = 4000;
// 전체 HTML이 이보다 크면 변경된 요소의 조각만 싣는다.
const FULL_HTML_LIMIT = 200000;

export function elementPath(el) {
  const parts = [];
  for (let cur = el; cur && cur.tagName && cur.tagName.toLowerCase() !== 'html'; cur = cur.parentElement) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`${tag}#${cur.id}`);
      break;
    }
    const parent = cur.parentElement;
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur.tagName) : [cur];
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
  }
  return parts.join(' > ');
}

export function describeOp(op) {
  if (op.kind === 'batch') return `제안 "${op.summary}" (${op.ops.length}건): ${op.ops.map(describeOp).join('; ')}${op.reason ? ` — 이유: ${op.reason}` : ''}`;
  if (op.kind === 'style') return `${op.prop}: ${op.before || '(기본)'} → ${op.after || '(기본)'}`;
  if (op.kind === 'text') {
    const cut = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);
    return `문구: "${cut(op.before)}" → "${cut(op.after)}"`;
  }
  if (op.kind === 'styles') {
    if (op.gesture === 'offset' || op.gesture === 'nudge') return `위치 오프셋 → left ${op.after.left}, top ${op.after.top}`;
    if (op.gesture === 'resize') return `크기 → ${Object.entries(op.after).map(([p, v]) => `${p} ${v}`).join(', ')}`;
    return Object.entries(op.after).map(([p, v]) => `${p}: ${v || '(기본)'}`).join(', ');
  }
  if (op.from.parent === op.to.parent) return `${op.toLabel} 안에서 ${op.from.index + 1}번째 → ${op.to.index + 1}번째`;
  return `${op.fromLabel} → ${op.toLabel} ${op.to.index + 1}번째`;
}

function stripMarks(root) {
  root.querySelectorAll(`[${UI_ATTR}]`).forEach((n) => n.remove());
  const all = [root, ...root.querySelectorAll('*')];
  all.forEach((n) => {
    Array.from(n.attributes).forEach((a) => {
      if (a.name.startsWith('data-fm-')) n.removeAttribute(a.name);
    });
  });
  return root;
}

// 작업실이 주입한 속성과 요소를 제거한 문서 HTML
export function cleanHtml(doc) {
  const clone = stripMarks(doc.documentElement.cloneNode(true));
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>\n` : '';
  return `${doctype}${clone.outerHTML}\n`;
}

export function cleanOuterHtml(el) {
  const html = stripMarks(el.cloneNode(true)).outerHTML;
  return html.length > SNIPPET_LIMIT ? `${html.slice(0, SNIPPET_LIMIT)}\n<!-- … ${html.length - SNIPPET_LIMIT}자 생략 -->` : html;
}

export function diffText(diff) {
  return diff.map((d) => [`@@ ${d.label} — ${d.currentPath || d.path}`, ...d.lines.map((l) => `${l.sign} ${l.text}`)].join('\n')).join('\n\n');
}

export function buildHandoff({ sourceName, ops, cursor, doc, viewportLabel, byId, htmlMode, diff = [] }) {
  // 복원 실패(새로고침 뒤 요소를 찾지 못한) 변경은 적용되지 않았으므로 따로 적는다.
  const applied = ops.slice(0, cursor).filter((op) => !op.lost);
  const lostOps = ops.slice(0, cursor).filter((op) => op.lost);
  const undone = ops.length - cursor;
  const fullHtml = cleanHtml(doc);
  const mode = htmlMode || (fullHtml.length > FULL_HTML_LIMIT ? 'changed' : 'full');
  const hasOffset = applied.some((op) => op.kind === 'styles' && (op.gesture === 'offset' || op.gesture === 'nudge'));
  const currentPath = (id) => {
    const el = byId(id);
    return el ? elementPath(el) : null;
  };

  const items = applied.map((op, i) => {
    const now = currentPath(op.target);
    const moved = now && now !== op.path ? ` (현재 위치: ${now})` : '';
    const lost = now ? '' : ' (요소를 더 찾을 수 없음)';
    return `${i + 1}. \`${op.label}\` — ${describeOp(op)} [${viewportLabel(op)}]\n   - 원래 경로: \`${op.path}\`${moved}${lost}`;
  });

  const resultSection = [];
  if (mode === 'full') {
    resultSection.push('## 결과 HTML', '', '```html', fullHtml.trimEnd(), '```');
  } else {
    resultSection.push('## 변경된 요소의 현재 HTML', '', '페이지 전체가 커서 변경된 요소만 싣습니다. 경로는 위 변경 목록의 현재 위치입니다.', '');
    const seen = new Set();
    applied.forEach((op, i) => {
      if (seen.has(op.target)) return;
      seen.add(op.target);
      const el = byId(op.target);
      resultSection.push(`### ${i + 1}. \`${op.label}\``, '', '```html', el ? cleanOuterHtml(el) : '(요소를 더 찾을 수 없음)', '```', '');
    });
  }

  const markdown = [
    '# frame-mesh 변경 전달',
    '',
    `- 원본: \`${sourceName}\``,
    `- 적용된 변경: ${applied.length}건${undone ? ` (취소된 변경 ${undone}건은 제외)` : ''}`,
    '- 변경은 요소의 인라인 스타일과 DOM 순서로 적용된 상태입니다.',
    '',
    '## 변경 목록',
    '',
    items.length ? items.join('\n') : '(없음)',
    '',
    ...(diff.length ? ['## 원본 대비 변경 (diff)', '', '여러 번 바꾼 속성은 처음 값과 최종 값만 보여 줍니다.', '', '```diff', diffText(diff), '```', ''] : []),
    ...(lostOps.length ? ['## 적용되지 않은 변경 (새로고침 뒤 요소를 찾지 못함)', '', ...lostOps.map((op) => `- \`${op.label}\` — ${describeOp(op)} (경로: \`${op.path}\`)`), ''] : []),
    '## 요청',
    '',
    '- 위 변경을 원본 소스에 반영해 주세요. 인라인 스타일을 그대로 두지 말고 기존 CSS 규칙을 수정하거나 필요한 규칙을 추가하세요.',
    '- 변경 목록에 없는 본문, 구조, 동작은 바꾸지 마세요.',
    applied.some((op) => op.kind === 'text') ? '- `문구:` 변경은 스타일이 아니라 글 내용입니다. 원본 소스의 해당 텍스트(다국어 리소스가 있으면 그 파일)를 고쳐 주세요.' : null,
    hasOffset ? '- `위치 오프셋`(position: relative + left/top)은 작업실에서 끌어 놓은 임시 값입니다. 의도한 위치를 유지하는 적절한 레이아웃 속성(정렬, 여백, 순서)으로 바꿔 주세요.' : null,
    '- 반영 후 데스크톱(1280px)과 모바일(390px)에서 결과를 확인해 주세요.',
    '',
    ...resultSection,
    '',
  ].filter((line) => line !== null).join('\n');

  const json = {
    tool: 'frame-mesh',
    version: 2,
    source: sourceName,
    exportedAt: new Date().toISOString(),
    htmlMode: mode,
    operations: applied.map((op, i) => ({ n: i + 1, ...op, description: describeOp(op), currentPath: currentPath(op.target) })),
    undoneCount: undone,
    diff,
    lostOperations: lostOps.map((op) => ({ ...op, description: describeOp(op) })),
    html: mode === 'full' ? fullHtml : null,
  };
  return { markdown, json };
}
