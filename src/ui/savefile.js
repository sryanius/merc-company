// 세이브 파일 내보내기 / 불러오기.
//
// localStorage 세이브는 그 브라우저에만 남는다. 다른 기기나 시크릿 창에서 열면 처음부터다.
// 여기서는 세이브를 JSON 파일로 내려받고 다시 올릴 수 있게 한다. 서버도 로그인도 필요 없다.
//
// DOM을 쓰므로 game/ 이 아니라 ui/ 에 둔다 (SPEC §0: game/ 은 순수 JS 유지).
import { state, save, load, SAVE_KEY, SAVE_VERSION, SEAL_MARK } from '../game/state.js';

const APP_ID = 'merc-company';

/* ══════════════════════════ 세이브 봉인 ══════════════════════════
 * 내보낸 파일이 그냥 JSON 이라 메모장으로 골드를 고칠 수 있었다.
 *
 * ★ 먼저 분명히 해 둘 것 — 이건 **암호화가 아니라 봉인(tamper-evident)** 이다.
 *   싱글 플레이 게임이라 열쇠가 클라이언트 안에 있을 수밖에 없고, 이 파일을 읽을 줄 아는
 *   사람은 언제든 되돌릴 수 있다. 목적은 "메모장으로 숫자만 바꾸는" 것을 막는 것이지
 *   작정한 사람을 막는 게 아니다. 그렇게 광고해서도 안 된다.
 *
 * 방식: JSON → UTF-8 → 키스트림 XOR → base64. 체크섬을 같이 실어 한 글자만 바뀌어도 걸린다.
 * 봉투(app/버전/요약)는 **평문으로 남긴다** — 파일만 보고 어느 게임의 언제 세이브인지
 * 알 수 있어야 하고, 그게 이 기능의 원래 쓸모다.
 */

/** 봉인 형식 버전. 방식이 바뀌면 올린다 (옛 파일은 계속 읽을 수 있어야 한다). */
const SEAL_VERSION = 1;

/**
 * 봉인 이전에 내보낸 **평문 세이브 파일**을 열 때 물어보는 암호.
 *
 * ★ 이건 보안이 아니다. 이 파일을 열어 보면 그대로 적혀 있다 —
 *   목적은 "옛 파일로 그냥 이어 하는 것"을 한 번 막아 세우는 것뿐이다.
 *   평문 파일은 메모장으로 골드를 고칠 수 있었으므로 기본은 거절하고,
 *   본인 세이브임을 아는 사람만 통과시킨다.
 */
const LEGACY_PASSWORD = 'qwe123!@#';

/** FNV-1a 32bit — 위·변조 검출용 (충돌 저항이 필요한 용도가 아니다) */
function checksum(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 키스트림 — 시드 하나로 바이트열을 만든다 (xorshift32) */
function* keystream(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  for (;;) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    yield x & 0xff;
    yield (x >>> 8) & 0xff;
    yield (x >>> 16) & 0xff;
    yield (x >>> 24) & 0xff;
  }
}

const SEAL_SALT = 0x4d455243;   // 'MERC'

/** 문자열 → 봉인된 base64 */
function sealText(plain) {
  const bytes = new TextEncoder().encode(plain);
  const ks = keystream(checksum(plain) ^ SEAL_SALT);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks.next().value;
  let bin = '';
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 봉인 해제. 체크섬이 안 맞으면 null (= 누가 건드렸거나 깨진 파일) */
function unsealText(b64, sum) {
  let bin;
  try { bin = atob(String(b64)); } catch { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ks = keystream((sum >>> 0) ^ SEAL_SALT);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks.next().value;
  let plain;
  try { plain = new TextDecoder().decode(out); } catch { return null; }
  return checksum(plain) === (sum >>> 0) ? plain : null;
}

/** 파일에 담기는 봉투. state를 그대로 쓰지 않고 감싸서 자기 서술적으로 만든다. */
function envelope() {
  return {
    app: APP_ID,
    saveVersion: SAVE_VERSION,
    exportedAt: new Date().toISOString(),
    // 파일만 열어봐도 어느 시점 세이브인지 알 수 있게 요약을 남긴다.
    summary: {
      day: state.day,
      gold: state.gold,
      renown: state.renown,
      roster: state.roster?.length ?? 0,
      city: state.cityId,
    },
    // ★ 본문은 봉인해서 담는다. 봉투(위 필드들)는 평문이라 파일만 봐도 무엇인지 안다.
    seal: SEAL_VERSION,
    sum: 0,          // exportSave 에서 채운다
    data: '',        // exportSave 에서 채운다
  };
}

const pad = (n) => String(n).padStart(2, '0');

export function saveFileName() {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `용병단_${state.day}일차_${date}.json`;
}

/** 현재 상태를 JSON 파일로 내려받는다. */
export function exportSave() {
  save(); // 내보내기 전에 최신 상태를 localStorage에도 반영
  const env = envelope();
  const plain = JSON.stringify(state);
  env.sum = checksum(plain);
  env.data = sealText(plain);
  const text = JSON.stringify(env, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = saveFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name: a.download, bytes: blob.size };
}

/**
 * 세이브 버전이 올라갔을 때 옛 파일을 새 형식으로 옮기는 자리.
 * 지금은 버전이 1뿐이라 하는 일이 없지만, 밸런스 수정 때마다 세이브를 버리게 되므로
 * 훅을 미리 열어둔다. 새 버전을 만들면 여기에 단계별 변환을 추가해라.
 */
function migrate(data, from) {
  if (from === SAVE_VERSION) return data;
  return null; // 변환 경로가 없으면 거부
}

/**
 * 파일 텍스트를 읽어 세이브로 적용한다.
 * @returns {{ok:boolean, error?:string, summary?:object}}
 */
export function importSaveText(text, opts = {}) {
  let raw = null;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: '올바른 JSON 파일이 아닙니다.' }; }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '세이브 내용이 비어 있습니다.' };

  // 봉투 형식이면 벗기고, 옛 방식(state를 그대로 저장한 파일)도 받아준다.
  let payload = raw;
  let version = raw.saveVersion;
  if (raw.app && raw.app !== APP_ID) {
    return { ok: false, error: '이 게임의 세이브 파일이 아닙니다.' };
  }
  /* 봉인된 파일이면 풀어서 쓴다. 체크섬이 안 맞으면 **손대지 않고 거절**한다 —
   * 반쯤 고쳐진 세이브를 억지로 살리면 그게 더 나쁘다.
   * 봉인 이전에 내보낸 평문 파일(state 를 그대로 담은 것)도 계속 받는다. */
  if (raw.seal && typeof raw.data === 'string') {
    const plain = unsealText(raw.data, raw.sum);
    if (!plain) {
      return { ok: false, error: '세이브 파일이 손상되었거나 수정되었습니다. 원본을 다시 내보내 주세요.' };
    }
    try { payload = JSON.parse(plain); } catch { return { ok: false, error: '세이브 본문을 읽지 못했습니다.' }; }
  } else {
    /* 봉인 이전 형식(평문)이다. 메모장으로 고칠 수 있던 파일이라 **기본은 거절**한다.
     * 암호를 넣으면 통과시킨다 — 본인 세이브를 잃게 만들 이유는 없다.
     * `needPassword` 를 켜서 호출부가 암호를 물어볼 수 있게 한다. */
    if (opts.password !== LEGACY_PASSWORD) {
      return {
        ok: false,
        needPassword: true,
        error: '예전 형식(암호화 전) 세이브 파일입니다. 그대로는 쓸 수 없습니다.',
      };
    }
    if (raw.state && typeof raw.state === 'object') payload = raw.state;
    else version = raw.version;                 // 아주 옛날: state 를 그대로 저장한 파일
  }

  if (version == null) return { ok: false, error: '세이브 버전 정보가 없습니다.' };
  if (version !== SAVE_VERSION) {
    const migrated = migrate(payload, version);
    if (!migrated) {
      return { ok: false, error: `세이브 버전이 맞지 않습니다. (파일 v${version} / 현재 v${SAVE_VERSION})` };
    }
    payload = migrated;
  }

  // 최소한의 형태 검사 — 깨진 파일로 게임을 망가뜨리지 않는다.
  for (const key of ['day', 'gold', 'roster', 'squads', 'cityId']) {
    if (payload[key] == null) return { ok: false, error: `세이브가 손상되었습니다. (누락: ${key})` };
  }
  if (!Array.isArray(payload.roster) || !Array.isArray(payload.squads)) {
    return { ok: false, error: '세이브가 손상되었습니다. (로스터/부대 형식 오류)' };
  }

  payload.version = SAVE_VERSION;
  /* ★ 관문 표식을 여기서 찍는다.
   *
   *   이걸 빼먹어서 **암호를 맞춰도 불러오기가 실패했다.** 아래 `load()` 는 localStorage 쪽
   *   관문(`needsUnlock` = sealMark 가 없다)을 한 번 더 보는데, 옛 평문 파일의 본문에는
   *   그 필드가 없으니 방금 통과시킨 세이브를 `load()` 가 다시 막아 세우고 `newGame()` 을
   *   돌려 버린다 — 호출부에는 "세이브를 불러오지 못했습니다"만 남고, 그 사이에
   *   **원래 하던 게임까지 날아간다.**
   *
   *   여기까지 왔다는 건 이 함수의 검사(봉인 해제 또는 암호 확인 + 형태 검사)를 전부
   *   지났다는 뜻이다. 그게 곧 관문 통과다. 표식은 한 곳에서만 찍혀야 하므로
   *   state.js 의 상수를 그대로 쓴다. */
  payload.sealMark = SEAL_MARK;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (e) {
    return { ok: false, error: '브라우저 저장소에 쓸 수 없습니다.' };
  }
  const loaded = load();
  if (!loaded) return { ok: false, error: '세이브를 불러오지 못했습니다.' };

  return {
    ok: true,
    summary: raw.summary || { day: payload.day, gold: payload.gold, roster: payload.roster.length },
  };
}

/** 파일 선택 창을 띄우고 결과를 콜백으로 넘긴다. */
export function pickSaveFile(onResult, opts = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onResult(importSaveText(String(reader.result), opts), file.name, String(reader.result));
    reader.onerror = () => onResult({ ok: false, error: '파일을 읽지 못했습니다.' }, file.name);
    reader.readAsText(file);
  });
  document.body.appendChild(input);
  input.click();
}
