// 페이지의 CSS 커스텀 속성(디자인 토큰)을 모아, 스타일 변경이 어떤 토큰과 관련 있는지 handoff에 알린다.
// 에이전트가 소스에 px 값을 그대로 쓰지 않고 토큰을 고치게 하려는 정보이며, 값은 모두 추정이다.

// Tailwind v4처럼 토큰이 수백 개인 페이지에서도 handoff를 만들 때 멈추지 않도록 비교할 토큰 수를 제한한다.
export const TOKEN_LIMIT = 2000;
const MATCH_MAX = 3;
const VAR_NAME = /var\(\s*(--[\w-]+)/g;
const COLOR_PROP = /(^|-)color$|^fill$|^stroke$/;
// 이 값과 같은 토큰은 너무 많아 의미가 없다.
const TRIVIAL = new Set(['', '0px', 'auto', 'normal', 'none', 'initial', 'rgba(0, 0, 0, 0)', 'transparent']);

function walkRules(list, out, win) {
  for (const rule of Array.from(list || [])) {
    if (rule.media && rule.media.mediaText && !win.matchMedia(rule.media.mediaText).matches) continue;
    if (rule.style) out.push(rule);
    if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, out, win);
  }
}

function varNames(value) {
  return [...String(value || '').matchAll(VAR_NAME)].map((m) => m[1]);
}

// padding-top의 값이 `padding: var(--x)`처럼 단축 속성에 있으면 속성별 값이 비어 있으므로 단축 속성도 본다.
function shorthands(prop) {
  const parts = prop.split('-');
  const out = [];
  for (let i = parts.length - 1; i > 0; i -= 1) out.push(parts.slice(0, i).join('-'));
  if (prop.startsWith('border-') && prop.endsWith('-radius')) out.unshift('border-radius');
  return out;
}

export function createTokenIndex({ doc, win, uiAttr }) {
  let cache = null;

  function signature() {
    return Array.from(doc.styleSheets).map((sheet) => {
      try {
        return sheet.cssRules.length;
      } catch (_) {
        return 'x';
      }
    }).join(',');
  }

  function collect() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache;
    const rules = [];
    let skipped = 0;
    Array.from(doc.styleSheets).forEach((sheet) => {
      let list;
      try {
        list = sheet.cssRules;
      } catch (_) {
        // 다른 출처의 스타일시트는 브라우저가 규칙을 읽지 못하게 한다. 건너뛰고 수를 알린다.
        skipped += 1;
        return;
      }
      walkRules(list, rules, win);
    });
    const names = new Set();
    rules.forEach((rule) => {
      for (let i = 0; i < rule.style.length; i += 1) {
        const p = rule.style.item(i);
        if (p.startsWith('--')) names.add(p);
      }
    });
    const all = [...names];
    cache = { sig, rules, skipped, names: all.slice(0, TOKEN_LIMIT), truncated: all.length > TOKEN_LIMIT, resolved: new Map() };
    return cache;
  }

  // 요소에 맞는 규칙 중 문서 순서상 마지막 규칙의 선언을 본다. 명시도를 따지지 않으므로 추정이다.
  function declaredVars(el, prop, inlineBefore) {
    const fromInline = varNames(inlineBefore);
    if (fromInline.length) return fromInline;
    const props = [prop, ...shorthands(prop)];
    const { rules } = collect();
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const rule = rules[i];
      if (!rule.selectorText) continue;
      let hit = false;
      try {
        hit = el.matches(rule.selectorText);
      } catch (_) {
        hit = false;
      }
      if (!hit) continue;
      for (const p of props) {
        const names = varNames(rule.style.getPropertyValue(p));
        if (names.length) return names;
        if (rule.style.getPropertyValue(p)) return [];
      }
    }
    return [];
  }

  // 변경 하나를 판단하는 동안 측정용 요소를 한 번만 붙인다. 계산한 토큰 값은 스타일시트가 바뀔 때까지 재사용한다.
  function session() {
    const data = collect();
    const probe = doc.createElement('div');
    probe.setAttribute(uiAttr, '');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;';
    doc.body.appendChild(probe);
    const cs = win.getComputedStyle(probe);
    const compute = (prop, value) => {
      probe.style.setProperty(prop, value);
      const out = cs.getPropertyValue(prop);
      probe.style.removeProperty(prop);
      return out;
    };
    // 속성에 맞지 않는 토큰(색 속성에 8px 등)은 계산 단계에서 무효가 되어 상속값으로 바뀌므로, 같은 값으로 잘못 잡힌다.
    // :root에서 읽은 원래 값이 그 속성에 맞는지 먼저 보고, 원래 값을 모르면 무효일 때의 값과 같은지로 거른다.
    const rootStyle = win.getComputedStyle(doc.documentElement);
    const tokenValues = (prop) => {
      const key = COLOR_PROP.test(prop) ? 'color' : prop;
      if (!data.resolved.has(key)) {
        const invalid = compute(key, 'var(--fm-no-such-token)');
        const values = new Map();
        data.names.forEach((name) => {
          const raw = rootStyle.getPropertyValue(name).trim();
          if (raw && !win.CSS.supports(key, raw)) return;
          const v = compute(key, `var(${name})`);
          if (!raw && v === invalid) return;
          values.set(name, v);
        });
        data.resolved.set(key, values);
      }
      return data.resolved.get(key);
    };

    function hint(el, prop, after, inlineBefore) {
      const from = el ? declaredVars(el, prop, inlineBefore) : [];
      const key = COLOR_PROP.test(prop) ? 'color' : prop;
      const value = after ? compute(key, after) : '';
      const match = [];
      if (data.names.length && !TRIVIAL.has(value) && !varNames(after).length) {
        for (const [name, v] of tokenValues(prop)) {
          if (v === value && !from.includes(name)) match.push(name);
          if (match.length >= MATCH_MAX) break;
        }
      }
      return from.length || match.length ? { from, match } : null;
    }

    return {
      hint,
      info: () => ({ skipped: data.skipped, truncated: data.truncated, count: data.names.length }),
      close: () => probe.remove(),
    };
  }

  return { session };
}
