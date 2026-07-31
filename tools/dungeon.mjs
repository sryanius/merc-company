// 던전 난이도 곡선 검증 (node tools/dungeon.mjs).
//
// 설계 C 목표:
//   Lv80 4차 7인 · 세트 0개 → 1웨이브 승률 ~50% / 2웨이브는 사실상 불가(<10%)
//   세트 3 / 5 / 7 개    → 도달 웨이브가 단계적으로 올라간다
//   풀세트(10칸, 양손무기는 9칸) → 10웨이브 승률 ~30%
//
// 튜닝 노브는 두 개뿐이다:
//   · `game/dungeon.js WAVE_POWER` (웨이브별 적 전스탯 배율)
//   · `data/sets.js SET_TUNE` / `bonuses` (세트 파츠·세트 효과 크기)
//
// 주의: 순수 JS 모듈만 import 한다 (DOM 참조 금지).
import { RNG } from '../src/core/rng.js';
import { clamp } from '../src/core/util.js';
import { simulate, createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getClass } from '../src/data/classes.js';
import { getSkill } from '../src/data/skills.js';
import '../src/data/enemies.js';                     // 적 전용 스킬 등록 (부수효과)
import { getFormation } from '../src/data/formations.js';
import { mercStats } from '../src/game/merc.js';
import * as Gear from '../src/game/gear.js';
import * as Sets from '../src/data/sets.js';
import { SLOTS, SLOT_POWER } from '../src/data/items.js';
import { DUNGEON_LIST, getDungeon } from '../src/data/dungeons.js';
import { WAVE_POWER, WAVES, dungeonEnemyDefs, wavePower } from '../src/game/dungeon.js';

setSkillResolver(getSkill);

/* ────────────────────────────── 실행 옵션 ────────────────────────────── */

const ARGV = process.argv.slice(2);
const optNum = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.slice(k.length + 3)) : d;
};
const optStr = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const only = optStr('only', '');
const wants = (name) => !only || only.split(',').includes(name);

/** 웨이브 하나당 표본 (던전 4개 × 세트단계 × 웨이브 10 이라 크게 잡으면 오래 걸린다) */
const N_WAVE = optNum('n', 24);
/** 던전 런(HP 인계) 표본 */
const N_RUN = optNum('nrun', 24);
/** 부대 등급 — 실제 만렙 부대의 중앙값에 해당 */
const GRADE = optStr('grade', 'B');
const LEVEL = optNum('level', 80);
/** `--nospecial` — 세트 고유 효과를 빼고 잰다 (9차 이전 측정과의 A/B 비교용) */
const NO_SPECIAL = ARGV.includes('--nospecial');

/* ────────────────────────────── 출력 헬퍼 ────────────────────────────── */

const wide = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf)
    || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60);
};
const wlen = (s) => [...String(s)].reduce((a, c) => a + (wide(c) ? 2 : 1), 0);
const pad = (s, w, right = false) => {
  const t = String(s);
  const gap = Math.max(0, w - wlen(t));
  return right ? ' '.repeat(gap) + t : t + ' '.repeat(gap);
};
function table(head, rows, align = []) {
  const all = [head, ...rows];
  const w = head.map((_, i) => Math.max(...all.map((r) => wlen(r[i] ?? ''))));
  const line = (r) => '  ' + r.map((c, i) => pad(c ?? '', w[i], align[i] === 'r')).join('  ').trimEnd();
  console.log(line(head));
  console.log('  ' + w.map((x) => '─'.repeat(x)).join('  '));
  for (const r of rows) console.log(line(r));
}
const pctS = (v) => `${(v * 100).toFixed(0)}%`;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

const ISSUES = [];
function verdict(ok, label, detail) {
  console.log(`  ${ok ? '[OK  ]' : '[FAIL]'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) ISSUES.push(`${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
function header(t) {
  console.log('');
  console.log('═'.repeat(78));
  console.log(` ${t}`);
  console.log('═'.repeat(78));
}

/* ────────────────────────── 부대 / 장비 구성 ────────────────────────── */

// 4차 표준 부대 (balance.mjs 9번 섹션과 같은 조합). 아키타입이 전부 다르다 —
// 그래서 던전 1~3 의 세트는 2명씩만 쓸 수 있고, 4번(성좌)만 7명 전부가 쓴다.
// 실제 플레이의 최종 상태는 "네 던전을 다 돌아 각자 자기 계열 세트를 입는다" 이므로
// 세트 배분도 그렇게 한다 (아래 setForArch).
const SQUAD4 = [
  'bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
  'masterarcher_apex', 'archmage_apex', 'highpriest_abyss',
];

/** 그 아키타입이 입을 수 있는 세트 (계열 세트 우선, 없으면 성좌) */
function setForArch(arch) {
  const hit = Sets.SET_LIST.find((s) => s.archs.includes(arch) && s.archs.length < Sets.ALL_ARCHS.length);
  return (hit || Sets.getSet('constellation')).id;
}

/** 세트를 채우는 순서 — 던전 드랍 순서(방어구 → 장신구 → 무기)와 같게 둔다 */
const FILL_ORDER = ['body', 'head', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'weapon', 'offhand'];

/** ilvl 80 전설(희귀도 4) 채우기용 아이템. 슬롯 계수는 items.js 가 이미 먹인다. */
function legendaryFor(slot, rng) {
  const it = Gear.rollItem({ ilvl: 80, slot, rarity: 4, rng });
  return it;
}

/**
 * 용병 하나의 장비를 만든다.
 * @param {string} classId
 * @param {number} nSet 신화 세트 파츠 개수 (0~10)
 * @param {boolean} fillLegend 나머지 칸을 전설로 채우는가
 */
function buildLoadout(classId, nSet, fillLegend, rng) {
  const cls = getClass(classId);
  const setId = setForArch(cls.arch);
  const items = [];
  const equipment = {};
  for (let i = 0; i < FILL_ORDER.length; i++) {
    const slot = FILL_ORDER[i];
    let it = null;
    if (i < nSet) it = Sets.setPieceItem(setId, slot, 80);
    else if (fillLegend) it = legendaryFor(slot, rng);
    if (!it) continue;
    items.push(it);
    equipment[slot] = it.uid;
  }
  return { equipment, items, setId };
}

/** 장비 구성 프리셋 */
const LOADOUTS = [
  { key: 'bare', label: '장비없음', nSet: 0, legend: false },
  { key: 'legend', label: '전설10', nSet: 0, legend: true },
  { key: 'set3', label: '세트3', nSet: 3, legend: true },
  { key: 'set5', label: '세트5', nSet: 5, legend: true },
  { key: 'set7', label: '세트7', nSet: 7, legend: true },
  { key: 'set8', label: '세트8', nSet: 8, legend: true },
  { key: 'full', label: '풀세트', nSet: 10, legend: true },
];
/** 세트 단계 순서 (단조성·게이트 판정용) */
const LADDER = ['legend', 'set3', 'set5', 'set7', 'set8', 'full'];

/**
 * 아군 UnitDef 7기 (장비 반영). 진형 보정은 balance.mjs 랭크 섹션과 같게 걸지 않는다.
 *
 * ★ `specials`(세트 고유 효과)를 **실제 게임과 같은 진입점**(`gear.setSpecialsFor`)에서 싣는다.
 *   9차 전에는 이 도구가 specials 를 안 실어서 **풀세트를 반쪽 성능으로 재고 있었다** —
 *   그 값에 맞춰 `WAVE_POWER` 를 잡으면 실제 게임은 곡선보다 세진다.
 *   빼지 마라. (`--nospecial` 로 끄면 옛 측정과 비교할 수 있다)
 */
function allySquad(loadout, formationId = 'basic') {
  const f = getFormation(formationId) || getFormation('basic');
  const rng = new RNG(20260731);
  return SQUAD4.map((classId, i) => {
    const cls = getClass(classId);
    const { equipment, items } = buildLoadout(classId, loadout.nSet, loadout.legend, rng);
    const merc = { uid: `a${i}`, classId, level: LEVEL, grade: GRADE, equipment };
    let specials = [];
    if (!NO_SPECIAL) {
      const raw = Gear.setSpecialsFor(merc, items) || [];
      specials = raw.map((s) => ({ id: s.id, label: s.name || s.id, params: { ...s.params } }));
    }
    return {
      uid: `a${i}_${classId}`,
      name: cls.name,
      side: 'ally',
      classId,
      arch: cls.arch,
      level: LEVEL, grade: GRADE,
      stats: mercStats(merc, items),
      skills: (cls.skills || []).slice(),
      basicFx: cls.basicFx, basicRange: cls.range, basicDmgType: cls.dmgType,
      slot: f.slots[i] || { x: 0.5, y: 0.5 }, slotIndex: i, boss: false,
      specials,
      __merc: merc, __items: items,
    };
  });
}

/** 부대 전투력 지수 — 스탯 총합을 하나의 숫자로 (상대 비교 전용) */
function squadPower(defs) {
  let p = 0;
  for (const d of defs) {
    const s = d.stats;
    p += (s.hp || 0) * 0.12 + (s.atk || 0) * 1.0 + (s.def || 0) * 0.85 + (s.res || 0) * 0.75
      + (s.spd || 0) * 0.9 + (s.crit || 0) * 1.2 + (s.critDmg || 0) * 0.35 + (s.eva || 0) * 1.1;
  }
  return p;
}

/* ────────────────────────────── 시뮬 ────────────────────────────── */

let SIM_COUNT = 0;
function sim(cfg, seed) {
  SIM_COUNT++;
  return simulate({ ...cfg, seed: (seed >>> 0) || 1, getSkill });
}

/** 적 정의 캐시 (던전+웨이브는 결정론적이다) */
const ENEMY_CACHE = new Map();
function enemiesOf(dungeonId, wi) {
  const k = `${dungeonId}#${wi}`;
  if (!ENEMY_CACHE.has(k)) ENEMY_CACHE.set(k, dungeonEnemyDefs(dungeonId, wi));
  return ENEMY_CACHE.get(k);
}
function enemyFormationOf(dungeonId) {
  const d = getDungeon(dungeonId);
  return (d && d.formationId) || 'basic';
}

/** 웨이브 하나를 만나는 승률 (부대는 항상 만피로 시작) */
function waveWinRate(allies, dungeonId, wi, n = N_WAVE, seed0 = 9001) {
  const enemies = enemiesOf(dungeonId, wi);
  if (!enemies.length) return { win: 0, n: 0 };
  let win = 0;
  for (let i = 0; i < n; i++) {
    const r = sim({
      allies, enemies,
      allyFormationId: 'basic', enemyFormationId: enemyFormationOf(dungeonId),
    }, seed0 + i * 7919 + wi * 131);
    if (r.winner === 'ally') win++;
  }
  return { win: win / n, n };
}

/**
 * 던전 런 — 1웨이브부터 연속 진행. **HP 는 회복되지 않는다**(전투 화면과 동일).
 * @returns {number} 클리어한 웨이브 수 (0~10)
 */
function dungeonRun(allies0, dungeonId, seed) {
  let hp = allies0.map((a) => a.stats.hp);
  let cleared = 0;
  for (let wi = 0; wi < WAVES; wi++) {
    const enemies = enemiesOf(dungeonId, wi);
    if (!enemies.length) break;
    const allies = allies0.map((a, i) => (hp[i] > 0 ? { ...a, hp: hp[i] } : null)).filter(Boolean);
    if (!allies.length) break;
    SIM_COUNT++;
    const b = createBattle({
      allies, enemies,
      allyFormationId: 'basic', enemyFormationId: enemyFormationOf(dungeonId),
      seed: ((seed + wi * 7717) >>> 0) || 1, getSkill, record: false,
    });
    const r = b.run();
    if (r.winner !== 'ally') break;
    cleared++;
    // 생존자 HP 인계. 다운된 용병은 다음 웨이브에 못 나온다 (전투 화면과 동일).
    const next = allies0.map(() => 0);
    for (const u of b.units) {
      if (u.side !== 'ally') continue;
      const idx = allies0.findIndex((a) => a.uid === u.uid);
      if (idx >= 0) next[idx] = u.alive ? Math.max(1, Math.round(u.hp || 0)) : 0;
    }
    hp = next;
  }
  return cleared;
}

/* ══════════════════════════════════════════════════════════════════════
 * 1. 장비 총량 — 슬롯 10칸이 부대를 얼마나 세게 만들었나
 * ══════════════════════════════════════════════════════════════════════ */

const SQUAD_CACHE = new Map();
function squadOf(key) {
  if (!SQUAD_CACHE.has(key)) SQUAD_CACHE.set(key, allySquad(LOADOUTS.find((l) => l.key === key)));
  return SQUAD_CACHE.get(key);
}

if (wants('power')) {
  header('1. 부대 전투력 — 장비 구성별 (Lv80 4차 7인 · grade ' + GRADE + ')');
  const base = squadPower(squadOf('bare'));
  const rows = LOADOUTS.map((l) => {
    const defs = squadOf(l.key);
    const p = squadPower(defs);
    const s = defs.reduce((a, d) => {
      for (const k of ['hp', 'atk', 'def', 'res', 'spd']) a[k] = (a[k] || 0) + (d.stats[k] || 0);
      return a;
    }, {});
    return [l.label, Math.round(p).toLocaleString(), `x${f2(p / base)}`,
      Math.round(s.hp).toLocaleString(), Math.round(s.atk).toLocaleString(),
      Math.round(s.def).toLocaleString(), Math.round(s.res).toLocaleString(), Math.round(s.spd).toLocaleString()];
  });
  table(['장비', '전투력', '장비없음 대비', 'HP', 'atk', 'def', 'res', 'spd'], rows,
    ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);

  const slotSum = SLOTS.reduce((a, s) => a + (SLOT_POWER[s] || 0), 0);
  console.log(`  SLOT_POWER 합계 ${f2(slotSum)} (옛 3슬롯 ≈ 2.40 · 설계 목표 ≈ 4.70)`);
  const legendMul = squadPower(squadOf('legend')) / base;
  const fullMul = squadPower(squadOf('full')) / squadPower(squadOf('legend'));
  console.log(`  전설10 = 장비없음 x${f2(legendMul)} · 풀세트 = 전설10 x${f2(fullMul)}`);
  verdict(fullMul >= 1.15 && fullMul <= 1.85,
    '풀세트가 전설10 대비 1.15~1.85배 (곡선이 따라잡을 수 있는 폭)', `실측 x${f2(fullMul)}`);
}

/* ══════════════════════════════════════════════════════════════════════
 * 2. 웨이브별 승률 — 세트 개수 × 웨이브 (만피 시작, 던전 4개 평균)
 * ══════════════════════════════════════════════════════════════════════ */

const WAVE_TABLE = new Map();   // key -> number[10]

if (wants('wave')) {
  header(`2. 웨이브별 승률 — 만피 시작 · 던전 4개 평균 (표본 ${N_WAVE}/웨이브/던전)`);
  const rows = [];
  for (const l of LOADOUTS) {
    const allies = squadOf(l.key);
    const per = [];
    for (let wi = 0; wi < WAVES; wi++) {
      let s = 0;
      for (const d of DUNGEON_LIST) s += waveWinRate(allies, d.id, wi).win;
      per.push(s / DUNGEON_LIST.length);
    }
    WAVE_TABLE.set(l.key, per);
    rows.push([l.label, ...per.map(pctS)]);
  }
  table(['장비', ...Array.from({ length: WAVES }, (_, i) => `${i + 1}웨`)], rows,
    ['l', ...Array(WAVES).fill('r')]);
  console.log('  WAVE_POWER: ' + WAVE_POWER.map((v) => f2(v)).join(' '));
  console.log('  던전별 배율: ' + DUNGEON_LIST.map((d) => `${d.name} x${f2(d.power)}`).join(' · '));
}

/* ══════════════════════════════════════════════════════════════════════
 * 3. 던전 런 — HP 인계 (실제 플레이와 같다)
 * ══════════════════════════════════════════════════════════════════════ */

const RUN_TABLE = new Map();

if (wants('run')) {
  header(`3. 던전 런 — HP 인계 · 1웨이브부터 연속 (표본 ${N_RUN}/던전)`);
  const rows = [];
  for (const l of LOADOUTS) {
    const allies = squadOf(l.key);
    const reach = [];              // 도달(클리어) 웨이브 수 목록
    const clearN = Array(WAVES + 1).fill(0);  // n웨이브 이상 클리어한 횟수
    for (const d of DUNGEON_LIST) {
      for (let i = 0; i < N_RUN; i++) {
        const c = dungeonRun(allies, d.id, 4801 + i * 6151);
        reach.push(c);
        for (let k = 0; k <= c; k++) clearN[k]++;
      }
    }
    const total = reach.length;
    const avg = reach.reduce((a, b) => a + b, 0) / total;
    RUN_TABLE.set(l.key, { avg, clearN, total });
    rows.push([l.label, f1(avg),
      ...[1, 2, 3, 5, 7, 10].map((w) => pctS(clearN[w] / total))]);
  }
  table(['장비', '평균 도달', '1웨↑', '2웨↑', '3웨↑', '5웨↑', '7웨↑', '10웨'], rows,
    ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
}

/* ══════════════════════════════════════════════════════════════════════
 * 4. 목표 판정
 * ══════════════════════════════════════════════════════════════════════ */

header('4. 설계 C 목표 판정');

// ★ 판정은 전부 **런(HP 인계)** 기준이다. 만피 단일 웨이브 승률은 편성이 고정이라
//   거의 계단(100%↔0%)이라서 "50%/30%" 같은 값에 맞출 수 없다 — 진단표로만 쓴다.
console.log(`  기준선: 세트 0개 = 전설 10칸 착용 부대 (Lv${LEVEL} 4차 7인 grade ${GRADE})`);
console.log('  판정은 런(HP 인계) 통계로 한다 — 만피 단일 웨이브 승률은 계단이라 잣대가 안 된다.');

if (RUN_TABLE.size) {
  const avgs = LADDER.map((k) => RUN_TABLE.get(k).avg);
  const bad = [];
  for (let i = 1; i < avgs.length; i++) if (avgs[i] < avgs[i - 1] - 0.25) bad.push(`${LADDER[i - 1]}→${LADDER[i]}`);
  verdict(bad.length === 0, '세트 단계가 오를수록 도달 웨이브가 올라간다',
    `${bad.join(', ')} · ${LADDER.map((k, i) => `${k} ${f1(avgs[i])}`).join(' / ')}`);

  const zeroRun = RUN_TABLE.get('legend');
  verdict(zeroRun.avg <= 2.5, '세트 0개 부대는 초반 웨이브에서 막힌다 (평균 도달 ≤ 2.5)',
    `실측 ${f1(zeroRun.avg)}`);
  verdict(zeroRun.clearN[5] / zeroRun.total < 0.10,
    '세트 없이 5웨이브가 뚫리지 않는다', `실측 ${pctS(zeroRun.clearN[5] / zeroRun.total)}`);

  // ★ 드랍 게이트 — 이게 막히면 세트를 영원히 완성할 수 없다 (가장 중요한 검사)
  const s5 = RUN_TABLE.get('set5');
  verdict(s5.clearN[6] / s5.total >= 0.10,
    '★ 장신구 게이트: 방어구 5칸 부대가 6웨이브에 닿는다 (≥10%)',
    `실측 ${pctS(s5.clearN[6] / s5.total)} — 막히면 장신구를 영원히 못 얻는다`);
  const s8 = RUN_TABLE.get('set8');
  verdict(s8.clearN[9] / s8.total >= 0.10,
    '★ 무기 게이트: 방어구+장신구 8칸 부대가 9웨이브에 닿는다 (≥10%)',
    `실측 ${pctS(s8.clearN[9] / s8.total)} — 막히면 무기·왼손을 영원히 못 얻는다`);

  const fullRun = RUN_TABLE.get('full');
  const ten = fullRun.clearN[WAVES] / fullRun.total;
  verdict(ten >= 0.15 && ten <= 0.50, '풀세트 · 10웨이브 완주 ~30% (15~50%)', `실측 ${pctS(ten)}`);
}

if (WAVE_TABLE.size) {
  // 단조성 진단: 세트를 모을수록 같은 웨이브 승률이 떨어지면 안 된다
  const drops = [];
  for (let wi = 0; wi < WAVES; wi++) {
    for (let i = 1; i < LADDER.length; i++) {
      const a = WAVE_TABLE.get(LADDER[i - 1])[wi];
      const b = WAVE_TABLE.get(LADDER[i])[wi];
      if (b < a - 0.12) drops.push(`${LADDER[i]} ${wi + 1}웨 ${pctS(a)}→${pctS(b)}`);
    }
  }
  verdict(drops.length === 0, '세트를 모을수록 웨이브 승률이 떨어지지 않는다',
    drops.slice(0, 4).join(' / '));
}

/* ────────────────────────────── 요약 ────────────────────────────── */

header('요약');
if (!ISSUES.length) console.log('  모든 목표 통과');
else ISSUES.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
console.log('');
console.log(`  전투 ${SIM_COUNT.toLocaleString()}회 / ${(process.uptime()).toFixed(1)}초`);
process.exit(ISSUES.length ? 1 : 0);
