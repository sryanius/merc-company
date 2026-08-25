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
 *   ⇒ `보고값 ≤ 맨몸 × 실측최대배율 × 여유` 를 넘으면 거절한다.
 *     hp 999999 같은 값은 여기서 전부 걸린다. 미세 조작(+3%)은 못 잡는다 —
 *     그건 다음 단계(원본 재계산)의 몫이다.
 *
 * ★★ 상한은 **게임 자신의 생성기로 만든 최강 빌드**에서 잰다.
 *
 *   처음엔 `rollItem` 으로 무작위 장비를 껴서 쟀다. **그게 틀렸다** — 무작위 아이템은
 *   신화 «세트» 가 성립하지 않아 세트 보너스(가산 + 배율)가 통째로 빠진다.
 *   그 상한으로 배포했더니 **정상 플레이어의 등록이 막혔다** (제작자 실제 편성:
 *   skysplitter_apex atk 8514 / critDmg 278 이 거절됐다). 내가 가장 나쁘다고 적어 둔 실패다.
 *
 *   다시 쟀다 — `rollSetItem` 으로 **전 클래스 × 전 세트**의 풀세트 빌드를 만들어
 *   «맨몸 대비 최대 배율» 을 구했다:
 *
 *     hp ×5.92 · atk ×20.84 · def ×15.31 · res ×8.75 · spd ×3.04 · crit ×8.15 · critDmg ×5.62 · eva ×2.64
 *
 *   (제작자의 critDmg 278 은 `swordsman/bloodoath` 실측 281 과 같은 자리다 — 정상 빌드였다.)
 *
 * ★ 배율로 잡는다. 장비는 고정값을 더하지만 세트는 **배율로** 곱하고, 기본 수치가 낮은
 *   클래스일수록 비율이 커진다 — 그 최악을 이미 포함해 쟀으므로 배율이 안전한 모양이다.
 *   여기에 여유 2배. **정상 플레이어를 막는 쪽이 조작을 놓치는 쪽보다 훨씬 나쁘다.**
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

/** 맨몸 대비 최대 배율 (실측 — 전 클래스 × 전 신화 세트 풀빌드, ilvl 80, 모든 굴림 최대) */
export const MAX_RATIO = {
  hp: 5.92, atk: 20.84, def: 15.31, res: 8.75, spd: 3.04, crit: 8.15, critDmg: 5.62, eva: 2.64,
};
/** 앞으로의 밸런스 변화·펫 배율을 위한 여유 */
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
    /* ★ 맨몸 × 실측 최대배율 × 여유 */
    const cap = (base[k] || 0) * (MAX_RATIO[k] || 1) * SLACK;
    if (base[k] > 0 && v > cap) {
      bad.push(`${k} ${Math.round(v)} 가 가능한 최대 ${Math.round(cap)} 을 넘는다 (맨몸 ${Math.round(base[k])} × ${MAX_RATIO[k]})`);
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
      /* ★ 클래스 id 가 아니라 **용병 이름(클래스명)** 으로 짚어 준다 —
       *   제작자가 자기 단원 중 누구인지 바로 알아야 고칠 수 있다.
       *   (id 는 `skysplitter_apex` 처럼 사람이 못 알아본다) */
      const cls = CLASSES[u?.classId];
      const who = u?.name
        ? `${u.name}(${cls?.name || u?.classId || '?'})`
        : (cls?.name || u?.classId || '?');
      for (const m of checkUnit(u)) bad.push(`${si + 1}부대 ${ui + 1}번 ${who}: ${m}`);
    });
  });
  return { ok: bad.length === 0, bad: bad.slice(0, 20) };
}
