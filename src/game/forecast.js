/**
 * 의뢰 난이도 예보 — **실제로 돌려 보고** 정한다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 만들었나
 *   예전에는 카드의 색을 **전투력 비율 하나**로 정했다 (`ui/quests.js dangerLevelByPower`).
 *   그게 왜 안 되는지는 실측으로 확인했다 (docs/HANDOFF.md §24):
 *
 *     - 승률이 100% → 0% 로 뒤집히는 데 전투력비 **0.025** 밖에 안 걸린다.
 *       그런데 「적정」 밴드 하나가 **0.30** 이다 — 전이 폭의 12배다.
 *       한 색 안에 확실한 승리와 확실한 패배가 같이 사는 게 당연했다.
 *     - 더 나쁜 건 **위치**다. 실제 의뢰 10건에서 승률 50% 지점이
 *       전투력비 0.633~0.873 에 흩어졌다 (폭 0.240 = 전이 폭의 9.6배).
 *       경계를 어떻게 옮겨도 맞힐 수 없다는 뜻이다.
 *
 *   그래서 경계를 다시 잡는 대신 **자를 바꿨다.** 실제 전투를 몇 판 돌려
 *   이긴 비율로 색을 정한다. 전투 코드는 한 줄도 안 건드렸으므로
 *   기존 밸런스 곡선(WAVE_POWER · 탑 · 나락 · 세트)은 전부 그대로 유효하다.
 *
 * ★ 왜 "승률" 인가 — 실제 전투는 이미 결정론인데
 *   `questBattleDefs` 는 `hash(의뢰#웨이브#부대) ^ 세이브시드` 를 시드로 준다.
 *   즉 같은 부대로 같은 의뢰를 돌리면 **결과가 항상 같다.** 그러니 시드 하나만
 *   돌리면 승패를 100% 맞힐 수 있다 — 그런데 그건 정답을 알려 주는 것이지
 *   난이도를 알려 주는 게 아니다.
 *
 *   여기서 재는 건 **여유**다. 시드 여러 개로 돌려 7/7 이면 어떤 판이 와도 이기고,
 *   4/7 이면 칼날 위에 서 있다는 뜻이다. 장비를 하나 바꾸면 시드가 바뀌므로
 *   후자는 실제로 위험하다. 그래서 표시는 승률 숫자가 아니라 **기존 5단계 색**이다.
 *
 * ★ DOM 을 안 쓴다 — `tools/` 에서 그대로 import 해 계측한다.
 *
 * @module game/forecast
 */

import { createBattle } from '../battle/engine.js';
import { questBattleDefs, applyWaveCarry, readWaveCarry } from './quest.js';

/**
 * 기본 표본 수.
 *
 * ★ 5 로 정한 이유는 비용이다. 3웨이브 의뢰 한 건이 표본당 ~7ms 라
 *   7표본이면 도시 하나(최대 16건)에 560ms 가 든다. 5표본이면 400ms 다.
 *   전이 구간 자체가 워낙 좁아(전투력비 0.025) 표본을 늘려도 얻는 게 거의 없다 —
 *   실측에서 의뢰 대부분이 5/5 아니면 0/5 로 갈렸다.
 */
export const DEFAULT_SAMPLES = 5;

/**
 * 결과가 **갈릴 때만** 늘리는 표본 수.
 *
 * ★ 왜 필요한가: 실측(`tools/dangercheck.mjs`)에서 175건 중 1건이 참승률 6.7% 인데
 *   5판 중 2판을 이겨 「적정」으로 떴다. 5표본으로는 3.6% 확률로 이런 일이 난다.
 *
 * ★ 왜 처음부터 11판이 아닌가: 의뢰 대부분이 5/5 아니면 0/5 로 만장일치다
 *   (실측 175건 중 174건). 만장일치면 더 굴려도 답이 안 바뀌므로 거기서 멈추고,
 *   **갈린 판에만** 표본을 더 쓴다. 정밀도가 필요한 곳이 정확히 거기다.
 */
export const REFINE_SAMPLES = 11;

/** 첫 표본이 갈렸는가 — 갈렸으면 REFINE_SAMPLES 까지 더 돌려야 한다 */
export const isMixed = (wins, done) => wins > 0 && wins < done;

/**
 * 위험도 등급 (1 식은 죽 먹기 ~ 5 무모).
 *
 * ★ **승률만으로는 색이 두 개밖에 안 나온다.** 이 게임의 전투는 사실상 이진이라
 *   (§24) "확실히 이긴다" 아니면 "확실히 진다" 로 갈린다 — 실측에서 175건 중
 *   중간 색이 1건뿐이었다.
 *
 *   그래서 **값을 같이 본다.** 이기더라도 몇 명이 쓰러지느냐로 갈라 준다.
 *   권장 레벨 부대로 실측한 결과가 근거다 (HANDOFF §28):
 *
 *     F랭크  승률 100% · 무손실 100%          → 식은 죽 먹기
 *     E랭크  승률  77% · 1명 쓰러짐 35%        → 여유
 *     D랭크  승률  81% · 2~3명 쓰러짐 47%      → 적정
 *     A랭크  승률  66% · 4명 이상 40%          → 위험
 *     S랭크  승률   0%                         → 무모
 *
 *   즉 중간 색은 **손실 축에서** 나온다. 승패 축에는 원래 없었다.
 *
 * @param {number} winRate 0~1
 * @param {number} down    이겼을 때 쓰러지는 평균 인원
 */
export function dangerLevelOf(winRate, down = 0) {
  const wr = Number(winRate);
  if (!(wr >= 0)) return 0;
  if (wr < LOSS_LIKELY) return 5;               // 거의 진다
  if (wr < WIN_LIKELY) return 4;                // 반반 — 값이 얼마든 위험하다
  const d = Math.max(0, Number(down) || 0);
  if (d >= DOWN_HEAVY) return 4;                // 이겨도 절반이 쓰러진다
  if (d >= DOWN_SOME) return 3;
  if (d >= DOWN_LIGHT) return 2;
  return 1;                                     // 이기고 아무도 안 쓰러진다
}

/** 이 밑이면 「무모」 — 이길 가망이 거의 없다 */
export const LOSS_LIKELY = 0.15;
/** 이 위라야 «이긴다» 고 친다. 그 아래는 손실을 따질 것 없이 「위험」 */
export const WIN_LIKELY = 0.75;
/** 이겨도 이만큼 쓰러지면 「위험」 (7인 부대의 절반) */
export const DOWN_HEAVY = 3.5;
/** 「적정」 문턱 */
export const DOWN_SOME = 1.5;
/** 「여유」 문턱 — 이 밑이면 사실상 무손실 */
export const DOWN_LIGHT = 0.5;

/** 옛 이름 — 손실을 모를 때(도구·구버전 호출)는 승률만 본다 */
export function dangerLevelByWinRate(wr) {
  return dangerLevelOf(wr, 0);
}

/* ------------------------------------------------------------------ 시드 */

/**
 * 표본용 시드를 만든다.
 *
 * ★ `base + i * 상수` 같은 **산술수열을 쓰면 안 된다.** 실측에서 그렇게 뽑은 20판이
 *   거울전 승률을 80% 로 보고했다 — 잘 섞은 시드로는 50.0% 였다
 *   (`tools/dangercheck.mjs` 가 이 함정에 빠져 있었다). splitmix32 로 섞는다.
 *
 * i=0 은 **실제 전투가 쓸 시드 그대로**다. 예보에 진짜 판이 한 번은 들어간다.
 */
function sampleSeed(base, i) {
  if (i === 0) return base >>> 0;
  let z = (base + Math.imul(i, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return ((z ^ (z >>> 15)) >>> 0) || 1;
}

/* ---------------------------------------------------------------- 한 판 */

/**
 * 의뢰 하나를 **끝까지** 돌린다 (웨이브 인계 포함). 실제 경로와 같은 규칙을 쓴다.
 * @returns {boolean} 완주했는가
 */
function runOnce(st, quest, squadId, sampleIndex) {
  const waves = (quest && quest.waves) || [];
  if (!waves.length) return { win: false, alive: 0, total: 0, hp: 0 };
  let carry = null;
  let total = 0;

  for (let w = 0; w < waves.length; w++) {
    const cfg = questBattleDefs(quest, w, st, squadId);
    const allies = applyWaveCarry(cfg.allies, carry);
    if (w === 0) total = (cfg.allies || []).filter((u) => !u.pet).length;
    if (!allies.length) return { win: false, alive: 0, total, hp: 0 };

    const b = createBattle({
      ...cfg,
      allies,
      seed: sampleSeed(cfg.seed >>> 0, sampleIndex),
    });
    b.run();
    carry = readWaveCarry(b.units, carry || {});
    if (!b.finished || b.result.winner !== 'ally') return { win: false, ...tally(carry, total) };
  }
  return { win: true, ...tally(carry, total) };
}

/**
 * 인계 상태에서 "몇 명이 서 있고 체력이 얼마나 남았나" 를 센다.
 *
 * ★ `hp <= 0` 은 **쓰러진** 것이다. 이기면 부상 없이 낮은 체력으로 돌아오고,
 *   지면 그 사람만 부상 판정을 받는다 (`quest.js` — 부상은 실패했을 때만 난다).
 *   그래서 화면에 「쓰러짐」 이라고 써야 한다. 「부상」 은 사실이 아니다.
 */
function tally(carry, total) {
  const uids = Object.keys(carry || {});
  if (!uids.length) return { alive: 0, total, hp: 0 };
  let alive = 0;
  let cur = 0;
  let max = 0;
  for (const u of uids) {
    const c = carry[u];
    if (c.hp > 0) alive++;
    cur += Math.max(0, c.hp);
    max += c.maxHp || 0;
  }
  return { alive, total: total || uids.length, hp: max > 0 ? cur / max : 0 };
}

/**
 * 표본 **한 판만** 돌린다.
 *
 * ★ 화면(`ui/quests.js`)이 이걸 쓴다. 의뢰 한 건을 통째로 재면 3웨이브짜리가 ~20ms 라
 *   프레임을 넘긴다 — 목록을 열 때 화면이 걸린다. 한 판씩 나눠 돌리면
 *   판당 ~7ms 라 프레임 예산 안에 들어간다.
 *
 * @returns {{win:boolean, alive:number, total:number, hp:number}|null}
 */
export function forecastSample(st, quest, squadId, sampleIndex) {
  try {
    return runOnce(st, quest, squadId, sampleIndex);
  } catch (e) {
    return null;
  }
}

/**
 * 표본들을 모아 예보로 만든다. 화면과 `forecastQuest` 가 같이 쓴다 —
 * 두 곳이 다른 식으로 합치면 카드와 도구가 다른 말을 하게 된다.
 */
export function summarize(samples) {
  const list = (samples || []).filter(Boolean);
  if (!list.length) return { ok: false, level: 0, winRate: 0, wins: 0, samples: 0 };
  const wins = list.filter((r) => r.win).length;
  const winRate = wins / list.length;
  /* ★ 손실은 **이긴 판만** 평균낸다. 화면이 묻는 건 "이기면 몇 명 남나" 인데
   *   진 판을 섞으면 그 답이 안 된다. 이길 가망이 아예 없으면 전체로 센다. */
  const src = wins ? list.filter((r) => r.win) : list;
  const avg = (f) => src.reduce((a, r) => a + f(r), 0) / src.length;
  const total = src[0].total || 7;
  const alive = avg((r) => r.alive);
  return {
    ok: true,
    level: dangerLevelOf(winRate, Math.max(0, total - alive)),
    winRate,
    wins,
    samples: list.length,
    total,
    alive,
    down: Math.max(0, total - alive),
    hp: avg((r) => r.hp),
  };
}

/* ------------------------------------------------------------------ 예보 */

/**
 * 이 부대로 이 의뢰를 돌리면 어떻게 되나.
 *
 * ★ **전역 rng 를 건드리지 않는다.** 전투 경로(`questBattleDefs` → `createBattle`)는
 *   전부 자기 시드로만 돈다 — 확인했다. 그래서 예보를 몇 번을 돌려도
 *   실제 게임의 전리품·부상 판정이 밀리지 않는다. (`quest.js` 에서 전역 rng 를
 *   쓰는 건 `genQuests`·`questRewards`·`applyQuestResult` 뿐이고 여기선 안 부른다.)
 *
 * @param {object} st        State.state
 * @param {object} quest
 * @param {string} squadId
 * @param {{samples?:number}} [opt]
 * @returns {{ok:boolean, level:number, winRate:number, wins:number, samples:number}}
 */
export function forecastQuest(st, quest, squadId, opt = {}) {
  const base = Math.max(1, Math.round(opt.samples ?? DEFAULT_SAMPLES));
  const max = opt.refine === false ? base : Math.max(base, REFINE_SAMPLES);
  const out = [];
  try {
    while (out.length < base) out.push(runOnce(st, quest, squadId, out.length));
    // 갈렸으면 더 굴린다. 만장일치면 여기서 끝 — 대부분이 그렇다.
    if (isMixed(out.filter((r) => r.win).length, out.length)) {
      while (out.length < max) out.push(runOnce(st, quest, squadId, out.length));
    }
  } catch (e) {
    // 편성이 비었거나 의뢰 자료가 깨졌다 — 예보 없이 넘어간다. 카드는 그려야 한다.
    return { ok: false, level: 0, winRate: 0, wins: 0, samples: 0 };
  }
  return summarize(out);
}

/* ------------------------------------------------------------------ 캐시 키 */

/**
 * 부대 구성 지문. 이게 그대로면 예보도 그대로다.
 *
 * ★ 무엇이 결과를 바꾸는지 빠짐없이 넣어야 한다 — 하나라도 빠지면
 *   장비를 바꿨는데 색이 안 변하는 버그가 된다.
 *   인원·순서·레벨·등급·장비·펫·진형, 그리고 **부상 상태**(날짜에 따라 벤치된다).
 */
export function squadStamp(st, squadId) {
  const sq = (st?.squads || []).find((s) => s && s.id === squadId);
  if (!sq) return '';
  const roster = st.roster || [];
  const parts = [sq.formationId || 'basic', sq.petUid || '-'];
  for (const uid of sq.memberUids || []) {
    if (!uid) { parts.push('-'); continue; }
    const m = roster.find((x) => x.uid === uid);
    if (!m) { parts.push('-'); continue; }
    const eq = Object.keys(m.equipment || {}).sort()
      .map((k) => `${k}:${m.equipment[k]}`).join(',');
    // woundUntil 은 날짜와 비교돼야 의미가 있다 — 벤치 여부를 그대로 찍는다
    parts.push(`${m.uid}|${m.classId}|${m.level}|${m.grade}|${eq}|${(m.woundUntil || 0) > (st.day || 0) ? 'w' : 'o'}`);
  }
  return parts.join(';');
}
