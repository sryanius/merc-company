/**
 * 세이브 ↔ `run_*` 표 — **사상(寫像)을 한 벌만 둔다**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 있나: §104 1단계에서 `run_import()`(세이브 → 표)와 `run_snapshot()`
 *   (표 → 클라)이 **서로의 역함수**여야 한다. 두 벌로 짜면 반드시 갈라진다
 *   (§94·§98·§107 이 전부 같은 병이었다). 그래서 한 파일에 마주 보게 둔다.
 *
 * ★★ 그리고 이 파일이 **먼저 잰다.** 서버가 전력을 스스로 세려면
 *   「표로 갔다 돌아와도 같은 숫자가 나오나」 가 참이어야 한다.
 *   `tools/powerparity.mjs` 가 그걸 실제로 굴린다 — 여기가 틀리면 1단계가 통째로 무너진다.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★ 모양 규칙 (db/013_run_state.sql 의 결정 그대로)
 *
 *   «서버가 판단에 쓰는 것만 컬럼, 나머지는 `data jsonb`».
 *   그래서 여기서도 **승격된 컬럼은 data 에서 뺀다** — 두 벌이 되면 어느 쪽이
 *   진실인지 아무도 모르게 된다.
 *
 * ★★ 착용은 **아이템 쪽에만** 적는다 (`equipped_by`/`equipped_slot`).
 *   `merc.equipment` 는 **복원할 때 다시 만든다.** 013 이 그렇게 정한 이유는
 *   양쪽에 적으면 반드시 어긋나기 때문이다. 그러니 `data` 에도 남기지 않는다.
 *
 * ★★ `squad.memberUids` 는 **7칸 배열이고 빈 칸이 null 이다.** 자리가 곧 진형 위치라
 *   «null 을 걸러내면» 전력이 달라진다. 길이를 그대로 보존한다 (`petUids` 는 3칸).
 *   `merc.squadId`/`slotIndex` 도 이 배열의 사본이라 복원할 때 다시 만든다.
 *
 * ★★ **import 가 0개다.** 그래서 서버 묶음(`_power`)에 넣어도 닫힘이 한 파일도 안 늘어난다 —
 *   `itembound.js` 와 같은 이유로 `src/game/` 에 둔다. 서버의 `run_import`/`run_snapshot`
 *   이 이 파일을 **그대로** 쓴다. 사상이 두 벌이 되면 반드시 갈라진다.
 *
 * @module game/runrows
 */

/* ════════════════════════════════════════════════════════════════════════════
 * `run_state` 가 담당하는 세이브 최상위 키
 *
 * ★★ 여기 **안 적힌 키는 전부 `data jsonb` 로 간다.** 그래서 게임에 새 칸이 생겨도
 *   조용히 사라지지 않는다 — 이게 db/015 를 판 이유다.
 *   (013 만 있던 시절엔 최상위 27개 중 **14개가 자리 없이 버려지고 있었다** — 실측.)
 * ════════════════════════════════════════════════════════════════════════════ */
/** 컬럼으로 그대로 가는 것 */
const STATE_COLS = ['seed', 'day', 'gold', 'renown', 'cityId', 'rosterCap',
  'companyName', 'flagSquadId'];
/** 별도 표로 가는 것 */
const STATE_TABLES = ['roster', 'items', 'squads', 'pets'];
/** 여러 컬럼으로 펴지는 것 */
const STATE_SPLIT = ['stats', 'abyss', 'tower'];

/** 승격 컬럼 — `data` 에서 빼는 것들 */
const MERC_COLS = ['uid', 'classId', 'grade', 'level', 'hiredDay'];
const ITEM_COLS = ['uid', 'baseId', 'slot', 'rarity', 'ilvl', 'setId', 'locked'];
const PET_COLS = ['uid', 'sid', 'grade'];
/** 표에서 되만드는 것 — 사본을 남기면 갈라진다 */
const MERC_DERIVED = ['equipment', 'squadId', 'slotIndex'];

const SLOT_COUNT = 7;
const PET_SLOT_COUNT = 3;

function rest(obj, drop) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (!drop.includes(k)) out[k] = obj[k];
  return out;
}

/** 배열을 길이 n 으로 맞춘다 (모자라면 null 로 채우고, 넘치면 자른다) */
function pad(arr, n) {
  const a = Array.isArray(arr) ? arr.slice(0, n) : [];
  while (a.length < n) a.push(null);
  return a;
}

/**
 * 세이브 → `run_*` 행들.
 * @param {object} st 게임 state
 * @returns {{state:object, mercs:object[], items:object[], squads:object[], pets:object[]}}
 */
export function toRows(st) {
  const s = st || {};

  /* 착용을 뒤집는다: merc.equipment{slot:itemUid} → item 쪽 (equipped_by, equipped_slot) */
  const wornBy = new Map();            // itemUid → { by, slot }
  for (const m of s.roster || []) {
    if (!m || !m.equipment) continue;
    for (const [slot, uid] of Object.entries(m.equipment)) {
      if (!uid) continue;
      /* ★ 한 아이템이 두 군데 걸려 있으면 **여기서 잡는다.** 조용히 덮으면
       *   전력이 두 배로 잡힌다 (013 의 run_items_slot_uniq 가 DB 쪽에서 막는 것과 같은 사고). */
      if (wornBy.has(uid)) {
        const p = wornBy.get(uid);
        throw new Error(`아이템 ${uid} 이 두 곳에 착용돼 있다: ${p.by}/${p.slot} 와 ${m.uid}/${slot}`);
      }
      wornBy.set(uid, { by: m.uid, slot });
    }
  }

  return {
    state: {
      seed: s.seed, day: s.day, gold: s.gold, renown: s.renown,
      city_id: s.cityId == null ? null : s.cityId,
      roster_cap: s.rosterCap,
      quests_done: (s.stats && s.stats.questsDone) || 0,
      battles_won: (s.stats && s.stats.battlesWon) || 0,
      battles_lost: (s.stats && s.stats.battlesLost) || 0,
      hires: (s.stats && s.stats.hires) || 0,
      spec_hires: (s.stats && s.stats.specHires) || 0,
      abyss_best: (s.abyss && s.abyss.best) || 0,
      abyss_best_day: (s.abyss && s.abyss.bestDay) || 0,
      abyss_last_run_day: (s.abyss && s.abyss.lastRunDay) || 0,
      tower_best: (s.tower && s.tower.best) || 0,
      tower_best_day: (s.tower && s.tower.bestDay) || 0,
      tower_last_run_day: (s.tower && s.tower.lastRunDay) || 0,

      /* ★ 순위표가 읽는 둘 — 그래서 컬럼으로 꺼냈다 (db/015).
       *   flag_squad_id 가 없으면 이관 뒤 전원의 대표 부대가 «첫 부대» 로 되돌아간다. */
      company_name: s.companyName == null ? null : String(s.companyName),
      flag_squad_id: s.flagSquadId == null ? null : String(s.flagSquadId),

      /* ★★ **나머지 전부.** 위 목록에 안 적힌 최상위 키는 여기로 온다 —
       *   reputation · repTouch · formations · dungeons · autoSellRarity · petSeq ·
       *   version · dataVersion · quests · shop · tavern · log …
       *   게임에 새 칸이 생겨도 저절로 여기 담긴다. */
      data: {
        ...rest(s, [...STATE_COLS, ...STATE_TABLES, ...STATE_SPLIT]),
        /* ★★ `abyss`·`tower`·`stats` 는 **컬럼으로 펴지는데, 편 것만 펴진다.**
         *   나머지 하위 키가 조용히 사라지고 있었다 — 왕복 검사가 잡았다:
         *     abyss.lastRunDepth · abyss.lastGold · tower.lastRunFloor
         *   («마지막 탐험 결과» 표시용이다. 잃으면 그 칸이 초기화돼 보인다.)
         *   ⇒ 편 것만 빼고 나머지를 여기 담는다. 하위 키가 늘어도 저절로 따라온다. */
        abyssRest: rest(s.abyss || {}, ['best', 'bestDay', 'lastRunDay']),
        towerRest: rest(s.tower || {}, ['best', 'bestDay', 'lastRunDay']),
        statsRest: rest(s.stats || {}, ['questsDone', 'battlesWon', 'battlesLost', 'hires', 'specHires']),
      },
    },
    mercs: (s.roster || []).filter(Boolean).map((m) => ({
      uid: m.uid,
      class_id: m.classId,
      grade: m.grade,
      level: m.level,
      hired_day: m.hiredDay,
      data: rest(m, [...MERC_COLS, ...MERC_DERIVED]),
    })),
    items: (s.items || []).filter(Boolean).map((it) => {
      const w = wornBy.get(it.uid) || null;
      return {
        uid: it.uid,
        base_id: it.baseId,
        slot: it.slot,
        rarity: it.rarity || 0,
        ilvl: it.ilvl || 1,
        set_id: it.setId == null ? null : it.setId,
        locked: !!it.locked,
        equipped_by: w ? w.by : null,
        equipped_slot: w ? w.slot : null,
        data: rest(it, ITEM_COLS),
      };
    }),
    squads: (s.squads || []).filter(Boolean).map((q, i) => ({
      idx: i,
      sid: q.id,
      name: q.name,
      formation_id: q.formationId,
      member_uids: pad(q.memberUids, SLOT_COUNT),
      pet_uids: pad(q.petUids, PET_SLOT_COUNT),
      /* ★ db/015 에서 칸이 생겼다. 그전엔 `_notInSchema` 로 들고만 다녔다 —
       *   전력에는 안 걸리지만(§110 실측) `run_snapshot` 이 「원정 중」 을 알려야 한다.
       *   값은 'idle' / 'away' 둘뿐이다 (squad.js 의 SQUAD_IDLE·SQUAD_AWAY). */
      status: q.status === 'away' ? 'away' : 'idle',
      return_day: Math.max(0, Math.round(Number(q.returnDay) || 0)),
    })),
    pets: (s.pets || []).filter(Boolean).map((p) => ({
      uid: p.uid, sid: p.sid, grade: p.grade, data: rest(p, PET_COLS),
    })),
  };
}

/**
 * `run_*` 행들 → 전력 계산이 먹을 수 있는 state 모양.
 *
 * ★ «세이브 전체» 를 되만드는 게 아니다. `squadPower`/`mercStats` 가 읽는 것만 채운다
 *   (roster · items · squads · pets · formations · rosterCap · day).
 */
export function fromRows(rows) {
  const r = rows || {};
  const S = r.state || {};

  /* ★★ `data` 를 **먼저** 편다 — 아래 컬럼들이 이겨야 한다.
   *
   *   db/016_run_import.sql 은 **컬럼만** 자른다 (level ≤ 80 · rarity ≤ 5 · ilvl ≤ 80).
   *   `data` jsonb 는 검사 없이 통째로 들어간다. 그래서 `data` 를 **나중에** 펴면
   *   `{level:999, grade:'S'}` 한 줄로 그 클램프가 통째로 무의미해진다 — 실측으로 6/6 뚫렸다.
   *   state 쪽(아래)은 처음부터 이 순서였다. 이제 넷이 같은 계약이다. */
  const items = (r.items || []).map((x) => ({
    ...(x.data || {}),
    uid: x.uid,
    baseId: x.base_id,
    slot: x.slot,
    rarity: x.rarity,
    ilvl: x.ilvl,
    /* ★ `null` 을 `undefined` 로 바꾸지 마라 — 세이브의 아이템은 `setId: null` 을
     *   **키로 갖고 있다.** 바꿔 놓으면 왕복할 때마다 키 하나가 사라진다 (왕복 검사가 잡았다). */
    setId: x.set_id,
    ...(x.locked ? { locked: true } : {}),
  }));

  /* 착용을 되세운다: 아이템 쪽 기록 → merc.equipment */
  const equipOf = new Map();          // mercUid → {slot: itemUid}
  for (const x of r.items || []) {
    if (!x.equipped_by || !x.equipped_slot) continue;
    if (!equipOf.has(x.equipped_by)) equipOf.set(x.equipped_by, {});
    equipOf.get(x.equipped_by)[x.equipped_slot] = x.uid;
  }

  /* ★★ `data` 를 먼저 편다 — 위 items 와 같은 이유다 (컬럼이 이겨야 한다). */
  const roster = (r.mercs || []).map((x) => ({
    ...(x.data || {}),
    uid: x.uid,
    classId: x.class_id,
    grade: x.grade,
    level: x.level,
    hiredDay: x.hired_day,
    equipment: equipOf.get(x.uid) || {},
  }));

  const squads = (r.squads || []).slice()
    .sort((a, b) => (a.idx || 0) - (b.idx || 0))
    .map((q) => ({
      id: q.sid,
      name: q.name,
      formationId: q.formation_id,
      memberUids: pad(q.member_uids, SLOT_COUNT),
      petUids: pad(q.pet_uids, PET_SLOT_COUNT),
      status: q.status === 'away' ? 'away' : 'idle',
      returnDay: Math.max(0, Math.round(Number(q.return_day) || 0)),
    }));

  /* merc.squadId / slotIndex 는 편성의 사본이다 — 여기서 다시 만든다.
   *
   * ★★ **부대에 안 든 단원도 값을 갖는다.** 게임은 `squadId: null` · `slotIndex: -1` 로
   *   둔다 (`merc.js createMerc`). 든 사람만 채웠더니 나머지가 `undefined` 로 돌아와
   *   왕복 검사가 물었다 — 키 자체가 사라지는 것이라 조용히 어긋난다. */
  const byUid = new Map(roster.map((m) => [m.uid, m]));
  for (const m of roster) { m.squadId = null; m.slotIndex = -1; }
  for (const q of squads) {
    q.memberUids.forEach((uid, i) => {
      const m = uid && byUid.get(uid);
      if (m) { m.squadId = q.id; m.slotIndex = i; }
    });
  }

  return {
    /* ★ `data` 를 **먼저** 편다 — 아래 컬럼들이 이겨야 한다.
     *   (data 에 같은 이름이 들어갈 일은 없지만, 순서로 못 박아 둔다.) */
    ...rest(S.data || {}, ['abyssRest', 'towerRest', 'statsRest']),
    seed: S.seed, day: S.day, gold: S.gold, renown: S.renown,
    cityId: S.city_id, rosterCap: S.roster_cap,
    companyName: S.company_name == null ? undefined : S.company_name,
    flagSquadId: S.flag_squad_id == null ? null : S.flag_squad_id,
    roster, items, squads,
    /* ★★ `data` 먼저 — 컬럼이 이긴다 (위 items·roster 와 같은 계약). */
    pets: (r.pets || []).map((p) => ({ ...(p.data || {}), uid: p.uid, sid: p.sid, grade: p.grade })),
    /* ★ 편 컬럼 + `data` 에 남겨 둔 나머지 하위 키를 합친다 (toRows 의 짝) */
    stats: {
      ...((S.data || {}).statsRest || {}),
      questsDone: S.quests_done, battlesWon: S.battles_won, battlesLost: S.battles_lost,
      hires: S.hires, specHires: S.spec_hires,
    },
    abyss: {
      ...((S.data || {}).abyssRest || {}),
      best: S.abyss_best, bestDay: S.abyss_best_day, lastRunDay: S.abyss_last_run_day,
    },
    tower: {
      ...((S.data || {}).towerRest || {}),
      best: S.tower_best, bestDay: S.tower_best_day, lastRunDay: S.tower_last_run_day,
    },
  };
}
