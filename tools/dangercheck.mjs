/**
 * 난이도 색이 실제 승률을 맞히는가
 * ────────────────────────────────────────────────────────────────
 * 의뢰 카드의 색은 이제 **실제 전투를 돌려 본 승률**로 정한다
 * (`src/game/forecast.js`). 이 도구는 그게 정말 맞는지 재확인한다.
 *
 * ★ 이 도구는 예전에 두 가지로 거짓말을 했다. 둘 다 고쳤다:
 *
 *   1. **경계를 손으로 베껴 적어 뒀다.** 게임 쪽 경계를 고치면 도구는 옛 경계로
 *      채점했다. 지금은 `forecast.js` 에서 import 한다 — 사본이 없다.
 *   2. **표본이 20판이고 시드가 산술수열(9001+i*7919)이었다.**
 *      그 조합이 거울전(같은 부대끼리) 승률을 80% 로 보고했다.
 *      잘 섞은 시드로 2000판을 돌리면 50.0% 다. 전환 구간에서는
 *      n=20 의 95% 신뢰구간이 ±22%p 라 아무것도 판정할 수 없었다.
 *
 * 실행: node tools/dangercheck.mjs [--n=200] [--grade=A] [--level=80]
 * 종료 코드: 예보가 실제와 어긋나면 1
 */
import * as State from '../src/game/state.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { genQuests, questBattleDefs, applyWaveCarry, readWaveCarry } from '../src/game/quest.js';
import { forecastQuest, dangerLevelByWinRate, BANDS, DEFAULT_SAMPLES } from '../src/game/forecast.js';
import { RNG } from '../src/core/rng.js';

setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '200'), 10);

/* ★ 부대 하나로만 재면 아무것도 검사하지 못한다.
 *   A등급 Lv80 은 모든 도시의 의뢰를 100% 로 이겨서 전부 「식은 죽 먹기」로 나온다.
 *   밴드가 실제로 갈리는 지점을 지나가야 검증이 된다 — 그래서 부대를 훑는다. */
const SQUADS = [
  ['F', 20], ['E', 30], ['D', 40], ['C', 50], ['B', 60], ['A', 70], ['S', 80],
];

const LABEL = ['-', '식은 죽 먹기', '여유', '적정', '위험', '무모'];
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

/** 잘 섞은 시드 (splitmix32). 산술수열은 xorshift 와 상관이 생긴다. */
function mixSeed(i) {
  let z = (i + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return ((z ^ (z >>> 15)) >>> 0) || 1;
}

/**
 * 의뢰 하나의 **참 승률**. 예보(표본 5판)와 달리 시드를 훨씬 많이 굴린다.
 * 예보가 이 값을 얼마나 잘 맞히는지가 이 도구의 질문이다.
 */
function trueWinRate(st, quest, squadId, n) {
  let win = 0;
  for (let i = 0; i < n; i++) {
    let carry = null;
    let ok = true;
    for (let w = 0; w < quest.waves.length; w++) {
      const cfg = questBattleDefs(quest, w, st, squadId);
      const allies = applyWaveCarry(cfg.allies, carry);
      if (!allies.length) { ok = false; break; }
      const b = createBattle({ ...cfg, allies, seed: mixSeed((cfg.seed >>> 0) + i * 1013904223) });
      b.run();
      if (!b.finished || b.result.winner !== 'ally') { ok = false; break; }
      carry = readWaveCarry(b.units, carry || {});
    }
    if (ok) win++;
  }
  return win / n;
}

/** 95% 신뢰구간 반폭 */
const ci95 = (p, n) => 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);

console.log(`난이도 색 검증 — 예보(${DEFAULT_SAMPLES}판)가 참 승률(${N}판)을 맞히는가`);
console.log('='.repeat(78));
console.log('\n색 기준 (game/forecast.js — 유일한 출처)');
for (const b of BANDS) console.log(`  승률 ${String(b.min).padStart(5)} 이상 → ${LABEL[b.level]}`);

/* ── 1. 예보가 참 승률을 맞히는가 ──
 * 부대 강도를 훑어 밴드 5개를 전부 지나가게 한다. */
console.log('\n── 1. 예보 vs 실제');
console.log('  부대       의뢰                  웨  예보         참승률(95%CI)      맞나');

const CITIES = [['greenhold', 30], ['kingsrest', 60], ['elderoak', 120], ['deepdelve', 200], ['frostgate', 300]];
const rows = [];
const seen = new Map();          // 밴드별 검사 건수 — 다 지나갔는지 확인용

for (const [grade, level] of SQUADS) {
  const st = mkState(grade, level);
  const sqId = st.squads[0].id;
  for (const [city, day] of CITIES) {
    for (const q of genQuests(city, day, new RNG(1000 + day), 1)) {
      const fc = forecastQuest(st, q, sqId);
      if (!fc.ok) continue;
      const truth = trueWinRate(st, q, sqId, N);
      const half = ci95(truth, N);
      const wantLv = dangerLevelByWinRate(truth);
      seen.set(wantLv, (seen.get(wantLv) || 0) + 1);
      /* 예보는 표본 5판이라 참값과 한 칸 어긋날 수 있다 — 그건 정상이다.
       * 문제로 치는 건 **두 칸 이상** 어긋나거나, 이긴다/진다가 뒤집힌 경우다. */
      const flipped = (truth >= 0.5) !== (fc.winRate >= 0.5);
      const bad = Math.abs(fc.level - wantLv) >= 2 || (flipped && Math.abs(truth - 0.5) > half + 0.1);
      rows.push({ tag: `${grade}Lv${level}`, id: q.id, fc, truth, bad, wantLv });
      if (bad || fc.level !== wantLv) {
        console.log(`  ${`${grade}Lv${level}`.padEnd(9)} ${q.id.slice(0, 20).padEnd(20)} ${String(q.waves.length).padStart(2)}  ${LABEL[fc.level].padEnd(11)} ${(truth * 100).toFixed(1).padStart(5)}%±${(half * 100).toFixed(1).padStart(4)} → ${LABEL[wantLv].padEnd(11)} ${bad ? '✗' : '~'}`);
      }
    }
  }
}
console.log(`  (같은 색이면 안 찍는다 — ${rows.length}건 중 ${rows.filter((r) => r.fc.level !== r.wantLv).length}건만 어긋남, 그중 ✗ 는 두 칸 이상)`);
console.log('\n  밴드별 검사 건수:');
for (let l = 1; l <= 5; l++) console.log(`    ${LABEL[l].padEnd(11)} ${seen.get(l) || 0}건${seen.get(l) ? '' : '  ← 이 색은 검사되지 않았다'}`);

/* ── 2. 거울전 — 도구 자신이 편향돼 있지 않은가 ──
 * 같은 부대끼리는 정확히 50% 여야 한다. 여기가 틀어지면 위의 숫자를 믿을 수 없다. */
console.log(`\n── 2. 자기 검사: 같은 부대끼리 (${N * 4}판)`);
{
  const a = mkState('B', 60, 1000);
  const q = genQuests('greenhold', 30, new RNG(1030), 1)[0];
  const units = questBattleDefs(q, 0, a, a.squads[0].id).allies.map((u) => ({ ...u }));
  let win = 0;
  const n = N * 4;
  for (let i = 0; i < n; i++) {
    const b = createBattle({
      allies: units.map((u) => ({ ...u })),
      enemies: units.map((u, k) => ({ ...u, uid: `e_${k}`, side: 'enemy', slotIndex: k })),
      allyFormationId: 'basic', enemyFormationId: 'basic', seed: mixSeed(i),
    });
    b.run();
    if (b.result.winner === 'ally') win++;
  }
  const wr = win / n;
  const half = ci95(wr, n);
  const fair = Math.abs(wr - 0.5) <= half + 0.02;
  console.log(`  거울전 승률 ${(wr * 100).toFixed(1)}% ±${(half * 100).toFixed(1)}  ${fair ? '✓ 공평' : '✗ 편향 — 아래 숫자를 믿지 마라'}`);
  if (!fair) rows.push({ id: '거울전', bad: true });
}

/* ── 결론 ── */
console.log('\n' + '─'.repeat(78));
const wrong = rows.filter((r) => r.bad);
if (!wrong.length) {
  console.log(`✅ 예보가 실제 승률과 어긋나는 의뢰가 없다 (${rows.length}건 검사).`);
  process.exit(0);
}
console.log(`❌ 어긋난 의뢰 ${wrong.length}건 / ${rows.length}건:`);
for (const r of wrong) {
  if (!r.fc) { console.log(`   ${r.id}`); continue; }
  console.log(`   ${r.id} — 화면은 「${LABEL[r.fc.level]}」(${r.fc.wins}/${r.fc.samples}) 인데 실제 ${(r.truth * 100).toFixed(1)}% → 「${LABEL[r.wantLv]}」`);
}
process.exit(1);
