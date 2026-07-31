// 초반 게임이 실제로 클리어 가능한지 + 파견(원정) 시스템이 의도대로 굴러가는지 검사한다.
//
// ── 파견 모델 (2026-07-28 변경) ──
// 의뢰를 끝내도 날짜는 흐르지 않는다. 전투/보상은 즉시, 부대만 `quest.days` 만큼 `away` 로 잠긴다.
// 날짜는 플레이어가 직접 넘긴다. 그래서 부대가 여러 개면 같은 날 여러 의뢰를 돌 수 있다.
// 이 스크립트도 **절대 `advanceDays(q.days)` 를 부르지 않는다** — 실제 루프와 똑같이
// "출정 → 부대 잠김 → 다른 부대로 또 출정 → 없으면 날짜를 넘긴다" 를 돌린다.
//
// 재는 것:
//   A. 랭크별 1회 의뢰 성적 (승률/전사/전투시간)
//   B. 파견 루프 — F랭크 의뢰 10회를 실제 루프대로 (출전 불가/부상/골드 추이)
//   C. 역경 시나리오 — 계속 지는 상황에서 회복 루프가 도는가
//   D. ★ 부대 1개 vs 2개 — 30일 운용 비교. 이번 변경의 목적이 실제로 달성됐는가
//   E. 경제 — 30일 골드 추이 / 레벨업 속도 / 임금 비중
//   F. ★ 의뢰 공급 — 부대 1/2/3/5개일 때 부대-일 유휴율 (5부대 15% 미만이 목표)
//   G. ★ 평판 잠금 — 낯선 도시(평판 0)에 도착해 주점을 여는 데 며칠 걸리나
//
// ※ 실제 게임(ui/battle.js)과 조건을 맞춘다:
//    - setSkillResolver(getSkill) 를 등록한다. 이걸 빼면 스킬이 전부 무시되고
//      기본공격만 나가는, 게임과 다른 전투를 재게 된다.
//    - 웨이브 간 HP를 인계하고 WAVE_HEAL 만큼 회복시킨다.
//    - 전리품은 autoEquipAll 로 배분한다 (전투 결과 화면의 "획득 장비 자동 착용").
import {
  newGame, state, advanceDays, refreshCity, restAtInn, addGold, addMerc, daysUntilNextReturn,
  ROSTER_CAP_MAX, getRep, REP_TAVERN_MIN, START_REP,
} from '../src/game/state.js';
import { BASE_CLASSES } from '../src/data/classes.js';
import { questBattleDefs, applyQuestResult, RANK_LEVEL } from '../src/game/quest.js';
import { canDeploy, createSquad, addToSquad, squadMembers, isSquadAway, squadReturnIn } from '../src/game/squad.js';
import { isWounded, createMerc, gradeRoll, canPromote, promoteOptionsFor, promote, mercPower } from '../src/game/merc.js';
import { autoEquipAll } from '../src/game/gear.js';
import { getCity, CITIES, travelDays } from '../src/data/world.js';
import { MAX_LEVEL } from '../src/game/merc.js';
import { RNG } from '../src/core/rng.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import '../src/data/enemies.js';   // 적 전용 스킬 등록 (부수효과)

setSkillResolver(getSkill);

const SEEDS = Number(process.argv[2] || 24);
/** ui/battle.js 와 동일: 웨이브 사이 회복량 */
const WAVE_HEAL = 0.15;
/** ui/city.js 의 restFee 와 동일한 숙박비 */
const restFee = (days) => days * (20 + state.roster.length * 6);

/* ────────────────────────── 공용 헬퍼 ────────────────────────── */

/** 의뢰 한 건을 실제 게임과 같은 순서로 끝까지 돌린다 (웨이브 HP 인계 포함). */
function runQuest(quest, squadId, seed) {
  const carry = {};
  const finalHp = {};
  const results = [];
  let time = 0;
  let allyDeaths = 0;
  let enemyDeaths = 0;
  let waves = 0;
  let firstCfg = null;

  for (let w = 0; w < quest.waves.length; w++) {
    const cfg = questBattleDefs(quest, w, state, squadId);
    if (!firstCfg) firstCfg = cfg;
    if (waves > 0) {
      cfg.allies = cfg.allies.map((d) => {
        const c = carry[d.uid];
        if (!c) return d;
        if (c.hp <= 0) return null;
        return { ...d, hp: Math.min(c.maxHp, Math.max(1, Math.round(c.hp + c.maxHp * WAVE_HEAL))) };
      }).filter(Boolean);
    }
    if (!cfg.allies.length) return { win: false, time, waves, allyDeaths, enemyDeaths, results, firstCfg };
    if (!cfg.enemies.length) continue;

    const b = createBattle({ ...cfg, seed: (seed + w * 2654435761) >>> 0 || 1, getSkill, record: false });
    const res = b.run();
    waves++;
    time += res.time;

    for (const u of b.units) {
      if (u.side !== 'ally') continue;
      const hp = u.alive ? Math.max(1, Math.round(u.hp)) : 0;
      carry[u.uid] = { hp, maxHp: u.maxHp };
      finalHp[u.uid] = hp;
    }
    allyDeaths += b.units.filter((u) => u.side === 'ally' && !u.alive).length;
    enemyDeaths += b.units.filter((u) => u.side === 'enemy' && !u.alive).length;
    results.push({ ...res, finalHp: { ...finalHp }, squadId });
    if (res.winner !== 'ally') return { win: false, time, waves, allyDeaths, enemyDeaths, results, firstCfg };
  }
  return { win: true, time, waves, allyDeaths, enemyDeaths, results, firstCfg };
}

/**
 * 의뢰 1건을 "수주 → 전투 → 정산 → 전리품 자동착용 → 전직" 까지 실제 게임과 같은 순서로 처리한다.
 * 날짜는 넘기지 않는다 (applyQuestResult 가 부대를 잠글 뿐이다).
 */
function doQuest(quest, squadId, seed) {
  const r = runQuest(quest, squadId, seed);
  const out = applyQuestResult(quest, { results: r.results, squadId });
  if (out && out.items && out.items.length) {
    try {
      autoEquipAll(state, { pool: out.items.map((it) => it.uid), powerOf: (m) => mercPower(m, state) });
    } catch { /* 자동 착용 실패는 밸런스 측정에 치명적이지 않다 */ }
  }
  return { ...r, apply: out };
}

/** 전직 가능한 단원을 전부 승격시킨다 (플레이어가 바로 누른다고 가정). */
function promoteAll(r) {
  const done = [];
  for (const m of state.roster) {
    let ok = false;
    try { ok = canPromote(m); } catch { ok = false; }
    if (!ok) continue;
    const opts = promoteOptionsFor(m);
    if (!opts.length) continue;
    const res = promote(m, r.pick(opts).id);
    if (res.ok) done.push({ uid: m.uid, to: m.classId, level: m.level });
  }
  return done;
}

/** `.ok` 가 false면 플레이어는 출정 버튼을 누를 수 없다. */
function deployCheck(sid) {
  try { return canDeploy(state, sid) || { ok: false, benched: [], deployable: [], away: false }; }
  catch { return { ok: false, benched: [], deployable: [], away: false }; }
}

/** 원정 나간 부대가 돌아올 때까지 며칠 남았는가 (없으면 0) */
function nextReturnIn() {
  const v = daysUntilNextReturn(state);
  return v == null ? 0 : Math.max(1, v);
}

/* ══════════════════════ A. 랭크별 1회 성적 ══════════════════════ */

const byRank = new Map();

for (let s = 1; s <= SEEDS; s++) {
  newGame(s * 7919);
  const sid = state.squads[0].id;
  const list = state.quests[state.cityId]?.list || [];
  for (const q of list) {
    const r = runQuest(q, sid, (s * 104729) >>> 0);
    const e = byRank.get(q.rank) || { n: 0, win: 0, time: 0, ad: 0, ed: 0, ec: 0, ac: 0, lv: 0, days: 0 };
    e.n++; e.win += r.win ? 1 : 0; e.time += r.time; e.ad += r.allyDeaths; e.ed += r.enemyDeaths;
    e.lv += q.level;
    e.days += q.days || 0;
    e.ac += r.firstCfg ? r.firstCfg.allies.length : 0;
    e.ec += r.firstCfg ? r.firstCfg.enemies.length : 0;
    byRank.set(q.rank, e);
  }
}

const partySize = (() => { newGame(1); return state.squads[0].memberUids.filter(Boolean).length; })();
console.log(`\n시작 부대 인원: ${partySize}명 (Lv1)\n`);
console.log('랭크  의뢰수  승률    평균시간  아군전사  적전사  아군수  적수  권장Lv  소요일');
console.log('─'.repeat(84));
for (const rank of ['F', 'E', 'D', 'C', 'B', 'A', 'S']) {
  const e = byRank.get(rank);
  if (!e) continue;
  const p = (v) => (v / e.n).toFixed(2);
  console.log(
    `  ${rank}   ${String(e.n).padStart(5)}  ${((100 * e.win) / e.n).toFixed(0).padStart(4)}%  ` +
    `${p(e.time).padStart(7)}s  ${p(e.ad).padStart(7)}  ${p(e.ed).padStart(6)}  ` +
    `${p(e.ac).padStart(6)}  ${p(e.ec).padStart(4)}  ${p(e.lv).padStart(6)}  ${p(e.days).padStart(6)}`);
}
const f = byRank.get('F');
const fRate = f ? (100 * f.win) / f.n : 0;
const fDeaths = f ? f.ad / f.n : 0;
console.log(`\n판정: 시작 부대의 F랭크 승률 ${fRate.toFixed(1)}% / 아군 전사 평균 ${fDeaths.toFixed(2)}명 ` +
  (fRate >= 85 && fDeaths <= 1.0 ? '— 목표 달성 (85% 이상 / 1.0명 이하)'
    : fRate >= 55 ? '— 목표 미달 (85% 이상 / 1.0명 이하)'
      : '— 초반이 클리어 불가능하다. 반드시 고쳐야 한다.'));

/* ══════════════ B. 파견 루프 (F랭크 10연속, 부대 1개) ══════════════ */
//
// 실제 루프 그대로다.
//   출정 → 부대가 quest.days 일 잠김 → (부대가 하나뿐이라) 날짜를 넘겨 복귀를 기다림 → 다시 출정
// "출전 불가"는 **부상/전멸로 막힌 경우만** 센다. 원정 중이라 못 나가는 건 설계된 동작이므로
// 별도 지표(원정 대기 일수)로 뺀다.

const RUNS = 10;
/** 의뢰가 없을 때 최대 며칠까지 기다려 보는가 */
const MAX_WAIT = 12;

/** 지금 시점에 받을 수 있는 F랭크 의뢰 하나 (없으면 null) */
function pickF() {
  const list = state.quests[state.cityId]?.list || [];
  const fs = list.filter((q) => q.rank === 'F');
  if (!fs.length) return null;
  return fs.slice().sort((a, b) => a.level - b.level)[0];
}

const loop = {
  seeds: 0, done: 0, wins: 0, blocked: 0, restDays: 0, brokeAt: [],
  woundSum: 0, fitSum: 0, samples: 0, goldEnd: 0, dayEnd: 0, deadEnd: 0,
  awayWaitDays: 0, awayWaits: 0,
};
const trace = [];

for (let s = 1; s <= SEEDS; s++) {
  newGame(s * 15485863);
  const sid = state.squads[0].id;
  loop.seeds++;
  let completed = 0;

  for (let run = 0; run < RUNS; run++) {
    // 1) 원정 중이면 복귀까지 날짜를 넘긴다.
    //    ui/city.js 의 "부대 복귀까지 넘기기" 버튼과 같은 경로다 (daysUntilNextReturn → advanceDays).
    if (isSquadAway(state.squads.find((x) => x.id === sid), state.day)) {
      const wait = Math.max(1, nextReturnIn() || squadReturnIn(state.squads.find((x) => x.id === sid), state.day));
      advanceDays(wait);
      refreshCity(state.cityId);
      loop.awayWaits++;
      loop.awayWaitDays += wait;
    }

    // 2) 출전 판정 — 부상으로 막히면 여관에서 쉬고 다시 시도한다.
    let dep = deployCheck(sid);
    if (!dep.ok && !dep.away) {
      loop.blocked++;
      for (let d = 0; d < MAX_WAIT && !dep.ok; d++) {
        state.gold = Math.max(0, state.gold - restFee(1));
        loop.restDays++;
        restAtInn(1);
        refreshCity(state.cityId);
        dep = deployCheck(sid);
      }
      if (!dep.ok) { loop.brokeAt.push(run + 1); break; }
    }
    if (!dep.ok) { loop.brokeAt.push(run + 1); break; }

    // 3) F랭크 의뢰 확보 — 목록이 비었으면 하루씩 넘기며 리롤을 기다린다.
    refreshCity(state.cityId);
    let q = pickF();
    for (let d = 0; d < MAX_WAIT && !q; d++) {
      advanceDays(1);
      refreshCity(state.cityId);
      q = pickF();
    }
    if (!q) { loop.brokeAt.push(run + 1); break; }

    // 4) 수행 + 정산. **날짜는 넘기지 않는다** — 부대만 q.days 만큼 잠긴다.
    const r = doQuest(q, sid, (s * 2246822519 + run * 40503) >>> 0);

    loop.done++;
    completed++;
    if (r.win) loop.wins++;

    const after = deployCheck(sid);
    const wounds = state.roster.filter((m) => isWounded(m, state.day)).length;
    loop.woundSum += wounds;
    loop.fitSum += after.deployable.length;
    loop.samples++;
    if (s === 1) {
      trace.push({
        run: run + 1, day: state.day, win: r.win, wounds,
        fit: after.deployable.length, gold: state.gold,
        back: r.apply && r.apply.dispatch ? r.apply.dispatch.returnDay : state.day,
        hp: state.roster.map((m) => Math.round((100 * (m.hp || 0)) / Math.max(1, m.maxHp || 1))),
      });
    }
  }

  if (completed === RUNS) loop.deadEnd += 0; else loop.deadEnd++;
  loop.goldEnd += state.gold;
  loop.dayEnd += state.day;
}

console.log(`\n\n파견 루프 — 부대 1개로 F랭크 의뢰 ${RUNS}회 연속 (시드 ${SEEDS}개)`);
console.log('─'.repeat(84));
console.log('#   일차  결과  복귀일  부상  출전가능  보유골드  단원 HP%');
for (const t of trace) {
  console.log(`${String(t.run).padStart(2)}  ${String(t.day).padStart(4)}  ${t.win ? '승리' : '패배'}  ` +
    `${String(t.back).padStart(6)}  ${String(t.wounds).padStart(4)}  ${String(t.fit).padStart(8)}  ` +
    `${String(t.gold).padStart(8)}  ${t.hp.join('/')}`);
}
console.log('─'.repeat(84));
const avg = (v, n) => (n ? (v / n).toFixed(2) : '-');
console.log(`완주(10회 전부 수행)   : ${loop.seeds - loop.deadEnd}/${loop.seeds} 시드`);
console.log(`수행한 의뢰            : ${loop.done}건 (승률 ${loop.done ? ((100 * loop.wins) / loop.done).toFixed(1) : 0}%)`);
console.log(`★ 출전 불가로 막힌 횟수: ${loop.blocked}회  (목표 0회 — 원정 대기는 제외)`);
console.log(`  └ 복구용 여관 숙박    : ${loop.restDays}일`);
console.log(`원정 복귀 대기          : ${loop.awayWaits}회 · ${loop.awayWaitDays}일 (부대가 1개라 필연)`);
console.log(`의뢰 후 평균 부상자     : ${avg(loop.woundSum, loop.samples)}명`);
console.log(`의뢰 후 평균 출전 가능  : ${avg(loop.fitSum, loop.samples)}명 / ${partySize}명`);
console.log(`10회 종료 시 평균 골드  : ${avg(loop.goldEnd, loop.seeds)}G (시작 800G)`);
console.log(`10회 종료 시 평균 일차  : ${avg(loop.dayEnd, loop.seeds)}일`);
if (loop.brokeAt.length) console.log(`진행 중단 지점          : ${loop.brokeAt.join(', ')}회차`);

const loopOk = loop.blocked === 0 && loop.deadEnd === 0;
console.log(`\n판정: ${loopOk ? '10회 연속 진행 가능 — 부상으로 막히지 않는다.'
  : `막힘 발생 — 출전 불가 ${loop.blocked}회 / 중단 ${loop.deadEnd}시드.`}`);

/* ═══════ C. 역경 시나리오 — 실제로 부상이 나는 상황에서의 회복 루프 ═══════ */
//
// F랭크는 거의 지지 않으므로 부상 경로 자체를 타지 않는다(위 루프의 부상자 0.00명).
// 플레이어가 실제로 겪은 문제는 "지고 → 눕고 → 출정 불가"였으므로,
// 시작 부대가 확실히 지는 E랭크 의뢰를 계속 물리게 해서 그 경로를 강제로 밟는다.
// 검사 항목:
//   1) 건강한 단원이 1명이라도 남아 있고 원정 중이 아니면 canDeploy().ok 가 반드시 true 인가
//   2) 부상자가 나와도 출전 → 회복 → 재출전 루프가 계속 돌아가는가

const adv = {
  seeds: 0, tries: 0, losses: 0, blocked: 0, restDays: 0,
  woundEvents: 0, maxWound: 0, benchedDeploys: 0, contract: 0,
  stuck: 0, worstFit: 4,
};
const ADV_RUNS = 10;

for (let s = 1; s <= SEEDS; s++) {
  newGame(s * 32452843);
  const sid = state.squads[0].id;
  adv.seeds++;

  for (let run = 0; run < ADV_RUNS; run++) {
    // 원정 중이면 복귀까지 넘긴다.
    const sq = state.squads.find((x) => x.id === sid);
    if (isSquadAway(sq, state.day)) {
      advanceDays(Math.max(1, squadReturnIn(sq, state.day)));
      refreshCity(state.cityId);
    }

    let dep = deployCheck(sid);
    const healthy = state.roster.filter((m) => !isWounded(m, state.day)).length;
    // ★ 핵심 계약: 원정 중이 아니고 건강한 인원이 1명 이상이면 출전은 막히지 않아야 한다.
    if (healthy > 0 && !dep.ok && !dep.away) adv.contract++;

    if (!dep.ok) {
      adv.blocked++;
      for (let d = 0; d < MAX_WAIT && !dep.ok; d++) {
        state.gold = Math.max(0, state.gold - restFee(1));
        adv.restDays++;
        restAtInn(1);
        dep = deployCheck(sid);
      }
      if (!dep.ok) { adv.stuck++; break; }
    }
    if (dep.benched.length) adv.benchedDeploys++;
    adv.worstFit = Math.min(adv.worstFit, dep.deployable.length);

    refreshCity(state.cityId);
    const list = state.quests[state.cityId]?.list || [];
    const hard = list.filter((q) => q.rank === 'E').sort((a, b) => b.level - a.level)[0]
      || list.filter((q) => q.rank !== 'F').sort((a, b) => b.level - a.level)[0];
    if (!hard) { advanceDays(1); refreshCity(state.cityId); continue; }

    const r = runQuest(hard, sid, (s * 3266489917 + run * 40503) >>> 0);
    const before = state.roster.filter((m) => isWounded(m, state.day)).length;
    applyQuestResult(hard, { results: r.results, squadId: sid });
    adv.tries++;
    if (!r.win) adv.losses++;

    const now = state.roster.filter((m) => isWounded(m, state.day)).length;
    if (now > before) adv.woundEvents += now - before;
    adv.maxWound = Math.max(adv.maxWound, now);
  }
}

console.log(`\n\n역경 시나리오 — 시작 부대가 이길 수 없는 E랭크 의뢰를 ${ADV_RUNS}회 반복 (시드 ${SEEDS}개)`);
console.log('─'.repeat(84));
console.log(`시도한 의뢰            : ${adv.tries}건 (패배 ${adv.losses}건)`);
console.log(`발생한 부상            : ${adv.woundEvents}건 · 동시 최대 ${adv.maxWound}명`);
console.log(`부상자를 벤치하고 출전  : ${adv.benchedDeploys}회 (최소 출전 인원 ${adv.worstFit}명)`);
console.log(`★ 건강한 인원이 남았는데도 출전 불가: ${adv.contract}회  (반드시 0)`);
console.log(`전원 부상으로 출전 불가 : ${adv.blocked}회 → 여관 ${adv.restDays}일로 복구`);
console.log(`복구 실패(영구 중단)    : ${adv.stuck}회  (반드시 0)`);

const advOk = adv.contract === 0 && adv.stuck === 0;
console.log(`\n판정: ${advOk
  ? '부상이 나도 남은 인원으로 계속 출전할 수 있고, 여관 휴식으로 반드시 복구된다.'
  : `계약 위반 ${adv.contract}회 / 영구 중단 ${adv.stuck}회 — 하강 나선이 남아 있다.`}`);

/* ══════ D/E. 장기 운용 시뮬레이터 — 부대 수를 바꿔 가며 30일을 돌린다 ══════ */

/** 부대 하나가 도전할 만한 의뢰인가: 랭크 하한이 평균 레벨 + 여유 안에 들어오는가 */
const RANK_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const LEVEL_MARGIN = 2;

function squadAvgLv(sq) {
  const ms = squadMembers(state, sq.id).filter((m) => !isWounded(m, state.day));
  if (!ms.length) return 0;
  return ms.reduce((a, m) => a + (m.level || 1), 0) / ms.length;
}

/* 부대별 "도전 상한 랭크". 사람은 계속 지면 한 단계 내리고, 두 번 연속 이기면 한 단계 올린다.
 * 권장 레벨만 보고 무조건 최고 랭크를 잡게 두면 소수 부대가 계속 전멸해서
 * 측정하려는 게 "파견 처리량"이 아니라 "내 봇이 얼마나 무모한가"가 되어 버린다. */
const policy = new Map();
function pol(sq) {
  if (!policy.has(sq.id)) policy.set(sq.id, { ceil: 0, streak: 0 });
  return policy.get(sq.id);
}
function afterQuest(sq, win) {
  const p = pol(sq);
  if (win) {
    p.streak++;
    if (p.streak >= 2 && p.ceil < RANK_ORDER.length - 1) { p.ceil++; p.streak = 0; }
  } else {
    p.ceil = Math.max(0, p.ceil - 1);
    p.streak = 0;
  }
}

/** 이 부대가 지금 받을 수 있는 가장 값진 의뢰 (없으면 null) */
function pickQuestFor(sq, taken) {
  const list = state.quests[state.cityId]?.list || [];
  const avg = squadAvgLv(sq);
  const ceil = pol(sq).ceil;
  const cand = list.filter((q) => !taken.has(q.id)
    && RANK_ORDER.indexOf(q.rank) <= ceil
    && (RANK_LEVEL[q.rank]?.[0] ?? 99) <= avg + LEVEL_MARGIN);
  if (!cand.length) return null;
  cand.sort((a, b) => (RANK_ORDER.indexOf(b.rank) - RANK_ORDER.indexOf(a.rank))
    || ((b.reward?.gold || 0) - (a.reward?.gold || 0)));
  return cand[0];
}

/** 주점에서 한 명 고용한다 (골드가 reserve 이상 남을 때만). */
function tryHire(r, reserve) {
  const list = state.tavern[state.cityId]?.list || [];
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => a.cost - b.cost);
  const offer = sorted[0];
  if (!offer || state.gold < offer.cost + reserve) return null;
  addGold(-offer.cost);
  const grade = gradeRoll(getCity(state.cityId)?.tier || 1, r);
  const m = createMerc({ classId: offer.classId, grade, level: 1, rng: r, day: state.day });
  addMerc(m);
  // 창고에 놀고 있는 장비를 새 단원에게 물려준다 (인벤토리 화면의 "자동 착용"과 같다).
  // 이걸 빼면 새 단원이 맨몸으로 나가서 2부대가 부당하게 약해진다.
  try { autoEquipAll(state, { mercs: [m] }); } catch { /* 무시 */ }
  const i = list.indexOf(offer);
  if (i >= 0) list.splice(i, 1);
  return m;
}

/** 부대 인원 수 */
const squadSize = (sq) => sq.memberUids.filter(Boolean).length;

/**
 * 미배치 단원을 부대에 넣는다. maxSquads 까지만 부대를 만든다.
 *
 * ※ 부대를 아직 다 만들지 못했으면 새 단원을 **기존 부대에 넣지 않고 아껴 둔다**.
 *   그러지 않으면 고용하는 족족 1부대가 삼켜 버려서 2부대가 영원히 안 생긴다
 *   (실제 플레이어도 2부대를 만들 작정이면 새 단원을 그쪽에 모은다).
 */
function organize(maxSquads) {
  const free = () => state.roster.filter((m) => !m.squadId);
  if (state.squads.length < maxSquads) {
    // 새 부대는 4명이 모였을 때만 만든다 (3명 이하로는 F랭크도 위험하다).
    if (free().length < 4) return;
    const sq = createSquad(`제${state.squads.length + 1}부대`, state.formations[0] || 'basic');
    state.squads.push(sq);
  }
  for (const m of free()) {
    // 정원이 남은 부대 중 인원이 가장 적은 쪽에 넣는다.
    const target = state.squads.filter((sq) => squadSize(sq) < 7)
      .sort((a, b) => squadSize(a) - squadSize(b))[0];
    if (!target) break;
    addToSquad(state, target.id, m.uid);
  }
}

/**
 * N일을 실제 루프대로 돌린다.
 * 하루: 도시 갱신 → 고용/편성 → 대기 중인 모든 부대를 각각 출정 → 하루 넘기기.
 */
function runCompany({ seed, days = 30, maxSquads = 1, hire = true, rosterCap = null, reserve = 250 }) {
  // 각 모드는 "실제로 출전시킬 수 있는 만큼"만 고용한다.
  // 부대 1개면 8번째 단원부터는 임금만 축내는 잉여다 — 그래서 정원이 곧 7명이다.
  // 부대를 늘릴 수 있어야 8명째부터가 의미를 갖는다. 이게 파견 시스템이 노린 지점이다.
  const cap = rosterCap ?? (maxSquads === 1 ? 7 : maxSquads * 6);
  newGame(seed);
  policy.clear();   // newGame 의 부대 id('squad_1')가 고정이라 지우지 않으면 앞 시드의 정책이 새어 든다
  const r = new RNG((seed ^ 0x9e3779b9) >>> 0 || 1);
  const out = {
    quests: 0, wins: 0, gold: 0, upkeep: 0, hires: 0, hireGold: 0,
    idleSquadDays: 0, squadDays: 0, noQuestSlots: 0,
    firstLv15: null, firstPromote: null, maxLevel: 1, avgLevel: 1,
    goldMin: state.gold, goldSeries: [], bankruptDays: 0, roster: 0, squads: 1,
    power: 0,
  };
  const startDay = state.day;

  while (state.day - startDay < days) {
    refreshCity(state.cityId);
    if (hire && state.roster.length < cap) {
      const g0 = state.gold;
      if (tryHire(r, reserve)) { out.hires++; out.hireGold += g0 - state.gold; }
    }
    organize(maxSquads);

    const taken = new Set();
    for (const sq of state.squads.slice()) {
      out.squadDays++;
      const dep = deployCheck(sq.id);
      if (!dep.ok) continue;               // 원정 중이거나 전원 부상
      const q = pickQuestFor(sq, taken);
      if (!q) { out.noQuestSlots++; out.idleSquadDays++; continue; }
      taken.add(q.id);
      const res = doQuest(q, sq.id, (seed * 2654435761 + state.day * 40503 + out.quests * 7919) >>> 0);
      out.quests++;
      if (res.win) out.wins++;
      afterQuest(sq, res.win);
    }

    const promoted = promoteAll(r);
    if (out.firstPromote == null && promoted.length) out.firstPromote = state.day - startDay + 1;
    for (const m of state.roster) {
      if (out.firstLv15 == null && (m.level || 1) >= 15) out.firstLv15 = state.day - startDay + 1;
    }

    const adv2 = advanceDays(1);
    out.upkeep += adv2.upkeep;
    if (adv2.unpaid > 0) out.bankruptDays++;
    out.goldMin = Math.min(out.goldMin, state.gold);
    out.goldSeries.push(state.gold);
  }

  out.gold = state.gold;
  out.roster = state.roster.length;
  out.squads = state.squads.length;
  out.maxLevel = state.roster.reduce((a, m) => Math.max(a, m.level || 1), 1);
  out.avgLevel = state.roster.length
    ? state.roster.reduce((a, m) => a + (m.level || 1), 0) / state.roster.length : 1;
  out.power = state.roster.reduce((a, m) => {
    try { return a + mercPower(m, state); } catch { return a; }
  }, 0);
  out.renown = state.renown;
  return out;
}

/* ══════ D. 부대 1개 vs 2개 ══════ */

const SIM_DAYS = 40;
const SIM_SEEDS = Math.max(6, Math.min(SEEDS, 16));

function aggregate(rows) {
  const n = rows.length;
  const sum = (k) => rows.reduce((a, x) => a + (x[k] || 0), 0);
  const cnt15 = rows.filter((x) => x.firstLv15 != null).length;
  return {
    n,
    quests: sum('quests') / n,
    winRate: sum('quests') ? (100 * sum('wins')) / sum('quests') : 0,
    gold: sum('gold') / n,
    goldMin: rows.reduce((a, x) => Math.min(a, x.goldMin), Infinity),
    upkeep: sum('upkeep') / n,
    roster: sum('roster') / n,
    squads: sum('squads') / n,
    avgLevel: sum('avgLevel') / n,
    maxLevel: sum('maxLevel') / n,
    power: sum('power') / n,
    renown: sum('renown') / n,
    bankrupt: sum('bankruptDays'),
    noQuest: sum('noQuestSlots') / n,
    hires: sum('hires') / n,
    hireGold: sum('hireGold') / n,
    lv15Days: cnt15 ? rows.filter((x) => x.firstLv15 != null).reduce((a, x) => a + x.firstLv15, 0) / cnt15 : null,
    lv15Seeds: cnt15,
  };
}

const oneRows = [];
const twoRows = [];
for (let s = 1; s <= SIM_SEEDS; s++) {
  const seed = (s * 2654435761) >>> 0 || 1;
  oneRows.push(runCompany({ seed, days: SIM_DAYS, maxSquads: 1 }));
  twoRows.push(runCompany({ seed, days: SIM_DAYS, maxSquads: 2 }));
}
const one = aggregate(oneRows);
const two = aggregate(twoRows);

const fmt = (v, d = 1) => (v == null ? '-' : Number(v).toFixed(d));
console.log(`\n\n★ D. 부대 1개 vs 2개 — ${SIM_DAYS}일 운용 (시드 ${SIM_SEEDS}개, 같은 시드끼리 비교)`);
console.log('─'.repeat(84));
console.log('지표                     부대 1개      부대 2개      차이');
const row = (label, a, b, d = 1, unit = '') => {
  const diff = (b - a);
  const pctv = a ? ((100 * diff) / Math.abs(a)) : 0;
  console.log(`${label.padEnd(24)} ${(fmt(a, d) + unit).padStart(11)}  ${(fmt(b, d) + unit).padStart(11)}  ` +
    `${(diff >= 0 ? '+' : '') + fmt(diff, d) + unit} (${(pctv >= 0 ? '+' : '') + fmt(pctv, 0)}%)`);
};
row('수행 의뢰 수', one.quests, two.quests, 1);
row('의뢰 승률', one.winRate, two.winRate, 1, '%');
row(`${SIM_DAYS}일 후 골드`, one.gold, two.gold, 0, 'G');
row('누적 임금 지출', one.upkeep, two.upkeep, 0, 'G');
row('고용비 지출', one.hireGold, two.hireGold, 0, 'G');
row('단원 수', one.roster, two.roster, 1);
row('평균 레벨', one.avgLevel, two.avgLevel, 1);
row('최고 레벨', one.maxLevel, two.maxLevel, 1);
row('용병단 총 전투력', one.power, two.power, 0);
row('명성', one.renown, two.renown, 1);
console.log(`부대 수                  ${fmt(one.squads, 1).padStart(11)}  ${fmt(two.squads, 1).padStart(11)}`);
console.log(`의뢰 없어 논 부대-일     ${fmt(one.noQuest, 1).padStart(11)}  ${fmt(two.noQuest, 1).padStart(11)}`);
console.log(`골드 최저점              ${fmt(one.goldMin, 0).padStart(11)}G ${fmt(two.goldMin, 0).padStart(10)}G`);
console.log(`임금 체불 일수(합)       ${String(one.bankrupt).padStart(11)}  ${String(two.bankrupt).padStart(11)}`);
console.log(`Lv15 도달 일차           ${fmt(one.lv15Days, 1).padStart(11)}  ${fmt(two.lv15Days, 1).padStart(11)}  ` +
  `(${one.lv15Seeds}/${one.n} vs ${two.lv15Seeds}/${two.n} 시드)`);

const twoBetter = two.quests > one.quests * 1.15 && two.power >= one.power;
console.log(`\n판정: ${twoBetter
  ? `부대 2개가 유리하다 — 의뢰 수 +${fmt(100 * (two.quests / Math.max(1, one.quests) - 1), 0)}%, 전투력 +${fmt(100 * (two.power / Math.max(1, one.power) - 1), 0)}%.`
  : '부대를 2개로 나눠도 이득이 없다 — 파견 시스템의 목적이 달성되지 않았다.'}`);

/* ══════ E. 경제 — 30일 골드/레벨 추이 ══════ */

console.log(`\n\nE. 경제 — 부대 2개 기준 ${SIM_DAYS}일 (시드 ${SIM_SEEDS}개 평균)`);
console.log('─'.repeat(84));
const series = [];
for (let d = 0; d < SIM_DAYS; d++) {
  const vals = twoRows.map((rw) => rw.goldSeries[d]).filter((v) => v != null);
  series.push(vals.reduce((a, v) => a + v, 0) / (vals.length || 1));
}
const marks = [];
for (let i = Math.max(1, Math.round(SIM_DAYS / 11)) - 1; i < SIM_DAYS; i += Math.max(1, Math.round(SIM_DAYS / 11))) marks.push(i);
if (marks[marks.length - 1] !== SIM_DAYS - 1) marks.push(SIM_DAYS - 1);
console.log('일차   ' + marks.map((i) => String(i + 1).padStart(7)).join(''));
console.log('골드   ' + marks.map((i) => String(Math.round(series[i] || 0)).padStart(7)).join(''));
const goldStart = 800;
const goldEnd = series[SIM_DAYS - 1] || 0;
const growth = goldEnd / goldStart;
console.log(`\n골드 800G → ${Math.round(goldEnd)}G (${fmt(growth, 2)}배). 누적 임금 ${Math.round(two.upkeep)}G.`);
console.log(`임금이 수입에서 차지하는 비중: ${fmt((100 * two.upkeep) / Math.max(1, two.upkeep + goldEnd - goldStart), 0)}%`);
console.log(`Lv15(2차 전직) 도달: 부대1개 ${one.lv15Days == null ? '미도달' : `${fmt(one.lv15Days, 1)}일차`}` +
  ` (${one.lv15Seeds}/${one.n} 시드) / 부대2개 ${two.lv15Days == null ? '미도달' : `${fmt(two.lv15Days, 1)}일차`}` +
  ` (${two.lv15Seeds}/${two.n} 시드) — 설계 B 목표 30~45일`);
console.log('  ※ 이 시뮬은 시작 도시(tier 1)에 계속 머문다 = F/E 위주라 성장이 가장 느린 경로다.');
console.log('    Lv35·Lv55 성장은 아래 ★E2(도시 이동 포함)에서 잰다.');
console.log(`파산(임금 체불) 발생 일수: ${two.bankrupt}일 / ${SIM_DAYS * two.n}일`);

const lv15 = one.lv15Days;
const econOk =
  goldEnd > 200 &&                          // 파산하지 않는다
  growth < 40 &&                            // 무한 증식하지 않는다
  two.bankrupt <= SIM_SEEDS &&              // 체불이 상시화되지 않는다
  lv15 != null && lv15 >= 25 && lv15 <= 50; // 설계 B: 시작 도시 고정 경로에서 Lv15 30~45일 근처
console.log(`\n판정: ${econOk ? '경제가 파산하지도 폭주하지도 않고, 성장 속도가 설계 B 목표 범위다.'
  : '경제 목표 이탈 — 위 수치 확인 필요.'}`);

/* ══════ ★ E2. 성장 곡선 — Lv80 까지, 도시 이동 포함 (설계 B) ══════ */
//
// 기존 성장 시뮬(runCompany)은 시작 도시(tier 1)에 눌러앉아 F/E 만 돌아 Lv35·Lv55 에
// 도달하지 못했다(HANDOFF 미해결 항목). 여기서는 **부대가 크면 상위 tier 도시로 이동**해
// 자기 레벨에 맞는 랭크를 받도록 만들어 실제 플레이에 가깝게 잰다.
//   - 단원 7명을 초반에 채우고(정원 7), 이후엔 그 부대를 레벨업시킨다.
//   - 평균 레벨이 오르면 상위 tier 도시로 이동(travelDays 만큼 날짜 소모).
//   - 도달 목표(설계 B): Lv15 30~45일 / Lv35 80~120일 / Lv55 160~220일 / Lv80 장기(300일+).
const GROWTH_SEEDS = Math.max(4, Math.min(SEEDS, 10));
const GROWTH_MAXDAYS = 900;

const CITY_BY_TIER = {};
for (const c of CITIES) (CITY_BY_TIER[c.tier] || (CITY_BY_TIER[c.tier] = [])).push(c);
const MAX_CITY_TIER = Math.max(...Object.keys(CITY_BY_TIER).map(Number));
function cityOfTier(t) {
  const list = CITY_BY_TIER[Math.min(t, MAX_CITY_TIER)] || [];
  return list[0] || null;
}
// 평균 레벨 → 목표 도시 tier. 랭크 권장 레벨(D15/C25/B35/A45/S55)에 맞춰 올라간다.
function targetTierFor(avgLv) {
  if (avgLv < 12) return 1;
  if (avgLv < 25) return 2;
  if (avgLv < 40) return 3;
  if (avgLv < 55) return 4;
  return MAX_CITY_TIER;
}

function runGrowth({ seed, cap = 7, reserve = 150 }) {
  newGame(seed);
  policy.clear();
  const r = new RNG((seed ^ 0x27d4eb2f) >>> 0 || 1);
  const marks = { 15: null, 35: null, 55: null, 80: null };
  const startDay = state.day;
  let travelTotal = 0, quests = 0, wins = 0;
  const maxLvNow = () => state.roster.reduce((a, m) => Math.max(a, m.level || 1), 1);

  while (state.day - startDay < GROWTH_MAXDAYS) {
    const sq = state.squads[0];
    // 원정 중이면 복귀까지 날짜를 넘긴다(부대 1개라 필연).
    if (isSquadAway(sq, state.day)) {
      advanceDays(Math.max(1, nextReturnIn()));
      continue;
    }
    // 초반엔 정원까지 고용해 7명 부대를 만든다. 이후엔 그 부대를 레벨업.
    if (state.roster.length < cap) tryHire(r, reserve);
    organize(1);

    // 부대가 현재 도시를 졸업했으면 상위 tier 로 이동한다(날짜 소모).
    const avg = squadAvgLv(sq) || maxLvNow();
    const tt = targetTierFor(avg);
    const cur = getCity(state.cityId)?.tier || 1;
    if (tt > cur) {
      const dest = cityOfTier(tt);
      if (dest && dest.id !== state.cityId) {
        let td = 3;
        try { const v = travelDays(state.cityId, dest.id); if (Number.isFinite(v) && v > 0) td = v; } catch { /* 기본 3일 */ }
        advanceDays(td); travelTotal += td;
        state.cityId = dest.id;
      }
    }
    refreshCity(state.cityId);

    const dep = deployCheck(sq.id);
    if (dep.ok) {
      const q = pickQuestFor(sq, new Set());
      if (q) {
        const res = doQuest(q, sq.id, (seed * 2654435761 + state.day * 40503 + quests * 7919) >>> 0);
        quests++; if (res.win) wins++;
        afterQuest(sq, res.win);
      }
    }
    promoteAll(r);

    const mx = maxLvNow();
    for (const t of [15, 35, 55, 80]) if (marks[t] == null && mx >= t) marks[t] = state.day - startDay + 1;
    if (marks[80] != null) break;

    advanceDays(1);
  }
  return { marks, travelTotal, quests, wins, finalLv: maxLvNow(), days: state.day - startDay };
}

console.log(`\n\n★ E2. 성장 곡선 — Lv80 까지 (도시 이동 포함, 시드 ${GROWTH_SEEDS}개)`);
console.log('─'.repeat(84));
const gRows = [];
for (let s = 1; s <= GROWTH_SEEDS; s++) gRows.push(runGrowth({ seed: s * 2654435761 >>> 0 || 1 }));
const gAvg = (sel) => {
  const vals = gRows.map(sel).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const reached = (t) => gRows.filter((x) => x.marks[t] != null).length;
const TARGETS = { 15: [30, 45], 35: [80, 120], 55: [160, 220], 80: [300, Infinity] };
console.log('마일스톤   평균 도달 일차   도달 시드   설계 B 목표');
console.log('─'.repeat(84));
const growthMiss = [];
for (const t of [15, 35, 55, 80]) {
  const d = gAvg((x) => x.marks[t]);
  const [lo, hi] = TARGETS[t];
  const label = hi === Infinity ? `${lo}일+` : `${lo}~${hi}일`;
  const inBand = d != null && d >= lo && d <= hi;
  console.log(`  Lv${String(t).padStart(2)}      ${(d == null ? '미도달' : `${fmt(d, 1)}일`).padStart(13)}   ` +
    `${String(reached(t)).padStart(2)}/${GROWTH_SEEDS} 시드   ${label}${inBand ? '  ✓' : (d == null ? '' : '  (대역 밖)')}`);
  // Lv15/35/55 는 대역 판정, Lv80 은 도달만 확인(장기 목표라 상한 없음).
  if (t !== 80 && d != null && !inBand) growthMiss.push(`Lv${t} ${fmt(d, 1)}일 (목표 ${label})`);
  if (t === 80 && d != null && d < lo) growthMiss.push(`Lv80 ${fmt(d, 1)}일 (300일+ 장기 목표보다 빠름)`);
}
console.log(`\n평균 이동일수 ${fmt(gAvg((x) => x.travelTotal), 1)}일 · 평균 의뢰 ${fmt(gAvg((x) => x.quests), 0)}건 ` +
  `· 최종 평균 레벨 ${fmt(gAvg((x) => x.finalLv), 1)}`);
const growthOk = reached(15) >= GROWTH_SEEDS * 0.5 && growthMiss.length === 0;
console.log(`판정: ${growthOk ? '도시 이동을 넣으니 Lv15/35/55 성장이 설계 B 목표 대역에 든다.'
  : `성장 대역 이탈 — ${growthMiss.length ? growthMiss.join(' / ') : 'Lv15 도달 시드 부족'}`}`);

/* ══════ F. 의뢰 공급 — 부대 1/2/3/5개일 때 부대-일 유휴율 ══════ */
//
// 부대 확장(최대 5개)을 넣으면 "부대는 늘렸는데 시킬 의뢰가 없다"가 곧바로 문제가 된다.
// D 섹션은 **경제까지 포함한** 비교라 5부대를 40일 안에 만들 수가 없다(체증 비용 18,000G).
// 그래서 여기서는 부대와 단원을 **무상으로 채워 넣고** 의뢰 공급만 따로 잰다.
//   유휴율 = (출전 가능한데 받을 의뢰가 없어 논 부대-일) / (부대 수 × 일수)
// 목표: 5부대에서 15% 미만.

const SUPPLY_PER_SQUAD = 5;   // 부대당 인원 (7 을 다 채우면 고용 병목이 섞여 측정이 흐려진다)

/** 부대 N개를 무상으로 채워 넣고 일수를 돌리며 유휴 부대-일만 센다. */
function runSupply({ seed, days, squads }) {
  newGame(seed);
  policy.clear();
  state.rosterCap = ROSTER_CAP_MAX;      // 정원 확장은 여기서 재는 대상이 아니다
  const r = new RNG((seed ^ 0x85ebca6b) >>> 0 || 1);

  // 부대·단원 무상 지급. 여기서 재는 것은 "의뢰 공급"이지 경제가 아니다.
  while (state.squads.length < squads) {
    state.squads.push(createSquad(`제${state.squads.length + 1}부대`, state.formations[0] || 'basic'));
  }
  for (const sq of state.squads) {
    while (squadSize(sq) < SUPPLY_PER_SQUAD) {
      const m = createMerc({
        classId: r.pick(BASE_CLASSES), grade: gradeRoll(1, r), level: 1, rng: r, day: state.day,
      });
      addMerc(m);
      addToSquad(state, sq.id, m.uid);
    }
  }

  const out = { squadDays: 0, idle: 0, away: 0, quests: 0, wins: 0, listAvg: 0, listDays: 0, bankrupt: 0 };
  const startDay = state.day;
  while (state.day - startDay < days) {
    refreshCity(state.cityId);
    out.listAvg += (state.quests[state.cityId]?.list || []).length;
    out.listDays++;

    const taken = new Set();
    for (const sq of state.squads.slice()) {
      out.squadDays++;
      const dep = deployCheck(sq.id);
      if (!dep.ok) { if (dep.away) out.away++; continue; }   // 원정 중 = 일하는 중, 유휴 아님
      const q = pickQuestFor(sq, taken);
      if (!q) { out.idle++; continue; }
      taken.add(q.id);
      const res = doQuest(q, sq.id, (seed * 2654435761 + state.day * 40503 + out.quests * 7919) >>> 0);
      out.quests++;
      if (res.win) out.wins++;
      afterQuest(sq, res.win);
    }
    promoteAll(r);
    const a = advanceDays(1);
    if (a.unpaid > 0) out.bankrupt++;
    // 임금 파산이 유휴율 측정을 오염시키지 않도록 최소 운영비를 보전한다(공급 측정 전용).
    if (state.gold < 100) addGold(400);
  }
  return out;
}

console.log(`\n\nF. 의뢰 공급 — 부대 수별 유휴율 (${SIM_DAYS}일 · 시드 ${SIM_SEEDS}개 · 부대당 ${SUPPLY_PER_SQUAD}명 무상 지급)`);
console.log('─'.repeat(84));

const SUPPLY_COUNTS = [1, 2, 3, 5];
const supply = [];
for (const n of SUPPLY_COUNTS) {
  const rows = [];
  for (let s = 1; s <= SIM_SEEDS; s++) rows.push(runSupply({ seed: s * 7919 + 13, days: SIM_DAYS, squads: n }));
  const sum = (k) => rows.reduce((a, x) => a + (x[k] || 0), 0);
  supply.push({
    n,
    idleRate: (100 * sum('idle')) / Math.max(1, sum('squadDays')),
    awayRate: (100 * sum('away')) / Math.max(1, sum('squadDays')),
    quests: sum('quests') / rows.length,
    winRate: sum('quests') ? (100 * sum('wins')) / sum('quests') : 0,
    list: sum('listAvg') / Math.max(1, sum('listDays')),
    idleDays: sum('idle') / rows.length,
    squadDays: sum('squadDays') / rows.length,
  });
}
console.log('  ' + ['부대수', '부대-일', '유휴 부대-일', '유휴율', '원정중 비율', '의뢰/40일', '승률', '평균 의뢰목록'].join('  '));
console.log('  ' + '─'.repeat(76));
for (const s of supply) {
  console.log('  '
    + String(s.n).padStart(6)
    + String(Math.round(s.squadDays)).padStart(9)
    + fmt(s.idleDays, 1).padStart(14)
    + `${fmt(s.idleRate, 1)}%`.padStart(8)
    + `${fmt(s.awayRate, 1)}%`.padStart(13)
    + fmt(s.quests, 1).padStart(11)
    + `${fmt(s.winRate, 0)}%`.padStart(7)
    + fmt(s.list, 1).padStart(15));
}
const five = supply.find((s) => s.n === 5);
const supplyOk = five && five.idleRate < 15;
console.log('\n  의뢰 목록 길이 = clamp(3 + 부대수*2 + rand(0,1), 4, 16) (quest.js) · 목록 리롤 3일 (state.js REFRESH_DAYS)');
console.log('  ※ 유휴의 원인은 "다른 부대가 먼저 채감"이 아니라 "그 부대가 받을 수 있는 랭크가 목록에 없음"이다 —');
console.log('    그래서 리롤 주기가 아니라 목록 길이 상한(12→16)을 올려서 맞췄다.');
console.log(`\n판정: ${supplyOk
  ? `5부대에서도 유휴율 ${fmt(five.idleRate, 1)}% (< 15%) — 의뢰 공급이 부대 수를 따라간다.`
  : `5부대 유휴율 ${fmt(five ? five.idleRate : 100, 1)}% ≥ 15% — genQuests 개수나 리롤 주기를 손봐야 한다.`}`);

/* ══════ G. 평판 잠금 — 낯선 도시에 도착해 주점을 여는 데 며칠 걸리나 ══════ */
//
// 평판 10 미만이면 그 도시 주점에서 고용할 수 없다. 시작 도시만 평판 10 이므로
// **다른 도시로 이동하는 순간 주점이 닫힌다**. 그게 진행을 막는지 실제로 재 본다.
//   - 낯선 도시에서 의뢰를 받아 평판 10 에 닿기까지 며칠 / 몇 건인가
//   - 그 사이 부대가 놀거나(받을 의뢰가 없음) 전멸해서 막히는 일이 있는가

console.log(`\n\nG. 평판 잠금 — 낯선 도시 도착 후 주점 개방까지 (시드 ${SIM_SEEDS}개)`);
console.log('─'.repeat(84));

function runRepUnlock({ seed, cityId, maxDays = 30 }) {
  newGame(seed);
  policy.clear();
  const r = new RNG((seed ^ 0x27d4eb2f) >>> 0 || 1);
  // 시작 도시에서 몸을 풀지 않고 곧장 이동한 최악의 경우를 본다 (Lv1 4명 그대로).
  state.cityId = cityId;
  const out = { days: null, quests: 0, wins: 0, idleDays: 0, blockedDays: 0, restDays: 0, rep0: getRep(cityId) };
  const sq = state.squads[0];
  const start = state.day;
  while (state.day - start < maxDays) {
    refreshCity(state.cityId);
    if (getRep(cityId) >= REP_TAVERN_MIN) { out.days = state.day - start; break; }
    const dep = deployCheck(sq.id);
    if (dep.ok) {
      const q = pickQuestFor(sq, new Set());
      if (q) {
        const res = doQuest(q, sq.id, (seed * 2654435761 + state.day * 40503 + out.quests * 7919) >>> 0);
        out.quests++;
        if (res.win) out.wins++;
        afterQuest(sq, res.win);
      } else out.idleDays++;
    } else if (!dep.away) {
      // 전원 부상 = 진행 불가. 여관에서 회복한다 (실제 플레이어 행동).
      out.blockedDays++;
      addGold(-restFee(1));
      restAtInn(1);
      out.restDays++;
    }
    advanceDays(1);
    if (state.gold < 60) addGold(300);   // 이 섹션이 재는 것은 평판이지 경제가 아니다
  }
  if (out.days == null && getRep(cityId) >= REP_TAVERN_MIN) out.days = state.day - start;
  out.rep = getRep(cityId);
  return out;
}

// 시작 도시에서 갈 만한 이웃 도시 두 곳 (tier 1 / tier 2)
const UNLOCK_CITIES = ['millford', 'kingsrest'];
const unlockRows = [];
for (const cityId of UNLOCK_CITIES) {
  const rows = [];
  for (let s = 1; s <= SIM_SEEDS; s++) rows.push(runRepUnlock({ seed: s * 104729 + 7, cityId }));
  const done = rows.filter((x) => x.days != null);
  const sum = (k) => rows.reduce((a, x) => a + (x[k] || 0), 0);
  unlockRows.push({
    cityId,
    name: getCity(cityId)?.name || cityId,
    tier: getCity(cityId)?.tier || 1,
    opened: done.length,
    n: rows.length,
    days: done.length ? done.reduce((a, x) => a + x.days, 0) / done.length : null,
    quests: sum('quests') / rows.length,
    winRate: sum('quests') ? (100 * sum('wins')) / sum('quests') : 0,
    idle: sum('idleDays') / rows.length,
    blocked: sum('blockedDays') / rows.length,
  });
}
// 한글은 콘솔에서 두 칸을 먹는다 — padEnd 로는 열이 맞지 않아 폭을 직접 센다.
const wideLen = (s) => [...String(s)].reduce((a, ch) => {
  const c = ch.codePointAt(0);
  const w = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf)
    || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xff00 && c <= 0xff60);
  return a + (w ? 2 : 1);
}, 0);
const padW = (s, w) => String(s) + ' '.repeat(Math.max(0, w - wideLen(s)));

console.log('  ' + ['도시', 'tier', '개방 시드', '개방까지 일수', '의뢰 건수', '승률', '의뢰없음 일수', '전원부상 일수'].join('  '));
console.log('  ' + '─'.repeat(76));
for (const u of unlockRows) {
  console.log('  '
    + padW(u.name, 12)
    + `T${u.tier}`.padStart(4)
    + `${u.opened}/${u.n}`.padStart(11)
    + (u.days == null ? '미개방' : fmt(u.days, 1)).padStart(15)
    + fmt(u.quests, 1).padStart(11)
    + `${fmt(u.winRate, 0)}%`.padStart(7)
    + fmt(u.idle, 1).padStart(15)
    + fmt(u.blocked, 1).padStart(15));
}
const unlockOk = unlockRows.every((u) => u.opened === u.n && u.days != null && u.days <= 15);
console.log(`\n  시작 도시 평판 ${START_REP} → 주점 열림 · 낯선 도시 평판 0 → 개방선 ${REP_TAVERN_MIN}`);
console.log(`\n판정: ${unlockOk
  ? `낯선 도시도 전 시드에서 평균 ${fmt(Math.max(...unlockRows.map((u) => u.days)), 1)}일이면 주점이 열린다 — 이동이 진행을 막지 않는다.`
  : '낯선 도시에서 주점을 열지 못하는 시드가 있다 — 평판 잠금이 진행을 막는다.'}`);

/* ────────────────────────── 종합 ────────────────────────── */

const allOk = fRate >= 85 && fDeaths <= 1.0 && loopOk && advOk && twoBetter && econOk && supplyOk && unlockOk;
console.log('\n' + '═'.repeat(84));
console.log(`종합: ${allOk ? '전부 통과' : '미달 항목 있음'}` +
  `  [F랭크 ${fRate >= 85 && fDeaths <= 1.0 ? 'O' : 'X'}]` +
  `  [파견루프 ${loopOk ? 'O' : 'X'}]` +
  `  [역경 ${advOk ? 'O' : 'X'}]` +
  `  [2부대이득 ${twoBetter ? 'O' : 'X'}]` +
  `  [경제 ${econOk ? 'O' : 'X'}]` +
  `  [의뢰공급 ${supplyOk ? 'O' : 'X'}]` +
  `  [평판잠금 ${unlockOk ? 'O' : 'X'}]`);
process.exitCode = allOk ? 0 : 1;
