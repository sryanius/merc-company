/**
 * tools/mobileaudit.js — 모바일 대응 **브라우저 실측** 하네스 (10차 세션)
 *
 * 정적 검사(`tools/mobile.mjs`)로는 알 수 없는 것을 실제 뷰포트에서 잰다.
 * `tools/perf-battle.js` 와 마찬가지로 **브라우저 전용**이다 (node 로 돌리지 마라).
 *
 * 사용법 — 개발 서버(`node tools/serve.mjs 5175`)를 띄우고 콘솔에서:
 *
 *   const A = await import('/tools/mobileaudit.js');
 *   await A.setup();          // 화면이 꽉 차도록 상태를 부풀린다(부대 5 · 단원 35 · 장비 100+)
 *   const r = await A.sweep(); // 전 화면 + 모달 + 전투를 돌며 감사
 *   A.bad(r);                  // 문제가 있는 항목만
 *
 * 판정 기준 (docs/HANDOFF.md §13 과 같다)
 *   1) 가로 스크롤 0        document.body.scrollWidth <= innerWidth   ★가장 중요
 *   2) 화면 밖 요소 0       getBoundingClientRect().right > innerWidth
 *                           (단, 조상이 overflow-x:auto 면 그 안에서 스크롤되는 것이므로 정상)
 *   3) 터치 타겟 >= 36px    클릭 가능한 요소의 **실효 히트 영역**(클릭 가능한 조상 포함)
 *   4) 글자 >= 12px         직접 텍스트를 가진 요소의 computed font-size (폰 폭에서만 본다)
 *   5) 콘솔 에러 0
 *
 * 뷰포트는 이 스크립트가 못 바꾼다 — 브라우저 도구(devtools 기기 모드 등)로 바꾼 뒤 다시 부른다.
 */

/** 클릭 가능하다고 보는 것들 */
const CLICK = 'button,a,input,select,textarea,label,[role=button],.btn,.card,.dg-tab,.dg-sq,.qs-card,.co-slot';
/** 터치 타겟 하한 (권장 40, 판정은 36 에서 끊는다) */
export const TOUCH_MIN = 36;
/** 글자 하한 */
export const FONT_MIN = 12;
/** 이 폭 이하를 "폰"으로 본다 — 글자 하한은 폰에서만 판정한다 (css/style.css 와 같은 기준선) */
export const PHONE_PX = 767;

export const errors = [];
let hooked = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 콘솔 에러/예외를 모은다 (한 번만 건다) */
export function hookErrors() {
  if (hooked) return errors;
  hooked = true;
  const ce = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 240)); ce(...a); };
  addEventListener('error', (e) => errors.push('onerror: ' + e.message));
  addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason).slice(0, 240)));
  return errors;
}

const label = (e) => {
  let s = e.tagName.toLowerCase();
  if (e.id) s += '#' + e.id;
  if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.');
  return s;
};
/** 조상 중 가로 스크롤 컨테이너 (있으면 그 안에서 스크롤되는 것이므로 화면 밖 요소가 아니다) */
const scroller = (e) => {
  for (let p = e.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
};
/** 실효 히트 영역 — 체크박스처럼 작아도 label 이 감싸면 그 label 이 진짜 터치 타겟이다 */
const hitRect = (e) => {
  let best = e.getBoundingClientRect();
  let n = 0;
  for (let p = e.parentElement; p && n < 4; p = p.parentElement, n++) {
    if (!p.matches || !p.matches(CLICK)) continue;
    const r = p.getBoundingClientRect();
    if (Math.min(r.width, r.height) > Math.min(best.width, best.height)) best = r;
  }
  return best;
};

/**
 * 지금 화면을 감사한다.
 * @param {string} name 보고용 이름
 */
export function audit(name = '') {
  hookErrors();
  const IW = innerWidth;
  const phone = IW <= PHONE_PX;
  const over = [], small = [], tiny = [];
  for (const e of document.querySelectorAll('#app *, #modal-layer *, #toast-layer *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    if ((r.right > IW + 0.5 || r.left < -0.5) && !scroller(e)) {
      over.push({ sel: label(e), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1) });
    }
    if (e.matches(CLICK) && !e.disabled && !e.closest('[disabled]')) {
      const h = hitRect(e);
      const m = Math.min(h.width, h.height);
      if (m < TOUCH_MIN) small.push({ sel: label(e), w: +h.width.toFixed(1), h: +h.height.toFixed(1), text: (e.textContent || '').trim().slice(0, 20) });
    }
    if (phone) {
      let t = '';
      for (const n of e.childNodes) if (n.nodeType === 3) t += n.nodeValue;
      if (t.trim() && parseFloat(cs.fontSize) < FONT_MIN) {
        tiny.push({ sel: label(e), px: parseFloat(cs.fontSize), text: t.trim().slice(0, 20) });
      }
    }
  }
  return {
    name, iw: IW, ih: innerHeight, phone,
    bodySW: document.body.scrollWidth, docSW: document.documentElement.scrollWidth,
    hscroll: document.body.scrollWidth > IW || document.documentElement.scrollWidth > IW,
    overN: over.length, over: over.slice(0, 20),
    smallN: small.length, small: small.slice(0, 20),
    tinyN: tiny.length, tiny: tiny.slice(0, 20),
    errN: errors.length, err: errors.slice(0, 4),
  };
}

/**
 * 화면이 가장 빽빽해지도록 상태를 부풀린다 (최악의 경우로 재기 위해).
 * ★ 게임 밸런스를 바꾸지 않는다 — 세이브에 쓰지 말고 검사 후 새로고침해라.
 */
export async function setup() {
  hookErrors();
  const St = await import('/src/game/state.js');
  const Sq = await import('/src/game/squad.js');
  const M = await import('/src/game/merc.js');
  const G = await import('/src/game/gear.js');
  const Q = await import('/src/game/quest.js');
  const C = await import('/src/data/classes.js');
  const Sets = await import('/src/data/sets.js');
  const s = St.state;
  s.gold = 200000; s.rosterCap = 40; s.renown = 1200;
  for (const k in s.reputation) s.reputation[k] = Math.max(s.reputation[k], 60);
  while (s.squads.length < 5) {
    const nm = `제${s.squads.length + 1}부대`;
    let bought = false;
    try { const r = Sq.buySquad(s, nm); bought = !!(r && r.ok !== false); } catch (e) { bought = false; }
    if (!bought) s.squads.push(Sq.createSquad(nm, 'basic'));
  }
  const ids = Object.keys(C.CLASSES);
  const grades = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
  let n = 0;
  while (s.roster.length < 35) {
    s.roster.push(M.createMerc({ classId: ids[(n * 7) % ids.length], grade: grades[n % 7], level: 1 + ((n * 11) % 78) }));
    n++;
  }
  for (const sq of s.squads) {
    for (let i = 0; i < 7; i++) {
      const free = s.roster.find((m) => !s.squads.some((q) => (q.memberUids || []).includes(m.uid)));
      if (!free) break;
      try { Sq.addToSquad(s, sq.id, free.uid, i); } catch (e) { /* 슬롯이 차 있으면 넘어간다 */ }
    }
  }
  if ((s.items || []).length < 90) {
    for (let i = 0; i < 80; i++) { try { St.addItem(G.rollItem({ ilvl: 5 + i, rarityBonus: 0.4 })); } catch (e) { /* */ } }
    const sid = Object.keys(Sets.SETS || {});
    for (let i = 0; i < 10 && sid.length; i++) { try { St.addItem(G.rollSetItem({ setId: sid[i % sid.length], ilvl: 60 })); } catch (e) { /* */ } }
  }
  try { G.autoEquipAll(s); } catch (e) { /* */ }
  try { s.quests = Q.genQuests(s.cityId, s.day, undefined, s.squads.length); } catch (e) { /* */ }
  try { St.bus.emit('change'); } catch (e) { /* */ }
  const app = await import('/src/ui/app.js');
  await app.go('city');
  await sleep(300);
  return { roster: s.roster.length, squads: s.squads.length, items: (s.items || []).length, quests: (s.quests || []).length };
}

/** 전 화면 + 주요 모달 + 전투(결과까지)를 돌며 감사한다 */
export async function sweep() {
  hookErrors();
  const app = await import('/src/ui/app.js');
  const out = [];
  const byText = (t) => [...document.querySelectorAll('#screen button')].find((b) => (b.textContent || '').includes(t));
  const closeModal = () => { const m = document.querySelector('#modal-layer'); if (m) m.innerHTML = ''; };

  for (const id of ['city', 'quests', 'tavern', 'company', 'inventory', 'world', 'dungeon']) {
    errors.length = 0;
    try { await app.go(id); } catch (e) { errors.push(`go(${id}): ${e}`); }
    await sleep(340);
    out.push(audit(id));
  }
  // 모달 (도시 시설 / 단원 상세 / 아이템 상세)
  const modals = [
    ['city', () => byText('물건 보기'), '모달:상점'],
    ['city', () => byText('작업대로'), '모달:대장간'],
    ['city', () => byText('여관에서 휴식'), '모달:여관'],
    ['company', () => byText('상세'), '모달:단원'],
    ['inventory', () => document.querySelector('#screen .cards .card'), '모달:아이템'],
  ];
  for (const [screen, find, name] of modals) {
    errors.length = 0;
    try { await app.go(screen); } catch (e) { /* */ }
    await sleep(320);
    const t = find();
    if (!t) { out.push({ name, skipped: '대상 없음' }); continue; }
    t.click();
    await sleep(430);
    out.push(audit(name + (document.querySelector('#modal-layer .modal') ? '' : '(모달 안 열림)')));
    closeModal();
  }
  // 던전 주차 탭 선택 상태
  errors.length = 0;
  try { await app.go('dungeon'); } catch (e) { /* */ }
  await sleep(320);
  const tab = document.querySelector('.dg-tab');
  if (tab) { tab.click(); await sleep(360); }
  out.push(audit('dungeon(주차 선택)'));
  // 의뢰 선택 → 전투 → 결과
  errors.length = 0;
  try { await app.go('quests'); } catch (e) { /* */ }
  await sleep(320);
  const card = document.querySelector('.qs-card');
  if (card) { card.click(); await sleep(360); }
  out.push(audit('quests(의뢰 선택)'));
  errors.length = 0;
  const go = document.querySelector('.qs-mb-go') || document.querySelector('.qs-send-btn');
  if (go) {
    go.click(); await sleep(900);
    out.push(audit('battle(교전 중)'));
    // rAF 는 창이 숨겨져 있으면 멈춘다(HANDOFF §4) — `결과만 보기`는 rAF 없이 끝까지 시뮬한다
    const ff = [...document.querySelectorAll('#screen button')].find((x) => x.textContent.includes('결과만 보기'));
    if (ff) { ff.click(); await sleep(1100); out.push(audit('battle(결과)')); }
    const exit = [...document.querySelectorAll('.bt-actions button')].find((x) => /도시|나가|돌아|계속/.test(x.textContent));
    if (exit) { exit.click(); await sleep(600); }
  }
  return out;
}

/** 문제 있는 항목만 추린다 */
export function bad(rows) {
  return rows.filter((r) => r.skipped || r.hscroll || r.overN || r.smallN || r.tinyN || r.errN);
}
/** 한 줄 요약 */
export function summary(rows) {
  return rows.map((r) => r.skipped
    ? `${r.name}: 건너뜀(${r.skipped})`
    : `${r.name}: iw=${r.iw} bodySW=${r.bodySW} 가로스크롤=${r.hscroll} 밖=${r.overN} 작은터치=${r.smallN} 작은글자=${r.tinyN} 에러=${r.errN}`);
}
