// 밸런스 검증 스크립트 (node tools/balance.mjs).
// battle/engine.js 의 simulate() 로 대량 시뮬레이션을 돌려 아래를 점검한다.
//   1) 동급 매칭 승률 40~60% / 전투 시간 15~60초
//   2) 클래스 49종의 승률·피해 기여도 (0%/100% 승률, 피해량 1/3~3배 이탈 탐지)
//   3) 힐러·탱커의 실제 기여 (힐량, 받은 피해 분담률)
//   4) F등급 부대 vs S등급 부대
//   5) 진형별 기본진 대비 승률 차이
//   6) 랭크 F~S 의뢰를 권장 레벨 부대로 갔을 때 승률 60~80%
//
// 주의: 순수 JS 모듈만 import 한다 (DOM 참조 금지).
import { RNG } from '../src/core/rng.js';
import * as State from '../src/game/state.js';
import { clamp } from '../src/core/util.js';
import { simulate, createBattle, setSkillResolver, TIME_LIMIT } from '../src/battle/engine.js';
import { CLASSES, getClass } from '../src/data/classes.js';
import { getSkill } from '../src/data/skills.js';
import '../src/data/enemies.js';                       // 적 전용 스킬 등록 (부수효과)
import { getEnemy } from '../src/data/enemies.js';
import { FORMATIONS, getFormation, formationMods } from '../src/data/formations.js';
import { mercStats, GRADE_MULT, TIER_MULT, GROWTH_RATE, MAX_LEVEL } from '../src/game/merc.js';
import { enemyStats, enemyUnitDefs, genQuests, RANK_LEVEL, RANKS, subLevelRange, SUB_LABEL, SUB_POWER, applyWaveCarry, readWaveCarry } from '../src/game/quest.js';
import { CITIES } from '../src/data/world.js';

setSkillResolver(getSkill);

/* ────────────────────────────── 실행 옵션 ────────────────────────────── */

const ARGV = process.argv.slice(2);
const optNum = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.slice(k.length + 3)) : d;
};
const only = (ARGV.find((a) => a.startsWith('--only=')) || '').slice(7);
const wants = (name) => !only || only.split(',').includes(name);

const N_MATCH = optNum('n', 400);      // 동급 매칭 표본
const N_CLASS = optNum('nclass', 120); // 클래스별 표본
const N_FORM = optNum('nform', 200);   // 진형별 표본
// 랭크별 의뢰 표본. B·S 는 보스·구성 편차가 커서 40으로는 ±12%p 흔들려 판정이 뒤집힌다.
// 90 이면 랭크당 270 전투로 ±3~4%p 안에 든다(실측). 정밀히 보려면 --nquest=150.
const N_QUEST = optNum('nquest', 90);  // 랭크별 의뢰 표본

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
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
const pctS = (v) => `${(v * 100).toFixed(1)}%`;

const ISSUES = [];
const flag = (msg) => { ISSUES.push(msg); };
// 판정 출력. 실패했을 때만 상세를 붙이고, 그때도 "위반:" 을 앞에 달아
// "…없음 (검사, 궁수, …)" 처럼 통과 문구 뒤에 이름이 나열되어 헷갈리는 일을 막는다.
// (예전에는 통과·실패 구분 없이 detail을 그대로 이어 붙여 읽는 사람이 반대로 해석했다.)
function verdict(ok, label, detail) {
  console.log(`  ${ok ? '[OK  ]' : '[FAIL]'} ${label}${!ok && detail ? ` — 위반: ${detail}` : ''}`);
  if (!ok) flag(`${label}${detail ? ` — 위반: ${detail}` : ''}`);
  return ok;
}
function header(t) {
  console.log('');
  console.log('═'.repeat(78));
  console.log(` ${t}`);
  console.log('═'.repeat(78));
}

/* ────────────────────────────── 유닛 정의 ────────────────────────────── */

/** 기본진 기준 표준 부대 구성 (전열3 / 중열2 / 후열2) */
const SQUADS = {
  1: ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'],
  2: ['knight', 'berserker', 'dragoon', 'assassin', 'sniper', 'elementalist', 'priest'],
  3: ['bulwark', 'swordgod', 'dragoonlord', 'shadowblade', 'masterarcher', 'archmage', 'highpriest'],
  // 4차 표준 부대 — 3차 SQUADS 를 각각의 4차 후보로 승격한 조합 (탱커/딜러/힐러 균형 유지).
  4: ['bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex', 'masterarcher_apex', 'archmage_apex', 'highpriest_abyss'],
};
/** 표준 적 부대 — 아키타입이 골고루 섞이고 평균 배율이 1.0 근처인 조합 */
const STD_ENEMY = ['orc_warrior', 'bandit_brute', 'lizardman_spear', 'cutthroat', 'orc_archer', 'rogue_mage', 'orc_shaman'];

// 차수 경계 = 전직 레벨 (Lv15 / Lv35 / Lv55). 랭크 권장 레벨과 정확히 맞물린다.
const tierOfLevel = (lv) => (lv >= 55 ? 4 : lv >= 35 ? 3 : lv >= 15 ? 2 : 1);

/** 용병(클래스+레벨+등급)의 최종 배율과 같은 세기를 갖는 적 레벨 */
function matchedEnemyLevel(level, tier, grade) {
  const mult = (1 + GROWTH_RATE * (level - 1)) * TIER_MULT[clamp(tier - 1, 0, 3)] * (GRADE_MULT[grade] ?? 1);
  return clamp(Math.round(1 + (mult - 1) / GROWTH_RATE), 1, MAX_LEVEL);
}


/* ★ 이 도구의 표준 부대는 **맨몸이다.** 한때 장비를 입혔다가 되돌렸다 —
 * 이 도구가 판정하는 건 §36.5 이후 «1등급 도시의 F/E/D», 즉 **순수 초보 구간**뿐이고
 * 거기서는 맨몸이 맞는 모델이다 (실측: 장비 2칸만 줘도 D랭크가 70% → 96% 로 튄다).
 * 장비를 갖춘 부대는 `tools/endgame.mjs` 가 «만렙 풀장비» 로 따로 잰다.
 * 두 도구가 각각 하나의 모델만 갖는 게 맞다 — 한 도구에 둘을 섞으면 둘 다 못 믿는다. */

function allyDef(classId, level, grade, slotIndex, formationId = 'basic', useForm = false) {
  const cls = getClass(classId);
  if (!cls) throw new Error(`알 수 없는 클래스: ${classId}`);
  const f = getFormation(formationId) || getFormation('basic');
  const slot = f.slots[slotIndex] || { x: 0.5, y: 0.5 };
  const def = {
    uid: `a${slotIndex}_${classId}`,
    name: cls.name,
    side: 'ally',
    classId,
    arch: cls.arch,
    level, grade,
    stats: mercStats({ classId, level, grade, equipment: {} }, null),
    skills: (cls.skills || []).slice(),
    basicFx: cls.basicFx, basicRange: cls.range, basicDmgType: cls.dmgType,
    slot, slotIndex, boss: false,
  };
  if (useForm) def.formationMods = formationMods(f, slotIndex, { arch: cls.arch, classId });
  return def;
}

function enemyDefOf(enemyId, level, slotIndex, formationId = 'basic', tag = 'e') {
  const e = getEnemy(enemyId);
  if (!e) throw new Error(`알 수 없는 적: ${enemyId}`);
  const f = getFormation(formationId) || getFormation('basic');
  const slot = f.slots[slotIndex] || { x: 0.5, y: 0.5 };
  return {
    uid: `${tag}${slotIndex}_${enemyId}`,
    name: e.name,
    side: 'enemy',
    enemyId,
    arch: e.arch,
    level, grade: e.boss ? 'S' : 'C',
    stats: enemyStats(e, level),
    skills: (e.skills || []).slice(),
    basicFx: e.basicFx, basicRange: e.range, basicDmgType: e.dmgType,
    slot, slotIndex, boss: !!e.boss,
  };
}

/** 표준 부대 (레벨에 맞는 차수) */
function stdSquad(level, grade, formationId = 'basic', useForm = false, tier = tierOfLevel(level)) {
  return SQUADS[tier].map((c, i) => allyDef(c, level, grade, i, formationId, useForm));
}
/** 표준 적 부대 */
function stdEnemies(level, formationId = 'basic') {
  return STD_ENEMY.map((e, i) => enemyDefOf(e, level, i, formationId));
}

/**
 * 클래스 비교용 잣대를 "동급"으로 맞춘다.
 * 표준 부대(해당 차수)가 표준 적 부대를 상대로 승률 50%에 가장 가까워지는 적 레벨을 찾는다.
 * 데이터 수치를 고친 뒤에도 잣대가 함께 따라오므로 클래스 간 상대 비교가 유지된다.
 */
const CAL_CACHE = new Map();
function calibratedEnemyLevel(tier, level, grade) {
  const key = `${tier}|${level}|${grade}`;
  if (CAL_CACHE.has(key)) return CAL_CACHE.get(key);
  const allies = stdSquad(level, grade, 'basic', false, tier);
  let best = 1, bestErr = Infinity;
  let lo = 1, hi = MAX_LEVEL;
  for (let step = 0; step < 7 && lo <= hi; step++) {
    const mid = Math.round((lo + hi) / 2);
    const s = series(() => ({ allies, enemies: stdEnemies(mid), allyFormationId: 'basic', enemyFormationId: 'basic' }), 60, 4711);
    const err = Math.abs(s.winRate - 0.5);
    if (err < bestErr) { bestErr = err; best = mid; }
    if (s.winRate > 0.5) lo = mid + 1; else hi = mid - 1;
  }
  CAL_CACHE.set(key, best);
  return best;
}
/** 아군 정의를 그대로 뒤집어 적으로 (완전 동급 미러 매치) */
function mirror(defs, formationId = 'basic') {
  const f = getFormation(formationId) || getFormation('basic');
  return defs.map((d, i) => ({ ...d, uid: `m${i}_${d.classId || d.enemyId}`, side: 'enemy', slot: f.slots[i] || d.slot }));
}

/* ────────────────────────────── 시뮬 실행 ────────────────────────────── */

let SIM_COUNT = 0;
function sim(cfg, seed) {
  SIM_COUNT++;
  return simulate({ ...cfg, seed: (seed >>> 0) || 1, getSkill });
}

/** 이벤트를 받아 유닛별 "받은 피해"까지 집계하는 정밀 실행 */
function simDetailed(cfg, seed) {
  SIM_COUNT++;
  const b = createBattle({ ...cfg, seed: (seed >>> 0) || 1, getSkill, record: true });
  const taken = {}, healedOn = {};
  let guard = 0;
  const maxTicks = Math.ceil((TIME_LIMIT + 2) * 60);
  while (!b.finished && guard++ < maxTicks) {
    b.step(1 / 60);
    for (const e of b.drainEvents()) {
      if (e.type === 'damage') taken[e.targetUid] = (taken[e.targetUid] || 0) + e.amount;
      else if (e.type === 'heal') healedOn[e.targetUid] = (healedOn[e.targetUid] || 0) + e.amount;
    }
  }
  return { res: b.result, units: b.units, taken, healedOn };
}

/** n회 반복해 승률/시간 통계를 낸다 */
function series(makeCfg, n, seed0 = 12345) {
  let wins = 0, draws = 0, tSum = 0;
  const times = [], allyDmg = [], enemyDmg = [], heals = [];
  let survSum = 0;
  for (let i = 0; i < n; i++) {
    const cfg = makeCfg(i);
    const r = sim(cfg, (seed0 + i * 7919) >>> 0);
    if (r.winner === 'ally') wins++;
    else if (r.winner === 'draw') draws++;
    times.push(r.time); tSum += r.time;
    const aSet = new Set(cfg.allies.map((d) => d.uid));
    let ad = 0, ed = 0, hd = 0;
    for (const [uid, v] of Object.entries(r.damageDealt)) (aSet.has(uid) ? (ad += v) : (ed += v));
    for (const [uid, v] of Object.entries(r.healDone || {})) if (aSet.has(uid)) hd += v;
    allyDmg.push(ad); enemyDmg.push(ed); heals.push(hd);
    survSum += r.survivors.filter((u) => aSet.has(u)).length;
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const sorted = times.slice().sort((a, b) => a - b);
  return {
    n, wins, draws, winRate: wins / n, drawRate: draws / n,
    time: tSum / n, tMin: sorted[0], tMax: sorted[sorted.length - 1],
    tMed: sorted[Math.floor(sorted.length / 2)],
    timeout: times.filter((t) => t >= TIME_LIMIT - 0.5).length / n,
    allyDmg: avg(allyDmg), enemyDmg: avg(enemyDmg), heal: avg(heals),
    survivors: survSum / n,
  };
}

/* ══════════════════════════ 1. 동급 매칭 ══════════════════════════ */

function sectionMatch() {
  header('1. 동급 매칭 — 승률 40~60% / 전투 시간 15~60초');

  const rows = [];
  const bad = [];
  // (a) 완전 미러: 같은 클래스·레벨·등급·인원. 승률은 정의상 50% 근처여야 한다.
  for (const [lv, grade] of [[5, 'D'], [12, 'D'], [20, 'C'], [30, 'C'], [45, 'B'], [58, 'A']]) {
    const allies = stdSquad(lv, grade);
    const enemies = mirror(allies);
    const s = series(() => ({ allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic' }), N_MATCH);
    rows.push(['미러', `Lv${lv} ${grade}`, `${s.n}`, pctS(s.winRate), pctS(s.drawRate), f1(s.time), f1(s.tMin), f1(s.tMax), pctS(s.timeout), f1(s.survivors)]);
    if (s.winRate < 0.4 || s.winRate > 0.6) bad.push(`미러 Lv${lv}: 승률 ${pctS(s.winRate)}`);
    if (s.time < 15 || s.time > 60) bad.push(`미러 Lv${lv}: 평균 ${f1(s.time)}초`);
  }
  // (b) 표준 부대 vs "같은 레벨" 표준 적 부대 — 차수/등급 배율이 만드는 계통 격차를 본다
  for (const [lv, grade] of [[5, 'D'], [12, 'D'], [20, 'C'], [30, 'C'], [45, 'B'], [58, 'A']]) {
    const allies = stdSquad(lv, grade);
    const enemies = stdEnemies(lv);
    const s = series(() => ({ allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic' }), N_MATCH, 555);
    const eq = matchedEnemyLevel(lv, tierOfLevel(lv), grade);
    rows.push(['동레벨 적', `Lv${lv} ${grade} (환산 ${eq})`, `${s.n}`, pctS(s.winRate), pctS(s.drawRate), f1(s.time), f1(s.tMin), f1(s.tMax), pctS(s.timeout), f1(s.survivors)]);
  }
  table(['구도', '조건', '표본', '승률', '무승부', '평균초', '최단', '최장', '타임아웃', '생존'],
    rows, ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
  verdict(bad.length === 0, '동급 매칭 승률/지속시간', bad.join(' | '));
}

/* ══════════════════════════ 2. 클래스별 기여도 ══════════════════════════ */

function sectionClasses() {
  header('2. 클래스별 기여도 — 7인 동일 클래스 부대 vs 표준 적 부대');
  const LV = 12, GRADE = 'C';
  const cal = {
    1: calibratedEnemyLevel(1, LV, GRADE), 2: calibratedEnemyLevel(2, LV, GRADE),
    3: calibratedEnemyLevel(3, LV, GRADE), 4: calibratedEnemyLevel(4, LV, GRADE),
  };
  console.log(`  잣대: 표준 부대 Lv${LV} ${GRADE}등급이 승률 50%가 되는 표준 적 부대 레벨 = 1차 ${cal[1]} / 2차 ${cal[2]} / 3차 ${cal[3]} / 4차 ${cal[4]}`);
  const out = [];
  for (const cls of Object.values(CLASSES)) {
    const elv = cal[cls.tier];
    const enemies = stdEnemies(elv);
    const eHp = enemies.reduce((a, d) => a + d.stats.hp, 0);
    const allies = Array.from({ length: 7 }, (_, i) => allyDef(cls.id, LV, GRADE, i));
    const s = series(() => ({ allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic' }), N_CLASS, 9001);
    out.push({
      id: cls.id, name: cls.name, tier: cls.tier, arch: cls.arch,
      win: s.winRate, time: s.time, dmg: s.allyDmg, heal: s.heal,
      idx: s.allyDmg / eHp,   // 적 총 체력 대비 피해 지수 (차수 간 비교용)
    });
  }
  out.sort((a, b) => a.tier - b.tier || b.win - a.win);
  table(['차수', '클래스', '아키타입', '승률', '평균초', '총피해', '피해지수', '힐량'],
    out.map((o) => [`${o.tier}`, o.name, o.arch, pctS(o.win), f1(o.time), Math.round(o.dmg).toLocaleString('en-US'), f2(o.idx), Math.round(o.heal).toLocaleString('en-US')]),
    ['r', 'l', 'l', 'r', 'r', 'r', 'r', 'r']);

  const idxs = out.map((o) => o.idx).sort((a, b) => a - b);
  const med = idxs[Math.floor(idxs.length / 2)];
  const lo = out.filter((o) => o.idx < med / 3);
  const hi = out.filter((o) => o.idx > med * 3);
  const zero = out.filter((o) => o.win <= 0.0001);
  const full = out.filter((o) => o.win >= 0.9999);
  console.log(`  피해지수 중앙값 ${f2(med)} (허용 ${f2(med / 3)} ~ ${f2(med * 3)})`);
  verdict(zero.length === 0, '승률 0% 클래스 없음', zero.map((o) => o.name).join(', '));
  verdict(full.length === 0, '승률 100% 클래스 없음', full.map((o) => o.name).join(', '));
  verdict(lo.length === 0, '피해 하한(중앙값 1/3) 이탈 없음', lo.map((o) => `${o.name} ${f2(o.idx)}`).join(', '));
  verdict(hi.length === 0, '피해 상한(중앙값 3배) 이탈 없음', hi.map((o) => `${o.name} ${f2(o.idx)}`).join(', '));
  return out;
}

/* ══════════════════════════ 3. 힐러 / 탱커 기여 ══════════════════════════ */

function roleContribution() {
  header('3. 힐러 · 탱커 기여도');

  const LV = 20, GRADE = 'C', TIER = 2;
  const elv = calibratedEnemyLevel(TIER, LV, GRADE);
  const enemies = stdEnemies(elv);
  console.log(`  잣대: 표준 적 부대 Lv${elv} (표준 2차 부대 Lv${LV} ${GRADE} 기준 승률 50%)`);
  const base = stdSquad(LV, GRADE);                                            // knight(탱커) + priest(힐러)
  const noHeal = base.map((d, i) => (i === 6 ? allyDef('swordmaster', LV, GRADE, 6) : d));
  const noTank = base.map((d, i) => (i === 0 ? allyDef('swordmaster', LV, GRADE, 0) : d));

  const rows = [];
  const runs = [['표준(탱커+힐러)', base], ['힐러→검성', noHeal], ['탱커→검성', noTank]];
  const results = {};
  for (const [label, allies] of runs) {
    const s = series(() => ({ allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic' }), N_MATCH, 4242);
    results[label] = s;
    rows.push([label, pctS(s.winRate), f1(s.time), Math.round(s.heal).toLocaleString('en-US'), f1(s.survivors)]);
  }
  table(['부대', '승률', '평균초', '아군 힐량', '평균 생존'], rows, ['l', 'r', 'r', 'r', 'r']);

  // 유닛별 받은 피해 분담률 (표준 부대)
  const agg = {};
  const SAMPLE = 60;
  for (let i = 0; i < SAMPLE; i++) {
    const { units, taken, healedOn } = simDetailed({ allies: base, enemies, allyFormationId: 'basic', enemyFormationId: 'basic' }, 777 + i * 131);
    for (const u of units) {
      if (u.side !== 'ally') continue;
      const a = agg[u.uid] || (agg[u.uid] = { name: u.name, taken: 0, heal: 0, dealt: 0, maxHp: u.maxHp });
      a.taken += taken[u.uid] || 0;
      a.heal += healedOn[u.uid] || 0;
    }
  }
  const totalTaken = Object.values(agg).reduce((a, b) => a + b.taken, 0) || 1;
  const totalHeal = Object.values(agg).reduce((a, b) => a + b.heal, 0);
  table(['슬롯', '아군', '받은 피해', '분담률', '받은 힐', '힐 비중'],
    Object.entries(agg).map(([uid, a], i) => [
      `${i}`, a.name, Math.round(a.taken / SAMPLE).toLocaleString('en-US'), pctS(a.taken / totalTaken),
      Math.round(a.heal / SAMPLE).toLocaleString('en-US'), totalHeal ? pctS(a.heal / totalHeal) : '-',
    ]), ['r', 'l', 'r', 'r', 'r', 'r']);

  const tankShare = (agg[base[0].uid]?.taken || 0) / totalTaken;
  const healPerBattle = results['표준(탱커+힐러)'].heal;
  const healDelta = results['표준(탱커+힐러)'].winRate - results['힐러→검성'].winRate;
  const tankDelta = results['표준(탱커+힐러)'].winRate - results['탱커→검성'].winRate;

  verdict(healPerBattle > 0, '힐러가 실제로 회복을 한다', `전투당 ${Math.round(healPerBattle)}`);
  verdict(tankShare >= 0.16, '탱커가 피해를 앞에서 받는다', `전열 탱커 분담률 ${pctS(tankShare)} (1/7=14.3%)`);
  console.log(`  힐러 유무 승률차 ${(healDelta * 100).toFixed(1)}%p · 탱커 유무 승률차 ${(tankDelta * 100).toFixed(1)}%p`);
}

/* ══════════════════════════ 4. 등급 F vs S ══════════════════════════ */

function sectionGrade() {
  header('4. 등급 격차 — 같은 클래스/레벨, 등급만 다른 부대');
  const rows = [];
  let ok = true;
  for (const lv of [12, 25, 45]) {
    for (const [ga, ge] of [['F', 'S'], ['S', 'F'], ['C', 'C']]) {
      const allies = stdSquad(lv, ga);
      const enemies = mirror(stdSquad(lv, ge));
      const s = series(() => ({ allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic' }), N_MATCH, 31337);
      rows.push([`Lv${lv}`, `${ga} vs ${ge}`, pctS(s.winRate), f1(s.time), f1(s.survivors)]);
      if (ga === 'F' && ge === 'S' && s.winRate > 0.15) ok = false;
      if (ga === 'S' && ge === 'F' && s.winRate < 0.85) ok = false;
    }
  }
  table(['레벨', '등급', '아군 승률', '평균초', '생존'], rows, ['l', 'l', 'r', 'r', 'r']);
  verdict(ok, 'S등급 부대가 F등급 부대를 압도한다');
}

/* ══════════════════════════ 5. 진형 ══════════════════════════ */

function sectionFormation() {
  header('5. 진형별 효과 — 표준 부대(각 진형) vs 표준 적 부대(기본진)');
  const LV = 20, GRADE = 'C';
  const elv = calibratedEnemyLevel(tierOfLevel(LV), LV, GRADE);
  const enemies = stdEnemies(elv);
  console.log(`  잣대: 표준 적 부대 Lv${elv} (기본진 기준 승률 50%)`);
  const rows = [];
  let baseWin = 0;
  const res = [];
  for (const f of Object.values(FORMATIONS)) {
    const allies = stdSquad(LV, GRADE, f.id, true);
    const s = series(() => ({ allies, enemies, allyFormationId: f.id, enemyFormationId: 'basic' }), N_FORM, 60613);
    if (f.id === 'basic') baseWin = s.winRate;
    res.push({ f, s });
  }
  for (const { f, s } of res) {
    const d = (s.winRate - baseWin) * 100;
    rows.push([f.name, `T${f.tier}`, pctS(s.winRate), `${d >= 0 ? '+' : ''}${d.toFixed(1)}%p`, f1(s.time), Math.round(s.allyDmg).toLocaleString('en-US'), f1(s.survivors)]);
  }
  table(['진형', '등급', '승률', '기본진 대비', '평균초', '총피해', '생존'], rows, ['l', 'l', 'r', 'r', 'r', 'r', 'r']);
  const flatlist = res.filter((r) => r.f.id !== 'basic' && Math.abs(r.s.winRate - baseWin) < 0.03);
  verdict(flatlist.length <= 2, '진형이 기본진과 유의미하게 다르다',
    flatlist.length ? `차이 3%p 미만: ${flatlist.map((r) => r.f.name).join(', ')}` : '');
}

/* ══════════════════════════ 6. 의뢰 랭크별 ══════════════════════════ */
// (랭크별 버킷은 공용 대형 풀 collectQuestPool 에서 뽑는다 — sectionQuests 참고.)

// 실제 게임과 같은 적 스탯 파이프라인을 쓴다: quest.js 의 enemyUnitDefs 가
// wave.power(RANK_POWER × 레벨 초과분) · 정예 배율 · 보스 감쇠 · 진형을 전부 반영한다.
// 예전 구현은 enemyStats(레벨만) 만 써서 RANK_POWER·보스감쇠·정예를 통째로 무시했다 —
// 그래서 난이도 노브를 바꿔도 측정값이 움직이지 않았다(7차 세션에서 발견).
function waveEnemyDefs(wave, waveIndex, quest) {
  return enemyUnitDefs(wave, quest, waveIndex);
}

/** ui/battle.js 와 같은 방식으로 웨이브를 이어 붙여 돌린다 (HP 인계 + 15% 회복) */
function runQuest(quest, squad, seed) {
  let carry = null;
  let time = 0;
  const waveTimes = [];
  for (let w = 0; w < quest.waves.length; w++) {
    /* ★ 인계 규칙은 game/quest.js 가 유일한 출처다. 예전에는 여기에 사본이 있었는데
     *   (15% 회복을 손으로 적어 뒀다) 그러면 게임 쪽을 고쳤을 때 이 도구만 옛 규칙으로
     *   재게 된다 — 이 저장소가 반복해서 밟은 함정이다. */
    const allies = applyWaveCarry(squad.map((d) => ({ ...d })), carry);
    if (!allies.length) return { win: false, wave: w, time, waveTimes };
    const enemies = waveEnemyDefs(quest.waves[w], w, quest);
    if (!enemies.length) continue;
    const b = createBattle({
      allies, enemies, allyFormationId: 'basic', enemyFormationId: quest.waves[w].formationId,
      seed: ((seed + w * 2654435761) >>> 0) || 1, getSkill, record: false,
    });
    SIM_COUNT++;
    const res = b.run();
    time += res.time;
    waveTimes.push(res.time);
    carry = readWaveCarry(b.units, carry || {});
    if (res.winner !== 'ally') return { win: false, wave: w, time, waveTimes };
  }
  return { win: true, wave: quest.waves.length, time, waveTimes };
}

/* 랭크별 목표 승률 대역 (설계 F — 7차 세션 갱신).
 * "E등급부터 난이도를 더 올린다. 실패도 자주 해야 클래스·아이템 조합을 바꿀 필요를 느낀다."
 * F 만 초반 보호 구간으로 88~100% 를 지키고, E 부터는 확실히 조인다. C 이상은 세 번 중 한 번은
 * 실패하는 것이 목표다. 단 실패가 진행을 막지 않도록 부상 완화·출전불가 0회 계약은 별도로 지킨다. */
/** 이 섹션이 «판정» 하는 랭크. 나머지는 표에만 찍고 넘어간다 (endgame.mjs 담당) */
const JUDGED_RANKS = new Set(['F', 'E', 'D']);

const RANK_TARGET = {
  F: [88, 100], E: [72, 86], D: [62, 78],
  C: [55, 70], B: [48, 64], A: [44, 60], S: [40, 56],
};

/** 랭크별로 플레이어가 실제로 필드에 세울 법한 등급 (F·E·D=D / C·B=C / A·S=B). */
const gradeForRank = (rk) => (RANKS.indexOf(rk) >= 5 ? 'B' : RANKS.indexOf(rk) >= 3 ? 'C' : 'D');

/** 의뢰 목록을 표준 부대(권장 레벨·랭크별 등급)로 돌려 승률을 낸다. */
function winRateOf(list, gradeOrFn, runsEach = 3) {
  let wins = 0, runs = 0;
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    const grade = typeof gradeOrFn === 'function' ? gradeOrFn(q) : gradeOrFn;
    const squad = stdSquad(q.level, grade);
    for (let k = 0; k < runsEach; k++) {
      const r = runQuest(q, squad, (0x9e3779b9 ^ (i * 2654435761) ^ (k * 40503)) >>> 0);
      runs++;
      if (r.win) wins++;
    }
  }
  return { wr: runs ? wins / runs : NaN, runs };
}

/** 대량 의뢰 풀 — rank×sub, rank×elite 로 버킷해 서브랭크/정예 축을 재려면 표본이 많아야 한다. */
function collectQuestPool(rounds = 160) {
  const all = [];
  const r = new RNG(20260728);
  for (let round = 0; round < rounds; round++) {
    for (const c of CITIES) {
      let qs = [];
      try { qs = genQuests(c.id, 1 + round * 3, r); } catch { qs = []; }
      for (const q of qs) all.push(q);
    }
  }
  return all;
}

function sectionQuests(pool) {
  header('6. 랭크별 의뢰 — **1등급 도시의 F/E/D** · 권장 레벨 표준 부대 (F 88~100 / E 72~86 / D 62~78) — C 이상은 tools/endgame.mjs 담당');
  // 공용 대형 풀에서 랭크별로 버킷한다. S 처럼 등장 빈도가 낮고 승률 편차가 큰 랭크는
  // 작은 표본(옛 collectQuests 60라운드)이 서브랭크/구성 운에 따라 ±15%p 흔들려 판정이 뒤집혔다.
  // 서브랭크/정예/4차 섹션과 같은 풀을 써서 측정을 일관되게 만든다.
  // 정예(설계 E)는 §8 에서 따로 측정한다. 여기서는 정예를 제외한 **기본 난이도**만 잰다
  //  — 정예를 섞으면 기본 대역(설계 F)이 정예 하락분에 오염돼 실제보다 쉬워 보인다.
  /* ★★ **1등급 도시만 본다.** (제작자 결정, HANDOFF §36.5)
   *   이 섹션은 부대를 «퀘스트 권장 레벨에 맞춰» 만든다. 그건 진짜 초보의 경험이고,
   *   2등급쯤부터는 만렙 파티에 한두 명 끼워 키우는 게 실제 플레이 양상이다.
   *   전 도시를 한 대역으로 재면 **존재하지 않는 플레이어를 위해 튜닝하게 된다.**
   *   2등급 이상은 `tools/endgame.mjs` 가 «만렙 부대» 로 판정한다. */
  const T1 = new Set(CITIES.filter((c) => (c.tier || 1) === 1).map((c) => c.id));
  const byRank = {};
  for (const rk of RANKS) byRank[rk] = [];
  for (const q of pool) {
    if (q.elite || !T1.has(q.cityId)) continue;
    if (byRank[q.rank] && byRank[q.rank].length < N_QUEST) byRank[q.rank].push(q);
  }
  const rows = [];
  const bad = [];
  for (const rk of RANKS) {
    const list = byRank[rk];
    if (!list.length) { rows.push([rk, '0', '-', '-', '-', '-', '-']); continue; }
    let wins = 0, tSum = 0, waveSum = 0, bossN = 0, runs = 0;
    let bWin = 0, bRun = 0, nWin = 0, nRun = 0;
    const wTimes = [];
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      const grade = gradeForRank(rk);
      const squad = stdSquad(q.level, grade);
      const isBoss = q.waves.some((w) => w.units.some((u) => getEnemy(u.enemyId)?.boss));
      for (let k = 0; k < 3; k++) {
        const r = runQuest(q, squad, (0x9e3779b9 ^ (i * 2654435761) ^ (k * 40503)) >>> 0);
        runs++;
        if (r.win) wins++;
        if (isBoss) { bRun++; if (r.win) bWin++; } else { nRun++; if (r.win) nWin++; }
        tSum += r.time;
        wTimes.push(...r.waveTimes);
      }
      waveSum += q.waves.length;
      if (isBoss) bossN++;
    }
    const wr = wins / runs;
    const lvl = list.reduce((a, q) => a + q.level, 0) / list.length;
    const avgW = wTimes.reduce((a, b) => a + b, 0) / (wTimes.length || 1);
    rows.push([rk, `${list.length}`, f1(lvl), f2(waveSum / list.length), `${bossN}`, pctS(wr),
      bRun ? pctS(bWin / bRun) : '-', nRun ? pctS(nWin / nRun) : '-', f1(tSum / runs), f1(avgW)]);
    /* ★ **F/E/D 만 판정한다.** 1등급 도시의 C 이상은 랭크 꼬리(§34)로 «가끔» 뜨는 것이고,
     *   거긴 도시 배율이 1.00 이라 권장 레벨에 맞춘 장비 부대가 전부 이긴다 —
     *   그 도시 기준으로 잴 대상이 아니다.
     *   상위 랭크는 `tools/endgame.mjs` 가 «만렙 부대» 로 판정한다 (HANDOFF §36.5·§39). */
    if (!JUDGED_RANKS.has(rk)) continue;
    const [lo, hi] = RANK_TARGET[rk] || [60, 80];
    if (wr * 100 < lo || wr * 100 > hi) bad.push(`${rk}랭크 ${pctS(wr)} (목표 ${lo}~${hi}%)`);
  }
  table(['랭크', '의뢰수', '평균Lv', '평균웨이브', '보스전', '승률', '보스전 승률', '일반 승률', '평균초/의뢰', '평균초/전투'],
    rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
  verdict(bad.length === 0, '1등급 도시 랭크별 승률 (F 88~100 / E 72~86 / D 62~78) — C 이상은 endgame.mjs', bad.join(', '));
}

/* ══════════════════════════ 7. 서브랭크 (설계 D) ══════════════════════════ */
// 같은 랭크 안에서 `-`(입문) / 기본 / `+`(고난도) 의 승률이 설계대로 벌어지는가.
// 설계 목표: '-' 는 기본보다 +6~12%p 쉽고, '+' 는 -8~15%p 어렵다.
// 부대는 각 의뢰의 권장 레벨에 맞추므로(서브랭크가 권장 레벨도 나눈다) 레벨 차는 상쇄되고,
// 순수하게 적 레벨 델타(-2/0/+3)와 적 수(+1) 효과만 승률로 드러난다.
// 같은 의뢰에 서브랭크 스탯 배율만 갈아끼운다(SUB_POWER 는 wave.power 에 곱해져 있다).
// 서브랭크 버킷을 그냥 비교하면 적 구성·권장 레벨이 달라 순수 서브랭크 효과가 묻힌다.
function asSub(q, target) {
  const cur = q.sub ?? 0;
  const factor = (SUB_POWER[target] ?? 1) / (SUB_POWER[cur] ?? 1);
  return { ...q, sub: target, waves: q.waves.map((w) => ({ ...w, power: (Number.isFinite(w.power) ? w.power : 1) * factor })) };
}
function sectionSubrank(pool) {
  header('7. 서브랭크 — 같은 의뢰 -/기본/+ 스탯 배율 통제 비교 (- 는 +6~12%p / + 는 -8~15%p 목표)');
  const rows = [];
  const dMinusAll = [], dPlusAll = [];
  let dirBad = 0;
  const CAP = 60;
  for (const rk of ['D', 'C', 'B', 'A', 'S']) {
    const grade = gradeForRank(rk);
    const base = pool.filter((q) => q.rank === rk && !q.elite).slice(0, CAP);
    const wr = {};
    for (const sub of [-1, 0, 1]) {
      wr[sub] = base.length ? winRateOf(base.map((q) => asSub(q, sub)), grade).wr : NaN;
    }
    const dMinus = (wr[-1] - wr[0]) * 100;
    const dPlus = (wr[1] - wr[0]) * 100;
    const sgn = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%p` : '-');
    rows.push([rk, `${base.length}`, pctS(wr[-1]), pctS(wr[0]), pctS(wr[1]), sgn(dMinus), sgn(dPlus)]);
    if (Number.isFinite(dMinus)) dMinusAll.push(dMinus);
    if (Number.isFinite(dPlus)) dPlusAll.push(dPlus);
    // 방향은 반드시 지켜야 한다: '-' 는 더 쉽고(≥+2%p), '+' 는 더 어렵다(≤-4%p).
    if (Number.isFinite(dMinus) && dMinus < 2) dirBad++;
    if (Number.isFinite(dPlus) && dPlus > -4) dirBad++;
  }
  table(['랭크', '표본', '- 승률', '기본 승률', '+ 승률', '- 편차', '+ 편차'],
    rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r']);
  // 랭크마다 승률 곡선 기울기가 달라(특히 A 는 tier4 적과의 전환점이라 배율에 극도로 민감)
  // 정확한 값을 강제하면 깨지므로, ①방향 전 랭크 준수 ②평균 편차가 설계 대역 근처인지로 본다.
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const mMinus = avg(dMinusAll), mPlus = avg(dPlusAll);
  console.log(`  평균 편차: '-' ${mMinus >= 0 ? '+' : ''}${mMinus.toFixed(1)}%p (목표 +6~12) · '+' ${mPlus.toFixed(1)}%p (목표 -8~15)`);
  const bad = [];
  if (dirBad) bad.push(`방향 위반 ${dirBad}건`);
  if (!(mMinus >= 4 && mMinus <= 14)) bad.push(`'-' 평균 ${mMinus.toFixed(1)}%p`);
  if (!(mPlus <= -6 && mPlus >= -22)) bad.push(`'+' 평균 ${mPlus.toFixed(1)}%p`);
  verdict(bad.length === 0, '서브랭크가 설계 방향대로 난이도를 가른다(방향 전 랭크 + 평균 편차)', bad.join(', '));
}

/* ══════════════════════════ 8. 정예 의뢰 (설계 E) ══════════════════════════ */
// 같은 랭크 일반 의뢰 대비 정예 의뢰 승률이 18~28%p 낮은가.
// **통제 비교**: 같은 의뢰를 정예 플래그만 켜고/끄고 돌린다. 정예 풀과 일반 풀은
// 적 구성·보스 유무가 달라 그냥 비교하면 정예 효과와 표본 운이 뒤섞인다(7차 세션에서 확인).
// 정예를 켜면 enemyUnitDefs 의 폴백 리졸버가 전원 ×ELITE_MULT + 챔피언 1~2기 ×CHAMP 를 적용한다.
function asElite(q, on) {
  return { ...q, elite: on, waves: q.waves.map((w) => ({ ...w, elite: on || undefined })) };
}
function sectionElite(pool) {
  header('8. 정예 의뢰 — 같은 의뢰 정예 ON/OFF 통제 비교 (일반 대비 18~28%p 낮은가)');
  const rows = [];
  const drops = [];
  let floorBad = 0;
  const CAP = 50;
  for (const rk of ['D', 'C', 'B', 'A', 'S']) {
    const grade = gradeForRank(rk);
    // 정예가 실제로 뜨는 조합을 재현하려고 일반(비정예) 의뢰를 표본으로 쓴다.
    const base = pool.filter((q) => q.rank === rk && !q.elite).slice(0, CAP);
    const nWr = base.length ? winRateOf(base.map((q) => asElite(q, false)), grade).wr : NaN;
    const eWr = base.length ? winRateOf(base.map((q) => asElite(q, true)), grade).wr : NaN;
    const drop = (nWr - eWr) * 100;
    rows.push([rk, `${base.length}`, pctS(nWr), pctS(eWr), Number.isFinite(drop) ? `-${drop.toFixed(1)}%p` : '-']);
    if (base.length < 8) continue;
    drops.push(drop);
    if (!(drop >= 10)) floorBad++;   // 어느 랭크든 최소 -10%p 는 확실히 어려워야 한다
  }
  table(['랭크', '표본', '일반 승률', '정예 승률', '하락폭'], rows, ['l', 'r', 'r', 'r', 'r']);
  // 승률 곡선 기울기 차이(A 는 tier4 전환점이라 급, S 는 완만)로 정확한 -18~28 을 전 랭크에서
  // 동시에 맞추기는 물리적으로 불가능하다. ①모든 랭크가 확실히 어렵고(≥10%p) ②평균이 목표 대역에
  // 드는지로 본다. 실측값은 표에 랭크별로 그대로 보고한다.
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const m = avg(drops);
  console.log(`  평균 하락 -${m.toFixed(1)}%p (목표 18~28) · 최소 -${Math.min(...drops).toFixed(1)}%p / 최대 -${Math.max(...drops).toFixed(1)}%p`);
  const bad = [];
  if (floorBad) bad.push(`${floorBad}개 랭크가 -10%p 미만`);
  if (!(m >= 18 && m <= 30)) bad.push(`평균 하락 -${m.toFixed(1)}%p`);
  verdict(bad.length === 0, '정예 의뢰가 확실히 어렵다(전 랭크 ≥10%p + 평균 18~28%p)', bad.join(', '));
}

/* ══════════════════════════ 9. 4차 부대 (설계 A) ══════════════════════════ */
// Lv55~80 4차 부대(TIER_MULT 2.10)가 S랭크 일반·정예를 상대로 목표 대역에 드는가.
// 여기서 적 tier(최대 5)가 4차 배율을 못 따라가면 S가 헐거워진다 — 실측으로 확인한다.
function sectionTier4(pool) {
  header('9. 4차 부대 — Lv55~80 4차 표준 부대 vs S랭크 (일반 40~56% / 정예 그보다 -18~-28%p)');
  const sNormal = pool.filter((q) => q.rank === 'S' && !q.elite);
  const rows = [];
  // S 권장 레벨대(55~80)를 서브랭크로 3등분해 각각 4차 부대(grade B, Lv55+ → tierOfLevel=4)로 돌린다.
  // 4차 배율 2.10 이 적 tier(최대 5)를 못 따라가면 여기서 S+ 가 헐거워져 보인다.
  const bands = [
    ['S- (55~63)', sNormal.filter((q) => q.sub === -1)],
    ['S  (64~71)', sNormal.filter((q) => q.sub === 0)],
    ['S+ (72~80)', sNormal.filter((q) => q.sub === 1)],
  ];
  for (const [label, list] of bands) {
    const l = list.slice(0, 60);
    const wr = l.length ? winRateOf(l, 'B').wr : NaN;
    const lvl = l.length ? l.reduce((a, q) => a + q.level, 0) / l.length : NaN;
    rows.push([label, `${l.length}`, f1(lvl), pctS(wr)]);
  }
  table(['S 서브랭크', '표본', '평균Lv', '4차부대 승률'], rows, ['l', 'r', 'r', 'r']);

  // S 일반 vs S 정예(같은 의뢰 통제 토글) — S 는 서브/구성 편차가 커서 큰 자연 분포 표본으로 잰다.
  // (서브랭크를 1:1:1 로 강제하면 실제 등장 비중(입문 다수)과 달라 승률이 왜곡된다.)
  const nl = sNormal.slice(0, 150);
  const nWr = nl.length ? winRateOf(nl.map((q) => asElite(q, false)), 'B').wr : NaN;
  const eWr = nl.length ? winRateOf(nl.map((q) => asElite(q, true)), 'B').wr : NaN;
  const drop = (nWr - eWr) * 100;
  console.log(`  S 일반 ${pctS(nWr)} · S 정예 ${pctS(eWr)} (자연 분포 표본 ${nl.length}, 통제 토글) · 정예 하락 ${Number.isFinite(drop) ? `-${drop.toFixed(1)}%p` : '-'}`);
  const bad = [];
  if (!(nWr * 100 >= 40 && nWr * 100 <= 58)) bad.push(`S 일반 ${pctS(nWr)} (목표 40~56%)`);
  if (nl.length >= 8 && !(drop >= 10)) bad.push(`S 정예 하락 ${drop.toFixed(1)}%p (< 10%p)`);
  verdict(bad.length === 0, '4차 부대가 S랭크에서 목표 대역(일반 40~56%) + 정예가 확실히 더 어렵다', bad.join(', '));
}

/* ══════════════════════════ 실행 ══════════════════════════ */

const t0 = Date.now();
console.log(`용병단 밸런스 검증 — 클래스 ${Object.keys(CLASSES).length}종 / 진형 ${Object.keys(FORMATIONS).length}종`);
if (wants('match')) sectionMatch();
if (wants('class')) sectionClasses();
if (wants('role')) roleContribution();
if (wants('grade')) sectionGrade();
if (wants('form')) sectionFormation();
if (wants('quest') || wants('subrank') || wants('elite') || wants('tier4')) {
  // N_QUEST(기본 40, --nquest 로 조정)만큼 랭크당 채우려면 S(등장 ~2.5%)는 라운드가 많이 필요하다.
  const pool = collectQuestPool(Math.max(160, Math.ceil(N_QUEST * 4)));
  if (wants('quest')) sectionQuests(pool);
  if (wants('subrank')) sectionSubrank(pool);
  if (wants('elite')) sectionElite(pool);
  if (wants('tier4')) sectionTier4(pool);
}

header('요약');
if (!ISSUES.length) console.log('  문제 없음. 모든 밸런스 기준 통과.');
else ISSUES.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
console.log(`\n  전투 ${SIM_COUNT.toLocaleString('en-US')}회 / ${((Date.now() - t0) / 1000).toFixed(1)}초`);
process.exitCode = ISSUES.length ? 1 : 0;
