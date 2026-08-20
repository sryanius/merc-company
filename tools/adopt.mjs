#!/usr/bin/env node
// 채택한 후보 도트를 **파츠 파일에 넣을 수 있는 JS 조각**으로 뽑는다.
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 왜 도구인가
//   후보는 JSON 이고 파츠 파일은 JS 다. 손으로 옮기면 따옴표·쉼표·앵커를 반드시 한 번은 틀린다.
//   그리고 **hd: true 를 빼먹으면** parts.js 가 그 파츠를 또 2배로 늘려 혼자만 거대해진다.
//   여기서 항상 붙인다.
//
// 실행
//   node tools/adopt.mjs 후보.json --map=head:head_human,body:body_normal
//   node tools/adopt.mjs 후보.json                 # 기본 이름표 사용
//   node tools/adopt.mjs 후보.json --apply         # parts_body.js 를 실제로 갱신
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIX_CHARS } from '../src/art/palette.js';

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

const cand = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
const ALLOWED = new Set(PIX_CHARS);

const bad = [];
const out = [];
for (const [slot, p] of Object.entries(cand.parts || {})) {
  const name = MAP[slot];
  if (!name) { bad.push(`${slot}: 어떤 파츠로 넣을지 모르겠다 (--map 으로 알려줘라)`); continue; }
  if (!p || !Array.isArray(p.px)) { bad.push(`${slot}: px 없음`); continue; }
  if (p.px.length !== p.h) bad.push(`${slot}: 행 개수 ${p.px.length} ≠ h ${p.h}`);
  p.px.forEach((r, i) => { if (r.length !== p.w) bad.push(`${slot}: ${i}행 길이 ${r.length} ≠ w ${p.w}`); });
  for (const r of p.px) for (const ch of r) if (!ALLOWED.has(ch)) bad.push(`${slot}: 모르는 문자 '${ch}'`);
  const rows = p.px.map((r) => `      '${r}',`).join('\n');
  out.push(
    `  // ${cand.name || '후보'} — 64×80 네이티브\n`
    + `  ${name}: {\n`
    + `    w: ${p.w}, h: ${p.h}, ax: ${p.ax || 0}, ay: ${p.ay || 0}, hd: true,\n`
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
console.error(`\n  ${out.length}개 파츠. ★ hd: true 가 붙어 있다 — 이게 없으면 parts.js 가 또 2배로 늘린다.`);
