/**
 * 랭킹 제출 검증 규칙 — **클라이언트와 서버가 같이 쓴다**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 이 파일이 존재하는 이유
 *   랭킹을 서버에서 검증하려면 "이 값이 게임 규칙상 가능한가"를 판단해야 하는데,
 *   그 판단은 전부 게임 상수에서 나온다(`goldRange`, `TOWER_FLOORS`, `MAX_LEVEL`…).
 *   규칙을 SQL 로 옮겨 적으면 **손으로 베낀 두 번째 사본**이 생기고, 밸런스를 고치는 날
 *   정상 플레이어가 전원 거절당한다. 그래서 규칙은 여기 한 벌만 두고
 *   node(도구) · Deno(Edge Function) · 브라우저가 **같은 파일**을 읽는다.
 *
 * ★ 그래서 이 파일은 순수해야 한다 — DOM 도, 네트워크도, 전역 상태도 안 쓴다.
 *   입력은 인자로만 받는다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 무엇을 막고 무엇을 못 막는가 (정직하게)
 *
 *   막는다:   게임 규칙상 **불가능한** 값.
 *             나락은 주 1회, 탑은 월 1회로 코드가 강제하므로 서버는
 *             "지난주 40심층이던 사람이 이번 주 200심층" 이 거짓임을 **확실히** 안다.
 *   못 막는다: 전투 승패 조작, 아이템 스탯 위조, 규칙 경계 안에서 천천히 부풀리기.
 *
 *   **"조작 방지"가 아니라 "개연성 검사"다.** 그렇게 광고하면 안 된다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 등급
 *   A  물리적으로 불가능 — 오탐이 원리상 0이다. 즉시 거절한다.
 *   B  총량 상한 초과 — 오탐이 **가능하다**. 거절하되 원본을 남겨 사람이 본다.
 *   C  통계적으로 이상 — 표시만 하고 게임은 그대로 둔다.
 *
 *   오탐으로 정상 플레이어를 날리는 게 치트보다 큰 사고다. 그래서 상한은 전부
 *   **넉넉하게** 잡는다 — 아슬아슬하게 잡으면 언젠가 반드시 정상 플레이어가 걸린다.
 *
 * @module game/rules
 */

/* ★ 여기서 import 하는 것은 **전부 의존성 0 모듈**이어야 한다.
 *   이 파일은 Supabase Edge Function(Deno)에서도 그대로 돌아야 하는데,
 *   game/state.js(import 14개)나 game/merc.js(6개)를 물면 게임 전체가 서버로 딸려 간다.
 *   그래서 상수를 `data/limits.js` 로 빼고 원래 자리에서는 다시 내보내게 했다.
 *   **여기에 새 import 를 추가할 때는 그 모듈의 import 도 0인지 확인해라.**
 *   (tools/syncshared.mjs 가 이 조건을 검사한다) */
import { DEPTH_CAP, goldRange, weekIndex } from './abyss.js';
import { TOWER_FLOORS } from './tower.js';
import { MAX_LEVEL, DAYS_PER_WEEK, DAYS_PER_MONTH, MAX_SQUADS, ROSTER_CAP_MAX } from './limits.js';

/** 랭킹에 올라가는 값만 뽑아낸다. 세이브 전체를 서버에 판단시키지 않는다. */
/**
 * 클라가 **점수만** 보냈을 때 그 모양을 못 박는다.
 * ────────────────────────────────────────────────────────────────
 *
 * ★ 왜 필요한가. 예전엔 클라가 **세이브 전체**를 올렸고 서버가 `extractScore` 로 접었다.
 *   그런데 서버가 실제로 쓰는 것은 접힌 30칸뿐이고 나머지는 통째로 버려졌다 —
 *   실측 낭비율 **97.4%** (보내는 107.7KB / 쓰는 2.8KB), 1MB 세이브에선 99.7%.
 *
 * ★★ 신뢰 경계는 안 바뀐다. `extractScore` 는 세이브의 **순수 투영**이고, 조작자는
 *   어차피 세이브를 위조한다 — 접기 전에 위조하나 접은 뒤에 위조하나 같다.
 *   판정은 지금도 앞으로도 **이 30칸에 대고** 한다.
 *
 * ★ 잃는 것 하나는 적어 둔다: 「나중에 원본 세이브로 검사를 더한다」 는 문이 닫힌다.
 *   §113 이 이미 그 문의 값을 쟀다 — 아이템은 소급 검증이 **불가능**하다. 그리고
 *   전환 계획대로 명부가 `run_*` 로 올라오면 서버는 원본보다 나은 것을 갖게 된다.
 *
 * ★★ 이 함수가 옳다는 증거는 **항등식 하나**다:
 *     `normalizeScore(extractScore(save))` 가 `extractScore(save)` 와 **똑같아야 한다.**
 *   스모크가 실제 세이브 여러 벌로 그걸 굴린다. 칸이 새로 생기면 그날 물린다.
 */

/* 음이 아닌 정수 칸. ★ 목록을 손으로 적었지만, 위 항등식이 빠진 칸을 잡는다. */
const SCORE_INTS = [
  'day', 'abyssBest', 'abyssBestDay', 'abyssLastRunDay',
  'towerBest', 'towerBestDay', 'towerLastRunDay',
  'questsDone', 'battlesWon', 'battlesLost', 'gold', 'renown',
  'rosterN', 'rosterCap', 'topLevel', 'squadsN', 'petsN', 'itemsN',
  'sMercs', 'hires', 'specHires', 'hiredN', 'topPower',
];

/* ★ 배열 길이 상한 — 정상 명부는 100을 안 넘는다(rosterCap 상한).
 *   이건 판정이 아니라 **자원 방어**다. 넘치는 것을 «거절» 하지 않고 자른다:
 *   자르면 sMercs 와 어긋나 §118 이 판정하고, 거절하면 오탐이 된다. */
const S_DAYS_MAX = 500;

export function normalizeScore(raw) {
  /* ★ 배열도 `typeof === 'object'` 다 — 안 걸러 내면 `[]` 가 «점수» 로 통과한다.
   *   (스모크의 쓰레기 판이 실제로 이걸 잡았다.) */
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};

  /* seed·dataVersion 은 «0 이상» 을 걸지 않는다 — extractScore 와 정확히 같은 식을 쓴다.
   *   (clamp 를 더하면 항등식이 깨지고, seed 가 어긋나면 sameRun 이 통째로 무너진다.) */
  out.seed = Number(raw.seed) || 0;
  out.dataVersion = Number(raw.dataVersion) || 0;

  for (const k of SCORE_INTS) out[k] = Math.max(0, Math.round(Number(raw[k]) || 0));

  /* ★ `extractScore` 와 **글자 그대로 같은 식**이어야 한다 — 코드포인트 단위로 자른다
   *   (이모지가 24번째에 걸리면 UTF-16 slice 는 반쪽을 남긴다). */
  out.companyName = Array.from(String(raw.companyName || '용병단')).slice(0, 24).join('');
  out.cityId = typeof raw.cityId === 'string' ? raw.cityId : null;

  out.sHiredDays = Array.isArray(raw.sHiredDays)
    ? raw.sHiredDays.slice(0, S_DAYS_MAX).map((n) => Math.max(0, Math.round(Number(n) || 0)))
    : [];

  /* ★★ **개수가 `sMercs` 와 같아야 한다.** 이게 없으면 §118(소급 S 상한)이 스스로 꺼진다 —
   *   빈 배열로 보내면 그 루프가 아예 안 돌기 때문이다.
   *
   *   실측: 900일차·S 8명을 «전부 초기에 몰아 받은» 판에서
   *     sHiredDays 실음 → flag(「10일차까지 S 6명 · 그 시점 상한 5」)
   *     sHiredDays 뺌   → **ok** ← 소급 검사가 유일한 방어였던 자리다.
   *
   * ★ 판정이 아니라 **모양 오류**로 막는다 (`null` → 서버가 400). 「없다」 는 치트의 증거가
   *   아니라 «못 읽었다» 이고, 표식을 붙이면 정상 계정을 물 여지가 생긴다.
   *   정상 클라는 `extractScore` 가 둘을 **같은 명부에서** 뽑으므로 언제나 같다 (12판 12/12).
   *   ⇒ 이 거절은 손으로 지은 본문만 맞는다. */
  if (out.sMercs > 0 && out.sHiredDays.length !== out.sMercs) return null;

  /* ★ 표시용 둘은 여기서 안 만진다 — `submit-score/index.ts` 의 화이트리스트가
   *   이미 «아는 필드만» 남긴다 (§58). 두 벌이 되면 갈라진다. */
  out.squad = raw.squad && typeof raw.squad === 'object' && !Array.isArray(raw.squad) ? raw.squad : null;
  /* ★ `[]` 가 아니라 `null` 로 떨어뜨린다 — `allSquadsOf` 는 부대가 없으면 **`null`** 을
   *   내기 때문이다(rules.js:227). `[]` 로 바꾸면 항등식이 그 판에서 깨진다.
   *   (`sanitizeSquadsFull` 은 둘 다 null 로 접으므로 DB 행은 어차피 같다 — 그래도
   *    항등식은 항등식이다. 깨진 채 두면 다음 사람이 「원래 그런가 보다」 로 지나간다.) */
  out.squadsFull = Array.isArray(raw.squadsFull) ? raw.squadsFull : null;

  return out;
}

export function extractScore(st) {
  if (!st || typeof st !== 'object') return null;
  const roster = Array.isArray(st.roster) ? st.roster : [];
  let topLevel = 1;
  for (const m of roster) if (m && (m.level || 1) > topLevel) topLevel = m.level;

  return {
    seed: Number(st.seed) || 0,
    /* ★ 세이브의 데이터 버전. 서버가 «이 세이브가 리셋을 거쳤나» 를 판단하는 데 쓴다.
     *   실제로 필요했다 — 랭킹을 리셋했는데 **서비스워커에 캐시된 옛 클라이언트**가
     *   그대로 돌면서 옛 기록을 다시 올려 리셋을 되돌렸다 (HANDOFF §41). */
    dataVersion: Number(st.dataVersion) || 0,
    /* ★ `slice` 는 UTF-16 단위로 자른다 — 이모지가 든 이름이 24번째에서 걸리면
     *   서러게이트 쌍이 반으로 쪼개져 깨진 글자가 서버에 저장된다.
     *   코드포인트 단위로 세야 한다. */
    companyName: Array.from(String(st.companyName || '용병단')).slice(0, 24).join(''),
    day: Number(st.day) || 1,
    abyssBest: Number(st.abyss?.best) || 0,
    abyssBestDay: Number(st.abyss?.bestDay) || 0,
    abyssLastRunDay: Number(st.abyss?.lastRunDay) || 0,
    towerBest: Number(st.tower?.best) || 0,
    towerBestDay: Number(st.tower?.bestDay) || 0,
    towerLastRunDay: Number(st.tower?.lastRunDay) || 0,
    questsDone: Number(st.stats?.questsDone) || 0,
    battlesWon: Number(st.stats?.battlesWon) || 0,
    battlesLost: Number(st.stats?.battlesLost) || 0,
    gold: Number(st.gold) || 0,
    renown: Number(st.renown) || 0,
    cityId: typeof st.cityId === 'string' ? st.cityId : null,
    rosterN: roster.length,
    rosterCap: Number(st.rosterCap) || 20,
    topLevel,
    squadsN: Array.isArray(st.squads) ? st.squads.length : 0,
    petsN: Array.isArray(st.pets) ? st.pets.length : 0,
    itemsN: Array.isArray(st.items) ? st.items.length : 0,
    /* ★ 순위 축을 늘리려고 더한 값들 (플레이어 요청).
     *   둘 다 **본인 신고**다 — 서버가 계산하지 않는다. 상한은 checkStatic 이 건다. */
    sMercs: roster.reduce((a, m) => a + (m && m.grade === 'S' ? 1 : 0), 0),
    /* 고용 계량기 — «S 가 이만큼 나올 수 있는 횟수였나» 를 묻는 데 쓴다 (checkGrowth).
     * 옛 세이브는 0 이라, 전체가 아니라 **증가분끼리** 비교해야 한다. */
    hires: Number(st.stats?.hires) || 0,
    specHires: Number(st.stats?.specHires) || 0,
    /* ★★ 「고용된 단원 수」를 **명부에서 직접 센다.**
     *
     *   `stats.hires` 는 계량기라 **생기기 전부터 하던 사람은 0** 이다 — 그걸로 총량을
     *   재면 오래 한 정상 플레이어가 전부 걸린다. 반면 `hiredDay` 는 **최초 커밋부터**
     *   있었고 `addMerc` 가 항상 채운다(호출자는 주점 하나뿐이다). 그래서 옛 세이브에도
     *   빠짐없이 들어 있다 — 계량기 대신 쓸 수 있는 유일한 파생값이다.
     *
     *   새 게임 시작 단원 4명은 `hiredDay = 1` 이고 등급이 C·C·D·D 로 **고정**이다
     *   (state.js newGame). 즉 **S 는 반드시 고용된 사람**이다. */
    /* ★ `hiredDay` 가 **오늘 이전**이어야 센다.
     *   예전엔 `> 1` 만 봤다. 그래서 1일차 세이브에 `hiredDay: 2` 를 적어 넣으면
     *   «고용된 단원» 이 늘어나 `sMercs > hiredN + START_ROSTER` 검사가 헐거워졌다 (§96). */
    hiredN: roster.reduce((a, m) => {
      const hd = Number(m && m.hiredDay) || 0;
      return a + (hd > 1 && hd <= (Number(st.day) || 0) ? 1 : 0);
    }, 0),
    /* ★★★ **S 를 «언제 얻었는가» 로 소급해서 센다** (§118).
     *
     *   `sMercs` 상한은 «오늘» 기준이라, 일차가 커지면 상한도 같이 커진다.
     *   그래서 **1일차에 S 4명을 만들어 넣고 274일차까지 굴리면 통과한다** —
     *   실제로 그 계정이 08-26 에 「S 용병 4명 · 1일차 상한 2」로 걸렸다가,
     *   일차를 키우자 상한이 17 이 되어 조용히 통과했다.
     *
     *   ★ 그런데 **증거는 세이브에 그대로 남아 있다.** 시작 단원 4명은 `hiredDay = 1` 이고
     *     등급이 C·C·D·D 로 **고정**이므로, 1일차 S 는 «그날 고용했다» 는 뜻이다.
     *   ⇒ 고용 시점을 오름차순으로 놓고 «그 시점의 상한» 을 하나씩 물으면 그때 걸린다.
     *
     *   ★ 오늘 이후·없는 값은 **오늘로 본다** (플레이어에게 유리한 쪽).
     *     `hiredDay` 를 지워서 피하려 하면 위 `hiredN` 이 줄어
     *     `sMercs > hiredN + START_ROSTER` 가 대신 문다 (A등급 거절). */
    sHiredDays: roster
      .filter((m) => m && m.grade === 'S')
      .map((m) => {
        const hd = Math.round(Number(m.hiredDay) || 0);
        const day = Math.max(1, Math.round(Number(st.day) || 1));
        return hd >= 1 && hd <= day ? hd : day;
      })
      .sort((a, b) => a - b),
    topPower: Math.round(Math.max(0, ...(Array.isArray(st.squads) ? st.squads : [])
      .map((sq) => Number(sq && sq.power) || 0), 0)),
    squad: topSquadOf(st),
    squadsFull: allSquadsOf(st),
  };
}

/**
 * **모든 부대**의 상세 — 순위표에서 «눌렀을 때» 만 쓴다.
 *
 * ★★ 목록에 실으면 안 된다. 순위표는 200행을 한 번에 주는데
 *   전 부대 상세가 1인당 ~2KB 라 **400KB** 가 된다 (요약은 150B → 30KB).
 *   그래서 `squad`(요약)는 목록에, 이건 **누른 한 사람 것만** 따로 받는다.
 *
 * ★ 장비를 낱개로 담지 않는다 — 1인당 5.8KB(200행 1.1MB)가 되고,
 *   빌드에서 정작 의미 있는 건 «무슨 세트를 맞췄나» 다. 세트 id 만 담는다.
 */
function allSquadsOf(st) {
  const squads = Array.isArray(st?.squads) ? st.squads : [];
  const roster = Array.isArray(st?.roster) ? st.roster : [];
  const items = Array.isArray(st?.items) ? st.items : [];
  if (!squads.length) return null;
  const byUid = new Map(roster.filter((m) => m && m.uid).map((m) => [m.uid, m]));
  const itemById = new Map(items.filter((i) => i && i.uid).map((i) => [i.uid, i]));
  const cut = (v, n) => Array.from(String(v ?? '')).slice(0, n).join('');

  const out = [];
  for (const sq of squads.slice(0, MAX_SQUADS)) {
    const mems = (sq?.memberUids || []).map((u) => byUid.get(u)).filter(Boolean).slice(0, 7);
    if (!mems.length) continue;
    out.push({
      n: cut(sq.name || '부대', 16),
      f: cut(sq.formationId || 'basic', 24),
      /* ★ 부대 전력. `squad.js stampSquadPower()` 가 제출 직전에 찍는다 —
       *   여기서는 계산할 수 없다 (의존성 0 제약). 없으면 그냥 뺀다. */
      p: Math.round(Number(sq.power) || 0) || undefined,
      m: mems.map((m) => {
        /* 그 사람이 맞춘 세트 — 같은 세트 id 가 몇 칸인지까지 담아야 «몇 세트» 가 읽힌다 */
        const setCount = {};
        for (const iid of Object.values(m.equipment || {})) {
          const it = itemById.get(iid);
          if (it && it.setId) setCount[it.setId] = (setCount[it.setId] || 0) + 1;
        }
        const sets = Object.entries(setCount)
          .sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([id, n]) => `${cut(id, 24)}:${n}`);
        return {
          c: cut(m.classId, 24),
          /* ★ 단원 이름 — 제작자 요청: 「클래스명 대신 내 용병 이름으로. 용병이름 (클래스)」.
           *   ★★ 이 필드를 더했으면 **submit-score 의 sanitizeSquadsFull 도 같이** 고쳐야 한다.
           *      거기는 «아는 필드만 남기는» 화이트리스트라 안 고치면 조용히 버려진다 (§58). */
          nm: cut(m.name, 16),
          l: Math.max(1, Math.min(MAX_LEVEL, Number(m.level) || 1)),
          g: cut(m.grade, 1),
          /* ★ **실제로 낀 것만** 센다. state.js 의 normalizeEquipment 가 10칸을 null 로
           *   채워 두므로 Object.keys 로 세면 **누구나 항상 10** 이 된다 —
           *   순위표의 «착용 칸 수» 가 전원 10 으로 올라가고 있었다 (실측: 실제 2, 표시 10). */
          e: Object.values(m.equipment || {}).filter(Boolean).length,
          s: sets.length ? sets : undefined,
        };
      }),
    });
  }
  return out.length ? out : null;
}

/**
 * 순위표에 보여 줄 **대표 부대** 스냅샷.
 *
 * ★ 자랑거리를 보여 주는 게 목적이라 «가장 센 부대» 하나만 담는다.
 *   부대 5개를 다 담으면 행 하나가 몇 KB 가 되고, 순위표는 200행을 한 번에 받는다.
 *
 * ★ 담는 것은 **게임 정보뿐**이다 — 클래스·레벨·등급·세트. 세이브 원문이나
 *   개인 정보는 절대 안 넣는다. 그리고 이건 클라이언트가 스스로 신고하는 값이라
 *   «검증된 편성» 이 아니다. 화면에도 그렇게 쓰면 안 된다.
 *
 * @returns {{name:string, power:number, members:Array}|null}
 */
function topSquadOf(st) {
  const squads = Array.isArray(st?.squads) ? st.squads : [];
  const roster = Array.isArray(st?.roster) ? st.roster : [];
  if (!squads.length || !roster.length) return null;
  const byUid = new Map(roster.filter((m) => m && m.uid).map((m) => [m.uid, m]));

  /* ★★ 순위표에 내거는 부대는 **제작자가 고른다** (state.flagSquadId).
   *   예전엔 «레벨 합이 가장 높은 부대» 를 자동으로 골랐는데, 내걸고 싶은 부대와
   *   가장 키운 부대가 늘 같지는 않다 (제작자 지적: 「대표부대를 지정할 수 있게」).
   *   고르지 않았으면 **첫 부대(1부대)** 다 — «자동으로 제일 센 놈» 이 아니다. */
  const memsOf = (sq) => (sq?.memberUids || []).map((u) => byUid.get(u)).filter(Boolean);
  let best = null;
  const flagged = st?.flagSquadId && squads.find((q) => q && q.id === st.flagSquadId);
  if (flagged) {
    const mems = memsOf(flagged);
    if (mems.length) best = { sq: flagged, mems };
  }
  if (!best) {
    for (const sq of squads) {
      const mems = memsOf(sq);
      if (mems.length) { best = { sq, mems }; break; }
    }
  }
  if (!best) return null;

  const cut = (v, n) => Array.from(String(v ?? '')).slice(0, n).join('');
  return {
    name: cut(best.sq.name || '부대', 16),
    power: Math.round(Number(best.sq.power) || 0) || undefined,
    members: best.mems.slice(0, 7).map((m) => ({
      c: cut(m.classId, 24),                       // 클래스 id — 이름은 받는 쪽이 찾는다
      l: Math.max(1, Math.min(MAX_LEVEL, Number(m.level) || 1)),
      g: cut(m.grade, 1),
      /* ★★ 단원 이름. 제작자 요청—「클래스명 대신 내 용병 이름으로」.
       *   상세용 allSquadsOf 에만 넣었다가 **목록은 그대로 클래스명이었다** —
       *   순위표에 실리는 건 이쪽(topSquadOf)이다. 둘은 별도의 함수라 같이 고쳐야 한다.
       *   ★ 뒤따라 서버 sanitizeSquad 도 같이 고쳐야 한다 — 안 그러면 조용히 버려진다.
       *   크기: 200행 기준 원본 +41KB(행당 +210B), gzip +0.2KB — 재 보고 넣었다. */
      nm: cut(m.name, 16),
    })),
  };
}

/* ─────────────────────────── A등급: 불가능 ───────────────────────────
 * 여기 걸리는 값은 **어떤 플레이로도 나올 수 없다.** 오탐이 원리상 0이라
 * 사람 확인 없이 바로 거절한다. */

/** 값 자체가 범위를 벗어났는가 */
export function checkStatic(s) {
  const bad = [];
  if (!s) return ['점수를 읽지 못했다'];
  if (s.day < 1) bad.push(`day=${s.day}`);
  if (s.abyssBest < 0 || s.abyssBest > DEPTH_CAP) bad.push(`나락 ${s.abyssBest} (상한 ${DEPTH_CAP})`);
  if (s.towerBest < 0 || s.towerBest > TOWER_FLOORS) bad.push(`탑 ${s.towerBest} (상한 ${TOWER_FLOORS})`);
  if (s.topLevel < 1 || s.topLevel > MAX_LEVEL) bad.push(`최고레벨 ${s.topLevel} (상한 ${MAX_LEVEL})`);
  if (s.questsDone < 0) bad.push(`의뢰 ${s.questsDone}`);
  if (s.squadsN < 0 || s.squadsN > MAX_SQUADS) bad.push(`부대 ${s.squadsN}`);
  if (s.rosterN < 0 || s.rosterN > ROSTER_CAP_MAX) bad.push(`단원 ${s.rosterN}`);
  if (s.gold < 0) bad.push(`골드 ${s.gold}`);

  // 기록을 세운 날이 현재 일차를 넘을 수 없다
  if (s.abyssBest > 0 && s.abyssBestDay > s.day) bad.push(`나락 기록일 ${s.abyssBestDay} > 현재 ${s.day}`);
  if (s.towerBest > 0 && s.towerBestDay > s.day) bad.push(`탑 기록일 ${s.towerBestDay} > 현재 ${s.day}`);
  // 이긴 판보다 끝낸 의뢰가 많을 수 없다 (의뢰 하나에 최소 한 판)
  if (s.battlesWon < s.questsDone) bad.push(`승리 ${s.battlesWon} < 의뢰 ${s.questsDone}`);

  /* ★★ 완료 의뢰·명성에 **일차 기준 상한**을 건다.
   *
   *   여기가 뚫려 있었다. `checkGrowth` 가 «하루에 이만큼 이상 늘 수 없다» 를 보지만
   *   그건 **지난 제출과 비교**하는 검사라, `prev` 가 없는 **첫 제출은 통과한다.**
   *   즉 처음부터 «1일차, 의뢰 99999건» 으로 올리면 아무 검사에도 안 걸렸다.
   *   실제로 순위표 완료 의뢰 칸에 그런 기록이 올라왔다 (HANDOFF §57).
   *
   *   상한은 게임이 코드로 강제하는 값에서 나온다: 부대 5개 × 하루 5건.
   *   그 **두 배**까지 봐준다 — 규칙이 바뀌어도 정상 플레이어가 걸리지 않게. */
  /* ★★★ 의뢰 상한을 **재서 조였다** (§121). 예전엔 `day × 50` (= 5 × 5 × 2) 이었다.
   *
   *   무방비 축을 전부 열어 놓고 훑어 보니, 첫 제출로 349일차에 **의뢰 17,450건**이
   *   통과했다 — 실계정 최고(3055일차 1,145건)의 **15배**다. 완료의뢰는 순위 축이라
   *   그것만으로 1위가 된다.
   *
   * ★ 실측한 «하루당» 비율:
   *     실계정 최고 2.38/일 (그마저 치트 계정) · 정상 최고 1.68/일 · 3055일차는 0.37/일
   *   ★ 이론상 가용량: 도시 목록이 최대 18건이고 3일마다 갱신 → 대략 **6건/일**.
   *     (`recallSquad` 가 공짜라 «부대 5개 × 1일» 로는 안 잡힌다 — 가용량이 진짜 벽이다.)
   *
   * ⇒ `day × 15 + 200`. 가용량의 **2.5배**, 실측 최고의 **6배** 여유다.
   *   상수항 200 은 **1일차** 때문이다 — 그날 목록 18건을 다 돌 수 있으므로
   *   비례항만 두면 초반에 오탐이 난다.
   *
   * ★ 명성 상한이 이걸 따라가므로 같이 조여진다 (아래). */
  const questCap = s.day * (MAX_QUESTS_PER_DAY * 3) + 200;
  if (s.questsDone > questCap) {
    bad.push(`의뢰 ${s.questsDone}건 (${s.day}일차 상한 ${questCap})`);
  }
  /* 명성도 같다 — 의뢰에서만 나오므로 의뢰 상한을 넘을 수 없다. */
  const renownCap = questCap * 60 + 1000;
  if (s.renown > renownCap) bad.push(`명성 ${s.renown} (${s.day}일차 상한 ${renownCap})`);

  /* S 용병은 명부 안에 있어야 하고, 부대 전력은 «전원 만렙 S» 를 넘을 수 없다.
   * 전력 상한은 후하게 잡는다 — 장비·진형 보정이 밸런스에 따라 움직이므로
   * 조이면 패치 때마다 오탐이 난다. */
  if (s.sMercs < 0 || s.sMercs > s.rosterN) bad.push(`S 용병 ${s.sMercs} (단원 ${s.rosterN})`);
  if (s.topPower < 0 || s.topPower > POWER_CAP) bad.push(`부대 전력 ${s.topPower} (상한 ${POWER_CAP})`);

  /* ★★ **총량 불변식** — 이력이 필요 없다. 여기가 이 검증의 새 바닥이다.
   *
   *   조작 기록 하나가 이렇게 들어왔다: 총 고용 4회인데 S 용병 17명, 단원 17명.
   *   기존 검사는 전부 «지난번보다 얼마나 늘었나» 를 보는 것이라, 한 번 통과해
   *   원장이 생기고 나면 조금씩 올리는 것을 막지 못했다 (실제 세이브는 단원 36명 전원 S,
   *   그중 **시작 단원 4명까지 S** 였다 — 시작 등급은 C·C·D·D 로 고정인데도).
   *
   *   아래 둘은 «게임이 코드로 강제하는 것» 에서 바로 나오므로 오탐이 없다:
   *     · 명부는 정원을 넘을 수 없다.
   *     · S 는 고용으로만 생긴다 (시작 단원은 C·C·D·D 고정, 등급은 나중에 안 바뀐다).
   *
   *   여유(START_ROSTER)를 두는 이유: **1일차에 고용하면** `hiredDay === 1` 이라
   *   시작 단원과 구분이 안 되어 hiredN 이 그만큼 덜 세어진다. 시작 골드로는
   *   많아야 두 명이므로 4는 넉넉하다. */
  if (s.rosterCap > 0 && s.rosterN > s.rosterCap) {
    bad.push(`단원 ${s.rosterN}명 (정원 ${s.rosterCap})`);
  }
  if (Number.isFinite(s.hiredN) && s.sMercs > s.hiredN + START_ROSTER) {
    bad.push(`S 용병 ${s.sMercs}명 · 고용된 단원 ${s.hiredN}명`);
  }
  return bad;
}

/**
 * 입장 제한이 지켜졌는가.
 * ★ 이게 이 검증의 **가장 강한 무기**다. 나락은 주 1회, 탑은 월 1일에만 열린다 —
 *   게임이 코드로 강제하므로 서버는 "얼마나 자주 기록이 오를 수 있는가"를 정확히 안다.
 */
export function checkCadence(prev, s) {
  const bad = [];
  if (!prev || !s) return bad;                // 첫 제출은 비교 대상이 없다

  if (s.day < prev.day) { bad.push(`일차가 뒤로 갔다 ${prev.day} → ${s.day}`); return bad; }

  /* ★ 날짜 차이가 아니라 **입장 기록**으로 판단한다.
   *
   *   처음에는 "지난 제출 이후 며칠 지났나"로 셌는데, 그러면 같은 날 제출 두 번에
   *   기록이 40 → 200 으로 뛰어도 통과했다(계측기가 잡았다).
   *   반대로 날짜만 조이면 오탐이 난다 — 같은 날 두 번 제출하는 것 자체는 정상이고,
   *   그 사이에 진짜로 잠수를 한 번 했을 수도 있다.
   *
   *   정확한 규칙은 이것이다: **기록은 잠수(등반) 중에만 오른다.**
   *   그리고 잠수는 주 1회, 등반은 월 1회로 게임이 코드로 강제한다.
   *   그러니 기록이 올랐다면 `lastRunDay` 가 **새 주(달)**로 넘어가 있어야 한다.
   *   이건 날짜 산술이 아니라 게임 규칙 그대로라 오탐이 원리상 없다. */

  const abyssWeek = (d) => (d > 0 ? weekIndex(d) : -1);
  if (s.abyssBest > prev.abyssBest) {
    if (abyssWeek(s.abyssLastRunDay) <= abyssWeek(prev.abyssLastRunDay)) {
      bad.push(`나락 기록이 올랐는데 새로 잠수한 주가 없다 `
        + `(지난 잠수 ${prev.abyssLastRunDay}일 · 이번 ${s.abyssLastRunDay}일 · 주 1회)`);
    }
    if (s.abyssBestDay > 0 && s.abyssLastRunDay > 0 && s.abyssBestDay > s.abyssLastRunDay) {
      bad.push(`나락 기록일(${s.abyssBestDay})이 마지막 잠수일(${s.abyssLastRunDay})보다 뒤다`);
    }
  }

  const towerMonth = (d) => (d > 0 ? Math.floor((d - 1) / DAYS_PER_MONTH) : -1);
  if (s.towerBest > prev.towerBest) {
    if (towerMonth(s.towerLastRunDay) <= towerMonth(prev.towerLastRunDay)) {
      bad.push(`탑 기록이 올랐는데 새로 등반한 달이 없다 `
        + `(지난 등반 ${prev.towerLastRunDay}일 · 이번 ${s.towerLastRunDay}일 · 월 1회)`);
    }
    if (s.towerBestDay > 0 && s.towerLastRunDay > 0 && s.towerBestDay > s.towerLastRunDay) {
      bad.push(`탑 기록일(${s.towerBestDay})이 마지막 등반일(${s.towerLastRunDay})보다 뒤다`);
    }
  }

  // 단조성 — 이 셋은 절대 줄지 않는다
  if (s.abyssBest < prev.abyssBest) bad.push(`나락 기록이 줄었다 ${prev.abyssBest} → ${s.abyssBest}`);
  if (s.towerBest < prev.towerBest) bad.push(`탑 기록이 줄었다 ${prev.towerBest} → ${s.towerBest}`);
  if (s.questsDone < prev.questsDone) bad.push(`의뢰 수가 줄었다 ${prev.questsDone} → ${s.questsDone}`);
  return bad;
}

/* ─────────────────────────── B등급: 총량 상한 ───────────────────────────
 * 여기는 **오탐이 가능하다.** 그래서 상한을 넉넉히 잡고, 걸려도 게임은 그대로 두고
 * 랭킹에서만 숨긴다(제작자 결정). 원본을 남겨 사람이 확인할 수 있게 한다. */

/** 하루에 부대 하나가 끝낼 수 있는 의뢰 수의 넉넉한 상한 */
export const MAX_QUESTS_PER_DAY = 5;

/** 새 게임이 주는 시작 단원 수. state.js newGame 이 4명을 C·C·D·D 로 준다 — **S 는 없다.** */
export const START_ROSTER = 4;

/** 명물 슬롯의 S 확률 상한 (merc.js SPEC_S_MAX_BY_TIER 의 최댓값). 일반 슬롯은 0 이다. */
export const S_CHANCE_MAX = 0.05;
/** 운을 봐주는 배수. 4배면 실효 20% — 이걸 넘으면 확률로는 설명이 안 된다. */
export const S_LUCK_SLACK = 4;

/* ── 탐침 차단 ─────────────────────────────────────────────────
 *
 * ★★ 제작자: 「해킹하려면 차단되는거 여러번 반복할껀데 이거 체크해서도 막을수있나?」
 *
 *   막을 수 있다. 실제로 그 공격이 일어났고 `rejections` 에 시간순으로 남아 있다 —
 *   전력 값을 5285956 → 5296011 → 5535173 → 5720690 → 5763505 로 바꿔 가며 찔렀다.
 *
 * ★★ 사유는 이미 안 알려 준다 (§55). 그런데 **«걸렸다» 그 자체가 1비트 신탁**이라
 *   그것만으로 이분 탐색이 된다. 몇 번 반복되면 그 한 비트마저 닫는다.
 *
 * ★ 정상 플레이어에게 드는 비용이 0 에 가깝다 — **거절당한 사람은 이미 순위표에 없다.**
 *   조용해져도 잃을 게 없고, 조작자는 유일한 신호를 잃는다.
 *
 * ★ 그래도 **처음 몇 번은 알려 준다.** 오탐이면 그 메시지가 유일한 단서다.
 */

/** 세는 기간 (시간) */
export const PROBE_WINDOW_H = 24;
/** 이 횟수를 넘으면 «걸렸다» 를 더 이상 알려 주지 않는다 */
export const PROBE_QUIET = 3;
/** 이 횟수를 넘으면 **받아들인 기록도** 순위에서 잡아 둔다 (사람이 푼다) */
export const PROBE_HOLD = 12;

/**
 * 최근 거절 횟수로 이번 응답을 어떻게 할지 정한다.
 *
 * ★ 순수 함수로 둔 이유: 검사가 **굴려 볼 수 있어야** 한다.
 *   엣지 함수 안에 if 로 흩어 놓으면 스모크가 글자로만 볼 수 있고,
 *   글자 검사는 값이 헐거워져도 안 문다 (이 저장소가 여러 번 당했다).
 *
 * @param {number} recentRejects `PROBE_WINDOW_H` 시간 안의 A등급 거절 횟수
 * @returns {{quiet:boolean, hold:boolean}} quiet=성공과 구분 불가하게 답한다 · hold=순위에서 잡아 둔다
 */
export function probePolicy(recentRejects) {
  const n = Math.max(0, Number(recentRejects) || 0);
  return { quiet: n >= PROBE_QUIET, hold: n >= PROBE_HOLD };
}

/** 하루에 볼 수 있는 명물 후보를 아주 후하게 잡은 수.
 *  주점 목록은 도시 하나에 최대 6명이고(`state.js genTavern`) 그중 명물만 S 가 나온다.
 *  여러 도시를 도는 경우까지 감안해 6 으로 둔다 — **넓히는 쪽으로 후하게**. */
export const SPEC_HIRES_PER_DAY = 6;

/**
 * 레벨별 **부대 전력 천장** — `node tools/powerceiling.mjs` 실측.
 *
 * ★★ 손으로 «커 보이는 수» 를 적지 않는다. 예전 `POWER_CAP` 이 정확히 그 실수였다:
 *   5,000,000 으로 적어 두고 **바로 위 주석에는 「실측 74,148」** 이라 써 놨다.
 *   재 놓고 안 쓴 것이다. 그 틈으로 전력 259,803 짜리 등재가 순위 1위에 올라왔다 (§96).
 *
 * ★ 재는 방식은 클라이언트의 `squadPower` 와 같다 — 7칸 · 진형 하나 고정 · 펫 제외.
 *   레벨 곡선이 완만한 건 **장비가 지배**하기 때문이다 (Lv1 123k → Lv80 190k).
 */
export const POWER_LEVEL_STOPS = [1, 10, 20, 30, 40, 50, 60, 70, 80];
export const POWER_BY_LEVEL = [123543, 131145, 139615, 148078, 156562, 165032, 173516, 181979, 190470];

/**
 * 천장 대비 여유. 걸려도 «표시» 라 게임은 그대로 돌아간다.
 *
 * ★★ 처음엔 1.25 로 잡았다 — 「내 측정이 틀렸을 수 있다」 는 이유였다.
 *   그 틈으로 **전력 219,474 가 통과했다** (천장의 1.15배, §100).
 *
 * ★ 그래서 천장이 정말 정확한지 세 갈래로 확인했다:
 *     · **세트 조각은 고정 스탯이다** — 굴림이 없다. 즉 풀세트 전력은 «운 좋은 최대» 가
 *       아니라 **정해진 값**이다 (같은 세트를 어떤 난수로 굴려도 hp 2970 / atk 772).
 *     · 무작위 신화를 4000번 굴려도 풀세트에 한참 못 미친다 (18,043 vs 26,356).
 *     · 칸마다 최강을 골라 세트 보너스를 깨도 여전히 못 미친다 (22,736).
 *   ⇒ 풀세트가 상한이고, 그 값은 정확하다. 여유를 크게 둘 이유가 없다.
 *
 * ★ 그래도 0 은 아니다 — 콘텐츠가 늘면 천장이 오른다.
 *   그건 `tools/powerceiling.mjs` 와 스모크가 **배포 전에** 잡는다.
 */
export const POWER_SLACK = 1.05;

/* ── 기록 ↔ 전력 (교차 검증) ──────────────────────────────────────
 *
 * ★★ 세 번째 치트가 **전력만 낮춰서** 통과했다 (§103).
 *   전력 상한은 «너무 큰 전력» 만 잡는다. 그래서 27,127 로 내려놓고
 *   나락 96심층 · 탑 490층은 그대로 뒀다 — 기록은 `checkCadence` 가 감소를 거절하므로
 *   낮출 수도 없다. **값 하나하나는 다 통과하는데 서로 모순이다.**
 *
 * ★★ 그래서 «심층·층에 서려면 전력이 최소 얼마인가» 를 실측해 표로 박는다.
 *   `node tools/abysspower.mjs` · `node tools/towerpower.mjs`
 *
 * ★★★ **비율로 보면 안 된다.** 「전력 ÷ 층수」 는 오탐 기계다 —
 *   2인 풀세트(46,756)가 7인 맨몸(61,081)보다 **훨씬 깊이 간다.**
 *   전력은 인원에 거의 비례하는데 전투력은 아니기 때문이다.
 *   ⇒ 반드시 «전력 P **이하**로 도달한 최대» 라는 **상단 포락선**으로 쓴다 (아래 표가 그것이다).
 *
 * ★ 표는 (전력, 그 전력 이하로 도달한 최대) 쌍이고 전력 오름차순이다.
 */

/** 황금 나락 — 실측 (`tools/abysspower.mjs`) */
export const ABYSS_POWER_CURVE = [
  [5_000, 18], [10_000, 29], [20_000, 51], [30_000, 66],
  [50_000, 86], [75_000, 108], [100_000, 128], [190_470, 163],
];

/** 무한의 탑 — 실측 (`tools/towerpower.mjs`, 월 5회 누적 최댓값) */
export const TOWER_POWER_CURVE = [
  [21_708, 235], [26_756, 283], [46_756, 404], [66_454, 407],
  [91_545, 443], [117_121, 483], [125_086, 498], [165_368, 500],
];

/**
 * 그 기록을 세우려면 전력이 최소 얼마여야 하는가 (표를 거꾸로 읽는다).
 * @returns {number} 0 이면 «그 정도는 아무 전력으로도 된다»
 */
function minPowerFor(curve, record) {
  const r = Number(record) || 0;
  if (r <= 0) return 0;
  let prev = null;
  for (const [pw, best] of curve) {
    if (best >= r) {
      if (!prev) return pw;
      /* 두 지점 사이는 선형으로 본다 — 표가 성긴 만큼 낮은 쪽으로 눕는다(=후하다) */
      const [pw0, b0] = prev;
      const t = (r - b0) / Math.max(1, best - b0);
      return pw0 + (pw - pw0) * t;
    }
    prev = [pw, best];
  }
  /* 표 밖 — 표의 끝보다 깊다. 끝 값을 쓴다 (더 세게 잡지 않는다) */
  return curve[curve.length - 1][0];
}

/**
 * 기록 대비 전력이 말이 되는가.
 *
 * ★★ **거절이 아니라 표시여야 한다.** 전력은 «제출 시점 스냅샷» 이고 기록은 «과거» 다 —
 *   500층을 찍은 뒤 장비를 전부 팔고 단원을 해고하면 정상 플레이어도 여기 걸린다.
 *   그래서 실측 최소치의 절반까지 봐준다.
 */
export const RECORD_POWER_SLACK = 0.5;

/**
 * 이 최고레벨에서 부대 하나가 낼 수 있는 전력의 천장 (사이는 선형 보간).
 * @param {number} level 명부의 최고 레벨
 */
export function powerCeiling(level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1));
  const st = POWER_LEVEL_STOPS;
  if (lv <= st[0]) return POWER_BY_LEVEL[0];
  for (let i = 1; i < st.length; i++) {
    if (lv > st[i]) continue;
    const t = (lv - st[i - 1]) / (st[i] - st[i - 1]);
    return POWER_BY_LEVEL[i - 1] + (POWER_BY_LEVEL[i] - POWER_BY_LEVEL[i - 1]) * t;
  }
  return POWER_BY_LEVEL[POWER_BY_LEVEL.length - 1];
}

/**
 * 부대 전력 **거절** 상한 — 이 위는 «물리적으로 불가능» 이라 아예 안 받는다.
 * ★ 표시(flag)선은 `powerCeiling × POWER_SLACK` 이고, 이건 그보다 훨씬 위다.
 *   측정이 틀렸을 때 정상 플레이어를 거절하는 쪽이 제일 나쁘므로 만렙 천장의 5배로 둔다.
 */
export const POWER_CAP = 1_000_000;

/**
 * 증가폭이 게임 규칙으로 설명되는가.
 * @param {object} prev 지난번에 받아들인 값
 * @param {object} s    이번 값
 */
export function checkGrowth(prev, s) {
  const bad = [];
  if (!prev || !s) return bad;
  const dDay = Math.max(0, s.day - prev.day);

  // 의뢰: 부대 5개 × 하루 5건이 물리적 상한이다. 그 두 배까지 봐준다.
  const dQuests = s.questsDone - prev.questsDone;
  const questCap = (dDay + 1) * MAX_QUESTS_PER_DAY * 5 * 2;
  if (dQuests > questCap) bad.push(`의뢰 ${dQuests}건 증가 (${dDay}일 · 상한 ${questCap})`);

  /* 골드: 의뢰 + 나락 + 던전. 나락은 도달 심층으로 상한이 정확히 계산된다.
   * 의뢰 쪽은 후하게 잡는다 — 정예 S랭크 보상이 얼마까지 나오는지는
   * 밸런스에 따라 움직이므로 여기를 조이면 패치 때마다 오탐이 난다. */
  const dGold = s.gold - prev.gold;
  if (dGold > 0) {
    const weeks = Math.floor(dDay / DAYS_PER_WEEK) + 1;
    const abyssCap = goldRange(Math.min(DEPTH_CAP, s.abyssBest)) * weeks;
    const questCapGold = Math.max(0, dQuests) * 120_000;
    const cap = abyssCap + questCapGold + (dDay + 1) * 50_000;
    if (dGold > cap) bad.push(`골드 ${dGold.toLocaleString()} 증가 (상한 ${cap.toLocaleString()})`);
  }

  /* ★★ **S 용병이 나올 수 있는 횟수였나.**
   *   일반 주점은 S 확률이 **0** 이고(GRADE_WEIGHTS), 명물 슬롯에서만 최대 5% 다.
   *   그래서 «지난 제출 이후 늘어난 S» 는 «그 사이 명물 고용 횟수» 로 설명돼야 한다.
   *
   * ★ 전체가 아니라 **증가분끼리** 비교한다. 계량기가 없던 시절의 세이브는 0 에서 시작하므로
   *   전체를 비교하면 오래 한 정상 플레이어가 전부 걸린다.
   *
   * ★ 상한은 실제 확률(5%)의 **네 배**로 잡는다. 운이 좋은 사람을 날리는 게
   *   치트를 놓치는 것보다 나쁜 사고다 — 이 파일의 원칙이다. */
  const dS = s.sMercs - prev.sMercs;
  if (dS > 0) {
    const dSpec = Math.max(0, s.specHires - prev.specHires);
    const cap = Math.max(2, Math.ceil(dSpec * S_CHANCE_MAX * S_LUCK_SLACK));
    if (dS > cap) bad.push(`S 용병 ${dS}명 증가 · 명물 고용 ${dSpec}회 (상한 ${cap})`);
  }

  // 명성: 의뢰 하나당 넉넉히 잡아도 이 이상은 안 나온다
  const dRenown = s.renown - prev.renown;
  if (dRenown > Math.max(0, dQuests) * 60 + 100) {
    bad.push(`명성 ${dRenown} 증가 (의뢰 ${dQuests}건)`);
  }
  return bad;
}

/**
 * 기록 자체가 «이 일차로는 설명이 안 되는가». **매 제출마다** 본다.
 *
 * ★ 기준은 전부 **게임이 코드로 강제하는 것**에서 나온다:
 *   - 탑은 월 1회, 나락은 주 1회만 열린다 → 며칠 만에 깊이 갈 수 없다.
 *   - 일반 주점은 S 등급이 **아예 안 나온다**(가중치 0). 명물 슬롯에서만 최대 5% 다.
 *     그래서 초반에 S 가 여럿 모이는 일은 사실상 없다.
 *
 * ★ 상한은 **넉넉하게** 잡는다. 여기 걸려도 게임은 그대로 돌아가고 순위표에서만 빠진다.
 */
function absoluteOddities(s) {
  const bad = [];
  const towerRuns = Math.floor(Math.max(0, s.day - 1) / DAYS_PER_MONTH) + 1;
  const abyssRuns = Math.floor(Math.max(0, s.day - 1) / DAYS_PER_WEEK) + 1;

  /* 한 번 입장해서 갈 수 있는 깊이를 아주 후하게 잡은 값이다.
   * 실측(tools/tower.mjs): 만렙 풀세트 부대가 500층 중 474층. 그 절반을 1회분으로 본다. */
  if (s.towerBest > towerRuns * 250) bad.push(`탑 ${s.towerBest}층 · ${s.day}일차면 입장 ${towerRuns}회`);
  if (s.abyssBest > abyssRuns * 12) bad.push(`나락 ${s.abyssBest}심층 · ${s.day}일차면 입장 ${abyssRuns}회`);

  /* S 는 명물 슬롯에서만, 그것도 최대 5% 다. 하루 한 명씩 나온다 쳐도 이 이상은 안 모인다.
   *
   * ★★ 예전에는 계량기(`hires`)를 **그대로** 상한으로 썼다:
   *       sCap = max(2, ceil(day*0.06), hires)
   *   주석에 「넓히는 데는 안전하다」 고 적어 뒀는데 **틀렸다.** 오탐에는 안전해도
   *   **위조에는 안전하지 않다** — `hires` 는 세이브에서 오는 자기 신고값이라,
   *   그 숫자만 올리면 일차 상한이 통째로 사라진다.
   *   실제로 그렇게 올라온 등재가 있었다 (`숨단`: 1일차 · S 7명 · 전력 259,803, §96).
   *
   * ★ 그래서 두 가지로 묶는다.
   *     ① **고용했다고 다 S 가 아니다.** 명물 슬롯 확률(S_CHANCE_MAX)에 운 여유(S_LUCK_SLACK)를
   *        곱한 만큼만 인정한다 — 예전엔 «고용 1회 = S 1명» 이라 5배 후했다.
   *     ② **그 고용 자체가 날짜 안에 가능해야 한다.** 주점 목록은 하루 최대 6명이고
   *        (`state.js genTavern`), 그중 명물만 S 가 나온다. 하루 SPEC_HIRES_PER_DAY 로 후하게 잡는다.
   *
   * ★ 이래도 오래 한 정상 플레이어는 안 걸린다 — 오히려 넓어진다.
   *   (168일차 S 36명: 예전 상한 23 → 지금은 고용 기록만 있으면 통과한다.) */
  const specSeen = Math.max(0, Number(s.specHires) || 0, Number(s.hires) || 0);
  const specPossible = Math.min(specSeen, s.day * SPEC_HIRES_PER_DAY);
  const fromHires = Math.ceil(specPossible * S_CHANCE_MAX * S_LUCK_SLACK);
  const sCap = Math.max(2, Math.ceil(s.day * 0.06), fromHires);
  if (s.sMercs > sCap) bad.push(`S 용병 ${s.sMercs}명 · ${s.day}일차 상한 ${sCap}`);

  /* ★★★ 같은 상한을 **고용 시점으로 소급해서** 묻는다 (§118).
   *
   *   위 상한은 «오늘» 기준이라 일차가 커지면 같이 커진다. 그래서
   *   **1일차에 S 4명을 만들어 넣고 일차만 키우면 통과한다** —
   *   실제로 그 계정이 「S 용병 4명 · 1일차 상한 2」로 걸렸다가,
   *   274일차가 되자 상한이 17 이 되어 조용히 통과했다.
   *
   *   그런데 **증거는 세이브에 그대로 남아 있다** — 시작 단원은 C·C·D·D 고정이므로
   *   `hiredDay = 1` 인 S 는 «그날 고용했다» 는 뜻이다.
   *   고용 시점을 오름차순으로 놓고 «그 시점의 상한» 을 하나씩 물으면 그때 걸린다.
   *
   * ★ `specSeen` 은 **총량**을 그대로 쓴다 — 그 시점까지의 고용 횟수는 모른다.
   *   즉 «지금까지 한 고용을 전부 그날 이전에 했다» 고 봐 주는 것이라 **플레이어에게 유리**하다.
   *
   * ★★ 실측 (실제 세이브 9개): 정상 계정의 여유는 −5 ~ −79 였고,
   *   치트 계정 둘만 +2 로 걸렸다. 가장 빠듯한 정상 계정도 −5 다.
   *
   * ★ 표시(C)다, 거절이 아니다 — 옛 세이브의 `hiredDay` 가 이상할 여지를 남긴다. */
  /* ★★ **이 검사는 스스로 꺼질 수 있었다.** 예전엔 서버가 `sHiredDays` 를 명부에서 직접
   *   뽑았지만, 지금은 클라가 «점수만» 보내는 갈래가 있다 — 그러면 이 칸도 클라가 신고한다.
   *   빈 배열로 보내면 아래 루프가 아예 안 돌아 **소급 검사가 통째로 꺼진다.**
   *
   *   실측: 900일차·S 8명을 «전부 초기에 몰아 받은» 판에서
   *     sHiredDays 실음 → flag(「10일차까지 S 6명 · 그 시점 상한 5」)
   *     sHiredDays 뺌   → **ok** ← 소급 검사가 유일한 방어였던 자리다.
   *
   * ★★ 막는 자리는 **여기가 아니다.** 「없다」 는 «치트» 가 아니라 «모양이 틀렸다» 이고,
   *   여기서 표식을 붙이면 손으로 지은 판정 픽스처가 전부 걸린다 (실측: 8개 픽스처).
   *   ⇒ `normalizeScore` 가 **개수 불일치를 모양 오류로 거절한다** (서버는 400).
   *     정상 클라는 둘을 **같은 명부에서** 뽑으므로 언제나 일치한다 (12판 실측 12/12).
   *     옛 갈래 `{state}` 로 오면 서버가 직접 뽑으므로 이 경로 자체를 안 탄다. */
  const sDays = Array.isArray(s.sHiredDays) ? s.sHiredDays : null;
  if (sDays && sDays.length) {
    for (let i = 0; i < sDays.length; i++) {
      const d = Math.max(1, Math.round(Number(sDays[i]) || 1));
      if (d >= s.day) break;                       // 오늘 시점은 위에서 이미 봤다
      const capThen = Math.max(2, Math.ceil(d * 0.06),
        Math.ceil(Math.min(specSeen, d * SPEC_HIRES_PER_DAY) * S_CHANCE_MAX * S_LUCK_SLACK));
      if (i + 1 > capThen) {
        bad.push(`${d}일차까지 S 용병 ${i + 1}명 · 그 시점 상한 ${capThen}`);
        break;                                     // 가장 이른 위반 하나만 적는다
      }
    }
  }

  /* ★★ 부대 전력이 **게임이 만들 수 있는 값**인가.
   *
   *   여기 아무 검사도 없었다. `checkStatic` 의 POWER_CAP 하나뿐이었는데 그게 5,000,000 이라
   *   실측 천장(190,470)의 26배였다 — 259,803 이 상한의 5% 라 걸릴 수가 없었다.
   *   §57 에서 «1일차 의뢰 99999» 를 막을 때 일차 상한을 **의뢰·명성에만** 걸었고,
   *   나중에 추가된 순위 축(S용병·부대 전력, db/008)까지 확장되지 않았던 것이다.
   *
   * ★ 거절이 아니라 **표시**다. 내 측정이 틀릴 수 있고(§94 에서 세 번 틀렸다),
   *   그때 정상 플레이어를 통째로 막는 쪽이 치트 하나를 놓치는 쪽보다 훨씬 나쁘다. */
  const pCap = Math.ceil(powerCeiling(s.topLevel) * POWER_SLACK);
  if (s.topPower > pCap) {
    bad.push(`부대 전력 ${s.topPower} · 최고레벨 ${s.topLevel} 천장 ${pCap}`);
  }

  /* ★★ **기록 ↔ 전력 교차 검증** (§103).
   *
   *   지금까지의 검사는 전부 «이 값이 일차에 비해 말이 되나» 였다 — 값끼리 안 견줬다.
   *   그래서 세 번째 치트가 **전력만 낮춰서** 통과했다:
   *     전력 27,127 인데 나락 96심층 · 탑 490층.
   *   실측으로 나락 96 은 최소 57,122, 탑 490 은 최소 125,086 이 필요하다.
   *   («여기이름…» 이 전력 46,581 로 나락 52 · 탑 191 인 것과도 앞뒤가 맞는다.)
   *
   * ★ 표시(flag)다, 거절이 아니다 — 전력은 «제출 시점» 이고 기록은 «과거» 라,
   *   기록을 세운 뒤 장비를 전부 팔면 정상 플레이어도 여기 걸린다.
   *   그래서 실측 최소치의 절반까지 봐준다 (`RECORD_POWER_SLACK`). */
  /* ★★ **전력을 안 찍었으면 대조하지 않는다.**
   *   `topPower` 는 `squad.js stampSquadPower()` 가 제출 직전에 찍는다.
   *   그 경로를 안 탄 세이브(옛 클라·도구가 만든 것)는 0 이고,
   *   그때 이 검사를 돌리면 **기록이 있는 사람이 전원 걸린다.**
   *   실제로 계측기(`tools/cheatcheck.mjs`)가 그걸 잡아 줬다.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ 그런데 그 «건너뛰기» 가 **마법의 탈출값**이었다 (§111).
   *
   *   가드가 「걸어라」 가 아니라 「건너뛰라」 라서, 전력을 **정확히 0** 으로 적어 내면
   *   검사가 통째로 꺼진다. 실측:
   *
   *     c5097c (나락 96 · 탑 490)   전력 27,127 → flag C
   *                                 전력      1 → flag C
   *                                 전력      0 → **ok**   ← 그냥 통과
   *
   *   즉 §103 이 막았다고 믿은 자리가 **더 싼 값으로 열려 있었다.**
   *   지금 flagged 인 계정도 다음 제출에서 0 만 적으면 풀린다.
   *
   * ★★ 막는 방법: **그 계정이 전에 보인 최대 전력을 바닥값으로 깐다.**
   *   `seenPower` 는 서버가 `scores.top_power` 에서 넣어 준다 (submit-score).
   *   부대를 해산하든 장비를 다 팔든 **이미 세운 알리바이는 못 지운다.**
   *
   * ★ 이 바닥값은 판정을 **느슨하게만** 만든다 — 전력이 커지면 `전력 < 필요치` 가
   *   덜 걸린다. 그래서 **정상 플레이어를 새로 거절할 위험이 구조적으로 0** 이다.
   *   옛 클라(신고 0 · 알리바이도 0)는 바닥값도 0 이라 오늘과 똑같이 검사가 꺼진다.
   *
   * ★ `seenPower` 가 없으면(옛 호출자·스모크·클라) undefined → 0 → 오늘 동작 그대로다.
   * ════════════════════════════════════════════════════════════════════════ */
  const power = Math.max(Number(s.topPower) || 0, Number(s.seenPower) || 0);

  /* ★★★ 알리바이만으로는 **새 계정을 못 막는다** (제작자 지적: 「용병단을 새로 만들면?」).
   *
   *   새 계정은 `scores` 행이 없어 알리바이가 0 이다. 그러면 위 바닥값이 0 이고,
   *   전력을 0 으로 유지하면 검사가 계속 꺼진 채로 남는다. 실측:
   *
   *     새 계정 · 첫 제출 · 나락 96 · 탑 490 · 전력 0   → ok
   *     새 계정 · 첫 제출 · 나락 300 · 탑 500 · 전력 0  → ok   ← 둘 다 최대치
   *
   *   ⇒ **「기록이 있는데 전력이 하나도 없다」 자체를 신호로 본다.**
   *
   * ★ 정상 플레이로는 이 상태가 안 나온다. 나락·탑에 들어가려면 부대가 있어야 하고,
   *   부대가 있으면 전력이 0 이 아니다 (새 게임 직후에도 1,577 이다 — 실측).
   *   기록을 세운 뒤 부대를 해산해도 **알리바이가 남아** 위 바닥값이 0 이 아니다.
   *
   * ★ 실측한 대가: 지금 계정 7개 중 「기록이 있는데 전력 0」 인 계정은 **0개**다
   *   (전력 분포 9,456 ~ 174,034). 걸리려면 **한 번도 전력을 올린 적이 없어야** 한다 —
   *   서비스워커에 캐시된 옛 클라(제출 직전 stampSquadPower 를 안 부르는 버전)뿐이다.
   *
   * ★ 거절이 아니라 **표시**다. 게임은 그대로 되고 순위표에서만 빠지며 사람이 되돌린다. */
  if (power <= 0 && (s.abyssBest > 0 || s.towerBest > 0)) {
    bad.push(`나락 ${s.abyssBest} · 탑 ${s.towerBest} 인데 부대 전력이 없다`);
  }

  const forCross = power > 0 ? [
    ['나락', s.abyssBest, ABYSS_POWER_CURVE],
    ['탑', s.towerBest, TOWER_POWER_CURVE],
  ] : [];
  for (const [label, rec, curve] of forCross) {
    const need = Math.ceil(minPowerFor(curve, rec) * RECORD_POWER_SLACK);
    if (rec > 0 && need > 0 && power < need) {
      bad.push(`${label} ${rec} 인데 부대 전력 ${power} — 최소 ${need} 은 있어야 한다`);
    }
  }
  return bad;
}

/* ─────────────────────────── 종합 ─────────────────────────── */

/**
 * 제출을 판정한다.
 * @param {object|null} prev 지난번에 받아들인 값 (없으면 첫 제출)
 * @param {object} s         이번 값 (`extractScore` 결과)
 * @returns {{verdict:'ok'|'reject'|'flag', tier:string, reasons:string[]}}
 */
export function judge(prev, s) {
  // ★ extractScore 는 못 읽으면 null 을 준다. 여기서 안 막으면 checkCadence 가 터진다.
  if (!s) return { verdict: 'reject', tier: 'A', reasons: ['점수를 읽지 못했다'] };
  const a = [...checkStatic(s), ...checkCadence(prev, s)];
  if (a.length) return { verdict: 'reject', tier: 'A', reasons: a };

  /* ★★ 이 검사는 **매 제출마다** 돈다. 예전에는 `if (!prev)` 안에 있었다.
   *
   *   그게 구멍이었다. flag 를 받아도 원장은 갱신되므로(submit-score 의 «flagged 여도
   *   갱신한다»), **한 번 걸리고 나면 그 뒤로는 증가분 검사만 남았다.**
   *   증가분 상한은 제출당 최소 2명이라, 제출을 반복하면 얼마든지 올릴 수 있었다 —
   *   실제로 거절 19건을 찔러 본 뒤 통과한 기록이 있다 (S 17명 · 총 고용 4회).
   *   절대 상한이 매번 걸리면 그 «조금씩 올리기» 가 상한을 못 넘는다.
   *
   * ★ 그래도 **거절하지는 않는다.** 오래 오프라인으로 하다가 클라우드를 처음 켠
   *   정상 플레이어의 기록도 똑같이 커 보인다. 구분할 방법이 없다.
   *   그래서 **표시(flag)** 만 한다 — 순위표에서는 빠지고 행은 남아 사람이 본다.
   *   «불가능» 인 것(정원 초과·고용 없는 S)은 위 checkStatic 이 이미 거절한다. */
  const odd = absoluteOddities(s);
  if (odd.length) return { verdict: 'flag', tier: 'C', reasons: odd };

  const b = checkGrowth(prev, s);
  // ★ B 는 거절이 아니라 **표시**다 (제작자 결정: 랭킹에서만 숨긴다).
  //   게임은 그대로 즐기게 두고, 오탐이면 나중에 사람이 되돌린다.
  if (b.length) return { verdict: 'flag', tier: 'B', reasons: b };

  return { verdict: 'ok', tier: '', reasons: [] };
}

/** 같은 플레이스루인가 (seed 가 다르면 새 판이라 비교 자체가 무의미하다) */
export function sameRun(prev, s) {
  return !!prev && !!s && prev.seed === s.seed;
}

export { weekIndex, DAYS_PER_WEEK, DAYS_PER_MONTH };
