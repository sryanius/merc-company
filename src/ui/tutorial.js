/**
 * 따라하기 튜토리얼 — 첫 실행 안내
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 버튼을 하나씩 짚어 주고 그걸 누르면 다음으로 넘어간다.
 *
 * ── 이 파일이 조심하는 것 (이 게임 UI 의 특성)
 * 1. **화면은 통째로 다시 그려진다.** `app.js refresh()` 가 `host.innerHTML=''` 후 재생성하므로
 *    DOM 참조를 들고 있으면 다음 순간 죽은 노드가 된다. → 매번 셀렉터로 다시 찾는다.
 * 2. **rAF 가 멈출 수 있다** (`document.hidden`). 위치 추적을 rAF 에만 걸면 안 된다.
 *    → MutationObserver + 짧은 인터벌 + resize/scroll 로 갱신한다.
 * 3. **못 찾는 대상이 있어도 진행을 막지 않는다.** 화면 구조가 바뀌어 셀렉터가 어긋나도
 *    말풍선은 뜨고 "건너뛰기"로 빠져나갈 수 있어야 한다 — 튜토리얼이 게임을 잠그면 안 된다.
 *
 * @module ui/tutorial
 */

import { el } from '../core/util.js';
import { state, save } from '../game/state.js';

/* ─────────────────────────── 단계 정의 ─────────────────────────── */

/**
 * @typedef {object} Step
 * @property {string} id
 * @property {string} text        말풍선 본문
 * @property {string} [screen]    이 화면일 때만 뜬다 (없으면 아무 화면)
 * @property {string} [target]    강조할 요소 CSS 셀렉터
 * @property {(s:object)=>boolean} [done]  참이 되면 자동으로 다음 단계
 * @property {boolean} [clickToAdvance]    대상을 누르면 넘어간다 (기본 true)
 */

/** @type {Step[]} */
const STEPS = [
  {
    id: 'intro',
    text: '용병단을 맡았다. 할 일은 단순하다 — **의뢰를 받고, 싸우고, 강해진다.**\n'
      + '먼저 의뢰소로 가자.',
    target: 'button[data-nav="quests"]',
  },
  {
    id: 'pick-quest',
    screen: 'quests',
    text: '계약서가 붙어 있다. **F 등급**부터 고르면 된다.\n'
      + '의뢰를 하나 눌러 자세히 보자.',
    target: '.qs-card',
  },
  {
    id: 'deploy',
    screen: 'quests',
    text: '오른쪽(폰이면 아래)에서 **부대를 골라 출정**시킨다.\n'
      + '색이 곧 위험도다 — 초록이면 해 볼 만하다.',
    target: '.qs-send-btn',
  },
  {
    id: 'battle',
    screen: 'battle',
    // ★ 전투 화면은 직접 못 간다 — 기다리는 동안 이 문구를 띄운다 (renderWaiting)
    wait: '의뢰에 **부대를 출정**시키면 전투가 시작된다.\n그때 안내가 이어진다.',
    text: '전투는 **저절로 진행된다.** 지켜보기만 하면 된다.\n'
      + '급하면 배속을 올리거나 «결과만 보기»를 눌러라.',
    target: '.bt-log, .bt-actions, canvas',
    clickToAdvance: false,
    done: () => !!document.querySelector('.bt-res-head'),
  },
  {
    id: 'result',
    screen: 'battle',
    wait: '전투가 끝나면 **전과와 전리품**이 나온다.\n그때 안내가 이어진다.',
    text: '전과와 전리품이 나왔다. **얻은 장비는 자동으로 끼울 수 있다.**\n'
      + '다 봤으면 아래 버튼으로 나가자.',
    target: '.bt-actions button',
  },
  {
    id: 'advance-day',
    screen: 'city',
    text: '★ **날짜는 저절로 흐르지 않는다.**\n'
      + '직접 넘겨야 임금이 나가고, 부상이 낫고, 의뢰 목록이 갱신된다.',
    target: '.t-acts button',
  },
  {
    id: 'done',
    text: '기본은 다 익혔다.\n'
      + '단원이 늘고 레벨이 오르면 **부대·진형·던전·황금 나락·무한의 탑**이 차례로 열린다.\n'
      + '화면 위쪽의 «지금 할 일» 이 다음에 뭘 하면 되는지 항상 알려 준다.',
  },
];

/* ─────────────────────────── 상태 ─────────────────────────── */

let idx = -1;
/** 직접 갈 수 없는 화면을 기다리는 중인가 (renderWaiting 이 켜고 render 가 끈다) */
let waiting = false;
let root = null;      // 오버레이 루트
let hole = null;      // 구멍(강조 테두리)
let bubble = null;    // 말풍선
let timer = null;
let mo = null;
let curScreen = () => null;
let navTo = null;      // (id) => go(id) — 단계가 요구하는 화면으로 직접 데려간다

/** 튜토리얼을 이미 봤는가 */
export function seen() {
  return !!(state.tutorial && state.tutorial.done);
}

/** 봤다고 기록 */
function markSeen() {
  state.tutorial = { ...(state.tutorial || {}), done: true };
  try { save(); } catch (e) { /* 저장 실패는 튜토리얼을 막지 않는다 */ }
}

/* ─────────────────────────── CSS ─────────────────────────── */

const CSS = `
#tut-root { position:fixed; inset:0; z-index:9000; pointer-events:none; }
#tut-root .tut-dim { position:absolute; inset:0; background:rgba(6,4,10,.62); }
#tut-hole { position:absolute; border-radius:10px; box-shadow:0 0 0 9999px rgba(6,4,10,.62),
            0 0 0 3px var(--gold), 0 0 22px 4px rgba(224,180,74,.5);
            transition:all .18s ease; pointer-events:none; }
#tut-bubble { position:absolute; max-width:min(360px, 88vw); pointer-events:auto;
              background:#1b1626; border:1px solid rgba(224,180,74,.45); border-radius:12px;
              padding:12px 14px; box-shadow:0 10px 30px rgba(0,0,0,.55); }
#tut-bubble .t { font-size:13px; line-height:1.6; color:var(--ink); white-space:pre-line; }
#tut-bubble .t b { color:var(--gold); }
#tut-bubble .r { display:flex; gap:8px; align-items:center; margin-top:10px; }
#tut-bubble .n { font-size:11px; color:var(--ink-faint); flex:1; }
@media (max-width: 767px) {
  #tut-bubble { max-width:calc(100vw - 24px); }
  #tut-bubble .t { font-size:14px; }
  #tut-bubble .n { font-size:12px; }
}
`;
function injectStyle() {
  if (document.getElementById('tut-style')) return;
  document.head.appendChild(el('style', { id: 'tut-style', text: CSS }));
}

/* ─────────────────────────── 그리기 ─────────────────────────── */

function findTarget(step) {
  if (!step.target) return null;
  for (const sel of step.target.split(',')) {
    const n = document.querySelector(sel.trim());
    if (n && n.offsetParent !== null) return n;
  }
  return null;
}

/** 말풍선 안의 **굵게** 를 <b> 로 */
function richText(s) {
  const box = el('div', { class: 't' });
  for (const part of String(s).split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**')) box.appendChild(el('b', { text: part.slice(2, -2) }));
    else box.appendChild(document.createTextNode(part));
  }
  return box;
}

function place() {
  const step = STEPS[idx];
  if (!step || !root) return;

  const node = findTarget(step);
  if (node) {
    const r = node.getBoundingClientRect();
    const pad = 6;
    hole.style.display = 'block';
    hole.style.left = `${r.left - pad}px`;
    hole.style.top = `${r.top - pad}px`;
    hole.style.width = `${r.width + pad * 2}px`;
    hole.style.height = `${r.height + pad * 2}px`;

    // 말풍선은 대상 아래 → 자리가 없으면 위
    const bw = bubble.offsetWidth || 320;
    const bh = bubble.offsetHeight || 120;
    let bx = Math.min(Math.max(8, r.left), window.innerWidth - bw - 8);
    let by = r.bottom + 12;
    if (by + bh > window.innerHeight - 8) by = Math.max(8, r.top - bh - 12);
    bubble.style.left = `${bx}px`;
    bubble.style.top = `${by}px`;
  } else {
    // 대상을 못 찾았다 — 화면을 가리지 말고 가운데 아래에 띄운다
    hole.style.display = 'none';
    const bw = bubble.offsetWidth || 320;
    bubble.style.left = `${Math.max(8, (window.innerWidth - bw) / 2)}px`;
    bubble.style.top = `${Math.max(8, window.innerHeight - (bubble.offsetHeight || 140) - 24)}px`;
  }
}

function render() {
  const step = STEPS[idx];
  if (!step) { stop(); return; }

  /* 이 단계가 요구하는 화면이 아닐 때.
   *
   * ★ 못 가는 화면(전투)을 기다릴 때 **숨기면 안 된다.**
   *   3단계에서 「다음」을 누르면 4단계(전투)로 넘어가는데, 전투 화면은 부대를
   *   출정시켜야 열린다. 예전에는 여기서 그냥 `display:none` 을 걸어 **안내가 통째로
   *   사라졌다** — 플레이어 눈에는 버튼이 먹통이다(실제 제보로 확인).
   *   무엇을 해야 이어지는지 말해 주고 계속 떠 있어야 한다. */
  const wrong = step.screen && curScreen() !== step.screen;
  if (wrong) {
    if (step.screen !== 'battle' && typeof navTo === 'function') {
      root.style.display = 'none';
      navTo(step.screen);
      setTimeout(() => { if (root) render(); }, 320);
      return;
    }
    renderWaiting(step);
    return;
  }
  waiting = false;
  root.style.display = 'block';

  bubble.innerHTML = '';
  bubble.append(
    richText(step.text),
    el('div', { class: 'r' },
      el('span', { class: 'n', text: `${idx + 1} / ${STEPS.length}` }),
      el('button', { class: 'btn sm ghost', onClick: () => { markSeen(); stop(); } }, '건너뛰기'),
      el('button', { class: 'btn sm primary', onClick: next }, idx === STEPS.length - 1 ? '시작하기' : '다음')),
  );
  place();
}

/**
 * 직접 갈 수 없는 화면(전투)을 기다리는 중.
 * 구멍(강조)은 지우고, **무엇을 하면 이어지는지**만 아래쪽에 띄운다.
 * 「다음」 버튼은 안 만든다 — 눌러도 갈 수 없는 곳이라 또 먹통처럼 보인다.
 */
function renderWaiting(step) {
  waiting = true;
  root.style.display = 'block';
  hole.style.display = 'none';
  bubble.innerHTML = '';
  bubble.append(
    richText(step.wait || '이어서 진행하면 안내가 계속된다.'),
    el('div', { class: 'r' },
      el('span', { class: 'n', text: `${idx + 1} / ${STEPS.length}` }),
      el('button', { class: 'btn sm ghost', onClick: () => { markSeen(); stop(); } }, '건너뛰기')),
  );
  // 대상이 없으니 화면 아래 가운데에 둔다 (place() 의 '대상 없음' 경로와 같은 자리)
  const bw = bubble.offsetWidth || 320;
  bubble.style.left = `${Math.max(8, (window.innerWidth - bw) / 2)}px`;
  bubble.style.top = `${Math.max(8, window.innerHeight - (bubble.offsetHeight || 140) - 24)}px`;
}

/* ─────────────────────────── 진행 ─────────────────────────── */

function next() {
  idx += 1;
  if (idx >= STEPS.length) { markSeen(); stop(); return; }
  render();
}

/** 대상 클릭 / 조건 충족을 감시한다 */
function tick() {
  const step = STEPS[idx];
  if (!step || !root) return;
  /* 전투처럼 직접 못 가는 화면을 기다리는 중이면, 도착했을 때 본 내용으로 바꾼다.
   * ★ 예전에는 `display === 'none'` 일 때만 봤는데, 이제 기다리는 동안에도
   *   안내를 띄워 두므로(renderWaiting) 그 조건으로는 영영 안 바뀐다 —
   *   전투 화면에 도착해도 "출정시키면 시작된다"가 그대로 남는다. */
  if (waiting || root.style.display === 'none') {
    if (!step.screen || curScreen() === step.screen) render();
    return;
  }
  if (typeof step.done === 'function') {
    try { if (step.done(state)) { next(); return; } } catch (e) { /* 무시 */ }
  }
  place();
}

/** 대상을 실제로 눌렀을 때 넘어간다 (캡처 단계라 화면이 바뀌기 전에 잡는다) */
function onDocClick(ev) {
  const step = STEPS[idx];
  if (!step || step.clickToAdvance === false) return;
  const node = findTarget(step);
  if (node && (node === ev.target || node.contains(ev.target))) {
    setTimeout(next, 260);   // 화면 전환이 끝난 뒤 다음 단계를 그린다
  }
}

/* ─────────────────────────── 공개 API ─────────────────────────── */

/**
 * 튜토리얼을 켠다.
 * @param {{screenOf:()=>string}} opt `screenOf` 는 지금 화면 id 를 돌려주는 함수 (app.js currentScreen)
 */
export function start(opt = {}) {
  if (root) stop();
  injectStyle();
  curScreen = typeof opt.screenOf === 'function' ? opt.screenOf : () => null;
  navTo = typeof opt.navigate === 'function' ? opt.navigate : null;

  hole = el('div', { id: 'tut-hole' });
  bubble = el('div', { id: 'tut-bubble' });
  root = el('div', { id: 'tut-root' }, hole, bubble);
  document.body.appendChild(root);

  idx = 0;
  render();

  // rAF 는 탭이 숨으면 멈춘다 — 인터벌로 받쳐 준다 (가볍게 200ms)
  timer = setInterval(tick, 200);
  mo = new MutationObserver(() => place());
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  document.addEventListener('click', onDocClick, true);
}

/** 튜토리얼을 끈다 (기록은 안 건드린다 — markSeen 은 호출부가 정한다) */
export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (mo) { mo.disconnect(); mo = null; }
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
  document.removeEventListener('click', onDocClick, true);
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = hole = bubble = null;
  idx = -1;
}

/** 지금 켜져 있는가 */
export function active() { return !!root; }

/** 처음부터 다시 (도움말 메뉴용) */
export function restart(opt) {
  state.tutorial = { ...(state.tutorial || {}), done: false };
  start(opt);
}
