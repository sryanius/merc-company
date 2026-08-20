// 도트 파츠 인덱스. 실제 픽셀 데이터는 parts_body.js / parts_gear.js 가 소유한다.
// SPEC §4.3~4.4 참고.
import { BODY_PARTS } from './parts_body.js';
import { upscalePart } from './upscale.js';
import { SCALE } from './scale.js';
import { GEAR_PARTS } from './parts_gear.js';

export const PARTS = { ...BODY_PARTS, ...GEAR_PARTS };

/** 아무것도 그리지 않는 빈 파츠 */
export const EMPTY_PART = { w: 1, h: 1, ax: 0, ay: 0, px: ['.'] };

const warned = new Set();

/** 파츠 조회. 없거나 `*_none` 이면 빈 파츠를 돌려준다 (렌더 중단 방지). */
/* ★ 옛 파츠는 **32×40 시절 좌표로 적혀 있다.** 스프라이트 해상도(SCALE)까지 여기서 승격한다
 *   (`art/upscale.js`, HANDOFF §50).
 *
 * ★★ 파츠는 **자기가 몇 배로 그려졌는지 `scale` 로 밝힌다** (없으면 1 = 32×40 기준).
 *   그래야 한 번에 다 갈아엎지 않고 **하나씩** 옮길 수 있고,
 *   나중에 해상도를 또 올려도 «먼저 옮긴 파츠만 작게 남는» 일이 안 생긴다.
 *
 * ★ 캐시 열쇠에 SCALE 을 넣는다 — 안 넣으면 배율을 바꿔도 옛 결과가 그대로 나온다. */
const upCache = new Map();

export function getPart(name) {
  if (!name || name === 'none' || String(name).endsWith('_none')) return EMPTY_PART;
  const p = PARTS[name];
  if (!p) {
    if (!warned.has(name)) { warned.add(name); console.warn('[parts] 정의되지 않은 파츠:', name); }
    return EMPTY_PART;
  }
  if ((p.scale || 1) === SCALE) return p;
  const key = name + '@' + SCALE;
  let up = upCache.get(key);
  if (!up) { up = upscalePart(p, SCALE); upCache.set(key, up); }
  return up;
}

/** 손질한 파츠를 바로 확인할 때 (개발용). 캐시를 비운다. */
export function clearPartCache() { upCache.clear(); }

export const hasPart = (name) => !!PARTS[name];

/** SPEC §4.4 어휘. 누락 파츠 점검용. */
export const PART_VOCAB = `
body_slim body_normal body_heavy body_hulk
head_human head_goblin head_orc head_skull head_wolf head_lizard head_demon head_elf
hair_none hair_short hair_long hair_pony hair_mohawk hair_bald hair_beard
helm_none helm_iron helm_horned helm_great helm_circlet helm_hood helm_wizard helm_crown helm_plume helm_mask
armor_cloth armor_robe armor_leather armor_mail armor_plate armor_heavy armor_bare armor_bone
cape_none cape_short cape_long cape_tattered cape_wing
arm_slim arm_normal arm_heavy
leg_cloth leg_leather leg_mail leg_plate leg_bare
wpn_none wpn_sword wpn_greatsword wpn_katana wpn_rapier wpn_dagger wpn_twindagger
wpn_axe wpn_greataxe wpn_mace wpn_hammer wpn_spear wpn_pike wpn_halberd wpn_scythe
wpn_bow wpn_longbow wpn_crossbow wpn_staff wpn_wand wpn_tome wpn_claw wpn_orb
shd_none shd_buckler shd_round shd_kite shd_tower shd_orb shd_torch shd_dagger
`.trim().split(/\s+/);

/** 파츠 무결성 검사. 콘솔에서 `window.__parts()` 로 확인. */
export function validateParts() {
  const missing = PART_VOCAB.filter((n) => !n.endsWith('_none') && !PARTS[n]);
  const broken = [];
  for (const [name, p] of Object.entries(PARTS)) {
    if (!p || !Array.isArray(p.px)) { broken.push(`${name}: px 없음`); continue; }
    if (p.px.length !== p.h) broken.push(`${name}: h=${p.h} 인데 행 ${p.px.length}개`);
    const bad = p.px.findIndex((r) => r.length !== p.w);
    if (bad >= 0) broken.push(`${name}: ${bad}행 길이 ${p.px[bad].length} ≠ w=${p.w}`);
    if (p.ax == null || p.ay == null) broken.push(`${name}: 앵커(ax,ay) 없음`);
  }
  return { total: Object.keys(PARTS).length, missing, broken };
}

if (typeof window !== 'undefined') window.__parts = validateParts;
