// 변경 이력과 대상 문서를 LLM에 전달할 형태로 정리한다.
import { t } from './i18n.js';

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
  const dflt = t('op.default');
  if (op.kind === 'batch') return t('op.proposal', { summary: op.summary, n: op.ops.length, ops: op.ops.map(describeOp).join('; ') }) + (op.reason ? t('op.reason', { reason: op.reason }) : '');
  if (op.kind === 'style') return `${op.prop}: ${op.before || dflt} → ${op.after || dflt}`;
  if (op.kind === 'text') {
    const cut = (s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
    return t('op.text', { before: cut(op.before), after: cut(op.after) });
  }
  if (op.kind === 'styles') {
    if (op.gesture === 'offset' || op.gesture === 'nudge') return t('op.offset', { left: op.after.left, top: op.after.top });
    if (op.gesture === 'resize') return t('op.resize', { list: Object.entries(op.after).map(([p, v]) => `${p} ${v}`).join(', ') });
    return Object.entries(op.after).map(([p, v]) => `${p}: ${v || dflt}`).join(', ');
  }
  if (op.from.parent === op.to.parent) return t('op.moveWithin', { parent: op.toLabel, from: op.from.index + 1, to: op.to.index + 1 });
  return t('op.moveTo', { from: op.fromLabel, to: op.toLabel, index: op.to.index + 1 });
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
  return html.length > SNIPPET_LIMIT ? `${html.slice(0, SNIPPET_LIMIT)}\n${t('handoff.omitted', { n: html.length - SNIPPET_LIMIT })}` : html;
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
    const moved = now && now !== op.path ? t('handoff.nowAt', { path: now }) : '';
    const lost = now ? '' : ` ${t('handoff.lost')}`;
    return `${i + 1}. \`${op.label}\` — ${describeOp(op)} [${viewportLabel(op)}]\n   - ${t('handoff.origPath')}: \`${op.path}\`${moved}${lost}`;
  });

  const resultSection = [];
  if (mode === 'full') {
    resultSection.push(t('handoff.resultFull'), '', '```html', fullHtml.trimEnd(), '```');
  } else {
    resultSection.push(t('handoff.resultChanged'), '', t('handoff.resultChangedNote'), '');
    const seen = new Set();
    applied.forEach((op, i) => {
      if (seen.has(op.target)) return;
      seen.add(op.target);
      const el = byId(op.target);
      resultSection.push(`### ${i + 1}. \`${op.label}\``, '', '```html', el ? cleanOuterHtml(el) : t('handoff.lost'), '```', '');
    });
  }

  const markdown = [
    t('handoff.title'),
    '',
    t('handoff.source', { source: sourceName }),
    t('handoff.applied', { n: applied.length }) + (undone ? t('handoff.undone', { n: undone }) : ''),
    t('handoff.state'),
    '',
    t('handoff.list'),
    '',
    items.length ? items.join('\n') : t('handoff.none'),
    '',
    ...(diff.length ? [t('handoff.diff'), '', t('handoff.diffNote'), '', '```diff', diffText(diff), '```', ''] : []),
    ...(lostOps.length ? [t('handoff.lostTitle'), '', ...lostOps.map((op) => `- \`${op.label}\` — ${describeOp(op)} (${t('handoff.path')}: \`${op.path}\`)`), ''] : []),
    t('handoff.request'),
    '',
    t('handoff.req.apply'),
    t('handoff.req.scope'),
    applied.some((op) => op.kind === 'text') ? t('handoff.req.text', { label: t('op.textLabel') }) : null,
    hasOffset ? t('handoff.req.offset', { label: t('op.offsetLabel') }) : null,
    t('handoff.req.verify'),
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
