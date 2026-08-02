/**
 * 무한의 탑 화면
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 이 화면은 전투 화면(`ui/battle.js`)을 **자동 진행에 쓰지 않는다.**
 *   거기에는 자동 진행 경로가 의도적으로 없고(플레이어가 요청한 계약),
 *   `fastForward()` 에는 12웨이브 하드 캡이 있어 13층에서 런 전체가 조용히 패배 처리된다.
 *   그래서 등반은 `game/tower.js` 의 헤드리스 시뮬로 돌리고 층별 결과를 로그로 보여 준다.
 *   "이 층은 직접 보고 싶다"는 경우에만 전투 화면으로 한 층을 띄운다.
 *
 * @module ui/tower
 */

import { el, num } from '../core/util.js';
import { state, save } from '../game/state.js';
import * as Tower from '../game/tower.js';
import * as Pet from '../game/pet.js';
import { getPetSpecies } from '../data/pets.js';
import { TOWER_FLOORS, zoneOf, floorPower, floorEnemyCount, SWEEP_BACKOFF, REST_EVERY } from '../data/tower.js';
import { go, refresh, toast } from './app.js';

/** 마지막 등반 결과 — 화면을 나갔다 와도 남는다 */
let lastRun = null;

export function dispose() { /* rAF·타이머 없음 */ }

/* ─────────────────────────── CSS ─────────────────────────── */

const CSS = `
.tw-head { display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
.tw-big { font-size:34px; font-weight:800; color:var(--gold); font-variant-numeric:tabular-nums; line-height:1; }
.tw-bar { height:10px; border-radius:5px; background:rgba(255,255,255,.07); overflow:hidden; }
.tw-bar i { display:block; height:100%; background:linear-gradient(90deg,#8b6f2e,#e0b44a); }
.tw-log { max-height:340px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;
          background:rgba(0,0,0,.22); border-radius:8px; padding:8px; }
.tw-row { display:flex; gap:8px; align-items:baseline; font-size:12px; line-height:1.45; }
.tw-row .f { color:var(--ink-faint); font-variant-numeric:tabular-nums; min-width:52px; }
.tw-row.drop { color:#ffd9a8; }
.tw-row.rest { color:#8fd3a6; }
.tw-row.lose { color:#ef8a7a; }
.tw-row.broke { color:#e8c27a; }
.tw-row.sweep { color:var(--ink-dim); }
.tw-zone { display:flex; gap:6px; flex-wrap:wrap; }
.tw-zone span { font-size:11px; padding:2px 8px; border-radius:99px; background:rgba(255,255,255,.06); color:var(--ink-dim); }
.tw-zone span.on { background:rgba(224,180,74,.18); color:var(--gold); }
@media (max-width: 767px) {
  .tw-big { font-size:28px; }
  .tw-log { max-height:260px; }
  /* 폰에서는 11px 이 안 읽힌다 — 프로젝트 하한(12px)까지 올린다 */
  .tw-zone span { font-size:12px; }
  .tw-row { font-size:12px; }
}
`;
function injectStyle() {
  if (document.getElementById('tower-style')) return;
  document.head.appendChild(el('style', { id: 'tower-style', text: CSS }));
}

/* ─────────────────────────── 화면 ─────────────────────────── */

export function render(root, params = {}) {
  injectStyle();
  const st = state;
  const best = st.tower?.best || 0;
  const entry = Tower.canEnter(st);
  const preview = Tower.costPreview(st);

  root.appendChild(el('div', { class: 'col', style: { gap: '12px' } },
    header(best, entry),
    runPanel(st, entry, preview),
    lastRun ? resultPanel(lastRun) : null,
    rulesPanel(),
  ));
}

function header(best, entry) {
  const pct = Math.round((best / TOWER_FLOORS) * 100);
  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('div', { class: 'row spread center', style: { gap: '10px', flexWrap: 'wrap' } },
      el('div', { class: 'tw-head' },
        el('div', { class: 'tw-big', text: best ? `${best}층` : '미등반' }),
        el('div', { class: 'col', style: { gap: '2px' } },
          el('div', { style: { fontWeight: '700' }, text: '무한의 탑' }),
          el('div', { class: 'faint tiny', text: best ? `${zoneOf(best)} · 최고 기록` : '아직 오른 적이 없다' }))),
      el('button', { class: 'btn sm', onClick: () => go('world') }, '월드맵으로')),
    el('div', { class: 'tw-bar' }, el('i', { style: { width: `${pct}%` } })),
    el('div', { class: 'tw-zone' },
      ...[100, 200, 300, 400, 500].map((f) =>
        el('span', { class: best >= f ? 'on' : '', text: `${zoneOf(f)} ${f}` }))),
    entry.ok
      ? el('div', { class: 'wm-ev good tiny', text: '오늘 탑이 열려 있다.' })
      : el('div', { class: 'wm-ev bad tiny', text: entry.reason }));
}

function runPanel(st, entry, preview) {
  const squads = (st.squads || []).filter((s) => s.status !== 'away');
  const gold = st.gold || 0;

  const rows = squads.map((sq) => {
    const pets = Pet.squadPets(st, sq);
    const members = (sq.memberUids || []).filter(Boolean).length;
    return el('div', { class: 'row spread center wm-nb', style: { gap: '10px' } },
      el('div', { class: 'grow col', style: { gap: '2px' } },
        el('div', { style: { fontWeight: '600' }, text: sq.name },
          el('span', { class: 'faint tiny', text: ` 단원 ${members}명` })),
        el('div', { class: 'faint tiny', text: pets.length ? `펫 ${pets.map((p) => Pet.petLabel(p)).join(' · ')}` : '펫 없음' })),
      el('button', {
        class: 'btn sm wm-go',
        disabled: !entry.ok || members === 0,
        onClick: () => doClimb(sq.id),
      }, '등반 시작'));
  });

  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('h3', { text: '등반' }),
    el('div', { class: 'muted tiny' },
      preview.sweepTo >= 1
        ? `최고 기록 −${SWEEP_BACKOFF}층이라 ${preview.sweepTo}층까지는 전투 없이 소탕한다 (${num(preview.sweep)}G). ${preview.nextFloor}층부터 실제로 싸운다.`
        : `1층부터 오른다. 최고 기록이 ${SWEEP_BACKOFF}층을 넘으면 그 아래는 소탕으로 건너뛴다.`),
    el('div', { class: 'faint tiny' },
      `층당 ${num(2)}G × 층수 · 보유 ${num(gold)}G — 골드가 떨어지면 그 층에서 멈춘다.`),
    rows.length ? el('div', { class: 'col', style: { gap: '8px' } }, rows)
      : el('div', { class: 'faint tiny', text: '출전할 수 있는 부대가 없다.' }));
}

function resultPanel(run) {
  const rows = run.log.map((e) => {
    switch (e.type) {
      case 'sweep':
        return row('sweep', `${e.from}~${e.to}`, `소탕으로 지나갔다 (−${num(e.cost)}G)`);
      case 'rest':
        return row('rest', `${e.floor}층`, '숨을 돌렸다 — 전원 회복');
      case 'drop':
        return row('drop', `${e.floor}층`, `${Pet.petLabel(e.pet)} 을(를) 얻었다!`);
      case 'lose':
        return row('lose', `${e.floor}층`, '밀려났다. 여기서 등반이 끝났다.');
      case 'broke':
        return row('broke', `${e.floor}층`, `골드가 모자라 더 못 올라갔다 (${num(e.cost)}G 필요 · 보유 ${num(e.gold)}G)`);
      default:
        return null;
    }
  }).filter(Boolean);

  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('h3', { text: `등반 결과 — ${run.reached}층` }),
    el('div', { class: 'row', style: { gap: '16px', flexWrap: 'wrap' } },
      stat('도달', `${run.reached}층`),
      stat('구간', `${run.from}층부터`),
      stat('쓴 골드', `${num(run.spent)}G`),
      stat('얻은 펫', `${run.pets.length}마리`)),
    run.pets.length
      ? el('div', { class: 'col', style: { gap: '6px' } },
        ...run.pets.map((p) => {
          const sp = getPetSpecies(p.sid);
          return el('div', { class: 'tiny' },
            el('b', { style: { color: '#ffd9a8' }, text: Pet.petLabel(p) }),
            ` — ${sp ? Pet.ROLE_NAME[sp.role] : ''} · ${Pet.petAbilityText(p)}`);
        }),
        el('button', { class: 'btn sm', style: { alignSelf: 'flex-start' }, onClick: () => go('pets') }, '펫 배치하러 가기'))
      : el('div', { class: 'faint tiny', text: '이번에는 아무것도 못 얻었다.' }),
    rows.length ? el('div', { class: 'tw-log' }, rows) : null);
}

const row = (cls, f, text) => el('div', { class: `tw-row ${cls}` },
  el('span', { class: 'f', text: f }), el('span', { text }));

const stat = (k, v) => el('div', { class: 'col', style: { gap: '2px' } },
  el('div', { class: 'faint tiny', text: k }),
  el('div', { style: { fontWeight: '700' }, text: v }));

function rulesPanel() {
  return el('div', { class: 'panel col', style: { gap: '6px' } },
    el('h3', { text: '탑의 규칙' }),
    el('div', { class: 'faint tiny', text: `· 매달 1일에만 문이 열린다. 그날 안에 끝까지 오른다 — 날짜는 넘어가지 않는다.` }),
    el('div', { class: 'faint tiny', text: `· 층마다 층수 × 2 골드를 낸다. 떨어지면 그 자리에서 끝난다.` }),
    el('div', { class: 'tiny' },
      '· ', el('b', { style: { color: 'var(--gold)' }, text: '층을 넘어도 체력이 안 채워진다.' }),
      ` ${REST_EVERY}층마다 오는 회복 지점에서만 전원 회복한다.`),
    el('div', { class: 'faint tiny', text: `· 쓰러진 단원은 다음 회복 지점까지 나오지 못한다.` }),
    el('div', { class: 'faint tiny', text: `· 한 번 오른 곳은 다음 달에 최고 기록 −${SWEEP_BACKOFF}층까지 소탕한다. 소탕 구간에서는 펫이 안 나온다.` }),
    el('div', { class: 'faint tiny', text: `· 층마다 펫이 주인으로 서 있다. 쓰러뜨리면 아주 낮은 확률로 그 펫이 따라온다.` }));
}

/* ─────────────────────────── 동작 ─────────────────────────── */

function doClimb(squadId) {
  const chk = Tower.canEnter(state);
  if (!chk.ok) { toast(chk.reason, 'bad'); return; }

  // 500층을 한 번에 돌린다. 헤드리스라 실측 1~3초면 끝나지만, 그 동안 화면이 멈춘 것처럼
  // 보이므로 안내를 먼저 띄우고 다음 프레임에 실행한다.
  toast('탑을 오르는 중…', 'good');
  setTimeout(() => {
    let run;
    try {
      run = Tower.climb(state, squadId, {});
    } catch (e) {
      console.error('[tower] 등반 실패', e);
      toast('등반 중 오류가 났다.', 'bad');
      return;
    }
    if (!run.ok) { toast(run.reason, 'bad'); return; }
    lastRun = run;
    save();
    toast(`${run.reached}층까지 올랐다. 펫 ${run.pets.length}마리 획득.`, run.pets.length ? 'good' : '');
    refresh();
  }, 30);
}

/** 층 하나를 전투 화면으로 본다 (관전용) — 진행도에는 영향이 없다 */
export function watchFloor(squadId, floor) {
  go('battle', { tower: true, towerFloor: floor, squadId });
}
