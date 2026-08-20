#!/usr/bin/env node
// 채택한 후보 도트를 **파츠 파일에 넣을 수 있는 JS 조각**으로 뽑는다.
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 왜 도구인가
//   후보는 JSON 이고 파츠 파일은 JS 다. 손으로 옮기면 따옴표·쉼표·앵커를 반드시 한 번은 틀린다.
//   그리고 **scale 을 빼먹으면** parts.js 가 그 파츠를 32×40 원본으로 알고 또 늘려
//   혼자만 거대해진다. 여기서 후보의 캔버스에서 배수를 구해 항상 적어 준다.
//
// 실행
//   node tools/adopt.mjs 후보.json --map=head:head_human,body:body_normal
//   node tools/adopt.mjs 후보.json                 # 기본 이름표 사용
//   node tools/adopt.mjs 후보.json --apply         # parts_body.js 를 실제로 갱신
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIX_CHARS } from '../src/art/palette.js';
import { BODY_PARTS } from '../src/art/parts_body.js';
import { GEAR_PARTS } from '../src/art/parts_gear.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('후보 JSON 을 넘겨라.'); process.exit(1); }

/** 후보의 슬롯 이름 → 실제 파츠 이름 */
const DEFAULT_MAP = {
  head: 'head_human', hair: 'hair_short', body: 'body_normal',
  arm: 'arm_normal', leg: 'leg_leather', armor: 'armor_leather',
  weapon: 'wpn_sword', offhand: 'shd_kite', helm: 'helm_iron', cape: 'cape_long',
};
const MAP = { ...DEFAULT_MAP };
for (const pair of (arg('map', '') || '').split(',').filter(Boolean)) {
  const [k, v] = pair.split(':');
  if (k && v) MAP[k.trim()] = v.trim();
}
/* ★ 열쇠가 이미 진짜 파츠 이름(helm_hood 처럼)이면 그대로 쓴다.
 *   69개를 한꺼번에 옮길 때 --map 을 69줄 적게 만들 이유가 없다. */
const KNOWN = new Set([...Object.keys(BODY_PARTS), ...Object.keys(GEAR_PARTS)]);
const resolveName = (slot) => (KNOWN.has(slot) ? slot : MAP[slot]);

const cand = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
/* ★ 이 파츠가 몇 배로 그려졌나 = 후보 캔버스 폭 ÷ 32 (64→2, 96→3). */
const PART_SCALE = Math.round(((cand.canvas && cand.canvas.w) || 64) / 32);
if (!Number.isInteger(PART_SCALE) || PART_SCALE < 1) { console.error('캔버스 폭이 32 의 정수배가 아니다'); process.exit(1); }
const ALLOWED = new Set(PIX_CHARS);

const bad = [];
const out = [];
const entries = [];   // { name, block } — --apply 가 파일에서 찾아 갈아 끼운다
for (const [slot, p] of Object.entries(cand.parts || {})) {
  const name = resolveName(slot);
  if (!name) { bad.push(`${slot}: 어떤 파츠로 넣을지 모르겠다 (--map 으로 알려줘라)`); continue; }
  if (!p || !Array.isArray(p.px)) { bad.push(`${slot}: px 없음`); continue; }
  if (p.px.length !== p.h) bad.push(`${slot}: 행 개수 ${p.px.length} ≠ h ${p.h}`);
  p.px.forEach((r, i) => { if (r.length !== p.w) bad.push(`${slot}: ${i}행 길이 ${r.length} ≠ w ${p.w}`); });
  for (const r of p.px) for (const ch of r) if (!ALLOWED.has(ch)) bad.push(`${slot}: 모르는 문자 '${ch}'`);
  const rows = p.px.map((r) => `      '${r}',`).join('\n');
  const block = `  // ${32 * PART_SCALE}×${40 * PART_SCALE} 네이티브`
    + `\n  ${name}: {`
    + `\n    w: ${p.w}, h: ${p.h}, ax: ${p.ax || 0}, ay: ${p.ay || 0}, scale: ${PART_SCALE},`
    + `\n    px: [\n${rows}\n    ],`
    + `\n  },`;
  out.push(block);
  entries.push({ name, block });
}

if (bad.length) {
  console.error('규격 위반 — 넣기 전에 고쳐라:');
  for (const b of [...new Set(bad)].slice(0, 20)) console.error('  ✗ ' + b);
  process.exit(1);
}

if (!args.includes('--apply')) {
  console.log(out.join('\n'));
  console.error(`\n  ${out.length}개 파츠 · scale: ${PART_SCALE} (${32 * PART_SCALE}×${40 * PART_SCALE} 로 그렸다는 뜻)`);
  console.error('  ★ scale 이 없으면 parts.js 가 32×40 원본으로 알고 또 늘려 혼자만 거대해진다.');
  console.error('  ★ 파일에 바로 반영하려면 --apply 를 붙여라.');
  process.exit(0);
}

/* ─────────────────── --apply : 파일에 직접 반영 ───────────────────
 *
 * ★ 왜 도구가 해야 하나
 *   69개를 손으로 갈아 끼우면 반드시 몇 개는 엉뚱한 자리에 들어가고, 그건 눈으로만 보인다.
 *
 * ★★ 항목의 끝을 **중괄호 깊이**로 찾는다. `'  },'` 를 문자열로 찾으면
 *   px 배열 안에 우연히 그런 줄이 있는 파츠에서 끊겨 파일이 깨진다.
 */
/** 도구가 스스로 쓴 주석. 이 모양만 걷어낸다. */
const TOOL_COMMENT = /^\s*\/\/\s*\d+×\d+ 네이티브\s*$/;

function findEntry(text, name) {
  const head = new RegExp('^  ' + name + ': \\{$', 'm');
  const m = head.exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let inStr = false;
  let quote = '';
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (inStr) { if (ch === quote) inStr = false; }
    else if (ch === "'" || ch === '"' || ch === '`') { inStr = true; quote = ch; }
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  while (i < text.length && text[i] !== '\n') i++;   // 뒤따르는 쉼표까지

  /* ★ 바로 위의 **도구가 쓴 주석**만 걷어낸다. 안 그러면 다시 적용할 때마다
   *   «// 96×120 네이티브» 가 한 줄씩 쌓인다.
   *
   * ★★ 사람이 적은 주석은 **건드리지 않는다.** 파츠 위 주석에는 설계 의도가 적혀 있고
   *   («앞머리를 내리면 옆얼굴이 죽는다» 같은) 그건 그림을 다시 그려도 유효하다.
   *   도구가 조용히 지우면 그 이유가 영영 사라진다. */
  let start = m.index;
  while (start > 0) {
    const prevEnd = start - 1;                       // start-1 은 앞 줄의 개행
    const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
    const line = text.slice(prevStart, prevEnd);
    if (!TOOL_COMMENT.test(line)) break;
    start = prevStart;
  }
  return { start, end: i + 1 };
}

const FILES = {
  body: path.join(ROOT, 'src/art/parts_body.js'),
  gear: path.join(ROOT, 'src/art/parts_gear.js'),
};
const raw = { body: fs.readFileSync(FILES.body, 'utf8'), gear: fs.readFileSync(FILES.gear, 'utf8') };
const eol = {};
const text = {};
for (const k of ['body', 'gear']) {
  eol[k] = raw[k].includes('\r\n') ? '\r\n' : '\n';
  text[k] = raw[k].split('\r\n').join('\n');
}

let done = 0;
const missed = [];
for (const { name, block } of entries) {
  const where = Object.prototype.hasOwnProperty.call(BODY_PARTS, name) ? 'body' : 'gear';
  const at = findEntry(text[where], name);
  if (!at) { missed.push(name); continue; }
  text[where] = text[where].slice(0, at.start) + block + '\n' + text[where].slice(at.end);
  done++;
}

/* ★ 하나라도 못 찾으면 **아무것도 안 쓴다.** 절반만 반영된 파일이 제일 나쁘다. */
if (missed.length) {
  console.error('파일에서 못 찾은 항목 — 아무것도 안 고쳤다:');
  for (const n of missed) console.error('  ✗ ' + n);
  process.exit(1);
}

for (const k of ['body', 'gear']) fs.writeFileSync(FILES[k], text[k].split('\n').join(eol[k]));
console.error(`  ${done}개 파츠를 파일에 반영했다 (scale: ${PART_SCALE}).`);
console.error('  ★ 확인: node tools/smoke.mjs · node tools/facing.mjs · node tools/artsheet.mjs');
