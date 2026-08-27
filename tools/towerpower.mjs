/**
 * 무한의 탑 — **부대 전력 → 도달 층수** 실측
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 생겼나
 *   순위표에 「전력 27,127 · 탑 490층 · 나락 96심층 · 122일차」 가 올라왔다.
 *   전력 상한 검사(`powerCeiling × POWER_SLACK`)는 **위쪽만** 막는다. 그래서
 *   전력을 낮게 적어 넣으면 그 검사를 그냥 지나간다 — 그런데 층수·심층은
 *   `checkCadence` 가 «기록 감소» 를 거절하므로 못 낮춘다. 즉 **아래로 도망친 위조**다.
 *
 *   그걸 숫자로 잡으려면 «이 전력으로 저 층에 갈 수 있나» 를 알아야 하는데,
 *   `tools/tower.mjs` 는 도달 층만 찍고 **전력을 안 찍는다.** 여기서 같이 찍는다.
 *
 * ★ 재는 방식은 `tools/tower.mjs` 와 같다 — 진짜 state 를 만들고 `Tower.climb` 를 탄다.
 *   자체 조립기를 만들면 세트 고유효과가 조용히 빠진다(9차 세션 사고).
 *   전력은 **클라이언트와 같은 `squad.js squadPower`** 로 잰다 (손계산 금지).
 *
 * ★★ 이 도구는 «치트를 잡는 쪽» 이 아니라 **«정상 플레이어를 안 막는 쪽»** 으로 굴린다.
 *   그래서 모든 축을 «주장하는 쪽» 에게 유리하게 놓는다:
 *     · 펫은 **고급 3마리**를 항상 붙인다 — `squadPower` 는 펫을 **안 센다**.
 *       즉 펫은 전력을 1도 안 올리면서 도달 층을 올린다. 가장 유리한 축이다.
 *     · 골드 무한 (`floorCost` 로 안 멈추게)
 *     · 월 입장을 여러 번 굴린다 — 소탕(`최고−100`)이 만피로 이어 달리므로
 *       달을 거듭하면 더 깊이 간다. 122일차면 5회다.
 *     · **인원을 줄인다.** 전력은 인원에 거의 비례하는데 전투력은 그렇지 않다 →
 *       「소수 정예」가 저전력에서 가장 깊이 간다. 이게 저전력 최선이다.
 *     · 씨앗을 여러 개 굴려 **최댓값**을 쓴다 (평균이 아니다).
 *
 * 실행:
 *   node tools/towerpower.mjs                       (기본 표 + 밴드 탐색)
 *   node tools/towerpower.mjs --n=8 --months=5
 *   node tools/towerpower.mjs --target=490 --power=27127
 *   node tools/towerpower.mjs --curve                (전력 곡선만, 밴드 탐색 생략)
 */
import * as State from '../src/game/state.js';
import * as Tower from '../src/game/tower.js';
import * as Pet from '../src/game/pet.js';
import * as Gear from '../src/game/gear.js';
import * as Sets from '../src/data/sets.js';
import { getClass } from '../src/data/classes.js';
import { squadPower } from '../src/game/squad.js';
import { setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { TOWER_FLOORS, sweepLimit, SWEEP_BACKOFF } from '../src/data/tower.js';

// ★ 이걸 빼먹으면 스킬이 전부 사라져 도달 층이 통째로 틀린다 (6차 세션 사고)
setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const N = parseInt(arg('n', '4'), 10);            // 구성당 굴릴 씨앗 수 (최댓값을 쓴다)
const MONTHS = parseInt(arg('months', '5'), 10);  // 월 입장 횟수 (122일차 = 5)
const TARGET = parseInt(arg('target', '490'), 10);
const CLAIM = parseInt(arg('power', '27127'), 10);
// 「TARGET 층에 가려면 최소 얼마인가」 를 찾을 전력 구간 (경계가 이 안에 있어야 한다)
const MIN_LO = parseInt(arg('minlo', '95000'), 10);
const MIN_HI = parseInt(arg('minhi', '150000'), 10);

/* ─────────────────────────── 부대 만들기 ─────────────────────────── */

// tools/tower.mjs 와 같은 4차 표준 부대 (아키타입이 전부 다르다 = 가장 센 조합)
const SQUAD4 = [
  'bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
  'masterarcher_apex', 'archmage_apex', 'highpriest_abyss',
];
const FILL_ORDER = ['body', 'head', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'weapon', 'offhand'];

function setForArch(arch) {
  const hit = Sets.SET_LIST.find((s) => s.archs.includes(arch) && s.archs.length < Sets.ALL_ARCHS.length);
  return (hit || Sets.getSet('constellation')).id;
}

/** 고급 펫 3마리 — `squadPower` 가 안 세므로 «전력 0 으로 사는 전투력» 이다 */
const PETS_FULL = [['pet_warden', 'S'], ['pet_chalice', 'A'], ['pet_starcalf', 'A']];

/**
 * 구성 → 단원 명세 배열.
 * `{members, level, grade, pieces}` 는 전원 같은 명세를 뜻하고,
 * `{specs:[{level,grade,pieces}, ...]}` 는 사람마다 다르게 준다 (섞인 부대).
 */
function specsOf(o) {
  if (Array.isArray(o.specs)) return o.specs;
  const n = o.members ?? 7;
  return new Array(n).fill(null).map(() => ({
    level: o.level ?? 80, grade: o.grade ?? 'S', pieces: o.pieces ?? 10,
  }));
}

/** 진짜 게임 상태를 만든다 (장비·펫을 state 에 실어 tower.js 가 평소 경로로 읽어 가게) */
function setup(o = {}) {
  const specs = specsOf(o).slice(0, 7);
  State.newGame(20260802, '탑계측단');
  const st = State.state;
  st.gold = 1e9;
  st.roster = [];
  st.items = [];
  st.pets = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);

  specs.forEach((sp, i) => {
    const classId = SQUAD4[i];
    const cls = getClass(classId);
    if (!cls) throw new Error(`클래스 ${classId} 없음 — 도구를 갱신해라`);
    const merc = {
      uid: `tp_a${i}`, name: cls.name, classId, level: sp.level, grade: sp.grade,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0, hiredDay: 1,
    };
    if (sp.pieces > 0) {
      const setId = setForArch(cls.arch);
      for (const slot of FILL_ORDER.slice(0, sp.pieces)) {
        const it = Sets.setPieceItem(setId, slot, 80, { uid: `tp_it_${i}_${slot}` });
        if (!it) continue;
        st.items.push(it);
        merc.equipment[slot] = it.uid;
      }
      // ★ 실제 게임과 같은 진입점으로 세트 고유효과를 싣는다
      Gear.setSpecialsFor(merc, State.itemsById(st.items));
    }
    st.roster.push(merc);
    sq.memberUids[i] = merc.uid;
  });
  for (const m of st.roster) m.hp = 0;   // 0 = mercStats.hp 로 채워진다

  sq.petUids = [null, null, null];
  if (o.pets !== false) {
    for (const [sid, g] of PETS_FULL) {
      const p = Pet.makePet(st, sid, g);
      if (!p) continue;
      st.pets.push(p);
      Pet.assignPet(st, sq.id, st.pets.length - 1, p.uid);
    }
  }
  return st;
}

/** 전투를 안 돌리고 전력만 (밴드 탐색용 — 싸다) */
function powerOf(o) {
  const st = setup(o);
  return squadPower(st, st.squads[0].id);
}

/* ─────────────────────────── 측정 ─────────────────────────── */

/**
 * 한 «계정» 을 MONTHS 번 입장시킨다.
 * ★ 여기가 이 도구의 핵심이다 — 「여러 번 들어가면 더 깊이 가나」 를 코드가 답한다.
 *   `climb()` 은 `sweepLimit(best) = best − 100` 까지를 **전투 없이** 지나고
 *   그 다음 층부터 **만피로** 싸운다. 즉 매번 1층부터가 아니다.
 * @returns {number[]} 달마다의 최고 기록
 */
function season(st, seedOffset, months = MONTHS) {
  const sq = st.squads[0];
  st.tower = { best: 0, bestDay: 0, lastRunDay: 0, lastRunFloor: 0 };
  const out = [];
  for (let mo = 0; mo < months; mo++) {
    st.day = 1 + mo * 28;                       // 실제 입장일 (1·29·57·85·113…)
    st.gold = 1e9;                              // 골드는 난이도 축이 아니다 — 무한
    st.tower.lastRunDay = 0;                    // 이번 달은 아직 안 다녀왔다
    st.seed = (20260802 + seedOffset * 7919) >>> 0;   // 씨앗만 바꿔 다른 전투를 만든다
    Tower.climb(st, sq.id, { force: true });
    out.push(st.tower.best);
  }
  return out;
}

/** 구성 하나를 N 씨앗 굴려 **최댓값** 곡선을 낸다 */
function measure(o) {
  const power = powerOf(o);
  const best = new Array(MONTHS).fill(0);
  let single = 0;                                // 1회 입장만 했을 때의 최고
  for (let i = 0; i < N; i++) {
    const st = setup(o);
    const seq = season(st, i);
    for (let m = 0; m < MONTHS; m++) if (seq[m] > best[m]) best[m] = seq[m];
    if (seq[0] > single) single = seq[0];
  }
  return { power, single, months: best, max: best[MONTHS - 1] };
}

/* ─────────────────────────── 이름표 ─────────────────────────── */

const width = (s) => Array.from(String(s)).reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));

function label(o) {
  if (Array.isArray(o.specs)) {
    const key = (s) => `Lv${s.level}${s.grade}/${s.pieces}칸`;
    const grp = [];
    for (const s of o.specs) {
      const k = key(s);
      if (grp.length && grp[grp.length - 1].k === k) grp[grp.length - 1].n++;
      else grp.push({ k, n: 1 });
    }
    return grp.map((g) => `${g.n}×${g.k}`).join(' + ') + (o.pets === false ? ' · 펫없음' : ' · 고급펫');
  }
  const bits = [`Lv${o.level ?? 80}`, `${o.grade ?? 'S'}`, `${o.members ?? 7}인`];
  bits.push((o.pieces ?? 10) === 0 ? '장비없음' : `세트${o.pieces ?? 10}칸`);
  bits.push(o.pets === false ? '펫없음' : '고급펫');
  return bits.join('·');
}

/* ═══════════════════ 1) 전력 곡선 — 축을 네 개 쓴다 ═══════════════════
 * ★ 축을 하나만 쓰면 «그 축에서만 성립하는 관계» 를 잰 게 된다.
 *   인원·장비·등급·레벨 네 축을 전부 쓰고, 같은 전력대에서
 *   **가장 깊이 간 값**을 그 전력의 대표로 삼는다. */
const CURVE = [
  { level: 80, grade: 'S', pieces: 10, members: 1 },
  { level: 80, grade: 'S', pieces: 10, members: 2 },
  { level: 80, grade: 'S', pieces: 10, members: 3 },
  { level: 80, grade: 'S', pieces: 10, members: 4 },
  { level: 80, grade: 'S', pieces: 10, members: 5 },
  { level: 80, grade: 'S', pieces: 10, members: 6 },
  { level: 80, grade: 'S', pieces: 10, members: 7 },
  { level: 80, grade: 'S', pieces: 0, members: 7 },
  { level: 80, grade: 'S', pieces: 4, members: 7 },
  { level: 80, grade: 'S', pieces: 8, members: 7 },
  { level: 80, grade: 'F', pieces: 0, members: 7 },
  { level: 80, grade: 'C', pieces: 0, members: 7 },
  { level: 80, grade: 'A', pieces: 10, members: 7 },
  { level: 40, grade: 'S', pieces: 10, members: 7 },
  { level: 40, grade: 'S', pieces: 0, members: 7 },
  { level: 80, grade: 'A', pieces: 10, members: 7, pets: false },
  { level: 80, grade: 'A', pieces: 0, members: 7, pets: false },
];

console.log(`무한의 탑 — 부대 전력 → 도달 층수`);
console.log(`씨앗 ${N}개의 **최댓값** · 월 입장 ${MONTHS}회 누적 · 골드 무한 · 펫은 기본 «고급 3마리»`);
console.log(`★ squadPower 는 펫을 **안 센다** → 펫은 전력 0 으로 도달 층을 산다. 그래서 기본에 붙인다(주장하는 쪽에 유리하게).`);
console.log('='.repeat(100));
console.log(`${pad('구성', 30)} ${'전력'.padStart(9)} ${'1회'.padStart(5)} ` +
  Array.from({ length: MONTHS }, (_, i) => `${i + 1}달`.padStart(5)).join(''));
console.log('-'.repeat(100));

const rows = [];
for (const o of CURVE) {
  const m = measure(o);
  rows.push({ o, ...m });
  console.log(`${pad(label(o), 30)} ${m.power.toLocaleString().padStart(9)} ${String(m.single).padStart(5)} ` +
    m.months.map((x) => String(x).padStart(5)).join(''));
}

/* ═══════════════ 2) 밴드 탐색 — 「전력 X 이하의 최선」 ═══════════════
 * ★ 곡선만 보면 안 된다. 필요한 답은 «전력 27,127 **이하**의 어떤 부대든
 *   갈 수 있는 최대 층» 이다. 전력이 낮은 구성을 되도록 많이 만들어
 *   그중 가장 깊이 가는 것을 찾는다. 섞인 부대(정예 몇 + 맨몸 몇)까지 본다. */

const BAND_ROWS = [];
if (!has('curve')) {
  const cands = [];
  const push = (o) => { const p = powerOf(o); if (p <= CLAIM) cands.push({ o, power: p }); };

  // (a) 같은 명세 전원 — 인원 × 등급 × 장비 × 레벨
  for (const members of [1, 2, 3, 4, 5, 6, 7]) {
    for (const grade of ['F', 'D', 'C', 'B', 'A', 'S']) {
      for (const pieces of [0, 2, 4, 6, 8, 10]) {
        for (const level of [40, 60, 80]) push({ members, grade, pieces, level });
      }
    }
  }
  // (b) 섞인 부대 — 정예 k 명 + 맨몸 m 명 (전력을 조금씩 채워 밴드 상단에 붙인다)
  for (let k = 1; k <= 3; k++) {
    for (let m = 0; m + k <= 7; m++) {
      for (const fillGrade of ['F', 'D', 'C']) {
        for (const fillLevel of [1, 40, 80]) {
          const specs = [];
          for (let i = 0; i < k; i++) specs.push({ level: 80, grade: 'S', pieces: 10 });
          for (let i = 0; i < m; i++) specs.push({ level: fillLevel, grade: fillGrade, pieces: 0 });
          push({ specs });
        }
      }
    }
  }

  // 전력이 높은 순으로 — 밴드 안에서는 대체로 전력이 높을수록 깊이 간다.
  // 다만 «인원이 적은 쪽» 이 뒤집는 일이 있어 인원별로도 상위를 남긴다.
  cands.sort((a, b) => b.power - a.power);
  const seen = new Map();
  const picked = [];
  for (const c of cands) {
    const n = specsOf(c.o).length;
    const cnt = seen.get(n) || 0;
    if (cnt >= 4) continue;                    // 인원마다 상위 4개만
    seen.set(n, cnt + 1);
    picked.push(c);
  }

  console.log('\n' + '='.repeat(100));
  console.log(` 밴드 탐색 — 전력 ${CLAIM.toLocaleString()} **이하** 구성 ${cands.length}개 중 인원별 상위 ${picked.length}개를 실제로 등반시킨다`);
  console.log('='.repeat(100));
  console.log(`${pad('구성', 44)} ${'전력'.padStart(9)} ${'1회'.padStart(5)} ` +
    Array.from({ length: MONTHS }, (_, i) => `${i + 1}달`.padStart(5)).join(''));
  console.log('-'.repeat(100));
  for (const c of picked) {
    const m = measure(c.o);
    BAND_ROWS.push({ o: c.o, ...m });
    console.log(`${pad(label(c.o), 44)} ${m.power.toLocaleString().padStart(9)} ${String(m.single).padStart(5)} ` +
      m.months.map((x) => String(x).padStart(5)).join(''));
  }
}

/* ═══════════ 2.5) 최소 전력 탐색 — 「490층에 가려면 최소 얼마인가」 ═══════════
 * ★ 위의 굵은 곡선만으로는 «118,404 는 못 갔고 134,166 은 갔다» 밖에 못 말한다.
 *   그 사이를 촘촘히 채워 **경계**를 찾는다. 여기서도 펫은 고급 3마리로 붙인 채다. */

const MIN_ROWS = [];
if (!has('curve') && !has('noband')) {
  const cands = [];
  const seenP = new Set();
  const push = (o) => {
    const p = powerOf(o);
    if (p < MIN_LO || p > MIN_HI) return;
    const bucket = Math.round(p / 2500);            // 2,500 간격으로 하나만
    if (seenP.has(bucket)) return;
    seenP.add(bucket);
    cands.push({ o, power: p });
  };

  // 정예 k명(풀세트) + 나머지 m명(장비 p칸) — 이 밴드를 가장 촘촘히 채우는 형태
  for (let k = 3; k <= 7; k++) {
    for (let m = 0; k + m <= 7; m++) {
      for (const p2 of [0, 2, 4, 6, 8, 10]) {
        for (const g2 of ['F', 'C', 'S']) {
          const specs = [];
          for (let i = 0; i < k; i++) specs.push({ level: 80, grade: 'S', pieces: 10 });
          for (let i = 0; i < m; i++) specs.push({ level: 80, grade: g2, pieces: p2 });
          push({ specs });
        }
      }
    }
  }
  // 전원 같은 명세 — 등급·장비칸을 낮춰 밴드에 넣는다
  for (const members of [5, 6, 7]) {
    for (const grade of ['F', 'D', 'C', 'B', 'A', 'S']) {
      for (const pieces of [6, 8, 10]) {
        for (const level of [40, 60, 80]) push({ members, grade, pieces, level });
      }
    }
  }

  cands.sort((a, b) => a.power - b.power);
  console.log('\n' + '='.repeat(100));
  console.log(` 최소 전력 탐색 — ${MIN_LO.toLocaleString()}~${MIN_HI.toLocaleString()} 사이 ${cands.length}개 구성을 오름차순으로 등반시킨다`);
  console.log('='.repeat(100));
  console.log(`${pad('구성', 44)} ${'전력'.padStart(9)} ${'1회'.padStart(5)} ` +
    Array.from({ length: MONTHS }, (_, i) => `${i + 1}달`.padStart(5)).join('') + `  ${TARGET}층?`);
  console.log('-'.repeat(100));
  for (const c of cands) {
    const m = measure(c.o);
    MIN_ROWS.push({ o: c.o, ...m });
    console.log(`${pad(label(c.o), 44)} ${m.power.toLocaleString().padStart(9)} ${String(m.single).padStart(5)} ` +
      m.months.map((x) => String(x).padStart(5)).join('') + `   ${m.max >= TARGET ? 'O' : '·'}`);
  }
}

/* ═══════════════════ 3) 전력 오름차순 정리 ═══════════════════ */

const all = rows.concat(BAND_ROWS, MIN_ROWS);
console.log('\n' + '='.repeat(100));
console.log(` 전력 오름차순 — 각 전력에서 도달한 최대 층 (월 ${MONTHS}회 누적)`);
console.log('='.repeat(100));
const sorted = all.slice().sort((a, b) => a.power - b.power);
let running = 0;
for (const r of sorted) {
  running = Math.max(running, r.max);            // 「이 전력 이하로 갈 수 있는 최대 층」
  console.log(`  ${r.power.toLocaleString().padStart(9)} → ${String(r.max).padStart(3)}층` +
    `   (이하 통틀어 최대 ${String(running).padStart(3)}층)   ${label(r.o)}`);
}

/* ═══════════════════ 4) 판정 ═══════════════════ */

console.log('\n' + '='.repeat(100));
console.log(' 판정');
console.log('='.repeat(100));

const reached = all.filter((r) => r.max >= TARGET).sort((a, b) => a.power - b.power);
const failed = all.filter((r) => r.max < TARGET).sort((a, b) => b.power - a.power);

if (!reached.length) {
  console.log(`  ${TARGET}층에 도달한 구성이 하나도 없다 — 구성 목록을 넓혀라.`);
} else {
  const lo = reached[0];
  console.log(`  ${TARGET}층 도달 **최소 전력** (실측) = ${lo.power.toLocaleString()}   [${label(lo.o)}]`);
  console.log(`      그 구성의 도달: 1회 ${lo.single}층 → ${MONTHS}달 ${lo.max}층`);
}
if (failed.length) {
  const hi = failed[0];
  console.log(`  ${TARGET}층에 **못 간** 최고 전력 = ${hi.power.toLocaleString()} (${hi.max}층에서 멈춤) [${label(hi.o)}]`);
}

const under = all.filter((r) => r.power <= CLAIM);
const capAt = Math.max(0, ...under.map((r) => r.max));
const capRow = under.find((r) => r.max === capAt);
console.log(`\n  전력 ${CLAIM.toLocaleString()} **이하** 구성 ${under.length}개가 도달한 최대 층 = **${capAt}층**`
  + (capRow ? `  [${label(capRow.o)}]` : ''));
console.log(`  주장된 층 = ${TARGET}층 → ${capAt >= TARGET ? '가능하다' : `**불가능하다** (${TARGET - capAt}층 모자란다 · 배수 ${(TARGET / Math.max(1, capAt)).toFixed(2)}x)`}`);

/* ═══════ 5) 「여러 번 들어가면 더 깊이 가나」 — 코드가 답하는 자리 ═══════ */

console.log('\n' + '='.repeat(100));
console.log(' 월 입장을 거듭하면 더 깊이 가는가');
console.log('='.repeat(100));
console.log(`  game/tower.js climb(): floor = sweepLimit(best) + 1, carry = null`);
console.log(`    sweepLimit(best) = best − ${SWEEP_BACKOFF}  →  best−${SWEEP_BACKOFF - 1} 층부터 **만피로** 싸운다.`);
console.log(`    sweepLimit(0)=${sweepLimit(0)}  sweepLimit(100)=${sweepLimit(100)}  sweepLimit(300)=${sweepLimit(300)}  sweepLimit(500)=${sweepLimit(500)}`);
console.log(`  ⇒ 매번 1층부터가 **아니다.** 다만 소탕 구간은 «전투 없이 골드만» 이라 실력은 안 산다.`);
let grew = 0, flat = 0, delta = 0;
for (const r of all) {
  if (r.months[MONTHS - 1] > r.months[0]) { grew++; delta += r.months[MONTHS - 1] - r.months[0]; } else flat++;
}
console.log(`  구성 ${all.length}개 중 ${grew}개가 달을 거듭하며 기록이 자랐고(평균 +${grew ? (delta / grew).toFixed(1) : 0}층), ${flat}개는 그대로였다.`);
console.log(`  ⇒ 횟수는 기록을 **조금** 밀어 올릴 뿐, 부대가 못 이기는 층에서는 몇 달을 가도 멈춘다.`);

/* ═══ 6) 포화 시험 — 「횟수로 설명되나」 의 마지막 문 ═══
 * ★ 「122일차면 5회니까 5회로는 못 간다」 는 반박당하기 쉽다("더 오래 하면?").
 *   그래서 밴드 최선 구성을 **LONG 달** 굴려 기록이 어디서 평평해지는지 본다.
 *   여기서 490 에 안 닿으면 «횟수로는 절대 설명이 안 된다» 가 된다. */

const LONG = parseInt(arg('long', '24'), 10);
if (under.length && !has('curve')) {
  const bestUnder = under.slice().sort((a, b) => b.max - a.max)[0];
  console.log('\n' + '='.repeat(100));
  console.log(` 포화 시험 — 전력 ${CLAIM.toLocaleString()} 이하 최선 구성을 ${LONG}달(= ${(LONG - 1) * 28 + 1}일차) 굴린다`);
  console.log('='.repeat(100));
  console.log(`  구성: ${label(bestUnder.o)}  (전력 ${bestUnder.power.toLocaleString()})`);
  const curve = new Array(LONG).fill(0);
  for (let i = 0; i < N; i++) {
    const seq = season(setup(bestUnder.o), 1000 + i, LONG);
    for (let m = 0; m < LONG; m++) if (seq[m] > curve[m]) curve[m] = seq[m];
  }
  for (let m = 0; m < LONG; m += 4) {
    const slice = curve.slice(m, m + 4)
      .map((v, j) => `${String(m + j + 1).padStart(2)}달:${String(v).padStart(3)}층`).join('   ');
    console.log(`    ${slice}`);
  }
  const sat = curve[LONG - 1];
  console.log(`  ⇒ ${LONG}달(입장 ${LONG}회)을 굴려도 ${sat}층에서 평평해진다. ${TARGET}층까지 ${TARGET - sat}층 모자란다.`);
  console.log(`     소탕은 «전투 없이 골드만» 이라 실력을 안 산다 — 못 이기는 층은 몇 번을 들어가도 못 이긴다.`);
}

console.log(`\n  탑 최고층 = ${TOWER_FLOORS} · 소탕 후퇴폭 = ${SWEEP_BACKOFF}`);
