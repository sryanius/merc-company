/**
 * 황금 나락 — 잠수 · 채굴
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 규칙 요약
 *   · 도시 아래 갱도. **주당 1회** 내려간다 (요일은 안 가린다).
 *   · 심층 n 을 지날 때마다 n × 40G 를 캔다. 10심층마다 금고가 있어 3배.
 *   · 입장료도 통행료도 없다 — 여기는 **버는 곳**이다.
 *   · 층 사이에 **체력이 이월된다.** 20심층마다 회복 지점이 있다.
 *   · 장비도 펫도 경험치도 안 나온다. 오직 골드다.
 *
 * ── 왜 소탕이 없나
 * 탑에는 "최고 기록 −100층까지 건너뛰기"가 있다. 저기는 층마다 **골드를 내는** 구조라
 * 건너뛰기가 곧 시간 절약이었다. 여기는 층마다 **버는** 구조라, 건너뛰면 그만큼 못 번다.
 * 매주 1심층부터 다시 내려가는 게 곧 보상이다.
 *
 * ── 왜 전투 화면을 안 쓰나
 * 탑과 같은 이유다. `ui/battle.js` 에는 자동 진행 경로가 **의도적으로 없고**(플레이어와의 계약),
 * `fastForward()` 의 12웨이브 하드 캡 때문에 13층째에 런 전체가 조용히 패배 처리된다.
 * 그래서 헤드리스 시뮬로 돌리고, 보고 싶은 심층만 전투 화면으로 띄운다.
 *
 * ── 아군 편성은 반드시 questBattleDefs 를 지난다
 * 이 프로젝트는 아군 UnitDef 조립 경로가 갈려서 진형과 세트 효과가 각각 한 번씩
 * 조용히 안 먹은 전례가 있다. 던전·탑과 같이 **합성 의뢰 → questBattleDefs** 에 위임한다.
 *
 * @module game/abyss
 */

import { clamp } from '../core/util.js';
import { RNG } from '../core/rng.js';
import { createBattle } from '../battle/engine.js';
import {
  ABYSS_NAME, DEPTH_CAP, depthGold, goldRange, depthPower, depthEnemyCount, depthEnemyLevel,
  isRestDepth, isVaultDepth, zoneOf, weekIndex, REST_EVERY, VAULT_EVERY, VAULT_MULT,
} from '../data/abyss.js';
import * as State from './state.js';
import * as Quest from './quest.js';
import { enemiesFor } from '../data/enemies.js';

export {
  ABYSS_NAME, DEPTH_CAP, depthGold, goldRange, depthPower, zoneOf,
  isRestDepth, isVaultDepth, REST_EVERY, VAULT_EVERY, VAULT_MULT,
};

/* ─────────────────────────── 입장 판정 ─────────────────────────── */

/** 이번 주에 이미 내려갔는가.
 *  ★ 요일이 아니라 **주 번호**로 센다 — 고정 요일로 하면 그날 부대가 원정 중일 때
 *     한 주치 임금 재원이 통째로 날아간다. */
export function alreadyRanThisWeek(st = State.state) {
  const a = st.abyss;
  if (!a || !a.lastRunDay) return false;
  return weekIndex(a.lastRunDay) === weekIndex(st.day || 1);
}

/**
 * 지금 내려갈 수 있는가.
 * @returns {{ok:boolean, reason:string}}
 */
export function canEnter(st = State.state) {
  if (alreadyRanThisWeek(st)) {
    return { ok: false, reason: `이번 주에는 이미 내려갔다. ${daysUntilEntry(st)}일 뒤 다시 열린다.` };
  }
  return { ok: true, reason: '' };
}

/** 다음 잠수까지 며칠 남았나 (지금 가능하면 0) */
export function daysUntilEntry(st = State.state) {
  if (!alreadyRanThisWeek(st)) return 0;
  const day = st.day || 1;
  const w = weekIndex(day);
  for (let d = 1; d <= 7; d++) if (weekIndex(day + d) !== w) return d;
  return 0;
}

/* ─────────────────────────── 심층별 난수 ───────────────────────────
 * ★ 모듈 전역 rng 를 쓰면 안 된다. `load()` 가 시드를 되감기 때문에
 *   새로고침 → 같은 호출 순서 재현 → 유리한 편성이 나올 때까지 반복이 된다.
 *   심층마다 독립 RNG 를 만들어 그 비대칭을 상속하지 않는다. (탑과 같은 처리)
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

/** 이 심층 전용 시드 — 같은 날·같은 부대·같은 심층이면 항상 같다 */
export function depthSeed(st, depth, squadId) {
  return (hashStr(`ab#${depth}#${squadId || ''}#${st.day || 0}`) ^ ((st.seed || 0) >>> 0)) >>> 0;
}

/* ─────────────────────────── 심층 편성 ─────────────────────────── */

/**
 * 심층 하나를 합성 의뢰로 만든다 (던전의 dungeonQuest, 탑의 towerQuest 와 같은 방식).
 */
export function abyssQuest(st, depth, squadId) {
  const d = clamp(Math.round(depth), 1, DEPTH_CAP);
  const r = new RNG(depthSeed(st, d, squadId));
  const count = depthEnemyCount(d);
  const power = depthPower(d);
  const level = depthEnemyLevel(d);

  // 적 풀: 깊이에 따라 높은 tier 를 섞는다. (적 tier 상한 5, 레벨 80 클램프)
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
    desc: `${zoneOf(d)} — ${d}심층.`,
    expiresDay: Number.MAX_SAFE_INTEGER,
    abyssDepth: d,
  };
}

/**
 * 심층 전투 설정. 아군은 questBattleDefs 를 그대로 지나므로
 * 진형·장비·세트 고유효과·펫이 전부 실린다.
 *
 * @param {object} opts `{carry: {uid: hp}}` 이월 체력
 */
export function abyssBattleDefs(st, depth, squadId, opts = {}) {
  const d = clamp(Math.round(depth), 1, DEPTH_CAP);
  const q = abyssQuest(st, d, squadId);
  if (!q) throw new Error('나락 편성을 만들지 못했다.');

  const cfg = Quest.questBattleDefs(q, 0, st, squadId);
  cfg.seed = depthSeed(st, d, squadId);
  cfg.abyssDepth = d;
  cfg.abyss = true;
  cfg.title = `${ABYSS_NAME} ${d}심층 — ${zoneOf(d)}`;

  /* 이월 체력.
   * carry[uid] === 0 은 **앞 심층에서 쓰러졌다**는 뜻이다. hp 를 1 로 clamp 하면
   * 쓰러진 단원이 다음 심층에 멀쩡히 나오게 되므로 아예 편성에서 뺀다. */
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

/* ─────────────────────────── 한 심층 시뮬 ─────────────────────────── */

function simulateBattle(cfg, maxSeconds = 60) {
  const b = createBattle(cfg);
  const dt = 1 / 60;
  let t = 0;
  while (!b.finished && t < maxSeconds) { b.step(dt); t += dt; }
  return b;
}

/**
 * 한 심층을 치른다. **상태를 바꾸지 않는다** — 골드 지급·기록은 호출자(dive)가 한다.
 * @returns {{win:boolean, depth:number, carry:object, time:number}}
 */
export function runDepth(st, squadId, depth, carry = null) {
  const d = clamp(Math.round(depth), 1, DEPTH_CAP);
  const cfg = abyssBattleDefs(st, d, squadId, { carry });
  const b = simulateBattle(cfg);
  const res = b.result;
  const win = res.winner === 'ally';

  /* 살아남은 아군의 체력을 다음 심층으로 넘긴다.
   *
   * ★ 쓰러진 단원은 0 을 **명시적으로** 넣는다 — carry 에 키가 없으면 다음 심층에 만피로 선다.
   *   그런데 그것만으로는 부족했다: `abyssBattleDefs` 가 0 인 단원을 편성에서 빼기 때문에
   *   아래 루프의 `cfg.allies` 에 그 사람이 아예 없고, 그래서 0 이 **한 심층만 살고 사라졌다.**
   *   실제로 같은 사람이 3·6·8심층에서 세 번 쓰러지는 로그가 나왔다
   *   ("회복 지점까지 못 나온다"고 써 놓고 두 심층 뒤에 만피로 복귀). 앞선 0 을 먼저 옮겨 둔다. */
  const next = {};
  if (win) {
    if (carry) for (const [uid, hp] of Object.entries(carry)) if (hp === 0) next[uid] = 0;
    for (const a of cfg.allies) {
      const u = b.unitOf(a.uid);
      next[a.uid] = u && u.alive ? Math.max(1, Math.round(u.hp)) : 0;
    }
  }
  return { win, depth: d, carry: next, time: res.time, result: res, cfg };
}

/* ─────────────────────────── 잠수 ─────────────────────────── */

/**
 * 자동 잠수. 패배할 때까지 한 심층씩 내려간다.
 *
 * @param {object} st
 * @param {string} squadId
 * @param {object} opts `{maxDepth, force, onDepth}`
 * @returns {{ok:boolean, reason:string, reached:number, gold:number, log:Array}}
 */
export function dive(st, squadId, opts = {}) {
  const fail = (reason) => ({ ok: false, reason, reached: 0, gold: 0, log: [] });

  const chk = canEnter(st);
  if (!chk.ok && !opts.force) return fail(chk.reason);

  const sq = (st.squads || []).find((s) => s.id === squadId);
  if (!sq) return fail('부대를 찾을 수 없습니다.');
  if (!(sq.memberUids || []).filter(Boolean).length) return fail('부대에 단원이 없다.');

  const maxDepth = clamp(opts.maxDepth || DEPTH_CAP, 1, DEPTH_CAP);
  const log = [];
  let gold = 0;
  let reached = 0;
  let carry = null;             // null = 만피에서 시작

  for (let d = 1; d <= maxDepth; d++) {
    const r = runDepth(st, squadId, d, carry);
    if (!r.win) {
      log.push({ type: 'lose', depth: d, time: r.time });
      break;
    }
    reached = d;

    const g = depthGold(d);
    gold += g;
    if (isVaultDepth(d)) log.push({ type: 'vault', depth: d, gold: g });

    /* 이번 심층에서 쓰러진 단원을 로그에 남긴다.
     * 쓰러진 단원은 다음 회복 지점까지 편성에서 빠지는데, 알려 주지 않으면
     * "사람이 조용히 사라진다"로 읽힌다. */
    const fell = [];
    for (const [uid, hp] of Object.entries(r.carry)) {
      if (hp !== 0) continue;
      if (carry && carry[uid] === 0) continue;          // 앞 심층에서 이미 빠진 사람
      const m = (st.roster || []).find((x) => x && x.uid === uid);
      if (m) fell.push(m.name);
    }
    if (fell.length) log.push({ type: 'fall', depth: d, names: fell });

    carry = r.carry;

    if (isRestDepth(d)) {
      carry = null;
      log.push({ type: 'rest', depth: d });
    }
    if (typeof opts.onDepth === 'function') opts.onDepth(d, r);
  }

  // ★ 골드는 여기서 **한 번에** 준다. 심층마다 st.gold 를 건드리면
  //   중간에 예외가 나올 때 절반만 지급된 상태가 남는다.
  st.gold = (st.gold || 0) + gold;

  if (!st.abyss) st.abyss = { best: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0 };
  st.abyss.best = Math.max(st.abyss.best || 0, reached);
  st.abyss.lastRunDay = st.day || 0;
  st.abyss.lastRunDepth = reached;
  st.abyss.lastGold = gold;

  return { ok: true, reason: '', reached, gold, log };
}
