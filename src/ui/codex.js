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
import { CLASSES, ARCHETYPES, classChain } from '../data/classes.js';
import { getSkill } from '../data/skills.js';
import { LINEAGE_TRAIT, BRANCH_TRAIT } from '../data/lineage.js';
import '../data/classes_t4.js';
import { PETS, ROLE_NAME, PET_GRADES } from '../data/pets.js';
import { ENEMIES } from '../data/enemies.js';

export const meta = { id: 'codex', title: '도감' };

let styleDone = false;
let tab = 'merc';                 // merc | pet | foe
let openTiers = { 1: true };      // 용병 탭(차수 보기): 연 차수
/* ★ 기본은 **계열 보기**다 — 계열 특성은 줄기 전체의 성질이라
 *   차수로 흘어 놓으면 볼 수가 없다 (제작자 요청). */
let mercView = 'line';           // line | tier
let openLines = {};              // 용병 탭(계열 보기): 연 계열
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
.cdx-badge { display:inline-block; padding:1px 7px; border-radius:999px; font-size:11px; font-weight:700;
  background:var(--bg-4); color:var(--gold); margin-right:6px; }
.cdx-trait-head { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.cdx-trait { border:1px solid var(--line-soft); border-left:3px solid var(--gold);
  border-radius:var(--radius); background:var(--bg-1); padding:8px 10px; }
.cdx-trait-br { border-left-color:var(--arcane); }
.cdx-trait-t { font-weight:700; font-size:12px; margin-bottom:4px; }
.cdx-trait-ul { margin:0; padding-left:16px; font-size:12px; color:var(--ink-dim); line-height:1.6; }
.cdx-skills { width:100%; margin-top:4px; border-top:1px solid var(--line-soft); padding-top:5px;
  display:flex; flex-direction:column; gap:4px; }
.cdx-sk-nm { font-size:11px; display:flex; gap:5px; align-items:baseline; flex-wrap:wrap; }
.cdx-sk-meta { color:var(--ink-faint); font-size:10px; }
.cdx-sk-desc { font-size:10px; color:var(--ink-faint); line-height:1.45; }
.cdx-grid { grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); }
@media (max-width: 767px) { .cdx-grid { grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); } .cdx-sub { font-size:12px; } }
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

const TIER_LABEL = { 1: '1차', 2: '2차', 3: '3차', 4: '4차' };

/* ─────────────────────────── 용병 ───────────────────────────
 *
 * ★ 제작자 요청: 「계열별 특징이랑 각 클래스별 스킬을 같이 넣어두면 좋을것같아」.
 *   그래서 기본 보기를 **계열**로 바꿨다 — 계열 특성은 «그 줄기 전체» 의 성질이라
 *   차수별로 흩어 놓으면 볼 수가 없다. 차수 보기도 남겨 뒀다.
 */

/** 계열 특성을 사람이 읽는 한 줄로 */
function traitLine(rootId) {
  const t = LINEAGE_TRAIT[rootId];
  if (!t) return null;
  const parts = [];
  if (t.guardChance) parts.push(`대신 맞기 ${Math.round(t.guardChance * 100)}% (피해 ${Math.round(t.guardCut * 100)}% 감소)`);
  if (t.taunt) parts.push('적 근접을 자기 쪽으로 끌어온다');
  if (t.riposte) parts.push(`맞으면 ${Math.round(t.riposte * 100)}% 되받아친다`);
  if (t.intercept) parts.push(`뒷줄로 오는 큰 한 방을 ${Math.round(t.intercept * 100)}% 확률로 쳐낸다`);
  if (t.interceptCounter) parts.push(`쳐내면 ${Math.round(t.interceptCounter * 100)}% 되받아친다`);
  if (t.chargeSlow) parts.push(`적 돌진 ${Math.round(t.chargeSlow * 100)}% 느리게`);
  if (t.shy) parts.push('적 근접이 다른 표적을 먼저 고른다');
  if (t.evaBonus) parts.push(`회피 +${t.evaBonus}`);
  if (t.wardShield) parts.push(`최대 체력 ${Math.round(t.wardShield * 100)}% 방패로 시작 (초당 ${Math.round((t.wardRegen || 0) * 100)}% 재생)`);
  if (t.deathWard) parts.push(`치명타를 ${t.deathWard}번 체력 1로 견딘다`);
  if (t.dmgCutAura) parts.push(`진영 전체 피해 ${Math.round(t.dmgCutAura * 100)}% 감소`);
  return { label: t.label, note: t.note, parts };
}

/** 2차 갈래 특성 (수도사 → 사제 / 수도승) */
function branchLine(id) {
  const t = BRANCH_TRAIT[id];
  if (!t) return null;
  const parts = [];
  if (t.deathWard) parts.push(`진영 전체가 치명타를 ${t.deathWard}번 체력 1로 견딘다`);
  if (t.dmgCutAura) parts.push(`진영 전체 피해 ${Math.round(t.dmgCutAura * 100)}% 감소`);
  return { label: t.label, note: t.note, parts };
}

/** 클래스 하나의 카드 — 스프라이트 · 이름 · 스킬 */
function mercCard(c) {
  const arch = ARCHETYPES && ARCHETYPES[c.arch];
  const card = el('div', { class: 'cdx-card' },
    stillSprite(mercRecipe({ classId: c.id }, {})),
    el('div', { class: 'cdx-nm', text: c.name }),
    el('div', { class: 'cdx-sub', text: `${TIER_LABEL[c.tier || 1]} · ${(arch && arch.name) || c.arch} · ${(c.equip || []).join('·') || '-'}` }));

  /* ★ 스킬 — id 만 들고 있으니 이름·설명은 여기서 찾는다.
   *   못 찾는 id 는 조용히 건너뛴다 (데이터가 앞서 나갈 수 있다). */
  const sk = (c.skills || []).map((s) => getSkill(s)).filter(Boolean);
  if (sk.length) {
    const box = el('div', { class: 'cdx-skills' });
    for (const s of sk) {
      const meta2 = [
        s.range === 'melee' ? '근접' : s.range === 'ranged' ? '원거리' : null,
        s.cd ? `재사용 ${s.cd}초` : null,
      ].filter(Boolean).join(' · ');
      box.appendChild(el('div', { class: 'cdx-sk' },
        el('div', { class: 'cdx-sk-nm' },
          el('b', { text: s.name || s.id }),
          meta2 ? el('span', { class: 'cdx-sk-meta', text: meta2 }) : null),
        s.desc ? el('div', { class: 'cdx-sk-desc', text: s.desc }) : null));
    }
    card.appendChild(box);
  }
  return card;
}

function mercTab(root) {
  const all = Object.values(CLASSES).filter((c) => c && c.id);

  /* ── 차수 보기 (예전 그대로) ── */
  if (mercView === 'tier') {
    const byTier = { 1: [], 2: [], 3: [], 4: [] };
    for (const c of all) (byTier[c.tier || 1] = byTier[c.tier || 1] || []).push(c);
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
        for (const c of list) grid.appendChild(mercCard(c));
        panel.appendChild(grid);
      }
      wrap.appendChild(panel);
    }
    return wrap;
  }

  /* ── 계열 보기 (기본) ── */
  const roots = all.filter((c) => (c.tier || 1) === 1);
  const wrap = el('div', { class: 'col', style: { gap: '12px' } });
  for (const r of roots) {
    const line = all.filter((c) => {
      const ch = classChain(c.id);
      return ch.length && ch[0].id === r.id;
    }).sort((a, b) => (a.tier || 1) - (b.tier || 1) || a.name.localeCompare(b.name, 'ko'));
    if (!line.length) continue;

    const open = !!openLines[r.id];
    const tr = traitLine(r.id);
    const panel = el('div', { class: 'panel col', style: { gap: '10px' } });
    panel.appendChild(el('div', {
      class: 'row spread center cdx-sec',
      onClick: () => { openLines[r.id] = !open; rerender(root); },
    },
      el('div', { class: 'col', style: { gap: '2px', minWidth: '0' } },
        el('h3', { text: `${r.name} 계열 — ${line.length}종` }),
        tr ? el('div', { class: 'cdx-trait-head' },
          el('span', { class: 'cdx-badge', text: tr.label }),
          el('span', { class: 'tiny faint', text: tr.note })) : null),
      el('span', { class: 'tiny faint', text: open ? '접기 ▴' : '펼치기 ▾' })));

    if (open) {
      if (tr && tr.parts.length) {
        panel.appendChild(el('div', { class: 'cdx-trait' },
          el('div', { class: 'cdx-trait-t', text: `계열 특성 — ${tr.label}` }),
          el('ul', { class: 'cdx-trait-ul' }, tr.parts.map((p) => el('li', { text: p }))),
          el('div', { class: 'tiny faint', text: '4차 기준. 차수가 낮으면 그만큼 약하다.' })));
      }
      /* 갈래가 갈리는 계열(수도사)은 갈래 특성도 같이 보여준다 */
      for (const c of line) {
        const b = branchLine(c.id);
        if (!b) continue;
        panel.appendChild(el('div', { class: 'cdx-trait cdx-trait-br' },
          el('div', { class: 'cdx-trait-t', text: `${c.name} 갈래 — ${b.label}` }),
          el('ul', { class: 'cdx-trait-ul' }, b.parts.map((p) => el('li', { text: p })))));
      }
      const grid = el('div', { class: 'cdx-grid' });
      for (const c of line) grid.appendChild(mercCard(c));
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
  /* ★ 용병 탭에만 «계열 / 차수» 보기 전환을 달아 둔다 */
  if (tab === 'merc') {
    root.appendChild(el('div', { class: 'row center wrap', style: { gap: '6px', marginBottom: '10px' } },
      el('span', { class: 'tiny faint', text: '보기' }),
      ...[['line', '계열별'], ['tier', '차수별']].map(([v, label]) => el('button', {
        class: `btn sm ${mercView === v ? 'primary' : 'ghost'}`,
        onClick: () => { mercView = v; rerender(root); },
      }, label))));
  }
  if (tab === 'merc') root.appendChild(mercTab(root));
  else if (tab === 'pet') root.appendChild(petTab());
  else root.appendChild(foeTab(root));
}
