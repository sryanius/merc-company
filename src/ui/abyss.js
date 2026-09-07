/**
 * 황금 나락 화면
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ §173 소탕 + 관전 잠수
 *   · 최고 기록까지는 **소탕**한다 — 전투 없이 지나가고 골드는 그대로 캔다.
 *   · 그 다음 심층부터는 **전투 화면에서 한 심층씩** 내려간다. 던전의 웨이브 진행과 같은 방식이다:
 *     `go('battle')` 로 한 판 보내고, 결과 훅(onResult)에서 정산하고, 「다음 심층으로」 로 이어 간다.
 *   · 진행 중인 잠수는 `state.abyss.run` 에 남아 화면을 나갔다 와도, 새로고침해도 이어진다.
 *   · 「자동으로 마무리」 는 남은 심층을 계산으로 돌린다 — 실력 차가 커서 100심층을 눈으로 볼 이유가 없을 때.
 *
 * ★ `ui/battle.js` 는 고치지 않는다 (다른 화면도 쓰는 파일이다). 전투 화면에는 자동 진행 경로가
 *   의도적으로 없고 `fastForward()` 에 12웨이브 하드 캡이 있으므로, 한 심층 = 전투 한 판으로 보낸다.
 *
 * ★ 전투 화면은 조우전 정산(`applyEncounterResult`)에서 쓰러진 단원을 3일 부상으로 만든다.
 *   나락은 「잠수가 끝나면 부상 없이 돌아온다」 가 규칙이라, 전투 전에 단원 상태를 찍어 두고
 *   결과 훅에서 되돌린다 (이월 체력은 훅이 받는 finalHp 로 따로 넘긴다).
 *
 * @module ui/abyss
 */

import { el, num } from '../core/util.js';
import { state, save, dailyUpkeep } from '../game/state.js';
import * as Abyss from '../game/abyss.js';
import * as Pet from '../game/pet.js';
import {
  ABYSS_NAME, zoneOf, depthPower, depthGold, goldRange, depthEnemyCount, depthEnemyLevel,
  REST_EVERY, VAULT_EVERY, VAULT_MULT, DEPTH_CAP, HERO_GATE_DEPTH, HERO_GATE_NEED, heroGateOpen,
} from '../data/abyss.js';
import { costRange, TOWER_FLOORS } from '../data/tower.js';
import { rankNote } from './ranknote.js';
import { go, refresh, toast } from './app.js';

/** 마지막 잠수 결과 — 화면을 나갔다 와도 남는다 */
let lastRun = null;
/** 전투 전에 찍어 둔 단원 상태 (uid → {hp,status,woundUntil}) — 결과 훅이 되돌린다 */
let SNAP = null;

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
.ab-row.sweep { color:#9fc4e8; }
.ab-row.stop { color:var(--ink-dim); }
.ab-zone { display:flex; gap:6px; flex-wrap:wrap; }
.ab-zone span { font-size:11px; padding:2px 8px; border-radius:99px; background:rgba(255,255,255,.06); color:var(--ink-dim); }
.ab-zone span.on { background:rgba(240,192,90,.18); color:#f0c05a; }
.ab-ledger { display:grid; grid-template-columns:1fr auto; gap:2px 14px; font-size:12px; }
.ab-ledger .v { font-variant-numeric:tabular-nums; text-align:right; }
.ab-ledger .tot { border-top:1px solid rgba(255,255,255,.12); padding-top:4px; margin-top:2px; font-weight:700; }
.ab-run { border:1px solid rgba(240,192,90,.35); background:rgba(240,192,90,.06); }
.ab-run .ab-big { font-size:28px; }
.ab-carry { display:flex; gap:4px 8px; flex-wrap:wrap; font-size:12px; }
.ab-carry span { padding:1px 6px; border-radius:6px; background:rgba(255,255,255,.06); }
.ab-carry span.down { color:#ef8a7a; text-decoration:line-through; }
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

/**
 * @param {HTMLElement} root
 * @param {{from?:string, autoNext?:boolean}} [params]
 *   · `from:'world'` 이면 나갈 때 월드맵으로 돌아간다 (진입로가 둘이라 나가는 문도 둘이어야 한다).
 *   · `autoNext` — 전투 결과 화면의 「다음 심층으로」 로 넘어온 경우. 진행 중인 잠수가 있으면
 *     이 화면을 보여 주지 않고 곧바로 다음 심층 전투로 들어간다 (던전의 autoNext 와 같다).
 */
export function render(root, params = {}) {
  injectStyle();
  const st = state;
  const stale = Abyss.closeStaleRun(st);
  if (stale) { lastRun = stale; try { save(); } catch (e) { console.warn('[abyss] 저장 실패', e); } }

  const run = Abyss.liveRun(st);
  if (params.autoNext && run) {
    /* ★ go() 는 중첩 호출을 조용히 무시한다 (던전 화면과 같은 이유) — 다음 틱에 들어간다 */
    setTimeout(() => enterDepth(params.from), 0);
    return;
  }

  const entry = Abyss.canEnter(st);
  const back = params.from === 'world' ? 'world' : 'city';

  root.appendChild(el('div', { class: 'col', style: { gap: '12px' } },
    header(st, entry, back),
    ledgerPanel(st),
    run ? runPanel(st, run, params.from) : divePanel(st, entry),
    lastRun ? resultPanel(lastRun) : null,
    rulesPanel(),
  ));
}

function header(st, entry, back = 'city') {
  const best = st.abyss?.best || 0;
  const run = Abyss.liveRun(st);
  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('div', { class: 'row spread center', style: { gap: '10px', flexWrap: 'wrap' } },
      el('div', { class: 'ab-head' },
        el('div', { class: 'ab-big', text: best ? `${best}심층` : '미답사' }),
        el('div', { class: 'col', style: { gap: '2px' } },
          el('div', { style: { fontWeight: '700' }, text: ABYSS_NAME }),
          el('div', { class: 'faint tiny', text: best ? `${zoneOf(best)} · 최고 기록 / 바닥 ${DEPTH_CAP}심층` : '아직 내려간 적이 없다' }))),
      el('button', { class: 'btn sm', onClick: () => go(back) },
        back === 'world' ? '월드맵으로' : '도시로')),
    el('div', { class: 'ab-zone' },
      ...[20, 50, 90, 140, 200, 300, 400, 500].map((d) =>
        el('span', { class: best >= d ? 'on' : '', text: `${zoneOf(d)} ${d}` }))),
    run
      ? el('div', { class: 'wm-ev good tiny', text: `잠수 중 — ${run.depth}심층 앞에 서 있다.` })
      : (entry.ok
        ? el('div', { class: 'wm-ev good tiny', text: '갱도가 열려 있다. 이번 주 몫이 남아 있다.' })
        : el('div', { class: 'wm-ev bad tiny', text: entry.reason })));
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
      el('div', { style: { color: '#f0c05a' }, text: best ? `나락 소탕 수입 (${best}심층까지 · 보장)` : '나락 예상 수입 (기록 없음)' }),
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
  const best = st.abyss?.best || 0;
  const sweepTo = Abyss.sweepDepth(st);

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
      sweepTo >= 1
        ? `최고 기록 ${best}심층까지는 소탕한다 — 전투 없이 지나가고 골드는 그대로 캔다 (+${num(goldRange(sweepTo))}G). `
          + `${sweepTo + 1}심층부터는 전투를 보며 한 심층씩 내려간다.`
        : `1심층부터 전투를 보며 한 심층씩 내려간다. 다음 주부터는 기록까지 소탕하고 그 아래만 싸운다.`),
    el('div', { class: 'faint tiny' },
      `심층 n 을 지나면 ${num(depthGold(1))}G × n 을 캐고, ${VAULT_EVERY}심층마다 금고가 있어 ${VAULT_MULT}배가 된다. `
      + '장비도 펫도 경험치도 안 나온다. 오직 골드다.'),
    rows.length ? el('div', { class: 'col', style: { gap: '8px' } }, rows)
      : el('div', { class: 'faint tiny', text: '출전할 수 있는 부대가 없다.' }),
    squads.length ? watchPanel(st, squads) : null);
}

/**
 * 진행 중인 관전 잠수. 다음 심층 전투로 들어가거나, 남은 심층을 계산으로 마무리하거나, 여기서 그만둔다.
 */
function runPanel(st, run, from) {
  const sq = (st.squads || []).find((s) => s.id === run.squadId);
  const heroN = Abyss.squadHeroCount(st, run.squadId);
  const gateNote = run.depth + 20 > HERO_GATE_DEPTH && !heroGateOpen(heroN, HERO_GATE_DEPTH + 1)
    ? el('div', { class: 'tiny', style: { color: '#ff9be0' }, text: `${HERO_GATE_DEPTH}심층 아래는 각성한 영웅이 있어야 내려간다 (지금 ${heroN}명).` })
    : null;

  return el('div', { class: 'panel col ab-run', style: { gap: '10px' } },
    el('div', { class: 'row spread center', style: { gap: '10px', flexWrap: 'wrap' } },
      el('div', { class: 'ab-head' },
        el('div', { class: 'ab-big', text: `${run.depth}심층` }),
        el('div', { class: 'col', style: { gap: '2px' } },
          el('div', { style: { fontWeight: '700' }, text: `잠수 중 — ${zoneOf(run.depth)}` }),
          el('div', { class: 'faint tiny', text: `${sq ? sq.name : '부대'} · ${run.startDepth}심층부터 · 이번 잠수 ${num(run.gold)}G` }))),
      el('div', { class: 'faint tiny', text: `적 Lv${depthEnemyLevel(run.depth)} · ${depthEnemyCount(run.depth)}기 · 배율 ${depthPower(run.depth).toFixed(1)}` })),
    gateNote,
    el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      el('button', { class: 'btn primary', onClick: () => enterDepth(from) }, `${run.depth}심층 전투`),
      el('button', { class: 'btn', onClick: () => autoFinish() }, '남은 심층 자동으로 마무리'),
      el('button', { class: 'btn sm', onClick: () => stopRun() }, '여기서 그만')),
    el('div', { class: 'faint tiny' },
      '심층마다 부대는 만피·전원 생존으로 선다 — 벽은 오직 힘이다. '
      + '「자동으로 마무리」 는 남은 심층을 계산으로 돌려 패배할 때까지 내려간다 — 결과는 같은 규칙으로 정산된다.'));
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
      '소탕한 심층이나 아직 못 간 심층의 전투를 미리 보고 싶으면 여기서 띄워라. 기록·골드에는 영향이 없다.'),
    el('div', { class: 'row center', style: { gap: '6px', flexWrap: 'wrap' } },
      pick, input, el('span', { class: 'faint tiny', text: '심층' }),
      el('button', { class: 'btn sm', onClick: () => watchDepth(squadId, depth) }, '이 심층 전투 보기')));
}

function resultPanel(run) {
  const rows = (run.log || []).map((e) => {
    switch (e.type) {
      case 'sweep':
        return row('sweep', `1~${e.to}심층`, `소탕 — 전투 없이 지났다. ${num(e.gold)}G`);
      case 'vault':
        return row('vault', `${e.depth}심층`, `금고를 열었다 — ${num(e.gold)}G`);
      case 'fall':
        return row('fall', `${e.depth}심층`, `${e.names.join(' · ')} 쓰러졌다 — 회복 지점까지 못 나온다`);
      case 'rest':
        return row('rest', `${e.depth}심층`, '갱도 쉼터 — 전원 복귀');
      case 'lose':
        return row('lose', `${e.depth}심층`, '더는 못 내려간다. 여기서 끝났다.');
      case 'stop':
        return row('stop', `${e.depth}심층`, e.why === 'stale' ? '주가 바뀌어 잠수가 닫혔다.' : '여기서 올라왔다.');
      case 'gate':
        return row('lose', `${e.depth}심층`, `갱도의 심장은 각성한 영웅이 여는 문이다 — ${HERO_GATE_DEPTH}심층 아래는 각성 영웅 ${HERO_GATE_NEED}명이 부대에 있어야 내려간다.`);
      default:
        return null;
    }
  }).filter(Boolean);

  // 순위 한 줄 (ui/ranknote.js — 탑 결과 화면과 같은 조각을 쓴다)
  const rankLine = rankNote({
    kind: 'abyss', value: run.reached, best: state.abyss?.best || 0, unit: '심층',
  });
  const fought = run.startDepth ? Math.max(0, run.reached - (run.startDepth - 1)) : null;

  return el('div', { class: 'panel col', style: { gap: '10px' } },
    el('h3', { text: `잠수 결과 — ${run.reached}심층${run.why === 'cap' ? ' (바닥)' : ''}` }),
    el('div', { class: 'row', style: { gap: '16px', flexWrap: 'wrap' } },
      stat('도달', `${run.reached}심층`),
      stat('구역', run.reached ? zoneOf(run.reached) : '—'),
      fought != null ? stat('전투로 내려간 심층', `${fought}`) : null,
      stat('캔 골드', `${num(run.gold)}G`)),
    rankLine,
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
      '· ', el('b', { style: { color: '#9fc4e8' }, text: '최고 기록까지는 소탕한다.' }),
      ' 전투 없이 지나가고 골드는 그대로 캔다. 그 다음 심층부터 전투를 보며 내려간다.'),
    el('div', { class: 'tiny' },
      '· ', el('b', { style: { color: '#f0c05a' }, text: '깊이 내려갈수록 많이 캔다.' }),
      ` 심층 n 에서 ${num(depthGold(1))}G × n, ${VAULT_EVERY}심층마다 금고 ${VAULT_MULT}배.`),
    el('div', { class: 'tiny' },
      '· ', el('b', { style: { color: 'var(--gold)' }, text: '심층마다 만피·전원 생존으로 선다.' }),
      ' 쓰러져도 부상은 없다 — 벽은 오직 부대의 힘이다.'),
    el('div', { class: 'faint tiny', text: '· 장비·펫·경험치는 나오지 않는다. 여기서 가져가는 건 골드뿐이다.' }),
    el('div', { class: 'tiny' },
      '· ', el('b', { style: { color: '#ff9be0' }, text: `${HERO_GATE_DEPTH}심층 아래는 각성한 영웅이 연다.` }),
      ` 부대에 각성 영웅이 ${HERO_GATE_NEED}명 이상 있어야 그 아래로 내려간다.`),
    el('div', { class: 'faint tiny', text: `· 바닥은 ${DEPTH_CAP}심층이다. 참고 — 100심층 배율 ${depthPower(100).toFixed(1)} / 200심층 ${depthPower(200).toFixed(1)} / 300심층 ${depthPower(300).toFixed(1)} / ${DEPTH_CAP}심층 ${depthPower(DEPTH_CAP).toFixed(1)} (적 Lv${depthEnemyLevel(DEPTH_CAP)} · ${depthEnemyCount(DEPTH_CAP)}기)` }));
}

/* ─────────────────────────── 동작 ─────────────────────────── */

/** 「내려간다」 — 소탕(골드)까지 하고 첫 전투 심층으로 들어간다 */
function doDive(squadId) {
  let b;
  try {
    b = Abyss.beginLiveRun(state, squadId);
  } catch (e) {
    console.error('[abyss] 잠수 시작 실패', e);
    toast('잠수를 시작하지 못했다.', 'bad');
    return;
  }
  if (!b.ok) { toast(b.reason, 'bad'); return; }
  save();
  if (b.done) {
    lastRun = b.result;
    toast(b.gate
      ? `${HERO_GATE_DEPTH}심층 아래는 각성한 영웅이 있어야 내려간다. 소탕으로 ${num(b.gold)}G 를 캤다.`
      : `이미 바닥(${DEPTH_CAP}심층)이다. 소탕으로 ${num(b.gold)}G 를 캤다.`, 'good');
    refresh();
    return;
  }
  if (b.sweepTo >= 1) toast(`${b.sweepTo}심층까지 소탕 — ${num(b.gold)}G. ${b.sweepTo + 1}심층부터 싸운다.`, 'good');
  else toast('1심층부터 내려간다.', 'good');
  setTimeout(() => enterDepth(), 0);
}

/** 단원 상태를 찍어 둔다 — 전투 화면의 조우전 정산(부상 3일)을 되돌리기 위해 */
function snapshotSquad(squadId) {
  const sq = (state.squads || []).find((s) => s.id === squadId);
  const snap = {};
  for (const uid of (sq ? sq.memberUids : []) || []) {
    if (!uid) continue;
    const m = (state.roster || []).find((x) => x && x.uid === uid);
    if (m) snap[uid] = { hp: m.hp, maxHp: m.maxHp, status: m.status, woundUntil: m.woundUntil };
  }
  return snap;
}
function restoreSquad(snap) {
  if (!snap) return;
  for (const [uid, s] of Object.entries(snap)) {
    const m = (state.roster || []).find((x) => x && x.uid === uid);
    if (!m) continue;
    m.hp = s.hp; m.maxHp = s.maxHp; m.status = s.status; m.woundUntil = s.woundUntil;
  }
}

/** 진행 중인 잠수의 다음 심층을 전투 화면으로 보낸다 */
function enterDepth(from) {
  const run = Abyss.liveRun(state);
  if (!run) { refresh(); return; }
  let cfg;
  try {
    cfg = Abyss.liveBattleDefs(state);
  } catch (e) {
    console.error('[abyss] 심층 편성 실패', e);
    toast('편성을 만들지 못했다.', 'bad');
    return;
  }
  if (!cfg) { refresh(); return; }
  const depth = run.depth;
  const squadId = run.squadId;
  SNAP = snapshotSquad(squadId);
  const snap = SNAP;
  const retParams = from ? { from } : {};

  go('battle', {
    battleCfg: cfg,
    title: `${ABYSS_NAME} ${depth}심층 — ${zoneOf(depth)}`,
    rank: 'S',
    biome: 'cave',
    squadId,
    days: 0,
    reward: null,          // 골드는 심층을 이길 때 훅에서 준다 — 여기에 붙이면 이중 지급이다
    returnTo: 'abyss',
    returnParams: retParams,
    // 이기면 결과 화면에 「다음 심층으로」 가 뜬다 — 이 화면을 거쳐(autoNext) 곧바로 다음 전투로 들어간다.
    // ★ 바닥이거나 다음 심층이 영웅 관문(§177) 아래인데 각성 영웅이 없으면 버튼을 안 띄운다 (검수: 죽은 버튼이 떴다).
    continueLabel: depth < DEPTH_CAP && heroGateOpen(Abyss.squadHeroCount(state, squadId), depth + 1)
      ? `다음 심층으로 (${depth + 1})` : null,
    continueParams: { ...retParams, autoNext: true },
    /* ★ 전투 화면이 결과를 확정한 **그 자리에서** 정산한다 (던전과 같다). 도시로 나가 버려도
     *   골드·기록·이월 체력이 남고, 졌으면 그 자리에서 잠수가 닫힌다 (되감기 여지를 줄인다). */
    onResult: (r) => {
      restoreSquad(snap);
      SNAP = null;
      let res = null;
      try {
        res = Abyss.settleLiveDepth(state, { win: !!(r && r.win), finalHp: (r && r.finalHp) || {} });
      } catch (e) {
        console.error('[abyss] 심층 정산 실패', e);
      }
      if (res && res.finished && res.result) lastRun = res.result;
      try { save(); } catch (e) { console.warn('[abyss] 저장 실패', e); }
      if (!res) return {};
      const note = res.win
        ? `${res.depth}심층 돌파 — ${num(res.gold)}G (이번 잠수 ${num((Abyss.liveRun(state) || res.result || {}).gold || 0)}G)`
          + (res.gate ? ` · ${HERO_GATE_DEPTH}심층 아래는 각성한 영웅이 있어야 내려간다` : res.finished ? ` · 바닥이다` : '')
        : `${res.depth}심층에서 막혔다 — 이번 잠수는 ${res.result ? res.result.reached : res.depth - 1}심층까지, ${num(res.result ? res.result.gold : 0)}G`;
      return { note };
    },
  });
}

/** 남은 심층을 계산으로 마무리한다 */
function autoFinish() {
  const run = Abyss.liveRun(state);
  if (!run) { refresh(); return; }
  toast('남은 심층을 내려가는 중…', 'good');
  setTimeout(() => {
    let out;
    try {
      out = Abyss.autoFinishLiveRun(state);
    } catch (e) {
      console.error('[abyss] 자동 마무리 실패', e);
      toast('잠수 중 오류가 났다.', 'bad');
      return;
    }
    if (!out) { refresh(); return; }
    lastRun = out;
    save();
    toast(`${out.reached}심층까지 내려가 ${num(out.gold)}G 를 캤다.`, out.gold ? 'good' : '');
    refresh();
  }, 30);
}

/** 여기서 올라온다 — 이긴 만큼은 기록·골드로 남는다 */
function stopRun() {
  const out = Abyss.finishLiveRun(state, 'stop');
  if (!out) { refresh(); return; }
  lastRun = out;
  save();
  toast(`${out.reached}심층에서 올라왔다. 이번 주 잠수는 여기까지다.`, '');
  refresh();
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
  const snap = snapshotSquad(squadId);
  go('battle', {
    battleCfg: cfg,
    title: `${ABYSS_NAME} ${depth}심층 — ${zoneOf(depth)} (관전)`,
    rank: 'S',
    biome: 'cave',
    squadId,
    returnTo: 'abyss',
    reward: null,          // 보상 없음 — 관전이라 골드가 붙으면 안 된다
    days: 0,
    // 관전도 부상을 남기지 않는다 (§173)
    onResult: () => { restoreSquad(snap); try { save(); } catch (e) { /* 무시 */ } return {}; },
  });
}
