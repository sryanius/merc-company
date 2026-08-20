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
for (const [slot, p] of Object.entries(cand.parts || {})) {
  const name = resolveName(slot);
  if (!name) { bad.push(`${slot}: 어떤 파츠로 넣을지 모르겠다 (--map 으로 알려줘라)`); continue; }
  if (!p || !Array.isArray(p.px)) { bad.push(`${slot}: px 없음`); continue; }
  if (p.px.length !== p.h) bad.push(`${slot}: 행 개수 ${p.px.length} ≠ h ${p.h}`);
  p.px.forEach((r, i) => { if (r.length !== p.w) bad.push(`${slot}: ${i}행 길이 ${r.length} ≠ w ${p.w}`); });
  for (const r of p.px) for (const ch of r) if (!ALLOWED.has(ch)) bad.push(`${slot}: 모르는 문자 '${ch}'`);
  const rows = p.px.map((r) => `      '${r}',`).join('\n');
  out.push(
    `  // ${cand.name || '후보'} — ${32 * PART_SCALE}×${40 * PART_SCALE} 네이티브
`
    + `  ${name}: {\n`
    + `    w: ${p.w}, h: ${p.h}, ax: ${p.ax || 0}, ay: ${p.ay || 0}, scale: ${PART_SCALE},
`
    + `    px: [\n${rows}\n    ],\n`
    + `  },`);
}

if (bad.length) {
  console.error('규격 위반 — 넣기 전에 고쳐라:');
  for (const b of [...new Set(bad)].slice(0, 20)) console.error('  ✗ ' + b);
  process.exit(1);
}

const js = out.join('\n');
if (args.includes('--apply')) {
  console.error('--apply 는 아직 없다. 아래를 parts_body.js 에 직접 넣어라 (덮어쓸 항목을 눈으로 확인하는 편이 안전하다).');
}
console.log(js);
console.error(`
  ${out.length}개 파츠 · scale: ${PART_SCALE} (${32 * PART_SCALE}×${40 * PART_SCALE} 로 그렸다는 뜻)`);
console.error('  ★ scale 이 없으면 parts.js 가 32×40 원본으로 알고 또 늘려 혼자만 거대해진다.');
