/**
 * 정면 파츠 — 단원 탭·주점 초상용
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 이름은 **옆모습 파츠와 같다** (`head_human`, `armor_plate` …).
 *   레시피를 그대로 쓰고 여기서 정면 그림만 갈아 끼운다.
 *
 * ★★ 없는 파츠는 **그리지 않는다.** 옆모습 것으로 대신 채우면 정면 조인트에 옆얼굴이 얹혀
 *   기괴해진다 — 빈 자리가 «아직 안 그렸다» 로 읽혀서 낫다 (`portrait.canDraw`).
 *
 * ★ 좌표 규약 (96×120, SCALE=3)
 *     head_* / hair_* / helm_*  : 앵커 = **하단 중앙(목)**   → head    (48, 44)
 *     body_* / armor_* / cape_* : 앵커 = **상단 중앙**       → chest   (48, 44)
 *     arm_*                     : 앵커 = **상단 안쪽 모서리(어깨)** → shLeft(38,48) / shRight(58,48)
 *     leg_*                     : 앵커 = **상단 중앙(고관절)** → hipLeft(42,75) / hipRight(54,75)
 *     wpn_* / shd_*             : 앵커 = **손잡이 그립점**   → handRight(62,80) / handLeft(34,80)
 *   발바닥 y=114, 가로 중심 x=48.
 *
 * ★ **왼쪽 파츠는 앵커를 축으로 좌우가 뒤집혀** 그려진다 (`pixel.js` 의 flipX).
 *   즉 팔·다리는 **오른쪽(빛 받는 쪽) 기준 한 짝만** 그리면 된다.
 *
 * ★ `scale` 은 이 그림이 몇 배로 그려졌는지다 (3 = 96×120 기준). 빼먹으면 또 늘어난다.
 *
 * @module art/parts_front
 */

/** @type {Record<string, {w:number,h:number,ax:number,ay:number,px:string[],scale:number}>} */
export const FRONT_PARTS = {
  // 아직 없다 — 여기에 하나씩 채운다.
};

/** 이 슬롯이 채워졌나. 비어도 되는 슬롯(투구 없음 등)은 언제나 참이다. */
export function hasFrontPart(name) {
  if (!name || name === 'none' || String(name).endsWith('_none')) return true;
  return !!FRONT_PARTS[name];
}

export function getFrontPart(name) {
  if (!name || name === 'none' || String(name).endsWith('_none')) return null;
  return FRONT_PARTS[name] || null;
}

/** 얼마나 그렸나 (도구가 진행률을 찍는다) */
export const frontPartCount = () => Object.keys(FRONT_PARTS).length;
