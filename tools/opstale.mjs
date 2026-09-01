/**
 * 「서버 사본이 낡으면 정직한 판매·착용이 막히나」 — **켜기 전에 잰다** (§104 10·11단계)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ 이 도구가 답하는 질문 하나:
 *
 *     "판매·착용을 «서버가 결정» 으로 바꾸면, 아무 잘못도 안 한 플레이어가 막히나?"
 *
 *   전직(9단계)은 안전했다 — 서버의 판정이 `class_id` 하나에 걸려 있고 그건 **서버가
 *   직접 소유**하기 때문이다. 판매·착용은 다르다:
 *
 *     · 판매 판정 — `없다`(신품 전리품) · `착용 중` · `잠김` … 전부 **세션 중에 변한다**
 *     · 착용 판정 — `equipIssue` 가 **`merc.level`** 을 본다 (gear.js:「레벨 N 이상」)
 *       레벨업은 의뢰로 오르는데 서버는 그걸 모른다
 *
 *   서버 사본은 **부팅 때 재동기화** 될 때만 맞다. 그 뒤로 의뢰를 돌면 전리품이 생기고
 *   레벨이 오른다 — 서버는 하나도 모른다.
 *
 * ★ 그래서 «몇 %나 막히나» 를 굴려서 센다. 0 이 아니면 그대로 켜면 안 된다.
 *
 * 실행: node tools/opstale.mjs [--quests=12]
 * 종료 코드: 정직한 조작이 하나라도 막히면 1
 */
import * as State from '../src/game/state.js';
import * as Quest from '../src/game/quest.js';
import * as Gear from '../src/game/gear.js';
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
const QUESTS = parseInt(arg('quests', '12'), 10);

const SQUAD = ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'];

function mkState(seed) {
  State.newGame(seed, '낡음검사단');
  const st = State.state;
  st.roster = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    st.roster.push({
      uid: `d_${i}`, name: getClass(classId).name, classId, level: 10, grade: 'C',
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0, hiredDay: 1,
    });
    sq.memberUids[i] = `d_${i}`;
  });
  return st;
}

/** 의뢰 한 건을 실제로 돌리고 정산까지 한다 (레벨업·전리품이 생긴다) */
function playOne(st, i) {
  State.refreshCity(st.cityId, true);
  const list = (st.quests[st.cityId] || {}).list || [];
  if (!list.length) return false;
  const q = list[i % list.length];
  const squadId = st.squads[0].id;
  const results = [];
  let carry = null;
  for (let w = 0; w < q.waves.length; w++) {
    const cfg = Quest.questBattleDefs(q, w, st, squadId);
    const allies = Quest.applyWaveCarry(cfg.allies, carry);
    if (!allies.length) break;
    const b = createBattle({ ...cfg, allies, seed: cfg.seed });
    b.run();
    results.push(b.result);
    if (b.result.winner !== 'ally') break;
    if (w < q.waves.length - 1) carry = Quest.readWaveCarry(b.units, carry || {});
  }
  if (!results.length) return false;
  try { Quest.applyQuestResult(q, { results, squadId }); } catch { return false; }
  return true;
}

/** 서버가 가진 «그때» 의 사본으로 판정한다 — 지금 상태가 아니라 스냅숏이다 */
function serverView(snapRows) {
  const srv = fromRows(snapRows);
  const mercs = new Map((srv.roster || []).map((m) => [m.uid, m]));
  const items = new Map((srv.items || []).map((it) => [it.uid, it]));
  return { srv, mercs, items };
}

console.log(`서버 사본이 낡으면 정직한 조작이 막히나 — 의뢰 ${QUESTS}건 뒤에 잰다`);
console.log('='.repeat(78));

const st = mkState(31337);
/* ★★ 스냅숏 때 **가방에 있던 고레벨 장비**를 만든다.
 *   실제로 흔한 상황이다: 낮은 레벨에 좋은 것을 주워 넣어 두고, 레벨이 오른 뒤에 낀다.
 *   그때 서버는 «그 사람은 아직 레벨 10» 이라고 알고 있다 —
 *   `equipIssue` 가 `merc.level < minLv` 를 보므로 **정직한 착용이 막힌다.**
 *   이걸 안 만들면 착용 쪽은 «위험이 없다» 가 아니라 «위험을 안 만들었다» 가 된다. */
for (let i = 0; i < 6; i++) {
  const it = State.rollLoot({ ilvl: 60, rarityBonus: 0 });
  if (it) st.items.push(it);
}

/* ── 부팅 재동기화: 이 순간의 사본을 서버가 갖는다 ───────────────────────── */
const snap = JSON.parse(JSON.stringify(toRows(st)));
const view0 = serverView(snap);
console.log(`재동기화 시점: ${st.day}일차 · 명부 ${st.roster.length} · 아이템 ${st.items.length}`);

/* ── 그 뒤로 평소처럼 논다 ──────────────────────────────────────────────── */
let played = 0;
for (let i = 0; i < QUESTS; i++) {
  if (playOne(st, i)) played++;
  State.advanceDays(1);
}
/* ★★★ **판이 위험을 실제로 만들어야 한다.** 처음엔 의뢰만 돌렸더니 레벨업도
 *   착용 변경도 잠금도 안 일어나서 «0% 막힘» 이 나왔다 — 그건 «안전하다» 가 아니라
 *   **«그 경우를 안 만들었다»** 다. 이 저장소가 반복해서 겪은 실수다.
 *   ⇒ 재동기화 뒤에 벌어지는 세 가지를 일부러 만든다:
 *     ① 레벨업 — `equipIssue` 가 `merc.level < minLv` 를 본다
 *     ② 착용/해제 — 서버는 «그때» 의 착용 상태만 안다
 *     ③ 잠금 — `isSellable` 이 본다 */
{
  /* ① 레벨을 올린다 (의뢰만으로는 잘 안 오른다) */
  for (const m of st.roster) m.level = Math.min(80, (m.level || 1) + 45);
  /* ② 재동기화 뒤에 낀 것 / 벗은 것을 만든다.
   *   ★★ **스냅숏에 있던 아이템**으로만 한다. 신품 전리품으로 흔들면 서버가 «없다»(404)
   *     로 보고 그건 애초에 안 막는 경우라 — 위험을 하나도 안 만든 판이 된다.
   *     처음에 그렇게 짜서 «0% 막힘» 이 나왔다. 판이 틀리면 검사가 거짓말한다. */
  const old = new Set((snap.items || []).map((r) => r.uid));
  const idx = State.itemsById(st.items);
  let equipped = 0;
  for (const m of st.roster) {
    for (const it of st.items) {
      if (it.equippedBy || equipped >= 6 || !old.has(it.uid)) continue;
      if (Gear.equipIssue(m, it, null, (u) => idx[u] || null)) continue;
      const r = Gear.equipItem(st, m, it, null);
      if (r && r.ok) equipped++;
    }
  }
  /* 스냅숏 때 «끼고 있던» 것을 벗긴다 — 서버는 아직 «끼고 있다» 고 안다 */
  let off = 0;
  for (const r0 of (snap.items || [])) {
    if (off >= 3 || !r0.equipped_by) continue;
    const m = st.roster.find((x) => x.uid === r0.equipped_by);
    if (!m) continue;
    const slot = Object.keys(m.equipment || {}).find((k) => m.equipment[k] === r0.uid);
    if (!slot) continue;
    const r = Gear.unequipSlot(st, m, slot);
    if (r && r.ok) off++;
  }
  /* ③ 스냅숏에 있던 것의 **잠금을 푼다** — 서버는 아직 «잠겼다» 고 안다 */
  let unlocked = 0;
  for (const r0 of (snap.items || [])) {
    if (unlocked >= 3) break;
    const it = st.items.find((x) => x.uid === r0.uid);
    if (!it || !r0.locked) continue;
    it.locked = false;
    unlocked++;
  }
  /* 잠금이 하나도 없었으면 **먼저 잠근 판을 만들어** 다시 푼다 (판을 실하게) */
  let locked = 0;
  if (!unlocked) {
    for (const r0 of (snap.items || [])) {
      if (locked >= 3) break;
      const it = st.items.find((x) => x.uid === r0.uid);
      if (!it || it.equippedBy) continue;
      /* 서버 사본 쪽만 잠근다 — «클라는 안 잠갔는데 서버는 잠겼다» 를 만든다 */
      const srvRow = view0.items.get(r0.uid);
      if (srvRow) { srvRow.locked = true; locked++; }
    }
  }
  console.log(`판을 흔들었다: 레벨 +45 · 새로 낀 것 ${equipped} · 벗은 것 ${off} · 서버만 잠긴 것 ${locked} · 푼 것 ${unlocked}`);
}
console.log(`논 뒤:        ${st.day}일차 · 명부 ${st.roster.length} · 아이템 ${st.items.length} (의뢰 ${played}건)`);
console.log('-'.repeat(78));

/* ── 지금 «정직하게» 할 수 있는 조작을 전부 모은다 ─────────────────────── */
const itemsById = State.itemsById(st.items);
const honestSell = st.items.filter((it) => Gear.isSellable(it, st)).map((it) => it.uid);
const honestEquip = [];
for (const m of st.roster) {
  for (const it of st.items) {
    if (it.equippedBy) continue;
    const issue = Gear.equipIssue(m, it, null, (uid) => itemsById[uid] || null);
    if (!issue) honestEquip.push({ mercUid: m.uid, itemUid: it.uid });
  }
}
console.log(`지금 정직하게 팔 수 있는 것 ${honestSell.length}점 · 낄 수 있는 조합 ${honestEquip.length}가지`);

/* ── 서버(낡은 사본)가 그것들을 어떻게 볼까 ─────────────────────────────── */
const sellBlock = { 없다: 0, 착용중: 0, 팔수없다: 0 };
for (const uid of honestSell) {
  const r = view0.items.get(uid);
  if (!r) { sellBlock.없다++; continue; }
  if (r.equippedBy) { sellBlock.착용중++; continue; }
  if (!Gear.isSellable(r, view0.srv)) { sellBlock.팔수없다++; }
}
const sellBlocked = sellBlock.없다 + sellBlock.착용중 + sellBlock.팔수없다;

const eqBlock = { 단원없다: 0, 장비없다: 0, 판정거절: 0 };
const eqReasons = {};
const srvItemsById = State.itemsById(view0.srv.items || []);
for (const { mercUid, itemUid } of honestEquip) {
  const m = view0.mercs.get(mercUid);
  const it = view0.items.get(itemUid);
  if (!m) { eqBlock.단원없다++; continue; }
  if (!it) { eqBlock.장비없다++; continue; }
  const issue = Gear.equipIssue(m, it, null, (uid) => srvItemsById[uid] || null);
  if (issue) { eqBlock.판정거절++; eqReasons[issue] = (eqReasons[issue] || 0) + 1; }
}
/* ★ «없다» 는 404 로 오고 **막지 않기로** 돼 있다 (§146). 진짜 위험은 409 다. */
const eq409 = eqBlock.판정거절;

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '-');
console.log('');
console.log('판매 — 서버가 거절할 것:');
console.log(`  없다(404, 안 막음)  ${sellBlock.없다}  ·  착용 중  ${sellBlock.착용중}  ·  팔 수 없다  ${sellBlock.팔수없다}`);
console.log(`  ⇒ 409 로 막힐 것: ${sellBlock.착용중 + sellBlock.팔수없다} / ${honestSell.length} (${pct(sellBlock.착용중 + sellBlock.팔수없다, honestSell.length)})`);
console.log('착용 — 서버가 거절할 것:');
console.log(`  장비 없다(404, 안 막음) ${eqBlock.장비없다}  ·  단원 없다 ${eqBlock.단원없다}`);
console.log(`  ⇒ 409 로 막힐 것: ${eq409} / ${honestEquip.length} (${pct(eq409, honestEquip.length)})`);
for (const [k, v] of Object.entries(eqReasons).slice(0, 5)) console.log(`      · ${k} — ${v}건`);

console.log('='.repeat(78));
let fails = 0;
const need = (c, m) => { if (!c) { fails++; console.log(`  ✗ ${m}`); } else console.log(`  ✓ ${m}`); };
need(played >= 3, `판이 실하다 — 의뢰 ${played}건을 실제로 돌았다`);
need(st.items.length > snap.items.length, `논 뒤에 아이템이 늘었다 (${snap.items.length} → ${st.items.length})`);
need(honestSell.length >= 5 && honestEquip.length >= 5, '정직한 조작 표본이 충분하다');
need(sellBlock.착용중 + sellBlock.팔수없다 === 0, '낡은 사본이 정직한 판매를 안 막는다');
need(eq409 === 0, '낡은 사본이 정직한 착용을 안 막는다');
console.log(fails ? `❌ ${fails}건 — 이대로 «서버가 결정» 으로 바꾸면 정상 플레이어가 막힌다`
  : '✅ 낡은 사본으로도 정직한 조작이 안 막힌다');
process.exit(fails ? 1 : 0);
