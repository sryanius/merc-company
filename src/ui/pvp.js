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
import { ENGINE_HASH } from '../data/enginever.js';
import * as Auth from '../net/auth.js';
import { toast, go } from './app.js';
import { lineupNode } from './lineupview.js';

export const meta = { id: 'pvp', title: 'PvP' };

/** 도전 한 번의 골드 (제작자 결정) */
export const CHALLENGE_COST = 300_000;

/** 같은 상대에게 다시 도전하기까지 (초).
 *  ★★ 서버의 `COOLDOWN` 과 **같은 값**이어야 한다 (smoke 가 맞춰 본다).
 *    짧게 잡으면 누를 수 있는 버튼이 서버에서 튕겨 나고,
 *    길게 잡으면 눌 수 있는데 막힌다. */
export const CHALLENGE_COOLDOWN_S = 10;

/* ★ 상대별 마지막 도전 시각. 서버가 쿨타임을 가지고 있지만
 *   순위표에 실어 보내지는 않는다. 도전을 건 건 이 클라이므로
 *   여기서 기억해 두면 버튼을 미리 막을 수 있다.
 *   ★ 다른 기기에서 도전했으면 여기엔 기록이 없어 서버가 거절한다 —
 *     예전과 같은 행동이라 나빠지지 않는다. */
/* ★★ **브라우저에 적어 둔다.** 메모리에만 두면 새로고침 한 번에 잊어버려
 *   누를 수 있는 버튼처럼 보이고 서버에서 튕겨 난다. */
const COOL_KEY = 'merc_pvp_cool_v1';
const readCool = () => {
  try { const o = JSON.parse(localStorage.getItem(COOL_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
  catch { return {}; }
};
const writeCool = (o) => { try { localStorage.setItem(COOL_KEY, JSON.stringify(o)); } catch { /* 사파리 비공개 */ } };
/** 이 상대에게 방금 도전했다고 적는다 */
function markTried(handle) {
  const o = readCool();
  o[handle] = Date.now();
  /* 지난 것은 치워 둔다 — 무한히 쌓이면 안 된다 */
  const cut = Date.now() - CHALLENGE_COOLDOWN_S * 1000 * 4;
  for (const k of Object.keys(o)) if (!(o[k] > cut)) delete o[k];
  writeCool(o);
}
/* 지금 화면에 있는 도전 버튼들 — 남은 초를 글자만 고쳐 쓴다 (화면 재그림 없이) */
let coolBtns = [];
let coolTimer = 0;
/** 남은 쿨타임 (초). 0 이면 눌 수 있다 */
function cooldownLeft(handle) {
  const t = readCool()[handle];
  if (!t) return 0;
  return Math.max(0, Math.ceil((CHALLENGE_COOLDOWN_S * 1000 - (Date.now() - t)) / 1000));
}

let styleDone = false;
let busy = false;
/* 방금 끝난 도전 — 화면을 다시 그릴 때 맨 위에 보여준다 */
let lastResult = null;

export function dispose() {
  /* ★ 화면을 떠나면 반드시 멈춘다 — 안 그러면 사라진 버튼을 계속 만지작거린다 */
  if (coolTimer) { clearInterval(coolTimer); coolTimer = 0; }
  coolBtns = [];
}

/** 도전 버튼의 남은 초를 주기적으로 고쳐 쓴다 */
function startCoolTick() {
  if (coolTimer) clearInterval(coolTimer);
  coolTimer = setInterval(() => {
    let any = false;
    for (const { el: b, handle } of coolBtns) {
      if (!b.isConnected) continue;
      const left = cooldownLeft(handle);
      if (left) {
        any = true;
        b.disabled = true;
        b.classList.add('pv-cool');
        if (b.textContent !== `${left}초`) b.textContent = `${left}초`;
      } else if (b.disabled) {
        b.disabled = false;
        b.classList.remove('pv-cool');
        b.textContent = '도전';
      }
    }
    if (!any) { clearInterval(coolTimer); coolTimer = 0; }
  }, 250);
}

/* ── 서버에서 받아 오기 ───────────────────────────────────────────
 *
 * ★★ **캐시는 짧게 산다.**
 *   예전엔 `boardCache`·`meCache` 에 한 번 담고 세션 내내 그대로 썼다 (지울 때는
 *   내가 등록하거나 도전했을 때뿐). 그래서 **남이 움직인 건 영영 안 보였다**:
 *     · 남이 새로 등록해도 내 순위 목록에 안 나타나고
 *     · 남이 나를 때려 내 승점이 바뀌어도 「1000 · 0승 0패」 그대로였다.
 *   제작자가 화면으로 알려 줬다 — 서버엔 2행이 있는데 화면엔 1행이었고,
 *   전적에는 5판이 찍혀 있는데 전적표는 0승 0패였다.
 *
 * ★ 그렇다고 «그릴 때마다 다시 받기» 는 과하다 — `refresh()` 는 다른 화면 코드가
 *   44군데에서 부른다. 10초면 화면을 다시 열 때는 새로 받고,
 *   한 번 그리는 동안에는 한 번만 받는다.
 *
 * ★ me 와 board 를 **한 약속으로 묶는다.** 예전엔 둘이 따로 날아서
 *   board 가 먼저 오면 «나» 표시(myHandle)가 비었다 — 눈에 잘 안 띄는 경합이었다.
 */
const CACHE_MS = 10_000;
let dataAt = 0;
let dataPromise = null;

/** 다음 그리기에서 반드시 새로 받게 한다 */
function dropCache() { dataPromise = null; dataAt = 0; lineupCache.clear(); }

/* ── 순위표에서 편성 보기 ────────────────────────────────────────
 *
 * ★★ 제작자: 「pvp 순위에서 부대 보는거 안되나?」
 *
 *   §93 에서는 **일부러 안 줬다** — 도전 전에 남의 편성을 보면 «맞춰 짜기» 가 되기 때문이다.
 *   그 설명을 읽은 뒤 제작자가 「순위표의 누구나」 로 정했다. 그 결정을 따른다.
 *   되돌릴 곳은 `db/011_pvp_lineup.sql` 의 grant 한 줄이다.
 *
 * ★ 편성 하나가 약 19KB 다. 순위표에 통째로 실으면 목록이 무거워지므로
 *   **누른 사람 것만** 따로 받는다 (§007 의 400KB 교훈).
 *
 * ★ 받은 건 화면에 남겨 둔다 — 접었다 폈다 할 때마다 다시 받을 이유가 없다.
 *   «새로고침» 은 이것도 같이 비운다 (남이 다시 등록했을 수 있다).
 */
const lineupCache = new Map();

async function fetchLineup(handle) {
  if (lineupCache.has(handle)) return lineupCache.get(handle);
  const res = await Pvp.lineup(handle);
  const row = res && res.ok && Array.isArray(res.data) ? res.data[0] : null;
  const units = row && Array.isArray(row.units) ? row.units : null;
  if (units) lineupCache.set(handle, units);
  return units;
}

async function toggleBoardLineup(btn, host, r, mine) {
  if (host.childNodes.length) {
    host.textContent = '';
    host.style.display = 'none';
    btn.textContent = '편성';
    return;
  }
  host.style.display = '';
  host.appendChild(el('div', { class: 'tiny faint', text: '불러오는 중…' }));
  btn.disabled = true;
  try {
    const squads = await fetchLineup(r.handle);
    host.textContent = '';
    if (!squads || !squads.length) {
      host.appendChild(el('div', { class: 'tiny faint', text: '편성을 불러오지 못했다.' }));
      return;
    }
    host.appendChild(lineupNode([{ squads, mine }]));
    btn.textContent = '접기';
  } catch (e) {
    host.textContent = '';
    host.appendChild(el('div', { class: 'tiny faint', text: `편성을 펴지 못했다: ${String((e && e.message) || e)}` }));
  } finally {
    btn.disabled = false;
  }
}

function pvpData() {
  if (dataPromise && (Date.now() - dataAt) < CACHE_MS) return dataPromise;
  dataAt = Date.now();
  dataPromise = (async () => {
    const signed = !!(Auth.signedIn && Auth.signedIn());
    const [me, board] = await Promise.all([
      signed ? Pvp.me() : Promise.resolve({ ok: false, data: null }),
      Pvp.board(100),
    ]);
    return { signed, me, board };
  })();
  return dataPromise;
}

/* ── 등록이 낡았는가 ──────────────────────────────────────────────
 *
 * 서버가 보관하는 `pvp_defense.units` 는 **등록한 순간의 사본**이다. 장비를 갈아 끼우든
 * 레벨을 올리든 서버 쪽은 그대로다. 그리고 그 사본이 곧 내 **공격** 편성이라,
 * 재등록을 잊으면 옛 장비로 싸운다.
 *
 * ★ 그래서 «마지막으로 등록한 편성의 지문» 을 이 기기에 적어 두고 지금 편성과 견준다.
 *   서버에 지문 칸을 두는 편이 더 정확하지만(다른 기기에서도 맞는다) 스키마를 건드려야 한다.
 *   여기서 틀리는 방향은 **«낡았다» 로 잘못 보는 쪽**뿐이고(기기를 바꾸면 그렇다),
 *   그 대가는 «필요 없는 재등록 한 번» 이라 안전하다.
 */
const FP_KEY = 'merc_pvp_lineup_fp_v1';
const readFp = () => { try { return localStorage.getItem(FP_KEY) || ''; } catch { return ''; } };
const writeFp = (v) => { try { localStorage.setItem(FP_KEY, v); } catch { /* 사파리 비공개 모드 */ } };

/* ★★ 지문에 **엔진 지문을 같이 엮는다.**
 *   서버는 등록된 편성의 `engine_hash` 가 지금과 다르면 전투를 거절한다
 *   (`needRebuild`). 그런데 그건 **방어자 쪽도** 막는다 — 그 사람이 직접 다시
 *   등록할 때까지 **아무도 그를 못 때린다.** 내가 대신 해 줄 수도 없다.
 *   그래서 엔진이 움직이면 화면에 들어오는 것만으로 **조용히 다시 올린다.**
 *   사람이 고른 편성을 바꾸는 게 아니라 **같은 편성을 다시 올리는 것**이라 놀람 일이 없다. */
const stamp = (fp) => `${ENGINE_HASH}:${fp}`;

/** 지금 편성이 마지막으로 등록한 것과 다른가 (등록 자체가 없으면 «다르다») */
function lineupStale(lineup) {
  if (!lineup) return false;                 // 편성이 없으면 물어볼 것도 없다
  const was = readFp();
  return !was || was !== stamp(Pvp.lineupFp(lineup.units));
}

/** 편성은 그대로인데 **엔진만** 움직였는가 */
function engineMoved() {
  const was = readFp();
  return !!was && was.slice(0, was.indexOf(':')) !== ENGINE_HASH;
}

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
.pv-cool { opacity:.5; cursor:not-allowed; min-width:44px; }
/* 전적 행은 «보기» 단추가 더 붙어 다섯 칸이다 */
.pv-row.pv-5 { grid-template-columns: 42px 1fr auto auto auto; }
@media (max-width: 520px) {
  .pv-row { grid-template-columns: 34px 1fr auto; }
  .pv-row.pv-5 { grid-template-columns: 30px 1fr auto auto; }
  .pv-pow { display:none; }
}
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
    /* ★ 부상을 무시한다 — 이유는 quest.js 의 주석 참조 */
    const defs = allyUnitDefs(state, sq, { ignoreWounds: true });
    if (!defs.length) continue;
    units.push(defs);
    power += squadPower(state, sq.id) || 0;
  }
  return units.length ? { units, power } : null;
}

/**
 * 지금 편성을 등록한다.
 * @param {(msg:string)=>void} [say] 진행 표시
 * @returns {Promise<{ok:boolean, error:string, n:number}>}
 */
async function registerNow(say) {
  const lineup = myLineup();
  if (!lineup) return { ok: false, error: '먼저 부대를 편성해라', n: 0 };
  if (say) say('등록하는 중…');

  /* ★ 지문은 **보낸 것 그대로**에서 뽑는다. 다른 모양에서 뽑으면 늘 «낡았다» 가 된다. */
  const units = lineup.units;
  const res = await Pvp.registerDefense({
    companyName: state.companyName || '무명단',
    squads: units,
    power: Math.round(lineup.power),
    saveRev: state.rev,
  });
  if (say) say('');
  if (!res.ok) {
    /* ★ 서버가 «불가능한 값» 을 짚어 주면 그대로 보여준다 — 정상 플레이어가 고칠 수 있어야 한다 */
    const detail = res.data && Array.isArray(res.data.detail) ? res.data.detail.slice(0, 2).join(' / ') : '';
    return { ok: false, error: `${res.error || '등록 실패'} ${detail}`.trim(), n: 0, mercs: 0 };
  }
  writeFp(stamp(Pvp.lineupFp(units)));
  dropCache();
  const mercs = units.reduce((a, sq) => a + sq.filter((u) => !u.pet).length, 0);
  return { ok: true, error: '', n: units.length, mercs };
}

async function doRegister(afterEl) {
  if (busy) return;
  busy = true;
  const r = await registerNow((m) => { afterEl.textContent = m; });
  busy = false;
  if (!r.ok) { toast(`등록 실패: ${r.error}`, 'bad'); return; }
  /* ★ 인원을 같이 적는다 — 예전엕 부대 수만 말해서
   *   «부상자가 빠져 용병 1명만 등록됐다» 를 알 길이 없었다. */
  toast(`${r.n}개 부대 · 단원 ${r.mercs}명을 등록했다`, 'good');
  go('pvp');
}

async function doChallenge(handle, name) {
  if (busy) return;
  if ((state.gold || 0) < CHALLENGE_COST) {
    toast(`골드가 모자란다 (${num(CHALLENGE_COST)} 필요)`, 'bad');
    return;
  }
  busy = true;

  /* ★★ **도전 직전에 편성을 맞춘다.**
   *   등록해 둔 편성이 곧 내 공격 편성이라, 장비를 갈아 끼우고 재등록을 잊으면
   *   **옛 장비로 싸운다.** 제작자가 물었다: 「부대 등록하면 자동 업데이트 되나?」 — 아니었다.
   *   ★ 등록이 실패하면 **도전을 접는다.** 골드는 아직 안 깎였다. */
  if (lineupStale(myLineup())) {
    toast('편성이 바뀌었다 — 다시 등록하고 도전한다', 'good');
    const r = await registerNow();
    if (!r.ok) { busy = false; toast(`등록 실패: ${r.error}`, 'bad'); return; }
  }

  /* ★ 응답 전에 적는다 — 서버가 받았으면 쿨타임은 이미 시작된 것이다.
   *   거절당해도 그대로 둔다 (서버 기준으로도 못 누르는 상태니까). */
  markTried(handle);
  toast(`${name} 에게 도전한다…`, 'good');

  /* ★ 도전 id 를 **먼저 만들어 둔다.** 응답을 못 받아도 같은 id 로 다시 부르면
   *   서버가 «저장된 결과» 를 그대로 준다 — 골드만 날리고 결과를 잃는 일이 없다. */
  const challengeId = Pvp.newChallengeId();

  let res = await Pvp.challenge(handle, challengeId);

  /* ★ 엔진이 바뀌어 옛 지문으로 접힌 편성이면 서버가 «다시 등록해라» 를 준다.
   *   그건 사람이 할 일이 아니다 — 여기서 한 번 다시 접고 같은 id 로 재시도한다.
   *   (첫 시도가 409 면 도전권이 청구되지 않았으므로 같은 id 로 다시 불러도 안전하다.) */
  if (!res.ok && res.data && res.data.needRebuild) {
    const r = await registerNow();
    if (r.ok) res = await Pvp.challenge(handle, challengeId);
  }

  busy = false;
  if (!res.ok) {
    toast(res.data?.error || res.error || '도전 실패', 'bad');
    return;
  }

  /* ★ 골드는 **성공했을 때만** 깎는다. 서버가 거절했는데 골드를 먹으면 안 된다.
   *   (서버는 골드를 모른다 — 이건 클라이언트의 정직성에 기댄 부분이다. §70.2 에 적어 두었다.) */
  state.gold = Math.max(0, (state.gold || 0) - CHALLENGE_COST);
  save();

  dropCache();
  lastResult = { ...(res.data || {}), opponentName: name };

  /* ★★ **바로 전투를 보여 준다.**
   *   제작자: 「도전하면 전투를 보여줘야되는거 아니」 ·
   *   「pvp 전투 누르면 전투는 안보이고 내 전적에서 봐야되네」.
   *   결과 판은 재생을 닫으면(`닫기` → go('pvp')) 그대로 뜼다 — lastResult 를 남겨 둔다.
   * ★ cfg 가 없으면(응답이 짤렸거나 예외) matchId 로 받아 오게 한다 —
   *   재생 화면이 둘 다 받는다. 둔 쪽 다 없을 때만 결과 판으로 남는다. */
  const d = res.data || {};
  if (d.cfg || d.matchId) {
    go('pvpreplay', {
      cfg: d.cfg || null, matchId: d.matchId || null, winner: d.winner,
      opponentName: name, role: 'attacker', returnTo: 'pvp',
    });
    return;
  }
  go('pvp');
}

/* ── 화면 ─────────────────────────────────────────────────── */

function meRow() {
  const box = el('div', { class: 'panel col', style: { gap: '8px' } });
  const body = el('div', { class: 'tiny faint', text: '불러오는 중…' });
  const status = el('span', { class: 'tiny faint' });
  const stale = el('div', { class: 'tiny', style: { color: 'var(--gold)', display: 'none' } });

  box.appendChild(el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
    el('h3', { text: 'PvP', style: { margin: '0' } }),
    el('div', { class: 'row center', style: { gap: '6px' } },
      status,
      /* ★ 남이 등록하거나 나를 때린 것은 **가만히 있으면 안 보인다.**
       *   10초 캐시가 있어도 화면을 열어 둔 채로는 안 바뀌므로 손잡이를 하나 둔다. */
      el('button', {
        class: 'btn sm ghost',
        title: '순위와 전적을 서버에서 다시 받는다',
        onClick: () => { dropCache(); go('pvp'); },
      }, '새로고침'),
      el('button', {
        class: 'btn sm',
        title: '지금 편성을 방어 부대로 등록한다 (이 편성이 곧 내 공격 편성이다)',
        onClick: () => doRegister(status),
      }, '내 부대 등록'))));
  box.appendChild(stale);
  box.appendChild(body);

  (async () => {
    const d = await pvpData();
    if (!d.signed) {
      body.textContent = '로그인하면 PvP 에 참여할 수 있다.';
      return;
    }
    const res = d.me;
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

    /* ★ 지금 편성이 몇 명인지 적어 둔다 — 부대가 비면 눈에 띄게 */
    const lu = myLineup();
    if (lu) {
      const mercN = lu.units.reduce((a, sq) => a + sq.filter((u) => !u.pet).length, 0);
      const thin = lu.units.filter((sq) => sq.filter((u) => !u.pet).length < 3).length;
      body.appendChild(el('div', { class: 'tiny faint' },
        `지금 편성 ${lu.units.length}개 부대 · 단원 ${mercN}명`,
        thin ? el('span', { style: { color: 'var(--gold)' }, text: `  — 단원이 3명 미만인 부대 ${thin}개` }) : null));
    }

    /* ★★ **엔진이 움직였으면 묻지 않고 다시 올린다.**
     *   서버는 방어자의 지문이 낡아도 전투를 거절한다 — 그러면 그 사람은
     *   **아무도 때릴 수 없는 상태**로 순위표에 남아 있게 된다.
     *   같은 편성을 다시 올리는 것뿐이라 사람이 고른 것을 바꾸지 않는다. */
    if (engineMoved()) {
      const r = await registerNow();
      if (r.ok) { dropCache(); go('pvp'); return; }
      /* 다시 올리기에 실패했으면 아래 배지로 넘어간다 — 조용히 무시하지 않는다 */
    }

    /* ★ 등록은 **얼어붙은 사본**이다 — 장비를 갈아 끼워도 서버 쪽은 그대로다.
     *   도전할 때는 자동으로 다시 올리지만, 그 사이에 **방어**는 옛 편성으로 받는다.
     *   그래서 알려는 준다. */
    if (lineupStale(myLineup())) {
      stale.style.display = '';
      stale.textContent = '지금 편성이 등록된 것과 다르다 — 방어는 등록해 둔 편성으로 받는다. (도전할 때는 자동으로 다시 올린다)';
    }
  })();

  return box;
}

function boardPanel() {
  const list = el('div', { class: 'col', style: { gap: '0' } },
    el('div', { class: 'faint tiny', text: '불러오는 중…' }));

  (async () => {
    /* ★ me 와 board 를 **한 약속에서** 꾺낸다 — 따로 받으면 board 가 먼저 왔을 때
     *   «나» 표시(myHandle)가 빈다. 눈에 잘 안 띄는 경합이었다. */
    const d = await pvpData();
    const res = d.board;
    if (!res.ok) { list.textContent = '순위를 불러오지 못했다.'; return; }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) { list.textContent = '아직 등록한 사람이 없다. 첫 번째가 되어라.'; return; }

    const myHandle = d.me.ok && Array.isArray(d.me.data) && d.me.data[0]
      ? d.me.data[0].handle : null;

    list.textContent = '';
    coolBtns = [];
    for (const r of rows) {
      const mine = !!(myHandle && r.handle === myHandle);

      /* ★ 편성은 **줄 아래**에 편다. 격자(.pv-row) 안에 넣으면 열이 어긋난다. */
      const luHost = el('div', { style: { display: 'none', padding: '0 8px 8px' } });
      const luBtn = el('button', {
        class: 'btn sm ghost',
        title: mine ? '내가 등록해 둔 편성을 본다' : '이 용병단의 등록 편성을 본다',
        onClick: () => { toggleBoardLineup(luBtn, luHost, r, mine); },
      }, '편성');

      list.appendChild(el('div', {},
        el('div', { class: `pv-row${mine ? ' pv-me' : ''}` },
        el('div', { class: 'pv-rank', text: String(r.rank) }),
        el('div', { class: 'col', style: { gap: '1px', minWidth: '0' } },
          el('b', { style: { fontSize: '13px' }, text: r.company_name }),
          el('div', { class: 'tiny faint', text: `${r.wins}승 ${r.losses}패` })),
        el('div', { class: 'pv-rt', text: num(r.rating) }),
        /* ★ 편성 버튼과 도전 버튼을 **한 칸에** 넣는다 — 열 수가 그대로라 순위표 배치가 안 흔들린다 */
        el('div', { class: 'row', style: { gap: '4px', alignItems: 'center' } },
          luBtn,
          mine
          ? el('span', { class: 'tiny faint', text: '나' })
          : (() => {
            /* ★★ 쿨타임이면 **버튼 자체를 막고 남은 초를 보인다.**
             *   예전엕 누르면 그제야 «아직 다시 도전할 수 없다» 가 떴다 —
             *   몇 초 남았는지를 알 길이 없었다 (제작자 지적). */
            const left = cooldownLeft(r.handle);
            const b = el('button', {
              class: `btn sm ${left ? 'ghost' : 'ghost'}`,
              disabled: left ? true : undefined,
              title: left ? `${left}초 뒤에 다시 도전할 수 있다` : `${num(CHALLENGE_COST)} 골드를 쓴다`,
              onClick: () => { if (!cooldownLeft(r.handle)) doChallenge(r.handle, r.company_name); },
            }, left ? `${left}초` : '도전');
            if (left) b.classList.add('pv-cool');
            /* 남은 초를 직접 줄이기 위해 버튼과 상대를 짝지어 둔다 */
            coolBtns.push({ el: b, handle: r.handle });
            return b;
          })())),
        luHost));
    }
    if (coolBtns.some(({ handle }) => cooldownLeft(handle))) startCoolTick();
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
      el('div', { class: 'row center', style: { gap: '6px' } },
        /* ★ 서버가 cfg(양쪽 부대 + 시드)를 같이 준다 — 더 받을 것 없이 바로 재생한다.
         *   cfg 가 없으면 matchId 로 받아 온다 — 한쪽만 있어도 볼 수 있어야 한다. */
        (d.cfg || d.matchId) ? el('button', {
          class: 'btn sm primary',
          onClick: () => go('pvpreplay', {
            cfg: d.cfg || null, winner: d.winner, opponentName: d.opponentName,
            role: 'attacker', matchId: d.matchId || null, returnTo: 'pvp',
          }),
        }, '전투 다시 보기') : null,
        el('button', { class: 'btn sm ghost', onClick: () => { lastResult = null; go('pvp'); } }, '닫기'))),
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
      list.appendChild(el('div', { class: 'pv-row pv-5' },
        el('div', { class: 'pv-rank', text: r.role === 'attacker' ? '공' : '방' }),
        el('div', { class: 'col', style: { gap: '1px', minWidth: '0' } },
          el('b', { style: { fontSize: '13px' }, text: r.opponent }),
          el('div', { class: 'tiny faint', text: iWon ? '승리' : (r.winner === 'draw' ? '무승부' : '패배') })),
        el('div', { class: 'pv-rt', style: { color: r.delta >= 0 ? 'var(--leaf)' : 'var(--ink-faint)' },
          text: `${sign}${r.delta}` }),
        /* ★ 전적에서도 다시 볼 수 있어야 한다 — 당한 판을 못 보면
         *   «왜 졌는지» 를 알 길이 없다. pvp_replay 는 공격자·방어자 둘 다 볼 수 있다. */
        el('button', {
          class: 'btn sm ghost',
          title: '이 전투를 다시 본다',
          onClick: () => go('pvpreplay', {
            matchId: r.id, opponentName: r.opponent, role: r.role, returnTo: 'pvp',
          }),
        }, '보기'),
        el('span', { class: 'tiny faint', text: `${r.rating_after}` })));
    }
  })();

  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('h3', { text: '내 전적', style: { margin: '0' } }),
    list);
}
