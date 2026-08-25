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
    hiredN: roster.reduce((a, m) => a + (m && (Number(m.hiredDay) || 0) > 1 ? 1 : 0), 0),
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

  let best = null;
  let bestScore = -1;
  for (const sq of squads) {
    const mems = (sq?.memberUids || []).map((u) => byUid.get(u)).filter(Boolean);
    if (!mems.length) continue;
    // 서버가 못 믿는 값이라 정교할 필요가 없다 — 레벨 합이면 «가장 키운 부대» 가 잡힌다.
    const score = mems.reduce((a, m) => a + (Number(m.level) || 1), 0);
    if (score > bestScore) { bestScore = score; best = { sq, mems }; }
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
  const questCap = s.day * MAX_QUESTS_PER_DAY * MAX_SQUADS * 2;
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

/** 부대 전력 상한. 7명 × 만렙 S × 신화 풀세트를 아주 후하게 잡은 값이다.
 *  실측 기준: 엔드게임 잣대 부대(4차 Lv80 · 10칸 전설)가 74,148 이다 (tools/endgame.mjs). */
export const POWER_CAP = 5_000_000;

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
   * ★ 계량기(hires)가 «그보다 많이 고용했다» 고 말하면 그쪽을 믿는다.
   *   계량기는 옛 세이브에서 0 이라 **상한을 좁히는 데는 못 쓰지만**, 넓히는 데는 안전하다 —
   *   0 이면 일차 상한 그대로고, 값이 있으면 그만큼 봐준다. */
  const sCap = Math.max(2, Math.ceil(s.day * 0.06), Math.max(0, Number(s.hires) || 0));
  if (s.sMercs > sCap) bad.push(`S 용병 ${s.sMercs}명 · ${s.day}일차 상한 ${sCap}`);
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
