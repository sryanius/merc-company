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

export const PIX_CHARS = ['.', 'o', 's', 'S', 'h', 'H', 'c', 'C', 'm', 'M', 'l', 'L', 'a', 'A', 'w', 'e', 'g', 'G'];

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

const OUTLINE = '#171320';

/**
 * 팔레트 조립. 각 인자는 위 사전의 키.
 * @returns {Record<string,string>} 문자 -> hex
 */
export function makePalette({ skin = 'pale', hair = 'brown', metal = 'iron', cloth = 'ash', leather = 'brown', accent = 'gold', glow = 'none', outline = OUTLINE } = {}) {
  const [s, S] = SKIN[skin] || SKIN.pale;
  const [h, H] = HAIR[hair] || HAIR.brown;
  const [m, M] = METAL[metal] || METAL.iron;
  const [c, C] = CLOTH[cloth] || CLOTH.ash;
  const [l, L] = LEATHER[leather] || LEATHER.brown;
  const [a, A] = METAL[accent] || CLOTH[accent] || METAL.gold;
  const [g, G] = GLOW[glow] || GLOW.none;
  return { '.': null, o: outline, s, S, h, H, c, C, m, M, l, L, a, A, w: '#ffffff', e: '#20182c', g, G };
}

export const PALETTE_SETS = { SKIN, HAIR, METAL, CLOTH, LEATHER, GLOW };

/** 등급 색 (F~S) */
export const GRADE_COLOR = {
  F: '#8a8a96', E: '#9fb08a', D: '#6fae7a', C: '#5b95d6', B: '#9a6fd6', A: '#e0913a', S: '#f0d24a',
};

/** 아이템 희귀도 색 (0~4) */
export const RARITY_COLOR = ['#9a9aa6', '#6fae7a', '#5b95d6', '#a86fd6', '#e8a13a'];
export const RARITY_NAME = ['일반', '고급', '희귀', '영웅', '전설'];
