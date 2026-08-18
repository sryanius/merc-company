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
import { getCity } from '../data/world.js';
import { companyName } from '../data/names.js';

/** 용병단 이름 최대 길이 */
const NAME_MAX = 20;
/** 이름이 아직 없는 세이브에서 HUD에 쓸 기본 표기 */
const DEFAULT_BRAND = '용병단';

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
  // 무한의 탑도 월드맵 노드로 들어간다. 하단 탭은 폰에서 6칸이 한계라 더 못 늘린다.
  { id: 'tower', title: '무한의 탑', nav: false, load: () => import('./tower.js') },
  // 펫 관리는 용병단 화면에서 들어간다 (장비 관리와 같은 결).
  { id: 'pets', title: '펫', nav: false, load: () => import('./pets.js') },
];

/* HUD 날짜 표기용 소량 CSS. 모듈 안에서 한 번만 주입한다.
   (셸 공용 반응형은 css/style.css 에 있다 — 여기는 app.js 가 만드는 요소만 다룬다) */
const CSS = `
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
    el('div', { class: 'hud-brand', title: brand },
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
    el('div', { class: 'hud-actions' },
      el('button', { class: 'btn sm', onClick: () => { save(); toast('저장했습니다.', 'good'); } }, '저장'),
      el('button', { class: 'btn sm ghost', title: '세이브를 파일로 내려받는다', onClick: doExport }, '내보내기'),
      el('button', { class: 'btn sm ghost', title: '세이브 파일을 불러온다', onClick: doImport }, '불러오기'),
      el('button', { class: 'btn sm ghost', onClick: () => promptNewGame({ overwrite: hasSave() }) }, '새 게임')),
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
    title ? el('header', { text: title }) : null,
    el('div', { class: 'body' }, body),
    actions.length
      ? el('footer', {}, actions.map((a) => el('button', {
          class: `btn ${a.kind || ''}`,
          onClick: () => { if (a.act?.(close) !== false) close(); },
        }, a.label)))
      : el('footer', {}, el('button', { class: 'btn', onClick: close }, '닫기')));
  layer.innerHTML = '';
  layer.appendChild(box);
  layer.onclick = dismissable ? (e) => { if (e.target === layer) close(); } : null;
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
  const { pickSaveFile } = await import('./savefile.js');
  confirmDlg('세이브 불러오기', '현재 진행 상황을 덮어씁니다. 계속할까요?', () => {
    pickSaveFile((res, fileName) => {
      if (!res.ok) { toast(res.error || '불러오기에 실패했습니다.', 'bad'); return; }
      const s = res.summary || {};
      toast(`${fileName} 불러옴 — ${s.day ?? '?'}일차 · 단원 ${s.roster ?? '?'}명`, 'good');
      go('city');
    });
  }, '파일 선택');
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

/* ---------------- 부팅 ---------------- */
export function boot() {
  bus.on('change', () => { renderHud(); });
  window.addEventListener('beforeunload', () => { try { save(); } catch {} });

  let loaded = false;
  if (hasSave()) {
    // load()는 실패/버전 불일치 시 내부에서 newGame()을 돌리고 false를 반환한다.
    // 그 경우도 사실상 새 게임이므로 이름부터 묻는다.
    try { loaded = load() !== false; } catch (e) { console.warn('세이브 로드 실패, 새 게임으로 시작', e); loaded = false; }
  }
  if (loaded) { go('city'); return; }

  // 세이브가 없거나 못 읽었다 — 곧장 newGame() 하지 않고 용병단 이름부터 받는다.
  renderHud();
  $('#screen').innerHTML = '';
  $('#screen').appendChild(el('div', { class: 'panel', style: { textAlign: 'center', padding: '40px 14px' } },
    el('h3', { text: '용병단' }),
    el('div', { class: 'muted', text: '이름을 정하면 첫 단원들과 함께 출발합니다.' })));
  promptNewGame({ overwrite: false, mandatory: true });
}
