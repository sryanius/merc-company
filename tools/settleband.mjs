/**
 * 「정직한 의뢰 정산이 판정에 걸리나」 — **켜기 전에 잰다** (§104 17단계 4번 조각)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ 이 도구가 답하는 질문 하나:
 *
 *     "의뢰 정산 판정을 켜면, **아무 잘못도 안 한 플레이어**가 걸리나?"
 *
 *   17단계는 전환 계획이 «거절 위험 최대» 라고 못 박은 조각이다. 그리고 이 저장소는
 *   같은 사고를 이미 겪었다 — 이관 안 한 계정의 정직한 의뢰가 시드 0 탓에
 *   «보상 불일치» 로 찍혔다 (재생성 82G vs 실제 2,288G).
 *
 * ★★ **라이브 표본을 기다리지 않는다.** 관측이 9건 쌓였는데 **후퇴·패배가 0건**이다.
 *   그건 「안 나온다」 가 아니라 「아직 안 했다」 다 — 기다리면 영영 0 일 수 있고,
 *   그 사이에 판정을 켜면 첫 후퇴가 곧 첫 오탐이 된다.
 *   ⇒ 여기서 **직접 만든다**: 승리 · 패배 · **후퇴** · 자동판매 켠 판.
 *
 * ★ 판정은 손으로 다시 안 쓴다 — `src/game/settlejudge.js` **그 함수**를 부른다.
 *   서버(`run-op`)도 같은 파일을 쓴다. 사본이 둘이면 반드시 갈라진다.
 *
 * ★ 목록도 손으로 안 만든다 — `state.js refreshCity` 가 실제로 만드는 것을 쓰고,
 *   서버 쪽 재생성은 `questgen.genQuests` 로 **시드를 같은 식으로** 지어 부른다.
 *
 * 실행: node tools/settleband.mjs [--n=40]
 * 종료 코드: 정직한 판이 하나라도 걸리면 1
 */
import * as State from '../src/game/state.js';
import * as Quest from '../src/game/quest.js';
import { genQuests, resolveSquadCount } from '../src/game/questgen.js';
import { hashStr } from '../src/game/enemygen.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { RNG } from '../src/core/rng.js';
import { judgeSettle } from '../src/game/settlejudge.js';

setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '40'), 10);

/* 강한 부대와 약한 부대를 둘 다 쓴다 — 이겨야 승리 표본이, 져야 패배 표본이 생긴다 */
const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function mkState({ seed, level, grade, squads = 1 }) {
  State.newGame(seed, '정산검사단');
  const st = State.state;
  st.roster = [];
  st.items = [];
  while (st.squads.length < squads) {
    st.squads.push({ ...st.squads[0], id: `sq_${st.squads.length}`, memberUids: [], petUids: [] });
  }
  st.squads.length = squads;
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

/**
 * 의뢰를 **실제로 돌린다.** `ui/battle.js` 와 같은 순서다.
 *
 * ★★ `mode` 가 'retreat' 이면 중간에 물러난다 — 그때 `ui/battle.js` 는
 *   `{...b.result, winner:'enemy'}` 를 **합성한다.** `finish()` 를 안 지나므로
 *   `margin` 이 없다. 서버가 같은 시드로 다시 돌리면 **그 판을 이겼을 수 있다** —
 *   그래서 «다르면 거절» 로 짜면 안 되는 그 경우다. 여기서 그것을 만들어 본다.
 */
function runQuest(st, quest, squadId, mode) {
  const total = quest.waves.length;
  const results = [];
  let carry = null;
  for (let w = 0; w < total; w++) {
    const cfg = Quest.questBattleDefs(quest, w, st, squadId);
    const allies = Quest.applyWaveCarry(cfg.allies, carry);
    if (!allies.length) break;
    const b = createBattle({ ...cfg, allies, seed: cfg.seed });
    b.run();
    if (mode === 'retreat' && w === Math.min(1, total - 1)) {
      /* ui/battle.js 의 후퇴 합성 — margin 이 **없다** */
      results.push({ winner: 'enemy', time: b.result.time, units: b.units });
      break;
    }
    results.push(b.result);
    if (b.result.winner !== 'ally') break;
    if (w < total - 1) carry = Quest.readWaveCarry(b.units, carry || {});
  }
  return results;
}

/** `net/settle.js` 가 만드는 신고를 **같은 모양으로** 짓는다 */
function buildReport(st, quest, applied, results, squadId) {
  return {
    questId: String(quest.id || ''),
    cityId: String(quest.cityId || ''),
    win: !!applied.win,
    progress: Number(applied.progress),
    '신고': {
      gold: Math.round(Number(applied.gold) || 0),
      exp: Math.round(Number(applied.exp) || 0),
      renown: Math.round(Number(applied.renown) || 0),
      itemsN: Array.isArray(applied.items) ? applied.items.length : 0,
    },
    reward: quest.reward || null,
    waves: results.map((r) => ({ winner: r && r.winner ? String(r.winner) : null, margin: !!(r && r.margin) })),
    waveN: results.length,
    questWaveN: Array.isArray(quest.waves) ? quest.waves.length : 0,
    autoSellRarity: Number(st.autoSellRarity),
  };
}

/** 서버가 하는 재생성 — `run-op` 과 **같은 식**이어야 한다 */
function regen(st, quest, squads) {
  const m = /^q_(.+)_(\d+)_(\d+)$/.exec(String(quest.id || ''));
  if (!m) return null;
  const cityId = m[1];
  const genDay = Number(m[2]);
  const r = new RNG((hashStr(`qs#${cityId}#${genDay}`) ^ ((st.seed || 0) >>> 0)) >>> 0);
  const list = genQuests(cityId, genDay, r, resolveSquadCount(squads));
  return list.find((q) => q && q.id === quest.id) || null;
}

console.log(`정직한 정산이 판정에 걸리나 — 도시 3 × 날 ${N} × 부대세기 3 × 방식 3`);
console.log('='.repeat(78));

const CASES = [];
for (const cityId of ['greenhold', 'elderoak', 'frostgate']) {
  for (let k = 0; k < N; k++) {
    const day = 4 + k * 7;
    for (const [level, grade] of [[80, 'A'], [40, 'C'], [12, 'E']]) {
      for (const mode of ['normal', 'retreat', 'normal2']) {
        CASES.push({ cityId, day, level, grade, mode, squads: 1 + (k % 5) });
      }
    }
  }
}

const tally = { 승리: 0, 패배: 0, 후퇴: 0, 재현불가: 0, 자동판매: 0 };
/* ★ 아래 «조작을 심으면 물리나» 가 쓸 정직한 표본 — 승·패를 골고루 남긴다 */
const SAMPLES = [];
const flagged = [];
let ran = 0;

for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const st = mkState({ seed: 900000 + i * 7919, level: c.level, grade: c.grade, squads: c.squads });
  st.day = c.day;
  st.cityId = c.cityId;
  /* 자동판매를 절반쯤 켠다 — 켠 판이 신고를 오염시키는지 본다 */
  st.autoSellRarity = (i % 2) ? 2 : -1;
  if (st.autoSellRarity >= 0) tally.자동판매++;
  st.quests = {};
  State.refreshCity(c.cityId, true);
  const list = (st.quests[c.cityId] || {}).list || [];
  if (!list.length) continue;
  const quest = list[i % list.length];
  const squadId = st.squads[0].id;

  let results = [];
  try { results = runQuest(st, quest, squadId, c.mode); } catch (e) { continue; }
  if (!results.length) continue;

  let applied = null;
  try { applied = Quest.applyQuestResult(quest, { results, squadId }); } catch (e) { continue; }
  if (!applied) continue;
  ran++;

  const retreat = c.mode === 'retreat';
  if (retreat) tally.후퇴++;
  else if (applied.win) tally.승리++;
  else tally.패배++;

  const report = buildReport(st, quest, applied, results, squadId);
  const gen = regen(st, quest, c.squads);
  const v = judgeSettle({ report, gen });
  if (v.cantJudge) { tally.재현불가++; continue; }
  if (SAMPLES.length < 400) {
    SAMPLES.push({ report, gen, win: !!applied.win, label: `${c.cityId} ${c.day}일 ${c.mode}` });
  }
  if (v.verdict !== 'ok') {
    flagged.push(`${c.cityId} ${c.day}일 ${c.grade}${c.level} ${c.mode}: ${v.reasons.join('·')} `
      + `(G ${v.axes.G}→${v.axes.paidGold} · E ${v.axes.E}→${v.axes.paidExp} · 웨이브 ${v.axes.waveN}/${v.axes.questWaveN})`);
  }
}

console.log(`돌린 판 ${ran} — 승리 ${tally.승리} · 패배 ${tally.패배} · 후퇴 ${tally.후퇴} `
  + `· 자동판매 켠 판 ${tally.자동판매} · 재현불가 ${tally.재현불가}`);
console.log('-'.repeat(78));

/* ★★ **판이 실해야 한다.** 후퇴가 0건이면 이 도구는 아무것도 증명 못 한다 —
 *   그건 라이브 관측이 이미 겪고 있는 문제고, 그걸 여기서 되풀이하면 뜻이 없다. */
let fails = 0;
const need = (cond, msg) => { if (!cond) { fails++; console.log(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); };

need(ran >= 100, `충분히 돌렸다 (${ran}판)`);
need(tally.승리 >= 20, `승리 표본이 있다 (${tally.승리})`);
need(tally.패배 >= 10, `패배 표본이 있다 (${tally.패배})`);
need(tally.후퇴 >= 20, `★ 후퇴 표본이 있다 (${tally.후퇴}) — 라이브에는 아직 0건이다`);
need(tally.자동판매 >= 20, `자동판매 켠 판이 있다 (${tally.자동판매})`);
need(tally.재현불가 === 0, `재현이 전부 됐다 (못 한 판 ${tally.재현불가})`);

if (flagged.length) {
  fails++;
  console.log(`  ✗ ★★★ 정직한 판이 ${flagged.length}건 걸린다 — 판정을 켜면 그만큼 오탐이다`);
  for (const f of flagged.slice(0, 12)) console.log(`      · ${f}`);
  if (flagged.length > 12) console.log(`      · … 외 ${flagged.length - 12}건`);
} else {
  console.log(`  ✓ ★ 정직한 판이 **하나도** 안 걸린다 (${ran}판)`);
}


/* ══════════════════════════════════════════════════════════════════════════
 * ★★★ 조작을 **심어서** 물리는지 본다 — 이게 없으면 위 결과가 아무 뜻이 없다
 *
 *   「정직한 판이 안 걸린다」 는 «판정이 아무것도 안 문다» 와 **구별되지 않는다.**
 *   이 저장소가 실제로 겪은 사고다 — 검사 하나가 정규식 안의 보이지 않는 글자 때문에
 *   통째로 죽어 있었고, 그동안 계속 초록이었다.
 *
 * ★ 조작은 **정직한 신고를 가져다 한 칸만** 바꾼다. 그래야 «그 칸이 물리는지» 를 안다.
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('');
console.log('조작을 심으면 물리나');
console.log('-'.repeat(78));

const CHEATS = [
  ['골드 2배', (r) => { r['신고'].gold = Math.round(r['신고'].gold * 2) + 1; }],
  ['골드 밴드 바로 위', (r, g) => { r['신고'].gold = Math.round(g.reward.gold * 1.14) + 1; }],
  ['경험 2배', (r) => { r['신고'].exp = Math.round(r['신고'].exp * 2) + 1; }],
  ['명성 부풀리기', (r) => { r['신고'].renown += 1; }],
  ['보상표 위조 (G)', (r) => { r.reward = { ...r.reward, gold: Math.round((r.reward.gold || 0) * 3) + 7 }; }],
  ['보상표 위조 (E)', (r) => { r.reward = { ...r.reward, exp: Math.round((r.reward.exp || 0) * 3) + 7 }; }],
  ['웨이브 수 위조', (r) => { r.questWaveN += 2; }],
  ['전리품 더 받기', (r, g) => { r['신고'].itemsN = (Array.isArray(g.reward.itemRolls) ? g.reward.itemRolls.length : 0) + 3; }],
];
const LOSS_CHEATS = [
  ['패배인데 골드', (r) => { r['신고'].gold = 1000; }],
  ['패배인데 명성', (r) => { r['신고'].renown = 5; }],
  ['패배인데 전리품', (r) => { r['신고'].itemsN = 2; }],
  ['패배 경험치 초과', (r, g) => { r['신고'].exp = Math.round((g.reward.exp || 0) * 0.9) + 10; }],
];

const missed = [];
let tried = 0;
for (const s of SAMPLES) {
  const list = s.win ? CHEATS : LOSS_CHEATS;
  for (const [name, mutate] of list) {
    const r = JSON.parse(JSON.stringify(s.report));
    try { mutate(r, s.gen); } catch (e) { continue; }
    /* 바뀐 게 없으면 «조작» 이 아니다 — 그런 판으로 «안 물었다» 고 하면 거짓말이다 */
    if (JSON.stringify(r) === JSON.stringify(s.report)) continue;
    tried++;
    const v = judgeSettle({ report: r, gen: s.gen });
    if (v.verdict === 'ok') missed.push(`${name} (${s.label})`);
  }
}
const byName = {};
for (const m of missed) { const k = m.split(' (')[0]; byName[k] = (byName[k] || 0) + 1; }
console.log(`  심은 조작 ${tried}건 — 놓친 것 ${missed.length}건`);
if (missed.length) {
  fails++;
  console.log('  ✗ ★ 안 물리는 조작이 있다:');
  for (const [k, n] of Object.entries(byName)) console.log(`      · ${k} — ${n}건`);
} else {
  console.log(`  ✓ ★ 심은 조작을 ${tried}건 모두 잡는다`);
}

/* ★ 그리고 «못 잰다» 는 흠이 아니다 — 재현이 없으면 조작도 안 묻는다 (그게 맞다) */
{
  const s = SAMPLES[0];
  const r = JSON.parse(JSON.stringify(s.report));
  r['신고'].gold *= 5;
  const v = judgeSettle({ report: r, gen: null });
  if (v.verdict !== 'ok' || !v.cantJudge) { fails++; console.log('  ✗ 재현이 없는데 판정했다 — 이관 전 계정이 걸린다'); }
  else console.log('  ✓ 재현이 없으면 «못 잰다» 로 남는다 (이관 전 계정을 안 문다)');
}

console.log('='.repeat(78));
console.log(fails ? `❌ ${fails}건 — 아직 판정을 켜면 안 된다` : '✅ 정직한 정산은 하나도 안 걸린다');
process.exit(fails ? 1 : 0);
