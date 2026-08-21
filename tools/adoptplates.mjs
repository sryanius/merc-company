/**
 * «포즈 판»·클래스 얼굴 반영기 (node tools/adoptplates.mjs <결과.json> [--apply])
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 워크플로가 만든 { key, face, plate }[] 를 parts_front.js 에 붙인다.
 *
 * ★ 붙이기 전에 **여기서 다시 검사한다.** 생성 쪽 검사기와 어긋날 수 있고
 *   (실제로 검사기 버그로 헛도는 일이 여러 번 있었다), 파일에 잘못 들어간 파츠는
 *   모든 초상을 깨뜨린다. 검사는 두 벌이어도 싸다.
 *
 * ★ 같은 이름이 이미 있으면 **교체한다** — 재생성 반복이 기본 흐름이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src', 'art', 'parts_front.js');
const ALLOWED = '.odrqeEwxsSyhHvcCnmMklLbaAfgG';

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file) { console.error('사용법: node tools/adoptplates.mjs <결과.json> [--apply]'); process.exit(1); }

const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const list = Array.isArray(rows) ? rows : rows.result || [];
if (!list.length) { console.error('결과가 비었다'); process.exit(1); }

const problems = [];
const parts = {};   // 이름 -> part

function checkPart(name, p) {
  if (!p || !Array.isArray(p.px)) { problems.push(`${name}: px 없음`); return; }
  if (p.px.length !== p.h) problems.push(`${name}: 행 ${p.px.length} != h ${p.h}`);
  p.px.forEach((r, i) => { if (r.length !== p.w) problems.push(`${name}: ${i}행 길이 ${r.length} != w ${p.w}`); });
  for (const r of p.px) for (const ch of r) if (!ALLOWED.includes(ch)) { problems.push(`${name}: 팔레트 밖 문자 '${ch}'`); return; }
}

for (const r of list) {
  if (!r || !r.key) continue;
  checkPart(`face_${r.key}`, r.face);
  checkPart(`plate_${r.key}`, r.plate);
  if (r.face && r.face.w === 36 && r.face.h === 38) parts[`face_${r.key}`] = r.face;
  else problems.push(`face_${r.key}: 36x38 이 아니다`);
  if (r.plate) {
    if (r.plate.ay !== r.plate.h - 66) problems.push(`plate_${r.key}: ay(${r.plate.ay}) != h-66(${r.plate.h - 66}) — 발이 안 닿는다`);
    parts[`plate_${r.key}`] = r.plate;
  }
}

if (problems.length) {
  console.error(`❌ ${problems.length}건 문제 — 반영하지 않는다`);
  for (const p of problems.slice(0, 20)) console.error('   · ' + p);
  process.exit(1);
}

console.log(`검사 통과 — 파츠 ${Object.keys(parts).length}개`);
for (const [n, p] of Object.entries(parts)) {
  const solid = p.px.reduce((a, r) => a + [...r].filter((c) => c !== '.').length, 0);
  console.log(`  ${n.padEnd(16)} ${p.w}x${p.h} 앵커(${p.ax},${p.ay}) 채움 ${solid}칸`);
}
if (!apply) { console.log('\n--apply 를 붙이면 parts_front.js 에 반영한다'); process.exit(0); }

let src = fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n');

/** 기존 항목 제거 (교체 지원) — 항목은 «  이름: {» 로 시작해 «  },» 로 끝난다 */
function removePart(text, name) {
  const startMark = `  ${name}: {`;
  const i = text.indexOf(startMark);
  if (i < 0) return text;
  const end = text.indexOf('\n  },', i);
  if (end < 0) return text;
  return text.slice(0, i) + text.slice(end + 5).replace(/^\n/, '');
}

function entryOf(name, p) {
  const px = p.px.map((r) => `      '${r}',`).join('\n');
  return `  ${name}: {\n    w: ${p.w}, h: ${p.h}, ax: ${p.ax}, ay: ${p.ay}, scale: 3,\n    px: [\n${px}\n    ],\n  },\n`;
}

for (const name of Object.keys(parts)) src = removePart(src, name);

const anchor = 'export const frontPartCount';
const at = src.indexOf(anchor);
if (at < 0) { console.error('parts_front.js 의 꼬리를 못 찾았다'); process.exit(1); }
// FRONT_PARTS 객체를 닫는 '};' 는 anchor 바로 위에 있다
const close = src.lastIndexOf('};', at);
if (close < 0) { console.error('FRONT_PARTS 닫는 괄호를 못 찾았다'); process.exit(1); }
const inject = Object.entries(parts).map(([n, p]) => entryOf(n, p)).join('');
src = src.slice(0, close) + inject + src.slice(close);

fs.writeFileSync(TARGET, src, 'utf8');
/* ★ 써 놓고 되읽는다 — «반영했다» 는 말만 하고 실제로 안 바뀐 사고를 겪었다 (syncshared) */
const back = fs.readFileSync(TARGET, 'utf8');
const missing = Object.keys(parts).filter((n) => !back.includes(`  ${n}: {`));
if (missing.length) { console.error('❌ 써 놓고 되읽으니 없다: ' + missing.join(', ')); process.exit(1); }
console.log(`✅ ${Object.keys(parts).length}개 파츠를 parts_front.js 에 반영했다`);
