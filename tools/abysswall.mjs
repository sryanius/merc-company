/**
 * 황금 나락 — 「세트 단 → 벽」 계측 (§173 · 500심층 곡선 설계용)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 생겼나
 *   제작자 요구: 「2단 세트를 어느 정도 맞추면 200언저리, 3단 세트면 300언저리,
 *   영웅 + 3단이면 500언저리」. 그러려면 먼저 **지금 곡선에서** 각 단의 부대가 어디서
 *   멈추는지, 그리고 그 심층의 **배율이 얼마인지** 알아야 한다 — 곡선은 배율↔심층 사상일 뿐이라
 *   «단 N 부대가 버티는 배율» 만 재면 심층은 앵커로 옮길 수 있다.
 *
 * ★ 두 가지 벽을 잰다 — 소탕(§173)이 생기면서 둘이 갈라졌다
 *   · 연속 벽  : 1심층부터 (심층마다 만피 · §178) 연속으로 이겨 내려가다 처음 지는 심층 (tools/abyss.mjs 와 같다)
 *   · 단판 벽  : **만피로** 그 심층 하나만 쳤을 때의 승률. 소탕 뒤에는 «기록+1» 부터 만피로 서므로
 *               주마다 여기까지 기어 올라간다. 25% 이하로 떨어지는 첫 심층을 벽으로 본다.
 *
 * 실행: node tools/abysswall.mjs [--n=4] [--from=40] [--step=10] [--only=t2] [--p500=60]
 */
import * as Abyss from '../src/game/abyss.js';
import * as Sets from '../src/data/sets.js';
import { getClass } from '../src/data/classes.js';
import { setup, powerOf, DEEP_ROSTER, DEEP_FID } from './abysspower.mjs';
import { depthPower, DEPTH_CAP, POWER_ANCHORS, setPowerAnchors } from '../src/data/abyss.js';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '4'), 10);
const FROM = parseInt(arg('from', '40'), 10);
const STEP = parseInt(arg('step', '10'), 10);
const ONLY = arg('only', '');
/* --p500=60  500 앵커를 실행 중에 바꿔 벽이 500 을 넘는 부대의 «버티는 배율» 을 잰다 (§180) */
const P500 = Number(arg('p500', '0'));
if (P500 > 0) setPowerAnchors(POWER_ANCHORS.map(([d, p]) => (d === DEPTH_CAP ? [d, P500] : [d, p])));

const SQUAD4 = [
  'bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
  'masterarcher_apex', 'archmage_apex', 'highpriest_abyss',
];

function baseSetForArch(arch) {
  const hit = Sets.BASE_SET_LIST.find((s) => s.archs.includes(arch) && s.archs.length < Sets.ALL_ARCHS.length);
  return (hit || Sets.getSet('constellation')).id;
}
function rosterAt(tier, classes = SQUAD4, setOf = null) {
  return classes.map((classId, i) => {
    const base = setOf ? setOf[i] : baseSetForArch((getClass(classId) || {}).arch);
    return { classId, setId: Sets.setIdAtTier(base, tier) || base };
  });
}
function deepAt(tier) {
  return DEEP_ROSTER.map((r) => ({ classId: r.classId, setId: Sets.setIdAtTier(r.setId, tier) || r.setId }));
}

const CONFIGS = [
  { key: 't1', label: '1단 풀세트 Lv80 A', o: { roster: rosterAt(1), level: 80, grade: 'A', gear: 'sets', setIlvl: 80 } },
  { key: 't1p', label: '1단 풀세트 Lv80 A +중급펫', o: { roster: rosterAt(1), level: 80, grade: 'A', gear: 'sets', setIlvl: 80, pets: 'mid' } },
  { key: 't2', label: '2단 풀세트 Lv80 A', o: { roster: rosterAt(2), level: 80, grade: 'A', gear: 'sets', setIlvl: 80 } },
  { key: 't2p', label: '2단 풀세트 Lv80 A +중급펫', o: { roster: rosterAt(2), level: 80, grade: 'A', gear: 'sets', setIlvl: 80, pets: 'mid' } },
  { key: 't3', label: '3단 풀세트 Lv80 A', o: { roster: rosterAt(3), level: 80, grade: 'A', gear: 'sets', setIlvl: 80 } },
  { key: 't3p', label: '3단 풀세트 Lv80 A +중급펫', o: { roster: rosterAt(3), level: 80, grade: 'A', gear: 'sets', setIlvl: 80, pets: 'mid' } },
  { key: 't3s', label: '3단 풀세트 Lv80 S +펫S', o: { roster: rosterAt(3), level: 80, grade: 'S', gear: 'sets', setIlvl: 80, pets: 'max' } },
  { key: 'd1', label: '최심편성 1단 Lv80 S +펫S', o: { roster: deepAt(1), level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: DEEP_FID, pets: 'max' } },
  { key: 'd3', label: '최심편성 3단 Lv80 S +펫S', o: { roster: deepAt(3), level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: DEEP_FID, pets: 'max' } },
  /* §174 영웅 부대 — 각성(Lv100 · 고유 스킬 둘). 제작자 목표: 「영웅 + 3단이면 500언저리」 */
  { key: 'h1', label: '영웅 1단 Lv100 +중급펫', o: { roster: rosterAt(1), level: 100, grade: 'S', gear: 'sets', setIlvl: 80, pets: 'mid', hero: true } },
  { key: 'h3', label: '영웅 3단 Lv100 +중급펫', o: { roster: rosterAt(3), level: 100, grade: 'S', gear: 'sets', setIlvl: 80, pets: 'mid', hero: true } },
  { key: 'h3s', label: '영웅 3단 Lv100 +펫S', o: { roster: rosterAt(3), level: 100, grade: 'S', gear: 'sets', setIlvl: 80, pets: 'max', hero: true } },
  { key: 'h80', label: '영웅(미각성) 3단 Lv80 +중급펫', o: { roster: rosterAt(3), level: 80, grade: 'S', gear: 'sets', setIlvl: 80, pets: 'mid', hero: true, unawakened: true } },
];

/** 1심층부터 연속 잠수(심층마다 만피) — 첫 패배 심층 (N회) */
function carryDive(o) {
  const st = setup(o);
  const sq = st.squads[0];
  const reached = [];
  for (let i = 0; i < N; i++) {
    st.day = 1 + i * 337;
    st.abyss = { best: 0, bestDay: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0, run: null };
    st.gold = 0;
    for (const m of st.roster) { m.hp = 0; m.woundUntil = 0; m.status = 'idle'; }
    const r = Abyss.dive(st, sq.id, { force: true });
    reached.push(r.reached);
  }
  return { power: powerOf(st), reached };
}

/** 만피 단판 승률 — 심층 d 를 N번 (날짜를 바꿔 시드를 바꾼다) */
function freshWinRate(st, d) {
  const sq = st.squads[0];
  let w = 0;
  for (let i = 0; i < N; i++) {
    st.day = 1 + i * 337;
    for (const m of st.roster) { m.hp = 0; m.woundUntil = 0; m.status = 'idle'; }
    const r = Abyss.runDepth(st, sq.id, d, null);
    if (r.win) w++;
  }
  return w / N;
}

/** 단판 벽 — 25% 이하로 처음 떨어지는 심층과 0% 가 두 번 연속인 심층 */
function freshWall(o) {
  const st = setup(o);
  let wall25 = null, wall0 = null, zeros = 0;
  const curve = [];
  for (let d = FROM; d <= DEPTH_CAP; d += STEP) {
    const wr = freshWinRate(st, d);
    curve.push([d, wr]);
    if (wall25 == null && wr <= 0.25) wall25 = d;
    if (wr === 0) { zeros++; if (zeros >= 2 && wall0 == null) wall0 = d - STEP; } else zeros = 0;
    if (wall0 != null) break;
  }
  return { wall25, wall0, curve };
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`황금 나락 벽 계측 — 각 ${N}회 · 단판은 ${FROM}심층부터 ${STEP}씩 (DEPTH_CAP ${DEPTH_CAP})`);
console.log('='.repeat(100));
console.log('구성                          전력    연속평균  최저~최고   단판벽25%  (배율)   단판벽0%  (배율)');
console.log('-'.repeat(100));
for (const c of CONFIGS) {
  if (ONLY && !ONLY.split(',').includes(c.key)) continue;
  const cd = carryDive(c.o);
  const fw = freshWall(c.o);
  const p25 = fw.wall25 ? depthPower(fw.wall25).toFixed(2) : '-';
  const p0 = fw.wall0 ? depthPower(fw.wall0).toFixed(2) : '-';
  console.log(
    `${c.label.padEnd(28)} ${cd.power.toLocaleString().padStart(8)}  ${avg(cd.reached).toFixed(1).padStart(7)}   ${String(Math.min(...cd.reached)).padStart(3)}~${String(Math.max(...cd.reached)).padEnd(4)}  `
    + `${String(fw.wall25 ?? '-').padStart(7)}   (${p25})   ${String(fw.wall0 ?? '-').padStart(6)}   (${p0})`,
  );
  console.log(`    승률: ${fw.curve.map(([d, w]) => `${d}:${Math.round(w * 100)}`).join(' ')}`);
}
