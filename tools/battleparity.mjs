/**
 * 「서버가 재현한 전투 == 클라가 실제로 한 전투」 를 **잰다** (§152 ②의 0번 관문)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 이게 먼저인가. ②단계는 「서버가 전투를 다시 돌려 승패를 대조한다」 다.
 *   그런데 서버가 낸 답이 클라와 **다르면**, 정직한 승리가 전부 «졌는데 이겼다고
 *   신고» 로 찍힌다. 그 상태로 판정을 켜면 정상 플레이어가 통째로 걸린다 (§94).
 *
 * ★★★ **서버 경로를 그대로 흉내낸다** — 이게 이 도구의 전부다:
 *   · 클라 상태를 `toRows` → `fromRows` 로 **왕복**시킨다 (서버가 가진 것이 그것이다)
 *   · `questBattleDefs` 를 그 왕복본으로 부른다
 *   · ★ `getSkill` 을 **설정에 직접 싣는다** — 서버에는 UI 부팅이 없어서
 *     전역 `setSkillResolver` 가 안 불린다. 빼먹으면 스킬이 통째로 사라져 승률이
 *     완전히 달라진다 (`runverify.js` 가 같은 자리에서 겪었다).
 *
 * 실행: node tools/battleparity.mjs [--n=40]
 * 종료 코드: 승패가 하나라도 갈리면 1
 */
import * as State from '../src/game/state.js';
import * as Quest from '../src/game/quest.js';
import { questBattleDefs, applyWaveCarry, readWaveCarry } from '../src/game/questbattle.js';
import { toRows, fromRows } from '../src/game/runrows.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';

/* 클라 쪽은 게임처럼 전역 해석기를 쓴다 (UI 부팅이 하는 일) */
setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '40'), 10);

const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function mkState(seed, level, grade) {
  State.newGame(seed, '전투대조단');
  const st = State.state;
  st.roster = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    st.roster.push({
      uid: `d_${i}`, name: getClass(classId).name, classId, level, grade,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0, hiredDay: 1,
    });
    sq.memberUids[i] = `d_${i}`;
  });
  /* 장비를 실제로 끼운다 — 세트·무기 타입이 정의에 섞이는 경로다 */
  for (let k = 0; k < 14; k++) { const it = State.rollLoot({ ilvl: level, rarityBonus: 0 }); if (it) st.items.push(it); }
  try {
    const Gear = State;
    for (const m of st.roster) { if (typeof Gear.autoEquipAll === 'function') Gear.autoEquipAll(st, m); }
  } catch (e) { /* 자동 착용이 없으면 맨몸으로 간다 */ }
  return st;
}

/** 의뢰 하나를 끝까지 — `useServerCopy` 면 서버가 가진 왕복본으로 정의를 만든다 */
function play(st, quest, squadId, useServerCopy) {
  const defs = useServerCopy ? fromRows(JSON.parse(JSON.stringify(toRows(st)))) : st;
  let carry = null;
  let waves = 0;
  for (let w = 0; w < quest.waves.length; w++) {
    const cfg = questBattleDefs(quest, w, defs, squadId);
    const allies = applyWaveCarry(cfg.allies, carry);
    if (!allies.length) return { win: false, waves };
    /* ★ 서버 경로는 getSkill 을 설정으로 싣는다 (전역이 없다) */
    const b = createBattle(useServerCopy ? { ...cfg, allies, getSkill } : { ...cfg, allies });
    b.run();
    waves++;
    if (b.result.winner !== 'ally') return { win: false, waves, time: b.result.time };
    if (w < quest.waves.length - 1) carry = readWaveCarry(b.units, carry || {});
  }
  return { win: true, waves };
}

console.log(`서버가 재현한 전투 == 클라가 한 전투 — 의뢰 ${N}건`);
console.log('='.repeat(74));

const cases = [];
for (const [city, day] of [['greenhold', 30], ['elderoak', 120], ['frostgate', 300]]) {
  for (const [level, grade] of [[80, 'A'], [45, 'B'], [20, 'D']]) {
    cases.push({ city, day, level, grade });
  }
}

let n = 0;
let same = 0;
let wins = 0;
const diff = [];
for (const c of cases) {
  const st = mkState(5150 + c.day * 7 + c.level, c.level, c.grade);
  st.day = c.day; st.cityId = c.city; st.quests = {};
  State.refreshCity(c.city, true);
  const list = ((st.quests[c.city] || {}).list || []).slice(0, Math.ceil(N / cases.length));
  const sqId = st.squads[0].id;
  for (const q of list) {
    const cli = play(st, q, sqId, false);
    const srv = play(st, q, sqId, true);
    n++;
    if (cli.win) wins++;
    if (cli.win === srv.win && cli.waves === srv.waves) same++;
    else diff.push(`${c.city} ${q.rankLabel} ${c.grade}${c.level}: 클라 ${cli.win ? '승' : '패'}(${cli.waves}) vs 서버 ${srv.win ? '승' : '패'}(${srv.waves})`);
  }
}

console.log(`돌린 의뢰 ${n}건 · 클라가 이긴 것 ${wins}건`);
console.log(`  일치 ${same} / ${n}  (${n ? (100 * same / n).toFixed(1) : 0}%)`);
if (diff.length) for (const d of diff.slice(0, 8)) console.log(`      · ${d}`);

console.log('-'.repeat(74));
let fails = 0;
const need = (c, m) => { if (!c) { fails++; console.log(`  ✗ ${m}`); } else console.log(`  ✓ ${m}`); };
need(n >= 15, `판이 실하다 (${n}건)`);
need(wins >= 5 && wins < n, `승패가 섞여 있다 (승 ${wins} / ${n}) — 전부 같으면 아무것도 증명 못 한다`);
need(diff.length === 0, `서버 재현이 클라와 **완전히 일치**한다 (다른 것 ${diff.length}건)`);

/* ★★ 메타 — `getSkill` 을 빼면 실제로 갈리나. 이걸 안 보이면 위 «일치» 가
 *   «검사가 아무것도 안 본다» 와 구별되지 않는다 (runverify 가 겪은 그 사고다). */
{
  const st = mkState(777, 45, 'B');
  st.day = 120; st.cityId = 'elderoak'; st.quests = {};
  State.refreshCity('elderoak', true);
  const q = ((st.quests.elderoak || {}).list || [])[0];
  const sqId = st.squads[0].id;
  if (q) {
    const defs = fromRows(JSON.parse(JSON.stringify(toRows(st))));
    const cfg = questBattleDefs(q, 0, defs, sqId);
    const withSkill = createBattle({ ...cfg, getSkill });
    withSkill.run();
    /* ★★ **전역 해석기를 꺼야 한다.** 이 도구는 클라 경로를 위해 setSkillResolver 를
     *   켜 뒀는데, 그러면 cfg.getSkill 을 null 로 줘도 엔진이 **전역으로 넘어간다** —
     *   그래서 처음엔 이 메타가 «안 갈린다» 고 나왔다. 서버에는 그 전역이 없다.
     *   판을 서버와 같게 만들어야 이 검사가 뜻을 갖는다. */
    setSkillResolver(null);
    const noSkill = createBattle({ ...cfg, getSkill: null });
    noSkill.run();
    setSkillResolver(getSkill);
    const differs = JSON.stringify(withSkill.result) !== JSON.stringify(noSkill.result);
    need(differs, '메타 — getSkill 을 빼면 결과가 실제로 갈린다 (그래서 반드시 실어야 한다)');
  }
}

console.log('='.repeat(74));
console.log(fails ? `❌ ${fails}건` : '✅ 서버 재현이 클라와 같은 승패를 낸다');
process.exit(fails ? 1 : 0);
