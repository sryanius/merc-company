// 의뢰소 — 도시의 의뢰 목록을 훑고, 출전할 부대를 골라 전투로 넘긴다.
import { el, num, clamp } from '../core/util.js';
import { GRADE_COLOR, RARITY_COLOR, RARITY_NAME } from '../art/palette.js';
import { getCity } from '../data/world.js';
import { getEnemy } from '../data/enemies.js';
import { getFormation, formationSummary } from '../data/formations.js';
import { getClass } from '../data/classes.js';
import { state, refreshCity } from '../game/state.js';
import { canDeploy, squadAvgLevel, squadMembers, squadPower } from '../game/squad.js';
// 난이도 판정을 "아군 전투력 vs 적 전투력" 으로 재려면 개인 전투력이 필요하다.
import { mercPower } from '../game/merc.js';
// 파견 헬퍼(dispatchSquad/isSquadAway/...)는 나중에 붙는 함수라 이름 import 하면
// 없을 때 모듈 전체가 죽는다. 네임스페이스로 받아 존재할 때만 호출한다.
import * as Squad from '../game/squad.js';
import * as GameState from '../game/state.js';
// 서브랭크(quest.sub/rankLabel)·정예(quest.elite) API 는 1단계에서 붙은 함수라,
// 이름 import 하면 없는 빌드에서 모듈 전체가 죽는다. 네임스페이스로 받아 방어적으로 쓴다.
import * as Quest from '../game/quest.js';
import { isWounded } from '../game/merc.js';
import { josa } from '../game/gear.js';
import { go, toast } from './app.js';

export const meta = { id: 'quests', title: '의뢰소' };

const BIOME_NAME = {
  plains: '평야', forest: '숲', mountain: '산악', desert: '사막',
  swamp: '늪지', coast: '해안', tundra: '설원', cave: '동굴',
};
const TYPE_COLOR = { 토벌: '#cf8a5a', 호위: '#5b95d6', 탐색: '#6fae7a', 섬멸: '#cf5a5a', 수호: '#a86fd6' };

/* ── 목록 정렬 ──
 * 게임 진행 상태가 아니라 화면 취향이므로 세이브가 아니라 localStorage 에 남긴다.
 * 새 게임을 시작해도, 세이브를 갈아끼워도 설정이 유지된다. */
const SORT_KEY = 'merc_quest_sort';
/** 정렬 기준 — 각 항목이 "값이 클수록 상위" 가 되도록 점수를 뽑는다 */
const SORT_MODES = [
  ['rank', '난이도', (q) => rankScore(q)],
  ['level', '권장 레벨', (q) => q.level || 0],
  ['reward', '보상 골드', (q) => (q.reward && q.reward.gold) || 0],
  ['days', '소요 일수', (q) => q.days || 0],
];
/** 랭크(F~S) + 서브랭크(-/기본/+) 를 하나의 연속 점수로. 정예는 반 단계 위로 본다. */
function rankScore(q) {
  const ranks = Array.isArray(Quest.RANKS) ? Quest.RANKS : ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
  const base = Math.max(0, ranks.indexOf(q.rank));
  const sub = Number(q.sub) || 0;                 // -1 | 0 | 1
  return base * 3 + sub + (isElite(q) ? 1.5 : 0);
}
/** 저장된 정렬 설정 읽기 (없거나 깨졌으면 난이도 높은순) */
function loadSort() {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
    const mode = SORT_MODES.some(([k]) => k === raw?.mode) ? raw.mode : 'rank';
    return { mode, desc: raw?.desc !== false };
  } catch { return { mode: 'rank', desc: true }; }
}
function saveSort(s) {
  try { localStorage.setItem(SORT_KEY, JSON.stringify(s)); } catch { /* 저장 실패는 무시 */ }
}
/** 현재 정렬 설정 (모듈 수준 캐시 — 화면을 다시 그려도 유지) */
let sortPref = loadSort();

/** 화면을 다시 그려도 선택이 유지되도록 모듈 수준에 둔다 */
let selectedQuestId = null;
let selectedSquadId = null;
let lastCityId = null;

/* ── 모바일 상태 ──
 * 좁은 화면에서는 의뢰 카드를 접어 핵심만 보여주고(펼친 카드 id 집합),
 * 출전 패널은 하단 고정 바 위로 올라오는 시트로 띄운다. 둘 다 화면 취향이라 세이브하지 않는다. */
const expandedQuests = new Set();
let sheetOpen = false;

/**
 * 폰 폭인가. 레이아웃은 전부 CSS 미디어쿼리로 하고, JS 는 "탭하면 펼친다" 같은 동작에만 쓴다.
 * 기준선 767px 은 `css/style.css` 의 공용 모바일 기준과 같은 값이어야 한다.
 */
function isNarrow() {
  try { return !!(window.matchMedia && window.matchMedia('(max-width: 767px)').matches); } catch (e) { return false; }
}

export function dispose() {
  /* 타이머·rAF 없음. 화면을 떠나면 모바일 시트는 닫힌 상태로 되돌린다. */
  sheetOpen = false;
}

/* ─────────────────────────── 스타일 ─────────────────────────── */

function injectStyle() {
  if (document.getElementById('quests-style')) return;
  document.head.appendChild(el('style', {
    id: 'quests-style',
    text: `
/* 정렬 바 셀렉트 — 다른 화면의 입력 요소와 같은 톤으로 맞춘다 */
.qs-sortsel{background:var(--bg-3);border:1px solid var(--line);border-radius:5px;
  padding:4px 8px;font-size:12px;color:var(--ink)}
/* 출정 버튼 — 색이 그 부대의 위험도를 나타낸다 (카드 상단 라벨과 같은 체계) */
.qs-send-btn.on{font-weight:700}
.qs-send-btn.on:hover:not(:disabled){filter:brightness(1.25)}
.qs-send-risk{font-style:normal;font-size:10px;font-weight:700;opacity:.85;margin-left:6px;
  padding-left:6px;border-left:1px solid currentColor}
.qs-wrap{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:12px;align-items:start}
@media (max-width:1080px){.qs-wrap{grid-template-columns:minmax(0,1fr)}}
/* 출전 패널.
 * sticky 만 걸면 패널 내용이 화면보다 길 때 아래쪽(출정 버튼)이 화면 밖에 **고정된 채**
 * 갇힌다 — 스크롤해도 패널이 계속 붙어 있어서 올라오지 않고, 의뢰 목록을 끝까지
 * 내려야 겨우 보인다(실제 플레이어가 겪은 문제). 부대가 4개쯤 되면 바로 재현된다.
 * 그래서 높이를 화면에 맞춰 자르고 패널 자체가 스크롤되게 한다.
 * overscroll-behavior 로 패널 끝에서 페이지가 따라 스크롤되는 것도 막는다. */
.qs-side{position:sticky;top:64px;max-height:calc(100vh - 76px);overflow-y:auto;
  overscroll-behavior:contain;padding-right:2px;margin-top:12px}
.qs-card{display:flex;flex-direction:column;gap:7px}
/* 접히는 영역. 카드와 같은 gap 을 물려받아 PC 에서는 예전과 똑같이 보인다. */
.qs-fold{display:flex;flex-direction:column;gap:7px}
.qs-rank{width:30px;height:30px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  border:1px solid currentColor;border-radius:6px;font-weight:900;font-family:var(--mono);font-size:16px}
.qs-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--ink-dim)}
.qs-meta b{color:var(--ink);font-weight:600}
.qs-wave{font-size:11px;color:var(--ink-dim);padding:1px 0}
.qs-wave i{color:var(--ink-faint);font-style:normal;margin-right:5px}
.qs-rew{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;border-top:1px solid var(--line-soft);padding-top:7px}
.qs-sq{display:flex;flex-direction:column;gap:4px;padding:9px;margin-bottom:8px}
.qs-boss{color:#e0913a;font-weight:700}
.qs-note{display:flex;gap:7px;align-items:flex-start;padding:6px 9px;border-radius:4px;font-size:11px;
  border-left:3px solid var(--gold-dim);background:rgba(224,180,74,.08);color:var(--ink-dim);margin:2px 0 8px}
.qs-note b{color:var(--ink)}
.qs-note.bad{border-left-color:var(--bad);background:rgba(207,90,90,.10);color:#e8b7b7}
.qs-note.bad b{color:#f0c8c8}

/* 소요 일수 — 이제 이게 핵심 선택 요소다 (짧은 의뢰 여러 개 vs 긴 고랭크 하나) */
.qs-days{display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-width:52px;padding:2px 6px 3px;border:1px solid var(--gold-dim);border-radius:6px;
  background:rgba(224,180,74,.09);line-height:1.05;flex:0 0 auto}
.qs-days b{font-size:23px;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums}
.qs-days span{font-size:9px;color:var(--ink-faint);letter-spacing:.14em}

/* 의뢰 카드에서 바로 부대를 골라 보낸다 */
.qs-send{display:flex;gap:6px;align-items:center;flex-wrap:wrap;
  border-top:1px solid var(--line-soft);padding-top:7px}
.qs-send .btn{flex:0 0 auto}

/* 원정 중인 부대 */
.qs-sq.away{opacity:.55;cursor:not-allowed}
.qs-sq.away:hover{transform:none;border-color:var(--line)}
.qs-away{color:var(--ember);font-weight:700}
.qs-idle{color:var(--ok);font-weight:700}
.qs-sqbar{width:100%;margin-top:2px}
.qs-sqbar > i{background:linear-gradient(90deg,#7a4a22,var(--ember))}

/* 서브랭크 배지 강약 — '-'(입문)는 흐리게, '+'(고난도)는 진하게 한눈에 보이도록 */
.qs-rank.two{font-size:13px;letter-spacing:-.03em}
.qs-rank.rk-minus{opacity:.62;border-style:dashed}
.qs-rank.rk-plus{border-width:2px;font-weight:900;
  box-shadow:0 0 8px -2px currentColor, inset 0 0 0 1px currentColor}

/* 정예 의뢰 — 붉은 강조 */
.qs-card.elite{border-color:var(--bad);
  box-shadow:0 0 0 1px rgba(207,90,90,.45), 0 0 18px -7px rgba(207,90,90,.7)}
.qs-card.elite.selected{box-shadow:0 0 0 1px var(--bad), 0 0 18px -5px rgba(207,90,90,.8)}
.qs-elite-badge{display:inline-flex;align-items:center;gap:2px;padding:1px 8px;border-radius:999px;
  font-size:11px;font-weight:900;letter-spacing:.03em;background:var(--bad);color:#1a0f13;white-space:nowrap}
.qs-champ{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;font-weight:700;
  color:#f0b4b4;background:rgba(207,90,90,.16);border:1px solid rgba(207,90,90,.5)}
.qs-note.elite{border-left-color:var(--bad);background:rgba(207,90,90,.11);color:#f0c8c8}
.qs-note.elite b{color:#f6d2d2}

/* 예상 난이도 — 실패를 예측할 수 있게 색으로 보여준다 */
.qs-assess{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:center;font-size:11px;
  border-top:1px dashed var(--line-soft);padding-top:6px;margin-top:1px}
.qs-diff{display:inline-flex;align-items:center;gap:5px;font-weight:700}
.qs-diff .dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:0 0 auto}
.qs-diff b{font-weight:800}
.qs-rew .elite-x{color:var(--bad);font-weight:800}

/* ══════════════════ 모바일 대응 ══════════════════
 * PC(1280px)에서는 아래 규칙이 하나도 걸리지 않는다 — 전부 @media 안에만 있다.
 *
 * ≤1080  2단 → 1단. 이때 출전 패널을 그냥 목록 아래로 내리면 "의뢰를 고르고 한참 스크롤해야
 *        출정 버튼이 나오는" 화면이 된다. 그래서 패널은 화면 밖으로 빼고
 *        **하단 고정 바**(선택한 의뢰 + 부대 드롭다운 + 출정)를 항상 띄운다.
 *        자세한 준비 화면이 필요하면 그 바에서 시트로 끌어올린다.
 * ≤767   의뢰 카드를 접는다(핵심만) · 터치 타겟 40px 이상 · 글자 12px 하한.
 *        (767 = css/style.css 의 공용 모바일 기준선. 두 곳이 어긋나면 어중간한 폭이 생긴다)
 *
 * 하단 고정 요소는 css/style.css 가 깔아 둔 하단 탭 바 위에 얹는다 —
 * 높이는 --navh (PC 0px / 폰 58px) + --safe-b. 이 계약을 깨면 내비를 덮어 버린다. */
.qs-mbar,.qs-sheet-bd,.qs-sheet-head,.qs-foldbtn{display:none}

@media (max-width:1080px){
  .qs-wrap{grid-template-columns:minmax(0,1fr)}
  /* sticky + calc(100vh) 는 폰에서 화면을 통째로 먹는다 — 평소엔 아예 감춘다. */
  .qs-side{position:fixed;left:0;right:0;top:auto;z-index:75;margin:0;display:none;
    bottom:calc(var(--navh, 0px) + var(--safe-b, 0px));
    max-height:74vh;overflow-y:auto;overscroll-behavior:contain;padding:10px 12px 14px;
    background:linear-gradient(180deg,var(--bg-2),var(--bg-1));
    border-top:2px solid var(--gold-dim);box-shadow:0 -10px 30px rgba(0,0,0,.7)}
  .qs-side.open{display:flex}
  .qs-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
    padding-bottom:6px;border-bottom:1px solid var(--line-soft)}
  .qs-sheet-head b{font-size:14px;color:var(--gold)}
  .qs-sheet-bd.on{display:block;position:fixed;inset:0;z-index:70;background:rgba(6,4,10,.62)}

  .qs-mbar{display:flex;flex-direction:column;gap:6px;position:fixed;left:0;right:0;z-index:71;
    bottom:calc(var(--navh, 0px) + var(--safe-b, 0px));
    padding:8px max(12px, var(--safe-r, 0px)) 10px max(12px, var(--safe-l, 0px));
    background:linear-gradient(180deg,var(--bg-2),var(--bg-1));
    border-top:1px solid var(--gold-dim);box-shadow:0 -8px 24px rgba(0,0,0,.6)}
  .qs-mb-info{display:flex;gap:8px;align-items:center;min-width:0;font-size:12px}
  .qs-mb-info .qs-rank{width:26px;height:26px;font-size:13px}
  .qs-mb-name{flex:1 1 auto;min-width:0;font-weight:700;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .qs-mb-acts{display:flex;gap:6px;align-items:stretch}
  /* 16px 미만이면 iOS 사파리가 포커스 때 화면을 확대한다 (공용 규칙과 같은 값) */
  .qs-mb-sel{flex:1 1 auto;min-width:0;min-height:44px;padding:0 8px;font-size:16px;
    background:var(--bg-3);border:1px solid var(--line);border-radius:5px;color:var(--ink)}
  .qs-mb-acts .btn{flex:0 0 auto;min-height:44px;padding:6px 12px;font-size:13px}
  .qs-mb-go{min-width:104px;font-weight:800}
  /* #screen 은 이미 탭 바만큼 비워 뒀다. 여기서는 내 고정 바 높이만 더 비운다. */
  .qs-screen{padding-bottom:104px}
}

@media (max-width:767px){
  /* 11px 이하는 폰에서 안 읽힌다 */
  .qs-meta,.qs-wave,.qs-note,.qs-assess,.qs-elite-badge,.qs-champ{font-size:12px}
  .qs-send-risk{font-size:12px}
  .qs-screen .btn.sm{min-height:40px;padding:8px 12px;font-size:12px}
  .qs-sortsel{min-height:40px;font-size:16px}
  .qs-days{min-width:46px}
  .qs-days b{font-size:20px}
  /* '일 구속' 라벨이 9px 이라 폰에서 안 읽혔다 (실측: 360px 화면에서 그대로 9px) */
  .qs-days span{font-size:12px;letter-spacing:.06em}

  /* 카드 접기 — 접힌 상태는 랭크·이름·난이도·보상만 남는다 */
  .qs-fold{display:none}
  .qs-card.open .qs-fold{display:flex}
  .qs-foldbtn{display:inline-flex;align-items:center;flex:0 0 auto}
  .qs-card:not(.open) .qs-m2{display:none}

  /* 부대가 5개면 버튼이 가로로 넘친다 — 세로로 쌓고 터치 타겟을 키운다 */
  .qs-send{flex-direction:column;align-items:stretch}
  .qs-send .btn,.qs-screen .qs-send .btn.sm{flex:1 1 auto;width:100%;min-height:44px;
    white-space:normal;font-size:13px}
}
`,
  }));
}

/* ─────────────────────────── 유틸 ─────────────────────────── */

/* ── 서브랭크 · 정예 헬퍼 (quest.js 의 API 가 없는 옛 빌드도 견딘다) ── */
const SUB_SIGN = { '-1': '-', 0: '', 1: '+' };
/** 서브랭크 -1|0|1. 없으면 0(표준). */
function subOf(quest) {
  if (typeof Quest.subOf === 'function') { try { return Quest.subOf(quest); } catch (e) { /* fall through */ } }
  const n = Math.round(Number(quest && typeof quest === 'object' ? quest.sub : quest));
  return Number.isFinite(n) ? (n < 0 ? -1 : n > 0 ? 1 : 0) : 0;
}
/** 표시용 랭크 문자열 'E+' 등. 서브랭크가 없는 옛 의뢰는 랭크 문자만. */
function rankLabel(quest) {
  if (typeof Quest.rankLabelOf === 'function') { try { const v = Quest.rankLabelOf(quest); if (v) return v; } catch (e) { /* */ } }
  if (quest && quest.rankLabel) return quest.rankLabel;
  const rk = (quest && quest.rank) || 'F';
  return `${rk}${SUB_SIGN[subOf(quest)] || ''}`;
}
/** 정예 의뢰인가 */
function isElite(quest) {
  if (typeof Quest.isEliteQuest === 'function') { try { return !!Quest.isEliteQuest(quest); } catch (e) { /* */ } }
  return !!(quest && quest.elite);
}
/** 서브랭크 한국어 이름 (입문/표준/고난도) */
function subName(quest) {
  const s = subOf(quest);
  const t = Quest.SUB_NAME || { '-1': '입문', 0: '표준', 1: '고난도' };
  return t[s] || (s < 0 ? '입문' : s > 0 ? '고난도' : '표준');
}
const ELITE_PREFIX = (typeof Quest.ELITE_PREFIX === 'string' && Quest.ELITE_PREFIX) || '정예 ';
const ELITE_LABEL = (typeof Quest.ELITE_LABEL === 'string' && Quest.ELITE_LABEL) || '정예';
/** 카드에 박는 경고 문구 (요구 문구) */
const ELITE_CARD_WARN = '정예 개체가 섞여 있다. 같은 랭크보다 훨씬 위험하다.';

/**
 * 랭크+서브랭크 배지. quest 객체나 rank 문자열 둘 다 받는다.
 * 서브랭크에 따라 배지 색 농도를 달리해 난이도 차이가 한눈에 보이게 한다.
 */
function rankBadge(q) {
  const rank = typeof q === 'string' ? q : ((q && q.rank) || 'F');
  const sub = typeof q === 'string' ? 0 : subOf(q);
  const label = typeof q === 'string' ? rank : rankLabel(q);
  const mod = sub < 0 ? ' rk-minus' : sub > 0 ? ' rk-plus' : '';
  const two = String(label).length > 1 ? ' two' : '';
  return el('div', {
    class: `qs-rank${mod}${two}`,
    style: { color: GRADE_COLOR[rank] || '#999' },
    title: `${label}랭크 · ${sub < 0 ? '입문(적 약함 · 보상↓ · 안전)' : sub > 0 ? '고난도(적 강함 · 수↑ · 보상↑)' : '표준'}`,
  }, label);
}

/**
 * 웨이브의 적 구성을 훑는다. 정예 개체(champion)는 일반 적과 분리해 따로 표시한다 —
 * "정예 늑대"처럼 전장에서 바로 보이는 위협을 미리보기에서도 눈에 띄게 하기 위해서다.
 * @returns {{normals:string[], champions:string[], boss:boolean, size:number}}
 */
function waveSummary(wave) {
  const normals = new Map();
  const champs = new Map();
  let boss = false;
  for (const u of wave.units || []) {
    const e = getEnemy(u.enemyId);
    const baseName = e ? e.name : u.enemyId;
    if (e && e.boss) boss = true;
    if (u && u.champion) {
      const nm = (typeof u.nameOverride === 'string' && u.nameOverride) || `${ELITE_PREFIX}${baseName}`;
      champs.set(nm, (champs.get(nm) || 0) + 1);
    } else {
      normals.set(baseName, (normals.get(baseName) || 0) + 1);
    }
  }
  const fmt = (m) => [...m.entries()].map(([n, c]) => (c > 1 ? `${n} x${c}` : n));
  return { normals: fmt(normals), champions: fmt(champs), boss, size: (wave.units || []).length };
}

/**
 * canDeploy 의 결과를 방어적으로 읽는다.
 * 확장 전 버전은 `{ok, reason, wounded}` 만 돌려주고,
 * 확장 후에는 `{ok, reason, wounded, benched, deployable}` 을 돌려준다.
 * 어느 쪽이든 같은 형태로 정규화해 UI가 깨지지 않게 한다.
 */
function deployInfo(squadId) {
  const members = squadMembers(state, squadId);
  const hurt = members.filter((m) => isWounded(m, state.day));
  let res = null;
  try { res = canDeploy(state, squadId); } catch (e) { console.warn('[quests] canDeploy 실패', e); }
  if (!res || typeof res !== 'object') res = { ok: false, reason: '출전 여부를 확인할 수 없다.' };

  const asList = (v) => (Array.isArray(v) ? v : null);
  const benched = asList(res.benched) || asList(res.wounded) || hurt;
  const deployableList = asList(res.deployable);
  const fit = typeof res.deployable === 'number'
    ? res.deployable
    : (deployableList ? deployableList.length : members.length - hurt.length);

  return {
    ok: !!res.ok,
    reason: res.reason || '',
    members,
    benched,
    fit: Math.max(0, fit),
    total: members.length,
  };
}

/* ─────────────────── 부대 파견(원정) 상태 조회 ───────────────────
   game/squad.js : SQUAD_AWAY, isSquadAway(squad|id, day), squadReturnIn(squad|id, day),
                   normalizeDispatch(squad, day)
   game/state.js : awaySquads(st), anySquadAway(st), daysUntilNextReturn(st)
   이 함수들이 아직 없는 빌드나, status/returnDay 가 없는 옛 세이브에서도 화면이 죽지 않도록
   전부 "있으면 쓰고 없으면 필드를 직접 읽는" 형태로 감싼다. */

const AWAY = 'away';

/** id든 객체든 부대 객체로 */
function squadOf(sq) {
  if (sq && typeof sq === 'object') return sq;
  return (state.squads || []).find((s) => s && s.id === sq) || null;
}

/** 원정 중인가. 필드가 없는 옛 세이브는 항상 대기 중으로 본다. */
function isAway(sq) {
  const s = squadOf(sq);
  if (!s) return false;
  if (typeof Squad.isSquadAway === 'function') {
    try {
      const v = Squad.isSquadAway(s, state.day);
      if (typeof v === 'boolean') return v;
    } catch (e) { console.warn('[quests] isSquadAway 실패', e); }
  }
  return s.status === (Squad.SQUAD_AWAY || AWAY) && Number(s.returnDay || 0) > state.day;
}

/** 복귀까지 남은 일수 (대기 중이면 0) */
function awayLeft(sq) {
  const s = squadOf(sq);
  if (!s || !isAway(s)) return 0;
  if (typeof Squad.squadReturnIn === 'function') {
    try {
      const v = Squad.squadReturnIn(s, state.day);
      if (Number.isFinite(v) && v > 0) return Math.round(v);
    } catch (e) { console.warn('[quests] squadReturnIn 실패', e); }
  }
  return Math.max(0, Math.round(Number(s.returnDay || 0) - state.day));
}

/** 복귀 예정 일차 (대기 중이면 0) */
function returnDayOf(sq) {
  const s = squadOf(sq);
  if (!s) return 0;
  const left = awayLeft(s);
  if (!left) return 0;
  const rd = Number(s.returnDay || 0);
  return rd > state.day ? rd : state.day + left;
}

/** 가장 먼저 복귀하는 부대까지 남은 일수 (원정 중인 부대가 없으면 0) */
function nextReturnIn() {
  if (typeof GameState.daysUntilNextReturn === 'function') {
    try {
      const v = GameState.daysUntilNextReturn(state);
      if (v == null) return 0;                       // 원정 중인 부대 없음
      if (Number.isFinite(v)) return Math.max(0, Math.round(v));
    } catch (e) { console.warn('[quests] daysUntilNextReturn 실패', e); }
  }
  const lefts = (state.squads || []).filter(isAway).map(awayLeft).filter((d) => d > 0);
  return lefts.length ? Math.min(...lefts) : 0;
}

/** 원정 나간 부대가 하나라도 있는가 */
function anyAway() {
  if (typeof GameState.anySquadAway === 'function') {
    try {
      const v = GameState.anySquadAway(state);
      if (typeof v === 'boolean') return v;
    } catch (e) { console.warn('[quests] anySquadAway 실패', e); }
  }
  return (state.squads || []).some(isAway);
}

/** 복귀일이 지난 부대의 status 를 되돌린다 (도시를 거치지 않고 들어와도 화면이 맞도록). */
function syncSquadStatus() {
  const fn = typeof Squad.normalizeDispatch === 'function' ? Squad.normalizeDispatch : null;
  for (const s of state.squads || []) {
    if (!s) continue;
    if (fn) {
      try { fn(s, state.day); continue; } catch (e) { console.warn('[quests] normalizeDispatch 실패', e); }
    }
    if (s.status === AWAY && Number(s.returnDay || 0) <= state.day) { s.status = 'idle'; s.returnDay = 0; }
  }
}

/* 진행 바용 총 원정 기간. Squad 는 returnDay 만 들고 있으므로
   이 화면에서 관측한 최대 잔여 일수를 총 기간으로 기억한다. */
const awaySeen = new Map();

function awayTotal(sq, left) {
  const s = squadOf(sq);
  if (!s) return Math.max(1, left);
  const rd = Number(s.returnDay || 0);
  const direct = [s.awayDays, s.questDays, s.awayTotal]
    .map(Number).find((v) => Number.isFinite(v) && v > 0);
  if (direct) return direct;
  const dep = [s.departDay, s.dispatchDay, s.awayFrom]
    .map(Number).find((v) => Number.isFinite(v) && v > 0);
  if (dep && rd > dep) return rd - dep;
  const prev = awaySeen.get(s.id);
  const total = prev && prev.returnDay === rd ? Math.max(prev.total, left) : left;
  awaySeen.set(s.id, { returnDay: rd, total });
  return Math.max(1, total);
}

/** 지금 이 의뢰를 받을 수 있는 부대인가 (원정 중이 아니고 움직일 인원이 있다) */
function canSend(sq) {
  if (isAway(sq)) return false;
  const dep = deployInfo(sq.id);
  return dep.ok && dep.fit > 0;
}

/**
 * 실제 출정. 전투와 보상은 즉시 처리되고, 부대는 quest.days 만큼 잠긴다.
 * 부대를 잠그는 것(dispatchSquad)은 전투 정산 경로(applyQuestResult)의 몫이다 —
 * 전투 전에 여기서 미리 잠그면 squadUnitDefs 가 원정 중인 부대를 거를 경우
 * 그 전투 자체가 성립하지 않는다. 여기서는 출정 가능 여부만 다시 확인한다.
 */
function launch(quest, sq) {
  if (!quest || !sq) return;
  if (isAway(sq)) {
    toast(`${sq.name}${josa(sq.name, '은/는')} 원정 중이다 — ${num(returnDayOf(sq))}일차 복귀.`, 'bad');
    return;
  }
  const check = deployInfo(sq.id);
  if (!check.ok) { toast(check.reason || '출전할 수 없습니다.', 'bad'); return; }
  go('battle', { questId: quest.id, squadId: sq.id });
}

/** 권장 레벨 대비 위험도 단계. 정예는 한 단계 더 위험하게 본다(설계 E). */
const DANGER = [
  { label: '식은 죽 먹기', color: 'var(--ink-dim)' }, // 1
  { label: '여유', color: 'var(--ok)' },              // 2
  { label: '적정', color: 'var(--steel)' },           // 3
  { label: '위험', color: 'var(--ember)' },           // 4
  { label: '무모', color: 'var(--bad)' },             // 5
];
/**
 * `merc.js mercPower` 와 **같은 가중치**. 아군·적을 같은 자로 재야 비교가 성립한다.
 * (merc.js 의 가중치를 바꾸면 여기도 같이 고쳐야 한다)
 */
function statPower(s) {
  if (!s) return 0;
  return s.hp * 0.14 + s.atk * 2.6 + s.def * 1.5 + s.res * 1.3 + s.spd * 1.6
    + s.crit * 2.2 + s.critDmg * 0.5 + s.eva * 1.8;
}

/** 의뢰별 적 전투력 캐시 (의뢰 목록은 3일마다만 갈리므로 id 로 캐시해도 안전하다) */
const foePowerCache = new Map();

/**
 * 의뢰의 적 전투력.
 *
 * `enemyUnitDefs` 로 **실제 전투에 나가는 스탯**을 받아 계산한다 — 웨이브 배율·정예·보스 감쇠가
 * 전부 반영된 값이라, 직접 다시 계산하면 실제 게임과 어긋난다(예전에 balance.mjs 가 그래서
 * 난이도 노브를 바꿔도 측정값이 안 움직였다).
 *
 * 웨이브 사이에는 HP가 이어지므로 "가장 센 웨이브"만으로는 모자란다. 최고 웨이브를 기준으로
 * 웨이브 수만큼 가산해 누적 소모를 반영한다.
 */
function questFoePower(q) {
  if (!q) return 0;
  if (q.id && foePowerCache.has(q.id)) return foePowerCache.get(q.id);
  const waves = q.waves || [];
  let peak = 0;
  let total = 0;
  waves.forEach((w, i) => {
    let p = 0;
    try {
      const defs = typeof Quest.enemyUnitDefs === 'function' ? Quest.enemyUnitDefs(w, q, i) : [];
      p = (defs || []).reduce((a, u) => a + statPower(u && u.stats), 0);
    } catch (e) { p = 0; }
    peak = Math.max(peak, p);
    total += p;
  });
  const v = Math.round(peak * (1 + 0.18 * Math.max(0, waves.length - 1)) + total * 0.05);
  if (q.id) foePowerCache.set(q.id, v);
  return v;
}

/** 실제로 출전할 인원(부상자 제외)의 전투력 합 */
function deployablePower(squadId) {
  let ms = [];
  try { ms = (canDeploy(state, squadId) || {}).deployable || []; } catch (e) { ms = []; }
  if (!ms.length) {
    try { ms = (squadMembers(state, squadId) || []).filter((m) => !isWounded(m, state.day)); } catch (e) { ms = []; }
  }
  return ms.reduce((a, m) => a + mercPower(m, state), 0);
}

/** 전투력 비율 → 위험도 등급 (1 매우 여유 ~ 5 무모) */
function dangerLevelByPower(ratio) {
  if (!(ratio > 0)) return 0;
  if (ratio >= 1.60) return 1;
  if (ratio >= 1.22) return 2;
  if (ratio >= 0.92) return 3;
  if (ratio >= 0.70) return 4;
  return 5;
}

/**
 * 예상 난이도.
 *
 * 예전에는 **평균 레벨 차이만** 봤다. 그래서 3명짜리 Lv43 부대(전투력 9,971)가
 * 7명짜리 Lv31 부대(전투력 15,570)보다 "여유"로 뜨는 역전이 났다 —
 * 오토배틀러에서 인원수는 곧 화력인데 그걸 통째로 무시한 것이다.
 * 지금은 **출전 인원의 전투력 합 vs 의뢰의 적 전투력** 비율로 잰다.
 */
function dangerFor(quest, squadId) {
  const elite = isElite(quest);
  if (!squadId) return { label: '부대 없음', color: 'var(--ink-faint)', level: 0, elite, ratio: 0 };
  const ally = deployablePower(squadId);
  const foe = questFoePower(quest);
  if (!ally) return { label: '출전 인원 없음', color: 'var(--bad)', level: 5, elite, ratio: 0 };
  if (!foe) return { label: '판정 불가', color: 'var(--ink-faint)', level: 0, elite, ratio: 0 };
  const ratio = ally / foe;
  const lv = clamp(dangerLevelByPower(ratio), 1, 5);
  const d = DANGER[lv - 1];
  return { label: d.label, color: d.color, level: lv, elite, ratio, ally, foe };
}

/**
 * 카드의 예상 난이도를 잴 기준 부대. 지금 고른 부대(원정 중이 아니면)를 우선하고,
 * 없으면 오늘 보낼 수 있는 부대 → 대기 중 부대 → 아무 부대 순으로 고른다.
 */
function refSquad() {
  const squads = state.squads || [];
  const sel = squads.find((s) => s && s.id === selectedSquadId && !isAway(s));
  if (sel) return sel;
  return squads.find((s) => canSend(s)) || squads.find((s) => !isAway(s)) || squads[0] || null;
}

/* ─────────────────────────── 렌더 ─────────────────────────── */

export function render(root, params = {}) {
  injectStyle();
  const city = getCity(state.cityId);
  if (!city) {
    root.appendChild(el('div', { class: 'panel' }, el('h3', { text: '의뢰소' }), el('div', { class: 'muted', text: '현재 도시를 알 수 없습니다.' })));
    return;
  }
  if (lastCityId !== city.id) { selectedQuestId = null; lastCityId = city.id; }
  if (params.questId) selectedQuestId = params.questId;

  syncSquadStatus();
  refreshCity(city.id);
  const list = sortQuests(((state.quests[city.id] && state.quests[city.id].list) || [])
    .filter((q) => (q.expiresDay ?? Infinity) >= state.day));

  if (!list.some((q) => q.id === selectedQuestId)) selectedQuestId = list.length ? list[0].id : null;
  const quest = list.find((q) => q.id === selectedQuestId) || null;
  // 의뢰 목록은 3일마다 갈린다 — 사라진 의뢰의 펼침 상태가 계속 쌓이지 않도록 정리한다.
  if (expandedQuests.size) {
    const alive = new Set(list.map((q) => q.id));
    for (const id of [...expandedQuests]) if (!alive.has(id)) expandedQuests.delete(id);
  }

  const squads = state.squads || [];
  const ready = squads.filter((sq) => !isAway(sq));
  const cur = squads.find((sq) => sq.id === selectedSquadId) || null;
  // 원정 중인 부대가 선택돼 있으면 지금 보낼 수 있는 부대로 옮긴다.
  if (!cur || isAway(cur)) {
    const pick = squads.find((sq) => canSend(sq)) || ready[0] || squads[0] || null;
    selectedSquadId = pick ? pick.id : null;
  }

  // 화면 전체를 감싼다 — 모바일 규칙(글자 크기·하단 여백)을 이 화면 안으로만 한정하기 위해서다.
  const screen = el('div', { class: 'qs-screen' });
  screen.appendChild(headerPanel(city, list));

  const left = el('div', { class: 'col', style: { marginTop: '12px' } });
  if (list.length > 1) left.appendChild(sortBar(root));
  if (!list.length) {
    left.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'muted', text: '지금은 걸려 있는 의뢰가 없다. 며칠 지나 다시 들러 보자.' })));
  } else {
    for (const q of list) left.appendChild(questCard(q, root));
  }

  // 모바일에서 .qs-side 는 하단 시트가 된다(CSS). .qs-sheet-head 는 그때만 보이는 닫기 줄이다.
  const side = el('div', { class: `col qs-side${sheetOpen ? ' open' : ''}` },
    el('div', { class: 'qs-sheet-head' },
      el('b', { text: '출전 준비' }),
      el('button', { class: 'btn sm ghost', onClick: () => closeSheet(root) }, '닫기 ✕')),
    deployPanel(quest, root));

  screen.appendChild(el('div', { class: 'qs-wrap' }, left, side));
  screen.appendChild(el('div', {
    class: `qs-sheet-bd${sheetOpen ? ' on' : ''}`,
    onClick: () => closeSheet(root),
  }));
  screen.appendChild(mobileBar(quest, root));

  root.appendChild(screen);
}

/** 모바일 출전 시트 닫기 */
function closeSheet(root) {
  if (!sheetOpen) return;
  sheetOpen = false;
  rerender(root);
}

/**
 * 모바일 하단 고정 출정 바.
 * 좁은 화면에서는 출전 패널이 목록 아래로 밀려나므로, "고른 의뢰를 어느 부대로 보낼까"만
 * 여기서 끝낸다. 부대가 5개여도 드롭다운이라 가로로 넘치지 않는다.
 * 데스크톱에서는 CSS 로 통째로 숨기므로 1280px 레이아웃은 변하지 않는다.
 */
function mobileBar(quest, root) {
  const bar = el('div', { class: 'qs-mbar' });
  const squads = state.squads || [];

  if (!quest) {
    bar.appendChild(el('div', { class: 'qs-mb-info' },
      el('span', { class: 'faint', text: '의뢰를 고르면 여기서 바로 출정할 수 있다.' })));
    return bar;
  }

  bar.appendChild(el('div', { class: 'qs-mb-info' },
    rankBadge(quest),
    el('span', { class: 'qs-mb-name', text: quest.name }),
    el('span', { class: 'faint num', text: `${quest.days}일 구속` })));

  if (!squads.length) {
    bar.appendChild(el('div', { class: 'qs-mb-acts' },
      el('button', { class: 'btn primary qs-mb-go', onClick: () => go('company') }, '부대 만들기')));
    return bar;
  }
  // 드롭다운의 선택값과 모듈 상태가 어긋나지 않게 맞춰 둔다.
  if (!squads.some((s) => s && s.id === selectedSquadId)) selectedSquadId = squads[0].id;

  const sel = el('select', { class: 'qs-mb-sel', title: '출전 부대' });
  for (const sq of squads) {
    const away = isAway(sq);
    const dep = away ? null : deployInfo(sq.id);
    const okay = !away && !!dep && dep.ok && dep.fit > 0;
    const tail = away
      ? `원정 중 · ${num(returnDayOf(sq))}일차 복귀`
      : okay ? `${dep.fit}명 출전 가능` : ((dep && dep.reason) || '출전 불가');
    sel.appendChild(el('option', {
      value: sq.id, selected: sq.id === selectedSquadId, text: `${sq.name} — ${tail}`,
    }));
  }

  const goBtn = el('button', { class: 'btn primary qs-mb-go' }, '출정');
  const sheetBtn = el('button', {
    class: 'btn ghost qs-mb-more',
    onClick: () => { sheetOpen = !sheetOpen; rerender(root); },
  }, sheetOpen ? '닫기 ▾' : '준비 ▴');

  // 부대만 바꿀 때는 화면을 다시 그리지 않는다 — 목록 스크롤 위치를 잃지 않기 위해서다.
  const sync = () => {
    const sq = squads.find((s) => s && s.id === selectedSquadId) || null;
    const away = sq ? isAway(sq) : false;
    const dep = sq && !away ? deployInfo(sq.id) : null;
    const okay = !!dep && dep.ok && dep.fit > 0;
    const risk = okay && sq ? dangerFor(quest, sq.id) : null;
    goBtn.disabled = !okay;
    goBtn.textContent = !sq ? '부대 없음'
      : away ? `${awayLeft(sq)}일 뒤 복귀`
        : okay ? (risk && risk.label ? `출정 · ${risk.label}` : '출정') : '출전 불가';
    goBtn.title = okay
      ? `${quest.days}일간 묶인다 — ${num(state.day + quest.days)}일차 복귀`
      : ((dep && dep.reason) || (away ? `${num(returnDayOf(sq))}일차 복귀` : '출전할 수 없다'));
  };
  sel.addEventListener('change', () => { selectedSquadId = sel.value || null; sync(); });
  goBtn.addEventListener('click', () => {
    const sq = squads.find((s) => s && s.id === selectedSquadId);
    if (sq) launch(quest, sq);
  });
  sync();

  bar.appendChild(el('div', { class: 'qs-mb-acts' }, sel, goBtn, sheetBtn));
  return bar;
}

function headerPanel(city, list) {
  const entry = state.quests[city.id];
  const nextRoll = entry ? Math.max(0, 3 - (state.day - (entry.day || state.day))) : 0;
  const squads = state.squads || [];
  const away = squads.filter(isAway);
  const ready = squads.length - away.length;
  const nextIn = nextReturnIn();

  const blocked = squads.length > 0 && ready === 0;

  return el('div', { class: 'panel' },
    el('div', { class: 'row spread center wrap', style: { gap: '12px' } },
      el('div', {},
        el('div', { style: { fontWeight: '700', fontSize: '16px' } }, `${city.name} 의뢰소`),
        el('div', { class: 'tiny muted', text: '게시판에 못 박힌 양피지들. 하루에 여러 부대를 각각 다른 의뢰에 보낼 수 있다.' })),
      el('div', { class: 'row', style: { gap: '18px' } },
        el('div', { class: 'col', style: { gap: '2px', alignItems: 'flex-end' } },
          el('span', { class: 'tiny faint', text: '오늘' }),
          el('span', { class: 'num', style: { fontWeight: '700' }, text: `${num(state.day)}일차` })),
        el('div', { class: 'col', style: { gap: '2px', alignItems: 'flex-end' } },
          el('span', { class: 'tiny faint', text: '보낼 수 있는 부대' }),
          el('span', { class: `num ${ready ? 'qs-idle' : ''}`, style: { fontWeight: '700', color: ready ? '' : 'var(--bad)' }, text: `${ready} / ${squads.length}` })),
        el('div', { class: 'col', style: { gap: '2px', alignItems: 'flex-end' } },
          el('span', { class: 'tiny faint', text: '게시된 의뢰' }),
          el('span', { class: 'num', style: { fontWeight: '700' }, text: `${list.length}건` })),
        el('div', { class: 'col', style: { gap: '2px', alignItems: 'flex-end' } },
          el('span', { class: 'tiny faint', text: '목록 갱신' }),
          el('span', { class: 'num', style: { fontWeight: '700' }, text: nextRoll > 0 ? `${nextRoll}일 후` : '오늘' })))),
    blocked
      ? el('div', { class: 'qs-note bad', style: { margin: '10px 0 0' } },
        el('span', { text: '!' }),
        el('span', {},
          el('b', { text: '지금 보낼 수 있는 부대가 없다 — 전 부대가 원정 중이다. ' }),
          nextIn > 0 ? `도시에서 날짜를 넘겨라. 최단 ${nextIn}일 뒤 복귀한다.` : '도시에서 날짜를 넘겨라.',
          el('div', { style: { marginTop: '5px' } },
            el('button', { class: 'btn sm', onClick: () => go('city') }, '도시로 — 날짜 넘기기'))))
      : anyAway()
        ? el('div', { class: 'qs-note', style: { margin: '10px 0 0' } },
          el('span', { text: '·' }),
          el('span', {}, `원정 중인 부대 ${away.length}개 — `,
            away.map((sq) => `${sq.name} ${num(returnDayOf(sq))}일차`).join(', '),
            '. 남은 부대는 오늘 다른 의뢰에 보낼 수 있다.'))
        : null);
}

/** 정렬 적용. 값이 같으면 랭크 점수 → 이름 순으로 안정 정렬한다. */
function sortQuests(list) {
  const mode = SORT_MODES.find(([k]) => k === sortPref.mode) || SORT_MODES[0];
  const score = mode[2];
  const dir = sortPref.desc ? -1 : 1;
  return list.slice().sort((a, b) => {
    const d = (score(a) - score(b)) * dir;
    if (d) return d;
    const r = (rankScore(a) - rankScore(b)) * dir;
    if (r) return r;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });
}

/** 정렬 바 — 기준 선택 + 높은순/낮은순 토글. 선택은 localStorage 에 남는다. */
function sortBar(root) {
  const redraw = () => { saveSort(sortPref); root.innerHTML = ''; render(root, {}); };

  const sel = el('select', {
    class: 'qs-sortsel',
    onChange: (e) => { sortPref.mode = e.target.value; redraw(); },
  });
  for (const [k, label] of SORT_MODES) {
    sel.appendChild(el('option', { value: k, selected: k === sortPref.mode, text: label }));
  }

  return el('div', { class: 'row wrap center', style: { gap: '6px', marginBottom: '2px' } },
    el('span', { class: 'tiny faint', text: '정렬' }),
    sel,
    el('button', {
      class: 'btn sm',
      title: sortPref.desc ? '지금 높은순 — 누르면 낮은순' : '지금 낮은순 — 누르면 높은순',
      onClick: () => { sortPref.desc = !sortPref.desc; redraw(); },
    }, sortPref.desc ? '높은순 ↓' : '낮은순 ↑'),
    el('span', { class: 'tiny faint', text: '설정은 다음에도 유지된다' }));
}

function questCard(q, root) {
  const selected = q.id === selectedQuestId;
  const elite = isElite(q);
  const biome = BIOME_NAME[q.biome] || q.biome || '—';
  const daysLeft = (q.expiresDay ?? 0) - state.day;
  const waves = q.waves || [];
  const rew = q.reward || {};

  const waveRows = waves.map((w, i) => {
    const s = waveSummary(w);
    const kids = [el('i', { text: `${i + 1}웨이브` })];
    if (s.normals.length) kids.push(el('span', { class: s.boss ? 'qs-boss' : '', text: s.normals.join(', ') }));
    s.champions.forEach((c, j) => {
      if (s.normals.length || j > 0) kids.push(el('span', { class: 'faint', text: ' ' }));
      kids.push(el('span', { class: 'qs-champ', text: c }));
    });
    // 정예 의뢰인데 챔피언 표식이 아직 안 실린 옛 세이브라도 최소한 알린다.
    if (elite && !s.champions.length && s.normals.length) kids.push(el('span', { class: 'qs-champ', text: `${ELITE_LABEL} 개체 포함` }));
    if (s.boss) kids.push(el('span', { class: 'qs-boss', text: ' ◆보스' }));
    return el('div', { class: 'qs-wave' }, kids);
  });

  const itemRolls = rew.itemRolls || [];
  const avgIlvl = itemRolls.length ? Math.round(itemRolls.reduce((a, r) => a + (r.ilvl || 1), 0) / itemRolls.length) : 0;
  const bonus = itemRolls.length ? Math.max(...itemRolls.map((r) => r.rarityBonus || 0)) : 0;
  const lootRarity = clamp(Math.round(bonus * 6), 0, 4);

  // 예상 난이도 — 지금 고른(또는 보낼 수 있는) 부대의 평균 레벨 대비. 정예면 한 단계 위로.
  const ref = refSquad();
  const avg = ref ? squadAvgLevel(state, ref.id) : 0;
  const diff = dangerFor(q, ref ? ref.id : null);

  const open = expandedQuests.has(q.id);

  return el('div', {
    class: `card qs-card ${selected ? 'selected' : ''}${elite ? ' elite' : ''}${open ? ' open' : ''}`,
    onClick: () => {
      selectedQuestId = q.id;
      // 폰에서는 카드가 접혀 있다 — 고르는 동작이 곧 펼치는 동작이다(접기는 전용 버튼으로).
      if (isNarrow()) expandedQuests.add(q.id);
      rerender(root);
    },
  },
    el('div', { class: 'row center', style: { gap: '10px' } },
      rankBadge(q),
      el('div', { class: 'qs-days', title: `출정한 부대가 ${q.days}일간 묶인다 (${num(state.day + q.days)}일차 복귀)` },
        el('b', { text: String(q.days) }),
        el('span', { text: '일 구속' })),
      el('div', { style: { flex: '1', minWidth: '0' } },
        el('div', { class: 'row center', style: { gap: '6px', flexWrap: 'wrap' } },
          el('div', { style: { fontWeight: '700' } }, q.name),
          elite ? el('span', { class: 'qs-elite-badge', title: ELITE_CARD_WARN }, `◆ ${ELITE_LABEL}`) : null),
        // qs-m2 = 접힌 카드에서는 감추는 보조 정보(폰 전용). PC 에서는 전부 그대로 보인다.
        el('div', { class: 'qs-meta' },
          el('span', { class: 'tag', style: { color: TYPE_COLOR[q.type] || 'var(--steel)' }, text: q.type }),
          el('span', { class: 'qs-m2' }, '지역 ', el('b', { text: biome })),
          el('span', {}, '권장 ', el('b', { text: `Lv${q.level}` })),
          el('span', { class: 'qs-m2' }, '단계 ', el('b', { text: `${rankLabel(q)} · ${subName(q)}` })),
          el('span', { class: 'qs-m2' }, '웨이브 ', el('b', { text: `${waves.length}` })),
          el('span', { class: 'qs-m2' }, '복귀 ', el('b', { class: 'num', text: `${num(state.day + q.days)}일차` })),
          el('span', { class: daysLeft <= 1 ? '' : 'faint', style: daysLeft <= 1 ? { color: 'var(--bad)' } : {}, text: daysLeft <= 0 ? '오늘 마감' : `${daysLeft}일 남음` }))),
      foldButton(q)),
    el('div', { class: 'qs-assess' },
      el('span', { class: 'qs-diff', style: { color: diff.color } },
        el('span', { class: 'dot' }), '예상 난이도 ', el('b', { text: diff.label })),
      ref
        ? el('span', { class: 'faint', text: `${ref.name} 평균 Lv${avg || 0} 기준 · 권장 Lv${q.level}` })
        : el('span', { class: 'faint', text: '부대를 골라야 난이도를 가늠할 수 있다' }),
      elite ? el('span', { class: 'qs-diff', style: { color: 'var(--bad)' }, text: '정예 보정 +1단계' }) : null),
    // ↓ 여기부터 .qs-fold — 폰에서는 접힌다. PC 에서는 예전과 같은 순서·간격으로 펼쳐져 있다.
    el('div', { class: 'qs-fold' },
      elite
        ? el('div', { class: 'qs-note elite' },
          el('span', { text: '◆' }),
          el('span', {},
            el('b', { text: `${ELITE_LABEL} 의뢰 — ${ELITE_CARD_WARN} ` }),
            '적이 전원 강화되고 그중 1~2기는 정예 개체다. 대신 보상이 크다.'))
        : null,
      el('div', { class: 'tiny muted', text: q.desc || '' }),
      el('div', {}, waveRows)),
    el('div', { class: 'qs-rew' },
      el('span', {}, el('span', { class: 'faint', text: '보수 ' }), el('b', { class: 'num', style: { color: 'var(--gold)' }, text: `${num(rew.gold || 0)}G` })),
      el('span', {}, el('span', { class: 'faint', text: '경험치 ' }), el('b', { class: 'num', text: num(rew.exp || 0) })),
      el('span', {}, el('span', { class: 'faint', text: '명성 ' }), el('b', { class: 'num', text: `+${rew.renown || 0}` })),
      elite ? el('span', { class: 'elite-x', text: '정예 보상 ×2.2' }) : null,
      itemRolls.length
        ? el('span', {}, el('span', { class: 'faint', text: '전리품 ' }),
            el('b', { style: { color: RARITY_COLOR[lootRarity] }, text: `${itemRolls.length}개 · ${RARITY_NAME[lootRarity]}급 기대 (i${avgIlvl})${elite ? ' · 희귀도+1' : ''}` }))
        : null),
    foldWrap(sendRow(q, root)));
}

/** 접히는 영역으로 감싼다. 내용이 없으면 빈 칸(gap)이 생기지 않도록 아무것도 만들지 않는다. */
function foldWrap(node) {
  return node ? el('div', { class: 'qs-fold' }, node) : null;
}

/**
 * 카드 접기/펼치기 버튼. 폰에서만 보인다(CSS).
 * 다시 그리지 않고 클래스만 토글해 스크롤 위치를 지킨다.
 */
function foldButton(q) {
  const label = (o) => (o ? '접기 ▴' : '자세히 ▾');
  return el('button', {
    class: 'btn sm ghost qs-foldbtn',
    onClick: (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const card = btn.closest ? btn.closest('.qs-card') : null;
      const nowOpen = card ? card.classList.toggle('open') : !expandedQuests.has(q.id);
      if (nowOpen) expandedQuests.add(q.id); else expandedQuests.delete(q.id);
      btn.textContent = label(nowOpen);
    },
  }, label(expandedQuests.has(q.id)));
}

/**
 * 의뢰 카드에서 부대를 바로 골라 보낸다.
 * 같은 날 부대별로 서로 다른 의뢰에 나갈 수 있다는 것이 여기서 눈에 보여야 한다.
 */
function sendRow(q, root) {
  const squads = state.squads || [];
  if (!squads.length) return null;

  const btns = squads.map((sq) => {
    const away = isAway(sq);
    const dep = away ? null : deployInfo(sq.id);
    const ok = !away && !!dep && dep.ok && dep.fit > 0;
    // 버튼 색 = **그 부대의** 위험도. 부대마다 난이도가 다르므로 버튼마다 색이 달라야
    // "어느 부대로 보내야 하나"가 한눈에 읽힌다. 카드 상단 라벨과 같은 색 체계를 쓴다.
    const risk = ok ? dangerFor(q, sq.id) : null;
    return el('button', {
      class: `btn sm qs-send-btn${ok ? ' on' : ''}`,
      style: risk && risk.level
        ? { color: risk.color, borderColor: risk.color, background: `color-mix(in srgb, ${risk.color} 14%, var(--bg-3))` }
        : {},
      disabled: !ok,
      title: away
        ? `원정 중 — ${num(returnDayOf(sq))}일차 복귀 (남은 ${awayLeft(sq)}일)`
        : ok
          ? `${risk && risk.label ? `예상 난이도 ${risk.label} · ` : ''}${q.days}일간 묶인다 — ${num(state.day + q.days)}일차 복귀`
          : (dep && dep.reason) || '출전할 수 없다',
      onClick: (e) => {
        e.stopPropagation();
        selectedQuestId = q.id;
        if (!ok) {
          toast(away ? `${sq.name} — ${num(returnDayOf(sq))}일차 복귀` : (dep && dep.reason) || '출전할 수 없습니다.', 'bad');
          rerender(root);
          return;
        }
        selectedSquadId = sq.id;
        launch(q, sq);
      },
    }, away
      ? `${sq.name} · ${num(returnDayOf(sq))}일차 복귀`
      : el('span', {},
        `${sq.name}${josa(sq.name, '으로/로')} 출정`,
        // 색만으로는 색각 이상이 있으면 못 읽는다. 라벨을 같이 박아 둔다.
        risk && risk.level ? el('i', { class: 'qs-send-risk', text: risk.label }) : null));
  });

  return el('div', { class: 'qs-send' },
    el('span', { class: 'faint tiny', text: '이 의뢰로 보내기' }), btns);
}

/* ─────────────────────────── 출전 패널 ─────────────────────────── */

function deployPanel(quest, root) {
  const panel = el('div', { class: 'panel' }, el('h3', { text: '출전 준비' }));
  if (!quest) {
    panel.appendChild(el('div', { class: 'muted tiny', text: '왼쪽에서 의뢰를 고르면 여기에 출전 준비가 뜬다.' }));
    return panel;
  }

  const elite = isElite(quest);
  panel.appendChild(el('div', { class: 'row center', style: { gap: '10px', marginBottom: '8px' } },
    rankBadge(quest),
    el('div', { class: 'qs-days' }, el('b', { text: String(quest.days) }), el('span', { text: '일 구속' })),
    el('div', { style: { flex: '1', minWidth: '0' } },
      el('div', { class: 'row center', style: { gap: '6px', flexWrap: 'wrap' } },
        el('div', { style: { fontWeight: '700' } }, quest.name),
        elite ? el('span', { class: 'qs-elite-badge', title: ELITE_CARD_WARN }, `◆ ${ELITE_LABEL}`) : null),
      el('div', { class: 'tiny faint', text: `${quest.type} · ${rankLabel(quest)}랭크(${subName(quest)}) · 권장 Lv${quest.level} · ${quest.waves.length}웨이브` }))));

  if (elite) {
    panel.appendChild(el('div', { class: 'qs-note elite', style: { marginBottom: '8px' } },
      el('span', { text: '◆' }),
      el('span', {},
        el('b', { text: `${ELITE_LABEL} 의뢰 — ${ELITE_CARD_WARN} ` }),
        '권장 레벨을 넘겨 도전하는 편이 안전하다. 보상은 골드·경험치 ×2.2, 전리품 희귀도 +1단계.')));
  }

  const squads = state.squads || [];
  if (!squads.length) {
    panel.appendChild(el('div', { class: 'muted tiny', text: '편성된 부대가 없다. 용병단 화면에서 부대를 만들자.' }));
    panel.appendChild(el('button', { class: 'btn', style: { marginTop: '10px' }, onClick: () => go('company') }, '용병단으로'));
    return panel;
  }

  panel.appendChild(el('div', { class: 'tiny faint', style: { margin: '4px 0 6px' }, text: '출전 부대' }));
  for (const sq of squads) panel.appendChild(squadCard(sq, quest, root));

  const chosen = squads.find((s) => s.id === selectedSquadId) || null;
  const chosenAway = chosen ? isAway(chosen) : false;
  const dep = chosen && !chosenAway ? deployInfo(chosen.id) : null;
  const nextIn = nextReturnIn();

  // 원정 중인 부대를 고른 경우 — 출정 자체가 불가능하다.
  if (chosen && chosenAway) {
    panel.appendChild(el('div', { class: 'qs-note bad' },
      el('span', { text: '!' }),
      el('span', {},
        el('b', { text: `${chosen.name}${josa(chosen.name, '은/는')} 원정 중이다 — ${num(returnDayOf(chosen))}일차 복귀. ` }),
        `남은 ${awayLeft(chosen)}일 동안은 다른 의뢰를 받을 수 없다.`,
        el('div', { style: { marginTop: '4px' } },
          el('button', { class: 'btn sm', onClick: () => go('city') },
            nextIn > 0 ? `도시로 — ${nextIn}일 넘기기` : '도시로')))));
    panel.appendChild(el('button', {
      class: 'btn lg', style: { width: '100%', marginTop: '4px' }, disabled: true,
    }, '출정 불가 — 원정 중'));
    panel.appendChild(deployFootNote(quest));
    return panel;
  }

  if (!dep) {
    panel.appendChild(el('div', { class: 'qs-note bad' },
      el('span', { text: '!' }), el('span', { text: '출전할 부대를 고르자.' })));
  } else if (dep.fit === 0) {
    // 움직일 수 있는 인원이 하나도 없다 — 출정 버튼은 비활성 상태로 남기고 회복 동선을 붙인다.
    panel.appendChild(el('div', { class: 'qs-note bad' },
      el('span', { text: '!' }),
      el('span', {},
        el('b', { text: '휴식이 필요하다 — 움직일 수 있는 단원이 없다. ' }),
        dep.total ? `${dep.total}명 전원이 부상 중이다.` : (dep.reason || '부대가 비어 있다.'))));
  } else if (dep.benched.length) {
    // 부상자는 자동으로 열외된다. 출정 자체는 막지 않는다.
    const names = dep.benched.map((m) => m.name).filter(Boolean).join(', ');
    panel.appendChild(el('div', { class: 'qs-note' },
      el('span', { text: '!' }),
      el('span', {},
        el('b', { text: `부상자 ${dep.benched.length}명 제외, ${dep.fit}명으로 출전` }),
        names ? el('div', { class: 'faint', style: { marginTop: '2px' }, text: `열외: ${names}` }) : null,
        el('div', { style: { marginTop: '2px' } }, '빈 자리는 남은 인원으로 다시 채워진다. 전력이 줄어드니 무리하지 마라.'))));
  }

  if (dep && !dep.ok && dep.fit > 0) {
    panel.appendChild(el('div', { class: 'qs-note bad' },
      el('span', { text: '!' }), el('span', { text: `출전 불가 — ${dep.reason || '조건을 확인하자.'}` })));
  }

  // 출정 전에 "이 부대가 언제까지 묶이는가"를 반드시 보여준다.
  // 전투와 보상은 즉시 끝나지만 부대는 그날부터 quest.days 동안 잠긴다.
  if (chosen && dep && dep.ok) {
    const others = squads.filter((s) => s.id !== chosen.id && !isAway(s)).length;
    panel.appendChild(el('div', { class: 'qs-note' },
      el('span', { text: '!' }),
      el('span', {},
        el('b', { text: `출정하면 ${chosen.name}${josa(chosen.name, '은/는')} ${num(state.day + quest.days)}일차까지 다른 의뢰를 받을 수 없다 (${quest.days}일 구속).` }),
        el('div', { style: { marginTop: '2px' } },
          '전투와 보상은 지금 바로 처리된다. 날짜는 자동으로 흐르지 않으니 도시에서 직접 넘겨야 복귀한다.'),
        others > 0
          ? el('div', { class: 'faint', style: { marginTop: '2px' }, text: `남은 부대 ${others}개는 오늘 다른 의뢰에 보낼 수 있다.` })
          : null)));
  }

  panel.appendChild(el('button', {
    class: 'btn primary lg',
    style: { width: '100%', marginTop: '4px' },
    disabled: !dep || !dep.ok,
    onClick: () => {
      if (!chosen) return;
      launch(quest, chosen);
    },
  }, dep && dep.fit > 0 && dep.benched.length ? `${dep.fit}명으로 출정` : '출정'));

  // 전원 부상이면 "그럼 뭘 해야 하나"를 바로 이어 준다.
  if (dep && dep.fit === 0) {
    panel.appendChild(el('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
      el('button', { class: 'btn', style: { flex: '1' }, onClick: () => go('city') }, '도시로 — 여관에서 휴식'),
      el('button', { class: 'btn ghost', onClick: () => go('company') }, '편성 변경')));
  }

  panel.appendChild(deployFootNote(quest));
  return panel;
}

/** 출전 패널 하단 안내 — 새 파견 규칙을 한 문단으로 정리한다. */
function deployFootNote(quest) {
  return el('div', { class: 'tiny faint', style: { marginTop: '8px' } },
    el('div', { text: `전투와 보상은 즉시 처리된다. 대신 나간 부대는 ${quest.days}일간 묶인다 — 다른 부대는 같은 날 다른 의뢰에 보낼 수 있다.` }),
    el('div', { style: { marginTop: '3px' }, text: '날짜는 도시 화면에서 직접 넘긴다. 임금·부상 회복·의뢰 갱신은 날짜를 넘길 때만 진행된다.' }),
    el('div', { style: { marginTop: '3px' }, text: '쓰러진 단원은 의뢰에 성공하면 그대로 복귀하고, 실패하면 일부가 부상으로 빠진다.' }));
}

function squadCard(sq, quest, root) {
  const avg = squadAvgLevel(state, sq.id);
  const power = squadPower(state, sq.id);
  const f = getFormation(sq.formationId);
  const danger = dangerFor(quest, sq.id);
  const dep = deployInfo(sq.id);
  const members = dep.members;
  const selected = sq.id === selectedSquadId;
  const away = isAway(sq);

  const roleLine = members.map((m) => {
    const c = getClass(m.classId);
    const name = c ? c.name : '?';
    // 부상자는 출전 명단에서 빠지므로 흐리게 표시한다.
    return isWounded(m, state.day) ? `(${name})` : name;
  }).join(' · ');

  // 원정 중이면 다른 사정은 볼 것도 없다 — 복귀일과 진행 바만 보여주고 선택을 막는다.
  const left = away ? awayLeft(sq) : 0;
  const total = away ? awayTotal(sq, left) : 0;
  const statusLine = away
    ? el('div', { class: 'col', style: { gap: '2px' } },
      el('div', { class: 'tiny qs-away', text: `원정 중 — ${num(returnDayOf(sq))}일차 복귀 (남은 ${left}일)` }),
      el('div', { class: 'bar qs-sqbar' },
        el('i', { style: { width: `${Math.round((clamp(total - left, 0, total) / Math.max(1, total)) * 100)}%` } })))
    // 부상자가 있어도 남은 인원으로 나갈 수 있다 — 경고색이지 차단이 아니다.
    : dep.fit === 0
      ? el('div', { class: 'tiny', style: { color: 'var(--bad)' }, text: dep.reason || '전원 부상 — 출전 불가' })
      : dep.benched.length
        ? el('div', { class: 'tiny', style: { color: 'var(--gold)' }, text: `부상 ${dep.benched.length}명 제외 · ${dep.fit}명 출전 가능` })
        : (dep.ok ? el('div', { class: 'tiny qs-idle', text: '대기 중 — 오늘 출정할 수 있다' })
          : el('div', { class: 'tiny', style: { color: 'var(--bad)' }, text: dep.reason }));

  return el('div', {
    class: `card qs-sq ${selected && !away ? 'selected' : ''}${away ? ' away' : ''}`,
    title: away ? `${num(returnDayOf(sq))}일차 복귀 — 그때까지 다른 의뢰를 받을 수 없다` : '',
    onClick: () => {
      if (away) { toast(`${sq.name} — ${num(returnDayOf(sq))}일차 복귀. 도시에서 날짜를 넘겨라.`, 'bad'); return; }
      selectedSquadId = sq.id;
      rerender(root);
    },
  },
    el('div', { class: 'row spread center' },
      el('span', { style: { fontWeight: '700', color: away ? 'var(--ember)' : '' } }, sq.name),
      away
        ? el('span', { class: 'tag', style: { color: 'var(--ember)' }, text: '원정 중' })
        : el('span', { class: 'tag', style: { color: danger.color }, text: danger.label })),
    el('div', { class: 'qs-meta' },
      el('span', {}, '인원 ', el('b', { text: `${members.length}/7` })),
      el('span', {}, '출전 ', el('b', { style: { color: dep.benched.length ? 'var(--gold)' : 'var(--ink)' }, text: `${dep.fit}명` })),
      el('span', {}, '평균 ', el('b', { text: `Lv${avg || 0}` })),
      el('span', {}, '전투력 ', el('b', { class: 'num', text: num(power) })),
      el('span', {}, '진형 ', el('b', { text: f ? f.name : '없음' }))),
    roleLine ? el('div', { class: 'tiny faint', text: roleLine }) : null,
    f ? el('div', { class: 'tiny faint', text: formationSummary(f).join(' / ') }) : null,
    statusLine);
}

/* ─────────────────────────── 부분 갱신 ─────────────────────────── */

function rerender(root) {
  root.innerHTML = '';
  render(root, {});
}
