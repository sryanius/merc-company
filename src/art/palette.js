// 도트 파츠에서 쓰는 문자 -> 색상 매핑.
// 파츠는 색을 직접 갖지 않고 "역할 문자"만 갖는다. 유닛마다 팔레트를 갈아끼워
// 같은 파츠로 완전히 다른 외형을 뽑는다. (palette swap)
//
//  .  투명            o  외곽선
//  s  피부   S 피부 그림자
//  h  머리카락 H 머리 그림자
//  c  천/주색  C 천 그림자
//  m  금속     M 금속 그림자
//  l  가죽     L 가죽 그림자
//  a  강조색   A 강조 그림자
//  w  하이라이트      e  눈
//  g  마력광   G 마력광 그림자


const SKIN = {
  pale: ['#f2cda6', '#cfa073'],
  tan: ['#e0a878', '#b57c50'],
  dark: ['#9c6b45', '#6f4a2e'],
  grey: ['#a8a8b4', '#7a7a88'],
  green: ['#8fbf6a', '#5f8a42'],
  ash: ['#8a7f96', '#5f5668'],
  bone: ['#e6e2d2', '#b3ae99'],
  red: ['#c56a5a', '#8e4438'],
};

const HAIR = {
  black: ['#3b3348', '#241f2e'],
  brown: ['#7a5230', '#4e341d'],
  blond: ['#e6c76a', '#b3913c'],
  white: ['#e8e8f0', '#b0b0c0'],
  red: ['#b8543a', '#7d3423'],
  blue: ['#5f7fc4', '#3d548a'],
  green: ['#5f9c68', '#3c6a44'],
};

const METAL = {
  iron: ['#9aa2b0', '#666e7e'],
  steel: ['#c2cad8', '#7f889a'],
  dark: ['#5c5f70', '#3a3c4a'],
  gold: ['#e8c24a', '#a8842a'],
  bronze: ['#c98a4b', '#8c5a2c'],
  silver: ['#dfe6f0', '#98a2b4'],
  bone: ['#ded8c4', '#a49d86'],
  blood: ['#a83b3b', '#6e2323'],
};

const CLOTH = {
  crimson: ['#a83a4a', '#6e2130'],
  azure: ['#3f6fb5', '#26467a'],
  forest: ['#3f8a55', '#25583a'],
  violet: ['#7a4bab', '#4d2c73'],
  sand: ['#c9ab6f', '#8f7444'],
  ash: ['#6b6b7a', '#454552'],
  ivory: ['#e4dfd0', '#b0a992'],
  night: ['#33334a', '#1f1f30'],
  ember: ['#d1642c', '#8f3d16'],
  teal: ['#2f9a97', '#1a635f'],
  rose: ['#d1738f', '#94465e'],
};

const LEATHER = {
  brown: ['#8a6136', '#5a3d20'],
  dark: ['#4e4238', '#332b24'],
  tan: ['#b08a55', '#7a5c33'],
  green: ['#5f7043', '#3d4a2a'],
};

const GLOW = {
  arcane: ['#8fd7ff', '#3d7fb8'],
  holy: ['#ffe9a8', '#d1a63f'],
  fire: ['#ffb44a', '#d1521f'],
  shadow: ['#a06fd6', '#5a3390'],
  nature: ['#9be86a', '#4f9436'],
  frost: ['#a8e8f0', '#4a95b8'],
  blood: ['#ff5a5a', '#a02020'],
  none: ['#cfcfe0', '#8a8aa0'],
};

/**
 * 눈동자 색.
 *
 * ★★ 예전엔 눈이 `e` **한 글자, 고정 검정**이었다. 그러면 어떤 캐릭터든 눈이 점 두 개라
 *   «애니메이션 얼굴» 이 나올 수가 없다 — 플레이어 지적: *"애들이 전체적으로 얼굴이 못생겼는데
 *   난 일본풍 애니메이션 좋아하는데"*.
 *   애니 눈은 **흰자 + 홍채 + 하이라이트** 세 겹이 있어야 산다 (HANDOFF §55).
 *     q 흰자 / e 홍채 / E 동공·홍채 그늘 / w 하이라이트(눈에도 쓴다)
 */
const EYE = {
  brown: ['#8a5a2e', '#4a2c14'],
  blue: ['#4a86c8', '#23477a'],
  green: ['#4a9a5e', '#256036'],
  amber: ['#d09030', '#8a5a18'],
  crimson: ['#c04050', '#722030'],
  violet: ['#8a5ac0', '#4d2f78'],
  grey: ['#8a90a0', '#4e5464'],
};
/** 흰자. 순백이 아니라 살짝 푸른 회백 — 순백은 눈알이 튀어나와 보인다. */
const SCLERA = '#eef2f8';

const OUTLINE = '#171320';

/* ─────────────────────── 색 보조 ───────────────────────
 * ★ 하이라이트를 **손으로 60개 더 적지 않는다.** 스와치가 60가지가 넘는데
 *   한 벌씩 적으면 새 색을 넣을 때마다 세 곳을 고쳐야 하고 반드시 하나를 빠뜨린다.
 *   기본색에서 **유도**하면 어떤 스와치든 자동으로 3단계가 된다.
 *
 * ★ 순백으로 밝히면 색이 빠져 분필처럼 된다. 채도를 지키려고
 *   «따뜻한 흰색» 쪽으로 당기고, 원색을 일부 남긴다. */
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** RGB(0~255) ↔ HSL(0~1). 명도만 따로 만지려고 거친다. */
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const L = (mx + mn) / 2;
  if (!d) return [0, 0, L];
  const S = L > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let H;
  if (mx === r) H = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) H = ((b - r) / d + 2) / 6;
  else H = ((r - g) / d + 4) / 6;
  return [H, S, L];
}
function hsl2rgb([H, S, L]) {
  if (!S) { const v = L * 255; return [v, v, v]; }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(H + 1 / 3) * 255, f(H) * 255, f(H - 1 / 3) * 255];
}

/**
 * 하이라이트 = **명도만** 올린다.
 *
 * ★ 흰색과 섞으면 안 된다. 어두운 색일수록 채도가 통째로 빠져
 *   갈색 머리(#7a5230)가 분필색(#a78a6f)이 된다 — 실제로 첫 판이 그랬다.
 *   HSL 로 L 만 남은 여유의 t 만큼 올리고, 채도는 살짝만 낮춘다.
 *   빛이 따뜻하다는 느낌은 색조를 노랑 쪽으로 아주 조금(2°) 밀어 낸다.
 */
function lite(h, t) {
  const [H, S, L] = rgb2hsl(hex2rgb(h));
  const nH = (H + 0.006) % 1;                 // 살짝 따뜻하게
  const nS = S * (1 - t * 0.22);              // 너무 유지하면 형광이 된다
  const nL = L + (1 - L) * t;
  return rgb2hex(hsl2rgb([nH, nS, nL]));
}

/**
 * 볼 홍조 = 피부색에서 유도한다.
 * ★ 고정 분홍을 쓰면 어두운 피부에서 스티커처럼 뜬다 — 그 피부를 붉은 쪽으로 밀어야
 *   «달아오른 볼» 로 읽힌다. 애니 얼굴의 귀여움 절반이 여기서 나온다 (HANDOFF §60).
 */
const blushOf = (skin) => rgb2hex(mix(skin, '#ff5a6e', 0.42));
const mix = (a, b, t) => hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t);

/**
 * 깊은 그늘 = 재질과 **무관한** 어두운 중성색.
 * ★ 피부에서 유도하면 갑옷 틈이 갈색으로 뜬다. 맞닿아 생긴 그늘은 재질색이 아니라
 *   «빛이 안 드는 곳» 이므로 외곽선보다 조금 밝은 한 가지 색이면 충분하다.
 */
const DEEP = '#2a2438';

/**
 * 팔레트 조립. 각 인자는 위 사전의 키.
 *
 * ★★ 재질마다 **3단계 + 깊은 그늘** 이다. 2단계로는 입체가 안 나온다 —
 *   실제로 옛 파츠가 «기본 + 왼쪽 그림자 한 줄» 뿐이라 전부 납작했다 (HANDOFF §51).
 *     피부   x 하이라이트 / s 기본 / S 그림자
 *     머리   y            / h      / H
 *     천     v            / c      / C
 *     금속   n            / m      / M
 *     가죽   k            / l      / L
 *     강조   b            / a      / A
 *     마력광 f            / g      / G
 *   `w` 는 **금속 반사광 전용 순백**이다. 피부·천에 쓰면 분필처럼 뜬다.
 *   `d` 는 재질과 무관한 깊은 그늘(맞닿은 틈).
 *
 * @returns {Record<string,string>} 문자 -> hex
 */
export function makePalette({ skin = 'pale', hair = 'brown', metal = 'iron', cloth = 'ash', leather = 'brown', accent = 'gold', glow = 'none', eye = 'brown', outline = OUTLINE } = {}) {
  const [s, S] = SKIN[skin] || SKIN.pale;
  const [h, H] = HAIR[hair] || HAIR.brown;
  const [m, M] = METAL[metal] || METAL.iron;
  const [c, C] = CLOTH[cloth] || CLOTH.ash;
  const [l, L] = LEATHER[leather] || LEATHER.brown;
  const [a, A] = METAL[accent] || CLOTH[accent] || METAL.gold;
  const [g, G] = GLOW[glow] || GLOW.none;
  const [e, E] = EYE[eye] || EYE.brown;
  return {
    '.': null, o: outline, w: '#ffffff',
    q: SCLERA, e, E,          // 눈: 흰자 · 홍채 · 동공
    s, S, h, H, c, C, m, M, l, L, a, A, g, G,
    // 하이라이트 (유도)
    x: lite(s, 0.30),      // 피부는 살짝만 — 많이 밝히면 창백해진다
    y: lite(h, 0.34),
    v: lite(c, 0.28),      // 천은 반사가 약하다
    n: lite(m, 0.42),      // 금속은 세게
    k: lite(l, 0.30),
    b: lite(a, 0.40),
    f: lite(g, 0.50),      // 마력광은 심지가 밝다
    r: blushOf(s),         // 볼 홍조
    // 깊은 그늘 (재질 공용, 피부 기준으로 하나만 둔다)
    d: DEEP,
  };
}

/** 도트에서 쓸 수 있는 문자 전부. 파츠 검사기가 이 목록으로 오타를 잡는다. */
export const PIX_CHARS = ['.', 'o', 'w', 'd', 'q', 'e', 'E', 'r',
  's', 'S', 'x', 'h', 'H', 'y', 'c', 'C', 'v', 'm', 'M', 'n',
  'l', 'L', 'k', 'a', 'A', 'b', 'g', 'G', 'f'];

/** 문자 -> 사람 말 (도구가 표를 찍을 때 쓴다) */
export const CHAR_NAME = {
  '.': '투명', o: '외곽선', w: '반사광·눈 하이라이트', d: '깊은 그늘',
  q: '흰자', e: '홍채', E: '동공', r: '볼 홍조',
  s: '피부', S: '피부 그늘', x: '피부 하이라이트',
  h: '머리', H: '머리 그늘', y: '머리 하이라이트',
  c: '천', C: '천 그늘', v: '천 하이라이트',
  m: '금속', M: '금속 그늘', n: '금속 하이라이트',
  l: '가죽', L: '가죽 그늘', k: '가죽 하이라이트',
  a: '강조', A: '강조 그늘', b: '강조 하이라이트',
  g: '마력광', G: '마력광 그늘', f: '마력광 심지',
};

export const PALETTE_SETS = { SKIN, HAIR, METAL, CLOTH, LEATHER, GLOW, EYE };

/** 등급 색 (F~S) */
export const GRADE_COLOR = {
  F: '#8a8a96', E: '#9fb08a', D: '#6fae7a', C: '#5b95d6', B: '#9a6fd6', A: '#e0913a', S: '#f0d24a',
};

/** 아이템 희귀도 색 (0~4) */
export const RARITY_COLOR = ['#9a9aa6', '#6fae7a', '#5b95d6', '#a86fd6', '#e8a13a'];
export const RARITY_NAME = ['일반', '고급', '희귀', '영웅', '전설'];
