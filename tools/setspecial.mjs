// 세트 고유 효과(special) 검증 — `node tools/setspecial.mjs`
//
// 이 도구가 증명하려는 것은 딱 하나다: **`data/sets.js` 의 고유 효과가 실제 전투에 적용되는가.**
// 말이 아니라 측정으로 보여야 하므로 전부 같은 시드에서 ON/OFF 를 토글해 차이를 낸다.
//
//   0. 어휘 일치   sets.js 의 고유 효과 개수 == 엔진이 처리하는 개수 (양방향, 하나라도 남으면 FAIL)
//   1. 배선        squad.js / quest.js / dungeon.js **세 경로 전부** UnitDef.specials 를 싣는가
//   2. 훅 단위     4종을 엔진 훅에 직접 태워 문서대로 동작하는지 (방어막·흡혈·분열타·부활)
//   3. ON/OFF      같은 시드·같은 부대로 고유 효과만 끄고 켜서 던전 런(HP 인계) 차이
//   4. 개별 기여도 4종을 하나씩만 켜서 각각의 기여도 + **발동 횟수 실측** (죽어 있으면 0 으로 드러난다)
//   5. 결정론      같은 시드 두 번 = 같은 결과
//
// 실패가 하나라도 있으면 exit 1.
//
// 주의: 순수 JS 모듈만 import 한다 (DOM 참조 금지).
import { RNG } from '../src/core/rng.js';
import { simulate, createBattle, setSkillResolver, SPECIAL_IDS } from '../src/battle/engine.js';
import { getClass } from '../src/data/classes.js';
import { getSkill } from '../src/data/skills.js';
import '../src/data/enemies.js';                     // 적 전용 스킬 등록 (부수효과)
import { getFormation } from '../src/data/formations.js';
import { mercStats } from '../src/game/merc.js';
import * as Gear from '../src/game/gear.js';
import * as Sets from '../src/data/sets.js';
import * as State from '../src/game/state.js';
import * as Squad from '../src/game/squad.js';
import * as Quest from '../src/game/quest.js';
import * as Dungeon from '../src/game/dungeon.js';
import { DUNGEON_LIST } from '../src/data/dungeons.js';
import { WAVES, WAVE_POWER } from '../src/game/dungeon.js';

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

/** 웨이브 하나당 표본 */
const N = optNum('n', 30);
const GRADE = optStr('grade', 'A');
const LEVEL = optNum('level', 80);

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
const sgn = (v, dec = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(dec)}`;

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

/* ══════════════════════════════════════════════════════════════════════
 * 0. 어휘 일치 — sets.js 의 고유 효과를 엔진이 전부 처리하는가
 * ══════════════════════════════════════════════════════════════════════ */

const DATA_IDS = Sets.SET_SPECIAL_IDS.slice().sort();
const ENGINE_IDS = SPECIAL_IDS.slice().sort();

if (wants('vocab')) {
  header('0. 고유 효과 어휘 — data/sets.js ↔ battle/engine.js');
  console.log(`  sets.js  ${DATA_IDS.length}종: ${DATA_IDS.join(', ')}`);
  console.log(`  engine   ${ENGINE_IDS.length}종: ${ENGINE_IDS.join(', ')}`);

  const missing = DATA_IDS.filter((id) => !ENGINE_IDS.includes(id));
  const extra = ENGINE_IDS.filter((id) => !DATA_IDS.includes(id));
  verdict(missing.length === 0, '엔진이 처리하지 않는 sets.js 고유 효과가 없다',
    missing.length ? `미구현 ${missing.join(', ')}` : '');
  verdict(extra.length === 0, '엔진에만 있고 sets.js 에 없는 고유 효과가 없다',
    extra.length ? `유령 ${extra.join(', ')}` : '');
  verdict(DATA_IDS.length === ENGINE_IDS.length,
    `개수 일치 (${DATA_IDS.length} == ${ENGINE_IDS.length})`, `${DATA_IDS.length} vs ${ENGINE_IDS.length}`);

  // 정의가 완결적인가 (엔진이 params 만 읽어 동작할 수 있어야 한다)
  let bad = [];
  for (const id of DATA_IDS) {
    const s = Sets.getSetSpecial(id);
    if (!s || !s.params || !Object.keys(s.params).length) { bad.push(`${id}:params`); continue; }
    if (!s.desc) bad.push(`${id}:desc`);
    if (!s.name) bad.push(`${id}:name`);
    if (!Sets.SPECIAL_TRIGGERS.includes(s.params.trigger)) bad.push(`${id}:trigger(${s.params.trigger})`);
  }
  verdict(bad.length === 0, '4종 전부 name/desc/params/trigger 를 갖췄다', bad.join(' '));
}

/* ────────────────────────── 부대 / 장비 구성 ────────────────────────── */

// tools/dungeon.mjs 와 같은 4차 표준 부대. 아키타입이 전부 다르다.
const SQUAD4 = [
  'bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
  'masterarcher_apex', 'archmage_apex', 'highpriest_abyss',
];

/** 그 아키타입이 입을 수 있는 세트 (계열 세트 우선, 없으면 성좌) */
function setForArch(arch) {
  const hit = Sets.SET_LIST.find((s) => s.archs.includes(arch) && s.archs.length < Sets.ALL_ARCHS.length);
  return (hit || Sets.getSet('constellation')).id;
}

const FILL_ORDER = ['body', 'head', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'weapon', 'offhand'];

/**
 * 풀세트 장비 한 벌 (10칸 전부 같은 세트).
 * @param {(arch:string)=>string} [setOf] 세트 선택기 (기본: 그 아키타입의 계열 세트)
 */
function fullSetLoadout(classId, uidTag, setOf = null) {
  const cls = getClass(classId);
  const setId = (setOf ? setOf(cls.arch) : null) || setForArch(cls.arch);
  const items = [];
  const equipment = {};
  for (const slot of FILL_ORDER) {
    const it = Sets.setPieceItem(setId, slot, 80, { uid: `it_${uidTag}_${slot}` });
    if (!it) continue;
    items.push(it);
    equipment[slot] = it.uid;
  }
  return { equipment, items, setId };
}

/**
 * 아군 UnitDef 7기.
 * `specials` 는 **실제 게임과 같은 진입점**(`gear.setSpecialsFor`)에서 가져온다 —
 * 도구가 자체 경로로 만들면 "배선이 살아 있다"를 증명하지 못한다.
 * @param {(id:string)=>boolean} [allow] 켤 고유 효과 필터 (기본: 전부 켬)
 */
function allySquad(allow = null, formationId = 'basic', setOf = null) {
  const f = getFormation(formationId) || getFormation('basic');
  return SQUAD4.map((classId, i) => {
    const cls = getClass(classId);
    const { equipment, items } = fullSetLoadout(classId, `a${i}`, setOf);
    const merc = { uid: `a${i}`, classId, level: LEVEL, grade: GRADE, equipment };
    const raw = Gear.setSpecialsFor(merc, items) || [];
    const specials = raw
      .filter((s) => !allow || allow(s.id))
      .map((s) => ({ id: s.id, label: s.name || s.id, params: { ...s.params } }));
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
    };
  });
}

/** 적 정의 캐시 (던전+웨이브는 결정론적이다) */
const ENEMY_CACHE = new Map();
function enemiesOf(dungeonId, wi) {
  const k = `${dungeonId}#${wi}`;
  if (!ENEMY_CACHE.has(k)) ENEMY_CACHE.set(k, Dungeon.dungeonEnemyDefs(dungeonId, wi));
  return ENEMY_CACHE.get(k);
}

/* ══════════════════════════════════════════════════════════════════════
 * 1. 배선 — 세 경로가 전부 UnitDef.specials 를 싣는가
 * ══════════════════════════════════════════════════════════════════════ */

/** 풀세트를 입힌 진짜 게임 상태를 만든다 (세이브 경로와 동일한 자료 구조) */
function makeLiveState() {
  State.newGame(20260801, '검증단');
  const st = State.state;
  const squad = st.squads[0];
  // 로스터 앞 4명을 4차 클래스로 갈아 끼우고 풀세트를 입힌다
  st.roster.forEach((m, i) => {
    const classId = SQUAD4[i % SQUAD4.length];
    m.classId = classId;
    m.level = LEVEL;
    m.grade = GRADE;
    const { equipment, items } = fullSetLoadout(classId, `live${i}`);
    m.equipment = equipment;
    m.hp = null;
    for (const it of items) st.items.push(it);
    squad.memberUids[i] = m.uid;
  });
  return st;
}

if (wants('wire')) {
  header('1. 배선 — squad.js / quest.js / dungeon.js 세 경로');
  const st = makeLiveState();
  const sqId = st.squads[0].id;

  const hasSp = (defs) => (defs || []).filter((d) => Array.isArray(d.specials) && d.specials.length > 0);
  const spIds = (defs) => [...new Set((defs || []).flatMap((d) => (d.specials || []).map((s) => s.id)))].sort();

  // (a) squad.js squadUnitDefs
  const sqDefs = Squad.squadUnitDefs(st, sqId);
  const sqHit = hasSp(sqDefs);
  verdict(sqHit.length > 0, `squad.js squadUnitDefs 가 specials 를 싣는다`,
    `${sqHit.length}/${sqDefs.length}기`);
  console.log(`         → ${sqHit.length}/${sqDefs.length}기 · ${spIds(sqDefs).join(', ') || '(없음)'}`);

  // (b) quest.js allyUnitDefs (questBattleDefs 를 통해 — 그 함수는 모듈 내부다)
  const quests = Quest.genQuests(st.cityId, st.day || 1, new RNG(4242), 1);
  const q = quests.find((x) => x.waves && x.waves.length) || quests[0];
  const qCfg = Quest.questBattleDefs(q, 0, st, sqId);
  const qHit = hasSp(qCfg.allies);
  verdict(qHit.length > 0, `quest.js allyUnitDefs 가 specials 를 싣는다`,
    `${qHit.length}/${(qCfg.allies || []).length}기`);
  console.log(`         → ${qHit.length}/${(qCfg.allies || []).length}기 · ${spIds(qCfg.allies).join(', ') || '(없음)'}`);

  // (c) dungeon.js dungeonBattleDefs
  const dgId = DUNGEON_LIST[0].id;
  const dCfg = Dungeon.dungeonBattleDefs(st, dgId, 0, sqId);
  const dHit = hasSp(dCfg.allies);
  verdict(dHit.length > 0, `dungeon.js dungeonBattleDefs 가 specials 를 싣는다`,
    `${dHit.length}/${(dCfg.allies || []).length}기`);
  console.log(`         → ${dHit.length}/${(dCfg.allies || []).length}기 · ${spIds(dCfg.allies).join(', ') || '(없음)'}`);

  // (d) 적에게는 절대 실리면 안 된다
  const enemyHit = hasSp(qCfg.enemies).length + hasSp(dCfg.enemies).length;
  verdict(enemyHit === 0, '적 UnitDef 에는 specials 가 실리지 않는다', `${enemyHit}기`);

  // (e) 세 경로가 같은 효과를 준다 (한쪽만 배선된 전례가 있다)
  const a = spIds(sqDefs).join('|'), b = spIds(qCfg.allies).join('|'), c = spIds(dCfg.allies).join('|');
  verdict(a === b && b === c, '세 경로의 고유 효과 목록이 동일하다', `${a} / ${b} / ${c}`);

  // (f) params 가 sets.js 원본과 같은가 (엔진은 params 만 읽는다)
  let pmBad = [];
  for (const d of qHit) {
    for (const s of d.specials) {
      const src = Sets.getSetSpecial(s.id);
      if (!src) { pmBad.push(`${s.id}:정의없음`); continue; }
      for (const k of Object.keys(src.params)) {
        if (JSON.stringify(s.params[k]) !== JSON.stringify(src.params[k])) pmBad.push(`${s.id}.${k}`);
      }
    }
  }
  verdict(pmBad.length === 0, 'UnitDef.specials[].params 가 sets.js specialParams 와 같다',
    [...new Set(pmBad)].join(' '));
}

/* ══════════════════════════════════════════════════════════════════════
 * 2. 훅 단위 검증 — 4종을 엔진 훅에 직접 태워 문서대로 동작하는가
 * ══════════════════════════════════════════════════════════════════════ */

/** 고유 효과 하나만 가진 더미 유닛으로 전투를 만든다 */
function probeBattle(specialId, opts = {}) {
  const sp = Sets.getSetSpecial(specialId);
  const mk = (uid, side, over = {}) => ({
    uid, name: uid, side,
    stats: { hp: 20000, atk: 300, def: 100, res: 100, spd: 40, crit: 0, critDmg: 50, eva: 0 },
    skills: [], basicFx: 'slash', basicRange: 'melee', basicDmgType: 'phys',
    slot: { x: 0.2, y: 0.5 }, slotIndex: 0,
    ...over,
  });
  const allies = [mk('h1', 'ally', { specials: [{ id: specialId, label: sp.name, params: { ...sp.params } }] })];
  if (opts.extraAlly) allies.push(mk('h2', 'ally', { slot: { x: 0.5, y: 0.3 }, slotIndex: 1 }));
  const enemies = [mk('e1', 'enemy', { slot: { x: 0.2, y: 0.5 } })];
  if (opts.extraEnemy) enemies.push(mk('e2', 'enemy', { slot: { x: 0.5, y: 0.3 }, slotIndex: 1 }));
  return createBattle({ allies, enemies, seed: 7, getSkill, record: true });
}

if (wants('hook')) {
  header('2. 훅 단위 — 엔진이 sets.js 파라미터대로 동작하는가');

  // (a) rampart_aegis — battleStart 방어막 + shieldBreak 아군 방어 버프
  {
    const p = Sets.getSetSpecial('rampart_aegis').params;
    const b = probeBattle('rampart_aegis', { extraAlly: true });
    const u = b.units.find((x) => x.uid === 'h1');
    const want = Math.round(u.maxHp * p.shieldRatio);
    verdict(u.shield === want && Math.abs(u.shieldDur - p.shieldDur) < 1e-6,
      `rampart_aegis: 전투 시작 방어막 = 최대체력 x${p.shieldRatio} (${p.shieldDur}초)`,
      `실측 shield=${u.shield}(기대 ${want}) dur=${u.shieldDur}`);
    // 방어막을 피해로 깬다
    b.drainEvents();
    b.applySpecial(u, 'shieldBreak', { srcUid: 'e1', amount: 1 });
    const ally = b.units.find((x) => x.uid === 'h2');
    const buf = ally.buffs.find((x) => x.stat === p.allyStat);
    verdict(!!buf && Math.abs(buf.amount - p.allyDefMod) < 1e-9 && Math.abs(buf.dur - p.allyDur) < 1e-6,
      `rampart_aegis: 방어막 파괴 시 아군 전체 ${p.allyStat} +${p.allyDefMod} (${p.allyDur}초)`,
      buf ? `실측 ${buf.stat} ${buf.amount} ${buf.dur}초` : '버프 없음');
    // 1회 제한
    const before = ally.buffs.length;
    b.applySpecial(u, 'shieldBreak', { srcUid: 'e1', amount: 1 });
    verdict(ally.buffs.length === before, 'rampart_aegis: 전투당 1회 (breakOnce)');
  }

  // (b) bloodoath_frenzy — 흡혈 / 처치 시 쿨감 + 공격력 중첩
  {
    const p = Sets.getSetSpecial('bloodoath_frenzy').params;
    const b = probeBattle('bloodoath_frenzy', { extraEnemy: true });
    const u = b.units.find((x) => x.uid === 'h1');
    u.hp = Math.round(u.maxHp * 0.5);
    const hp0 = u.hp;
    b.applySpecial(u, 'dealDamage', { target: b.units.find((x) => x.uid === 'e1'), amount: 1000, total: 1000, crit: false, dmgType: 'phys', skill: null, killed: false });
    const healed = u.hp - hp0;
    verdict(Math.abs(healed - 1000 * p.lifesteal) <= 1,
      `bloodoath_frenzy: 가한 피해의 ${p.lifesteal * 100}% 흡혈`, `실측 +${healed} (기대 ${1000 * p.lifesteal})`);
    // 처치 훅
    u.cds = { x: 10 };
    b.applySpecial(u, 'kill', { target: null, skill: null });
    const buf1 = u.buffs.find((x) => x.stat === 'atk' && x.src === (p.buffId || 'sp_bloodoath_frenzy'));
    verdict(!!buf1 && Math.abs(buf1.amount - p.atkMod) < 1e-9,
      `bloodoath_frenzy: 처치 시 atk +${p.atkMod} (1중첩)`, buf1 ? `실측 ${buf1.amount}` : '버프 없음');
    verdict(Math.abs(u.cds.x - (10 - p.cdReduce)) < 1e-6,
      `bloodoath_frenzy: 처치 시 쿨 -${p.cdReduce}초`, `실측 ${u.cds.x}`);
    for (let i = 1; i < p.stacks + 2; i++) b.applySpecial(u, 'kill', { target: null, skill: null });
    const bufN = u.buffs.find((x) => x.stat === 'atk' && x.src === (p.buffId || 'sp_bloodoath_frenzy'));
    verdict(!!bufN && Math.abs(bufN.amount - p.atkMod * p.stacks) < 1e-9,
      `bloodoath_frenzy: 최대 ${p.stacks}중첩에서 멈춘다`, bufN ? `실측 ${bufN.amount}` : '버프 없음');
  }

  // (c) starseeker_starfall — 원거리 분열타 + 처치 게이지
  {
    const p = Sets.getSetSpecial('starseeker_starfall').params;
    const b = probeBattle('starseeker_starfall', { extraEnemy: true });
    const u = b.units.find((x) => x.uid === 'h1');
    const t1 = b.units.find((x) => x.uid === 'e1');
    const t2 = b.units.find((x) => x.uid === 'e2');
    const hp2 = t2.hp;
    b.drainEvents();
    const fired = b.applySpecial(u, 'dealDamage', {
      target: t1, amount: 1000, total: 1000, crit: false, dmgType: 'phys',
      skill: { id: 'probe', range: 'ranged', power: 1, dmgType: 'phys', fx: 'arrow' }, killed: false,
    });
    const splash = hp2 - t2.hp;
    verdict(fired && splash > 0,
      `starseeker_starfall: 원거리 명중 시 다른 적 ${p.splashCount}기 추가 타격`, `실측 ${splash}`);
    verdict(Math.abs(splash - Math.round(1000 * p.splashPower)) <= 1,
      `starseeker_starfall: 추가 타격 = 그 피해의 ${p.splashPower * 100}% (splashOf=damage)`,
      `실측 ${splash} (기대 ${Math.round(1000 * p.splashPower)})`);
    // 근접은 발동하지 않는다
    const hp2b = t2.hp;
    b.applySpecial(u, 'dealDamage', {
      target: t1, amount: 1000, total: 1000, crit: false, dmgType: 'phys',
      skill: { id: 'probe2', range: 'melee', power: 1, dmgType: 'phys' }, killed: false,
    });
    verdict(t2.hp === hp2b, 'starseeker_starfall: 근접 공격에는 발동하지 않는다 (rangeFilter)');
    // 처치 게이지
    u.gauge = 0;
    b.applySpecial(u, 'kill', { target: t1, skill: null });
    verdict(Math.abs(u.gauge - 100 * p.killGauge) < 1e-6,
      `starseeker_starfall: 처치 시 행동 게이지 +${p.killGauge * 100}`, `실측 ${u.gauge}`);
  }

  // (d) constellation_grace — 부활 + 아군 회복
  {
    const p = Sets.getSetSpecial('constellation_grace').params;
    const b = probeBattle('constellation_grace', { extraAlly: true });
    const u = b.units.find((x) => x.uid === 'h1');
    const mate = b.units.find((x) => x.uid === 'h2');
    mate.hp = Math.round(mate.maxHp * 0.3);
    const mate0 = mate.hp;
    // 치명타 피해를 실제로 먹여 lethal 훅을 태운다
    const dead = u.maxHp * 10;
    const src = b.units.find((x) => x.uid === 'e1');
    b.drainEvents();
    // applyDamage 는 내부 함수라 훅을 직접 태운다 (엔진이 부르는 경로와 같은 시그니처)
    const after = [];
    const ok = b.applySpecial(u, 'lethal', { srcUid: src.uid, amount: dead, total: dead, dmgType: 'phys', after });
    for (const fn of after) fn();
    verdict(ok && u.hp === Math.round(u.maxHp * p.reviveHp),
      `constellation_grace: 치명 피해를 가로채고 최대체력 ${p.reviveHp * 100}% 로 부활`,
      `실측 hp=${u.hp} (기대 ${Math.round(u.maxHp * p.reviveHp)})`);
    verdict(mate.hp - mate0 > 0 && Math.abs((mate.hp - mate0) - Math.round(mate.maxHp * p.allyHeal)) <= 1,
      `constellation_grace: 부활 시 아군 전체가 최대체력 ${p.allyHeal * 100}% 회복`,
      `실측 +${mate.hp - mate0} (기대 ${Math.round(mate.maxHp * p.allyHeal)})`);
    const after2 = [];
    const twice = b.applySpecial(u, 'lethal', { srcUid: src.uid, amount: dead, total: dead, dmgType: 'phys', after: after2 });
    verdict(!twice, 'constellation_grace: 전투당 1회 (reviveOnce)');
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * 3~4. ON/OFF · 개별 기여도 — 같은 시드로 토글해 차이를 잰다
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * ★ 측정 단위는 **던전 런(HP 인계)** 이다 — 고정 웨이브 하나의 승률로는 잴 수 없다.
 *
 * 던전은 편성이 고정(`lineup`/`bosses`)이라 만피 7대7 웨이브 하나의 승률이 **계단**이다
 * (HANDOFF §11.4: 배율 3.0 → 100% / 3.2 → 8%). 고정 웨이브에서 재면 어떤 효과를 켜도
 * Δ승률이 0%p 로 눌리고, 초반 웨이브는 아무도 죽지 않아 `constellation_grace` 는 발동조차
 * 하지 않는다. 실제 게임과 같은 **1웨이브부터 HP 를 인계하는 런**으로 재야 소모전이 반영되어
 * 도달 웨이브·생존 인원이 연속적으로 움직인다.
 *
 * 여기서 "승률" = **웨이브 전투 승률**(치른 웨이브 중 이긴 비율)이다.
 */
const RUN_SEEDS = N;

/**
 * 한 구성으로 던전 4개를 각각 RUN_SEEDS 번 완주 시도한다.
 * @param {boolean} [collectFire] 고유 효과 발동 횟수(`specialState[id].fired`)까지 모을지
 * @returns {{win:number, dmg:number, alive:number, reach:number, clear:number, waves:number, runs:number, fire:Map|null}}
 */
function measure(allies0, collectFire = false) {
  const allyUids = new Set(allies0.map((a) => a.uid));
  const fire = collectFire ? new Map(DATA_IDS.map((id) => [id, { n: 0, hooks: new Map() }])) : null;
  let waves = 0, win = 0, dmg = 0, aliveSum = 0, reach = 0, clear = 0, runs = 0;

  for (const d of DUNGEON_LIST) {
    for (let i = 0; i < RUN_SEEDS; i++) {
      const seed0 = (13579 + i * 104729 + d.id.length * 31) >>> 0;
      let hp = allies0.map((a) => a.stats.hp);
      let cleared = 0;
      runs++;
      for (let wi = 0; wi < WAVES; wi++) {
        const enemies = enemiesOf(d.id, wi);
        if (!enemies.length) break;
        const allies = allies0.map((a, k) => (hp[k] > 0 ? { ...a, hp: hp[k] } : null)).filter(Boolean);
        if (!allies.length) break;
        const b = createBattle({
          allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic',
          seed: ((seed0 + wi * 7717) >>> 0) || 1, getSkill, record: false,
        });
        const r = b.run();
        waves++;
        for (const uid of Object.keys(r.damageDealt)) if (allyUids.has(uid)) dmg += r.damageDealt[uid];
        if (fire) {
          for (const u of b.units) {
            for (const id of Object.keys(u.specialState || {})) {
              const rec = fire.get(id);
              if (!rec) continue;
              const st = u.specialState[id];
              rec.n += st.fired || 0;
              for (const k of Object.keys(st)) {
                if (!k.startsWith('fired_')) continue;
                const h = k.slice(6);
                rec.hooks.set(h, (rec.hooks.get(h) || 0) + st[k]);
              }
            }
          }
        }
        if (r.winner !== 'ally') break;
        win++;
        cleared++;
        const next = allies0.map(() => 0);
        for (const u of b.units) {
          if (u.side !== 'ally') continue;
          const k = allies0.findIndex((a) => a.uid === u.uid);
          if (k >= 0) next[k] = u.alive ? Math.max(1, Math.round(u.hp || 0)) : 0;
        }
        hp = next;
        aliveSum += next.filter((v) => v > 0).length;
      }
      reach += cleared;
      if (cleared >= WAVES) clear++;
    }
  }
  return {
    win: waves ? win / waves : 0,
    dmg: waves ? dmg / waves : 0,
    alive: win ? aliveSum / win : 0,     // 웨이브를 이겼을 때 남은 인원
    reach: reach / runs,
    clear: clear / runs,
    waves, runs, fire,
  };
}

/**
 * 보조 측정 — **10웨이브 벽에서의 마진**.
 *
 * 런 통계는 벽(WAVE_POWER[9]=6.35)이 계단이라 효과 하나만 켜면 Δ도달·Δ완주가 0 으로 눌린다
 * (넷을 다 켜야 넘어가도록 맞춰 뒀다). 그래서 개별 기여도는 **승패가 아니라 마진**으로 잰다:
 *
 *   마진 = (전투 끝 아군 잔여 HP 비율) − (적 잔여 HP 비율)
 *
 * 이 값은 연속적이라 "졌지만 얼마나 아깝게 졌는가"까지 눈금으로 보여 준다.
 * 아군 잔여가 많고 적 잔여가 적을수록 크다. 마진이 0 을 넘으면 대체로 이긴 전투다.
 */
const WALL_WAVE = WAVES - 1;
function wallMargin(allies0) {
  let win = 0, margin = 0, allySide = 0, foeSide = 0, n = 0;
  for (const d of DUNGEON_LIST) {
    const enemies = enemiesOf(d.id, WALL_WAVE);
    if (!enemies.length) continue;
    for (let i = 0; i < N; i++) {
      const seed = (55001 + i * 7919 + d.id.length * 17) >>> 0;
      const b = createBattle({
        allies: allies0, enemies, allyFormationId: 'basic', enemyFormationId: 'basic',
        seed, getSkill, record: false,
      });
      const r = b.run();
      n++;
      if (r.winner === 'ally') win++;
      let ah = 0, am = 0, eh = 0, em = 0;
      for (const u of b.units) {
        if (u.side === 'ally') { ah += Math.max(0, u.hp); am += u.maxHp; }
        else { eh += Math.max(0, u.hp); em += u.maxHp; }
      }
      const a = am ? ah / am : 0, e = em ? eh / em : 0;
      allySide += a; foeSide += e; margin += a - e;
    }
  }
  return { win: win / n, margin: margin / n, ally: allySide / n, foe: foeSide / n, n };
}

const OFF_SQUAD = allySquad(() => false);
const ON_SQUAD = allySquad(null);

let onOffDelta = null;

if (wants('onoff')) {
  header(`3. ★ 고유 효과 ON/OFF — 같은 시드·같은 부대 (던전 4개 x ${RUN_SEEDS}런 = ${DUNGEON_LIST.length * RUN_SEEDS}런)`);
  const off = measure(OFF_SQUAD);
  const on = measure(ON_SQUAD);
  onOffDelta = { off, on };

  table(['구성', '웨이브 승률', '평균 피해/웨이브', '평균 생존', '평균 도달', '10웨 완주'], [
    ['고유효과 OFF', pctS(off.win), Math.round(off.dmg).toLocaleString(), f2(off.alive), f2(off.reach), pctS(off.clear)],
    ['고유효과 ON', pctS(on.win), Math.round(on.dmg).toLocaleString(), f2(on.alive), f2(on.reach), pctS(on.clear)],
    ['차이', `${sgn((on.win - off.win) * 100)}%p`,
      `${sgn(on.dmg - off.dmg, 0)} (${sgn((on.dmg / off.dmg - 1) * 100)}%)`,
      sgn(on.alive - off.alive, 2), sgn(on.reach - off.reach, 2), `${sgn((on.clear - off.clear) * 100)}%p`],
  ], ['l', 'r', 'r', 'r', 'r', 'r']);

  const same = on.win === off.win && Math.abs(on.dmg - off.dmg) < 1e-6
    && Math.abs(on.alive - off.alive) < 1e-9 && Math.abs(on.reach - off.reach) < 1e-9;
  verdict(!same, '★ 고유 효과 ON/OFF 가 실제로 다른 결과를 낸다 (차이 0 = 배선 끊김)',
    same ? '전 지표가 완전히 동일하다 — 엔진이 specials 를 소비하지 않는다' : '');
  verdict(on.reach >= off.reach && on.clear >= off.clear, '고유 효과가 도달 웨이브를 떨어뜨리지 않는다',
    `OFF ${f2(off.reach)}/${pctS(off.clear)} → ON ${f2(on.reach)}/${pctS(on.clear)}`);
}

if (wants('each')) {
  header('4. ★ 개별 기여도 — 4종을 하나씩만 켠다 (기준 = 전부 OFF)');
  const off = (onOffDelta && onOffDelta.off) || measure(OFF_SQUAD);
  const rows = [];
  const dead = [];
  for (const id of DATA_IDS) {
    const sp = Sets.getSetSpecial(id);
    const m = measure(allySquad((x) => x === id));
    rows.push([sp.name, id, pctS(m.win), `${sgn((m.win - off.win) * 100)}%p`,
      sgn(m.dmg - off.dmg, 0), sgn(m.alive - off.alive, 2), sgn(m.reach - off.reach, 2),
      `${sgn((m.clear - off.clear) * 100)}%p`]);
    const changed = Math.abs(m.win - off.win) > 1e-9 || Math.abs(m.dmg - off.dmg) > 1e-6
      || Math.abs(m.alive - off.alive) > 1e-9 || Math.abs(m.reach - off.reach) > 1e-9;
    if (!changed) dead.push(id);
  }
  table(['효과', 'id', '웨이브 승률', 'Δ승률', 'Δ피해', 'Δ생존', 'Δ도달', 'Δ완주'], rows,
    ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r']);
  verdict(dead.length === 0, '★ 4종 전부 전투 결과를 바꾼다 (죽은 효과 없음)',
    dead.length ? `무반응 ${dead.join(', ')}` : '');
  console.log('  ※ Δ도달·Δ완주가 0 인 것은 효과가 죽어서가 아니다 — 10웨이브 벽은 네 효과를 다 켜야');
  console.log('    넘어가도록 맞춰 뒀다(WAVE_POWER[9]=6.35). 하나씩의 눈금은 바로 아래 **벽 마진 표**를 봐라.');

  // ── 10웨이브 벽에서의 마진 — 개별 기여도가 눈금 있게 보이는 유일한 구간
  console.log('');
  console.log(`  개별 기여도 — 10웨이브 벽 (WAVE_POWER[${WALL_WAVE}]=${WAVE_POWER[WALL_WAVE]}) · 마진 = 아군 잔여HP% − 적 잔여HP%`);
  const wOff = wallMargin(OFF_SQUAD);
  const wrows = [['(전부 OFF)', '-', pctS(wOff.win), pctS(wOff.margin), pctS(wOff.ally), pctS(wOff.foe), '-']];
  const wDead = [];
  for (const id of DATA_IDS) {
    const m = wallMargin(allySquad((x) => x === id));
    wrows.push([Sets.getSetSpecial(id).name, id, pctS(m.win), pctS(m.margin),
      pctS(m.ally), pctS(m.foe), `${sgn((m.margin - wOff.margin) * 100)}%p`]);
    if (Math.abs(m.margin - wOff.margin) < 1e-9) wDead.push(id);
  }
  const wAll = wallMargin(ON_SQUAD);
  wrows.push(['(전부 ON)', '-', pctS(wAll.win), pctS(wAll.margin), pctS(wAll.ally), pctS(wAll.foe),
    `${sgn((wAll.margin - wOff.margin) * 100)}%p`]);
  table(['효과', 'id', '승률', '마진', '아군 잔여', '적 잔여', 'Δ마진'], wrows,
    ['l', 'l', 'r', 'r', 'r', 'r', 'r']);
  verdict(wAll.margin > wOff.margin, '10웨이브 벽에서 고유 효과 전부 ON 이 OFF 보다 마진이 크다',
    `OFF ${pctS(wOff.margin)} → ON ${pctS(wAll.margin)}`);
  verdict(wDead.length === 0, '★ 4종 전부 벽에서 마진을 움직인다 (하나도 죽어 있지 않다)',
    wDead.join(', '));

  // ── 발동 횟수 실측: 엔진이 `specialState[id].fired` 에 남긴 계수기를 그대로 읽는다.
  //    Δ 수치는 "무언가 달라졌다" 까지만 증명한다. 이 표는 **몇 번 발동했는지**를 센다.
  console.log('');
  console.log('  발동 횟수 (전 효과 ON · 같은 표본):');
  const fm = measure(ON_SQUAD, true);
  const frows = DATA_IDS.map((id) => {
    const r = fm.fire.get(id);
    const hooks = [...r.hooks.entries()].sort().map(([h, c]) => `${h} ${c}`).join(' · ');
    return [Sets.getSetSpecial(id).name, id, r.n.toLocaleString(), f2(r.n / fm.waves), hooks || '(없음)'];
  });
  table(['효과', 'id', '총 발동', '웨이브당', '훅별'], frows, ['l', 'l', 'r', 'r', 'l']);
  const never = DATA_IDS.filter((id) => fm.fire.get(id).n === 0);
  verdict(never.length === 0, `★ 4종 전부 실제 전투에서 발동한다 (웨이브 전투 ${fm.waves}회)`,
    never.length ? `발동 0회 ${never.join(', ')}` : '');

  // ── 보정: 위 표는 "각자 자기 계열 세트" 모델이라 `constellation_grace` 는 **7명 중 1명**(힐러)만
  //    갖는다. 성좌는 전 아키타입이 입을 수 있으므로 7인 전원 착용도 실제 빌드다 — 그때의 기여도.
  console.log('');
  console.log('  참고 — 성좌 세트를 7인 전원이 입었을 때 (constellation_grace 만 ON):');
  const gOn = measure(allySquad((x) => x === 'constellation_grace', 'basic', () => 'constellation'));
  const gOff = measure(allySquad(() => false, 'basic', () => 'constellation'));
  table(['구성', '웨이브 승률', '평균 생존', '평균 도달'], [
    ['성좌7 · 효과 OFF', pctS(gOff.win), f2(gOff.alive), f2(gOff.reach)],
    ['성좌7 · 효과 ON', pctS(gOn.win), f2(gOn.alive), f2(gOn.reach)],
    ['차이', `${sgn((gOn.win - gOff.win) * 100)}%p`, sgn(gOn.alive - gOff.alive, 2), sgn(gOn.reach - gOff.reach, 2)],
  ], ['l', 'r', 'r', 'r']);
  verdict(gOn.reach >= gOff.reach, '성좌 7인 전원 착용에서도 고유 효과가 손해가 아니다',
    `OFF ${f2(gOff.reach)} → ON ${f2(gOn.reach)}`);
}

/* ══════════════════════════════════════════════════════════════════════
 * 5. 결정론 — 같은 시드 두 번 = 같은 결과
 * ══════════════════════════════════════════════════════════════════════ */

if (wants('det')) {
  header('5. 결정론 — 고유 효과를 켠 채 같은 시드 두 번');
  let bad = 0, checked = 0;
  for (const d of DUNGEON_LIST) for (const wi of [0, 4, 7, 9]) {
    const enemies = enemiesOf(d.id, wi);
    if (!enemies.length) continue;
    for (let i = 0; i < 4; i++) {
      const seed = (4242 + i * 131 + wi * 7) >>> 0;
      const cfg = { allies: ON_SQUAD, enemies, allyFormationId: 'basic', enemyFormationId: 'basic', seed, getSkill };
      const a = simulate(cfg);
      const b = simulate(cfg);
      checked++;
      const key = (r) => JSON.stringify([r.winner, Math.round(r.time * 1000), r.damageDealt, r.healDone, r.kills]);
      if (key(a) !== key(b)) bad++;
    }
  }
  verdict(bad === 0, `같은 시드 = 같은 결과 (${checked}쌍)`, `불일치 ${bad}쌍`);

  // 시드가 다르면 결과도 달라야 한다 (상수를 반환하는 버그 방지)
  const enemies = enemiesOf(DUNGEON_LIST[0].id, 7);
  const r1 = simulate({ allies: ON_SQUAD, enemies, allyFormationId: 'basic', enemyFormationId: 'basic', seed: 11, getSkill });
  const r2 = simulate({ allies: ON_SQUAD, enemies, allyFormationId: 'basic', enemyFormationId: 'basic', seed: 12, getSkill });
  verdict(JSON.stringify(r1.damageDealt) !== JSON.stringify(r2.damageDealt),
    '다른 시드는 다른 결과를 낸다');
}

/* ────────────────────────────── 종합 ────────────────────────────── */

header('종합');
if (ISSUES.length === 0) {
  console.log('  ✅ 전부 통과');
  process.exit(0);
} else {
  console.log(`  ❌ ${ISSUES.length}건 실패`);
  for (const s of ISSUES) console.log(`     · ${s}`);
  process.exit(1);
}
