/**
 * 등급 격차 계측기 — F부대 vs S부대
 * ────────────────────────────────────────────────────────────────
 * "같은 레벨·같은 클래스·같은 장비인데 등급만 다르면 얼마나 차이 나나"에 답한다.
 *
 * ★ 스탯 배율(GRADE_MULT)만 보면 안 된다. F 0.78 / S 1.55 라 표로는 2배지만,
 *   전투는 공격력·방어력·체력이 **동시에** 곱해지므로 실제 승패 차이는 그보다 크다.
 *   그래서 배율·전투력·맞대결 승률·나락 도달을 따로 잰다.
 *
 * ★ 아군 편성을 직접 조립하지 않는다. 실제 게임 경로(합성 의뢰 → questBattleDefs)를
 *   그대로 탄다 — 자체 조립기가 세트 고유효과를 빠뜨린 사고가 있었다(9차 세션).
 *
 * 실행: node tools/gradegap.mjs [--n=12] [--level=60]
 */
import * as State from '../src/game/state.js';
import * as Abyss from '../src/game/abyss.js';
import * as Merc from '../src/game/merc.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { questBattleDefs } from '../src/game/quest.js';
import { RNG } from '../src/core/rng.js';

setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '12'), 10);
const LEVEL = parseInt(arg('level', '60'), 10);

// 아키타입이 겹치지 않는 3차 표준 부대 (중후반 기준)
const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

/** 등급만 다른 부대를 만든다. 장비는 양쪽 다 없음 — 등급 효과만 보려는 것이다. */
function setup(grade, seed = 4242, level = LEVEL) {
  State.newGame(seed, `${grade}부대`);
  const st = State.state;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    const cls = getClass(classId);
    if (!cls) throw new Error(`클래스 ${classId} 없음`);
    const m = {
      uid: `g_${grade}_${i}`, name: `${cls.name}(${grade})`, classId, level, grade,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    };
    m.upkeep = Merc.upkeepOf(m);
    st.roster.push(m);
    sq.memberUids[i] = m.uid;
  });
  for (const m of st.roster) m.hp = 0;
  return st;
}

/** 부대 전투력 합 (mercPower 는 게임이 위험도 표시에 쓰는 것과 같은 값) */
function squadPower(st) {
  const idx = State.itemsById(st.items);
  let sum = 0;
  for (const m of st.roster) sum += Merc.mercPower(m, { items: idx });
  return Math.round(sum);
}

/** 부대 스탯 합 */
function squadStats(st) {
  const idx = State.itemsById(st.items);
  const t = { hp: 0, atk: 0, def: 0, res: 0, spd: 0 };
  for (const m of st.roster) {
    const s = Merc.mercStats(m, { items: idx });
    for (const k of Object.keys(t)) t[k] += s[k] || 0;
  }
  for (const k of Object.keys(t)) t[k] = Math.round(t[k]);
  return t;
}

console.log(`등급 격차 — 같은 3차 클래스 7인 · Lv${LEVEL} · 장비 없음`);
console.log('='.repeat(76));

/* ── 1. 표에 적힌 값 ── */
console.log('\n── 1. 상수');
console.log(`  스탯 배율   F ${Merc.GRADE_MULT.F} / S ${Merc.GRADE_MULT.S}  → ${(Merc.GRADE_MULT.S / Merc.GRADE_MULT.F).toFixed(2)}배`);
console.log(`  일당(계수)  F ${Merc.GRADE_UPKEEP.F} / S ${Merc.GRADE_UPKEEP.S}  → ${(Merc.GRADE_UPKEEP.S / Merc.GRADE_UPKEEP.F).toFixed(1)}배`);
console.log(`  고용비      F ${Merc.GRADE_HIRE_COST.F} / S ${Merc.GRADE_HIRE_COST.S}  → ${(Merc.GRADE_HIRE_COST.S / Merc.GRADE_HIRE_COST.F).toFixed(1)}배`);

/* ── 2. 실제 스탯·전투력·임금 ── */
console.log('\n── 2. 부대 실측 (7인 합계)');
const rows = [];
for (const g of Merc.GRADES) {
  const st = setup(g);
  rows.push({
    g,
    stats: squadStats(st),
    power: squadPower(st),
    upkeep: State.dailyUpkeep(st),
  });
}
console.log('  등급   체력     공격    방어   전투력    일임금');
for (const r of rows) {
  console.log(`   ${r.g}   ${String(r.stats.hp).padStart(6)}  ${String(r.stats.atk).padStart(6)}  ${String(r.stats.def).padStart(5)}  ${String(r.power).padStart(7)}  ${String(r.upkeep).padStart(7)}G`);
}
const f = rows[0];
const s = rows[rows.length - 1];
console.log(`\n  F → S  체력 ${(s.stats.hp / f.stats.hp).toFixed(2)}배 · 공격 ${(s.stats.atk / f.stats.atk).toFixed(2)}배`
  + ` · 전투력 ${(s.power / f.power).toFixed(2)}배 · 임금 ${(s.upkeep / f.upkeep).toFixed(2)}배`);

/* ── 2b. 등급 한 칸은 레벨 몇 개짜리인가 ──
 * ★ 이 게임에서 가장 중요한 성장 축이 무엇인지 정하는 값이다.
 *   등급은 바꿀 수 없고(고용으로만 얻는다) 레벨은 시간으로 오르므로,
 *   "등급 한 칸 = 레벨 N" 을 알면 S 를 사는 값어치가 정해진다. */
console.log('\n── 2b. 등급 한 칸 ≈ 레벨 몇 개?');
{
  const powAt = (grade, level) => {
    const st = setup(grade, 5, level);
    return squadPower(st);
  };
  const base = powAt('F', LEVEL);
  const per10 = powAt('F', Math.min(80, LEVEL + 10)) / base;      // 10레벨당 배율
  const steps = Merc.GRADES.length - 1;
  const perGrade = (Merc.GRADE_MULT.S / Merc.GRADE_MULT.F) ** (1 / steps);
  const lvPerGrade = (Math.log(perGrade) / Math.log(per10)) * 10;
  console.log(`  등급 한 칸  ×${perGrade.toFixed(3)}   (F→S 6칸 = ×${(Merc.GRADE_MULT.S / Merc.GRADE_MULT.F).toFixed(2)})`);
  console.log(`  레벨 10개   ×${per10.toFixed(3)}`);
  console.log(`  → 등급 한 칸 ≈ 레벨 ${lvPerGrade.toFixed(0)}개 · F→S 는 레벨 ${(lvPerGrade * steps).toFixed(0)}개어치`);
  console.log(`  ※ 레벨 상한이 80 이므로 F 부대는 레벨만으로 S 부대를 **따라잡을 수 없다.**`);
}

/* ── 3. 맞대결 ──
 * ★ 등급 차이가 실제 승패로 얼마나 벌어지는지는 이걸로만 알 수 있다.
 *   스탯이 2배라고 승률이 2배가 되는 게 아니다 — 공·방·체가 동시에 곱해진다. */
console.log('\n── 3. 맞대결 승률 (F부대 기준, 각 ' + N + '판)');

function duel(gA, gB, n, lvA = LEVEL, lvB = LEVEL) {
  const stA = setup(gA, 1000, lvA);
  const alliesA = questBattleDefs(Abyss.abyssQuest(stA, 1, stA.squads[0].id), 0, stA, stA.squads[0].id).allies;
  const stB = setup(gB, 2000, lvB);
  const alliesB = questBattleDefs(Abyss.abyssQuest(stB, 1, stB.squads[0].id), 0, stB, stB.squads[0].id).allies;

  let winA = 0;
  for (let i = 0; i < n; i++) {
    const enemies = alliesB.map((u, k) => ({
      ...u, uid: `e_${k}`, side: 'enemy', slotIndex: k,
    }));
    const b = createBattle({
      allies: alliesA.map((u) => ({ ...u })),
      enemies,
      allyFormationId: 'basic',
      enemyFormationId: 'basic',
      seed: (12345 + i * 7919) >>> 0,
    });
    let t = 0;
    while (!b.finished && t < 90) { b.step(1 / 60); t += 1 / 60; }
    if (b.result.winner === 'ally') winA++;
  }
  return winA / n;
}

for (const g of Merc.GRADES) {
  const r = duel('F', g, N);
  const bar = '█'.repeat(Math.round(r * 20)).padEnd(20, '·');
  console.log(`  F vs ${g}   ${bar} ${(r * 100).toFixed(0)}%`);
}

/* ── 3b. 인접 등급끼리 — 한 칸 차이가 얼마나 큰가 ── */
console.log(`
── 3b. 인접 등급 맞대결 (왼쪽 기준, 각 ${N}판)`);
for (let i = 0; i < Merc.GRADES.length - 1; i++) {
  const lo = Merc.GRADES[i];
  const hi = Merc.GRADES[i + 1];
  const r = duel(lo, hi, N);
  console.log(`  ${lo} vs ${hi}   ${(r * 100).toFixed(0)}%  (한 칸 차이)`);
}

/* ── 3c. 레벨로 등급을 메울 수 있나 ──
 * ★ 이게 실전에서 가장 중요한 질문이다. S 는 고용비 67배·임금 11배인데,
 *   F 를 몇 레벨 더 키우면 따라잡히는지가 그 값어치를 정한다. */
console.log(`
── 3c. F부대가 S부대(Lv${LEVEL})와 맞먹으려면? (F 레벨을 올려 가며)`);
let found = 0;
for (const lv of [LEVEL, LEVEL + 10, LEVEL + 20, LEVEL + 30, 80]) {
  if (lv > 80) break;
  const r = duel('F', 'S', N, lv, LEVEL);
  const mark = r >= 0.45 && r <= 0.55 ? '  ← 호각' : '';
  console.log(`  F Lv${String(lv).padStart(2)} vs S Lv${LEVEL}   ${(r * 100).toFixed(0)}%${mark}`);
  if (!found && r >= 0.45) found = lv;
}
console.log(found
  ? `  → F 가 S 를 따라잡으려면 약 **+${found - LEVEL}레벨** 이 필요하다`
  : `  → 80레벨(상한)까지 올려도 S(Lv${LEVEL})를 못 따라잡는다`);

/* ── 4. 나락 도달 (등급이 실제 진행에 주는 차이) ── */
console.log('\n── 4. 황금 나락 도달 심층 (잠수 3회 평균)');
for (const g of ['F', 'C', 'S']) {
  const st = setup(g, 777);
  const sq = st.squads[0];
  const got = [];
  for (let i = 0; i < 3; i++) {
    st.day = 1 + i * 337;
    st.abyss = { best: 0, bestDay: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0 };
    st.gold = 0;
    const r = Abyss.dive(st, sq.id, { force: true });
    got.push(r.reached);
  }
  const avg = got.reduce((a, b) => a + b, 0) / got.length;
  console.log(`   ${g}   ${avg.toFixed(1)}심층  (${got.join(', ')})`);
}
