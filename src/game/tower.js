/**
 * 무한의 탑 — 등반 · 소탕 · 펫 드랍
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 규칙 요약
 *   · 1~500층. **매달 1일에만** 입장하고, 그날 안에 끝까지 오른다(날짜는 안 넘어간다).
 *   · 층당 비용 = 층수 × 2 골드. 골드가 떨어지면 거기서 멈춘다.
 *   · 한 번 오른 곳은 다음 달에 **최고 기록 −100층**까지 전투 없이 소탕한다(골드는 낸다).
 *   · 층 사이에 **체력이 이월된다.** 25층마다 회복 지점이 있다.
 *   · 각 층 적에 펫이 하나 섞이고, 이기면 아주 낮은 확률로 그 펫을 얻는다.
 *
 * ── 왜 전투 화면을 안 쓰나
 * `ui/battle.js` 에는 자동 진행 경로가 **의도적으로 없다**(플레이어가 요청한 계약).
 * 500층을 그쪽으로 돌리면 최소 500회 클릭이고, `fastForward()` 의 12웨이브 하드 캡 때문에
 * 13층에서 런 전체가 조용히 패배 처리된다.
 * 그래서 여기서 헤드리스 `simulate()` 로 돌리고, 플레이어가 고른 층만 UI 가 전투 화면으로 띄운다.
 *
 * ── 아군 편성은 반드시 questBattleDefs 를 지난다
 * 이 프로젝트는 아군 UnitDef 조립 경로가 갈려서 진형과 세트 효과가 각각 한 번씩
 * 조용히 안 먹은 전례가 있다. 던전과 같은 방식으로 **합성 의뢰 → questBattleDefs** 에
 * 위임한다. 그래야 진형·장비·세트 고유효과·펫이 전부 한 경로로 들어온다.
 *
 * @module game/tower
 */

import { clamp } from '../core/util.js';
import { RNG } from '../core/rng.js';
import { createBattle } from '../battle/engine.js';
import {
  TOWER_FLOORS, floorCost, costRange, sweepLimit, floorPower, floorEnemyCount,
  isRestFloor, tierWeights, gradeWeights, dropChance, zoneOf,
} from '../data/tower.js';
import { PET_GRADES, petsOfTier, getPetSpecies } from '../data/pets.js';
import * as State from './state.js';
import * as Quest from './quest.js';
import * as Pet from './pet.js';
import { enemiesFor } from '../data/enemies.js';

export { TOWER_FLOORS, floorCost, costRange, sweepLimit, floorPower, zoneOf, isRestFloor };

/* ─────────────────────────── 입장 판정 ─────────────────────────── */

/**
 * 그날이 매달 1일인가.
 *
 * ★ 달력에 `dayOfMonth` 같은 함수가 **없다.** `calendar().dayOfWeek === 1` 로 검사하면
 *   한 달에 4번(1·8·15·22일) 참이 된다 — 실제로 확인한 함정이다.
 *   주(week)까지 같이 봐야 한 달에 한 번이 된다.
 */
export function isEntryDay(st = State.state) {
  const c = State.calendar(st.day || 1);
  return c.week === 1 && c.dayOfWeek === 1;
}

/** 이번 달에 이미 다녀왔는가.
 *  ★ `advanceDays` 에는 월 경계 훅이 없다 — 플래그를 저장하면 영원히 리셋되지 않는다.
 *     그래서 "마지막으로 들어간 날"을 저장하고 날짜로 판정한다. */
export function alreadyRanThisMonth(st = State.state) {
  const last = st.tower?.lastRunDay || 0;
  return last > 0 && last === (st.day || 0);
}

/**
 * 지금 탑에 들어갈 수 있는가.
 * @returns {{ok:boolean, reason:string}}
 */
export function canEnter(st = State.state) {
  if (!isEntryDay(st)) {
    const c = State.calendar(st.day || 1);
    return { ok: false, reason: `탑은 매달 1일에만 열린다. (지금 ${c.month}월 ${c.week}주 ${c.dayOfWeek}일차)` };
  }
  if (alreadyRanThisMonth(st)) return { ok: false, reason: '이번 달에는 이미 다녀왔다. 다음 달 1일에 다시 열린다.' };
  return { ok: true, reason: '' };
}

/** 다음 입장일까지 며칠 남았나 */
export function daysUntilEntry(st = State.state) {
  const day = st.day || 1;
  for (let d = 0; d <= State.DAYS_PER_MONTH; d++) {
    const c = State.calendar(day + d);
    if (c.week === 1 && c.dayOfWeek === 1 && (d > 0 || !alreadyRanThisMonth(st))) return d;
  }
  return 0;
}

/* ─────────────────────────── 층별 난수 ───────────────────────────
 * ★ 드랍을 모듈 전역 `globalRng` 로 굴리면 안 된다. `load()` 가 그 시드를 게임 최초 상태로
 *   되감기 때문에, 새로고침 → 같은 호출 순서 재현 → **원하는 펫이 나올 때까지 반복**이 된다.
 *   (전투 시드는 이미 날짜를 섞어 이 문제를 막아 뒀는데 드랍만 빠져 있었다.)
 *   층마다 독립 RNG 를 만들어 그 비대칭을 상속하지 않는다.
 */

function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 이 층 전용 시드 — 같은 날·같은 부대·같은 층이면 항상 같다 */
export function floorSeed(st, floor, squadId) {
  return (hashStr(`tw#${floor}#${squadId || ''}#${st.day || 0}`) ^ ((st.seed || 0) >>> 0)) >>> 0;
}

/** 가중치 배열에서 하나 고른다 */
function pickWeighted(r, weights) {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return 0;
  let x = r.float(0, total);
  for (let i = 0; i < weights.length; i++) {
    x -= Math.max(0, weights[i]);
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

/* ─────────────────────────── 층 편성 ─────────────────────────── */

/** 이 층에 나올 펫 (종 + 등급). 층이 오를수록 높은 tier·등급이 나온다. */
export function floorPet(st, floor, squadId) {
  const r = new RNG(floorSeed(st, floor, squadId) ^ 0x9e3779b9);
  const tier = pickWeighted(r, tierWeights(floor)) + 1;
  const pool = petsOfTier(tier);
  if (!pool.length) return null;
  const sp = pool[Math.floor(r.float(0, pool.length)) % pool.length];
  const grade = PET_GRADES[clamp(pickWeighted(r, gradeWeights(floor)), 0, PET_GRADES.length - 1)];
  return { sid: sp.id, grade };
}

/**
 * 층 하나를 합성 의뢰로 만든다 (던전의 dungeonQuest 와 같은 방식).
 * 적 종류는 층수에 맞춰 enemies.js 에서 뽑고, 배율은 floorPower 로 준다.
 */
export function towerQuest(st, floor, squadId) {
  const f = clamp(Math.round(floor), 1, TOWER_FLOORS);
  const r = new RNG(floorSeed(st, f, squadId));
  const count = floorEnemyCount(f);
  const power = floorPower(f);

  // 적 풀: 층이 오를수록 높은 tier 를 섞는다. (적 tier 상한은 5, 레벨은 80 클램프)
  // enemiesFor(biome, tier, opt) — 탑은 동굴 지형으로 고정한다.
  const maxTier = clamp(1 + Math.floor((f / TOWER_FLOORS) * 5), 1, 5);
  const usable = enemiesFor('cave', maxTier, { spread: 1 }) || [];
  if (!usable.length) return null;

  const units = [];
  for (let i = 0; i < count; i++) {
    const e = usable[Math.floor(r.float(0, usable.length)) % usable.length];
    units.push({ enemyId: e.id, level: 80, slotIndex: i });
  }

  return {
    id: `tw_${f}`,
    name: `무한의 탑 ${f}층`,
    type: '섬멸',
    cityId: null,                 // 도시가 아니다 → 평판 경로를 안 탄다
    biome: 'cave',
    rank: 'S',
    sub: 0,
    rankLabel: 'S',
    elite: false,
    level: 80,
    days: 0,                      // 부대를 잠그지 않는다
    waves: [{ units, formationId: 'basic', power }],
    reward: { gold: 0, exp: 0, renown: 0, itemRolls: [] },
    desc: `${zoneOf(f)} — ${f}층.`,
    expiresDay: Number.MAX_SAFE_INTEGER,
    towerFloor: f,
  };
}

/**
 * 층 전투 설정. 아군은 questBattleDefs 를 그대로 지나므로
 * 진형·장비·세트 고유효과·펫이 전부 실린다.
 *
 * @param {object} opts `{carry: {uid: hp}}` 층 이월 체력
 */
export function towerBattleDefs(st, floor, squadId, opts = {}) {
  const f = clamp(Math.round(floor), 1, TOWER_FLOORS);
  const q = towerQuest(st, f, squadId);
  if (!q) throw new Error('탑 편성을 만들지 못했다.');

  const cfg = Quest.questBattleDefs(q, 0, st, squadId);
  cfg.seed = floorSeed(st, f, squadId);
  cfg.towerFloor = f;
  cfg.tower = true;
  cfg.title = `무한의 탑 ${f}층 — ${zoneOf(f)}`;

  // ★ 층의 주인 — 펫이 적으로 하나 선다.
  //   `pet:true` 를 **안** 붙인다. 붙이면 엔진이 승패에서 빼기 때문에 안 잡아도 이겨 버린다.
  //   "이기면 얻는다" 가 성립하려면 실제로 쓰러뜨려야 한다.
  const pp = floorPet(st, f, squadId);
  if (pp) {
    const sp = getPetSpecies(pp.sid);
    const stats = Pet.petStats(pp);
    const power = floorPower(f);
    cfg.enemies.push({
      uid: `tw_pet_${f}`,
      name: `${sp.name} (탑의 주인)`,
      side: 'enemy',
      classId: null,
      enemyId: null,
      level: 80,
      grade: pp.grade,
      // 적으로 설 때는 층 배율을 그대로 먹인다 — 아군 펫과 같은 값이면 후반부에 종잇장이 된다
      stats: {
        hp: Math.round(stats.hp * power), atk: Math.round(stats.atk * power),
        def: Math.round(stats.def * power), res: Math.round(stats.res * power),
        spd: stats.spd, crit: stats.crit, critDmg: stats.critDmg, eva: stats.eva,
      },
      skills: Array.isArray(sp.skills) ? sp.skills.slice() : [],
      basicFx: sp.basicFx || 'slash',
      basicRange: sp.basicRange || 'melee',
      basicDmgType: sp.basicDmgType || 'phys',
      slot: { x: 0.96, y: 0.5 },
      recipe: sp.sprite,
      boss: true,
      specials: [],
      towerPet: pp,          // 드랍 판정이 읽는다
    });
  }

  /* 층 이월 체력.
   * carry[uid] === 0 은 **앞 층에서 쓰러졌다**는 뜻이다. 이때 hp 를 1 로 clamp 하면
   * 쓰러진 단원이 다음 층에 멀쩡히 나오게 된다 — 아예 편성에서 뺀다.
   * (25층마다 오는 회복 지점에서 carry 를 비우면 전원 복귀한다.) */
  const carry = opts.carry;
  if (carry) {
    cfg.allies = cfg.allies.filter((a) => !(carry[a.uid] === 0));
    for (const a of cfg.allies) {
      if (Object.prototype.hasOwnProperty.call(carry, a.uid)) {
        a.hp = clamp(Math.round(carry[a.uid]), 1, Math.round(a.stats.hp));
      }
    }
  }
  return cfg;
}

/* ─────────────────────────── 한 층 시뮬 ─────────────────────────── */

/**
 * 전투 하나를 헤드리스로 끝까지 돌린다 (ui/battle.js 를 거치지 않는다).
 * 결과 객체에는 생존자 uid 만 있고 **남은 체력이 없다** — 층 이월에 필요하므로
 * 전투 객체(`unitOf`)를 같이 돌려준다.
 */
function simulateBattle(cfg, maxSeconds = 60) {
  const b = createBattle(cfg);
  const dt = 1 / 60;
  let t = 0;
  while (!b.finished && t < maxSeconds) { b.step(dt); t += dt; }
  return b;
}

/**
 * 한 층을 치른다. **상태를 바꾸지 않는다** — 골드 차감·기록은 호출자(climb)가 한다.
 * @returns {{win:boolean, floor:number, carry:object, pet:object|null, time:number}}
 */
export function runFloor(st, squadId, floor, carry = null) {
  const f = clamp(Math.round(floor), 1, TOWER_FLOORS);
  const cfg = towerBattleDefs(st, f, squadId, { carry });
  const b = simulateBattle(cfg);
  const res = b.result;
  const win = res.winner === 'ally';

  // 살아남은 아군의 체력을 다음 층으로 넘긴다.
  // ★ 죽은 단원은 아예 넘기지 않는다 — carry 에 없으면 다음 층에서 만피로 서므로,
  //   "쓰러진 단원이 다음 층에 멀쩡히 나온다"가 된다. 그래서 0 을 명시적으로 넣는다.
  // ★ 쓰러진 사람의 0 은 `towerBattleDefs` 가 그를 편성에서 빼기 때문에 아래 루프에 안 잡힌다.
  //    그래서 0 이 한 층만 살고 사라져 **두 층 뒤에 만피로 복귀**했다. 앞선 0 을 먼저 옮겨 둔다.
  const next = {};
  if (win) {
    if (carry) for (const [uid, hp] of Object.entries(carry)) if (hp === 0) next[uid] = 0;
    for (const a of cfg.allies) {
      const u = b.unitOf(a.uid);
      next[a.uid] = u && u.alive ? Math.max(1, Math.round(u.hp)) : 0;
    }
  }
  return { win, floor: f, carry: next, time: res.time, result: res, cfg };
}

/* ─────────────────────────── 등반 ─────────────────────────── */

/**
 * 자동 등반. 골드가 떨어지거나 패배할 때까지 한 층씩 올라간다.
 *
 * @param {object} st
 * @param {string} squadId
 * @param {object} opts `{maxFloors, onFloor}` — onFloor 는 층마다 호출되는 콜백(UI 진행 표시용)
 * @returns {{ok:boolean, reason:string, from:number, reached:number, spent:number, pets:Array, log:Array}}
 */
export function climb(st, squadId, opts = {}) {
  const chk = canEnter(st);
  if (!chk.ok && !opts.force) return { ok: false, reason: chk.reason, from: 0, reached: 0, spent: 0, pets: [], log: [] };

  const sq = (st.squads || []).find((s) => s.id === squadId);
  if (!sq) return { ok: false, reason: '부대를 찾을 수 없습니다.', from: 0, reached: 0, spent: 0, pets: [], log: [] };

  const best = st.tower?.best || 0;
  const sweepTo = sweepLimit(best);
  const maxFloors = opts.maxFloors || TOWER_FLOORS;

  let spent = 0;
  const gotPets = [];
  const log = [];

  /* ── 1) 소탕 구간 — 전투 없이 골드만 낸다.
   *    ★ 전투가 없으므로 **드랍도 없다.** 매달 새로 오른 구간만 벌이가 된다. */
  let floor = 1;
  if (sweepTo >= 1) {
    const cost = costRange(1, sweepTo);
    if (st.gold < cost) {
      return {
        ok: false, reason: `소탕에만 ${cost.toLocaleString()}G 가 필요하다. (보유 ${st.gold.toLocaleString()}G)`,
        from: 1, reached: 0, spent: 0, pets: [], log: [],
      };
    }
    st.gold -= cost;
    spent += cost;
    floor = sweepTo + 1;
    log.push({ type: 'sweep', from: 1, to: sweepTo, cost });
  }

  /* ── 2) 등반 구간 — 여기서부터 실제로 싸운다. 체력은 층을 넘어 이월된다. */
  const from = floor;
  let carry = null;             // null = 만피에서 시작
  let reached = floor - 1;

  for (let n = 0; n < maxFloors && floor <= TOWER_FLOORS; n++, floor++) {
    const cost = floorCost(floor);
    if (st.gold < cost) {
      log.push({ type: 'broke', floor, cost, gold: st.gold });
      break;
    }
    st.gold -= cost;
    spent += cost;

    const r = runFloor(st, squadId, floor, carry);
    if (!r.win) {
      log.push({ type: 'lose', floor, time: r.time });
      break;
    }
    reached = floor;

    /* 이번 층에서 쓰러진 단원을 로그에 남긴다.
     * 쓰러진 단원은 다음 회복 지점까지 편성에서 빠지는데(= 설계), 알려 주지 않으면
     * "사람이 조용히 사라진다"로 읽힌다. 누가 언제 빠졌는지 이름으로 적는다. */
    const fell = [];
    for (const [uid, hp] of Object.entries(r.carry)) {
      if (hp !== 0) continue;
      if (carry && carry[uid] === 0) continue;          // 앞 층에서 이미 빠진 사람
      const m = (st.roster || []).find((x) => x && x.uid === uid);
      fell.push(m ? m.name : (Pet.getPet(st, uid) ? Pet.petLabel(Pet.getPet(st, uid)) : uid));
    }
    if (fell.length) log.push({ type: 'fall', floor, names: fell });

    carry = r.carry;

    // 펫 드랍 — 층 전용 RNG (globalRng 금지: load() 가 시드를 되감아 리롤이 가능해진다)
    const pp = floorPet(st, floor, squadId);
    if (pp) {
      const dr = new RNG(floorSeed(st, floor, squadId) ^ 0x5bf03635);
      if (dr.chance(dropChance(floor))) {
        const pet = Pet.makePet(st, pp.sid, pp.grade);
        if (pet) {
          if (!Array.isArray(st.pets)) st.pets = [];
          st.pets.push(pet);
          gotPets.push(pet);
          log.push({ type: 'drop', floor, pet });
        }
      }
    }

    // 회복 지점
    if (isRestFloor(floor)) {
      carry = null;
      log.push({ type: 'rest', floor });
    }
    if (typeof opts.onFloor === 'function') opts.onFloor(floor, r);
  }

  // 기록 갱신
  if (!st.tower) st.tower = { best: 0, lastRunDay: 0, lastRunFloor: 0 };
  st.tower.best = Math.max(st.tower.best || 0, reached);
  st.tower.lastRunDay = st.day || 0;
  st.tower.lastRunFloor = reached;

  return { ok: true, reason: '', from, reached, spent, pets: gotPets, log };
}

/**
 * 이번 달 등반에 드는 골드를 미리 계산한다 (UI 표시용).
 * @returns {{sweep:number, sweepTo:number, nextFloor:number, nextCost:number}}
 */
export function costPreview(st = State.state) {
  const best = st.tower?.best || 0;
  const sweepTo = sweepLimit(best);
  const sweep = sweepTo >= 1 ? costRange(1, sweepTo) : 0;
  const nextFloor = Math.min(TOWER_FLOORS, sweepTo + 1);
  return { sweep, sweepTo, nextFloor, nextCost: floorCost(nextFloor) };
}
