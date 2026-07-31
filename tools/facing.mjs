// 캐릭터가 "오른쪽(적 방향)을 보고 있다"가 한눈에 읽히는지 검사한다.
//
// 배경: 플레이어가 전투 화면을 보고 방패병이 뒤돌아 있다고 두 번 지적했다.
// 반전 로직은 정상이었고(아군은 flip 없음 = +x를 봄), 진짜 원인은 두 가지였다.
//   1) 방패를 handBack(x=11)에 붙여 몸 왼쪽 뒤로 튀어나왔다 → spritegen SHIELD_OFFSET 으로 수정
//   2) 얼굴이 머리 중앙에 있어 옆얼굴로 읽히지 않는다 → 이 스크립트가 검사하는 항목
//
// 옆모습에서 방향을 만드는 건 결국 **비대칭**이다. 얼굴·눈은 앞쪽(x가 큰 쪽)에,
// 뒤통수·머리카락은 뒤쪽에 있어야 한다. 캔버스 중심은 x=16, 머리 조인트도 x=16이다.
//
// 캔버스를 쓰지 않고 파츠 문자 행렬을 그대로 합성해서 재므로 node에서 바로 돌아간다.
import { BODY_PARTS } from '../src/art/parts_body.js';
import { GEAR_PARTS } from '../src/art/parts_gear.js';
import { JOINTS } from '../src/art/spritegen.js';
import { CLASSES } from '../src/data/classes.js';
import { ENEMIES } from '../src/data/enemies.js';

const PARTS = { ...BODY_PARTS, ...GEAR_PARTS };
const W = 32, H = 40;

/** 합격선 */
const MIN_EYE = 1;          // 합성 후 남아 있어야 하는 눈 픽셀 수
const EYE_X = 17.5;         // 눈 평균 x (중심 16보다 확실히 앞)
const MIN_SKIN = 5;         // 보이는 얼굴 픽셀 수 (투구가 얼굴을 통째로 덮으면 안 된다)
const SKIN_X = 16.8;        // 얼굴 평균 x
const HAIR_BACK = 16.2;     // 머리카락 평균 x (뒤통수는 뒤쪽에 있어야 한다)

const get = (n) => (!n || n.endsWith('_none') ? null : PARTS[n] || null);

/** 파츠들을 문자 격자에 순서대로 합성한다 (뒤에 오는 것이 덮어쓴다). */
function composeHead(names) {
  const grid = Array.from({ length: H }, () => new Array(W).fill('.'));
  const j = JOINTS.head;
  for (const name of names) {
    const p = get(name);
    if (!p) continue;
    for (let y = 0; y < p.h; y++) {
      const row = p.px[y];
      for (let x = 0; x < p.w; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        const gx = j.x + (x - p.ax), gy = j.y + (y - p.ay);
        if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
        grid[gy][gx] = ch;
      }
    }
  }
  return grid;
}

function measure(grid) {
  let eye = 0, eyeX = 0, skin = 0, skinX = 0, hair = 0, hairX = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      if (c === 'e') { eye++; eyeX += x; }
      else if (c === 's' || c === 'S') { skin++; skinX += x; }
      else if (c === 'h' || c === 'H') { hair++; hairX += x; }
    }
  }
  return {
    eye, skin, hair,
    eyeX: eye ? eyeX / eye : null,
    skinX: skin ? skinX / skin : null,
    hairX: hair ? hairX / hair : null,
  };
}

/** 실제로 게임에 쓰이는 (머리, 헤어, 투구) 조합만 검사한다 */
function usedCombos() {
  const seen = new Map();
  const add = (label, s) => {
    if (!s) return;
    const key = `${s.head || 'head_human'}|${s.hair || 'hair_none'}|${s.helm || 'helm_none'}`;
    if (!seen.has(key)) seen.set(key, { key, label, names: key.split('|') });
  };
  for (const [id, c] of Object.entries(CLASSES)) add(c.name || id, c.sprite);
  for (const [id, e] of Object.entries(ENEMIES)) add(e.name || id, e.sprite);
  return [...seen.values()];
}

const combos = usedCombos();
const fails = [];
const rows = [];

for (const combo of combos) {
  const m = measure(composeHead(combo.names));
  const bad = [];
  if (m.eye < MIN_EYE) bad.push(`눈 ${m.eye}개(≥${MIN_EYE})`);
  else if (m.eyeX < EYE_X) bad.push(`눈 x ${m.eyeX.toFixed(1)}(≥${EYE_X})`);
  if (m.skin < MIN_SKIN) bad.push(`얼굴 ${m.skin}px(≥${MIN_SKIN})`);
  else if (m.skinX < SKIN_X) bad.push(`얼굴 x ${m.skinX.toFixed(1)}(≥${SKIN_X})`);
  if (m.hair > 0 && m.hairX > HAIR_BACK) bad.push(`머리 x ${m.hairX.toFixed(1)}(≤${HAIR_BACK})`);
  rows.push({ combo, m, bad });
  if (bad.length) fails.push({ combo, bad });
}

console.log('\n캐릭터 방향 가독성 — 얼굴·눈은 앞(x>16)에, 뒤통수는 뒤(x<16)에\n');
console.log('조합 (머리 / 헤어 / 투구)                            눈  눈x   얼굴  얼굴x  머리x  판정');
console.log('─'.repeat(96));
for (const { combo, m, bad } of rows) {
  const name = combo.names.map((n) => n.replace(/^(head|hair|helm)_/, '')).join(' / ');
  const f = (v) => (v == null ? '  — ' : v.toFixed(1).padStart(5));
  console.log(
    `${(name + ' ').padEnd(50)}${String(m.eye).padStart(3)}${f(m.eyeX)}  ` +
    `${String(m.skin).padStart(4)}${f(m.skinX)}  ${f(m.hairX)}  ${bad.length ? '✗ ' + bad.join(', ') : '✓'}`);
}

console.log('─'.repeat(96));
if (fails.length) {
  console.log(`\n✗ ${fails.length}/${combos.length} 조합이 방향을 읽기 어렵다.`);
  console.log('  고치는 법: head_* 는 코·턱을 앞(x>ax)으로 내밀고 눈(e)을 앞쪽에 찍는다.');
  console.log('            hair_* 는 뒤통수 쪽(x<ax)에 몰고, helm_* 는 앞면에 바이저 틈을 내어 얼굴이 비치게 한다.');
  process.exit(1);
}
console.log(`\n✅ ${combos.length}개 조합 전부 방향이 읽힌다.`);
