/**
 * 「의뢰 전투를 서버가 다시 돌리면 얼마나 드나」 — 설계 전에 잰다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 렌더링은 안 잰다. 서버는 **판정만** 한다 (`b.run()` — 그림은 없다).
 *   `tools/perf-battle.js` 는 브라우저 래스터 비용을 재는 다른 도구다.
 *
 * ★ 재는 것: 웨이브 하나 · 의뢰 하나(웨이브 1~3) · 그리고 **결정론**
 *   (같은 시드로 두 번 돌리면 같은 결과인가 — 이게 아니면 서버 재현 자체가 불가능하다).
 *
 * 실행: node tools/battlecost.mjs [--n=30]
 */
import * as State from '../src/game/state.js';
import * as Quest from '../src/game/quest.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';

setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '30'), 10);

const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function mkState(seed, level) {
  State.newGame(seed, '전투비용');
  const st = State.state;
  st.roster = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    st.roster.push({
      uid: `d_${i}`, name: getClass(classId).name, classId, level, grade: 'A',
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0, hiredDay: 1,
    });
    sq.memberUids[i] = `d_${i}`;
  });
  return st;
}

const st = mkState(9090, 60);
const sqId = st.squads[0].id;

/* 여러 도시·날에서 의뢰를 모은다 — 웨이브 수가 골고루 나오게 */
const pool = [];
for (const [city, day] of [['greenhold', 30], ['elderoak', 120], ['frostgate', 300]]) {
  st.day = day; st.cityId = city; st.quests = {};
  State.refreshCity(city, true);
  for (const q of (st.quests[city] || {}).list || []) pool.push(q);
}

console.log(`서버가 의뢰 전투를 다시 돌리는 비용 — 의뢰 ${pool.length}건 중 ${N}건`);
console.log('='.repeat(74));

/** 의뢰 하나를 끝까지 돌린다 (웨이브 인계 포함) — 서버가 할 일 그대로 */
function runQuest(quest) {
  let carry = null;
  let waves = 0;
  for (let w = 0; w < quest.waves.length; w++) {
    const cfg = Quest.questBattleDefs(quest, w, st, sqId);
    const allies = Quest.applyWaveCarry(cfg.allies, carry);
    if (!allies.length) break;
    const b = createBattle({ ...cfg, allies });
    b.run();
    waves++;
    if (b.result.winner !== 'ally') return { waves, win: false, last: b.result };
    if (w < quest.waves.length - 1) carry = Quest.readWaveCarry(b.units, carry || {});
  }
  return { waves, win: true };
}

const picked = pool.slice(0, N);
/* 워밍업 */
runQuest(picked[0]);

let totalMs = 0;
let totalWaves = 0;
const per = [];
for (const q of picked) {
  const t0 = process.hrtime.bigint();
  const r = runQuest(q);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  totalMs += ms; totalWaves += r.waves;
  per.push({ rank: q.rankLabel, waves: r.waves, ms: Math.round(ms * 10) / 10, win: r.win });
}
per.sort((a, b) => b.ms - a.ms);

console.log(`의뢰 ${picked.length}건 · 웨이브 ${totalWaves}개 · 합계 ${Math.round(totalMs)}ms`);
console.log(`  의뢰 하나 평균  ${(totalMs / picked.length).toFixed(1)} ms`);
console.log(`  웨이브 하나 평균 ${(totalMs / totalWaves).toFixed(1)} ms`);
console.log(`  가장 무거운 의뢰 ${per[0].ms} ms (${per[0].rank} · 웨이브 ${per[0].waves})`);
console.log('');

/* ★★ 결정론 — 이게 아니면 서버 재현이 원리적으로 불가능하다 */
const a = runQuest(picked[1]);
const b2 = runQuest(picked[1]);
const same = JSON.stringify(a) === JSON.stringify(b2);
console.log(`결정론: 같은 의뢰를 두 번 돌리면 ${same ? '**같다**' : '다르다 (재현 불가!)'}`);

console.log('='.repeat(74));
const avg = totalMs / picked.length;
console.log(`⇒ 서버 예산 2,500ms 안에 의뢰 약 ${Math.floor(2500 / avg)}건을 다시 돌릴 수 있다.`);
process.exit(same ? 0 : 1);
