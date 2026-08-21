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
  };
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
