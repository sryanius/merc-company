/**
 * 엔드게임 잣대 — 「Lv80 풀장비 고정 부대」로 도시 등급별 의뢰를 잰다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 따로 필요한가 — `balance.mjs` 는 부대를 **퀘스트 권장 레벨에 맞춰** 만든다.
 *   그건 «제때 도착한 플레이어» 의 경험이고, **«레벨 상한을 찍은 플레이어» 는 거기 안 잡힌다.**
 *   실제로 balance 가 전 랭크 통과인데도 제작자의 Lv80 풀장비 부대에겐
 *   5등급 도시 의뢰가 전부 「식은 죽 먹기」였다 (HANDOFF §36).
 *
 * ★ 목표: 5등급 도시라면 엔드게임 부대에게도 **완주율 40~70%** 여야 한다.
 *   1등급 도시가 쉬운 건 정상이다 — 거긴 이미 지나온 곳이다.
 *
 * 실행: node tools/endgame.mjs [--n=7]
 * 종료 코드: 5등급 도시가 목표 대역을 벗어나면 1
 */
import * as St from '../src/game/state.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import * as E from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Q from '../src/game/quest.js';
import * as Merc from '../src/game/merc.js';
import { RNG } from '../src/core/rng.js';

E.setSkillResolver(getSkill);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const N = parseInt(arg('n', '7'), 10);

const SQUAD4 = ['bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex', 'masterarcher_apex', 'archmage_apex', 'highpriest_abyss'];
const SLOTS = ['mainhand', 'offhand', 'head', 'body', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];

/** 제작자 실제 스펙에 맞춘 부대: 4차 · Lv80 · 10칸 전설급 */
function endgameSquad(grade = 'A') {
  St.newGame(4242, '엔드게임');
  const st = St.state;
  st.roster = []; st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  const rng = new RNG(20260731);
  SQUAD4.forEach((c, i) => {
    const m = { uid: `x_${i}`, name: getClass(c).name, classId: c, level: 80, grade, equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 };
    for (const s of SLOTS) {
      const it = St.rollLoot({ ilvl: 80, rarityBonus: 3, rng });
      if (it) { st.items.push(it); m.equipment[it.slot || s] = it.uid; }
    }
    st.roster.push(m);
    sq.memberUids[i] = `x_${i}`;
  });
  return st;
}
const powerOf = (st) => { const idx = St.itemsById(st.items); return Math.round(st.roster.reduce((a, m) => a + Merc.mercPower(m, { items: idx }), 0)); };
function mix(i) { let z = (i + 0x9e3779b9) >>> 0; z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0; z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0; return (z ^ (z >>> 15)) >>> 0 || 1; }

/** 의뢰를 끝까지 (웨이브 인계 포함) */
function clear(st, q, n) {
  const id = st.squads[0].id;
  let w = 0;
  for (let i = 0; i < n; i++) {
    let carry = null; let ok = true;
    for (let k = 0; k < q.waves.length; k++) {
      const cfg = Q.questBattleDefs(q, k, st, id);
      const a = Q.applyWaveCarry(cfg.allies, carry);
      if (!a.length) { ok = false; break; }
      const b = E.createBattle({ ...cfg, allies: a, seed: mix(i * 31 + k) });
      b.run();
      if (b.result.winner !== 'ally') { ok = false; break; }
      carry = Q.readWaveCarry(b.units, carry || {});
    }
    if (ok) w++;
  }
  return w / n;
}

const CITIES = [['greenhold', 1], ['gullport', 2], ['stonewatch', 3], ['dunehold', 4], ['frostgate', 5]];
const st = endgameSquad('A');
console.log(`엔드게임 잣대 — 4차 Lv80 A등급 · 10칸 전설 (전투력 ${powerOf(st)})`);
console.log('='.repeat(72));
console.log('\n  도시등급  배율   의뢰수  평균Lv  완주율   랭크별 완주율');

let topS = null;
for (const [cid, tier] of CITIES) {
  const qs = [];
  /* ★ 표본을 넉넉히 뽑는다. 처음에는 12라운드 × 앞에서 24건만 잘라 썼는데,
   *   그러면 S랭크가 한두 건뿐이라 **판정이 표본 운에 좌우된다** —
   *   실제로 의뢰 목록 길이를 바꿨더니(난수 소비가 달라져 다른 의뢰가 뽑힘)
   *   5등급 S가 62% → 100% 로 튀었다. 곡선이 아니라 표본이 바뀐 것이다.
   *   랭크별로 최대 12건씩 확보한다. */
  for (let s = 0; s < 40; s++) qs.push(...Q.genQuests(cid, 30 + s * 5, new RNG(4200 + s), 3));
  const perRank = {};
  const list = [];
  for (const q of qs) {
    if (q.elite) continue;
    perRank[q.rank] = (perRank[q.rank] || 0) + 1;
    if (perRank[q.rank] <= 12) list.push(q);
  }
  if (!list.length) continue;
  let sum = 0; let lv = 0;
  const byRank = {};
  for (const q of list) {
    const r = clear(st, q, N);
    sum += r; lv += q.level;
    (byRank[q.rank] ||= []).push(r);
  }
  const avg = sum / list.length;
  // ★ 평균이 아니라 그 도시의 «최고 랭크» 로 판정한다 — 저랭크는 만렙 부대에게
  //   어떤 배율을 곱해도 안 위험하다 (HP 풀 차이, HANDOFF §37). 평균을 목표에 맞추려면
  //   저랭크까지 죽을 만큼 올려야 하고 그러면 «제때 도착한 플레이어» 가 못 논다.
  if (tier === 5 && byRank.S && byRank.S.length) topS = byRank.S.reduce((a, b) => a + b, 0) / byRank.S.length;
  const rk = Object.keys(byRank).sort().map((k) => `${k} ${(byRank[k].reduce((a, b) => a + b, 0) / byRank[k].length * 100).toFixed(0)}%`).join(' · ');
  console.log(`  ${tier}등급     ${(list[0].cityPower || 1).toFixed(2)}    ${String(list.length).padStart(3)}    ${(lv / list.length).toFixed(0).padStart(4)}   ${(avg * 100).toFixed(0).padStart(4)}%   ${rk}`);
}

console.log('\n' + '─'.repeat(72));
if (topS == null) { console.log('❌ 5등급 도시의 S랭크를 재지 못했다.'); process.exit(1); }
const pct = (topS * 100).toFixed(0);
if (topS >= 0.40 && topS <= 0.70) {
  console.log(`✅ 5등급 S랭크 완주율 ${pct}% — 엔드게임 부대에게도 도전이 된다 (목표 40~70%).`);
  process.exit(0);
}
console.log(`❌ 5등급 S랭크 완주율 ${pct}% (목표 40~70%).`);
console.log(topS > 0.70
  ? '   상한을 찍은 부대에게 너무 쉽다 — CITY_POWER[5] 나 보스 등장률을 올려라.'
  : '   과하다 — CITY_POWER[5] 를 낮춰라.');
process.exit(1);
