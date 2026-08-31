// 진형 데이터. 순수 JS (DOM 참조 금지).
//
// 좌표계: slot.x = 0(최전방) ~ 1(최후방), slot.y = 0(위) ~ 1(아래).
//   engine 이 아군은 `x = 44 - slot.x*36`, 적군은 `x = 56 + slot.x*36`, `y = 8 + slot.y*44` 로 변환한다.
//   따라서 여기 좌표는 "그 진형의 그림" 그대로여야 한다 (학익진은 V, 봉시진은 화살촉 …).
//   모든 슬롯은 서로 0.12 이상 떨어져 있다 (스프라이트 겹침 방지).
//
// 구역 판정: front = x < 0.34, back = x >= 0.66, 나머지 mid.
// effects[].scope: 'all' | 'front' | 'mid' | 'back' | 'role:<arch>' | 'arch:<arch>' | 'class:<classId>'
//   role: 과 arch: 는 동의어이며 ARCHETYPES 키(tank/fighter/lancer/archer/rogue/mage/healer)를 받는다.
// effects[].mods: §2.1 최종 스탯에 곱연산으로 적용될 배율 (`scaleStats`). 0.2 = +20%.

/** 구역 경계 */
export const FRONT_X = 0.34;
export const BACK_X = 0.66;

/** 스탯 한국어 표기 (UI 요약용) */
const STAT_LABEL = {
  hp: '체력', atk: '공격', def: '방어', res: '저항',
  spd: '속도', crit: '치명', critDmg: '치명피해', eva: '회피',
};

/** 아키타입 한국어 표기 (UI 요약용) */
const ARCH_LABEL = {
  tank: '방패', fighter: '전사', lancer: '창병', archer: '궁수',
  rogue: '도적', mage: '마법', healer: '치유',
};

/** 슬롯이 속한 구역 */
export function slotZone(slot) {
  const x = typeof slot === 'number' ? slot : slot ? slot.x : 0;
  if (x < FRONT_X) return 'front';
  if (x >= BACK_X) return 'back';
  return 'mid';
}

export const FORMATIONS = {
  basic: {
    id: 'basic',
    name: '기본진',
    slots: [
      { x: 0.14, y: 0.25 }, { x: 0.14, y: 0.50 }, { x: 0.14, y: 0.75 },
      { x: 0.46, y: 0.35 }, { x: 0.46, y: 0.65 },
      { x: 0.80, y: 0.35 }, { x: 0.80, y: 0.65 },
    ],
    effects: [],
    cost: 0,
    source: '기본 지급',
    tier: 1,
    desc: '전열 셋, 중열 둘, 후열 둘의 표준 대형. 아무 보정도 없지만 약점도 없다.',
  },

  round: {
    id: 'round',
    name: '방원진',
    // 중앙 1 + 바깥 6 = 완전한 원. 사방에서 오는 공격을 받아내는 방어 대형.
    slots: [
      { x: 0.17, y: 0.50 },
      { x: 0.33, y: 0.24 }, { x: 0.33, y: 0.76 },
      { x: 0.50, y: 0.50 },
      { x: 0.67, y: 0.24 }, { x: 0.67, y: 0.76 },
      { x: 0.83, y: 0.50 },
    ],
    effects: [
      { scope: 'all', mods: { def: 0.08, res: 0.08, spd: -0.075 } },
      { scope: 'front', mods: { hp: 0.07, atk: -0.09 } },
      { scope: 'role:tank', mods: { def: 0.05 } },
    ],
    cost: 900,
    source: '상점',
    tier: 1,
    desc: '둥글게 뭉쳐 사방을 막는다. 방어와 저항이 크게 오르지만 발이 느리고 화력이 떨어진다.',
  },

  arrowhead: {
    id: 'arrowhead',
    name: '봉시진',
    // 화살촉: 뾰족한 촉(3열) + 뒤로 뻗은 화살대(2).
    slots: [
      { x: 0.06, y: 0.50 },
      { x: 0.26, y: 0.34 }, { x: 0.26, y: 0.66 },
      { x: 0.46, y: 0.20 }, { x: 0.46, y: 0.80 },
      { x: 0.62, y: 0.50 },
      { x: 0.84, y: 0.50 },
    ],
    effects: [
      { scope: 'front', mods: { atk: 0.09, spd: 0.045, def: -0.070, res: -0.070 } },
      { scope: 'mid', mods: { atk: 0.038, crit: 0.056 } },
      { scope: 'back', mods: { spd: 0.038, hp: -0.075 } },
    ],
    cost: 1100,
    source: '상점',
    tier: 1,
    desc: '화살촉처럼 한 점을 찔러 들어간다. 선봉의 공격이 크게 오르는 대신 몸이 종잇장이 된다.',
  },

  crane: {
    id: 'crane',
    name: '학익진',
    // 학이 날개를 펼친 V. 가운데 미끼 하나, 양 날개가 뒤로 크게 벌어진다.
    slots: [
      { x: 0.12, y: 0.50 },
      { x: 0.30, y: 0.32 }, { x: 0.30, y: 0.68 },
      { x: 0.52, y: 0.18 }, { x: 0.52, y: 0.82 },
      { x: 0.74, y: 0.06 }, { x: 0.74, y: 0.94 },
    ],
    effects: [
      { scope: 'back', mods: { atk: 0.11, crit: 0.125 } },
      { scope: 'mid', mods: { atk: 0.05, spd: 0.04 } },
      { scope: 'front', mods: { def: -0.075, hp: -0.055 } },
      { scope: 'role:archer', mods: { atk: 0.06, spd: 0.05 } },
      { scope: 'role:mage', mods: { atk: 0.06 } },
    ],
    cost: 2200,
    source: '상점',
    tier: 2,
    desc: '날개를 펼쳐 적을 감싸 안는다. 후열 사격수의 화력이 폭발하지만 중앙 미끼는 버티기 어렵다.',
  },

  serpent: {
    id: 'serpent',
    name: '장사진',
    // 세로 일렬. 전원이 같은 깊이에 서서 전부 최전선이 된다.
    slots: [
      { x: 0.50, y: 0.05 }, { x: 0.50, y: 0.20 }, { x: 0.50, y: 0.35 },
      { x: 0.50, y: 0.50 },
      { x: 0.50, y: 0.65 }, { x: 0.50, y: 0.80 }, { x: 0.50, y: 0.95 },
    ],
    effects: [
      { scope: 'all', mods: { atk: 0.05, spd: 0.045, def: -0.070, res: -0.070 } },
      { scope: 'role:rogue', mods: { eva: 0.038, crit: 0.031 } },
      { scope: 'role:lancer', mods: { atk: 0.021 } },
    ],
    cost: 1600,
    source: '상점',
    tier: 2,
    desc: '한 줄로 길게 늘어서 전원이 동시에 맞붙는다. 전열·후열 구분이 사라져 화력은 늘고 방어는 무너진다.',
  },

  scale: {
    id: 'scale',
    name: '어린진',
    // 물고기 비늘처럼 촘촘히 겹친 쐐기. 중앙 돌파용.
    slots: [
      { x: 0.10, y: 0.50 },
      { x: 0.32, y: 0.36 }, { x: 0.32, y: 0.64 },
      { x: 0.54, y: 0.22 }, { x: 0.54, y: 0.50 }, { x: 0.54, y: 0.78 },
      { x: 0.80, y: 0.50 },
    ],
    effects: [
      { scope: 'front', mods: { atk: 0.032, hp: 0.025 } },
      { scope: 'mid', mods: { atk: 0.028, crit: 0.035 } },
      { scope: 'back', mods: { def: -0.105, res: -0.105, spd: -0.06 } },
      { scope: 'role:fighter', mods: { atk: 0.014, critDmg: 0.026 } },
    ],
    cost: 3200,
    source: '상점',
    tier: 3,
    desc: '비늘처럼 겹쳐 중앙을 짓밟는 밀집 쐐기. 앞과 가운데가 두터워지는 대신 뒤가 얇아진다.',
  },

  geese: {
    id: 'geese',
    name: '안행진',
    // 기러기 행렬: 앞위 -> 뒤아래로 이어지는 사선.
    slots: [
      { x: 0.08, y: 0.14 }, { x: 0.20, y: 0.26 }, { x: 0.32, y: 0.38 },
      { x: 0.44, y: 0.50 },
      { x: 0.56, y: 0.62 }, { x: 0.68, y: 0.74 }, { x: 0.80, y: 0.86 },
    ],
    effects: [
      { scope: 'all', mods: { spd: 0.049, eva: 0.07, def: -0.035 } },
      { scope: 'mid', mods: { atk: 0.042 } },
      { scope: 'role:archer', mods: { crit: 0.07 } },
      { scope: 'role:tank', mods: { spd: 0.028, hp: -0.06 } },
    ],
    cost: 1800,
    source: '상점',
    tier: 2,
    desc: '기러기 떼처럼 비스듬히 늘어서 측면을 노린다. 속도와 회피를 얻고 정면 방어를 내준다.',
  },

  crescent: {
    id: 'crescent',
    name: '언월진',
    // 반달: 양 뿔이 앞으로 튀어나오고 중앙이 뒤로 움푹 들어간다.
    slots: [
      { x: 0.10, y: 0.06 }, { x: 0.10, y: 0.94 },
      { x: 0.46, y: 0.21 }, { x: 0.46, y: 0.79 },
      { x: 0.68, y: 0.36 }, { x: 0.68, y: 0.64 },
      { x: 0.74, y: 0.50 },
    ],
    effects: [
      { scope: 'front', mods: { atk: 0.138, crit: 0.127, hp: -0.045 } },
      { scope: 'mid', mods: { atk: 0.057, def: 0.057 } },
      { scope: 'back', mods: { def: 0.115, res: 0.115, spd: -0.037 } },
      { scope: 'role:healer', mods: { atk: 0.086, res: 0.057 } },
    ],
    cost: 3600,
    source: '이벤트',
    tier: 3,
    desc: '두 뿔로 적을 물고 중앙 오목한 곳으로 끌어들인다. 뿔은 날카롭고 안쪽은 단단하지만 굼뜨다.',
  },

  ironwall: {
    id: 'ironwall',
    name: '철벽진',
    // 앞을 넷으로 꽉 막고, 그 뒤를 둘이 메우고, 지휘관 하나가 뒤에 선다.
    slots: [
      { x: 0.08, y: 0.12 }, { x: 0.08, y: 0.37 }, { x: 0.08, y: 0.63 }, { x: 0.08, y: 0.88 },
      { x: 0.28, y: 0.30 }, { x: 0.28, y: 0.70 },
      { x: 0.70, y: 0.50 },
    ],
    effects: [
      { scope: 'all', mods: { def: 0.074, res: 0.052, spd: -0.055 } },
      { scope: 'front', mods: { hp: 0.067, atk: -0.045 } },
      { scope: 'back', mods: { atk: 0.056 } },
      { scope: 'role:tank', mods: { def: 0.056, hp: 0.037 } },
    ],
    cost: 2400,
    source: '상점',
    tier: 2,
    desc: '방패를 맞물려 벽을 세운다. 웬만한 돌격은 튕겨내지만 대열이 무거워 발이 느리고 화력이 죽는다.',
  },

  ambush: {
    id: 'ambush',
    name: '매복진',
    // 앞에 미끼 하나, 나머지는 뒤 양쪽 구석에 숨는다.
    slots: [
      { x: 0.10, y: 0.50 },
      { x: 0.56, y: 0.14 }, { x: 0.56, y: 0.86 },
      { x: 0.74, y: 0.06 }, { x: 0.74, y: 0.94 },
      { x: 0.80, y: 0.26 }, { x: 0.80, y: 0.74 },
    ],
    effects: [
      { scope: 'front', mods: { eva: 0.1, atk: 0.06, hp: -0.15 } },
      { scope: 'mid', mods: { spd: 0.06, crit: 0.08 } },
      { scope: 'back', mods: { atk: 0.064, crit: 0.14, def: -0.09 } },
      { scope: 'role:rogue', mods: { spd: 0.072, critDmg: 0.08 } },
      { scope: 'role:archer', mods: { crit: 0.06 } },
    ],
    cost: 3400,
    source: '이벤트',
    tier: 3,
    desc: '미끼 하나를 세우고 나머지는 숨는다. 숨은 자들의 급소 적중률이 치솟지만 미끼는 목숨을 건다.',
  },

  twinhead: {
    id: 'twinhead',
    name: '쌍두진',
    // 위아래 두 개의 화살촉 + 뒤에서 둘을 잇는 지휘관.
    slots: [
      { x: 0.12, y: 0.24 }, { x: 0.12, y: 0.76 },
      { x: 0.36, y: 0.12 }, { x: 0.36, y: 0.38 },
      { x: 0.36, y: 0.62 }, { x: 0.36, y: 0.88 },
      { x: 0.72, y: 0.50 },
    ],
    effects: [
      { scope: 'front', mods: { atk: 0.04, spd: 0.022, def: -0.105 } },
      { scope: 'mid', mods: { atk: 0.026, crit: 0.033, res: -0.075 } },
      { scope: 'back', mods: { hp: 0.049, res: 0.04, spd: -0.06 } },
      { scope: 'role:tank', mods: { def: 0.026 } },
    ],
    cost: 2000,
    source: '상점',
    tier: 2,
    desc: '두 개의 머리로 위아래를 동시에 문다. 양쪽 선봉이 사나워지지만 가운데가 텅 비어 방어가 얇다.',
  },

  newmoon: {
    id: 'newmoon',
    name: '신월진',
    // 초승달처럼 가늘게 휜 갈고리. 앞에서 시작해 아래를 감고 뒤로 말려 올라간다.
    slots: [
      { x: 0.10, y: 0.52 }, { x: 0.14, y: 0.30 },
      { x: 0.20, y: 0.72 }, { x: 0.38, y: 0.86 },
      { x: 0.60, y: 0.90 }, { x: 0.78, y: 0.78 },
      { x: 0.86, y: 0.58 },
    ],
    effects: [
      { scope: 'all', mods: { spd: 0.04, crit: 0.05, hp: -0.045 } },
      { scope: 'mid', mods: { atk: 0.04 } },
      { scope: 'back', mods: { atk: 0.045, critDmg: 0.05, def: -0.075 } },
      { scope: 'role:rogue', mods: { eva: 0.05 } },
      { scope: 'role:mage', mods: { atk: 0.025 } },
    ],
    cost: 4200,
    source: '이벤트',
    tier: 3,
    desc: '가는 초승달 모양으로 휘어 적의 옆구리를 훑는다. 전원이 빨라지고 급소를 노리지만 맷집을 포기한다.',
  },
};

/** 시작 시 보유한 진형 */
export const START_FORMATIONS = ['basic'];

/** 정의 순서대로의 배열 (상점/목록 UI용) */
export const FORMATION_LIST = Object.values(FORMATIONS);
export const FORMATION_IDS = Object.keys(FORMATIONS);

/** id -> 진형. 없으면 null */
export function getFormation(id) {
  if (id && typeof id === 'object') return id.slots ? id : null;
  return FORMATIONS[id] || null;
}

/** 내부용: 문자열/객체/누락 무엇이 들어와도 진형 객체를 돌려준다 */
function resolve(f) {
  return getFormation(f) || FORMATIONS.basic;
}

/** 유닛에서 아키타입 키를 뽑아낸다. Merc/UnitDef/클래스 객체 모두 지원 */
function unitArch(unit) {
  if (!unit) return null;
  return unit.arch || unit.archetype || (unit.cls && unit.cls.arch) || (unit.klass && unit.klass.arch) || (unit.class && unit.class.arch) || null;
}

/** 유닛의 클래스 id (class: 스코프용) */
function unitClassId(unit) {
  if (!unit) return null;
  return unit.classId || unit.enemyId || (unit.cls && unit.cls.id) || null;
}

/**
 * 이 effect가 해당 슬롯/유닛에 적용되는가.
 * unit이 없으면(UI 미리보기) role:/arch:/class: 스코프는 적용되지 않는다.
 */
function matches(scope, zone, unit) {
  if (!scope || scope === 'all') return true;
  if (scope === 'front' || scope === 'back') return zone === scope;
  if (scope === 'mid' || scope === 'middle') return zone === 'mid';
  const ci = scope.indexOf(':');
  if (ci < 0) return false;
  const kind = scope.slice(0, ci);
  const val = scope.slice(ci + 1);
  if (kind === 'role' || kind === 'arch') return unitArch(unit) === val;
  if (kind === 'class') return unitClassId(unit) === val;
  if (kind === 'zone') return zone === (val === 'middle' ? 'mid' : val);
  return false;
}

/**
 * 슬롯/유닛에 적용될 보정을 전부 합산한 평평한 객체를 돌려준다.
 * @param {object|string} formation 진형 또는 진형 id
 * @param {number} slotIndex 0~6
 * @param {object} [unit] 용병/적 (없으면 role 계열 스코프는 무시)
 * @returns {{[stat:string]:number}} 예: { atk:0.24, def:-0.16 }
 */
export function formationMods(formation, slotIndex, unit) {
  const f = resolve(formation);
  const slot = f.slots[slotIndex] || f.slots[0];
  const zone = slotZone(slot);
  const out = {};
  for (const eff of f.effects || []) {
    if (!matches(eff.scope, zone, unit)) continue;
    for (const k in eff.mods) out[k] = (out[k] || 0) + eff.mods[k];
  }
  return out;
}

/** 해당 슬롯의 구역 ('front'|'mid'|'back'). 잘못된 인덱스는 'front' */
export function slotZoneOf(formation, slotIndex) {
  const f = resolve(formation);
  return slotZone(f.slots[slotIndex] || f.slots[0]);
}

/** 구역별 슬롯 인덱스 목록 { front:[..], mid:[..], back:[..] } */
export function formationZones(formation) {
  const f = resolve(formation);
  const out = { front: [], mid: [], back: [] };
  f.slots.forEach((s, i) => out[slotZone(s)].push(i));
  return out;
}

const OFFSETS = (() => {
  const list = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) list.push([dx, dy]);
  list.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  return list;
})();

/**
 * 7슬롯 배치를 격자 문자열 배열로 만든다 (UI 미리보기 / 콘솔 디버깅).
 * 행 = 위(y=0)에서 아래(y=1), 열 = 왼쪽이 최전방(x=0) → 오른쪽이 최후방(x=1).
 * `mirror:true` 를 주면 전투 화면의 아군처럼 오른쪽이 최전방이 된다.
 * 칸 내용은 기본적으로 슬롯 번호 '1'~'7'.
 * @returns {string[]} 길이 rows 의 문자열 배열 (각 문자열 길이 = cols)
 */
export function formationPreviewRows(formation, opts = {}) {
  const { cols = 13, rows = 9, mirror = false, empty = '·', marks = null } = opts;
  const f = resolve(formation);
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(empty));
  f.slots.forEach((s, i) => {
    let cx = Math.round(s.x * (cols - 1));
    const cy0 = Math.round(s.y * (rows - 1));
    if (mirror) cx = cols - 1 - cx;
    const mark = marks && marks[i] != null ? String(marks[i])[0] : String(i + 1);
    for (const [dx, dy] of OFFSETS) {
      const px = cx + dx, py = cy0 + dy;
      if (px < 0 || px >= cols || py < 0 || py >= rows) continue;
      if (grid[py][px] !== empty) continue;
      grid[py][px] = mark;
      return;
    }
  });
  return grid.map((r) => r.join(''));
}

/** 스코프 한국어 라벨 */
function scopeLabel(scope) {
  if (!scope || scope === 'all') return '전체';
  if (scope === 'front') return '전열';
  if (scope === 'back') return '후열';
  if (scope === 'mid' || scope === 'middle') return '중열';
  const ci = scope.indexOf(':');
  if (ci < 0) return scope;
  const kind = scope.slice(0, ci), val = scope.slice(ci + 1);
  if (kind === 'role' || kind === 'arch') return `${ARCH_LABEL[val] || val} 계열`;
  if (kind === 'class') return val;
  return scope;
}

/**
 * 진형 효과를 한국어 한 줄씩으로 풀어 쓴다 (상점/편성 화면 표기용).
 * @returns {string[]} 예: ['전열 · 공격 +24%, 방어 -16%', ...]
 */
export function formationSummary(formation) {
  const f = resolve(formation);
  if (!f.effects || !f.effects.length) return ['보정 없음'];
  return f.effects.map((eff) => {
    const parts = [];
    for (const k in eff.mods) {
      const v = eff.mods[k];
      parts.push(`${STAT_LABEL[k] || k} ${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);
    }
    return `${scopeLabel(eff.scope)} · ${parts.join(', ')}`;
  });
}
