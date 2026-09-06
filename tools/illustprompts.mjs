// 정면 일러스트 생성 프롬프트 — 스타일(illustStyleOf) 11종 × 성별
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 왜 파일인가
//   105 클래스는 11 스타일로 묶인다 (game/merc.js illustStyleOf). 스타일마다 «무엇을 든 누구인가» 를
//   한 곳에 적어야 다시 뽑을 때 같은 그림이 나온다. 프롬프트가 채팅에만 있으면 두 번째 판부터 어긋난다.
//
// ★ 표식 규약 (tools/illustpng.mjs 가 읽는다)
//   머리 = magenta(자홍) · 홍채 = cyan(청록) · 배경 = 순녹(#00ff00, 키잉) · 발이 바닥 · 3/4 서 있는 자세.
//   녹색 옷·청록 옷·분홍/보라 옷은 금지 — 배경·표식과 섞인다.
//
// ★ 모델: Animagine XL 4.0 (SDXL). 품질 태그·부정 프롬프트·cfg 5·28 단계는 모델 카드 권장값.
//   해상도 896×1152 (7:9) — 4:5 목표에 가장 가까운 SDXL 버킷. 도구가 그림 상자를 잘라 192×240 으로 맞춘다.

import { CLASS_TAGS } from './illustprompts_classes.mjs';

/** 스타일별 «누구» — 게임 현재 디자인(도감)과 어긋나지 않게 색·장비를 고정한다. 클래스 태그가 없을 때의 대체다. */
export const STYLE_TAGS = {
  fighter: 'mercenary swordsman, red military jacket with gold epaulettes and gold buttons, brown leather boots, holding a longsword, confident',
  lancer: 'spearman, steel breastplate over dark blue tunic, long spear held upright, round shield on back',
  tank: 'heavily armored knight, full plate armor, large tower shield, flanged mace, stalwart',
  archer: 'ranger archer, brown hooded cloak, leather armor, longbow in hand, quiver of arrows',
  rogue: 'assassin rogue, dark hooded outfit, face mask, twin daggers, lean, sly',
  mage: 'mage, wide-brimmed wizard hat, long dark blue robe with gold trim, wooden staff with glowing crystal',
  healer: 'priestess, white and gold robe, holy staff, gentle, prayer',
  necro: 'necromancer, black tattered robe, bone scythe, skull ornaments, dark aura, pale',
  monk: 'martial artist monk, sleeveless gi, clawed gauntlets, prayer beads, fighting stance, muscular',
  fiend: 'vampire swordsman, black and crimson long coat, katana, pale skin, fangs, red glow',
  oath: 'paladin priest, white plate armor with gold cross, kite shield, holy light, serene',
};

export const STYLES = Object.keys(STYLE_TAGS);

/** 모든 그림에 공통 — 자세·표식·배경·품질 */
/* ★ 1차 파일럿 실측 (2026-09-06): «green screen background» 는 청록빛(160°)으로 나왔고 «magenta hair» 는
 *   분홍(330~345°)으로 나왔다. 배경은 도구가 테두리에서 재서 빼니(--bg=auto) 색이 정확할 필요는 없지만
 *   눈(청록 165~200°)과 멀어야 한다 — 라임 쪽(90~120°)으로 민다. 머리는 색상대를 285~350° 로 넓혔다. */
/* ★ 2차 실측 (105장 일괄): 클래스 태그가 40단어를 넘자 뒤에 있던 배경·머리 태그가 CLIP 두 번째 청크(77토큰 뒤)로 밀려
 *   76장이 무채색 배경으로 나왔다. 표식·배경은 **맨 앞**에, 가중치를 걸어 둔다. 자세·품질은 뒤. */
/* ★ 노출 (제작자 2026-09-06 「옷들이 노출이 좀 더 있으면 좋겠다」): Animagine 등급 태그 sensitive + 노출 태그.
 *   선은 지킨다 — 부정 프롬프트에 nsfw·nude·nipples. 클래스 태그도 「노출 요소 2개 이상」 규칙으로 다시 썼다. */
const LEAD = 'sensitive, revealing clothes, '
  + '(vivid purple hair:1.3), (bright violet hair:1.2), saturated purple hair, glossy hair, cyan eyes, aqua eyes';
/* ★ 3차 실측: 배경을 맨 앞에 1.3 으로 걸었더니 방패 줄무늬·지팡이·검 광채가 초록으로 번졌다 (배경색 = 키 색이라 구멍이 난다).
 *   클래스 태그 뒤, 머리 모양 뒤에 1.1 로. 파스텔로 나와도 도구가 테두리에서 재서 뺀다. */
const BG = '(flat lime green background:1.1), simple background';
const COMMON = 'solo, full body, standing pose, both feet on the ground, three-quarter view, looking at viewer, '
  + 'masterpiece, high score, great score, absurdres';

export const NEGATIVE = 'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, '
  + 'worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry, '
  + 'multiple views, multiple girls, multiple boys, chibi, nsfw, explicit, nude, nipples, sex, underwear only, '
  + 'jumping, kicking, running, one leg raised, sitting, kneeling, crouching, bending over, squatting, leaning forward, magic circle, glowing ring, circular aura, halo ring behind body, '
  + 'pink clothes, magenta clothes, purple clothes, lavender clothes, purple cape, green clothes, green armor, green trim, green weapon, green glow, green shield, green gem, purple weapon, purple blade, purple gem, purple glow, purple trim, purple armor, purple lining, purple cape, purple flames, purple aura, purple crystal, magenta, pink glow, floating skulls, wisps, spirits, smoke, fog, mist, ink splatter, stained glass, window, arch, from behind, back view, teal clothes, cyan clothes, green cape, green scarf, '
  + 'glowing weapon, drop shadow, cast shadow, ground shadow, teal background, gradient background, detailed background, scenery';

/**
 * @param {string} style  STYLE_TAGS 의 키
 * @param {'1boy'|'1girl'} subject
 * @param {string} [extra] 판마다 덧붙일 말 (예: 'smile')
 */
export function buildPrompt(style, subject = '1boy', extra = '') {
  const tags = STYLE_TAGS[style];
  if (!tags) throw new Error(`모르는 스타일: ${style}`);
  return [subject, LEAD, tags, BG, extra, COMMON].filter(Boolean).join(', ');
}

/* ★ 3차 실측(재검수 63장 중 54장 탈락): 모델이 «dagger/wand/tome/bow» 를 무시하고 검·낫·지팡이를 쥐여 준다.
 *   주무기를 **맨 앞에 가중치**로 박고, 그 클래스가 안 드는 무기 이름을 **부정 프롬프트**에 넣는다. */
const WEAPON = {
  sword: ['longsword', ['sword', 'longsword']], greatsword: ['greatsword', ['greatsword', 'zweihander', 'sword']], katana: ['katana', ['katana']],
  rapier: ['rapier', ['rapier', 'sword']], dagger: ['dagger', ['dagger', 'knife']], twindagger: ['dual daggers', ['dagger', 'daggers', 'knife']],
  axe: ['battle axe', ['axe']], greataxe: ['great axe', ['axe']], mace: ['flanged mace', ['mace']], hammer: ['war hammer', ['hammer']],
  spear: ['spear', ['spear', 'polearm', 'lance']], pike: ['pike', ['pike', 'spear', 'polearm']], halberd: ['halberd', ['halberd', 'polearm', 'spear']],
  scythe: ['scythe', ['scythe']], bow: ['longbow', ['bow', 'longbow']], longbow: ['longbow', ['bow', 'longbow']], crossbow: ['crossbow', ['crossbow', 'bow']],
  staff: ['staff', ['staff']], wand: ['short wand', ['wand']], tome: ['open grimoire', ['grimoire', 'book', 'tome', 'spellbook']],
  claw: ['clawed gauntlets', ['claws', 'gauntlets', 'claw']], orb: ['floating orb', ['orb']], shield: ['shield', ['shield']],
};
const ALL_NOUNS = ['sword', 'longsword', 'greatsword', 'katana', 'rapier', 'dagger', 'axe', 'mace', 'hammer', 'spear', 'polearm', 'lance', 'pike', 'halberd', 'scythe', 'bow', 'crossbow', 'staff', 'wand', 'grimoire', 'book', 'claws', 'orb', 'shield', 'glaive', 'sickle', 'trident', 'whip', 'gun'];

/** 주무기 강조 — 맨 앞에 */
export function weaponLead(classId) {
  const ct = CLASS_TAGS[classId];
  const eq = ct && ct.equip && ct.equip[0];
  const w = eq && WEAPON[eq];
  if (!w) return '';
  return `(holding ${w[0]}:1.3), ${w[0]} in hand`;
}

/** 클래스별 부정 — 이 클래스가 안 드는 무기들 (equip 전체의 어휘는 뺀다) */
export function classNegative(classId) {
  const ct = CLASS_TAGS[classId];
  if (!ct || !ct.equip) return '';
  const allowed = new Set();
  for (const e of ct.equip) for (const n of ((WEAPON[e] || [])[1] || [])) allowed.add(n);
  return ALL_NOUNS.filter((n) => !allowed.has(n)).join(', ');
}

/**
 * 클래스별 프롬프트 — 105 클래스 각각 다른 그림 (제작자: 「검사 계열이 모두 같고 머리색만 다른데 다 바꾸는 거 맞지?」).
 * CLASS_TAGS 가 없는 클래스는 스타일 태그로 물러난다. 용병은 전부 여성 (제작자 결정 2026-09-06).
 */
/* ★ 6차: 재생성 보정(gen/fixes.json)이 tags·hairStyle·pose 를 통째로 바꿀 수 있다 — override 로 받는다. equip 은 못 바꾼다(주무기 선두·부정은 그대로). */
export function buildClassPrompt(classId, style, extra = '', override = null) {
  const base = CLASS_TAGS[classId];
  if (!base) return buildPrompt(style, '1girl', extra);
  const ct = override ? { ...base, ...Object.fromEntries(Object.entries(override).filter(([k, v]) => ['tags', 'hairStyle', 'pose'].includes(k) && v)) } : base;
  const parts = ['1girl', weaponLead(classId), '(standing:1.2), standing straight, full body', LEAD, ct.tags, ct.hairStyle, BG, ct.pose, extra].filter(Boolean);
  return [...parts, COMMON].join(', ');
}

/** 모델 카드 권장 설정 */
export const SETTINGS = { w: 896, h: 1152, steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal' };
