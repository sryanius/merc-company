/**
 * 순위표 화면
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ **읽기 전용이다.** 이 화면은 아무것도 제출하지 않는다.
 *   제출은 기록이 오를 때 `net/cloud.js` 가 알아서 한다.
 *
 * ★ 로그인 없이도 보인다. 순위표는 남에게 보여 주려고 만드는 것이고,
 *   `leaderboard()` RPC 는 user_id·seed 를 내보내지 않는다.
 *   클라우드를 안 켠 사람도 "저 위엔 어떤 사람들이 있나"를 볼 수 있어야 한다.
 *
 * @module ui/rank
 */

import { el, num } from '../core/util.js';
import { state } from '../game/state.js';
import * as Cloud from '../net/cloud.js';
import { ABYSS_NAME, zoneOf } from '../data/abyss.js';
import { getCity } from '../data/world.js';
import { go, toast } from './app.js';

export function dispose() { /* rAF·타이머 없음 */ }

/** 부문 — 각각 성격이 다르다 (아래 설명 참고) */
const KINDS = [
  { id: 'abyss', label: ABYSS_NAME, unit: '심층', desc: '비용이 안 드는 순수 전력 싸움. 부대가 세면 깊이 내려간다.' },
  { id: 'tower', label: '무한의 탑', unit: '층', desc: '월 1회 · 골드를 태워야 오른다. 명예의 전당에 가깝다.' },
  { id: 'quests', label: '완료 의뢰', unit: '건', desc: '꾸준함의 기록. 전력과는 다른 축이다.' },
];

let kind = 'abyss';
let cache = null;

const CSS = `
.rk-tabs { display:flex; gap:6px; flex-wrap:wrap; }
.rk-row { display:grid; grid-template-columns:38px 1fr auto; gap:10px; align-items:center;
  padding:7px 8px; border-radius:6px; }
.rk-row + .rk-row { border-top:1px solid rgba(255,255,255,.05); }
.rk-row.me { background:rgba(224,180,74,.13); }
.rk-no { font-variant-numeric:tabular-nums; font-weight:800; color:var(--ink-faint); text-align:right; }
.rk-row.top1 .rk-no { color:#f0c05a; }
.rk-row.top2 .rk-no { color:#cfd3dc; }
.rk-row.top3 .rk-no { color:#c98a5b; }
.rk-nm { font-weight:700; }
.rk-sub { font-size:11px; color:var(--ink-faint); }
.rk-val { font-variant-numeric:tabular-nums; font-weight:800; color:var(--gold); white-space:nowrap; }
@media (max-width: 767px) {
  .rk-sub { font-size:12px; }
  .rk-row { grid-template-columns:32px 1fr auto; }
}
`;
function injectStyle() {
  if (document.getElementById('rank-style')) return;
  document.head.appendChild(el('style', { id: 'rank-style', text: CSS }));
}

export function render(root, params = {}) {
  injectStyle();
  if (params.kind && KINDS.some((k) => k.id === params.kind)) kind = params.kind;

  const list = el('div', { class: 'col', style: { gap: '2px' } },
    el('div', { class: 'faint tiny', text: '불러오는 중…' }));

  root.appendChild(el('div', { class: 'col', style: { gap: '12px' } },
    header(),
    el('div', { class: 'panel col', style: { gap: '10px' } },
      el('div', { class: 'rk-tabs' }, ...KINDS.map((k) => el('button', {
        class: `btn sm ${k.id === kind ? '' : 'ghost'}`,
        onClick: () => { kind = k.id; cache = null; go('rank', { kind: k.id }); },
      }, k.label))),
      el('div', { class: 'muted tiny', text: KINDS.find((k) => k.id === kind).desc }),
      list),
    minePanel(),
    notePanel(),
  ));

  load(list);
}

function header() {
  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('div', { class: 'row spread center', style: { flexWrap: 'wrap', gap: '8px' } },
      el('h3', { text: '순위표', style: { margin: '0' } }),
      el('button', { class: 'btn sm', onClick: () => go('city') }, '도시로')),
    el('div', { class: 'faint tiny', text: '기록이 오르면 자동으로 올라간다. 따로 제출할 필요는 없다.' }));
}

async function load(list) {
  const res = cache || await Cloud.leaderboard(kind, 100);
  cache = res;
  list.innerHTML = '';

  if (!res.ok) {
    list.appendChild(el('div', { class: 'faint tiny', text: `순위표를 불러오지 못했다 — ${res.error}` }));
    return;
  }
  if (!res.rows.length) {
    list.appendChild(el('div', { class: 'faint tiny', text: '아직 아무도 기록을 올리지 않았다. 첫 번째가 될 수 있다.' }));
    return;
  }

  const me = (state.companyName || '').trim();
  const unit = KINDS.find((k) => k.id === kind).unit;

  for (const r of res.rows) {
    const rank = Number(r.rank) || 0;
    const city = r.city_id ? getCity(r.city_id) : null;
    // ★ 이름만으로 "나"를 표시한다 — 서버가 user_id 를 안 내보내기 때문이다(의도).
    //   동명이인이면 둘 다 표시되지만, 남의 계정을 알아낼 수 없는 쪽이 낫다.
    const mine = me && r.company_name === me;
    list.appendChild(el('div', {
      class: `rk-row${rank <= 3 ? ` top${rank}` : ''}${mine ? ' me' : ''}`,
    },
      el('div', { class: 'rk-no', text: String(rank) }),
      el('div', { class: 'col', style: { gap: '1px', minWidth: '0' } },
        el('div', { class: 'rk-nm', text: r.company_name || '이름 없음' }),
        el('div', { class: 'rk-sub' },
          `${num(r.day)}일차`,
          city ? ` · ${city.name} ★${r.city_tier || city.tier}` : '',
          r.top_level ? ` · 최고 Lv${r.top_level}` : '',
          r.roster_n ? ` · 단원 ${r.roster_n}` : '')),
      el('div', { class: 'rk-val' },
        `${num(r.value)}${unit}`,
        kind === 'abyss' && r.value ? el('div', { class: 'rk-sub', style: { textAlign: 'right' }, text: zoneOf(r.value) }) : null)));
  }
}

/** 내 기록 — 서버에 마지막으로 올라간 값 */
function minePanel() {
  const sub = Cloud.mySubmitted();
  const abyss = state.abyss?.best || 0;
  const tower = state.tower?.best || 0;
  const quests = state.stats?.questsDone || 0;

  const line = (k, now, sent) => el('div', { class: 'row spread', style: { gap: '10px' } },
    el('span', { class: 'muted tiny', text: k }),
    el('span', { class: 'tiny' },
      el('b', { text: num(now) }),
      // 아직 안 올라간 기록이 있으면 그렇게 말한다 — 조용히 다르면 버그로 보인다
      sent != null && sent < now ? el('span', { class: 'faint', text: ` (올린 값 ${num(sent)})` }) : null));

  return el('div', { class: 'panel col', style: { gap: '6px' } },
    el('h3', { text: '내 기록' }),
    line(ABYSS_NAME, abyss, sub?.abyss),
    line('무한의 탑', tower, sub?.tower),
    line('완료 의뢰', quests, sub?.quests),
    Cloud.ready()
      ? el('button', {
        class: 'btn sm ghost', style: { alignSelf: 'flex-start' },
        onClick: async (ev) => {
          const b = ev.currentTarget;
          b.disabled = true; b.textContent = '올리는 중…';
          const r = await Cloud.submitScore({ force: true });
          b.disabled = false; b.textContent = '지금 올리기';
          if (r.ok) { cache = null; toast('기록을 올렸습니다.', 'good'); go('rank', { kind }); }
          else toast(r.error || '올리지 못했습니다.', 'bad');
        },
      }, '지금 올리기')
      : el('div', { class: 'faint tiny', text: '클라우드를 켜면 기록이 순위표에 올라간다.' }));
}

function notePanel() {
  return el('div', { class: 'panel col', style: { gap: '6px' } },
    el('h3', { text: '순위표에 대해' }),
    el('div', { class: 'faint tiny', text: '· 기록은 잠수·등반을 마쳤을 때 자동으로 올라간다.' }),
    el('div', { class: 'faint tiny', text: `· ${ABYSS_NAME}은 비용이 안 드는 순수 전력 싸움이고, 무한의 탑은 골드를 태워야 오른다.` }),
    el('div', { class: 'faint tiny', text: '· 동점이면 더 적은 일수로 도달한 쪽이 위다.' }),
    el('div', { class: 'faint tiny', text: '· 서버가 게임 규칙으로 값을 확인한다 — 나락은 주 1회, 탑은 월 1회라 오를 수 있는 속도가 정해져 있다.' }));
}
