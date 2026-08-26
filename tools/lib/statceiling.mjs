/**
 * 스탯 천장 스윕 — 「게임이 실제로 만들 수 있는 값의 범위」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 이 파일이 따로 있는 이유: **도구와 스모크가 같은 경로를 재야 한다.**
 *
 *   예전엔 스모크가 자기만의 짧은 검사를 갖고 있었다 (S등급 · 레벨 80 · `mercStats` 만).
 *   그래서 실제 등록 경로에 있는 **진형 보정 · 펫 배율 · 낮은 등급**이 통째로 빠졌고,
 *   그 빈틈으로 제작자의 crit 103.215 가 «절대 상한 100» 에 걸려 **등록 자체가 막혔다.**
 *   두 곳이 다른 걸 재면 한 곳이 통과해도 다른 곳이 터진다 — 그래서 하나로 묶는다.
 *
 * ★ 실제 등록 경로(`allyUnitDefs`)와 **같은 순서**로 쌓는다:
 *
 *       mercStats(장비) → withFormation(진형) → applyPetBuff(펫)
 *
 *   그리고 **펫은 선택**이므로 «펫 있음/없음» 두 경우를 다 본다. `applyPetBuff` 는
 *   치명·회피를 깎기 때문에, 펫이 없는 쪽이 오히려 더 높을 수 있다.
 *
 * @module tools/lib/statceiling
 */
import * as Gear from '../../src/game/gear.js';
import { mercStats } from '../../src/game/merc.js';
import { CLASSES, getClass } from '../../src/data/classes.js';
import { FORMATIONS, formationMods } from '../../src/data/formations.js';
import { scaleStats } from '../../src/core/util.js';
import { SET_IDS, setsForArch } from '../../src/data/sets.js';
import { PETS, PETS_PER_SQUAD, PET_GRADE_MULT, PET_TIER_MULT } from '../../src/data/pets.js';

export const KEYS = ['hp', 'atk', 'def', 'res', 'spd', 'crit', 'critDmg', 'eva'];
export const GRADES = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];

/* 모든 굴림을 최대로 — 최강 빌드를 만든다 */
const rngMax = {
  next: () => 0.999999,
  float: (a, b) => b, int: (a, b) => b, chance: () => true,
  pick: (arr) => arr[arr.length - 1], pickMany: (a, n) => a.slice(0, n),
  weighted: (a) => a[a.length - 1], shuffle: (a) => a, range: (a, b) => b,
};

const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 풀세트 장비를 낀 스탯 */
function gearedStats(clsId, setId, grade) {
  const items = {};
  const equipment = {};
  for (const slot of (Gear.SLOTS || [])) {
    let it = null;
    try { it = Gear.rollSetItem({ setId, slot, ilvl: 80, rng: rngMax }); } catch { it = null; }
    if (!it) { try { it = Gear.rollItem({ ilvl: 80, rarity: 5, slot, rng: rngMax }); } catch { it = null; } }
    if (it) { it.id = `x_${slot}`; items[it.id] = it; equipment[slot] = it.id; }
  }
  return mercStats({ uid: 'x', classId: clsId, level: 80, grade, equipment }, items);
}

/**
 * 버퍼 펫이 줄 수 있는 최대 배율.
 * ★ 한 부대에 `PETS_PER_SQUAD` 마리까지 **합산**된다 (`squadPetBuff` 가 더한다) —
 *   «가장 센 한 마리» 가 아니라 «가장 센 한 마리 × 슬롯 수» 가 천장이다.
 */
export function maxPetBuff() {
  const out = {};
  for (const sp of Object.values(PETS || {})) {
    if (!sp || sp.role !== 'buffer') continue;
    const tm = PET_TIER_MULT[clampTo((sp.tier || 1) - 1, 0, PET_TIER_MULT.length - 1)] || 1;
    const gm = Math.max(...Object.values(PET_GRADE_MULT));
    for (const [k, v] of Object.entries((sp.ability && sp.ability.buff) || {})) {
      const got = v * tm * gm * PETS_PER_SQUAD;
      if (!out[k] || got > out[k]) out[k] = got;
    }
  }
  return out;
}

/**
 * 판이 제대로 차려졌는지 먼저 본다.
 * ★★ 이 게이트가 없으면 «장비가 안 붙은 맨몸» 을 최강 빌드로 착각한 채 상한을 낸다 —
 *   실제로 그렇게 해서 정상 플레이어를 막은 적이 있다 (§68.1).
 * @returns {string[]} 문제 목록 (비면 통과)
 */
export function gates() {
  const bad = [];
  if (!SET_IDS.length) bad.push('세트 목록을 못 읽었다');

  const bare = mercStats({ uid: 'b', classId: 'archmage_apex', level: 80, grade: 'S', equipment: {} }, {});
  const probe = gearedStats('archmage_apex', 'starseeker', 'S');
  const mult = probe.atk / Math.max(1, bare.atk);
  if (!(mult >= 3)) bad.push(`장비가 안 붙었다 (${mult.toFixed(2)}x)`);

  let moved = false;
  for (const fid of Object.keys(FORMATIONS)) {
    for (let si = 0; si < 7; si++) {
      const mods = formationMods(fid, si, { arch: 'archer', classId: 'archer' });
      if (mods && Object.keys(mods).length) { moved = true; break; }
    }
    if (moved) break;
  }
  if (!moved) bad.push('진형 보정이 하나도 안 나온다');

  if (!Object.keys(maxPetBuff()).length) bad.push('버퍼 펫 배율을 하나도 못 읽었다');
  return bad;
}

/**
 * 전 클래스 × 착용 가능 세트 × 전 진형 × 전 슬롯 × 전 등급을 돌며
 * «게임이 만들 수 있는 유닛» 을 만들어 낸다.
 *
 * @param {(u:object)=>string[]} [check] 유닛 하나를 검사하는 함수 (보통 `checkUnit`)
 * @param {{classIds?:string[]}} [opts]
 * @returns {{tested:number, rejects:string[], best:object, ratio:object, petBest:object}}
 */
export function sweep(check = null, opts = {}) {
  const petBest = maxPetBuff();
  const classIds = opts.classIds || Object.keys(CLASSES).filter((id) => CLASSES[id] && CLASSES[id].id);
  const best = {};
  const ratio = {};
  const rejects = [];
  let tested = 0;

  /* 비율은 «맨몸 대비» 다 — 서버의 맨몸 계산을 그대로 쓴다 (있으면) */
  const bareOf = opts.bareStats;

  for (const clsId of classIds) {
    const cls = getClass(clsId) || {};
    /* ★ 세트에는 계열 제한이 있다 — 못 입는 세트를 끼우면 조용히 «맨몸 + 잡템» 이 된다 */
    let wearable = SET_IDS;
    try {
      const w = setsForArch(cls.arch);
      if (Array.isArray(w) && w.length) wearable = w.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
    } catch { /* 전부 돈다 */ }

    for (const setId of wearable) {
      /* ★ 등급을 전부 돈다. 치명처럼 장비가 **고정값을 더하는** 스탯은
       *   맨몸이 작을수록 배율이 커진다 — 최악은 언제나 최저 등급 쪽에 있다.
       *   S 만 재면 이 구멍이 안 보인다. */
      for (const grade of GRADES) {
        let st;
        try { st = gearedStats(clsId, setId, grade); } catch { continue; }
        const bs = bareOf ? bareOf(clsId, 80, grade) : null;

        for (const fid of Object.keys(FORMATIONS)) {
          for (let si = 0; si < 7; si++) {
            let mods;
            try { mods = formationMods(fid, si, { arch: cls.arch, classId: clsId }); } catch { continue; }
            const s2 = mods && Object.keys(mods).length ? scaleStats(st, mods) : st;

            /* 펫 있음 / 없음 두 갈래 — `applyPetBuff` 의 깎기까지 그대로 흉내 낸다 */
            const withPet = {};
            const noPet = {};
            for (const k of KEYS) {
              noPet[k] = Number(s2[k]) || 0;
              withPet[k] = noPet[k] * (1 + (petBest[k] || 0));
            }
            withPet.crit = clampTo(withPet.crit, 0, 100);
            withPet.eva = clampTo(withPet.eva, 0, 75);

            for (const stats of [withPet, noPet]) {
              tested++;
              const where = `${clsId}/${setId}/${fid}#${si} ${grade}등급`;
              for (const k of KEYS) {
                if (!best[k] || stats[k] > best[k].v) best[k] = { v: stats[k], who: where };
                if (bs && bs[k] > 0) {
                  const r = stats[k] / bs[k];
                  if (!ratio[k] || r > ratio[k].r) ratio[k] = { r, who: where };
                }
              }
              if (check) {
                const bad = check({ classId: clsId, level: 80, grade, stats });
                if (bad && bad.length) rejects.push(`${where}: ${bad[0]}`);
              }
            }
          }
        }
      }
    }
  }
  return { tested, rejects, best, ratio, petBest };
}
