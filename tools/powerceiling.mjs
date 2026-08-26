/**
 * 부대 전력의 천장 실측 — 「순위표의 전력이 가능한 값인가」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 생겼나: 순위표 부대 전력 1위에 **게임이 만들 수 없는 값**이 올라왔다.
 *   `숨단` — 1일차 · 의뢰 1건 · 최고레벨 37 인데 전력 259,803.
 *   실측 천장은 190,470 이다. 통과한 이유는 `POWER_CAP` 이 **5,000,000** 이었기 때문이고,
 *   그 상한 바로 위 주석에는 「실측 74,148」 이라 적혀 있었다 — **재 놓고 안 쓴 것**이다.
 *
 * ★ 그래서 이 도구가 낸 표를 `rules.js` 가 그대로 쓴다. 손으로 «커 보이는 수» 를 안 적는다.
 *   §94(등록 상한)에서 같은 실수를 세 번 하고 배운 방식이다.
 *
 * ★★ 재는 방법은 **클라이언트의 `squadPower` 와 같아야 한다.**
 *     · 부대는 7칸, 각 칸에 `mercPower(merc, items)`
 *     · 진형 보정은 `squadPower` 가 쓰는 **같은 근사식**
 *     · **진형은 부대 전체가 하나다.** 칸마다 다른 진형을 고르면 실제보다 높게 나온다
 *       (처음에 그렇게 재서 193,211 이 나왔고, 고치니 190,470 이었다)
 *     · 펫은 안 센다 — `squadPower` 가 안 센다
 *
 * 사용: node tools/powerceiling.mjs [비교할값]
 */
import * as Gear from '../src/game/gear.js';
import { mercStats, mercPower } from '../src/game/merc.js';
import { CLASSES, getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { SET_IDS, setsForArch } from '../src/data/sets.js';
import { FORMATIONS, formationMods } from '../src/data/formations.js';
import { MAX_LEVEL } from '../src/data/limits.js';

/* 모든 굴림을 최대로 — 최강 빌드를 만든다 */
const rngMax = {
  next: () => 0.999999, float: (a, b) => b, int: (a, b) => b, chance: () => true,
  pick: (a) => a[a.length - 1], pickMany: (a, n) => a.slice(0, n),
  weighted: (a) => a[a.length - 1], shuffle: (a) => a, range: (a, b) => b,
};

export const SQUAD_SLOTS = 7;
/** 표를 뜨는 레벨 지점 (사이는 선형 보간한다) */
export const LEVEL_STOPS = [1, 10, 20, 30, 40, 50, 60, 70, 80];

/**
 * 장비 한 벌을 입힌 스탯.
 * @param {'set'|'unique'} style 세트 풀장착 / 무작위 신화(고유 포함)
 */
function equip(clsId, setId, level, grade, style) {
  const items = {}; const equipment = {};
  for (const slot of (Gear.SLOTS || [])) {
    let it = null;
    if (style === 'set') {
      try { it = Gear.rollSetItem({ setId, slot, ilvl: 80, rng: rngMax }); } catch { it = null; }
    }
    /* ★ 고유(unique) 쪽도 재야 한다 — 세트만 재면 «세트가 최강» 이라는 가정이 검사에 박힌다.
     *   `chance: () => true` 라 UNIQUE_CHANCE 가 항상 터진다. */
    if (!it) { try { it = Gear.rollItem({ ilvl: 80, rarity: Gear.RARITY_MYTHIC, slot, rng: rngMax }); } catch { it = null; } }
    if (it) { it.id = `x_${slot}`; items[it.id] = it; equipment[slot] = it.id; }
  }
  return { m: { uid: 'x', classId: clsId, level, grade, equipment }, items };
}

/** `squadPower` 가 쓰는 진형 근사식과 **같은 식** */
function formMul(fid, i, unit) {
  const mods = formationMods(fid, i, unit) || {};
  const keys = Object.keys(mods);
  if (!keys.length) return 1;
  return 1 + keys.reduce((a, k) => a + mods[k], 0) / (keys.length * 2);
}

const classIds = Object.keys(CLASSES).filter((id) => CLASSES[id] && CLASSES[id].id);

/**
 * 판이 차려졌는지 먼저 본다.
 * ★★ 이게 없으면 «장비가 안 붙은 맨몸» 을 최강으로 착각한 채 천장을 낸다 — 실제로 겪었다.
 */
export function gates() {
  const bad = [];
  if (!SET_IDS.length) bad.push('세트 목록을 못 읽었다');
  if (!classIds.length) bad.push('클래스를 못 읽었다');
  const bare = mercPower({ uid: 'b', classId: 'archmage_apex', level: 80, grade: 'S', equipment: {} }, {});
  const { m, items } = equip('archmage_apex', 'starseeker', 80, 'S', 'set');
  const mult = mercPower(m, items) / Math.max(1, bare);
  if (!(mult >= 3)) bad.push(`장비가 안 붙었다 (전력 ${mult.toFixed(2)}x)`);
  /* 스탯 쪽도 같이 본다 — 전력만 보면 가중치가 이상해도 안 걸린다 */
  const bs = mercStats({ uid: 'b', classId: 'archmage_apex', level: 80, grade: 'S', equipment: {} }, {});
  if (!(mercStats(m, items).atk / bs.atk >= 3)) bad.push('장비가 스탯에 안 붙었다');
  let moved = false;
  for (const fid of Object.keys(FORMATIONS)) {
    for (let i = 0; i < SQUAD_SLOTS; i++) if (formMul(fid, i, { arch: 'archer', classId: 'archer' }) !== 1) { moved = true; break; }
    if (moved) break;
  }
  if (!moved) bad.push('진형 보정이 하나도 안 나온다');
  return bad;
}

/**
 * 이 레벨·등급에서 부대 하나가 낼 수 있는 최대 전력.
 * @returns {{total:number, fid:string, top:{v:number, who:string}}}
 */
export function ceilingAt(level, grade = 'S') {
  /* 클래스·세트·빌드별 전력을 **한 번만** 계산해 둔다 (칸마다 다시 만들면 12배 느리다) */
  const pool = [];
  for (const clsId of classIds) {
    const cls = getClass(clsId) || {};
    let wearable = SET_IDS;
    try {
      const w = setsForArch(cls.arch);
      if (Array.isArray(w) && w.length) wearable = w.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
    } catch { /* 전부 */ }
    const seen = new Set();
    for (const style of ['set', 'unique']) {
      for (const setId of (style === 'set' ? wearable : [null])) {
        const key = `${style}:${setId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let p;
        try { const { m, items } = equip(clsId, setId, level, grade, style); p = mercPower(m, items); } catch { continue; }
        if (p > 0) pool.push({ p, arch: cls.arch, classId: clsId, who: `${clsId}/${setId || '고유'}` });
      }
    }
  }
  if (!pool.length) return { total: 0, fid: '', top: { v: 0, who: '' } };

  let best = { total: 0, fid: '', top: { v: 0, who: '' } };
  for (const fid of Object.keys(FORMATIONS)) {
    let total = 0; let top = { v: 0, who: '' };
    for (let i = 0; i < SQUAD_SLOTS; i++) {
      let bs = { v: 0, who: '' };
      for (const c of pool) {
        const v = c.p * formMul(fid, i, { arch: c.arch, classId: c.classId });
        if (v > bs.v) bs = { v, who: c.who };
      }
      total += bs.v;
      if (bs.v > top.v) top = bs;
    }
    if (total > best.total) best = { total, fid, top };
  }
  return { total: Math.round(best.total), fid: best.fid, top: best.top };
}

/** 레벨 지점별 천장 표 */
export function ceilingTable(grade = 'S') {
  return LEVEL_STOPS.map((lv) => ({ lv, ...ceilingAt(lv, grade) }));
}

/* ── 직접 실행할 때만 출력 ─────────────────────────────────────── */
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const bad = gates();
  if (bad.length) { for (const b of bad) console.log(`✗ ${b} — 멈춘다`); process.exit(1); }

  const REPORT = Number(process.argv[2] || 0);
  const tbl = ceilingTable('S');

  console.log('레벨별 부대 전력 천장 (7칸 · 전원 S · 최강 조합 · 진형 하나 고정)');
  console.log('');
  console.log(' Lv    천장        진형        최강 한 명');
  for (const r of tbl) {
    console.log(`${String(r.lv).padStart(3)}  ${r.total.toLocaleString().padStart(9)}   ${r.fid.padEnd(10)}  ${r.who || r.top.who}`);
  }

  const top = tbl[tbl.length - 1].total;
  console.log('');
  console.log(`만렙 천장 ${top.toLocaleString()}`);
  console.log('');
  console.log('rules.js 에 넣을 표:');
  console.log(`export const POWER_BY_LEVEL = [${tbl.map((r) => r.total).join(', ')}];`);
  console.log(`export const POWER_LEVEL_STOPS = [${LEVEL_STOPS.join(', ')}];`);

  if (REPORT > 0) {
    console.log('');
    for (const r of tbl) {
      if (r.lv % 10 && r.lv !== 1) continue;
      const x = REPORT / r.total;
      if (x > 1) console.log(`  신고값 ${REPORT.toLocaleString()} 은 Lv${r.lv} 천장의 ${x.toFixed(2)}배`);
    }
  }
  console.log('');
  console.log(`(레벨 상한 ${MAX_LEVEL})`);
}
