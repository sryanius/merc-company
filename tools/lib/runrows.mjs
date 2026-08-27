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
 * @module tools/lib/runrows
 */

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
      /* ★★ **이건 013 의 컬럼이 아니다.** `run_squads` 에 자리가 없는 값들이라
       *   여기서만 들고 다닌다 — `run_import` 를 쓸 때 이 이름으로 insert 하면 터진다.
       *   밑줄로 시작하는 이유가 그거다.
       *   ★ 전력에는 안 걸린다 (빼고 재 봤다 — 11판 전부 같은 값이었다).
       *     하지만 `run_snapshot` 은 필요하다 — 파견 중인 부대를 클라가 알아야 한다.
       *     ⇒ 013 위에 컬럼을 더할 때 같이 넣어라 (§110 의 남은 일). */
      _notInSchema: { status: q.status, returnDay: q.returnDay },
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

  const items = (r.items || []).map((x) => ({
    uid: x.uid,
    baseId: x.base_id,
    slot: x.slot,
    rarity: x.rarity,
    ilvl: x.ilvl,
    setId: x.set_id == null ? undefined : x.set_id,
    ...(x.locked ? { locked: true } : {}),
    ...(x.data || {}),
  }));

  /* 착용을 되세운다: 아이템 쪽 기록 → merc.equipment */
  const equipOf = new Map();          // mercUid → {slot: itemUid}
  for (const x of r.items || []) {
    if (!x.equipped_by || !x.equipped_slot) continue;
    if (!equipOf.has(x.equipped_by)) equipOf.set(x.equipped_by, {});
    equipOf.get(x.equipped_by)[x.equipped_slot] = x.uid;
  }

  const roster = (r.mercs || []).map((x) => ({
    uid: x.uid,
    classId: x.class_id,
    grade: x.grade,
    level: x.level,
    hiredDay: x.hired_day,
    ...(x.data || {}),
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
      status: (q._notInSchema && q._notInSchema.status) || 'idle',
      returnDay: (q._notInSchema && q._notInSchema.returnDay) || 0,
    }));

  /* merc.squadId / slotIndex 는 편성의 사본이다 — 여기서 다시 만든다 */
  const byUid = new Map(roster.map((m) => [m.uid, m]));
  for (const q of squads) {
    q.memberUids.forEach((uid, i) => {
      const m = uid && byUid.get(uid);
      if (m) { m.squadId = q.id; m.slotIndex = i; }
    });
  }

  return {
    seed: S.seed, day: S.day, gold: S.gold, renown: S.renown,
    cityId: S.city_id, rosterCap: S.roster_cap,
    roster, items, squads,
    pets: (r.pets || []).map((p) => ({ uid: p.uid, sid: p.sid, grade: p.grade, ...(p.data || {}) })),
    stats: {
      questsDone: S.quests_done, battlesWon: S.battles_won, battlesLost: S.battles_lost,
      hires: S.hires, specHires: S.spec_hires,
    },
    abyss: { best: S.abyss_best, bestDay: S.abyss_best_day, lastRunDay: S.abyss_last_run_day },
    tower: { best: S.tower_best, bestDay: S.tower_best_day, lastRunDay: S.tower_last_run_day },
  };
}
