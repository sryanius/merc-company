// 세이브 파일 내보내기 / 불러오기.
//
// localStorage 세이브는 그 브라우저에만 남는다. 다른 기기나 시크릿 창에서 열면 처음부터다.
// 여기서는 세이브를 JSON 파일로 내려받고 다시 올릴 수 있게 한다. 서버도 로그인도 필요 없다.
//
// DOM을 쓰므로 game/ 이 아니라 ui/ 에 둔다 (SPEC §0: game/ 은 순수 JS 유지).
import { state, save, load, SAVE_KEY, SAVE_VERSION } from '../game/state.js';

const APP_ID = 'merc-company';

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
    state,
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
  const text = JSON.stringify(envelope(), null, 2);
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
export function importSaveText(text) {
  let raw = null;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: '올바른 JSON 파일이 아닙니다.' }; }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '세이브 내용이 비어 있습니다.' };

  // 봉투 형식이면 벗기고, 옛 방식(state를 그대로 저장한 파일)도 받아준다.
  let payload = raw;
  let version = raw.saveVersion;
  if (raw.app && raw.app !== APP_ID) {
    return { ok: false, error: '이 게임의 세이브 파일이 아닙니다.' };
  }
  if (raw.state && typeof raw.state === 'object') payload = raw.state;
  else version = raw.version;

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
export function pickSaveFile(onResult) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onResult(importSaveText(String(reader.result)), file.name);
    reader.onerror = () => onResult({ ok: false, error: '파일을 읽지 못했습니다.' }, file.name);
    reader.readAsText(file);
  });
  document.body.appendChild(input);
  input.click();
}
