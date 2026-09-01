// 도시 허브 화면 — 시설 진입(주점/의뢰소/상점/대장간) · 휴식 · 요약 패널.
// 상점과 대장간은 별도 라우트가 없으므로 이 화면 안에서 모달로 처리한다.
import { el, num, clamp } from '../core/util.js';
import { rng } from '../core/rng.js';
import {
  state, advanceDays, refreshCity, addLog, addGold, addItem, save, REFRESH_DAYS,
} from '../game/state.js';
// restAtInn / 파견 헬퍼는 나중에 추가되는 함수라 이름 import 하면 없을 때 모듈 전체가 죽는다.
// 네임스페이스로 받아 존재할 때만 호출한다.
import * as GameState from '../game/state.js';
import { getCity, cityRegion, cityBiome, neighbors } from '../data/world.js';
// citySpecialty(도시 특화 클래스)는 나중에 붙은 API라 이름 import 하면 없을 때 모듈이 죽는다.
import * as World from '../data/world.js';
// 던전 데이터(주차별 개방)는 순수 데이터 모듈이다. 여기서는 "이번 주에 뭐가 열리나"만 읽는다 —
// 입장 판정·전투는 월드맵 노드 쪽 소관이다. 함수 유무는 항상 확인하고 쓴다.
import * as Dungeons from '../data/dungeons.js';
import { getClass } from '../data/classes.js';
import { squadMembers, squadAvgLevel, squadUpkeep, squadPower, SQUAD_SIZE } from '../game/squad.js';
import * as Squad from '../game/squad.js';
import { isWounded, mercStats } from '../game/merc.js';
// 다음 전직 시점(nextPromoteLevel/canPromote) · 서브랭크/정예(quest API) 는 1단계에서 붙은
// 함수라, 이름 import 하면 없는 빌드에서 모듈이 죽는다. 네임스페이스로 받아 방어적으로 쓴다.
import * as Merc from '../game/merc.js';
import * as Quest from '../game/quest.js';
import {
  inventory, sellItem, sellPrice, itemStats, itemValue, rollItem,
  ownerOf, weaponTypeName, josa, SLOT_NAME,
  /* ★ 판매 가능 판정의 유일한 출처 — 손으로 다시 쓰지 않는다 */
  isSellable,
} from '../game/gear.js';
import { RARITY_COLOR, RARITY_NAME, GRADE_COLOR } from '../art/palette.js';
import { getSprite, drawSpriteFrame } from '../art/spritegen.js';
import { go, refresh, toast, modal } from './app.js';
import * as Tower from '../game/tower.js';
import * as Abyss from '../game/abyss.js';
import * as Progress from '../game/progress.js';
/* ★ 판매를 서버에 먼저 묻는다 (§104 10단계 · 권위). 못 물으면 오늘 동작이다. */
import { askSell } from '../net/mirror.js';

export const meta = { id: 'city', title: '도시' };

/* ─────────────────────────── 표기용 상수 ─────────────────────────── */

const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const BIOME_NAME = {
  plains: '평야', forest: '숲', mountain: '산악', desert: '사막',
  swamp: '늪지', coast: '해안', tundra: '설원', cave: '동굴',
};
const SERVICE_NAME = { tavern: '주점', shop: '상점', guild: '의뢰소', smith: '대장간' };
const STAT_LABEL = {
  hp: '체력', atk: '공격', def: '방어', res: '저항',
  spd: '속도', crit: '치명', critDmg: '치명피해', eva: '회피',
};

/** 하루 숙박비 (단원 수에 비례) */
const restFee = (days) => days * (20 + state.roster.length * 6);
/** 재감정 수수료 */
const reforgeFee = (item) => Math.max(30, Math.round((item.value || itemValue(item)) * 0.45));

/* 회복 수치 — 실제 회복은 game/state.js 가 처리한다. 여기 값은 여관 모달의
   "예상치" 계산에만 쓰이므로, 수치가 어긋나지 않게 state.js 의 상수를 그대로 읽는다.
   (아직 없는 버전이면 설계값으로 대체한다.) */
const HEAL_READY = GameState.RECOVER_READY ?? 0.30;      // 정상 단원 하루 자연 회복 (maxHp 비율)
const HEAL_WOUNDED = GameState.RECOVER_WOUNDED ?? 0.20;  // 부상 단원 하루 자연 회복
const HEAL_INN = GameState.REST_HEAL ?? 0.45;            // 여관 숙박 1일당 추가 회복
const WOUND_SPEEDUP = GameState.REST_WOUND_SPEEDUP ?? 1; // 숙박 1일당 부상 기간 추가 단축
/** 여관 1일당 부상 잔여 기간이 줄어드는 총 일수 (날짜 경과 1 + 추가 단축) */
const REST_WOUND_STEP = 1 + WOUND_SPEEDUP;

const CSS = `
/* 접기 버튼 — 머리말 오른쪽에 작게 */
.city-fold { flex: 0 0 auto; font-size: 12px; padding: 2px 8px; opacity: .75; }
.city-fold:hover { opacity: 1; }
@media (max-width: 767px) { .city-fold { font-size: 12px; padding: 4px 10px; } }

/* 「지금 할 일」 — 첫 화면에서 가장 먼저 눈에 들어와야 한다 */
.city-next { border-color: rgba(224,180,74,.45); background: rgba(224,180,74,.07); }
.city-next-t { font-size: 15px; font-weight: 700; color: var(--ink); line-height: 1.4; }
.city-next-tag { display:inline-block; font-size:11px; font-weight:700; color:var(--gold);
                 background:rgba(224,180,74,.16); border-radius:99px; padding:1px 8px; margin-right:7px;
                 vertical-align:middle; }
@media (max-width: 767px) { .city-next-t { font-size: 14px; } .city-next-tag { font-size: 12px; } }

.city-hero { display:flex; gap:20px; justify-content:space-between; flex-wrap:wrap; }
.city-hero h2 { margin:0 0 4px; font-size:22px; letter-spacing:.02em; }
.city-hero .desc { max-width:640px; }
.city-facilities { grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); }
.city-fac { display:flex; flex-direction:column; gap:5px; min-height:126px; }
.city-fac .fac-head { display:flex; gap:6px; align-items:center; justify-content:space-between; }
.city-fac .fac-name { font-weight:700; font-size:15px; color:var(--ink); }
.city-fac .fac-foot { margin-top:auto; padding-top:8px; display:flex; gap:8px;
  align-items:flex-end; justify-content:space-between; }
.city-fac .fac-foot .btn { flex:0 0 auto; }
.city-fac.off { opacity:.4; cursor:not-allowed; }
.city-fac.off:hover { transform:none; border-color:var(--line); }
/* 지금 눌러야 하는 시설 (부상자가 있을 때의 휴식 등) */
.city-fac.urgent { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold-dim) inset; }
.city-fac.urgent .fac-name { color:var(--gold); }
.fac-badge { display:inline-block; padding:0 7px; border-radius:999px; font-size:10px;
  font-weight:800; line-height:1.8; white-space:nowrap; background:var(--bad); color:#1a0f13; }

/* 부상자 경고 배너 — 화면 최상단 */
.city-alert { display:flex; gap:16px; align-items:center; flex-wrap:wrap;
  padding:13px 16px; border:1px solid var(--bad); border-left-width:4px; border-radius:var(--radius);
  background:linear-gradient(180deg, rgba(207,90,90,.15), rgba(207,90,90,.05)); }
.city-alert .alert-main { flex:1 1 300px; min-width:0; }
.city-alert .alert-title { font-weight:800; font-size:15px; color:#f0b4b4; }
.city-alert .alert-acts { display:flex; gap:8px; flex-wrap:wrap; }
.city-alert .alert-names { display:flex; gap:4px 14px; flex-wrap:wrap; margin-top:5px; }
.city-hurt { display:flex; gap:4px 14px; flex-wrap:wrap; }
.city-hurt > span { white-space:nowrap; }
.city-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(310px, 1fr)); gap:12px; align-items:start; }
.city-warn { display:flex; gap:8px; align-items:flex-start; padding:7px 10px; border-radius:4px;
  border-left:3px solid var(--gold-dim); background:rgba(224,180,74,.07); }
.city-warn.bad { border-left-color:var(--bad); background:rgba(207,90,90,.08); }
.city-warn.ok { border-left-color:var(--ok); background:rgba(111,174,122,.07); }
.city-stars { letter-spacing:2px; color:var(--gold); }
.city-mini { display:flex; gap:10px; align-items:center; }
.city-mini .sprite-box { padding:2px 4px; flex:0 0 auto; }
.city-mini-cards { grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); }
.city-mini-cards .card { padding:9px 10px; }
.city-list { display:flex; flex-direction:column; gap:8px; }
.city-krow { display:flex; gap:10px; align-items:center; justify-content:space-between; }
.city-dlg { max-height:52vh; overflow:auto; }
.city-dlg table.data th { position:sticky; top:0; background:var(--bg-2); z-index:1; }

/* 날짜 진행 패널 — 이제 날짜는 플레이어가 직접 넘긴다. 화면 최상단에 크게 둔다. */
.city-time { display:flex; gap:20px; align-items:center; flex-wrap:wrap;
  padding:14px 18px; border:1px solid var(--gold-dim); border-radius:var(--radius);
  background:linear-gradient(180deg, rgba(224,180,74,.12), rgba(224,180,74,.02)); }
.city-time .t-day { display:flex; flex-direction:column; gap:1px; min-width:186px; }
.city-time .t-day .t-co { font-weight:800; font-size:13px; color:var(--gold-dim); letter-spacing:.05em; }
.city-time .t-day b { font-size:23px; font-weight:900; color:var(--gold); line-height:1.2;
  font-variant-numeric:tabular-nums; }
.city-time .t-mid { flex:1 1 260px; min-width:0; display:flex; flex-direction:column; gap:4px; }
.city-time .t-acts { display:flex; gap:8px; flex-wrap:wrap; }
.city-time .t-acts .btn { min-width:156px; max-width:230px; text-align:center; }
.city-time .t-acts .btn .t-cost { display:block; font-size:11px; font-weight:600; opacity:.85; }
/* 주가 바뀌는 버튼에만 붙는 예고 — 무엇이 열리는지 누르기 전에 보인다 */
.city-time .t-acts .btn .t-week { display:block; margin-top:2px; font-size:10px; font-weight:800;
  color:var(--gold); }

/* 이번 주 던전 — 달력 주차가 곧 열리는 던전이다 (N주차 = N번 던전) */
.city-week { display:flex; gap:3px 10px; flex-direction:column;
  padding:7px 10px; border-radius:4px; border-left:3px solid var(--gold-dim);
  background:rgba(224,180,74,.08); }
.city-week .w-row { display:flex; gap:6px; align-items:baseline; flex-wrap:wrap; }
.city-week .w-now { font-weight:800; color:var(--gold); }
.city-week .w-dun { color:var(--gold); font-weight:800; }
.city-week .w-next b { color:var(--ember); }
.city-week .w-shut { color:var(--ink-faint); }

/* 부대 원정 상태 */
.sq-away { color:var(--ember); font-weight:700; }
.sq-idle { color:var(--ok); font-weight:700; }
.sq-bar { width:104px; margin-top:4px; }
.sq-bar > i { background:linear-gradient(90deg,#7a4a22,var(--ember)); }
tr.row-away td { background:rgba(209,100,44,.07); }

/* 도시 평판 — 이 도시가 우리를 얼마나 아는가. 주점 개방 여부가 여기에 걸려 있다. */
.city-rep { margin-top:12px; padding:10px 12px; max-width:640px;
  border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-2); }
.city-rep .rep-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.city-rep .rep-num { font-family:var(--mono); font-weight:800; font-size:16px; }
.city-rep .rep-delta { font-family:var(--mono); font-weight:800; }
.city-rep .bar { height:9px; margin-top:7px; position:relative; }
.city-rep .bar > i { background:linear-gradient(90deg,#5a4a2a,var(--gold)); }
.city-rep .rep-mark { position:absolute; top:-3px; bottom:-3px; width:2px;
  background:var(--bad); opacity:.9; }
.city-rep .rep-scale { display:flex; justify-content:space-between; margin-top:3px; }

/* 이 도시가 배출하는 클래스 */
.city-spec { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:9px; }
.city-spec .spec-badge { display:inline-block; padding:0 8px; border-radius:999px;
  font-size:10px; font-weight:800; line-height:1.9; background:var(--gold-dim); color:#1a1408; }
.city-log-rep { color:var(--gold); }

/* 의뢰소 요약 — 서브랭크까지 반영한 랭크 배지. '+'(고난도)는 진하게, '-'(입문)는 흐리게 */
.city-subtag.sub-plus { border:1px solid currentColor; box-shadow:0 0 6px -2px currentColor; font-weight:800; }
.city-subtag.sub-minus { opacity:.62; }

/* 정예 의뢰 알림 배너 */
.city-elite { display:flex; gap:8px; align-items:flex-start; padding:8px 11px; border-radius:var(--radius);
  border:1px solid var(--bad); border-left-width:4px;
  background:linear-gradient(180deg, rgba(207,90,90,.16), rgba(207,90,90,.04)); }
.city-elite .el-mark { color:var(--bad); font-weight:900; }
.city-elite b { color:#f0b4b4; }
.city-krow .qs-elite-tag { display:inline-block; margin-left:5px; padding:0 6px; border-radius:999px;
  font-size:9px; font-weight:900; background:var(--bad); color:#1a0f13; vertical-align:middle; }

/* 부대 현황 — 다음 전직 목표 */
.sq-promo-ready { color:var(--gold); font-weight:700; }
.sq-promo-max { color:var(--gold-dim); }

/* 넓은 표(부대 현황 7열)는 페이지가 아니라 자기 컨테이너 안에서만 가로 스크롤한다. */
.city-tablewrap { max-width:100%; }
/* 가로로 밀어야 한다는 안내는 폰에서만 띄운다 */
.city-scrollhint { display:none; }

/* ══════════════════ 모바일 대응 ══════════════════
 * 전부 @media 안에만 있다 — 1280px 레이아웃은 한 픽셀도 바뀌지 않는다.
 * ≤900  시설 카드 2열 이하 · 날짜 버튼 그리드 (태블릿 세로 768 포함)
 * ≤767  1열 · 터치 타겟 40px 이상 · 글자 12px 하한 · 부상자 배너를 맨 위로
 *       (767 = css/style.css 의 공용 모바일 기준선. 어긋나면 어중간한 폭이 생긴다) */
@media (max-width:900px) {
  /* 날짜 넘기기는 이 게임의 주요 조작이다. 폰에서는 꽉 찬 큰 버튼으로 깐다. */
  .city-time { gap:12px; padding:12px 14px; }
  .city-time .t-day { min-width:0; flex:1 1 100%; }
  .city-time .t-acts { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));
    gap:8px; width:100%; }
  .city-time .t-acts .btn { min-width:0; max-width:none; width:100%; min-height:56px;
    padding:9px 8px; white-space:normal; }
}

@media (max-width:767px) {
  /* 11px 이하는 폰에서 안 읽힌다 (.tiny/.tag 는 공용 규칙이 이미 12px 로 올린다) */
  .city-screen .fac-badge,
  .city-screen .spec-badge,
  .city-krow .qs-elite-tag,
  .city-time .t-acts .btn .t-cost,
  .city-time .t-acts .btn .t-week { font-size:12px; }
  .city-screen .btn.sm { min-height:40px; padding:8px 12px; font-size:12px; }

  /* 부상자가 있으면 그게 제일 급한 일이다 — 날짜 패널보다 위로 올린다.
     (.city-screen 은 flex column 이라 order 가 그대로 먹는다) */
  .city-alert { order:-1; }
  .city-alert .alert-acts { width:100%; }
  .city-alert .alert-acts .btn { flex:1 1 auto; min-height:48px; }
  .city-hurt > span { white-space:normal; }

  .city-hero { gap:12px; }
  .city-hero h2 { font-size:19px; }
  /* 오른쪽 요약 칸이 좁은 화면에서 오른쪽에 매달리면 읽기 나쁘다 — 폭을 다 쓰게 한다 */
  .city-hero > .col { min-width:0 !important; width:100%; }

  .city-facilities { grid-template-columns:minmax(0, 1fr); }
  .city-fac { min-height:0; }
  .city-fac .fac-foot { flex-wrap:wrap; gap:6px; }
  .city-fac .fac-foot .btn { flex:1 1 auto; min-height:40px; }

  .city-cols { grid-template-columns:minmax(0, 1fr); }

  /* 7열짜리 부대 현황 표 — 페이지를 늘리지 말고 표만 밀어서 보게 한다 */
  .city-tablewrap { overflow-x:auto; overscroll-behavior-x:contain; -webkit-overflow-scrolling:touch; }
  .city-tablewrap table.data { min-width:560px; }
  .city-scrollhint { display:block; }

  .city-dlg { max-height:62vh; }
  .city-rep .rep-num { font-size:15px; }

  /* 모달 안쪽(상점·대장간·여관)도 같은 기준을 따른다 — 모달은 #screen 밖이라 따로 잡아 준다 */
  .city-dlg .tiny, .city-modal .tiny { font-size:12px; }
  .city-dlg .btn.sm, .city-modal .btn.sm { min-height:40px; padding:8px 12px; font-size:12px; }
  .city-dlg table.data, .city-modal table.data { font-size:12px; }
  .city-dlg table.data th, .city-dlg table.data td,
  .city-modal table.data th, .city-modal table.data td { padding:6px 6px; }
  .city-modal .row { flex-wrap:wrap; }
}
`;

/* ─────────────────────────── 작은 헬퍼 ─────────────────────────── */

function injectStyle() {
  if (document.getElementById('city-style')) return;
  document.head.appendChild(el('style', { id: 'city-style', text: CSS }));
}

const stars = (tier) => '★'.repeat(clamp(tier, 0, 5)) + '☆'.repeat(clamp(5 - tier, 0, 5));

/** append 는 null을 "null" 문자열로 넣어버리므로 걸러서 붙인다 */
function add(host, ...kids) {
  for (const k of kids.flat(9)) if (k) host.appendChild(k);
  return host;
}

/** 등급/랭크 색 태그 */
const rankTag = (r, extra = '') =>
  el('span', { class: 'tag', style: { color: GRADE_COLOR[r] || 'var(--ink-dim)' } }, `${r}${extra}`);

/* ── 서브랭크 · 정예 · 전직 헬퍼 (1단계 API 가 없는 옛 빌드도 견딘다) ── */
const SUB_SIGN = { '-1': '-', 0: '', 1: '+' };
/** 서브랭크 -1|0|1 */
function questSub(q) {
  if (typeof Quest.subOf === 'function') { try { return Quest.subOf(q); } catch (e) { /* */ } }
  const n = Math.round(Number(q && typeof q === 'object' ? q.sub : q));
  return Number.isFinite(n) ? (n < 0 ? -1 : n > 0 ? 1 : 0) : 0;
}
/** 표시용 랭크 문자열 'E+' 등 */
function rankLabel(q) {
  if (typeof Quest.rankLabelOf === 'function') { try { const v = Quest.rankLabelOf(q); if (v) return v; } catch (e) { /* */ } }
  if (q && q.rankLabel) return q.rankLabel;
  const rk = (q && q.rank) || 'F';
  return `${rk}${SUB_SIGN[questSub(q)] || ''}`;
}
/** 정예 의뢰인가 */
function isElite(q) {
  if (typeof Quest.isEliteQuest === 'function') { try { return !!Quest.isEliteQuest(q); } catch (e) { /* */ } }
  return !!(q && q.elite);
}
/** 서브랭크까지 반영한 랭크 태그 ('E+' 2 · '-'는 흐리게 '+'는 진하게) */
function subRankTag(label, count) {
  const rank = label[0];
  const sub = label.length > 1 ? label[label.length - 1] : '';
  const cls = sub === '+' ? 'sub-plus' : sub === '-' ? 'sub-minus' : '';
  return el('span', {
    class: `tag city-subtag ${cls}`,
    style: { color: GRADE_COLOR[rank] || 'var(--ink-dim)' },
  }, count != null ? `${label} ${count}` : label);
}

/** 다음 차수 전직에 필요한 레벨 (더 없으면 null) */
function nextPromo(m) {
  if (typeof Merc.nextPromoteLevel === 'function') {
    try { const v = Merc.nextPromoteLevel(m); return v == null ? null : Number(v); } catch (e) { /* */ }
  }
  const c = getClass(m && m.classId);
  const t = clamp(Math.round((c && c.tier) || 1), 1, 4);
  return ({ 2: 15, 3: 35, 4: 55 })[t + 1] ?? null;
}
/** 지금 전직 가능한가 */
function canPromoteM(m) {
  if (typeof Merc.canPromote === 'function') { try { return !!Merc.canPromote(m); } catch (e) { /* */ } }
  const need = nextPromo(m);
  return need != null && (m.level || 1) >= need;
}
/**
 * 부대의 다음 전직 목표를 요약한다. 레벨업이 느려졌으니 "무엇을 향해 굴리는가"가 보여야 한다.
 * @returns {{ready:number, best:{need:number,remain:number}|null, maxed:number, total:number}|null}
 */
function squadPromo(sq) {
  const members = squadMembers(state, sq.id);
  if (!members.length) return null;
  let ready = 0; let maxed = 0; let best = null;
  for (const m of members) {
    if (canPromoteM(m)) { ready++; continue; }
    const need = nextPromo(m);
    if (need == null) { maxed++; continue; }
    const remain = need - (m.level || 1);
    if (remain > 0 && (best == null || remain < best.remain)) best = { need, remain };
  }
  return { ready, best, maxed, total: members.length };
}

/** 스탯 오브젝트 → "공격 +12 · 체력 +30" */
function statLine(stats, sep = ' · ') {
  const parts = [];
  for (const [k, v] of Object.entries(stats || {})) {
    if (!v) continue;
    const label = STAT_LABEL[k] || k;
    const val = Math.round(v * 10) / 10;
    parts.push(`${label} ${val > 0 ? '+' : ''}${val}`);
  }
  return parts.join(sep) || '추가 능력치 없음';
}

/** 아이템 이름 (희귀도 색) */
const itemName = (it) => el('span', { style: { color: RARITY_COLOR[it.rarity || 0], fontWeight: '600' } }, it.name);

/** 클래스 스프라이트 미리보기 캔버스 */
function classSprite(cls, scale = 2) {
  if (!cls || !cls.sprite) return null;
  try {
    const s = getSprite(cls.sprite);
    const cv = el('canvas', { width: 32 * scale, height: 40 * scale });
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawSpriteFrame(ctx, s, 'idle0', 16 * scale, 38 * scale, { scale });
    return el('div', { class: 'sprite-box' }, cv);
  } catch (e) {
    console.warn('[city] 스프라이트 생성 실패', e);
    return null;
  }
}

// 대기 인원 할인 포함 — 실제 차감(advanceDays)과 같은 식을 쓴다
const totalUpkeep = () => GameState.dailyUpkeep(state);
const cityQuests = (id) => state.quests?.[id]?.list || [];
const cityTavern = (id) => state.tavern?.[id]?.list || [];
const cityShop = (id) => state.shop?.[id]?.list || [];
const shopPrice = (it) => Math.max(1, Math.round(it.price || itemValue(it) * 1.5));
/** 목록이 다시 굴러갈 때까지 남은 일수 */
function restockIn(cityId, key) {
  const day = state[key]?.[cityId]?.day;
  if (day == null) return 0;
  return clamp(REFRESH_DAYS - (state.day - day), 0, REFRESH_DAYS);
}

/* ─────────────────── 년 / 월 / 주 달력 · 이번 주 던전 ───────────────────
   game/state.js    : calendar(day) · openDungeonWeek(day) · calendarLabel(day)
                      DAYS_PER_WEEK / WEEKS_PER_MONTH / MONTHS_PER_YEAR
   data/dungeons.js : DUNGEONS · DUNGEON_LIST · dungeonForWeek(week)

   day 는 여전히 진실의 원천이고 년/월/주는 전부 파생값이다. 전부 나중에 붙은 API라
   "있으면 쓰고 없으면 직접 계산하는" 형태로 감싼다 — 없는 빌드에서도 화면이 죽지 않는다.
   1주 = 7일 · 1개월 = 4주(28일) · 1년 = 12개월(336일) · N주차 = N번 던전 개방. */

/** state.js 의 달력 상수를 읽되, 없는 빌드면 설계값으로 대체 */
function calKnob(name, fallback) {
  const v = Number(GameState[name]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}
const daysPerWeek = () => calKnob('DAYS_PER_WEEK', 7);
const daysPerMonth = () => calKnob('DAYS_PER_MONTH', daysPerWeek() * calKnob('WEEKS_PER_MONTH', 4));
const daysPerYear = () => calKnob('DAYS_PER_YEAR', daysPerMonth() * calKnob('MONTHS_PER_YEAR', 12));
/** 1 이상의 정수로 정규화 (NaN·0·음수·소수 방어) */
const normDay = (day) => {
  const d = Math.floor(Number(day));
  return Number.isFinite(d) && d >= 1 ? d : 1;
};

/** 날짜 → `{year, month, week, dayOfWeek, day}`. week 은 그 달의 주차(1~4) */
function cal(day = state.day) {
  const d = normDay(day);
  if (typeof GameState.calendar === 'function') {
    try {
      const c = GameState.calendar(d);
      if (c && Number.isFinite(c.year) && Number.isFinite(c.month) && Number.isFinite(c.week)) return c;
    } catch (e) { console.warn('[city] calendar 실패', e); }
  }
  const dpw = daysPerWeek(); const dpm = daysPerMonth(); const dpy = daysPerYear();
  const doy = (d - 1) % dpy;
  return {
    year: Math.floor((d - 1) / dpy) + 1,
    month: Math.floor(doy / dpm) + 1,
    week: Math.floor((doy % dpm) / dpw) + 1,
    dayOfWeek: (doy % dpw) + 1,
    day: d,
  };
}

/** `3년 7월 2주차` */
function calShort(day = state.day) {
  const c = cal(day);
  return `${c.year}년 ${c.month}월 ${c.week}주차`;
}
/** `3년 7월 2주차 (245일차)` — UI 공용 표기 */
function calLabel(day = state.day) {
  if (typeof GameState.calendarLabel === 'function') {
    try { const s = GameState.calendarLabel(normDay(day)); if (s) return String(s); } catch (e) { console.warn('[city] calendarLabel 실패', e); }
  }
  return `${calShort(day)} (${num(normDay(day))}일차)`;
}
/** 통산 주 번호 — "주가 바뀌었나"를 달·해가 넘어가도 정확히 비교하려고 쓴다 */
const weekIndex = (day = state.day) => Math.floor((normDay(day) - 1) / daysPerWeek());
/** 다음 주가 시작될 때까지 남은 일수 (1~7) */
const daysToNextWeek = (day = state.day) => daysPerWeek() - ((normDay(day) - 1) % daysPerWeek());

/** 그날 열리는 던전 번호(= 그 달의 주차 1~4) */
function dungeonWeekOf(day = state.day) {
  if (typeof GameState.openDungeonWeek === 'function') {
    try {
      const v = Math.round(Number(GameState.openDungeonWeek(normDay(day))));
      if (Number.isFinite(v) && v > 0) return v;
    } catch (e) { console.warn('[city] openDungeonWeek 실패', e); }
  }
  return cal(day).week;
}
/** 그 주차에 열리는 던전 (없으면 null) */
function dungeonOfWeek(week) {
  const w = Math.round(Number(week));
  if (!Number.isFinite(w)) return null;
  if (typeof Dungeons.dungeonForWeek === 'function') {
    try { const d = Dungeons.dungeonForWeek(w); if (d) return d; } catch (e) { console.warn('[city] dungeonForWeek 실패', e); }
  }
  const list = Array.isArray(Dungeons.DUNGEON_LIST)
    ? Dungeons.DUNGEON_LIST
    : Object.values(Dungeons.DUNGEONS || {});
  return list.find((d) => d && Math.round(Number(d.week)) === w) || null;
}
/** 그날 들어갈 수 있는 던전 (없으면 null) */
const openDungeonAt = (day = state.day) => dungeonOfWeek(dungeonWeekOf(day));

/* ─────────────────── 도시 평판 · 특화 클래스 ───────────────────
   game/state.js : getRep(cityId), canUseTavern(cityId), REP_TAVERN_MIN, REP_QUEST_GAIN
   data/world.js : citySpecialty(cityId)
   전부 나중에 붙은 API라 "있으면 쓰고 없으면 필드를 직접 읽는" 형태로 감싼다. */

/** 평판 구간 이름 — 주점 화면과 같은 어휘를 쓴다 */
/* ★ 상한이 100 → 300 으로 늘면서 구간도 다시 잡았다 (state.js REP_MAX).
 *   구간을 5개 그대로 두면 한 칸이 60점이라 한참을 올려도 이름이 안 바뀐다 —
 *   길어진 여정일수록 이정표가 더 촘촘해야 한다. */
const REP_TIERS = [
  { min: 280, name: '살아있는 전설', color: 'var(--gold)' },
  { min: 220, name: '전설의 이름', color: 'var(--gold)' },
  { min: 150, name: '이름이 팔린다', color: 'var(--leaf)' },
  { min: 90, name: '명망 높음', color: 'var(--leaf)' },
  { min: 40, name: '믿을 만함', color: 'var(--steel)' },
  { min: 10, name: '얼굴은 안다', color: 'var(--ink-dim)' },
  { min: 0, name: '무명', color: 'var(--ink-faint)' },
];
const repTier = (v) => REP_TIERS.find((t) => v >= t.min) || REP_TIERS[REP_TIERS.length - 1];

/** state.js 상수를 읽되, 아직 없는 빌드면 설계값으로 대체 */
function repKnob(name, fallback) {
  const v = Number(GameState[name]);
  return Number.isFinite(v) ? v : fallback;
}
/** 주점이 열리는 최소 평판 */
const repNeed = () => repKnob('REP_TAVERN_MIN', 10);
/** 평판 상한 — 화면에 100 을 박아 두면 상한을 바꿀 때 조용히 거짓말이 된다 */
const repMax = () => repKnob('REP_MAX', 300);

/** 도시 평판 (0~REP_MAX). 기록이 없으면 0 */
function repOf(cityId) {
  if (typeof GameState.getRep === 'function') {
    try {
      const v = Number(GameState.getRep(cityId));
      if (Number.isFinite(v)) return clamp(Math.round(v), 0, 100);
    } catch (e) { console.warn('[city] getRep 실패', e); }
  }
  const v = Number(state.reputation?.[cityId]);
  return Number.isFinite(v) ? clamp(Math.round(v), 0, 100) : 0;
}

/** 이 도시 주점을 쓸 수 있는가 */
function tavernGate(cityId) {
  const rep = repOf(cityId);
  const need = repNeed();
  if (typeof GameState.canUseTavern === 'function') {
    try {
      const r = GameState.canUseTavern(cityId);
      if (r && typeof r.ok === 'boolean') {
        return {
          ok: r.ok,
          reason: r.reason || '',
          rep: Number.isFinite(r.rep) ? r.rep : rep,
          need: Number.isFinite(r.need) ? r.need : need,
        };
      }
    } catch (e) { console.warn('[city] canUseTavern 실패', e); }
  }
  return { ok: rep >= need, reason: '', rep, need };
}

/** 이 도시가 배출하는 1차 클래스 id 목록 */
function specialtyOf(cityId) {
  if (typeof World.citySpecialty === 'function') {
    try {
      const a = World.citySpecialty(cityId);
      if (Array.isArray(a)) return a.slice();
    } catch (e) { console.warn('[city] citySpecialty 실패', e); }
  }
  const c = getCity(cityId);
  return Array.isArray(c?.specialty) ? c.specialty.slice() : [];
}

/* 의뢰를 마치고 도시로 돌아오면 평판이 달라져 있다 (quest.applyQuestResult().rep).
   전투 화면을 거쳐 오므로 결과창을 놓쳤을 수 있어, 도시 화면에 들어온 순간
   "마지막으로 이 화면에 그렸던 값"과 비교해 변동분을 배지로 한 번 띄운다.
   (로그 줄은 state.addRep 이 따로 남기고, 아래 logPanel 이 강조해서 보여준다.) */
const repSeen = new Map();

/** render 당 한 번만 부를 것 — 부르는 순간 기준값이 갱신된다 */
function takeRepDelta(cityId, cur) {
  const prev = repSeen.get(cityId);
  repSeen.set(cityId, cur);
  if (prev == null || prev === cur) return 0;
  return cur - prev;
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
    } catch (e) { console.warn('[city] isSquadAway 실패', e); }
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
    } catch (e) { console.warn('[city] squadReturnIn 실패', e); }
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
    } catch (e) { console.warn('[city] daysUntilNextReturn 실패', e); }
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
    } catch (e) { console.warn('[city] anySquadAway 실패', e); }
  }
  return (state.squads || []).some(isAway);
}

/* 진행 바를 그리려면 "총 며칠짜리 원정인가"를 알아야 한다. Squad 는 returnDay 만 들고 있으므로
   이 화면에서 관측한 최대 잔여 일수를 총 기간으로 기억해 둔다
   (출정 직후 도시로 돌아오면 그 값이 곧 의뢰 소요 일수라 정확히 맞는다).
   나중에 Squad 가 기간/출발일을 직접 들고 있게 되면 그쪽을 우선한다. */
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

/** 복귀일이 지난 부대의 status 를 되돌린다. state.js 가 이미 처리했다면 무해하다. */
function syncSquadStatus() {
  const fn = typeof Squad.normalizeDispatch === 'function' ? Squad.normalizeDispatch : null;
  for (const s of state.squads || []) {
    if (!s) continue;
    if (fn) {
      try { fn(s, state.day); continue; } catch (e) { console.warn('[city] normalizeDispatch 실패', e); }
    }
    if (s.status === AWAY && Number(s.returnDay || 0) <= state.day) { s.status = 'idle'; s.returnDay = 0; }
  }
}

/* ─────────────────────── 부상/회복 계산 ─────────────────────── */

/** 부상 중인 단원 — 복귀가 빠른 순 */
function woundedRoster() {
  return state.roster
    .filter((m) => isWounded(m, state.day))
    .sort((a, b) => (a.woundUntil || 0) - (b.woundUntil || 0));
}

/** 장비까지 반영한 최대 체력 */
function maxHpOf(m) {
  try {
    const st = mercStats(m, state.items);
    if (st && st.hp > 0) return Math.round(st.hp);
  } catch (e) {
    console.warn('[city] mercStats 실패', e);
  }
  return Math.max(1, Math.round(m.maxHp || m.hp || 1));
}

/** 복귀 예정일 (부상이 아니면 0) */
const backDay = (m) => (isWounded(m, state.day) ? Math.max(state.day, m.woundUntil || 0) : 0);

/**
 * `days`일 묵었을 때 이 용병이 어떻게 되는지 미리 계산한다.
 * @returns {{wounded:boolean, maxHp:number, cur:number, hp:number, back:number, recovers:boolean}}
 */
function restPreview(m, days) {
  const maxHp = maxHpOf(m);
  const wounded = isWounded(m, state.day);
  const cur = clamp(Math.round(m.hp ?? maxHp), 0, maxHp);
  // 여관은 하루 묵을 때마다 부상 잔여 기간을 REST_WOUND_STEP 일치 깎는다 (경과 + 추가 단축).
  const cut = days * WOUND_SPEEDUP;
  const back = wounded ? Math.max(state.day + days, (m.woundUntil || 0) - cut) : 0;
  const recovers = wounded && (m.woundUntil || 0) - cut <= state.day + days;
  const rate = (wounded ? HEAL_WOUNDED : HEAL_READY) + HEAL_INN;
  const hp = recovers ? maxHp : clamp(Math.round(cur + maxHp * rate * days), 0, maxHp);
  return { wounded, maxHp, cur, hp, back, recovers };
}

/** 이름 + 복귀일 한 줄 */
function woundedChip(m) {
  const c = getClass(m.classId);
  return el('span', { class: 'tiny' },
    el('b', { style: { color: GRADE_COLOR[m.grade] || 'var(--ink)' }, text: m.name }),
    el('span', { class: 'faint', text: c ? ` ${c.name} Lv${m.level}` : '' }),
    el('span', { class: 'num', style: { color: 'var(--bad)' }, text: ` ${num(backDay(m))}일차 복귀` }));
}

/* ─────────────────────────── 화면 ─────────────────────────── */

export function render(root) {
  injectStyle();
  const city = getCity(state.cityId);
  if (!city) {
    root.appendChild(el('div', { class: 'panel' },
      el('h3', { text: '길을 잃었다' }),
      el('div', { class: 'muted', text: '현재 위치를 알 수 없습니다. 월드맵에서 도시를 선택하세요.' }),
      el('div', { class: 'row', style: { marginTop: '12px' } },
        el('button', { class: 'btn primary', onClick: () => go('world') }, '월드맵 열기'))));
    return;
  }

  // 도착/휴식 직후 목록이 만료됐을 수 있으니 갱신부터 한다.
  syncSquadStatus();
  try { refreshCity(city.id); } catch (e) { console.warn('[city] 도시 목록 갱신 실패', e); }

  // 평판은 화면 여러 곳에서 쓰지만, 변동분 계산은 render 당 한 번뿐이어야 한다.
  const gate = tavernGate(city.id);
  const repDelta = takeRepDelta(city.id, gate.rep);

  // city-screen = 모바일 규칙(글자 크기·배너 순서)을 이 화면 안으로만 한정하는 표식이다.
  const wrap = el('div', { class: 'col city-screen' });
  add(wrap,
    nextStepPanel(),
    timePanel(city),
    woundedBanner(city),
    heroPanel(city, gate, repDelta),
    facilityPanel(city),
    el('div', { class: 'city-cols' }, questPanel(city), tavernPanel(city), shopPanel(city)),
    el('div', { class: 'city-cols' }, squadPanel(city), logPanel()),
  );
  root.appendChild(wrap);
}

/** 화면을 떠날 때 이 화면이 띄운 모달(상점/대장간/여관)을 닫는다. */
export function dispose() {
  const layer = document.getElementById('modal-layer');
  if (layer) layer.innerHTML = '';
}

/* ---------- 0. 날짜 진행 ---------- */

/**
 * 의뢰를 마쳐도 날짜는 저절로 흐르지 않는다 — 여기서 플레이어가 직접 넘긴다.
 * 이 패널이 눈에 안 띄면 게임이 멈춘 것처럼 보이므로 화면 최상단에 크게 둔다.
 */
function timePanel(city) {
  const squads = state.squads || [];
  const away = squads.filter(isAway);
  const idle = squads.filter((s) => !isAway(s));
  const upkeep = totalUpkeep();
  const nextIn = nextReturnIn();
  const toNextWeek = daysToNextWeek();

  /** 넘기기 버튼 — 소모될 임금과, 주가 바뀌면 열릴 던전을 미리 보여준다 */
  const stepBtn = (d, label) => {
    const cost = upkeep * d;
    const poor = cost > state.gold;
    // 주가 바뀌면 개방 던전이 통째로 갈린다. 누르기 전에 알려 준다.
    const crosses = weekIndex(state.day + d) !== weekIndex(state.day);
    const nextDun = crosses ? openDungeonAt(state.day + d) : null;
    const nextWeek = crosses ? dungeonWeekOf(state.day + d) : 0;
    return el('button', {
      class: `btn lg${poor ? '' : ' primary'}`,
      title: poor
        ? '골드가 부족하다. 임금이 밀리면 명성이 깎인다.'
        : `${d}일 뒤 = ${calLabel(state.day + d)}${crosses ? ` · ${nextDun ? `「${nextDun.name}」 개방` : '개방 던전 없음'}` : ''}`,
      onClick: () => passDays(d),
    },
    el('span', { style: { display: 'block' }, text: label }),
    el('span', {
      class: 't-cost num',
      style: poor ? { color: '#f0b4b4' } : {},
      text: upkeep > 0 ? `임금 -${num(cost)}G${poor ? ' (부족)' : ''}` : '임금 없음',
    }),
    crosses
      ? el('span', { class: 't-week', text: `→ ${nextWeek}주차 · ${nextDun ? nextDun.name : '던전 없음'}` })
      : null);
  };

  const awayRows = away.map((sq) => {
    const left = awayLeft(sq);
    const total = awayTotal(sq, left);
    return el('div', { class: 'tiny' },
      el('span', { class: 'sq-away', text: sq.name }),
      el('span', { class: 'faint num', text: ` — ${num(returnDayOf(sq))}일차 복귀 · 남은 ${left}일 / ${total}일` }));
  });

  const blocked = squads.length > 0 && idle.length === 0;
  const notice = blocked
    ? el('div', { class: 'city-warn bad tiny' }, el('span', { text: '!' }),
      el('span', { text: `지금 보낼 수 있는 부대가 없다 — 전 부대가 원정 중이다. 날짜를 넘겨 복귀시켜라${nextIn > 0 ? ` (최단 ${nextIn}일)` : ''}.` }))
    : null;

  const restockHint = (city.services || []).includes('guild')
    ? `의뢰 목록 갱신까지 ${restockIn(city.id, 'quests')}일` : null;

  return el('div', { class: 'city-time' },
    el('div', { class: 't-day' },
      el('div', { class: 't-co', text: state.companyName || '이름 없는 용병단' }),
      el('b', { class: 'num', text: calShort() }),
      el('div', { class: 'faint tiny num', text: `${num(state.day)}일차 · 하루 임금 ${num(upkeep)}G` })),
    el('div', { class: 't-mid' },
      el('div', { class: 'muted tiny', text: '날짜는 저절로 흐르지 않는다. 의뢰를 마쳐도 그날 그대로다 — 직접 넘겨야 임금·회복·목록 갱신이 진행된다.' }),
      weekBlock(),
      el('div', { class: 'tiny' },
        el('span', { class: idle.length ? 'sq-idle' : 'faint', text: `출정 가능 ${idle.length}개 부대` }),
        el('span', { class: 'faint', text: ' · ' }),
        el('span', { class: away.length ? 'sq-away' : 'faint', text: `원정 중 ${away.length}개` }),
        restockHint ? el('span', { class: 'faint', text: ` · ${restockHint}` }) : null),
      awayRows.length ? el('div', { class: 'col', style: { gap: '1px' } }, awayRows) : null,
      notice),
    el('div', { class: 't-acts' },
      stepBtn(1, '하루 넘기기'),
      stepBtn(3, '3일 넘기기'),
      // 다음 주차로 딱 맞춰 넘긴다 = 다음 던전이 열리는 첫날. 하루면 위 버튼과 겹치므로 생략.
      toNextWeek > 1 ? stepBtn(toNextWeek, `다음 주까지 (${toNextWeek}일)`) : null,
      nextIn > 0 && nextIn !== toNextWeek ? stepBtn(nextIn, `부대 복귀까지 (${nextIn}일)`) : null));
}

/**
 * 이번 주에 열린 던전 + 주가 바뀔 때 무엇이 열리는지.
 * 달력을 도입한 이유가 여기 있다 — 주차 하나가 곧 들어갈 수 있는 던전 하나다.
 */
function weekBlock() {
  const week = dungeonWeekOf();
  const now = openDungeonAt();
  const toNext = daysToNextWeek();
  const nextWeek = dungeonWeekOf(state.day + toNext);
  const next = openDungeonAt(state.day + toNext);
  const whenText = toNext === 1 ? '하루만 넘기면' : `${toNext}일 넘기면`;

  const nowRow = el('div', { class: 'w-row tiny' },
    el('span', { class: 'w-now', text: `이번 주: ${week}주차` }),
    now
      ? el('span', {}, el('b', { class: 'w-dun', text: `· ${now.name}` }), el('span', { class: 'muted', text: ' 개방' }))
      : el('span', { class: 'w-shut', text: '· 이번 주에 열리는 던전은 없다' }),
    now && now.biome
      ? el('span', { class: 'faint', text: `(${BIOME_NAME[now.biome] || now.biome}${now.waves ? ` · ${now.waves}웨이브` : ''})` })
      : null);

  const nextRow = el('div', { class: 'w-row tiny w-next' },
    next
      ? el('span', { class: 'muted' },
        `${whenText} ${nextWeek}주차 — `,
        el('b', { text: next.name }),
        `${josa(next.name, '이/가')} 열린다`)
      : el('span', { class: 'muted', text: `${whenText} ${nextWeek}주차가 된다` }),
    now
      ? el('span', { class: 'faint', text: `— ${now.name}${josa(now.name, '은/는')} 그때 닫힌다` })
      : null);

  /* 던전은 아직 안 열렸으면 통째로 감춘다 — 첫 화면 복잡도의 큰 몫이었다.
   *
   * ★★ 구걸은 **여기에도** 넣는다. 초반 골드가 마르는 걸 메우는 장치라
   *   던전이 잠긴 «바로 그 시기» 에 가장 필요하다. 던전 해금 뒤에만 보이면
   *   정작 필요한 사람에게 안 보인다 (그렇게 만들었다가 화면에서 확인하고 고쳤다). */
  if (!Progress.unlocked(Progress.FEATURES.DUNGEON, state)) {
    return el('div', { class: 'city-week' },
      el('div', { class: 'w-row tiny' },
        el('span', { class: 'faint tiny', text: `이번 주: ${week}주차` }),
        el('span', { class: 'faint tiny', text: `· ${Progress.lockHint(Progress.FEATURES.DUNGEON, state)}` })),
      begRow());
  }

  return el('div', { class: 'city-week' },
    nowRow,
    nextRow,
    el('div', { class: 'w-row' },
      el('span', { class: 'faint tiny', text: '던전은 월드맵의 별도 노드다. 주차 안에 다녀와야 한다.' }),
      el('button', { class: 'btn sm ghost', onClick: () => go('world') }, '월드맵에서 보기')),
    begRow(),
    towerRow(),
    abyssRow());
}

/**
 * 구걸 — **1등급 도시에서만, 하루 한 번.**
 *
 * ★ 초반 골드가 마르는 것을 메우는 장치다(제작자 지적). 규칙은 state.js 가 갖는다 —
 *   여기서 조건을 다시 쓰면 두 곳이 어긋난다.
 * ★ 조건이 안 되는 도시에서는 **아예 안 보여 준다.** 후반 도시에서 회색 버튼이
 *   계속 보이면 «눌러야 하나» 하는 잡일만 늘어난다.
 */
function begRow() {
  const chk = GameState.canBeg(state);
  // 1등급 도시가 아니면 줄 자체를 안 만든다 (오늘 이미 했으면 «내일 다시» 로 남긴다)
  if (!chk.ok && /1등급/.test(chk.reason || '')) return null;
  return el('div', { class: 'w-row' },
    el('span', { class: chk.ok ? 'w-now' : 'faint tiny', text: '구걸' }),
    chk.ok
      ? el('span', {}, el('b', { class: 'w-dun', text: `· ${GameState.BEG_MIN}~${GameState.BEG_MAX}G` }))
      : el('span', { class: 'faint tiny', text: '· 오늘은 이미 했다' }),
    el('span', { class: 'faint tiny', text: '작은 도시에서만 · 하루 한 번' }),
    el('button', {
      class: `btn sm ${chk.ok ? '' : 'ghost'}`,
      disabled: !chk.ok,
      onClick: () => {
        const r = GameState.beg(state);
        if (!r.ok) { toast(r.reason || '지금은 안 된다.', 'bad'); return; }
        save();
        toast(`${num(r.gold)}G 를 얻었다.`, 'good');
        refresh();
      },
    }, '손 벌리기'));
}

/**
 * 무한의 탑 안내 — 던전과 같은 달력 컨텐츠라 같은 자리에 둔다.
 * 탑은 **매달 1일에만** 열린다(주차가 아니다).
 */
function towerRow() {
  // 탑은 후반 컨텐츠다 — 조건 전에는 아예 안 보여 준다
  if (!Progress.unlocked(Progress.FEATURES.TOWER, state)) return null;
  const entry = Tower.canEnter(state);
  const best = state.tower?.best || 0;
  const wait = Tower.daysUntilEntry(state);
  return el('div', { class: 'w-row' },
    el('span', { class: entry.ok ? 'w-now' : 'faint tiny', text: '무한의 탑' }),
    entry.ok
      ? el('span', {}, el('b', { class: 'w-dun', text: '· 오늘 열려 있다' }))
      : el('span', { class: 'faint tiny', text: wait > 0 ? `· ${wait}일 뒤 (매달 1일)` : '· 이번 달은 다녀왔다' }),
    el('span', { class: 'faint tiny', text: best ? `최고 ${best}층` : '미등반' }),
    el('button', { class: 'btn sm ghost', onClick: () => go('tower') }, '탑으로'));
}

/**
 * 황금 나락 안내 — 탑과 같은 자리에 둔다.
 *
 * ★ 진입로가 **둘**이다: 여기(도시 화면)와 월드맵 노드.
 *   지도에도 있어야 눈에 띄지만, 임금 재원이라 "그 도시까지 가야 한다"가 되면 안 된다 —
 *   그래서 지도 노드를 눌러도 **이동 일수를 쓰지 않고** 바로 들어간다.
 *   갱도는 어느 도시 아래에도 있다는 설정이고, 이 줄이 그 사실의 근거다.
 */
function abyssRow() {
  if (!Progress.unlocked(Progress.FEATURES.ABYSS, state)) return null;
  const entry = Abyss.canEnter(state);
  const best = state.abyss?.best || 0;
  const wait = Abyss.daysUntilEntry(state);
  return el('div', { class: 'w-row' },
    el('span', { class: entry.ok ? 'w-now' : 'faint tiny', text: '황금 나락' }),
    entry.ok
      ? el('span', {}, el('b', { class: 'w-dun', text: '· 이번 주 몫이 남아 있다' }))
      : el('span', { class: 'faint tiny', text: `· ${wait}일 뒤 (주 1회)` }),
    el('span', { class: 'faint tiny', text: best ? `최고 ${best}심층` : '미답사' }),
    el('button', { class: 'btn sm ghost', onClick: () => go('abyss') }, '갱도로'));
}

/* ─────────────────── 접기 상태 ───────────────────
 * 도시 설명문과 시설 카드는 화면에서 가장 무거운 두 블록이다(실측 398자 / 362자).
 * 익숙해진 플레이어는 매번 볼 이유가 없으므로 접을 수 있게 한다.
 * 세이브가 아니라 localStorage 에 둔다 — 진행 상황이 아니라 **보기 설정**이다.
 * (세이브에 넣으면 파일을 주고받을 때 남의 화면 설정까지 따라간다.) */

const FOLD_KEY = 'merc_city_fold';

function folds() {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch { return {}; }
}
function folded(id) { return !!folds()[id]; }
function toggleFold(id) {
  const f = folds();
  f[id] = !f[id];
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch { /* 사파리 시크릿 등 */ }
  refresh();
}

/** 패널 머리말에 붙는 접기 버튼 */
function foldBtn(id) {
  return el('button', {
    class: 'btn sm ghost city-fold',
    title: folded(id) ? '펼치기' : '접기',
    onClick: (ev) => { ev.stopPropagation(); toggleFold(id); },
  }, folded(id) ? '펼치기 ▾' : '접기 ▴');
}

/**
 * 「지금 할 일」 — 상황을 읽어 **한 가지만** 짚어 준다.
 *
 * 첫 화면이 글자 2,217자 · 버튼 30개인데 정작 "무엇부터 하나"가 없었다(실측).
 * 여러 개를 나열하면 같은 문제가 되므로 game/progress.js 가 딱 하나만 돌려준다.
 * 안내할 게 없으면(익숙해진 플레이어) 카드 자체가 안 뜬다.
 */
function nextStepPanel() {
  const step = Progress.nextStep(state);
  if (!step) return null;
  return el('div', { class: 'panel city-next' },
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('div', { class: 'col', style: { gap: '2px', minWidth: '0' } },
        el('div', { class: 'city-next-t' }, el('span', { class: 'city-next-tag', text: '지금 할 일' }), step.title),
        el('div', { class: 'tiny faint', text: step.why })),
      step.go ? el('button', { class: 'btn sm primary', onClick: () => go(step.go) }, step.cta || '가기') : null));
}

/** 날짜를 n일 넘긴다. 임금·회복·목록 갱신은 advanceDays 가 처리한다. */
function passDays(n) {
  const days = Math.max(1, Math.round(n || 1));
  const awayBefore = (state.squads || []).filter(isAway).map((s) => s.id);
  const goldBefore = state.gold;
  const weekBefore = weekIndex(state.day);
  const dunBefore = openDungeonAt(state.day);

  let res = null;
  try {
    res = advanceDays(days);
  } catch (e) {
    console.warn('[city] 날짜 진행 실패', e);
    toast('날짜를 넘기지 못했습니다.', 'bad');
    return;
  }
  syncSquadStatus();
  try { refreshCity(state.cityId); } catch (e) { console.warn('[city] 도시 목록 갱신 실패', e); }

  const back = (state.squads || []).filter((s) => awayBefore.includes(s.id) && !isAway(s));
  if (back.length) addLog(`원정에서 복귀 — ${back.map((s) => s.name).join(', ')}. 다시 의뢰를 받을 수 있다.`);

  // 주가 넘어갔다 = 들어갈 수 있는 던전이 바뀌었다. 이번 달력 도입의 핵심이라 로그로 남긴다.
  const weekChanged = weekIndex(state.day) !== weekBefore;
  const dunAfter = openDungeonAt(state.day);
  if (weekChanged) {
    if (dunAfter && (!dunBefore || dunBefore.id !== dunAfter.id)) {
      addLog(`${calShort()} — ${dunAfter.name}의 문이 열렸다${dunBefore ? `. ${dunBefore.name}${josa(dunBefore.name, '은/는')} 닫혔다` : ''}.`);
    } else if (!dunAfter) {
      addLog(`${calShort()} — 이번 주에 열리는 던전은 없다.`);
    }
  }
  try { save(); } catch (e) { console.warn('[city] 저장 실패', e); }

  const spent = Math.max(0, goldBefore - state.gold);
  refresh();

  const parts = [`${days}일 경과 · ${calLabel()}`];
  if (spent) parts.push(`임금 -${num(spent)}G`);
  if (back.length) parts.push(`${back.length}개 부대 복귀`);
  if (res && res.recovered && res.recovered.length) parts.push(`부상 복귀 ${res.recovered.length}명`);
  toast(parts.join(' · '), 'good');
  if (weekChanged && dunAfter && (!dunBefore || dunBefore.id !== dunAfter.id)) {
    toast(`${dungeonWeekOf(state.day)}주차 — ${dunAfter.name} 개방`, 'good');
  }
  if (res && res.unpaid > 0) toast(`임금 ${num(res.unpaid)}G가 밀렸다. 금고를 채워야 한다.`, 'bad');
}

/* ---------- 0-1. 부상자 경고 배너 ---------- */

/**
 * 부상자가 있으면 화면 맨 위에 띄운다.
 * "부상자를 봤을 때 무엇을 눌러야 하는가"를 배너 안에서 바로 해결한다 —
 * 시설 카드까지 스크롤해서 휴식을 찾아내게 만들지 않는다.
 */
function woundedBanner(city) {
  const hurt = woundedRoster();
  if (!hurt.length) return null;

  const soonest = Math.min(...hurt.map((m) => backDay(m)));
  const latest = Math.max(...hurt.map((m) => backDay(m)));
  const healthy = state.roster.length - hurt.length;
  const need = Math.max(1, Math.ceil((latest - state.day) / REST_WOUND_STEP));
  const restHint = need <= 3
    ? `여관에 묵으면 하루당 회복이 ${REST_WOUND_STEP}일치 앞당겨진다. ${need}일이면 전원 복귀한다.`
    : `여관에 묵으면 하루당 회복이 ${REST_WOUND_STEP}일치 앞당겨진다. 한 번에 최대 3일까지 묵을 수 있다.`;

  const detail = healthy > 0
    ? `건강한 단원 ${healthy}명으로 출정은 가능하다. 부상자는 자동으로 열외된다.`
    : '움직일 수 있는 단원이 없다. 회복하기 전에는 출정할 수 없다.';

  return el('div', { class: 'city-alert' },
    el('div', { class: 'alert-main' },
      el('div', { class: 'alert-title' },
        `부상자 ${hurt.length}명 · 최단 복귀 ${num(soonest)}일차`,
        latest !== soonest ? el('span', { class: 'faint tiny', text: `  (전원 복귀 ${num(latest)}일차)` }) : null),
      el('div', { class: 'muted tiny', style: { marginTop: '3px' }, text: detail }),
      el('div', { class: 'alert-names' }, hurt.slice(0, 8).map(woundedChip),
        hurt.length > 8 ? el('span', { class: 'faint tiny', text: `외 ${hurt.length - 8}명` }) : null),
      el('div', { class: 'faint tiny', style: { marginTop: '5px' }, text: restHint })),
    el('div', { class: 'alert-acts' },
      el('button', { class: 'btn primary lg', onClick: () => openRest(city) }, '여관에서 휴식'),
      el('button', { class: 'btn', onClick: () => go('company') }, '부대 편성')));
}

/* ---------- 1. 도시 소개 ---------- */

function heroPanel(city, gate = tavernGate(city.id), repDelta = 0) {
  const region = cityRegion(city.id);
  const biome = BIOME_NAME[cityBiome(city.id)] || '변경';
  const services = (city.services || []).map((s) => SERVICE_NAME[s] || s).join(' · ') || '없음';
  const capText = Number.isFinite(Number(state.rosterCap))
    ? `${state.roster.length} / ${Math.round(Number(state.rosterCap))}명`
    : `${state.roster.length}명`;

  /* 설명문·명물·평판은 화면에서 가장 무거운 덩어리다(실측 398자).
   * 도시 이름·등급과 우측 지표는 늘 필요하므로 남기고, **설명 부분만** 접는다. */
  const fold = folded('hero');

  return el('div', { class: 'panel' },
    el('div', { class: 'city-hero' },
      el('div', {},
        el('div', { class: 'row spread center', style: { gap: '8px' } },
          el('h2', { style: { margin: '0' } }, city.name, ' ', el('span', { class: 'city-stars tiny' }, stars(city.tier || 1))),
          foldBtn('hero')),
        el('div', { class: 'muted tiny' }, `${region ? region.name : '알 수 없는 지역'} · ${biome} · ${city.tier || 1}등급 도시`),
        fold
          ? el('div', { class: 'faint tiny', style: { marginTop: '6px' } },
            `시설: ${services}${specialtyNames(city) ? ` · 명물 ${specialtyNames(city)}` : ''} · 평판 ${gate.rep}/${repMax()}`)
          : [
            el('p', { class: 'muted desc', style: { margin: '10px 0 0' }, text: city.desc || '' }),
            el('div', { class: 'faint tiny', style: { marginTop: '6px' } }, `시설: ${services}`),
            specialtyBlock(city),
            repBlock(city, gate, repDelta),
          ]),
      el('div', { class: 'col', style: { gap: '6px', minWidth: '190px', textAlign: 'right' } },
        kv('용병단', state.companyName || '이름 없는 용병단', 'var(--gold-dim)'),
        kv('날짜', calShort(), 'var(--gold-dim)'),
        kv('현재 일차', `${num(state.day)}일차`),
        kv('보유 골드', `${num(state.gold)} G`, 'var(--gold)'),
        kv('일일 임금', `${num(totalUpkeep())} G`),
        kv('단원', capText),
        kv('평판', `${gate.rep} / ${repMax()}`, repTier(gate.rep).color),
        kv('명성', num(state.renown)))));
}

/** 접었을 때 한 줄로 쓰는 명물 클래스 이름 */
function specialtyNames(city) {
  return specialtyOf(city.id).map((id) => getClass(id)).filter(Boolean).map((c) => c.name).join('·');
}

/** 이 도시가 배출하는 클래스. 저티어 도시를 굳이 들르는 이유가 여기 있다. */
function specialtyBlock(city) {
  const ids = specialtyOf(city.id);
  if (!ids.length) return null;
  const names = ids.map((id) => getClass(id)).filter(Boolean);
  if (!names.length) return null;
  return el('div', { class: 'city-spec' },
    el('span', { class: 'faint tiny', text: '이 도시의 명물' }),
    names.map((c) => el('span', { class: 'spec-badge', text: c.name })),
    el('span', { class: 'muted tiny', text: '— 이 클래스는 여기 주점에서 유독 잘 나온다 (S·A 확률 급상승)' }));
}

/**
 * 도시 평판 0~REP_MAX. 주점 개방선(REP_TAVERN_MIN)을 바 위에 표시하고,
 * 의뢰를 마치고 돌아왔을 때의 변동분을 배지로 한 번 보여준다.
 */
function repBlock(city, gate, delta) {
  const t = repTier(gate.rep);
  const gainTable = GameState.REP_QUEST_GAIN || { F: 2, E: 3, D: 4, C: 5, B: 6, A: 8, S: 10 };
  const fGain = Number(gainTable.F) || 2;
  const short = Math.max(0, gate.need - gate.rep);

  const hint = gate.ok
    ? `주점이 열려 있다. 평판이 오를수록 고등급 용병이 굴러 나온다 (${repMax()}이면 실효 주점 등급 +1.9).`
    : `주점 잠김 — 평판 ${gate.need}부터 고용할 수 있다. ${short} 더 필요하다 (F랭크 의뢰 성공 +${fGain}).`;

  return el('div', { class: 'city-rep' },
    el('div', { class: 'rep-head' },
      el('span', { class: 'faint tiny', text: '도시 평판' }),
      el('span', { class: 'rep-num', style: { color: t.color }, text: `${gate.rep}` }),
      el('span', { class: 'faint tiny', text: '/ 100' }),
      el('span', { class: 'tag', style: { color: t.color }, text: t.name }),
      delta
        ? el('span', {
          class: 'rep-delta',
          style: { color: delta > 0 ? 'var(--ok)' : 'var(--bad)' },
          text: `${delta > 0 ? '+' : ''}${delta}`,
        })
        : null,
      gate.ok
        ? el('span', { class: 'tiny', style: { color: 'var(--ok)' }, text: '주점 개방' })
        : el('span', { class: 'tiny', style: { color: 'var(--bad)' }, text: '주점 이용 불가' })),
    el('div', { class: 'bar' },
      el('i', { style: { width: `${clamp(gate.rep, 0, 100)}%` } }),
      el('span', { class: 'rep-mark', style: { left: `${clamp(gate.need, 0, 100)}%` }, title: `주점 개방선 ${gate.need}` })),
    el('div', { class: 'rep-scale' },
      el('span', { class: 'faint tiny', text: '0' }),
      el('span', { class: 'faint tiny', text: '100' })),
    el('div', { class: gate.ok ? 'muted tiny' : 'tiny', style: { marginTop: '5px', color: gate.ok ? '' : '#f0b4b4' }, text: hint }));
}

function kv(k, v, color) {
  return el('div', { class: 'row spread center', style: { gap: '14px' } },
    el('span', { class: 'faint tiny', text: k }),
    el('span', { class: 'num', style: { fontWeight: '700', color: color || 'var(--ink)' }, text: v }));
}

/* ---------- 2. 시설 ---------- */

function facilityPanel(city) {
  const has = (s) => (city.services || []).includes(s);
  const quests = cityQuests(city.id);
  const eliteCount = quests.filter(isElite).length;
  const tavern = cityTavern(city.id);
  const shop = cityShop(city.id);
  const linked = neighbors(city.id).length;
  const hurt = woundedRoster();
  const awayCount = state.squads.filter(isAway).length;
  const idleCount = state.squads.length - awayCount;
  const openDun = openDungeonAt();
  // 던전이 아직 안 열렸으면 시설 설명에서도 언급하지 않는다 (신규 화면 정리)
  const showDun = openDun && Progress.unlocked(Progress.FEATURES.DUNGEON, state) ? openDun : null;

  // 평판이 모자라면 주점은 들어갈 수는 있어도 고용이 잠긴다 — 카드에서 미리 알린다.
  const gate = tavernGate(city.id);
  const specNames = specialtyOf(city.id).map((id) => getClass(id)).filter(Boolean).map((c) => c.name);
  const tavernDesc = gate.ok
    ? (specNames.length
      ? `용병을 고용한다. 등급은 운에 맡긴다. 이 도시는 ${specNames.join(' · ')} 쪽이 유독 잘 나온다.`
      : '용병을 고용한다. 클래스를 고르면 등급은 운에 맡긴다.')
    : '이 도시에서는 아직 당신들의 이름이 알려지지 않았다. 의뢰를 수행해 평판을 쌓아라.';

  const cards = el('div', { class: 'cards city-facilities' },
    facCard('주점', tavernDesc,
      gate.ok ? `${tavern.length}명 대기 중` : `평판 ${gate.rep} / ${gate.need} — 고용 잠김`,
      has('tavern'), () => go('tavern'), '이 도시에는 주점이 없다',
      { action: gate.ok ? '들어가기' : '조건 보기', badge: gate.ok ? null : '주점 이용 불가' }),
    facCard('의뢰소', '계약서를 뒤져 부대에 맞는 일을 고른다. 부대마다 따로 보낼 수 있다.',
      `의뢰 ${quests.length}건 · 출정 가능 ${idleCount}개 부대${eliteCount ? ` · 정예 ${eliteCount}건` : ''}`,
      has('guild'), () => go('quests'), '이 도시에는 의뢰소가 없다',
      { action: '게시판 보기',
        badge: state.squads.length && !idleCount ? '보낼 부대 없음' : (eliteCount ? `정예 ${eliteCount}` : null) }),
    facCard('상점', '떠돌이 상인이 물건을 펼쳐 놓았다.',
      `${shop.length}종 판매 중`, has('shop'), () => openShop(city), '이 도시에는 상점이 없다',
      { action: '물건 보기' }),
    facCard('대장간', '쓰지 않는 장비를 팔거나, 다시 벼려 능력치를 굴린다.',
      `보유 장비 ${state.items.length}점`, has('smith'), () => openSmith(city), '이 도시에는 대장간이 없다',
      { action: '작업대로' }),
    facCard('휴식',
      hurt.length
        ? `여관 침상에 눕혀 상처를 꿰맨다. 하루 묵을 때마다 회복이 ${REST_WOUND_STEP}일치 앞당겨진다.`
        : '여관에 묵어 체력을 회복한다. 1~3일.',
      `1일 ${num(restFee(1))}G부터`, true, () => openRest(city), '',
      { action: '여관에서 휴식', urgent: hurt.length > 0, badge: hurt.length ? `부상 ${hurt.length}명` : null }),
    facCard('월드맵',
      anyAway()
        ? '짐을 꾸리고 다음 도시로 향한다. 원정 나간 부대도 함께 끌려간다 — 복귀를 기다리는 편이 낫다.'
        : `짐을 꾸리고 다음 도시로 향한다. 이동에는 날짜가 든다.${showDun ? ` 지도에는 이번 주 열린 ${showDun.name}도 찍혀 있다.` : ''}`,
      `연결된 도시 ${linked}곳${showDun ? ` · ${dungeonWeekOf()}주차 던전 개방` : ''}`,
      true, () => go('world'), '',
      // .fac-badge 는 붉은 경고색이다 — 던전 안내를 여기 넣으면 위험 표시처럼 보인다.
      { action: '길 떠나기', badge: awayCount ? `원정 ${awayCount}개 부대` : null }),
  );

  /* 시설 카드 6장은 362자짜리 덩어리다. 익숙해지면 하단 탭으로 바로 가므로 접을 수 있게 한다.
   * 접어도 '무엇이 몇 개 있는지'는 한 줄로 남긴다 — 접었더니 정보가 통째로 사라지면 안 된다. */
  const fold = folded('fac');
  return el('div', { class: 'panel' },
    el('div', { class: 'row spread center', style: { gap: '8px' } },
      el('h3', { text: '시설', style: { margin: '0' } }),
      foldBtn('fac')),
    fold
      ? el('div', { class: 'faint tiny', style: { marginTop: '4px' } },
        `의뢰 ${quests.length}건${eliteCount ? ` (정예 ${eliteCount})` : ''} · 주점 ${tavern.length}명`
        + ` · 상점 ${shop.length}종 · 장비 ${(state.items || []).length}점`
        + `${hurt.length ? ` · 부상 ${hurt.length}명` : ''} · 출전 가능 ${idleCount}개 부대`)
      : cards);
}

/**
 * 시설 카드. 카드 전체가 클릭 가능하지만, "누를 수 있다"는 게 눈에 보여야 하므로
 * 하단에 진짜 버튼을 하나 박는다.
 * @param {{action?:string, urgent?:boolean, badge?:string|null}} opts
 */
function facCard(name, desc, foot, enabled, onClick, offText, opts = {}) {
  const { action = null, urgent = false, badge = null } = opts;
  const fire = enabled ? onClick : () => toast(offText || '이용할 수 없습니다.', 'bad');

  return el('div', {
    class: `card city-fac${enabled ? '' : ' off'}${urgent ? ' urgent' : ''}`,
    onClick: fire,
  },
  el('div', { class: 'fac-head' },
    el('div', { class: 'fac-name', text: name }),
    badge ? el('span', { class: 'fac-badge', text: badge }) : null),
  el('div', { class: 'muted tiny', text: desc }),
  el('div', { class: 'fac-foot' },
    el('div', { class: 'faint tiny', text: enabled ? foot : (offText || '이용 불가') }),
    action && enabled
      ? el('button', {
        class: `btn sm${urgent ? ' primary' : ''}`,
        onClick: (e) => { e.stopPropagation(); onClick(); },
      }, action)
      : null));
}

/* ---------- 3. 의뢰 요약 ---------- */

function questPanel(city) {
  const list = cityQuests(city.id);
  // 서브랭크까지 세분해 센다 (E- / E / E+ 를 따로).
  const counts = {};
  for (const q of list) { const lb = rankLabel(q); counts[lb] = (counts[lb] || 0) + 1; }
  const orderedLabels = [];
  for (const r of RANKS) for (const s of ['-', '', '+']) { const lb = `${r}${s}`; if (counts[lb]) orderedLabels.push(lb); }

  const tags = el('div', { class: 'row wrap', style: { gap: '6px', flexWrap: 'wrap' } },
    orderedLabels.map((lb) => subRankTag(lb, counts[lb])));

  const elites = list.filter(isElite);
  const eliteBanner = elites.length
    ? el('div', { class: 'city-elite tiny' },
      el('span', { class: 'el-mark', text: '◆' }),
      el('span', {},
        el('b', { text: `정예 의뢰 ${elites.length}건 게시` }),
        ' — 적이 전원 강화되고 정예 개체가 섞인다. 보상 골드·경험치 ×2.2. 준비된 부대만 도전하라.'))
    : null;

  const top = list.slice(0, 4).map((q) => el('div', { class: 'city-krow' },
    el('div', { style: { minWidth: '0' } },
      el('div', { style: { fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        q.name, isElite(q) ? el('span', { class: 'qs-elite-tag', text: '정예' }) : null),
      el('div', { class: 'faint tiny' }, `${q.type} · 권장 Lv${q.level} · ${q.days}일 · 웨이브 ${q.waves.length}`)),
    el('div', { class: 'row center', style: { gap: '8px' } },
      subRankTag(rankLabel(q)),
      el('span', { class: 'num tiny', style: { color: 'var(--gold)' }, text: `${num(q.reward?.gold || 0)}G` }))));

  return el('div', { class: 'panel col' },
    el('h3', { text: `의뢰소 — ${list.length}건` }),
    list.length ? tags : el('div', { class: 'faint tiny', text: '지금은 걸린 의뢰가 없다.' }),
    eliteBanner,
    el('div', { class: 'city-list' }, top),
    el('div', { class: 'row', style: { marginTop: '4px' } },
      el('button', {
        class: 'btn sm', disabled: !(city.services || []).includes('guild'),
        onClick: () => go('quests'),
      }, '의뢰소로')));
}

/* ---------- 4. 주점 미리보기 ---------- */

function tavernPanel(city) {
  const list = cityTavern(city.id);
  const open = (city.services || []).includes('tavern');
  const gate = tavernGate(city.id);
  const spec = specialtyOf(city.id);

  const cards = list.slice(0, 4).map((offer) => {
    const cls = getClass(offer.classId);
    const isSpec = spec.includes(offer.classId);
    return el('div', {
      class: 'card city-mini',
      onClick: () => (open ? go('tavern') : toast('이 도시에는 주점이 없다', 'bad')),
      style: isSpec ? { borderColor: 'var(--gold-dim)' } : {},
    },
    classSprite(cls, 1) || el('div', { class: 'faint tiny', text: '—' }),
    el('div', { style: { minWidth: '0' } },
      el('div', { style: { fontWeight: '600' } }, cls ? cls.name : offer.classId,
        isSpec ? el('span', { class: 'spec-badge', style: { marginLeft: '5px' }, text: '명물' }) : null),
      el('div', { class: 'faint tiny', text: cls ? `${cls.role} · 배치 ${cls.rank === 2 ? '후열' : '전열'}` : '' }),
      el('div', { class: 'num tiny', style: { color: 'var(--gold)' }, text: `${num(offer.cost)}G` })));
  });

  const lock = !gate.ok && open
    ? el('div', { class: 'city-warn bad tiny' }, el('span', { text: '!' }),
      el('span', { text: `평판 ${gate.rep}/${gate.need} — 이 도시에서는 아직 고용할 수 없다. 의뢰를 수행해 평판을 쌓아라.` }))
    : null;

  return add(el('div', { class: 'panel col' }),
    el('h3', { text: `주점 — ${list.length}명 대기` }),
    el('div', { class: 'faint tiny', text: `${city.tier || 1}등급 도시. 등급이 높을수록, 평판이 높을수록 좋은 용병이 굴러 나온다.` }),
    lock,
    cards.length
      ? el('div', { class: 'cards city-mini-cards' }, cards)
      : el('div', { class: 'faint tiny', text: '오늘은 탁자가 비어 있다.' }),
    el('div', { class: 'row', style: { marginTop: '4px', gap: '6px' } },
      el('button', {
        class: 'btn sm', disabled: !open,
        onClick: () => go('tavern'),
      }, gate.ok ? '주점으로' : '주점 조건 보기'),
      !gate.ok
        ? el('button', {
          class: 'btn sm primary', disabled: !(city.services || []).includes('guild'),
          onClick: () => go('quests'),
        }, '의뢰소로')
        : null));
}

/* ---------- 5. 상점 신상품 ---------- */

function shopPanel(city) {
  const list = cityShop(city.id).slice()
    .sort((a, b) => (b.rarity - a.rarity) || (shopPrice(b) - shopPrice(a)))
    .slice(0, 3);

  const open = (city.services || []).includes('shop');
  const cards = list.map((it) => el('div', {
    class: 'card',
    onClick: () => (open ? openShop(city) : toast('이 도시에는 상점이 없다', 'bad')),
  },
  el('div', { class: 'row spread center', style: { gap: '8px' } },
    itemName(it),
    el('span', { class: 'num tiny', style: { color: 'var(--gold)' }, text: `${num(shopPrice(it))}G` })),
  el('div', { class: 'faint tiny', text: `${SLOT_NAME[it.slot] || it.slot}${it.weaponType ? ` · ${weaponTypeName(it.weaponType)}` : ''} · iLv${it.ilvl} · ${RARITY_NAME[it.rarity] || ''}` }),
  el('div', { class: 'muted tiny', text: statLine(itemStats(it)) })));

  return el('div', { class: 'panel col' },
    el('h3', { text: '상점 신상품' }),
    cards.length
      ? el('div', { class: 'cards city-mini-cards' }, cards)
      : el('div', { class: 'faint tiny', text: '좌판이 닫혀 있다.' }),
    el('div', { class: 'row', style: { marginTop: '4px' } },
      el('button', {
        class: 'btn sm', disabled: !(city.services || []).includes('shop'),
        onClick: () => openShop(city),
      }, '물건 보기')));
}

/* ---------- 6. 부대 상태 + 경고 ---------- */

/** 부대 한 줄의 상태 칸 — 대기 중 / 원정 중(복귀일 + 진행 바) */
function squadStatusCell(sq) {
  if (!isAway(sq)) {
    return el('td', {},
      el('div', { class: 'tiny sq-idle', text: '대기 중' }),
      el('div', { class: 'faint tiny', text: '오늘 출정할 수 있다' }));
  }
  const left = awayLeft(sq);
  const total = awayTotal(sq, left);
  const done = clamp(total - left, 0, total);
  return el('td', {},
    el('div', { class: 'tiny sq-away', text: '원정 중' }),
    el('div', { class: 'faint tiny num', text: `${num(returnDayOf(sq))}일차 복귀 · 남은 ${left}일` }),
    el('div', { class: 'bar sq-bar' },
      el('i', { style: { width: `${Math.round((done / Math.max(1, total)) * 100)}%` } })));
}

/** 부대 한 줄의 "다음 전직" 칸 — 레벨업이 느려졌으니 목표(Lv15/35/55)를 보여준다. */
function squadPromoCell(sq) {
  const p = squadPromo(sq);
  if (!p) return el('td', { class: 'faint tiny' }, '—');
  if (p.ready) {
    return el('td', {}, el('span', { class: 'tiny sq-promo-ready', text: `전직 가능 ${p.ready}명` }),
      p.best ? el('div', { class: 'faint tiny num', text: `다음 Lv${p.best.need} · ${p.best.remain} 남음` }) : null);
  }
  if (p.best) {
    return el('td', { class: 'tiny' },
      el('b', { class: 'num', text: `Lv${p.best.need}` }),
      el('span', { class: 'faint', text: ` · ${p.best.remain} 남음` }));
  }
  if (p.maxed && p.maxed === p.total) return el('td', {}, el('span', { class: 'tiny sq-promo-max', text: '만렙' }));
  return el('td', { class: 'faint tiny' }, '—');
}

function squadPanel(city) {
  const rows = state.squads.map((sq) => {
    const members = squadMembers(state, sq.id);
    const wounded = members.filter((m) => isWounded(m, state.day));
    const away = isAway(sq);
    return el('tr', { class: away ? 'row-away' : '' },
      el('td', {}, el('div', { style: { fontWeight: '600', color: away ? 'var(--ember)' : 'var(--ink)' }, text: sq.name }),
        el('div', { class: 'faint tiny', text: `전력 ${num(squadPower(state, sq.id))}` })),
      squadStatusCell(sq),
      el('td', { class: 'num' }, `${members.length}/${SQUAD_SIZE}`),
      el('td', { class: 'num' }, members.length ? `Lv${squadAvgLevel(state, sq.id)}` : '—'),
      squadPromoCell(sq),
      el('td', { class: 'num', style: { color: wounded.length ? 'var(--bad)' : 'var(--ink-dim)' } }, `${wounded.length}명`),
      el('td', { class: 'num' }, `${num(squadUpkeep(state, sq.id))}G`));
  });

  // 7열짜리 표는 폰 폭을 넘는다. 페이지가 아니라 이 래퍼 안에서만 가로로 밀리게 감싼다.
  const table = el('div', { class: 'city-tablewrap' },
    el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        el('th', { text: '부대' }), el('th', { text: '상태' }), el('th', { text: '인원' }),
        el('th', { text: '평균' }), el('th', { text: '다음 전직' }), el('th', { text: '부상' }), el('th', { text: '임금' }))),
      el('tbody', {}, rows)));

  // 전 부대가 원정 중이면 "그럼 뭘 해야 하나"를 바로 이어 준다.
  const idleCount = state.squads.filter((sq) => !isAway(sq)).length;
  const nextIn = nextReturnIn();
  const blockedBlock = state.squads.length && !idleCount
    ? el('div', { class: 'col', style: { gap: '6px' } },
      el('div', { class: 'city-warn bad tiny' }, el('span', { text: '!' }),
        el('span', { text: `지금 보낼 수 있는 부대가 없다. 전 부대가 원정 중이니 날짜를 넘겨야 한다${nextIn > 0 ? ` — 최단 ${nextIn}일 뒤 복귀` : ''}.` })),
      nextIn > 0
        ? el('div', { class: 'row' },
          el('button', { class: 'btn sm primary', onClick: () => passDays(nextIn) }, `${nextIn}일 넘겨 복귀시키기`))
        : null)
    : null;

  const hurt = woundedRoster();
  const hurtBlock = hurt.length
    ? el('div', { class: 'col', style: { gap: '4px' } },
      el('div', { class: 'faint tiny', text: `부상자 ${hurt.length}명 — 복귀 예정일` }),
      el('div', { class: 'city-hurt' }, hurt.map(woundedChip)),
      el('div', { class: 'row', style: { marginTop: '2px' } },
        el('button', { class: 'btn sm primary', onClick: () => openRest(city) }, '여관에서 휴식')))
    : null;

  return add(el('div', { class: 'panel col' }),
    el('h3', { text: '부대 현황' }),
    state.squads.length ? table : el('div', { class: 'faint tiny', text: '편성된 부대가 없다.' }),
    state.squads.length
      ? el('div', { class: 'city-scrollhint faint tiny', text: '← 표를 좌우로 밀면 나머지 칸이 보인다' })
      : null,
    state.squads.length > 1
      ? el('div', { class: 'faint tiny', text: '부대마다 따로 움직인다 — 같은 날 서로 다른 의뢰에 보낼 수 있다.' })
      : el('div', { class: 'faint tiny', text: '부대를 하나 더 만들면 한 부대가 원정 나간 날에도 다른 의뢰를 받을 수 있다.' }),
    blockedBlock,
    hurtBlock,
    el('div', { class: 'col', style: { gap: '6px' } }, warnings(city)),
    el('div', { class: 'row', style: { marginTop: '4px' } },
      el('button', { class: 'btn sm', onClick: () => go('company') }, '용병단 편성'),
      el('button', { class: 'btn sm', onClick: () => go('inventory') }, '장비 관리')));
}

function warnings(city) {
  const out = [];
  const warn = (text, kind = '') => out.push(el('div', { class: `city-warn tiny ${kind}` },
    el('span', { text: kind === 'bad' ? '!' : kind === 'ok' ? '·' : '?' }), el('span', { text })));

  if (!state.roster.length) {
    warn('단원이 한 명도 없다. 주점에서 용병을 고용해야 한다.', 'bad');
  }
  if (!state.squads.length) {
    warn('편성된 부대가 없다. 용병단 화면에서 부대를 만들어라.', 'bad');
  }
  for (const sq of state.squads) {
    if (isAway(sq)) {
      warn(`${sq.name}${josa(sq.name, '은/는')} 원정 중이다 — ${num(returnDayOf(sq))}일차 복귀 (남은 ${awayLeft(sq)}일). 그때까지 다른 의뢰를 받을 수 없다.`);
      continue;
    }
    const members = squadMembers(state, sq.id);
    if (!members.length) { warn(`${sq.name}에 배치된 용병이 없다. 출정할 수 없다.`, 'bad'); continue; }
    const wounded = members.filter((m) => isWounded(m, state.day));
    const fit = members.length - wounded.length;
    if (!fit) {
      warn(`${sq.name}이(가) 전원 부상이다. 회복 전에는 출정할 수 없다 — 여관에서 쉬어라.`, 'bad');
    } else if (wounded.length >= Math.ceil(members.length / 2)) {
      warn(`${sq.name}의 절반 이상(${wounded.length}명)이 부상 중이다. ${fit}명으로는 버겁다 — 휴식을 권한다.`, 'bad');
    } else if (wounded.length) {
      const back = Math.max(...wounded.map((m) => m.woundUntil || 0));
      warn(`${sq.name}에 부상자 ${wounded.length}명 — ${num(back)}일차 전원 복귀. 그때까지는 ${fit}명으로 출정한다.`);
    }
  }

  // 평판 — 주점 잠금은 "왜 고용이 안 되지?"로 이어지므로 여기서도 한 줄 남긴다.
  const gate = tavernGate(city.id);
  if ((city.services || []).includes('tavern')) {
    if (!gate.ok) {
      warn(`${city.name}의 주점은 아직 잠겨 있다 (평판 ${gate.rep}/${gate.need}). 의뢰를 완수해 평판을 쌓아야 고용할 수 있다.`, 'bad');
    } else if (gate.rep < 50) {
      warn(`이 도시의 평판은 ${gate.rep}이다. 의뢰를 더 쌓으면 주점의 고등급 확률이 올라간다.`);
    }
  }

  const cap = Number(state.rosterCap);
  if (Number.isFinite(cap) && cap > 0 && state.roster.length >= cap) {
    warn(`단원 정원이 가득 찼다 (${state.roster.length}/${Math.round(cap)}). 용병단 화면에서 숙소를 넓혀야 더 고용할 수 있다.`, 'bad');
  }

  const idle = state.roster.filter((m) => !m.squadId).length;
  if (idle) warn(`부대에 배치되지 않은 용병이 ${idle}명 있다. 임금은 그대로 나간다.`);

  const upkeep = totalUpkeep();
  if (upkeep > 0 && state.gold < upkeep * 3) {
    warn(`금고가 위험하다. 남은 골드로 ${Math.floor(state.gold / upkeep)}일치 임금밖에 못 준다.`, 'bad');
  }

  const quests = cityQuests(city.id);
  if (quests.length && state.squads.length) {
    const best = Math.max(0, ...state.squads.map((sq) => squadAvgLevel(state, sq.id)));
    const easiest = Math.min(...quests.map((q) => q.level));
    if (best > 0 && easiest > best + 5) {
      warn(`이 도시의 가장 쉬운 의뢰도 권장 Lv${easiest}다. 부대 평균 Lv${best}로는 벅차다.`, 'bad');
    }
  }

  if (!out.length) warn('부대는 출정할 준비가 되어 있다.', 'ok');
  return out;
}

/* ---------- 7. 최근 소식 ---------- */

function logPanel() {
  // 평판 변동 줄은 금색으로 띄운다 — 의뢰 결과가 도시에 어떻게 남았는지 여기서 확인한다.
  const rows = state.log.slice(0, 8).map((e) => el('div', { class: 'tiny' },
    el('span', { class: 'faint num', text: `${e.day}일 ` }),
    el('span', { class: `${/평판/.test(e.text || '') ? 'city-log-rep' : 'muted'}`, text: e.text })));
  return el('div', { class: 'panel col' },
    el('h3', { text: '최근 소식' }),
    el('div', { class: 'city-list', style: { gap: '4px' } },
      rows.length ? rows : el('div', { class: 'faint tiny', text: '기록이 없다.' })));
}

/* ─────────────────────────── 휴식 ─────────────────────────── */

function openRest(city) {
  let days = 1;
  const info = el('div', { class: 'col', style: { gap: '8px', marginTop: '12px' } });
  const btns = [1, 2, 3].map((d) => el('button', {
    class: 'btn sm', onClick: () => { days = d; paint(); },
  }, `${d}일`));

  /** 선택한 일수 기준 단원별 예상 결과 표 */
  function previewTable() {
    const rows = state.roster.map((m) => {
      const p = restPreview(m, days);
      const cls = getClass(m.classId);
      const full = p.hp >= p.maxHp;
      return el('tr', {},
        el('td', {},
          el('span', { style: { color: GRADE_COLOR[m.grade] || 'var(--ink)', fontWeight: '600' }, text: m.name }),
          el('div', { class: 'faint tiny', text: cls ? `${cls.name} Lv${m.level}` : `Lv${m.level}` })),
        el('td', { class: 'num tiny' },
          el('span', { class: 'faint', text: `${num(p.cur)} → ` }),
          el('b', { style: { color: full ? 'var(--ok)' : 'var(--ink)' }, text: num(p.hp) }),
          el('span', { class: 'faint', text: ` / ${num(p.maxHp)}` })),
        el('td', { class: 'tiny' }, p.wounded
          ? (p.recovers
            ? el('span', { style: { color: 'var(--ok)' }, text: `${num(state.day + days)}일차 복귀` })
            : el('span', { style: { color: 'var(--bad)' }, text: `${num(p.back)}일차 복귀 (부상 지속)` }))
          : el('span', { class: 'faint', text: full ? '완전 회복' : '이상 없음' })));
    });
    if (!rows.length) return el('div', { class: 'faint tiny', text: '단원이 없다.' });
    return el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        el('th', { text: '단원' }), el('th', { text: '체력' }), el('th', { text: '휴식 후' }))),
      el('tbody', {}, rows));
  }

  function paint() {
    btns.forEach((b, i) => { b.className = `btn sm${i + 1 === days ? ' primary' : ''}`; });
    const fee = restFee(days);
    const wage = totalUpkeep() * days;
    const hurt = woundedRoster();
    const back = hurt.filter((m) => restPreview(m, days).recovers).length;

    info.innerHTML = '';
    add(info,
      previewTable(),
      el('div', { class: 'sep' }),
      kv('숙박비', `${num(fee)} G`),
      kv(`${days}일치 임금`, `${num(wage)} G`),
      kv('총 지출', `${num(fee + wage)} G`, state.gold >= fee + wage ? 'var(--gold)' : 'var(--bad)'),
      kv('휴식 후 골드', `${num(Math.max(0, state.gold - fee - wage))} G`),
      el('div', { class: 'muted tiny' },
        hurt.length
          ? `부상자 ${hurt.length}명 중 ${back}명이 이 휴식으로 복귀한다. (여관은 하루당 ${REST_WOUND_STEP}일치씩 회복을 앞당긴다)`
          : '부상자는 없다. 체력만 회복한다.'),
      state.gold < fee ? el('div', { class: 'city-warn bad tiny' },
        el('span', { text: '!' }), el('span', { text: '숙박비가 부족하다.' })) : null,
      state.gold >= fee && state.gold < fee + wage ? el('div', { class: 'city-warn tiny' },
        el('span', { text: '?' }), el('span', { text: '숙박비는 되지만 임금이 밀린다. 명성이 깎인다.' })) : null,
    );
  }
  paint();

  modal({
    title: `${city.name}의 여관`,
    wide: true,
    body: el('div', { class: 'city-modal' },
      el('div', { class: 'muted tiny', text: '따뜻한 국물과 마른 침상. 얼마나 묵을까?' }),
      el('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } }, btns),
      info),
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: '묵는다',
        kind: 'primary',
        act: (close) => {
          const fee = restFee(days);
          if (state.gold < fee) { toast('골드가 부족합니다.', 'bad'); return false; }

          // 결과 요약은 실제 상태 변화를 재서 만든다 (restAtInn 의 반환 형태에 의존하지 않는다).
          const before = new Map(state.roster.map((m) => [m.uid, {
            hp: Math.round(m.hp || 0), status: m.status, wound: m.woundUntil || 0,
          }]));
          const goldBefore = state.gold;

          addGold(-fee);
          addLog(`${city.name}의 여관에서 ${days}일간 묵었다. 숙박비 ${num(fee)}G.`);
          doRest(days);
          try { refreshCity(state.cityId); } catch (e) { console.warn('[city] 도시 목록 갱신 실패', e); }

          // 화면을 먼저 다시 그린다 — refresh()가 dispose()를 부르며 모달 레이어를 비우므로
          // 결과 모달은 그 뒤에 띄워야 살아남는다.
          close();
          refresh();
          showRestResult(city, days, goldBefore, before);
          return false;
        },
      },
    ],
  });
}

/**
 * 실제 휴식 처리. state.js 의 restAtInn(days)를 우선 쓰고,
 * 아직 없거나 실패하면 예전 방식(부상 기간 단축 + advanceDays)으로 되돌아간다.
 */
function doRest(days) {
  const fn = typeof GameState.restAtInn === 'function' ? GameState.restAtInn : null;
  if (fn) {
    try { return fn(days); } catch (e) {
      console.warn('[city] restAtInn 실패 — 기존 방식으로 대체합니다.', e);
    }
  }
  return legacyRest(days);
}

/** 폴백: 하루당 maxHp 45% 회복 + 부상 잔여 1일 추가 단축 후 날짜를 넘긴다. */
function legacyRest(days) {
  for (const m of state.roster) {
    if (m.status === 'wounded') m.woundUntil = Math.max(state.day, (m.woundUntil || 0) - days * WOUND_SPEEDUP);
    const maxHp = maxHpOf(m);
    m.maxHp = maxHp;
    m.hp = clamp(Math.round((m.hp || 0) + maxHp * HEAL_INN * days), 1, maxHp);
  }
  return advanceDays(days);
}

/** 휴식 결과 요약 모달 + 토스트 */
function showRestResult(city, days, goldBefore, before) {
  const recovered = [];
  const healed = [];
  for (const m of state.roster) {
    const b = before.get(m.uid);
    if (!b) continue;
    if (b.status === 'wounded' && m.status !== 'wounded') recovered.push(m.name);
    const gain = Math.round((m.hp || 0) - (b.hp || 0));
    if (gain > 0) healed.push({ name: m.name, grade: m.grade, gain, hp: Math.round(m.hp || 0), max: maxHpOf(m) });
  }
  const stillHurt = woundedRoster();
  const spent = Math.max(0, goldBefore - state.gold);

  const rows = healed.map((h) => el('div', { class: 'city-krow tiny' },
    el('span', { style: { color: GRADE_COLOR[h.grade] || 'var(--ink)', fontWeight: '600' }, text: h.name }),
    el('span', { class: 'num' },
      el('span', { style: { color: 'var(--ok)' }, text: `+${num(h.gain)}` }),
      el('span', { class: 'faint', text: ` (${num(h.hp)} / ${num(h.max)})` }))));

  const body = el('div', { class: 'col city-modal', style: { gap: '8px' } },
    el('div', { class: 'muted tiny', text: `${city.name}에서 ${days}일을 흘려보냈다. 지금은 ${calLabel()}.` }),
    kv('지출', `${num(spent)} G`),
    kv('남은 골드', `${num(state.gold)} G`, 'var(--gold)'),
    el('div', { class: 'sep' }),
    recovered.length
      ? el('div', { class: 'city-warn ok tiny' }, el('span', { text: '·' }),
        el('span', { text: `부상에서 복귀: ${recovered.join(', ')}` }))
      : el('div', { class: 'faint tiny', text: '이번 휴식으로 복귀한 부상자는 없다.' }),
    stillHurt.length
      ? el('div', { class: 'city-warn bad tiny' }, el('span', { text: '!' }),
        el('span', { text: `아직 부상 ${stillHurt.length}명 — 최단 복귀 ${num(Math.min(...stillHurt.map(backDay)))}일차` }))
      : null,
    rows.length
      ? el('div', { class: 'col', style: { gap: '3px' } },
        el('div', { class: 'faint tiny', text: '회복한 체력' }), rows)
      : null);

  toast(recovered.length
    ? `${days}일 휴식 · ${recovered.length}명 복귀`
    : `${days}일 휴식했습니다.`, 'good');

  modal({
    title: '휴식을 마쳤다',
    body,
    actions: [{ label: '좋다', kind: 'primary' }],
  });
}

/* ─────────────────────────── 상점 ─────────────────────────── */

function openShop(city) {
  const body = el('div', { class: 'col city-dlg' });
  const paint = () => {
    const list = cityShop(city.id);
    body.innerHTML = '';
    add(body,
      el('div', { class: 'row spread center' },
        el('span', { class: 'muted tiny', text: `${city.name} 상점 — 재고는 ${restockIn(city.id, 'shop')}일 뒤 바뀐다.` }),
        el('span', { class: 'num', style: { color: 'var(--gold)' }, text: `보유 ${num(state.gold)}G` })));
    if (!list.length) {
      body.appendChild(el('div', { class: 'faint tiny', style: { marginTop: '10px' }, text: '상인이 좌판을 접었다.' }));
      return;
    }
    const rows = list.map((it) => el('tr', {},
      el('td', {}, itemName(it),
        el('div', { class: 'faint tiny', text: statLine(itemStats(it)) })),
      el('td', { class: 'tiny muted' }, `${SLOT_NAME[it.slot] || it.slot}${it.weaponType ? `/${weaponTypeName(it.weaponType)}` : ''}`),
      el('td', { class: 'num tiny' }, `iLv${it.ilvl}`),
      el('td', { class: 'num', style: { color: 'var(--gold)' } }, `${num(shopPrice(it))}G`),
      el('td', {}, el('button', {
        class: 'btn sm primary', disabled: state.gold < shopPrice(it),
        onClick: () => { buy(city, it); paint(); },
      }, '구매'))));
    body.appendChild(el('table', { class: 'data', style: { marginTop: '10px' } },
      el('thead', {}, el('tr', {},
        el('th', { text: '물품' }), el('th', { text: '부위' }),
        el('th', { text: '레벨' }), el('th', { text: '가격' }), el('th', { text: '' }))),
      el('tbody', {}, rows)));
  };
  paint();

  modal({
    title: '상점',
    wide: true,
    body,
    actions: [{ label: '나가기', kind: 'ghost' }],
    onClose: () => refresh(),
  });
}

function buy(city, it) {
  const price = shopPrice(it);
  if (state.gold < price) { toast('골드가 부족합니다.', 'bad'); return; }
  const list = cityShop(city.id);
  const i = list.indexOf(it);
  if (i < 0) return;
  list.splice(i, 1);
  addGold(-price);
  const item = { ...it };
  delete item.price;
  addItem(item);
  addLog(`${city.name} 상점에서 ${item.name}${josa(item.name)} ${num(price)}G에 샀다.`);
  toast(`${item.name} 구매`, 'good');
}

/* ─────────────────────────── 대장간 ─────────────────────────── */

function openSmith(city) {
  const body = el('div', { class: 'col city-dlg' });

  const paint = () => {
    const list = state.items.slice().sort((a, b) => (b.rarity - a.rarity) || (b.ilvl - a.ilvl));
    /* ★★ **`isSellable` 이 유일한 출처다** (gear.js). 예전엔 여기서 `rarity === 0` 만 봤는데
     *   `inventory()` 는 «착용 중» 만 거르고 **잠금·noSell·세트를 안 본다** (gear.js:inventory).
     *   ⇒ 플레이어가 **잠가 둔** 일반 등급이 이 목록에 담겨 팔렸다. 실측으로 재현했다.
     *   gear.js 가 잠금에 대해 「자동 착용이 뺏어가지 못하고, 벗기지도 못하고,
     *   **팔리지도 않는다**」 고 못 박은 그 계약이 이 경로에서만 깨져 있었다.
     *   같은 일을 하는 `ui/inventory.js` 는 처음부터 `isSellable` 을 썼다 — 두 벌이 갈렸던 것이다. */
    const junk = inventory(state).filter((it) => (it.rarity || 0) === 0 && isSellable(it, state));
    const junkGold = junk.reduce((a, it) => a + sellPrice(it), 0);

    body.innerHTML = '';
    add(body,
      el('div', { class: 'row spread center' },
        el('span', { class: 'muted tiny', text: '장착 중인 장비는 팔 수 없다. 재감정은 접사를 처음부터 다시 굴린다.' }),
        el('span', { class: 'num', style: { color: 'var(--gold)' }, text: `보유 ${num(state.gold)}G` })),
      junk.length
        ? el('div', { class: 'row', style: { marginTop: '8px' } },
          el('button', {
            class: 'btn sm',
            onClick: async () => {
              /* ★★ 서버가 «이건 못 판다» 고 한 것만 뺀다. 못 물으면 빈 집합이라
               *   지금까지대로 전부 판다 — 새로 막히는 사람이 생기면 안 된다. */
              const ask = await askSell(junk.map((x) => x.uid), state.day);
              const blocked = ask.blocked || new Set();
              let g = 0;
              for (const it of junk) {
                if (blocked.has(it.uid)) continue;
                const r = sellItem(state, it.uid); if (r.ok) g += r.gold;
              }
              if (blocked.size) toast(`${blocked.size}점은 지금 팔 수 없습니다.`, 'bad');
              addLog(`대장간에 잡동사니 ${junk.length}점을 넘기고 ${num(g)}G를 받았다.`);
              toast(`${junk.length}점 매각 · +${num(g)}G`, 'good');
              paint();
            },
          }, `일반 등급 일괄 매각 (${junk.length}점 · ${num(junkGold)}G)`))
        : null);

    if (!list.length) {
      body.appendChild(el('div', { class: 'faint tiny', style: { marginTop: '10px' }, text: '팔 만한 장비가 없다.' }));
      return;
    }

    const rows = list.map((it) => {
      const owner = ownerOf(state, it.uid);
      const fee = reforgeFee(it);
      return el('tr', {},
        el('td', {}, itemName(it),
          el('div', { class: 'faint tiny', text: statLine(itemStats(it)) })),
        el('td', { class: 'tiny muted' }, `${SLOT_NAME[it.slot] || it.slot}${it.weaponType ? `/${weaponTypeName(it.weaponType)}` : ''}`),
        el('td', { class: 'tiny' }, owner
          ? el('span', { style: { color: GRADE_COLOR[owner.grade] || 'var(--ink-dim)' }, text: owner.name })
          : el('span', { class: 'faint', text: '창고' })),
        el('td', { class: 'num tiny' }, `iLv${it.ilvl}`),
        el('td', {}, el('div', { class: 'row', style: { gap: '6px' } },
          el('button', {
            class: 'btn sm', disabled: !!owner,
            title: owner ? '장착 중' : '',
            onClick: () => { sell(it); paint(); },
          }, `매각 ${num(sellPrice(it))}G`),
          el('button', {
            class: 'btn sm', disabled: state.gold < fee || !!it.unique,
            title: it.unique ? '고유 장비는 다시 벼릴 수 없다' : '',
            onClick: () => { reforge(it); paint(); },
          }, `재감정 ${num(fee)}G`))));
    });

    body.appendChild(el('table', { class: 'data', style: { marginTop: '10px' } },
      el('thead', {}, el('tr', {},
        el('th', { text: '장비' }), el('th', { text: '부위' }), el('th', { text: '소지' }),
        el('th', { text: '레벨' }), el('th', { text: '' }))),
      el('tbody', {}, rows)));
  };
  paint();

  modal({
    title: `${city.name}의 대장간`,
    wide: true,
    body,
    actions: [{ label: '나가기', kind: 'ghost' }],
    onClose: () => refresh(),
  });
}

async function sell(it) {
  /* ★ 서버가 규칙으로 거절하면 안 판다. 못 물으면 지금까지대로 판다. */
  const ask = await askSell([it.uid], state.day);
  if (ask.blocked && ask.blocked.has(it.uid)) { toast('지금은 팔 수 없습니다.', 'bad'); return; }
  const r = sellItem(state, it.uid);
  if (!r.ok) { toast(r.reason, 'bad'); return; }
  addLog(`대장간에 ${it.name}${josa(it.name)} ${num(r.gold)}G에 넘겼다.`);
  toast(r.reason, 'good');
}

/** 접사를 다시 굴린다. uid를 유지하므로 장착 상태는 그대로 남는다. */
function reforge(it) {
  const fee = reforgeFee(it);
  if (state.gold < fee) { toast('수수료가 부족합니다.', 'bad'); return; }
  let fresh = null;
  try {
    fresh = rollItem({ ilvl: it.ilvl, rarity: it.rarity, baseId: it.baseId, slot: it.slot, rng });
  } catch (e) {
    console.warn('[city] 재감정 실패', e);
  }
  if (!fresh) { toast('다시 벼릴 수 없는 장비입니다.', 'bad'); return; }
  addGold(-fee);
  const before = statLine(itemStats(it), ', ');
  it.name = fresh.name;
  it.stats = fresh.stats;
  it.baseStats = fresh.baseStats;
  it.affixes = fresh.affixes;
  it.value = fresh.value;
  it.rarity = fresh.rarity;
  addLog(`${it.name}${josa(it.name)} 다시 벼렸다. (${num(fee)}G) 이전: ${before}`);
  toast(`재감정 완료 — ${statLine(itemStats(it), ', ')}`, 'good');
}
