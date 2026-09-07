// 던전 데이터 — 월드맵의 **별도 노드** 4개. 도시가 아니다 (설계 C).
// 순수 JS: DOM 참조 금지. 진행 로직(개방 판정·웨이브·드랍)은 game/dungeon.js 가 소유한다.
//
// [계약 요약 — 다른 모듈이 지켜야 할 것]
//  - 던전 하나 = 세트 하나. 세트 아이템 **실물**(베이스·스탯·세트 효과)은 `data/items.js` 소유다.
//    여기서는 연결 키 `setId` 와 착용 제한 `archs`(아키타입 7종 기준)만 들고 있는다.
//    → items.js 는 이 파일의 `SET_IDS` 와 **같은 id** 로 세트를 정의해야 한다.
//  - `week` 은 그 달의 개방 주차(1~4). N주차에는 N번 던전만 열린다.
//    판정은 `state.js openDungeonWeek(day)` → `game/dungeon.js openDungeonId(day)`.
//  - `x,y` 는 월드맵 좌표(0~1000 × 0~700). 도시 14곳과 최소 140 이상 떨어뜨렸다
//    (도시끼리의 평균 간격이 130~150 이라 그 이상이면 노드가 겹쳐 보이지 않는다).
//  - `waves` 는 10 고정. **웨이브마다 보스가 나온다**(game/dungeon.js 가 boss:true 로 세운다).
//
// 클래스는 105종이라 개별 제한을 걸 수 없다. 제한은 전부 **아키타입 7종** 기준이다.

import { clamp } from '../core/util.js';

/** 던전 하나의 웨이브 수 (설계 C) */
export const DUNGEON_WAVES = 10;
/** 던전 적이 쓰는 난이도 대역 — S랭크와 같은 tier 5(심연 대역) */
export const DUNGEON_TIER = 5;
/** 던전 적 레벨 — 만렙 고정. 난이도는 레벨이 아니라 `WAVE_POWER`(dungeon.js)로 올린다.
 *  적 레벨은 어차피 80 에서 clamp 되므로 레벨은 노브가 될 수 없다(HANDOFF §7 교훈). */
export const DUNGEON_LEVEL = 80;
/** 개방 주차 수 (= 던전 수). 1주차 → 1번 던전 … 4주차 → 4번 던전 */
export const DUNGEON_WEEKS = 4;

/* ── 난이도 (§172) ──────────────────────────────────────────────────────
 * 제작자: 「던전을 현재꺼는 보통 난이도로 하고 어려움, 정예 난이도를 추가해서 보통 난이도로 셋트
 *   아이템 맞추고 어느정도 거의 맞추면 어려움 난이도에서 두번째 셋트 아이템을 파밍하고 두번째
 *   셋트도 거의 파밍하면 정예 난이도에서 세번째 셋트를 파밍 하는 식이면 좋을것같아」
 *
 * · 던전 하나에 난이도 셋. 난이도마다 **그 던전 계열의 세트가 한 단계씩** 올라간다
 *   (보통 = 1단 세트 · 어려움 = 2단 · 정예 = 3단). 착용 제한(archs)은 세 단 모두 같다.
 * · 해금: 어려움은 보통을 **한 번이라도 완주**(10웨이브)했을 때, 정예는 어려움을 완주했을 때.
 * · 진행도는 난이도마다 따로 적는다 (`progressKey`). 보통은 예전 키(던전 id) 그대로라
 *   옛 세이브의 기록이 그대로 보통 난이도 기록이 된다.
 * · 난이도 배율은 `WAVE_POWER`(game/dungeon.js) 에 곱한다. 값은 실측으로 정한다 —
 *   목표는 「1단 풀세트가 어려움 10웨이브를 30% 완주 · 2단 풀세트가 정예 10웨이브를 30% 완주」.
 *   (보통이 「전설 10칸 → 1단 풀세트 30% 완주」 인 것과 같은 계단이다.) */
export const DIFFICULTIES = ['normal', 'hard', 'elite'];
export const DIFFICULTY_LABEL = { normal: '보통', hard: '어려움', elite: '정예' };
/** 난이도 → 그 난이도가 떨어뜨리는 세트 단 (1~3) */
export const DIFFICULTY_TIER = { normal: 1, hard: 2, elite: 3 };
/**
 * 난이도 → 적 배율. **둘로 나눈다** — 1~9웨이브(`early`)와 10웨이브 벽(`wall`).
 *
 * ★ 왜 둘인가 (실측 §172): 배율 하나(1.32)로는 계단이 안 만들어졌다. 어려움의 입장 부대는
 *   «1단 풀세트» 인데 그 부대가 8.8웨이브까지 가 버려 2단 조각을 다 모으기도 전에 벽만 남았고,
 *   반대로 2단 풀세트의 완주는 16% 였다. 초반을 세게, 벽은 덜 세게 해야
 *   「입장 부대는 5~7웨이브 · 다음 단 풀세트만 완주」 가 된다 — 보통 난이도의 계단과 같은 모양이다.
 * ★ 값은 tools/dungeon.mjs --diff= --settier= --basetier= 로 잰다. 세트를 만지면 다시 재라. */
export const DIFFICULTY_POWER = {
  normal: { early: 1.00, wall: 1.00 },
  /* 실측(계열 합산 뒤, tools/dungeon.mjs --diff=hard --settier=2 --basetier=1):
   *   입장(1단 풀세트) 평균 6.7웨 · 2단 조각 3/5/7/8개 → 8.3/8.3/8.7/8.7 · 2단 풀세트 완주 wall 1.28 → 52%, 1.32 → 19% */
  hard: { early: 1.65, wall: 1.56 },
  /* 실측(--diff=elite --settier=3 --basetier=2): 입장(2단 풀세트) 4.4웨 · 3단 조각 3/5/7/8개 → 7.6/8.0/8.4/8.5 · 3단 풀세트 완주 wall 1.75 → 40%, 1.82 → 4% */
  elite: { early: 2.60, wall: 2.55 },
};
/** 계측 도구용 — 실행 중에 난이도 배율을 바꿔 격자로 잰다 (게임은 부르지 않는다) */
export function setDifficultyPower(diff, v) {
  const k = normDifficulty(diff);
  if (v && typeof v === 'object') DIFFICULTY_POWER[k] = { early: Number(v.early) || 1, wall: Number(v.wall) || 1 };
}

/** 난이도 문자열 정규화 (모르는 값이면 보통) */
export function normDifficulty(diff) {
  return DIFFICULTIES.includes(diff) ? diff : 'normal';
}
/** 진행도 저장 키 — 보통은 예전 그대로 던전 id, 나머지는 `id@난이도` */
export function progressKey(dungeonId, diff = 'normal') {
  const d = normDifficulty(diff);
  return d === 'normal' ? dungeonId : `${dungeonId}@${d}`;
}
/** 이 난이도의 바로 아래 난이도 (보통이면 null) */
export function prevDifficulty(diff) {
  const i = DIFFICULTIES.indexOf(normDifficulty(diff));
  return i > 0 ? DIFFICULTIES[i - 1] : null;
}

/** 아키타입 7종 — 던전4처럼 제한이 없는 세트가 그대로 쓴다 */
export const ALL_ARCHS = ['tank', 'lancer', 'fighter', 'rogue', 'archer', 'mage', 'healer'];

/* ── 던전 정의 ────────────────────────────────────────────────────────────
 * { id, name, week, setId, setName, archs, biome, x, y, desc,
 *   formationId, lineup[6], bosses[], waves, tier, level, power }
 *
 * `power` 는 던전별 난이도 배율(기본 1.0)이다. `dungeon.js WAVE_POWER` 에 곱해진다 —
 * 네 던전은 **같은 난이도**가 기본값이다. 4번 던전(범용 세트)이 쉬우면 아무도 1~3번을
 * 돌지 않고, 어려우면 범용 세트라는 존재 이유가 사라진다.
 * 지형(biome)은 전투 배경과 적 풀을 함께 정한다 — 넷을 전부 다르게 골랐다.
 *
 * ★ `lineup` / `bosses` 는 **고정 편성**이다. 무작위로 뽑지 않는다.
 *   던전 적은 tier 5(심연 대역) 뿐인데 개체차가 커서(강철 거상 hp×3.58 ↔ 심연의 저격수 ×2.20),
 *   `buildEnemySquad` 로 무작위로 세우면 같은 배율에서도 웨이브별 승률이 **0% ↔ 100% 로**
 *   튄다(실측). 특히 지형 풀이 얇으면 후열이 전부 힐러(cave)이거나 전부 마법사(plains)로
 *   채워져 난이도가 통째로 뒤집힌다. 그래서 웨이브 난이도 축은 `WAVE_POWER` 하나만 남기고
 *   편성은 손으로 못 박았다. 층마다 같은 수비대를 상대하는 편이 "장비를 맞춰 다시 온다" 는
 *   던전 설계와도 맞는다.
 *   - `lineup` 은 **전열 → 후열 순서**의 호위 6기. 진형 슬롯에 그 순서로 앉는다.
 *   - `bosses` 는 층주(層主) 목록이며 **반드시 약한 순서대로** 적는다. 웨이브 구간을 통째로
 *     나눠 갖는다(2기면 1~5웨이브 / 6~10웨이브). 웨이브마다 번갈아 세우면 보스가 웨이브 총
 *     HP 의 3~4할이라 승률이 100% ↔ 0% 로 톱니처럼 튄다(실측).
 *   - 편성을 바꾸면 난이도가 통째로 움직인다. 바꿨으면 반드시 다시 재라.
 */
const DUNGEON_DEFS = [
  {
    id: 'frostbastion',
    name: '얼어붙은 성채',
    week: 1,
    setId: 'ironrampart',
    setName: '강철 성벽',
    sets: { normal: 'ironrampart', hard: 'ironrampart2', elite: 'ironrampart3' },
    archs: ['tank', 'lancer'],
    biome: 'tundra',
    x: 80, y: 60,
    formationId: 'ironwall',
    // 문을 막는 갑주 둘 + 백부장 + 추적자, 뒤에 벼락과 역병. 전열이 두꺼워 화력을 나누면 못 뚫는다.
    lineup: ['void_sentinel', 'void_sentinel', 'blood_captain', 'nightmare_stalker', 'storm_herald', 'blight_druid'],
    bosses: ['lich', 'void_titan'],
    // 실측 보정(8차): 전설 10칸 부대의 1웨이브 50% 지점 실측 → 기준 3.30 대비 0.929.
    power: 0.929,
    desc: '북쪽 끝, 성벽째로 얼어붙은 요새. 문을 지키라는 명령만 남은 갑주들이 아직도 층마다 서 있다. '
      + '방패를 앞세우고 한 층씩 밀어 올리는 것 말고는 방법이 없다.',
  },
  {
    id: 'bloodarena',
    name: '피의 투기장',
    week: 2,
    setId: 'bloodoath',
    setName: '피의 서약',
    sets: { normal: 'bloodoath', hard: 'bloodoath2', elite: 'bloodoath3' },
    archs: ['fighter', 'rogue'],
    biome: 'cave',
    x: 65, y: 430,
    formationId: 'arrowhead',
    // 투기장이라 죄다 앞으로 나온다. 뒤에는 상처를 꿰매는 대사제 하나뿐 — 저걸 먼저 끊어야 한다.
    lineup: ['void_sentinel', 'demon_warrior', 'demon_warrior', 'abyss_reaper', 'nightmare_stalker', 'abyss_hierophant'],
    bosses: ['demon_lord', 'flame_dragon'],
    // 실측 보정(8차): 근접 일변도라 무르다. 1웨이브 50% 지점 실측 → 1.043.
    power: 1.043,
    desc: '해안 절벽 아래로 파 내려간 지하 투기장. 모래는 오래전에 검게 굳었고, '
      + '누군가 이기면 다음 문이 열린다는 규칙만 남았다. 서약을 맺은 자는 등을 보이지 못한다.',
  },
  {
    id: 'starfall_spire',
    name: '별이 떨어진 관측탑',
    week: 3,
    setId: 'starseeker',
    setName: '별의 사수',
    sets: { normal: 'starseeker', hard: 'starseeker2', elite: 'starseeker3' },
    archs: ['archer', 'mage'],
    biome: 'mountain',
    x: 930, y: 240,
    formationId: 'crane',
    // 거상과 파수병이 계단을 막고, 그 뒤에서 전령이 벼락을 떨군다. 후열을 못 끊으면 시간이 적 편이다.
    lineup: ['iron_juggernaut', 'void_sentinel', 'blood_captain', 'demon_warrior', 'storm_herald', 'abyss_hierophant'],
    bosses: ['void_titan', 'flame_dragon'],
    // 실측 보정(8차): 전열 벽 둘 + 후열 화력이라 세다. 1웨이브 50% 지점 실측 → 0.938.
    power: 0.938,
    desc: '별 하나가 꽂힌 채로 무너지다 만 관측탑. 떨어진 별 조각이 아직 식지 않아 '
      + '탑 안쪽은 밤에도 훤하다. 활과 주문이 닿는 거리에서 끝내지 못하면 위층까지 못 간다.',
  },
  {
    id: 'astral_temple',
    name: '성좌의 신전',
    week: 4,
    setId: 'constellation',
    setName: '성좌의 은총',
    sets: { normal: 'constellation', hard: 'constellation2', elite: 'constellation3' },
    /* ★ 세트가 사제 전용이 되면서 여기도 같이 바꿨다 (sets.js constellation 주석 참고).
     *   던전의 archs 와 세트의 archs 는 **반드시 같아야 한다** — 스모크가 그걸 본다.
     *   어긋나면 던전은 «누구나 쓴다» 고 안내하는데 정작 못 끼는 상황이 된다. */
    archs: ['healer'],
    biome: 'plains',
    x: 430, y: 665,
    formationId: 'crescent',
    // 전열·후열·지원이 고르게 선 '교과서' 편성. 어떤 부대 조합이든 한 번은 시험해 본다.
    lineup: ['iron_juggernaut', 'blood_captain', 'blood_captain', 'abyss_marksman', 'storm_herald', 'abyss_hierophant'],
    bosses: ['blight_archon', 'void_titan'],
    // 실측 보정(8차): 균형 편성이라 가장 무르다. 1웨이브 50% 지점 실측 → 1.109.
    power: 1.109,
    desc: '남쪽 벌판 한가운데 홀로 선 신전. 천장에 박힌 별자리가 층마다 다르게 돈다. '
      + '여기서 나오는 한 벌은 **사제만** 걸칠 수 있다 — 별이 고른 것은 남을 살리는 손이다.',
  },
];

const DEF_BASE = {
  waves: DUNGEON_WAVES,
  tier: DUNGEON_TIER,
  level: DUNGEON_LEVEL,
  power: 1.0,
  formationId: 'basic',
  lineup: [],
  bosses: [],
};

/** 던전 맵 (id -> Dungeon) */
export const DUNGEONS = {};
for (const d of DUNGEON_DEFS) {
  DUNGEONS[d.id] = {
    ...DEF_BASE,
    ...d,
    archs: Array.isArray(d.archs) ? d.archs.slice() : ALL_ARCHS.slice(),
    lineup: Array.isArray(d.lineup) ? d.lineup.slice() : [],
    bosses: Array.isArray(d.bosses) ? d.bosses.slice() : [],
    /* 난이도별 세트. 데이터에 없으면 세 난이도가 전부 기본 세트를 가리킨다 (누락 방어) */
    sets: { normal: d.setId, hard: d.setId, elite: d.setId, ...(d.sets || {}) },
  };
}

/** 이 던전이 이 난이도에서 떨어뜨리는 세트 id */
export function setIdForDifficulty(dungeon, diff = 'normal') {
  const d = typeof dungeon === 'string' ? DUNGEONS[dungeon] : dungeon;
  if (!d) return null;
  const k = normDifficulty(diff);
  return (d.sets && d.sets[k]) || d.setId || null;
}

/** 순회용 배열 (DUNGEONS 와 동일 객체 참조). 주차 오름차순 */
export const DUNGEON_LIST = Object.values(DUNGEONS).sort((a, b) => a.week - b.week);
/** 던전 id 배열 (주차 순) */
export const DUNGEON_IDS = DUNGEON_LIST.map((d) => d.id);
/** 세트 id 배열 (주차 순) — ★ data/items.js 는 이 id 로 세트를 정의해야 한다 */
export const SET_IDS = DUNGEON_LIST.map((d) => d.setId);

/* ------------------------------------------------------------------ 조회 */

/** id 로 던전 조회 (없으면 null) */
export function getDungeon(id) {
  return (id && DUNGEONS[id]) || null;
}

/** 그 주차(1~4)에 열리는 던전 (없으면 null) */
export function dungeonForWeek(week) {
  const w = clamp(Math.round(Number(week) || 1), 1, DUNGEON_WEEKS);
  return DUNGEON_LIST.find((d) => d.week === w) || null;
}

/** 그 주차에 열리는 던전 목록. 지금은 항상 0~1개지만 배열로 열어 둔다 */
export function dungeonsForWeek(week) {
  const d = dungeonForWeek(week);
  return d ? [d] : [];
}

/** 세트 id 로 던전 역조회 (없으면 null) */
export function dungeonBySet(setId) {
  return DUNGEON_LIST.find((d) => d.setId === setId) || null;
}

/** 이 세트를 착용할 수 있는 아키타입 배열 (모르는 세트면 빈 배열) */
export function archsForSet(setId) {
  const d = dungeonBySet(setId);
  return d ? d.archs.slice() : [];
}

/** 그 아키타입이 이 던전(=세트)의 장비를 쓸 수 있는가 */
export function allowsArch(dungeonId, arch) {
  const d = getDungeon(dungeonId);
  return !!(d && arch && d.archs.includes(arch));
}

/** 세트 착용 제한 판정 — items/gear 쪽에서 그대로 쓰라고 열어 둔다 */
export function setAllowsArch(setId, arch) {
  const d = dungeonBySet(setId);
  return !!(d && arch && d.archs.includes(arch));
}

/** 던전 id 인가 */
export function isDungeonId(id) {
  return !!getDungeon(id);
}

/* ------------------------------------------------------------------ 검증 */

/**
 * 데이터 정합성 점검 (스모크용). 문제가 없으면 빈 배열.
 * 좌표 겹침은 도시 목록을 받아야 볼 수 있으므로 인자로 받는다.
 * @param {Array} [cities] data/world.js CITIES
 * @param {number} [minDist] 도시와의 최소 거리
 */
export function validateDungeons(cities = null, minDist = 120) {
  const errs = [];
  const weeks = new Set();
  const sets = new Set();
  for (const d of DUNGEON_LIST) {
    if (!d.id || !d.name) errs.push(`던전 id/name 누락: ${d.id}`);
    if (!(d.week >= 1 && d.week <= DUNGEON_WEEKS)) errs.push(`${d.id}: week 범위 밖 (${d.week})`);
    if (weeks.has(d.week)) errs.push(`${d.id}: 주차 중복 (${d.week})`);
    weeks.add(d.week);
    if (!d.setId) errs.push(`${d.id}: setId 누락`);
    if (sets.has(d.setId)) errs.push(`${d.id}: setId 중복 (${d.setId})`);
    sets.add(d.setId);
    if (d.waves !== DUNGEON_WAVES) errs.push(`${d.id}: waves 는 ${DUNGEON_WAVES} 여야 한다 (${d.waves})`);
    if (!Array.isArray(d.archs) || !d.archs.length) errs.push(`${d.id}: archs 누락`);
    if (!Array.isArray(d.lineup) || d.lineup.length !== 6) errs.push(`${d.id}: lineup 은 호위 6기여야 한다 (${(d.lineup || []).length})`);
    if (!Array.isArray(d.bosses) || !d.bosses.length) errs.push(`${d.id}: bosses 누락`);
    if (!d.formationId) errs.push(`${d.id}: formationId 누락`);
    for (const a of d.archs || []) if (!ALL_ARCHS.includes(a)) errs.push(`${d.id}: 알 수 없는 아키타입 ${a}`);
    if (!(d.x >= 0 && d.x <= 1000) || !(d.y >= 0 && d.y <= 700)) errs.push(`${d.id}: 좌표 범위 밖 (${d.x},${d.y})`);
    for (const c of Array.isArray(cities) ? cities : []) {
      const dist = Math.hypot((c.x ?? 0) - d.x, (c.y ?? 0) - d.y);
      if (dist < minDist) errs.push(`${d.id}: 도시 ${c.id} 와 너무 가깝다 (${Math.round(dist)})`);
    }
  }
  if (weeks.size !== DUNGEON_WEEKS) errs.push(`주차 ${DUNGEON_WEEKS}개를 전부 덮지 못했다 (${[...weeks].join(',')})`);
  return errs;
}
