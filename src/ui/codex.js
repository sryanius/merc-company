// 도감 — 용병 클래스 · 펫 · 적을 한눈에 (제작자: 「클래스별로 화면 내가 확인하기 힘드니까
// 이번 기회에 도감을 추가하자. 용병, 펫, 적 각각 볼 수 있게」)
// 화면 모듈 계약: meta / render(root, params) / dispose()
//
// ★ 렌더 비용: 클래스가 105개라 전부 세우면 초상 105장을 굽는다 (한 장이 수십 ms).
//   그래서 **차수(tier)별 접이식**으로 나누고 연 구간만 그린다 — 기본은 1차만 연다.
//   (장비 화면 페이징과 같은 교훈: 화면에 안 보이는 것을 만들 이유가 없다)
import { el } from '../core/util.js';
import { getShowcase, drawShowcase } from '../art/showcase.js';
import { mercRecipe } from '../game/merc.js';
import { CLASSES, ARCHETYPES } from '../data/classes.js';
import '../data/classes_t4.js';
import { PETS, ROLE_NAME, PET_GRADES } from '../data/pets.js';
import { ENEMIES } from '../data/enemies.js';

export const meta = { id: 'codex', title: '도감' };

let styleDone = false;
let tab = 'merc';                 // merc | pet | foe
let openTiers = { 1: true };      // 용병 탭: 연 차수
let openFoe = { 1: true };        // 적 탭: 연 티어

export function dispose() { /* rAF 없음 — 전부 정지 프레임 */ }

function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  document.head.appendChild(el('style', {
    text: `
.cdx-tabs { display:flex; gap:6px; flex-wrap:wrap; }
.cdx-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px; }
.cdx-card { border:1px solid var(--line-soft); border-radius:var(--radius); background:var(--bg-2);
  padding:8px; display:flex; flex-direction:column; align-items:center; gap:4px; }
.cdx-card canvas { image-rendering:pixelated; }
.cdx-nm { font-weight:700; font-size:13px; text-align:center; }
.cdx-sub { font-size:11px; color:var(--ink-faint); text-align:center; }
.cdx-sec { cursor:pointer; user-select:none; }
.cdx-sec h3 { margin:0; }
@media (max-width: 767px) { .cdx-grid { grid-template-columns:repeat(auto-fill, minmax(124px, 1fr)); } .cdx-sub { font-size:12px; } }
`,
  }));
}

/** 정지 프레임 스프라이트 — 도감은 애니메이션이 필요 없다 (105장이 같이 돌면 그게 사고다) */
function stillSprite(recipe, { front = true, w = 120, h = 132, scale = 3 } = {}) {
  const c = el('canvas', { width: w, height: h });
  try {
    const sp = getShowcase(recipe, { front });
    if (sp) {
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      drawShowcase(ctx, sp, 'idle0', w / 2, h - 6, { scale });
    }
  } catch (e) { console.warn('[codex] 스프라이트 실패', e); }
  return c;
}

/* ─────────────────────────── 용병 ─────────────────────────── */

const TIER_LABEL = { 1: '1차', 2: '2차', 3: '3차', 4: '4차' };

function mercTab(root) {
  const byTier = { 1: [], 2: [], 3: [], 4: [] };
  for (const c of Object.values(CLASSES)) {
    if (!c || !c.id) continue;
    (byTier[c.tier || 1] = byTier[c.tier || 1] || []).push(c);
  }
  for (const t of Object.keys(byTier)) byTier[t].sort((a, b) => String(a.arch).localeCompare(String(b.arch)));

  const wrap = el('div', { class: 'col', style: { gap: '12px' } });
  for (const t of [1, 2, 3, 4]) {
    const list = byTier[t] || [];
    if (!list.length) continue;
    const open = !!openTiers[t];
    const panel = el('div', { class: 'panel col', style: { gap: '10px' } });
    panel.appendChild(el('div', {
      class: 'row spread center cdx-sec',
      onClick: () => { openTiers[t] = !open; rerender(root); },
    },
      el('h3', { text: `${TIER_LABEL[t]} — ${list.length}종` }),
      el('span', { class: 'tiny faint', text: open ? '접기 ▴' : '펼치기 ▾' })));
    if (open) {
      const grid = el('div', { class: 'cdx-grid' });
      for (const c of list) {
        const arch = ARCHETYPES && ARCHETYPES[c.arch];
        grid.appendChild(el('div', { class: 'cdx-card' },
          stillSprite(mercRecipe({ classId: c.id }, {})),
          el('div', { class: 'cdx-nm', text: c.name }),
          el('div', { class: 'cdx-sub', text: `${(arch && arch.name) || c.arch} · ${(c.equip || []).join('·') || '-'}` })));
      }
      panel.appendChild(grid);
    }
    wrap.appendChild(panel);
  }
  return wrap;
}

/* ─────────────────────────── 펫 ─────────────────────────── */

function petTab() {
  const list = Object.values(PETS || {}).filter(Boolean);
  const grid = el('div', { class: 'cdx-grid' });
  for (const sp of list) {
    grid.appendChild(el('div', { class: 'cdx-card' },
      stillSprite(sp.sprite || {}, { front: false, w: 108, h: 120 }),
      el('div', { class: 'cdx-nm', text: sp.name || sp.id }),
      el('div', { class: 'cdx-sub', text: `${(ROLE_NAME && ROLE_NAME[sp.role]) || sp.role || ''}${sp.tier ? ` · ${sp.tier}티어` : ''}` })));
  }
  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('h3', { text: `펫 — ${list.length}종 (무한의 탑에서 얻는다)` }), grid);
}

/* ─────────────────────────── 적 ─────────────────────────── */

function foeTab(root) {
  const byTier = {};
  for (const e of Object.values(ENEMIES || {})) {
    if (!e || !e.id) continue;
    (byTier[e.tier || 1] = byTier[e.tier || 1] || []).push(e);
  }
  const wrap = el('div', { class: 'col', style: { gap: '12px' } });
  for (const t of Object.keys(byTier).sort((a, b) => a - b)) {
    const list = byTier[t];
    const open = !!openFoe[t];
    const panel = el('div', { class: 'panel col', style: { gap: '10px' } });
    panel.appendChild(el('div', {
      class: 'row spread center cdx-sec',
      onClick: () => { openFoe[t] = !open; rerender(root); },
    },
      el('h3', { text: `${t}티어 — ${list.length}종` }),
      el('span', { class: 'tiny faint', text: open ? '접기 ▴' : '펼치기 ▾' })));
    if (open) {
      const grid = el('div', { class: 'cdx-grid' });
      for (const e of list) {
        grid.appendChild(el('div', { class: 'cdx-card' },
          stillSprite(e.sprite || {}, { front: false, w: 108, h: 120 }),
          el('div', { class: 'cdx-nm', text: (e.boss ? '👑 ' : '') + (e.name || e.id) }),
          el('div', { class: 'cdx-sub', text: `${e.range === 'ranged' ? '원거리' : '근접'}${e.biome ? ` · ${e.biome}` : ''}` })));
      }
      panel.appendChild(grid);
    }
    wrap.appendChild(panel);
  }
  return wrap;
}

/* ─────────────────────────── 뼈대 ─────────────────────────── */

function rerender(root) { root.innerHTML = ''; render(root); }

export function render(root) {
  injectStyle();
  const tabs = [['merc', '용병'], ['pet', '펫'], ['foe', '적']];
  root.appendChild(el('div', { class: 'panel col', style: { gap: '10px' } },
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('h3', { class: 'panel-title', style: { margin: '0' }, text: '도감' }),
      el('div', { class: 'cdx-tabs' }, tabs.map(([id, label]) => el('button', {
        class: `btn sm ${tab === id ? 'primary' : 'ghost'}`,
        onClick: () => { tab = id; rerender(root); },
      }, label)))),
    el('div', { class: 'tiny faint', text: '등급·개인 편차(머리색 등)를 뺀 기본 모습이다. 용병은 정면 일러스트, 펫·적은 전투 모습.' })));
  if (tab === 'merc') root.appendChild(mercTab(root));
  else if (tab === 'pet') root.appendChild(petTab());
  else root.appendChild(foeTab(root));
}
