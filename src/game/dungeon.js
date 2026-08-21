// 던전 진행 로직 — 개방 판정 / 웨이브 구성 / 전투 정의 / 세트 드랍 / 진행도 반영.
// 순수 JS: DOM을 만지지 않는다. state.js 와 순환할 수 있어 네임스페이스로 받는다.
//
// [이 모듈의 규칙]
//  - 던전은 **월드맵의 별도 노드**다 (data/dungeons.js). 도시가 아니다.
//  - **그 달의 N주차에는 N번 던전만** 열린다 (state.js `openDungeonWeek`).
//  - 던전 하나 = 10웨이브, **웨이브마다 보스가 나온다**. 보스를 잡을 때마다 세트 아이템 1개.
//  - 웨이브 인덱스는 **0부터**다 (quest.js / ui/battle.js 와 같은 규약).
//    표시·저장용 웨이브 번호는 `waveIndex + 1` (1~10).
//  - 적 스탯 파이프라인은 **quest.js 를 그대로 재사용**한다. 던전용으로 quest 모양의 객체를
//    만들어 `questBattleDefs` 에 넘긴다 — 진형·보스 감쇠·스탯 배율 경로가 의뢰와 한 벌로 굴러야
//    "던전만 이상하게 세다/약하다" 가 안 생긴다. 던전 고유 난이도는 `WAVE_POWER` 하나로 낸다.

import { clamp } from '../core/util.js';
import { RNG, rng as globalRng } from '../core/rng.js';
import {
  DUNGEONS, DUNGEON_LIST, DUNGEON_IDS, DUNGEON_WAVES, DUNGEON_WEEKS,
  getDungeon, dungeonForWeek, dungeonBySet,
} from '../data/dungeons.js';
import { buildEnemySquad, getEnemy } from '../data/enemies.js';
import { getFormation } from '../data/formations.js';
import * as Items from '../data/items.js';
import * as State from './state.js';
import * as Quest from './quest.js';
import * as Merc from './merc.js';
import * as Gear from './gear.js';

export { DUNGEONS, DUNGEON_LIST, DUNGEON_IDS, getDungeon, dungeonForWeek, dungeonBySet };

/* ════════════════════════════════════════════════════════════════════════
 *  난이도 노브 (설계 C)
 * ════════════════════════════════════════════════════════════════════════
 * 목표 곡선:
 *   Lv80 4차 7인 **grade A** · 세트 0개 → 1웨이브 승률 ~50% / 2웨이브는 사실상 불가(<10%)
 *   세트를 모을수록 완만히 상승 → 풀세트(10칸, 양손무기면 9칸)로 10웨이브 ~30%
 *
 * ★ 튜닝 담당에게 — 숫자를 키우기 전에 이 네 가지를 먼저 읽어라. 전부 실측이다(8차 세션).
 *
 * (1) **승률이 배율에 거의 계단으로 반응한다.** 편성이 고정이라 7대7 만렙 전투는 결정론에 가깝다.
 *     실측(전설 10칸 부대 · frostbastion 1웨이브): 배율 3.0 → 100% / 3.2 → 8% / 3.5 → 0%.
 *     0.1 이 40~90%p 다. **웨이브 하나의 승률을 30%/50% 같은 값에 맞추는 것은 불가능하다** —
 *     판정은 반드시 `tools/dungeon.mjs` 의 **런(HP 인계) 통계**로 해라.
 *
 * (2) **실제 난이도는 배율이 아니라 HP 인계(소모전)가 만든다.** 웨이브를 넘어도 체력은
 *     회복되지 않고 다운된 용병은 그 런에서 빠진다(`settleMembers`). 그래서 만피 승률이
 *     100% 인 웨이브도 런에서는 3~4층이 한계가 된다. 배율을 조금만 올려도 도달 웨이브가
 *     절반으로 줄어든다 — 곡선을 가파르게 만들 필요가 없다.
 *
 * (3) ★ **드랍 게이트를 막지 마라.** 방어구는 1~5웨이브, 장신구는 6~8, 무기·왼손은 9~10에서만
 *     나온다. 즉 **방어구 5칸만 모은 부대가 6웨이브에 닿을 수 있어야** 장신구를 모으고,
 *     **장신구까지 모은 부대가 9웨이브에 닿을 수 있어야** 무기가 나온다. 초반 웨이브를 세게
 *     잡으면 세트를 영원히 완성할 수 없는 순환 고리가 생긴다(실측으로 실제로 만들어 봤다).
 *     그래서 1~9웨이브는 완만하고(2.92 → 3.60, 총 x1.23) **10웨이브만 벽(6.35)** 이다.
 *
 * (3-c) ★ **grade A 기준으로 곡선 전체를 다시 잡았다 (14차).** 1~9웨는 x1.09,
 *     10웨는 6.00 → 6.35. A 부대 실측으로 완주율 29% · 게이트 둘 다 통과.
 *     10웨 감도(A 기준): 6.10 → 70% / 6.25 → 47% / 6.30 → 35% / 6.35 → **29%** / 6.58 → 0%.
 *
 * (3-b) ★ **10웨이브 벽은 4.78 → 5.36 으로 올렸다 (9차).** 세트 고유 효과(`data/sets.js` 의
 *     `special` 4종)가 엔진에 실제로 붙으면서 풀세트가 세졌기 때문이다 — 곡선을 그대로 두면
 *     완주율이 30% → **75%** 로 뛴다(실측). 고유 효과는 **풀세트에만** 붙으므로 세트3~8 구간의
 *     도달 웨이브는 하나도 변하지 않았고, 그래서 **바꾼 값은 10웨이브 한 칸뿐**이다.
 *     `battle/engine.js` 의 고유 효과를 만지면 `node tools/dungeon.mjs` 로 여기를 다시 재라.
 *
 * (4) 곡선의 총 폭은 세트가 주는 전투력 증가분을 넘을 수 없다. 실측:
 *     장비없음 1.00 → 전설 10칸 1.83 → 풀세트 2.45 (전설 대비 x1.34).
 *
 * 기준선: **전설 10칸을 낀 Lv80 4차 grade A 부대**다 (14차 세션에 B → A 로 올렸다).
 *   ★ 왜 바꿨나: 도구마다 기준 등급이 달랐다(tower/abyss 는 A, dungeon/setspecial 은 B).
 *     등급 한 칸이 맞대결 승률 0% 로 갈리는 게임이라(`tools/gradegap.mjs`) 이건
 *     전혀 다른 난이도다. 실제로 B 곡선을 A 부대로 재니 **풀세트 완주율이 25% → 73%**,
 *     세트 0개 평균 도달이 1.6 → 3.2 로 튀어 설계 목표 두 개가 깨져 있었다.
 *   예전 표(1.48 시작)는 장비 없는 부대 기준이었는데, 10슬롯 확장으로 실제 만렙 부대가
 *   1.83배 세져 그 잣대가 통째로 무의미해졌다.
 *   던전별 `power`(data/dungeons.js)는 네 던전의 1웨이브 난이도를 서로 맞추는 정규화 계수다.
 */
/** 웨이브별 적 전스탯 배율 (인덱스 0 = 1웨이브). `wave.power` 로 그대로 넘어간다.
 *  quest.js `enemyUnitDefs` 가 hp/atk/def/res/spd 전부에 곱한다.
 *  1~9웨이브는 완만(2.92 → 3.60), **10웨이브만 벽(6.35)** — 위 (3)·(3-b) 참조.
 *  ★ 10웨이브는 매우 가파르다. 0.01 단위로 만져라.
 *  ★ 이 값은 세트 예산 버그를 고치면서 함께 올렸다. 신화(세트)가 전설보다 약했던 것을
 *    바로잡자(sets.js SLOT_COEF/SET_REF_POWER) 풀세트 완주율이 30% → 75% 로 뛰었다.
 *    sets.js 를 만지면 **여기도 반드시 다시 재라** — 두 값은 한 몸이다. */
export const WAVE_POWER = [2.92, 2.94, 2.96, 2.99, 3.01, 3.05, 3.16, 3.32, 3.60, 6.35];

/** 웨이브 하나에 세우는 적 수. 보스 1 + 호위 6 (엔진 상한 7). */
export const WAVE_SIZE = 7;

/* ── 편성은 고정이다 (data/dungeons.js `lineup`/`bosses`) ──
 * 무작위 편성(`buildEnemySquad`)을 쓰면 위 곡선이 그냥 거짓말이 된다. tier 5 는 개체차가 커서
 * (강철 거상 hp×3.58 ↔ 심연의 저격수 ×2.20) 같은 배율에서도 웨이브 승률이 **0% ↔ 100%** 로
 * 튀었다(실측). 원인은 총 스탯이 아니라 **역할 구성**이었다 —
 *   · cave 의 tier 5 풀에는 비힐러 원거리가 하나도 없어 후열이 전부 힐러가 됐고(승률 0%),
 *   · plains 는 반대로 마법사 3기가 몰려 아군이 첫 폭발에 녹았다.
 * 편성 지수로 배율을 정규화해 봐도(√(hp×atk) 합) 이 구조 차이는 못 잡는다.
 * 그래서 편성을 손으로 못 박고 **난이도 축을 WAVE_POWER 하나로 남겼다.**
 * 던전마다 lineup 이 다르므로 "이 던전은 전열이 두껍다/후열이 아프다" 는 개성은 유지된다.
 * lineup 이 비어 있는 던전은 예전처럼 buildEnemySquad 로 폴백한다(데이터 누락 방어). */

/** 던전 웨이브 수 (= data/dungeons.js DUNGEON_WAVES) */
export const WAVES = DUNGEON_WAVES;

/** 던전 전투에 쓰는 랭크 문자. quest.js 의 보스 감쇠(BOSS_SCALE.S = 0.90)를 그대로 탄다. */
const DUNGEON_RANK = 'S';

/* ── 드랍 (설계 C) ────────────────────────────────────────────────────────
 * 웨이브별로 나오는 슬롯이 정해져 있다. 방어구 → 장신구 → 무기 순으로 뒤로 갈수록
 * 값나가는 칸이 나온다. 그래서 "앞 웨이브만 돌아 방어구부터 채우고 → 더 깊이 들어간다" 는
 * 순서가 자연히 생긴다. */
/* 슬롯 목록의 소유자는 `data/items.js` 다. 여기서 하드코딩하면 슬롯이 바뀔 때 조용히 어긋난다 —
 * 있으면 그쪽 것을 쓰고, 없을 때만 아래 기본값으로 떨어진다. */
const fromItems = (name, fallback) => (Array.isArray(Items[name]) && Items[name].length ? Items[name].slice() : fallback);

/** 신화(Mythic) 희귀도 — 전설(4) 위 등급 */
export const MYTHIC_RARITY = Number.isFinite(Items.MYTHIC_RARITY) ? Items.MYTHIC_RARITY : 5;
/** 1~5웨이브 드랍 슬롯 (방어구 5칸) */
export const DROP_ARMOR_SLOTS = fromItems('ARMOR_SLOTS', ['head', 'body', 'legs', 'hands', 'feet']);
/** 6~8웨이브 드랍 슬롯 (장신구 3칸) */
export const DROP_ACC_SLOTS = fromItems('ACC_SLOTS', ['neck', 'ring1', 'ring2']);
/** 9~10웨이브 드랍 슬롯 (무기·왼손) */
export const DROP_WEAPON_SLOTS = fromItems('WEAPON_SLOTS', ['weapon', 'offhand']);
/** 웨이브 번호(1~10) -> 드랍 슬롯 풀 */
export const DROP_TABLE = [
  DROP_ARMOR_SLOTS, DROP_ARMOR_SLOTS, DROP_ARMOR_SLOTS, DROP_ARMOR_SLOTS, DROP_ARMOR_SLOTS,
  DROP_ACC_SLOTS, DROP_ACC_SLOTS, DROP_ACC_SLOTS,
  DROP_WEAPON_SLOTS, DROP_WEAPON_SLOTS,
];
/** 드랍 ilvl = DROP_ILVL_BASE + waveIndex (1웨이브 71 … 10웨이브 80) */
export const DROP_ILVL_BASE = 71;
/** 드랍 ilvl 상한 (= 만렙) */
export const DROP_ILVL_MAX = 80;

/** 레벨 상한 (merc.js MAX_LEVEL / quest.js MAX_QUEST_LEVEL 과 같은 값) */
const MAX_LEVEL = 80;

/* ------------------------------------------------------------------ 유틸 */

function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 네임스페이스에서 있는 함수 하나를 고른다 (모듈 갱신 순서에 안 물리게 하려는 방어) */
function pickFn(ns, names) {
  for (const n of names) if (ns && typeof ns[n] === 'function') return ns[n];
  return null;
}

const warned = new Set();
function warnOnce(key, ...args) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(...args);
}

/** 0-based 웨이브 인덱스로 정규화 */
function normWaveIndex(waveIndex, total = WAVES) {
  const i = Math.round(Number(waveIndex));
  return clamp(Number.isFinite(i) ? i : 0, 0, Math.max(0, total - 1));
}

/* ------------------------------------------------------------------ 개방 판정 */

/** 지금(또는 그날)의 개방 주차 1~4. state.js 가 없는 빌드에서도 같은 식으로 계산한다. */
function weekOf(day) {
  const d = day == null ? (State.state ? State.state.day : 1) : day;
  try {
    if (typeof State.openDungeonWeek === 'function') return clamp(State.openDungeonWeek(d), 1, DUNGEON_WEEKS);
    if (typeof State.calendar === 'function') return clamp(State.calendar(d).week, 1, DUNGEON_WEEKS);
  } catch { /* 아래 폴백 */ }
  // 폴백: 1주 7일 · 1개월 4주 = 28일
  const n = Math.floor(Number(d));
  const day1 = Number.isFinite(n) && n >= 1 ? n : 1;
  return clamp(Math.floor(((day1 - 1) % 28) / 7) + 1, 1, DUNGEON_WEEKS);
}

/**
 * 그날 들어갈 수 있는 던전 id (달력 주차 기준).
 * @param {number} [day] 생략하면 현재 state.day
 * @returns {string|null}
 */
export function openDungeonId(day = null) {
  const d = dungeonForWeek(weekOf(day));
  return d ? d.id : null;
}

/** 그날 열려 있는 던전 객체 (없으면 null) */
export function openDungeon(day = null) {
  return getDungeon(openDungeonId(day));
}

/**
 * 이 던전에 지금 들어갈 수 있는가.
 * @param {object} [state] 게임 상태 (기본: 전역 state)
 * @param {string} dungeonId
 * @returns {{ok:boolean, reason:string, week:number, dungeonId:string|null, openId:string|null}}
 */
export function canEnter(state = State.state, dungeonId = null) {
  const st = state || State.state;
  const week = weekOf(st ? st.day : null);
  const openId = openDungeonId(st ? st.day : null);
  const d = getDungeon(dungeonId);
  if (!d) {
    return { ok: false, reason: '그런 던전은 없다.', week, dungeonId: dungeonId || null, openId };
  }
  if (d.week !== week) {
    return {
      ok: false,
      reason: `${d.name} — ${d.week}주차에만 열린다. 지금은 ${week}주차다.`,
      week, dungeonId: d.id, openId,
    };
  }
  return { ok: true, reason: '', week, dungeonId: d.id, openId };
}

/* ─────────────────── 부대별 «오늘 몫» ───────────────────
 *
 * ★★ 제작자 지적: 「던전이 안 죽고 그만두고 다시 1웨이브부터 할 수 있는데,
 *   그 주에 한 번 진행한 부대는 다시 못 하도록 막아 줘」
 *
 *   던전은 지면 그 도전이 끝나지만 **물러나면(정비) 아무 대가가 없었다.**
 *   그래서 «1웨이브만 깨고 물러나기» 를 반복하면 세트 조각을 무한히 캘 수 있었다.
 *   **부대마다 하루 1회**로 못 박는다 (제작자 결정: 주 1회는 너무 빡빡했다).
 *
 * ★ 부대를 여럿 굴리면 부대 수만큼 갈 수 있다 — 그게 부대를 늘리는 이유이기도 하다.
 *
 * ★★ «한 판» 이 아니라 «시작» 을 센다. 1웨이브에 들어가는 순간 오늘 몫을 쓴 것이고,
 *   **2웨이브·3웨이브로 이어 가는 것은 같은 판이라 다시 안 센다.**
 *   (처음에 웨이브마다 세는 바람에 1웨이브 뒤 진행이 막혔다 — 제작자가 바로 잡아 줬다.)
 *
 * ★ 기록은 «마지막으로 들어간 날» 하나면 된다. 날짜가 오르면 저절로 풀린다. */

/** 이 부대가 오늘 이미 던전에 들어갔나 */
export function squadUsedToday(state = State.state, squadId = null) {
  const st = state || State.state;
  if (!st || !squadId) return false;
  const runs = st.dungeonRuns;
  if (!runs || typeof runs !== 'object') return false;
  const d = Math.floor(Number(runs[squadId]));
  return Number.isFinite(d) && d >= (st.day || 1);
}

/** 이 부대가 오늘 몫을 썼다고 남긴다 (**1웨이브 진입** 시점에만 부른다 — 물러나도 남는다) */
export function markSquadRun(state = State.state, squadId = null) {
  const st = state || State.state;
  if (!st || !squadId) return;
  if (!st.dungeonRuns || typeof st.dungeonRuns !== 'object' || Array.isArray(st.dungeonRuns)) st.dungeonRuns = {};
  st.dungeonRuns[squadId] = st.day || 1;
}

/** 던전 진행도 조회 `{bestWave, clearedAt}` (기록이 없으면 0/null) */
export function dungeonProgress(state = State.state, dungeonId = null) {
  const st = state || State.state;
  try {
    if (typeof State.getDungeonProgress === 'function') return State.getDungeonProgress(dungeonId, st);
  } catch { /* 아래 폴백 */ }
  const e = dungeonId && st && st.dungeons ? st.dungeons[dungeonId] : null;
  const best = Math.floor(Number(e && e.bestWave));
  const cleared = Math.floor(Number(e && e.clearedAt));
  return {
    bestWave: Number.isFinite(best) && best > 0 ? best : 0,
    clearedAt: Number.isFinite(cleared) && cleared > 0 ? cleared : null,
  };
}

/* ------------------------------------------------------------------ 웨이브 */

/** 이 웨이브의 적 스탯 배율 = WAVE_POWER × 던전별 배율 */
export function wavePower(dungeonId, waveIndex = 0) {
  const d = getDungeon(dungeonId);
  const wi = normWaveIndex(waveIndex, d ? d.waves : WAVES);
  const base = WAVE_POWER[clamp(wi, 0, WAVE_POWER.length - 1)] || 1;
  const mul = d && Number.isFinite(d.power) ? d.power : 1;
  return base * mul;
}

/** enemies.js 가 돌려준 부대 정의를 안전한 형태로 다듬는다 (quest.js normalizeWave 와 같은 규칙) */
function normalizeUnits(sq, fallbackLevel) {
  const raw = sq && Array.isArray(sq.units) ? sq.units : [];
  const units = raw.slice(0, 7).map((u, i) => ({
    enemyId: (u && (u.enemyId || u.id)) || null,
    level: clamp(Math.round((u && u.level) != null ? u.level : fallbackLevel), 1, MAX_LEVEL),
    slotIndex: Number.isInteger(u && u.slotIndex) ? clamp(u.slotIndex, 0, 6) : i,
  })).filter((u) => u.enemyId);
  const used = new Set();
  for (const u of units) {
    while (used.has(u.slotIndex)) u.slotIndex = (u.slotIndex + 1) % 7;
    used.add(u.slotIndex);
  }
  return { units, formationId: (sq && sq.formationId) || 'basic' };
}

/** 원거리 계열인가 (enemies.js 의 같은 판정을 여기서도 쓴다) */
const isRangedLike = (e) => !!e && (e.range === 'ranged' || e.arch === 'archer' || e.arch === 'mage' || e.arch === 'healer');

/** 진형 슬롯 인덱스를 전열(x 작은 순)부터 나열 */
function slotOrder(formationId) {
  const f = getFormation(formationId) || getFormation('basic');
  const slots = f && Array.isArray(f.slots) ? f.slots : null;
  const idx = [0, 1, 2, 3, 4, 5, 6];
  if (!slots || slots.length < 7) return idx;
  return idx.sort((a, b) => (slots[a].x - slots[b].x) || (slots[a].y - slots[b].y));
}

/**
 * 이 웨이브의 층주(보스) id.
 * 보스를 웨이브마다 **번갈아** 세우면 안 된다 — 보스는 웨이브 총 HP 의 3~4할이라
 * 교대만으로 승률이 100% ↔ 0% 로 튀어(실측) 난이도가 톱니처럼 오르내린다.
 * 그래서 `bosses` 를 **약한 순서대로** 나열하고 웨이브 구간을 통째로 나눠 준다
 * (보스 2기면 1~5웨이브 / 6~10웨이브). 난이도는 계단이 되지만 단조 증가는 지켜진다.
 */
export function bossForWave(dungeonId, waveIndex = 0) {
  const d = getDungeon(dungeonId);
  if (!d || !d.bosses.length) return null;
  const wi = normWaveIndex(waveIndex, d.waves);
  const seg = Math.floor((wi * d.bosses.length) / Math.max(1, d.waves));
  return d.bosses[clamp(seg, 0, d.bosses.length - 1)];
}

/** 고정 편성으로 웨이브를 세운다 (lineup 이 없으면 null) */
function fixedWave(d, wi) {
  const bossId = bossForWave(d.id, wi);
  const boss = getEnemy(bossId);
  const escorts = d.lineup.map(getEnemy).filter(Boolean);
  if (!escorts.length) return null;

  const order = slotOrder(d.formationId);
  const used = new Set();
  const takeFront = () => {
    for (const i of order) if (!used.has(i)) { used.add(i); return i; }
    return -1;
  };
  const takeBack = () => {
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      if (!used.has(i)) { used.add(i); return i; }
    }
    return -1;
  };

  const units = [];
  // 보스: 근접형은 최전열, 시전형은 최후열 (enemies.js buildEnemySquad 와 같은 규칙)
  if (boss) units.push({ enemyId: boss.id, level: d.level, slotIndex: isRangedLike(boss) ? takeBack() : takeFront() });
  // 호위: lineup 순서대로 전열부터, 원거리 계열은 후열부터 채운다
  for (const e of escorts.slice(0, Math.max(0, WAVE_SIZE - units.length))) {
    units.push({ enemyId: e.id, level: d.level, slotIndex: isRangedLike(e) ? takeBack() : takeFront() });
  }
  return {
    units: units.filter((u) => u.slotIndex >= 0).sort((a, b) => a.slotIndex - b.slotIndex),
    formationId: d.formationId || 'basic',
  };
}

/**
 * 던전 웨이브의 적 부대 정의를 만든다. **웨이브마다 보스가 나온다.**
 *
 * 편성은 `data/dungeons.js` 의 고정 lineup 이다 (웨이브마다 층주만 바뀐다).
 * lineup 이 비어 있는 던전만 `buildEnemySquad` 로 폴백하며, 이때는 rng 를 주지 않으면
 * `(dungeonId, waveIndex)` 로 시드된 RNG 를 쓴다 — 미리보기와 실제 전투가 같아야 한다.
 * @param {string} dungeonId
 * @param {number} waveIndex 0-based (0 = 1웨이브)
 * @param {RNG} [rng] 폴백 경로에서만 쓰인다
 * @returns {{units:Array, formationId:string, power:number, boss:boolean, level:number,
 *            waveIndex:number, waveNo:number, dungeonId:string}|null}
 */
export function dungeonWave(dungeonId, waveIndex = 0, rng = null) {
  const d = getDungeon(dungeonId);
  if (!d) return null;
  const wi = normWaveIndex(waveIndex, d.waves);

  let wave = fixedWave(d, wi);
  if (!wave) {
    // 폴백: 데이터에 lineup 이 없을 때만 무작위 편성 (난이도 편차가 크다 — 위 주석 참조)
    const r = rng || new RNG(hashStr(`dg#${d.id}#${wi}`));
    let sq = null;
    try {
      sq = buildEnemySquad({
        id: `dg_${d.id}_w${wi}`, biome: d.biome, tier: d.tier, level: d.level,
        count: WAVE_SIZE, size: WAVE_SIZE, boss: true, elite: false,
        rank: DUNGEON_RANK, rankIndex: 6,
        waveIndex: wi, waveCount: d.waves, isLast: wi === d.waves - 1, rng: r,
      }, r);
    } catch (e) {
      console.warn('[dungeon] buildEnemySquad 실패', e);
    }
    wave = normalizeUnits(sq, d.level);
  }

  wave.power = wavePower(d.id, wi);
  wave.boss = true;
  wave.level = d.level;
  wave.waveIndex = wi;
  wave.waveNo = wi + 1;
  wave.dungeonId = d.id;
  return wave;
}

/**
 * quest.js 파이프라인에 그대로 태울 수 있는 **의뢰 모양 객체**를 만든다.
 * 보상은 전부 0 이다 — 던전 보상은 `dropForWave` 의 세트 아이템 하나뿐이고,
 * 골드·경험치·명성·평판은 의뢰 경제를 건드리지 않으려고 일부러 비워 뒀다.
 * (밸런스 도구가 던전 전투를 잴 때도 이 객체를 쓰면 된다.)
 * @returns {object|null}
 */
export function dungeonQuest(dungeonId, waveIndex = 0, rng = null) {
  const d = getDungeon(dungeonId);
  if (!d) return null;
  const wi = normWaveIndex(waveIndex, d.waves);
  const wave = dungeonWave(d.id, wi, rng);
  if (!wave || !wave.units.length) return null;
  return {
    id: `dg_${d.id}_w${wi}`,
    name: `${d.name} ${wi + 1}웨이브`,
    type: '섬멸',
    cityId: null,                 // 도시가 아니다 → 평판 경로를 타지 않는다
    biome: d.biome,
    rank: DUNGEON_RANK,           // 보스 감쇠(BOSS_SCALE.S)와 등급 표기용
    sub: 0,
    rankLabel: DUNGEON_RANK,
    elite: false,
    level: d.level,
    days: 0,                      // 부대를 잠그지 않는다 (파견 모델과 분리)
    waves: [wave],
    reward: { gold: 0, exp: 0, renown: 0, itemRolls: [] },
    desc: `${d.name} ${wi + 1}웨이브. 층마다 주인이 하나씩 버티고 있다.`,
    expiresDay: Number.MAX_SAFE_INTEGER,
    dungeonId: d.id,
    waveIndex: wi,
    waveCount: d.waves,
  };
}

/**
 * 적 유닛 정의만 뽑는다 (부대 없이 재는 밸런스 도구용).
 * @returns {Array} UnitDef[]
 */
export function dungeonEnemyDefs(dungeonId, waveIndex = 0, rng = null) {
  const q = dungeonQuest(dungeonId, waveIndex, rng);
  if (!q) return [];
  try {
    return Quest.enemyUnitDefs(q.waves[0], q, q.waveIndex) || [];
  } catch (e) {
    console.warn('[dungeon] enemyUnitDefs 실패', e);
    return [];
  }
}

/**
 * `createBattle` 에 넘길 설정을 만든다.
 * 아군 편성·진형·스탯은 의뢰 전투와 **완전히 같은 경로**(quest.js questBattleDefs)를 탄다.
 * @param {object} state
 * @param {string} dungeonId
 * @param {number} waveIndex 0-based
 * @param {string} [squadId]
 * @returns {object} createBattle cfg (+ dungeonId/waveIndex/waveCount)
 */
export function dungeonBattleDefs(state = State.state, dungeonId = null, waveIndex = 0, squadId = null) {
  const st = state || State.state;
  const d = getDungeon(dungeonId);
  if (!d) throw new Error('그런 던전은 없다.');
  const wi = normWaveIndex(waveIndex, d.waves);
  const q = dungeonQuest(d.id, wi);
  if (!q) throw new Error('던전 웨이브를 만들지 못했다.');

  const cfg = Quest.questBattleDefs(q, 0, st, squadId);
  // questBattleDefs 는 quest.waves 기준으로 1/1 웨이브라고 적어 보낸다. 던전 기준으로 덮어쓴다.
  cfg.waveIndex = wi;
  cfg.waveCount = d.waves;
  cfg.dungeonId = d.id;
  cfg.dungeon = true;
  cfg.questId = q.id;
  cfg.biome = d.biome;
  cfg.title = `${d.name} ${wi + 1}/${d.waves}웨이브`;
  // 전투 시드에 **날짜**를 섞는다.
  // questBattleDefs 의 기본 시드는 (의뢰 id + 웨이브 + 부대)라 던전처럼 id 가 고정된 콘텐츠는
  // 같은 부대로 몇 번을 들어와도 **완전히 똑같은 전투**가 된다. 편성까지 고정이라 한 번 진
  // 웨이브는 장비를 바꾸기 전까지 영원히 진다. 날짜를 섞으면 그날 안에서는 결과가 고정이라
  // (저장·재시도로 굴리기 방지) 하루에 한 번은 다시 도전해 볼 값어치가 생긴다.
  cfg.seed = (hashStr(`dg#${d.id}#${wi}#${cfg.squadId || ''}#${st.day || 0}`) ^ ((st.seed || 0) >>> 0)) >>> 0;
  return cfg;
}

/* ------------------------------------------------------------------ 드랍 */

/** 웨이브(0-based)에서 나올 수 있는 슬롯 풀 */
export function dropSlotsForWave(waveIndex = 0) {
  const wi = normWaveIndex(waveIndex);
  return (DROP_TABLE[wi] || DROP_ARMOR_SLOTS).slice();
}

/** 웨이브에서 나올 슬롯 하나를 굴린다 */
export function dropSlotForWave(waveIndex = 0, rng = null) {
  const pool = dropSlotsForWave(waveIndex);
  const r = rng || globalRng;
  if (r && typeof r.pick === 'function') return r.pick(pool);
  return pool[clamp(Math.floor(Math.random() * pool.length), 0, pool.length - 1)];
}

/**
 * 웨이브를 깼을 때 세트 조각이 나올 확률.
 * 올리면 수집이 빨라지고 내리면 느려진다 — 완주 1회가 곧 1개월이라 체감이 크다.
 */
export const DROP_CHANCE = 0.30;

/** 드랍 아이템 레벨 */
export function dropIlvl(waveIndex = 0) {
  return clamp(DROP_ILVL_BASE + normWaveIndex(waveIndex), 1, DROP_ILVL_MAX);
}

/* 세트 아이템 **실물**은 data/items.js / game/gear.js 소유다. 여기서는
 * "어느 세트의 어느 슬롯을 몇 ilvl 로" 만 정하고 실제 생성은 아래 순서로 위임한다.
 *   0) setDungeonDropFactory 로 주입된 팩토리
 *   1) gear.js 의 세트 전용 롤러 (rollSetItem 등)
 *   2) 세트 베이스를 찾아 gear.js rollItem({baseId, rarity:5})
 * 셋 다 없으면 **아이템을 만들지 않는다**(null). 아무 아이템이나 만들어 주면 세트가 아닌
 * 물건이 신화로 둔갑해 밸런스가 조용히 망가진다 — 차라리 비는 편이 낫다. */
let dropFactory = null;

/**
 * 세트 아이템 생성기를 주입한다 (items/gear 담당이 이름을 다르게 정했을 때의 탈출구).
 * @param {(ctx:{setId:string, slot:string, ilvl:number, rarity:number, rng:RNG,
 *            dungeonId:string, waveIndex:number}) => object|null} fn
 */
export function setDungeonDropFactory(fn) {
  dropFactory = typeof fn === 'function' ? fn : null;
}

/** 세트 id + 슬롯 -> 베이스 id (없으면 null) */
function setPieceBaseId(setId, slot) {
  if (!setId || !slot) return null;
  // 1) items.js 가 조회 함수를 열어 뒀으면 그걸 쓴다
  const fn = pickFn(Items, ['setPieceFor', 'setPiece', 'pieceOfSet', 'setBaseFor']);
  if (fn) {
    try {
      const v = fn(setId, slot);
      const id = typeof v === 'string' ? v : (v && v.id) || null;
      if (id) return id;
    } catch { /* 아래로 */ }
  }
  // 2) ITEM_SETS[setId].pieces — 배열(baseId 목록) 또는 {slot: baseId} 맵 둘 다 받는다
  const def = Items.ITEM_SETS ? Items.ITEM_SETS[setId] : null;
  const pieces = def && def.pieces;
  if (pieces && !Array.isArray(pieces) && typeof pieces === 'object') {
    const v = pieces[slot];
    const id = typeof v === 'string' ? v : (v && v.id) || null;
    if (id) return id;
  }
  // 슬롯 -> 베이스 풀. 반지 두 칸(ring1/ring2)은 같은 'ring' 풀을 쓰므로 items.js 에 물어본다.
  const pools = typeof Items.basePoolsFor === 'function' ? (Items.basePoolsFor(slot) || [slot]) : [slot];
  const inPool = (b) => !!b && pools.includes(b.slot);

  const byId = typeof Items.baseById === 'function' ? Items.baseById : null;
  if (Array.isArray(pieces) && byId) {
    for (const p of pieces) {
      const b = byId(typeof p === 'string' ? p : p && p.id);
      if (inPool(b)) return b.id;
    }
  }
  // 3) 베이스 목록을 직접 훑는다
  const bases = Array.isArray(Items.ITEM_BASES) ? Items.ITEM_BASES : [];
  const hit = bases.find((b) => b && b.setId === setId && inPool(b));
  return hit ? hit.id : null;
}

/**
 * 보스를 잡았을 때 나오는 세트 아이템 1개.
 *   1~5웨이브 → 방어구 5칸 중 하나 / 6~8 → 장신구 3칸 / 9~10 → 무기·왼손
 * @param {string} dungeonId
 * @param {number} waveIndex 0-based
 * @param {RNG} [rng]
 * @returns {object|null} 아이템 (세트 데이터가 아직 없으면 null)
 */
export function dropForWave(dungeonId, waveIndex = 0, rng = null) {
  const d = getDungeon(dungeonId);
  if (!d) return null;
  const wi = normWaveIndex(waveIndex, d.waves);
  const r = rng || globalRng;

  /* ★ 드랍 확률.
   * 원래 설계는 **확정 드랍**이었다(SPEC §521 "보스를 잡을 때마다 세트 아이템 1개").
   * 그때는 10웨이브를 완주하면 조각 10개가 나와 풀세트가 평균 3개월이면 끝났다.
   * 세트 예산 버그를 고쳐 세트가 실제로 강해지자 이 속도가 과해져 확률제로 바꿨다.
   *
   * 실측 (완주 1회 = 1개월, 중앙값):
   *   100% → 3칸 1개월 / 5칸 1 / 7칸 1 / 10칸 3
   *    30% → 3칸 1개월 / 5칸 2 / 7칸 4 / 10칸 9   ← 채택
   *    20% → 3칸 2개월 / 5칸 3 / 7칸 5 / 10칸 14
   * 30% 를 고른 이유: 초반 보너스(3·5칸)는 여전히 빨리 닿아 매달 갈 이유가 남고,
   * 풀세트만 장기 목표로 남는다. */
  if (!r.chance(DROP_CHANCE)) return null;
  const slot = dropSlotForWave(wi, r);
  const ilvl = dropIlvl(wi);
  const ctx = {
    setId: d.setId, setName: d.setName, slot, ilvl, rarity: MYTHIC_RARITY,
    rng: r, dungeonId: d.id, waveIndex: wi, waveNo: wi + 1, archs: d.archs.slice(),
  };

  if (dropFactory) {
    try {
      const it = dropFactory(ctx);
      if (it) return tagSet(it, d, slot, ilvl);
    } catch (e) { console.warn('[dungeon] 주입된 드랍 팩토리 실패', e); }
  }

  const roll = pickFn(Gear, ['rollSetItem', 'rollSetPiece', 'rollMythicItem', 'createSetItem', 'makeSetItem']);
  if (roll) {
    try {
      const it = roll(ctx);
      if (it) return tagSet(it, d, slot, ilvl);
    } catch (e) { console.warn('[dungeon] 세트 롤러 실패', e); }
  }

  const baseId = setPieceBaseId(d.setId, slot);
  if (baseId && typeof Gear.rollItem === 'function') {
    try {
      const it = Gear.rollItem({ baseId, slot, ilvl, rarity: MYTHIC_RARITY, rng: r });
      if (it) return tagSet(it, d, slot, ilvl);
    } catch (e) { console.warn('[dungeon] rollItem(세트 베이스) 실패', e); }
  }

  warnOnce(`drop:${d.setId}`,
    `[dungeon] 세트 '${d.setId}'(${d.setName})의 ${slot} 조각을 만들 수 없다. `
    + 'data/items.js 에 세트 베이스가 있는지, gear.js 에 세트 롤러가 있는지 확인해라.');
  return null;
}

/** 만들어진 아이템에 세트 표식이 빠져 있으면 채워 준다 (덮어쓰지는 않는다) */
function tagSet(item, dungeon, slot, ilvl) {
  if (!item || typeof item !== 'object') return item;
  if (!item.setId) item.setId = dungeon.setId;
  if (!item.slot) item.slot = slot;
  if (item.ilvl == null) item.ilvl = ilvl;
  if (item.rarity == null) item.rarity = MYTHIC_RARITY;
  return item;
}

/* ------------------------------------------------------------------ 정산 */

const winnerOf = (res) => (res && (res.winner ?? (res.result && res.result.winner) ?? (res.win === true ? 'ally' : null))) || null;

function normalizeResults(result) {
  if (!result) return { list: [], squadId: null };
  if (Array.isArray(result)) return { list: result.filter(Boolean), squadId: null };
  if (Array.isArray(result.results)) return { list: result.results.filter(Boolean), squadId: result.squadId || null };
  if (Array.isArray(result.list)) return { list: result.list.filter(Boolean), squadId: result.squadId || null };
  return { list: [result], squadId: result.squadId || null };
}

/** 결과에서 uid -> 최종 HP 를 모은다 (뒤 결과 우선) */
function collectHp(list) {
  const hp = {};
  for (const res of list) {
    const src = (res && (res.finalHp || res.hpByUid)) || null;
    if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) hp[k] = v;
    const units = res && Array.isArray(res.units) ? res.units : null;
    if (units) for (const u of units) if (u && u.uid != null) hp[u.uid] = u.alive === false ? 0 : (u.hp != null ? u.hp : hp[u.uid]);
  }
  return hp;
}

/** 전투 후 HP 하한 (maxHp 대비) — quest.js 와 같은 값 */
const HP_FLOOR = 0.15;
/** 클리어했을 때 다운된 용병이 되살아나는 HP 비율 — quest.js DOWN_HP_WIN 과 같은 값 */
const DOWN_HP_WIN = 0.25;
/** 던전에서 패배했을 때 다운된 용병이 실제 부상까지 갈 확률 (S랭크 의뢰와 같은 값) */
const WOUND_CHANCE = 0.50;
/** 부상 기간 [최소, 최대] 일 */
const WOUND_DAYS = [2, 4];

/**
 * 용병 HP/부상 반영.
 *  - 런 도중(runOver=false): 결과 HP 를 **그대로** 적는다. 회복시키지 않는다 —
 *    웨이브 사이에 체력이 이어지는 것이 던전 난이도의 절반이다.
 *  - 런 종료(패배 또는 마지막 웨이브 클리어): 의뢰와 같은 규칙으로 마무리한다.
 */
function settleMembers(st, members, hpMap, { win, runOver, survivors = null, rng = globalRng }) {
  const wounded = [];
  const downed = [];
  let itemIdx = {};
  try { itemIdx = State.itemsById(st.items); } catch { itemIdx = {}; }
  for (const m of members) {
    // maxHp 는 매번 다시 잰다 — 장비를 바꿔 끼운 뒤라면 예전 값이 그대로 남아 있다.
    let maxHp = m.maxHp || 1;
    try {
      const stats = Merc.mercStats(m, { items: itemIdx });
      if (stats && Number.isFinite(stats.hp)) maxHp = Math.max(1, Math.round(stats.hp));
    } catch { /* 스탯 계산 실패 시 기존 값 유지 */ }
    m.maxHp = maxHp;

    // 다운 판정: HP 기록이 우선, 없으면 생존자 목록으로 본다 (quest.js 와 같은 규칙).
    // `simulate()` 는 finalHp 를 안 실어 줄 수 있으므로 이 폴백이 없으면 전멸해도 멀쩡해 보인다.
    const known = hpMap[m.uid];
    const down = known != null ? known <= 0 : (survivors ? !survivors.has(m.uid) : false);
    const floor = Math.max(1, Math.round(maxHp * HP_FLOOR));

    if (!runOver) {
      // 다운된 용병의 hp 를 0 으로 두면 안 된다 — allyUnitDefs 가 `m.hp || stats.hp` 로 읽어
      // **만피로 되살아난다**. 1 로 눕혀 두고, 다음 웨이브 편성은 UI 가 걷어낸다.
      m.status = 'ready';
      const cur = known != null ? known : (down ? 1 : (m.hp || maxHp));
      m.hp = clamp(Math.round(cur), 1, maxHp);
      if (down) downed.push({ uid: m.uid, name: m.name, hp: m.hp });
      continue;
    }

    if (down) {
      if (!win && rng.chance(WOUND_CHANCE)) {
        m.status = 'wounded';
        m.woundUntil = (st.day || 0) + rng.int(WOUND_DAYS[0], WOUND_DAYS[1]);
        m.hp = floor;
        wounded.push({ uid: m.uid, name: m.name, until: m.woundUntil });
      } else {
        m.status = 'ready';
        m.hp = clamp(Math.round(maxHp * (win ? DOWN_HP_WIN : HP_FLOOR)), floor, maxHp);
        downed.push({ uid: m.uid, name: m.name, hp: m.hp });
      }
    } else {
      m.status = 'ready';
      m.hp = clamp(Math.round(known != null ? known : (m.hp || maxHp)), floor, maxHp);
    }
  }
  return { wounded, downed };
}

/**
 * 던전 웨이브 결과를 상태에 반영한다.
 *  - 승리: 세트 아이템 1개 드랍 + 진행도(bestWave/clearedAt) 갱신
 *  - 패배: 진행도는 그대로. 다운된 용병만 확률 부상
 * 용병 HP/부상은 기본으로 여기서 처리한다. 전투 화면이 이미 정산했다면
 * `opts.settleMercs = false` 로 끄면 된다.
 *
 * @param {object} state
 * @param {string} dungeonId
 * @param {number} waveIndex 0-based
 * @param {object|Array} result createBattle 의 result (또는 결과 배열)
 * @param {{settleMercs?:boolean, squadId?:string, rng?:RNG}} [opts]
 * @returns {{ok:boolean, reason:string, win:boolean, wave:number, item:object|null,
 *            bestWave:number, cleared:boolean, first:boolean, runOver:boolean,
 *            wounded:Array, downed:Array, progress:object}}
 */
export function applyDungeonResult(state = State.state, dungeonId = null, waveIndex = 0, result = null, opts = {}) {
  const st = state || State.state;
  const d = getDungeon(dungeonId);
  const empty = {
    ok: false, reason: '', win: false, wave: 0, item: null, bestWave: 0,
    cleared: false, first: false, runOver: true, wounded: [], downed: [],
    progress: { bestWave: 0, clearedAt: null },
  };
  if (!d) return { ...empty, reason: '그런 던전은 없다.' };

  const wi = normWaveIndex(waveIndex, d.waves);
  const waveNo = wi + 1;
  const { list, squadId: resSquad } = normalizeResults(result);
  const win = list.length > 0 && list.every((r) => winnerOf(r) === 'ally');
  const runOver = !win || waveNo >= d.waves;

  // 전투 통계는 의뢰와 같은 카운터를 쓴다 (던전도 전투다)
  if (st && st.stats) {
    for (const res of list) {
      if (winnerOf(res) === 'ally') st.stats.battlesWon = (st.stats.battlesWon || 0) + 1;
      else st.stats.battlesLost = (st.stats.battlesLost || 0) + 1;
    }
  }

  // 참여 용병
  const squadId = opts.squadId || resSquad || null;
  const squad = squadId ? (st.squads || []).find((s) => s.id === squadId) : null;
  const hpMap = collectHp(list);
  let members = [];
  if (squad) {
    members = squad.memberUids.filter(Boolean)
      .map((u) => (st.roster || []).find((m) => m.uid === u)).filter(Boolean);
  } else {
    members = Object.keys(hpMap).map((u) => (st.roster || []).find((m) => m.uid === u)).filter(Boolean);
  }

  const lastRes = list[list.length - 1] || {};
  const survivors = Array.isArray(lastRes.survivors) ? new Set(lastRes.survivors) : null;

  let wounded = [];
  let downed = [];
  if (opts.settleMercs !== false && members.length) {
    const res = settleMembers(st, members, hpMap, { win, runOver, survivors, rng: opts.rng || globalRng });
    wounded = res.wounded;
    downed = res.downed;
  }

  // 진행도 + 드랍
  let item = null;
  let progress = dungeonProgress(st, d.id);
  const before = progress.bestWave;
  if (win) {
    progress = recordWave(st, d, waveNo);
    item = dropForWave(d.id, wi, opts.rng || null);
    if (item) {
      try { State.addItem(item); } catch (e) { console.warn('[dungeon] 드랍 지급 실패', e); }
    }
  }

  // 로그
  try {
    const label = `${d.name} ${waveNo}/${d.waves}웨이브`;
    if (win) {
      State.addLog(`[던전] ${label} 돌파! 층의 주인을 쓰러뜨렸다.`);
      if (item) State.addLog(`[던전] ${d.setName} 세트 획득: ${item.name || '이름 없는 유물'}`);
      if (waveNo >= d.waves && progress.clearedAt === (st.day || 0) && before < d.waves) {
        State.addLog(`[던전] ${d.name} — 끝까지 밀어냈다. ${d.setName} 세트의 주인이 바뀌었다.`);
      }
    } else {
      State.addLog(`[던전] ${label}에서 부대가 물러났다.`);
    }
    if (wounded.length) State.addLog(`부상자 발생: ${wounded.map((w) => `${w.name}(${w.until}일차 복귀)`).join(', ')}`);
  } catch (e) {
    console.warn('[dungeon] 로그 기록 실패', e);
  }

  return {
    ok: true,
    reason: '',
    win,
    wave: waveNo,
    item,
    bestWave: progress.bestWave,
    cleared: progress.clearedAt != null,
    first: win && waveNo > before,
    runOver,
    wounded,
    downed,
    progress,
  };
}

/** 진행도 기록 — state.js 가 열어 준 API 를 쓰고, 없으면 직접 쓴다 */
function recordWave(st, dungeon, waveNo) {
  try {
    if (typeof State.recordDungeonWave === 'function') {
      return State.recordDungeonWave(dungeon.id, waveNo, { total: dungeon.waves }, st);
    }
  } catch (e) { console.warn('[dungeon] 진행도 기록 실패', e); }
  if (!st.dungeons || typeof st.dungeons !== 'object' || Array.isArray(st.dungeons)) st.dungeons = {};
  const cur = dungeonProgress(st, dungeon.id);
  const next = {
    bestWave: Math.max(cur.bestWave, waveNo),
    clearedAt: cur.clearedAt,
  };
  if (next.clearedAt == null && next.bestWave >= dungeon.waves) next.clearedAt = st.day || 0;
  st.dungeons[dungeon.id] = next;
  return next;
}
