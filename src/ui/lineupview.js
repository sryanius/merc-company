/**
 * 편성 표 — 「누가 어느 부대에 있나」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 이 파일이 따로 있는 이유: **두 화면이 같은 표를 그린다.**
 *
 *   · 재생 화면(`pvpreplay.js`) — 내가 싸운 판의 양쪽 편성
 *   · 순위표(`pvp.js`)          — 순위표에 뜬 용병단의 등록 편성
 *
 *   원래는 재생 화면 안에만 있었다. 그대로 두고 순위표에 복사했다면 둘이 갈라졌을 것이다
 *   (§94 에서 «스모크와 도구가 서로 다른 걸 재고 있었다» 로 크게 데였다 — 같은 종류의 실수다).
 *
 * ★★ CSS 도 여기서 넣는다. 예전엔 `.rp-lu*` 를 `pvpreplay.js` 의 `injectStyle()` 이 넣었는데,
 *   그러면 **재생 화면을 한 번도 안 연 사람은 순위표에서 표가 깨진다.**
 *   표를 그리는 쪽이 자기 CSS 를 들고 있어야 한다.
 *
 * ★ 클래스 이름은 `getClass` 로 찾는다. 못 찾으면 조용히 id 를 보여준다 —
 *   서버가 준 편성이 내 클래스 표보다 앞서 나갈 수 있다 (전직 추가 직후 등).
 *
 * @module ui/lineupview
 */
import { el, num } from '../core/util.js';
import { getClass } from '../data/classes.js';
import '../data/classes_t4.js';
import { GRADE_COLOR } from '../art/palette.js';

/** 이 인원보다 적은 부대는 눈에 띄게 — §92 에서 부상자가 빠져 «용병 1명» 이 된 적이 있다 */
export const THIN_SQUAD = 3;

let styleDone = false;

/** 편성 표의 CSS. 여러 번 불러도 한 번만 넣는다. */
export function injectLineupStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  document.head.appendChild(el('style', {
    text: `
.rp-lu { border:1px solid var(--line-soft); border-radius:var(--radius); background:var(--bg-2); overflow:hidden; }
.rp-lu-h { display:flex; justify-content:space-between; align-items:center; gap:8px;
  padding:4px 8px; background:var(--bg-3); font-size:12px; font-weight:700; }
.rp-lu-r { display:grid; grid-template-columns:1fr auto auto auto auto auto; gap:8px; align-items:center;
  padding:3px 8px; border-top:1px solid var(--line-soft); font-size:11px; }
.rp-lu-nm { font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@media (max-width: 520px) { .rp-lu-r { grid-template-columns:1fr auto auto; } .rp-lu-r span:nth-child(n+4) { display:none; } }
`,
  }));
}

/**
 * 부대 하나를 표 한 덩이로.
 * @param {object[]} squad UnitDef 배열 (펫 포함)
 * @param {number} i 0부터
 */
function squadNode(squad, i) {
  const mercs = (squad || []).filter((u) => !u.pet);
  const pets = (squad || []).filter((u) => u.pet);
  const tbl = el('div', { class: 'rp-lu' });
  tbl.appendChild(el('div', { class: 'rp-lu-h' },
    el('span', { text: `${i + 1}부대` }),
    el('span', { class: 'tiny faint', text: `단원 ${mercs.length}명${pets.length ? ` · 펫 ${pets.length}` : ''}` })));

  for (const u of mercs) {
    const cls = u.classId ? getClass(u.classId) : null;
    const st = u.stats || {};
    tbl.appendChild(el('div', { class: 'rp-lu-r' },
      el('span', { class: 'rp-lu-nm', text: u.name || (cls && cls.name) || u.classId || '?' }),
      el('span', { class: 'tiny faint', text: cls ? cls.name : '' }),
      el('span', { class: 'tiny faint', text: u.level ? `Lv${u.level}` : '' }),
      el('span', { class: 'tiny', style: { color: GRADE_COLOR[u.grade] || 'var(--ink-faint)' }, text: u.grade || '' }),
      el('span', { class: 'tiny faint', text: st.hp ? `체 ${num(Math.round(st.hp))}` : '' }),
      el('span', { class: 'tiny faint', text: st.atk ? `공 ${num(Math.round(st.atk))}` : '' })));
  }

  if (mercs.length < THIN_SQUAD) {
    tbl.appendChild(el('div', {
      class: 'tiny',
      style: { color: 'var(--gold)', padding: '2px 8px' },
      text: '단원이 적다',
    }));
  }
  return tbl;
}

/**
 * 한 진영의 부대들. 라벨이 있으면 위에 붙인다.
 * @param {object[][]} squads 부대 배열의 배열
 * @param {{label?:string, mine?:boolean}} [opts]
 */
export function sideNode(squads, opts = {}) {
  const wrap = el('div', { class: 'col', style: { gap: '6px' } });
  if (opts.label) {
    wrap.appendChild(el('div', { class: 'row center', style: { gap: '6px' } },
      el('b', { style: { fontSize: '13px' }, text: opts.label }),
      opts.mine ? el('span', { class: 'tiny faint', text: '(나)' }) : null));
  }
  const list = Array.isArray(squads) ? squads : [];
  if (!list.length) {
    wrap.appendChild(el('div', { class: 'tiny faint', text: '등록된 편성이 없다' }));
    return wrap;
  }
  list.forEach((sq, i) => wrap.appendChild(squadNode(sq, i)));
  return wrap;
}

/**
 * 여러 진영을 한 덩이로 (재생 화면: 공격 / 방어).
 * @param {Array<{label?:string, squads:object[][], mine?:boolean}>} sides
 */
export function lineupNode(sides) {
  injectLineupStyle();
  const box = el('div', { class: 'col', style: { gap: '10px' } });
  for (const s of (sides || [])) {
    box.appendChild(sideNode(s && s.squads, { label: s && s.label, mine: s && s.mine }));
  }
  return box;
}

/**
 * 접었다 폈다 하는 자리에 편성을 끼운다. 이미 펴져 있으면 접는다.
 *
 * ★ 그리다 터져도 화면 전체를 죽이지 않는다 — 서버가 준 편성은 내 클래스 표보다
 *   앞서 나갈 수 있고, 그때 «편성만» 안 보이는 게 맞다.
 *
 * @param {HTMLElement} host 비었다 채웠다 할 자리
 * @param {() => Array<{label?:string, squads:object[][], mine?:boolean}>} build
 * @returns {boolean} 편 상태면 true, 접었으면 false
 */
export function toggleLineup(host, build) {
  if (!host) return false;
  if (host.childNodes.length) { host.textContent = ''; host.style.display = 'none'; return false; }
  host.style.display = '';
  try { host.appendChild(lineupNode(build())); }
  catch (e) {
    host.appendChild(el('div', { class: 'tiny faint', text: `편성을 펴지 못했다: ${String((e && e.message) || e)}` }));
  }
  return true;
}
