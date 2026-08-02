/**
 * 무한의 탑 난이도 계측기
 * ────────────────────────────────────────────────────────────────
 * 요구 목표:
 *   · 1층   = 평균 Lv80 부대가 **쉽게** 클리어
 *   · 500층 = 세트 풀셋 + 저등급 펫이 어느 정도 있어야 **간신히**
 *
 * ★ 이 도구는 아군 편성을 **직접 조립하지 않는다.** `game/tower.js` 가 실제로 쓰는 경로
 *   (합성 의뢰 → questBattleDefs)를 그대로 탄다. 9차 세션에 자체 조립기가 세트 고유효과를
 *   빠뜨려 "풀세트를 반쪽 성능으로 재던" 사고가 있었다 — 진짜 상태(state)를 만들어
 *   거기에 장비를 입히고 펫을 배치하는 쪽이 그 사고를 구조적으로 못 내게 한다.
 *
 * 실행: node tools/tower.mjs [--floors=1,50,...] [--n=30]
 */
import * as State from '../src/game/state.js';
import * as Tower from '../src/game/tower.js';
import * as Pet from '../src/game/pet.js';
import * as Gear from '../src/game/gear.js';
import * as Sets from '../src/data/sets.js';
import { getClass } from '../src/data/classes.js';
import { setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { floorPower, floorEnemyCount, dropChance, TOWER_FLOORS } from '../src/data/tower.js';

// ★ 이걸 빼먹으면 스킬이 전부 사라져 승률이 통째로 틀린다 (6차 세션 사고)
setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const FLOORS = String(arg('floors', '1,25,50,100,150,200,250,300,350,400,450,500'))
  .split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);
const N = parseInt(arg('n', '24'), 10);

/* ─────────────────────────── 부대 만들기 ─────────────────────────── */

// tools/dungeon.mjs · setspecial.mjs 와 같은 4차 표준 부대 (아키타입이 전부 다르다)
const SQUAD4 = [
  'bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
  'masterarcher_apex', 'archmage_apex', 'highpriest_abyss',
];
const FILL_ORDER = ['body', 'head', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'weapon', 'offhand'];
const LEVEL = 80;
const GRADE = 'A';

function setForArch(arch) {
  const hit = Sets.SET_LIST.find((s) => s.archs.includes(arch) && s.archs.length < Sets.ALL_ARCHS.length);
  return (hit || Sets.getSet('constellation')).id;
}

/**
 * 실제 게임 상태를 만든다. 장비·펫을 state 에 실으므로 tower.js 가 평소 경로로 읽어 간다.
 * @param {object} o `{sets:boolean, pets:'none'|'low'|'mid'|'full'}`
 */
function setup(o = {}) {
  State.newGame(20260802, '탑계측단');
  const st = State.state;
  st.gold = 99999999;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);

  SQUAD4.forEach((classId, i) => {
    const cls = getClass(classId);
    if (!cls) throw new Error(`클래스 ${classId} 없음 — 도구를 갱신해라`);
    const merc = {
      uid: `tw_a${i}`, name: cls.name, classId, level: LEVEL, grade: GRADE,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    };
    if (o.sets) {
      const setId = setForArch(cls.arch);
      for (const slot of FILL_ORDER) {
        const it = Sets.setPieceItem(setId, slot, LEVEL, { uid: `tw_it_${i}_${slot}` });
        if (!it) continue;
        st.items.push(it);
        merc.equipment[slot] = it.uid;
      }
      // ★ 실제 게임과 같은 진입점으로 고유효과를 싣는다
      Gear.setSpecialsFor(merc, State.itemsById(st.items));
    }
    st.roster.push(merc);
    sq.memberUids[i] = merc.uid;
  });

  // 만피로 시작
  const items = State.itemsById(st.items);
  for (const m of st.roster) m.hp = 0;   // 0 이면 mercStats.hp 로 채워진다(allyUnitDefs 의 clamp)

  sq.petUids = [null, null, null];
  const PET_SETS = {
    low: [['pet_shell', 'D'], ['pet_moss', 'D'], ['pet_lantern', 'C']],
    mid: [['pet_kite', 'C'], ['pet_saint', 'C'], ['pet_banner', 'B']],
    full: [['pet_warden', 'S'], ['pet_chalice', 'A'], ['pet_starcalf', 'A']],
  };
  for (const [sid, g] of (PET_SETS[o.pets] || [])) {
    const p = Pet.makePet(st, sid, g);
    if (!p) continue;
    st.pets.push(p);
    Pet.assignPet(st, sq.id, st.pets.length - 1, p.uid);
  }
  return st;
}

/* ─────────────────────────── 측정 ─────────────────────────── */

/** 한 층을 N 번 (다른 시드로) 돌려 승률·전투시간·남은 체력비를 잰다 */
function measure(st, floor, n) {
  const sq = st.squads[0];
  const baseDay = st.day;
  let win = 0, time = 0, hpLeft = 0;
  for (let i = 0; i < n; i++) {
    st.day = baseDay + i * 337;        // 시드에 day 가 섞여 매번 다른 전투가 된다
    const r = Tower.runFloor(st, sq.id, floor, null);
    if (r.win) {
      win++;
      const maxSum = r.cfg.allies.reduce((a, x) => a + x.stats.hp, 0);
      const cur = Object.values(r.carry).reduce((a, v) => a + v, 0);
      if (maxSum > 0) hpLeft += cur / maxSum;
    }
    time += r.time;
  }
  st.day = baseDay;
  return { rate: win / n, time: time / n, hpLeft: win ? hpLeft / win : 0 };
}

/* ─────────────────────────── 리포트 ─────────────────────────── */

const CONFIGS = [
  { key: '장비없음', o: { sets: false, pets: 'none' } },
  { key: '풀세트', o: { sets: true, pets: 'none' } },
  { key: '+저급펫', o: { sets: true, pets: 'low' } },
  { key: '+중급펫', o: { sets: true, pets: 'mid' } },
  { key: '+고급펫', o: { sets: true, pets: 'full' } },
];

console.log(`무한의 탑 난이도 — Lv80 7인, 층당 ${N}판 (만피 시작 · 이월 없음 기준)`);
console.log('='.repeat(92));
console.log('   층  배율 적수 |' + CONFIGS.map((c) => c.key.padStart(12)).join(' |'));
console.log('-'.repeat(92));

const table = {};
for (const cfg of CONFIGS) {
  const st = setup(cfg.o);
  table[cfg.key] = {};
  for (const f of FLOORS) table[cfg.key][f] = measure(st, f, N);
}

for (const f of FLOORS) {
  const cells = CONFIGS.map((c) => {
    const m = table[c.key][f];
    return `${(m.rate * 100).toFixed(0).padStart(3)}% ${m.time.toFixed(0).padStart(3)}s`.padStart(12);
  });
  console.log(`${String(f).padStart(5)} ${floorPower(f).toFixed(2)} ${String(floorEnemyCount(f)).padStart(3)}  |${cells.join(' |')}`);
}

/* ─────────────── 진짜 지표: 한 런에서 몇 층까지 가나 ───────────────
 * 위 표는 **만피 시작** 기준이라 실제보다 후하다. 탑은 층 사이에 체력이 이월되므로
 * "한 판 승률"이 아니라 "연속으로 몇 층을 버티나"가 난이도를 결정한다.
 * 25층마다 회복 지점이 있다. */

console.log('\n' + '='.repeat(92));
console.log(' 실제 등반 — 1층부터 골드 무한으로 끝까지 (체력 이월 포함)');
console.log('='.repeat(92));

const RUNS = Math.max(4, Math.round(N / 3));
const climbOut = {};
for (const cfg of CONFIGS) {
  const st = setup(cfg.o);
  st.gold = 1e9;                                // 골드는 난이도 축이 아니므로 무한으로 둔다
  const sq = st.squads[0];
  const reached = [];
  let pets = 0;
  for (let i = 0; i < RUNS; i++) {
    st.day = 1 + i * 337;                       // 매달 1일(week1/day1)을 유지한 채 시드만 바꾼다
    st.tower = { best: 0, lastRunDay: 0, lastRunFloor: 0 };
    const r = Tower.climb(st, sq.id, { force: true });
    reached.push(r.reached);
    pets += r.pets.length;
  }
  reached.sort((a, b) => a - b);
  climbOut[cfg.key] = {
    min: reached[0], max: reached[reached.length - 1],
    avg: Math.round(reached.reduce((a, b) => a + b, 0) / reached.length),
    clear: reached.filter((x) => x >= TOWER_FLOORS).length / reached.length,
    pets: pets / RUNS,
  };
}
console.log(`  구성          최저   평균   최고   500완주   런당펫   (${RUNS}회)`);
for (const c of CONFIGS) {
  const o = climbOut[c.key];
  console.log(`  ${c.key.padEnd(12)} ${String(o.min).padStart(5)} ${String(o.avg).padStart(6)} ${String(o.max).padStart(6)} ${(o.clear * 100).toFixed(0).padStart(8)}% ${o.pets.toFixed(1).padStart(8)}`);
}

/* ─────────────────────────── 판정 ─────────────────────────── */

console.log('\n' + '='.repeat(92));
console.log(' 목표 판정');
console.log('='.repeat(92));

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`  [${ok ? 'OK  ' : 'FAIL'}] ${label}\n         ${detail}`);
  if (!ok) fail++;
};

const g = (cfg, f) => (table[cfg] && table[cfg][f]) || null;

const f1 = g('장비없음', 1);
if (f1) check('1층 = 평균 Lv80 부대가 쉽게 (장비 없이 90% 이상)', f1.rate >= 0.90, `${(f1.rate * 100).toFixed(0)}%`);

/* ★ 아래 판정은 전부 **등반 도달 층** 기준이다.
 *   만피 한 판 승률로 재면 안 된다 — 체력 이월 때문에 400층을 100% 이기는 부대가
 *   실제로는 378층에서 멈춘다(실측). 만피 승률은 참고 표일 뿐이다. */

const cSet = climbOut['풀세트'];
const cLow = climbOut['+저급펫'];
const cMid = climbOut['+중급펫'];
const cFull = climbOut['+고급펫'];

if (cSet) check('500층 = 풀세트만으로는 못 깬다 (완주율 10% 미만)',
  cSet.clear < 0.10, `평균 ${cSet.avg}층 · 완주 ${(cSet.clear * 100).toFixed(0)}%`);

if (cLow) check('500층 = 풀세트+저급펫이면 간신히 깬다 (완주율 5~50%)',
  cLow.clear >= 0.05 && cLow.clear <= 0.50, `평균 ${cLow.avg}층 · 완주 ${(cLow.clear * 100).toFixed(0)}%`);

// 펫 배선이 살아 있는가 — 끊겨 있으면 도달 층이 안 움직인다
if (cSet && cLow) check('펫이 도달 층을 올린다 (저급펫 ≥ 풀세트 +5층)',
  cLow.avg >= cSet.avg + 5, `풀세트 ${cSet.avg}층 → 저급펫 ${cLow.avg}층`);

// 펫을 모을수록 계속 나아지는가 (모을 이유가 있는가)
if (cLow && cMid && cFull) check('펫 등급이 오를수록 더 간다 (저급 ≤ 중급 ≤ 고급)',
  cLow.avg <= cMid.avg && cMid.avg <= cFull.avg,
  `저급 ${cLow.avg} → 중급 ${cMid.avg} → 고급 ${cFull.avg}층`);

// 층이 오를수록 어려워지는가 (단조성)
const setRates = FLOORS.map((f) => g('풀세트', f).rate);
let mono = true;
for (let i = 1; i < setRates.length; i++) if (setRates[i] > setRates[i - 1] + 0.15) mono = false;
check('층이 오를수록 어려워진다 (풀세트 기준 단조 감소)', mono,
  FLOORS.map((f, i) => `${f}:${(setRates[i] * 100).toFixed(0)}%`).join(' '));

let expect = 0;
for (let f = 1; f <= TOWER_FLOORS; f++) expect += dropChance(f);
console.log(`\n  펫 드랍: 1층 ${(dropChance(1) * 100).toFixed(1)}% → 500층 ${(dropChance(500) * 100).toFixed(1)}%`);
console.log(`  1~500층 완주 1회 기대 마리수: ${expect.toFixed(1)}`);

console.log(`\n${fail === 0 ? '전부 통과' : `${fail}개 목표 미달`}`);
process.exit(fail === 0 ? 0 : 1);
