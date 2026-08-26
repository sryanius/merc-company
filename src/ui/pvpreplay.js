// PvP 재생 — 서버가 정한 판을 화면으로 다시 돌린다
// 화면 모듈 계약: meta / render(root, params) / dispose()
//
// ★★ **정산이 없다.** `ui/battle.js` 를 그대로 못 쓰는 이유가 이것이다 — 그쪽은 경험치·부상·
//   전리품·세이브 기록이 얽혀 있어서, PvP 판을 다시 볼 때마다 보상이 나오면 «재생으로 경험치 벌기»
//   가 된다. 여기서는 **상태를 한 글자도 안 건드린다.** 엔진과 렌더러만 쓴다.
//
// ★★ **재현은 서버가 준 것만으로 한다.** cfg(양쪽 부대 + 시드) 를 그대로 `tagMatch` 에 넣으면
//   서버가 돌린 것과 같은 합 순서·같은 시드·같은 생존자 HP 가 나온다 (엔진이 결정적이라서다).
//   `record` 옵션은 이벤트 기록만 가르고 시뮬레이션엔 영향이 없다 — 골든 40판으로 확인했다.
//
// ★ 마지막에 **서버 승자와 대조**한다. 다르면 재생이 아니라 «발산» 이므로 desync 로 남긴다.
//   그때도 **서버 결과가 진실**이다 (화면에도 그렇게 적는다).
import { el, num } from '../core/util.js';
import { state } from '../game/state.js';
import { createBattle, setSkillResolver } from '../battle/engine.js';
import { tagMatch } from '../battle/tagmatch.js';
import { getSkill } from '../data/skills.js';
import * as Pvp from '../net/pvp.js';
import { ENGINE_HASH } from '../data/enginever.js';
import { go, toast } from './app.js';

export const meta = { id: 'pvpreplay', title: 'PvP 재생' };

/** 합이 끝나고 다음 합으로 넘어가기 전 멈춤 (초) */
const GAP_S = 1.1;
/* ── 진단 ────────────────────────────────────────────────────────
 *
 * ★★ 제작자: 「DB상에 있는데 그대로 구현 안되나?」
 *   판 자체는 `pvp_matches.cfg` 에 다 들어 있다. 그런데 `pvp_replay` 는 **그 판의
 *   당사자만** 읽게 잠겨 있다 — 아무나 열게 하면 남의 편성이 통째로 공개된다.
 *   그래서 «서버를 열어 준다» 대신 **본인 화면에서 뽑아 갈 수 있게** 만든다.
 *
 * ★ 합마다 다시 돌리되 이번엔 **죽는 순서를 받아 적는다.** 재생과 같은 시드·같은 입력이라
 *   화면에서 본 전개와 정확히 같다. 상태는 여전히 안 건드린다.
 */
function diagnose() {
  if (!S) return '';
  const lines = [];
  lines.push(`# PvP 진단 — ${S.leftName}(공격) vs ${S.rightName}(방어)`);
  lines.push(`판 ${S.matchId ?? '(방금 도전)'} · 시드 ${S.cfg.seed} · 엔진 ${ENGINE_HASH}`);
  lines.push(`서버 승자 ${S.serverWinner || '?'} · 재생 승자 ${S.localWinner || '?'} · ${S.rounds.length}합`);

  S.rounds.forEach((r, i) => {
    /* ★★ `rout: false` 를 **반드시** 같이 넘긴다 — tagmatch 가 그렇게 돌렸기 때문이다.
     *   빼먹었더니 진단이 «(7:0) 인데 생존자에 방어 용병이 있다» 를 뿜었다 —
     *   진단이 자기가 만든 다른 판을 보고 있었다. 재생과 **한 글자도 달라지면 안 된다.** */
    const b = createBattle({
      allies: r.input.allies, enemies: r.input.enemies,
      allyFormationId: r.input.allyFormationId, enemyFormationId: r.input.enemyFormationId,
      seed: r.input.seed, getSkill, rout: false,
    });
    const died = [];
    const seen = new Set();
    let g = 0;
    while (!b.finished && g++ < 20000) {
      b.step(1 / 60);
      b.drainEvents();
      for (const u of b.units) {
        if (!u.alive && !seen.has(u.uid)) { seen.add(u.uid); died.push({ t: b.time, u }); }
      }
    }
    const who = (u) => `${u.side === 'ally' ? 'A' : 'D'}:${u.name || u.classId || '?'}${u.pet ? '(펫)' : ''}`;
    lines.push('');
    lines.push(`${i + 1}합  A ${r.attackerSquad + 1}부대 vs D ${r.defenderSquad + 1}부대 → ${r.winner} (${r.attackerLeft}:${r.defenderLeft}) ${r.time}초`);
    lines.push(`  인원  A ${r.input.allies.length}명 · D ${r.input.enemies.length}명`);
    lines.push(`  전사  ${died.map((d) => `${d.t.toFixed(1)}s ${who(d.u)}`).join(' → ') || '없음'}`);
    const left = b.units.filter((u) => u.alive);
    lines.push(`  생존  ${left.map((u) => `${who(u)} ${Math.round(u.hp / Math.max(1, u.maxHp) * 100)}%`).join(' · ') || '없음'}`);
  });
  return lines.join('\n');
}

function showDiag() {
  if (!S || !S.diagNode) return;
  if (S.diagNode.textContent) { S.diagNode.textContent = ''; S.diagNode.style.display = 'none'; return; }
  let text = '';
  try { text = diagnose(); } catch (e) { text = `진단 실패: ${String((e && e.message) || e)}`; }
  S.diagNode.style.display = '';
  S.diagNode.textContent = '';
  S.diagNode.appendChild(el('div', { class: 'row center', style: { gap: '6px', marginBottom: '6px' } },
    el('button', {
      class: 'btn sm ghost',
      onClick: () => {
        try {
          navigator.clipboard.writeText(text);
          toast('진단을 복사했다 — 그대로 붙여 넣으면 된다', 'good');
        } catch { toast('복사가 막혔다 — 아래 글을 직접 긁어라', 'bad'); }
      },
    }, '복사'),
    el('span', { class: 'tiny faint', text: '이 글을 그대로 붙여 주면 같은 판을 재현할 수 있다' })));
  S.diagNode.appendChild(el('pre', {
    style: {
      whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11px', lineHeight: '1.5',
      margin: '0', maxHeight: '320px', overflow: 'auto', color: 'var(--ink-dim)',
    },
    text,
  }));
}

/** 한 합이 아무리 길어도 이 시간이면 접는다 — 엔진이 무한히 돌 리는 없지만 화면은 지켜야 한다 */
const MAX_ROUND_S = 90;

let S = null;
let styleDone = false;

function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  document.head.appendChild(el('style', {
    text: `
.rp-wrap { display:flex; flex-direction:column; gap:10px; }
.rp-cv { width:100%; display:block; background:var(--bg-0); border-radius:var(--radius); }
.rp-side { display:flex; align-items:center; gap:6px; min-width:0; }
.rp-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
.rp-round { display:grid; grid-template-columns:46px 1fr auto auto; gap:8px; align-items:center;
  padding:6px 8px; border-bottom:1px solid var(--line-soft); }
.rp-round:last-child { border-bottom:0; }
.rp-round.rp-now { background:var(--bg-2); border-radius:var(--radius); }
.rp-round.rp-todo { opacity:.38; }
`,
  }));
}

export function dispose() {
  if (S && S.raf) cancelAnimationFrame(S.raf);
  S = null;
}

/* ── 재생 ────────────────────────────────────────────────────── */

/** 이번 합을 화면에 올린다 */
function startRound(i) {
  if (!S || i >= S.rounds.length) return finish();
  S.at = i;
  const inp = S.rounds[i].input;
  const b = createBattle({
    allies: inp.allies,
    enemies: inp.enemies,
    allyFormationId: inp.allyFormationId,
    enemyFormationId: inp.enemyFormationId,
    seed: inp.seed,
    getSkill,
    /* ★★ `rout: false` — **tagmatch 가 그렇게 돌렸기 때문이다.**
     *   이걸 빼먹으면 합 목록은 «전멸(0)» 이라 적힌 판을 화면에서는
     *   패주로 일찍 끝낸다 — 목록과 화면이 서로 다른 말을 하게 된다.
     *   메타 검사가 진단 쪽 구멍을 물지 않는 걸 보다가 이걸 찾았다. */
    rout: false,
  });
  S.battle = b;
  S.gap = 0;
  S.roundT = 0;
  if (S.renderer && typeof S.renderer.setBattle === 'function') {
    try { S.renderer.setBattle(b, { biome: S.biome }); } catch (e) { console.warn('[재생] setBattle 실패', e); }
  }
  paintRounds();
}

function finish() {
  if (!S || S.done) return;
  S.done = true;
  S.battle = null;
  paintRounds();
  paintVerdict();

  /* ★ 서버가 정한 승자와 다르면 남긴다 — 크로스 런타임 발산을 수치로 갖는 유일한 통로다 */
  if (S.matchId && S.serverWinner && S.localWinner && S.localWinner !== S.serverWinner) {
    Pvp.reportDesync({
      matchId: S.matchId,
      serverWinner: S.serverWinner,
      clientWinner: S.localWinner,
      detail: `합 ${S.rounds.length} · seed ${S.cfg.seed}`,
    }).catch(() => { /* 못 남겨도 판을 막지 않는다 */ });
  }
}

function loop() {
  const frame = (now) => {
    if (!S) return;
    S.raf = requestAnimationFrame(frame);
    if (!S.last) S.last = now;
    const dt = Math.min(0.05, (now - S.last) / 1000);
    S.last = now;

    const b = S.battle;
    if (!b) { if (S.renderer) { try { S.renderer.update(dt); S.renderer.draw(); } catch (e) { /* 마지막 화면 유지 */ } } return; }

    if (S.renderer) {
      try { S.renderer.speed = S.speed; } catch (e) { /* 속도 프로퍼티가 없어도 진행 */ }
      const t0 = b.time;
      try { S.renderer.update(dt); } catch (e) { console.warn('[재생] update 실패', e); }
      /* 렌더러가 스스로 step 을 돌리는 구현이면 이중 진행을 막는다 (battle.js 와 같은 처리) */
      if (b.time > t0 + 1e-9) S.rendererSteps = true;
      if (!S.rendererSteps && !b.finished) b.step(dt * S.speed);
      b.drainEvents();
      try { S.renderer.draw(); } catch (e) { console.warn('[재생] draw 실패', e); }
    } else {
      if (!b.finished) b.step(dt * S.speed);
      b.drainEvents();
    }

    S.roundT += dt * S.speed;
    if (!b.finished && S.roundT > MAX_ROUND_S) b.finished = true;

    if (b.finished) {
      S.gap += dt;
      if (S.gap >= GAP_S / Math.max(1, S.speed)) startRound(S.at + 1);
    }
  };
  S.raf = requestAnimationFrame(frame);
}

/** 남은 합을 그리지 않고 끝까지 넘긴다 */
function skipAll() {
  if (!S || S.done) return;
  S.battle = null;
  S.at = S.rounds.length;
  finish();
}

/* ── 화면 ────────────────────────────────────────────────────── */

function paintRounds() {
  if (!S || !S.listNode) return;
  S.listNode.textContent = '';
  /* ★★ **앞으로의 합은 아예 안 보여 준다.**
   *   예전엕 전체 목록을 깔아 두고 결과 칸만 비워 둥다. 그러면
   *   **몇 합짜리인지·어느 부대가 나올지**가 그대로 드러난다 —
   *   «내 1부대 vs 상대 5부대» 까지 보이면 승패가 짐작된다.
   *   제작자 지적: 「결과가 미리 보이니까 안좋다」. 지난 합과 지금 합까지만 그린다. */
  const upto = S.done ? S.rounds.length : Math.min(S.at + 1, S.rounds.length);
  S.rounds.slice(0, upto).forEach((r, i) => {
    const playing = !S.done && i === S.at;
    const past = S.done || i < S.at;
    const aWon = r.winner === 'attacker';
    S.listNode.appendChild(el('div', { class: `rp-round${playing ? ' rp-now' : ''}` },
      el('div', { class: 'tiny faint', text: `${i + 1}합` }),
      el('div', { class: 'tiny' }, `${S.leftName} ${r.attackerSquad + 1}부대 vs ${S.rightName} ${r.defenderSquad + 1}부대`),
      el('div', { class: 'tiny', style: { color: aWon ? 'var(--leaf)' : 'var(--ink-faint)' },
        text: past ? (r.winner === 'draw' ? '무' : (aWon ? '←승' : '승→')) : '' }),
      el('div', { class: 'tiny faint', text: past ? `${r.attackerLeft}:${r.defenderLeft}` : '' })));
  });
  if (S.stepNode) {
    /* ★ 진행 중엔 **총 합 수도 안 적는다** — «1합 / 5합» 은 그 자체로 스포일러다. */
    S.stepNode.textContent = S.done
      ? `${S.rounds.length}합 종료`
      : `${Math.min(S.at + 1, S.rounds.length)}합 진행 중`;
  }
}

function paintVerdict() {
  if (!S || !S.verdictNode) return;
  const iWon = (S.role === 'attacker' && S.serverWinner === 'attacker')
    || (S.role === 'defender' && S.serverWinner === 'defender');
  const label = S.serverWinner === 'draw' ? '무승부' : (iWon ? '승리' : '패배');
  S.verdictNode.textContent = '';
  S.verdictNode.appendChild(el('b', {
    style: { color: S.serverWinner === 'draw' ? 'var(--ink)' : (iWon ? 'var(--leaf)' : 'var(--blood)') },
    text: label,
  }));
  /* 재생이 서버와 갈리면 **서버가 진실**이라고 화면에도 적는다 */
  if (S.localWinner && S.serverWinner && S.localWinner !== S.serverWinner) {
    S.verdictNode.appendChild(el('span', { class: 'tiny', style: { color: 'var(--gold)' },
      text: ' — 재생이 서버 결과와 달랐다. 순위에 반영된 것은 서버 결과다.' }));
  }
}

function speedBtn(v) {
  return el('button', {
    class: `btn sm ${S.speed === v ? 'primary' : 'ghost'}`,
    onClick: () => { S.speed = v; if (S.speedRow) paintSpeed(); },
  }, `${v}x`);
}

function paintSpeed() {
  S.speedRow.textContent = '';
  for (const v of [1, 2, 4]) S.speedRow.appendChild(speedBtn(v));
}

function build(root) {
  const canvas = el('canvas', { class: 'rp-cv' });
  canvas.width = 1280;
  canvas.height = 560;

  const stepNode = el('span', { class: 'tiny faint' });
  const verdictNode = el('div', { class: 'tiny' });
  const listNode = el('div', { class: 'col', style: { gap: '0' } });
  const speedRow = el('div', { class: 'row center', style: { gap: '4px' } });
  const diagNode = el('div', { class: 'col', style: { gap: '4px', display: 'none' } });

  S.stepNode = stepNode;
  S.verdictNode = verdictNode;
  S.listNode = listNode;
  S.speedRow = speedRow;
  S.diagNode = diagNode;
  paintSpeed();

  root.appendChild(el('div', { class: 'rp-wrap' },
    el('div', { class: 'panel col', style: { gap: '8px' } },
      el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
        el('div', { class: 'rp-side' },
          el('span', { class: 'rp-dot', style: { background: 'var(--leaf)' } }),
          el('b', { style: { fontSize: '13px' }, text: S.leftName }),
          el('span', { class: 'tiny faint', text: '공격' }),
          el('span', { class: 'tiny faint', text: 'vs' }),
          el('span', { class: 'rp-dot', style: { background: 'var(--blood)' } }),
          el('b', { style: { fontSize: '13px' }, text: S.rightName }),
          el('span', { class: 'tiny faint', text: '방어' })),
        el('div', { class: 'row center', style: { gap: '6px' } },
          stepNode,
          speedRow,
          el('button', { class: 'btn sm ghost', onClick: () => skipAll() }, '건너뛰기'),
          /* ★ «왜 저렇게 끝났나» 를 글로 뽑는다 — 서버를 안 열고도 전해 줄 수 있게 */
          el('button', { class: 'btn sm ghost', title: '죽은 순서·생존자를 글로 뽑는다', onClick: () => showDiag() }, '진단'),
          el('button', { class: 'btn sm ghost', onClick: () => go(S.returnTo) }, '닫기'))),
      verdictNode,
      canvas,
      diagNode),
    el('div', { class: 'panel col', style: { gap: '4px' } },
      el('h3', { text: '합', style: { margin: '0' } }),
      listNode)));

  return canvas;
}

async function attachRenderer(canvas, token) {
  let create = null;
  try {
    const mod = await import('../battle/renderer.js');
    create = mod.createRenderer || mod.default || null;
  } catch (e) {
    console.warn('[재생] renderer.js 를 불러오지 못했다', e);
  }
  if (!S || S.token !== token) return;
  if (typeof create === 'function') {
    try {
      const r = create(canvas, { biome: S.biome, width: canvas.width, height: canvas.height });
      if (r && typeof r.update === 'function' && typeof r.draw === 'function') S.renderer = r;
    } catch (e) {
      console.warn('[재생] 렌더러 생성 실패', e);
    }
  }
  startRound(0);
  loop();
}

export function render(root, params = {}) {
  injectStyle();
  dispose();
  try { setSkillResolver(getSkill); } catch (e) { console.warn('[재생] 스킬 해석기 등록 실패', e); }

  const token = Math.random();
  const returnTo = params.returnTo || 'pvp';
  const loading = el('div', { class: 'panel', text: '전투를 불러오는 중…' });
  root.appendChild(loading);

  (async () => {
    let cfg = params.cfg || null;
    let serverWinner = params.winner || '';
    const matchId = params.matchId || null;

    /* 전적에서 들어온 경우 — 판 하나를 서버에서 받아 온다 (공격자·방어자 둘 다 볼 수 있다) */
    if (!cfg && matchId) {
      const res = await Pvp.replay(matchId);
      const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
      if (!row || !row.cfg) {
        loading.textContent = '이 전투를 불러오지 못했다.';
        return;
      }
      cfg = row.cfg;
      serverWinner = row.winner || serverWinner;
    }
    if (!cfg || !Array.isArray(cfg.attacker) || !Array.isArray(cfg.defender)) {
      loading.textContent = '전투 정보가 없다.';
      return;
    }

    let out;
    try {
      out = tagMatch({
        attacker: cfg.attacker,
        defender: cfg.defender,
        seed: cfg.seed,
        getSkill,
      });
    } catch (e) {
      console.error('[재생] 태그매치 실패', e);
      loading.textContent = '전투를 다시 돌리지 못했다.';
      return;
    }
    if (!out.rounds.length) { loading.textContent = '재생할 합이 없다.'; return; }

    const me = state.companyName || '내 용병단';
    const foe = params.opponentName || '상대';
    const role = params.role === 'defender' ? 'defender' : 'attacker';

    S = {
      token,
      cfg,
      matchId,
      role,
      serverWinner,
      localWinner: out.winner,
      rounds: out.rounds,
      /* 왼쪽이 늘 **공격자**다 — 편을 바꿔 그리면 진형과 위치가 달라져 전개가 갈린다.
       * 그래서 자리는 그대로 두고 이름표로만 누가 나인지 알린다. */
      leftName: role === 'attacker' ? `${me}(나)` : foe,
      rightName: role === 'attacker' ? foe : `${me}(나)`,
      returnTo,
      biome: 'plains',
      speed: 1,
      at: 0,
      battle: null,
      renderer: null,
      rendererSteps: false,
      raf: 0,
      last: 0,
      gap: 0,
      roundT: 0,
      done: false,
    };

    root.textContent = '';
    const canvas = build(root);
    paintRounds();
    attachRenderer(canvas, token);
  })().catch((e) => {
    console.error('[재생] 실패', e);
    loading.textContent = '재생 준비 중에 문제가 생겼다.';
    toast('재생을 시작하지 못했다', 'bad');
  });
}
