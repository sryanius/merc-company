// 공용 유틸. 의존성 없음.
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const TAU = Math.PI * 2;
export const rad = (deg) => (deg * Math.PI) / 180;

/** 1234567 -> "1,234,567" */
export const num = (n) => Math.round(n).toLocaleString('ko-KR');
/** 0.235 -> "+24%" (부호 포함) */
export const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + f(b), 0);
export const byId = (arr, id) => arr.find((x) => x.id === id) || null;
export const groupBy = (arr, f) => {
  const m = new Map();
  for (const x of arr) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

export const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

/** 스탯 오브젝트끼리 합산 (b를 a에 더한 새 객체) */
export function addStats(a, b) {
  const out = { ...a };
  for (const k in b) out[k] = (out[k] || 0) + b[k];
  return out;
}
/** 배율 오브젝트 적용: {atk:0.2} => atk 20% 증가 */
export function scaleStats(base, mods) {
  const out = { ...base };
  for (const k in mods) if (out[k] != null) out[k] = out[k] * (1 + mods[k]);
  return out;
}

/** DOM 헬퍼 */
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'data' && typeof v === 'object') for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return n;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 아주 가벼운 이벤트 버스 */
export function emitter() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt).delete(fn);
    },
    emit(evt, ...args) {
      const s = map.get(evt);
      if (s) for (const fn of [...s]) fn(...args);
    },
  };
}
