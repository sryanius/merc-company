/**
 * PvP 통신
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ rest.js 의 계약을 그대로 지킨다 — **절대 throw 하지 않고** `{ok, status, data, error}` 를 준다.
 *   화면 코드가 try/catch 로 감싸는 것을 잊어도 게임이 안 죽는다.
 *
 * ★★ 승패는 **서버가 정한다.** 이 모듈은 결과를 «받아 오는» 것이지 «계산해서 올리는» 것이 아니다.
 *   재생(replay)은 서버가 준 시드·편성으로 화면을 다시 그리는 것뿐이고,
 *   화면 결과가 서버와 달라도 **서버 결과가 진실**이다 (그리고 그때 desync 를 남긴다).
 */
import { call, authed } from './rest.js';
import { EP } from './config.js';
import * as Auth from './auth.js';
import { ENGINE_HASH } from '../data/enginever.js';

const FN = () => EP.fn('pvp-battle');

/** uuid v4 — 도전 id 는 클라가 만든다 (서버가 unique 로 중복을 막는다) */
export function newChallengeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/**
 * 방어 편성 등록 — **이것이 곧 내 공격 편성이다.**
 * 등록해 두지 않으면 도전도 못 하고 남에게 도전받지도 않는다.
 *
 * @param {object} p
 * @param {string} p.companyName
 * @param {Array<Array<object>>} p.squads  부대 순서대로의 UnitDef 배열
 * @param {number} p.power
 */
/**
 * 편성 지문 — «지금 편성이 등록해 둔 것과 같은가» 만 묻는다.
 *
 * ★ 보안 장치가 **아니다.** 서버는 이 값을 보지 않는다 — 위조 방어는
 *   statbound.js 가 맡는다. 여기서 거짓말해봐야 손해는 본인 것이다
 *   (낡은 편성으로 싸우게 된다).
 *
 * ★ 32비트로는 충돌 한 번이 «낡은 편성으로 싸움» 으로 이어져서
 *   FNV-1a 두 벌을 엮어 64비트로 둔다. 값이 싸다.
 *
 * @param {any} units 등록할 모양 그대로의 부대 배열
 * @returns {string} 16자 16진수
 */
export function lineupFp(units) {
  const s = JSON.stringify(units);
  let a = 2166136261 >>> 0;
  let b = 2166136343 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ (c + i), 16777639) >>> 0;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export async function registerDefense({ companyName, squads, power, saveRev }) {
  return authed(FN(), {
    method: 'POST',
    body: { register: true, companyName, squads, power, saveRev },
  }, Auth);
}

/**
 * 도전.
 *
 * ★ `challengeId` 를 **호출자가 만들어 보관해라.** 응답을 못 받았을 때 같은 id 로 다시 부르면
 *   서버가 «저장된 결과» 를 그대로 준다 (재실행하지 않는다). 새 id 로 부르면 새 판이다.
 *
 * @param {string} opponentHandle  pvp_board() 가 준 handle
 * @param {string} challengeId     newChallengeId() 로 만든 uuid
 */
export async function challenge(opponentHandle, challengeId) {
  return authed(FN(), {
    method: 'POST',
    body: { challengeId, opponent: opponentHandle, engineHash: ENGINE_HASH },
    timeout: 30_000,          // 서버가 태그매치를 돌린다 — 기본 타임아웃보다 넉넉히
  }, Auth);
}

/** PvP 순위표 (로그인 없이도 본다) */
export async function board(limit = 100) {
  return call(EP.rpc('pvp_board'), { method: 'POST', body: { p_limit: limit } });
}

/**
 * 순위표에 뜬 용병단 하나의 등록 편성.
 *
 * ★ 순위표와 **같은 통로**다 — 로그인 없이도 본다 (`board()` 와 같은 `call`).
 *   한쪽만 로그인을 요구하면 «버튼은 보이는데 눌리면 실패» 가 된다.
 *
 * ★ 목록에 안 싣고 **한 명씩 부른다.** 편성 하나가 약 19KB 라 순위표에 통째로 얹으면
 *   목록이 무거워진다 (§007 의 400KB 교훈).
 *
 * @param {string} handle `pvp_board()` 가 준 handle
 */
export async function lineup(handle) {
  return call(EP.rpc('pvp_lineup'), { method: 'POST', body: { p_handle: handle } });
}

/** 내 레이팅·순위 */
export async function me() {
  return authed(EP.rpc('pvp_me'), { method: 'POST', body: {} }, Auth);
}

/**
 * 내 전적. ★ 내가 **공격자든 방어자든** 낀 판이 전부 나온다 —
 * 자고 있는 동안 누가 나를 쳤는지도 나중에 확인된다.
 */
export async function history(limit = 20) {
  return authed(EP.rpc('pvp_history'), { method: 'POST', body: { p_limit: limit } }, Auth);
}

/**
 * 재생 입력. ★ 방어자도 자기가 당한 판을 똑같이 재생할 수 있다.
 * 남이 낀 판은 함수가 auth.uid() 로 걸러서 안 준다.
 */
export async function replay(matchId) {
  return authed(EP.rpc('pvp_replay'), { method: 'POST', body: { p_id: matchId } }, Auth);
}

/**
 * 재생 결과가 서버와 다를 때 남긴다.
 *
 * ★★ 이것이 «크로스 런타임 발산» 을 **수치로 갖는 유일한 통로**다.
 *   골든 픽스처(§68)는 고정 편성만 본다 — 실제 편성에서 갈리는 것은 이걸로만 안다.
 *   실패해도 조용히 넘긴다. 기록을 못 남긴다고 사용자의 판을 막을 이유는 없다.
 */
export async function reportDesync({ matchId, serverWinner, clientWinner, detail }) {
  try {
    return await authed(EP.rpc('pvp_desync_log'), {
      method: 'POST',
      body: {
        p_match: matchId,
        p_engine_hash: ENGINE_HASH,
        p_server_winner: serverWinner,
        p_client_winner: clientWinner,
        p_detail: detail || null,
        p_ua: (globalThis.navigator?.userAgent || '').slice(0, 200),
      },
    }, Auth);
  } catch {
    return { ok: false, status: 0, error: 'desync 기록 실패' };
  }
}
