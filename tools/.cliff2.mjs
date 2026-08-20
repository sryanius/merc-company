/**
 * 임시 계측기 2 — (a) 배율 손잡이가 실제 레벨/등급 차이와 같은지 검증
 *                 (b) 전투 길이를 직접 조절해 절벽 폭과의 인과를 본다
 * 끝나면 삭제한다.
 */
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { setSkillResolver, simulate } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Abyss from '../src/game/abyss.js';
import { questBattleDefs } from '../src/game/quest.js';

setSkillResolver(getSkill);   // ★ 필수

const PW = { hp: 0.14, atk: 2.6, def: 1.5, res: 1.3, spd: 1.6, crit: 2.2, critDmg: 0.5, eva: 1.8 };
const SCAL = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT = ['crit', 'critDmg', 'eva'];
const SQUAD7 = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'highpriest'];

function setup(classes, level, grade, seed) {
  State.newGame(seed, `v${seed}`);
  const st = State.state;
  st.roster = []; st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  classes.forEach((classId, i) => {
    st.roster.push({ uid: `u_${i}`, name: getClass(classId).name, classId, level, grade, equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 });
    sq.memberUids[i] = `u_${i}`;
  });
  for (const m of st.roster) m.hp = 0;
  return st;
}

/** ★ 만든 직후에 값으로 꺼낸다 (State.state 싱글턴) */
function build(level, grade, seed) {
  const st = setup(SQUAD7, level, grade, seed);
  const sqId = st.squads[0].id;
  const allies = questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies;
  return { units: allies.map((u) => ({ ...u, stats: { ...u.stats } })), rosterPower: st.roster.reduce((a, m) => a + Merc.mercPower(m, null), 0) };
}

const powerOf = (units) => {
  let scal = 0; let flat = 0;
  for (const u of units) {
    for (const k of SCAL) scal += (u.stats[k] || 0) * PW[k];
    for (const k of FLAT) flat += (u.stats[k] || 0) * PW[k];
  }
  return { scal, flat, power: scal + flat };
};
const scaleKeys = (units, m, keys = SCAL) => units.map((u) => {
  const s = { ...u.stats };
  for (const k of keys) s[k] = (s[k] || 0) * m;
  return { ...u, stats: s, hp: Math.max(1, Math.round(s.hp)) };
});

function duel(A, B, n, seed0 = 9001) {
  let win = 0; let tsum = 0;
  for (let i = 0; i < n; i++) {
    const res = simulate({
      allies: A.map((u) => ({ ...u, stats: { ...u.stats } })),
      enemies: B.map((u, k) => ({ ...u, stats: { ...u.stats }, uid: `e_${k}`, side: 'enemy' })),
      allyFormationId: 'basic', enemyFormationId: 'basic',
      seed: (seed0 + i * 7919) >>> 0,
    });
    if (res.winner === 'ally') win++;
    tsum += res.time;
  }
  return { wr: win / n, tAvg: tsum / n };
}

/* ═══ (a) 손잡이 검증 — 같은 전투력비를 '레벨차'/'등급차'/'배율'로 만들면 결과가 같은가 ═══ */
console.log('(a) 손잡이 검증 — 같은 전투력비를 다른 방법으로 만들면 승률이 같은가  (각 500판)');
console.log('    아군 = 3차 7인 B등급 Lv80 고정');
const ME = build(80, 'B', 1000);
const MEp = powerOf(ME.units);
console.log(`    아군 전투력 ${Math.round(MEp.power)} (roster mercPower ${ME.rosterPower})\n`);
console.log('    만드는 법            전투력비   승률    평균전투');
const rows = [];
for (const lv of [70, 74, 76, 78, 79, 80, 81, 82, 84, 88]) {
  if (lv > 80) continue;
  const EN = build(lv, 'B', 2000);
  const ep = powerOf(EN.units);
  const ratio = MEp.power / ep.power;
  const d = duel(ME.units, EN.units, 500);
  rows.push({ tag: `적 Lv${lv}`, ratio, wr: d.wr, t: d.tAvg, kind: 'level' });
}
for (const g of ['C', 'B', 'A']) {
  const EN = build(80, g, 3000);
  const ep = powerOf(EN.units);
  const ratio = MEp.power / ep.power;
  const d = duel(ME.units, EN.units, 500);
  rows.push({ tag: `적 ${g}등급`, ratio, wr: d.wr, t: d.tAvg, kind: 'grade' });
}
rows.sort((a, b) => a.ratio - b.ratio);
for (const r of rows) {
  // 같은 비율을 배율 손잡이로 재현
  const m = (MEp.power / r.ratio - MEp.flat) / MEp.scal;
  const d2 = duel(ME.units, scaleKeys(ME.units, m), 500);
  console.log(`    ${r.tag.padEnd(10)}${r.kind === 'level' ? '(레벨차)' : '(등급차)'}  ${r.ratio.toFixed(4)}  ${(r.wr * 100).toFixed(1).padStart(5)}%  ${r.t.toFixed(1).padStart(5)}초`);
  console.log(`      └ 같은 비율을 배율로       ${r.ratio.toFixed(4)}  ${(d2.wr * 100).toFixed(1).padStart(5)}%  ${d2.tAvg.toFixed(1).padStart(5)}초   차이 ${((d2.wr - r.wr) * 100).toFixed(1).padStart(5)}%p`);
}

/* ═══ (b) 전투 길이 → 절벽 폭 (양쪽 hp 를 같이 늘려 전투만 길게 만든다) ═══ */
console.log('\n\n(b) 전투 길이만 바꾸면 절벽 폭이 달라지는가');
console.log('    양쪽 hp 에 같은 계수 k 를 곱해 전투 길이만 조절한다 (전투력비는 그대로 1.00 기준).');
console.log('    k     거울전투(초)   10%비    50%비    90%비   10~90폭');
const kRes = [];
for (const k of [0.25, 0.4, 0.6, 1.0, 1.6, 2.5, 4.0, 6.0]) {
  const base = scaleKeys(ME.units, k, ['hp']);
  const bp = powerOf(base);
  const mirror = duel(base, base, 300, 555);
  const at = (r) => duel(base, scaleKeys(base, (bp.power / r - bp.flat) / bp.scal), 400).wr;
  // 0.002 단위로 훑어 10/50/90 을 보간
  const pts = [];
  for (let r = 0.93; r <= 1.075; r += 0.002) {
    const rr = Math.round(r * 1000) / 1000;
    pts.push({ r: rr, wr: at(rr) });
    if (pts.length > 4 && pts[pts.length - 1].wr >= 0.995 && pts[pts.length - 2].wr >= 0.995) break;
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
  kRes.push({ k, t: mirror.tAvg, c10, c50, c90, w });
  console.log(`    ${String(k).padStart(4)}  ${mirror.tAvg.toFixed(1).padStart(7)}      ${c10 != null ? c10.toFixed(4) : '  -   '}  ${c50 != null ? c50.toFixed(4) : '  -   '}  ${c90 != null ? c90.toFixed(4) : '  -   '}  ${w != null ? w.toFixed(4) : '-'}`);
}
{
  const ok = kRes.filter((x) => x.w != null);
  const xs = ok.map((x) => x.t); const ys = ok.map((x) => x.w);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  console.log(`\n    전투길이 vs 절벽폭  피어슨 r = ${(num / Math.sqrt(dx * dy)).toFixed(3)}  (n=${xs.length})`);
}
