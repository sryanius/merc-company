/**
 * 클라우드 켜기/끄기 상태
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ **기본은 꺼짐이다.** 게임을 켜자마자 계정을 만들지 않는다.
 *   · 익명 가입에는 IP 기준 요청 제한이 있다. 통신사 NAT 뒤에서 여러 명이 동시에
 *     처음 켜면 무더기로 실패한다 — 그게 게임 부팅을 막으면 안 된다.
 *   · 계정은 되돌리기 어려운 물건이다. 플레이어가 원할 때 만드는 게 맞다.
 *
 * ★ 이 값은 **세이브가 아니라 기기 설정이다.** localStorage 에 따로 둔다 —
 *   세이브에 넣으면 파일을 주고받을 때 남의 기기 설정까지 따라간다
 *   (도시 화면 접기 상태를 같은 이유로 세이브 밖에 뒀다).
 *
 * 실제 업로드·복원은 다음 단계에서 이 모듈에 붙는다. 지금은 상태와 연결만 다룬다.
 *
 * @module net/cloud
 */

import { ENABLED } from './config.js';
import * as Auth from './auth.js';

const ON_KEY = 'merc_cloud_on_v1';

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** 플레이어가 클라우드를 켰는가 (기기별 설정) */
export function isOn() {
  if (!ENABLED) return false;
  const ls = storage();
  if (!ls) return false;
  try { return ls.getItem(ON_KEY) === '1'; } catch { return false; }
}

function setOn(v) {
  const ls = storage();
  if (!ls) return;
  try {
    if (v) ls.setItem(ON_KEY, '1');
    else ls.removeItem(ON_KEY);
  } catch (e) {
    console.warn('[cloud] 설정을 저장하지 못했다', e);
  }
}

/** 이 기기에서 클라우드를 쓸 수 있는 상태인가 (켜져 있고 로그인까지 됐는가) */
export function ready() { return isOn() && Auth.signedIn(); }

/**
 * 켠다. 필요하면 익명 계정을 만든다.
 * @returns {Promise<{ok:boolean, error:string}>}
 */
export async function enable() {
  if (!ENABLED) return { ok: false, error: '클라우드 기능이 꺼져 있다' };
  const r = await Auth.signInAnonymously();
  // ★ 로그인에 실패하면 켜지 않는다. "켜졌는데 안 되는" 상태가 가장 나쁘다.
  if (!r.ok) return r;
  setOn(true);
  return { ok: true, error: '' };
}

/**
 * 끈다. **계정은 지우지 않는다** — 다시 켜면 같은 계정으로 이어진다.
 * 세션까지 버리면 랭킹 기록과의 연결이 끊기고 되돌릴 방법이 없다.
 */
export function disable() { setOn(false); }

/** 화면에 띄울 상태 요약 */
export function status() {
  if (!ENABLED) return { on: false, label: '사용 불가', detail: '이 빌드에서는 클라우드가 꺼져 있다.' };
  if (!isOn()) return { on: false, label: '꺼짐', detail: '세이브가 이 기기에만 저장된다.' };
  if (!Auth.signedIn()) return { on: false, label: '연결 끊김', detail: '다시 켜면 연결된다.' };
  return {
    on: true,
    label: '켜짐',
    detail: `계정 ${Auth.userId().slice(0, 8)}…`,
  };
}
