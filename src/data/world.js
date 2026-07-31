// 세계 지도: 지역(Region) / 도시(City) / 이동 경로 / 이동 중 랜덤 이벤트.
// 순수 JS — 모듈 최상위에서 DOM·window를 절대 참조하지 않는다.
import { clamp, num } from '../core/util.js';
import { rng as globalRng } from '../core/rng.js';
import { BASE_CLASSES } from './classes.js';

/* ─────────────────────────────── 지역 ─────────────────────────────── */
// tier 1~5 로 난이도 구배를 만든다. 저티어는 지도 중앙(남부), 고티어는 변방.
export const REGIONS = [
  {
    id: 'heartland', name: '중원 평야', biome: 'plains', tier: 1,
    desc: '왕도로 향하는 밀밭과 교역로의 땅. 도적 떼 말고는 큰 위험이 없어 신참 용병단이 첫발을 딛는 곳이다.',
  },
  {
    id: 'whisperwood', name: '속삭임 숲', biome: 'forest', tier: 2,
    desc: '북서쪽을 뒤덮은 오래된 숲. 나무꾼과 밀렵꾼이 드나들지만, 밤에는 늑대와 숲의 것들이 길을 차지한다.',
  },
  {
    id: 'saltmere', name: '소금여울 해안', biome: 'coast', tier: 2,
    desc: '남서쪽 갯벌과 어촌이 이어진 해안선. 밀수선과 해적 소문이 끊이지 않는다.',
  },
  {
    id: 'blackfen', name: '검은 수렁', biome: 'swamp', tier: 3,
    desc: '남동쪽의 안개 낀 늪지대. 발밑이 무엇을 삼켰는지 아무도 세지 않는다.',
  },
  {
    id: 'ironspine', name: '강철척추 산맥', biome: 'mountain', tier: 3,
    desc: '북동쪽을 가르는 험준한 산줄기. 광맥과 갱도, 그리고 그 속에서 기어 나오는 것들의 영역이다.',
  },
  {
    id: 'sunscar', name: '태양흉터 황야', biome: 'desert', tier: 4,
    desc: '동쪽 끝의 붉은 모래바다. 옛 제국의 유적이 모래 밑에 잠겨 있고, 물 한 통이 검 한 자루 값이다.',
  },
  {
    id: 'frostmarch', name: '서리변경', biome: 'tundra', tier: 5,
    desc: '북쪽 끝, 사람의 법이 닿지 않는 얼어붙은 변경. 여기서 돌아온 용병단은 이야깃거리를 팔아 먹고산다.',
  },
];

const REGION_MAP = new Map(REGIONS.map((r) => [r.id, r]));
export function getRegion(id) { return REGION_MAP.get(id) || null; }

/* ─────────────────────────────── 도시 ─────────────────────────────── */
// 좌표계: x 0~1000, y 0~700 (y가 작을수록 북쪽).
// 같은 지역 도시는 서로 뭉쳐 있고, 티어가 높을수록 지도 외곽에 있다.
//
// ★ specialty: 그 도시가 배출하는 1차 클래스(1~2종).
//   특화 클래스는 그 도시 주점에서 유독 잘 나오고, 고등급(S·A) 확률도 크게 뛴다.
//   **도시 tier 와 무관하게 배분한다.** 1티어 도시의 특화 클래스가 5티어 비특화 도시보다
//   좋은 등급을 뽑아야, 부대가 커진 뒤에도 저티어 도시를 순회할 이유가 남는다.
//   1차 7종이 정확히 3개 도시씩(총 21칸) 나눠 갖고, 7종 전부 tier 1~2 도시에 거점이 하나씩 있다.
export const CITIES = [
  // 중원 평야 (tier 1) — 지도 중앙
  {
    id: 'greenhold', name: '초록성채', regionId: 'heartland', tier: 1, x: 500, y: 380,
    services: ['tavern', 'shop', 'guild', 'smith'], links: [],
    specialty: ['swordsman', 'acolyte'],
    desc: '밀밭 한가운데 선 낮은 성벽의 교역 도시. 이름 없는 용병단이 첫 계약서에 손도장을 찍는 곳이다. '
      + '성문 앞 검술 훈련장과 순례길 신전이 마주 보고 있어, 검사와 수도사는 여기서 구하는 게 가장 낫다.',
  },
  {
    id: 'millford', name: '물방아여울', regionId: 'heartland', tier: 1, x: 395, y: 300,
    services: ['tavern', 'shop', 'guild'], links: [],
    specialty: ['archer', 'rogue'],
    desc: '강을 낀 방앗간 마을. 곡물 수레가 끊임없이 오가고, 그만큼 노리는 자들도 많다. '
      + '물새를 쏘아 맞히는 활잡이와 수레를 노리다 손을 씻은 도적이 같은 주점에서 일자리를 기다린다.',
  },
  {
    id: 'kingsrest', name: '왕의안식', regionId: 'heartland', tier: 2, x: 610, y: 300,
    services: ['tavern', 'shop', 'guild', 'smith'], links: [],
    specialty: ['spearman', 'shieldman'],
    desc: '옛 왕이 사냥 중 묵었다는 성채 도시. 평야에서 가장 크고, 의뢰도 사람도 값이 비싸다. '
      + '왕실 상비군의 창벽 대열이 여기서 훈련해, 창병과 방패병만큼은 왕도에 뒤지지 않는다.',
  },

  // 속삭임 숲 (tier 2) — 북서
  {
    id: 'thornvale', name: '가시덤불골', regionId: 'whisperwood', tier: 2, x: 330, y: 195,
    services: ['tavern', 'guild', 'smith'], links: [],
    specialty: ['archer'],
    desc: '숲 어귀의 목책 마을. 사냥꾼과 밀렵꾼이 같은 탁자에 앉아 서로를 못 본 척한다. '
      + '나뭇가지 사이로 화살을 꿰는 활잡이들이 모여드는 변경 마을이라, 궁수의 고장으로 불린다.',
  },
  {
    id: 'elderoak', name: '늙은참나무', regionId: 'whisperwood', tier: 3, x: 215, y: 110,
    services: ['tavern', 'shop', 'guild'], links: [],
    specialty: ['apprentice'],
    desc: '천 년 묵은 참나무를 중심으로 지어진 숲속 마을. 나무 위 통로가 곧 거리다. '
      + '뿌리 아래 서고에서 나무의 말을 배우는 견습마법사들이 첫 지팡이를 받는 곳이다.',
  },

  // 소금여울 해안 (tier 2) — 남서
  {
    id: 'greymere', name: '잿빛여울', regionId: 'saltmere', tier: 2, x: 300, y: 500,
    services: ['tavern', 'shop', 'guild', 'smith'], links: [],
    specialty: ['rogue', 'apprentice'],
    desc: '늘 잿빛 안개가 깔린 하구 도시. 소금과 절인 생선, 그리고 소문이 주요 수출품이다. '
      + '안개를 읽는 주문 학당과 소문을 파는 밀정 길드가 같은 골목에 있어, 도적과 견습마법사가 흔하다.',
  },
  {
    id: 'gullport', name: '갈매기항', regionId: 'saltmere', tier: 3, x: 170, y: 600,
    services: ['tavern', 'shop', 'guild'], links: [],
    specialty: ['swordsman'],
    desc: '서남단 끝의 항구. 해적기를 내린 배들이 정박하고, 부두에서는 아무것도 묻지 않는다. '
      + '갑판 위에서 칼질을 배운 검사들이 배를 내려 계약을 찾는다.',
  },

  // 검은 수렁 (tier 3) — 남동
  {
    id: 'mirefall', name: '수렁폭포', regionId: 'blackfen', tier: 3, x: 560, y: 560,
    services: ['tavern', 'guild', 'smith'], links: [],
    specialty: ['spearman', 'acolyte'],
    desc: '늪으로 쏟아지는 흙탕 폭포 옆에 말뚝을 박아 세운 마을. 바닥은 늘 젖어 있다. '
      + '작살로 늪을 헤치는 창병과 역병을 돌보는 수도사가 마을을 지탱한다.',
  },
  {
    id: 'blackreed', name: '검은갈대', regionId: 'blackfen', tier: 4, x: 700, y: 640,
    services: ['tavern', 'shop', 'guild'], links: [],
    specialty: ['rogue'],
    desc: '갈대밭 깊숙이 숨은 무법 마을. 늪지 약초와 독, 그리고 사라진 사람들의 유품을 판다. '
      + '갈대 사이로 소리 없이 다니는 법을 아는 도적이라면 여기 말고 갈 곳이 없다.',
  },

  // 강철척추 산맥 (tier 3) — 북동
  {
    id: 'stonewatch', name: '돌망루', regionId: 'ironspine', tier: 3, x: 700, y: 190,
    services: ['tavern', 'shop', 'guild', 'smith'], links: [],
    specialty: ['shieldman'],
    desc: '산길 고개를 지키는 요새 도시. 북쪽에서 내려오는 모든 것이 이 관문을 먼저 만난다. '
      + '고갯길을 몸으로 막아 온 방패병들이 대를 이어 성벽을 지킨다.',
  },
  {
    id: 'deepdelve', name: '깊은굴', regionId: 'ironspine', tier: 4, x: 820, y: 120,
    services: ['tavern', 'shop', 'guild', 'smith'], links: [],
    specialty: ['swordsman'],
    desc: '산 속을 파고 들어간 광산 도시. 갱도가 너무 깊어져 아래층 절반은 봉인되어 있다. '
      + '검을 벼리는 도시답게, 자기가 두드린 검을 차고 갱도를 지키는 검사가 많다.',
  },

  // 태양흉터 황야 (tier 4) — 동쪽 외곽
  {
    id: 'dunehold', name: '모래성채', regionId: 'sunscar', tier: 4, x: 880, y: 400,
    services: ['tavern', 'shop', 'guild', 'smith'], links: [],
    specialty: ['spearman', 'archer'],
    desc: '사막 대상로의 유일한 우물을 낀 성채. 물값이 곧 통행세이고, 칼이 곧 계약서다. '
      + '대상을 호위하는 낙타 창기와 모래언덕 위의 활잡이가 이곳 주점의 단골이다.',
  },
  {
    id: 'emberwell', name: '잿불우물', regionId: 'sunscar', tier: 5, x: 960, y: 540,
    services: ['tavern', 'shop', 'guild'], links: [],
    specialty: ['apprentice'],
    desc: '땅속에서 불이 새어 나오는 유적 위에 세워진 변경 취락. 유물 사냥꾼들의 마지막 보급지. '
      + '유적에서 주워 온 주문을 더듬거리는 견습마법사가 끊이지 않는다.',
  },

  // 서리변경 (tier 5) — 북쪽 끝
  {
    id: 'frostgate', name: '서리관문', regionId: 'frostmarch', tier: 5, x: 520, y: 70,
    services: ['tavern', 'guild', 'smith'], links: [],
    specialty: ['shieldman', 'acolyte'],
    desc: '얼어붙은 성벽 하나가 북쪽 전부를 막아선다. 이곳 주점의 술은 얼지 않는 것만으로 값을 한다. '
      + '성벽에 붙어 사는 방패병과 언 손을 녹이는 수도사가 이 관문의 전부다.',
  },
];

const CITY_MAP = new Map(CITIES.map((c) => [c.id, c]));

/** 시작 도시 id (게임 상태의 초기 cityId) */
export const START_CITY = 'greenhold';

/* ───────────────────────────── 도로망 ───────────────────────────── */
// [도시A, 도시B, 소요일수] — 여기서 양방향 links 를 자동 생성하므로 항상 대칭이다.
const EDGES = [
  ['greenhold', 'millford', 2],
  ['greenhold', 'kingsrest', 2],
  ['greenhold', 'greymere', 3],
  ['greenhold', 'mirefall', 3],
  ['millford', 'kingsrest', 3],
  ['millford', 'thornvale', 2],
  ['millford', 'greymere', 3],
  ['kingsrest', 'stonewatch', 2],
  ['kingsrest', 'mirefall', 4],
  ['kingsrest', 'dunehold', 4],
  ['thornvale', 'elderoak', 2],
  ['elderoak', 'frostgate', 5],
  ['greymere', 'gullport', 2],
  ['greymere', 'mirefall', 4],
  ['mirefall', 'blackreed', 2],
  ['blackreed', 'emberwell', 4],
  ['stonewatch', 'deepdelve', 2],
  ['stonewatch', 'frostgate', 3],
  ['deepdelve', 'dunehold', 4],
  ['dunehold', 'emberwell', 3],
];

for (const [a, b, days] of EDGES) {
  const ca = CITY_MAP.get(a);
  const cb = CITY_MAP.get(b);
  if (!ca || !cb) continue;
  if (!ca.links.some((l) => l.to === b)) ca.links.push({ to: b, days });
  if (!cb.links.some((l) => l.to === a)) cb.links.push({ to: a, days });
}

/* ───────────────────────────── 특화 클래스 ───────────────────────────── */
// 정의 시점에 오타를 잡는다: BASE_CLASSES(1차 7종)에 없는 id 가 섞이면 그 자리에서 버린다.
// data/ 는 순수 JS 라 예외를 던지면 게임 전체가 부팅에 실패하므로, 경고만 남기고 걸러낸다.
const BASE_SET = new Set(BASE_CLASSES || []);
for (const c of CITIES) {
  const raw = Array.isArray(c.specialty) ? c.specialty : [];
  const ok = raw.filter((id) => BASE_SET.has(id));
  if (ok.length !== raw.length) {
    console.warn('[world] 알 수 없는 특화 클래스 id', c.id, raw.filter((id) => !BASE_SET.has(id)));
  }
  c.specialty = ok;
}

/** 도시의 특화 1차 클래스 id 배열. 없으면 빈 배열 */
export function citySpecialty(cityId) {
  const c = getCity(cityId);
  return Array.isArray(c?.specialty) ? c.specialty.slice() : [];
}

/** 이 도시가 해당 클래스를 특화하는가 (merc.gradeRoll 의 opts.specialty 에 그대로 넘긴다) */
export function isSpecialtyCity(cityId, classId) {
  return citySpecialty(cityId).includes(classId);
}

/** 해당 클래스를 특화하는 도시 id 배열 (UI: "어디 가면 잘 나오나") */
export function citiesForClass(classId) {
  if (!classId) return [];
  return CITIES.filter((c) => (c.specialty || []).includes(classId)).map((c) => c.id);
}

/* ───────────────────────────── 조회 헬퍼 ───────────────────────────── */
export function getCity(id) { return CITY_MAP.get(id) || null; }

/** 도시가 속한 지역 객체 */
export function cityRegion(cityId) {
  const c = getCity(cityId);
  return c ? getRegion(c.regionId) : null;
}

/** 도시의 지형(biome). 알 수 없으면 'plains' */
export function cityBiome(cityId) {
  return cityRegion(cityId)?.biome || 'plains';
}

/** 인접 도시 목록 [{to, days}] */
export function neighbors(cityId) {
  return getCity(cityId)?.links.slice() || [];
}

/** 두 도시가 직접 연결돼 있으면 소요일수, 아니면 null */
export function linkDays(a, b) {
  return getCity(a)?.links.find((l) => l.to === b)?.days ?? null;
}

/* ───────────────────────── 다익스트라 (경로 탐색) ───────────────────────── */
const _pathCache = new Map(); // fromId -> {dist:Map, prev:Map}

function dijkstra(from) {
  const cached = _pathCache.get(from);
  if (cached) return cached;
  const dist = new Map();
  const prev = new Map();
  const done = new Set();
  for (const c of CITIES) dist.set(c.id, Infinity);
  if (!dist.has(from)) return { dist, prev };
  dist.set(from, 0);
  for (;;) {
    let cur = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) { best = d; cur = id; }
    }
    if (cur == null) break;
    done.add(cur);
    for (const lk of getCity(cur).links) {
      const nd = best + lk.days;
      if (nd < (dist.get(lk.to) ?? Infinity)) {
        dist.set(lk.to, nd);
        prev.set(lk.to, cur);
      }
    }
  }
  const res = { dist, prev };
  _pathCache.set(from, res);
  return res;
}

/** a→b 최단 이동 일수. 같은 도시면 0, 도달 불가면 Infinity */
export function travelDays(a, b) {
  if (a === b) return 0;
  if (!getCity(a) || !getCity(b)) return Infinity;
  return dijkstra(a).dist.get(b) ?? Infinity;
}

/** a→b 최단 경로를 도시 id 배열로 반환 (양 끝 포함). 같은 도시면 [a], 불가면 [] */
export function pathBetween(a, b) {
  if (!getCity(a) || !getCity(b)) return [];
  if (a === b) return [a];
  const { dist, prev } = dijkstra(a);
  if (!Number.isFinite(dist.get(b) ?? Infinity)) return [];
  const out = [b];
  let cur = b;
  while (cur !== a) {
    cur = prev.get(cur);
    if (cur == null) return [];
    out.push(cur);
  }
  return out.reverse();
}

/* ─────────────────────── 이동 중 랜덤 이벤트 ─────────────────────── */
// apply(state, rng) 는 state 를 절대 직접 수정하지 않는다.
// 반환: { text, gold?, itemRoll?, battle? }
//   gold     : 골드 증감(음수 가능). 호출부가 state.gold 에 더하고 0 미만은 잘라낸다.
//   itemRoll : { ilvl, rarityBonus }  — gear.js 의 아이템 롤 인자와 동일 형태
//   battle   : { name, biome, tier, level, count, rank } — quest 유사 객체.
//              enemies.js 의 buildEnemySquad(questLike, rng) 에 그대로 넘길 수 있다.

/** 부대 평균 레벨 (없으면 1) */
function partyLevel(state) {
  const roster = (state && state.roster) || [];
  const lv = roster.filter((m) => m && m.level > 0).map((m) => m.level);
  if (!lv.length) return 1;
  return Math.round(lv.reduce((a, b) => a + b, 0) / lv.length);
}

/** 레벨에 따른 금액 배율 */
function goldScale(state) { return 1 + partyLevel(state) * 0.25; }

/** 이벤트가 벌어진 지형 추정: 현재 도시 지형, 이벤트가 지형 한정이면 그쪽을 우선 */
function ctxBiome(state, ev) {
  const b = cityBiome(state && state.cityId);
  if (ev.biome && !ev.biome.includes(b)) return ev.biome[0];
  return b;
}

/** 이벤트가 벌어진 지역 티어 */
function ctxTier(state) {
  return clamp(cityRegion(state && state.cityId)?.tier || 1, 1, 5);
}

/** 조우 전투 정의 생성 */
function encounter(state, ev, { name, count = 3, lvDelta = 0 }) {
  const level = clamp(partyLevel(state) + lvDelta, 1, 60);
  return {
    name,
    biome: ctxBiome(state, ev),
    tier: ctxTier(state),
    level,
    count: clamp(count, 1, 7),
    rank: ['F', 'E', 'D', 'C', 'B'][clamp(ctxTier(state) - 1, 0, 4)],
  };
}

/** 전리품 롤 정의 생성 */
function loot(state, { lvDelta = 0, rarityBonus = 0 } = {}) {
  return { ilvl: clamp(partyLevel(state) + lvDelta, 1, 60), rarityBonus };
}

/** 금액 계산 (음수도 그대로 반환) */
function coin(state, rng, lo, hi) {
  const raw = rng.int(lo, hi) * goldScale(state);
  return Math.round(raw / 5) * 5;
}

export const TRAVEL_EVENTS = [
  {
    id: 'bandit_ambush', name: '산적의 매복', weight: 12,
    apply(state, rng) {
      const n = rng.int(3, 5);
      return {
        text: `좁아진 길목 양쪽에서 휘파람이 울린다. 산적 ${n}명이 통행세를 요구하며 길을 막아섰다.`,
        battle: encounter(state, this, { name: '노상의 산적 떼', count: n, lvDelta: 0 }),
      };
    },
  },
  {
    id: 'wolf_pack', name: '굶주린 늑대 무리', weight: 10,
    biome: ['forest', 'mountain', 'tundra', 'plains'],
    apply(state, rng) {
      const n = rng.int(3, 5);
      return {
        text: '해가 지자 나무 사이에서 눈동자들이 하나둘 켜진다. 늑대 무리가 대열을 둘러싸기 시작했다.',
        battle: encounter(state, this, { name: '굶주린 늑대 무리', count: n, lvDelta: -1 }),
      };
    },
  },
  {
    id: 'deserters', name: '탈영병', weight: 7,
    apply(state, rng) {
      const n = rng.int(2, 4);
      return {
        text: '불 꺼진 야영지에서 갑옷 조각을 걸친 자들이 튀어나온다. 군기를 버린 탈영병들이다.',
        battle: encounter(state, this, { name: '탈영병 무리', count: n, lvDelta: 2 }),
      };
    },
  },
  {
    id: 'grave_crawlers', name: '파헤쳐진 무덤', weight: 6,
    biome: ['swamp', 'desert', 'plains', 'tundra'],
    apply(state, rng) {
      const n = rng.int(3, 5);
      return {
        text: '길가의 봉분이 안쪽에서부터 무너져 있다. 흙을 밀어내며 무언가가 기어 올라온다.',
        battle: encounter(state, this, { name: '무덤에서 기어 나온 것들', count: n, lvDelta: 1 }),
      };
    },
  },
  {
    id: 'merchant_caravan', name: '상단 동행', weight: 10,
    apply(state, rng) {
      const g = coin(state, rng, 40, 90);
      return {
        text: `같은 방향으로 가는 상단과 하루를 동행했다. 호위 몫으로 ${num(g)} 골드를 받았다.`,
        gold: g,
      };
    },
  },
  {
    id: 'hunter_camp', name: '사냥꾼 야영지', weight: 8,
    biome: ['forest', 'mountain', 'tundra', 'plains'],
    apply(state, rng) {
      const g = coin(state, rng, 25, 60);
      return {
        text: `사냥꾼 야영지에 들러 모닥불을 나눴다. 남는 모피를 헐값에 사들여 되팔아 ${num(g)} 골드를 남겼다.`,
        gold: g,
      };
    },
  },
  {
    id: 'lost_scholar', name: '길 잃은 학자', weight: 6,
    apply(state, rng) {
      const g = coin(state, rng, 35, 75);
      return {
        text: `지도를 거꾸로 들고 헤매던 학자를 마을 어귀까지 데려다줬다. 사례금 ${num(g)} 골드.`,
        gold: g,
      };
    },
  },
  {
    id: 'toll_gate', name: '통행세 징수소', weight: 9,
    apply(state, rng) {
      const g = coin(state, rng, 20, 50);
      return {
        text: `영주의 이름이 적힌 목책이 길을 막는다. 시비를 걸어봐야 남는 게 없어 ${num(g)} 골드를 냈다.`,
        gold: -g,
      };
    },
  },
  {
    id: 'roadside_shrine', name: '길가의 사당', weight: 7,
    apply(state, rng) {
      const g = coin(state, rng, 10, 30);
      return {
        text: `이끼 낀 사당 앞에서 대원들이 걸음을 멈춘다. ${num(g)} 골드를 헌납하자 분위기가 한결 누그러졌다.`,
        gold: -g,
      };
    },
  },
  {
    id: 'wandering_bard', name: '떠돌이 음유시인', weight: 6,
    apply(state, rng) {
      const g = coin(state, rng, 10, 25);
      return {
        text: `모닥불 옆에 낯선 악사가 끼어들었다. ${num(g)} 골드어치 술값을 대신 내주고 용병단 이야기 한 소절을 얻었다.`,
        gold: -g,
      };
    },
  },
  {
    id: 'downpour', name: '쏟아지는 폭우', weight: 8,
    biome: ['plains', 'forest', 'coast', 'swamp', 'mountain'],
    apply(state, rng) {
      const g = coin(state, rng, 15, 40);
      return {
        text: `밤새 퍼붓는 비에 수레 덮개가 찢어졌다. 젖어 못 쓰게 된 보급품이 ${num(g)} 골드어치.`,
        gold: -g,
      };
    },
  },
  {
    id: 'sandstorm', name: '모래폭풍', weight: 11, biome: ['desert'],
    apply(state, rng) {
      const g = coin(state, rng, 25, 60);
      return {
        text: `지평선이 통째로 일어서더니 모래벽이 덮쳤다. 물통 몇 개와 ${num(g)} 골드어치 짐을 모래에 묻고 왔다.`,
        gold: -g,
      };
    },
  },
  {
    id: 'frozen_pass', name: '얼어붙은 고갯길', weight: 11, biome: ['tundra', 'mountain'],
    apply(state, rng) {
      const g = coin(state, rng, 20, 55);
      return {
        text: `고갯길이 통째로 얼음판이 됐다. 짐말 한 마리를 잃고 ${num(g)} 골드어치 장비를 절벽 아래로 흘렸다.`,
        gold: -g,
      };
    },
  },
  {
    id: 'swamp_miasma', name: '늪의 독기', weight: 11, biome: ['swamp'],
    apply(state, rng) {
      const g = coin(state, rng, 20, 45);
      return {
        text: `수면에서 피어오른 누런 안개가 목을 긁는다. ${num(g)} 골드어치 해독 약초를 태워 겨우 빠져나왔다.`,
        gold: -g,
      };
    },
  },
  {
    id: 'smuggler_boat', name: '밀수선 접선', weight: 10, biome: ['coast'],
    apply(state, rng) {
      const g = coin(state, rng, 30, 70);
      return {
        text: `안개 속 밀수선이 등불로 신호를 보낸다. ${num(g)} 골드를 건네고 출처가 수상한 물건 하나를 받았다.`,
        gold: -g,
        itemRoll: loot(state, { lvDelta: 2, rarityBonus: 1 }),
      };
    },
  },
  {
    id: 'abandoned_cart', name: '버려진 짐수레', weight: 8,
    apply(state, rng) {
      const bonus = rng.chance(0.25) ? 1 : 0;
      return {
        text: '바퀴가 부러진 짐수레가 길가에 처박혀 있다. 주인은 보이지 않는다. 쓸 만한 것이 하나 남아 있었다.',
        itemRoll: loot(state, { lvDelta: 0, rarityBonus: bonus }),
      };
    },
  },
  {
    id: 'old_battlefield', name: '오래된 전장터', weight: 7,
    biome: ['plains', 'desert', 'swamp', 'tundra', 'coast'],
    apply(state, rng) {
      const g = coin(state, rng, 15, 45);
      return {
        text: `녹슨 창날이 잡초처럼 솟은 옛 전장을 가로질렀다. 뒤져서 ${num(g)} 골드와 아직 쓸 만한 장비를 챙겼다.`,
        gold: g,
        itemRoll: loot(state, { lvDelta: -2, rarityBonus: 0 }),
      };
    },
  },
  {
    id: 'ruined_watchtower', name: '무너진 망루', weight: 7,
    biome: ['mountain', 'plains', 'tundra', 'forest'],
    apply(state, rng) {
      const bonus = rng.chance(0.35) ? 1 : 0;
      return {
        text: '허물어진 망루 지하에 봉인된 무기고가 남아 있었다. 자물쇠는 이미 세월이 부숴놨다.',
        itemRoll: loot(state, { lvDelta: 3, rarityBonus: bonus }),
      };
    },
  },
];

// apply 안에서 자기 자신(this.biome)을 참조하므로, 함수만 떼어 써도 안전하도록 미리 바인딩한다.
for (const ev of TRAVEL_EVENTS) ev.apply = ev.apply.bind(ev);

/** 해당 지형에서 발생 가능한 이벤트만 추린다 */
export function travelEventsFor(biome) {
  return TRAVEL_EVENTS.filter((e) => !e.biome || e.biome.includes(biome));
}

/** 지형에 맞는 이벤트 하나를 가중 추첨해 반환 (apply 는 호출부가 실행) */
export function rollTravelEvent(biome, rng = globalRng) {
  const pool = travelEventsFor(biome);
  if (!pool.length) return null;
  return rng.weighted(pool, 'weight');
}
