// 캐릭터가 "오른쪽(적 방향)을 보고 있다"가 한눈에 읽히는지 검사한다.
//
// 배경: 플레이어가 전투 화면을 보고 방패병이 뒤돌아 있다고 두 번 지적했다.
// 반전 로직은 정상이었고(아군은 flip 없음 = +x를 봄), 진짜 원인은 두 가지였다.
//   1) 방패를 handBack(x=11)에 붙여 몸 왼쪽 뒤로 튀어나왔다 → spritegen SHIELD_OFFSET 으로 수정
//   2) 얼굴이 머리 중앙에 있어 옆얼굴로 읽히지 않는다 → 이 스크립트가 검사하는 항목
//
// 옆모습에서 방향을 만드는 건 결국 **비대칭**이다. 얼굴·눈은 앞쪽(x가 큰 쪽)에,
// 뒤통수·머리카락은 뒤쪽에 있어야 한다. 가로 중심과 머리 조인트 x 는 같은 값이다(SPRITE_W/2).
//
// 캔버스를 쓰지 않고 파츠 문자 행렬을 그대로 합성해서 재므로 node에서 바로 돌아간다.
//
// ★★ 좌표를 **직접 적지 않는다.** 예전엔 W=32,H=40 과 «중심 16» 을 박아 놨는데,
//   해상도를 64×80 으로 올리자 조인트만 2배가 돼 71/71 전부 낙제로 뒤집혔다.
//   측정기가 고장난 것을 «캐릭터가 다 잘못됐다» 로 읽을 뻔했다 (HANDOFF §50).
//   파츠는 parts.js 의 getPart() 로 받고(배율 승격을 거친다), 규격은 spritegen 에서 읽는다.
import { getPart } from '../src/art/parts.js';
import { JOINTS, SPRITE_W, SPRITE_H, SCALE } from '../src/art/spritegen.js';
import { BODY_PARTS } from '../src/art/parts_body.js';
import { GEAR_PARTS } from '../src/art/parts_gear.js';
import { CLASSES } from '../src/data/classes.js';
import { ENEMIES } from '../src/data/enemies.js';

const PARTS = { ...BODY_PARTS, ...GEAR_PARTS };
const W = SPRITE_W, H = SPRITE_H;
const MID = W / 2;                       // 가로 중심 = 머리 조인트 x

/** 합격선. 거리 기준은 «중심에서 몇 논리 픽셀» 이라 배율을 탄다. */
const MIN_EYE = 1;                       // 합성 후 남아 있어야 하는 눈 픽셀 수
const EYE_X = MID + 1.5 * SCALE;         // 눈 평균 x (중심보다 확실히 앞)
const MIN_SKIN = 5 * SCALE;              // 보이는 얼굴 픽셀 수 (투구가 얼굴을 통째로 덮으면 안 된다)
const SKIN_X = MID + 0.8 * SCALE;        // 얼굴 평균 x
const HAIR_BACK = MID + 0.2 * SCALE;     // 머리카락 평균 x (뒤통수는 뒤쪽에 있어야 한다)
/* ★ 머리카락이 **머리에 붙어 있나** — 평균 x 만 재면 «뒤에 떠 있는 가발» 을 못 잡는다 */
const MAX_BARE = 2 * SCALE;              // 정수리가 드러난 열 (조금은 이마·가르마라 허용)
const MAX_FLOAT = 3 * SCALE;             // 피부에 한 칸도 안 닿는 머리카락 덩어리

const get = (n) => {
  if (!n || n.endsWith('_none')) return null;
  if (!PARTS[n]) return null;
  return getPart(n);                     // ★ 승격된 파츠 (배율이 조인트와 맞는다)
};

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

/* ★★ 재질 문자는 **3단계 전부** 세야 한다 (art/palette.js).
 *   하이라이트(x·y)를 빼먹었더니 얼굴 평균 x 가 뒤로 밀려 31/71 이 낙제로 나왔다 —
 *   하이라이트는 빛을 받는 **앞면에 몰려 있기** 때문이다. 그림이 아니라 자가 틀렸다.
 *   팔레트에 단계를 더할 때 여기도 같이 고쳐야 한다 (HANDOFF §54). */
const SKIN = new Set(['s', 'S', 'x']);
const HAIR = new Set(['h', 'H', 'y']);

function measure(grid) {
  let eye = 0, eyeX = 0, skin = 0, skinX = 0, hair = 0, hairX = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      if (c === 'e') { eye++; eyeX += x; }
      else if (SKIN.has(c)) { skin++; skinX += x; }
      else if (HAIR.has(c)) { hair++; hairX += x; }
    }
  }
  return {
    eye, skin, hair,
    eyeX: eye ? eyeX / eye : null,
    skinX: skin ? skinX / skin : null,
    hairX: hair ? hairX / hair : null,
    ...scalp(grid),
  };
}

/**
 * 머리카락이 **두피에 붙어 있나.**
 *
 * ★ 실제로 겪은 것 (HANDOFF §54): 파츠를 다시 그렸더니 머리카락이 뒤통수 **뒤에 떠 있는 판**이 됐다.
 *   대머리에 가발이 따로 떠 있는 모양인데, 위 지표(평균 x)는 전부 통과했다.
 *   «뒤통수 쪽에 있는가» 만 재고 «머리에 붙어 있는가» 를 안 쟀기 때문이다.
 *
 * 두 가지를 본다:
 *   1. 정수리 노출 — 머리 위쪽에서 머리카락 대신 **맨살**이 보이는 칸 수
 *   2. 뜬 머리카락 — 머리(피부)와 **한 칸도 안 닿는** 머리카락 덩어리의 크기
 */
function scalp(grid) {
  const skinAt = (x, y) => SKIN.has(grid[y][x]);
  const hairAt = (x, y) => HAIR.has(grid[y][x]);

  // 1) 각 열에서 가장 위의 피부/머리카락을 찾아, 피부가 더 위면 «정수리가 드러났다»
  let bare = 0;
  for (let x = 0; x < W; x++) {
    let topSkin = -1; let topHair = -1;
    for (let y = 0; y < H; y++) {
      if (topSkin < 0 && skinAt(x, y)) topSkin = y;
      if (topHair < 0 && hairAt(x, y)) topHair = y;
      if (topSkin >= 0 && topHair >= 0) break;
    }
    if (topSkin >= 0 && topHair >= 0 && topSkin < topHair) bare++;
  }

  /* 2) 머리카락 덩어리를 잇고, **몸의 어느 것에도 안 닿으면** «떠 있다».
   *
   * ★ 「피부에 닿는가」 로 재면 안 된다 — 투구를 쓰면 머리카락이 두피 대신 **투구**에 닿는데
   *   그걸 «떴다» 로 오판한다 (실제로 human/short/iron 이 그렇게 낙제로 나왔다).
   *   기준은 «머리카락 아닌 무언가에 닿아 있는가» 다. 허공에 뜬 판만 잡힌다. */
  const solid = (x, y) => grid[y][x] !== '.' && !hairAt(x, y);
  const seen = Array.from({ length: H }, () => new Array(W).fill(false));
  let floating = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seen[y][x] || !hairAt(x, y)) continue;
      const stack = [[x, y]]; let size = 0; let touches = false;
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        size++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (solid(nx, ny)) touches = true;
          if (seen[ny][nx] || !hairAt(nx, ny)) continue;
          seen[ny][nx] = true; stack.push([nx, ny]);
        }
      }
      if (!touches) floating = Math.max(floating, size);
    }
  }
  return { bare, floating };
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
  /* 머리카락이 있는데 두피를 안 덮거나 몸에서 떨어져 있으면 «가발이 떠 있는» 그림이다 */
  if (m.hair > 0 && m.bare > MAX_BARE) bad.push(`정수리 노출 ${m.bare}칸(≤${MAX_BARE})`);
  if (m.floating > MAX_FLOAT) bad.push(`뜬 머리카락 ${m.floating}px(≤${MAX_FLOAT})`);
  rows.push({ combo, m, bad });
  if (bad.length) fails.push({ combo, bad });
}

console.log(`\n캐릭터 방향 가독성 — 얼굴·눈은 앞(x>${MID})에, 뒤통수는 뒤(x<${MID})에  ·  캔버스 ${W}×${H}\n`);
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
