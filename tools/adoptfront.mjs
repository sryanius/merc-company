#!/usr/bin/env node
// 정면 파츠 JSON → src/art/parts_front.js 갱신
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 옆모습(adopt.mjs)과 따로인 이유: 정면 파츠는 **파일 하나가 통째로 사전**이라
//   항목을 찾아 갈아 끼울 필요 없이 전체를 다시 쓰면 된다. 대신 **기존 것을 지우지 않도록**
//   지금 파일을 읽어 합친다.
//
//   node tools/adoptfront.mjs 후보.json [--replace]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIX_CHARS } from '../src/art/palette.js';
import { FRONT_PARTS } from '../src/art/parts_front.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('후보 JSON 을 넘겨라.'); process.exit(1); }

const cand = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
const scale = Math.round(((cand.canvas && cand.canvas.w) || 96) / 32);
const ALLOWED = new Set(PIX_CHARS);

const bad = [];
for (const [n, p] of Object.entries(cand.parts || {})) {
  if (!p || !Array.isArray(p.px)) { bad.push(`${n}: px 없음`); continue; }
  if (p.px.length !== p.h) bad.push(`${n}: 행 개수 ${p.px.length} ≠ h ${p.h}`);
  p.px.forEach((r, i) => { if (r.length !== p.w) bad.push(`${n}: ${i}행 길이 ${r.length} ≠ w ${p.w}`); });
  for (const r of p.px) for (const ch of r) if (!ALLOWED.has(ch)) bad.push(`${n}: 모르는 문자 '${ch}'`);
}
if (bad.length) {
  console.error('규격 위반 — 넣기 전에 고쳐라:');
  for (const b of [...new Set(bad)].slice(0, 20)) console.error('  ✗ ' + b);
  process.exit(1);
}

/* ★ --replace 가 없으면 **합친다.** 한 번에 다 그리지 않고 계열별로 채워 넣기 때문이다. */
const merged = args.includes('--replace')
  ? { ...cand.parts }
  : { ...FRONT_PARTS, ...cand.parts };

const body = Object.keys(merged).sort().map((n) => {
  const p = merged[n];
  const rows = p.px.map((r) => `      '${r}',`).join('\n');
  return `  ${n}: {\n    w: ${p.w}, h: ${p.h}, ax: ${p.ax || 0}, ay: ${p.ay || 0}, scale: ${p.scale || scale},\n`
    + `    px: [\n${rows}\n    ],\n  },`;
}).join('\n');

const target = path.join(ROOT, 'src/art/parts_front.js');
const src = fs.readFileSync(target, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const text = src.split('\r\n').join('\n');
const head = text.indexOf('export const FRONT_PARTS = {');
const tail = text.indexOf('\n};', head);
if (head < 0 || tail < 0) { console.error('parts_front.js 에서 FRONT_PARTS 를 못 찾았다'); process.exit(1); }
const out = text.slice(0, head) + 'export const FRONT_PARTS = {\n' + body + text.slice(tail);
fs.writeFileSync(target, out.split('\n').join(eol));
console.error(`  정면 파츠 ${Object.keys(merged).length}종 (이번에 ${Object.keys(cand.parts).length}종 갱신, scale: ${scale})`);
