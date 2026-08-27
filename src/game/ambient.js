/**
 * 「인자를 안 주면 쓰는 전역」 — 순환을 끊기 위한 한 칸
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 있나
 *   `gear.js` · `merc.js` · `squad.js` 가 `state.js` 를 되물고 있었다.
 *   쓰는 것은 딱 하나 — **「첫 인자를 생략하면 전역 state 를 쓴다」 는 편의 기본값**이다
 *   (그리고 squad 의 `addLog`). 그런데 `state.js` 는 게임 전체를 문다:
 *
 *     merc.js 의 닫힘 = 23개 · 774KB   (quest·world·enemies·abyss·tower 까지 전부)
 *     되물기를 끊으면 = 10개 · 345KB
 *     부대 전력까지   = 14개 · 464KB   ← 이미 배포 중인 전투 엔진 묶음(9개·212KB)과 같은 급
 *
 *   ⇒ **편의 기본값 하나 때문에 게임 전체가 끌려오고 있었다.**
 *     서버(§104)는 언제나 명시적으로 넘기므로 이 칸을 아예 안 쓴다.
 *
 * ★ 왜 스냅샷이어도 되나
 *   `state.js` 는 `export const state = defaultState();` 다 — **재대입이 없고
 *   제자리에서만 고친다.** 그래서 한 번 묶어 둔 참조와 live binding 이 같다.
 *   (재대입이 생기면 이 전제가 깨진다 — 스모크가 그것을 지킨다.)
 *
 * ★ 안 묶인 채로 읽으면 `null` 이다. 예전 `try { globalState } catch { return null }`
 *   가 순환 중 TDZ 에서 내놓던 값과 같다 — 부르는 쪽은 이미 그 경우를 다룬다.
 *
 * @module game/ambient
 */

let _state = null;
let _addLog = null;

/** state.js 가 자기 모듈 끝에서 한 번 부른다 */
export function bindAmbient(o) {
  if (!o) return;
  if (o.state) _state = o.state;
  if (typeof o.addLog === 'function') _addLog = o.addLog;
}

/** 전역 state (안 묶였으면 null) */
export function ambientState() { return _state; }

/** 일지에 한 줄. 안 묶였으면 조용히 넘어간다 (서버엔 일지가 없다) */
export function ambientLog(text) {
  if (typeof _addLog !== 'function') return null;
  try { return _addLog(text); } catch { return null; }
}
