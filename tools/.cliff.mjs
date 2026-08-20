/**
 * 임시 계측기 — "전투력비 → 승률" 절벽의 폭을 0.01 단위로 잰다.
 * 끝나면 삭제한다.
 *
 * 방법
 *  1) 실제 게임 경로(questBattleDefs)로 부대 하나를 만들고 **즉시 값으로 꺼낸다**
 *     (State.state 는 싱글턴이므로 두 번 만들면 둘 다 마지막 것을 가리킨다).
 *  2) 그 부대를 양쪽에 그대로 써서 완전한 거울 대결을 만든다 (m=1 → 전투력비 정확히 1.000).
 *  3) 적 쪽 SCALING 스탯(hp/atk/def/res/spd)에만 배율 m 을 곱한다.
 *     — 레벨(lvMul)·등급(gMul)이 스탯에 작용하는 방식과 **같은 축**이다.
 *  4) mercPower 는 스탯의 1차식이므로 목표 전투력비 r 을 정확히 맞추는 m 을 닫힌 식으로 푼다.
 *        power(m) = m*scal + flat,  m = (allyPower/r - flat)/scal
 */
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import * as Gear from '../src/game/gear.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { setSkillResolver, simulate } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Abyss from '../src/game/abyss.js';
import { questBattleDefs } from '../src/game/quest.js';

setSkillResolver(getSkill);   // ★ 빼먹으면 스킬이 전부 사라져 수치가 통째로 틀린다

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N_FINE = parseInt(arg('n', '300'), 10);
const N_COARSE = 40;
const ONLY = arg('only', '');

/* mercPower 계수 (merc.js mercPower 와 같은 값 — 저기를 고치면 여기도 고쳐야 한다) */
const PW = { hp: 0.14, atk: 2.6, def: 1.5, res: 1.3, spd: 1.6, crit: 2.2, critDmg: 0.5, eva: 1.8 };
const SCAL = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT = ['crit', 'critDmg', 'eva'];

/* ── 편성 정의 ───────────────────────────────────────────────── */
const T3 = { tank: 'gatewarden', fighter: 'madgeneral', lancer: 'dragoonlord', rogue: 'shadowarcher', archer: 'masterarcher', mage: 'archmage', healer: 'highpriest', mage2: 'stormcaller' };
const T2 = { tank: 'knight', fighter: 'berserker', lancer: 'dragoon', rogue: 'assassin', archer: 'sniper', mage: 'elementalist', healer: 'priest', mage2: 'necromancer' };

const comp = (T, kind, n) => {
  if (n === 7) {
    if (kind === 'nohealer') return [T.tank, T.fighter, T.lancer, T.rogue, T.archer, T.mage, T.mage2];
    return [T.tank, T.fighter, T.lancer, T.rogue, T.archer, T.mage, T.healer];
  }
  if (n === 5) return [T.tank, T.fighter, T.rogue, T.mage, T.healer];
  return [T.tank, T.mage, T.healer];
};
const SLOTS_OF = { 7: [0, 1, 2, 3, 4, 5, 6], 5: [0, 1, 3, 5, 6], 3: [0, 3, 5] };

/* ── 부대 생성 ───────────────────────────────────────────────── */
function setup(classes, slots, level, grade, seed, equip) {
  State.newGame(seed, `c${seed}`);
  const st = State.state;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  classes.forEach((classId, i) => {
    if (!getClass(classId)) throw new Error(`클래스 없음: ${classId}`);
    const m = {
      uid: `u_${i}`, name: getClass(classId).name, classId, level, grade,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    };
    st.roster.push(m);
    sq.memberUids[slots[i]] = m.uid;
  });
  if (equip) {
    // 레벨에 맞는 장비를 넉넉히 굴려 실제 자동착용 경로로 입힌다 (10칸 x 인원 x 여유 3배)
    for (let i = 0; i < classes.length * 30; i++) {
      const it = State.rollLoot({ ilvl: level, rarityBonus: 0.3 });
      if (it) st.items.push(it);
    }
    Gear.autoEquipAll(st, { squadId: sq.id });
  }
  for (const m of st.roster) m.hp = 0;
  return st;
}

/** ★ 만든 직후에 UnitDef 를 값으로 꺼내 둔다 (싱글턴 함정) */
function build(cfg) {
  const st = setup(cfg.classes, cfg.slots, cfg.level, cfg.grade, cfg.seed, cfg.equip);
  const sqId = st.squads[0].id;
  const allies = questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies;
  const units = allies.map((u) => ({ ...u, stats: { ...u.stats } }));
  const idx = State.itemsById(st.items);
  const rosterPower = st.roster.reduce((a, m) => a + Merc.mercPower(m, { items: idx }), 0);
  let scal = 0; let flat = 0;
  for (const u of units) {
    for (const k of SCAL) scal += (u.stats[k] || 0) * PW[k];
    for (const k of FLAT) flat += (u.stats[k] || 0) * PW[k];
  }
  const worn = st.roster.reduce((a, m) => a + Object.values(m.equipment || {}).filter(Boolean).length, 0);
  return { units, rosterPower, scal, flat, power: scal + flat, n: units.length, worn };
}

const scaleUnits = (units, m) => units.map((u) => {
  const s = { ...u.stats };
  for (const k of SCAL) s[k] = (s[k] || 0) * m;
  return { ...u, stats: s, hp: Math.max(1, Math.round(s.hp)) };
});

const mForRatio = (S, r) => (S.power / r - S.flat) / S.scal;

/** 승률 + 전투시간 (시드만 바꿔 n 판) */
function duel(allyUnits, enemyUnits, n, seed0 = 9001) {
  let win = 0; let draw = 0; let tsum = 0; let tmax = 0;
  const times = [];
  for (let i = 0; i < n; i++) {
    const res = simulate({
      allies: allyUnits.map((u) => ({ ...u, stats: { ...u.stats } })),
      enemies: enemyUnits.map((u, k) => ({ ...u, stats: { ...u.stats }, uid: `e_${k}`, side: 'enemy' })),
      allyFormationId: 'basic', enemyFormationId: 'basic',
      seed: (seed0 + i * 7919) >>> 0,
    });
    if (res.winner === 'ally') win++;
    else if (res.winner === 'draw') draw++;
    tsum += res.time; times.push(res.time);
    if (res.time > tmax) tmax = res.time;
  }
  times.sort((a, b) => a - b);
  return { wr: win / n, draw: draw / n, tAvg: tsum / n, tMed: times[Math.floor(n / 2)], tMax: tmax };
}

/* ── 설정 목록 ───────────────────────────────────────────────── */
const CONFIGS = [
  { key: 'A 기준', label: '7v7 · 힐러O · Lv80 · 장비X', n: 7, kind: 'heal', level: 80, T: T3, equip: false },
  { key: 'B 인원5', label: '5v5 · 힐러O · Lv80 · 장비X', n: 5, kind: 'heal', level: 80, T: T3, equip: false },
  { key: 'C 인원3', label: '3v3 · 힐러O · Lv80 · 장비X', n: 3, kind: 'heal', level: 80, T: T3, equip: false },
  { key: 'D 힐러X', label: '7v7 · 전부딜러 · Lv80 · 장비X', n: 7, kind: 'nohealer', level: 80, T: T3, equip: false },
  { key: 'E Lv50', label: '7v7 · 힐러O · Lv50 · 장비X', n: 7, kind: 'heal', level: 50, T: T3, equip: false },
  { key: 'F Lv20', label: '7v7 · 힐러O · Lv20 · 장비X', n: 7, kind: 'heal', level: 20, T: T2, equip: false },
  { key: 'G 장비O', label: '7v7 · 힐러O · Lv80 · 장비O', n: 7, kind: 'heal', level: 80, T: T3, equip: true },
  { key: 'H 장비O저렙', label: '7v7 · 힐러O · Lv20 · 장비O', n: 7, kind: 'heal', level: 20, T: T2, equip: true },
];

const round2 = (x) => Math.round(x * 100) / 100;

console.log(`전투력비 → 승률 절벽 정량화   (미세 스윕 0.01 단위 · 각 지점 ${N_FINE}판)`);
console.log('='.repeat(96));

const summary = [];
for (const C of CONFIGS) {
  if (ONLY && !C.key.startsWith(ONLY)) continue;
  const S = build({
    classes: comp(C.T, C.kind, C.n), slots: SLOTS_OF[C.n].slice(0, C.n),
    level: C.level, grade: 'B', seed: 1000, equip: C.equip,
  });
  process.stderr.write(`\n[${C.key}] ${C.label}  power=${Math.round(S.power)} (roster ${S.rosterPower}, 착용 ${S.worn}칸)\n`);

  /* 1) 거친 스윕으로 전환 구간을 찾는다 */
  let lo = 0.50; let hi = 2.00;
  const coarse = [];
  for (let r = 0.50; r <= 2.001; r += 0.05) {
    const rr = round2(r);
    const d = duel(S.units, scaleUnits(S.units, mForRatio(S, rr)), N_COARSE);
    coarse.push({ r: rr, wr: d.wr });
  }
  for (const c of coarse) { if (c.wr <= 0.02) lo = c.r; }
  for (let i = coarse.length - 1; i >= 0; i--) { if (coarse[i].wr >= 0.98) hi = coarse[i].r; }
  const from = Math.max(0.30, round2(lo - 0.06));
  const to = Math.min(3.00, round2(hi + 0.06));

  /* 2) 0.01 단위 미세 스윕 */
  const fine = [];
  for (let r = from; r <= to + 1e-9; r += 0.01) {
    const rr = round2(r);
    const d = duel(S.units, scaleUnits(S.units, mForRatio(S, rr)), N_FINE);
    fine.push({ r: rr, ...d });
  }
  const firstAtLeast = (arr, p) => (arr.find((f) => f.wr >= p) || null);
  const f10 = firstAtLeast(fine, 0.10);
  const f50 = firstAtLeast(fine, 0.50);
  const f90 = firstAtLeast(fine, 0.90);
  const mixed = fine.filter((f) => f.wr > 0 && f.wr < 1);
  const width = f10 && f90 ? round2(f90.r - f10.r) : null;

  console.log(`\n── [${C.key}] ${C.label}`);
  console.log(`   부대 전투력 ${Math.round(S.power)} · 인원 ${S.n} · 착용 ${S.worn}칸`);
  console.log('   전투력비  승률    (300판)          평균전투(초)  중앙값');
  for (const f of fine) {
    if (f.wr === 0 && f.r < (f10 ? f10.r : 99) - 0.03) continue;
    if (f.wr === 1 && f.r > (f90 ? f90.r : -99) + 0.03) continue;
    const bar = '█'.repeat(Math.round(f.wr * 24)).padEnd(24, '·');
    console.log(`     ${f.r.toFixed(2)}   ${(f.wr * 100).toFixed(1).padStart(5)}%  ${bar}  ${f.tAvg.toFixed(1).padStart(5)}   ${f.tMed.toFixed(1).padStart(5)}`);
  }
  console.log(`   → [0.01 격자] 10% 지점 ${f10 ? f10.r.toFixed(2) : '-'} · 50% 지점 ${f50 ? f50.r.toFixed(2) : '-'} · 90% 지점 ${f90 ? f90.r.toFixed(2) : '-'}`);
  console.log(`   → [0.01 격자] 10~90% 폭 = ${width != null ? width.toFixed(2) : '-'} · 승패가 갈리는(0<승률<100) 구간 폭 = ${round2(mixed.length * 0.01).toFixed(2)}`);

  /* 2b) 0.01 은 절벽보다 굵다 — 0.002 단위로 다시 훑어 실제 폭을 잡는다 */
  const uFrom = Math.max(0.30, (f10 ? f10.r : 0.95) - 0.02);
  const uTo = (f90 ? f90.r : 1.05) + 0.02;
  const ultra = [];
  for (let r = uFrom; r <= uTo + 1e-9; r += 0.002) {
    const rr = Math.round(r * 1000) / 1000;
    const d = duel(S.units, scaleUnits(S.units, mForRatio(S, rr)), Math.max(N_FINE, 400));
    ultra.push({ r: rr, ...d });
  }
  /** 승률 p 를 지나는 지점을 선형보간 */
  const cross = (p) => {
    for (let i = 1; i < ultra.length; i++) {
      if (ultra[i - 1].wr < p && ultra[i].wr >= p) {
        const a = ultra[i - 1]; const b = ultra[i];
        return a.r + (p - a.wr) * (b.r - a.r) / (b.wr - a.wr);
      }
    }
    return null;
  };
  const u10 = cross(0.10); const u50 = cross(0.50); const u90 = cross(0.90);
  const uWidth = (u10 != null && u90 != null) ? u90 - u10 : null;
  console.log('   [0.002 단위 정밀]');
  for (const f of ultra) {
    if (f.wr === 0 && f.r < (u10 ?? 99) - 0.006) continue;
    if (f.wr === 1 && f.r > (u90 ?? -99) + 0.006) continue;
    const bar = '█'.repeat(Math.round(f.wr * 24)).padEnd(24, '·');
    console.log(`     ${f.r.toFixed(3)}  ${(f.wr * 100).toFixed(1).padStart(5)}%  ${bar}  ${f.tAvg.toFixed(1).padStart(5)}초`);
  }
  console.log(`   → [정밀] 10% ${u10 != null ? u10.toFixed(4) : '-'} · 50% ${u50 != null ? u50.toFixed(4) : '-'} · 90% ${u90 != null ? u90.toFixed(4) : '-'}`);
  console.log(`   → [정밀] 10~90% 폭 = ${uWidth != null ? uWidth.toFixed(4) : '-'}  (= 전투력 ${uWidth != null ? (uWidth * 100).toFixed(2) : '-'}%p)`);

  /* 3) 시드 분산 — 50% 지점에서 1000판, 100판씩 10묶음의 편차 */
  let seedVar = null;
  if (u50 != null) {
    const en = scaleUnits(S.units, mForRatio(S, u50));
    const batches = [];
    for (let b = 0; b < 10; b++) batches.push(duel(S.units, en, 100, 20000 + b * 131071).wr);
    const mean = batches.reduce((a, b) => a + b, 0) / batches.length;
    const sd = Math.sqrt(batches.reduce((a, b) => a + (b - mean) ** 2, 0) / batches.length);
    seedVar = { r: u50, mean, sd, min: Math.min(...batches), max: Math.max(...batches), batches };
    console.log(`   → 시드분산: 비율 ${u50.toFixed(4)} 고정, 100판 묶음 10개 → 평균 ${(mean * 100).toFixed(1)}% · 표준편차 ${(sd * 100).toFixed(1)}%p · 최소 ${(seedVar.min * 100).toFixed(0)}% / 최대 ${(seedVar.max * 100).toFixed(0)}%`);
  }

  /* 4) 전투 길이 — 거울(1.00) 기준 */
  const mirror = duel(S.units, S.units, 400, 555);
  console.log(`   → 거울(1.00) 승률 ${(mirror.wr * 100).toFixed(1)}% · 평균 전투 ${mirror.tAvg.toFixed(1)}초 · 중앙 ${mirror.tMed.toFixed(1)}초 · 최장 ${mirror.tMax.toFixed(1)}초`);

  summary.push({
    key: C.key, label: C.label, power: Math.round(S.power), n: S.n,
    r10: u10, r50: u50, r90: u90, gridWidth: width,
    width: uWidth, mixedWidth: round2(mixed.length * 0.01),
    uMixedWidth: Math.round(ultra.filter((f) => f.wr > 0 && f.wr < 1).length * 0.002 * 1000) / 1000,
    tMirror: round2(mirror.tAvg), tMed: round2(mirror.tMed), wrMirror: round2(mirror.wr),
    seedSd: seedVar ? round2(seedVar.sd * 100) : null,
    seedMin: seedVar ? Math.round(seedVar.min * 100) : null,
    seedMax: seedVar ? Math.round(seedVar.max * 100) : null,
  });
}

/* ── 종합표 ─────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(96));
console.log('종합');
console.log('  설정                            전투력   10%비    50%비    90%비   10~90폭  갈림폭  거울승률 거울전투(초) 시드SD');
for (const s of summary) {
  console.log(`  ${s.label.padEnd(28)} ${String(s.power).padStart(7)}  ${(s.r10 ?? 0).toFixed(4)}  ${(s.r50 ?? 0).toFixed(4)}  ${(s.r90 ?? 0).toFixed(4)}  ${(s.width ?? 0).toFixed(4)}  ${(s.uMixedWidth ?? 0).toFixed(3)}   ${((s.wrMirror ?? 0) * 100).toFixed(0).padStart(3)}%   ${s.tMirror.toFixed(1).padStart(5)}      ${(s.seedSd ?? 0).toFixed(1)}%p`);
}

/* 전투길이 vs 절벽폭 상관 */
if (summary.length >= 3) {
  const xs = summary.map((s) => s.tMirror);
  const ys = summary.map((s) => s.width);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  const rho = num / Math.sqrt(dx * dy);
  console.log(`\n  전투길이(거울 평균초) vs 10~90% 폭  피어슨 r = ${rho.toFixed(3)}   (n=${xs.length})`);
  console.log('   ' + summary.map((s) => `${s.tMirror.toFixed(0)}s→${(s.width ?? 0).toFixed(2)}`).join('  '));
}
