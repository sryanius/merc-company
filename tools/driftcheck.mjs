/**
 * 「재동기화를 잠그면 서버 사본이 얼마나 벌어지나」 — §152 ⑤ 의 0번 관문
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ 제작자가 골랐다: **문을 닫는다**(B). 그러면 클라가 서버 사본을 못 덮는다.
 *   그런데 **한 번에 잠그면 정직한 플레이어의 사본도 굳는다** — 지금 서버에 올라가는
 *   것은 다음뿐이다:
 *     · 전직·판매·착용 (op)          · 의뢰 정산의 **단원 상태와 총량** (§149)
 *   올라가지 **않는** 것:
 *     · 전리품 아이템 (§113 — 정체를 못 확인해서 일부러 안 쓴다)
 *     · 하루 넘기기(임금·회복·부상) · 고용 · 던전·탑·나락 · 길가 사건 · 여관 휴식
 *
 * ★ 그래서 잠그기 전에 **무엇이 얼마나 벌어지는지** 센다. 그 수치가
 *   「무엇을 더 신고해야 잠글 수 있나」 를 정한다 — 감으로 정하지 않는다.
 *
 * 실행: node tools/driftcheck.mjs [--days=30]
 */
import * as State from '../src/game/state.js';
import * as Quest from '../src/game/quest.js';
import { toRows, fromRows } from '../src/game/runrows.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';

setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const DAYS = parseInt(arg('days', '30'), 10);

const SQUAD = ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'];

function mkState(seed) {
  State.newGame(seed, '표류검사단');
  const st = State.state;
  st.roster = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    st.roster.push({
      uid: `d_${i}`, name: getClass(classId).name, classId, level: 25, grade: 'C',
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0, hiredDay: 1,
    });
    sq.memberUids[i] = `d_${i}`;
  });
  for (let k = 0; k < 12; k++) { const it = State.rollLoot({ ilvl: 25, rarityBonus: 0 }); if (it) st.items.push(it); }
  return st;
}

/**
 * 서버 사본에 **지금 실제로 올라가는 것만** 반영한다 (§149).
 * ★ 여기 없는 것이 곧 «벌어지는 것» 이다. 손으로 «다 반영» 하면 이 도구가 거짓말한다.
 */
function applyReportedOnly(srv, st, squadId, loot) {
  /* ★ 전리품도 올라간다 (§158) — 판정을 통과한 정산의 것만, 굴림 수까지 */
  for (const it of loot || []) {
    if (!(srv.items || []).some((x) => x.uid === it.uid)) srv.items.push(it);
  }
  /* 의뢰 정산: 출전 부대의 단원 상태 + 총량 */
  const sq = (st.squads || []).find((x) => x && x.id === squadId);
  const want = new Set(((sq && sq.memberUids) || []).filter(Boolean).map(String));
  for (const m of st.roster || []) {
    if (!want.has(String(m.uid))) continue;
    const sm = (srv.roster || []).find((x) => x.uid === m.uid);
    if (!sm) continue;
    sm.level = m.level; sm.exp = m.exp; sm.hp = m.hp;
    sm.status = m.status; sm.woundUntil = m.woundUntil;
  }
  srv.gold = st.gold;
  srv.renown = st.renown;
  srv.stats = { ...(srv.stats || {}), questsDone: st.stats?.questsDone };
}

const st = mkState(60606);
const srv = fromRows(JSON.parse(JSON.stringify(toRows(st))));   // 이관 시점의 사본
const sqId = st.squads[0].id;
const startItems = st.items.length;

console.log(`재동기화를 잠그면 얼마나 벌어지나 — ${DAYS}일 논다`);
console.log('='.repeat(74));

let quests = 0;
for (let d = 0; d < DAYS; d++) {
  State.refreshCity(st.cityId, true);
  const list = (st.quests[st.cityId] || {}).list || [];
  /* 하루에 의뢰 하나 */
  const q = list.find((x) => (x.days || 1) <= 1) || list[0];
  if (q) {
    const results = [];
    let carry = null;
    for (let w = 0; w < q.waves.length; w++) {
      const cfg = Quest.questBattleDefs(q, w, st, sqId);
      const allies = Quest.applyWaveCarry(cfg.allies, carry);
      if (!allies.length) break;
      const b = createBattle({ ...cfg, allies });
      b.run();
      results.push(b.result);
      if (b.result.winner !== 'ally') break;
      if (w < q.waves.length - 1) carry = Quest.readWaveCarry(b.units, carry || {});
    }
    if (results.length) {
      let applied = null;
      try { applied = Quest.applyQuestResult(q, { results, squadId: sqId }); quests++; } catch (e) { /* */ }
      /* ★ 서버가 받는 것: 단원 상태 · 총량 · **그 정산의 전리품** (굴림 수까지) */
      const rolls = Array.isArray(q.reward?.itemRolls) ? q.reward.itemRolls.length : 0;
      const loot = (applied && Array.isArray(applied.items) ? applied.items : []).slice(0, rolls);
      applyReportedOnly(srv, st, sqId, loot);
    }
  }
  State.advanceDays(1);                       // ★ 임금·회복·부상 — 신고 경로 없음
}

/* ── 얼마나 벌어졌나 ─────────────────────────────────────────────────── */
const cliItems = st.items.length;
const srvItems = (srv.items || []).length;
const cliGold = Math.round(st.gold || 0);
const srvGold = Math.round(srv.gold || 0);
const lvOf = (list) => (list || []).reduce((a, m) => a + (m.level || 0), 0);
const cliLv = lvOf(st.roster);
const srvLv = lvOf(srv.roster);

console.log(`의뢰 ${quests}건 · ${DAYS}일`);
console.log('');
const row = (k, c, s) => {
  const d = c - s;
  const p = c ? `${(100 * Math.abs(d) / Math.abs(c)).toFixed(1)}%` : '-';
  console.log(`  ${k.padEnd(14)} 클라 ${String(c).padStart(9)}  서버 ${String(s).padStart(9)}  차이 ${String(d).padStart(9)}  (${p})`);
  return Math.abs(d);
};
const dItems = row('아이템 수', cliItems, srvItems);
const dGold = row('골드', cliGold, srvGold);
const dLv = row('레벨 합', cliLv, srvLv);

console.log('');
console.log('-'.repeat(74));
let fails = 0;
const need = (c, m) => { if (!c) { fails++; console.log(`  ✗ ${m}`); } else console.log(`  ✓ ${m}`); };
need(quests >= 5, `판이 실하다 — 의뢰 ${quests}건을 실제로 돌았다`);
need(cliItems > startItems, `논 뒤에 아이템이 늘었다 (${startItems} → ${cliItems})`);
need(dLv === 0, `레벨은 안 벌어진다 (차이 ${dLv}) — 정산 쓰기가 따라온다`);
need(dGold === 0, `골드는 안 벌어진다 (차이 ${dGold}) — 정산 쓰기가 따라온다`);
need(dItems === 0, `아이템은 안 벌어진다 (차이 ${dItems})`);

console.log('='.repeat(74));
if (fails) {
  console.log(`❌ ${fails}건 — 이대로 재동기화를 잠그면 **정직한 플레이어의 사본이 굳는다.**`);
  console.log('   위에서 «차이» 가 0 이 아닌 칸이 곧 «더 신고해야 하는 것» 이다.');
} else {
  console.log('✅ 벌어지는 것이 없다 — 재동기화를 잠글 수 있다');
}
process.exit(fails ? 1 : 0);
