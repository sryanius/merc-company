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
import { getClass } from '../data/classes.js';
import { getFormation } from '../data/formations.js';
import { getSet } from '../data/sets.js';
import { GRADE_COLOR } from '../art/palette.js';
import { go, toast, modal } from './app.js';

export function dispose() {
  /* rAF·타이머 없음. 캐시만 버린다 — 다음에 들어올 땐 새로 받아야 한다 (위 주석 참고). */
  cache = null;
}

/** 부문 — 각각 성격이 다르다 (아래 설명 참고) */
const KINDS = [
  { id: 'abyss', label: ABYSS_NAME, unit: '심층', desc: '비용이 안 드는 순수 전력 싸움. 부대가 세면 깊이 내려간다.' },
  { id: 'tower', label: '무한의 탑', unit: '층', desc: '월 1회 · 골드를 태워야 오른다. 명예의 전당에 가깝다.' },
  { id: 'quests', label: '완료 의뢰', unit: '건', desc: '꾸준함의 기록. 전력과는 다른 축이다.' },
  /* ★ 아래 둘은 **본인 신고값**이다 (전력은 장비·진형 보정까지 들어가서 서버가 다시 계산하려면
   *   게임 전체가 서버로 딸려 온다). 상한만 rules.js 가 건다 — «검증됨» 이라고 쓰면 안 된다. */
  { id: 'smercs', label: 'S 용병', unit: '명', desc: '주점에서 뽑은 S 등급이 몇이나 되나. 평판과 운의 기록이다.' },
  { id: 'power', label: '부대 전력', unit: '', desc: '가장 센 부대 하나의 전력. 장비·진형까지 반영된 값이다.' },
];

let kind = 'abyss';
/* 순위표 캐시.
 * ★★ **화면을 떠날 때 버린다.** 예전에는 모듈 수명 내내 살아 있어서,
 *   나락을 등반해 제출까지 끝난 뒤에 순위표를 열어도 **옛 목록이 그대로** 보였다
 *   (제작자: «나락만 등반했을 땐 안 보이고 날짜 넘기니 보인다»).
 *   목록은 30KB 라 들어올 때마다 받아도 부담이 없다 — 캐시는 «같은 화면 안의
 *   다시 그리기» 를 위한 것이지 «다음 방문» 을 위한 게 아니다. */
let cache = null;

const CSS = `
.rk-tabs { display:flex; gap:6px; flex-wrap:wrap; }
.rk-more { margin-top:4px; display:block; margin-left:auto; }
.rk-pw { font-size:11px; color:var(--gold); border:1px solid color-mix(in srgb, var(--gold) 40%, transparent);
  border-radius:999px; padding:1px 7px; white-space:nowrap; }
.rk-row { display:grid; grid-template-columns:38px 1fr auto; gap:10px; align-items:center;
  padding:7px 8px; border-radius:6px; }
.rk-row + .rk-row { border-top:1px solid rgba(255,255,255,.05); }
.rk-clickable { cursor:pointer; }
.rk-clickable:hover { background:rgba(255,255,255,.05); }
.rk-sqbox { border:1px solid var(--line-soft); border-radius:6px; padding:8px 10px; }
.rk-sqgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:6px 10px; margin-top:6px; }
.rk-sqmem { font-size:12px; line-height:1.35; }
@media (max-width: 767px) { .rk-sqgrid { grid-template-columns:1fr 1fr; } }
.rk-squad { display:flex; flex-wrap:wrap; gap:3px 6px; margin-top:3px; }
.rk-mem { font-size:10.5px; white-space:nowrap; }
.rk-mem i { font-style:normal; opacity:.55; }
@media (max-width: 767px) { .rk-mem { font-size:12px; } }
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
    // ★ '도시로' 버튼은 뺐다 — 이제 하단 탭에 걸려 있어서 아무 때나 돌아갈 수 있다.
    el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
      el('h3', { text: '순위표', style: { margin: '0' } }),
      /* ★ PvP 진입점 — 제작자 요청대로 «순위표에서 상대를 지정» 한다.
       *   하단 탭에는 안 건다 (8칸이 실측 한계다 — §53.4). */
      el('button', { class: 'btn sm', onClick: () => go('pvp') }, '⚔️ PvP')),
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
      class: `rk-row rk-clickable${rank <= 3 ? ` top${rank}` : ''}${mine ? ' me' : ''}`,
      role: 'button',
      tabindex: '0',
      title: '눌러서 이 용병단의 모든 부대 보기',
      onClick: () => openSquads(kind, rank, r.company_name),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSquads(kind, rank, r.company_name); } },
    },
      el('div', { class: 'rk-no', text: String(rank) }),
      el('div', { class: 'col', style: { gap: '1px', minWidth: '0' } },
        el('div', { class: 'rk-nm', text: r.company_name || '이름 없음' }),
        el('div', { class: 'rk-sub' },
          `${num(r.day)}일차`,
          /* ★ 도시 등급은 **여기서 직접 찾는다.** 서버의 city_tier 는 비어 있다 —
           *   검증 규칙(rules.js)이 의존성 0 모듈만 쓸 수 있어서 world.js 를 못 물기 때문이다.
           *   클라이언트는 어차피 도시 데이터를 다 갖고 있으니 여기서 푸는 게 맞다. */
          city ? ` · ${city.name} ★${city.tier || r.city_tier || '?'}` : '',
          r.top_level ? ` · 최고 Lv${r.top_level}` : '',
          r.roster_n ? ` · 단원 ${r.roster_n}` : '',
          /* 지금 보는 축은 오른쪽 큰 숫자로 이미 보인다 — 부제에 또 쓰면 군더더기다. */
          kind !== 'smercs' && r.s_mercs ? ` · S ${r.s_mercs}명` : '',
          kind !== 'power' && r.top_power ? ` · 전력 ${num(r.top_power)}` : ''),
        squadLine(r.squad)),
      el('div', { class: 'rk-val' },
        `${num(r.value)}${unit}`,
        kind === 'abyss' && r.value ? el('div', { class: 'rk-sub', style: { textAlign: 'right' }, text: zoneOf(r.value) }) : null,
        /* ★★ 줄 전체가 눌리긴 하지만 **그걸 아무도 몰랐다** (제작자: «아이디 눌러야 나오는 게 안 보여서»).
         *   숨은 조작은 없는 기능과 같다. 눈에 보이는 버튼을 단다.
         *   줄 클릭도 그대로 둔다 — 익숙해진 사람이 쓰던 길을 뺏을 이유가 없다. */
        el('button', {
          class: 'btn xs rk-more',
          onClick: (ev) => { ev.stopPropagation(); openSquads(kind, rank, r.company_name); },
        }, '상세보기'))));
  }
}

/**
 * 그 사람의 **대표 부대** 한 줄.
 *
 * ★ 순위표에 이걸 붙이는 이유 — 숫자만 보면 «어떻게 저기까지 갔지» 를 알 수 없다.
 *   편성을 보면 배울 게 생기고, 그게 경쟁을 굴린다.
 *
 * ★ 이건 **본인이 신고한 값**이다. 서버가 편성을 검증하지는 않는다 (점수와 같다).
 *   그래서 «검증됨» 같은 말을 붙이면 안 된다 — 그냥 보여 준다.
 *
 * ★ 클래스 id 만 오므로 이름은 여기서 찾는다. 모르는 id 는 조용히 건너뛴다
 *   (구버전 클라이언트가 올린 값이거나 삭제된 클래스일 수 있다).
 */
function squadLine(squad) {
  const mems = squad && Array.isArray(squad.members) ? squad.members : [];
  if (!mems.length) return null;

  const row = el('div', { class: 'rk-squad' });
  for (const m of mems) {
    const cls = m && m.c ? getClass(m.c) : null;
    if (!cls) continue;
    /* ★ 제작자 요청: 「클래스명 대신 내 용병 이름으로. **용병이름 (클래스)**」.
     *   옛 세이브에서 온 스냅샷에는 이름(nm)이 없다 — 그때는 클래스명만 쓴다. */
    row.appendChild(el('span', {
      class: 'rk-mem',
      style: { color: GRADE_COLOR[m.g] || 'var(--ink-dim)' },
      title: `${m.nm ? `${m.nm} · ` : ''}${cls.name} · ${m.g || '?'}등급 · Lv${m.l || 1}`,
    }, m.nm || cls.name,
    m.nm ? el('i', { text: ` (${cls.name})` }) : null,
    el('i', { text: ` ${m.g || ''}${m.l || ''}` })));
  }
  if (!row.childNodes.length) return null;
  return row;
}

/**
 * 그 순위의 **모든 부대** 를 띄운다.
 *
 * ★ 목록에는 대표 부대 요약만 실려 있다 (§40). 전 부대 상세는 1인당 ~2KB 라
 *   200행에 실으면 400KB 가 된다 — **누를 때만** 따로 받는다.
 * ★ 서버가 `user_id` 를 안 주므로 **순위**로 찾는다. 목록과 같은 정렬이라 같은 사람이다.
 */
async function openSquads(kind, rank, name) {
  const body = el('div', { class: 'col', style: { gap: '10px', minWidth: 'min(520px, 86vw)' } },
    el('div', { class: 'faint tiny', text: '불러오는 중…' }));
  modal({ title: `${name || '용병단'} — 부대 편성`, body, wide: true, actions: [{ label: '닫기', kind: 'ghost' }] });

  let res = null;
  try { res = await Cloud.squadsAt(kind, rank); } catch (e) { res = null; }
  if (!body.isConnected) return;
  body.innerHTML = '';

  const squads = res && res.ok ? res.squads : null;
  if (!Array.isArray(squads) || !squads.length) {
    body.appendChild(el('div', { class: 'muted tiny' },
      res && res.ok
        ? '아직 부대 정보가 올라오지 않았다. 그 사람이 다음에 기록을 올릴 때 채워진다.'
        : '부대 정보를 불러오지 못했다.'));
    return;
  }

  /* ★ «본인이 신고한 값» 이라는 걸 화면에 남긴다 — 서버가 편성을 검증하지는 않는다 (§40.2). */
  body.appendChild(el('div', { class: 'faint tiny', text: '본인이 올린 기록이다 — 서버가 편성을 검증하지는 않는다.' }));

  for (const sq of squads) {
    const f = sq.f ? getFormation(sq.f) : null;
    /* ★ 부대 전력. 옛 제출에는 없다 (`stampSquadPower` 를 넣기 전 기록) — 없으면 그냥 뺀다.
     *   «0» 으로 보여 주면 «전력이 0인 부대» 로 읽혀서 더 나쁘다. */
    const power = Number(sq.p) || 0;
    const box = el('div', { class: 'rk-sqbox' },
      el('div', { class: 'row spread center', style: { gap: '8px' } },
        el('div', { class: 'row center', style: { gap: '8px' } },
          el('b', { text: sq.n || '부대' }),
          power ? el('span', { class: 'rk-pw', text: `전력 ${num(power)}` }) : null),
        el('span', { class: 'faint tiny', text: `${f ? f.name : sq.f || '기본진'} · ${(sq.m || []).length}명` })));
    const grid = el('div', { class: 'rk-sqgrid' });
    for (const m of sq.m || []) {
      const cls = m && m.c ? getClass(m.c) : null;
      if (!cls) continue;
      const sets = Array.isArray(m.s) ? m.s.map((v) => {
        const [id, n] = String(v).split(':');
        const set = getSet ? getSet(id) : null;
        return `${set?.name || id} ${n}`;
      }) : [];
      grid.appendChild(el('div', { class: 'rk-sqmem' },
        el('div', {},
          el('b', { style: { color: GRADE_COLOR[m.g] || 'var(--ink)' }, text: m.nm || cls.name }),
          m.nm ? el('span', { class: 'faint', text: ` (${cls.name})` }) : null,
          el('span', { class: 'faint', text: ` ${m.g || ''}${m.l || ''}` })),
        el('div', { class: 'faint tiny' },
          m.e ? `장비 ${m.e}칸` : '장비 없음',
          sets.length ? ` · ${sets.join(' · ')}` : '')));
    }
    box.appendChild(grid);
    body.appendChild(box);
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
