/**
 * 랭킹 제출 검증 규칙 — **클라이언트와 서버가 같이 쓴다**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 이 파일이 존재하는 이유
 *   랭킹을 서버에서 검증하려면 "이 값이 게임 규칙상 가능한가"를 판단해야 하는데,
 *   그 판단은 전부 게임 상수에서 나온다(`goldRange`, `TOWER_FLOORS`, `MAX_LEVEL`…).
 *   규칙을 SQL 로 옮겨 적으면 **손으로 베낀 두 번째 사본**이 생기고, 밸런스를 고치는 날
 *   정상 플레이어가 전원 거절당한다. 그래서 규칙은 여기 한 벌만 두고
 *   node(도구) · Deno(Edge Function) · 브라우저가 **같은 파일**을 읽는다.
 *
 * ★ 그래서 이 파일은 순수해야 한다 — DOM 도, 네트워크도, 전역 상태도 안 쓴다.
 *   입력은 인자로만 받는다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 무엇을 막고 무엇을 못 막는가 (정직하게)
 *
 *   막는다:   게임 규칙상 **불가능한** 값.
 *             나락은 주 1회, 탑은 월 1회로 코드가 강제하므로 서버는
 *             "지난주 40심층이던 사람이 이번 주 200심층" 이 거짓임을 **확실히** 안다.
 *   못 막는다: 전투 승패 조작, 아이템 스탯 위조, 규칙 경계 안에서 천천히 부풀리기.
 *
 *   **"조작 방지"가 아니라 "개연성 검사"다.** 그렇게 광고하면 안 된다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 등급
 *   A  물리적으로 불가능 — 오탐이 원리상 0이다. 즉시 거절한다.
 *   B  총량 상한 초과 — 오탐이 **가능하다**. 거절하되 원본을 남겨 사람이 본다.
 *   C  통계적으로 이상 — 표시만 하고 게임은 그대로 둔다.
 *
 *   오탐으로 정상 플레이어를 날리는 게 치트보다 큰 사고다. 그래서 상한은 전부
 *   **넉넉하게** 잡는다 — 아슬아슬하게 잡으면 언젠가 반드시 정상 플레이어가 걸린다.
 *
 * @module game/rules
 */

/* ★ 여기서 import 하는 것은 **전부 의존성 0 모듈**이어야 한다.
 *   이 파일은 Supabase Edge Function(Deno)에서도 그대로 돌아야 하는데,
 *   game/state.js(import 14개)나 game/merc.js(6개)를 물면 게임 전체가 서버로 딸려 간다.
 *   그래서 상수를 `data/limits.js` 로 빼고 원래 자리에서는 다시 내보내게 했다.
 *   **여기에 새 import 를 추가할 때는 그 모듈의 import 도 0인지 확인해라.**
 *   (tools/syncshared.mjs 가 이 조건을 검사한다) */
import { DEPTH_CAP, goldRange, weekIndex } from '../data/abyss.js';
import { TOWER_FLOORS } from '../data/tower.js';
import { MAX_LEVEL, DAYS_PER_WEEK, DAYS_PER_MONTH, MAX_SQUADS, ROSTER_CAP_MAX } from '../data/limits.js';

/** 랭킹에 올라가는 값만 뽑아낸다. 세이브 전체를 서버에 판단시키지 않는다. */
export function extractScore(st) {
  if (!st || typeof st !== 'object') return null;
  const roster = Array.isArray(st.roster) ? st.roster : [];
  let topLevel = 1;
  for (const m of roster) if (m && (m.level || 1) > topLevel) topLevel = m.level;

  return {
    seed: Number(st.seed) || 0,
    /* ★ `slice` 는 UTF-16 단위로 자른다 — 이모지가 든 이름이 24번째에서 걸리면
     *   서러게이트 쌍이 반으로 쪼개져 깨진 글자가 서버에 저장된다.
     *   코드포인트 단위로 세야 한다. */
    companyName: Array.from(String(st.companyName || '용병단')).slice(0, 24).join(''),
    day: Number(st.day) || 1,
    abyssBest: Number(st.abyss?.best) || 0,
    abyssBestDay: Number(st.abyss?.bestDay) || 0,
    abyssLastRunDay: Number(st.abyss?.lastRunDay) || 0,
    towerBest: Number(st.tower?.best) || 0,
    towerBestDay: Number(st.tower?.bestDay) || 0,
    towerLastRunDay: Number(st.tower?.lastRunDay) || 0,
    questsDone: Number(st.stats?.questsDone) || 0,
    battlesWon: Number(st.stats?.battlesWon) || 0,
    battlesLost: Number(st.stats?.battlesLost) || 0,
    gold: Number(st.gold) || 0,
    renown: Number(st.renown) || 0,
    cityId: typeof st.cityId === 'string' ? st.cityId : null,
    rosterN: roster.length,
    rosterCap: Number(st.rosterCap) || 20,
    topLevel,
    squadsN: Array.isArray(st.squads) ? st.squads.length : 0,
    petsN: Array.isArray(st.pets) ? st.pets.length : 0,
    itemsN: Array.isArray(st.items) ? st.items.length : 0,
  };
}

/* ─────────────────────────── A등급: 불가능 ───────────────────────────
 * 여기 걸리는 값은 **어떤 플레이로도 나올 수 없다.** 오탐이 원리상 0이라
 * 사람 확인 없이 바로 거절한다. */

/** 값 자체가 범위를 벗어났는가 */
export function checkStatic(s) {
  const bad = [];
  if (!s) return ['점수를 읽지 못했다'];
  if (s.day < 1) bad.push(`day=${s.day}`);
  if (s.abyssBest < 0 || s.abyssBest > DEPTH_CAP) bad.push(`나락 ${s.abyssBest} (상한 ${DEPTH_CAP})`);
  if (s.towerBest < 0 || s.towerBest > TOWER_FLOORS) bad.push(`탑 ${s.towerBest} (상한 ${TOWER_FLOORS})`);
  if (s.topLevel < 1 || s.topLevel > MAX_LEVEL) bad.push(`최고레벨 ${s.topLevel} (상한 ${MAX_LEVEL})`);
  if (s.questsDone < 0) bad.push(`의뢰 ${s.questsDone}`);
  if (s.squadsN < 0 || s.squadsN > MAX_SQUADS) bad.push(`부대 ${s.squadsN}`);
  if (s.rosterN < 0 || s.rosterN > ROSTER_CAP_MAX) bad.push(`단원 ${s.rosterN}`);
  if (s.gold < 0) bad.push(`골드 ${s.gold}`);

  // 기록을 세운 날이 현재 일차를 넘을 수 없다
  if (s.abyssBest > 0 && s.abyssBestDay > s.day) bad.push(`나락 기록일 ${s.abyssBestDay} > 현재 ${s.day}`);
  if (s.towerBest > 0 && s.towerBestDay > s.day) bad.push(`탑 기록일 ${s.towerBestDay} > 현재 ${s.day}`);
  // 이긴 판보다 끝낸 의뢰가 많을 수 없다 (의뢰 하나에 최소 한 판)
  if (s.battlesWon < s.questsDone) bad.push(`승리 ${s.battlesWon} < 의뢰 ${s.questsDone}`);
  return bad;
}

/**
 * 입장 제한이 지켜졌는가.
 * ★ 이게 이 검증의 **가장 강한 무기**다. 나락은 주 1회, 탑은 월 1일에만 열린다 —
 *   게임이 코드로 강제하므로 서버는 "얼마나 자주 기록이 오를 수 있는가"를 정확히 안다.
 */
export function checkCadence(prev, s) {
  const bad = [];
  if (!prev || !s) return bad;                // 첫 제출은 비교 대상이 없다

  if (s.day < prev.day) { bad.push(`일차가 뒤로 갔다 ${prev.day} → ${s.day}`); return bad; }

  /* ★ 날짜 차이가 아니라 **입장 기록**으로 판단한다.
   *
   *   처음에는 "지난 제출 이후 며칠 지났나"로 셌는데, 그러면 같은 날 제출 두 번에
   *   기록이 40 → 200 으로 뛰어도 통과했다(계측기가 잡았다).
   *   반대로 날짜만 조이면 오탐이 난다 — 같은 날 두 번 제출하는 것 자체는 정상이고,
   *   그 사이에 진짜로 잠수를 한 번 했을 수도 있다.
   *
   *   정확한 규칙은 이것이다: **기록은 잠수(등반) 중에만 오른다.**
   *   그리고 잠수는 주 1회, 등반은 월 1회로 게임이 코드로 강제한다.
   *   그러니 기록이 올랐다면 `lastRunDay` 가 **새 주(달)**로 넘어가 있어야 한다.
   *   이건 날짜 산술이 아니라 게임 규칙 그대로라 오탐이 원리상 없다. */

  const abyssWeek = (d) => (d > 0 ? weekIndex(d) : -1);
  if (s.abyssBest > prev.abyssBest) {
    if (abyssWeek(s.abyssLastRunDay) <= abyssWeek(prev.abyssLastRunDay)) {
      bad.push(`나락 기록이 올랐는데 새로 잠수한 주가 없다 `
        + `(지난 잠수 ${prev.abyssLastRunDay}일 · 이번 ${s.abyssLastRunDay}일 · 주 1회)`);
    }
    if (s.abyssBestDay > 0 && s.abyssLastRunDay > 0 && s.abyssBestDay > s.abyssLastRunDay) {
      bad.push(`나락 기록일(${s.abyssBestDay})이 마지막 잠수일(${s.abyssLastRunDay})보다 뒤다`);
    }
  }

  const towerMonth = (d) => (d > 0 ? Math.floor((d - 1) / DAYS_PER_MONTH) : -1);
  if (s.towerBest > prev.towerBest) {
    if (towerMonth(s.towerLastRunDay) <= towerMonth(prev.towerLastRunDay)) {
      bad.push(`탑 기록이 올랐는데 새로 등반한 달이 없다 `
        + `(지난 등반 ${prev.towerLastRunDay}일 · 이번 ${s.towerLastRunDay}일 · 월 1회)`);
    }
    if (s.towerBestDay > 0 && s.towerLastRunDay > 0 && s.towerBestDay > s.towerLastRunDay) {
      bad.push(`탑 기록일(${s.towerBestDay})이 마지막 등반일(${s.towerLastRunDay})보다 뒤다`);
    }
  }

  // 단조성 — 이 셋은 절대 줄지 않는다
  if (s.abyssBest < prev.abyssBest) bad.push(`나락 기록이 줄었다 ${prev.abyssBest} → ${s.abyssBest}`);
  if (s.towerBest < prev.towerBest) bad.push(`탑 기록이 줄었다 ${prev.towerBest} → ${s.towerBest}`);
  if (s.questsDone < prev.questsDone) bad.push(`의뢰 수가 줄었다 ${prev.questsDone} → ${s.questsDone}`);
  return bad;
}

/* ─────────────────────────── B등급: 총량 상한 ───────────────────────────
 * 여기는 **오탐이 가능하다.** 그래서 상한을 넉넉히 잡고, 걸려도 게임은 그대로 두고
 * 랭킹에서만 숨긴다(제작자 결정). 원본을 남겨 사람이 확인할 수 있게 한다. */

/** 하루에 부대 하나가 끝낼 수 있는 의뢰 수의 넉넉한 상한 */
export const MAX_QUESTS_PER_DAY = 5;

/**
 * 증가폭이 게임 규칙으로 설명되는가.
 * @param {object} prev 지난번에 받아들인 값
 * @param {object} s    이번 값
 */
export function checkGrowth(prev, s) {
  const bad = [];
  if (!prev || !s) return bad;
  const dDay = Math.max(0, s.day - prev.day);

  // 의뢰: 부대 5개 × 하루 5건이 물리적 상한이다. 그 두 배까지 봐준다.
  const dQuests = s.questsDone - prev.questsDone;
  const questCap = (dDay + 1) * MAX_QUESTS_PER_DAY * 5 * 2;
  if (dQuests > questCap) bad.push(`의뢰 ${dQuests}건 증가 (${dDay}일 · 상한 ${questCap})`);

  /* 골드: 의뢰 + 나락 + 던전. 나락은 도달 심층으로 상한이 정확히 계산된다.
   * 의뢰 쪽은 후하게 잡는다 — 정예 S랭크 보상이 얼마까지 나오는지는
   * 밸런스에 따라 움직이므로 여기를 조이면 패치 때마다 오탐이 난다. */
  const dGold = s.gold - prev.gold;
  if (dGold > 0) {
    const weeks = Math.floor(dDay / DAYS_PER_WEEK) + 1;
    const abyssCap = goldRange(Math.min(DEPTH_CAP, s.abyssBest)) * weeks;
    const questCapGold = Math.max(0, dQuests) * 120_000;
    const cap = abyssCap + questCapGold + (dDay + 1) * 50_000;
    if (dGold > cap) bad.push(`골드 ${dGold.toLocaleString()} 증가 (상한 ${cap.toLocaleString()})`);
  }

  // 명성: 의뢰 하나당 넉넉히 잡아도 이 이상은 안 나온다
  const dRenown = s.renown - prev.renown;
  if (dRenown > Math.max(0, dQuests) * 60 + 100) {
    bad.push(`명성 ${dRenown} 증가 (의뢰 ${dQuests}건)`);
  }
  return bad;
}

/* ─────────────────────────── 종합 ─────────────────────────── */

/**
 * 제출을 판정한다.
 * @param {object|null} prev 지난번에 받아들인 값 (없으면 첫 제출)
 * @param {object} s         이번 값 (`extractScore` 결과)
 * @returns {{verdict:'ok'|'reject'|'flag', tier:string, reasons:string[]}}
 */
export function judge(prev, s) {
  // ★ extractScore 는 못 읽으면 null 을 준다. 여기서 안 막으면 checkCadence 가 터진다.
  if (!s) return { verdict: 'reject', tier: 'A', reasons: ['점수를 읽지 못했다'] };
  const a = [...checkStatic(s), ...checkCadence(prev, s)];
  if (a.length) return { verdict: 'reject', tier: 'A', reasons: a };

  const b = checkGrowth(prev, s);
  // ★ B 는 거절이 아니라 **표시**다 (제작자 결정: 랭킹에서만 숨긴다).
  //   게임은 그대로 즐기게 두고, 오탐이면 나중에 사람이 되돌린다.
  if (b.length) return { verdict: 'flag', tier: 'B', reasons: b };

  return { verdict: 'ok', tier: '', reasons: [] };
}

/** 같은 플레이스루인가 (seed 가 다르면 새 판이라 비교 자체가 무의미하다) */
export function sameRun(prev, s) {
  return !!prev && !!s && prev.seed === s.seed;
}

export { weekIndex, DAYS_PER_WEEK, DAYS_PER_MONTH };
