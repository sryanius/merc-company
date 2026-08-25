/**
 * 머리 파츠 반영기 (node tools/adoptheads.mjs <결과.json> [--apply])
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 워크플로가 만든 { name, part }[] 를 `src/art/parts_body.js` 에 붙인다.
 *
 * ★★ 머리는 **조립** 파츠다 — 위에 투구·머리카락이 겹쳐 얹히고 아래로 몸이 이어붙는다.
 *   실루엣이 바뀌면 그 전부가 어긋난다. 그래서 여기서 **원본과 실루엣을 대조한다**:
 *     · 크기·앵커가 한 칸이라도 다르면 거부
 *     · 전체 실루엣 차이가 면적의 11% 를 넘으면 거부
 *     · **두개골 윗면(위 40%)** 차이가 면적의 3.5% 를 넘으면 거부 (투구가 앉는 자리)
 *
 *   워크플로 스크립트는 파일을 못 읽어서 원본과 대조할 수 없다 — 그래서 그 검사는
 *   반드시 여기(반영 시점)에 있어야 한다. 생성 쪽 검사만 믿으면 실루엣이 조용히 어긋난다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src', 'art', 'parts_body.js');
const ALLOWED = '.odrqeEwxsSyhHvcCnmMklLbaAfgG';

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file) { console.error('사용법: node tools/adoptheads.mjs <결과.json> [--apply]'); process.exit(1); }

const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const list = Array.isArray(rows) ? rows : rows.heads || [];
if (!list.length) { console.error('결과가 비었다'); process.exit(1); }

/* 원본은 «지금 파일» 에서 읽는다 — 반영 전에 읽어야 한다 */
const { BODY_PARTS } = await import('file://' + TARGET.replace(/\\/g, '/'));

const problems = [];
const parts = {};

for (const r of list) {
  const name = r.name || (r.key ? r.key : null);
  const p = r.part;
  if (!name || !p || !Array.isArray(p.px)) { problems.push(`${name || '?'}: part 없음`); continue; }
  const ref = BODY_PARTS[name];
  if (!ref) { problems.push(`${name}: 원본에 없는 파츠다`); continue; }

  if (p.px.length !== p.h) problems.push(`${name}: 행 ${p.px.length} != h ${p.h}`);
  p.px.forEach((row, i) => { if (row.length !== p.w) problems.push(`${name}: ${i}행 길이 ${row.length} != w ${p.w}`); });
  for (const row of p.px) for (const ch of row) if (!ALLOWED.includes(ch)) { problems.push(`${name}: 팔레트 밖 문자 '${ch}'`); break; }
  if (p.w !== ref.w || p.h !== ref.h) { problems.push(`${name}: 크기 ${p.w}x${p.h} — 원본 ${ref.w}x${ref.h} 이어야 한다`); continue; }
  if (p.ax !== ref.ax || p.ay !== ref.ay) { problems.push(`${name}: 앵커 (${p.ax},${p.ay}) — 원본 (${ref.ax},${ref.ay}) 이어야 한다`); continue; }

  let diff = 0; let topDiff = 0; let solid = 0; let refSolid = 0;
  const skullTop = Math.max(1, Math.round(p.h * 0.4));
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const a = (p.px[y] || '')[x] || '.';
      const b = (ref.px[y] || '')[x] || '.';
      if (a !== '.') solid++;
      if (b !== '.') refSolid++;
      if ((a === '.') !== (b === '.')) { diff++; if (y < skullTop) topDiff++; }
    }
  }
  const area = p.w * p.h;
  const capAll = Math.round(area * 0.11);
  const capTop = Math.round(area * 0.035);
  if (diff > capAll) problems.push(`${name}: 실루엣이 원본과 ${diff}칸 다르다 (${capAll} 이하) — 조립이 어긋난다`);
  if (topDiff > capTop) problems.push(`${name}: 두개골 윗면이 ${topDiff}칸 달라졌다 (${capTop} 이하) — 투구·머리카락이 안 맞는다`);
  if (solid < refSolid) problems.push(`${name}: 채움이 ${solid} 로 원본(${refSolid})보다 적다 — 밀도를 올리는 작업이다`);
  parts[name] = { p, diff, topDiff, solid, refSolid };
}

if (problems.length) {
  console.error(`❌ ${problems.length}건 문제 — 반영하지 않는다`);
  for (const x of problems.slice(0, 20)) console.error('   · ' + x);
  process.exit(1);
}

console.log(`검사 통과 — 머리 ${Object.keys(parts).length}개`);
for (const [n, v] of Object.entries(parts)) {
  console.log(`  ${n.padEnd(13)} ${v.p.w}x${v.p.h} 실루엣차 ${String(v.diff).padStart(3)} (윗면 ${v.topDiff}) 채움 ${v.refSolid} → ${v.solid}`);
}
if (!apply) { console.log('\n--apply 를 붙이면 parts_body.js 에 반영한다'); process.exit(0); }

let src = fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n');

function replacePart(text, name, p) {
  const start = text.indexOf(`  ${name}: {`);
  if (start < 0) return null;
  const end = text.indexOf('\n  },', start);
  if (end < 0) return null;
  const px = p.px.map((r) => `      '${r}',`).join('\n');
  const entry = `  ${name}: {\n    w: ${p.w}, h: ${p.h}, ax: ${p.ax}, ay: ${p.ay}, scale: 3,\n    px: [\n${px}\n    ],\n  },`;
  return text.slice(0, start) + entry + text.slice(end + 5);
}

for (const [name, v] of Object.entries(parts)) {
  const next = replacePart(src, name, v.p);
  if (next === null) { console.error(`❌ ${name} 항목을 파일에서 못 찾았다`); process.exit(1); }
  src = next;
}

fs.writeFileSync(TARGET, src, 'utf8');
/* ★ 써 놓고 되읽는다 — «반영했다» 는 말만 하고 안 바뀐 사고를 겪었다 (syncshared) */
const back = fs.readFileSync(TARGET, 'utf8');
for (const [name, v] of Object.entries(parts)) {
  const i = back.indexOf(`  ${name}: {`);
  if (i < 0) { console.error(`❌ 되읽으니 ${name} 이 없다`); process.exit(1); }
  const firstRow = v.p.px.find((r) => r.replace(/\./g, ''));
  if (firstRow && !back.slice(i, i + 4000).includes(`'${firstRow}'`)) {
    console.error(`❌ ${name} 이 새 그림으로 안 바뀌었다`); process.exit(1);
  }
}
console.log(`✅ ${Object.keys(parts).length}개 머리를 parts_body.js 에 반영했다`);
