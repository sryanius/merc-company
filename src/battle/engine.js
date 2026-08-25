// 결정론적 자동전투 시뮬레이터.
// 순수 JS — DOM/Canvas 를 절대 참조하지 않는다 (node 에서 import 가능해야 한다).
//
// 필드 좌표계 (픽셀 아님, 논리 단위 100 x 60):
//   아군 x = 44 - slot.x * 36  (전열 44 ~ 후열 8)
//   적군 x = 56 + slot.x * 36  (전열 56 ~ 후열 92)
//   y     = 8  + slot.y * 44
import { clamp, scaleStats } from '../core/util.js';
import { RNG } from '../core/rng.js';
import { chooseAction, isDamaging, makeBasicSkill } from './ai.js';

/** 전투 제한 시간(초). 초과 시 총 HP 비율 우세승 */
export const TIME_LIMIT = 120;

/* ── 패주 (설계 3a, HANDOFF §26) ─────────────────────────────────────────────
 * 예전에는 **전멸해야만** 전투가 끝났다. 그래서 결과가 「전멸승」/「전멸패」 둘뿐이고
 * "3명 잃고 겨우 이겼다" 같은 중간이 존재하지 않았다 (§24 · §25).
 *
 * 패주를 넣으면 진 쪽도 남은 사람이 살아 나온다 — 그게 부분 패의 실체다.
 *
 * ★ `TIME_LIMIT` 우세승은 실측 1320전 중 **0회**였다. 죽은 코드다. 그건 그대로 두고
 *   (안전망이니까) 실제로 도는 건 아래 규칙이다.
 *
 * ★ 난수를 안 쓴다. 이미 정해진 상태를 읽기만 하므로 rng 소비가 안 늘고,
 *   따라서 "패주를 껐을 때" 와 결과를 1:1로 비교할 수 있다.
 */
/** 자기 전력이 이 밑으로 떨어지면 패주 후보 */
export const ROUT_FLOOR = 0.20;
/** 그리고 상대가 자기보다 이 배 이상 남아 있어야 실제로 패주한다 */
export const ROUT_LEAD = 3.0;
/** 개전 직후에는 안 본다 — 초반 난전에서 한쪽이 잠깐 밀리는 걸 패주로 오판한다 */
export const ROUT_AFTER = 3.0;
/** 고정 시뮬 스텝. 결정론을 위해 항상 이 단위로만 진행한다 */
export const FIXED = 1 / 60;

const ST_KEYS = ['atk', 'def', 'res', 'spd', 'crit', 'critDmg', 'eva'];
const GAUGE_MAX = 100;
const MELEE_DELAY = 0.25;   // 돌진 후 타격까지
const CAST_DELAY = 0.2;     // 자기 대상 시전 후 발동까지
const PROJ_SPEED = 110;     // 투사체 속도 (필드 단위/초)
const PROJ_MIN = 0.08;
const PROJ_MAX = 0.7;
const MAX_ACC = 1.0;        // step(dt) 한 번에 소화하는 최대 시뮬 시간 (프레임 스파이크 보호)

// 스킬 id -> 스킬 정의 전역 해석기. data/skills.js 를 import 하지 않기 위한 주입 지점.
let SKILL_RESOLVER = null;
/** 게임 레이어가 시작 시 한 번 호출: setSkillResolver(getSkill) */
export function setSkillResolver(fn) { SKILL_RESOLVER = typeof fn === 'function' ? fn : null; }

/* ───────────────────────── 세트 고유 효과 (specials) ─────────────────────────
 *
 * `data/sets.js` 의 풀세트 `special` 을 전투에 붙이는 배선이다.
 * **수치는 전부 `UnitDef.specials[].params`(= sets.js 의 `specialParams`)에서만 읽는다.**
 * 엔진에 상수를 새로 만들지 마라 — sets.js 가 유일한 진실의 원천이다.
 *
 *   UnitDef.specials = [{ id, label?, params:{...} }]   // 문자열 id 만 넘겨도 받는다
 *
 * 훅 지점은 전부 `applySpecial(unit, hook, ctx)` 하나로 들어온다:
 *
 * | hook          | 시점                        | ctx                                                   |
 * |---------------|-----------------------------|-------------------------------------------------------|
 * | `battleStart` | 전투 시작 직후 (t=0)        | `{}`                                                   |
 * | `act`         | 행동을 개시할 때            | `{skill, targets}`                                     |
 * | `dealDamage`  | 피해를 준 직후 (가해자)     | `{target, amount, total, crit, dmgType, skill, killed}`|
 * | `takeDamage`  | 피해를 받은 직후 (피격자)   | `{srcUid, amount, total, crit, dmgType, killed}`        |
 * | `shieldBreak` | 방어막이 피해로 깨진 순간   | `{srcUid, amount}`                                     |
 * | `lethal`      | 전투 불능이 될 피해를 받음  | `{srcUid, amount, total, dmgType, after}` ★            |
 * | `kill`        | 적을 처치한 직후 (가해자)   | `{target, skill}`                                      |
 * | `tick`        | 매 시뮬 스텝 (주기 효과용)  | `{dt}`                                                 |
 *
 * ★ `lethal` 은 `true` 를 돌려주면 **죽지 않는다**(부활). 연출을 damage 이벤트 뒤로 미루려면
 *   `ctx.after` 에 함수를 넣어라 — damage 이벤트를 큐에 넣은 직후 순서대로 실행된다.
 *
 * 새 효과를 추가할 땐 `SPECIAL_HOOKS` 표에 `{ hook: fn(unit, params, ctx) }` 를 한 줄 더할 것.
 * 훅 함수는 발동했으면 `true` 를 돌려준다. **반드시 결정론적이어야 한다** —
 * 난수가 필요하면 전투 `rng` 만 쓰고, 시간은 `B.time` 만 본다.
 * 이벤트는 SPEC §5.4 스키마(`buff`/`status`/`damage`/`heal`)를 재사용한다 (새 타입 금지).
 */

/** 엔진이 실제로 구현한 고유 효과 id (data/sets.js 의 `special` 값과 1:1) */
export const SPECIAL_IDS = ['rampart_aegis', 'bloodoath_frenzy', 'starseeker_starfall', 'constellation_grace'];

/**
 * `UnitDef.specials` 정규화. 문자열 id 와 `{id,label,params}` 둘 다 받고 같은 id 는 하나로 합친다.
 * 모르는 id 도 버리지 않고 실어 둔다 (UI/렌더러가 라벨을 읽을 수 있게). 훅 표에 없으면 그냥 무시된다.
 * @returns {Array<{id:string,label:string,params:object}>}
 */
export function normalizeSpecials(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (!s) continue;
    const id = typeof s === 'string' ? s : s.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: (typeof s === 'object' && s.label) || id,
      params: (typeof s === 'object' && s.params) ? { ...s.params } : {},
    });
  }
  return out;
}

/** params 에서 유한한 숫자만 꺼낸다 (없거나 망가졌으면 기본값) */
const spNum = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * 전투 생성.
 * cfg = { allies:[UnitDef], enemies:[UnitDef], allyFormationId, enemyFormationId, seed,
 *         getSkill?(id), skills?{id:Skill}, record?:boolean }
 * UnitDef.skills 의 원소는 스킬 id 문자열이거나 스킬 정의 객체 둘 다 허용한다.
 * UnitDef.formationMods 가 있으면 스탯에 곱연산으로 적용한다(선택).
 * UnitDef.specials 가 있으면 세트 고유 효과를 전투에 적용한다(선택, 위 SPECIAL_IDS 주석 참조).
 * 없거나 빈 배열이면 예전과 완전히 같게 동작한다.
 */
export function createBattle(cfg = {}) {
  const seed = (cfg.seed ?? 1) >>> 0 || 1;
  const rng = new RNG(seed);
  const record = cfg.record !== false;
  /* ★★ 패주를 끔다 — PvP 전용.
   *   의뢰에서는 패주가 있어야 한다 (없으면 질 때마다 단원이 전멸한다 — §24·§25).
   *   그런데 PvP 는 다르다: 제작자가 화면을 보고 짚었다 —
   *   「원거리가 아직 남아있는데 왜 승리로 표시되지」. 실측해 보니
   *   PvP 급 전력에선 **200판 중 195판(98%)이 패주로** 끝나고 있었다.
   *
   * ★ 패주 판정은 **난수를 안 쓴다** (위 상수 주석). 그래서 이 스위치를 꺼도
   *   rng 소비가 안 바뀌고, 나머지 전개는 그대로다 — «더 싸우는» 차이만 남는다.
   *   기본값은 **켜짐**이라 의뢰·난락·탑은 손대지 않는다. */
  const routEnabled = cfg.rout !== false;

  const resolve = (s) => {
    if (!s) return null;
    if (typeof s === 'object') return s;
    if (typeof cfg.getSkill === 'function') { const r = cfg.getSkill(s); if (r) return r; }
    if (cfg.skills && cfg.skills[s]) return cfg.skills[s];
    if (SKILL_RESOLVER) { const r = SKILL_RESOLVER(s); if (r) return r; }
    return null;
  };

  const units = [];
  let idx = 0;
  const build = (defs, side) => {
    for (const def of defs || []) {
      if (!def) continue;
      units.push(makeUnit(def, side, idx++, resolve));
    }
  };
  build(cfg.allies, 'ally');
  build(cfg.enemies, 'enemy');

  // 고유 효과를 가진 유닛이 하나도 없으면 관련 경로를 통째로 건너뛴다 (하위 호환 · 비용 0)
  const hasSpecials = units.some((u) => u.specials.length > 0);

  /* ★ 수호 펫 게이트 — hasSpecials 와 같은 이유로 둔다.
   * 전투 rng 는 **단일 스트림**이라 난수를 한 번만 더 굴려도 그 뒤의 치명타·회피가
   * 통째로 밀린다. 즉 조건 없이 굴리면 랭크별 승률·던전 WAVE_POWER·세트 효과 측정치가
   * 전부 무효가 된다. 수호 펫이 실제로 있을 때만 굴리도록 여기서 막는다. */
  const hasGuardians = units.some((u) => u.pet && u.petRole === 'guardian');

  // 행동 순서가 한꺼번에 겹치지 않도록 아주 작은 시작 게이지 편차를 준다 (시드 결정론 유지)
  for (const u of units) u.gauge = rng.float(0, 12);

  const events = [];
  const sched = [];
  let schedSeq = 0;
  let acc = 0;

  const result = {
    winner: null, time: 0, survivors: [],
    damageDealt: {}, healDone: {}, kills: {}, mvpUid: null,
    /* 얼마나 이겼나 / 얼마나 졌나 — `finish()` 에서 채운다. 자세한 건 거기 주석 참고.
     * 지금은 **기록만** 한다. 아무도 안 읽는다. */
    margin: null,
  };
  for (const u of units) { result.damageDealt[u.uid] = 0; result.healDone[u.uid] = 0; result.kills[u.uid] = 0; }

  const B = {
    seed,
    rng,
    units,
    time: 0,
    finished: false,
    winner: null,
    result,
    allyFormationId: cfg.allyFormationId || null,
    enemyFormationId: cfg.enemyFormationId || null,
    aliveAllies: () => units.filter((u) => u.alive && u.side === 'ally'),
    aliveEnemies: () => units.filter((u) => u.alive && u.side === 'enemy'),
    unitOf: (uid) => units.find((u) => u.uid === uid) || null,
    drainEvents,
    step,
    run,
    /** 세트 고유 효과 단일 진입점 (테스트/확장용으로 노출) */
    applySpecial: (unit, hook, ctx) => applySpecial(unit, hook, ctx),
  };

  // ---------------------------------------------------------------- 이벤트
  function push(e) {
    if (!record) return;
    e.t = B.time;
    events.push(e);
  }
  function drainEvents() {
    if (!events.length) return [];
    return events.splice(0, events.length);
  }
  function schedule(at, fn) {
    sched.push({ at, seq: schedSeq++, fn });
  }
  function runSchedule() {
    let guard = 0;
    for (;;) {
      let ready = null;
      for (const s of sched) {
        if (s.at > B.time + 1e-9) continue;
        if (!ready || s.at < ready.at - 1e-9 || (Math.abs(s.at - ready.at) <= 1e-9 && s.seq < ready.seq)) ready = s;
      }
      if (!ready) return;
      sched.splice(sched.indexOf(ready), 1);
      ready.fn();
      if (++guard > 500) return;
    }
  }

  // ---------------------------------------------------------------- 스탯
  function recalc(u) {
    const mods = {};
    for (const b of u.buffs) mods[b.stat] = (mods[b.stat] || 0) + b.amount;
    const st = {};
    for (const k of ST_KEYS) {
      let v = u.base[k] || 0;
      const m = mods[k];
      if (m) v = v * (1 + Math.max(-0.9, m));
      st[k] = v;
    }
    st.crit = clamp(st.crit, 0, 100);
    st.eva = clamp(st.eva, 0, 75);
    st.critDmg = Math.max(0, st.critDmg);
    st.spd = Math.max(4, st.spd);
    st.def = Math.max(0, st.def);
    st.res = Math.max(0, st.res);
    st.atk = Math.max(1, st.atk);
    u.st = st;
  }

  // ---------------------------------------------------------------- 피해/치유
  /**
   * @param {object} [opts] `{ skill, fromSpecial, fromDot }`
   *   `skill` 은 고유 효과 훅에 넘겨줄 원인 스킬(있으면).
   *   `fromSpecial:true` 는 **고유 효과가 만들어 낸 피해**라는 표시다 —
   *   `dealDamage` 훅을 다시 태우지 않아 추가 타격이 무한히 연쇄하지 않는다.
   *   `fromDot:true` 는 **지속 피해(dot)** 라는 표시다 — `ctx.fromDot` 으로 훅에 전달되어
   *   sets.js 의 `lifestealDot:false` / 분열타 제외 계약을 지킬 수 있게 한다.
   */
  function applyDamage(srcUid, tgt, amount, crit, dmgType, fx, opts = {}) {
    if (!tgt.alive) return 0;

    /* ★ 수호 펫 재대상(redirect)
     * 이 엔진에는 원래 "피해 대상을 바꾸는" 훅이 없었다 — 가로챌 수 있는 건 죽음(lethal)뿐이었다.
     * 펫의 '확률적으로 대신 맞기' 때문에 여기 하나를 새로 열었다. 규약 4가지:
     *   1. `hasGuardians` 가 false 면 rng 를 **한 번도** 안 굴린다 (기존 측정치 보존).
     *   2. 펫이 맞는 건 다시 넘기지 않는다 — 수호 펫끼리 무한 연쇄를 막는다.
     *   3. 피해량은 이미 **원래 대상**의 def/res 로 계산된 값이다(resolveHit 이 앞에서 굴린다).
     *      대신 맞는 쪽이 자기 방어력으로 다시 계산하지 않는다 — 대신 guardCut 으로 깎는다.
     *      "물렁한 후열 대신 맞아서 오히려 더 아프다" 같은 역전을 피하려는 의도적 선택이다.
     *   4. 지속 피해(dot)는 넘기지 않는다 — 이미 몸에 붙은 것을 남이 대신 앓을 수는 없다. */
    if (hasGuardians && !tgt.pet && !opts.fromDot) {
      const g = pickGuardian(tgt.side);
      if (g) {
        amount = amount * (1 - clamp(g.guardCut || 0, 0, 0.9));
        push({ type: 'guard', uid: g.uid, targetUid: tgt.uid });
        tgt = g;
      }
    }

    let remain = Math.max(1, Math.round(amount));
    const total = remain;
    const hadShield = tgt.shield > 0;
    if (tgt.shield > 0) {
      const absorbed = Math.min(tgt.shield, remain);
      tgt.shield -= absorbed;
      remain -= absorbed;
      if (tgt.shield <= 0.0001) { tgt.shield = 0; tgt.shieldDur = 0; }
    }
    const shieldBroke = hadShield && tgt.shield === 0;
    tgt.hp = Math.max(0, tgt.hp - remain);
    if (srcUid != null) result.damageDealt[srcUid] = (result.damageDealt[srcUid] || 0) + total;
    let killed = tgt.hp <= 0;

    // ★ 고유 효과 — 전투 불능이 될 피해를 가로챈다(부활). 연출은 damage 이벤트 뒤로 미룬다.
    let after = null;
    if (killed && tgt.specials.length) {
      const ctx = { srcUid, amount: remain, total, dmgType, after: [] };
      if (applySpecial(tgt, 'lethal', ctx)) { killed = false; after = ctx.after; }
    }

    push({ type: 'damage', uid: srcUid, targetUid: tgt.uid, amount: total, crit: !!crit, dmgType, fx, killed });
    if (after) for (const fn of after) fn();
    if (killed) kill(tgt, srcUid);

    // ★ 고유 효과 훅 — 방어막 파괴 / 피격 / 가해 / 처치
    if (tgt.specials.length) {
      if (shieldBroke) applySpecial(tgt, 'shieldBreak', { srcUid, amount: remain });
      applySpecial(tgt, 'takeDamage', { srcUid, amount: remain, total, crit: !!crit, dmgType, killed });
    }
    if (hasSpecials && srcUid != null) {
      const src = B.unitOf(srcUid);
      if (src && src.specials.length) {
        if (!opts.fromSpecial) {
          applySpecial(src, 'dealDamage', {
            target: tgt, amount: remain, total, crit: !!crit, dmgType,
            skill: opts.skill || null, killed, fromDot: !!opts.fromDot,
          });
        }
        if (killed) applySpecial(src, 'kill', { target: tgt, skill: opts.skill || null });
      }
    }
    return remain;
  }

  /**
   * 대신 맞을 수호 펫을 고른다. 살아 있는 수호 펫을 순서대로 훑으며 각자의 확률을 굴린다.
   * 여러 마리면 앞선 쪽이 먼저 기회를 갖는다 — 순서가 고정이라 결정론이 유지된다.
   * @returns {object|null} 없으면 null (이때도 굴린 난수는 소비된 상태다)
   */
  function pickGuardian(side) {
    for (const u of units) {
      if (u.side !== side || !u.alive || !u.pet || u.petRole !== 'guardian') continue;
      if (rng.chance(clamp(u.guardChance || 0, 0, 1))) return u;
    }
    return null;
  }

  function kill(tgt, srcUid) {
    if (!tgt.alive) return;
    tgt.alive = false;
    tgt.hp = 0;
    tgt.gauge = 0;
    tgt.buffs.length = 0;
    tgt.dots.length = 0;
    tgt.shield = 0;
    tgt.shieldDur = 0;
    if (srcUid != null) result.kills[srcUid] = (result.kills[srcUid] || 0) + 1;
    push({ type: 'death', targetUid: tgt.uid });
  }

  function applyHeal(srcUid, tgt, amount) {
    if (!tgt.alive) return 0;
    const before = tgt.hp;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + Math.max(0, amount));
    const real = Math.round(tgt.hp - before);
    if (real <= 0) return 0;
    if (srcUid != null) result.healDone[srcUid] = (result.healDone[srcUid] || 0) + real;
    push({ type: 'heal', uid: srcUid, targetUid: tgt.uid, amount: real });
    return real;
  }

  function rollDamage(src, tgt, power, dmgType) {
    const mit = 100 / (100 + (dmgType === 'phys' ? tgt.st.def : tgt.st.res));
    let raw = src.st.atk * power * mit * rng.float(0.93, 1.07);
    const crit = rng.chance(clamp(src.st.crit, 0, 100) / 100);
    if (crit) raw *= 1 + src.st.critDmg / 100;
    return { amount: Math.max(1, Math.round(raw)), crit };
  }

  // ---------------------------------------------------------------- 상태이상
  function addBuff(srcUid, tgt, stat, amount, dur, skillId) {
    if (!tgt.alive || !stat) return;
    const d = dur || 5;
    const cur = tgt.buffs.find((b) => b.src === skillId && b.stat === stat);
    if (cur) { cur.dur = Math.max(cur.dur, d); cur.amount = amount; }
    else tgt.buffs.push({ stat, amount, dur: d, src: skillId });
    recalc(tgt);
    push({ type: 'buff', uid: srcUid, targetUid: tgt.uid, stat, amount, dur: d });
  }

  function addDot(src, tgt, e, skillId) {
    if (!tgt.alive) return;
    const dur = e.dur || 4;
    tgt.dots.push({
      src: skillId, srcUid: src.uid,
      dmgType: e.dmgType || 'magic',
      power: e.power || 0.3,
      tick: Math.max(0.2, e.tick || 1),
      dur, acc: 0, atk: src.st.atk,
      fx: e.fx || 'poison',
    });
    push({ type: 'status', targetUid: tgt.uid, status: 'dot', dur });
  }

  function addShield(srcUid, tgt, amount, dur) {
    if (!tgt.alive) return;
    const d = dur || 6;
    tgt.shield += Math.max(0, Math.round(amount));
    tgt.shieldDur = Math.max(tgt.shieldDur, d);
    push({ type: 'status', targetUid: tgt.uid, status: 'shield', dur: d });
  }

  function addStun(tgt, dur) {
    if (!tgt.alive) return;
    const d = dur || 1;
    tgt.stunUntil = Math.max(tgt.stunUntil, B.time + d);
    push({ type: 'status', targetUid: tgt.uid, status: 'stun', dur: d });
  }

  // ------------------------------------------------------- 세트 고유 효과 (specials)
  /** 그 효과의 유닛별 런타임 상태 보관함 (스택 수·발동 여부 등) */
  function spState(u, id) {
    let s = u.specialState[id];
    if (!s) { s = {}; u.specialState[id] = s; }
    return s;
  }

  /** 같은 편 생존자 (결정론: units 배열 순서 그대로) */
  function livingAllies(u) { return units.filter((a) => a.alive && a.side === u.side); }

  /**
   * 고유 효과의 `*Target` 어휘 (`data/sets.js` 참조) → 실제 대상 목록.
   * 'self' | 'allAlly'(기본) | 'allEnemy'. 순서는 units 배열 그대로라 결정론적이다.
   */
  function spTargets(u, key) {
    if (key === 'self') return u.alive ? [u] : [];
    if (key === 'allEnemy') return units.filter((a) => a.alive && a.side !== u.side);
    return livingAllies(u);
  }

  /**
   * 고유 효과의 `*Select` 어휘 → 추가 타격 대상.
   * 'nearest' = `from` 에서 가장 가까운 순, 거리가 같으면 `idx` 오름차순 (결정론 보장).
   * 그 외에는 idx 오름차순. **난수를 쓰지 않는다** — 쓰면 sets.js 의 결정론 계약이 깨진다.
   */
  function spSelect(from, pool, n, mode) {
    const list = pool.slice();
    if (mode === 'nearest' && from) {
      const d2 = (t) => (t.x - from.x) * (t.x - from.x) + (t.y - from.y) * (t.y - from.y);
      list.sort((a, b) => (d2(a) - d2(b)) || (a.idx - b.idx));
    } else {
      list.sort((a, b) => a.idx - b.idx);
    }
    return list.slice(0, Math.max(0, n));
  }

  /**
   * ★ 고유 효과 훅 표 — `data/sets.js` 의 `special` id 하나당 한 블록.
   * 수치는 전부 `p`(= specialParams)에서 읽는다. 여기서 새 상수를 만들지 마라.
   */
  const SPECIAL_HOOKS = {
    // ── 강철 성벽 풀세트 「불락(不落)의 가호」
    //    전투 시작 시 최대 체력 `shieldRatio` 만큼 방어막(`shieldDur` 초).
    //    그 방어막이 **피해로 깨지면** 아군 전체 방어 `allyDefMod` 를 `allyDur` 초 부여.
    rampart_aegis: {
      battleStart(u, p) {
        const ratio = spNum(p.shieldRatio, 0);
        if (ratio <= 0 || !u.alive) return false;
        spState(u, 'rampart_aegis').armed = true;
        addShield(u.uid, u, u.maxHp * ratio, spNum(p.shieldDur, 8));
        return true;
      },
      shieldBreak(u, p) {
        const s = spState(u, 'rampart_aegis');
        if (!s.armed) return false;
        if (p.breakOnce !== false) s.armed = false;   // 전투당 1회 (방어막이 깨진 그때)
        const mod = spNum(p.allyDefMod, 0);
        const dur = spNum(p.allyDur, 0);
        if (!mod || dur <= 0) return false;
        const stat = p.allyStat || 'def';
        const key = p.buffId || 'sp_rampart_aegis';
        for (const a of spTargets(u, p.allyTarget || 'allAlly')) addBuff(u.uid, a, stat, mod, dur, key);
        return true;
      },
    },

    // ── 피의 서약 풀세트 「피의 갈증」
    //    가한 피해의 `lifesteal` 만큼 흡혈 + 처치 시 모든 쿨 `cdReduce` 초 감소 &
    //    공격력 `atkMod` 를 `stackDur` 초 (최대 `stacks` 중첩).
    bloodoath_frenzy: {
      dealDamage(u, p, ctx) {
        const ls = spNum(p.lifesteal, 0);
        if (ls <= 0 || !u.alive || !(ctx.amount > 0)) return false;
        // sets.js `lifestealDot:false` — 지속 피해(dot)는 "직접 가한 피해"가 아니다
        if (ctx.fromDot && p.lifestealDot !== true) return false;
        return applyHeal(u.uid, u, ctx.amount * ls) > 0;
      },
      kill(u, p) {
        if (!u.alive) return false;
        const cut = spNum(p.cdReduce, 0);
        if (cut > 0) for (const k of Object.keys(u.cds)) u.cds[k] = Math.max(0, u.cds[k] - cut);
        const mod = spNum(p.atkMod, 0);
        const dur = spNum(p.stackDur, 0);
        if (!mod || dur <= 0) return true;
        const max = Math.max(1, Math.round(spNum(p.stacks, 1)));
        const s = spState(u, 'bloodoath_frenzy');
        // 직전 중첩이 아직 살아 있으면 쌓고, 만료됐으면 1중첩부터 다시 시작한다
        const n = (s.until != null && B.time <= s.until) ? Math.min(max, (s.n || 0) + 1) : 1;
        s.n = n;
        s.until = B.time + dur;
        addBuff(u.uid, u, p.buffStat || 'atk', mod * n, dur, p.buffId || 'sp_bloodoath_frenzy');
        return true;
      },
    },

    // ── 별의 사수 풀세트 「유성 낙하」
    //    원거리 공격이 다른 적 `splashCount` 기를 `splashPower` 배 위력으로 추가 타격 +
    //    처치 시 행동 게이지 `killGauge` 즉시 충전.
    starseeker_starfall: {
      dealDamage(u, p, ctx) {
        const sk = ctx.skill;
        // rangeFilter — 기본 'ranged'. 근접 공격은 발동하지 않는다.
        const need = p.rangeFilter === undefined ? 'ranged' : p.rangeFilter;
        if (!sk || !u.alive || !(ctx.amount > 0)) return false;
        if (need && sk.range !== need) return false;
        if (ctx.fromDot) return false;                  // 지속 피해는 "명중"이 아니다
        const n = Math.max(0, Math.round(spNum(p.splashCount, 0)));
        const ratio = spNum(p.splashPower, 0);
        if (n <= 0 || ratio <= 0) return false;
        const foes = units.filter((t) => t.alive && t.side !== u.side && t !== ctx.target);
        if (!foes.length) return false;
        // splashSelect — 원 대상에서 가장 가까운 적, 동률이면 idx 오름차순 (난수 금지)
        const picks = spSelect(ctx.target || u, foes, Math.min(n, foes.length), p.splashSelect || 'nearest');
        const fx = sk.fx || 'arrow';
        // splashOf:'damage' — **그 타격이 실제로 넣은 피해량**의 splashPower 배.
        // atk 로 다시 계산하지 않고 치명타·회피도 다시 굴리지 않는다 (splashRoll:false = 결정론 유지).
        const base = spNum(ctx.total, ctx.amount);
        for (const t of picks) {
          let amount, crit = false;
          if (p.splashOf === 'damage' || p.splashOf === undefined) {
            amount = Math.max(1, Math.round(base * ratio));
          } else {
            const r = rollDamage(u, t, ratio * (sk.power || 1), sk.dmgType);
            amount = r.amount; crit = r.crit;
          }
          // fromSpecial: 추가 타격이 또 추가 타격을 부르지 않게 한다 (splashChain:false)
          applyDamage(u.uid, t, amount, crit, sk.dmgType, fx, { skill: sk, fromSpecial: true });
        }
        return picks.length > 0;
      },
      kill(u, p) {
        const g = spNum(p.killGauge, 0);
        if (g <= 0 || !u.alive) return false;
        u.gauge = Math.min(GAUGE_MAX, u.gauge + GAUGE_MAX * g);
        return true;
      },
    },

    // ── 성좌의 은총 풀세트 「성좌의 은총」
    //    전투 불능이 될 피해를 받으면 (`reviveOnce` 면 전투당 1회) 최대 체력 `reviveHp` 로 부활하고
    //    그때 아군 전체를 최대 체력 `allyHeal` 만큼 회복시킨다.
    constellation_grace: {
      lethal(u, p, ctx) {
        const s = spState(u, 'constellation_grace');
        if (s.used && p.reviveOnce !== false) return false;
        const ratio = spNum(p.reviveHp, 0);
        if (ratio <= 0) return false;
        s.used = true;
        const hp = clamp(Math.round(u.maxHp * ratio), 1, u.maxHp);
        u.hp = hp;                              // 죽음을 취소한다 (kill() 이 불리지 않는다)
        // reviveClear — 되살아날 때 자신의 지속 피해(dot)와 **디버프**(음수 버프)를 지운다.
        // 그대로 두면 부활한 다음 틱에 도트로 다시 눕는다.
        if (p.reviveClear !== false) {
          u.dots.length = 0;
          const kept = u.buffs.filter((bf) => (bf.amount || 0) >= 0);
          if (kept.length !== u.buffs.length) { u.buffs.length = 0; u.buffs.push(...kept); recalc(u); }
        }
        const heal = spNum(p.allyHeal, 0);
        ctx.after.push(() => {
          // 부활 연출 — SPEC §5.4 의 heal 이벤트를 재사용한다 (새 타입을 만들지 않는다)
          push({ type: 'heal', uid: u.uid, targetUid: u.uid, amount: hp });
          if (heal <= 0) return;
          for (const a of spTargets(u, p.allyTarget || 'allAlly')) {
            if (a !== u) applyHeal(u.uid, a, a.maxHp * heal);
          }
        });
        return true;
      },
    },
  };

  /**
   * ★ 고유 효과 단일 진입점. 훅 표에 없는 id 는 조용히 무시한다.
   * @param {object} unit  런타임 유닛
   * @param {string} hook  battleStart|act|dealDamage|takeDamage|shieldBreak|lethal|kill|tick
   * @param {object} [ctx] 훅별 문맥 (위 표 참조)
   * @returns {boolean} 하나라도 발동했는가
   */
  function applySpecial(unit, hook, ctx) {
    const list = unit && unit.specials;
    if (!list || !list.length) return false;
    let fired = false;
    for (const sp of list) {
      const tbl = SPECIAL_HOOKS[sp.id];
      const fn = tbl && tbl[hook];
      if (!fn) continue;
      if (fn(unit, sp.params || {}, ctx || {})) {
        fired = true;
        // 발동 횟수 기록 — 검증 도구(tools/setspecial.mjs)가 "정말 발동했는가"를 증명하는 근거다.
        // 결정론에 영향을 주지 않는 순수 계수기다 (읽는 쪽은 전투가 끝난 뒤에만 본다).
        const s = spState(unit, sp.id);
        s.fired = (s.fired || 0) + 1;
        s[`fired_${hook}`] = (s[`fired_${hook}`] || 0) + 1;
      }
    }
    return fired;
  }

  // ---------------------------------------------------------------- 효과 적용
  function applyEffect(src, e, tgt, skill, ctx) {
    if (!e || !tgt) return;
    switch (e.type) {
      case 'heal':
        applyHeal(src.uid, tgt, src.st.atk * (e.power != null ? e.power : 1));
        break;
      case 'buff':
      case 'debuff':
        addBuff(src.uid, tgt, e.stat, e.amount || 0, e.dur, skill.id);
        break;
      case 'dot':
        addDot(src, tgt, e, skill.id);
        break;
      case 'shield':
        addShield(src.uid, tgt, src.st.atk * (e.power != null ? e.power : 1), e.dur);
        break;
      case 'stun':
        if (rng.chance(e.chance != null ? e.chance : 1)) addStun(tgt, e.dur);
        break;
      case 'lifesteal':
        if (ctx && ctx.dmg > 0) applyHeal(src.uid, src, ctx.dmg * (e.ratio || 0));
        break;
      default:
        break;
    }
  }

  /** target 이 명시된 효과는 스킬 사용당 1회, 지정된 범위에 적용한다 */
  function applyScopedEffect(src, e, skill) {
    const allies = units.filter((u) => u.alive && u.side === src.side);
    const foes = units.filter((u) => u.alive && u.side !== src.side);
    let list;
    switch (e.target) {
      case 'self': list = src.alive ? [src] : []; break;
      case 'allAlly': list = allies; break;
      case 'allEnemy': list = foes; break;
      case 'ally': list = allies.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.idx - b.idx).slice(0, 1); break;
      case 'enemy': list = foes.slice().sort((a, b) => (b.side === 'ally' ? b.x : -b.x) - (a.side === 'ally' ? a.x : -a.x) || a.idx - b.idx).slice(0, 1); break;
      default: list = [];
    }
    for (const t of list) applyEffect(src, e, t, skill, null);
  }

  // ---------------------------------------------------------------- 행동
  function resolveHit(src, tgt, skill, damaging, perTarget) {
    if (!tgt.alive) return;
    let dealt = 0;
    if (damaging) {
      if (rng.chance(clamp(tgt.st.eva, 0, 60) / 100)) {
        push({ type: 'miss', uid: src.uid, targetUid: tgt.uid });
        return;
      }
      const { amount, crit } = rollDamage(src, tgt, skill.power || 1, skill.dmgType);
      dealt = applyDamage(src.uid, tgt, amount, crit, skill.dmgType, skill.fx || 'slash', { skill });
    }
    const ctx = { dmg: dealt };
    for (const e of perTarget) {
      if (e.type === 'lifesteal') { applyEffect(src, e, src, skill, ctx); continue; }
      if (!tgt.alive) continue;
      applyEffect(src, e, tgt, skill, ctx);
    }
  }

  function act(u) {
    const choice = chooseAction(u, B);
    if (!choice || !choice.targets.length) { u.gauge = GAUGE_MAX; return; }
    const { skill, targets } = choice;
    u.gauge = 0;
    if (skill.id) u.cds[skill.id] = B.time + (skill.cd || 0);
    push({ type: 'act', uid: u.uid, skillId: skill.id || null });
    if (u.specials.length) applySpecial(u, 'act', { skill, targets });

    const effects = skill.effects || [];
    const scoped = effects.filter((e) => e.target);
    const perTarget = effects.filter((e) => !e.target);
    const damaging = isDamaging(skill);
    const selfOnly = targets.length === 1 && targets[0] === u;
    let earliest = Infinity;

    if (selfOnly) {
      const at = B.time + CAST_DELAY;
      earliest = at;
      schedule(at, () => { for (const e of perTarget) applyEffect(u, e, u, skill, { dmg: 0 }); });
    } else if (skill.range === 'melee') {
      push({ type: 'lunge', uid: u.uid, targetUid: targets[0].uid });
      const at = B.time + MELEE_DELAY;
      earliest = at;
      for (const t of targets) schedule(at, () => resolveHit(u, t, skill, damaging, perTarget));
    } else {
      const fx = skill.fx || (damaging ? 'arrow' : 'buff');
      for (const t of targets) {
        const dist = Math.hypot(t.x - u.x, t.y - u.y);
        const at = B.time + clamp(dist / PROJ_SPEED, PROJ_MIN, PROJ_MAX);
        if (at < earliest) earliest = at;
        push({ type: 'proj', uid: u.uid, targetUid: t.uid, fx, speed: PROJ_SPEED });
        schedule(at, () => resolveHit(u, t, skill, damaging, perTarget));
      }
    }
    if (scoped.length) {
      schedule(earliest === Infinity ? B.time : earliest, () => {
        for (const e of scoped) applyScopedEffect(u, e, skill);
      });
    }
  }

  // ---------------------------------------------------------------- 틱
  function tickUnit(u, dt) {
    // 버프 만료
    let dirty = false;
    for (let i = u.buffs.length - 1; i >= 0; i--) {
      u.buffs[i].dur -= dt;
      if (u.buffs[i].dur <= 0) { u.buffs.splice(i, 1); dirty = true; }
    }
    if (dirty) recalc(u);
    // 보호막 만료
    if (u.shield > 0) {
      u.shieldDur -= dt;
      if (u.shieldDur <= 0) { u.shield = 0; u.shieldDur = 0; }
    }
    // 지속 피해
    for (let i = u.dots.length - 1; i >= 0; i--) {
      const d = u.dots[i];
      if (!d) continue;              // 도트 피해로 사망하면 kill()이 목록을 비운다 → 남은 인덱스는 건너뛴다
      d.dur -= dt;
      d.acc += dt;
      while (d.acc >= d.tick && u.alive) {
        d.acc -= d.tick;
        const mit = 100 / (100 + (d.dmgType === 'phys' ? u.st.def : u.st.res));
        // fromDot: 고유 효과가 "직접 가한 피해"와 구분할 수 있게 한다 (sets.js `lifestealDot:false`)
        applyDamage(d.srcUid, u, Math.max(1, Math.round(d.atk * d.power * mit)), false, d.dmgType, d.fx, { fromDot: true });
      }
      if (d.dur <= 0 || !u.alive) u.dots.splice(i, 1);
    }
    // 주기 타이머 훅 — 간격이 필요한 효과는 여기서 ctx.dt 를 자기 누산기에 더해 쓴다
    // (dt 는 항상 FIXED 라 결정론이 유지된다).
    if (u.specials.length) applySpecial(u, 'tick', { dt });
  }

  function tick(dt) {
    B.time += dt;
    runSchedule();
    if (B.finished) return;

    for (const u of units) {
      if (!u.alive) continue;
      tickUnit(u, dt);
    }
    for (const u of units) {
      if (!u.alive) continue;
      if (u.stunUntil > B.time) continue;      // 기절 중엔 게이지가 차지 않는다
      u.gauge += u.st.spd * dt;
      if (u.gauge >= GAUGE_MAX) act(u);
    }
    checkEnd();
  }

  /* ★ 펫은 승패에서 빼고 센다.
   * `aliveAllies()` 를 그대로 쓰면 안 된다 — 그건 **표적 선택**에도 쓰이므로 펫을 빼면
   * 회복 스킬이 펫을 못 살리고 적도 펫을 못 때린다. 여기서만 따로 센다. */
  const aliveFighters = (side) => {
    let n = 0;
    for (const u of units) if (u.side === side && u.alive && !u.pet) n++;
    return n;
  };

  /** 그 진영의 전투원 수 (펫 제외) */
  const countOf = (side) => {
    let n = 0;
    for (const u of units) if (u.side === side && !u.pet) n++;
    return n;
  };

  /**
   * 그 진영이 얼마나 남았나 (0~1).
   * 인원과 체력을 반씩 본다 — 7명이 다 살았지만 빈사인 것과 4명이 멀쩡한 것은 다르다.
   * `result.margin` 도 같은 정의를 쓴다.
   */
  const strengthOf = (side) => {
    const tot = countOf(side);
    return tot > 0 ? 0.5 * (aliveFighters(side) / tot) + 0.5 * hpRatioOf(side) : 0;
  };

  function hpRatioOf(side) {
    let cur = 0, max = 0;
    // 펫 제외 — 덩치 큰 수호 펫이 시간초과 판정을 왜곡한다
    for (const u of units) if (u.side === side && !u.pet) { cur += Math.max(0, u.hp); max += u.maxHp; }
    return max > 0 ? cur / max : 0;
  }

  /** 어느 쪽이 물러났나 ('ally'|'enemy'|null). 전멸로 끝나면 null 이다. */
  let routed = null;

  function checkEnd() {
    // 단원이 전멸했는데 펫이 살아 있다고 이긴 게 아니다 — 펫은 머릿수에 안 넣는다
    const a = aliveFighters('ally');
    const e = aliveFighters('enemy');
    if (a > 0 && e > 0) {
      // 승부가 갈렸으면 전멸까지 안 간다 — 남은 사람은 살아 나온다
      if (routEnabled && B.time >= ROUT_AFTER) {
        const sa = strengthOf('ally');
        const se = strengthOf('enemy');
        if (sa < ROUT_FLOOR && se > sa * ROUT_LEAD) { routed = 'ally'; finish('enemy'); return; }
        if (se < ROUT_FLOOR && sa > se * ROUT_LEAD) { routed = 'enemy'; finish('ally'); return; }
      }
      if (B.time >= TIME_LIMIT) {
        const ra = hpRatioOf('ally');
        const re = hpRatioOf('enemy');
        finish(Math.abs(ra - re) < 1e-6 ? 'draw' : ra > re ? 'ally' : 'enemy');
      }
      return;
    }
    finish(a === 0 && e === 0 ? 'draw' : a > 0 ? 'ally' : 'enemy');
  }

  function finish(winner) {
    if (B.finished) return;
    B.finished = true;
    B.winner = winner;
    result.winner = winner;
    result.time = Math.round(B.time * 100) / 100;
    result.survivors = units.filter((u) => u.alive).map((u) => u.uid);
    // MVP: 승리 진영(무승부면 전원) 중 피해+치유+처치 가중 점수 최고.
    // 펫은 후보에서 뺀다 — 수훈은 단원 몫이다(수호 펫은 피해량이 0인데도 뽑힐 수 있다).
    const pool = (winner === 'draw' ? units : units.filter((u) => u.side === winner)).filter((u) => !u.pet);
    let best = null, bestScore = -1;
    for (const u of pool) {
      const s = (result.damageDealt[u.uid] || 0) + (result.healDone[u.uid] || 0) * 1.2 + (result.kills[u.uid] || 0) * 60;
      if (s > bestScore) { bestScore = s; best = u; }
    }
    result.mvpUid = best ? best.uid : null;

    /* ── 승패의 "폭" ──────────────────────────────────────────────────────
     * ★ 지금은 **기록만** 한다. 읽는 곳이 하나도 없다 — 일부러 그렇게 뒀다.
     *
     *   이유: 이 게임의 전투는 사실상 이진이다. 승률이 100%→0% 로 뒤집히는 데
     *   전투력비 0.025 밖에 안 걸린다 (docs/HANDOFF.md §24). 그래서 난이도 색을
     *   정직하게 고쳐 놔도 「이긴다」/「진다」 둘밖에 안 나온다.
     *   그걸 풀려면 승패를 연속량으로 바꿔야 하는데(부분 승·부분 패), 그건
     *   던전/탑/나락 인계·보상·랭킹까지 건드리는 큰 변경이다.
     *
     *   착수하기 전에 **먼저 재야 한다**: "손실" 이 전투력비에 대해 정말 매끈한가?
     *   여기서 값을 기록해 두면 `tools/margin.mjs` 가 그걸 잰다.
     *
     * ★ 난수를 쓰지 않는다. 이미 정해진 상태를 읽기만 하므로 rng 소비가 안 늘고,
     *   따라서 기존 측정치(WAVE_POWER·탑·나락·세트)가 전부 그대로 유효하다.
     *
     * `score` 는 -1(전멸패) ~ +1(무손실 완승). 0 근처가 신승·석패다.
     * 인원과 체력을 반씩 본다 — 7명이 다 살았지만 빈사인 것과 4명이 멀쩡한 것을
     * 같게 볼 수는 없다.
     */
    const aTot = countOf('ally');
    const eTot = countOf('enemy');
    const aAlive = aliveFighters('ally');
    const eAlive = aliveFighters('enemy');
    const aHp = hpRatioOf('ally');
    const eHp = hpRatioOf('enemy');
    const strength = (alive, tot, hp) => (tot > 0 ? 0.5 * (alive / tot) + 0.5 * hp : 0);
    result.margin = {
      allyAlive: aAlive, allyCount: aTot, allyHp: aHp,
      enemyAlive: eAlive, enemyCount: eTot, enemyHp: eHp,
      score: strength(aAlive, aTot, aHp) - strength(eAlive, eTot, eHp),
      /** 전멸이 아니라 물러나서 끝났으면 그 진영. UI 가 「패주」 라고 쓸 수 있다. */
      routed,
    };

    push({ type: 'end', winner });
  }

  // ---------------------------------------------------------------- 공개 API
  function step(dt) {
    if (B.finished) return;
    acc = Math.min(acc + (dt || 0), MAX_ACC);
    while (acc >= FIXED - 1e-9) {
      acc -= FIXED;
      tick(FIXED);
      if (B.finished) { acc = 0; break; }
    }
  }

  /** 끝까지 돌린다 (렌더 없이). 안전을 위해 스텝 수를 제한한다. */
  function run() {
    const maxTicks = Math.ceil((TIME_LIMIT + 2) / FIXED);
    let n = 0;
    while (!B.finished && n++ < maxTicks) {
      tick(FIXED);
      if (record && events.length > 4096) events.length = 0;
    }
    if (!B.finished) {
      const ra = hpRatioOf('ally');
      const re = hpRatioOf('enemy');
      finish(Math.abs(ra - re) < 1e-6 ? 'draw' : ra > re ? 'ally' : 'enemy');
    }
    return result;
  }

  for (const u of units) recalc(u);
  // ★ 세트 고유 효과 — 전투 시작 훅 (t=0). 방어막처럼 시작하자마자 붙는 것들이 여기서 걸린다.
  if (hasSpecials) for (const u of units) applySpecial(u, 'battleStart', {});
  return B;
}

/** 런타임 유닛 생성 */
function makeUnit(def, side, idx, resolve) {
  const raw = def.stats || {};
  let base = {
    hp: raw.hp || 100, atk: raw.atk || 10, def: raw.def || 0, res: raw.res || 0,
    spd: raw.spd || 40, crit: raw.crit || 0, critDmg: raw.critDmg != null ? raw.critDmg : 50, eva: raw.eva || 0,
  };
  if (def.formationMods) base = scaleStats(base, def.formationMods);

  const sx = def.slot && def.slot.x != null ? def.slot.x : 0.5;
  const sy = def.slot && def.slot.y != null ? def.slot.y : 0.5;
  const maxHp = Math.max(1, Math.round(base.hp));

  const u = {
    ...def,
    side,
    idx,
    uid: def.uid != null ? def.uid : `${side}_${idx}`,
    base,
    maxHp,
    hp: def.hp != null ? clamp(Math.round(def.hp), 1, maxHp) : maxHp,
    gauge: 0,
    alive: true,
    x: side === 'ally' ? 44 - sx * 36 : 56 + sx * 36,
    y: 8 + sy * 44,
    buffs: [],
    dots: [],
    shield: 0,
    shieldDur: 0,
    stunUntil: 0,
    cds: {},
    st: { ...base },
    skillDefs: [],
    // ★ 세트 고유 효과 — `...def` 를 덮어써서 항상 정규화된 배열을 보장한다 (없으면 빈 배열)
    specials: normalizeSpecials(def.specials),
    specialState: {},   // 효과 id -> 런타임 상태 (중첩 수 / 발동 여부 / 누산기)
  };
  u.basic = makeBasicSkill(u);
  for (const s of def.skills || []) {
    const sk = resolve(s);
    if (sk) u.skillDefs.push(sk);
  }
  return u;
}

/** 렌더 없이 끝까지 돌려 result 만 반환 (밸런스 테스트용) */
export function simulate(cfg = {}) {
  const b = createBattle({ ...cfg, record: false });
  return b.run();
}
