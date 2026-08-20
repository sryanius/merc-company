/**
 * 손실(margin)이 승패보다 매끈한가
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 이 도구가 답하는 질문 하나:
 *
 *     "이진 승패를 부분 승·부분 패로 바꾸면, 플레이어가 보는 양이 실제로 완만해지나?"
 *
 *   이 게임의 전투는 사실상 이진이다. 승률 100%→0% 가 전투력비 0.025 안에서 끝난다
 *   (docs/HANDOFF.md §24). 그래서 난이도 색을 정직하게 고쳐도
 *   「이긴다」/「진다」 둘밖에 안 나온다 — 실측 175건에서 중간 색이 1건뿐이었다.
 *
 *   풀려면 승패를 연속량으로 바꿔야 하는데(잔여 인원·잔여 체력으로 부분 보상),
 *   그건 던전/탑/나락 인계·보상·랭킹까지 건드리는 큰 변경이고 DATA_VERSION 이 올라간다.
 *   **착수하기 전에 그게 정말 효과가 있는지 먼저 재는 것**이 이 도구의 목적이다.
 *
 * ★ 판정 기준: 손실의 전이 폭이 승패의 전이 폭보다 **2배 이상** 넓어야 한다.
 *   그보다 좁으면 연속량으로 바꿔도 여전히 계단이라 큰 공사를 할 값어치가 없다.
 *   (조사 보고서는 거울전에서 2.2배를 봤다. 여기서는 **실제 의뢰 경로**로 확인한다 —
 *    거울전은 아군 편성이 양쪽 다 같아서 실전과 다를 수 있다.)
 *
 * ★ 전투는 안 건드린다. `result.margin` 은 engine.js 가 기록만 해 둔 값이라
 *   rng 소비가 안 늘고 기존 측정치가 전부 유효하다.
 *
 * 실행: node tools/margin.mjs [--n=120]
 * 종료 코드: 손실이 승패보다 2배 넓지 않으면 1 (= C안을 착수하지 마라)
 */
import * as State from '../src/game/state.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { genQuests, questBattleDefs, applyWaveCarry, readWaveCarry } from '../src/game/quest.js';
import { RNG } from '../src/core/rng.js';

setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '120'), 10);

const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function mkState(grade, level, seed = 4242) {
  State.newGame(seed, `${grade}${level}`);
  const st = State.state;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    st.roster.push({
      uid: `d_${i}`, name: getClass(classId).name, classId, level, grade,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    });
    sq.memberUids[i] = `d_${i}`;
  });
  return st;
}

/** 잘 섞은 시드 — 산술수열은 xorshift 와 상관이 생긴다 (§24.3) */
function mixSeed(i) {
  let z = (i + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return ((z ^ (z >>> 15)) >>> 0) || 1;
}

/** 적 스탯을 연속으로 조절한다 — 레벨·등급은 정수라 전이 구간을 훑을 수 없다 */
const scaleEnemies = (defs, m) => defs.map((u) => ({
  ...u,
  stats: {
    ...u.stats,
    hp: u.stats.hp * m, atk: u.stats.atk * m,
    def: u.stats.def * m, res: u.stats.res * m, spd: u.stats.spd * m,
  },
}));

/**
 * 의뢰 하나를 끝까지 돌리고 **승패와 "얼마나 온전히 끝냈나"** 를 같이 돌려준다.
 *
 * ★ score 정의 (0 = 1웨이브에서 전멸, 1 = 무손실 완주):
 *
 *     score = (넘긴 웨이브 수 + 마지막 전투에서 남은 아군 전력) / 전체 웨이브 수
 *
 *   처음에는 마지막 전투의 `margin.score` 만 봤는데 **비단조**가 나왔다 —
 *   2웨이브에서 진 판이 1웨이브에서 진 판보다 낮게 찍혔다.
 *   어디까지 갔는지가 빠져 있었기 때문이다. 진행도를 넣어야 뜻이 통한다.
 *
 *   "남은 전력" 은 인원과 체력을 반씩 본다 — 7명이 다 살았지만 빈사인 것과
 *   4명이 멀쩡한 것을 같게 볼 수 없다 (engine.js margin 과 같은 정의).
 */
function runQuest(st, quest, squadId, mult, sampleIndex) {
  const total = quest.waves.length;
  let carry = null;
  for (let w = 0; w < total; w++) {
    const cfg = questBattleDefs(quest, w, st, squadId);
    const allies = applyWaveCarry(cfg.allies, carry);
    if (!allies.length) return { win: false, score: w / total };
    const b = createBattle({
      ...cfg,
      allies,
      enemies: scaleEnemies(cfg.enemies, mult),
      seed: mixSeed((cfg.seed >>> 0) + sampleIndex * 1013904223),
    });
    b.run();
    const m = b.result.margin;
    const allyLeft = m && m.allyCount > 0
      ? 0.5 * (m.allyAlive / m.allyCount) + 0.5 * m.allyHp
      : 0;
    if (!b.finished || b.result.winner !== 'ally') {
      return { win: false, score: (w + allyLeft) / total };
    }
    if (w === total - 1) return { win: true, score: (w + allyLeft) / total };
    carry = readWaveCarry(b.units, carry || {});
  }
  return { win: true, score: 1 };
}

/**
 * 값 v(전투력비 대신 배율)에 대해 y 가 hi → lo 로 넘어가는 폭.
 * 격자 위에서 선형 보간으로 교차점을 찾는다.
 */
function transitionWidth(pts, key, hi, lo) {
  const cross = (target) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const ya = a[key];
      const yb = b[key];
      if ((ya - target) * (yb - target) <= 0 && ya !== yb) {
        return a.m + (b.m - a.m) * ((target - ya) / (yb - ya));
      }
    }
    return null;
  };
  const mHi = cross(hi);
  const mLo = cross(lo);
  if (mHi == null || mLo == null) return null;
  return { from: mHi, to: mLo, width: Math.abs(mLo - mHi) };
}

console.log(`손실이 승패보다 매끈한가 — 실제 의뢰 경로 · 지점당 ${N}판`);
console.log('='.repeat(78));
console.log(`
질문: 이진 승패를 부분 승·부분 패로 바꾸면 플레이어가 보는 양이 완만해지나?
판정: 손실(score)의 전이 폭이 승패(win)의 전이 폭보다 **2배 이상** 이어야 착수 가치가 있다.
`);

const st = mkState('A', 80);
const sqId = st.squads[0].id;

/* 웨이브 수가 다른 의뢰를 골라 본다 — 인계가 있는 쪽이 더 완만할 수 있다 */
const pool = [];
for (const [city, day] of [['greenhold', 30], ['elderoak', 120], ['frostgate', 300]]) {
  for (const q of genQuests(city, day, new RNG(2000 + day), 1)) pool.push(q);
}
/* ★ 웨이브 수마다 **여러 건** 본다. 한 건만 보면 그 의뢰의 우연을 설계 판단으로 착각한다
 *   (처음에 3웨이브 1건만 보고 1.63배가 나와 하마터면 착수를 접을 뻔했다 — 집계 버그였다). */
const PER_SHAPE = parseInt(arg('per', '2'), 10);
const targets = [];
for (const nw of [1, 2, 3]) {
  targets.push(...pool.filter((q) => q.waves.length === nw).slice(0, PER_SHAPE));
}

const ratios = [];
for (const quest of targets) {
  console.log(`\n── ${quest.id} (웨이브 ${quest.waves.length})`);

  /* 1단계: 승패가 뒤집히는 배율을 굵게 찾는다 */
  let loM = 1;
  let hiM = 1;
  for (let m = 1; m <= 4096; m *= 2) {
    let w = 0;
    for (let i = 0; i < 8; i++) if (runQuest(st, quest, sqId, m, i).win) w++;
    if (w === 0) { hiM = m; loM = m / 2; break; }
  }

  /* 2단계: 그 구간을 촘촘히 훑는다 */
  const pts = [];
  const steps = 26;
  for (let k = 0; k <= steps; k++) {
    const m = loM * (hiM / loM) ** (k / steps);
    let wins = 0;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const r = runQuest(st, quest, sqId, m, i);
      if (r.win) wins++;
      sum += r.score;
    }
    pts.push({ m, win: wins / N, score: sum / N });
  }

  console.log('  적배율     승률   온전도(0=1웨전멸 · 1=무손실완주)');
  for (const p of pts) {
    const bar = '█'.repeat(Math.round(p.score * 20)).padEnd(20, '·');
    console.log(`  ${p.m.toFixed(3).padStart(8)}  ${(p.win * 100).toFixed(0).padStart(4)}%  ${p.score.toFixed(3).padStart(6)}  ${bar}`);
  }

  // 승패: 90% → 10% / 손실: 같은 높이의 상대 구간(전체 폭의 90%→10%)
  const wT = transitionWidth(pts, 'win', 0.9, 0.1);
  const sMax = Math.max(...pts.map((p) => p.score));
  const sMin = Math.min(...pts.map((p) => p.score));
  const sT = transitionWidth(pts, 'score', sMin + (sMax - sMin) * 0.9, sMin + (sMax - sMin) * 0.1);

  if (!wT || !sT) { console.log('  (전이 구간을 못 찾았다 — 격자를 넓혀야 한다)'); continue; }
  const ratio = sT.width / wT.width;
  ratios.push(ratio);
  console.log(`\n  승패 전이 폭   배율 ${wT.from.toFixed(3)} → ${wT.to.toFixed(3)}  = ${wT.width.toFixed(4)}`);
  console.log(`  손실 전이 폭   배율 ${sT.from.toFixed(3)} → ${sT.to.toFixed(3)}  = ${sT.width.toFixed(4)}`);
  console.log(`  → 손실이 ${ratio.toFixed(2)}배 넓다`);
}

console.log('\n' + '─'.repeat(78));
if (!ratios.length) {
  console.log('❌ 아무것도 재지 못했다.');
  process.exit(1);
}
/* ★ 평균이 아니라 **최악**을 본다.
 *   설계는 모든 의뢰 모양에서 통해야 한다. 한 의뢰가 15배 넓다고
 *   3웨이브 의뢰가 1.6배인 걸 덮을 수는 없다 — 플레이어는 그 의뢰도 본다. */
const worst = Math.min(...ratios);
const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
console.log(`손실이 승패보다 넓은 배수 — 의뢰별 ${ratios.map((r) => r.toFixed(2)).join(' / ')}`);
console.log(`  최악 ${worst.toFixed(2)}배 · 평균 ${avg.toFixed(2)}배`);
if (worst >= 2) {
  console.log('\n✅ 착수할 값어치가 있다. 어떤 의뢰 모양에서도 손실이 2배 이상 완만하다.');
  process.exit(0);
}
console.log(`
❌ 최악이 ${worst.toFixed(2)}배로 2배에 못 미친다.`);
console.log('   웨이브가 많은 의뢰에서 특히 좁다 — 인계 때문에 앞 웨이브 손실이 뒤로 누적돼');
console.log('   결국 "한 웨이브라도 못 넘으면 끝" 이 되기 때문이다.');
console.log('   → 전투만 고쳐서는 부족하다. 게임 구조(중도 후퇴 · 부대 여러 개 · 재도전)를 같이 봐라.');
process.exit(1);
