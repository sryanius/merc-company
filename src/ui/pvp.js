// PvP — 순위표에서 상대를 지목해 도전한다
// 화면 모듈 계약: meta / render(root, params) / dispose()
//
// ★★ 승패는 **서버가 정한다.** 이 화면은 결과를 «받아 와서 보여주는» 것이지
//   계산해서 올리는 것이 아니다. 재생은 서버가 준 시드·편성으로 화면을 다시 그리는 것뿐이고,
//   재생 결과가 서버와 달라도 **서버 결과가 진실**이다 (그리고 그때 desync 를 남긴다).
//
// ★ 도전하려면 먼저 **내 부대를 등록**해야 한다. 등록한 편성이 곧 내 공격 편성이다 —
//   «약한 편성을 올려 두고 강한 편성으로 때리기» 를 구조적으로 막는다.
import { el, num } from '../core/util.js';
import { state, save } from '../game/state.js';
import { allyUnitDefs } from '../game/quest.js';
import { squadPower } from '../game/squad.js';
import * as Pvp from '../net/pvp.js';
import * as Auth from '../net/auth.js';
import { toast, go } from './app.js';

export const meta = { id: 'pvp', title: 'PvP' };

/** 도전 한 번의 골드 (제작자 결정) */
export const CHALLENGE_COST = 300_000;

let styleDone = false;
let boardCache = null;
let meCache = null;
let busy = false;
/* 방금 끝난 도전 — 화면을 다시 그릴 때 맨 위에 보여준다 */
let lastResult = null;

export function dispose() { /* rAF 없음 */ }

function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  document.head.appendChild(el('style', {
    text: `
.pv-row { display:grid; grid-template-columns: 42px 1fr auto auto; gap:8px; align-items:center;
  padding:7px 8px; border-bottom:1px solid var(--line-soft); }
.pv-row:last-child { border-bottom:0; }
.pv-rank { font-weight:700; text-align:right; color:var(--ink-faint); }
.pv-me { background:var(--bg-2); border-radius:var(--radius); }
.pv-rt { font-weight:700; min-width:52px; text-align:right; }
@media (max-width: 520px) { .pv-row { grid-template-columns: 34px 1fr auto; } .pv-pow { display:none; } }
`,
  }));
}

/* ── 내 편성을 서버가 쓸 모양으로 접는다 ───────────────────────────
 * ★ **실제 전투가 쓰는 `allyUnitDefs` 를 그대로 쓴다.**
 *   «전투에 나가는 유닛» 과 «순위표에 올리는 유닛» 이 다르면 그 자체가 구멍이다. */
function myLineup() {
  const squads = (state.squads || []).filter((sq) => (sq.memberUids || []).filter(Boolean).length);
  if (!squads.length) return null;
  const units = [];
  let power = 0;
  for (const sq of squads) {
    const defs = allyUnitDefs(state, sq);
    if (!defs.length) continue;
    units.push(defs);
    power += squadPower(state, sq.id) || 0;
  }
  return units.length ? { units, power } : null;
}

async function doRegister(afterEl) {
  if (busy) return;
  const lineup = myLineup();
  if (!lineup) { toast('먼저 부대를 편성해라', 'bad'); return; }
  busy = true;
  afterEl.textContent = '등록하는 중…';
  const res = await Pvp.registerDefense({
    companyName: state.companyName || '무명단',
    squads: lineup.units,
    power: Math.round(lineup.power),
    saveRev: state.rev,
  });
  busy = false;
  if (!res.ok) {
    /* ★ 서버가 «불가능한 값» 을 짚어 주면 그대로 보여준다 — 정상 플레이어가 고칠 수 있어야 한다 */
    const detail = res.data && Array.isArray(res.data.detail) ? res.data.detail.slice(0, 2).join(' / ') : '';
    afterEl.textContent = '';
    toast(`등록 실패: ${res.error || ''} ${detail}`.trim(), 'bad');
    return;
  }
  meCache = null;
  boardCache = null;
  afterEl.textContent = '';
  toast(`${lineup.units.length}개 부대를 등록했다`, 'good');
  go('pvp');
}

async function doChallenge(handle, name) {
  if (busy) return;
  if ((state.gold || 0) < CHALLENGE_COST) {
    toast(`골드가 모자란다 (${num(CHALLENGE_COST)} 필요)`, 'bad');
    return;
  }
  busy = true;
  toast(`${name} 에게 도전한다…`, 'good');

  /* ★ 도전 id 를 **먼저 만들어 둔다.** 응답을 못 받아도 같은 id 로 다시 부르면
   *   서버가 «저장된 결과» 를 그대로 준다 — 골드만 날리고 결과를 잃는 일이 없다. */
  const challengeId = Pvp.newChallengeId();

  const res = await Pvp.challenge(handle, challengeId);
  busy = false;
  if (!res.ok) {
    toast(res.data?.error || res.error || '도전 실패', 'bad');
    return;
  }

  /* ★ 골드는 **성공했을 때만** 깎는다. 서버가 거절했는데 골드를 먹으면 안 된다.
   *   (서버는 골드를 모른다 — 이건 클라이언트의 정직성에 기댄 부분이다. §70.2 에 적어 두었다.) */
  state.gold = Math.max(0, (state.gold || 0) - CHALLENGE_COST);
  save();

  meCache = null;
  boardCache = null;
  lastResult = { ...(res.data || {}), opponentName: name };
  go('pvp');
}

/* ── 화면 ─────────────────────────────────────────────────── */

function meRow() {
  const box = el('div', { class: 'panel col', style: { gap: '8px' } });
  const body = el('div', { class: 'tiny faint', text: '불러오는 중…' });
  const status = el('span', { class: 'tiny faint' });

  box.appendChild(el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
    el('h3', { text: 'PvP', style: { margin: '0' } }),
    el('div', { class: 'row center', style: { gap: '6px' } },
      status,
      el('button', {
        class: 'btn sm',
        title: '지금 편성을 방어 부대로 등록한다 (이 편성이 곧 내 공격 편성이다)',
        onClick: () => doRegister(status),
      }, '내 부대 등록'))));
  box.appendChild(body);

  (async () => {
    if (!Auth.signedIn || !Auth.signedIn()) {
      body.textContent = '로그인하면 PvP 에 참여할 수 있다.';
      return;
    }
    const res = meCache || await Pvp.me();
    if (res.ok) meCache = res;
    const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
    if (!row) {
      body.textContent = '아직 등록하지 않았다. «내 부대 등록» 을 눌러라.';
      return;
    }
    body.textContent = '';
    body.appendChild(el('div', { class: 'row wrap', style: { gap: '14px' } },
      el('span', {}, `승점 ${num(row.rating)}`),
      el('span', { class: 'faint' }, `${row.rank}위`),
      el('span', { class: 'faint' }, `${row.wins}승 ${row.losses}패`),
      el('span', { class: 'faint' }, `전력 ${num(row.power || 0)}`)));
  })();

  return box;
}

function boardPanel() {
  const list = el('div', { class: 'col', style: { gap: '0' } },
    el('div', { class: 'faint tiny', text: '불러오는 중…' }));

  (async () => {
    const res = boardCache || await Pvp.board(100);
    if (res.ok) boardCache = res;
    if (!res.ok) { list.textContent = '순위를 불러오지 못했다.'; return; }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) { list.textContent = '아직 등록한 사람이 없다. 첫 번째가 되어라.'; return; }

    const myHandle = meCache && Array.isArray(meCache.data) && meCache.data[0]
      ? meCache.data[0].handle : null;

    list.textContent = '';
    for (const r of rows) {
      const mine = myHandle && r.handle === myHandle;
      list.appendChild(el('div', { class: `pv-row${mine ? ' pv-me' : ''}` },
        el('div', { class: 'pv-rank', text: String(r.rank) }),
        el('div', { class: 'col', style: { gap: '1px', minWidth: '0' } },
          el('b', { style: { fontSize: '13px' }, text: r.company_name }),
          el('div', { class: 'tiny faint', text: `${r.wins}승 ${r.losses}패` })),
        el('div', { class: 'pv-rt', text: num(r.rating) }),
        mine
          ? el('span', { class: 'tiny faint', text: '나' })
          : el('button', {
            class: 'btn sm ghost',
            title: `${num(CHALLENGE_COST)} 골드를 쓴다`,
            onClick: () => doChallenge(r.handle, r.company_name),
          }, '도전')));
    }
  })();

  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('div', { class: 'row spread center' },
      el('h3', { text: 'PvP 순위', style: { margin: '0' } }),
      el('span', { class: 'tiny faint', text: `도전 ${num(CHALLENGE_COST)}골드` })),
    list);
}

function notePanel() {
  return el('div', { class: 'panel col', style: { gap: '6px' } },
    el('h3', { text: 'PvP 에 대해' }),
    el('div', { class: 'tiny faint', text: '· 등록한 편성이 방어에도 공격에도 쓰인다. 부대 순서대로 태그매치로 싸운다.' }),
    el('div', { class: 'tiny faint', text: '· 이긴 부대는 회복 없이 다음 부대와 이어서 싸운다.' }),
    el('div', { class: 'tiny faint', text: '· 승패는 서버가 계산한다. 같은 상대에게는 10초 뒤에 다시 도전할 수 있다.' }),
    el('div', { class: 'tiny faint', text: '· 승점은 상대와의 점수 차를 반영한다 — 약한 상대를 이겨도 조금밖에 안 오른다.' }),
    el('div', { class: 'tiny faint', text: '· 내가 공격한 판도, 당한 판도 전적에서 다시 볼 수 있다.' }));
}

function resultPanel() {
  const d = lastResult;
  if (!d) return null;
  const iWon = d.winner === 'attacker';
  const sign = d.delta > 0 ? '+' : '';
  const rows = Array.isArray(d.roundLog) ? d.roundLog : [];

  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
      el('h3', { style: { margin: '0' } }, `${d.opponentName} 전 — ${iWon ? '승리' : (d.winner === 'draw' ? '무승부' : '패배')}`),
      el('button', { class: 'btn sm ghost', onClick: () => { lastResult = null; go('pvp'); } }, '닫기')),
    el('div', { class: 'row wrap', style: { gap: '14px' } },
      el('b', { style: { color: d.delta >= 0 ? 'var(--leaf)' : 'var(--ink-faint)' } }, `승점 ${sign}${d.delta}`),
      el('span', { class: 'faint' }, `현재 ${num(d.rating)}`),
      el('span', { class: 'faint' }, `${d.rounds}합`)),
    /* ★ 합별 기록 — 태그매치가 어떻게 흘렀는지 보여준다.
     *   (애니메이션 재생은 아직 없다. 서버가 시드와 편성을 주므로 붙일 수 있다 — 다음 단계) */
    rows.length
      ? el('div', { class: 'col', style: { gap: '0' } },
        ...rows.map((r, i) => el('div', { class: 'pv-row' },
          el('div', { class: 'pv-rank', text: `${i + 1}합` }),
          el('div', { class: 'tiny' }, `내 ${r.attackerSquad + 1}부대 vs 상대 ${r.defenderSquad + 1}부대`),
          el('div', { class: 'tiny', style: { color: r.winner === 'attacker' ? 'var(--leaf)' : 'var(--ink-faint)' } },
            r.winner === 'attacker' ? '승' : (r.winner === 'draw' ? '무' : '패')),
          el('div', { class: 'tiny faint', text: `${r.attackerLeft}:${r.defenderLeft} 생존` }))))
      : null);
}

export function render(root) {
  injectStyle();
  root.appendChild(el('div', { class: 'col', style: { gap: '12px' } },
    resultPanel(),
    meRow(),
    boardPanel(),
    historyPanel(),
    notePanel()));
}

function historyPanel() {
  const list = el('div', { class: 'col', style: { gap: '0' } },
    el('div', { class: 'faint tiny', text: '불러오는 중…' }));

  (async () => {
    if (!Auth.signedIn || !Auth.signedIn()) { list.textContent = '로그인이 필요하다.'; return; }
    const res = await Pvp.history(20);
    if (!res.ok) { list.textContent = '전적을 불러오지 못했다.'; return; }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) { list.textContent = '아직 전적이 없다.'; return; }
    list.textContent = '';
    for (const r of rows) {
      const iWon = (r.role === 'attacker' && r.winner === 'attacker')
        || (r.role === 'defender' && r.winner === 'defender');
      const sign = r.delta > 0 ? '+' : '';
      list.appendChild(el('div', { class: 'pv-row' },
        el('div', { class: 'pv-rank', text: r.role === 'attacker' ? '공' : '방' }),
        el('div', { class: 'col', style: { gap: '1px', minWidth: '0' } },
          el('b', { style: { fontSize: '13px' }, text: r.opponent }),
          el('div', { class: 'tiny faint', text: iWon ? '승리' : (r.winner === 'draw' ? '무승부' : '패배') })),
        el('div', { class: 'pv-rt', style: { color: r.delta >= 0 ? 'var(--leaf)' : 'var(--ink-faint)' },
          text: `${sign}${r.delta}` }),
        el('span', { class: 'tiny faint', text: `${r.rating_after}` })));
    }
  })();

  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('h3', { text: '내 전적', style: { margin: '0' } }),
    list);
}
