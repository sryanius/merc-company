/**
 * 황금 나락 — 「부대 전력 → 도달 심층」 실측
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 생겼나
 *   순위표 3번째 치트가 **전력만 낮췄다.** 전력 상한 검사(`rules.js` powerCeiling ×
 *   POWER_SLACK)는 «너무 큰 전력» 만 잡는다. 그래서 신고 전력을 27,127 로 **내려** 놓고
 *   나락 96심층 · 탑 490층은 그대로 두었다 (기록은 checkCadence 가 감소를 거절한다).
 *
 *   그 조합이 불가능함을 **숫자로** 보이려면 «심층 D 에 서려면 전력이 최소 얼마인가» 가
 *   있어야 한다. 이 도구가 그 표를 만든다. `tools/abyss.mjs` 는 구성(레벨·장비)별로
 *   재지만 전력을 축으로 잡지 않아 그 질문에 답할 수 없다.
 *
 * ★★ 오탐이 치트를 놓치는 것보다 나쁘다 → 전부 **상한**으로 잡는다
 *   · 한 구성을 여러 번(--n) 굴려 **최댓값**을 쓴다 (운 좋은 잠수를 상한으로)
 *   · 전력이 낮은데 깊이 가는 구성을 일부러 찾는다 (저ilvl 풀세트 = 세트 고유효과는
 *     전부 받으면서 스탯은 낮다 → 전력당 심층이 가장 좋다)
 *   · 진형도 굴린다 — 진형은 전력 근사식과 전투 양쪽에 서로 다르게 먹는다
 *   · 표는 «그 전력 **이하**로 도달한 최대 심층» 의 **누적 최댓값**(상단 포락선)이다.
 *     한 지점의 표본이 운 나빴어도 아래 지점을 넘지 못하는 일이 없다.
 *
 * ★ 아군 편성은 직접 조립하지 않는다. `game/abyss.js` → `questBattleDefs` 를 그대로 탄다
 *   (9차 세션에 자체 조립기가 세트 고유효과를 빠뜨려 «풀세트를 반쪽» 으로 잰 사고).
 * ★ 전력은 클라이언트와 **같은 함수**(`squad.squadPower`)로 잰다. 손으로 다시 안 짠다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 실측 결과 (2026-08-27 · `--grid=3 --cap=130` + 근접 구간 고표본 재측정)
 *
 *   「그 전력 **이하**로 도달한 최대 심층」 — 합법 편성만, 펫S 포함, 각 구성 최댓값
 *
 *     |    부대 전력 | 도달 심층 | 그때의 구성                  |
 *     |-------------|----------|------------------------------|
 *     |       5,000 |       18 | 최심편성 Lv1 F 맨몸           |
 *     |      10,000 |       29 | Lv8 C 맨몸                   |
 *     |      20,000 |       51 | Lv3 S 세트ilvl1               |
 *     |    ★27,127 |    59~64 | Lv25 D ilvl1 / Lv22 C ilvl1   |
 *     |      30,000 |       66 | Lv30 D ilvl1                 |
 *     |      50,000 |       86 | Lv35 S ilvl1                 |
 *     |      75,000 |      108 | Lv40 S ilvl25                |
 *     |     100,000 |      128 | Lv60 B ilvl50                |
 *     |     190,470 |     163+ | Lv80 S ilvl80 (격자는 130 에서 잘랐다) |
 *
 *   ⇒ **96심층 최소 필요 전력 ≈ 57,122** (Lv45 B ilvl15 · 30회 중 최댓값이 딱 96,
 *      최저 73 · 평균 88.4). 방법을 바꿔 재도 57,122 / 59,041 / 62,987 / 64,458 로 모인다.
 *   ⇒ **전력 27,127 의 심층 상한 = 64** (27,127 바로 아래 구성 12개 × 20회 = 240잠수).
 *      96심층은 32심층 위이고, 필요 전력의 **47%** 다.
 *
 * ★★ 「전력 → 심층」은 **함수가 아니다.** 전력 천장 편성(190,470)은 같은 클래스가 겹쳐
 *   역할이 무너져 56~65심층에서 멈춘다 — 균형 편성(165,368)의 84심층보다 얕고,
 *   탐색으로 찾은 DEEP_ROSTER(159,345)의 163심층에는 한참 못 미친다.
 *   그래서 판정에 쓸 값은 «평균 곡선» 이 아니라 **상단 포락선**이어야 한다.
 *
 * 사용 (★ 판정에 쓸 표는 `--grid` 다 — 운에 안 기댄다):
 *   node tools/abysspower.mjs --grid=3        # ★ 격자 스윕 → 「전력 → 심층」 표 + 결론
 *   node tools/abysspower.mjs --search=500    # 가장 깊이 가는 **편성** 찾기 (DEEP_ROSTER 갱신용)
 *   node tools/abysspower.mjs --minpower=400  # 목표 심층을 가장 싼 전력으로 (언덕오르기)
 *   node tools/abysspower.mjs --capped=500    # 전력 상한 이하 최대 심층 (언덕오르기)
 *   node tools/abysspower.mjs                 # 넓은 구성 스윕 (맥락용, 느리다)
 *   node tools/abysspower.mjs --quick         # 짧은 스윕 (스모크용)
 *   node tools/abysspower.mjs --selftest      # 메타 검사(판 검사에 버그를 심어 물리는지)
 *
 *   공통 손잡이: --depth=96  --power=27127  --n=5  --restarts=4
 *               --anylevel   장착 레벨 제한(gear.js equipIssue)을 무시한다
 *
 * ★ 언덕오르기(--minpower/--capped)는 지역 최적에 갇힌다. 실측으로 `--capped` 가
 *   예산 27,127 중 14,922 만 쓰고 53심층에서 멈췄는데 격자에는 25,794 에 57심층이 있었다.
 *   **결론 숫자는 격자에서 읽어라.** 언덕오르기는 격자가 놓친 편성을 찾는 보조다.
 */
import * as State from '../src/game/state.js';
import * as Abyss from '../src/game/abyss.js';
import * as Gear from '../src/game/gear.js';
import * as Squad from '../src/game/squad.js';
import * as Sets from '../src/data/sets.js';
import { mercPower, mercStats } from '../src/game/merc.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { RNG } from '../src/core/rng.js';
import * as Pet from '../src/game/pet.js';
import { FORMATIONS, formationMods } from '../src/data/formations.js';
import { CLASSES } from '../src/data/classes.js';
import { depthPower, depthEnemyCount, depthEnemyLevel } from '../src/data/abyss.js';

// ★ 이걸 빼먹으면 스킬이 전부 사라져 승률이 통째로 틀린다 (6차 세션 사고)
setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
/** `--k` 도 `--k=값` 도 같은 스위치로 본다 (`--search=600` 이 조용히 무시되던 버그) */
const has = (k) => process.argv.some((x) => x === `--${k}` || x.startsWith(`--${k}=`));

const RUNS = parseInt(arg('n', '5'), 10);
const TARGET_DEPTH = parseInt(arg('depth', '96'), 10);
const TARGET_POWER = parseInt(arg('power', '27127'), 10);

/* ─────────────────────────── 부대 만들기 ───────────────────────────
 * tools/abyss.mjs 의 setup 과 같은 뼈대 + 전력을 흔들기 위한 손잡이:
 *   classes(차수) · level · grade · gear · setIlvl · slots(장비 칸 수) · members · formation
 */

const SQUAD4 = [
  'bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
  'masterarcher_apex', 'archmage_apex', 'highpriest_abyss',
];
const SQUAD3 = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];
const SQUAD2 = ['knight', 'berserker', 'dragoon', 'assassin', 'sniper', 'elementalist', 'priest'];
const SQUAD1 = ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'];

const FILL_ORDER = ['body', 'head', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'weapon', 'offhand'];

/**
 * ★★ **가장 깊이 가는 편성** — `node tools/abysspower.mjs --search=500` 이 찾아냈다.
 *
 *   Lv80 S · 풀세트 ilvl80 · 펫S · 진형 arrowhead 로 **163심층**(12회 재측정 150~166).
 *   같은 조건의 균형 편성(SQUAD4)은 84심층이다 — **편성만으로 두 배 차이가 난다.**
 *
 * ★ 이걸 저장해 두는 이유: 안티치트가 쓸 값은 «96심층에 필요한 **최소** 전력» 이고,
 *   그 값은 «가장 깊이 가는 편성» 을 안 찾으면 반드시 **높게** 나온다 → 정상 플레이어를 막는다.
 *   실제로 균형 편성만 재던 판에서는 96심층 최소 전력이 166,793 으로 나왔는데,
 *   이 편성으로 다시 재면 훨씬 낮은 전력에서도 96심층에 닿는다.
 *   탐색을 다시 돌려 더 깊은 편성이 나오면 **이 상수를 갱신하고 표를 다시 떠라.**
 */
export const DEEP_FID = 'arrowhead';
export const DEEP_ROSTER = [
  { classId: 'plaguelord_abyss', setId: 'ironrampart' },
  { classId: 'shadowblade_abyss', setId: 'bloodoath' },
  { classId: 'beastlord_abyss', setId: 'ironrampart' },
  { classId: 'oathshield_apex', setId: 'ironrampart' },
  { classId: 'lichlord_abyss', setId: 'constellation' },
  { classId: 'banditking_abyss', setId: 'ironrampart' },
  { classId: 'swordgod_abyss', setId: 'bloodoath' },
];

function setForArch(arch) {
  const hit = Sets.SET_LIST.find((s) => s.archs.includes(arch) && s.archs.length < Sets.ALL_ARCHS.length);
  return (hit || Sets.getSet('constellation')).id;
}

/* ─────────────────────── 천장 편성 (tools/powerceiling.mjs 와 같은 고르기) ───────────────────────
 * ★ 왜 필요한가: 위의 SQUAD4 는 «역할이 안 겹치는 균형 편성» 이라 **전력 천장이 아니다**.
 *   순위표 상한(190,470)은 칸마다 최강 클래스/세트를 꽂은 편성이다. 그 편성이 실제로
 *   몇 심층까지 가는지 재지 않으면 «가능한 최대 심층» 을 낮게 부르게 되고 → 오탐이 된다.
 * ★ 진형 근사식은 squadPower 와 **같은 식**을 쓴다.
 */
function formMul(fid, i, unit) {
  const mods = formationMods(fid, i, unit) || {};
  const keys = Object.keys(mods);
  if (!keys.length) return 1;
  return 1 + keys.reduce((a, k) => a + mods[k], 0) / (keys.length * 2);
}

const ALL_CLASS_IDS = Object.keys(CLASSES).filter((id) => CLASSES[id] && CLASSES[id].id);

/** 클래스×세트 전력 풀 — **재는 경로가 setup 과 같아야** 한다 (setPieceItem) */
function powerPool(level, grade) {
  const pool = [];
  for (const clsId of ALL_CLASS_IDS) {
    const cls = getClass(clsId) || {};
    let wearable = Sets.SET_IDS;
    try {
      const w = Sets.setsForArch(cls.arch);
      if (Array.isArray(w) && w.length) wearable = w.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
    } catch { /* 전부 */ }
    for (const setId of wearable) {
      const equipment = {}; const items = {};
      for (const slot of FILL_ORDER) {
        const it = Sets.setPieceItem(setId, slot, level, { uid: `pp_${slot}`, minLv: 1 });
        if (!it) continue;
        items[it.uid] = it; equipment[slot] = it.uid;
      }
      let p = 0;
      try { p = mercPower({ uid: 'pp', classId: clsId, level, grade, equipment }, items); } catch { p = 0; }
      if (p > 0) pool.push({ p, arch: cls.arch, classId: clsId, setId });
    }
  }
  return pool;
}

/** 이 진형에서 칸마다 최강인 (클래스, 세트) — powerceiling.mjs 와 같은 고르기 */
export function ceilingRoster(level = 80, grade = 'S', fid = 'basic') {
  const pool = powerPool(level, grade);
  const roster = [];
  let total = 0;
  for (let i = 0; i < 7; i++) {
    let bs = { v: 0, c: null };
    for (const c of pool) {
      const v = c.p * formMul(fid, i, { arch: c.arch, classId: c.classId });
      if (v > bs.v) bs = { v, c };
    }
    roster.push(bs.c);
    total += bs.v;
  }
  return { roster, total: Math.round(total) };
}

/** 전 진형에서 전력이 가장 높은 편성 */
export function bestCeilingRoster(level = 80, grade = 'S') {
  let best = null;
  for (const fid of Object.keys(FORMATIONS)) {
    const r = ceilingRoster(level, grade, fid);
    if (!best || r.total > best.total) best = { ...r, fid };
  }
  return best;
}

/**
 * 실제 게임 상태를 만든다.
 * @param {object} o
 *   `{classes, level, grade, gear:'none'|'shop'|'sets', setIlvl, slots, members, formation}`
 */
export function setup(o = {}) {
  State.newGame(20260819, '나락계측단');
  const st = State.state;
  st.gold = 0;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  if (o.formation) sq.formationId = o.formation;
  const rng = new RNG(4242);
  const level = o.level || 80;
  const nSlots = o.slots == null ? FILL_ORDER.length : Math.max(0, Math.min(FILL_ORDER.length, o.slots));
  const members = o.members == null ? 7 : Math.max(1, Math.min(7, o.members));
  const setIlvl = o.setIlvl || level;

  /* `roster` 가 오면 칸마다 (클래스, 세트) 를 지정한다 — 천장 편성용 */
  const plan = (o.roster || (o.classes || SQUAD4).map((classId) => ({ classId, setId: null })))
    .slice(0, members);

  plan.forEach((slotPlan, i) => {
    const classId = slotPlan.classId;
    const cls = getClass(classId);
    if (!cls) throw new Error(`클래스 ${classId} 없음 — 도구를 갱신해라`);
    /* 칸마다 등급·세트 ilvl 을 따로 줄 수 있다 — 「전력을 가장 싸게 쓰는 96심층 편성」 탐색용 */
    const mLevel = slotPlan.level || level;
    const mIlvl = slotPlan.setIlvl || setIlvl;
    const merc = {
      uid: `ap_a${i}`, name: cls.name, classId, level: mLevel, grade: slotPlan.grade || o.grade || 'A',
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    };
    if (o.gear === 'sets') {
      const setId = slotPlan.setId || setForArch(cls.arch);
      for (const slot of FILL_ORDER.slice(0, nSlots)) {
        // minLv 를 레벨 이하로 눌러 «게임에서 실제로 낄 수 있는» 조각으로 만든다
        const it = Sets.setPieceItem(setId, slot, mIlvl, { uid: `ap_it_${i}_${slot}`, minLv: 1 });
        if (!it) continue;
        st.items.push(it);
        merc.equipment[slot] = it.uid;
      }
      Gear.setSpecialsFor(merc, State.itemsById(st.items));
    } else if (o.gear === 'shop') {
      for (const slot of FILL_ORDER.slice(0, nSlots)) {
        const it = Gear.rollItem({ ilvl: mIlvl, slot, rng });
        if (!it || !Gear.slotAccepts(slot, it)) continue;
        it.uid = `ap_it_${i}_${slot}`;
        st.items.push(it);
        merc.equipment[slot] = it.uid;
      }
    }
    st.roster.push(merc);
    sq.memberUids[i] = merc.uid;
  });

  for (const m of st.roster) m.hp = 0;   // 0 이면 mercStats.hp 로 채워진다

  /* ★★ 펫은 `squadPower` 가 **안 센다.** 즉 펫은 «전력을 안 올리고 전투만 강해지는» 축이다.
   *   오탐을 피하려면 저전력 쪽 상한을 잴 때 반드시 최고급 펫을 얹어 봐야 한다. */
  sq.petUids = [null, null, null];
  st.pets = [];
  if (o.pets) {
    const PET_SETS = {
      low: [['pet_shell', 'D'], ['pet_moss', 'D'], ['pet_lantern', 'C']],
      mid: [['pet_kite', 'C'], ['pet_saint', 'C'], ['pet_banner', 'B']],
      // 최고 tier(5) 3종을 전부 S 로 — 게임이 낼 수 있는 펫의 천장
      max: [['pet_warden', 'S'], ['pet_eclipse', 'S'], ['pet_starcalf', 'S']],
    };
    for (const [sid, gr] of (PET_SETS[o.pets] || [])) {
      const p = Pet.makePet(st, sid, gr);
      if (!p) continue;
      st.pets.push(p);
      Pet.assignPet(st, sq.id, st.pets.length - 1, p.uid);
    }
  }
  return st;
}

/** 이 구성의 부대 전력 — **클라이언트와 같은 함수**로 잰다 */
export function powerOf(st) {
  return Squad.squadPower(st, st.squads[0].id);
}

/**
 * ★★ 이 편성을 **게임 안에서 실제로 입힐 수 있는가.**
 *
 *   setup 은 `merc.equipment` 에 직접 꽂는다 — `Gear.equipIssue` 를 안 지난다.
 *   그래서 «Lv20 용병이 ilvl80 신화 세트를 낀» 편성도 만들어진다. 게임은 그걸 막는다
 *   (`gear.js` equipIssue: `merc.level < item.minLv` 면 거절, `minLv = ilvl - 5`).
 *
 *   이걸 안 보면 「96심층 최소 전력」 을 **실제보다 낮게** 부르게 된다. 낮은 쪽은 오탐이
 *   안 나는 방향이라 안전하지만, 그만큼 치트를 놓친다. 그래서 **양쪽 다 낸다** —
 *   합법 편성만의 값과, 장착 제한을 무시한 값.
 *
 * @returns {string[]} 위반 사유 (없으면 빈 배열)
 */
export function legalIssues(st) {
  const bad = [];
  const byId = State.itemsById(st.items);
  for (const m of st.roster || []) {
    for (const [slot, uid] of Object.entries(m.equipment || {})) {
      const it = (st.items || []).find((x) => x && x.uid === uid);
      if (!it) continue;
      // setup 이 minLv 를 1 로 눌러 놨다 — **진짜 요구 레벨**로 되돌려 검사한다
      const realMinLv = Math.max(1, Math.round((it.ilvl || 1) - 5));
      const probe = { ...it, minLv: realMinLv };
      const why = Gear.equipIssue(m, probe, slot, byId);
      if (why) bad.push(`${m.classId} ${slot}: ${why}`);
    }
  }
  return bad;
}

/** 합법 편성인가 (한 줄 요약용) */
export function isLegal(o) {
  try { return legalIssues(setup(o)).length === 0; } catch { return false; }
}

/**
 * 이 구성으로 RUNS 번 잠수해 **최대 도달 심층**을 잰다.
 * (평균이 아니라 최댓값이다 — 상한을 잡아야 오탐이 없다)
 */
export function measure(o, runs = RUNS) {
  const st = setup(o);
  const sq = st.squads[0];
  const power = powerOf(st);
  const illegal = legalIssues(st);
  const reached = [];
  for (let i = 0; i < runs; i++) {
    st.day = 1 + i * 337;                 // 심층 시드는 day 에 물려 있다 → 매번 다른 굴림
    st.abyss = { best: 0, bestDay: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0 };
    st.gold = 0;
    for (const m of st.roster) { m.hp = 0; m.woundUntil = 0; m.status = 'idle'; }
    /* ★ `maxDepth` 는 **런타임 상한**일 뿐이다. 96심층 판정에는 영향이 없다
     *   (그보다 훨씬 위에서 자른다). 안 자르면 최강 편성이 매번 160심층까지 내려가
     *   격자 한 판이 몇 시간이 된다. */
    const r = Abyss.dive(st, sq.id, o.maxDepth ? { force: true, maxDepth: o.maxDepth } : { force: true });
    reached.push(r.reached);
    if (typeof o.onRun === 'function') o.onRun(r);
  }
  return {
    power,
    max: Math.max(...reached),
    min: Math.min(...reached),
    avg: reached.reduce((a, b) => a + b, 0) / reached.length,
    reached,
    legal: illegal.length === 0,
    illegal,
  };
}

/* ─────────────────────────── 판이 차려졌나 ───────────────────────────
 * ★★ 이 저장소가 세 번 당한 실수: 장비가 안 붙은 «맨몸» 을 재 놓고 천장이라 부른 것.
 *   그래서 재기 전에 판을 검사한다. `broken` 은 메타 검사용 — 일부러 판을 깨서
 *   이 검사가 **정말 무는지** 확인한다.
 */
export function gates(broken = null) {
  const bad = [];

  /* ★★ `State.state` 는 **하나짜리 전역**이고 `newGame` 이 그걸 제자리에서 갈아엎는다
   *   (`replaceState`: state 의 키를 전부 지우고 다시 채운다). 그래서 setup 을 두 번 부른 뒤에
   *   각각의 반환값을 비교하면 **같은 객체를 두 번 재는 것**이 된다.
   *   실제로 처음에 그렇게 짜서 «풀세트/맨몸 1.00x» 가 나왔고, 이 판 검사가 그걸 물었다.
   *   → 필요한 수는 setup 직후에 **그 자리에서** 뽑아 둔다. */
  const snap = (o, mutate = null) => {
    const st = setup(o);
    if (mutate) mutate(st);
    const items = State.itemsById(st.items);
    const m0 = st.roster[0];
    let nSp = 0;
    try {
      const sp = Gear.setSpecialsFor(m0, items) || m0.setSpecials || [];
      nSp = Array.isArray(sp) ? sp.length : 0;
    } catch { nSp = 0; }
    return {
      power: powerOf(st),
      atk: mercStats(m0, items).atk,
      bareAtk: mercStats({ ...m0, equipment: {} }, {}).atk,
      nSp,
    };
  };

  const bare = snap({ classes: SQUAD4, level: 80, grade: 'S', gear: 'none' });
  // 메타: 장비를 벗긴다 (판 검사가 «맨몸» 을 못 알아보면 여기서 안 걸린다)
  const strip = broken === 'strip' ? (st) => { for (const m of st.roster) m.equipment = {}; } : null;
  const full = snap({ classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80 }, strip);

  const pBare = bare.power;
  const pFull = full.power;

  if (!(pBare > 0)) bad.push('맨몸 전력이 0 이다 — 부대가 안 만들어졌다');
  if (!(pFull / Math.max(1, pBare) >= 2.5)) {
    bad.push(`장비가 전력에 안 붙었다 (풀세트/맨몸 ${(pFull / Math.max(1, pBare)).toFixed(2)}x)`);
  }

  // 스탯에도 붙었나 — 전력만 보면 가중치가 이상해도 안 걸린다
  if (!(full.atk / Math.max(1, full.bareAtk) >= 2)) bad.push('장비가 스탯에 안 붙었다');

  // 세트 고유효과가 실렸나 (풀세트인데 specials 가 비면 «반쪽» 을 재는 것이다)
  const nSp = full.nSp;
  if (!(nSp > 0)) bad.push('풀세트인데 세트 고유효과가 하나도 없다');

  // 진형 보정이 전력에 먹나 (squadPower 의 진형 근사식이 죽어 있으면 전력 축이 흔들린다)
  let moved = false;
  for (const fid of Object.keys(FORMATIONS)) {
    const p = snap({ classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: fid }).power;
    if (p !== pFull) { moved = true; break; }
  }
  if (!moved) bad.push('진형이 전력에 하나도 안 먹는다');

  // 실제로 잠수가 도는가 (전투 엔진·스킬 해석기가 죽어 있으면 전부 1심층에서 끝난다)
  const probe = measure({ classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80 }, 1);
  if (!(probe.max >= 20)) bad.push(`풀세트 Lv80 S 가 ${probe.max}심층에서 멈춘다 — 전투가 안 돈다`);

  // 전력 축이 단조로운가 (레벨을 올렸는데 전력이 안 오르면 축 자체가 틀렸다)
  const pLv40 = snap({ classes: SQUAD4, level: 40, grade: 'S', gear: 'sets', setIlvl: 40 }).power;
  if (!(pLv40 < pFull)) bad.push('레벨을 올려도 전력이 안 오른다');

  /* 펫이 실제로 부대에 붙었나 — 안 붙으면 «펫을 얹어도 그대로» 를 «펫이 무의미» 로 오독한다 */
  const stPet = setup({ classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, pets: 'max' });
  const nPet = (stPet.squads[0].petUids || []).filter(Boolean).length;
  if (broken !== 'strip' && nPet !== 3) bad.push(`펫이 부대에 안 붙었다 (${nPet}/3)`);

  /* 천장 편성이 균형 편성보다 전력이 높은가 — 낮으면 «천장» 을 잘못 고르고 있는 것이다 */
  const bc = bestCeilingRoster(80, 'S');
  const pCeil = snap({ roster: bc.roster, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: bc.fid }).power;
  if (!(pCeil >= pFull)) bad.push(`천장 편성(${pCeil.toLocaleString()})이 균형 편성(${pFull.toLocaleString()})보다 약하다`);

  return { bad, pBare, pFull, nSp, probe, nPet, pCeil, ceilFid: bc.fid };
}

/* ─────────────────────────── 스윕 ─────────────────────────── */

/** 전력을 넓게 흔드는 구성들. 낮은 전력 쪽은 «전력당 심층» 이 좋은 빌드를 일부러 섞는다. */
function sweepConfigs(quick = false) {
  const out = [];
  const push = (label, o) => out.push({ label, o });

  const tiers = [
    ['1차', SQUAD1], ['2차', SQUAD2], ['3차', SQUAD3], ['4차', SQUAD4],
  ];
  const levels = quick ? [40, 80] : [20, 30, 40, 50, 60, 70, 80];
  const grades = quick ? ['C', 'S'] : ['F', 'C', 'A', 'S'];

  for (const [tn, cls] of tiers) {
    for (const lv of levels) {
      for (const g of grades) {
        push(`${tn} Lv${lv} ${g} 맨몸`, { classes: cls, level: lv, grade: g, gear: 'none' });
        push(`${tn} Lv${lv} ${g} 상점템`, { classes: cls, level: lv, grade: g, gear: 'shop' });
        push(`${tn} Lv${lv} ${g} 풀세트`, { classes: cls, level: lv, grade: g, gear: 'sets', setIlvl: lv });
      }
    }
  }

  /* ★ 「전력은 싸고 심층은 깊은」 쪽을 일부러 훑는다 — 여기가 오탐의 경계선이다.
   *   저ilvl 풀세트: 세트 고유효과(전력에 안 잡힌다)는 전부 받으면서 스탯만 낮다. */
  if (!quick) {
    for (const il of [10, 20, 30, 40, 50, 60, 70, 80]) {
      for (const g of ['F', 'D', 'B', 'S']) {
        push(`4차 Lv80 ${g} 세트ilvl${il}`, { classes: SQUAD4, level: 80, grade: g, gear: 'sets', setIlvl: il });
      }
    }
    // 장비 칸을 줄여 본다 (세트 단계 3/5/7/full 이 갈리는 지점)
    for (const s of [3, 5, 7, 10]) {
      push(`4차 Lv80 S 세트 ${s}칸`, { classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, slots: s });
    }
    // 인원을 줄여 본다
    for (const mcount of [4, 5, 6]) {
      push(`4차 Lv80 S 풀세트 ${mcount}인`, { classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, members: mcount });
    }
    // 진형 전부 (펫 최고급까지 얹어서 — 펫은 전력에 안 잡히므로 «공짜 전투력» 이다)
    for (const fid of Object.keys(FORMATIONS)) {
      push(`4차 Lv80 S 풀세트 ${fid}`, { classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: fid });
      push(`4차 Lv80 S 풀세트 ${fid}+펫S`, { classes: SQUAD4, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: fid, pets: 'max' });
      push(`4차 Lv80 F 풀세트 ${fid}`, { classes: SQUAD4, level: 80, grade: 'F', gear: 'sets', setIlvl: 80, formation: fid });
    }
    // 저전력 쪽에 펫 천장을 얹는다 — 여기가 «전력 27,127» 근방의 오탐 경계선이다
    for (const lv of [30, 40, 50, 60, 80]) {
      for (const g of ['F', 'C', 'S']) {
        push(`4차 Lv${lv} ${g} 맨몸+펫S`, { classes: SQUAD4, level: lv, grade: g, gear: 'none', pets: 'max' });
        push(`4차 Lv${lv} ${g} 세트ilvl10+펫S`, { classes: SQUAD4, level: lv, grade: g, gear: 'sets', setIlvl: 10, pets: 'max' });
      }
    }
  }

  /* ★★★ 여기가 이 표의 **본체**다 — 가장 깊이 가는 편성(DEEP_ROSTER)을 전력 축으로 훑는다.
   *   레벨·등급·세트 ilvl 로 전력을 내리고, 전력에 안 잡히는 것(펫·세트 고유효과·진형)은 켜 둔다.
   *   포락선의 윗선은 사실상 전부 이 블록에서 나온다. */
  {
    const levels = quick ? [40, 80] : [20, 30, 40, 50, 60, 70, 80];
    const grades = quick ? ['S'] : ['F', 'D', 'C', 'B', 'A', 'S'];
    for (const lv of levels) {
      for (const gr of grades) {
        push(`최심편성 Lv${lv} ${gr} 세트ilvl${lv}+펫S`, { roster: DEEP_ROSTER, level: lv, grade: gr, gear: 'sets', setIlvl: lv, formation: DEEP_FID, pets: 'max' });
        if (!quick) {
          push(`최심편성 Lv${lv} ${gr} 세트ilvl80+펫S`, { roster: DEEP_ROSTER, level: lv, grade: gr, gear: 'sets', setIlvl: 80, formation: DEEP_FID, pets: 'max' });
          push(`최심편성 Lv${lv} ${gr} 세트ilvl10+펫S`, { roster: DEEP_ROSTER, level: lv, grade: gr, gear: 'sets', setIlvl: 10, formation: DEEP_FID, pets: 'max' });
          push(`최심편성 Lv${lv} ${gr} 맨몸+펫S`, { roster: DEEP_ROSTER, level: lv, grade: gr, gear: 'none', formation: DEEP_FID, pets: 'max' });
        }
      }
    }
    push('최심편성 Lv80 S 풀세트 (펫없음)', { roster: DEEP_ROSTER, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: DEEP_FID });
  }

  /* ★★ 전력 천장 편성 — 칸마다 최강 클래스/세트. 전력은 가장 높지만(190,470)
   *   같은 클래스가 겹쳐 역할이 무너져 **깊이는 오히려 얕다**(실측 56~65심층).
   *   「전력 → 심층」이 단조가 아님을 표에 남겨 두려고 같이 잰다. */
  for (const lv of (quick ? [80] : [40, 60, 80])) {
    for (const g of (quick ? ['S'] : ['C', 'A', 'S'])) {
      const bc = bestCeilingRoster(lv, g);
      push(`천장편성 Lv${lv} ${g} (${bc.fid})`, { roster: bc.roster, level: lv, grade: g, gear: 'sets', setIlvl: lv, formation: bc.fid });
      push(`천장편성 Lv${lv} ${g} (${bc.fid})+펫S`, { roster: bc.roster, level: lv, grade: g, gear: 'sets', setIlvl: lv, formation: bc.fid, pets: 'max' });
      for (const fid of (quick ? [] : Object.keys(FORMATIONS))) {
        const r = ceilingRoster(lv, g, fid);
        push(`천장편성 Lv${lv} ${g} ${fid}+펫S`, { roster: r.roster, level: lv, grade: g, gear: 'sets', setIlvl: lv, formation: fid, pets: 'max' });
      }
    }
  }
  return out;
}

/* ─────────────────────────── 가장 깊이 가는 편성 찾기 ───────────────────────────
 * ★★ 왜 필요한가: **전력 천장 편성은 가장 깊이 가지 못한다.**
 *   칸마다 최강 전력(190,470)을 꽂으면 같은 클래스가 겹쳐 탱커·힐러가 없어지고,
 *   실측에서 56심층(펫 포함 65)에서 멈췄다 — 균형 편성(165,368)의 84심층보다 얕다.
 *   즉 「전력 → 심층」 은 단조가 아니다. «가능한 최대 심층» 을 낮게 부르면 그게 곧 오탐이므로
 *   편성을 **탐색해서** 최대 심층 자체를 올려 봐야 한다.
 */

/** 탐색 후보 (클래스, 세트) — 3·4차만 본다 (1·2차는 실측에서 명백히 얕다) */
function searchPool(minTier = 3) {
  const pool = [];
  for (const clsId of ALL_CLASS_IDS) {
    const cls = getClass(clsId) || {};
    if ((cls.tier || 1) < minTier) continue;
    let wearable = Sets.SET_IDS;
    try {
      const w = Sets.setsForArch(cls.arch);
      if (Array.isArray(w) && w.length) wearable = w.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
    } catch { /* 전부 */ }
    for (const setId of wearable) pool.push({ classId: clsId, setId });
  }
  return pool;
}

/**
 * 언덕오르기 — 칸 하나씩 바꿔 가며 **최대 도달 심층**을 올린다.
 * 점수는 (최대심층, 평균심층) 사전식. 같은 편성을 두 번 재지 않는다.
 */
export function deepSearch(iters = 400, o = {}) {
  const level = o.level || 80;
  const grade = o.grade || 'S';
  const setIlvl = o.setIlvl || 80;
  const pets = o.pets || 'max';
  const runs = o.runs || 3;
  const pool = searchPool(o.minTier || 3);
  const rng = new RNG(o.seed || 90210);
  const seen = new Map();

  const key = (roster, fid) => `${fid}|${roster.map((r) => `${r.classId}:${r.setId}`).join(',')}`;
  const evalRoster = (roster, fid) => {
    const k = key(roster, fid);
    if (seen.has(k)) return seen.get(k);
    const m = measure({ roster, level, grade, gear: 'sets', setIlvl, formation: fid, pets }, runs);
    const v = { ...m, roster: roster.map((r) => ({ ...r })), fid };
    seen.set(k, v);
    return v;
  };
  const better = (a, b) => (a.max !== b.max ? a.max > b.max : a.avg > b.avg);

  // 출발점: 균형 편성(SQUAD4) + 각 아키타입의 기본 세트
  let cur = evalRoster(SQUAD4.map((classId) => ({ classId, setId: setForArch((getClass(classId) || {}).arch) })), o.formation || 'basic');

  // 진형부터 한 바퀴 (진형은 전투와 전력에 서로 다르게 먹는다)
  for (const fid of Object.keys(FORMATIONS)) {
    const t = evalRoster(cur.roster, fid);
    if (better(t, cur)) cur = t;
  }

  for (let n = 0; n < iters; n++) {
    const i = Math.floor(rng.float(0, 7)) % 7;
    const cand = pool[Math.floor(rng.float(0, pool.length)) % pool.length];
    const next = cur.roster.map((r) => ({ ...r }));
    next[i] = { ...cand };
    const t = evalRoster(next, cur.fid);
    if (better(t, cur)) {
      cur = t;
      // 좋아진 편성에서 진형을 다시 한 바퀴
      for (const fid of Object.keys(FORMATIONS)) {
        const u = evalRoster(cur.roster, fid);
        if (better(u, cur)) cur = u;
      }
    }
  }
  return { best: cur, tried: seen.size, all: [...seen.values()] };
}

/**
 * 「심층 D 를 **가장 싼 전력**으로 」 — 오탐 경계선을 아래로 민다.
 *
 * ★★ 왜: 안티치트가 쓸 값은 «96심층에 필요한 **최소** 전력» 이다. 이 값을 높게 잡으면
 *   정상 플레이어가 막힌다. 그래서 96심층을 유지한 채 전력을 깎을 수 있는 데까지 깎아 본다.
 *   깎는 손잡이는 전력에 잡히는 것들(등급 · 세트 ilvl · 레벨)이고,
 *   전력에 **안 잡히는** 것들(펫 · 세트 고유효과 · 진형)은 최대로 켜 둔다.
 */
export function minPowerSearch(depth, seedRoster, fid, iters = 300, o = {}) {
  const runs = o.runs || 3;
  const rng = new RNG(o.seed || 1337);
  const GRADE_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
  const seen = new Map();

  const ev = (plan) => {
    const k = plan.map((p) => `${p.classId}:${p.setId}:${p.grade}:${p.setIlvl}:${p.level}`).join(',');
    if (seen.has(k)) return seen.get(k);
    const m = measure({ roster: plan, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: fid, pets: 'max' }, runs);
    const v = { ...m, plan: plan.map((p) => ({ ...p })) };
    seen.set(k, v);
    return v;
  };

  let cur = ev(seedRoster.map((r) => ({ ...r, grade: 'S', setIlvl: 80, level: 80 })));
  if (cur.max < depth) return { ok: false, best: cur, tried: seen.size };

  for (let n = 0; n < iters; n++) {
    const i = Math.floor(rng.float(0, cur.plan.length)) % cur.plan.length;
    const next = cur.plan.map((p) => ({ ...p }));
    const knob = Math.floor(rng.float(0, 3)) % 3;
    if (knob === 0) {
      const gi = GRADE_ORDER.indexOf(next[i].grade);
      if (gi <= 0) continue;
      next[i].grade = GRADE_ORDER[gi - 1];
    } else if (knob === 1) {
      next[i].setIlvl = Math.max(1, next[i].setIlvl - Math.round(rng.float(1, 8)));
    } else {
      next[i].level = Math.max(1, next[i].level - Math.round(rng.float(1, 5)));
    }
    const t = ev(next);
    // ★ `legalOnly` 면 게임이 실제로 입힐 수 있는 편성만 인정한다 (레벨 < 요구레벨 배제)
    if (o.legalOnly && !t.legal) continue;
    if (t.max >= depth && t.power < cur.power) cur = t;
  }
  return { ok: true, best: cur, tried: seen.size };
}

/**
 * 「전력 P **이하**로 갈 수 있는 가장 깊은 심층」 — 치트 판정에 직접 쓰는 값.
 *
 * ★ 제약 최적화다: 전력 ≤ P 를 지키면서 심층을 최대로 올린다.
 *   전력에 안 잡히는 축(펫·진형·세트 고유효과)은 **공짜**이므로 항상 최대로 켠다.
 *   출발점은 전 손잡이 최소값이라 반드시 제약을 만족한다.
 */
export function cappedSearch(powerCap, iters = 400, o = {}) {
  const runs = o.runs || 3;
  const rng = new RNG(o.seed || 7788);
  const GRADE_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
  const pool = searchPool(o.minTier || 3);
  const seen = new Map();
  let fid = o.formation || DEEP_FID;

  const ev = (plan, f) => {
    const k = `${f}|${plan.map((p) => `${p.classId}:${p.setId}:${p.grade}:${p.setIlvl}:${p.level}`).join(',')}`;
    if (seen.has(k)) return seen.get(k);
    const m = measure({ roster: plan, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: f, pets: 'max' }, runs);
    const v = { ...m, plan: plan.map((p) => ({ ...p })), fid: f };
    seen.set(k, v);
    return v;
  };
  // 제약을 만족하는 것 중 더 깊은 쪽, 같으면 전력이 낮은 쪽
  const ok = (v) => v.power <= powerCap;
  const better = (a, b) => (a.max !== b.max ? a.max > b.max : a.power < b.power);

  let cur = ev((o.roster || DEEP_ROSTER).map((r) => ({ ...r, grade: 'F', setIlvl: 1, level: 1 })), fid);
  if (!ok(cur)) return { ok: false, reason: `최소 손잡이에서도 전력이 ${cur.power} 라 ${powerCap} 를 넘는다`, best: cur };

  for (let n = 0; n < iters; n++) {
    const i = Math.floor(rng.float(0, cur.plan.length)) % cur.plan.length;
    const next = cur.plan.map((p) => ({ ...p }));
    const knob = Math.floor(rng.float(0, 4)) % 4;
    const up = rng.float(0, 1) < 0.75;                      // 올리는 쪽을 더 자주 시도
    if (knob === 0) {
      const gi = GRADE_ORDER.indexOf(next[i].grade);
      const gj = Math.max(0, Math.min(GRADE_ORDER.length - 1, gi + (up ? 1 : -1)));
      next[i].grade = GRADE_ORDER[gj];
    } else if (knob === 1) {
      next[i].setIlvl = Math.max(1, Math.min(80, next[i].setIlvl + (up ? 1 : -1) * Math.round(rng.float(1, 10))));
    } else if (knob === 2) {
      next[i].level = Math.max(1, Math.min(80, next[i].level + (up ? 1 : -1) * Math.round(rng.float(1, 12))));
    } else {
      const c = pool[Math.floor(rng.float(0, pool.length)) % pool.length];
      next[i].classId = c.classId; next[i].setId = c.setId;
    }
    const t = ev(next, fid);
    if (o.legalOnly && !t.legal) continue;
    if (ok(t) && better(t, cur)) {
      cur = t;
      for (const f of Object.keys(FORMATIONS)) {         // 진형은 공짜에 가깝다 — 매번 한 바퀴
        const u = ev(cur.plan, f);
        if (ok(u) && better(u, cur)) { cur = u; fid = f; }
      }
    }
  }
  return { ok: true, best: cur, tried: seen.size };
}

/** 상단 포락선 — 전력 오름차순으로 「이 전력 이하에서 도달한 최대 심층」 */
export function envelope(rows) {
  const sorted = rows.slice().sort((a, b) => a.power - b.power);
  let best = 0;
  return sorted.map((r) => {
    if (r.max > best) best = r.max;
    return { ...r, env: best };
  });
}

/** 심층 D 에 서려면 전력이 최소 얼마여야 하나 (= D 이상 간 구성 중 최소 전력) */
export function minPowerFor(rows, depth) {
  const hit = rows.filter((r) => r.max >= depth);
  if (!hit.length) return null;
  return hit.reduce((a, b) => (b.power < a.power ? b : a));
}

/** 전력 P 이하로 갈 수 있었던 최대 심층 */
export function maxDepthAt(rows, power) {
  const hit = rows.filter((r) => r.power <= power);
  if (!hit.length) return null;
  return hit.reduce((a, b) => (b.max > a.max ? b : a));
}

/* ─────────────────────────── 실행 ─────────────────────────── */

if (import.meta.url === `file:///${String(process.argv[1] || '').replace(/\\/g, '/')}`) {
  if (has('selftest')) {
    // 메타 검사: 판 검사에 버그를 심어 **실제로 물리는지** 본다
    const ok = gates();
    const stripped = gates('strip');
    const pass = ok.bad.length === 0 && stripped.bad.length > 0;
    console.log(`정상 판  → ${ok.bad.length ? `✗ ${ok.bad.join(' / ')}` : '✓ 통과'}`);
    console.log(`장비 벗김 → ${stripped.bad.length ? `✓ 물었다: ${stripped.bad.join(' / ')}` : '✗ 못 물었다'}`);
    console.log(pass ? '메타 검사 통과' : '메타 검사 실패');
    process.exit(pass ? 0 : 1);
  }

  const g = gates();
  if (g.bad.length) { for (const b of g.bad) console.log(`✗ ${b} — 멈춘다`); process.exit(1); }

  if (has('grid')) {
    /* ★★ 격자 스윕 — 「전력 → 도달 심층」 표의 **본체**.
     *
     *   언덕오르기(--capped)는 지역 최적에 갇혀 예산을 다 못 쓴다 (실측: 27,127 예산에
     *   14,922 만 쓰고 53심층에서 멈췄는데, 격자에는 25,794 에 57심층이 있었다).
     *   그래서 판정에 쓸 표는 **운에 안 기대는 격자**로 뜬다.
     *
     *   축: 가장 깊이 가는 편성(DEEP_ROSTER)을 레벨 × 등급 × 세트ilvl 로 흔든다.
     *   전력에 안 잡히는 것(펫S · 세트 고유효과 · 진형)은 항상 최대로 켠다.
     */
    const runs = parseInt(arg('grid', '3'), 10) || 3;
    const cap = parseInt(arg('cap', '130'), 10) || 130;   // 96 보다 한참 위 — 판정엔 영향 없다
    const levels = [1, 3, 5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 50, 60, 70, 80];
    const grades = ['F', 'D', 'C', 'B', 'A', 'S'];
    const gearOpts = [['맨몸', null], ['ilvl1', 1], ['ilvl10', 10], ['ilvl25', 25], ['ilvl50', 50], ['ilvl=Lv', 'lv'], ['ilvl80', 80]];
    console.log(`판 검사 ✓  격자 스윕 (레벨 ${levels.length} × 등급 ${grades.length} × 장비 ${gearOpts.length} · 각 ${runs}회 · 펫S · 진형 ${DEEP_FID} · 심층 ${cap} 에서 자름)`);
    const rows = [];
    const t0 = Date.now();
    for (const lv of levels) {
      for (const gr of grades) {
        for (const [gname, gi] of gearOpts) {
          const base = { roster: DEEP_ROSTER, level: lv, grade: gr, formation: DEEP_FID, pets: 'max', maxDepth: cap };
          const o = gi === null
            ? { ...base, gear: 'none' }
            : { ...base, gear: 'sets', setIlvl: gi === 'lv' ? lv : gi };
          const m = measure(o, runs);
          rows.push({ label: `Lv${lv} ${gr} ${gname}`, ...m });
        }
      }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const legalRows = rows.filter((r) => r.legal);
    console.log(`구성 ${rows.length}개 (합법 ${legalRows.length}개) · ${secs}s`);
    console.log('');

    const env = envelope(legalRows);
    console.log('전력 → 도달 심층 (합법 편성만 · 각 구성 최댓값 · 포락선은 「그 전력 이하」 누적 최댓값)');
    console.log('='.repeat(76));
    console.log('       전력  최대심층  (최저~최고)  포락선  구성');
    console.log('-'.repeat(76));
    /* 표가 너무 기니 **포락선이 올라간 줄만** 낸다 — 상한을 정하는 건 그 줄들이다 */
    let shown = 0;
    for (let i = 0; i < env.length; i++) {
      const r = env[i];
      const rise = i === 0 || r.env > env[i - 1].env;
      if (!rise) continue;
      shown++;
      console.log(`${r.power.toLocaleString().padStart(11)}  ${String(r.max).padStart(8)}  (${String(r.min).padStart(3)}~${String(r.max).padEnd(3)})  ${String(r.env).padStart(6)}  ${r.label}`);
    }
    console.log(`(포락선이 오른 ${shown}줄만 표시 — 전체 ${env.length}줄)`);

    const STOPS = [5000, 10000, 20000, TARGET_POWER, 30000, 50000, 75000, 100000, 150000, 190470];
    console.log('');
    console.log('요청 지점 — 「그 전력 **이하**로 도달한 최대 심층」');
    console.log('-'.repeat(76));
    for (const p of STOPS) {
      const h = maxDepthAt(legalRows, p);
      console.log(`${p.toLocaleString().padStart(11)}  ${String(h ? h.max : '-').padStart(4)}심층  ${h ? `${h.label} (실전력 ${h.power.toLocaleString()})` : '표본 없음'}`);
    }

    console.log('');
    console.log('심층별 **최소 필요 전력**');
    console.log('-'.repeat(76));
    for (const d of [20, 40, 50, 60, 70, 80, 85, 90, 92, 95, 96, 100, 120, 150]) {
      const h = minPowerFor(legalRows, d);
      console.log(`${String(d).padStart(6)}심층  ${h ? h.power.toLocaleString().padStart(11) : '  도달 없음'}  ${h ? h.label : ''}`);
    }

    const need = minPowerFor(legalRows, TARGET_DEPTH);
    const can = maxDepthAt(legalRows, TARGET_POWER);
    console.log('');
    console.log('─'.repeat(76));
    if (need) console.log(`⇒ ${TARGET_DEPTH}심층 최소 필요 전력 = ${need.power.toLocaleString()} (${need.label})`);
    if (can) console.log(`⇒ 전력 ${TARGET_POWER.toLocaleString()} 이하 최대 심층 = ${can.max} (${can.label} · 실전력 ${can.power.toLocaleString()})`);
    if (need && can && can.max < TARGET_DEPTH) {
      console.log(`⇒ 전력 ${TARGET_POWER.toLocaleString()} 로 ${TARGET_DEPTH}심층은 **불가능** — ${TARGET_DEPTH - can.max}심층 모자라고, `
        + `필요 전력의 ${(TARGET_POWER / need.power * 100).toFixed(0)}% 밖에 안 된다`);
    }
    process.exit(0);
  }

  if (has('capped')) {
    const iters = parseInt(arg('capped', '500'), 10) || 500;
    console.log(`판 검사 ✓  전력 ${TARGET_POWER.toLocaleString()} **이하**로 갈 수 있는 최대 심층 (펫S · ${iters}회)`);
    const t = Date.now();
    const legalOnly = !has('anylevel');
    const restarts = parseInt(arg('restarts', '4'), 10) || 4;
    if (legalOnly) console.log('(게임이 실제로 입힐 수 있는 편성만 — 해제하려면 --anylevel)');
    /* ★ 언덕오르기는 지역 최적에 갇힌다 — 실제로 한 번만 돌렸을 때 예산 27,127 중
     *   16,953 만 쓰고 멈췄다. 씨앗을 바꿔 여러 번 돌려 **가장 깊은 것**을 쓴다. */
    let r = null;
    for (let k = 0; k < restarts; k++) {
      const one = cappedSearch(TARGET_POWER, iters, { runs: 3, legalOnly, seed: 7788 + k * 1013 });
      if (!one.ok) { r = one; break; }
      console.log(`  재시작 ${k + 1}/${restarts}: ${one.best.max}심층 · 전력 ${one.best.power.toLocaleString()}`);
      if (!r || !r.ok || one.best.max > r.best.max) r = one;
    }
    console.log(`편성 ${r.tried || 0}가지 · ${((Date.now() - t) / 1000).toFixed(1)}s`);
    if (!r.ok) { console.log(`✗ ${r.reason}`); process.exit(1); }
    console.log('');
    console.log(`최대 ${r.best.max}심층 (평균 ${r.best.avg.toFixed(1)}) · 전력 ${r.best.power.toLocaleString()} · 진형 ${r.best.fid}`);
    for (const p of r.best.plan) console.log(`  ${p.classId.padEnd(18)} / ${String(p.setId).padEnd(14)} Lv${String(p.level).padStart(2)} ${p.grade} ilvl${p.setIlvl}`);
    const v = measure({ roster: r.best.plan, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: r.best.fid, pets: 'max' }, 12);
    console.log('');
    console.log(`재측정 12회: 최대 ${v.max} · 최저 ${v.min} · 평균 ${v.avg.toFixed(1)} · 전력 ${v.power.toLocaleString()}`);
    console.log(`⇒ 전력 ${TARGET_POWER.toLocaleString()} 이하의 실측 심층 상한 = ${Math.max(v.max, r.best.max)}심층`
      + `${v.legal ? ' (합법 편성)' : ` (★장착 불가 ${v.illegal.length}건)`}`);
    process.exit(0);
  }

  if (has('minpower')) {
    const iters = parseInt(arg('minpower', '400'), 10) || 400;
    console.log(`판 검사 ✓  ${TARGET_DEPTH}심층을 **가장 싼 전력**으로 (최심편성 · 펫S · ${iters}회)`);
    const t = Date.now();
    const legalOnly = !has('anylevel');
    const restarts = parseInt(arg('restarts', '4'), 10) || 4;
    if (legalOnly) console.log('(게임이 실제로 입힐 수 있는 편성만 — 해제하려면 --anylevel)');
    let r = null;
    for (let k = 0; k < restarts; k++) {
      const one = minPowerSearch(TARGET_DEPTH, DEEP_ROSTER, DEEP_FID, iters, { runs: 3, legalOnly, seed: 1337 + k * 977 });
      if (!one.ok) { r = one; break; }
      console.log(`  재시작 ${k + 1}/${restarts}: 전력 ${one.best.power.toLocaleString()} · ${one.best.max}심층`);
      if (!r || !r.ok || one.best.power < r.best.power) r = one;
    }
    console.log(`편성 ${r.tried}가지 · ${((Date.now() - t) / 1000).toFixed(1)}s`);
    if (!r.ok) { console.log(`✗ 출발 편성조차 ${TARGET_DEPTH}심층에 못 간다 (${r.best.max})`); process.exit(1); }
    console.log('');
    console.log(`최소 전력 ${r.best.power.toLocaleString()} 에서 ${r.best.max}심층 (평균 ${r.best.avg.toFixed(1)}) · 진형 ${DEEP_FID}`);
    for (const p of r.best.plan) console.log(`  ${p.classId.padEnd(18)} / ${String(p.setId).padEnd(14)} Lv${String(p.level).padStart(2)} ${p.grade} ilvl${p.setIlvl}`);
    // 검증 — 더 많이 굴려 다시 잰다
    const v = measure({ roster: r.best.plan, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: DEEP_FID, pets: 'max' }, 12);
    console.log('');
    console.log(`재측정 12회: 최대 ${v.max} · 최저 ${v.min} · 평균 ${v.avg.toFixed(1)} · 전력 ${v.power.toLocaleString()}`);
    console.log(v.max >= TARGET_DEPTH
      ? `⇒ ${TARGET_DEPTH}심층 최소 필요 전력 ≈ ${v.power.toLocaleString()}${v.legal ? ' (합법 편성)' : ` (★장착 불가 ${v.illegal.length}건)`}`
      : `⇒ 재측정에서 ${TARGET_DEPTH}심층에 못 갔다 (${v.max}) — 탐색이 운을 주웠다. 표본을 늘려라`);
    process.exit(0);
  }

  if (has('search')) {
    const iters = parseInt(arg('search', '600'), 10) || 600;
    console.log(`판 검사 ✓  가장 깊이 가는 편성 탐색 (Lv80 S · 풀세트 ilvl80 · 펫S · ${iters}회)`);
    const t = Date.now();
    const r = deepSearch(iters, { runs: 3 });
    console.log(`편성 ${r.tried}가지 · ${((Date.now() - t) / 1000).toFixed(1)}s`);
    console.log('');
    console.log(`최고: ${r.best.max}심층 (평균 ${r.best.avg.toFixed(1)}) · 전력 ${r.best.power.toLocaleString()} · 진형 ${r.best.fid}`);
    r.best.roster.forEach((s, i) => console.log(`  ${i + 1}. ${s.classId.padEnd(18)} / ${s.setId}`));
    console.log('');
    // 검증 — 더 많이 굴려 다시 잰다
    const v = measure({ roster: r.best.roster, level: 80, grade: 'S', gear: 'sets', setIlvl: 80, formation: r.best.fid, pets: 'max' }, 12);
    console.log(`재측정 12회: 최대 ${v.max} · 최저 ${v.min} · 평균 ${v.avg.toFixed(1)} · 전력 ${v.power.toLocaleString()}`);
    const top = r.all.slice().sort((a, b) => b.max - a.max).slice(0, 8);
    console.log('');
    console.log('상위 8편성');
    for (const x of top) console.log(`  ${String(x.max).padStart(3)}심층  전력 ${x.power.toLocaleString().padStart(9)}  ${x.fid.padEnd(10)} ${x.roster.map((s) => s.classId).join(',')}`);
    process.exit(0);
  }

  console.log(`판 검사 ✓  맨몸 ${g.pBare.toLocaleString()} → 풀세트 ${g.pFull.toLocaleString()} `
    + `(${(g.pFull / g.pBare).toFixed(2)}x) · 세트 고유효과 ${g.nSp}개 · 펫 ${g.nPet}/3 · 시험 잠수 ${g.probe.max}심층`);
  console.log(`         천장 편성 ${g.pCeil.toLocaleString()} (${g.ceilFid}) — rules.js POWER_BY_LEVEL 만렙 190,470 과 같은 축`);
  console.log('');

  const quick = has('quick');
  const cfgs = sweepConfigs(quick);
  const t0 = Date.now();
  const rows = [];
  for (const c of cfgs) {
    const m = measure(c.o, quick ? 2 : RUNS);
    rows.push({ label: c.label, ...m });
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const env = envelope(rows);

  console.log(`부대 전력 → 도달 심층 (구성 ${cfgs.length}개 · 각 ${quick ? 2 : RUNS}회 잠수 · ${secs}s)`);
  console.log('='.repeat(86));
  console.log('       전력  최대심층  (최저~최고)  포락선  법  구성');
  console.log('-'.repeat(86));
  for (const r of env) {
    console.log(
      `${r.power.toLocaleString().padStart(11)}  ${String(r.max).padStart(8)}  `
      + `(${String(r.min).padStart(3)}~${String(r.max).padEnd(3)})  ${String(r.env).padStart(6)}  `
      + `${r.legal ? ' ✓' : ' ✗'}  ${r.label}`,
    );
  }
  console.log('');
  console.log('법 ✗ = 게임에서는 그 레벨로 그 장비를 못 낀다 (gear.js equipIssue minLv). 참고용으로만 남긴다.');

  /* 지점별 요약 — 「이 전력 이하로 갈 수 있는 최대 심층」 */
  const STOPS = [5000, 10000, 20000, 27127, 30000, 50000, 75000, 100000, 150000, 190470];
  console.log('');
  console.log('전력 지점별 상한 (그 전력 **이하** 구성이 실제로 도달한 최대 심층)');
  console.log('-'.repeat(86));
  console.log('       전력  최대심층  그때의 구성');
  for (const p of STOPS) {
    const h = maxDepthAt(rows.filter((r) => r.legal), p);
    const hAny = maxDepthAt(rows, p);
    const note = hAny && h && hAny.max > h.max ? `  [장착제한 무시하면 ${hAny.max}]` : '';
    console.log(`${p.toLocaleString().padStart(11)}  ${String(h ? h.max : '-').padStart(8)}  ${h ? `${h.label} (실전력 ${h.power.toLocaleString()})` : '표본 없음'}${note}`);
  }

  console.log('');
  console.log('심층별 최소 필요 전력 (그 심층에 실제로 도달한 구성 중 가장 낮은 전력)');
  console.log('-'.repeat(86));
  console.log('  심층    최소 전력  그때의 구성');
  for (const d of [20, 40, 50, 60, 70, 80, 85, 90, 92, 95, 96, 100, 120, 150]) {
    const h = minPowerFor(rows.filter((r) => r.legal), d);
    console.log(`${String(d).padStart(6)}  ${h ? h.power.toLocaleString().padStart(11) : '  도달 없음'}  ${h ? h.label : ''}`);
  }

  console.log('');
  const legalRows = rows.filter((r) => r.legal);
  const need = minPowerFor(legalRows, TARGET_DEPTH);
  const can = maxDepthAt(legalRows, TARGET_POWER);
  console.log('─'.repeat(86));
  if (need) {
    console.log(`⇒ ${TARGET_DEPTH}심층에 서려면 전력 최소 ${need.power.toLocaleString()} (${need.label})`);
  } else {
    console.log(`⇒ ${TARGET_DEPTH}심층에 도달한 합법 구성이 이 스윕에는 없다 (스윕 최대 ${Math.max(...legalRows.map((r) => r.max))}심층) — --minpower 로 따로 찾아라`);
  }
  if (can) {
    console.log(`⇒ 전력 ${TARGET_POWER.toLocaleString()} 이하로는 최대 ${can.max}심층 (${can.label} · 실전력 ${can.power.toLocaleString()})`);
    if (can.max < TARGET_DEPTH) {
      console.log(`⇒ 전력 ${TARGET_POWER.toLocaleString()} 로 ${TARGET_DEPTH}심층은 **불가능**하다 `
        + `— 실측 상한보다 ${TARGET_DEPTH - can.max}심층 깊다`);
    }
  }
  console.log('');
  console.log(`참고: ${TARGET_DEPTH}심층 적 배율 ${depthPower(TARGET_DEPTH).toFixed(2)} · `
    + `적 ${depthEnemyCount(TARGET_DEPTH)}명 · 적 Lv${depthEnemyLevel(TARGET_DEPTH)} `
    + `(던전 1웨이브 2.70 / 풀세트 Lv80 승률100% 4.70 / 승률0% 5.90)`);
}
