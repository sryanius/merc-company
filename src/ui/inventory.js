// 장비 화면 — 보유 장비 목록 / 필터·정렬 / 상세·비교 / 장착 / 개별·일괄 판매 / 세트 수집 현황.
// 화면 모듈 계약: meta / render(root, params) / dispose()
//
// 설계 A(10슬롯) · B(신화 세트) 반영:
//  - 부위 필터가 10칸이다. 반지처럼 후보가 둘인 아이템은 `slotAccepts` 로 판정한다.
//  - 희귀도 5 = 신화(세트). 카드에 세트 이름과 `3/10` 보유 현황을 같이 찍어
//    "이걸 모으려면 던전을 돌아야 한다"가 목록에서 바로 보이게 한다.
//  - 상단에 세트 수집 현황 패널 — 4세트 × 10칸을 슬롯 점(pip)으로 그린다.
import { el, num, clamp } from '../core/util.js';
import { refresh, toast, modal, go } from './app.js';
import { state, addLog, save } from '../game/state.js';
import { getClass } from '../data/classes.js';
import { makePalette, RARITY_COLOR, RARITY_NAME, GRADE_COLOR } from '../art/palette.js';
import { getPart } from '../art/parts.js';
import { mercStats, mercPower, weaponPartOf, shieldPartOf, armorPartOf, isWounded } from '../game/merc.js';
import {
  SLOTS, SLOT_NAME, itemStats, itemPower, sellPrice, sellItem, equipItem, unequipSlot,
  equipIssue, weaponTypeName, josa, autoEquipAll, recommendMercsFor, isUpgrade,
} from '../game/gear.js';
// 1단계에서 늘어난 API(슬롯 규칙·세트·달력·던전)는 전부 네임스페이스로 받는다.
// 명명 import 로 받으면 상대 모듈에 그 export 가 아직 없을 때 **모듈 링크가 통째로 실패**해
// 장비 화면이 아예 안 뜬다. 네임스페이스 + typeof 검사면 최악의 경우에도 폴백이 돈다.
import * as GearAPI from '../game/gear.js';
import * as MercAPI from '../game/merc.js';
import * as ItemsAPI from '../data/items.js';
import * as SetsAPI from '../data/sets.js';
import * as DungeonAPI from '../data/dungeons.js';
import * as StateAPI from '../game/state.js';

export const meta = { id: 'inventory', title: '장비' };

/* ─────────────────────────── 상수 ─────────────────────────── */

const STAT_KEYS = ['hp', 'atk', 'def', 'res', 'spd', 'crit', 'critDmg', 'eva'];
const PCT_KEYS = new Set(['crit', 'critDmg', 'eva']);
const STAT_LABEL = {
  hp: '체력', atk: '공격', def: '방어', res: '저항',
  spd: '속도', crit: '치명', critDmg: '치명피해', eva: '회피',
};

/** 아키타입 한국어 (세트 착용 제한 표기용) */
const ARCH_NAME = {
  tank: '방패', fighter: '전사', lancer: '창병', archer: '궁수',
  rogue: '도적', mage: '마법사', healer: '치유사',
};

/* ── 희귀도 0~5 (5 = 신화) ──────────────────────────────────────────────
 * `art/palette.js` 가 아직 5단계(0~4)일 수 있어 부족한 칸을 여기서 채운다.
 * data/items.js 가 6단계 표를 주면 언제나 그쪽이 이긴다. */
const MYTHIC = 5;
const MYTHIC_COLOR = SetsAPI.MYTHIC_COLOR || '#ff5f3a';
const MYTHIC_GLOW = SetsAPI.MYTHIC_GLOW || '#ffd27a';
const R_NAMES = pickTable(ItemsAPI.RARITY_NAME, RARITY_NAME, SetsAPI.MYTHIC_NAME || '신화');
const R_COLORS = pickTable(ItemsAPI.RARITY_COLOR, RARITY_COLOR, MYTHIC_COLOR);

/** 6칸짜리 표를 고른다 (모자라면 마지막 칸을 신화 값으로 채운다) */
function pickTable(a, b, tail) {
  const src = (Array.isArray(a) && a.length > MYTHIC) ? a : (Array.isArray(b) ? b : []);
  const out = src.slice();
  while (out.length <= MYTHIC) out.push(tail);
  return out;
}

/** 희귀도별 아이콘 팔레트 (등급이 올라갈수록 값비싼 재질로 보이게) */
const R_METAL = ['iron', 'bronze', 'steel', 'silver', 'gold', 'blood'];
const R_CLOTH = ['ash', 'forest', 'azure', 'violet', 'ember', 'crimson'];
const R_LEATHER = ['dark', 'brown', 'tan', 'brown', 'tan', 'dark'];
const R_GLOW = ['none', 'none', 'arcane', 'shadow', 'holy', 'blood'];

/* ─────────────────────────── 화면 상태 ─────────────────────────── */

const filter = { slot: '', rarity: '', equipped: '', setId: '', sort: 'ilvl' };
/** 세트 수집 현황 패널 접기 */
let setPanelOpen = true;
/** 좁은 화면에서 필터 줄을 접어 둔다 (PC 에서는 늘 펼쳐진 채로 보인다) */
let filterOpen = false;

/* ─────────────────── 목록 페이징 ───────────────────
 *
 * ★★ 창고가 커지니 화면이 버벅였다 (제작자 지적). 실측:
 *     50개 52ms · 200개 163ms · 500개 431ms · **900개 704ms**
 *   아이콘을 캐시해 296ms 까지 줄였지만, 남은 비용은 **카드 DOM 900개** 자체다
 *   (캐시가 더워진 뒤 재렌더도 234ms). 화면에 안 보이는 카드까지 만들 이유가 없다.
 *
 * ★ 한 부위로 좁히면 104장 = **35ms** 였다. 그래서 두 가지를 같이 넣는다:
 *   부위 탭(바로 좁히기) + 페이지 상한(전체 보기 보호).
 *
 * ★ 상한을 «화면 밖은 안 만든다» 수준으로 잡는다. 120장이면 어떤 화면에서도
 *   한 번에 다 안 보이므로 «잘린 느낌» 이 안 나면서 비용은 1/7 이 된다. */
const PAGE_SIZE = 120;
let shown = PAGE_SIZE;

/* ── 모바일 판정 ────────────────────────────────────────────────
 * 레이아웃은 **폭**으로만 가른다 — 터치 되는 1280px 노트북에서 PC 레이아웃이
 * 무너지면 안 된다. CSS 의 미디어 쿼리와 같은 경계(767px = css/style.css 공용 기준선)를 쓴다. */
const NARROW_MQ = '(max-width: 767px)';
function isNarrow() {
  try { return window.matchMedia(NARROW_MQ).matches; } catch { return false; }
}
/** 좁은 화면에서는 짧은 문구를 쓴다 */
const short = (narrowText, wideText) => (isNarrow() ? narrowText : wideText);
/** 넓은 표는 페이지가 아니라 자기 상자 안에서만 가로 스크롤시킨다 (가로 스크롤 금지 규칙) */
const xs = (node) => el('div', { class: 'iv-xs' }, node);

/** 기본값에서 벗어난 필터 개수 — 접혀 있어도 "지금 뭔가 걸려 있다"를 알 수 있게 */
function activeFilterCount() {
  let n = 0;
  for (const k of ['slot', 'rarity', 'setId', 'equipped']) if (filter[k]) n++;
  if (filter.sort !== 'ilvl') n++;
  return n;
}

/**
 * 확인 모달. `app.js confirmDlg` 와 동작은 같지만 본문에 `iv-mbody` 를 달아
 * 이 화면 전용 모바일 규칙(전체화면화)이 걸리게 한다.
 */
function confirmBox(title, message, onYes, yesLabel = '확인') {
  modal({
    title,
    body: el('div', { class: 'col iv-mbody' }, el('div', { text: message })),
    actions: [
      { label: '취소', kind: 'ghost' },
      { label: yesLabel, kind: 'primary', act: () => { onYes(); } },
    ],
  });
}

export function dispose() { /* 타이머·rAF를 쓰지 않는다 */ }

/* ─────────────────────────── 스타일 ─────────────────────────── */

const STYLE_ID = 'inventory-style';
const CSS = `
/* 단원별 착용 장비 — 부대마다 블록 하나. 11열이라 **표만** 옆으로 스크롤한다
   (페이지가 통째로 넘어가면 안 된다 — .iv-wscroll 이 스크롤을 가둔다). */
.iv-wgroup { margin-top: 10px; border-radius: 8px; overflow: hidden;
             border: 1px solid var(--line-soft); background: rgba(255,255,255,.02); }
.iv-wgroup.bench { opacity: .62; }
.iv-whead { display: flex; justify-content: space-between; align-items: center; gap: 8px;
            padding: 6px 10px; background: rgba(224,180,74,.10); color: var(--gold); }
.iv-wgroup.bench .iv-whead { background: rgba(255,255,255,.05); color: var(--ink-dim); }
.iv-wscroll { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
.iv-worn { margin: 0; }
.iv-worn th, .iv-worn td { vertical-align: top; white-space: nowrap; }
.iv-worn .iv-wname { position: sticky; left: 0; z-index: 1; background: var(--panel, #171225);
                     min-width: 132px; box-shadow: 1px 0 0 var(--line-soft); }
.iv-worn .iv-wcell { max-width: 128px; }
.iv-worn .iv-witem { overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.iv-worn .iv-witem:hover { text-decoration: underline; }
.iv-worn .iv-wmerc { cursor: pointer; }
.iv-worn .iv-wmerc:hover { text-decoration: underline; }
.iv-worn .iv-wcell.empty { color: var(--ink-faint); text-align: center; }
@media (max-width: 767px) {
  .iv-worn .iv-wcell { max-width: 104px; font-size: 12px; }
  .iv-worn .tiny { font-size: 12px; }
  /* 폰에서는 이름 열 고정을 푼다 — 화면 폭이 좁아 고정 열이 내용 자리를 잡아먹는다.
     대신 부대 블록마다 머리말이 있어 누구 줄인지는 스크롤해도 잃지 않는다. */
  .iv-worn .iv-wname { position: static; min-width: 96px; box-shadow: none; }
}

.iv-icon{display:flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden;border-radius:5px;
  background:radial-gradient(circle at 50% 50%,#241e31,#100d17);border:1px solid var(--line-soft);}
.iv-card{border-left-width:3px;}
.iv-in{background:var(--bg-1);border:1px solid var(--line);border-radius:5px;padding:5px 8px;color:var(--ink);}
.iv-in:focus{outline:none;border-color:var(--gold-dim);}
.iv-row{display:flex;align-items:center;gap:10px;padding:7px 9px;border:1px solid var(--line-soft);border-radius:5px;background:var(--bg-1);}
.iv-row.pick{cursor:pointer;}
.iv-row.pick:hover{border-color:var(--gold-dim);background:var(--bg-2);}
.iv-affix{padding:6px 9px;border-left:2px solid var(--arcane);background:rgba(168,111,214,.07);border-radius:0 5px 5px 0;}
.iv-empty{padding:28px;text-align:center;}
.iv-rec{border-left:3px solid var(--gold);background:rgba(224,180,74,.08);border-radius:0 5px 5px 0;padding:7px 10px;}
.iv-plan{border:1px solid var(--line);border-radius:6px;padding:9px 11px;background:var(--bg-1);}
.iv-swap{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.iv-scroll{max-height:48vh;overflow-y:auto;padding-right:4px;}

/* 신화(세트) — 전설(주황)과 확실히 구분되는 붉은 금빛 */
.iv-card.myth{border-color:${MYTHIC_COLOR};border-left-color:${MYTHIC_COLOR};
  background:linear-gradient(180deg,rgba(255,95,58,.10),rgba(0,0,0,0) 60%);
  box-shadow:0 0 14px -7px ${MYTHIC_GLOW};}
.iv-myth-tag{display:inline-flex;align-items:center;gap:4px;padding:0 7px;border-radius:999px;
  font-size:10px;font-weight:800;line-height:1.7;white-space:nowrap;
  color:${MYTHIC_GLOW};border:1px solid ${MYTHIC_COLOR};background:rgba(255,95,58,.12);}

/* 세트 수집 현황 */
.iv-setpanel{display:flex;flex-direction:column;gap:9px;}
.iv-setrow{border:1px solid var(--line-soft);border-radius:6px;padding:8px 10px;background:var(--bg-1);
  display:flex;flex-direction:column;gap:5px;border-left:3px solid var(--line);}
.iv-setrow.done{border-left-color:${MYTHIC_COLOR};background:linear-gradient(180deg,rgba(255,95,58,.08),rgba(0,0,0,0));}
.iv-setrow.open{box-shadow:0 0 0 1px var(--gold-dim) inset;}
.iv-pips{display:flex;gap:3px;flex-wrap:wrap;}
.iv-pip{width:26px;height:18px;border-radius:3px;border:1px solid var(--line);background:var(--bg-0);
  font-size:9px;line-height:16px;text-align:center;color:var(--ink-faint);white-space:nowrap;overflow:hidden;}
.iv-pip.on{border-color:${MYTHIC_COLOR};color:${MYTHIC_GLOW};background:rgba(255,95,58,.16);font-weight:700;}
.iv-pip.worn{border-color:var(--gold);color:var(--gold);background:rgba(224,180,74,.16);}
.iv-warn{padding:7px 10px;border-radius:5px;border:1px solid #6e5a2b;background:rgba(224,180,74,.10);color:#e7cf94;}
.iv-danger{padding:7px 10px;border-radius:5px;border:1px solid #6e2b34;background:rgba(168,58,74,.12);color:#eba9a9;}
.iv-step{display:flex;gap:8px;align-items:baseline;padding:4px 8px;border-radius:4px;border-left:2px solid var(--line);}
.iv-step.on{border-left-color:var(--gold);background:rgba(224,180,74,.08);}
.iv-step.off{opacity:.42;}

/* 넓은 표는 페이지가 아니라 이 상자 안에서만 가로로 스크롤한다 */
.iv-xs{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;}
/* 필터 접기 버튼은 폰에서만 나타난다 (PC 는 지금까지처럼 항상 펼쳐져 있다) */
.iv-ftoggle{display:none;}

/* ══════════════════════ 모바일 (≤767px) ══════════════════════
 * 전부 미디어 쿼리 안이다 — 1280px PC 화면은 한 픽셀도 달라지지 않는다.
 *   ① 필터(부위·희귀도·세트·장착·정렬 5종)를 접이식 패널로
 *   ② 아이템 목록 1열 카드
 *   ③ 터치 타겟 40px · 글자 하한 12px
 *   ④ 상세 모달을 거의 전체 화면으로
 */
@media (max-width:767px){
  .iv-root{gap:10px;}
  .iv-root .panel{padding:10px;}
  .iv-root .panel>h3,.iv-root .panel-title{margin:0 0 7px;font-size:12px;}

  /* ① 접이식 필터 — 펼치면 2칸씩 떨어져 손가락으로 고를 수 있다 */
  .iv-ftoggle{display:inline-flex;align-items:center;justify-content:center;}
  .iv-filters{display:none;flex-basis:100%;gap:8px;}
  .iv-filters.open{display:flex;}
  .iv-filters>*{flex:1 1 42%;min-width:0;}

  /* ③ 터치 타겟 40px / 글자 하한 12px */
  .iv-root .btn,.iv-mbody .btn{min-height:40px;}
  .iv-root .btn.sm,.iv-mbody .btn.sm{min-height:40px;padding:8px 12px;font-size:13px;}
  .iv-root .iv-in,.iv-mbody .iv-in{min-height:40px;font-size:13px;padding:8px 9px;}
  .iv-root .tiny,.iv-mbody .tiny{font-size:12px;}
  .iv-root .tag,.iv-mbody .tag{font-size:12px;}
  .iv-myth-tag{font-size:12px;}
  .iv-row{padding:9px;gap:8px;}
  .iv-row.pick{min-height:52px;}
  .iv-scroll{max-height:52vh;}

  /* 세트 수집 pip — 손가락으로도 짚어지게 키운다 */
  .iv-pip{width:40px;height:24px;font-size:12px;line-height:22px;}
  .iv-setrow{padding:9px;}

  /* 표는 칸을 좁히고, 그래도 넘치면 자기 상자 안에서만 가로 스크롤 */
  .iv-root table.data th,.iv-root table.data td,
  .iv-mbody table.data th,.iv-mbody table.data td{padding:5px 6px;font-size:12px;white-space:nowrap;}

  /* ④ 상세 모달 — 2단을 1단으로 접고, 창을 거의 전체 화면으로.
     modal 의 wide 옵션이 인라인으로 min-width:760px 을 박기 때문에 !important 가 필요하다.
     :has() 로 **이 화면이 띄운 모달에만** 걸어 다른 화면 모듈과 부딪히지 않게 한다. */
  .iv-dl,.iv-dr{flex:1 1 100% !important;min-width:0 !important;}
  #modal-layer:has(.iv-mbody){padding:8px;align-items:flex-start;}
  #modal-layer:has(.iv-mbody)>.modal{min-width:0 !important;width:100%;max-width:100% !important;
    max-height:calc(100dvh - 16px);}
  /* mobile-ok: 여기 sticky 는 **모달 안쪽 스크롤 상자**에 붙는다 — 페이지가 아니라
     max-height:calc(100dvh - 16px) 짜리 모달 자신이 스크롤 컨테이너다. 아이템 상세가 길어도
     장착/판매 버튼이 항상 손에 닿게 하는 용도다. */
  #modal-layer:has(.iv-mbody)>.modal>header{padding:12px 14px;position:sticky;top:0;z-index:2;background:var(--bg-2);}
  #modal-layer:has(.iv-mbody)>.modal>.body{padding:12px;}
  #modal-layer:has(.iv-mbody)>.modal>footer{padding:10px 12px;position:sticky;bottom:0;z-index:2;background:var(--bg-1);}
  .iv-mbody{min-width:0 !important;}
}

/* ② 아이템 목록은 1열 카드 (한 줄에 두 장이 들어가면 이름이 전부 잘린다) */
@media (max-width:560px){
  .iv-root .cards{grid-template-columns:minmax(0,1fr);}
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(el('style', { id: STYLE_ID, text: CSS }));
}

/* ─────────────────────────── 확장 API 어댑터 ─────────────────────────── */

const fnOf = (ns, name) => (ns && typeof ns[name] === 'function' ? ns[name] : null);

/** 이 아이템이 들어갈 수 있는 대표 슬롯 (반지는 ring1) */
function slotOf(item) {
  const f = fnOf(GearAPI, 'primarySlot');
  if (f) { try { return f(item) || item?.slot || null; } catch { /* noop */ } }
  return item?.slot || null;
}

/** 그 슬롯이 이 아이템을 받는가 (반지 2칸·옛 슬롯까지 감안) */
function accepts(slot, item) {
  const f = fnOf(GearAPI, 'slotAccepts');
  if (f) { try { return !!f(slot, item); } catch { /* noop */ } }
  return item && item.slot === slot;
}

/** 아이템의 세트 id */
function setIdOfItem(item) {
  if (!item) return null;
  if (item.setId) return item.setId;
  const f = fnOf(GearAPI, 'setIdOf');
  if (f) { try { return f(item) || null; } catch { /* noop */ } }
  return null;
}

/** 신화(세트) 아이템인가 */
const isMythic = (it) => !!(it && ((it.rarity || 0) >= MYTHIC || it.mythic || setIdOfItem(it)));
/** 팔 수 없는 장비인가 (던전 세트는 매각 대상이 아니다) */
// 판매 가능 판정은 `gear.js isSellable` 이 유일한 출처다 —
// 자동 판매(전투 결과)와 규칙이 갈리면 세트 조각이 한쪽에서만 팔린다.
const isProtected = (it) => !GearAPI.isSellable(it);

/** 세트 정의 목록 (data/sets.js 우선) */
function setDefList() {
  if (Array.isArray(SetsAPI.SET_LIST) && SetsAPI.SET_LIST.length) return SetsAPI.SET_LIST.slice();
  if (SetsAPI.SETS && typeof SetsAPI.SETS === 'object') return Object.values(SetsAPI.SETS);
  return [];
}

/**
 * 세트 정의를 찾는다.
 * ⚠ `data/dungeons.js` 의 `setId` 와 `data/sets.js` 의 id 가 어긋난 세트가 있어(steelwall/starshot ↔
 *   ironrampart/starseeker) **이름으로도 한 번 더 찾는다.** 그래도 없으면 gear.js 폴백.
 */
function setDefFor(setId, setName = '') {
  const list = setDefList();
  const get = fnOf(SetsAPI, 'getSet');
  if (setId && get) { try { const d = get(setId); if (d) return d; } catch { /* noop */ } }
  if (setId) { const d = list.find((s) => s && s.id === setId); if (d) return d; }
  if (setName) { const d = list.find((s) => s && s.name === setName); if (d) return d; }
  const g = fnOf(GearAPI, 'setDefOf');
  if (setId && g) { try { const d = g(setId); if (d) return d; } catch { /* noop */ } }
  return null;
}

/** 아이템으로 세트 정의 찾기 (이름까지 넘겨 id 불일치를 흡수) */
const setDefOfItem = (it) => (it ? setDefFor(setIdOfItem(it), it.setName || '') : null);

/** 세트 이름 (정의가 없어도 아이템에 실린 이름을 쓴다) */
function setNameOfItem(it) {
  const d = setDefOfItem(it);
  return (d && d.name) || it?.setName || setIdOfItem(it) || '';
}

/**
 * 세트 정의를 UI 공용 형태로 정규화한다.
 * data/sets.js: `bonuses:{3,5,7,full}` = {stats,mods,special,specialLabel,desc}
 * gear.js     : `bonus:{...}`         = {stats,mods,specials:[]}
 * @returns {{id, name, desc, archs, color, steps:Array}|null}
 */
function normSetDef(d) {
  if (!d) return null;
  const raw = d.bonuses || d.bonus || {};
  const keyNum = (k) => (k === 'full' || k === 'max' ? 999 : Number(k));
  const steps = Object.keys(raw)
    .filter((k) => k === 'full' || k === 'max' || Number.isFinite(Number(k)))
    .sort((a, b) => keyNum(a) - keyNum(b))
    .map((k) => {
      const b = raw[k] || {};
      const sp = Array.isArray(b.specials) ? b.specials : (b.special ? [b.special] : []);
      const first = sp[0];
      const spName = b.specialLabel
        || (first && typeof first === 'object' ? (first.label || first.name) : null)
        || null;
      const spDesc = (first && typeof first === 'object' ? first.desc : '') || '';
      return {
        key: (k === 'full' || k === 'max') ? 'full' : Number(k),
        stats: b.stats || {},
        mods: b.mods || {},
        specialName: spName,
        desc: b.desc || spDesc || '',
      };
    });
  return {
    id: d.id || '',
    name: d.name || d.id || '세트',
    desc: d.desc || '',
    archs: Array.isArray(d.archs) ? d.archs.slice() : null,
    color: d.color || MYTHIC_COLOR,
    steps,
  };
}

/** 단계 하나에 필요한 착용 개수 */
const stepNeed = (key, full) => (key === 'full' ? full : Number(key) || 0);
/** 단계 표기 */
const stepLabel = (key, full) => (key === 'full' ? `풀세트(${full})` : `${key}세트`);

/** 그 세트를 떨어뜨리는 던전 (없으면 null) */
function dungeonForSet(def) {
  const list = Array.isArray(DungeonAPI.DUNGEON_LIST) ? DungeonAPI.DUNGEON_LIST : [];
  if (!def || !list.length) return null;
  return list.find((d) => d && (d.setId === def.id || d.setName === def.name)) || null;
}

/** 이번 주에 열리는 던전 번호 (1~4). 알 수 없으면 0 */
function openWeek() {
  const f = fnOf(StateAPI, 'openDungeonWeek');
  if (!f) return 0;
  try { return clamp(Math.round(f(state.day) || 0), 0, 4); } catch { return 0; }
}

/** 날짜 표기 `3년 7월 2주차 (245일차)` */
function dayLabel() {
  const f = fnOf(StateAPI, 'calendarLabel');
  if (f) { try { return f(state.day); } catch { /* noop */ } }
  return `${num(state.day || 1)}일차`;
}

/* ─────────────────────────── 아이콘 (파츠 도트) ─────────────────────────── */

/** 슬롯 10칸에 맞는 파츠 이름 (SPEC §4.4 어휘 안에서만 고른다) */
function itemPartName(item) {
  if (!item) return 'wpn_orb';
  const slot = slotOf(item);
  switch (slot) {
    case 'weapon':
      if (item.weaponType === 'shield') return shieldPartOf(item) || 'shd_round';
      return weaponPartOf(item) || 'wpn_sword';
    case 'offhand':
      return (MercAPI.offhandPartOf ? MercAPI.offhandPartOf(item) : null) || shieldPartOf(item) || 'shd_buckler';
    case 'head':
      return (MercAPI.helmPartOf ? MercAPI.helmPartOf(item) : null) || 'helm_iron';
    case 'body':
      return armorPartOf(item) || 'armor_mail';
    case 'legs':
      return (MercAPI.legPartOf ? MercAPI.legPartOf(item) : null) || 'leg_mail';
    // 장갑·신발·장신구는 전용 파츠가 없다 — SPEC §4.4 어휘 안에서 가장 가까운 것을 쓴다
    case 'hands': return 'arm_heavy';
    case 'feet': return 'leg_plate';
    case 'neck': return 'wpn_orb';
    case 'ring1': case 'ring2': return 'shd_orb';
    case 'armor': return armorPartOf(item) || 'armor_leather';
    default: return 'wpn_orb';
  }
}

function itemPalette(item) {
  const r = clamp(item?.rarity || 0, 0, MYTHIC);
  // 세트 아이템은 그 세트의 고유 팔레트를 쓴다 (4세트가 색으로 구분된다)
  const def = setDefOfItem(item);
  if (def && def.palette) {
    return { skin: 'pale', hair: 'brown', metal: 'steel', cloth: 'ash', leather: 'dark', accent: 'gold', glow: 'none', ...def.palette };
  }
  return {
    skin: 'pale', hair: 'brown',
    metal: R_METAL[r], cloth: R_CLOTH[r], leather: R_LEATHER[r],
    accent: r >= 3 ? 'gold' : r >= 1 ? 'bronze' : 'iron',
    glow: R_GLOW[r],
  };
}

/** 파츠 픽셀을 그대로 찍어낸 아이콘 */
/* ─────────────────── 아이콘 캐시 ───────────────────
 *
 * ★★ 창고가 커지니 화면이 버벅였다 (제작자 지적). 재 보니 **아이템 수에 정비례**했다:
 *   50개 52ms · 200개 163ms · 500개 431ms · **900개 704ms**.
 *
 *   원인은 아이템마다 `<canvas>` 를 만들고 **픽셀 하나씩 fillRect** 한 것이었다.
 *   그런데 실제로 서로 다른 그림은 몇 개 안 된다 — 900개 창고에서 **91종**뿐이었다
 *   (같은 부품 + 같은 희귀도면 그림이 같다). 캐시 적중률 89.9%,
 *   칠하는 픽셀이 94만 → 9.5만으로 줄어든다.
 *
 * ★ 캔버스 대신 **data URL + `<img>`** 로 둔다. 같은 URL 은 브라우저가 한 번만 디코드해
 *   재사용하므로, 900개를 띄워도 실제 이미지는 91장이다. 캔버스 900개를 들고 있는 것보다
 *   메모리도 훨씬 가볍다.
 *
 * ★ 키는 «부품 · 희귀도 · 세트 · 크기» 다. 팔레트가 이 셋에서 나오므로(itemPalette 참고)
 *   이 넷이 같으면 그림이 같다. 세트 조각은 세트 고유 팔레트를 쓰므로 setId 가 필요하다. */
const ICON_CACHE = new Map();

function iconDataUrl(item, box) {
  const part = itemPartName(item);
  const key = `${part}|${item?.rarity || 0}|${setIdOfItem(item) || ''}|${box}`;
  const hit = ICON_CACHE.get(key);
  if (hit !== undefined) return hit;

  let url = null;
  try {
    const p = getPart(part);
    const scale = Math.max(1, Math.min(3, Math.floor((box - 4) / Math.max(p.w, p.h, 1))));
    const c = el('canvas', { width: p.w * scale, height: p.h * scale });
    const ctx = c.getContext('2d');
    const pal = makePalette(itemPalette(item));
    for (let r = 0; r < p.h; r++) {
      const row = p.px[r] || '';
      for (let x = 0; x < p.w; x++) {
        const col = pal[row[x]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, r * scale, scale, scale);
      }
    }
    url = c.toDataURL();
  } catch (e) { console.warn('[inventory] 아이콘 생성 실패', e); url = null; }
  ICON_CACHE.set(key, url);
  return url;
}

function itemIcon(item, box = 46) {
  const wrap = el('div', {
    class: 'iv-icon',
    style: {
      width: `${box}px`,
      height: `${box}px`,
      borderColor: isMythic(item) ? MYTHIC_COLOR : 'var(--line-soft)',
    },
  });
  const url = iconDataUrl(item, box);
  if (url) {
    wrap.appendChild(el('img', {
      src: url, alt: '', width: box - 4, height: box - 4,
      // 픽셀아트라 보간을 끈다 — 안 끄면 확대된 그림이 뭉개진다
      style: { imageRendering: 'pixelated', objectFit: 'contain' },
    }));
  }
  return wrap;
}

/* ─────────────────────────── 소도구 ─────────────────────────── */

const rColor = (it) => (isMythic(it) ? MYTHIC_COLOR : R_COLORS[clamp(it?.rarity || 0, 0, MYTHIC)]);
const rName = (it) => R_NAMES[clamp(it?.rarity || 0, 0, MYTHIC)] || '일반';

/** equipment 객체가 실제로 쓰는 키들 (옛 세이브 키가 남아 있어도 훑는다) */
function slotKeysOf(eq) {
  const keys = SLOTS.slice();
  if (eq && typeof eq === 'object') for (const k of Object.keys(eq)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** itemUid -> 장착 중인 용병 */
function ownerMap() {
  const m = new Map();
  for (const merc of state.roster || []) {
    const eq = merc.equipment;
    if (!eq) continue;
    for (const s of slotKeysOf(eq)) if (eq[s]) m.set(eq[s], merc);
  }
  return m;
}

const itemByUid = (uid) => (state.items || []).find((x) => x && x.uid === uid) || null;

function statText(k, v) {
  const n = PCT_KEYS.has(k) ? Math.round(v * 10) / 10 : Math.round(v);
  return `${STAT_LABEL[k] || k} ${n > 0 ? '+' : ''}${PCT_KEYS.has(k) ? n : num(n)}${PCT_KEYS.has(k) ? '%' : ''}`;
}

function statLine(stats) {
  const parts = [];
  for (const k of STAT_KEYS) if (stats[k]) parts.push(statText(k, stats[k]));
  return parts.join('  ') || '보정 없음';
}

/** 비율 보정 한 줄 (`공격 +12% · 방어 +20%`) */
function modLine(mods) {
  const parts = [];
  for (const k of STAT_KEYS) if (mods && mods[k]) parts.push(`${STAT_LABEL[k]} ${mods[k] > 0 ? '+' : ''}${Math.round(mods[k] * 100)}%`);
  return parts.join(' · ');
}

function deltaSpan(k, d) {
  const v = PCT_KEYS.has(k) ? Math.round(d * 10) / 10 : Math.round(d);
  if (!v) return null;
  return el('span', {
    class: 'tiny num',
    style: { color: v > 0 ? 'var(--ok)' : 'var(--bad)' },
    text: `${STAT_LABEL[k]} ${v > 0 ? '+' : ''}${PCT_KEYS.has(k) ? v : num(v)}${PCT_KEYS.has(k) ? '%' : ''}`,
  });
}

/* ─────────────────────────── 세트 수집 집계 ─────────────────────────── */

/**
 * 세트별 수집 현황.
 * @returns {Map<string, {slots:Map<string,object>, worn:Set<string>, count:number}>}
 *   key 는 "세트 정의 id" (정의가 없으면 아이템의 setId)
 */
function setCollection() {
  const owners = ownerMap();
  const out = new Map();
  for (const it of state.items || []) {
    const sid = setIdOfItem(it);
    if (!sid) continue;
    const def = setDefOfItem(it);
    const key = (def && def.id) || sid;
    if (!out.has(key)) out.set(key, { slots: new Map(), worn: new Set(), count: 0 });
    const e = out.get(key);
    const slot = it.setSlot || slotOf(it) || it.slot || '?';
    if (!e.slots.has(slot)) { e.slots.set(slot, it); e.count++; }
    if (owners.has(it.uid)) e.worn.add(slot);
  }
  return out;
}

/**
 * 이 세트가 그 용병의 아키타입을 위한 것인가 (설계 B의 아키타입 제한).
 * 판정 기준은 `data/sets.js` 다. **착용을 막지는 않는다** — 가부는 gear.js 의 몫이고
 * 여기서는 "의도된 대상이 아니다"만 알려 준다.
 * @returns {string|null} 어긋날 때만 짧은 안내 문구
 */
function setArchWarn(merc, item) {
  const sid = setIdOfItem(item);
  if (!sid) return null;
  const arch = (getClass(merc && merc.classId) || {}).arch;
  if (!arch) return null;
  const can = fnOf(SetsAPI, 'canWearSet');
  const d = normSetDef(setDefOfItem(item));
  let ok = true;
  if (can) { try { ok = !!can(sid, arch); } catch { ok = true; } }
  else if (d && Array.isArray(d.archs) && d.archs.length) ok = d.archs.includes(arch);
  if (ok) return null;
  const names = d && d.archs && d.archs.length ? d.archs.map((a) => ARCH_NAME[a] || a).join('·') : '다른';
  return `${names} 계열 전용 세트`;
}

/** 착용 중인 장비의 세트별 개수 (equipment 맵 기준) */
function setCountsOf(equipment) {
  const m = new Map();
  const seen = new Set();
  for (const s of slotKeysOf(equipment)) {
    const u = equipment && equipment[s];
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const it = itemByUid(u);
    const sid = it && setIdOfItem(it);
    if (sid) m.set(sid, (m.get(sid) || 0) + 1);
  }
  return m;
}

/* ─────────────────────────── 진입점 ─────────────────────────── */

export function render(root, params = {}) {
  injectStyle();
  if (params.slot && SLOTS.includes(params.slot)) filter.slot = params.slot;
  if (params.setId) filter.setId = params.setId;

  const owners = ownerMap();
  const list = filteredItems(owners);

  root.appendChild(el('div', { class: 'col iv-root' },
    headerPanel(owners, list),
    setPanel(),
    wornPanel(),
    listPanel(list, owners)));
}

/* ─────────────────────────── 상단: 필터 / 일괄 판매 ─────────────────────────── */

function headerPanel(owners, list) {
  const all = state.items || [];
  const free = all.filter((it) => !owners.has(it.uid));
  const sellable = free.filter((it) => !isProtected(it));
  const stock = sellable.reduce((a, it) => a + (it.value || 0), 0);

  const sel = (opts, value, onchange) => {
    // 필터가 바뀌면 목록이 달라진다 — 페이지를 처음으로 되돌린다
    const s = el('select', { class: 'iv-in', onChange: (e) => { onchange(e.target.value); shown = PAGE_SIZE; refresh(); } });
    for (const [v, label] of opts) s.appendChild(el('option', { value: v, selected: v === value, text: label }));
    return s;
  };

  const setOpts = [['', '전체 세트'], ['any', '세트 아이템만']];
  for (const raw of setDefList()) {
    const d = normSetDef(raw);
    if (d) setOpts.push([d.id, d.name]);
  }

  const nf = activeFilterCount();
  // 필터가 5종이라 폰에서는 세 줄까지 넘친다 — 접이식 패널로 만들고 걸린 개수만 버튼에 남긴다.
  const filters = el('div', { class: `row wrap center iv-filters${filterOpen ? ' open' : ''}`, style: { gap: '6px' } },
    sel([['', '전체 부위'], ...SLOTS.map((s) => [s, SLOT_NAME[s] || s])], filter.slot, (v) => { filter.slot = v; }),
    sel([['', '전체 희귀도'], ...R_NAMES.map((n, i) => [String(i), i === MYTHIC ? `${n}(세트)` : n])], filter.rarity, (v) => { filter.rarity = v; }),
    sel(setOpts, filter.setId, (v) => { filter.setId = v; }),
    sel([['', '전체'], ['no', '미장착'], ['yes', '장착 중']], filter.equipped, (v) => { filter.equipped = v; }),
    sel([['ilvl', '레벨순'], ['value', '가치순'], ['rarity', '희귀도순'], ['power', '성능순']], filter.sort, (v) => { filter.sort = v; }),
    nf
      ? el('button', {
        class: 'btn sm ghost',
        onClick: () => { filter.slot = ''; filter.rarity = ''; filter.setId = ''; filter.equipped = ''; filter.sort = 'ilvl'; refresh(); },
      }, '필터 초기화')
      : null);

  /* ★ 부위 탭 — 가장 자주 쓰는 필터라 접이식 안에 묻어 두지 않는다.
   *   한 부위로 좁히면 카드가 1/9 로 줄어 화면이 즉시 가벼워진다 (실측 234ms → 35ms). */
  const slotTabs = el('div', { class: 'row wrap center iv-slottabs', style: { gap: '4px' } },
    [['', '전체'], ...SLOTS.map((s0) => [s0, SLOT_NAME[s0] || s0])].map(([v, label]) => {
      const on = (filter.slot || '') === v;
      // 이 파일의 래퍼를 쓴다 — GearAPI 직접 호출은 반지 2칸·옛 슬롯 처리가 빠진다
      const n = v ? all.filter((it) => accepts(v, it)).length : all.length;
      return el('button', {
        class: `btn sm ${on ? 'primary' : 'ghost'}`,
        onClick: () => { filter.slot = v; shown = PAGE_SIZE; refresh(); },
      }, `${label} ${n}`);
    }));

  return el('div', { class: 'panel col' },
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('h3', { class: 'panel-title', style: { margin: '0' }, text: `창고 — ${list.length} / ${all.length}점` }),
      el('div', { class: 'row center wrap', style: { gap: '6px' } },
        /* ★ 펫 진입점 (제작자: 「펫 관리를 용병단 진형 쪽에서 들어가야 해서 불편하다」).
         *   용병단 → 진형까지 스크롤 → 펫 관리 였던 것을 장비 탭 한 번으로 줄인다.
         *   여기에 둔 이유는 펫이 «단원» 이 아니라 **부대에 딸려 오는 장비 같은 존재**이기 때문이다
         *   (app.js SCREENS 의 pets 주석도 처음부터 「장비 관리와 같은 결」 이라고 적혀 있다).
         *   from 을 넘겨야 펫 화면이 «장비로» 돌아갈 곳을 안다. */
        el('button', {
          class: 'btn sm ghost', onClick: () => go('pets', { from: 'inventory' }),
        }, '🐾 펫 관리'),
        el('button', {
          class: `btn sm iv-ftoggle${nf ? ' primary' : ' ghost'}`,
          onClick: () => { filterOpen = !filterOpen; refresh(); },
        }, filterOpen ? '필터 접기' : (nf ? `필터·정렬 (${nf})` : '필터·정렬'))),
      filters),
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('div', { class: 'tiny faint', text: `미장착 ${free.length}점 · 매각 가능 ${sellable.length}점 / ${num(stock)}G (전부 팔면 약 ${num(sellable.reduce((a, it) => a + sellPrice(it), 0))}G)` }),
      el('div', { class: 'row wrap', style: { gap: '6px' } },
        el('button', { class: 'btn sm primary', onClick: openAutoEquipPicker }, '자동 착용'),
        bulkSellControl())),
    slotTabs,
    autoSellControl(),
    el('div', { class: 'tiny faint', text: '신화(세트) 장비는 판매되지 않습니다 — 던전에서만 나오는 한정 장비입니다.' }));
}

/**
 * 단원 상세를 **이 화면 위에** 띄운다 (장비 화면을 벗어나지 않는다).
 *
 * 모달 본문은 `ui/company.js` 가 갖고 있다 — 스프라이트 애니메이션·클래스 계보·전직 후보까지
 * 붙은 화면이라 여기서 다시 만들 이유가 없다. 동적 import 로 그 함수만 빌려 온다
 * (정적 import 하면 두 화면이 서로를 물어 순환 참조가 된다).
 */
async function openMercDetailHere(uid) {
  try {
    const mod = await import('./company.js');
    if (typeof mod.openMercDetail === 'function') { mod.openMercDetail(uid); return; }
    go('company', { mercUid: uid });          // 옛 빌드 폴백
  } catch (e) {
    console.warn('[inventory] 단원 상세 열기 실패', e);
    go('company', { mercUid: uid });
  }
}

/* ───────────────────── 단원별 착용 장비 한눈에 ───────────────────── */

/** 펼침 상태 (화면을 다시 그려도 유지) */
let wornPanelOpen = false;

/** uid -> 아이템 (없으면 null) */
const itemOf = (uid) => (uid ? (state.items || []).find((x) => x && x.uid === uid) || null : null);

/**
 * 누가 무엇을 끼고 있는지 한 표로 본다.
 * 창고 목록만으로는 "이 전설이 누구 것인지" 를 카드마다 열어 봐야 알 수 있었다.
 */
function wornPanel() {
  const roster = (state.roster || []).filter(Boolean);
  if (!roster.length) return null;

  const assigned = new Map();   // uid -> 부대명
  for (const sq of state.squads || []) {
    for (const u of sq.memberUids || []) if (u) assigned.set(u, sq.name || '부대');
  }

  const panel = el('div', { class: 'panel col' });
  panel.appendChild(el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
    el('h3', { class: 'panel-title', style: { margin: '0' }, text: `단원별 착용 장비 — ${roster.length}명` }),
    el('button', {
      class: 'btn sm ghost',
      onClick: () => { wornPanelOpen = !wornPanelOpen; refresh(); },
    }, wornPanelOpen ? '접기' : '펼치기')));

  if (!wornPanelOpen) {
    const bare = roster.filter((m) => !Object.values(m.equipment || {}).some(Boolean)).length;
    const full = roster.filter((m) => SLOTS.every((s) => m.equipment && m.equipment[s])).length;
    panel.appendChild(el('div', { class: 'tiny faint', text: `10칸 전부 채운 단원 ${full}명 · 아무것도 안 낀 단원 ${bare}명` }));
    return panel;
  }

  /* 부대별로 끊어 준다. 한 표에 39명을 세로로 이어 붙이면 누가 어느 부대인지 안 보인다.
   * 부대 순서 → 그 안에서는 배치 슬롯 순서(편성판과 같은 순서). 마지막에 대기 인원. */
  const groups = [];
  const used = new Set();
  for (const sq of state.squads || []) {
    const members = (sq.memberUids || [])
      .map((u) => roster.find((m) => m.uid === u))
      .filter(Boolean);
    members.forEach((m) => used.add(m.uid));
    if (members.length) groups.push({ name: sq.name || '부대', members, bench: false });
  }
  const rest = roster.filter((m) => !used.has(m.uid))
    .sort((a, b) => mercPower(b, state) - mercPower(a, state));
  if (rest.length) groups.push({ name: `대기 인원 ${rest.length}명`, members: rest, bench: true });

  for (const g of groups) {
    const head = el('tr', {}, el('th', { text: '단원' }),
      ...SLOTS.map((sl) => el('th', { class: 'iv-wcell', text: SLOT_NAME[sl] || sl })));

    const rows = g.members.map((m) => {
      const c = getClass(m.classId) || {};
      const sets = new Map();
      for (const sl of SLOTS) {
        const it = itemOf(m.equipment && m.equipment[sl]);
        const nm = it && setNameOfItem(it);
        if (nm) sets.set(nm, (sets.get(nm) || 0) + 1);
      }
      const setTag = [...sets.entries()].map(([nm, n]) => `${nm} ${n}`).join(' · ');
      const filled = SLOTS.filter((sl) => m.equipment && m.equipment[sl]).length;

      return el('tr', {},
        el('td', { class: 'iv-wname' },
          el('div', {
            class: 'iv-wmerc',
            style: { fontWeight: '700', color: GRADE_COLOR[m.grade] || 'var(--ink)' },
            title: '용병 상세 보기',
            onClick: () => openMercDetailHere(m.uid),
          }, m.name),
          el('div', { class: 'tiny faint', text: `${c.name || m.classId} Lv${m.level || 1} · ${filled}/${SLOTS.length}칸` }),
          setTag ? el('div', { class: 'tiny', style: { color: MYTHIC_COLOR }, text: setTag }) : null),
        ...SLOTS.map((sl) => {
          const it = itemOf(m.equipment && m.equipment[sl]);
          if (!it) return el('td', { class: 'iv-wcell empty', text: '—' });
          return el('td', { class: 'iv-wcell' },
            el('div', {
              class: 'iv-witem',
              style: { color: rColor(it), fontWeight: isMythic(it) ? '700' : '500' },
              title: it.name,
              onClick: () => openItemDetail(it.uid),
            }, it.name),
            el('div', { class: 'tiny faint', text: `iL${it.ilvl || 1}` }));
        }));
    });

    panel.appendChild(el('div', { class: `iv-wgroup${g.bench ? ' bench' : ''}` },
      el('div', { class: 'iv-whead' },
        el('b', { text: g.name }),
        el('span', { class: 'tiny faint', text: `${g.members.length}명` })),
      el('div', { class: 'iv-wscroll' },
        el('table', { class: 'data tiny iv-worn' }, el('thead', {}, head), el('tbody', {}, rows)))));
  }

  panel.appendChild(el('div', { class: 'tiny faint', text: '칸을 누르면 그 장비의 상세가 열립니다. 회색 줄은 부대에 없는 대기 인원입니다.' }));
  return panel;
}

/* ─────────────────────────── 세트 수집 현황 ─────────────────────────── */

/** 이 세트를 **한 사람이 최대 몇 칸** 입고 있나 (보유가 아니라 착용) */
function maxWornOf(setId) {
  let best = 0;
  for (const m of state.roster || []) {
    if (!m || !m.equipment) continue;
    let n = 0;
    for (const s of Object.keys(m.equipment)) {
      const uid = m.equipment[s];
      if (!uid) continue;
      const it = (state.items || []).find((x) => x && x.uid === uid);
      if (it && setIdOfItem(it) === setId) n++;
    }
    if (n > best) best = n;
  }
  return best;
}

function setPanel() {
  const defs = setDefList().map(normSetDef).filter(Boolean);
  if (!defs.length) return null;
  const panel = el('div', { class: 'panel col' });

  const col = setCollection();
  const week = openWeek();
  const total = SLOTS.length;
  const owned = defs.reduce((a, d) => a + ((col.get(d.id) || { count: 0 }).count), 0);

  /* ★★ «수집» 은 **보유한 부위 수**다 — 「10/10」 이 «누가 풀세트를 입었다» 는 뜻이 아니다.
   *   제작자가 그렇게 읽고 물었다: 「10세트 다 모았다는데 10세트 착용한 용병이 없다」.
   *   그래서 제목 옆에 «최다 착용» 을 같이 찍는다. 두 수가 다르면 그 자리에서 보인다. */
  const bestWorn = defs.reduce((a, d) => Math.max(a, maxWornOf(d.id)), 0);
  panel.appendChild(el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
    el('h3', { class: 'panel-title', style: { margin: '0' }, text: `세트 수집 — 보유 ${owned} / ${defs.length * total}칸 · 최다 착용 ${bestWorn}칸` }),
    el('div', { class: 'row center wrap', style: { gap: '8px' } },
      el('span', { class: 'tiny faint', text: dayLabel() }),
      week ? el('span', { class: 'tag', style: { color: 'var(--gold)' }, text: `이번 주 개방: ${week}번 던전` }) : null,
      el('button', {
        class: 'btn sm ghost',
        onClick: () => { setPanelOpen = !setPanelOpen; refresh(); },
      }, setPanelOpen ? '접기' : '펼치기'))));

  if (!setPanelOpen) {
    panel.appendChild(el('div', { class: 'tiny faint', text: defs.map((d) => {
      const c0 = (col.get(d.id) || { count: 0 }).count;
      const w0 = maxWornOf(d.id);
      return `${d.name} 보유 ${c0}/${total} · 착용 ${w0}`;
    }).join('  ·  ') }));
    return panel;
  }

  const box = el('div', { class: 'iv-setpanel' });
  for (const d of defs) {
    const e = col.get(d.id) || { slots: new Map(), worn: new Set(), count: 0 };
    const dg = dungeonForSet(d);
    const isOpen = !!(dg && dg.week === week);
    const full = e.count >= total;

    const pips = el('div', { class: 'iv-pips' });
    for (const s of SLOTS) {
      const have = e.slots.has(s);
      const worn = e.worn.has(s);
      pips.appendChild(el('div', {
        class: `iv-pip${have ? (worn ? ' worn' : ' on') : ''}`,
        title: have
          ? `${SLOT_NAME[s] || s} — ${e.slots.get(s).name}${worn ? ' (착용 중)' : ''}`
          : `${SLOT_NAME[s] || s} — 미보유`,
        text: SLOT_NAME[s] || s,
      }));
    }

    const archs = d.archs && d.archs.length && d.archs.length < 7
      ? d.archs.map((a) => ARCH_NAME[a] || a).join('·')
      : '전 계열';

    box.appendChild(el('div', {
      class: `iv-setrow${full ? ' done' : ''}${isOpen ? ' open' : ''}`,
      style: { borderLeftColor: e.count ? d.color : 'var(--line)' },
    },
      el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
        el('div', { class: 'row center wrap', style: { gap: '6px' } },
          el('b', { style: { color: d.color }, text: d.name }),
          el('span', { class: 'tag', style: { color: 'var(--ink-dim)' }, text: archs }),
          dg ? el('span', { class: 'tag', style: { color: isOpen ? 'var(--gold)' : 'var(--ink-faint)' }, text: `${dg.week}주차 · ${dg.name}` }) : null,
          isOpen ? el('span', { class: 'iv-myth-tag', text: '지금 입장 가능' }) : null),
        el('div', { class: 'row center', style: { gap: '8px' } },
          el('span', { class: 'num', style: { color: e.count ? d.color : 'var(--ink-faint)', fontWeight: '700' }, text: `${e.count} / ${total}` }),
          el('button', {
            class: 'btn sm ghost',
            onClick: () => { filter.setId = d.id; filter.rarity = ''; filter.slot = ''; refresh(); },
          }, '보기'),
          el('button', { class: 'btn sm ghost', onClick: () => openSetDetail(d.id) }, '효과'))),
      pips,
      el('div', { class: 'tiny faint', text: nextStepHint(d, e.count, total) })));
  }
  panel.appendChild(box);
  panel.appendChild(el('div', {
    class: 'tiny faint',
    text: `세트 효과는 3 / 5 / 7 / 풀세트에서 단계별로 붙습니다. 풀세트 기준은 그 용병이 낄 수 있는 칸 수라 `
      + `양손무기 사용자는 ${total - 1}칸이 풀세트입니다. 조각은 던전 보스만 떨어뜨립니다 — `
      + `1~5웨이브 방어구 / 6~8웨이브 장신구 / 9~10웨이브 무기·왼손.`,
  }));
  return panel;
}

/**
 * 다음 단계까지 몇 개 남았는지 한 줄.
 * @param {object} d 정규화된 세트 정의
 * @param {number} count 보유(또는 착용) 조각 수
 * @param {number} fullCount 풀세트 기준 칸 수
 * @param {boolean} [withDesc] true 면 효과 설명까지 붙인다 (수집 패널용). 카드에는 짧은 쪽을 쓴다
 */
function nextStepHint(d, count, fullCount, withDesc = true) {
  if (!d.steps.length) return count ? `${count}조각 보유 중` : '아직 한 조각도 없다';
  const next = d.steps.find((s) => count < stepNeed(s.key, fullCount));
  if (!next) return '전 단계 효과를 열 수 있는 조각을 모두 모았다';
  const need = stepNeed(next.key, fullCount) - count;
  const head = `${stepLabel(next.key, fullCount)} 효과까지 ${need}조각`;
  return withDesc && next.desc ? `${head} 남음 — ${next.desc}` : `${head} 남음`;
}

/** 세트 효과 단계 목록 모달 */
function openSetDetail(setId) {
  const d = normSetDef(setDefFor(setId));
  if (!d) { toast('세트 정보를 찾을 수 없습니다.', 'bad'); return; }
  const col = setCollection();
  const e = col.get(d.id) || { count: 0 };
  const total = SLOTS.length;

  const body = el('div', { class: 'col iv-mbody', style: { gap: '9px', minWidth: 'min(460px, 80vw)' } },
    el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
      el('b', { style: { color: d.color, fontSize: '15px' }, text: d.name }),
      el('span', { class: 'num', style: { color: d.color }, text: `보유 ${e.count} / ${total}` })),
    d.desc ? el('div', { class: 'tiny muted', text: d.desc }) : null,
    el('div', { class: 'tiny faint', text: `착용 제한: ${d.archs && d.archs.length && d.archs.length < 7 ? d.archs.map((a) => ARCH_NAME[a] || a).join('·') + ' 계열만' : '전 계열'}` }));

  body.appendChild(el('div', { class: 'sep' }));
  for (const s of d.steps) {
    const need = stepNeed(s.key, total);
    const on = e.count >= need;
    body.appendChild(el('div', { class: `iv-step ${on ? 'on' : 'off'} col`, style: { gap: '2px' } },
      el('div', { class: 'row spread center wrap', style: { gap: '6px' } },
        el('b', { style: { color: on ? 'var(--gold)' : 'var(--ink-dim)' }, text: stepLabel(s.key, total) }),
        el('span', { class: 'tiny faint', text: on ? '보유 달성' : `${need - e.count}조각 부족` })),
      s.specialName ? el('div', { class: 'tiny', style: { color: d.color, fontWeight: '700' }, text: `★ ${s.specialName}` }) : null,
      s.desc ? el('div', { class: 'tiny muted', text: s.desc }) : null,
      Object.keys(s.stats || {}).length ? el('div', { class: 'tiny faint', text: statLine(s.stats) }) : null,
      modLine(s.mods) ? el('div', { class: 'tiny faint', text: modLine(s.mods) }) : null));
  }

  modal({ title: `${d.name} — 세트 효과`, wide: true, body, actions: [{ label: '닫기', kind: '' }] });
}

/* ─────────────────────────── 자동 착용 ─────────────────────────── */

/** 1단계 — 누구에게 배분할지 고른다 */
function openAutoEquipPicker() {
  if (!(state.roster || []).length) { toast('단원이 없습니다.', 'bad'); return; }

  const box = el('div', { class: 'col iv-mbody', style: { gap: '6px', minWidth: 'min(340px, 80vw)' } },
    el('div', { class: 'tiny faint', text: '창고의 장비를 클래스에 맞춰 10칸 전부 자동으로 끼웁니다. 전투력이 높은 단원부터 좋은 장비를 가져갑니다.' }),
    el('div', { class: 'tiny', style: { color: 'var(--gold-dim)' } },
      '부대에 없는 대기 인원의 장비는 ', el('b', { text: '먼저 자동으로 회수' }), '해 후보에 넣습니다.'),
    el('div', { class: 'tiny', style: { color: 'var(--ok)' } },
      el('b', { text: '세트는 유지됩니다.' }),
      ' 활성 세트 단계(3·5·7·10칸)를 떨어뜨리는 교체는 하지 않습니다 — '
      + '개별 스탯이 더 좋은 전설이 있어도 세트를 벗기지 않습니다.'));

  const row = (label, sub, target) => el('div', {
    class: 'iv-row pick',
    onClick: () => openAutoEquipPreview(target),
  },
    el('div', { class: 'col', style: { flex: '1', gap: '1px', minWidth: '0' } },
      el('b', { text: label }),
      sub ? el('span', { class: 'tiny faint', text: sub }) : null),
    el('span', { class: 'tiny faint', text: '미리보기 ▸' }));

  const assignedN = new Set(
    (state.squads || []).flatMap((sq) => (sq.memberUids || []).filter(Boolean)),
  ).size;
  box.appendChild(row('부대 전원', `배치된 단원 ${assignedN}명 (대기 인원 장비는 회수)`, { label: '부대 전원' }));

  const squads = (state.squads || []).filter(Boolean);
  if (squads.length) {
    box.appendChild(el('div', { class: 'sep' }));
    for (const s of squads) {
      const n = (s.memberUids || []).filter(Boolean).length;
      box.appendChild(row(s.name || '부대', `배치된 단원 ${n}명`, { label: s.name || '부대', squadId: s.id }));
    }
  }

  box.appendChild(el('div', { class: 'sep' }));
  box.appendChild(el('div', { class: 'tiny faint', text: '특정 단원만' }));
  const one = el('div', { class: 'col iv-scroll', style: { gap: '5px' } });
  for (const m of state.roster) {
    const c = getClass(m.classId) || {};
    one.appendChild(el('div', {
      class: 'iv-row pick',
      onClick: () => openAutoEquipPreview({ label: m.name, mercs: [m] }),
    },
      el('b', { style: { color: GRADE_COLOR[m.grade] || 'var(--ink)', flex: '1' }, text: m.name }),
      el('span', { class: 'tiny faint', text: `${c.name || m.classId} Lv${m.level || 1}` })));
  }
  box.appendChild(one);

  modal({ title: '자동 착용 — 대상 선택', body: box, actions: [{ label: '닫기', kind: '' }] });
}

/** 대상 지정 → autoEquipAll 옵션 */
const autoOpt = (target) => ({
  squadId: target.squadId || null,
  mercs: target.mercs || null,
  powerOf: (m) => mercPower(m, state),
  /* ★★ **백지 재배분** (제작자: 「그냥 모두 장비 해제 시키고 다시 체크하면 안 되나?
   *   그레타 흰까마귀 보면 셋템 하나인데 2부대에 풀템이 있어」).
   *
   *   한 칸씩 «지금 낀 것보다 나은가» 만 보면 이미 흩어진 세트에서 못 빠져나온다.
   *   전원 벗기고 다시 나누되, 백지에서는 첫 조각에 세트 시너지가 0 이라
   *   그냥 벗기기만 하면 오히려 더 흩어진다 — 그래서 gear.js 가 «세트 먼저 잡기» 를 함께 돈다.
   *   실측(tools/setalloc.mjs): 발동 단계 합 6 → 7, 부대 전투력 +534.
   *
   * ★ 잠근 장비는 안 벗긴다. 전리품 자동 착용(pool 지정)에는 안 걸린다 — gear.js 가 막는다. */
  reset: true,
});

/** 2단계 — 무엇이 어떻게 바뀌는지 보여주고 확정받는다 */
function openAutoEquipPreview(target) {
  const opt = autoOpt(target);
  let plan;
  try {
    plan = autoEquipAll(state, { ...opt, dryRun: true });
  } catch (e) {
    console.error('[inventory] 자동 착용 계획 실패', e);
    toast('자동 착용을 계산하지 못했습니다.', 'bad');
    return;
  }
  const rows = plan.perMerc.filter((r) => r.changed.length);

  const body = el('div', { class: 'col iv-mbody', style: { gap: '10px', minWidth: 'min(420px, 80vw)' } },
    el('div', { class: 'tiny faint', text: `대상: ${target.label}` }));

  if (!rows.length) {
    body.appendChild(el('div', { class: 'iv-empty muted' }, '창고에 지금보다 나은 장비가 없습니다.'));
    modal({ title: '자동 착용', body, actions: [{ label: '닫기', kind: '' }] });
    return;
  }

  const cards = rows.map((r) => ({ row: r, card: planCard(r) }));
  const broken = cards.filter((c) => c.card.__setBreak);

  if (broken.length) {
    body.appendChild(el('div', { class: 'iv-danger tiny' },
      el('b', { text: `세트가 깨지는 단원 ${broken.length}명 — ` }),
      '세트 단계 효과(3/5/7/풀세트)는 개별 스탯보다 큰 경우가 많습니다. ',
      '아래 붉은 줄을 확인하고, 필요하면 그 단원은 제외한 뒤 다시 실행하세요.'));
  }

  const list = el('div', { class: 'col iv-scroll', style: { gap: '8px' } });
  for (const c of cards) list.appendChild(c.card);
  body.appendChild(list);
  const taken = rows.reduce((a, r) => a + r.changed.filter((c) => c.tookFrom).length, 0);
  if (taken) {
    body.appendChild(el('div', { class: 'iv-danger tiny' },
      el('b', { text: `다른 단원에게서 가져오는 장비 ${taken}칸 — ` }),
      '빼앗기는 쪽은 그 자리가 빕니다. 지키고 싶은 장비는 창고에서 🔒 로 잠그면 자동 착용이 못 건드립니다.'));
  }
  body.appendChild(el('div', { class: 'tiny faint', text: '벗겨진 장비는 창고로 돌아갑니다. 남는 장비는 그대로 보관됩니다.' }));

  modal({
    title: `자동 착용 미리보기 — 단원 ${rows.length}명 / ${plan.total}칸`,
    wide: true,
    body,
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: `${plan.total}칸 착용`,
        kind: 'primary',
        act: () => {
          let res;
          try {
            res = autoEquipAll(state, opt);
          } catch (e) {
            console.error('[inventory] 자동 착용 실패', e);
            toast('자동 착용에 실패했습니다.', 'bad');
            return;
          }
          if (!res.total) { toast('바꿀 장비가 없었습니다.', 'bad'); return; }
          addLog(`장비를 자동으로 배분했다 — ${res.perMerc.filter((r) => r.changed.length).map((r) => r.name).join(', ')} (${res.total}칸).`);
          save();
          toast(`${res.total}칸을 자동으로 착용시켰습니다.`, 'good');
          refresh();
        },
      },
    ],
  });
}

/** 미리보기 카드 하나 — 누가 무엇을 끼우고 스탯이 얼마나 오르는지 (+ 세트 변화) */
function planCard(row) {
  const m = row.merc;
  const c = getClass(m.classId) || {};
  /* ★★ 계획이 준 **최종 장비**를 그대로 쓴다.
   *   예전에는 «지금 장비 + 변경» 으로 만들었는데, 백지 재배분에서는 그게 거짓말이 된다:
   *   재배분이 못 채운 칸을 «원래 것을 그대로 낀 것» 으로 그려서
   *   실측 예고 38칸 / 실제 30칸 이었다. 확인 화면이 손실을 숨기면 안 된다. */
  const after = row.after ? { ...row.after } : (() => {
    const a0 = { ...(m.equipment || {}) };
    for (const ch of row.changed) a0[ch.slot] = ch.to.uid;
    return a0;
  })();
  const ghost = { ...m, equipment: after };

  const sBefore = mercStats(m, state);
  const sAfter = mercStats(ghost, state);
  const pBefore = mercPower(m, state);
  const pAfter = mercPower(ghost, state);
  const dPower = pAfter - pBefore;

  const card = el('div', { class: 'iv-plan col', style: { gap: '6px' } },
    el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
      el('div', { class: 'row center', style: { gap: '6px' } },
        el('b', { style: { color: GRADE_COLOR[m.grade] || 'var(--ink)' }, text: m.name }),
        el('span', { class: 'tiny faint', text: `${c.name || m.classId} Lv${m.level || 1}` })),
      el('span', {
        class: 'tiny num',
        style: { color: dPower >= 0 ? 'var(--ok)' : 'var(--bad)' },
        text: `전투력 ${num(pBefore)} → ${num(pAfter)} (${dPower >= 0 ? '+' : ''}${num(dPower)})`,
      })));

  for (const ch of (row.diff || row.changed)) {
    card.appendChild(el('div', { class: 'iv-swap tiny' },
      el('span', { class: 'tag', style: { color: 'var(--ink-dim)' }, text: SLOT_NAME[ch.slot] || ch.slot }),
      ch.from
        ? el('span', { style: { color: rColor(ch.from) }, text: ch.from.name })
        : el('span', { class: 'faint', text: '빈 슬롯' }),
      el('span', { class: 'faint', text: '→' }),
      el('span', { style: { color: rColor(ch.to), fontWeight: '700' }, text: ch.to.name }),
      /* ★ 남에게서 가져오는 것이면 **누구 것인지 반드시 보여 준다.**
       *   자동 착용은 되돌릴 수 없다 — 조용히 뺏으면 «내 부대가 왜 약해졌지» 가 된다.
       *   잠그면 안 뺏긴다는 것도 같이 알린다(잠금 버튼은 창고 카드에 있다). */
      ch.tookFrom
        ? el('span', { class: 'tag', style: { color: 'var(--warn, #d8a13a)' }, text: `${ch.tookFrom.name} 에게서` })
        : null));
  }

  /* ★ 빈 채로 끝나는 칸 — 창고 재고가 모자라면 생긴다. 반드시 보여 준다. */
  const base = row.before || m.equipment || {};
  const lost = Object.keys(base).filter((s0) => base[s0] && !after[s0]);
  if (lost.length) {
    card.appendChild(el('div', {
      class: 'tiny', style: { color: 'var(--bad)', fontWeight: '700' },
      text: `⚠ ${lost.length}칸이 빈 채로 끝난다 (${lost.map((s0) => SLOT_NAME[s0] || s0).join(' · ')}) — 창고에 맞는 장비가 없다`,
    }));
  }

  // 세트 착용 개수 변화 — 줄어들면 경고
  const before = setCountsOf(row.before || m.equipment || {});
  const now = setCountsOf(after);
  const keys = new Set([...before.keys(), ...now.keys()]);
  let breaks = false;
  for (const sid of keys) {
    const a = before.get(sid) || 0;
    const b = now.get(sid) || 0;
    if (a === b) continue;
    const down = b < a;
    if (down) breaks = true;
    const nm = setNameOfItem({ setId: sid }) || sid;
    card.appendChild(el('div', {
      class: 'tiny',
      style: { color: down ? 'var(--bad)' : 'var(--ok)', fontWeight: down ? '700' : '400' },
      text: `${down ? '⚠ 세트 해체' : '세트 강화'} — ${nm} ${a} → ${b}칸`,
    }));
  }

  const deltas = STAT_KEYS.map((k) => deltaSpan(k, (sAfter[k] || 0) - (sBefore[k] || 0))).filter(Boolean);
  card.appendChild(el('div', { class: 'row wrap', style: { gap: '7px' } },
    deltas.length ? deltas : el('span', { class: 'tiny faint', text: '스탯 변화 없음' })));
  card.__setBreak = breaks;
  if (breaks) card.style.borderColor = 'var(--bad)';
  return card;
}

/** 등급 이름 (일반~전설). 신화는 판매 대상이 아니라 목록에 없다. */
const SELL_TIERS = ['일반', '고급', '희귀', '영웅', '전설'];

/** 선택한 등급 **이하**를 한 번에 판다 */
let bulkTier = 1;

function bulkSellControl() {
  const sel = el('select', {
    onChange: (e) => { bulkTier = clamp(Number(e.target.value) || 0, 0, SELL_TIERS.length - 1); },
    style: { minWidth: '92px' },
  }, ...SELL_TIERS.map((n, i) => el('option', { value: String(i), text: `${n} 이하`, selected: i === bulkTier })));

  return el('div', { class: 'row center', style: { gap: '6px' } },
    sel,
    el('button', {
      class: 'btn sm',
      onClick: () => bulkSell(bulkTier, SELL_TIERS.slice(0, bulkTier + 1).join('·')),
    }, '일괄 판매'));
}

/**
 * 의뢰 결과에서 자동으로 팔 등급. `state.autoSellRarity` (-1 = 끔).
 * 전투 화면이 이 값을 읽어 그 자리에서 판다.
 */
function autoSellControl() {
  const cur = Number.isFinite(state.autoSellRarity) ? state.autoSellRarity : -1;
  const sel = el('select', {
    onChange: (e) => {
      const v = Number(e.target.value);
      state.autoSellRarity = v >= 0 ? clamp(v, 0, SELL_TIERS.length - 1) : -1;
      save();
      toast(state.autoSellRarity < 0
        ? '자동 판매를 껐습니다.'
        : `의뢰 결과에서 ${SELL_TIERS[state.autoSellRarity]} 이하를 자동으로 팝니다.`, 'good');
      refresh();
    },
    style: { minWidth: '92px' },
  },
    el('option', { value: '-1', text: '끔', selected: cur < 0 }),
    ...SELL_TIERS.map((n, i) => el('option', { value: String(i), text: `${n} 이하`, selected: i === cur })));

  return el('div', { class: 'row center wrap', style: { gap: '8px', marginTop: '6px' } },
    el('span', { class: 'tiny faint', text: '의뢰 결과 자동 판매' }),
    sel,
    el('span', { class: 'tiny faint', text: cur < 0 ? '전리품을 그대로 창고에 넣습니다.' : '전투가 끝나면 그 자리에서 팔고 골드로 바꿉니다.' }));
}

function bulkSell(maxRarity, label) {
  const owners = ownerMap();
  const targets = (state.items || []).filter((it) => !owners.has(it.uid) && !isProtected(it) && (it.rarity || 0) <= maxRarity);
  if (!targets.length) { toast('팔 수 있는 장비가 없습니다.', 'bad'); return; }
  const gold = targets.reduce((a, it) => a + sellPrice(it), 0);
  confirmBox('일괄 판매',
    `${label} 등급 장비 ${targets.length}점을 약 ${num(gold)}G에 팝니다. 장착 중인 장비와 신화(세트) 장비는 팔지 않습니다.`,
    () => {
      let total = 0; let n = 0;
      for (const it of targets) {
        const r = sellItem(state, it.uid);
        if (r.ok) { total += r.gold; n++; }
      }
      addLog(`창고를 정리해 장비 ${n}점을 팔고 ${num(total)}G를 벌었다.`);
      save();
      toast(`${n}점을 팔아 ${num(total)}G를 얻었습니다.`, 'good');
      refresh();
    }, '판매');
}

/* ─────────────────────────── 목록 ─────────────────────────── */

function filteredItems(owners) {
  let list = (state.items || []).filter((it) => {
    if (!it) return false;
    if (filter.slot && !accepts(filter.slot, it)) return false;
    if (filter.rarity !== '' && String(it.rarity || 0) !== filter.rarity) return false;
    if (filter.setId === 'any' && !setIdOfItem(it)) return false;
    if (filter.setId && filter.setId !== 'any') {
      const d = setDefOfItem(it);
      const id = (d && d.id) || setIdOfItem(it);
      if (id !== filter.setId) return false;
    }
    if (filter.equipped === 'yes' && !owners.has(it.uid)) return false;
    if (filter.equipped === 'no' && owners.has(it.uid)) return false;
    return true;
  });
  const by = {
    ilvl: (a, b) => (b.ilvl || 0) - (a.ilvl || 0) || (b.rarity || 0) - (a.rarity || 0),
    value: (a, b) => (b.value || 0) - (a.value || 0),
    rarity: (a, b) => (b.rarity || 0) - (a.rarity || 0) || (b.ilvl || 0) - (a.ilvl || 0),
    power: (a, b) => itemPower(b) - itemPower(a),
  };
  list = list.slice().sort(by[filter.sort] || by.ilvl);
  return list;
}

function listPanel(list, owners) {
  const panel = el('div', { class: 'panel col' });
  if (!(state.items || []).length) {
    panel.appendChild(el('div', { class: 'iv-empty muted' }, '보유한 장비가 없습니다. 의뢰 보상이나 상점에서 구해 보세요.'));
    return panel;
  }
  if (!list.length) {
    panel.appendChild(el('div', { class: 'iv-empty muted' }, '조건에 맞는 장비가 없습니다.'));
    return panel;
  }
  const col = setCollection();
  const cut = Math.min(list.length, Math.max(PAGE_SIZE, shown));
  const cards = el('div', { class: 'cards' });
  for (let i = 0; i < cut; i++) cards.appendChild(itemCard(list[i], owners.get(list[i].uid) || null, col));
  panel.appendChild(cards);
  if (cut < list.length) {
    /* ★ «더 보기» 는 refresh 를 거친다 — 여기서 카드만 이어 붙이면 다음 refresh 때
     *   개수가 되돌아가서 «눌렀는데 다시 줄었다» 가 된다. 상태(shown)를 늘려야 한다. */
    panel.appendChild(el('div', { class: 'row center', style: { gap: '8px', marginTop: '10px' } },
      el('button', {
        class: 'btn',
        onClick: () => { shown = cut + PAGE_SIZE; refresh(); },
      }, `더 보기 (${list.length - cut}점 남음)`),
      el('button', {
        class: 'btn ghost',
        onClick: () => { shown = list.length; refresh(); },
      }, '전부 보기')));
  }
  panel.appendChild(el('div', { class: 'tiny faint', text: '카드를 클릭하면 상세 정보와 장착 대상 비교를 볼 수 있습니다. 장착 중인 장비는 판매할 수 없습니다.' }));
  return panel;
}

function itemCard(it, owner, col) {
  const color = rColor(it);
  const st = itemStats(it);
  const myth = isMythic(it);
  const def = myth ? normSetDef(setDefOfItem(it)) : null;
  const have = def ? (col.get(def.id) || { count: 0 }).count : 0;

  return el('div', {
    class: `card iv-card${myth ? ' myth' : ''}`,
    style: { borderColor: color, borderLeftColor: color },
    onClick: () => openItemDetail(it.uid),
  },
    el('div', { class: 'row center', style: { gap: '9px' } },
      itemIcon(it),
      el('div', { class: 'col', style: { gap: '1px', minWidth: '0', flex: '1' } },
        el('div', { style: { color, fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: it.name }),
        el('div', { class: 'tiny faint', text: `${rName(it)} · ${SLOT_NAME[slotOf(it)] || SLOT_NAME[it.slot] || it.slot}${it.weaponType ? ` · ${weaponTypeName(it.weaponType)}` : ''}` }),
        el('div', { class: 'tiny muted num', text: `iLv ${it.ilvl || 1}${it.minLv > 1 ? ` · 요구 Lv${it.minLv}` : ''}` }))),
    // ── 세트 아이템: 세트 이름 + 보유 현황. 던전을 돌 이유가 여기서 보여야 한다
    myth
      ? el('div', {
        class: 'row spread center wrap',
        style: { gap: '6px', marginTop: '6px' },
        onClick: (e) => { e.stopPropagation(); if (def) openSetDetail(def.id); },
      },
        el('span', { class: 'iv-myth-tag', text: `세트 · ${(def && def.name) || setNameOfItem(it)}` }),
        def
          ? el('span', {
            class: 'tiny num',
            style: { color: have >= SLOTS.length ? MYTHIC_GLOW : 'var(--ink-dim)', fontWeight: '700' },
            text: `보유 ${have} / ${SLOTS.length}`,
          })
          : null)
      : null,
    myth && def
      ? el('div', { class: 'tiny faint', style: { marginTop: '2px' }, text: nextStepHint(def, have, SLOTS.length, false) })
      : null,
    el('div', { class: 'tiny muted', style: { marginTop: '7px', minHeight: '17px' }, text: statLine(st) }),
    (it.affixes || []).length
      ? el('div', { class: 'tiny faint', style: { marginTop: '2px' }, text: `접사 ${it.affixes.length}개: ${it.affixes.map((a) => a.name).join(', ')}` })
      : null,
    el('div', { class: 'row spread center', style: { marginTop: '8px', gap: '6px' } },
      el('span', { class: 'tiny num', style: { color: 'var(--gold)' }, text: `${num(it.value || 0)}G` }),
      el('div', { class: 'row center', style: { gap: '6px' } },
        lockToggle(it),
        owner
          ? el('span', { class: 'tag', style: { color: GRADE_COLOR[owner.grade] || 'var(--steel)' }, text: `${owner.name} 착용` })
          : isProtected(it)
            ? el('span', { class: 'tag', style: { color: 'var(--ink-faint)' }, text: '판매 불가' })
            : el('button', {
              class: 'btn sm ghost',
              onClick: (e) => { e.stopPropagation(); askSell(it); },
            }, `판매 ${num(sellPrice(it))}G`))));
}

/**
 * 장비 잠금 토글.
 *
 * ★ 잠금은 «자동으로 움직이지 마라» 다 — 자동 착용이 뺏어가지도, 벗기지도, 팔지도 못한다
 *   (gear.js `isLocked`). 자동 착용이 남의 장비를 가져올 수 있게 되면서 필요해졌다:
 *   그게 없으면 부대를 짜 놓아도 다음 자동 착용 한 번에 흩어진다.
 */
function lockToggle(it) {
  const on = GearAPI.isLocked(it);
  return el('button', {
    class: `btn sm ${on ? '' : 'ghost'}`,
    title: on ? '잠금 해제 — 자동 착용이 가져갈 수 있게 된다' : '잠금 — 자동 착용·판매가 못 건드린다',
    style: on ? { color: 'var(--gold)' } : null,
    onClick: (e) => {
      e.stopPropagation();
      it.locked = !on;
      save();
      toast(it.locked ? `${it.name} 잠갔다.` : `${it.name} 잠금을 풀었다.`, it.locked ? 'good' : '');
      refresh();
    },
  }, on ? '🔒' : '🔓');
}

/* ─────────────────────────── 상세 ─────────────────────────── */

function openItemDetail(itemUid) {
  const it = (state.items || []).find((x) => x && x.uid === itemUid);
  if (!it) { toast('보유하지 않은 장비입니다.', 'bad'); return; }
  const owners = ownerMap();
  const owner = owners.get(it.uid) || null;
  const color = rColor(it);
  const st = itemStats(it);
  const def = normSetDef(setDefOfItem(it));
  const have = def ? (setCollection().get(def.id) || { count: 0 }).count : 0;

  const info = el('div', { class: 'col iv-dl', style: { flex: '0 0 260px', gap: '8px' } },
    el('div', { class: 'row center', style: { gap: '10px' } },
      itemIcon(it, 62),
      el('div', { class: 'col', style: { gap: '2px' } },
        el('b', { style: { color, fontSize: '15px' }, text: it.name }),
        el('div', { class: 'row wrap', style: { gap: '4px' } },
          el('span', { class: 'tag', style: { color }, text: rName(it) }),
          el('span', { class: 'tag', style: { color: 'var(--ink-dim)' }, text: SLOT_NAME[slotOf(it)] || SLOT_NAME[it.slot] || it.slot }),
          it.weaponType ? el('span', { class: 'tag', style: { color: 'var(--steel)' }, text: weaponTypeName(it.weaponType) }) : null),
        el('div', { class: 'tiny faint num', text: `iLv ${it.ilvl || 1} · 요구 Lv ${it.minLv || 1}` }))),
    def
      ? el('div', { class: 'iv-row', style: { borderColor: def.color, cursor: 'pointer' }, onClick: () => openSetDetail(def.id) },
        el('div', { class: 'col', style: { flex: '1', gap: '1px', minWidth: '0' } },
          el('b', { style: { color: def.color }, text: def.name }),
          el('span', { class: 'tiny faint', text: `${def.archs && def.archs.length < 7 ? def.archs.map((a) => ARCH_NAME[a] || a).join('·') + ' 계열 전용' : '전 계열 착용 가능'}` })),
        el('span', { class: 'num', style: { color: def.color }, text: `${have}/${SLOTS.length}` }),
        el('span', { class: 'tiny faint', text: '효과 ▸' }))
      : null,
    it.desc ? el('div', { class: 'tiny muted', text: it.desc }) : null,
    statTable(it, st),
    affixBlock(it),
    el('div', { class: 'row spread center' },
      el('span', { class: 'tiny faint', text: '가치 / 판매가' }),
      el('span', { class: 'num', style: { color: 'var(--gold)' }, text: isProtected(it) ? `${num(it.value || 0)}G / 판매 불가` : `${num(it.value || 0)}G / ${num(sellPrice(it))}G` })),
    owner
      ? el('div', { class: 'iv-row' },
        el('span', { class: 'tiny faint', text: '착용 중' }),
        el('b', { style: { color: GRADE_COLOR[owner.grade] || 'var(--ink)', flex: '1' }, text: owner.name }),
        el('button', {
          class: 'btn sm ghost',
          onClick: () => {
            const r = unequipSlot(state, owner, slotWornOn(owner, it));
            toast(r.reason, r.ok ? 'good' : 'bad');
            if (r.ok) { save(); refresh(); openItemDetail(it.uid); }
          },
        }, '해제'))
      : el('div', { class: 'tiny faint', text: '아무도 착용하고 있지 않습니다.' }));

  modal({
    title: it.name,
    wide: true,
    body: el('div', { class: 'row wrap iv-mbody', style: { alignItems: 'flex-start', gap: '16px' } },
      info,
      equipTargets(it, owner)),
    actions: [
      {
        label: GearAPI.isLocked(it) ? '🔒 잠금 해제' : '🔓 잠그기',
        kind: GearAPI.isLocked(it) ? 'primary' : 'ghost',
        act: () => {
          it.locked = !GearAPI.isLocked(it);
          save();
          toast(it.locked ? '잠갔다 — 자동 착용·판매가 못 건드린다.' : '잠금을 풀었다.', it.locked ? 'good' : '');
          refresh();
        },
      },
      owner
        ? { label: '장착 중 — 판매 불가', kind: 'ghost', act: () => { toast(`${owner.name}${josa(owner.name, '이/가')} 착용 중입니다. 먼저 해제하세요.`, 'bad'); return false; } }
        : isProtected(it)
          ? { label: '신화(세트) — 판매 불가', kind: 'ghost', act: () => { toast('던전 세트 장비는 팔 수 없습니다.', 'bad'); return false; } }
          : { label: `판매 ${num(sellPrice(it))}G`, kind: 'ghost danger', act: () => { setTimeout(() => askSell(it), 0); } },
      { label: '닫기', kind: '' },
    ],
  });
}

/** 이 용병이 그 아이템을 어느 칸에 끼고 있는지 (반지 2칸 대응) */
function slotWornOn(merc, it) {
  const eq = merc && merc.equipment;
  if (!eq) return slotOf(it) || it.slot;
  for (const s of slotKeysOf(eq)) if (eq[s] === it.uid) return s;
  return slotOf(it) || it.slot;
}

function statTable(it, st) {
  const rows = STAT_KEYS.filter((k) => st[k]);
  if (!rows.length) return el('div', { class: 'tiny faint', text: '스탯 보정이 없습니다.' });
  const base = it.baseStats || {};
  const table = el('table', { class: 'data tiny' },
    el('thead', {}, el('tr', {},
      el('th', { text: '스탯' }), el('th', { text: '기본' }), el('th', { text: '접사' }), el('th', { text: '합계' }))));
  const tb = el('tbody', {});
  for (const k of rows) {
    const b = base[k] || 0;
    const total = st[k] || 0;
    tb.appendChild(el('tr', {},
      el('td', { text: STAT_LABEL[k] }),
      el('td', { class: 'num faint', text: b ? fmt(k, b) : '—' }),
      el('td', {}, deltaSpanRaw(k, total - b)),
      el('td', { class: 'num', style: { fontWeight: '700', color: 'var(--ink)' }, text: fmt(k, total) })));
  }
  table.appendChild(tb);
  return xs(table);
}

const fmt = (k, v) => (PCT_KEYS.has(k) ? `${Math.round(v * 10) / 10}%` : num(v));

function deltaSpanRaw(k, d) {
  const v = PCT_KEYS.has(k) ? Math.round(d * 10) / 10 : Math.round(d);
  if (!v) return el('span', { class: 'faint', text: '—' });
  return el('span', {
    class: 'num',
    style: { color: v > 0 ? 'var(--ok)' : 'var(--bad)' },
    text: `${v > 0 ? '+' : ''}${PCT_KEYS.has(k) ? v : num(v)}${PCT_KEYS.has(k) ? '%' : ''}`,
  });
}

function affixBlock(it) {
  const list = it.affixes || [];
  if (!list.length) {
    return el('div', { class: 'tiny faint', text: isMythic(it) ? '접사 없음 — 세트 효과로 대신한다.' : '접사 없음 (일반 등급)' });
  }
  const box = el('div', { class: 'col', style: { gap: '5px' } },
    el('div', { class: 'tiny faint', text: `접사 ${list.length}개` }));
  for (const a of list) {
    box.appendChild(el('div', { class: 'iv-affix col', style: { gap: '1px' } },
      el('div', { style: { fontWeight: '700', color: 'var(--arcane)' }, text: a.name || a.id },
        a.kind ? el('span', { class: 'tiny faint', text: `  ${a.kind === 'prefix' ? '접두' : a.kind === 'suffix' ? '접미' : '고유'}` }) : null),
      el('div', { class: 'tiny muted', text: statLine(a.stats || {}) })));
  }
  return box;
}

/* ─────────────────────────── 장착 대상 비교 ─────────────────────────── */

function equipTargets(it, owner) {
  const box = el('div', { class: 'col iv-dr', style: { flex: '1 1 340px', minWidth: '320px', gap: '6px' } },
    el('h3', { class: 'panel-title', style: { margin: '0' }, text: '장착 가능한 용병' }));

  if (!state.roster.length) {
    box.appendChild(el('div', { class: 'muted tiny', text: '단원이 없습니다.' }));
    return box;
  }

  // 클래스 아키타입 가중치로 매긴 순위 (자동 착용과 같은 기준)
  const recs = recommendMercsFor(state, it, { limit: 0 });
  const ableUids = new Set(recs.map((r) => r.uid));
  const unable = state.roster.filter((m) => !ableUids.has(m.uid));
  const sid = setIdOfItem(it);

  // 추천 — 자동 착용과 같은 기준(클래스 아키타입 가중치)으로 가장 이득이 큰 단원
  const top = recs.find((r) => !r.owner && isUpgrade(r.curScore, r.score)) || null;
  if (top) {
    const tc = getClass(top.merc.classId) || {};
    box.appendChild(el('div', { class: 'iv-rec col', style: { gap: '2px' } },
      el('div', { class: 'tiny faint', text: '가장 잘 어울리는 단원' }),
      el('div', { class: 'row center wrap', style: { gap: '6px' } },
        el('b', { style: { color: GRADE_COLOR[top.merc.grade] || 'var(--ink)' }, text: top.merc.name }),
        el('span', { class: 'tiny faint', text: `${tc.name || top.merc.classId} · ${tc.role || '용병'}` }),
        el('span', { class: 'tiny num', style: { color: 'var(--ok)' }, text: `적합도 +${num(Math.round(top.delta))}` })),
      el('div', {
        class: 'tiny muted',
        text: top.cur
          ? `${top.cur.name}${josa(top.cur.name)} 벗고 이걸 끼우는 편이 낫다.`
          : `비어 있는 ${SLOT_NAME[top.slot] || SLOT_NAME[slotOf(it)] || ''} 슬롯에 그대로 들어간다.`,
      })));
  } else if (recs.length) {
    box.appendChild(el('div', { class: 'iv-rec tiny muted' },
      owner
        ? `이미 ${owner.name}${josa(owner.name, '이/가')} 착용 중이고, 더 어울리는 단원은 없다.`
        : '이 장비로 더 강해지는 단원이 없다. 창고에 두거나 팔아도 된다.'));
  }

  if (!recs.length) {
    box.appendChild(el('div', { class: 'muted tiny', text: '이 장비를 착용할 수 있는 단원이 없습니다.' }));
  }

  for (const rec of recs) {
    const m = rec.merc;
    const slot = rec.slot || slotOf(it) || it.slot;
    const before = mercStats(m, state);
    const after = mercStats({ ...m, equipment: { ...m.equipment, [slot]: it.uid } }, state);
    const c = getClass(m.classId) || {};
    const isOwner = owner && owner.uid === m.uid;
    const isTop = top && top.uid === m.uid;
    const deltas = STAT_KEYS
      .map((k) => deltaSpan(k, (after[k] || 0) - (before[k] || 0)))
      .filter(Boolean);
    const cur = m.equipment && m.equipment[slot] && m.equipment[slot] !== it.uid ? itemByUid(m.equipment[slot]) : null;
    // 세트 진행 — 이 아이템을 끼우면 그 용병의 세트가 몇 칸이 되는가
    const setNow = sid ? (setCountsOf(m.equipment || {}).get(sid) || 0) : 0;
    const setAfter = sid ? (setCountsOf({ ...(m.equipment || {}), [slot]: it.uid }).get(sid) || 0) : 0;

    box.appendChild(el('div', {
      class: `iv-row${isOwner ? '' : ' pick'}`,
      onClick: isOwner ? null : () => {
        const r = equipItem(state, m, it, slot);
        toast(r.reason, r.ok ? 'good' : 'bad');
        if (r.ok) { save(); refresh(); }
        openItemDetail(it.uid);
      },
    },
      el('div', { class: 'col', style: { flex: '1', gap: '1px', minWidth: '0' } },
        el('div', { class: 'row center', style: { gap: '6px' } },
          el('b', { style: { color: GRADE_COLOR[m.grade] || 'var(--ink)' }, text: m.name }),
          el('span', { class: 'tiny faint', text: `${c.name || m.classId} Lv${m.level || 1}` }),
          isTop ? el('span', { class: 'tag', style: { color: 'var(--gold)' }, text: '추천' }) : null,
          isWounded(m, state.day) ? el('span', { class: 'tag', style: { color: 'var(--bad)' }, text: '부상' }) : null),
        el('div', { class: 'tiny faint', text: `${SLOT_NAME[slot] || slot} — ${cur ? cur.name : '비어 있음'}` }),
        sid && setAfter > setNow
          ? el('div', { class: 'tiny', style: { color: MYTHIC_GLOW }, text: `세트 ${setNow} → ${setAfter}칸` })
          : null,
        setArchWarn(m, it)
          ? el('div', { class: 'tiny', style: { color: 'var(--ink-faint)' }, text: `※ ${setArchWarn(m, it)} — 이 용병은 대상이 아니다` })
          : null),
      el('div', { class: 'col', style: { flex: '0 0 auto', alignItems: 'flex-end', gap: '1px', maxWidth: '55%' } },
        isOwner
          ? el('span', { class: 'tag', style: { color: 'var(--gold)' }, text: '착용 중' })
          : el('div', { class: 'row wrap', style: { gap: '6px', justifyContent: 'flex-end' } },
            deltas.length ? deltas : el('span', { class: 'tiny faint', text: '변화 없음' })))));
  }

  if (unable.length) {
    box.appendChild(el('div', { class: 'sep' }));
    box.appendChild(el('div', { class: 'tiny faint', text: '착용 불가' }));
    for (const m of unable) {
      box.appendChild(el('div', { class: 'tiny muted' },
        el('span', { style: { color: GRADE_COLOR[m.grade] || 'var(--ink)' }, text: m.name }),
        ` — ${equipIssue(m, it) || '알 수 없음'}`));
    }
  }
  return box;
}

/* ─────────────────────────── 판매 ─────────────────────────── */

function askSell(it) {
  const owners = ownerMap();
  if (owners.has(it.uid)) {
    const on = owners.get(it.uid).name; toast(`${on}${josa(on, '이/가')} 착용 중이라 팔 수 없습니다.`, 'bad');
    return;
  }
  if (isProtected(it)) { toast('던전 세트(신화) 장비는 팔 수 없습니다.', 'bad'); return; }
  const gold = sellPrice(it);
  confirmBox('장비 판매', `${it.name}${josa(it.name)} ${num(gold)}G에 팝니다. 되돌릴 수 없습니다.`, () => {
    const r = sellItem(state, it.uid);
    toast(r.reason, r.ok ? 'good' : 'bad');
    if (r.ok) {
      addLog(`${it.name}${josa(it.name)} ${num(r.gold)}G에 팔았다.`);
      save();
      refresh();
    }
  }, '판매');
}
