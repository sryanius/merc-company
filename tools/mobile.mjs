#!/usr/bin/env node
/**
 * tools/mobile.mjs — 모바일 대응 정적 검사 (10차 세션)
 *
 * 브라우저 뷰포트를 바꿀 수 없는 환경에서도 "폰에서 깨질 것"을 최대한 잡아낸다.
 * 소스를 읽어 CSS 텍스트(= `css/style.css` + `src/ui/*.js` 안의 템플릿 리터럴)를 뽑고,
 * 각 선언이 `@media` 안에 있는지 / 모바일 쿼리에서 덮이는지를 본다.
 *
 * 검사 항목
 *   A. 고정 px 폭 (width/min-width/flex-basis ≥ 320px, grid-template-columns 의 고정 px)
 *      → 360px 화면을 넘기므로 @media 밖에 있으면 가로 스크롤이 난다
 *   B. position:sticky 가 모바일 쿼리에서 해제(static/relative)되는가
 *   C. 작은 터치 타겟(.btn.sm 등)이 모바일 쿼리에서 min-height ≥ 36px 로 커지는가
 *   D. 11px 이하 글자가 모바일 쿼리에서 12px 이상으로 올라가는가
 *   E. 캔버스 고정 크기(width=960)가 CSS 로 스케일되는가
 *   F. JS 인라인 스타일의 고정 px 폭 (인라인은 @media 로 덮을 수 없다 = 가장 위험)
 *
 * 실행:  node tools/mobile.mjs            (실패 시 exit 1)
 *        node tools/mobile.mjs --verbose  (통과 항목까지 전부 출력)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

/** 폰 기준 최소 뷰포트. 이 폭을 넘는 고정 px 는 가로 스크롤 후보다. */
const NARROWEST = 360;
/** 터치 타겟 최소 변 길이 */
const TOUCH_MIN = 36;
/** 글자 크기 하한 */
const FONT_MIN = 12;

/**
 * 예외 표시. 룰 바로 위(또는 같은 줄)에 `mobile-ok:` 주석이 있으면 그 룰은 검사에서 뺀다.
 * 정적 검사는 DOM 중첩(스크롤 래퍼 안인지)이나 JS 분기(폰에서는 아예 다른 요소를 그린다)를
 * 알 수 없다. 예외를 쓸 때는 반드시 **이유를 같이 적는다** — 근거 없는 무시를 막기 위해서다.
 */
const OKMARK = /mobile-ok\s*:/;

const problems = [];   // { file, kind, msg }
const notes = [];      // 통과했지만 알아두면 좋은 것
let checks = 0;
const fail = (file, kind, msg) => { problems.push({ file, kind, msg }); };
const ok = (kind, msg) => { checks++; if (VERBOSE) notes.push(`   ✓ ${kind} ${msg}`); };

/* ─────────────────────────── 소스 수집 ─────────────────────────── */

const uiDir = join(ROOT, 'src', 'ui');
const uiFiles = readdirSync(uiDir).filter((f) => f.endsWith('.js')).map((f) => join(uiDir, f));
const cssFile = join(ROOT, 'css', 'style.css');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

/**
 * JS 소스에서 CSS 로 보이는 템플릿 리터럴을 뽑는다.
 * (문자열 안의 백틱/이스케이프까지 완벽히 파싱하지는 않지만, 이 코드베이스의
 *  `const CSS = \`...\`` 형태는 전부 잡는다. 오탐보다 미탐이 위험하므로
 *  "CSS 처럼 생긴" 리터럴은 전부 대상으로 삼는다.)
 * @returns {{text:string, offset:number}[]}
 */
function extractCssLiterals(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '`') continue;
    // 이스케이프된 백틱은 건너뛴다
    let bs = 0;
    for (let k = i - 1; k >= 0 && src[k] === '\\'; k--) bs++;
    if (bs % 2 === 1) continue;
    let j = i + 1;
    for (; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === '`') break;
    }
    const body = src.slice(i + 1, j);
    // CSS 판정: `선택자 { prop: value }` 패턴이 하나라도 있는가
    if (/\{[^{}]*[a-z-]+\s*:\s*[^{}]+[;}]/.test(body)) out.push({ text: body, offset: i + 1 });
    i = j;
  }
  return out;
}

/**
 * 주석을 같은 길이의 공백으로 바꾼다 (오프셋→줄번호가 어긋나지 않게).
 * 주석 안의 `{` 때문에 룰 경계를 잘못 잡던 버그가 있었다.
 */
const blankComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/**
 * 템플릿 리터럴의 `${...}` 를 실제 값으로 치환한다.
 * `@media (max-width:${NARROW_PX}px)` 처럼 상수를 쓰는 곳이 있어서, 이걸 안 풀면
 * 미디어쿼리 판정이 통째로 틀린다. 숫자 상수는 파일에서 찾아 넣고, 나머지는 `0` 으로 둔다.
 * 길이를 맞추려 앞뒤를 공백으로 채운다.
 */
function resolveInterp(text, consts) {
  // 줄 수만 유지하면 된다(줄 번호 계산용). 열 위치는 보고에 쓰지 않으므로 길이를 맞추지 않는다 —
  // 공백을 채워 길이를 맞추면 `max-width:767   px` 가 되어 미디어쿼리 판정이 통째로 깨진다.
  return text.replace(/\$\{([^{}]*)\}/g, (m, expr) => {
    const nl = '\n'.repeat((m.match(/\n/g) || []).length);
    const key = expr.trim();
    return (consts.has(key) ? String(consts.get(key)) : '0') + nl;
  });
}

/** 파일에서 `const NAME = 123;` 숫자 상수를 모은다 */
function numConsts(src) {
  const map = new Map();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*[;,\n]/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

/** 파일 → CSS 텍스트 조각 목록 */
function cssChunks(path) {
  const src = readFileSync(path, 'utf8');
  if (path.endsWith('.css')) return { src, chunks: [{ text: blankComments(src), offset: 0 }] };
  const consts = numConsts(src);
  return {
    src,
    chunks: extractCssLiterals(src).map((c) => ({ ...c, text: blankComments(resolveInterp(c.text, consts)) })),
  };
}

/** 오프셋 → 1-base 줄 번호 */
const lineAt = (src, off) => src.slice(0, off).split('\n').length;

/**
 * CSS 텍스트를 훑으며 각 위치를 감싸는 @media 조건 스택을 계산한다.
 * @returns {(pos:number)=>string[]}  그 위치를 감싸는 @media prelude 목록
 */
function mediaScanner(css) {
  /** @type {{start:number, end:number, cond:string}[]} */
  const blocks = [];
  const re = /@media([^{]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const cond = m[1].trim();
    // 짝 맞는 } 찾기
    let depth = 1;
    let k = re.lastIndex;
    for (; k < css.length && depth > 0; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
    }
    blocks.push({ start: m.index, end: k, cond });
  }
  return (pos) => blocks.filter((b) => pos >= b.start && pos < b.end).map((b) => b.cond);
}

/** `(max-width: 767px)` 같은 조건이 폰(≤NARROWEST)에 걸리는가 */
function coversPhone(cond) {
  const mx = [...cond.matchAll(/max-width\s*:\s*(\d+)px/g)].map((x) => +x[1]);
  const mn = [...cond.matchAll(/min-width\s*:\s*(\d+)px/g)].map((x) => +x[1]);
  if (mn.some((v) => v > NARROWEST)) return false;      // min-width:1000px → 폰에 안 걸림
  if (mx.length === 0) return mn.length > 0;            // min-width 만 있고 작은 값 → 걸림
  return mx.every((v) => v >= NARROWEST);
}
/** 여러 겹의 @media 를 전부 통과해야 폰에 적용된다 */
const phoneScoped = (conds) => conds.length > 0 && conds.every(coversPhone);
/** 폰에서 이 룰이 실제로 걸리는가 (@media 밖 = 항상 걸린다) */
const appliesOnPhone = (r) => r.media.length === 0 || r.media.every(coversPhone);

/** 선택자의 마지막 복합선택자(키 셀렉터)를 정규화 — `.a .b.c` → `.b.c` */
function keyCompound(sel) {
  const last = sel.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() || '';
  const cls = [...last.matchAll(/\.[\w-]+/g)].map((m) => m[0]).sort();
  const tag = (/^[a-z][\w-]*/i.exec(last) || [''])[0].toLowerCase();
  return tag + cls.join('');
}
/** sel 목록 → 키 셀렉터 집합 */
const keysOf = (selList) => selList.split(',').map((s) => keyCompound(s)).filter(Boolean);

/** 선언 리스트에서 prop 값을 뽑는다 (마지막 선언이 이긴다) */
function declValue(block, prop) {
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'gi');
  let m, last = null;
  while ((m = re.exec(block))) last = m[1].trim();
  return last;
}

/** CSS 를 최상위 룰 단위로 쪼갠다 (@media 안쪽도 재귀적으로) */
function eachRule(css, cb, mediaStack = [], base = 0) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, k = open + 1;
    for (; k < css.length && depth > 0; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
    }
    const body = css.slice(open + 1, k - 1);
    if (/^@media/i.test(prelude)) {
      eachRule(body, cb, [...mediaStack, prelude.replace(/^@media/i, '').trim()], base + open + 1);
    } else if (/^@(keyframes|supports|font-face|layer)/i.test(prelude)) {
      // 관심 없음
    } else {
      // pos = 프리루드 시작(앞선 주석 포함) · open = `{` 위치. 예외 표시를 찾으려면 원본 텍스트가 필요하다.
      cb({ sel: prelude, body, media: mediaStack, pos: base + i, open: base + open });
    }
    i = k;
  }
}

/* ─────────────────────────── 검사 ─────────────────────────── */

const allFiles = [cssFile, ...uiFiles];
/** @type {{file:string, sel:string, body:string, media:string[], line:number, waived:boolean}[]} */
const RULES = [];
let waived = 0;
for (const f of allFiles) {
  const { src, chunks } = cssChunks(f);
  const lines = src.split('\n');
  for (const ch of chunks) {
    eachRule(ch.text, (r) => {
      // 선택자가 실제로 시작하는 줄을 보고한다 (앞선 주석/빈 줄은 건너뛴다)
      const selAt = ch.text.slice(r.pos, r.open).search(/\S(?![\s\S]*\n\s*\S)/) >= 0
        ? r.open - r.sel.length : r.pos;
      const line = lineAt(src, ch.offset + Math.max(r.pos, selAt));
      // 예외 표시는 **프리루드 원본**(= 직전 룰 이후 ~ `{` 사이, 선행 주석이 여기 들어 있다)에서 찾고,
      // 없으면 바로 위 6줄까지 본다 — 한 덩어리(래퍼+내용, header+body+footer)를 주석 하나로 덮기 위해서다.
      const raw = src.slice(ch.offset + r.pos, ch.offset + r.open);
      const w = OKMARK.test(raw) || OKMARK.test(lines.slice(Math.max(0, line - 7), line).join('\n'));
      if (w) waived++;
      RULES.push({ file: rel(f), sel: r.sel, body: r.body, media: r.media, line, waived: w });
    });
  }
}
console.log(`   (CSS 룰 ${RULES.length}개 · 파일 ${allFiles.length}개 · mobile-ok 예외 ${waived}건)`);

/* ── A. 고정 px 폭 ─────────────────────────────────────────── */
console.log('\n── A. 고정 px 폭 (360px 를 넘는 값이 @media 밖에 있는가)');
{
  /** `overflow-x:auto|scroll` 을 가진 선택자 집합 (이 안의 넓은 표는 허용 — 페이지가 아니라 자기가 스크롤한다) */
  const scrollers = new Set();
  for (const r of RULES) {
    if (!/overflow(-x)?\s*:\s*(auto|scroll)/.test(r.body)) continue;
    for (const s of r.sel.split(',')) scrollers.add(s.trim());
  }
  /** 폰 쿼리에서 폭이 안전한 값으로 덮이는가 (min-width:0 / 100% / calc(...) 등) */
  const overridden = (sel, prop) => RULES.some((r) => phoneScoped(r.media)
    && r.sel.split(',').some((x) => x.trim() === sel.trim())
    && (() => { const v = declValue(r.body, prop); return v && !/^\d{3,}px$/.test(v.trim()); })());
  /** 스크롤 래퍼 안에 있는가 — 선택자 앞부분이 scroller 중 하나로 시작하면 인정 */
  const inScroller = (sel) => sel.split(',').every((one) => {
    const s = one.trim();
    return [...scrollers].some((w) => w && s !== w && (s.startsWith(w + ' ') || s.startsWith(w + '>')
      || s.startsWith(w.replace(/-wrap$/, '') + ' ')));
  });

  const props = ['width', 'min-width', 'flex-basis'];
  let hits = 0;
  for (const r of RULES) {
    for (const p of props) {
      const re = new RegExp(`(?:^|[;{\\s])${p}\\s*:\\s*([^;}]+)`, 'gi');
      let m;
      while ((m = re.exec(r.body))) {
        const v = m[1].trim();
        // min()/max()/clamp()/calc() 안의 px 는 상한이 있으므로 안전하다고 본다
        if (/\b(?:min|max|clamp|calc)\s*\(/.test(v)) continue;
        const px = /^(\d+)px$/.exec(v);
        if (!px || +px[1] < NARROWEST) continue;
        hits++;
        if (r.waived) { ok('A', `${r.file}:${r.line} ${r.sel} ${p}:${v} — mobile-ok 예외`); continue; }
        if (!appliesOnPhone(r)) { ok('A', `${r.file}:${r.line} ${r.sel} ${p}:${v} @media ${r.media.join(' / ')}`); continue; }
        if (inScroller(r.sel)) { ok('A', `${r.file}:${r.line} ${r.sel} ${p}:${v} — overflow-x 래퍼 안`); continue; }
        if (overridden(r.sel, p)) { ok('A', `${r.file}:${r.line} ${r.sel} ${p}:${v} — 폰 쿼리에서 덮임`); continue; }
        fail(r.file, 'A', `${r.line}행 \`${r.sel}\` ${p}:${v} — 폰(${NARROWEST}px)에 그대로 적용된다`);
      }
    }
  }
  // grid-template-columns 의 고정 px
  for (const r of RULES) {
    const v = declValue(r.body, 'grid-template-columns');
    if (!v) continue;
    // minmax(230px,1fr) / repeat(auto-fill,minmax(..)) 은 축소되므로 안전
    if (/minmax|auto-fill|auto-fit/.test(v)) { ok('A', `${r.file}:${r.line} grid-template-columns:${v}`); continue; }
    const rigid = [...v.matchAll(/(?<![-\w(])(\d{3,})px/g)].map((x) => +x[1]).filter((n) => n >= NARROWEST);
    if (!rigid.length) { ok('A', `${r.file}:${r.line} grid-template-columns:${v}`); continue; }
    hits++;
    if (r.waived) { ok('A', `${r.file}:${r.line} grid-template-columns — mobile-ok 예외`); continue; }
    if (appliesOnPhone(r) && !inScroller(r.sel)) {
      fail(r.file, 'A', `${r.line}행 \`${r.sel}\` grid-template-columns:${v} — 폰에서 ${Math.max(...rigid)}px 고정 트랙`);
    }
  }
  console.log(`   후보 ${hits}건 검사 · overflow-x 래퍼 ${scrollers.size}개`);
}

/* ── B. position:sticky ────────────────────────────────────── */
console.log('\n── B. position:sticky 가 폰에서 해제되는가');
{
  // 폰에서 실제로 걸리는 sticky 만 본다 (@media (min-width:1000px) 안의 sticky 는 폰에 없다)
  const stickies = RULES.filter((r) => /position\s*:\s*sticky/.test(r.body) && appliesOnPhone(r) && !r.waived);
  if (!stickies.length) console.log('   (폰에 걸리는 sticky 없음)');
  for (const s of stickies) {
    const key = s.sel.split(',').map((x) => x.trim()).filter(Boolean);
    // (1) 폰 쿼리에서 position 을 static/relative/fixed 로 되돌렸는가
    const released = RULES.some((r) => phoneScoped(r.media)
      && r.sel.split(',').some((x) => key.includes(x.trim()))
      && /position\s*:\s*(static|relative|fixed|absolute)/.test(r.body));
    // (2) 스크롤 컨테이너 안의 표 헤더 고정은 화면을 먹지 않는다 — 오히려 있어야 좋다
    const tableHead = key.every((k) => /\b(th|thead)\b\s*$/.test(k));
    if (released) ok('B', `${s.file}:${s.line} ${s.sel} → 폰에서 해제`);
    else if (tableHead) ok('B', `${s.file}:${s.line} ${s.sel} — 스크롤 박스 안 표 헤더(허용)`);
    else fail(s.file, 'B', `${s.line}행 \`${s.sel}\` position:sticky 가 폰에서 그대로다`);
  }
}

/* ── C. 터치 타겟 ─────────────────────────────────────────── */
console.log('\n── C. 작은 버튼이 폰에서 커지는가');
{
  // .btn.sm / .btn 자체 + 각 모듈의 "작은 버튼" 클래스
  const smallSel = RULES.filter((r) => !phoneScoped(r.media) && /\.btn(\.sm|\.xs)?\b/.test(r.sel)
    && /padding\s*:/.test(r.body) && !/min-height/.test(r.body));
  const phoneBtn = RULES.filter((r) => phoneScoped(r.media) && /\.btn\b/.test(r.sel));
  const minH = (r) => {
    const v = declValue(r.body, 'min-height');
    const m = v && /^(\d+)px$/.exec(v.trim());
    return m ? +m[1] : null;
  };
  const covered = new Map();
  for (const r of phoneBtn) {
    const h = minH(r);
    if (h == null) continue;
    for (const s of r.sel.split(',')) covered.set(s.trim(), Math.max(covered.get(s.trim()) ?? 0, h));
  }
  for (const [sel, h] of covered) {
    if (h >= TOUCH_MIN) ok('C', `${sel} min-height:${h}px`);
    else fail('css/style.css', 'C', `폰 쿼리 \`${sel}\` min-height:${h}px < ${TOUCH_MIN}px`);
  }
  if (!covered.has('.btn')) fail('css/style.css', 'C', '폰 쿼리에 `.btn { min-height }` 이 없다');
  if (!covered.has('.btn.sm')) fail('css/style.css', 'C', '폰 쿼리에 `.btn.sm { min-height }` 이 없다');
  console.log(`   폰 쿼리에서 크기가 지정된 버튼 선택자 ${covered.size}개 / 후보 ${smallSel.length}개`);
}

/* ── D. 글자 크기 하한 ────────────────────────────────────── */
console.log(`\n── D. ${FONT_MIN}px 미만 글자가 폰에서 올라가는가`);
{
  const norm = (s) => s.trim().replace(/\s+/g, ' ');
  /**
   * 폰 쿼리의 선택자 `p` 가 문제 선택자 `o` 를 덮는가.
   *  · 완전 일치 / 한쪽이 다른 쪽의 뒤쪽 자손 선택자 (`.a .b` ⊃ `.b`)
   *  · 키 셀렉터가 같고 그것이 클래스일 때 (`.city-spec .spec-badge` ↔ `.city-screen .spec-badge`).
   *    태그만 같은 경우(`span`, `i`)는 다른 요소일 수 있으므로 인정하지 않는다.
   */
  const covers = (p, o) => {
    const pn = norm(p), on = norm(o);
    if (pn === on || pn.endsWith(' ' + on) || on.endsWith(' ' + pn)) return true;
    const k = keyCompound(on);
    return k.includes('.') && keyCompound(pn) === k;
  };
  /** 폰 쿼리 안에서 지정된 font-size / display 를 선택자별로 모은다 */
  const phoneFont = [];   // {sel, px}
  const phoneHidden = []; // sel
  for (const r of RULES) {
    if (!phoneScoped(r.media)) continue;
    const v = declValue(r.body, 'font-size');
    const m = v && /^(\d+(?:\.\d+)?)px$/.exec(v.trim());
    for (const s of r.sel.split(',').map(norm).filter(Boolean)) {
      if (m) phoneFont.push({ sel: s, px: +m[1] });
      if (/display\s*:\s*none/.test(r.body)) phoneHidden.push(s);
    }
  }
  let small = 0;
  const seen = new Set();
  for (const r of RULES) {
    const v = declValue(r.body, 'font-size');
    const m = v && /^(\d+(?:\.\d+)?)px$/.exec(v.trim());
    if (!m || +m[1] >= FONT_MIN || r.waived) continue;
    const px = +m[1];
    for (const s0 of r.sel.split(',')) {
      const sel = s0.trim();
      if (!sel || seen.has(sel)) continue;
      seen.add(sel);
      small++;
      if (phoneScoped(r.media)) { fail(r.file, 'D', `${r.line}행 폰 쿼리 \`${sel}\` font-size:${px}px < ${FONT_MIN}px`); continue; }
      if (phoneHidden.some((p) => covers(p, sel))) { ok('D', `${sel} ${px}px — 폰에서 숨김`); continue; }
      const fixed = phoneFont.filter((p) => covers(p.sel, sel)).map((p) => p.px);
      if (fixed.length && Math.max(...fixed) >= FONT_MIN) ok('D', `${sel} ${px}px → 폰 ${Math.max(...fixed)}px`);
      else fail(r.file, 'D', `${r.line}행 \`${sel}\` font-size:${px}px 가 폰에서 ${FONT_MIN}px 이상으로 안 올라간다`);
    }
  }
  console.log(`   ${FONT_MIN}px 미만 선택자 ${small}개`);
}

/* ── E. 캔버스 ────────────────────────────────────────────── */
console.log('\n── E. 캔버스 고정 크기가 CSS 로 스케일되는가');
{
  for (const f of [...uiFiles, join(ROOT, 'src', 'battle', 'renderer.js')]) {
    const src = readFileSync(f, 'utf8');
    const hits = [...src.matchAll(/\.width\s*=\s*(\d{3,})\b/g)].map((m) => +m[1]);
    if (!hits.length) continue;
    // 같은 파일(또는 공용 CSS)에 캔버스를 줄이는 규칙이 있는가
    const cssText = [readFileSync(cssFile, 'utf8'), ...extractCssLiterals(src).map((c) => c.text)].join('\n');
    const scaled = /canvas[^{}]*\{[^{}]*(?:max-)?width\s*:\s*100%/.test(cssText)
      || /canvas\s*\{[^{}]*max-width\s*:\s*100%/.test(cssText);
    if (scaled) ok('E', `${rel(f)} canvas ${hits.join('/')}px → CSS 로 축소`);
    else fail(rel(f), 'E', `캔버스 고정 크기(${hits.join('/')})를 CSS 가 줄이지 않는다`);
  }
}

/* ── F. JS 인라인 스타일 고정 폭 ──────────────────────────── */
console.log('\n── F. JS 인라인 스타일의 고정 px 폭 (@media 로 못 덮는다)');
{
  const props = ['width', 'minWidth', 'flexBasis', 'min-width', 'flex-basis'];
  for (const f of allFiles) {
    const src = readFileSync(f, 'utf8');
    for (const p of props) {
      const re = new RegExp(`['"\`]?${p}['"\`]?\\s*:\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
      let m;
      while ((m = re.exec(src))) {
        const v = m[1].trim();
        if (/\b(?:min|max|clamp|calc)\s*\(/.test(v)) continue;
        const px = /^(\d+)px$/.exec(v);
        if (!px || +px[1] < NARROWEST) continue;
        fail(rel(f), 'F', `${lineAt(src, m.index)}행 인라인 ${p}:'${v}' — 인라인 스타일은 미디어쿼리로 덮을 수 없다`);
      }
    }
    // 인라인 grid-template-columns 고정 px
    const g = /gridTemplateColumns\s*:\s*['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = g.exec(src))) {
      const v = m[1];
      if (/minmax|auto-fill|auto-fit|fr|%/.test(v)) continue;
      const fixed = [...v.matchAll(/(\d{3,})px/g)].map((x) => +x[1]).filter((n) => n >= NARROWEST);
      if (fixed.length) fail(rel(f), 'F', `${lineAt(src, m.index)}행 인라인 gridTemplateColumns:'${v}'`);
    }
  }
}

/* ─────────────────────────── 결과 ─────────────────────────── */
if (VERBOSE && notes.length) console.log('\n' + notes.join('\n'));
console.log('\n' + '─'.repeat(64));
if (!problems.length) {
  console.log(`✅ 정적 검사 통과 — 룰 ${RULES.length}개 / 확인 ${checks}건`);
  process.exit(0);
}
const byFile = new Map();
for (const p of problems) {
  if (!byFile.has(p.file)) byFile.set(p.file, []);
  byFile.get(p.file).push(p);
}
console.log(`❌ ${problems.length}건 지적`);
for (const [f, list] of byFile) {
  console.log(`\n  ${f}`);
  for (const p of list) console.log(`    [${p.kind}] ${p.msg}`);
}
process.exit(1);
