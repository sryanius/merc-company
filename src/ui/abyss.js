/**
 * 황금 나락 화면
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 무한의 탑과 같은 이유로 전투 화면을 **자동 진행에 쓰지 않는다.**
 *   `ui/battle.js` 에는 자동 진행 경로가 의도적으로 없고, `fastForward()` 의
 *   12웨이브 하드 캡 때문에 13심층에서 런 전체가 조용히 패배 처리된다.
 *   그래서 잠수는 `game/abyss.js` 의 헤드리스 시뮬로 돌리고, 보고 싶은 심층만 띄운다.
 *
 * @module ui/abyss
 */

import { el, num } from '../core/util.js';
import { state, save, dailyUpkeep } from '../game/state.js';
import * as Abyss from '../game/abyss.js';
import * as Pet from '../game/pet.js';
import {
  ABYSS_NAME, zoneOf, depthPower, depthGold, goldRange, depthEnemyCount, depthEnemyLevel,
  REST_EVERY, VAULT_EVERY, VAULT_MULT, DEPTH_CAP,
} from '../data/abyss.js';
import { costRange, TOWER_FLOORS } from '../data/tower.js';
import { go, refresh, toast } from './app.js';

/** 마지막 잠수 결과 — 화면을 나갔다 와도 남는다 */
let lastRun = null;

export function dispose() { /* rAF·타이머 없음 */ }

/* ─────────────────────────── CSS ─────────────────────────── */

const CSS = `
.ab-head { display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
.ab-big { font-size:34px; font-weight:800; color:#f0c05a; font-variant-numeric:tabular-nums; line-height:1; }
.ab-log { max-height:340px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;
          background:rgba(0,0,0,.26); border-radius:8px; padding:8px; }
.ab-row { display:flex; gap:8px; align-items:baseline; font-size:12px; line-height:1.45; }
.ab-row .f { color:var(--ink-faint); font-variant-numeric:tabular-nums; min-width:58px; }
.ab-row.vault { color:#ffd166; }
.ab-row.rest { color:#8fd3a6; }
.ab-row.lose { color:#ef8a7a; }
.ab-row.fall { color:#c9a0d0; }
.ab-zone { display:flex; gap:6px; flex-wrap:wrap; }
.ab-zone span { font-size:11px; padding:2px 8px; border-radius:99px; background:rgba(255,255,255,.06); color:var(--ink-dim); }
.ab-zone span.on { background:rgba(240,192,90,.18); color:#f0c05a; }
.ab-ledger { display:grid; grid-template-columns:1fr auto; gap:2px 14px; font-size:12px; }
.ab-ledger .v { font-variant-numeric:tabular-nums; text-align:right; }
.ab-ledger .tot { border-top:1px solid rgba(255,255,255,.12); padding-top:4px; margin-top:2px; font-weight:700; }
@media (max-width: 767px) {
  .ab-big { font-size:28px; }
  .ab-log { max-height:260px; }
  /* 폰에서 11px 은 안 읽힌다 — 프로젝트 하한(12px)까지 올린다 */
  .ab-zone span { font-size:12px; }
}
`;
function injectStyle() {
  if (document.getElementById('abyss-style')) return;
  document.head.appendChild(el('style', { id: 'abyss-style', text: CSS }));
}

/* ─────────────────────────── 화면 ─────────────────────────── */

export function render(root) {
  injectStyle();
  const st = state;
  const entry = Abyss.canEnter(st);

  root.appendChild(el('div', { class: 'col', style: { gap: '12px' } },
    header(st, entry),
    ledgerPanel(st),
    divePanel(st, entry),
    lastRun ? resultPanel(lastRun) : null,
    rulesPanel(),
  ));
}

function header(st, entry) {
  const best = st.abyss?.best || 0;
  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('div', { class: 'row spread center', style: { gap: '10px', flexWrap: 'wrap' } },
      el('div', { class: 'ab-head' },
        el('div', { class: 'ab-big', text: best ? `${best}심층` : '미답사' }),
        el('div', { class: 'col', style: { gap: '2px' } },
          el('div', { style: { fontWeight: '700' }, text: ABYSS_NAME }),
          el('div', { class: 'faint tiny', text: best ? `${zoneOf(best)} · 최고 기록` : '아직 내려간 적이 없다' }))),
      el('button', { class: 'btn sm', onClick: () => go('city') }, '도시로')),
    el('div', { class: 'ab-zone' },
      ...[20, 50, 90, 140, 200].map((d) =>
        el('span', { class: best >= d ? 'on' : '', text: `${zoneOf(d)} ${d}` }))),
    entry.ok
      ? el('div', { class: 'wm-ev good tiny', text: '갱도가 열려 있다. 이번 주 몫이 남아 있다.' })
      : el('div', { class: 'wm-ev bad tiny', text: entry.reason }));
}

/**
 * 주간 수지 — "이번 주 벌이가 지출을 덮는가"를 한눈에.
 * 이 컨텐츠가 존재하는 이유 자체가 이 계산이므로 화면에 그대로 띄운다.
 */
function ledgerPanel(st) {
  const upkeepWeek = dailyUpkeep(st) * 7;
  // 탑은 매달 1회다 — 주간으로 환산해서 비교한다. 아직 안 올랐으면 최고 기록 대신 1층으로 본다.
  const towerBest = Math.max(st.tower?.best || 0, 0);
  const towerMonth = towerBest > 0 ? costRange(1, Math.min(TOWER_FLOORS, towerBest + 30)) : 0;
  const towerWeek = Math.round(towerMonth / 4);
  const need = upkeepWeek + towerWeek;

  const best = st.abyss?.best || 0;
  const expect = goldRange(best);
  const ok = expect >= need;

  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('h3', { text: '주간 수지' }),
    el('div', { class: 'ab-ledger' },
      el('div', { text: '단원 임금 (7일)' }), el('div', { class: 'v', text: `−${num(upkeepWeek)}G` }),
      el('div', { text: towerWeek ? `무한의 탑 (${towerBest}층 기준 · 월 1회를 주로 환산)` : '무한의 탑 (아직 미등반)' }),
      el('div', { class: 'v', text: `−${num(towerWeek)}G` }),
      el('div', { class: 'tot', text: '주간 지출' }), el('div', { class: 'v tot', text: `${num(need)}G` }),
      el('div', { style: { color: '#f0c05a' }, text: best ? `나락 예상 수입 (${best}심층까지)` : '나락 예상 수입 (기록 없음)' }),
      el('div', { class: 'v', style: { color: '#f0c05a' }, text: `+${num(expect)}G` })),
    el('div', {
      class: `tiny ${ok ? 'good' : 'warn'}`,
      style: { color: ok ? 'var(--ok)' : '#e8c27a' },
      text: best === 0
        ? '한 번 내려가 보면 여기에 예상 수입이 잡힌다.'
        : (ok
          ? `이번 주 벌이가 지출을 ${num(expect - need)}G 넘긴다. 의뢰 수입은 전부 여유분이 된다.`
          : `아직 ${num(need - expect)}G 모자란다. 더 깊이 내려가려면 장비를 갖춰라 — 세트가 답이다.`),
    }));
}

function divePanel(st, entry) {
  const squads = (st.squads || []).filter((s) => s.status !== 'away');

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
        onClick: () => doDive(sq.id),
      }, '내려간다'));
  });

  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('h3', { text: '잠수' }),
    el('div', { class: 'muted tiny' },
      `1심층부터 다시 내려간다 — 여기는 심층마다 버는 곳이라 건너뛸 이유가 없다. `
      + `심층 n 을 지나면 ${num(depthGold(1))}G × n 을 캐고, ${VAULT_EVERY}심층마다 금고가 있어 ${VAULT_MULT}배가 된다.`),
    el('div', { class: 'faint tiny' }, '장비도 펫도 경험치도 안 나온다. 오직 골드다.'),
    rows.length ? el('div', { class: 'col', style: { gap: '8px' } }, rows)
      : el('div', { class: 'faint tiny', text: '출전할 수 있는 부대가 없다.' }),
    squads.length ? watchPanel(st, squads) : null);
}

/**
 * 심층 관전. 잠수는 계산으로 돌지만 "이 심층은 눈으로 보고 싶다"를 여기서 받는다.
 */
function watchPanel(st, squads) {
  const best = st.abyss?.best || 0;
  let depth = Math.max(1, Math.min(DEPTH_CAP, best || 1));
  let squadId = squads[0].id;

  const input = el('input', {
    type: 'number', min: '1', max: String(DEPTH_CAP), value: String(depth),
    style: { width: '92px' },
    onInput: (e) => { depth = Math.max(1, Math.min(DEPTH_CAP, Number(e.target.value) || 1)); },
  });
  const pick = el('select', {
    onChange: (e) => { squadId = e.target.value; },
  }, ...squads.map((s) => el('option', { value: s.id, text: s.name })));

  return el('div', { class: 'col', style: { gap: '6px', marginTop: '4px' } },
    el('div', { class: 'sep' }),
    el('div', { class: 'faint tiny' },
      '잠수는 계산으로 돌린다 — 심층마다 전투 화면을 띄우면 자동 진행이 안 된다. '
      + '특정 심층의 전투를 보고 싶으면 여기서 띄워라. 기록·골드에는 영향이 없다.'),
    el('div', { class: 'row center', style: { gap: '6px', flexWrap: 'wrap' } },
      pick, input, el('span', { class: 'faint tiny', text: '심층' }),
      el('button', { class: 'btn sm', onClick: () => watchDepth(squadId, depth) }, '이 심층 전투 보기')));
}

function resultPanel(run) {
  const rows = run.log.map((e) => {
    switch (e.type) {
      case 'vault':
        return row('vault', `${e.depth}심층`, `금고를 열었다 — ${num(e.gold)}G`);
      case 'fall':
        return row('fall', `${e.depth}심층`, `${e.names.join(' · ')} 쓰러졌다 — 회복 지점까지 못 나온다`);
      case 'rest':
        return row('rest', `${e.depth}심층`, '갱도 쉼터 — 전원 복귀');
      case 'lose':
        return row('lose', `${e.depth}심층`, '더는 못 내려간다. 여기서 끝났다.');
      default:
        return null;
    }
  }).filter(Boolean);

  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('h3', { text: `잠수 결과 — ${run.reached}심층` }),
    el('div', { class: 'row', style: { gap: '16px', flexWrap: 'wrap' } },
      stat('도달', `${run.reached}심층`),
      stat('구역', run.reached ? zoneOf(run.reached) : '—'),
      stat('캔 골드', `${num(run.gold)}G`)),
    rows.length ? el('div', { class: 'ab-log' }, rows) : null);
}

const row = (cls, f, text) => el('div', { class: `ab-row ${cls}` },
  el('span', { class: 'f', text: f }), el('span', { text }));

const stat = (k, v) => el('div', { class: 'col', style: { gap: '2px' } },
  el('div', { class: 'faint tiny', text: k }),
  el('div', { style: { fontWeight: '700' }, text: v }));

function rulesPanel() {
  return el('div', { class: 'panel col', style: { gap: '6px' } },
    el('h3', { text: '갱도의 규칙' }),
    el('div', { class: 'faint tiny', text: '· 주에 한 번 내려간다. 요일은 가리지 않는다 — 그 주에 아직 안 갔으면 언제든 열린다.' }),
    el('div', { class: 'faint tiny', text: '· 날짜는 넘어가지 않는다. 부대도 묶이지 않는다.' }),
    el('div', { class: 'tiny' },
      '· ', el('b', { style: { color: '#f0c05a' }, text: '깊이 내려갈수록 많이 캔다.' }),
      ` 심층 n 에서 ${num(depthGold(1))}G × n, ${VAULT_EVERY}심층마다 금고 ${VAULT_MULT}배.`),
    el('div', { class: 'tiny' },
      '· ', el('b', { style: { color: 'var(--gold)' }, text: '심층을 넘어도 체력이 안 채워진다.' }),
      ` ${REST_EVERY}심층마다 오는 쉼터에서만 전원 회복한다.`),
    el('div', { class: 'faint tiny', text: '· 쓰러진 단원은 다음 쉼터까지 나오지 못한다. 잠수가 끝나면 부상 없이 돌아온다.' }),
    el('div', { class: 'faint tiny', text: '· 장비·펫·경험치는 나오지 않는다. 여기서 가져가는 건 골드뿐이다.' }),
    el('div', { class: 'faint tiny', text: `· 참고 — 20심층 적 Lv${depthEnemyLevel(20)}·배율 ${depthPower(20).toFixed(1)} / 50심층 Lv${depthEnemyLevel(50)}·${depthPower(50).toFixed(1)} / 80심층 Lv${depthEnemyLevel(80)}·${depthPower(80).toFixed(1)} (적 ${depthEnemyCount(80)}기)` }));
}

/* ─────────────────────────── 동작 ─────────────────────────── */

function doDive(squadId) {
  const chk = Abyss.canEnter(state);
  if (!chk.ok) { toast(chk.reason, 'bad'); return; }

  // 헤드리스라 실측 1~3초면 끝나지만 그 동안 화면이 멈춘 것처럼 보인다.
  // 안내를 먼저 띄우고 다음 프레임에 실행한다. (탑과 같은 처리)
  toast('갱도를 내려가는 중…', 'good');
  setTimeout(() => {
    let run;
    try {
      run = Abyss.dive(state, squadId, {});
    } catch (e) {
      console.error('[abyss] 잠수 실패', e);
      toast('잠수 중 오류가 났다.', 'bad');
      return;
    }
    if (!run.ok) { toast(run.reason, 'bad'); return; }
    lastRun = run;
    save();
    toast(`${run.reached}심층까지 내려가 ${num(run.gold)}G 를 캤다.`, run.gold ? 'good' : '');
    refresh();
  }, 30);
}

/**
 * 심층 하나를 전투 화면으로 본다 (관전 전용).
 * **기록·골드에는 아무 영향이 없다** — 한 판만 띄우고 끝난다.
 */
function watchDepth(squadId, depth) {
  let cfg;
  try {
    cfg = Abyss.abyssBattleDefs(state, depth, squadId, {});
  } catch (e) {
    console.error('[abyss] 관전 편성 실패', e);
    toast('편성을 만들지 못했다.', 'bad');
    return;
  }
  go('battle', {
    battleCfg: cfg,
    title: `${ABYSS_NAME} ${depth}심층 — ${zoneOf(depth)} (관전)`,
    rank: 'S',
    biome: 'cave',
    squadId,
    returnTo: 'abyss',
    reward: null,          // 보상 없음 — 관전이라 골드가 붙으면 안 된다
    days: 0,
  });
}
