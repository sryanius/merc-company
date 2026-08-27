// 부대 편성 — 7슬롯 배치 / 진형 / 출전 판정 / 파견(원정) 상태 / 엔진 입력(UnitDef) 변환.
// 순수 JS (DOM 참조 금지).
//
// Squad (SPEC §3.8): { id, name, memberUids:[7개, 빈 슬롯은 null], formationId,
//                      status:'idle'|'away', returnDay:number }
//
// ── 파견 모델 ──
// 의뢰를 나가면 전투와 보상은 그 자리에서 즉시 처리되지만, 부대는 `quest.days` 만큼 잠긴다.
// 날짜는 플레이어가 도시 화면에서 직접 넘기고, 그때 원정 나간 부대가 복귀한다.
// 덕분에 같은 날 다른 부대를 다른 의뢰에 보낼 수 있고, 부대를 여러 개 두는 이유가 생긴다.
//
// 주의: 예전엔 state.js 를 되물었다 (순환). 지금은 ambient.js 한 칸만 본다 — §108.
import { clamp, num, scaleStats } from './util.js';
import { uid } from './rng.js';
import { getClass } from './classes.js';
import { getFormation, formationMods } from './formations.js';
import { mercStats, mercRecipe, mercPower, isWounded, upkeepOf, mercSetBonus } from './merc.js';
import { josa } from './gear.js';
// 세트 고유 효과 조회용. **네임스페이스로 받는다** — `setSpecialsFor` 는 gear.js 쪽에서 나중에
// 붙는 함수라, 이름을 콕 집어 import 하면 아직 없을 때 모듈 링크 단계에서 통째로 터진다.
import * as Gear from './gear.js';
import { ambientState, ambientLog } from './ambient.js';
import { PETS_PER_SQUAD } from './pets.js';

/** 부대 정원 */
export const SQUAD_SIZE = 7;

/** 부대 최대 개수. 시작은 1개이고 나머지는 골드로 산다. */
export const MAX_SQUADS = 5;

/**
 * 부대 추가 비용 표. 인덱스 = **추가하고 난 뒤의 부대 수**.
 * 체증 곡선이라 부대를 늘리는 것 자체가 중반 이후의 골드 싱크가 된다.
 */
export const SQUAD_COSTS = [0, 0, 1500, 4000, 9000, 18000];

/** 부대 상태값 */
export const SQUAD_IDLE = 'idle';
export const SQUAD_AWAY = 'away';

/** 진형 데이터를 못 찾았을 때 쓰는 좌표 (기본진과 동일 배치) */
const DEFAULT_SLOTS = [
  { x: 0.14, y: 0.25 }, { x: 0.14, y: 0.50 }, { x: 0.14, y: 0.75 },
  { x: 0.46, y: 0.35 }, { x: 0.46, y: 0.65 },
  { x: 0.80, y: 0.35 }, { x: 0.80, y: 0.65 },
];

/* ─────────────────────────── 내부 헬퍼 ─────────────────────────── */

function gs() { return ambientState(); }
/** 순환 import 로 state.js 가 아직 준비 전일 수 있으니 로그는 감싸서 남긴다 */
function log(text) { ambientLog(text); }
function isState(s) { return !!(s && (Array.isArray(s.squads) || Array.isArray(s.roster) || Array.isArray(s.items))); }
function useState(s) { return isState(s) ? s : gs(); }
/** 첫 인자가 state가 아닌 "값"이면 state를 생략한 호출로 보고 인자를 한 칸 민다 */
function shifted(s) { return s != null && !isState(s); }

/** id/객체 무엇이든 부대를 돌려준다 */
export function getSquad(state, squadId) {
  const st = useState(state);
  if (!squadId) return null;
  if (typeof squadId === 'object') return squadId;
  return (st && st.squads || []).find((s) => s && s.id === squadId) || null;
}

/** id/객체 무엇이든 용병을 돌려준다 */
export function getMerc(state, mercUid) {
  const st = useState(state);
  if (!mercUid) return null;
  if (typeof mercUid === 'object') return mercUid;
  return (st && st.roster || []).find((m) => m && m.uid === mercUid) || null;
}

/** memberUids 배열을 항상 길이 7로 정규화 */
function normalizeSlots(squad) {
  if (!Array.isArray(squad.memberUids)) squad.memberUids = [];
  while (squad.memberUids.length < SQUAD_SIZE) squad.memberUids.push(null);
  if (squad.memberUids.length > SQUAD_SIZE) squad.memberUids.length = SQUAD_SIZE;
  return squad.memberUids;
}

/**
 * 파견 필드를 정규화한다. **하위 호환의 핵심** —
 * 예전 세이브에는 `status`/`returnDay` 가 아예 없다. 없으면 무조건 `idle` 로 본다.
 * (`returnDay` 가 이미 지난 값이면 원정이 끝난 것이므로 idle 로 되돌린다.)
 * @param {object} squad
 * @param {number} day 현재 날짜 (0이면 만료 검사를 생략)
 */
export function normalizeDispatch(squad, day = 0) {
  if (!squad || typeof squad !== 'object') return squad;
  if (squad.status !== SQUAD_AWAY) squad.status = SQUAD_IDLE;
  const rd = Math.round(Number(squad.returnDay) || 0);
  squad.returnDay = rd > 0 ? rd : 0;
  if (squad.status === SQUAD_AWAY && (!squad.returnDay || (day > 0 && day >= squad.returnDay))) {
    squad.status = SQUAD_IDLE;
    squad.returnDay = 0;
  }
  return squad;
}

/** 용병의 소속 정보를 슬롯 배열과 동기화 */
function syncMembership(state, squad) {
  const st = useState(state);
  const slots = normalizeSlots(squad);
  slots.forEach((u, i) => {
    const m = getMerc(st, u);
    if (m) { m.squadId = squad.id; m.slotIndex = i; }
  });
}

/* ─────────────────────────── 생성 / 해산 ─────────────────────────── */

/** 빈 부대 하나 */
export function createSquad(name = '제1부대', formationId = 'basic') {
  return {
    id: uid('sq'),
    name,
    memberUids: new Array(SQUAD_SIZE).fill(null),
    // ★ state.js newGame 에도 같은 리터럴이 복제돼 있다 (createSquad 를 안 부른다).
    //   여기만 고치면 새 게임 부대에는 펫 칸이 없다.
    petUids: new Array(PETS_PER_SQUAD).fill(null),
    formationId,
    status: SQUAD_IDLE,
    returnDay: 0,
  };
}

/**
 * 부대 하나를 더 만들 때 드는 골드.
 * @param {number} nextCount 추가하고 난 뒤의 부대 수 (2번째 부대를 사려면 2)
 * @returns {number} 첫 부대(1)는 0
 */
export function squadCost(nextCount) {
  const n = Math.max(1, Math.round(Number(nextCount) || 1));
  if (n <= 1) return 0;
  if (n < SQUAD_COSTS.length) return SQUAD_COSTS[n];
  // 표 밖(= MAX_SQUADS 초과)은 표기용으로만 쓰인다. 실제 구매는 canAddSquad 가 막는다.
  let c = SQUAD_COSTS[SQUAD_COSTS.length - 1];
  for (let i = SQUAD_COSTS.length; i <= n; i++) c *= 2;
  return c;
}

/**
 * 부대를 하나 더 만들 수 있는가.
 * `canAddSquad()` 처럼 state 를 생략하면 전역 state 를 본다.
 * @returns {{ok:boolean, reason:string, cost:number, count:number, max:number}}
 */
export function canAddSquad(state) {
  const st = useState(state);
  const count = (st && Array.isArray(st.squads)) ? st.squads.length : 0;
  const cost = squadCost(count + 1);
  const base = { cost, count, max: MAX_SQUADS };
  if (!st) return { ok: false, reason: '게임 상태를 찾을 수 없습니다.', ...base };
  if (count >= MAX_SQUADS) return { ok: false, reason: `부대는 최대 ${MAX_SQUADS}개까지 만들 수 있습니다.`, ...base };
  const gold = Math.round(Number(st.gold) || 0);
  if (gold < cost) return { ok: false, reason: `골드가 부족합니다. (${num(cost)}G 필요)`, ...base };
  return { ok: true, reason: '', ...base };
}

/**
 * 부대를 **골드를 내고** 창설한다. 성공하면 state.squads 에 바로 추가된다.
 * `buySquad('제2부대')` 처럼 state 를 생략해도 된다.
 *
 * `createSquad` 는 비용도 상한도 보지 않는 순수 생성자다 —
 * 플레이어가 부대를 늘리는 경로는 항상 이 함수를 타야 한다.
 * @returns {{ok:boolean, reason:string, squad:object|null, cost:number}}
 */
export function buySquad(state, name) {
  if (shifted(state)) { [state, name] = [gs(), state]; }
  const st = useState(state);
  const chk = canAddSquad(st);
  if (!chk.ok) return { ok: false, reason: chk.reason, squad: null, cost: chk.cost };
  if (!Array.isArray(st.squads)) st.squads = [];

  const nm = (typeof name === 'string' && name.trim()) ? name.trim() : `제${st.squads.length + 1}부대`;
  const formationId = (Array.isArray(st.formations) && st.formations[0]) || 'basic';
  const squad = createSquad(nm, formationId);
  st.gold = Math.max(0, Math.round((Number(st.gold) || 0) - chk.cost));
  st.squads.push(squad);

  const reason = chk.cost > 0
    ? `${nm}${josa(nm)} 창설했습니다. (-${num(chk.cost)}G)`
    : `${nm}${josa(nm)} 창설했습니다.`;
  log(reason);
  return { ok: true, reason, squad, cost: chk.cost };
}

/**
 * 부대 해산. 소속 용병은 전부 자유가 된다.
 * @returns {{ok:boolean, reason:string}}
 */
export function disbandSquad(state, squadId) {
  if (shifted(state)) { [state, squadId] = [gs(), state]; }
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return { ok: false, reason: '부대를 찾을 수 없습니다.' };
  for (const u of normalizeSlots(squad)) {
    const m = getMerc(st, u);
    if (m) { m.squadId = null; m.slotIndex = -1; }
  }
  const idx = (st && st.squads || []).findIndex((s) => s && s.id === squad.id);
  if (idx >= 0) st.squads.splice(idx, 1);
  return { ok: true, reason: `${squad.name}${josa(squad.name)} 해산했습니다.` };
}

/* ─────────────────────────── 편성 ─────────────────────────── */

/**
 * 부대에 배치. slotIndex를 생략하면 빈 슬롯 아무 곳에나 넣는다.
 * 이미 다른 부대 소속이면 그쪽에서 빼 온다. 목표 슬롯에 다른 용병이 있으면 그 용병을 밀어낸다.
 * @returns {{ok:boolean, reason:string, slotIndex:number, displaced:object|null}}
 */
export function addToSquad(state, squadId, mercUid, slotIndex) {
  if (shifted(state)) { [state, squadId, mercUid, slotIndex] = [gs(), state, squadId, mercUid]; }
  const st = useState(state);
  const squad = getSquad(st, squadId);
  const merc = getMerc(st, mercUid);
  const fail = (reason) => ({ ok: false, reason, slotIndex: -1, displaced: null });
  if (!squad) return fail('부대를 찾을 수 없습니다.');
  if (!merc) return fail('용병을 찾을 수 없습니다.');

  const slots = normalizeSlots(squad);
  let idx = slotIndex == null || slotIndex < 0 ? -1 : Math.round(slotIndex);
  if (idx >= SQUAD_SIZE) return fail('슬롯 번호가 올바르지 않습니다.');

  // 이미 이 부대 소속이면 자리 이동(교환)으로 처리
  const here = slots.indexOf(merc.uid);
  if (here >= 0) {
    if (idx < 0 || idx === here) return { ok: true, reason: '이미 배치되어 있습니다.', slotIndex: here, displaced: null };
    const r = swapSlots(st, squad, here, idx);
    return { ok: r.ok, reason: r.reason, slotIndex: r.ok ? idx : here, displaced: null };
  }

  if (idx < 0) {
    idx = slots.indexOf(null);
    if (idx < 0) return fail(`부대는 최대 ${SQUAD_SIZE}명까지입니다.`);
  }

  // 다른 부대에 있으면 먼저 뺀다
  if (merc.squadId && merc.squadId !== squad.id) removeFromSquad(st, merc.squadId, merc.uid);

  let displaced = null;
  if (slots[idx]) {
    displaced = getMerc(st, slots[idx]);
    if (displaced) { displaced.squadId = null; displaced.slotIndex = -1; }
  }
  slots[idx] = merc.uid;
  merc.squadId = squad.id;
  merc.slotIndex = idx;
  return { ok: true, reason: `${merc.name}${josa(merc.name)} ${idx + 1}번 자리에 배치했습니다.`, slotIndex: idx, displaced };
}

/**
 * 부대에서 제외. `removeFromSquad(state, mercUid)` 처럼 부대 id를 생략해도 된다.
 * @returns {{ok:boolean, reason:string, slotIndex:number}}
 */
export function removeFromSquad(state, squadId, mercUid) {
  if (shifted(state)) { [state, squadId, mercUid] = [gs(), state, squadId]; }
  const st = useState(state);
  // 인자가 (state, mercUid) 형태인 경우 보정
  if (mercUid == null) {
    const m = getMerc(st, squadId);
    if (m) { mercUid = m.uid; squadId = m.squadId; }
  }
  const squad = getSquad(st, squadId);
  const merc = getMerc(st, mercUid);
  if (!squad) return { ok: false, reason: '부대를 찾을 수 없습니다.', slotIndex: -1 };
  const slots = normalizeSlots(squad);
  const targetUid = merc ? merc.uid : mercUid;
  if (!targetUid) return { ok: false, reason: '제외할 용병을 지정하지 않았습니다.', slotIndex: -1 };
  const idx = slots.indexOf(targetUid);
  if (idx < 0) return { ok: false, reason: '그 용병은 이 부대 소속이 아닙니다.', slotIndex: -1 };
  slots[idx] = null;
  if (merc) { merc.squadId = null; merc.slotIndex = -1; }
  const nm = merc ? merc.name : '용병';
  return { ok: true, reason: `${nm}${josa(nm)} 부대에서 제외했습니다.`, slotIndex: idx };
}

/**
 * 두 슬롯의 내용을 교환 (빈 슬롯과의 교환 = 이동).
 * @returns {{ok:boolean, reason:string}}
 */
export function swapSlots(state, squadId, a, b) {
  if (shifted(state)) { [state, squadId, a, b] = [gs(), state, squadId, a]; }
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return { ok: false, reason: '부대를 찾을 수 없습니다.' };
  const i = Math.round(a), j = Math.round(b);
  if (!(i >= 0 && i < SQUAD_SIZE && j >= 0 && j < SQUAD_SIZE)) return { ok: false, reason: '슬롯 번호가 올바르지 않습니다.' };
  const slots = normalizeSlots(squad);
  const t = slots[i]; slots[i] = slots[j]; slots[j] = t;
  syncMembership(st, squad);
  return { ok: true, reason: '자리를 바꿨습니다.' };
}

/**
 * 진형 변경. 보유하지 않은 진형은 거부한다.
 * @returns {{ok:boolean, reason:string}}
 */
export function setFormation(state, squadId, formationId) {
  if (shifted(state)) { [state, squadId, formationId] = [gs(), state, squadId]; }
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return { ok: false, reason: '부대를 찾을 수 없습니다.' };
  const f = getFormation(formationId);
  if (!f) return { ok: false, reason: '알 수 없는 진형입니다.' };
  const owned = st && Array.isArray(st.formations) ? st.formations : null;
  if (owned && owned.length && !owned.includes(f.id)) return { ok: false, reason: '아직 보유하지 않은 진형입니다.' };
  squad.formationId = f.id;
  return { ok: true, reason: `진형을 ${f.name}${josa(f.name, '으로/로')} 바꿨습니다.` };
}

/* ─────────────────────────── 파견(원정) ─────────────────────────── */

/**
 * 부대를 원정에 내보낸다. `days` 일 뒤에 복귀한다.
 *
 * 전투와 보상은 호출부에서 이미 즉시 처리된다. 여기서 하는 일은 **부대를 잠그는 것**뿐이다.
 * 날짜는 자동으로 흐르지 않으므로, 잠긴 부대는 플레이어가 도시에서 날짜를 넘겨야 돌아온다.
 *
 * `dispatchSquad(squadId, days)` 처럼 state 를 생략해도 된다.
 * @returns {{ok:boolean, reason:string, returnDay:number, days:number}}
 */
export function dispatchSquad(state, squadId, days) {
  if (shifted(state)) { [state, squadId, days] = [gs(), state, squadId]; }
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return { ok: false, reason: '부대를 찾을 수 없습니다.', returnDay: 0, days: 0 };
  const day = (st && st.day) || 0;
  const n = Math.max(0, Math.round(Number(days) || 0));
  normalizeDispatch(squad, day);
  if (n <= 0) {
    // 0일짜리 의뢰는 그 자리에서 끝난 것으로 본다 (잠그지 않는다).
    return { ok: true, reason: `${squad.name}${josa(squad.name)} 당일로 복귀했습니다.`, returnDay: day, days: 0 };
  }
  squad.status = SQUAD_AWAY;
  squad.returnDay = day + n;
  return {
    ok: true,
    reason: `${squad.name}${josa(squad.name)} 원정에 나섰습니다. ${squad.returnDay}일차 복귀 예정.`,
    returnDay: squad.returnDay,
    days: n,
  };
}

/**
 * 부대를 즉시 복귀시킨다 (날짜 진행에서 호출). 이미 idle 이면 ok:false.
 * @returns {{ok:boolean, reason:string}}
 */
export function recallSquad(state, squadId) {
  if (shifted(state)) { [state, squadId] = [gs(), state]; }
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return { ok: false, reason: '부대를 찾을 수 없습니다.' };
  if (squad.status !== SQUAD_AWAY) return { ok: false, reason: '원정 중인 부대가 아닙니다.' };
  squad.status = SQUAD_IDLE;
  squad.returnDay = 0;
  return { ok: true, reason: `${squad.name}${josa(squad.name)} 복귀했습니다.` };
}

/**
 * 원정 중인가. 인자는 부대 객체 / 부대 id 무엇이든 받는다.
 * 필드가 없는 예전 세이브는 항상 false (= idle).
 * @param {object|string} squad
 * @param {number} day 현재 날짜
 */
export function isSquadAway(squad, day = 0) {
  const s = (squad && typeof squad === 'object') ? squad : getSquad(gs(), squad);
  if (!s) return false;
  if (s.status !== SQUAD_AWAY) return false;
  const rd = Math.round(Number(s.returnDay) || 0);
  if (!rd) return false;
  const d = Number(day) || 0;
  return rd > d;
}

/**
 * 복귀까지 남은 일수. 원정 중이 아니면 0.
 * @param {object|string} squad
 * @param {number} day 현재 날짜
 * @returns {number}
 */
export function squadReturnIn(squad, day = 0) {
  const s = (squad && typeof squad === 'object') ? squad : getSquad(gs(), squad);
  if (!isSquadAway(s, day)) return 0;
  return Math.max(0, Math.round((Number(s.returnDay) || 0) - (Number(day) || 0)));
}

/* ─────────────────────────── 조회 ─────────────────────────── */

/** 슬롯 순서대로의 용병 목록 (빈 슬롯 제외) */
export function squadMembers(state, squadId) {
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return [];
  return normalizeSlots(squad).map((u) => getMerc(st, u)).filter(Boolean);
}

/** 길이 7의 배열 (빈 슬롯은 null) — 편성 UI용 */
export function squadSlots(state, squadId) {
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return new Array(SQUAD_SIZE).fill(null);
  return normalizeSlots(squad).map((u) => getMerc(st, u));
}

/** 부대 전력 (진형 보정 포함) */
export function squadPower(state, squadId) {
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return 0;
  const f = getFormation(squad.formationId) || getFormation('basic');
  let total = 0;
  normalizeSlots(squad).forEach((u, i) => {
    const m = getMerc(st, u);
    if (!m) return;
    const c = getClass(m.classId);
    const base = mercPower(m, st);
    let mul = 1;
    if (f) {
      const mods = formationMods(f, i, { arch: c && c.arch, classId: m.classId }) || {};
      // 진형 보정의 평균적 영향만 반영 (표기용 근사치)
      const keys = Object.keys(mods);
      if (keys.length) mul = 1 + keys.reduce((a, k) => a + mods[k], 0) / (keys.length * 2);
    }
    total += base * mul;
  });
  return Math.round(total);
}

/**
 * 모든 부대의 전력을 **상태에 찍어 둔다.**
 *
 * ★ 왜 필요한가
 *   순위표에 올릴 값(`game/rules.js`)은 «의존성 0 데이터 모듈» 만 물 수 있다 —
 *   서버(Deno)로 게임 전체가 딸려가면 안 되기 때문이다. 그래서 rules.js 는
 *   `squadPower()` 를 부를 수 없고 `sq.power` 를 **읽기만** 한다.
 *   그런데 그 값을 아무도 안 써 넣고 있었다 — 순위표의 부대 전력이 늘 비어 있었다.
 *
 * ★ 왜 «바뀔 때마다» 가 아니라 여기서 한 번에 찍나
 *   전력은 단원·레벨·장비·진형 어디가 바뀌어도 달라진다. 그 모든 자리에 갱신을 심으면
 *   반드시 한 곳을 빠뜨리고, 빠뜨린 것은 «순위표 숫자가 조금 낡았다» 로만 보여 안 잡힌다.
 *   제출 직전에 전부 다시 계산하는 편이 싸고 확실하다 (부대는 최대 5개다).
 */
export function stampSquadPower(state) {
  const st = useState(state);
  for (const sq of st.squads || []) {
    if (sq && sq.id) sq.power = squadPower(st, sq.id);
  }
  return st;
}

/** 부대 하루 임금 */
export function squadUpkeep(state, squadId) {
  return squadMembers(state, squadId).reduce((a, m) => a + (m.upkeep || upkeepOf(m)), 0);
}

/** 평균 레벨 (권장 레벨 비교용) */
export function squadAvgLevel(state, squadId) {
  const ms = squadMembers(state, squadId);
  if (!ms.length) return 0;
  return Math.round(ms.reduce((a, m) => a + (m.level || 1), 0) / ms.length);
}

/**
 * 출전 가능한가. 불가하면 사유를 함께 돌려준다.
 * ※ 반환값은 항상 객체다. 반드시 `.ok` 로 판정할 것.
 *
 * 부상자는 출전을 막지 않는다 — **자동으로 벤치**되고 남은 인원으로 나간다.
 * 한 명이 다쳤다고 부대 전체가 묶이면 회복 대기 중에 임금만 빠져나가 진행이 막힌다.
 * 전원 부상일 때만 출전 불가다.
 *
 * 원정(`status:'away'`) 중인 부대는 복귀 전까지 출전할 수 없다.
 * 이건 부상과 달리 벤치로 우회할 수 없는 하드 블록이다 — 부대 자체가 도시에 없다.
 *
 * @returns {{ok:boolean, reason:string, wounded:object[], benched:object[], deployable:object[],
 *            away:boolean, returnDay:number, returnIn:number}}
 *  - `wounded`   부상 중인 단원 (= `benched`, 기존 필드 유지)
 *  - `benched`   이번 출전에서 빠지는 단원
 *  - `deployable` 실제로 싸울 단원
 *  - `away`      원정 중이라 막혔는가
 *  - `returnDay` 복귀 예정 일차 (원정 중이 아니면 0)
 *  - `returnIn`  복귀까지 남은 일수 (원정 중이 아니면 0)
 */
export function canDeploy(state, squadId) {
  const st = useState(state);
  const none = { wounded: [], benched: [], deployable: [], away: false, returnDay: 0, returnIn: 0 };
  const squad = getSquad(st, squadId);
  if (!squad) return { ok: false, reason: '부대를 찾을 수 없습니다.', ...none };
  const members = squadMembers(st, squad);
  if (!members.length) return { ok: false, reason: '부대에 배치된 용병이 없습니다.', ...none };

  const day = (st && st.day) || 0;
  const wounded = members.filter((m) => isWounded(m, day));
  const deployable = members.filter((m) => !isWounded(m, day));

  // 원정 중이면 다른 무엇보다 먼저 막는다.
  normalizeDispatch(squad, day);
  if (isSquadAway(squad, day)) {
    const left = squadReturnIn(squad, day);
    return {
      ok: false,
      reason: `원정 중입니다. ${squad.returnDay}일차 복귀 예정 (${left}일 남음).`,
      wounded,
      benched: wounded.slice(),
      deployable,
      away: true,
      returnDay: squad.returnDay,
      returnIn: left,
    };
  }

  const rest = { away: false, returnDay: 0, returnIn: 0 };
  if (!deployable.length) {
    return {
      ok: false,
      reason: '전원이 부상 중입니다. 여관에서 휴식이 필요합니다.',
      wounded,
      benched: wounded.slice(),
      deployable: [],
      ...rest,
    };
  }
  if (!getFormation(squad.formationId)) {
    return { ok: false, reason: '진형이 지정되지 않았습니다.', wounded, benched: wounded.slice(), deployable, ...rest };
  }
  return { ok: true, reason: '', wounded, benched: wounded.slice(), deployable, ...rest };
}

/* ─────────────────────────── 엔진 입력 변환 ─────────────────────────── */

function roundStats(s) {
  return {
    hp: Math.max(1, Math.round(s.hp || 0)),
    atk: Math.max(1, Math.round(s.atk || 0)),
    def: Math.max(0, Math.round(s.def || 0)),
    res: Math.max(0, Math.round(s.res || 0)),
    spd: Math.max(1, Math.round(s.spd || 0)),
    crit: Math.round(clamp(s.crit || 0, 0, 100) * 10) / 10,
    critDmg: Math.round(clamp(s.critDmg || 0, 0, 400) * 10) / 10,
    eva: Math.round(clamp(s.eva || 0, 0, 60) * 10) / 10,
  };
}

/** 진형 슬롯을 전열(x 작은 순)부터 나열한 인덱스 배열 */
function frontFirstOrder(slots) {
  return slots
    .map((s, i) => ({ i, x: (s && s.x) != null ? s.x : 0.5 }))
    .sort((a, b) => (a.x - b.x) || (a.i - b.i))
    .map((o) => o.i);
}

/** 전열 판정 기준 (SPEC §3.4: slot.x < 0.34 = front) */
const FRONT_X = 0.34;

/**
 * 그 용병에게 **지금 발동 중인 세트 고유 효과**를 UnitDef 형태로 뽑는다.
 *
 * 진실의 원천은 `data/sets.js` 의 `special`/`specialParams` 하나뿐이다.
 * gear.js 가 그걸 `setSpecialsFor(merc, itemsById)` 로 넘겨 주고, 여기서는 엔진 계약 형태인
 * `[{ id, params }]` 로만 정규화한다 (label/desc 같은 표기용 필드는 UI 가 sets.js 에서 직접 읽는다).
 *
 * ★ 이 배선이 끊기면 풀세트를 다 맞춰도 화면 설명만 뜨고 전투에서는 아무 일도 일어나지 않는다.
 *   `quest.js allyUnitDefs` 에도 **똑같은 배선이 있어야 한다** — 의뢰·던전 전투는 그쪽 경로를 탄다.
 *   (3차 세션의 진형 누락과 같은 함정이다.)
 *
 * 결정론: 입력 순서를 그대로 보존하고(Set 은 삽입 순서), 무작위 요소를 쓰지 않는다.
 *
 * @param {object} merc
 * @param {object|Array|Map|null} itemsById  gear.itemFinder 가 받는 무엇이든 (state 도 가능)
 * @returns {Array<{id:string, params:object}>} 없으면 빈 배열
 */
function mercSpecials(merc, itemsById) {
  if (!merc) return [];
  let raw = null;
  try {
    // gear.js 가 전용 함수를 제공하면 그걸 쓰고, 아직 없으면 세트 보너스에서 직접 꺼낸다.
    if (typeof Gear.setSpecialsFor === 'function') raw = Gear.setSpecialsFor(merc, itemsById);
    else if (typeof mercSetBonus === 'function') raw = (mercSetBonus(merc, itemsById) || {}).specials;
  } catch (e) {
    console.warn('[squad] 세트 고유 효과 조회 실패', e);
    raw = null;
  }
  if (!Array.isArray(raw) || !raw.length) return [];

  const out = [];
  const seen = new Set();
  for (const sp of raw) {
    const id = (typeof sp === 'string') ? sp : (sp && sp.id);
    if (!id || typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const p = sp && sp.params;
    out.push({ id, params: (p && typeof p === 'object') ? { ...p } : {} });
  }
  return out;
}

/**
 * 전투 엔진에 넘길 UnitDef 배열 (SPEC §5.1).
 * 진형 슬롯 좌표와 formationMods를 여기서 적용한다.
 *
 * 부상자는 제외된다. 부상자가 빠져 **전열이 통째로 비면** 남은 인원을 앞에서부터 다시 채운다 —
 * 빈 자리를 그대로 두면 전열이 비어 후열(궁수/마법사)이 그대로 노출된다.
 * 재배치는 앞뒤 순서를 보존한다 (원래 더 앞에 있던 단원이 계속 앞에 선다).
 *
 * @param {object} state
 * @param {string|object} squadId
 * @returns {object[]}
 */
export function squadUnitDefs(state, squadId) {
  const st = useState(state);
  const squad = getSquad(st, squadId);
  if (!squad) return [];
  const f = getFormation(squad.formationId) || getFormation('basic');
  const slots = (f && Array.isArray(f.slots) && f.slots.length) ? f.slots : DEFAULT_SLOTS;
  const day = (st && st.day) || 0;

  // 배치된 인원 → 부상자 제외
  const filled = [];
  normalizeSlots(squad).forEach((u, i) => {
    const merc = getMerc(st, u);
    if (merc) filled.push({ merc, slotIndex: i });
  });
  const healthy = filled.filter((e) => !isWounded(e.merc, day));
  if (!healthy.length) return [];

  // 재배치는 "전열이 비었을 때"만 한다.
  // 전열에 아직 사람이 서 있으면 후열은 (엔진 타게팅상) 여전히 보호받는다.
  // 이때까지 억지로 앞으로 당기면 궁수/마법사가 전열 밴드로 끌려나와 오히려 더 잘 죽는다.
  const slotX = (i) => {
    const s = slots[i] || DEFAULT_SLOTS[i];
    return s && s.x != null ? s.x : 0.5;
  };
  const frontManned = healthy.some((e) => slotX(e.slotIndex) < FRONT_X);

  let placed = healthy;
  if (!frontManned) {
    const order = frontFirstOrder(slots);
    const rank = new Map(order.map((si, k) => [si, k]));
    const queue = healthy.slice().sort((a, b) => {
      const ra = rank.has(a.slotIndex) ? rank.get(a.slotIndex) : a.slotIndex;
      const rb = rank.has(b.slotIndex) ? rank.get(b.slotIndex) : b.slotIndex;
      return ra - rb;
    });
    placed = queue.map((e, k) => ({ merc: e.merc, slotIndex: order[k] != null ? order[k] : e.slotIndex }));
    placed.sort((a, b) => a.slotIndex - b.slotIndex);
  }

  const out = [];
  for (const { merc, slotIndex: i } of placed) {
    const c = getClass(merc.classId) || {};
    const slot = slots[i] || DEFAULT_SLOTS[i] || { x: 0.5, y: 0.5 };

    const base = mercStats(merc, st);
    const mods = f ? (formationMods(f, i, { arch: c.arch, role: c.arch, classId: merc.classId, side: 'ally' }) || {}) : {};
    const stats = roundStats(scaleStats(base, mods));

    out.push({
      uid: merc.uid,
      name: merc.name,
      side: 'ally',
      classId: merc.classId,
      level: merc.level || 1,
      grade: merc.grade || 'F',
      stats,
      skills: [...(c.skills || [])],
      basicFx: c.basicFx || 'slash',
      basicRange: c.range || 'melee',
      basicDmgType: c.dmgType || 'phys',
      slot: { x: slot.x, y: slot.y },
      slotIndex: i,
      recipe: mercRecipe(merc, st),
      boss: false,
      // 세트 고유 효과 (풀세트에서만 붙는다). 아군 전용 — 적에게는 절대 싣지 않는다.
      specials: mercSpecials(merc, st),
    });
  }
  return out;
}
