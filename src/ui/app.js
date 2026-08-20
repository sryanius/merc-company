// 화면 라우팅 + 상단 HUD + 토스트/모달.
// 각 화면 모듈 계약:  export const meta = { id, title }
//                    export function render(root, params)
//                    export function dispose()            (선택)
// 순환 참조를 피하기 위해 화면은 전부 동적 import 한다.
import { el, $, num } from '../core/util.js';
import { rng } from '../core/rng.js';
import { state, save, load, hasSave, newGame, bus } from '../game/state.js';
// 달력 API(calendar/calendarLabel)는 나중에 붙은 함수라, 이름 import 하면 없는 빌드에서
// 모듈 전체가 죽는다. 네임스페이스로 받아 존재할 때만 쓰고 없으면 옛 표기로 폴백한다.
import * as GameState from '../game/state.js';
import * as Cloud from '../net/cloud.js';
import * as Auth from '../net/auth.js';
import { getCity } from '../data/world.js';
import { companyName } from '../data/names.js';

/** 용병단 이름 최대 길이 */
const NAME_MAX = 20;
/** 이름이 아직 없는 세이브에서 HUD에 쓸 기본 표기 */
const DEFAULT_BRAND = '용병단';

/** 봉인 확인용 암호. `ui/savefile.js` 와 **같은 값이어야 한다** (한쪽만 바꾸면 파일과 브라우저가 갈린다). */
const LEGACY_PASSWORD = 'qwe123!@#';

// short/icon 은 모바일 하단 탭 바 전용 표기다 (6칸을 360px 에 나눠야 해서 2글자로 줄인다).
// PC 에서는 CSS 가 아이콘·축약을 숨기고 title 전체 이름만 보여준다 — 기존과 동일.
const SCREENS = [
  { id: 'city', title: '도시', short: '도시', icon: '🏰', nav: true, load: () => import('./city.js') },
  { id: 'quests', title: '의뢰소', short: '의뢰', icon: '📜', nav: true, load: () => import('./quests.js') },
  { id: 'tavern', title: '주점', short: '주점', icon: '🍺', nav: true, load: () => import('./tavern.js') },
  { id: 'company', title: '용병단', short: '단원', icon: '🛡️', nav: true, load: () => import('./company.js') },
  { id: 'inventory', title: '장비', short: '장비', icon: '⚔️', nav: true, load: () => import('./inventory.js') },
  { id: 'world', title: '월드맵', short: '지도', icon: '🗺️', nav: true, load: () => import('./worldmap.js') },
  { id: 'battle', title: '전투', nav: false, load: () => import('./battle.js') },
  // 던전은 도시가 아니라 월드맵의 별도 노드다 — 내비게이션에 상설로 걸지 않고
  // 월드맵에서 노드를 눌러 들어온다. 화면 모듈이 아직 없으면 go()가 오류 패널을 띄운다.
  { id: 'dungeon', title: '던전', nav: false, load: () => import('./dungeon.js') },
  // 무한의 탑은 월드맵 노드로 들어간다.
  { id: 'tower', title: '무한의 탑', nav: false, load: () => import('./tower.js') },
  // 황금 나락은 도시 화면에서 들어간다 — 갱도는 어느 도시 아래에도 있다는 설정이고,
  // 임금 재원이라 원정 중에 이동해야만 갈 수 있으면 안 된다.
  { id: 'abyss', title: '황금 나락', nav: false, load: () => import('./abyss.js') },
  // 펫 관리는 용병단 화면에서 들어간다 (장비 관리와 같은 결).
  { id: 'pets', title: '펫', nav: false, load: () => import('./pets.js') },
  /* 순위표는 읽기 전용이라 로그인 없이도 열린다.
   * ★ 하단 탭에 건다 — 경쟁을 유도하려면 눈에 보여야 한다.
   *   예전 주석은 "폰에서 6칸이 한계"라고 했는데 재 보니 아니었다(추정이었다):
   *   360px 에서 칸 50px · 글자 24px, 320px(아이폰 SE)에서도 45px 로 남는다.
   *   8칸째를 넣으려면 그때는 **다시 재고** 넣어라. */
  { id: 'rank', title: '순위표', short: '순위', icon: '🏆', nav: true, load: () => import('./rank.js') },
];

/* HUD 날짜 표기용 소량 CSS. 모듈 안에서 한 번만 주입한다.
   (셸 공용 반응형은 css/style.css 에 있다 — 여기는 app.js 가 만드는 요소만 다룬다) */
const CSS = `
.hud-brand-btn { cursor:pointer; border-radius:6px; padding:2px 6px; margin:-2px -6px; }
.hud-brand-btn:hover { background:rgba(255,255,255,.06); }
.hud-brand-btn:focus-visible { outline:2px solid var(--gold-dim); outline-offset:2px; }
.hud-stat .sub { font-size:10px; color:var(--ink-faint); font-variant-numeric:tabular-nums; }
.hud-stat.date .v { color:var(--gold-dim); letter-spacing:.01em; }
/* 날짜 전문(일차 + 주차 안내)은 PC 에서 title 툴팁으로 본다. 폰에는 hover 가 없으므로
   HUD 를 펼쳤을 때 한 줄로 보여준다 — 툴팁에만 있는 정보를 만들지 않는다. */
.hud-hint { display:none; }
@media (max-width: 767px) {
  /* 좁은 화면에서는 일차 병기를 접는다 — 년/월/주차만 남아도 뜻이 통한다 */
  .hud-stat .sub { display:none; }
  #hud.open .hud-hint { display:block; order:5; flex:1 0 100%; line-height:1.35; }
}
`;
function injectStyle() {
  if (document.getElementById('app-style')) return;
  document.head.appendChild(el('style', { id: 'app-style', text: CSS }));
}

let current = null; // { def, mod, params }
let busy = false;

export function currentScreen() { return current?.def.id ?? null; }

/** 화면 전환 */
export async function go(id, params = {}) {
  const def = SCREENS.find((s) => s.id === id);
  if (!def) return console.warn('[app] 알 수 없는 화면:', id);
  if (busy) return;
  busy = true;
  const host = $('#screen');
  try {
    if (current?.mod?.dispose) { try { current.mod.dispose(); } catch (e) { console.error(e); } }
    const mod = await def.load();
    current = { def, mod, params };
    host.innerHTML = '';
    host.scrollTop = 0;
    mod.render(host, params);
    renderNav();
    renderHud();
  } catch (err) {
    console.error(`[app] '${id}' 화면 로드 실패`, err);
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'panel' },
      el('h3', { text: '화면을 불러오지 못했습니다' }),
      el('pre', { class: 'tiny muted', style: { whiteSpace: 'pre-wrap' }, text: String(err?.stack || err) })));
  } finally {
    busy = false;
  }
}

/** 현재 화면 다시 그리기 */
export function refresh() {
  if (!current) return;
  const host = $('#screen');
  const scroll = host.scrollTop;
  if (current.mod.dispose) { try { current.mod.dispose(); } catch (e) { console.error(e); } }
  host.innerHTML = '';
  current.mod.render(host, current.params);
  host.scrollTop = scroll;
  renderHud();
  renderNav();
}

/* ---------------- 날짜 표기 ---------------- */
/**
 * HUD 날짜 조각. `state.js` 의 달력 API를 쓰고, 없는 빌드면 예전 `N일` 표기로 폴백한다.
 * @returns {{ok:boolean, label:string, sub:string, title:string}}
 *   ok=false 면 달력 API가 없는 옛 빌드 — 호출부가 예전 표기를 그대로 쓴다.
 */
function calInfo(day = state.day) {
  const d = Math.max(1, Math.floor(Number(day)) || 1);
  const dayText = `${num(d)}일차`;
  const out = { ok: false, label: `${num(d)}일`, sub: '', title: dayText };
  if (typeof GameState.calendar === 'function') {
    try {
      const c = GameState.calendar(d);
      if (c && Number.isFinite(c.year) && Number.isFinite(c.month) && Number.isFinite(c.week)) {
        out.ok = true;
        out.label = `${c.year}년 ${c.month}월 ${c.week}주차`;
        out.sub = dayText;
        out.title = `${out.label} (${dayText})`;
      }
    } catch (e) { console.warn('[app] calendar 실패', e); }
  }
  if (typeof GameState.calendarLabel === 'function') {
    try { const s = GameState.calendarLabel(d); if (s) out.title = String(s); } catch (e) { /* 위 값 유지 */ }
  }
  if (out.ok) out.title += ' — 주차가 바뀌면 들어갈 수 있는 던전이 바뀐다';
  return out;
}

/* ---------------- HUD ---------------- */
/**
 * 모바일에서 HUD 보조 정보(명성·일일 임금·현재 위치 + 저장 메뉴)를 펼쳤는가.
 * PC(768px+)에서는 CSS 가 이 상태를 무시하고 전부 항상 보여준다.
 */
let hudOpen = false;

function renderHud() {
  const hud = $('#hud');
  if (!hud) return;
  injectStyle();
  const city = state.cityId ? getCity(state.cityId) : null;
  // 대기 인원 할인이 들어간 실제 값. state.js dailyUpkeep 이 유일한 출처다.
  const upkeep = GameState.dailyUpkeep(state);
  // 용병단 이름이 정해져 있으면 브랜드 자리에 그 이름을 건다. 없으면 예전처럼 '용병단'.
  const brand = (state.companyName || '').trim() || DEFAULT_BRAND;
  // 날짜는 년/월/주차가 본문이고 일차는 작게 병기한다 — 주차가 곧 개방 던전이라 눈에 띄어야 한다.
  const cal = calInfo();
  hud.className = hudOpen ? 'open' : '';
  hud.innerHTML = '';
  hud.append(
    /* 용병단 이름을 누르면 개명창이 뜬다.
     * ★ 따로 버튼을 만들지 않았다 — 헤더 버튼을 5개에서 3개로 줄인 참이고,
     *   "이름을 바꾸려면 이름을 누른다" 가 버튼을 하나 더 다는 것보다 자연스럽다.
     *   (용병 상세의 이름 옆 수정 아이콘과 같은 결이다.) */
    el('div', {
      class: 'hud-brand hud-brand-btn',
      title: `${brand} — 누르면 이름을 바꾼다`,
      role: 'button',
      tabindex: '0',
      onClick: doRenameCompany,
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doRenameCompany(); } },
    },
      // 긴 이름이 HUD를 밀어내지 않도록 말줄임 처리 (.hud-brand 는 nowrap).
      // 폭 제한은 css/style.css 의 `.hud-brand .hud-name` — 모바일에서 풀어야 해서 클래스로 뺐다.
      el('span', { class: 'hud-name', text: brand }),
      el('small', { text: 'MERCENARY COMPANY' })),
    // 모바일에서 접히는 항목은 `x` 를 단다 (css/style.css 의 `.hud-stat.x`).
    // 폰에서 항상 보이는 건 골드·날짜·단원 셋뿐이다.
    el('div', { class: 'hud-stats' },
      stat('골드', num(state.gold), 'gold'),
      cal.ok
        ? stat('날짜', cal.label, 'date', cal.sub, cal.title)
        : stat('일차', cal.label, '', '', cal.title),
      stat('명성', num(state.renown), 'x'),
      stat('단원', `${state.roster.length}명`),
      stat('일일 임금', `${num(upkeep)}G`, 'x'),
      stat('현재 위치', city ? city.name : '—', 'x')),
    /* ★ 버튼을 셋으로 줄였다.
     *   · '저장' 은 뺐다 — 게임은 행동마다 자동 저장한다(47곳). 눌러도 더 하는 게 없다.
     *   · '내보내기/불러오기' 는 지운 게 아니라 **세이브 모달 안으로 옮겼다.**
     *     로그인 안 한 사람에게는 이게 유일한 백업 수단이라 없애면 안 된다.
     *   머리에는 계정 상태만 남긴다 — 로그인 여부가 지금 가장 중요한 정보다. */
    el('div', { class: 'hud-actions' },
      el('button', {
        class: `btn sm ${Cloud.isOn() ? 'ghost' : ''}`,
        title: '세이브 · 클라우드 · 랭킹',
        onClick: doCloud,
      }, Cloud.isOn() ? '세이브 ●' : '세이브'),
      el('button', { class: 'btn sm ghost', onClick: () => promptNewGame({ overwrite: hasSave() }) }, '새 게임'),
      el('button', { class: 'btn sm ghost', title: '기본 조작을 다시 안내한다', onClick: () => startTutorial(true) }, '따라하기')),
    // 모바일 전용 펼치기 버튼. PC 에서는 CSS 가 숨긴다.
    el('button', {
      class: 'btn sm ghost hud-toggle',
      type: 'button',
      'aria-expanded': hudOpen ? 'true' : 'false',
      title: hudOpen ? '요약만 보기' : '명성 · 임금 · 위치 · 저장 메뉴 보기',
      onClick: () => { hudOpen = !hudOpen; renderHud(); },
    }, hudOpen ? '접기 ▲' : '더보기 ▼'),
    // 툴팁 대체 — 펼쳤을 때만 보인다 (폰에는 hover 가 없다)
    el('div', { class: 'hud-hint tiny faint', text: cal.title }),
  );
}
/** HUD 항목. sub 는 본문 옆에 작게 병기하는 보조 표기(예: 날짜의 `245일차`). */
const stat = (k, v, cls = '', sub = '', title = '') => el('div', { class: `hud-stat ${cls}`, title: title || null },
  el('span', { class: 'k', text: k }),
  el('span', { class: 'v', text: v }),
  sub ? el('span', { class: 'sub', text: sub }) : null);

function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  nav.innerHTML = '';
  for (const s of SCREENS) {
    if (!s.nav) continue;
    const active = current?.def.id === s.id;
    // 아이콘 / 전체 이름 / 축약 이름을 전부 넣고 어느 걸 보일지는 CSS 가 정한다.
    // PC: 전체 이름만(기존과 동일) · 모바일 하단 탭 바: 아이콘 + 축약 이름.
    nav.appendChild(el('button', {
      class: active ? 'active' : '',
      disabled: current?.def.id === 'battle',   // 전투 중에는 내비 비활성 (기존 동작 유지)
      // 튜토리얼이 이 버튼을 짚는다 — 클래스는 CSS 가 바뀔 때 같이 흔들리므로 전용 표식을 둔다
      data: { nav: s.id },
      title: s.title,
      'aria-current': active ? 'page' : null,
      onClick: () => go(s.id),
    },
    el('span', { class: 'nav-ico', 'aria-hidden': 'true', text: s.icon || '' }),
    el('span', { class: 'nav-lb', text: s.title }),
    el('span', { class: 'nav-sh', text: s.short || s.title })));
  }
}

/* ---------------- 토스트 ---------------- */
export function toast(text, kind = '') {
  const layer = $('#toast-layer');
  if (!layer) return;
  const n = el('div', { class: `toast ${kind}`, text });
  layer.appendChild(n);
  setTimeout(() => {
    // 사라지는 방향은 css/style.css 의 `.toast.out` 이 정한다 —
    // 모바일에서는 토스트가 화면 폭을 다 쓰므로 가로가 아니라 아래로 밀어야 한다.
    n.classList.add('out');
    setTimeout(() => n.remove(), 320);
  }, 2600);
}

/* ---------------- 모달 ---------------- */
/** dismissable:false 면 배경을 눌러도 닫히지 않는다 (반드시 선택해야 하는 모달용). */
export function modal({ title, body, actions = [], onClose, wide = false, dismissable = true }) {
  const layer = $('#modal-layer');
  const close = () => { layer.innerHTML = ''; onClose?.(); };
  // wide 는 인라인 min-width 였는데 인라인은 미디어쿼리로 덮을 수 없어 폰에서 가로 스크롤을 만들었다.
  // 이제 `.modal.wide` 클래스(css/style.css)가 폭을 정한다 — PC 계산값은 그대로 760px.
  const box = el('div', { class: `modal${wide ? ' wide' : ''}` },
    // title 은 문자열이 보통이지만 **노드도 받는다** — 머리말에 버튼을 달 수 있어야 한다
    //   (용병 상세의 이름 옆 수정 아이콘 등).
    title ? (typeof title === 'string' ? el('header', { text: title }) : el('header', {}, title)) : null,
    el('div', { class: 'body' }, body),
    actions.length
      ? el('footer', {}, actions.map((a) => el('button', {
          class: `btn ${a.kind || ''}`,
          /* `act` 가 false 를 돌려주면 창을 닫지 않는다 (검증 실패 등).
           *
           * ★ **Promise 도 받는다.** 예전에는 결과를 그대로 `!== false` 로 봤는데,
           *   async 함수는 Promise 를 돌려주므로 `!== false` 가 항상 참이 되어
           *   **일이 끝나기도 전에 창이 닫혔다.** 네트워크를 타는 액션
           *   (클라우드 연결 등)은 전부 여기에 걸린다.
           *   기다리는 동안 버튼을 잠가 두 번 눌리는 것도 막는다. */
          onClick: (ev) => {
            const r = a.act?.(close);
            if (r && typeof r.then === 'function') {
              const btn = ev.currentTarget;
              btn.disabled = true;
              r.then((v) => { if (v !== false) close(); })
                .catch((e) => { console.error('[modal] 동작 실패', e); })
                .finally(() => { btn.disabled = false; });
              return;
            }
            if (r !== false) close();
          },
        }, a.label)))
      : el('footer', {}, el('button', { class: 'btn', onClick: close }, '닫기')));
  layer.innerHTML = '';
  layer.appendChild(box);
  /* ★ 배경 클릭으로 닫기 — 반드시 **누른 곳도 배경이었을 때만** 닫는다.
   * 예전에는 click 하나만 봤는데, 입력창의 글자를 드래그하다 배경에서 손을 떼면
   * click 의 target 이 배경이 되어 모달이 그대로 꺼졌다
   * (이름 변경창에서 기존 이름을 드래그하면 창이 닫혀 이름을 못 바꿨다).
   * mousedown 지점을 기억해 두고 둘 다 배경일 때만 닫는다. */
  let downOnLayer = false;
  layer.onmousedown = (e) => { downOnLayer = e.target === layer; };
  layer.onclick = dismissable
    ? (e) => { if (e.target === layer && downOnLayer) close(); downOnLayer = false; }
    : null;
  return close;
}

export function confirmDlg(title, message, onYes, yesLabel = '확인') {
  modal({
    title,
    body: el('div', { text: message }),
    actions: [
      { label: '취소', kind: 'ghost' },
      { label: yesLabel, kind: 'primary', act: () => { onYes(); } },
    ],
  });
}

/* ---------------- 세이브 파일 ---------------- */
// localStorage 세이브는 이 브라우저에만 남는다. 파일로 빼두면 기기를 옮기거나
// 밸런스 수정으로 세이브를 버려야 할 때 되돌릴 수 있다.
async function doExport() {
  const { exportSave } = await import('./savefile.js');
  try {
    const { name } = exportSave();
    toast(`${name} 으로 내보냈습니다.`, 'good');
  } catch (e) {
    console.error(e);
    toast('내보내기에 실패했습니다.', 'bad');
  }
}

async function doImport() {
  const { pickSaveFile, importSaveText } = await import('./savefile.js');
  confirmDlg('세이브 불러오기', '현재 진행 상황을 덮어씁니다. 계속할까요?', () => {
    pickSaveFile((res, fileName, rawText) => {
      if (res.ok) { finishImport(res, fileName); return; }
      // 봉인 이전(평문) 파일이면 암호를 한 번 물어본다
      if (res.needPassword) { askLegacyPassword(rawText, fileName, importSaveText); return; }
      toast(res.error || '불러오기에 실패했습니다.', 'bad');
    });
  }, '파일 선택');
}

function finishImport(res, fileName) {
  const s = res.summary || {};
  toast(`${fileName} 불러옴 — ${s.day ?? '?'}일차 · 단원 ${s.roster ?? '?'}명`, 'good');
  go('city');
}

/**
 * 예전 형식(암호화 전) 세이브 파일을 열려 할 때.
 * 그대로 두면 메모장으로 고친 파일이 그냥 들어오므로 한 번 막아 세운다.
 */
function askLegacyPassword(rawText, fileName, importSaveText) {
  const input = el('input', { type: 'password', class: 'co-in', placeholder: '암호' });
  const msg = el('div', { class: 'tiny', style: { color: 'var(--bad)', minHeight: '16px' } });
  modal({
    title: '예전 형식 세이브 파일',
    body: el('div', { class: 'col', style: { gap: '8px', minWidth: 'min(340px, 80vw)' } },
      el('div', { class: 'tiny muted' },
        '암호화 이전에 내보낸 파일입니다. 이런 파일은 내용을 손으로 고칠 수 있어 기본적으로 막습니다.'),
      el('div', { class: 'tiny faint' },
        '본인 세이브가 맞다면 암호를 넣어 이어서 하세요. 암호가 없으면 새 게임으로 시작해야 합니다.'),
      input, msg),
    actions: [
      { label: '새 게임으로', kind: 'ghost', act: () => { promptNewGame({ overwrite: hasSave() }); } },
      {
        label: '이어서 하기',
        kind: 'primary',
        act: () => {
          const res = importSaveText(rawText, { password: input.value });
          if (!res.ok) { msg.textContent = res.needPassword ? '암호가 맞지 않습니다.' : (res.error || '불러오기 실패'); return false; }
          finishImport(res, fileName);
          return true;
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 60);
}

/* ---------------- 용병단 개명 ---------------- */

/** 용병단 이름을 바꾸는 값 */
export const RENAME_COST = 50_000;

/**
 * 용병단 이름 변경.
 *
 * ★ 값을 받는 이유: 이름은 **순위표에 그대로 뜬다.** 공짜로 아무 때나 바꿀 수 있으면
 *   남을 사칭하거나 기록을 세운 뒤 이름만 바꿔 치는 게 가능해진다. 5만 골드면
 *   초반에는 부담이고 후반에는 부담이 아닌데, 그 정도가 딱 맞다 — 막자는 게 아니라
 *   "한 번 생각하고 바꾸게" 하려는 것이다.
 *
 * ★ 이름은 순수 표시용이다. 세이브·전투·랭킹의 키는 전부 uid / user_id 라 바꿔도 안전하다.
 */
function doRenameCompany() {
  const cur = (state.companyName || '').trim() || DEFAULT_BRAND;
  const input = el('input', {
    class: 'co-in', value: cur, maxlength: String(NAME_MAX),
    onInput: () => { msg.textContent = ''; },
  });
  const msg = el('div', { class: 'tiny', style: { minHeight: '16px', color: 'var(--bad)' } });
  const poor = (state.gold || 0) < RENAME_COST;

  modal({
    title: '용병단 이름 변경',
    body: el('div', { class: 'col', style: { gap: '8px', minWidth: 'min(340px, 84vw)' } },
      el('div', { class: 'row spread center' },
        el('span', { class: 'muted tiny', text: '비용' }),
        el('b', { style: { color: poor ? 'var(--bad)' : 'var(--gold)' }, text: `${num(RENAME_COST)}G` })),
      el('div', { class: 'faint tiny', text: `보유 ${num(state.gold || 0)}G · 현재 이름 ${cur}` }),
      el('div', { class: 'sep' }),
      input,
      el('div', { class: 'faint tiny', text: `1~${NAME_MAX}자. 순위표에도 이 이름으로 뜬다.` }),
      msg),
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: `바꾼다 (${num(RENAME_COST)}G)`,
        kind: 'primary',
        act: async () => {
          const name = cleanName(input.value).slice(0, NAME_MAX);
          if (!name) { msg.textContent = '이름을 입력하세요.'; return false; }
          if (name === cur) { msg.textContent = '지금과 같은 이름입니다.'; return false; }
          // ★ 골드 검사는 **바꾸기 직전에** 다시 한다. 창을 열어 둔 채 골드를 쓸 수 있다.
          if ((state.gold || 0) < RENAME_COST) {
            msg.textContent = `골드가 ${num(RENAME_COST - (state.gold || 0))}G 모자랍니다.`;
            return false;
          }
          state.gold -= RENAME_COST;
          state.companyName = name;
          save();
          renderHud();
          toast(`${cur} → ${name}`, 'good');
          /* 순위표에 올라간 이름도 바꿔 준다. 기록이 안 올랐으므로 평소 경로로는
           * 제출이 안 나가서, 여기서만 강제로 한 번 보낸다. 실패해도 조용히 넘어간다 —
           * 이름은 이미 바뀌었고 다음 기록 때 어차피 따라간다. */
          if (Cloud.ready()) Cloud.submitScore({ force: true }).catch(() => {});
          return true;
        },
      },
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 60);
}

/* ---------------- 클라우드 ---------------- */

/**
 * 클라우드 켜기/끄기.
 *
 * ★ 기본은 꺼짐이다. 게임을 켜자마자 계정을 만들지 않는다 —
 *   익명 가입에는 IP 기준 요청 제한이 있어서, 그게 부팅을 막으면 안 된다.
 *
 * ★ 못 지킬 약속을 화면에 쓰지 않는다. 지금은 계정 복구 수단이 없으므로
 *   "브라우저 저장소를 지우면 계정이 사라진다"를 그대로 적는다.
 */
function doCloud() {
  const st = Cloud.status();
  // 되돌릴 백업이 있으면 꺼내 둔다 (없으면 버튼도 안 만든다)
  const rollback = (() => {
    const raw = Cloud.rollbackSave();
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? { data, day: Number(data.day) || 0 } : null;
    } catch { return null; }
  })();
  const msg = el('div', { class: 'tiny', style: { minHeight: '16px', color: 'var(--bad)' } });

  const body = el('div', { class: 'col', style: { gap: '8px', minWidth: 'min(360px, 84vw)' } },
    el('div', { class: 'row spread center' },
      el('span', { class: 'muted tiny', text: '상태' }),
      el('b', { style: { color: st.on ? 'var(--ok)' : 'var(--ink-faint)' }, text: st.label })),
    el('div', { class: 'faint tiny', text: st.detail }),
    st.sync ? el('div', { class: 'faint tiny', text: st.sync }) : null,
    st.on
      ? el('button', {
        class: 'btn sm ghost', style: { alignSelf: 'flex-start' },
        onClick: async (ev) => {
          const b = ev.currentTarget;
          b.disabled = true; b.textContent = '올리는 중…';
          const r = await Cloud.pushNow();
          b.disabled = false; b.textContent = '지금 올리기';
          toast(r.ok ? '세이브를 올렸습니다.' : (r.error || '올리지 못했습니다.'), r.ok ? 'good' : 'bad');
        },
      }, '지금 올리기')
      : null,
    st.on
      ? el('button', {
        class: 'btn sm ghost', style: { alignSelf: 'flex-start' },
        onClick: (ev) => { ev.currentTarget.closest('.modal') && maybeReconcile({ silent: false }); },
      }, '서버와 맞추기')
      : null,
    // 순위표는 클라우드가 꺼져 있어도 볼 수 있다 (읽기 전용이라 로그인이 필요 없다)
    el('button', {
      class: 'btn sm ghost', style: { alignSelf: 'flex-start' },
      onClick: (ev) => { const c = ev.currentTarget.closest('.modal'); if (c) c.remove(); go('rank'); },
    }, '순위표 보기'),
    /* ★ 되돌리기. 이게 없으면 충돌 모달의 "잘못 골랐으면 되돌릴 수 있습니다" 가 거짓말이 된다 —
     *   백업은 잘 써지고 있었는데 꺼내는 코드가 아예 없었다. */
    rollback
      ? el('button', {
        class: 'btn sm ghost', style: { alignSelf: 'flex-start', color: '#e8c27a' },
        onClick: () => confirmDlg(
          '가져오기 되돌리기',
          `서버 세이브를 가져오기 전의 이 기기 세이브(${num(rollback.day)}일차)로 되돌립니다. `
          + '지금 진행 중인 내용은 사라집니다.',
          () => {
            if (!GameState.importState(rollback.data)) { toast('되돌리지 못했습니다.', 'bad'); return; }
            save();
            Cloud.clearRollback();
            toast(`${num(rollback.day)}일차로 되돌렸습니다.`, 'good');
            go('city');
          },
          '되돌린다',
        ),
      }, `가져오기 되돌리기 (${num(rollback.day)}일차)`)
      : null,
    el('div', { class: 'sep' }),
    /* 파일 백업. 헤더에서 뺐지만 지우지는 않았다 —
     * 로그인 안 한 사람에게는 이게 유일한 백업이고, 로그인한 사람도
     * 서버 세이브가 잘못 덮였을 때 마지막으로 기댈 곳이다. */
    el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
      el('button', { class: 'btn sm ghost', onClick: doExport }, '파일로 내보내기'),
      el('button', { class: 'btn sm ghost', onClick: doImport }, '파일에서 불러오기')),
    el('div', { class: 'faint tiny', text: '게임은 행동마다 자동 저장된다 — 따로 저장 버튼은 없다.' }),
    el('div', { class: 'sep' }),
    st.on
      ? el('div', { class: 'faint tiny' },
        '기기를 바꾸거나 앱을 지웠다 깔아도 같은 구글 계정으로 들어오면 그대로 이어진다.')
      : el('div', { class: 'tiny muted' },
        '로그인하면 세이브가 서버에도 보관되고 ', el('b', { text: '랭킹' }), '에 참여한다. '
        + '로그인 안 해도 게임은 그대로 돌아간다.'),
    msg);

  modal({
    title: '세이브 · 클라우드 · 랭킹',
    body,
    actions: [
      { label: '닫기', kind: 'ghost' },
      st.on
        ? {
          /* ★ '끄기' 대신 **계정 전환**이다. 끄는 스위치는 없앴다 —
           *   로그인했으면 켜진 것이고, 상태를 두 군데서 관리하면
           *   "켜졌는데 로그인은 안 된" 같은 조합이 생긴다. */
          label: '다른 계정으로',
          kind: 'ghost',
          act: async () => {
            msg.style.color = 'var(--ink-faint)';
            msg.textContent = '구글 계정 선택으로 넘어갑니다…';
            await Cloud.enable({ switchAccount: true });
            return false;             // 리다이렉트 중 — 창을 닫지 않는다
          },
        }
        : {
          label: Auth.signedIn() ? '켜기' : '구글로 로그인',
          kind: 'primary',
          act: async () => {
            msg.style.color = 'var(--ink-faint)';
            msg.textContent = Auth.signedIn() ? '연결하는 중…' : '구글 로그인으로 넘어갑니다…';
            /* ★ 먼저 한 번 저장한다. `rev` 는 나중에 추가한 필드라, 업데이트 뒤
             *   한 번도 저장 안 한 세이브는 rev 가 없다 — 그러면 첫 업로드가
             *   조용히 건너뛰어져 "켰는데 안 올라간" 상태가 된다. */
            save();
            const r = await Cloud.enable();
            // 로그인이 필요하면 여기서 페이지를 떠난다 — 돌아오면 boot() 이 이어받는다
            if (!r.ok) {
              msg.style.color = 'var(--bad)';
              msg.textContent = r.error || '연결에 실패했습니다.';
              return false;
            }
            if (Auth.signedIn()) { toast('클라우드를 켰습니다.', 'good'); renderHud(); return true; }
            return false;             // 리다이렉트 중 — 창을 닫지 않는다
          },
        },
    ],
  });
}

/* ---------------- 클라우드 복원 ---------------- */

/**
 * 서버 세이브가 로컬보다 앞서 있으면 물어보고 가져온다.
 *
 * ★ **도시 화면에서만 돈다.** `replaceState` 는 state 의 키를 전부 지웠다 다시 채우므로,
 *   전투나 월드맵이 잡고 있던 배열 참조가 그 순간 유령이 된다. 캔버스가 도는 화면에서
 *   이걸 실행하면 다음 프레임에 죽는다.
 *
 * ★ **자동으로 덮어쓰지 않는다.** 로컬이 최신이면 아무것도 안 하고,
 *   서버가 최신이어도 물어본다. 거절하면 로컬이 이긴다.
 */
let reconciling = false;

export async function maybeReconcile({ silent = true } = {}) {
  if (reconciling) return;
  if (!Cloud.ready()) { if (!silent) toast('클라우드가 꺼져 있습니다.'); return; }
  if (currentScreen() !== 'city') { if (!silent) toast('도시 화면에서만 확인할 수 있습니다.'); return; }

  reconciling = true;
  try {
    const c = await Cloud.compare();
    /* ★ 기다리는 동안 플레이어가 도시를 떠났을 수 있다. 부팅 1.2초 + 토큰 만료 시
     *   401→갱신→재시도까지 겹치면 의뢰에 출전하고도 남는 시간이다.
     *   여기서 다시 보지 않으면 진행 중인 판 위에 못 닫는 모달이 뜨고,
     *   replaceState 가 그 판을 통째로 날린다. */
    if (currentScreen() !== 'city') { if (!silent) toast('도시 화면에서만 확인할 수 있습니다.'); return; }
    if (!c.ok) { if (!silent) toast(c.error || '서버를 확인하지 못했습니다.', 'bad'); return; }

    /* ★ `local-newer` 라고 그냥 올리면 안 된다.
     *   rev 는 저장 횟수지 진행도가 아니라서, 서버 쪽이 일수로는 훨씬 앞선 경우가 있다.
     *   그때 조용히 올리면 **묻지도 않고 남의 진행을 덮는다.** divergent 면 무조건 묻는다. */
    /* ★ 로컬에 세이브가 아예 없으면 물어볼 게 없다. 그냥 가져온다 —
     *   "이 기기 것을 쓴다 (0일차)" 는 선택지가 아니라 **아무것도 없는 쪽을 고르라는 말**이다.
     *   게다가 그 모달은 닫기가 없어서 잘못 고르면 빠져나갈 수도 없다. */
    if (!c.local && c.remote) {
      const r = await Cloud.adoptRemote((data) => GameState.importState(data));
      if (r.ok) { save(); toast('서버에 저장된 진행을 불러왔습니다.', 'good'); go('city'); }
      else if (!silent) toast(r.error || '가져오지 못했습니다.', 'bad');
      return;
    }
    if (!c.divergent && (c.status === 'none' || c.status === 'same' || c.status === 'local-newer')) {
      if (!silent) {
        toast(c.status === 'local-newer' ? '이 기기가 더 최신입니다. 올리는 중입니다.' : '서버와 같습니다.', 'good');
        if (c.status === 'local-newer') Cloud.queuePush({ now: true });
      }
      return;
    }
    askAdopt(c);
  } finally {
    reconciling = false;
  }
}

/**
 * 어느 쪽을 쓸지 묻는다. 양쪽 요약을 나란히 보여 주고 사람이 고른다.
 *
 * ★ 화면 문구와 기본 버튼은 **rev 가 아니라 진행 일수**로 정한다.
 *   rev 로 "서버가 더 최신입니다" 라고 말하면, 5일차에서 천 번 저장한 세이브를
 *   200일차 세이브보다 최신이라고 우기는 셈이 된다 (실제로 재현된 상황이다).
 */
function askAdopt(c) {
  const other = c.status === 'other-run';
  const localDay = c.local?.day || 0;
  const remoteDay = c.remote?.day || 0;
  /* 기본 강조를 어디에 줄지.
   * ★ 갈렸으면(divergent) **어느 쪽에도 안 준다.** 한쪽을 강조하는 순간 그게 권고가 되는데,
   *   갈린 상황에서는 코드가 옳은 쪽을 알 방법이 없다 — 저장 횟수와 진행 일수가 서로
   *   반대를 가리키는 게 divergent 의 정의다. 사람이 읽고 고르게 두는 게 유일하게 안전하다. */
  const primary = c.divergent ? 'none' : (remoteDay >= localDay ? 'remote' : 'local');
  const side = (title, m, tone) => el('div', { class: 'col', style: { gap: '2px', flex: '1 1 140px' } },
    el('div', { class: 'tiny', style: { fontWeight: '700', color: tone } , text: title }),
    el('div', { class: 'tiny', text: m ? `${num(m.day)}일차` : '없음' }),
    el('div', { class: 'faint tiny', text: m ? `저장 ${num(m.rev)}회` : '' }));

  const msg = el('div', { class: 'tiny', style: { minHeight: '16px', color: 'var(--bad)' } });

  modal({
    title: other ? '다른 용병단이 서버에 있습니다'
      : c.divergent ? '두 기기의 진행이 갈렸습니다'
        : '다른 기기의 진행이 더 최신입니다',
    dismissable: false,
    body: el('div', { class: 'col', style: { gap: '10px', minWidth: 'min(380px, 86vw)' } },
      el('div', { class: 'row', style: { gap: '14px' } },
        side('이 기기', c.local, 'var(--ink)'),
        side('서버', c.remote, 'var(--gold)')),
      el('div', { class: 'sep' }),
      el('div', { class: 'tiny muted' }, other
        ? '서버에 저장된 것은 다른 용병단입니다(시드가 다릅니다). 하나를 고르면 다른 쪽은 이 기기에서 사라집니다.'
        : c.divergent
          ? `두 기기에서 각각 진행한 것으로 보입니다. 저장 횟수는 ${c.remote.rev > c.local.rev ? '서버' : '이 기기'}가 많지만 `
            + `진행은 ${remoteDay > localDay ? '서버' : '이 기기'}가 앞섭니다 — 어느 쪽이 맞는지는 직접 고르셔야 합니다.`
          : '다른 기기에서 더 진행한 세이브가 서버에 있습니다. 가져오면 이 기기의 진행은 덮입니다.'),
      el('div', { class: 'tiny', style: { color: '#e8c27a' } },
        '덮기 전에 이 기기의 세이브를 한 벌 남겨 둡니다. 잘못 골랐으면 되돌릴 수 있습니다.'),
      msg),
    actions: [
      {
        label: `이 기기 것을 쓴다 (${num(localDay)}일차)`,
        kind: primary === 'local' ? 'primary' : 'ghost',
        act: async () => {
          msg.style.color = 'var(--ink-faint)';
          msg.textContent = '올리는 중…';

          /* ★ 화면에 보여 준 건 **localStorage 의 세이브**인데 save() 는 메모리 state 를 쓴다.
           *   다른 탭이나 PWA 가 그 사이 더 저장했으면 둘이 다르다 — 그때 메모리를 그대로
           *   쓰면 모달이 약속한 일수가 아니라 이 탭의 낡은 진행이 로컬·서버를 덮는다. */
          const cur = Cloud.localSave();
          if (cur && (cur.rev !== (Number(state.rev) || 0) || cur.day !== state.day)) {
            let data = null;
            try { data = JSON.parse(cur.raw); } catch { data = null; }
            if (!data || !GameState.importState(data)) {
              msg.style.color = 'var(--bad)';
              msg.textContent = '이 기기의 세이브를 다시 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.';
              return false;
            }
          }

          Cloud.acceptLocalRun();      // 'other-run' 정체를 푼다 (없으면 영영 갇힌다)

          /* 서버 rev 가 더 높으면 그냥 올려도 되감기 방어에 막힌다 — 그 위로 올려 통과시킨다.
           * ★ bump 를 모달을 띄울 때 찍은 값으로 계산하면 안 된다. 이 모달은 닫기가 없어
           *   얼마든지 오래 열려 있고 그 사이 다른 기기가 더 올릴 수 있다. 직전에 다시 본다. */
          const fresh = await Cloud.compare();
          const remoteRev = (fresh.ok && fresh.remote?.rev) || c.remote?.rev || 0;
          const bump = remoteRev + 1;
          if ((state.rev || 0) < bump) state.rev = bump;
          save();

          // ★ 결과를 기다린다. 던져 두고 성공 토스트를 띄우면 거절당해도 성공했다고 말하게 된다.
          const r = await Cloud.pushNow();
          if (!r.ok) {
            msg.style.color = 'var(--bad)';
            msg.textContent = r.error || '올리지 못했습니다. 잠시 후 다시 시도합니다.';
            return false;
          }
          toast('이 기기의 진행을 유지합니다.', 'good');
          return true;
        },
      },
      {
        label: `서버 것을 가져온다 (${num(remoteDay)}일차)`,
        kind: primary === 'remote' ? 'primary' : 'ghost',
        act: async () => {
          msg.style.color = 'var(--ink-faint)';
          msg.textContent = '가져오는 중…';
          const r = await Cloud.adoptRemote((data) => GameState.importState(data));
          if (!r.ok) {
            msg.style.color = 'var(--bad)';
            msg.textContent = r.error || '가져오지 못했습니다.';
            return false;
          }
          save();                          // 가져온 내용을 로컬에도 확정한다
          toast('서버 세이브를 가져왔습니다.', 'good');
          go('city');
          return true;
        },
      },
    ],
  });
}

/* ---------------- 새 게임 / 용병단 이름 ---------------- */
/** 앞뒤 공백 제거 + 연속 공백 1칸으로 정리 */
const cleanName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** 이름을 확정하고 새 게임을 시작한다. */
function beginNewGame(name) {
  // state.js 의 newGame 은 2번째 인자로 용병단 이름을 받도록 확장 중이다.
  // 아직 1인자만 받는 구버전이면 여분 인자는 무시되므로 아래 폴백이 대신 채운다.
  newGame(undefined, name);
  if (!cleanName(state.companyName)) state.companyName = name;
  save();
  go('city');
  toast(`「${name}」 결성! 새 용병단이 세상에 나섰습니다.`, 'good');
  // 새 용병단은 항상 처음이다 — 따라하기 안내를 띄운다 (건너뛰기 가능).
  startTutorial();
}

/**
 * 용병단 이름 입력 모달.
 * @param {{overwrite?:boolean, mandatory?:boolean}} opts
 *   overwrite  기존 진행 상황을 덮어쓴다는 경고를 함께 띄운다
 *   mandatory  취소 없이 시작만 가능 (첫 실행). 어떻게 닫혀도 게임은 시작된다
 */
function promptNewGame({ overwrite = true, mandatory = false } = {}) {
  const input = el('input', {
    type: 'text',
    maxlength: String(NAME_MAX),
    value: companyName(rng),          // 빈 칸으로 두지 않는다 — 바로 시작할 수 있게 미리 채워둔다
    placeholder: '예) 붉은늑대단',
    autocomplete: 'off',
    spellcheck: 'false',
    style: {
      flex: '1', minWidth: '0', padding: '9px 12px',
      background: 'var(--bg-0)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)', color: 'var(--ink)',
      fontWeight: '700', letterSpacing: '.02em',
    },
  });
  const hint = el('div', { class: 'tiny faint', text: `1~${NAME_MAX}자` });
  const counter = el('div', { class: 'tiny faint num' });
  const refresh = () => {
    const n = cleanName(input.value);
    counter.textContent = `${[...input.value].length}/${NAME_MAX}`;
    if (n.length) { hint.className = 'tiny faint'; hint.textContent = `1~${NAME_MAX}자`; }
  };
  const warn = (msg) => {
    hint.className = 'tiny';
    hint.style.color = 'var(--bad)';
    hint.textContent = msg;
  };
  input.addEventListener('input', () => { hint.style.color = ''; refresh(); });

  const roll = () => {
    input.value = companyName(rng);
    hint.style.color = '';
    refresh();
    input.focus();
    input.select();
  };

  let started = false;
  const doStart = () => {
    const name = cleanName(input.value);
    if (!name) { warn('용병단 이름을 입력하세요. (공백만은 안 됩니다)'); input.focus(); return false; }
    if ([...name].length > NAME_MAX) { warn(`이름은 ${NAME_MAX}자까지만 쓸 수 있습니다.`); input.focus(); return false; }
    started = true;
    beginNewGame(name);
    return true;
  };

  let close = null;
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (doStart()) close?.();
  });

  const body = el('div', { class: 'col', style: { gap: '10px', minWidth: 'min(420px, 76vw)' } },
    el('div', { class: 'muted', text: '세상에 이름을 알릴 용병단의 이름을 정하세요.' }),
    el('div', { class: 'row center', style: { gap: '8px' } },
      input,
      el('button', { class: 'btn', title: '무작위 이름 뽑기', onClick: roll }, '🎲 주사위')),
    el('div', { class: 'row spread center' }, hint, counter),
    overwrite
      ? el('div', {
          class: 'tiny',
          style: {
            marginTop: '4px', padding: '8px 10px', borderRadius: 'var(--radius)',
            border: '1px solid #6e2b34', background: 'rgba(168,58,74,.12)', color: '#eba9a9',
          },
          text: '경고 — 지금 저장된 진행 상황(단원·장비·골드)이 모두 사라지고 1일차부터 다시 시작합니다.',
        })
      : null,
  );

  close = modal({
    title: mandatory ? '용병단 결성' : '새 게임 — 용병단 결성',
    body,
    dismissable: !mandatory,
    actions: mandatory
      ? [{ label: '결성', kind: 'primary', act: () => doStart() }]
      : [
          { label: '취소', kind: 'ghost' },
          { label: '새로 시작', kind: 'primary', act: () => doStart() },
        ],
    // 첫 실행에서는 어떤 경로로 닫히든 게임이 시작돼야 한다 (빈 화면 방지).
    onClose: () => {
      if (!mandatory || started) return;
      beginNewGame(cleanName(input.value).slice(0, NAME_MAX) || companyName(rng));
    },
  });
  refresh();
  input.focus();
  input.select();
  return close;
}

/**
 * 업데이트 **이전에 저장된** 브라우저 세이브를 만났을 때 — 딱 한 번만 뜬다.
 *
 * 그 시절 세이브는 개발자도구로 값만 바꿔 놓은 것일 수 있어 한 번 걸러 낸다.
 * 통과하면 표식이 찍혀 그 뒤로는 다시 안 묻는다.
 * 암호를 못 넣으면 새 게임이고 그 순간 원래 진행 상황은 사라진다 — 그래서 미리 경고한다.
 */
function askLockedSave(held) {
  renderHud();
  $('#screen').innerHTML = '';
  $('#screen').appendChild(el('div', { class: 'panel', style: { textAlign: 'center', padding: '40px 14px' } },
    el('h3', { text: '이어서 하려면 암호가 필요합니다' })));

  const input = el('input', { type: 'password', class: 'co-in', placeholder: '암호' });
  const msg = el('div', { class: 'tiny', style: { color: 'var(--bad)', minHeight: '16px' } });
  const s = held.summary || held;

  modal({
    title: '이전 버전 세이브 확인',
    dismissable: false,
    body: el('div', { class: 'col', style: { gap: '8px', minWidth: 'min(340px, 80vw)' } },
      el('div', { class: 'tiny muted' },
        '이 세이브는 세이브 보호가 들어가기 **이전**에 저장된 것입니다. 한 번만 확인합니다 — '
        + '통과하면 다음부터는 묻지 않습니다.'),
      el('div', { class: 'tiny faint' },
        `발견된 세이브: ${s.day ?? '?'}일차 · 골드 ${num(s.gold ?? 0)} · 단원 ${(held.roster || []).length}명`),
      el('div', { class: 'tiny', style: { color: 'var(--bad)' } },
        '암호 없이 진행하면 이 세이브는 사라지고 새 게임으로 시작합니다.'),
      input, msg),
    actions: [
      {
        label: '새 게임으로',
        kind: 'ghost',
        act: () => { promptNewGame({ overwrite: false, mandatory: true }); },
      },
      {
        label: '이어서 하기',
        kind: 'primary',
        act: () => {
          if (input.value !== LEGACY_PASSWORD) { msg.textContent = '암호가 맞지 않습니다.'; return false; }
          if (!GameState.acceptLockedSave(held)) { msg.textContent = '세이브를 살리지 못했습니다.'; return false; }
          toast('세이브를 이어서 불러왔습니다.', 'good');
          go('city');
          return true;
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 60);
}

/* ---------------- 따라하기 안내 ---------------- */

/**
 * 튜토리얼을 켠다. 모듈은 필요할 때만 받는다 (첫 로딩을 무겁게 하지 않는다).
 * @param {boolean} force true 면 이미 본 사람도 다시 본다
 */
export async function startTutorial(force = false) {
  try {
    const tut = await import('./tutorial.js');
    if (!force && tut.seen()) return;
    // 화면 전환이 끝난 뒤 시작해야 첫 대상(하단 탭)을 찾을 수 있다
    setTimeout(() => {
      try { (force ? tut.restart : tut.start)({ screenOf: currentScreen, navigate: (id) => go(id) }); }
      catch (e) { console.warn('[app] 튜토리얼 시작 실패', e); }
    }, 400);
  } catch (e) {
    console.warn('[app] 튜토리얼 모듈을 불러오지 못했습니다', e);
  }
}

/* ---------------- 부팅 ---------------- */
export function boot() {
  bus.on('change', () => { renderHud(); });
  // 저장 훅을 꽂고 밀려 있던 업로드를 이어 간다. 꺼져 있으면 아무 일도 안 한다.
  try { Cloud.init(); } catch (e) { console.warn('[app] 클라우드 초기화 실패', e); }
  /* ★ 구글 로그인에서 돌아온 길인지 본다. 주소에 `?code=` 가 붙어 있으면
   *   그걸 토큰으로 바꾸고 주소를 청소한다 (코드가 남으면 새로고침 때 재사용 오류가 난다).
   *   로그인 흔적이 없으면 아무 일도 안 하므로 부팅을 지연시키지 않는다. */
  Cloud.finishLogin()
    .then((r) => {
      if (!r.handled) return;
      toast(r.ok ? '로그인했습니다. 클라우드를 켰습니다.' : (r.error || '로그인하지 못했습니다.'), r.ok ? 'good' : 'bad');
      renderHud();
    })
    .catch((e) => console.warn('[app] 로그인 마무리 실패', e));
  window.addEventListener('beforeunload', () => { try { save(); } catch {} });

  let loaded = false;
  if (hasSave()) {
    // load()는 실패/버전 불일치 시 내부에서 newGame()을 돌리고 false를 반환한다.
    // 그 경우도 사실상 새 게임이므로 이름부터 묻는다.
    try { loaded = load() !== false; } catch (e) { console.warn('세이브 로드 실패, 새 게임으로 시작', e); loaded = false; }
  }
  if (loaded) {
    go('city');
    /* ★ boot() 는 동기로 둔다. 복원 확인은 화면이 뜬 **뒤에** 비동기로 붙인다 —
     *   여기서 await 하면 네트워크가 느린 기기에서 첫 화면이 그만큼 늦게 뜬다. */
    setTimeout(() => { maybeReconcile().catch((e) => console.warn('[app] 복원 확인 실패', e)); }, 1200);
    return;
  }

  /* ★ 봉인 검사에 걸린 세이브가 있으면 암호를 먼저 묻는다.
   * load() 는 그 세이브를 **지우지 않고** 들고 있다 — 암호를 맞추면 그대로 이어진다.
   * 못 맞추면 새 게임이다(진행 상황은 그때 사라진다). */
  const held = GameState.takeLockedSave ? GameState.takeLockedSave() : null;
  if (held) { askLockedSave(held); return; }

  // 세이브가 없거나 못 읽었다 — 곧장 newGame() 하지 않고 용병단 이름부터 받는다.
  renderHud();
  $('#screen').innerHTML = '';
  $('#screen').appendChild(el('div', { class: 'panel', style: { textAlign: 'center', padding: '40px 14px' } },
    el('h3', { text: '용병단' }),
    el('div', { class: 'muted', text: '이름을 정하면 첫 단원들과 함께 출발합니다.' })));
  promptNewGame({ overwrite: false, mandatory: true });
}
