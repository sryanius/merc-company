/**
 * 등록된 유닛 스탯의 **상한 검사** (위조 1차 방어선)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 무엇을 막고 무엇을 못 막는지 먼저 적는다.
 *
 *   PvP 방어 편성은 **클라이언트가 계산해서 올린다.** 접사(affix)가 `rng.float(min,max)` 로
 *   굴려진 실수값이라 서버가 그대로 되살릴 수 없기 때문이다 (HANDOFF §68.1).
 *   그래서 «이 스탯이 정확히 맞는가» 는 지금 단계에서 못 묻는다.
 *
 *   대신 **«물리적으로 가능한 값인가» 는 물을 수 있다.** 맨몸 스탯은
 *   (계열, 클래스 보정, 티어, 레벨, 등급) 만으로 rng 없이 정해지고,
 *   장비가 더할 수 있는 최대치는 실측으로 안다.
 *
 *   ⇒ `보고값 ≤ (맨몸 + 장비 최대가산) × 여유` 를 넘으면 거절한다.
 *     hp 999999 같은 값은 여기서 전부 걸린다. 미세 조작(+3%)은 못 잡는다 —
 *     그건 다음 단계(원본 재계산)의 몫이다.
 *
 * ★ 상한은 **추측이 아니라 실측**이다. 게임의 아이템 생성기로 10칸 전부
 *   신화(rarity 5)·ilvl 80·**모든 굴림 최대**로 만들어 «장비가 더하는 절대량» 을 쟀다:
 *
 *     hp +8998 · atk +1210 · def +1357 · res +720 · spd +68 · crit +26 · critDmg +50 · eva +11
 *
 *   ★★ **배율이 아니라 가산량이다.** 처음엔 «맨몸 × 최대배율» 로 잡았다가 궁수가 걸렸다 —
 *     장비는 고정값을 더하므로 **기본 수치가 낮은 스탯일수록 배율이 커진다.**
 *     실측으로 확인: 위 가산량은 9개 클래스에서 **전부 동일**했다 (장비는 클래스와 무관하다).
 *     그래서 «맨몸 + 최대가산 × 여유» 가 옳은 모양이다.
 *
 *   세트 효과는 가산 뒤에 **배율로** 붙으므로 그것만 배수로 남긴다.
 *   여유를 넉넉히 두는 이유: **정상 플레이어를 막는 쪽이 조작을 놓치는 쪽보다 훨씬 나쁘다.**
 */
import { ARCHETYPES, CLASSES } from './_engine/classes.js';

/* ★ merc.js 의 상수와 **같은 값이어야 한다.** 다르면 정상 유닛이 걸린다.
 *   (merc.js 는 state.js 를 물어 서버로 옮기기 무거워서 여기 옮겨 적었다 —
 *    이 중복은 스모크가 대조한다.) */
export const GRADE_MULT = { F: 0.78, E: 0.88, D: 0.97, C: 1.06, B: 1.18, A: 1.34, S: 1.55 };
export const GRADE_IDX = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };
export const TIER_MULT = [1.00, 1.30, 1.66, 2.10];
export const GROWTH_RATE = 0.085;
export const SCALING_KEYS = ['hp', 'atk', 'def', 'res', 'spd'];
export const FLAT_KEYS = ['crit', 'critDmg', 'eva'];
export const FALLBACK_ARCH = { hp: 220, atk: 30, def: 15, res: 12, spd: 46, crit: 6, critDmg: 50, eva: 5 };
export const MAX_LEVEL = 80;

/** 장비가 더할 수 있는 **절대 가산량** (실측 — 신화 10칸 최대 굴림. 클래스 무관) */
export const GEAR_ADD = {
  hp: 8998, atk: 1210, def: 1357, res: 720, spd: 68, crit: 26, critDmg: 50, eva: 11,
};
/** 세트 효과(가산 뒤 배율) · 지휘 펫 배율 · 앞으로의 밸런스 변화를 위한 여유 */
export const SLACK = 2.0;

/** 절대 상한 — 배율과 무관하게 이 값을 넘으면 무조건 거절한다 */
export const ABSOLUTE = { hp: 2_000_000, atk: 200_000, def: 200_000, res: 200_000, spd: 100_000, crit: 100, critDmg: 1000, eva: 95 };

/** 맨몸(장비 0) 스탯 — rng 를 쓰지 않으므로 서버가 정확히 계산할 수 있다 */
export function bareStats(classId, level, grade) {
  const c = CLASSES[classId];
  const arch = (c && ARCHETYPES && ARCHETYPES[c.arch]) || FALLBACK_ARCH;
  const mods = (c && c.mods) || {};
  const lv = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1));
  const gi = GRADE_IDX[grade] ?? 0;
  const lvMul = 1 + GROWTH_RATE * (lv - 1);
  const tierMul = TIER_MULT[Math.max(0, Math.min(TIER_MULT.length - 1, ((c && c.tier) || 1) - 1))];
  const gMul = GRADE_MULT[grade] ?? 1;

  const out = {};
  for (const k of SCALING_KEYS) out[k] = (arch[k] || 0) * (mods[k] ?? 1) * lvMul * tierMul * gMul;
  for (const k of FLAT_KEYS) out[k] = (arch[k] || 0) * (mods[k] ?? 1);
  out.crit += gi * 0.8;
  out.eva += gi * 0.5;
  return out;
}

/**
 * 유닛 하나가 «가능한 값» 인가.
 * @returns {string[]} 문제 목록 (비어 있으면 통과)
 */
export function checkUnit(u) {
  const bad = [];
  if (!u || typeof u !== 'object') return ['유닛이 객체가 아니다'];

  const cls = String(u.classId || '');
  if (!CLASSES[cls]) return [`없는 클래스: ${cls}`];

  const lv = Number(u.level);
  if (!Number.isFinite(lv) || lv < 1 || lv > MAX_LEVEL) bad.push(`레벨 ${u.level}`);
  if (!(String(u.grade) in GRADE_MULT)) bad.push(`등급 ${u.grade}`);

  const st = u.stats;
  if (!st || typeof st !== 'object') return [...bad, '스탯이 없다'];

  const base = bareStats(cls, lv, u.grade);
  for (const k of [...SCALING_KEYS, ...FLAT_KEYS]) {
    const v = Number(st[k]);
    if (!Number.isFinite(v)) { bad.push(`${k} 가 숫자가 아니다`); continue; }
    if (v < 0) { bad.push(`${k} 가 음수다 (${v})`); continue; }
    if (ABSOLUTE[k] != null && v > ABSOLUTE[k]) { bad.push(`${k} ${v} 가 절대 상한 ${ABSOLUTE[k]} 을 넘는다`); continue; }
    /* ★ 맨몸 + 장비 최대가산, 그 뒤에 세트·펫 여유 배수 */
    const cap = ((base[k] || 0) + (GEAR_ADD[k] || 0)) * SLACK;
    if (v > cap) {
      bad.push(`${k} ${Math.round(v)} 가 가능한 최대 ${Math.round(cap)} 을 넘는다 (맨몸 ${Math.round(base[k])} + 장비 ${GEAR_ADD[k] || 0})`);
    }
  }
  return bad;
}

/**
 * 등록하려는 부대 전체를 검사한다.
 * @param {Array<Array<object>>} squads
 * @returns {{ok:boolean, bad:string[]}}
 */
export function checkSquads(squads) {
  const bad = [];
  if (!Array.isArray(squads) || !squads.length) return { ok: false, bad: ['부대가 비었다'] };
  squads.forEach((sq, si) => {
    if (!Array.isArray(sq) || !sq.length) { bad.push(`${si + 1}부대가 비었다`); return; }
    sq.forEach((u, ui) => {
      /* 펫은 클래스가 없다 — 이 검사는 용병만 본다 (펫은 별도 상한이 필요하다) */
      if (u && u.pet) return;
      for (const m of checkUnit(u)) bad.push(`${si + 1}부대 ${ui + 1}번(${u?.classId || '?'}): ${m}`);
    });
  });
  return { ok: bad.length === 0, bad: bad.slice(0, 20) };
}
