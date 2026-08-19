/**
 * 진행도 해금 — 무엇을 언제 보여줄 것인가
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 신규 플레이어가 처음 보는 도시 화면은 **글자 2,217자 · 버튼 30개**였다(실측).
 * 전투를 한 번도 안 해 본 사람에게 던전·무한의 탑·평판·명물 클래스가 먼저 보이고,
 * 정작 "지금 뭘 해야 하는지"는 어디에도 없었다 — "화면이 눈에 안 들어온다"는
 * 지적의 실체가 이것이다.
 *
 * 그래서 고급 요소를 진행도에 따라 하나씩 연다. 규칙은 **여기에만** 둔다 —
 * 화면마다 조건을 흩어 놓으면 "어떤 건 열렸는데 어떤 건 안 열린" 상태가 생긴다.
 *
 * ★ 해금은 **가리기일 뿐 잠그는 게 아니다.** 조건을 안 채워도 그 기능 자체는 살아 있고
 *   (세이브를 불러오면 그대로 쓸 수 있다), 화면에 안내를 안 띄울 뿐이다.
 *   이미 진행한 세이브가 갑자기 기능을 잃으면 안 되기 때문에, 판정은 전부
 *   "이미 해 봤으면 무조건 열린다"를 먼저 본다.
 *
 * @module game/progress
 */

import { state as globalState } from './state.js';

/** 해금 키 — 화면들이 이 이름으로 물어본다 */
export const FEATURES = {
  WORLDMAP: 'worldmap',     // 다른 도시로 이동
  SQUADS: 'squads',         // 부대 추가 · 진형
  DUNGEON: 'dungeon',       // 던전
  TOWER: 'tower',           // 무한의 탑
  PETS: 'pets',             // 펫
  REPUTATION: 'reputation', // 도시 평판 · 명물 클래스
};

/** 로스터 최고 레벨 */
function topLevel(st) {
  let n = 1;
  for (const m of st.roster || []) if (m && (m.level || 1) > n) n = m.level;
  return n;
}

/**
 * 해금 규칙.
 * 각 항목은 `{ label, hint, done(st) }` — `done` 이 참이면 열린다.
 * `hint` 는 아직 안 열렸을 때 "무엇을 하면 열리는지" 한 줄로 알려 주는 문구다.
 */
const RULES = {
  [FEATURES.REPUTATION]: {
    label: '도시 평판',
    hint: '의뢰를 1건 마치면 이 도시가 우리를 알아보기 시작한다.',
    done: (st) => (st.stats?.questsDone || 0) >= 1,
  },
  [FEATURES.WORLDMAP]: {
    label: '월드맵 이동',
    hint: '의뢰를 3건 마치면 다른 도시로 떠날 수 있다.',
    done: (st) => (st.stats?.questsDone || 0) >= 3 || (st.cityId && st.cityId !== 'greenhold'),
  },
  [FEATURES.SQUADS]: {
    label: '부대 · 진형',
    hint: '단원이 8명이 되면 두 번째 부대를 꾸릴 수 있다.',
    done: (st) => (st.roster || []).length >= 8 || (st.squads || []).length >= 2
      || (st.formations || []).length > 1,
  },
  [FEATURES.DUNGEON]: {
    label: '던전',
    hint: '단원이 20레벨을 넘기면 던전 문이 보이기 시작한다.',
    done: (st) => topLevel(st) >= 20 || Object.keys(st.dungeons || {}).length > 0,
  },
  [FEATURES.TOWER]: {
    label: '무한의 탑',
    hint: '단원이 50레벨을 넘기면 탑이 열린다.',
    done: (st) => topLevel(st) >= 50 || (st.tower?.best || 0) > 0,
  },
  [FEATURES.PETS]: {
    label: '펫',
    hint: '무한의 탑에서 펫을 얻으면 배치할 수 있다.',
    done: (st) => (st.pets || []).length > 0,
  },
};

/**
 * 이 기능이 열렸는가.
 * @param {string} feature FEATURES 의 값
 * @param {object} [st]
 */
export function unlocked(feature, st = globalState) {
  const r = RULES[feature];
  if (!r) return true;                       // 모르는 키는 막지 않는다
  try { return !!r.done(st); } catch (e) { return true; }
}

/** 아직 안 열린 기능의 안내 문구 (열렸으면 빈 문자열) */
export function lockHint(feature, st = globalState) {
  if (unlocked(feature, st)) return '';
  return (RULES[feature] && RULES[feature].hint) || '';
}

/** 지금 열려 있는 기능 목록 (튜토리얼·디버그용) */
export function unlockedList(st = globalState) {
  return Object.keys(RULES).filter((k) => unlocked(k, st));
}

/* ─────────────────────────── 다음 할 일 ───────────────────────────
 * "지금 뭘 해야 하지" 에 **한 가지만** 답한다. 여러 개를 나열하면 처음 화면과 같은 문제가 된다.
 * 위에서부터 조건이 맞는 첫 항목이 답이다 — 순서가 곧 우선순위다. */

/**
 * @typedef {object} NextStep
 * @property {string} title 한 줄 지시
 * @property {string} why   왜 그걸 해야 하는지
 * @property {string} [go]  누르면 갈 화면 id
 * @property {string} [cta] 버튼 문구
 */

/**
 * 지금 해야 할 일 하나.
 * @param {object} [st]
 * @returns {NextStep|null} 딱히 안내할 게 없으면 null
 */
export function nextStep(st = globalState) {
  const roster = st.roster || [];
  const squads = st.squads || [];
  const done = st.stats?.questsDone || 0;
  const filled = squads.reduce((a, s) => a + (s.memberUids || []).filter(Boolean).length, 0);
  const wounded = roster.filter((m) => m && m.status === 'wounded').length;
  const idle = squads.filter((s) => s && s.status !== 'away').length;

  if (!roster.length) {
    return { title: '주점에서 용병을 고용해라', why: '싸울 사람이 없다.', go: 'tavern', cta: '주점으로' };
  }
  if (!filled) {
    return {
      title: '용병단 화면에서 부대에 단원을 배치해라',
      why: '배치되지 않은 단원은 의뢰에 따라가지 않는다.',
      go: 'company', cta: '편성하러 가기',
    };
  }
  if (idle === 0) {
    return {
      title: '날짜를 넘겨 부대를 복귀시켜라',
      why: '나간 부대가 돌아와야 다음 의뢰를 받을 수 있다.',
    };
  }
  if (wounded >= filled) {
    return {
      title: '여관에서 쉬어라',
      why: '출전할 수 있는 단원이 없다. 부상은 날짜가 지나야 낫는다.',
    };
  }
  if (done < 3) {
    return {
      title: '의뢰소에서 의뢰를 받아라',
      why: done === 0 ? '첫 계약이다. 낮은 등급부터 골라라.' : `${done}건 마쳤다. 3건을 채우면 다른 도시로 떠날 수 있다.`,
      go: 'quests', cta: '의뢰소로',
    };
  }
  if (roster.length >= 8 && squads.length < 2) {
    return {
      title: '두 번째 부대를 꾸려라',
      why: '부대가 둘이면 같은 날 의뢰를 두 건 돌릴 수 있다.',
      go: 'company', cta: '용병단으로',
    };
  }
  return null;
}
