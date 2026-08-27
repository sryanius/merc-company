/**
 * 나락·탑 **다시 돌리기** — 아군을 인자로 받는 러너
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 있나
 *   서버는 클라이언트가 올린 「45심층까지 내려갔다」를 믿을 수 없다. 그런데 나락·탑은
 *   **이미 결정론**이다 — 심층/층마다의 시드가 `(세이브 시드, 날짜, 부대 id, 깊이)`
 *   네 개로만 정해진다. 그러면 **아군 편성만 받으면 서버가 같은 판을 다시 돌려**
 *   도달 심층·층을 스스로 계산할 수 있다 (PvP 방어 편성 `pvp_defense.units` 와 같은 방식).
 *
 *   그래서 이 모듈은 `state` 를 **안 문다.** 아군 UnitDef 배열과 스칼라 넷
 *   (`seed` · `day` · `squadId` · 시작 깊이)만 받는다.
 *
 * ★★ 사본을 만들지 않는다 (§94)
 *   여기 있는 것은 `game/abyss.js` · `game/tower.js` 에서 **옮겨 온 한 벌**이다.
 *   저쪽은 이 모듈을 import 해서 쓴다 — 심층 시드·합성 의뢰·이월 체력·층 루프가
 *   두 벌이 되면 「서버 판정과 클라 화면이 다르다」가 조용히 생긴다.
 *   저쪽에 남은 것은 **상태를 만지는 부분뿐**이다 (골드 지급·기록 갱신·펫 드랍·로그 이름).
 *
 * ★ import 는 아래 열 줄이 전부여야 한다. 그 가벼움이 존재 이유다.
 *   state/gear/squad/quest/merc/world 를 물기 시작하면 게임 전체가 서버로 딸려 온다.
 *   (`game/pet.js` 는 `core/util` 과 `data/pets` 밖에 안 문다 — 탑의 «층의 주인»
 *    펫이 **적으로** 서기 때문에 스탯 공식이 필요하다. 아군 펫은 이미 편성에 실려 온다.)
 *
 * @module game/runverify
 */

import { clamp } from '../core/util.js';
import { RNG } from '../core/rng.js';
import { createBattle } from '../battle/engine.js';
import {
  ABYSS_NAME, DEPTH_CAP, depthPower, depthEnemyCount, depthEnemyLevel, isRestDepth,
  zoneOf as abyssZone,
} from '../data/abyss.js';
import {
  TOWER_FLOORS, floorPower, floorEnemyCount, isRestFloor, tierWeights, gradeWeights,
  zoneOf as towerZone,
} from '../data/tower.js';
import { getSkill } from '../data/skills.js';
import { enemiesFor } from '../data/enemies.js';
import { PET_GRADES, petsOfTier, getPetSpecies } from '../data/pets.js';
import { enemyUnitDefs, hashStr, MAX_QUEST_LEVEL } from './enemygen.js';
import { petStats } from './pet.js';

/** 전투 하나에 허용하는 시뮬 시간(초). 엔진의 시간초과 판정과는 별개인 안전망이다. */
export const SIM_SECONDS = 60;

/* ═══════════════════════════ 시드 ═══════════════════════════
 * ★ 모듈 전역 rng 를 쓰면 안 된다. `load()` 가 시드를 되감기 때문에
 *   새로고침 → 같은 호출 순서 재현 → 유리한 결과가 나올 때까지 반복이 된다.
 *   깊이마다 독립 RNG 를 만들어 그 비대칭을 상속하지 않는다.
 *
 * ctx 는 `{ seed, day }` 만 읽는다 — 그래서 `state` 를 그대로 넘겨도 되고,
 * 서버처럼 스칼라 둘만 있어도 된다.
 */

/** 이 심층 전용 시드 — 같은 날·같은 부대·같은 심층이면 항상 같다 */
export function depthSeed(ctx, depth, squadId) {
  return (hashStr(`ab#${depth}#${squadId || ''}#${ctx?.day || 0}`) ^ ((ctx?.seed || 0) >>> 0)) >>> 0;
}

/** 이 층 전용 시드 — 같은 날·같은 부대·같은 층이면 항상 같다 */
export function floorSeed(ctx, floor, squadId) {
  return (hashStr(`tw#${floor}#${squadId || ''}#${ctx?.day || 0}`) ^ ((ctx?.seed || 0) >>> 0)) >>> 0;
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

/* ═══════════════════════════ 합성 의뢰 ═══════════════════════════ */

/**
 * 나락 심층 하나를 합성 의뢰로 만든다 (던전의 dungeonQuest, 탑의 towerQuest 와 같은 방식).
 * 상태를 안 읽는다 — `ctx.seed` · `ctx.day` · `squadId` · `depth` 넷이 전부다.
 */
export function abyssQuest(ctx, depth, squadId) {
  const d = clamp(Math.round(depth), 1, DEPTH_CAP);
  const r = new RNG(depthSeed(ctx, d, squadId));
  const count = depthEnemyCount(d);
  const power = depthPower(d);
  const level = depthEnemyLevel(d);

  // 적 풀: 깊이에 따라 높은 tier 를 섞는다. (적 tier 상한 5, 레벨은 enemyStats 가 클램프한다)
  // 탑과 갈라 보이도록 지형을 mountain 으로 둔다 — 무너진 갱도라는 설정에 맞다.
  const maxTier = clamp(1 + Math.floor((d / 90) * 5), 1, 5);
  const usable = enemiesFor('mountain', maxTier, { spread: 1 }) || [];
  if (!usable.length) return null;

  const units = [];
  for (let i = 0; i < count; i++) {
    const e = usable[Math.floor(r.float(0, usable.length)) % usable.length];
    units.push({ enemyId: e.id, level, slotIndex: i });
  }

  return {
    id: `ab_${d}`,
    name: `${ABYSS_NAME} ${d}심층`,
    type: '탐색',
    cityId: null,                 // 도시가 아니다 → 평판 경로를 안 탄다
    biome: 'cave',
    scene: 'cave',
    rank: 'S',
    sub: 0,
    rankLabel: 'S',
    elite: false,
    level,
    days: 0,                      // 부대를 잠그지 않는다
    waves: [{ units, formationId: 'basic', power }],
    // ★ 보상은 여기 안 넣는다. 골드는 dive() 가 심층마다 직접 준다 —
    //   여기에 넣으면 "심층 관전"만으로도 골드가 들어온다.
    reward: { gold: 0, exp: 0, renown: 0, itemRolls: [] },
    desc: `${abyssZone(d)} — ${d}심층.`,
    expiresDay: Number.MAX_SAFE_INTEGER,
    abyssDepth: d,
  };
}

/**
 * 탑 층 하나를 합성 의뢰로 만든다.
 * ※ 적 레벨은 상한 고정이다. 예전엔 80 을 손으로 적어 뒀는데 그 값은
 *   `data/limits.js` → `enemygen.MAX_QUEST_LEVEL` 한 곳에서 온다(사본 금지).
 */
export function towerQuest(ctx, floor, squadId) {
  const f = clamp(Math.round(floor), 1, TOWER_FLOORS);
  const r = new RNG(floorSeed(ctx, f, squadId));
  const count = floorEnemyCount(f);
  const power = floorPower(f);
  const level = MAX_QUEST_LEVEL;

  // 적 풀: 층이 오를수록 높은 tier 를 섞는다. (적 tier 상한은 5)
  // enemiesFor(biome, tier, opt) — 탑은 동굴 지형으로 고정한다.
  const maxTier = clamp(1 + Math.floor((f / TOWER_FLOORS) * 5), 1, 5);
  const usable = enemiesFor('cave', maxTier, { spread: 1 }) || [];
  if (!usable.length) return null;

  const units = [];
  for (let i = 0; i < count; i++) {
    const e = usable[Math.floor(r.float(0, usable.length)) % usable.length];
    units.push({ enemyId: e.id, level, slotIndex: i });
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
    level,
    days: 0,                      // 부대를 잠그지 않는다
    waves: [{ units, formationId: 'basic', power }],
    reward: { gold: 0, exp: 0, renown: 0, itemRolls: [] },
    desc: `${towerZone(f)} — ${f}층.`,
    expiresDay: Number.MAX_SAFE_INTEGER,
    towerFloor: f,
  };
}

/* ═══════════════════════════ 탑의 주인(펫) ═══════════════════════════ */

/** 이 층에 나올 펫 (종 + 등급). 층이 오를수록 높은 tier·등급이 나온다. */
export function floorPet(ctx, floor, squadId) {
  const r = new RNG(floorSeed(ctx, floor, squadId) ^ 0x9e3779b9);
  const tier = pickWeighted(r, tierWeights(floor)) + 1;
  const pool = petsOfTier(tier);
  if (!pool.length) return null;
  const sp = pool[Math.floor(r.float(0, pool.length)) % pool.length];
  const grade = PET_GRADES[clamp(pickWeighted(r, gradeWeights(floor)), 0, PET_GRADES.length - 1)];
  return { sid: sp.id, grade };
}

/**
 * 층의 주인 — 펫이 **적으로** 하나 선다.
 *
 * ★ `pet:true` 를 **안** 붙인다. 붙이면 엔진이 승패에서 빼기 때문에 안 잡아도 이겨 버린다.
 *   "이기면 얻는다" 가 성립하려면 실제로 쓰러뜨려야 한다.
 * ★★ 그래서 이건 **아군 편성에 실려 오는 펫과 완전히 다른 것**이다.
 *   재계산에서 이걸 빼면 적이 한 기 모자라 도달 층이 통째로 어긋난다 (실측으로 확인).
 *
 * @returns {object|null} 적 UnitDef (펫 풀이 비면 null)
 */
export function towerPetDef(ctx, floor, squadId) {
  const f = clamp(Math.round(floor), 1, TOWER_FLOORS);
  const pp = floorPet(ctx, f, squadId);
  if (!pp) return null;
  const sp = getPetSpecies(pp.sid);
  if (!sp) return null;
  const stats = petStats(pp);
  const power = floorPower(f);
  return {
    uid: `tw_pet_${f}`,
    name: `${sp.name} (탑의 주인)`,
    side: 'enemy',
    classId: null,
    enemyId: null,
    level: MAX_QUEST_LEVEL,
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
  };
}

/* ═══════════════════════════ 이월 체력 ═══════════════════════════ */

/**
 * 앞 깊이의 체력을 이번 편성에 얹는다. **원본 배열을 안 건드린다** —
 * 아군 편성은 런 하나 동안 재사용되므로 여기서 복사본을 만든다.
 *
 * `carry[uid] === 0` 은 **앞 깊이에서 쓰러졌다**는 뜻이다. hp 를 1 로 clamp 하면
 * 쓰러진 단원이 다음 깊이에 멀쩡히 나오게 되므로 아예 편성에서 뺀다.
 * (회복 지점에서 carry 를 비우면 전원 복귀한다.)
 *
 * @param {Array<object>} allies
 * @param {Object<string,number>|null} carry
 * @returns {Array<object>}
 */
export function applyCarry(allies, carry) {
  const list = allies || [];
  if (!carry) return list.slice();
  const out = [];
  for (const a of list) {
    if (carry[a.uid] === 0) continue;
    if (Object.prototype.hasOwnProperty.call(carry, a.uid)) {
      out.push({ ...a, hp: clamp(Math.round(carry[a.uid]), 1, Math.round(a.stats.hp)) });
    } else {
      out.push(a);
    }
  }
  return out;
}

/**
 * 다음 깊이로 넘길 체력을 읽는다.
 *
 * ★ 쓰러진 단원은 0 을 **명시적으로** 넣는다 — carry 에 키가 없으면 다음 깊이에 만피로 선다.
 *   그런데 그것만으로는 부족했다: `applyCarry` 가 0 인 단원을 편성에서 빼기 때문에
 *   `defs` 에 그 사람이 아예 없고, 그래서 0 이 **한 깊이만 살고 사라졌다.**
 *   실제로 같은 사람이 3·6·8심층에서 세 번 쓰러지는 로그가 나왔다
 *   ("회복 지점까지 못 나온다"고 써 놓고 두 깊이 뒤에 만피로 복귀). 앞선 0 을 먼저 옮겨 둔다.
 */
function nextCarry(defs, battle, prev) {
  const next = {};
  if (prev) for (const [uid, hp] of Object.entries(prev)) if (hp === 0) next[uid] = 0;
  for (const a of defs) {
    const u = battle.unitOf(a.uid);
    next[a.uid] = u && u.alive ? Math.max(1, Math.round(u.hp)) : 0;
  }
  return next;
}

/* ═══════════════════════════ 전투 설정 ═══════════════════════════ */

/**
 * 전투 하나를 헤드리스로 끝까지 돌린다 (`ui/battle.js` 를 거치지 않는다).
 * 결과 객체에는 생존자 uid 만 있고 **남은 체력이 없다** — 이월에 필요하므로
 * 전투 객체(`unitOf`)를 같이 쓴다.
 *
 * ── 왜 전투 화면을 안 쓰나
 * `ui/battle.js` 에는 자동 진행 경로가 **의도적으로 없고**(플레이어와의 계약),
 * `fastForward()` 의 12웨이브 하드 캡 때문에 13번째에 런 전체가 조용히 패배 처리된다.
 */
export function simulateBattle(cfg, maxSeconds = SIM_SECONDS) {
  const b = createBattle(cfg);
  const dt = 1 / 60;
  let t = 0;
  while (!b.finished && t < maxSeconds) { b.step(dt); t += dt; }
  return b;
}

/** 합성 의뢰 + 아군 편성 → createBattle 설정. 아군은 **인자로 받은 것만** 쓴다. */
function battleCfg(q, extraEnemies, allies, seed, opts) {
  const wave = q.waves[0];
  const enemies = enemyUnitDefs(wave, q, 0);
  for (const e of extraEnemies) if (e) enemies.push(e);
  const allyFormationId = opts.allyFormationId || 'basic';
  return {
    allies: applyCarry(allies, opts.carry),
    enemies,
    allyFormationId,
    enemyFormationId: wave.formationId || 'basic',
    // 별칭 (렌더러/엔진이 다른 이름을 볼 수도 있어 함께 넣는다)
    formation: allyFormationId,
    formationId: allyFormationId,
    biome: q.scene || q.biome,
    seed,
    questId: q.id,
    waveIndex: 0,
    waveCount: 1,
    squadId: opts.squadId || null,
    /* ★ 스킬 해석기를 **설정에 직접 싣는다.** 전역 `setSkillResolver` 는 UI 부팅이
     *   불러 주는데, 서버에는 그 부팅이 없다. 빼먹으면 스킬이 통째로 사라져
     *   승률이 완전히 달라진다(6차 세션 사고). 엔진은 cfg.getSkill 을 먼저 본다. */
    getSkill,
  };
}

/**
 * 나락 심층 전투 설정.
 * @param {object} o `{allies, ctx, squadId, depth, carry, allyFormationId}`
 */
export function abyssBattleDefs(o) {
  const d = clamp(Math.round(o.depth), 1, DEPTH_CAP);
  const q = abyssQuest(o.ctx, d, o.squadId);
  if (!q) throw new Error('나락 편성을 만들지 못했다.');
  const cfg = battleCfg(q, [], o.allies, depthSeed(o.ctx, d, o.squadId), o);
  cfg.abyssDepth = d;
  cfg.abyss = true;
  cfg.title = `${ABYSS_NAME} ${d}심층 — ${abyssZone(d)}`;
  return cfg;
}

/**
 * 탑 층 전투 설정. 층의 주인(펫)이 적으로 하나 더 선다.
 * @param {object} o `{allies, ctx, squadId, floor, carry, allyFormationId}`
 */
export function towerBattleDefs(o) {
  const f = clamp(Math.round(o.floor), 1, TOWER_FLOORS);
  const q = towerQuest(o.ctx, f, o.squadId);
  if (!q) throw new Error('탑 편성을 만들지 못했다.');
  const cfg = battleCfg(q, [towerPetDef(o.ctx, f, o.squadId)], o.allies, floorSeed(o.ctx, f, o.squadId), o);
  cfg.towerFloor = f;
  cfg.tower = true;
  cfg.title = `무한의 탑 ${f}층 — ${towerZone(f)}`;
  return cfg;
}

/* ═══════════════════════════ 한 판 ═══════════════════════════ */

/**
 * 심층 하나를 치른다. **상태를 바꾸지 않는다.**
 * @returns {{win:boolean, depth:number, carry:object, time:number, result:object, cfg:object}}
 */
export function runOneDepth(o) {
  const cfg = abyssBattleDefs(o);
  const b = simulateBattle(cfg);
  const res = b.result;
  const win = res.winner === 'ally';
  return {
    win, depth: cfg.abyssDepth, time: res.time, result: res, cfg,
    carry: win ? nextCarry(cfg.allies, b, o.carry) : {},
  };
}

/**
 * 층 하나를 치른다. **상태를 바꾸지 않는다.**
 * @returns {{win:boolean, floor:number, carry:object, time:number, result:object, cfg:object}}
 */
export function runOneFloor(o) {
  const cfg = towerBattleDefs(o);
  const b = simulateBattle(cfg);
  const res = b.result;
  const win = res.winner === 'ally';
  return {
    win, floor: cfg.towerFloor, time: res.time, result: res, cfg,
    carry: win ? nextCarry(cfg.allies, b, o.carry) : {},
  };
}

/* ═══════════════════════════ 런 전체 ═══════════════════════════
 * ★ dive()/climb() 이 이 루프를 그대로 쓴다. 훅 셋으로 «상태를 만지는 부분»만 밖에 남긴다:
 *     before(n)   → false 를 주면 거기서 멈춘다 (탑의 골드 부족)
 *     onWin(n, r) → 이긴 직후. 골드 지급·쓰러진 사람 로그·펫 드랍이 여기서 일어난다.
 *     after(n, r) → 회복 지점 처리까지 끝난 뒤 (UI 진행 표시)
 */

/**
 * 나락 자동 잠수. 패배할 때까지 한 심층씩 내려간다.
 * @param {object} o `{allies, ctx, squadId, maxDepth, allyFormationId, log, before, onWin, after}`
 * @returns {{reached:number, log:Array}}
 */
export function runAbyss(o) {
  const maxDepth = clamp(o.maxDepth || DEPTH_CAP, 1, DEPTH_CAP);
  const log = o.log || [];
  let reached = 0;
  let carry = null;             // null = 만피에서 시작

  for (let d = 1; d <= maxDepth; d++) {
    if (o.before && o.before(d) === false) break;
    const r = runOneDepth({ ...o, depth: d, carry });
    if (!r.win) {
      log.push({ type: 'lose', depth: d, time: r.time });
      break;
    }
    reached = d;
    if (o.onWin) o.onWin(d, r, carry);
    carry = r.carry;
    if (isRestDepth(d)) {
      carry = null;
      log.push({ type: 'rest', depth: d });
    }
    if (o.after) o.after(d, r);
  }
  return { reached, log };
}

/**
 * 탑 자동 등반. 패배(또는 `before` 가 멈출 때)까지 한 층씩 올라간다.
 * @param {object} o `{allies, ctx, squadId, startFloor, maxFloors, allyFormationId, log, before, onWin, after}`
 * @returns {{reached:number, log:Array}}
 */
export function runTower(o) {
  /* ★ 위쪽으로 clamp 하지 않는다. 소탕이 꼭대기까지 닿아 `startFloor > TOWER_FLOORS` 면
   *   **한 층도 안 오르는 게 맞다.** TOWER_FLOORS 로 눌러 버리면 마지막 층을 한 번 더 싸운다. */
  const start = Math.max(1, Math.round(o.startFloor || 1));
  const maxFloors = o.maxFloors || TOWER_FLOORS;
  const log = o.log || [];
  let reached = start - 1;
  let carry = null;             // null = 만피에서 시작

  let floor = start;
  for (let n = 0; n < maxFloors && floor <= TOWER_FLOORS; n++, floor++) {
    if (o.before && o.before(floor) === false) break;
    const r = runOneFloor({ ...o, floor, carry });
    if (!r.win) {
      log.push({ type: 'lose', floor, time: r.time });
      break;
    }
    reached = floor;
    if (o.onWin) o.onWin(floor, r, carry);
    carry = r.carry;
    if (isRestFloor(floor)) {
      carry = null;
      log.push({ type: 'rest', floor });
    }
    if (o.after) o.after(floor, r);
  }
  return { reached, log };
}

/* ═══════════════════════════ 검증 진입점 ═══════════════════════════ */

/**
 * 나락을 **다시 돌려** 도달 심층을 계산한다.
 *
 * 서버가 부르는 자리다 — `state` 를 안 받는다. 아군 편성(UnitDef 배열)과
 * 스칼라 셋만 있으면 클라이언트가 실제로 돌린 것과 **같은 판**이 나온다.
 *
 * @param {object} o `{allies, seed, day, squadId, maxDepth, allyFormationId}`
 * @returns {{reached:number, log:Array}}
 */
export function verifyAbyss(o = {}) {
  return runAbyss({
    allies: o.allies || [],
    ctx: { seed: o.seed, day: o.day },
    squadId: o.squadId,
    maxDepth: o.maxDepth,
    allyFormationId: o.allyFormationId,
  });
}

/**
 * 탑을 **다시 돌려** 도달 층을 계산한다.
 *
 * ★ 골드는 안 본다. 등반은 「골드가 떨어지면 멈춘다」는 규칙도 있는데 그건 지갑
 *   (= 상태)이라 여기서 못 잰다. 서버는 이 값을 **상한**으로 쓰면 된다 —
 *   골드가 모자랐다면 실제 도달은 이보다 낮을 뿐 높을 수 없다.
 *
 * @param {object} o `{allies, seed, day, squadId, startFloor, maxFloors, allyFormationId}`
 * @returns {{reached:number, log:Array}}
 */
export function verifyTower(o = {}) {
  return runTower({
    allies: o.allies || [],
    ctx: { seed: o.seed, day: o.day },
    squadId: o.squadId,
    startFloor: o.startFloor,
    maxFloors: o.maxFloors,
    allyFormationId: o.allyFormationId,
  });
}
