// 전투 화면 — 웨이브 진행 / 캔버스 스테이지 / 전투 로그 / 결과 정산.
// params: { questId, squadId }  또는  { battleCfg, ... } (랜덤 인카운터용)
import { el, num, clamp } from '../core/util.js';
import { GRADE_COLOR, RARITY_COLOR, RARITY_NAME } from '../art/palette.js';
// 세트(신화) 등급 표기용 — RARITY_* 는 전설(4)까지라 세트템 rarity 5 를 못 담는다
import { MYTHIC_COLOR, MYTHIC_NAME, getSet } from '../data/sets.js';
import { getSprite, drawSpriteFrame } from '../art/spritegen.js';
import { getSkill } from '../data/skills.js';
import { getClass } from '../data/classes.js';
import { createBattle, setSkillResolver } from '../battle/engine.js';
import { state, addGold, addLog, save, getMerc, itemsById } from '../game/state.js';
import { questBattleDefs, applyWaveCarry, readWaveCarry, WAVE_HEAL, applyQuestResult } from '../game/quest.js';
import { canPromote, gainExp, mercStats, mercPower, promoteOptionsFor } from '../game/merc.js';
import { autoEquipAll, SLOT_NAME, isSellable, sellItem } from '../game/gear.js';
import { go, toast, confirmDlg } from './app.js';
import * as Squad from '../game/squad.js';

export const meta = { id: 'battle', title: '전투' };

const STAGE_W = 960;
const STAGE_H = 576;
const SPRITE_SCALE = 3;
const LOG_MAX = 90;
/** 이 폭 이하를 "폰"으로 본다. 아래 @media 와 반드시 같은 값이어야 한다 (레이아웃/JS 분기 일치).
 *  ★ 700 → 767 로 맞췄다(10차). css/style.css 는 **767px 이하**에서 내비를 하단 고정으로 깐다.
 *  700 으로 두면 701~767px 구간에서 셸은 하단 고정 내비인데 전투 화면은 PC 모드라
 *  결과 화면의 `.bt-actions`(sticky bottom:0, z-index 6)가 내비(z-index 60) **뒤로 숨는다**.
 *  실측 740x900: 버튼 바 798~900px vs 내비 상단 843px → 57px 가 가려졌다. */
const NARROW_PX = 767;

/** 폰처럼 좁은 화면인가. CSS @media 와 같은 기준을 쓴다. */
function isNarrow() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia) return window.matchMedia(`(max-width: ${NARROW_PX}px)`).matches;
  } catch (e) { /* 아래 폴백 */ }
  return (window.innerWidth || 1280) <= NARROW_PX;
}

/**
 * 폰 세로에서 노리는 **화면상** 스프라이트 셀 폭(CSS px).
 *
 * 스프라이트 한 칸은 논리 32px x `SPRITE_SCALE`(3) = **캔버스 96px** 이다(SPEC §4.1).
 * 캔버스는 `width:100%` 로 축소돼 그려지므로 화면상 셀 폭 = `96 * (표시폭 / 논리폭)` 이다.
 * 여기서 논리폭을 역산한다: `논리폭 = 표시폭 * 96 / PHONE_SPRITE_PX`.
 *
 * 예전에는 폰에서도 가로로 납작한 760x520 을 써서 360px 폭 화면에서 셀이 **42px** 밖에
 * 안 됐다(760 논리폭 -> 336 표시폭 = 0.44배). 누가 뭘 하는지 안 보였다.
 */
const PHONE_SPRITE_PX = 70;
/** 캔버스 논리 크기 하한/상한 (너무 작으면 오버레이가 겹치고, 너무 크면 스프라이트가 다시 작아진다) */
const PHONE_W_MIN = 340;
const PHONE_W_MAX = 640;
const PHONE_H_MIN = 360;
const PHONE_H_MAX = 1100;

/**
 * 폰에서 캔버스가 쓸 수 있는 세로 공간(CSS px).
 *
 * 위(HUD + 전투 바)와 아래(로그 토글 + 하단 고정 내비 + 여백)를 **실측해서** 뺀다.
 * 상수로 박으면 전투 바가 몇 줄로 접히는지에 따라 캔버스가 화면 밖으로 밀린다.
 */
function phoneStageH(canvas, vh) {
  let top = 236;
  let below = 118;
  try {
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      top = Math.max(0, r.top + (window.scrollY || 0));
    }
    let b = 14;                                   // 캔버스 아래 최소 숨통
    const lw = (S && S.logWrap) || document.querySelector('.bt-logwrap');
    if (lw) b += lw.offsetHeight;                 // 로그 토글(+펼쳐져 있으면 로그까지)
    const nav = document.getElementById('nav');
    if (nav && getComputedStyle(nav).position === 'fixed') b += nav.offsetHeight;
    below = b;
  } catch (e) { /* 잴 수 없으면 기본값으로 간다 */ }
  return clamp(vh - top - below, 260, 1200);
}

/**
 * 전투 캔버스의 **논리** 크기.
 *
 * 캔버스는 CSS(`width:100%`)로 화면 폭에 맞춰 줄어든다. PC 기본값(1280x560)은 가로가 2.3배로
 * 납작해서, 폰 세로에서는 높이 230px 짜리 띠가 되고 스프라이트가 42px 로 뭉개진다.
 *
 * 그래서 폰(≤767px)에서는 **세로로 긴 캔버스**를 만든다:
 *  - 논리 **폭**은 스프라이트가 화면상 `PHONE_SPRITE_PX` 로 보이도록 역산한다.
 *  - 논리 **높이**는 실제로 남는 세로 공간을 그 표시 배율로 되돌려 잡는다
 *    (= 캔버스가 화면에 정확히 맞고 세로 공간을 남기지 않는다).
 * 렌더러는 H/W 비를 보고 세로 전용 필드 매핑으로 전환한다(`battle/renderer.js` PORTRAIT_ASPECT).
 *
 * **PC 값(1280x560)은 렌더러 기본값 그대로다 — 768px 이상에서 예전과 완전히 같다.**
 */
function stageSpec(canvas) {
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  if (vw > NARROW_PX) return { w: 1280, h: 560 };
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const dispW = Math.max(240, (canvas && canvas.clientWidth) || (vw - 24));
  // 10px 단위로 끊어 둔다 — 리사이즈 때마다 값이 미세하게 흔들리면 배경을 계속 다시 굽는다.
  const w = clamp(Math.round((dispW * 96) / PHONE_SPRITE_PX / 10) * 10, PHONE_W_MIN, PHONE_W_MAX);
  const scale = dispW / w;                      // 논리 1px 이 화면에서 몇 CSS px 인가
  const h = clamp(Math.round(phoneStageH(canvas, vh) / scale / 10) * 10, PHONE_H_MIN, PHONE_H_MAX);
  return { w, h };
}

/** biome -> [하늘 위, 하늘 아래, 지면] */
const BIOME_BG = {
  plains: ['#33405c', '#556b52', '#6d7d52'],
  forest: ['#1f2d2c', '#2f4636', '#3d5a3a'],
  mountain: ['#2d3142', '#4a5064', '#5d6270'],
  desert: ['#4d3d2b', '#7d6742', '#9d8352'],
  swamp: ['#232c27', '#374030', '#464e39'],
  coast: ['#23394d', '#3d5d73', '#7c7c63'],
  tundra: ['#2f3b4b', '#5c6c7a', '#8c99a4'],
  cave: ['#15111a', '#241d2a', '#302838'],
};

/** 진행 중인 전투 세션. dispose()에서 반드시 비운다. */
let S = null;
let sessionToken = 0;

/* ─────────────────────────── 수명 관리 ─────────────────────────── */

export function dispose() {
  sessionToken++;
  if (!S) return;
  stopLoop();
  detachInput();
  destroyRenderer();
  S.battle = null;
  S = null;
}

/** 캔버스 클릭 / 키보드 리스너 해제. 안 하면 화면을 나가도 입력이 살아 있다. */
function detachInput() {
  if (!S) return;
  if (S.offStageClick) { try { S.offStageClick(); } catch (e) { /* 이미 제거됨 */ } S.offStageClick = null; }
  if (S.offKey) { try { S.offKey(); } catch (e) { /* 이미 제거됨 */ } S.offKey = null; }
  if (S.offResize) { try { S.offResize(); } catch (e) { /* 이미 제거됨 */ } S.offResize = null; }
}

function stopLoop() {
  if (S && S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
}

function destroyRenderer() {
  if (!S || !S.renderer) return;
  const r = S.renderer;
  S.renderer = null;
  for (const fn of ['dispose', 'destroy', 'stop']) {
    if (typeof r[fn] === 'function') { try { r[fn](); } catch (e) { console.warn('[battle] 렌더러 정리 실패', e); } break; }
  }
}

/* ─────────────────────────── 스타일 ─────────────────────────── */

function injectStyle() {
  if (document.getElementById('battle-style')) return;
  document.head.appendChild(el('style', {
    id: 'battle-style',
    text: `
.bt-overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:6px;
  background:rgba(6,4,10,.6);text-align:center;pointer-events:none;z-index:5}
.bt-overlay.on{display:flex}
.bt-overlay b{font-size:24px;letter-spacing:.06em;color:var(--gold)}
/* 진행 대기 상태 — 전장을 그대로 둔 채 플레이어가 직접 눌러 넘긴다 */
.bt-overlay.act{pointer-events:auto;cursor:pointer;background:rgba(6,4,10,.5)}
.bt-go{margin-top:14px;padding:14px 34px;font-size:18px;font-weight:800;letter-spacing:.06em;
  box-shadow:0 0 0 0 rgba(224,180,74,.45);animation:bt-breathe 1.8s ease-in-out infinite}
@keyframes bt-breathe{
  0%,100%{box-shadow:0 0 0 0 rgba(224,180,74,.42)}
  50%{box-shadow:0 0 0 10px rgba(224,180,74,0)}
}
@media (prefers-reduced-motion:reduce){ .bt-go{animation:none} }
.bt-hint{margin-top:8px;font-size:12px;color:var(--ink-dim,#9a93a8);letter-spacing:.03em}
/* 결과 화면 하단 고정 버튼 — 결과창도 자동으로 닫히지 않는다. 플레이어가 직접 나간다 */
.bt-actions{position:sticky;bottom:0;z-index:6;margin-top:14px;display:flex;flex-wrap:wrap;gap:10px;
  align-items:center;justify-content:center;padding:12px;
  background:linear-gradient(180deg,rgba(13,11,18,.55),var(--bg-1));
  border:1px solid var(--line);border-top-color:var(--gold-dim);border-radius:var(--radius)}
.bt-actions .btn.lg{min-width:180px}
.bt-log-ally{color:var(--ink)}
.bt-log-enemy{color:#d09090}
.bt-log-sys{color:var(--gold)}
.bt-log-heal{color:var(--ok)}
/* 판을 가르는 사건은 줄 전체 색으로 구분한다 — 전부 금색이면 웨이브 개시와 전멸이 같아 보인다 */
.bt-log-wave{color:var(--gold);font-weight:700;letter-spacing:.04em}
.bt-log-miss{color:#8a93a8}
.bt-log-buff{color:#8fc7ff}
.bt-log-debuff{color:#c79bd8}
.bt-log-down{color:#ff7a6b;font-weight:700}
.bt-log-downfoe{color:#9fd8a0}
.bt-log-win{color:var(--gold);font-weight:800}
.bt-log-lose{color:#ff6b5c;font-weight:800}
/* 줄 안의 한 조각만 강조 (치명타 숫자 등) */
.bt-mk{font-weight:700}
.bt-mk-crit{color:#ffd166;text-shadow:0 0 6px rgba(255,209,102,.45)}
.bt-mk-kill{color:#ff9d6b}
.bt-mk-down{color:#ff7a6b}
.bt-mk-miss{color:#a8b0c4}
.bt-mk-skill{color:#ffe3a3;font-weight:700}
.bt-mk-stun{color:#d8b4ff;font-weight:700}
.bt-res-head{text-align:center;padding:18px 12px}
.bt-res-head .verdict{font-size:34px;font-weight:900;letter-spacing:.14em}
.bt-mvp{color:var(--gold);font-weight:700}
.bt-item{border:1px solid var(--line);border-radius:var(--radius);padding:10px;background:var(--bg-2)}
.bt-item .nm{font-weight:700}
.bt-note{border-left:3px solid var(--gold);padding:6px 10px;background:rgba(224,180,74,.07);border-radius:0 4px 4px 0}
/* 전과 표는 **자기 안에서** 가로 스크롤한다. 페이지가 옆으로 밀리면 안 된다 */
.bt-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
/* 로그 접기 토글 — 폰에서만 보인다 (PC는 예전처럼 로그가 항상 펼쳐져 있다) */
.bt-logtoggle{display:none;width:100%;min-height:40px;align-items:center;justify-content:space-between;
  gap:8px;padding:8px 12px;border:0;border-top:1px solid var(--line);background:var(--bg-2);
  color:var(--ink-dim);font-family:inherit;font-weight:700;font-size:12px;cursor:pointer}
.bt-logtoggle .cv{color:var(--ink-faint);font-weight:400}
/* 폰 전용 하단 진행 바 — 엄지로 닿는 자리에 다음 웨이브/결과 버튼을 둔다 */
.bt-gobar{display:none}

/* ───────── 모바일 (폰 세로 기준 360x800) ───────── */
@media (max-width:${NARROW_PX}px){
  /* 전투 바: 한 줄에 다 못 들어간다 — 접어서 전부 누를 수 있게 한다.
     ★ 바가 한 줄 늘 때마다 전장 캔버스가 44px 씩 줄어든다(세로가 곧 관전 품질이다).
     제목/랭크/웨이브를 한 줄에 몰고 버튼 5개를 다음 한 줄에 담아 **2줄**로 고정한다. */
  .battle-bar.bt-bar{flex-wrap:wrap;gap:5px;padding:6px 8px}
  .battle-bar.bt-bar .bt-spacer{display:none}
  /* 제목은 남는 폭만 먹고 줄인다(말줄임) — 안 그러면 랭크·웨이브를 다음 줄로 밀어낸다 */
  .battle-bar.bt-bar .bt-title{flex:1 1 0;min-width:72px;font-size:14px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* 웨이브 표시는 제목 줄 끝에 붙여 한 줄을 통째로 아낀다 */
  .battle-bar.bt-bar > .tiny.muted{flex:0 0 auto}
  /* '속도' 라벨은 감추고 **줄바꿈 자리**로 쓴다 (1x/2x/4x 버튼 자체가 설명이다).
     이렇게 해야 버튼 5개가 한 줄에 모여 바가 정확히 2줄로 고정된다 */
  .battle-bar.bt-bar .bt-speedlab{flex:1 0 100%;height:0;margin:-2px 0 0;overflow:hidden;visibility:hidden}
  /* 터치 타겟 40px 하한 (라벨을 줄여도 높이는 유지한다) */
  .battle-bar.bt-bar .btn.sm{min-height:40px;padding:8px 10px;font-size:13px}
  .battle-bar.bt-bar .tag{align-self:center}
  .bt-logtoggle{display:flex}
  .bt-logwrap.bt-off .battle-log{display:none}
  .battle-log.bt-log{height:96px;font-size:12px}
  .bt-overlay b{font-size:20px}
  .bt-overlay .bt-hint{font-size:12px}
  /* bottom 은 placeGoBar() 가 하단 고정 내비 높이만큼 인라인으로 올려 준다 */
  .bt-gobar.on{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:50;
    gap:8px;align-items:center;justify-content:center;padding:10px 12px;
    background:linear-gradient(180deg,rgba(13,11,18,.72),var(--bg-1));border-top:1px solid var(--gold-dim)}
  .bt-gobar .bt-go{margin-top:0;width:100%;max-width:420px;padding:14px 18px;font-size:17px}
  .bt-tablewrap table.data{min-width:460px}
  .bt-res-head{padding:12px 8px}
  .bt-res-head .verdict{font-size:26px}
  /* 결과 버튼은 sticky 를 푼다 — 폰에서는 화면을 잡아먹는 데다, 하단 고정 내비 뒤로 숨는다.
     맨 아래 요소라 조금만 내리면 바로 닿는다 (#screen 에 하단 여백이 잡혀 있다). */
  .bt-actions{position:static;margin-top:10px;padding:10px;gap:8px}
  .bt-actions .btn.lg{flex:1 1 100%;min-width:0;padding:13px 18px}
}
`,
  }));
}

/* ─────────────────────────── 진입 ─────────────────────────── */

function findQuestById(id) {
  for (const cityId of Object.keys(state.quests || {})) {
    const entry = state.quests[cityId];
    const q = ((entry && entry.list) || []).find((x) => x.id === id);
    if (q) return q;
  }
  return null;
}

export function render(root, params = {}) {
  injectStyle();
  dispose();
  const token = ++sessionToken;
  try { setSkillResolver(getSkill); } catch (e) { console.warn('[battle] 스킬 해석기 등록 실패', e); }

  const quest = params.questId ? findQuestById(params.questId) : null;
  const cfgBase = params.battleCfg || null;
  if (!quest && !cfgBase) {
    errorPanel(root, '전투 정보를 찾을 수 없습니다. 의뢰가 만료되었을 수 있습니다.');
    return;
  }

  const squadId = params.squadId || (quest ? ((state.squads || [])[0] || {}).id : null);
  S = {
    token,
    root,
    mode: quest ? 'quest' : 'encounter',
    quest,
    squadId,
    cfgBase,
    title: quest ? quest.name : (params.title || '조우전'),
    rank: quest ? quest.rank : (params.rank || null),
    waveCount: quest ? Math.max(1, (quest.waves || []).length) : 1,
    waveIndex: 0,
    // scene = 전투 배경. 옛 세이브의 의뢰엔 없으니 biome 으로 떨어진다
    biome: quest ? (quest.scene || quest.biome) : (params.biome || (cfgBase && cfgBase.biome) || 'plains'),
    returnTo: params.returnTo || 'city',
    // ★ 복귀 화면에 넘길 params. 예전에는 호출부가 넘겨도 여기서 안 받아서 통째로 버려졌다
    //   (던전이 `returnParams:{dungeonId}` 를 넘겼는데 복귀 화면은 그걸 못 받았다).
    returnParams: params.returnParams || null,
    // 승리 후 "이어서 진행" 버튼. 호출부가 준 경우에만 뜬다 — 전투 화면은 무엇을 이어서
    //   하는지 몰라도 된다(던전이든 탑이든 호출부가 목적지와 params 를 정한다).
    continueLabel: params.continueLabel || null,
    continueParams: params.continueParams || null,
    // 호출부 정산 훅 (던전 세트 조각 등). 돌려준 items 는 전리품 칸에 합쳐진다.
    onResult: typeof params.onResult === 'function' ? params.onResult : null,
    waveIndex: Number.isFinite(params.waveIndex) ? params.waveIndex : 0,
    extraNote: null,
    reward: params.reward || null,
    days: quest ? (quest.days || 1) : (params.days || 0),
    battle: null,
    renderer: null,
    raf: 0, last: 0,
    speed: 1,
    quiet: false,
    closing: false, ended: false, daysDone: false,
    // awaiting = 진행 버튼을 띄우고 플레이어 입력을 기다리는 중 (자동 진행은 없다)
    awaiting: false, skipSettle: false, recorded: false, sinceFinish: 0,
    offStageClick: null, offKey: null, offResize: null,
    // 캔버스 논리 크기 (모바일에서 화면 비율에 맞춰 바뀐다)
    stageW: 0, stageH: 0, logOpen: true,
    rendererSteps: false, externalLog: false,
    carry: {}, finalHp: {}, results: [], totalTime: 0,
    dealt: {}, taken: {}, kills: {}, healed: {}, info: {},
    lines: [],
    applied: null,
  };

  buildUI(root);

  if (!startWave(0)) {
    finishAll(false);
    return;
  }
  attachRenderer(S.canvas, token);
  startLoop();
}

function errorPanel(root, msg) {
  root.appendChild(el('div', { class: 'panel' },
    el('h3', { text: '전투' }),
    el('div', { class: 'muted', text: msg }),
    el('button', { class: 'btn', style: { marginTop: '12px' }, onClick: () => go('city') }, '도시로 돌아가기')));
}

/* ─────────────────────────── UI 구성 ─────────────────────────── */

/**
 * 고를 수 있는 배속.
 *
 * ★ 버튼 목록과 «어느 버튼이 켜졌나» 판정이 **같은 배열**을 봐야 한다 —
 *   예전엔 [1,2,4] 가 두 곳에 손으로 적혀 있어서, 한쪽만 고치면 엉뚱한 버튼에 불이 들어온다.
 *
 * ★ 0.5x 를 넣은 이유: 배속 계산은 정확한데(1배속 = 실시간, 실측 확인) **전투 자체가 짧다.**
 *   레벨이 앞선 부대는 8초 안에 끝나서 «1배속도 빠르다» 로 느껴진다.
 *   느리게 보는 선택지를 주는 편이 시뮬 속도를 건드리는 것보다 안전하다 —
 *   전투 결과는 시뮬 시간으로 정해지므로 **표시 속도를 바꿔도 승패는 안 변한다.**
 */
const SPEEDS = [0.5, 1, 2, 4];

function buildUI(root) {
  const waveLabel = el('span', { class: 'tiny muted' });
  const speedBtns = SPEEDS.map((sp) => el('button', { class: 'btn sm', onClick: () => setSpeed(sp) }, `${sp}x`));

  const bar = el('div', { class: 'battle-bar bt-bar' },
    el('span', { class: 'bt-title', style: { fontWeight: '700' }, text: S.title }),
    S.rank ? el('span', { class: 'tag', style: { color: GRADE_COLOR[S.rank] || '#999' }, text: `${S.rank}랭크` }) : null,
    waveLabel,
    // 폰에서는 이 여백이 줄바꿈을 망가뜨린다 — @media 로 접는다
    el('span', { class: 'bt-spacer', style: { flex: '1' } }),
    el('span', { class: 'tiny faint bt-speedlab', text: '속도' }),
    speedBtns,
    el('button', { class: 'btn sm', onClick: fastForward }, '결과만 보기'),
    el('button', { class: 'btn sm danger', onClick: askRetreat }, '후퇴'));

  const canvas = el('canvas', { width: STAGE_W, height: STAGE_H });
  const overlay = el('div', { class: 'bt-overlay' });
  const stage = el('div', { class: 'battle-stage' }, canvas, overlay);

  // 로그는 폰에서 세로 공간을 많이 먹는다 — 접을 수 있게 한다 (PC는 토글이 숨겨져 늘 펼쳐진 상태)
  const log = el('div', { class: 'battle-log bt-log' });
  const logCv = el('span', { class: 'cv' });
  const logToggle = el('button', { class: 'bt-logtoggle', type: 'button', onClick: toggleLog },
    el('span', { text: '전투 로그' }), logCv);
  const logWrap = el('div', { class: 'bt-logwrap' }, logToggle, log);

  // 폰 전용 하단 진행 바. 패널 밖에 둔다 (패널이 overflow:hidden 이라 안에 두면 헷갈린다)
  const goBar = el('div', { class: 'bt-gobar' });

  root.appendChild(el('div', { class: 'panel', style: { padding: '0', overflow: 'hidden' } }, bar, stage, logWrap));
  root.appendChild(goBar);

  // 렌더러는 동적 import 라 한 박자 늦게 붙는다. 폰에서는 기본 비율(960x576)로 잠깐 그려졌다가
  // 세로 캔버스로 바뀌면서 화면이 크게 튄다 — 미리 최종 비율로 맞춰 둔다.
  // (PC 는 손대지 않는다. 아래 attachRenderer 가 어차피 1280x560 을 넘긴다)
  if (isNarrow()) {
    const sp0 = stageSpec(canvas);
    canvas.width = sp0.w;
    canvas.height = sp0.h;
  }

  S.waveLabel = waveLabel;
  S.speedBtns = speedBtns;
  S.canvas = canvas;
  S.overlay = overlay;
  S.logNode = log;
  S.logWrap = logWrap;
  S.logCv = logCv;
  S.goBar = goBar;
  S.logOpen = !isNarrow();          // 폰에서는 접힌 채로 시작한다
  applyLogState();
  attachInput(stage);
  attachResize();
  setSpeed(1);
  updateBar();
}

/** 로그 접힘 상태를 DOM 에 반영한다 */
function applyLogState() {
  if (!S || !S.logWrap) return;
  S.logWrap.classList.toggle('bt-off', !S.logOpen);
  if (S.logCv) S.logCv.textContent = S.logOpen ? '접기 ▲' : '펼치기 ▼';
}

function toggleLog() {
  if (!S) return;
  S.logOpen = !S.logOpen;
  applyLogState();
  if (S.logOpen && S.logNode) S.logNode.scrollTop = S.logNode.scrollHeight;
}

/**
 * 화면 회전·창 크기 변경에 캔버스 논리 크기를 맞춘다.
 * 리사이즈는 배경을 다시 굽는 비싼 작업이라, **크기 구간이 실제로 바뀔 때만** 부른다.
 */
function attachResize() {
  const token = S.token;
  let timer = 0;
  const onResize = () => {
    if (!S || S.token !== token) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!S || S.token !== token || S.ended) return;
      placeGoBar();          // 내비 높이가 회전으로 달라질 수 있다
      const sp = stageSpec(S.canvas);
      if (sp.w === S.stageW && sp.h === S.stageH) return;
      S.stageW = sp.w;
      S.stageH = sp.h;
      if (S.renderer && typeof S.renderer.resize === 'function') {
        try { S.renderer.resize(sp.w, sp.h); } catch (e) { console.warn('[battle] 캔버스 리사이즈 실패', e); }
      }
    }, 180);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  S.offResize = () => {
    clearTimeout(timer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  };
}

/**
 * 전장 클릭 / 키보드 입력을 건다.
 * - 진행 버튼이 떠 있으면(awaiting) → 다음 웨이브 또는 결과로 진행
 * - 마무리 연출 중이면 → 연출만 즉시 끝내고 버튼을 띄운다 (결과로 바로 가지 않는다)
 * - 전투 중이면 → 아무 일도 일어나지 않는다
 */
function attachInput(stage) {
  const token = S.token;
  const onClick = (ev) => {
    if (!S || S.token !== token || S.ended) return;
    ev.preventDefault();
    pokeStage();
  };
  const onKey = (ev) => {
    if (!S || S.token !== token || S.ended) return;
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    // 입력창/버튼에 포커스가 있으면 그쪽 동작을 방해하지 않는다
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!S.awaiting && !(S.battle && S.battle.finished)) return;
    ev.preventDefault();
    pokeStage();
  };
  stage.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  S.offStageClick = () => stage.removeEventListener('click', onClick);
  S.offKey = () => window.removeEventListener('keydown', onKey);
}

/** 클릭·키 입력 한 번의 의미를 상황에 맞게 해석한다 */
function pokeStage() {
  if (!S || S.ended) return;
  if (S.awaiting) { advanceAfterWave(); return; }
  const b = S.battle;
  // 연출 중 클릭 = 연출 건너뛰기. 결과까지 넘어가지는 않는다 (버튼을 한 번 더 눌러야 한다)
  if (b && b.finished && !S.closing) S.skipSettle = true;
}

function setSpeed(sp) {
  if (!S) return;
  S.speed = sp;
  S.speedBtns.forEach((b, i) => { b.className = `btn sm ${SPEEDS[i] === sp ? 'primary' : ''}`; });
}

function updateBar() {
  if (!S || !S.waveLabel) return;
  S.waveLabel.textContent = S.waveCount > 1 ? `웨이브 ${S.waveIndex + 1} / ${S.waveCount}` : '단일 전투';
}

function hideOverlay() {
  if (!S) return;
  if (S.overlay) {
    S.overlay.classList.remove('on', 'act');
    S.overlay.innerHTML = '';
  }
  if (S.goBar) {
    S.goBar.classList.remove('on');
    S.goBar.innerHTML = '';
  }
}

/**
 * 진행 대기 오버레이 — **자동으로 넘어가지 않는다.**
 * 전장은 그대로 살아 있고(대기 모션·잔여 파티클), 플레이어가 눌러야 다음으로 간다.
 */
function showContinue(title, sub, label) {
  if (!S || !S.overlay) return;
  const btn = el('button', { class: 'btn primary lg bt-go', onClick: (ev) => { ev.stopPropagation(); advanceAfterWave(); } }, label);
  // 폰에서는 전장 한가운데 버튼이 엄지에서 멀다 — 화면 아래 고정 바로 내린다.
  // (전장을 탭해도 넘어가는 것은 그대로다)
  const narrow = isNarrow();
  S.overlay.innerHTML = '';
  // ★ `append` 는 null 을 **"null" 문자열**로 넣어 버린다. 조건부 자식은 배열로 걸러서 붙인다.
  const kids = [
    el('b', { text: title }),
    sub ? el('span', { class: 'muted', text: sub }) : el('span'),
  ];
  if (!narrow) kids.push(btn);
  kids.push(el('div', { class: 'bt-hint', text: narrow ? '전장을 탭하거나 아래 버튼' : '화면 아무 곳이나 클릭 · Enter / Space' }));
  S.overlay.append(...kids);
  S.overlay.classList.add('on', 'act');
  if (S.goBar) {
    S.goBar.innerHTML = '';
    if (narrow) { S.goBar.appendChild(btn); S.goBar.classList.add('on'); placeGoBar(); }
    else S.goBar.classList.remove('on');
  }
  try { btn.focus({ preventScroll: true }); } catch (e) { /* 포커스 실패는 무시 */ }
}

/**
 * 하단 진행 바를 화면 맨 아래 **고정 내비 위**에 올린다.
 *
 * 좁은 화면에서 `#nav` 는 `position:fixed; bottom:0` 인 하단 탭 바다(css/style.css 담당).
 * 그냥 `bottom:0` 으로 두면 진행 버튼이 내비 뒤로 숨는다. 내비 높이는 CSS 쪽에서 언제든
 * 바뀔 수 있으므로 상수로 박지 않고 **그때그때 재서** 올린다. 내비가 고정이 아니면 0이다.
 */
function placeGoBar() {
  if (!S || !S.goBar) return;
  let off = 0;
  try {
    const nav = document.getElementById('nav');
    if (nav) {
      const cs = getComputedStyle(nav);
      if (cs.position === 'fixed') off = Math.max(0, Math.round(window.innerHeight - nav.getBoundingClientRect().top));
    }
  } catch (e) { off = 0; }
  S.goBar.style.bottom = off > 0 ? `${off}px` : '';
}

/* ─────────────────────────── 로그 ─────────────────────────── */

const nameOf = (uid) => (S && S.info[uid] ? S.info[uid].name : '???');
const sideOf = (uid) => (S && S.info[uid] ? S.info[uid].side : 'sys');

/**
 * 전투 로그 한 줄.
 *
 * `text` 에 **부분 강조 마크업**을 쓸 수 있다 — `«…»` 로 감싼 조각에 `parts` 클래스가 붙는다.
 * 줄 전체를 한 색으로만 칠하면 "62 피해" 와 "치명타! 62 피해" 가 구분이 안 된다.
 * 예: pushLog(`${a} → ${b} «치명타» ${n} 피해`, 'ally', 'crit')
 *
 * @param {string} text
 * @param {string} kind  줄 전체 색 (ally/enemy/heal/sys/down/miss/wave/win/lose)
 * @param {string} [mark] «…» 안쪽에 붙일 추가 클래스
 */
function pushLog(text, kind = 'sys', mark = '') {
  if (!S) return;
  S.lines.push({ text: String(text).replace(/[«»]/g, ''), kind });
  if (S.lines.length > 400) S.lines.splice(0, S.lines.length - 400);
  if (S.quiet || !S.logNode) return;

  const row = el('div', { class: `bt-log-${kind}` });
  for (const part of String(text).split(/(«[^»]*»)/g)) {
    if (!part) continue;
    if (part.startsWith('«') && part.endsWith('»')) {
      row.appendChild(el('span', { class: `bt-mk ${mark ? `bt-mk-${mark}` : ''}`, text: part.slice(1, -1) }));
    } else row.appendChild(document.createTextNode(part));
  }
  S.logNode.appendChild(row);
  while (S.logNode.childElementCount > LOG_MAX) S.logNode.removeChild(S.logNode.firstChild);
  S.logNode.scrollTop = S.logNode.scrollHeight;
}

/* ─────────────────────────── 웨이브 ─────────────────────────── */

function buildCfg(i) {
  let cfg;
  if (S.mode === 'quest') cfg = questBattleDefs(S.quest, i, state, S.squadId);
  else cfg = { ...S.cfgBase };
  cfg.getSkill = getSkill;
  if (!cfg.seed) cfg.seed = ((Date.now() >>> 0) ^ (i * 2654435761)) >>> 0;

  // 인계 규칙은 game/quest.js 가 유일한 출처다 — game/forecast.js 도 같은 걸 쓴다.
  // 여기에 사본을 다시 만들면 예보와 실제 전투가 갈라진다 (smoke 가 검사한다).
  cfg.allies = applyWaveCarry(cfg.allies, S.carry);
  return cfg;
}

function startWave(i) {
  let cfg = null;
  try {
    cfg = buildCfg(i);
  } catch (e) {
    console.error('[battle] 전투 구성 실패', e);
    pushLog('전투를 구성하지 못했다.', 'sys');
    return false;
  }
  if (!cfg || !(cfg.allies || []).length) { pushLog('싸울 수 있는 단원이 남지 않았다.', 'sys'); return false; }
  if (!(cfg.enemies || []).length) { pushLog('적을 찾지 못했다.', 'sys'); return false; }

  const b = createBattle(cfg);
  b.biome = cfg.biome || S.biome;
  hookEvents(b);

  for (const u of b.units) {
    S.info[u.uid] = {
      name: u.name, side: u.side, classId: u.classId || null, enemyId: u.enemyId || null,
      level: u.level || 1, grade: u.grade || 'F', boss: !!u.boss, maxHp: u.maxHp,
      // 결과 표에서 단원과 펫을 갈라 놓는 표식 (펫은 경험치·부상이 없다)
      pet: !!u.pet, petRole: u.petRole || null,
    };
  }

  S.battle = b;
  S.waveIndex = i;
  S.closing = false;
  S.awaiting = false;
  S.skipSettle = false;
  S.recorded = false;
  S.sinceFinish = 0;
  updateBar();
  if (S.renderer && typeof S.renderer.setBattle === 'function') {
    try { S.renderer.setBattle(b); } catch (e) { console.warn('[battle] setBattle 실패', e); }
  }
  const foes = b.units.filter((u) => u.side === 'enemy').length;
  pushLog(`── ${i + 1}웨이브 개시 · 적 ${foes}기 ──`, 'wave');
  return true;
}

/** drainEvents 를 가로채 로그·통계를 함께 모은다 (렌더러가 소비해도 놓치지 않도록) */
function hookEvents(b) {
  const real = b.drainEvents;
  b.drainEvents = () => {
    const evs = real();
    if (evs && evs.length) consumeEvents(evs);
    return evs;
  };
}

function consumeEvents(evs) {
  for (const e of evs) {
    switch (e.type) {
      case 'damage': {
        const amt = Math.round(e.amount || 0);
        S.dealt[e.uid] = (S.dealt[e.uid] || 0) + amt;
        S.taken[e.targetUid] = (S.taken[e.targetUid] || 0) + amt;
        if (e.killed) S.kills[e.uid] = (S.kills[e.uid] || 0) + 1;
        if (!S.externalLog) {
          // 치명타·처치는 숫자만 봐서는 안 보인다 — 그 조각만 색을 달리한다
          const dmg = e.crit ? `«치명타 ${num(amt)}»` : `${num(amt)} 피해`;
          const kill = e.killed ? ' · «쓰러뜨렸다»' : '';
          pushLog(`${nameOf(e.uid)} → ${nameOf(e.targetUid)} ${dmg}${kill}`,
            sideOf(e.uid), e.killed ? 'kill' : (e.crit ? 'crit' : ''));
        }
        break;
      }
      case 'heal': {
        const amt = Math.round(e.amount || 0);
        S.healed[e.uid] = (S.healed[e.uid] || 0) + amt;
        if (!S.externalLog) pushLog(`${nameOf(e.uid)} → ${nameOf(e.targetUid)} +${num(amt)} 회복`, 'heal');
        break;
      }
      case 'miss':
        if (!S.externalLog) pushLog(`${nameOf(e.targetUid)}이(가) 공격을 «흘려냈다».`, 'miss', 'miss');
        break;
      case 'death':
        if (!S.externalLog) {
          // 아군이 쓰러진 건 가장 크게 보여야 한다 — 판을 뒤집는 사건이다
          const foe = sideOf(e.targetUid) === 'enemy';
          pushLog(`${nameOf(e.targetUid)} «전투 불능».`, foe ? 'downfoe' : 'down', foe ? '' : 'down');
        }
        break;
      case 'end':
        if (!S.externalLog) {
          pushLog(e.winner === 'ally' ? '적을 모두 쓰러뜨렸다.'
            : e.winner === 'enemy' ? '부대가 무너졌다...' : '양측 모두 물러섰다.',
          e.winner === 'ally' ? 'win' : e.winner === 'enemy' ? 'lose' : 'sys');
        }
        break;
      default:
        break;
    }
  }
}

function recordWave(b) {
  if (S.recorded) return;   // 웨이브당 정확히 한 번만 집계한다 (대기 중 '결과만 보기' 로 중복 호출될 수 있다)
  S.recorded = true;
  readWaveCarry(b.units, S.carry);
  for (const u of b.units) {
    if (u.side !== 'ally') continue;
    S.finalHp[u.uid] = S.carry[u.uid].hp;
  }
  S.totalTime += (b.result && b.result.time) || b.time || 0;
  S.results.push({ ...b.result, finalHp: { ...S.finalHp }, squadId: S.squadId });
}

/**
 * 웨이브가 끝나고 마무리 연출까지 끝났을 때 호출된다.
 * **여기서 자동으로 넘어가지 않는다.** 전장을 그대로 둔 채 진행 버튼만 띄우고,
 * 다음 행동은 전적으로 플레이어가 정한다 (`advanceAfterWave`).
 */
function settleWave() {
  const b = S.battle;
  S.closing = true;
  S.awaiting = true;
  b.drainEvents();
  recordWave(b);
  // 캔버스에도 승패 연출이 떠 있다. 우리 오버레이와 같은 자리라 글자가 겹치므로
  // 넘겨받는다고 알려서 캔버스 쪽을 먼저 걷어낸다 (없는 렌더러여도 무시된다).
  if (S.renderer && typeof S.renderer.skipEnding === 'function') {
    try { S.renderer.skipEnding(); } catch (e) { console.warn('[battle] skipEnding 실패', e); }
  }

  const win = b.winner === 'ally';
  const next = S.waveIndex + 1;
  if (win && next < S.waveCount) {
    const healed = Math.round(WAVE_HEAL * 100);
    showContinue(`${S.waveIndex + 1}웨이브 격퇴`,
      `숨을 고른다 · 체력 ${healed}% 회복 — 준비되면 다음 적을 맞이한다`,
      `다음 웨이브 (${next + 1}/${S.waveCount})`);
    pushLog(`웨이브 정리. 붕대를 감고 자세를 고쳐 잡는다. (체력 ${healed}% 회복)`, 'heal');
  } else {
    showContinue(win ? '승 리' : '패 배',
      win ? '전장을 정리했다.' : '부대가 물러섰다.',
      '결과 보기');
  }
}

/** 진행 버튼(또는 캔버스 클릭·Enter/Space)이 눌렸을 때만 다음 단계로 넘어간다 */
function advanceAfterWave() {
  if (!S || S.ended || !S.awaiting) return;
  S.awaiting = false;
  hideOverlay();

  const b = S.battle;
  const win = !!b && b.winner === 'ally';
  const next = S.waveIndex + 1;
  if (win && next < S.waveCount) {
    if (!startWave(next)) finishAll(false);
    return;
  }
  stopLoop();
  finishAll(win);
}

/* ─────────────────────────── 루프 ─────────────────────────── */

function startLoop() {
  if (!S) return;
  S.last = 0;
  const frame = (now) => {
    if (!S) return;
    S.raf = requestAnimationFrame(frame);
    if (!S.last) S.last = now;
    const dt = Math.min(0.05, (now - S.last) / 1000);
    S.last = now;
    const b = S.battle;
    if (!b) return;

    if (S.renderer) {
      try { S.renderer.speed = S.speed; } catch (e) { /* 속도 프로퍼티가 없어도 진행 */ }
      const t0 = b.time;
      try { S.renderer.update(dt); } catch (e) { console.warn('[battle] renderer.update 실패', e); }
      // 렌더러가 스스로 battle.step 을 돌리는 구현이면 이중 진행을 막는다 (한 번 확인하면 계속 신뢰)
      if (b.time > t0 + 1e-9) S.rendererSteps = true;
      if (!S.rendererSteps && !b.finished) b.step(dt * S.speed);
      b.drainEvents();
      try { S.renderer.draw(); } catch (e) { console.warn('[battle] renderer.draw 실패', e); }
    } else {
      if (!b.finished) b.step(dt * S.speed);
      b.drainEvents();
    }

    // 승패가 갈려도 화면에서는 아직 마지막 타격·사망 연출·승리 텍스트가 재생 중이다.
    // 렌더러가 마무리까지 끝냈다고 할 때(또는 플레이어가 클릭으로 건너뛸 때)까지 기다린 뒤
    // **진행 버튼만** 띄운다. 시간이 지났다고 저절로 넘어가는 경로는 없다.
    if (b.finished && !S.closing && !S.awaiting) {
      S.sinceFinish += dt;
      const r = S.renderer;
      const settled = !r || typeof r.isSettled !== 'function' ? true : r.isSettled();
      // 마지막 항(5초)은 자동 진행이 **아니다** — 렌더러가 오류 등으로 영영 안 끝날 때
      // 버튼만 대신 띄워 주는 안전장치다. 넘어가려면 여전히 플레이어가 눌러야 한다.
      if (settled || S.skipSettle || S.sinceFinish > 5) settleWave();
    }
    // 대기 중에도 rAF는 계속 돈다 — 전장을 그대로 볼 수 있어야 하고,
    // 대기 모션과 남은 파티클이 살아 있어야 한다. 엔진(`b.step`)만 멈춘 상태다.
  };
  S.raf = requestAnimationFrame(frame);
}

/** 남은 웨이브를 즉시 시뮬레이션해 결과로 넘어간다 */
function fastForward() {
  if (!S || S.ended) return;
  stopLoop();
  S.awaiting = false;
  S.quiet = true;
  hideOverlay();

  for (let guard = 0; guard < 12; guard++) {
    const b = S.battle;
    if (!b) break;
    let steps = 0;
    while (!b.finished && steps++ < 400) { b.step(1); b.drainEvents(); }
    b.drainEvents();
    if (!b.finished) break;
    S.closing = true;
    recordWave(b);
    const win = b.winner === 'ally';
    const next = S.waveIndex + 1;
    if (win && next < S.waveCount) {
      if (startWave(next)) continue;
      finishAll(false);
      return;
    }
    finishAll(win);
    return;
  }
  finishAll(false);
}

function askRetreat() {
  if (!S || S.ended) return;
  confirmDlg('후퇴', '지금 물러나면 의뢰는 실패로 처리된다. 정말 후퇴할까?', () => {
    if (!S || S.ended) return;
    stopLoop();
    S.awaiting = false;
    const b = S.battle;
    if (b && !b.finished) {
      b.drainEvents();
      readWaveCarry(b.units, S.carry);
      for (const u of b.units) {
        if (u.side !== 'ally') continue;
        S.finalHp[u.uid] = S.carry[u.uid].hp;
      }
      S.totalTime += b.time;
      S.results.push({
        ...b.result,
        winner: 'enemy',
        time: Math.round(b.time * 100) / 100,
        survivors: b.units.filter((u) => u.alive).map((u) => u.uid),
        finalHp: { ...S.finalHp },
        squadId: S.squadId,
      });
    } else if (S.waveIndex + 1 < S.waveCount) {
      // 웨이브를 이겨 놓고 진행 버튼을 누르지 않은 채 물러난 경우.
      // 남은 웨이브를 패배로 남겨 두지 않으면 `applyQuestResult` 가
      // "기록된 웨이브를 전부 이겼다"고 보고 의뢰를 성공으로 처리해 버린다.
      S.results.push({
        winner: 'enemy', time: 0, survivors: [], damageDealt: {}, kills: {},
        finalHp: { ...S.finalHp }, squadId: S.squadId,
      });
    }
    pushLog('부대가 전열을 버리고 물러났다.', 'sys');
    finishAll(false);
  }, '후퇴한다');
}

/* ─────────────────────────── 결과 ─────────────────────────── */

function finishAll(win) {
  if (!S || S.ended) return;
  S.ended = true;
  S.awaiting = false;
  stopLoop();
  detachInput();          // 결과 화면에서는 캔버스 클릭·Enter/Space가 살아 있으면 안 된다
  destroyRenderer();
  hideOverlay();

  if (S.mode === 'quest') {
    try {
      S.applied = applyQuestResult(S.quest, { results: S.results, squadId: S.squadId });
    } catch (e) {
      console.error('[battle] 결과 정산 실패', e);
      S.applied = { win, gold: 0, exp: 0, renown: 0, items: [], levelUps: [], wounded: [], promotions: [] };
    }
  } else {
    S.applied = applyEncounterResult(win);
  }

  /* ★ 호출부 정산 훅.
   * 던전·탑처럼 이 화면이 모르는 보상 체계는 호출부가 여기서 정산하고 **전리품을 돌려준다.**
   * 이게 없던 동안 던전 세트 조각은 던전 화면에 다시 들어가야만 지급·표시됐고,
   * 도시로 나가 버리면 "드랍했다는 말도 없이 나중에 장비창에 생겨 있는" 상태가 됐다.
   * 훅이 무엇을 하든 이 화면은 결과 배열만 받아 전리품 칸에 얹는다. */
  if (typeof S.onResult === 'function') {
    try {
      const extra = S.onResult({
        win, squadId: S.squadId, waveIndex: S.waveIndex,
        results: S.results, finalHp: { ...S.finalHp },
      });
      const gained = extra && Array.isArray(extra.items) ? extra.items.filter(Boolean) : [];
      if (gained.length) S.applied.items = [...(S.applied.items || []), ...gained];
      if (extra && extra.note) S.extraNote = extra.note;
    } catch (e) {
      console.error('[battle] 호출부 정산 훅 실패', e);
    }
  }

  autoSellLoot();

  try { save(); } catch (e) { console.warn('[battle] 저장 실패', e); }
  renderResult(S.applied.win != null ? S.applied.win : win);
}

/** 인카운터(의뢰 아님) 정산 — HP/부상/경험치만 반영한다 */
function applyEncounterResult(win) {
  const out = { win, gold: 0, exp: 0, renown: 0, items: [], levelUps: [], wounded: [], promotions: [] };
  const idx = itemsById(state.items);
  const rew = S.reward || {};
  const baseExp = Math.round((rew.exp || 0) * (win ? 1 : 0.25));

  for (const [uid, hp] of Object.entries(S.finalHp)) {
    const m = getMerc(uid);
    if (!m) continue;
    let maxHp = m.maxHp || 1;
    try { maxHp = Math.max(1, Math.round(mercStats(m, { items: idx }).hp)); } catch (e) { /* 기존 값 유지 */ }
    m.maxHp = maxHp;
    if (hp <= 0) {
      m.status = 'wounded';
      m.woundUntil = state.day + 3;
      m.hp = 1;
      out.wounded.push({ uid, name: m.name, until: m.woundUntil });
    } else {
      m.status = 'ready';
      m.hp = clamp(Math.round(hp), 1, maxHp);
    }
    if (baseExp > 0) {
      const before = m.level;
      gainExp(m, hp <= 0 ? Math.round(baseExp * 0.6) : baseExp);
      if (m.level > before) out.levelUps.push({ uid, name: m.name, from: before, to: m.level });
    }
    m.battles = (m.battles || 0) + 1;
    m.kills = (m.kills || 0) + (S.kills[uid] || 0);
    let ok = false;
    try { ok = !!canPromote(m); } catch (e) { ok = false; }
    if (ok) out.promotions.push({ uid, name: m.name, level: m.level, classId: m.classId, options: promoteOptionsFor(m) });
  }

  if (win && rew.gold) { addGold(rew.gold); out.gold = rew.gold; }
  if (win && rew.renown) { state.renown = Math.max(0, state.renown + rew.renown); out.renown = rew.renown; }
  out.exp = baseExp;
  addLog(win ? `${S.title} — 습격을 물리쳤다.` : `${S.title} — 밀려나 후퇴했다.`);
  return out;
}

/**
 * 펫 참전 요약 한 줄.
 * 펫은 성장하지 않고 쓰러져도 **다음 전투에 만피로 돌아온다**(부상이 안 남는다) —
 * 표에 "전투 불능"으로 뜨면 손해를 본 것처럼 읽히므로 그 점을 같이 적는다.
 */
function petSummary(petRows) {
  const down = petRows.filter((p) => p.down).length;
  const dealt = petRows.reduce((a, p) => a + p.dealt, 0);
  const healed = petRows.reduce((a, p) => a + p.healed, 0);
  const parts = [];
  if (dealt) parts.push(`피해 ${num(dealt)}`);
  if (healed) parts.push(`회복 ${num(healed)}`);
  return el('div', { class: 'tiny faint', style: { marginTop: '8px', lineHeight: '1.5' } },
    `펫 ${petRows.length}마리 참전`,
    parts.length ? ` — ${parts.join(' · ')}` : '',
    down ? ` · ${down}마리 쓰러짐(다음 전투에 회복된다)` : '',
    el('div', { text: petRows.map((p) => p.info.name).join(' · ') }));
}

function mvpUid(rows) {
  let best = null, score = -1;
  for (const r of rows) {
    const s = r.dealt + r.healed * 1.2 + r.kills * 60;
    if (s > score) { score = s; best = r.uid; }
  }
  return best;
}

function renderResult(win) {
  const root = S.root;
  const a = S.applied || {};
  root.innerHTML = '';

  /* ★ 펫은 단원 표에서 뺀다.
   * 펫은 경험치도 레벨도 없고 부상도 안 남는다(정산 루프가 roster 에서 못 찾아 건너뛴다).
   * 그런데도 표에 섞이면 "전투 불능"만 잔뜩 뜨면서 아무 일도 안 일어나는 것처럼 보인다.
   * 참전 사실은 표 아래 한 줄 요약으로 따로 알린다. */
  const petRows = Object.keys(S.info)
    .filter((uid) => S.info[uid].side === 'ally' && S.info[uid].pet)
    .map((uid) => ({
      uid, info: S.info[uid], dealt: S.dealt[uid] || 0, healed: S.healed[uid] || 0,
      down: (S.finalHp[uid] != null ? S.finalHp[uid] : 1) <= 0,
    }));

  const rows = Object.keys(S.info)
    .filter((uid) => S.info[uid].side === 'ally' && !S.info[uid].pet)
    .map((uid) => ({
      uid,
      info: S.info[uid],
      dealt: S.dealt[uid] || 0,
      taken: S.taken[uid] || 0,
      healed: S.healed[uid] || 0,
      kills: S.kills[uid] || 0,
      down: (S.finalHp[uid] != null ? S.finalHp[uid] : 1) <= 0,
    }))
    .sort((x, y) => y.dealt - x.dealt);
  const mvp = mvpUid(rows);

  const verdictColor = win ? 'var(--gold)' : 'var(--bad)';
  root.appendChild(el('div', { class: 'panel bt-res-head' },
    el('div', { class: 'verdict', style: { color: verdictColor }, text: win ? '승 리' : '패 배' }),
    el('div', { class: 'muted', text: S.title }),
    el('div', { class: 'tiny faint', text: `${S.waveCount}웨이브 중 ${S.results.length}웨이브 진행 · 교전 시간 ${Math.round(S.totalTime)}초` })));

  // 전과 표
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', { text: '단원' }), el('th', { text: '준 피해' }), el('th', { text: '받은 피해' }),
      el('th', { text: '회복' }), el('th', { text: '처치' }), el('th', { text: '상태' }))),
    el('tbody', {}, rows.map((r) => {
      const cls = getClass(r.info.classId);
      return el('tr', {},
        el('td', {},
          el('span', { class: r.uid === mvp ? 'bt-mvp' : '', text: r.info.name }),
          r.uid === mvp ? el('span', { class: 'tag', style: { color: 'var(--gold)', marginLeft: '6px' }, text: 'MVP' }) : null,
          el('div', { class: 'tiny faint' },
            `${cls ? cls.name : '용병'} Lv${r.info.level} · `,
            el('span', { style: { color: GRADE_COLOR[r.info.grade] || '#999' }, text: `${r.info.grade}등급` }))),
        el('td', { class: 'num', text: num(r.dealt) }),
        el('td', { class: 'num muted', text: num(r.taken) }),
        el('td', { class: 'num muted', text: r.healed ? num(r.healed) : '—' }),
        el('td', { class: 'num', text: String(r.kills) }),
        el('td', { style: { color: r.down ? 'var(--bad)' : 'var(--ok)' }, text: r.down ? '전투 불능' : '생존' }));
    })));
  // 표는 좁은 화면에서 6열이 안 들어간다 — 페이지가 아니라 **표가** 옆으로 스크롤되게 감싼다
  root.appendChild(el('div', { class: 'panel', style: { marginTop: '12px' } },
    el('h3', { text: '전과' }),
    el('div', { class: 'bt-tablewrap' }, table),
    petRows.length ? petSummary(petRows) : null));

  // 보상
  const reward = el('div', { class: 'panel', style: { marginTop: '12px' } }, el('h3', { text: '보상' }));
  reward.appendChild(el('div', { class: 'row wrap', style: { gap: '22px' } },
    rewardStat('획득 골드', `${num(a.gold || 0)}G`, 'var(--gold)'),
    rewardStat('경험치', num(a.exp || 0), 'var(--arcane)'),
    rewardStat('명성', `+${a.renown || 0}`, 'var(--steel)')));

  const items = (a.items || []).filter(Boolean);
  reward.appendChild(el('div', { class: 'sep' }));
  if (items.length) {
    reward.appendChild(el('div', { class: 'cards' }, items.map(itemCard)));
    reward.appendChild(lootAutoEquipBlock(items));
  } else {
    reward.appendChild(el('div', { class: 'tiny faint', text: win ? '쓸 만한 전리품은 없었다.' : '전리품은 없다.' }));
  const soldLine = autoSoldLine();
  if (soldLine) reward.appendChild(soldLine);
  }
  root.appendChild(reward);

  // 성장 / 알림
  const notes = [];
  for (const l of a.levelUps || []) notes.push(`${l.name} — Lv${l.from} → Lv${l.to} 레벨 업!`);
  for (const w of a.wounded || []) notes.push(`${w.name} — 부상. ${w.until}일차에 복귀한다.`);
  for (const p of a.promotions || []) {
    const opt = (p.options || []).map((o) => (typeof o === 'string' ? o : o.name)).join(' / ');
    notes.push(`${p.name} (Lv${p.level}) — 전직 가능! ${opt ? `후보: ${opt}` : ''}`);
  }
  if (notes.length) {
    root.appendChild(el('div', { class: 'panel col', style: { marginTop: '12px', gap: '6px' } },
      el('h3', { text: '단원 소식' }),
      notes.map((t) => el('div', { class: 'bt-note tiny', text: t }))));
  }

  // 결과 화면은 자동으로 닫히지 않는다. 아래 버튼을 눌러야 나간다 (하단 고정이라 항상 보인다)
  // "이어서" 는 **이겼을 때만** 뜬다. 지고도 다음 웨이브로 갈 수는 없다.
  const canContinue = win && S && S.continueLabel;
  root.appendChild(el('div', { class: 'bt-actions' },
    canContinue
      ? el('button', { class: 'btn primary lg', onClick: continueBattle }, S.continueLabel)
      : null,
    el('button', {
      class: canContinue ? 'btn lg' : 'btn primary lg',
      onClick: leaveBattle,
    }, canContinue ? '여기서 그만'
      : S && S.returnTo === 'dungeon' ? '던전으로 돌아가기'
        : (S && S.mode === 'quest' && hasReadySquad()) ? '의뢰소로 돌아가기'
          : '도시로 돌아가기'),
    (a.promotions || []).length
      ? el('button', { class: 'btn lg', onClick: () => { finalizeDays(); go('company'); } }, '전직하러 가기')
      : null,
    el('span', { class: 'tiny faint', text: '전과를 다 확인한 뒤 눌러라. 화면은 저절로 넘어가지 않는다.' })));
}

/* ─────────────────────────── 전리품 자동 판매 ─────────────────────────── */

/**
 * 설정된 등급 이하의 전리품을 그 자리에서 판다 (`state.autoSellRarity`, -1 = 끔).
 *
 * ★ 팔 수 있는지는 반드시 `Gear.isSellable` 로 묻는다 — 신화(세트)·착용 중 판정의
 *   유일한 출처다. `sellItem` 자체는 아무것도 안 막으므로 여기서 안 거르면 세트 조각이 팔린다.
 *   (자동 판매는 되돌릴 수 없어서, 이 한 줄이 없으면 던전 보상이 조용히 사라진다.)
 */
function autoSellLoot() {
  if (!S || !S.applied) return;
  const th = Math.round(Number(state.autoSellRarity));
  if (!Number.isFinite(th) || th < 0) return;

  const items = (S.applied.items || []).filter(Boolean);
  if (!items.length) return;

  const keep = [];
  const sold = [];
  let gold = 0;
  for (const it of items) {
    if ((it.rarity || 0) > th || !isSellable(it, state)) { keep.push(it); continue; }
    const r = sellItem(state, it.uid);
    if (r && r.ok) { gold += r.gold; sold.push(it); } else keep.push(it);
  }
  if (!sold.length) return;

  S.applied.items = keep;
  S.autoSold = { count: sold.length, gold, names: sold.map((x) => x.name) };
  addLog(`전리품 ${sold.length}점을 현장에서 팔아 ${num(gold)}G를 챙겼다.`);
}

/** 결과 화면에 붙는 자동 판매 한 줄 */
function autoSoldLine() {
  const a = S && S.autoSold;
  if (!a) return null;
  return el('div', { class: 'tiny', style: { marginTop: '8px', color: 'var(--gold-dim)', lineHeight: '1.5' } },
    `자동 판매 ${a.count}점 → +${num(a.gold)}G`,
    el('div', { class: 'faint', text: a.names.join(' · ') }));
}

/* ─────────────────────────── 전리품 자동 착용 ─────────────────────────── */

/** 결과창 전리품 아래에 붙는 자동 착용 버튼 + 결과 표시 영역 */
function lootAutoEquipBlock(items) {
  const box = el('div', { class: 'col', style: { gap: '4px' } });
  const btn = el('button', { class: 'btn primary' }, '획득 장비 자동 착용');
  btn.onclick = () => runLootAutoEquip(items, btn, box);
  return el('div', { class: 'col', style: { gap: '8px', marginTop: '12px' } },
    el('div', { class: 'row wrap center', style: { gap: '10px' } },
      btn,
      el('span', { class: 'tiny faint', text: '이번 전투에서 얻은 장비만 배분한다. 전 단원 중 전투력이 높은 쪽이 먼저 고른다.' })),
    box);
}

function runLootAutoEquip(items, btn, box) {
  box.innerHTML = '';
  if (!(state.roster || []).length) {
    box.appendChild(el('div', { class: 'bt-note tiny', text: '장비를 맡길 단원이 없다.' }));
    return;
  }
  let res = null;
  try {
    res = autoEquipAll(state, { pool: items.map((it) => it.uid), powerOf: (m) => mercPower(m, state) });
  } catch (e) {
    console.error('[battle] 전리품 자동 착용 실패', e);
    toast('자동 착용에 실패했다.', 'bad');
    return;
  }

  if (!res.total) {
    box.appendChild(el('div', { class: 'bt-note tiny', text: '더 좋은 장비가 없다 — 지금 낀 것이 낫다. 전리품은 창고에 넣어 뒀다.' }));
    btn.disabled = true;
    return;
  }

  for (const row of res.perMerc) {
    if (!row.changed.length) continue;
    const line = el('div', { class: 'bt-note tiny row wrap center', style: { gap: '6px' } },
      el('b', { style: { color: GRADE_COLOR[row.merc.grade] || 'var(--ink)' }, text: row.name }));
    for (const ch of row.changed) {
      line.append(
        el('span', { class: 'tag', style: { color: 'var(--ink-dim)' }, text: SLOT_NAME[ch.slot] || ch.slot }),
        el('span', { style: { color: RARITY_COLOR[ch.to.rarity || 0], fontWeight: '700' }, text: ch.to.name }),
        el('span', { class: 'faint', text: ch.from ? `← ${ch.from.name} 해제` : '← 빈 슬롯' }));
    }
    box.appendChild(line);
  }
  box.appendChild(el('div', { class: 'tiny faint', text: `${res.total}칸 착용. 나머지 전리품은 창고에 있다.` }));

  addLog(`전리품을 곧바로 나눠 끼웠다 (${res.total}칸).`);
  try { save(); } catch (e) { console.warn('[battle] 저장 실패', e); }
  toast(`${res.total}칸을 자동으로 착용시켰습니다.`, 'good');
  btn.disabled = true;
  btn.textContent = '착용 완료';
}

const rewardStat = (k, v, color) => el('div', { class: 'col', style: { gap: '2px' } },
  el('span', { class: 'tiny faint', text: k }),
  el('span', { class: 'num', style: { fontSize: '20px', fontWeight: '800', color } , text: v }));

function itemCard(it) {
  /* ★ 세트(신화) 아이템은 rarity 5 인데 RARITY_NAME/COLOR 는 0~4(일반~전설)까지뿐이다.
   * 그대로 찍으면 "undefined · 아이템 레벨 71" 이 나온다 — 던전 세트 조각이 전부 그랬다.
   * 등급 이름 자리에 세트 이름을 같이 보여 줘 무슨 세트 조각인지 바로 알게 한다. */
  const r = it.rarity || 0;
  const mythic = r >= RARITY_NAME.length;
  const color = mythic ? MYTHIC_COLOR : RARITY_COLOR[r];
  const setName = mythic && it.setId ? (getSet(it.setId)?.name || '') : '';
  const gradeText = mythic ? `${MYTHIC_NAME}${setName ? ` · ${setName} 세트` : ''}` : RARITY_NAME[r];
  const statLine = Object.entries(it.stats || {}).map(([k, v]) => `${STAT_LABEL[k] || k} +${v}`).join(', ');
  return el('div', { class: 'bt-item' },
    el('div', { class: 'nm', style: { color }, text: it.name }),
    el('div', { class: 'tiny faint', text: `${gradeText} · 아이템 레벨 ${it.ilvl || 1}` }),
    el('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: statLine || '옵션 없음' }));
}

const STAT_LABEL = { hp: '체력', atk: '공격', def: '방어', res: '저항', spd: '속도', crit: '치명', critDmg: '치명피해', eva: '회피' };

/**
 * 결과창을 떠나기 전 마무리. **날짜는 넘기지 않는다** —
 * 이제 일수 경과는 플레이어가 도시에서 직접 처리한다 (전투가 임의로 날짜를 먹지 않는다).
 */
function finalizeDays() {
  if (!S || S.daysDone) return;
  S.daysDone = true;
  try { save(); } catch (e) { console.warn('[battle] 저장 실패', e); }
}

/**
 * 아직 내보낼 부대가 남았는가 (원정 중이 아니고, 세울 수 있는 단원이 있는 부대).
 * 의뢰를 마치고 어디로 돌아갈지 정하는 데 쓴다.
 */
function hasReadySquad() {
  for (const sq of state.squads || []) {
    if (!sq || sq.status === 'away') continue;
    try {
      const chk = Squad.canDeploy(state, sq.id);
      if (chk && chk.ok) return true;
    } catch (e) { /* 판정 실패는 '없음'으로 본다 */ }
  }
  return false;
}

function leaveBattle() {
  /* 의뢰를 마치면 예전에는 무조건 도시로 갔다. 그런데 부대가 여럿이면
   * 도시 → 의뢰소로 한 번 더 눌러야 다음 부대를 내보낼 수 있었다.
   * **아직 내보낼 부대가 남았으면 의뢰소로** 돌려보낸다 — 그게 바로 할 일이다.
   * 남은 부대가 없으면 도시로 간다(거기서 날짜를 넘겨야 하므로). */
  let target = (S && S.returnTo) || 'city';
  if (S && S.mode === 'quest') target = hasReadySquad() ? 'quests' : 'city';
  const params = (S && S.returnParams) || {};
  finalizeDays();
  go(target, params);
}

/** 승리 후 "이어서" — 호출부가 정해 준 곳으로 params 와 함께 넘어간다 */
function continueBattle() {
  if (!S || !S.continueLabel) return;
  const target = S.returnTo || 'city';
  const params = S.continueParams || S.returnParams || {};
  finalizeDays();
  go(target, params);
}

/* ─────────────────────────── 렌더러 연결 ─────────────────────────── */

async function attachRenderer(canvas, token) {
  let create = null;
  try {
    const mod = await import('../battle/renderer.js');
    create = mod.createRenderer || mod.default || null;
  } catch (e) {
    console.warn('[battle] renderer.js 를 불러오지 못했습니다. 간이 렌더러로 진행합니다.', e);
  }
  if (!S || S.token !== token || S.ended) return;

  if (typeof create === 'function') {
    try {
      // 논리 크기를 화면에 맞춰 넘긴다. PC 구간은 렌더러 기본값(1280x560)과 같은 값이다.
      const sp = stageSpec(canvas);
      S.stageW = sp.w;
      S.stageH = sp.h;
      const r = create(canvas, { biome: S.biome, width: sp.w, height: sp.h });
      if (r && typeof r.update === 'function' && typeof r.draw === 'function') S.renderer = r;
    } catch (e) {
      console.warn('[battle] 렌더러 생성 실패 — 간이 렌더러로 대체합니다.', e);
    }
  }
  if (!S.renderer) S.renderer = createSimpleRenderer(canvas, S.biome);
  S.renderer.speed = S.speed;
  if (typeof S.renderer.setBattle === 'function') {
    try { S.renderer.setBattle(S.battle, { biome: S.biome }); } catch (e) { console.warn('[battle] setBattle 실패', e); }
  }
  // 렌더러가 더 풍부한 로그 문구를 만들어 주면 그쪽을 쓴다 (중복 방지)
  if (typeof S.renderer.onLog === 'function') {
    S.externalLog = true;
    try {
      // 렌더러가 종류·강조까지 실어 준다. 예전엔 문자열만 받아 전부 'ally'(흰색)로 칠했다.
      S.renderer.onLog((text, kind, mark) => {
        if (S && S.token === token) pushLog(text, kind || 'ally', mark || '');
      });
    } catch (e) {
      S.externalLog = false;
      console.warn('[battle] 로그 구독 실패', e);
    }
  }
}

/**
 * 최소 기능 렌더러 (battle/renderer.js 가 없거나 실패했을 때만 쓰인다).
 * 배경 + 스프라이트 + HP/게이지 바 + 피해 숫자만 그린다.
 */
function createSimpleRenderer(canvas, biome) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const HORIZON = Math.round(H * 0.42);
  const pal = BIOME_BG[biome] || BIOME_BG.plains;
  const px = (fx) => (fx / 100) * W;
  const py = (fy) => HORIZON + (fy / 60) * (H - 40 - HORIZON);
  let battle = null;
  const pops = [];
  const flash = new Map();
  const sprites = new Map();

  const spriteOf = (u) => {
    if (sprites.has(u.uid)) return sprites.get(u.uid);
    let s = null;
    try { s = getSprite(u.recipe || {}); } catch (e) { console.warn('[battle] 스프라이트 생성 실패', e); }
    sprites.set(u.uid, s);
    return s;
  };

  return {
    speed: 1,
    setBattle(b) { battle = b; pops.length = 0; flash.clear(); sprites.clear(); },
    update(dt) {
      if (!battle) return;
      for (const e of battle.drainEvents()) {
        if (e.type === 'damage') {
          const u = battle.unitOf(e.targetUid);
          if (u) pops.push({ x: px(u.x), y: py(u.y) - 86, t: 0, text: String(Math.round(e.amount)), crit: !!e.crit });
          flash.set(e.targetUid, 0.14);
        } else if (e.type === 'heal') {
          const u = battle.unitOf(e.targetUid);
          if (u) pops.push({ x: px(u.x), y: py(u.y) - 86, t: 0, text: `+${Math.round(e.amount)}`, heal: true });
        }
      }
      for (let i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > 0.85) pops.splice(i, 1); }
      for (const key of [...flash.keys()]) {
        const v = flash.get(key) - dt;
        if (v <= 0) flash.delete(key); else flash.set(key, v);
      }
    },
    draw() {
      const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
      g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, HORIZON);
      const g2 = ctx.createLinearGradient(0, HORIZON, 0, H);
      g2.addColorStop(0, pal[2]); g2.addColorStop(1, '#12101a');
      ctx.fillStyle = g2; ctx.fillRect(0, HORIZON, W, H - HORIZON);
      if (!battle) return;

      const order = battle.units.slice().sort((a, b) => a.y - b.y);
      for (const u of order) {
        const x = px(u.x), y = py(u.y);
        ctx.save();
        ctx.globalAlpha = u.alive ? 0.32 : 0.16;
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x, y, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        const sp = spriteOf(u);
        const frame = !u.alive ? 'die3' : (flash.has(u.uid) ? 'hit0' : 'idle0');
        if (sp) {
          drawSpriteFrame(ctx, sp, frame, x, y, {
            scale: SPRITE_SCALE, flip: u.side === 'enemy',
            alpha: u.alive ? 1 : 0.45, flash: flash.has(u.uid) ? 0.7 : 0,
          });
        }
        if (!u.alive) continue;

        const bw = 52, bx = x - bw / 2, by = y - 128;
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 8);
        ctx.fillStyle = u.side === 'ally' ? '#c8563f' : '#8a4a6a';
        ctx.fillRect(bx, by, bw * clamp(u.hp / u.maxHp, 0, 1), 5);
        ctx.fillStyle = '#e0b44a';
        ctx.fillRect(bx, by + 6, bw * clamp(u.gauge / 100, 0, 1), 2);

        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = u.boss ? '#f0d24a' : (GRADE_COLOR[u.grade] || '#ddd');
        ctx.fillText(`${u.boss ? '◆ ' : ''}${u.name} Lv${u.level}`, x, by - 5);
      }

      ctx.textAlign = 'center';
      for (const p of pops) {
        const k = p.t / 0.85;
        ctx.globalAlpha = 1 - k * k;
        ctx.font = `${p.crit ? 'bold 26px' : '18px'} sans-serif`;
        ctx.fillStyle = p.heal ? '#8fe0a0' : (p.crit ? '#ffd75a' : '#ff9c86');
        ctx.fillText(p.text, p.x, p.y - k * 34);
      }
      ctx.globalAlpha = 1;
    },
    dispose() { battle = null; pops.length = 0; flash.clear(); sprites.clear(); },
  };
}
