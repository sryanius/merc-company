/**
 * 임시 계측기 4 — 거울 대결이 아니라 **실제 의뢰의 진짜 몬스터**를 상대로 절벽을 잰다.
 * (거울 대결에서만 좁은 것 아니냐는 반론을 막기 위한 외부 타당성 검사)
 * 끝나면 삭제한다.
 */
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { setSkillResolver, simulate } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { genQuests, questBattleDefs } from '../src/game/quest.js';
import { RNG } from '../src/core/rng.js';

setSkillResolver(getSkill);   // ★ 필수

const PW = { hp: 0.14, atk: 2.6, def: 1.5, res: 1.3, spd: 1.6, crit: 2.2, critDmg: 0.5, eva: 1.8 };
const SCAL = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT = ['crit', 'critDmg', 'eva'];
const SQUAD7 = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'highpriest'];

State.newGame(4242, '계측');
{
  const st = State.state;
  st.roster = []; st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD7.forEach((classId, i) => {
    st.roster.push({ uid: `u_${i}`, name: getClass(classId).name, classId, level: 80, grade: 'B', equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 });
    sq.memberUids[i] = `u_${i}`;
  });
  for (const m of st.roster) m.hp = 0;
}
const st = State.state;
const sqId = st.squads[0].id;

const powerOf = (units) => {
  let scal = 0; let flat = 0;
  for (const u of units) { for (const k of SCAL) scal += (u.stats[k] || 0) * PW[k]; for (const k of FLAT) flat += (u.stats[k] || 0) * PW[k]; }
  return { scal, flat, power: scal + flat };
};
const scaleUnits = (units, m) => units.map((u) => {
  const s = { ...u.stats };
  for (const k of SCAL) s[k] = (s[k] || 0) * m;
  return { ...u, stats: s, hp: Math.max(1, Math.round(s.hp)) };
});

function duel(A, B, n, seed0 = 9001) {
  let win = 0; let tsum = 0;
  for (let i = 0; i < n; i++) {
    const res = simulate({
      allies: A.map((u) => ({ ...u, stats: { ...u.stats } })),
      enemies: B.map((u, k) => ({ ...u, stats: { ...u.stats }, uid: `e_${k}`, side: 'enemy' })),
      allyFormationId: 'basic', enemyFormationId: 'basic', seed: (seed0 + i * 7919) >>> 0,
    });
    if (res.winner === 'ally') win++;
    tsum += res.time;
  }
  return { wr: win / n, t: tsum / n };
}

// 실제 의뢰를 뽑는다 (도시/일자별 생성기 그대로)
const quests = [];
for (const city of ['emberwell', 'deepdelve', 'blackreed', 'stonewatch']) {
  const qs = genQuests(city, 300, new RNG(1000 + city.length * 77), 1) || [];
  for (const q of qs) if (q && q.waves && q.waves.length) quests.push({ day: 300, q });
}
// 랭크가 높은 것부터 — 아군(Lv80 3차)에게 말이 되는 상대만 본다
quests.sort((a, b) => 'FEDCBAS'.indexOf(b.q.rank) - 'FEDCBAS'.indexOf(a.q.rank));
console.log(`실제 의뢰 상대 절벽 (아군 3차 7인 B등급 Lv80 고정) — 의뢰 ${quests.length}건 중 앞 8건`);
console.log('='.repeat(100));
console.log('  의뢰                          적수  전투력비   10%비    50%비    90%비   10~90폭  거울시간');

const widths = [];
for (const { day, q } of quests.slice(0, 8)) {
  let defs;
  try { defs = questBattleDefs(q, 0, st, sqId); } catch { continue; }
  const A = defs.allies.map((u) => ({ ...u, stats: { ...u.stats } }));
  const E = defs.enemies.map((u) => ({ ...u, stats: { ...u.stats } }));
  const ap = powerOf(A); const ep = powerOf(E);
  const base = ap.power / ep.power;                    // 원래 이 의뢰의 전투력비
  const at = (r, n = 300) => duel(A, scaleUnits(E, (ap.power / r - ep.flat) / ep.scal), n);
  // 1) 거친 스윕으로 전환 구간을 찾는다
  let lo = 0.40; let hi = 2.60;
  const coarse = [];
  for (let r = 0.40; r <= 2.601; r += 0.05) { const rr = Math.round(r * 100) / 100; coarse.push({ r: rr, wr: at(rr, 30).wr }); }
  for (const c of coarse) if (c.wr <= 0.02) lo = c.r;
  for (let i = coarse.length - 1; i >= 0; i--) if (coarse[i].wr >= 0.98) hi = coarse[i].r;
  if (hi <= lo || hi - lo > 0.40) {
    // 전환 구간을 못 잡았다 (윈도 밖 또는 너무 넓음) — 이 의뢰는 건너뛴다
    const nmX = `${q.rank || '?'}랭 ${(q.name || q.id).slice(0, 14)}`;
    console.log(`  ${nmX.padEnd(28)} ${String(E.length).padStart(3)}  ${base.toFixed(3).padStart(7)}   (전환 구간 미포착: 거친스윕 ${lo.toFixed(2)}~${hi.toFixed(2)})`);
    continue;
  }
  // 2) 0.002 단위 정밀 스윕
  const pts = [];
  for (let r = Math.max(0.20, lo - 0.03); r <= hi + 0.03 + 1e-9; r += 0.002) {
    const rr = Math.round(r * 1000) / 1000;
    pts.push({ r: rr, ...at(rr) });
  }
  const cross = (p) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].wr < p && pts[i].wr >= p) {
        const a = pts[i - 1]; const b = pts[i];
        return a.r + (p - a.wr) * (b.r - a.r) / (b.wr - a.wr);
      }
    }
    return null;
  };
  const c10 = cross(0.10); const c50 = cross(0.50); const c90 = cross(0.90);
  const w = (c10 != null && c90 != null) ? c90 - c10 : null;
  const mid = c50 != null ? duel(A, scaleUnits(E, (ap.power / c50 - ep.flat) / ep.scal), 300) : { t: 0 };
  if (w != null) widths.push(w);
  const nm = `${q.rank || '?'}랭 ${(q.name || q.id).slice(0, 14)}`;
  console.log(`  ${nm.padEnd(28)} ${String(E.length).padStart(3)}  ${base.toFixed(3).padStart(7)}  ${c10 != null ? c10.toFixed(4) : '  -   '}  ${c50 != null ? c50.toFixed(4) : '  -   '}  ${c90 != null ? c90.toFixed(4) : '  -   '}  ${w != null ? w.toFixed(4) : '  -   '}  ${mid.t.toFixed(1).padStart(5)}초`);
}
if (widths.length) {
  const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
  console.log(`\n  실제 의뢰 ${widths.length}건 평균 10~90% 폭 = ${avg.toFixed(4)} (최소 ${Math.min(...widths).toFixed(4)} / 최대 ${Math.max(...widths).toFixed(4)})`);
}
