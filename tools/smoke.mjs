// tools/smoke.mjs — 브라우저 없이 도는 정합성 스모크 테스트.
//   실행: node tools/smoke.mjs
// 밸런스는 tools/balance.mjs 담당. 여기서는 "크래시 / 데이터 정합성"만 본다.

import { readdirSync, readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const rootDir = fileURLToPath(ROOT);
const srcUrl = (rel) => new URL('src/' + rel, ROOT).href;
const srcDir = (rel) => fileURLToPath(new URL('src/' + rel, ROOT));

/* ───────────────────────────── 테스트 하네스 ───────────────────────────── */

const failures = [];
let checks = 0;
let curSection = '(init)';

function section(name) {
  curSection = name;
  process.stdout.write(`\n── ${name}\n`);
}
function ok(cond, label, detail) {
  checks++;
  if (cond) return true;
  failures.push({ section: curSection, label, detail: detail == null ? '' : String(detail) });
  process.stdout.write(`   ✗ ${label}${detail == null ? '' : ` — ${detail}`}\n`);
  return false;
}
function pass(label, extra) {
  checks++;
  process.stdout.write(`   ✓ ${label}${extra ? ` (${extra})` : ''}\n`);
}
/** 여러 개를 모아 한 줄로 보고 (첫 8개만 상세) */
function okAll(bad, label, total) {
  checks++;
  if (!bad.length) {
    process.stdout.write(`   ✓ ${label} (${total}건)\n`);
    return true;
  }
  const head = bad.slice(0, 8).join(' | ');
  failures.push({ section: curSection, label, detail: `${bad.length}건 — ${head}${bad.length > 8 ? ' …' : ''}` });
  process.stdout.write(`   ✗ ${label} — ${bad.length}건\n`);
  for (const b of bad.slice(0, 8)) process.stdout.write(`       · ${b}\n`);
  if (bad.length > 8) process.stdout.write(`       · … 외 ${bad.length - 8}건\n`);
  return false;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ───────────────────────────── 1. 모듈 로드 ───────────────────────────── */

section('모듈 import (DOM 없이)');

function listDir(rel) {
  try {
    return readdirSync(srcDir(rel))
      .filter((f) => f.endsWith('.js'))
      .sort()
      .map((f) => `${rel}/${f}`);
  } catch (e) {
    ok(false, `디렉터리 읽기 ${rel}`, e.message);
    return [];
  }
}

const MODULE_LIST = [
  ...listDir('data'),
  ...listDir('game'),
  'battle/engine.js',
  'battle/ai.js',
  'art/parts_body.js',
  'art/parts_gear.js',
  'art/parts.js',
  'art/parts_front.js',
  'art/palette.js',
  'art/spritegen.js',
  'art/fx.js',
  'core/util.js',
  'core/rng.js',
];

const M = new Map();
for (const rel of MODULE_LIST) {
  try {
    M.set(rel, await import(srcUrl(rel)));
    pass(`import ${rel}`);
  } catch (e) {
    ok(false, `import ${rel}`, `${e.name}: ${e.message}`);
  }
}
const need = (rel) => M.get(rel) || null;

// 브라우저 전역이 실제로 없는 상태에서 위 import 가 통과했다는 것이 곧 "최상위 DOM 미접근" 증명.
ok(typeof globalThis.document === 'undefined', 'document 전역이 없는 환경인지', 'node 환경 가정 위반');
ok(typeof globalThis.window === 'undefined', 'window 전역이 없는 환경인지', 'node 환경 가정 위반');

const Classes = need('data/classes.js');
const Skills = need('data/skills.js');
const Items = need('data/items.js');
const Formations = need('data/formations.js');
const Enemies = need('data/enemies.js');
const World = need('data/world.js');
const PartsBody = need('art/parts_body.js');
const PartsGear = need('art/parts_gear.js');
const Spritegen = need('art/spritegen.js');
const Merc = need('game/merc.js');
const Gear = need('game/gear.js');
const Quest = need('game/quest.js');
const Squad = need('game/squad.js');
const State = need('game/state.js');
const Engine = need('battle/engine.js');
const RngMod = need('core/rng.js');
const Sets = need('data/sets.js');
const Dungeons = need('data/dungeons.js');
const Dungeon = need('game/dungeon.js');

/* ───────────────────────────── 2. 클래스 트리 ───────────────────────────── */

section('클래스 트리');
if (Classes) {
  const CLASSES = Classes.CLASSES;
  const all = Object.values(CLASSES);
  ok(all.length === 105, '클래스 총 105종', `실제 ${all.length}종`);

  const t1 = all.filter((c) => c.tier === 1);
  const t2 = all.filter((c) => c.tier === 2);
  const t3 = all.filter((c) => c.tier === 3);
  const t4 = all.filter((c) => c.tier === 4);
  ok(t1.length === 7, '1차 7종', `실제 ${t1.length}종`);
  ok(t2.length === 14, '2차 14종', `실제 ${t2.length}종`);
  ok(t3.length === 28, '3차 28종', `실제 ${t3.length}종`);
  ok(t4.length === 56, '4차 56종', `실제 ${t4.length}종`);

  ok(Array.isArray(Classes.BASE_CLASSES) && Classes.BASE_CLASSES.length === 7,
    'BASE_CLASSES 7개', `실제 ${Classes.BASE_CLASSES?.length}`);
  okAll(
    (Classes.BASE_CLASSES || []).filter((id) => !CLASSES[id] || CLASSES[id].tier !== 1)
      .map((id) => `${id}: 1차 클래스가 아님`),
    'BASE_CLASSES 원소가 전부 1차 클래스',
    (Classes.BASE_CLASSES || []).length);

  // next 개수 — 1~3차는 정확히 2종, 4차는 트리의 끝이라 0종.
  const nextBad = [];
  for (const c of all) {
    const n = c.next;
    if (!Array.isArray(n)) { nextBad.push(`${c.id}: next 배열 아님`); continue; }
    if (c.tier === 4) {
      if (n.length !== 0) nextBad.push(`${c.id}(4차): next ${n.length}개 (0이어야 함)`);
    } else if (n.length !== 2) {
      nextBad.push(`${c.id}(${c.tier}차): next ${n.length}개 (2여야 함)`);
    }
    for (const id of n) {
      const t = CLASSES[id];
      if (!t) nextBad.push(`${c.id}.next -> '${id}' 없는 클래스`);
      else if (t.tier !== c.tier + 1) nextBad.push(`${c.id}(${c.tier}차).next -> ${id}(${t.tier}차)`);
    }
  }
  okAll(nextBad, 'next 구조(개수/차수/존재)', all.length);

  // 4차 스킬 id 규약: 4차는 [부모에게서 물려받은 스킬, `t4_<id>`] 를 갖는다.
  // (classes_t4 담당과 skills 담당이 독립적으로 이름을 정했으므로 여기서 어긋남을 잡는다.)
  const SKILLS_MAP = Skills?.SKILLS || {};
  const t4SkillBad = [];
  for (const c of t4) {
    const own = `t4_${c.id}`;
    if (!Array.isArray(c.skills) || c.skills.length !== 2) {
      t4SkillBad.push(`${c.id}: skills ${c.skills?.length}개 (2여야 함)`); continue;
    }
    if (!c.skills.includes(own)) t4SkillBad.push(`${c.id}: 전용 스킬 '${own}' 미보유 [${c.skills.join(',')}]`);
    for (const sid of c.skills) if (!SKILLS_MAP[sid]) t4SkillBad.push(`${c.id} -> 스킬 '${sid}' 없음`);
  }
  okAll(t4SkillBad, '4차 클래스 t4_<id> 스킬 규약', t4.length);

  // 모든 2·3차가 정확히 하나의 부모를 갖는지 = 트리 무결성
  const parents = new Map();
  for (const c of all) for (const n of c.next || []) {
    if (!parents.has(n)) parents.set(n, []);
    parents.get(n).push(c.id);
  }
  const parentBad = [];
  for (const c of all) {
    const p = parents.get(c.id) || [];
    if (c.tier === 1 && p.length) parentBad.push(`${c.id}(1차)에 부모 ${p.join(',')}`);
    if (c.tier > 1 && p.length !== 1) parentBad.push(`${c.id}: 부모 ${p.length}개 [${p.join(',')}]`);
  }
  okAll(parentBad, '모든 2·3차 클래스가 부모 정확히 1개', all.length);

  // 필수 필드
  const fieldBad = [];
  for (const c of all) {
    if (!Classes.ARCHETYPES[c.arch]) fieldBad.push(`${c.id}: arch '${c.arch}' 없음`);
    if (!['phys', 'magic'].includes(c.dmgType)) fieldBad.push(`${c.id}: dmgType '${c.dmgType}'`);
    if (!['melee', 'ranged'].includes(c.range)) fieldBad.push(`${c.id}: range '${c.range}'`);
    if (![1, 2].includes(c.rank)) fieldBad.push(`${c.id}: rank '${c.rank}'`);
    if (typeof c.name !== 'string' || !c.name) fieldBad.push(`${c.id}: name 없음`);
    if (typeof c.basicFx !== 'string' || !c.basicFx) fieldBad.push(`${c.id}: basicFx 없음`);
    if (!Array.isArray(c.skills) || !c.skills.length) fieldBad.push(`${c.id}: skills 비어있음`);
    if (!c.sprite || typeof c.sprite !== 'object') fieldBad.push(`${c.id}: sprite 없음`);
  }
  okAll(fieldBad, '클래스 필수 필드', all.length);

  // classChain / promoteOptions
  const chainBad = [];
  for (const c of all) {
    const chain = Classes.classChain(c.id);
    if (chain.length !== c.tier) chainBad.push(`${c.id}: classChain ${chain.length}단계 (tier ${c.tier})`);
    else if (chain[chain.length - 1].id !== c.id) chainBad.push(`${c.id}: classChain 끝이 ${chain[chain.length - 1].id}`);
    const po = Classes.promoteOptions(c.id);
    if (po.length !== (c.next || []).length) chainBad.push(`${c.id}: promoteOptions ${po.length} ≠ next ${(c.next || []).length}`);
  }
  okAll(chainBad, 'classChain / promoteOptions', all.length);
}

/* ───────────────────────────── 3. 스킬 참조 ───────────────────────────── */

section('스킬 id 참조');
if (Classes && Skills && Enemies) {
  const SKILLS = Skills.SKILLS;
  const bad = [];
  for (const c of Object.values(Classes.CLASSES)) {
    for (const sid of c.skills || []) if (!SKILLS[sid]) bad.push(`클래스 ${c.id} -> '${sid}'`);
  }
  for (const e of Object.values(Enemies.ENEMIES)) {
    for (const sid of e.skills || []) if (!SKILLS[sid]) bad.push(`적 ${e.id} -> '${sid}'`);
  }
  okAll(bad, '모든 skills id 가 SKILLS 에 존재',
    Object.keys(Classes.CLASSES).length + Object.keys(Enemies.ENEMIES).length);

  // 스킬 자체 스키마
  const TARGETS = ['enemy', 'ally', 'self', 'allEnemy', 'allAlly'];
  const SELECTS = ['front', 'back', 'lowestHp', 'highestAtk', 'random', 'self', 'lowestHpAlly'];
  const DMG = ['phys', 'magic', 'none'];
  const RANGE = ['melee', 'ranged'];
  // SPEC §3.1 의 부가효과 어휘 = battle/engine.js applyEffect 가 실제로 처리하는 전부.
  const EFF = ['heal', 'buff', 'debuff', 'dot', 'shield', 'stun', 'lifesteal'];
  const sbad = [];
  for (const [id, s] of Object.entries(SKILLS)) {
    if (s.id !== id) sbad.push(`${id}: s.id='${s.id}' 불일치`);
    if (typeof s.name !== 'string' || !s.name) sbad.push(`${id}: name 없음`);
    if (!isNum(s.cd) || s.cd < 0) sbad.push(`${id}: cd=${s.cd}`);
    if (!isNum(s.power) || s.power < 0) sbad.push(`${id}: power=${s.power}`);
    if (!DMG.includes(s.dmgType)) sbad.push(`${id}: dmgType='${s.dmgType}'`);
    if (!TARGETS.includes(s.target)) sbad.push(`${id}: target='${s.target}'`);
    if (!SELECTS.includes(s.select)) sbad.push(`${id}: select='${s.select}'`);
    if (!RANGE.includes(s.range)) sbad.push(`${id}: range='${s.range}'`);
    if (!isNum(s.count) || s.count < 1) sbad.push(`${id}: count=${s.count}`);
    if (typeof s.fx !== 'string' || !s.fx) sbad.push(`${id}: fx 없음`);
    for (const e of s.effects || []) {
      if (!EFF.includes(e.type)) sbad.push(`${id}: effect type='${e.type}'`);
      if (e.type === 'buff' || e.type === 'debuff') {
        if (!isNum(e.amount)) sbad.push(`${id}: ${e.type} amount=${e.amount}`);
        if (typeof e.stat !== 'string') sbad.push(`${id}: ${e.type} stat 없음`);
      }
    }
    if (typeof Skills.getSkill === 'function' && Skills.getSkill(id) !== s) sbad.push(`${id}: getSkill 반환 불일치`);
  }
  okAll(sbad, 'SKILLS 스키마', Object.keys(SKILLS).length);
}

/* ───────────────────────────── 4. 스프라이트 파츠 ───────────────────────────── */

section('파츠 무결성 / 스프라이트 레시피');
let PARTS = null;
if (PartsBody && PartsGear) {
  PARTS = { ...PartsBody.BODY_PARTS, ...PartsGear.GEAR_PARTS };
  const names = Object.keys(PARTS);
  ok(names.length > 0, 'PARTS 비어있지 않음');

  const bad = [];
  for (const [name, p] of Object.entries(PARTS)) {
    if (!p || !Array.isArray(p.px)) { bad.push(`${name}: px 배열 없음`); continue; }
    if (!isNum(p.w) || p.w < 1) { bad.push(`${name}: w=${p.w}`); continue; }
    if (!isNum(p.h) || p.h < 1) { bad.push(`${name}: h=${p.h}`); continue; }
    if (p.px.length !== p.h) bad.push(`${name}: 행 ${p.px.length}개 ≠ h=${p.h}`);
    for (let i = 0; i < p.px.length; i++) {
      if (typeof p.px[i] !== 'string') { bad.push(`${name}: ${i}행이 문자열 아님`); break; }
      if (p.px[i].length !== p.w) { bad.push(`${name}: ${i}행 길이 ${p.px[i].length} ≠ w=${p.w}`); break; }
    }
    if (!isNum(p.ax) || !isNum(p.ay)) bad.push(`${name}: 앵커(ax,ay) 없음/비숫자`);
    /* ★ 앵커는 «그림 안의 한 점» 이 아니라 **조인트에 맞출 기준 오프셋**이다.
     *   파츠 밖에 있어도 된다 — 예를 들어 짧은 머리카락은 목(앵커)보다 위에서 끝나므로
     *   ay 가 h 보다 크다. 그래야 «턱 위에서 끝나는 머리» 를 표현할 수 있다.
     *   다만 완전히 엉뚱한 값(수백 px)은 대개 크기를 바꾸고 앵커를 안 고친 실수라
     *   파츠 크기의 두 배까지만 허용한다. */
    else if (p.ax < -p.w || p.ax > p.w * 2 || p.ay < -p.h || p.ay > p.h * 2) {
      bad.push(`${name}: 앵커(${p.ax},${p.ay})가 파츠(${p.w}×${p.h})에서 너무 멀다 — 크기를 바꾸고 앵커를 안 고쳤나`);
    }
  }
  okAll(bad, '파츠 행렬/앵커 무결성', names.length);

  // 문자 팔레트 어휘
  const Palette = need('art/palette.js');
  if (Palette) {
    const allowed = new Set(Palette.PIX_CHARS);
    const cbad = [];
    for (const [name, p] of Object.entries(PARTS)) {
      const seen = new Set();
      for (const row of p.px || []) for (const ch of String(row)) if (!allowed.has(ch)) seen.add(ch);
      if (seen.size) cbad.push(`${name}: 미정의 문자 [${[...seen].join('')}]`);
    }
    okAll(cbad, '파츠 픽셀 문자가 PIX_CHARS 안에 있음', names.length);
  }

  // SPEC §4.4 어휘 전부 정의되어 있는지
  const Parts = need('art/parts.js');
  if (Parts) {
    const missing = Parts.PART_VOCAB.filter((n) => !n.endsWith('_none') && !PARTS[n]);
    okAll(missing.map((n) => `${n} 미정의`), 'SPEC §4.4 어휘 전부 구현', Parts.PART_VOCAB.length);
    const extra = Object.keys(PARTS).filter((n) => !Parts.PART_VOCAB.includes(n));
    okAll(extra.map((n) => `${n}: 어휘 목록에 없음`), 'PARTS 에 어휘 외 파츠 없음', names.length);
  }
}

// 클래스/적 sprite 파츠 이름 검증
if (PARTS && Classes && Enemies) {
  const SLOT_KEYS = ['body', 'head', 'hair', 'helm', 'armor', 'cape', 'weapon', 'offhand'];
  const bad = [];
  const checkRecipe = (who, sp) => {
    if (!sp) { bad.push(`${who}: sprite 없음`); return; }
    for (const k of SLOT_KEYS) {
      const v = sp[k];
      if (v == null) { bad.push(`${who}.${k}: 없음`); continue; }
      if (typeof v !== 'string') { bad.push(`${who}.${k}: 문자열 아님`); continue; }
      if (v.endsWith('_none')) continue;
      if (!PARTS[v]) bad.push(`${who}.${k}: '${v}' PARTS 에 없음`);
    }
    if (!sp.palette || typeof sp.palette !== 'object') bad.push(`${who}: palette 없음`);
  };
  for (const c of Object.values(Classes.CLASSES)) checkRecipe(`클래스 ${c.id}`, c.sprite);
  for (const e of Object.values(Enemies.ENEMIES)) checkRecipe(`적 ${e.id}`, e.sprite);
  okAll(bad, '모든 sprite 파츠 이름이 PARTS 에 존재',
    Object.keys(Classes.CLASSES).length + Object.keys(Enemies.ENEMIES).length);

  // 팔레트 키가 palette.js 사전에 있는지
  const Palette = need('art/palette.js');
  if (Palette) {
    const SETS = Palette.PALETTE_SETS;
    const map = { skin: SETS.SKIN, hair: SETS.HAIR, metal: SETS.METAL, cloth: SETS.CLOTH, leather: SETS.LEATHER, glow: SETS.GLOW };
    const pbad = [];
    const checkPal = (who, pal) => {
      if (!pal) return;
      for (const [k, dict] of Object.entries(map)) {
        if (pal[k] != null && !dict[pal[k]]) pbad.push(`${who}.palette.${k}='${pal[k]}' 미정의`);
      }
      if (pal.accent != null && !SETS.METAL[pal.accent] && !SETS.CLOTH[pal.accent]) {
        pbad.push(`${who}.palette.accent='${pal.accent}' 미정의`);
      }
    };
    for (const c of Object.values(Classes.CLASSES)) checkPal(`클래스 ${c.id}`, c.sprite?.palette);
    for (const e of Object.values(Enemies.ENEMIES)) checkPal(`적 ${e.id}`, e.sprite?.palette);
    okAll(pbad, '스프라이트 팔레트 키가 palette.js 사전에 존재',
      Object.keys(Classes.CLASSES).length + Object.keys(Enemies.ENEMIES).length);
  }
}

// spritegen: DOM 없이 import 되고, POSES/FRAMES 정합성
if (Spritegen) {
  const bad = [];
  for (const f of Spritegen.FRAMES) if (!Spritegen.POSES[f]) bad.push(`POSES['${f}'] 없음`);
  okAll(bad, 'FRAMES 전부에 대응하는 POSE 존재', Spritegen.FRAMES.length);
  /* ★ 숫자를 못박지 않는다 — 해상도는 SCALE 로 올린다(HANDOFF §50).
   *   못박으면 배율을 올릴 때마다 여기만 고쳐 «통과» 시키게 돼 아무것도 안 지킨다.
   *   지켜야 할 것은 **좌표계가 한 배율로 같이 움직였는가** 다:
   *   조인트 하나만 안 곱해져도 팔이 몸에서 떨어지는데, 그건 눈으로 봐야 보인다. */
  const S = Spritegen.SCALE;
  ok(S >= 1 && Number.isInteger(S), '스프라이트 배율은 정수배다 (반 픽셀이 생기면 안 된다)', `SCALE=${S}`);
  ok(Spritegen.SPRITE_W === 32 * S && Spritegen.SPRITE_H === 40 * S,
    '스프라이트 규격이 배율을 따른다', `${Spritegen.SPRITE_W}x${Spritegen.SPRITE_H} (기대 ${32 * S}x${40 * S})`);
  ok(Spritegen.FOOT_Y === 38 * S && Spritegen.ROT_PIVOT.y === 26 * S && Spritegen.SHIELD_OFFSET.x === 8 * S,
    '발밑·회전축·방패도 같은 배율을 탄다',
    `FOOT_Y=${Spritegen.FOOT_Y} pivot.y=${Spritegen.ROT_PIVOT.y} shield.x=${Spritegen.SHIELD_OFFSET.x}`);
  /* ★ 조인트 값을 못박지 않는다 — 파츠를 다시 그리면서 목을 세우고 다리를 뽑느라 실제로 바뀌었다.
   *   지켜야 할 것은 «**전부** 같은 배율을 탔는가» 다. 하나만 안 곱해지면 팔이 몸에서 떨어진다. */
  {
    const jbad = Object.keys(Spritegen.JOINT_BASE).filter((k) => {
      const b = Spritegen.JOINT_BASE[k], j = Spritegen.JOINTS[k];
      return !j || j.x !== Math.round(b.x * S) || j.y !== Math.round(b.y * S);
    }).map((k) => `JOINTS.${k} 가 배율을 안 탔다`);
    okAll(jbad, '조인트가 전부 같은 배율을 탄다', Object.keys(Spritegen.JOINT_BASE).length);
    ok(Spritegen.JOINTS.head.x === Spritegen.SPRITE_W / 2, '머리 조인트가 가로 중심에 있다',
      `head.x=${Spritegen.JOINTS.head.x} 중심=${Spritegen.SPRITE_W / 2}`);
  }
  // 발밑 높이는 화면 좌표라 SCALE 과 무관해야 한다 — 여기가 어긋나면 체력바가 머리 위로 날아간다
  ok(Spritegen.spriteFootPx(3) === 38 * 3, '발밑 높이는 SCALE 과 무관하게 논리 좌표를 지킨다',
    `spriteFootPx(3)=${Spritegen.spriteFootPx(3)} (기대 ${38 * 3})`);
  // 포즈 오프셋은 픽셀이라 배율을 타고, alpha 는 비율이라 타면 안 된다
  {
    const walk = Spritegen.POSES.walk1;
    const allMul = Object.values(Spritegen.POSES).every((q) => q.dx % S === 0 && q.dy % S === 0);
    ok(allMul && walk && walk.alpha === 1, '포즈 오프셋은 배율을 타고 alpha 는 안 탄다',
      `walk1.dy=${walk && walk.dy} alpha=${walk && walk.alpha}`);
  }
  // 파츠가 실제로 같은 배율로 승격돼 나오는가 — 여기가 어긋나면 몸만 작아진다
  if (PARTS && typeof PARTS.getPart === 'function') {
    const body = PARTS.getPart('body_normal');
    ok(body && body.px.length === body.h && body.px.every((r) => r.length === body.w),
      '승격된 파츠의 w/h 가 픽셀과 맞는다', body ? `${body.w}x${body.h}` : '없음');
  }
  const jbad = ['head', 'chest', 'pelvis', 'shBack', 'shFront', 'handBack', 'handFront', 'hipBack', 'hipFront']
    .filter((k) => !Spritegen.JOINTS[k]).map((k) => `JOINTS.${k} 없음`);
  okAll(jbad, 'JOINTS 필수 키', 9);
  // 회전 유틸은 순수 함수여야 한다 (DOM 없이 동작)
  if (PARTS && typeof Spritegen.rotateMatrix === 'function') {
    try {
      const r = Spritegen.rotateMatrix(PARTS.wpn_sword || Object.values(PARTS)[0], 45);
      ok(!!r && Array.isArray(r.px) && r.px.length === r.h, 'rotateMatrix 가 DOM 없이 동작');
    } catch (e) {
      ok(false, 'rotateMatrix 가 DOM 없이 동작', e.message);
    }
  }
}

/* ───────────────────────────── 5. 장비 타입 ───────────────────────────── */

section('무기 타입 / 아이템 베이스');
if (Classes && Items) {
  const WT = Items.WEAPON_TYPES;
  const bad = [];
  for (const c of Object.values(Classes.CLASSES)) {
    if (!Array.isArray(c.equip) || !c.equip.length) { bad.push(`${c.id}: equip 비어있음`); continue; }
    for (const w of c.equip) if (!WT[w]) bad.push(`${c.id}.equip -> '${w}' WEAPON_TYPES 에 없음`);
  }
  okAll(bad, '클래스 equip 무기타입이 WEAPON_TYPES 에 존재', Object.keys(Classes.CLASSES).length);

  // 모든 무기 타입에 최소 1개의 베이스가 있어야 한다 (장비 롤이 막히지 않도록).
  // ★ 설계 A: 방패(shield)는 weapon 이 아니라 offhand 슬롯이다 — WEAPON_TYPES[t].slot 을 따른다.
  const HAND_SLOTS = ['weapon', 'offhand'];
  const haveBase = new Set(Items.ITEM_BASES.filter((b) => HAND_SLOTS.includes(b.slot)).map((b) => b.weaponType));
  okAll(Object.keys(WT).filter((w) => !haveBase.has(w)).map((w) => `무기타입 '${w}' 의 베이스 아이템 없음`),
    '모든 무기 타입에 베이스 아이템 존재', Object.keys(WT).length);

  const bbad = [];
  const ids = new Set();
  const BASE_SLOTS = [...Items.SLOTS, 'ring'];
  for (const b of Items.ITEM_BASES) {
    if (!b.id) { bbad.push('id 없는 베이스'); continue; }
    if (ids.has(b.id)) bbad.push(`${b.id}: id 중복`);
    ids.add(b.id);
    // 설계 A: 10슬롯 + 반지 두 칸이 공유하는 'ring' 베이스 풀
    if (!BASE_SLOTS.includes(b.slot)) bbad.push(`${b.id}: slot='${b.slot}'`);
    if (b.slot === 'weapon' && !WT[b.weaponType]) bbad.push(`${b.id}: weaponType='${b.weaponType}'`);
    if (b.slot === 'offhand' && b.weaponType && !WT[b.weaponType]) bbad.push(`${b.id}: weaponType='${b.weaponType}'`);
    if (!isNum(b.minLv) || b.minLv < 1) bbad.push(`${b.id}: minLv=${b.minLv}`);
    if (!b.stats || typeof b.stats !== 'object') bbad.push(`${b.id}: stats 없음`);
    else for (const [k, v] of Object.entries(b.stats)) if (!isNum(v)) bbad.push(`${b.id}.stats.${k}=${v}`);
  }
  okAll(bbad, 'ITEM_BASES 스키마', Items.ITEM_BASES.length);

  // 모든 슬롯에 대해 basesFor 가 항상 후보를 돌려주는지
  const fbad = [];
  const FOR_SLOTS = [...Items.SLOTS, 'armor', 'accessory'];   // 옛 슬롯 별칭도 살아 있어야 한다
  for (const slot of FOR_SLOTS) {
    for (let lv = 1; lv <= 60; lv += 1) {
      const list = Items.basesFor(slot, lv);
      if (!Array.isArray(list) || !list.length) fbad.push(`basesFor('${slot}', ${lv}) 비어있음`);
    }
  }
  okAll(fbad, 'basesFor 가 1~60 모든 레벨에서 후보 반환', FOR_SLOTS.length * 60);
}

/* ───────────────────────────── 6. 진형 ───────────────────────────── */

section('진형');
if (Formations) {
  const list = Object.values(Formations.FORMATIONS);
  ok(list.length >= 8, '진형 8종 이상', `실제 ${list.length}종`);

  const MIN_DIST = 0.12;
  const bad = [];
  for (const f of list) {
    if (!Array.isArray(f.slots)) { bad.push(`${f.id}: slots 없음`); continue; }
    if (f.slots.length !== 7) bad.push(`${f.id}: 슬롯 ${f.slots.length}개 (7이어야 함)`);
    for (let i = 0; i < f.slots.length; i++) {
      const s = f.slots[i];
      if (!s || !isNum(s.x) || !isNum(s.y)) { bad.push(`${f.id}[${i}]: x/y 없음`); continue; }
      if (s.x < 0 || s.x > 1) bad.push(`${f.id}[${i}]: x=${s.x} 범위 밖`);
      if (s.y < 0 || s.y > 1) bad.push(`${f.id}[${i}]: y=${s.y} 범위 밖`);
    }
    for (let i = 0; i < f.slots.length; i++) {
      for (let j = i + 1; j < f.slots.length; j++) {
        const a = f.slots[i]; const b = f.slots[j];
        if (!a || !b || !isNum(a.x) || !isNum(b.x)) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < MIN_DIST - 1e-9) bad.push(`${f.id}: 슬롯 ${i}-${j} 거리 ${d.toFixed(3)} < ${MIN_DIST}`);
      }
    }
    if (f.id == null) bad.push('id 없는 진형');
    if (typeof f.name !== 'string' || !f.name) bad.push(`${f.id}: name 없음`);
    if (!isNum(f.cost) || f.cost < 0) bad.push(`${f.id}: cost=${f.cost}`);
    if (![1, 2, 3].includes(f.tier)) bad.push(`${f.id}: tier=${f.tier}`);
    if (typeof f.source !== 'string' || !f.source) bad.push(`${f.id}: source 없음`);
    if (!Array.isArray(f.effects)) bad.push(`${f.id}: effects 배열 아님`);
    for (const e of f.effects || []) {
      if (typeof e.scope !== 'string') bad.push(`${f.id}: effect scope 없음`);
      if (!e.mods || typeof e.mods !== 'object') bad.push(`${f.id}: effect mods 없음`);
      else for (const [k, v] of Object.entries(e.mods)) if (!isNum(v)) bad.push(`${f.id}: mods.${k}=${v}`);
    }
  }
  okAll(bad, '진형 슬롯/필드 무결성', list.length);

  // formationMods 가 모든 슬롯 x 모든 아키타입에서 유한값만 돌려주는지
  const archNames = Classes ? Object.keys(Classes.ARCHETYPES) : ['fighter'];
  const mbad = [];
  for (const f of list) {
    for (let i = 0; i < 7; i++) {
      for (const arch of archNames) {
        let mods;
        try { mods = Formations.formationMods(f, i, { arch, classId: 'swordsman' }); } catch (e) {
          mbad.push(`${f.id}[${i}] ${arch}: throw ${e.message}`); continue;
        }
        if (!mods || typeof mods !== 'object') { mbad.push(`${f.id}[${i}] ${arch}: 객체 아님`); continue; }
        for (const [k, v] of Object.entries(mods)) if (!isNum(v)) mbad.push(`${f.id}[${i}] ${arch}: ${k}=${v}`);
      }
    }
  }
  okAll(mbad, 'formationMods 유한값 반환', list.length * 7 * archNames.length);

  okAll(Object.entries(Formations.FORMATIONS).filter(([k, f]) => f.id !== k).map(([k, f]) => `키 '${k}' ≠ id '${f.id}'`),
    'FORMATIONS 키와 id 일치', list.length);
  okAll(list.filter((f) => Formations.getFormation(f.id) !== f).map((f) => `getFormation('${f.id}') 불일치`),
    'getFormation 조회', list.length);
}

/* ───────────────────────────── 7. 월드 그래프 ───────────────────────────── */

section('월드 (도시/도로망)');
if (World) {
  const CITIES = World.CITIES;
  ok(CITIES.length >= 12 && CITIES.length <= 16, '도시 12~16개', `실제 ${CITIES.length}개`);
  ok(World.REGIONS.length >= 6 && World.REGIONS.length <= 8, '지역 6~8개', `실제 ${World.REGIONS.length}개`);
  ok(!!World.getCity(World.START_CITY), 'START_CITY 가 실재하는 도시', World.START_CITY);

  const cbad = [];
  const regionIds = new Set(World.REGIONS.map((r) => r.id));
  const BIOMES = ['plains', 'forest', 'mountain', 'desert', 'swamp', 'coast', 'tundra', 'cave'];
  for (const r of World.REGIONS) {
    if (!BIOMES.includes(r.biome)) cbad.push(`지역 ${r.id}: biome='${r.biome}'`);
    if (!(r.tier >= 1 && r.tier <= 5)) cbad.push(`지역 ${r.id}: tier=${r.tier}`);
  }
  for (const c of CITIES) {
    if (!regionIds.has(c.regionId)) cbad.push(`${c.id}: regionId='${c.regionId}' 없음`);
    if (!(c.tier >= 1 && c.tier <= 5)) cbad.push(`${c.id}: tier=${c.tier}`);
    if (!(c.x >= 0 && c.x <= 1000)) cbad.push(`${c.id}: x=${c.x} 범위 밖(0~1000)`);
    if (!(c.y >= 0 && c.y <= 700)) cbad.push(`${c.id}: y=${c.y} 범위 밖(0~700)`);
    if (!Array.isArray(c.services) || !c.services.length) cbad.push(`${c.id}: services 비어있음`);
    for (const s of c.services || []) {
      if (!['tavern', 'shop', 'guild', 'smith'].includes(s)) cbad.push(`${c.id}: 알 수 없는 service '${s}'`);
    }
  }
  okAll(cbad, '도시/지역 필드', CITIES.length + World.REGIONS.length);

  // 양방향 링크
  const lbad = [];
  for (const c of CITIES) {
    if (!Array.isArray(c.links) || !c.links.length) { lbad.push(`${c.id}: links 없음`); continue; }
    for (const l of c.links) {
      const other = World.getCity(l.to);
      if (!other) { lbad.push(`${c.id} -> '${l.to}' 없는 도시`); continue; }
      if (l.to === c.id) { lbad.push(`${c.id}: 자기 자신 링크`); continue; }
      if (!isNum(l.days) || l.days <= 0) lbad.push(`${c.id}->${l.to}: days=${l.days}`);
      const back = other.links.find((x) => x.to === c.id);
      if (!back) lbad.push(`${c.id}->${l.to} 의 역방향 링크 없음`);
      else if (back.days !== l.days) lbad.push(`${c.id}<->${l.to}: days 비대칭 (${l.days} vs ${back.days})`);
    }
  }
  okAll(lbad, '모든 links 양방향 + days 대칭', CITIES.length);

  // 연결성
  const seen = new Set([World.START_CITY]);
  const queue = [World.START_CITY];
  while (queue.length) {
    const cur = queue.shift();
    for (const l of World.getCity(cur)?.links || []) {
      if (!seen.has(l.to)) { seen.add(l.to); queue.push(l.to); }
    }
  }
  okAll(CITIES.filter((c) => !seen.has(c.id)).map((c) => `${c.id} 도달 불가`),
    '그래프 연결성 (START_CITY 에서 전부 도달)', CITIES.length);

  // pathBetween 전 쌍
  const pbad = [];
  for (const a of CITIES) {
    for (const b of CITIES) {
      const p = World.pathBetween(a.id, b.id);
      if (!Array.isArray(p) || !p.length) { pbad.push(`${a.id}->${b.id}: 경로 없음`); continue; }
      if (p[0] !== a.id || p[p.length - 1] !== b.id) { pbad.push(`${a.id}->${b.id}: 경로 끝점 [${p[0]},${p[p.length - 1]}]`); continue; }
      let d = 0;
      let broken = false;
      for (let i = 0; i + 1 < p.length; i++) {
        const days = World.linkDays(p[i], p[i + 1]);
        if (days == null) { pbad.push(`${a.id}->${b.id}: ${p[i]}-${p[i + 1]} 직접 연결 아님`); broken = true; break; }
        d += days;
      }
      if (broken) continue;
      const td = World.travelDays(a.id, b.id);
      if (!isNum(td)) pbad.push(`${a.id}->${b.id}: travelDays=${td}`);
      else if (Math.abs(td - d) > 1e-9) pbad.push(`${a.id}->${b.id}: travelDays ${td} ≠ 경로합 ${d}`);
    }
  }
  okAll(pbad, 'pathBetween 이 모든 쌍에서 유효 경로 반환', CITIES.length * CITIES.length);
}

/* ───────────────────────────── 8. 적 데이터 ───────────────────────────── */

section('적 템플릿');
if (Enemies) {
  const list = Object.values(Enemies.ENEMIES);
  ok(list.length >= 30, '적 30종 이상', `실제 ${list.length}종`);
  ok(list.filter((e) => e.boss).length >= 5, '보스 5종 이상', `실제 ${list.filter((e) => e.boss).length}종`);

  const BIOMES = ['plains', 'forest', 'mountain', 'desert', 'swamp', 'coast', 'tundra', 'cave', 'any'];
  const bad = [];
  for (const e of list) {
    if (Classes && !Classes.ARCHETYPES[e.arch]) bad.push(`${e.id}: arch='${e.arch}'`);
    if (!['phys', 'magic'].includes(e.dmgType)) bad.push(`${e.id}: dmgType='${e.dmgType}'`);
    if (!['melee', 'ranged'].includes(e.range)) bad.push(`${e.id}: range='${e.range}'`);
    if (!(e.tier >= 1 && e.tier <= 5)) bad.push(`${e.id}: tier=${e.tier}`);
    if (!Array.isArray(e.biome) || !e.biome.length) bad.push(`${e.id}: biome 비어있음`);
    for (const b of e.biome || []) if (!BIOMES.includes(b)) bad.push(`${e.id}: biome '${b}'`);
    if (!isNum(e.expMul) || e.expMul <= 0) bad.push(`${e.id}: expMul=${e.expMul}`);
    if (!isNum(e.goldMul) || e.goldMul <= 0) bad.push(`${e.id}: goldMul=${e.goldMul}`);
    for (const [k, v] of Object.entries(e.mods || {})) if (!isNum(v)) bad.push(`${e.id}: mods.${k}=${v}`);
  }
  okAll(bad, '적 필수 필드', list.length);

  // enemiesFor 가 모든 (biome, tier) 조합에서 비지 않은 풀을 반환
  const ebad = [];
  for (const biome of BIOMES.filter((b) => b !== 'any')) {
    for (let t = 1; t <= 5; t++) {
      for (const boss of [false, true]) {
        const pool = Enemies.enemiesFor(biome, t, { boss });
        if (!Array.isArray(pool) || !pool.length) ebad.push(`enemiesFor('${biome}',${t},boss=${boss}) 비어있음`);
      }
    }
  }
  okAll(ebad, 'enemiesFor 가 모든 지형/티어에서 후보 반환', 8 * 5 * 2);

  // buildEnemySquad
  if (RngMod && Formations) {
    const r = new RngMod.RNG(4242);
    const sbad = [];
    for (const biome of BIOMES.filter((b) => b !== 'any')) {
      for (let t = 1; t <= 5; t++) {
        for (let n = 0; n < 6; n++) {
          const q = { biome, tier: t, level: t * 10, count: 1 + (n % 7), boss: n === 5 };
          let sq;
          try { sq = Enemies.buildEnemySquad(q, r); } catch (e) { sbad.push(`${biome}/${t}: throw ${e.message}`); continue; }
          if (!sq || !Array.isArray(sq.units) || !sq.units.length) { sbad.push(`${biome}/${t}: units 비어있음`); continue; }
          if (!Formations.getFormation(sq.formationId)) sbad.push(`${biome}/${t}: formationId='${sq.formationId}' 없음`);
          const used = new Set();
          for (const u of sq.units) {
            if (!Enemies.getEnemy(u.enemyId)) sbad.push(`${biome}/${t}: enemyId='${u.enemyId}' 없음`);
            if (!isNum(u.level) || u.level < 1) sbad.push(`${biome}/${t}: level=${u.level}`);
            if (!Number.isInteger(u.slotIndex) || u.slotIndex < 0 || u.slotIndex > 6) sbad.push(`${biome}/${t}: slotIndex=${u.slotIndex}`);
            if (used.has(u.slotIndex)) sbad.push(`${biome}/${t}: slotIndex ${u.slotIndex} 중복`);
            used.add(u.slotIndex);
          }
          if (sq.units.length > 7) sbad.push(`${biome}/${t}: 유닛 ${sq.units.length}명 (7 초과)`);
        }
      }
    }
    okAll(sbad, 'buildEnemySquad 결과 유효', 8 * 5 * 6);
  }
}

/* ───────────────────────────── 9. 아이템 롤링 ───────────────────────────── */

section('아이템 롤링 (rollItem 500회)');
if (Gear && Items && Merc && RngMod) {
  const STAT_KEYS = Merc.STAT_KEYS;
  const statSet = new Set(STAT_KEYS);
  const r = new RngMod.RNG(20260727);
  const bad = [];
  const baseIds = new Set(Items.ITEM_BASES.map((b) => b.id));
  let rarityHit = new Set();
  for (let i = 0; i < 500; i++) {
    const ilvl = 1 + (i % 55);
    let it;
    try {
      it = Gear.rollItem({ ilvl, rarityBonus: (i % 7) * 0.1, rng: r });
    } catch (e) {
      bad.push(`#${i} throw: ${e.message}`);
      continue;
    }
    if (!it) { bad.push(`#${i}: null 반환`); continue; }
    const tag = `#${i}(${it.baseId})`;
    if (typeof it.uid !== 'string' || !it.uid) bad.push(`${tag}: uid 없음`);
    if (!baseIds.has(it.baseId)) bad.push(`${tag}: baseId 미상`);
    if (typeof it.name !== 'string' || !it.name.trim()) bad.push(`${tag}: name 비어있음`);
    // 설계 A: 10슬롯 + 반지 풀('ring'). 왼손(offhand)은 weaponType 을 가질 수 있다(방패/보조검).
    if (![...Items.SLOTS, 'ring'].includes(it.slot)) bad.push(`${tag}: slot='${it.slot}'`);
    if (it.slot === 'weapon' && !Items.WEAPON_TYPES[it.weaponType]) bad.push(`${tag}: weaponType='${it.weaponType}'`);
    if (!['weapon', 'offhand'].includes(it.slot) && it.weaponType != null) bad.push(`${tag}: 손 슬롯이 아닌데 weaponType='${it.weaponType}'`);
    if (!Number.isInteger(it.rarity) || it.rarity < 0 || it.rarity > 4) bad.push(`${tag}: rarity=${it.rarity}`);
    else rarityHit.add(it.rarity);
    if (!isNum(it.ilvl) || it.ilvl < 1) bad.push(`${tag}: ilvl=${it.ilvl}`);
    if (!isNum(it.value) || it.value <= 0) bad.push(`${tag}: value=${it.value}`);
    if (!it.stats || typeof it.stats !== 'object') { bad.push(`${tag}: stats 없음`); continue; }
    if (!Object.keys(it.stats).length) bad.push(`${tag}: stats 비어있음`);
    for (const [k, v] of Object.entries(it.stats)) {
      if (!statSet.has(k)) bad.push(`${tag}: 알 수 없는 스탯 '${k}'`);
      if (!isNum(v)) bad.push(`${tag}: stats.${k}=${v}`);
    }
    if (!Array.isArray(it.affixes)) bad.push(`${tag}: affixes 배열 아님`);
    else {
      if (!it.unique && it.affixes.length > it.rarity) bad.push(`${tag}: 접사 ${it.affixes.length}개 > rarity ${it.rarity}`);
      for (const af of it.affixes) {
        if (typeof af.name !== 'string') bad.push(`${tag}: 접사 name 없음`);
        for (const [k, v] of Object.entries(af.stats || {})) {
          if (!statSet.has(k)) bad.push(`${tag}: 접사 스탯 '${k}'`);
          if (!isNum(v)) bad.push(`${tag}: 접사 ${k}=${v}`);
        }
      }
    }
    const st = Gear.itemStats(it);
    for (const [k, v] of Object.entries(st)) if (!isNum(v)) bad.push(`${tag}: itemStats.${k}=${v}`);
    if (!isNum(Gear.itemPower(it))) bad.push(`${tag}: itemPower 비정상`);
    if (!isNum(Gear.sellPrice(it)) || Gear.sellPrice(it) < 1) bad.push(`${tag}: sellPrice 비정상`);
  }
  okAll(bad, 'rollItem 500회 결과 전부 유효', 500);
  ok(rarityHit.size >= 3, '희귀도 분포가 최소 3종 이상 등장', `실제 ${[...rarityHit].sort().join(',')}`);

  // 슬롯/무기타입 지정 롤도 지정대로 나오는지
  const dbad = [];
  for (const wt of Object.keys(Items.WEAPON_TYPES)) {
    const want = Items.WEAPON_TYPES[wt].slot || 'weapon';   // shield 만 'offhand'
    for (let k = 0; k < 4; k++) {
      const it = Gear.rollItem({ ilvl: 1 + k * 15, slot: want, weaponType: wt, rng: r });
      if (!it) { dbad.push(`${wt}: null`); continue; }
      if (it.slot !== want) dbad.push(`${wt}: slot='${it.slot}' (기대 '${want}')`);
      if (it.weaponType !== wt) dbad.push(`${wt}: weaponType='${it.weaponType}'`);
    }
  }
  okAll(dbad, '무기타입 지정 롤이 지정대로 나옴', Object.keys(Items.WEAPON_TYPES).length * 4);
}

/* ───────────────────────────── 10. 용병 스탯 ───────────────────────────── */

section('용병 생성/스탯 (49 클래스 x 7 등급)');
if (Merc && Classes && RngMod) {
  const grades = Merc.GRADES;
  const classIds = Object.keys(Classes.CLASSES);
  const r = new RngMod.RNG(99991);
  const bad = [];
  const spriteBad = [];
  const STAT_KEYS = Merc.STAT_KEYS;
  let n = 0;
  for (const cid of classIds) {
    for (const g of grades) {
      for (const lv of [1, 15, 35, 60]) {
        n++;
        let m;
        try { m = Merc.createMerc({ classId: cid, grade: g, level: lv, rng: r }); } catch (e) {
          bad.push(`${cid}/${g}/${lv}: createMerc throw ${e.message}`); continue;
        }
        if (!m) { bad.push(`${cid}/${g}/${lv}: null`); continue; }
        if (m.classId !== cid) bad.push(`${cid}/${g}/${lv}: classId='${m.classId}'`);
        if (m.grade !== g) bad.push(`${cid}/${g}/${lv}: grade='${m.grade}'`);
        if (m.level !== lv) bad.push(`${cid}/${g}/${lv}: level=${m.level}`);
        if (!isNum(m.upkeep) || m.upkeep < 0) bad.push(`${cid}/${g}/${lv}: upkeep=${m.upkeep}`);
        if (typeof m.name !== 'string' || !m.name.trim()) bad.push(`${cid}/${g}/${lv}: name 비어있음`);
        let s;
        try { s = Merc.mercStats(m, null); } catch (e) {
          bad.push(`${cid}/${g}/${lv}: mercStats throw ${e.message}`); continue;
        }
        for (const k of STAT_KEYS) {
          if (!isNum(s[k])) bad.push(`${cid}/${g}/${lv}: ${k}=${s[k]}`);
        }
        if (isNum(s.hp) && s.hp < 1) bad.push(`${cid}/${g}/${lv}: hp=${s.hp}`);
        if (isNum(s.spd) && s.spd < 1) bad.push(`${cid}/${g}/${lv}: spd=${s.spd}`);
        if (!isNum(m.hp) || m.hp < 1) bad.push(`${cid}/${g}/${lv}: 현재 hp=${m.hp}`);
        if (!isNum(Merc.mercPower(m, null))) bad.push(`${cid}/${g}/${lv}: mercPower 비정상`);
        if (!isNum(Merc.hireCost(cid, g, lv))) bad.push(`${cid}/${g}/${lv}: hireCost 비정상`);

        // 스프라이트 레시피가 실재 파츠만 참조하는지
        if (PARTS && lv === 1) {
          const rec = Merc.mercSprite(m, null);
          if (!rec) spriteBad.push(`${cid}/${g}: mercSprite null`);
          else {
            for (const key of ['body', 'head', 'hair', 'helm', 'armor', 'cape', 'weapon', 'offhand']) {
              const v = rec[key];
              if (typeof v !== 'string') { spriteBad.push(`${cid}/${g}.${key}: 문자열 아님`); continue; }
              if (v.endsWith('_none')) continue;
              if (!PARTS[v]) spriteBad.push(`${cid}/${g}.${key}='${v}' PARTS 에 없음`);
            }
            if (!rec.palette) spriteBad.push(`${cid}/${g}: palette 없음`);
          }
        }
      }
    }
  }
  okAll(bad, 'createMerc/mercStats 전 조합에서 NaN 없음', n);
  okAll(spriteBad, 'mercSprite 파츠 실재', classIds.length * grades.length);

  // 장비를 낀 상태에서도 NaN 이 없는지
  if (Gear) {
    const r2 = new RngMod.RNG(5150);
    const ebad = [];
    for (const cid of classIds) {
      const c = Classes.CLASSES[cid];
      const m = Merc.createMerc({ classId: cid, grade: 'A', level: 40, rng: r2 });
      const wt = (c.equip || []).find((t) => t !== 'shield') || (c.equip || [])[0];
      const items = [
        Gear.rollItem({ ilvl: 40, slot: 'weapon', weaponType: wt, rarity: 4, rng: r2 }),
        Gear.rollItem({ ilvl: 40, slot: 'armor', rarity: 4, rng: r2 }),
        Gear.rollItem({ ilvl: 40, slot: 'accessory', rarity: 4, rng: r2 }),
      ];
      m.equipment = { weapon: items[0].uid, armor: items[1].uid, accessory: items[2].uid };
      const s = Merc.mercStats(m, items);
      for (const k of STAT_KEYS) if (!isNum(s[k])) ebad.push(`${cid}: 장비착용 ${k}=${s[k]}`);
      const base = Merc.mercStats(m, null);
      if (isNum(s.atk) && isNum(base.atk) && s.atk < base.atk) ebad.push(`${cid}: 장비 착용 후 atk 감소 (${base.atk}->${s.atk})`);
    }
    okAll(ebad, '장비 착용 상태 스탯 정상', classIds.length);
  }

  // 전직 경로: 1차 -> 2차 -> 3차 가 끝까지 동작하는지
  const pbad = [];
  for (const baseId of Classes.BASE_CLASSES) {
    for (const t2 of Classes.CLASSES[baseId].next) {
      for (const t3 of Classes.CLASSES[t2].next) {
        const m = Merc.createMerc({ classId: baseId, grade: 'C', level: 15, rng: r });
        if (!Merc.canPromote(m)) { pbad.push(`${baseId}: Lv15 에서 canPromote=false`); continue; }
        if (!Merc.promote(m, t2)) { pbad.push(`${baseId}->${t2}: promote 실패`); continue; }
        if (m.classId !== t2) { pbad.push(`${baseId}->${t2}: classId='${m.classId}'`); continue; }
        m.level = 35;
        if (!Merc.canPromote(m)) { pbad.push(`${t2}: Lv35 에서 canPromote=false`); continue; }
        if (!Merc.promote(m, t3)) { pbad.push(`${t2}->${t3}: promote 실패`); continue; }
        if (m.classId !== t3) pbad.push(`${t2}->${t3}: classId='${m.classId}'`);
        if (Merc.canPromote(m)) pbad.push(`${t3}: 3차인데 canPromote=true`);
        const s = Merc.mercStats(m, null);
        for (const k of STAT_KEYS) if (!isNum(s[k])) pbad.push(`${t3}: 전직 후 ${k}=${s[k]}`);
      }
    }
  }
  okAll(pbad, '1차→2차→3차 전직 경로 28개 동작', 28);

  // gradeRoll 이 항상 유효 등급
  const gbad = [];
  const r3 = new RngMod.RNG(777);
  for (let t = 1; t <= 5; t++) {
    for (let i = 0; i < 200; i++) {
      const g = Merc.gradeRoll(t, r3);
      if (!grades.includes(g)) gbad.push(`tier${t}: '${g}'`);
    }
  }
  okAll(gbad, 'gradeRoll 유효 등급만 반환', 1000);
}

/* ───────────────────────────── 11. 전투 엔진 ───────────────────────────── */

section('전투 엔진 / AI');
if (Engine && Classes && Skills && Merc && Formations && Quest && Enemies && RngMod) {
  const slotsOf = (fid) => Formations.getFormation(fid).slots;

  const allyDef = (m, slotIndex, slot) => {
    const c = Classes.CLASSES[m.classId];
    return {
      uid: m.uid, name: m.name, side: 'ally', classId: m.classId, level: m.level, grade: m.grade,
      stats: Merc.mercStats(m, null), skills: c.skills.slice(),
      basicFx: c.basicFx, basicRange: c.range, basicDmgType: c.dmgType,
      slot, slotIndex, recipe: c.sprite, boss: false,
    };
  };
  const enemyDef = (e, level, slotIndex, slot) => ({
    uid: `en_${e.id}_${slotIndex}`, name: e.name, side: 'enemy', enemyId: e.id, level, grade: 'C',
    stats: Quest.enemyStats(e, level), skills: (e.skills || []).slice(),
    basicFx: e.basicFx, basicRange: e.range, basicDmgType: e.dmgType,
    slot, slotIndex, recipe: e.sprite, boss: !!e.boss,
  });

  // 모든 클래스가 최소 한 번은 실제로 싸워 보게 한다 (스킬 해석/AI 크래시 검출)
  const classIds = Object.keys(Classes.CLASSES);
  const enemyIds = Object.keys(Enemies.ENEMIES);
  const bad = [];
  const r = new RngMod.RNG(31337);
  const fSlots = slotsOf('basic');
  let battles = 0;
  for (let i = 0; i < classIds.length; i += 4) {
    const group = classIds.slice(i, i + 4);
    const allies = group.map((cid, k) => {
      const m = Merc.createMerc({ classId: cid, grade: 'B', level: 25, rng: r });
      return allyDef(m, k, fSlots[k]);
    });
    const enemies = [];
    for (let k = 0; k < 4; k++) {
      const e = Enemies.ENEMIES[enemyIds[(i + k) % enemyIds.length]];
      enemies.push(enemyDef(e, 25, k, fSlots[k]));
    }
    try {
      const res = Engine.simulate({
        allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic',
        seed: 1000 + i, getSkill: Skills.getSkill,
      });
      battles++;
      if (!res) { bad.push(`#${i}: result null`); continue; }
      if (!['ally', 'enemy', 'draw'].includes(res.winner)) bad.push(`#${i}: winner='${res.winner}'`);
      if (!isNum(res.time) || res.time < 0 || res.time > Engine.TIME_LIMIT + 1) bad.push(`#${i}: time=${res.time}`);
      for (const [k, v] of Object.entries(res.damageDealt || {})) if (!isNum(v)) bad.push(`#${i}: damageDealt.${k}=${v}`);
      for (const [k, v] of Object.entries(res.kills || {})) if (!isNum(v)) bad.push(`#${i}: kills.${k}=${v}`);
      if (!Array.isArray(res.survivors)) bad.push(`#${i}: survivors 배열 아님`);
    } catch (e) {
      bad.push(`#${i} [${group.join(',')}]: throw ${e.message}`);
    }
  }
  okAll(bad, '전 클래스 참여 전투가 크래시 없이 종료', battles);

  // 결정론: 같은 시드는 같은 결과
  const mk = (seed) => {
    const rr = new RngMod.RNG(4);
    const allies = ['swordsman', 'archer', 'acolyte'].map((cid, k) =>
      allyDef(Merc.createMerc({ classId: cid, grade: 'C', level: 10, rng: rr, name: `t${k}` }), k, fSlots[k]));
    for (const a of allies) a.uid = `a${a.slotIndex}`;
    const enemies = ['goblin_grunt', 'goblin_archer'].map((eid, k) =>
      enemyDef(Enemies.ENEMIES[eid], 10, k, fSlots[k]));
    return Engine.simulate({ allies, enemies, allyFormationId: 'basic', enemyFormationId: 'basic', seed, getSkill: Skills.getSkill });
  };
  const r1 = mk(12345);
  const r2 = mk(12345);
  ok(r1.winner === r2.winner && Math.abs(r1.time - r2.time) < 1e-9,
    '같은 시드 = 같은 결과 (결정론)', `${r1.winner}/${r1.time} vs ${r2.winner}/${r2.time}`);

  // 이벤트 스키마
  const b = Engine.createBattle({
    allies: ['swordsman', 'apprentice'].map((cid, k) =>
      allyDef(Merc.createMerc({ classId: cid, grade: 'C', level: 12, rng: r }), k, fSlots[k])),
    enemies: ['goblin_grunt', 'wolf'].filter((id) => Enemies.ENEMIES[id]).map((eid, k) =>
      enemyDef(Enemies.ENEMIES[eid], 12, k, fSlots[k])),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed: 909, getSkill: Skills.getSkill,
  });
  const EV = ['act', 'lunge', 'proj', 'damage', 'heal', 'miss', 'buff', 'status', 'death', 'end'];
  const evBad = [];
  const seenTypes = new Set();
  let guard = 0;
  while (!b.finished && guard++ < 20000) {
    b.step(1 / 60);
    for (const e of b.drainEvents()) {
      seenTypes.add(e.type);
      if (!EV.includes(e.type)) evBad.push(`알 수 없는 이벤트 '${e.type}'`);
      if (!isNum(e.t)) evBad.push(`${e.type}: t=${e.t}`);
      if (e.type === 'damage' && !isNum(e.amount)) evBad.push(`damage.amount=${e.amount}`);
      if (e.type === 'heal' && !isNum(e.amount)) evBad.push(`heal.amount=${e.amount}`);
    }
  }
  okAll(evBad.slice(0, 20), '전투 이벤트 스키마', seenTypes.size);
  ok(b.finished, '전투가 제한 시간 내 종료', `time=${b.time?.toFixed?.(2)}`);
  ok(seenTypes.has('act') && seenTypes.has('damage') && seenTypes.has('end'),
    '핵심 이벤트(act/damage/end) 발생', [...seenTypes].join(','));
}

/* ───────────────────────────── 12. 게임 루프 ───────────────────────────── */

section('게임 상태 / 의뢰 루프');
if (State && Quest && World && Squad && RngMod) {
  try {
    State.newGame(20260727);
    pass('newGame 실행');
    ok(State.state.roster.length >= 1, '시작 용병 지급', `${State.state.roster.length}명`);
    ok(State.state.squads.length >= 1, '시작 부대 생성');
    ok(isNum(State.state.gold), 'gold 숫자', State.state.gold);

    const bad = [];
    for (const m of State.state.roster) {
      const s = Merc.mercStats(m, State.state.items);
      for (const k of Merc.STAT_KEYS) if (!isNum(s[k])) bad.push(`${m.name}: ${k}=${s[k]}`);
    }
    okAll(bad, '시작 용병 스탯 정상', State.state.roster.length);

    // 모든 도시에서 의뢰 생성 → 전투 정의 변환
    const r = new RngMod.RNG(8080);
    const qbad = [];
    let qn = 0;
    for (const city of World.CITIES) {
      const list = Quest.genQuests(city.id, 1, r);
      if (!Array.isArray(list) || !list.length) { qbad.push(`${city.id}: 의뢰 없음`); continue; }
      for (const q of list) {
        qn++;
        if (!Quest.RANKS.includes(q.rank)) qbad.push(`${city.id}/${q.id}: rank='${q.rank}'`);
        if (!Quest.QUEST_TYPES.includes(q.type)) qbad.push(`${city.id}/${q.id}: type='${q.type}'`);
        if (!isNum(q.level) || q.level < 1) qbad.push(`${city.id}/${q.id}: level=${q.level}`);
        if (!isNum(q.days) || q.days < 0) qbad.push(`${city.id}/${q.id}: days=${q.days}`);
        if (!Array.isArray(q.waves) || !q.waves.length || q.waves.length > 3) qbad.push(`${city.id}/${q.id}: waves=${q.waves?.length}`);
        const rw = q.reward || {};
        for (const k of ['gold', 'exp', 'renown']) if (!isNum(rw[k])) qbad.push(`${city.id}/${q.id}: reward.${k}=${rw[k]}`);
        for (const roll of rw.itemRolls || []) if (!isNum(roll.ilvl)) qbad.push(`${city.id}/${q.id}: itemRolls.ilvl=${roll.ilvl}`);
        for (let w = 0; w < q.waves.length; w++) {
          let defs;
          try { defs = Quest.questBattleDefs(q, w, State.state, State.state.squads[0].id); } catch (e) {
            qbad.push(`${city.id}/${q.id} wave${w}: throw ${e.message}`); continue;
          }
          if (!defs) { qbad.push(`${city.id}/${q.id} wave${w}: null`); continue; }
          const list2 = [...(defs.allies || []), ...(defs.enemies || [])];
          if (!(defs.enemies || []).length) qbad.push(`${city.id}/${q.id} wave${w}: 적 없음`);
          for (const u of list2) {
            if (!u.stats) { qbad.push(`${city.id}/${q.id}: ${u.uid} stats 없음`); continue; }
            for (const k of Merc.STAT_KEYS) if (!isNum(u.stats[k])) qbad.push(`${city.id}/${q.id}: ${u.name}.${k}=${u.stats[k]}`);
            if (!u.slot || !isNum(u.slot.x) || !isNum(u.slot.y)) qbad.push(`${city.id}/${q.id}: ${u.name} slot 없음`);
            for (const sid of u.skills || []) {
              const s = typeof sid === 'string' ? Skills.SKILLS[sid] : sid;
              if (!s) qbad.push(`${city.id}/${q.id}: ${u.name} 스킬 '${sid}' 없음`);
            }
          }
        }
        // 보상 계산
        try {
          const rew = Quest.questRewards(q, { winner: 'ally', survivors: [], damageDealt: {}, kills: {} }, r);
          for (const k of ['gold', 'exp', 'renown']) if (!isNum(rew[k])) qbad.push(`${city.id}/${q.id}: questRewards.${k}=${rew[k]}`);
          for (const it of rew.items || []) if (!it || !it.uid) qbad.push(`${city.id}/${q.id}: 전리품 불량`);
        } catch (e) {
          qbad.push(`${city.id}/${q.id}: questRewards throw ${e.message}`);
        }
      }
    }
    okAll(qbad, '전 도시 의뢰 생성 → 전투 정의 → 보상', qn);

    // 날짜 진행
    const before = State.state.day;
    State.advanceDays(10);
    ok(State.state.day === before + 10, 'advanceDays(10)', `${before} -> ${State.state.day}`);
    ok(isNum(State.state.gold) && State.state.gold >= 0, '임금 정산 후 gold 정상', State.state.gold);

    // 모든 도시 갱신
    const cbad = [];
    for (const city of World.CITIES) {
      try {
        State.refreshCity(city.id, true);
        const tv = State.state.tavern[city.id];
        const sh = State.state.shop[city.id];
        if (!tv || !Array.isArray(tv.list) || !tv.list.length) cbad.push(`${city.id}: 주점 목록 없음`);
        for (const o of tv?.list || []) {
          if (!Classes.CLASSES[o.classId || o.merc?.classId]) cbad.push(`${city.id}: 주점 클래스 불명`);
        }
        if (!sh || !Array.isArray(sh.list)) cbad.push(`${city.id}: 상점 목록 없음`);
        for (const it of sh?.list || []) {
          for (const [k, v] of Object.entries(it.stats || {})) if (!isNum(v)) cbad.push(`${city.id}: 상점 ${it.name}.${k}=${v}`);
        }
      } catch (e) {
        cbad.push(`${city.id}: refreshCity throw ${e.message}`);
      }
    }
    okAll(cbad, '전 도시 주점/상점/의뢰 갱신', World.CITIES.length);

    // 부대 편성 API
    const sq = State.state.squads[0];
    ok(Squad.squadMembers(State.state, sq.id).length >= 1, 'squadMembers 조회');
    ok(isNum(Squad.squadPower(State.state, sq.id)), 'squadPower 숫자');
    ok(isNum(Squad.squadUpkeep(State.state, sq.id)), 'squadUpkeep 숫자');
    const defs = Squad.squadUnitDefs(State.state, sq.id);
    okAll((defs || []).filter((d) => !d.stats || !isNum(d.stats.hp)).map((d) => `${d.name}: stats 불량`),
      'squadUnitDefs 스탯 정상', (defs || []).length);
  } catch (e) {
    ok(false, '게임 루프 스모크', `${e.name}: ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}`);
  }
}

/* ─────────────── 12b. 파견(원정) 시스템 + 용병단 이름 ─────────────── */
// 의뢰를 끝내도 날짜는 흐르지 않고 **부대만 quest.days 만큼 잠긴다**.
// 여기서 보증하는 것:
//   - Squad 가 status/returnDay 를 들고 세이브 직렬화를 통과하는가
//   - 필드가 없는 옛 세이브가 idle 로 취급되어 깨지지 않는가
//   - applyQuestResult 가 날짜를 넘기지 않고 부대만 잠그는가
//   - 잠긴 부대는 canDeploy 가 막고, 날짜를 넘기면 스스로 풀리는가
//   - companyName 이 newGame 에서 채워지고 세이브를 왕복하는가

section('파견(원정) 시스템 / 용병단 이름');
{
  try {
    State.newGame(4242, '검은 늑대단');
    const st = State.state;
    ok(st.companyName === '검은 늑대단', 'newGame(seed, name) 이 용병단 이름을 받는다', st.companyName);
    State.newGame(4243);
    ok(typeof State.state.companyName === 'string' && State.state.companyName.length > 0,
      '이름을 생략하면 자동 생성한다', State.state.companyName);

    const s0 = State.state.squads[0];
    ok(s0.status === 'idle' && s0.returnDay === 0, '새 부대는 idle/returnDay 0',
      `${s0.status}/${s0.returnDay}`);

    // 파견 → 잠김
    const day0 = State.state.day;
    const d = Squad.dispatchSquad(State.state, s0.id, 3);
    ok(d.ok && s0.status === 'away' && s0.returnDay === day0 + 3,
      'dispatchSquad(3일) → away, returnDay = day+3', `${s0.status}/${s0.returnDay}`);
    ok(Squad.isSquadAway(s0, State.state.day) === true, 'isSquadAway 가 원정 중을 알린다');
    ok(Squad.squadReturnIn(s0, State.state.day) === 3, 'squadReturnIn = 3',
      Squad.squadReturnIn(s0, State.state.day));
    ok(State.anySquadAway(State.state) === true, 'anySquadAway (월드맵 이동 경고용)');
    ok(State.daysUntilNextReturn(State.state) === 3, 'daysUntilNextReturn = 3',
      State.daysUntilNextReturn(State.state));
    ok(Squad.canDeploy(State.state, s0.id).away === true, '원정 중 부대는 canDeploy.away = true');
    ok(Squad.canDeploy(State.state, s0.id).ok === false, '원정 중 부대는 출전 불가');

    // 날짜를 넘기면 스스로 복귀
    State.advanceDays(2);
    ok(s0.status === 'away', '2일 경과 — 아직 복귀 전');
    const back = State.advanceDays(1);
    ok(s0.status === 'idle' && s0.returnDay === 0, '3일 경과 — 자동 복귀', `${s0.status}/${s0.returnDay}`);
    ok(Array.isArray(back.returned) && back.returned.includes(s0.name),
      'advanceDays 가 복귀한 부대 이름을 돌려준다', JSON.stringify(back.returned));
    ok(Squad.canDeploy(State.state, s0.id).ok === true, '복귀 후 다시 출전 가능');
    pass('부대 잠금 → 날짜 진행 → 자동 복귀 흐름');

    // applyQuestResult 는 날짜를 넘기지 않고 부대만 잠근다
    State.refreshCity(State.state.cityId, true);
    const quest = (State.state.quests[State.state.cityId]?.list || [])[0];
    if (!quest) {
      ok(false, '의뢰 목록 확보');
    } else {
      const dayBefore = State.state.day;
      const out = Quest.applyQuestResult(quest, { results: [{ winner: 'ally', survivors: [], damageDealt: {}, kills: {} }], squadId: s0.id });
      ok(State.state.day === dayBefore, 'applyQuestResult 는 날짜를 넘기지 않는다',
        `${dayBefore} -> ${State.state.day}`);
      const expected = Math.max(0, Math.round(quest.days || 0));
      if (expected > 0) {
        ok(s0.status === 'away' && s0.returnDay === dayBefore + expected,
          `의뢰(${quest.rank}, ${expected}일) 후 부대가 잠긴다`, `${s0.status}/${s0.returnDay}`);
        ok(out && out.dispatch && out.dispatch.days === expected,
          'applyQuestResult 가 dispatch 정보를 돌려준다', JSON.stringify(out && out.dispatch));
      } else {
        ok(s0.status === 'idle', '0일짜리 의뢰는 부대를 잠그지 않는다');
      }
      pass('applyQuestResult 는 날짜를 넘기지 않고 부대만 잠근다', `${quest.rank}랭크 ${quest.days}일`);
    }

    // 랭크별 소요 일수가 단조 증가하는가 (파견 전략의 핵심 노브)
    const dayBad = [];
    let prevLo = 0;
    for (const rk of Quest.RANKS) {
      const [lo, hi] = Quest.RANK_DAYS[rk] || [];
      if (!isNum(lo) || !isNum(hi) || lo < 1 || hi < lo) { dayBad.push(`${rk}: [${lo},${hi}]`); continue; }
      if (lo < prevLo) dayBad.push(`${rk}: 하한이 앞 랭크보다 작다 (${lo} < ${prevLo})`);
      prevLo = lo;
    }
    okAll(dayBad, 'RANK_DAYS 가 랭크에 따라 단조 증가', Quest.RANKS.length);

    // 세이브 직렬화 왕복
    Squad.dispatchSquad(State.state, s0.id, 5);
    const snap = JSON.parse(JSON.stringify(State.state));
    const rt = snap.squads[0];
    ok(rt.status === 'away' && isNum(rt.returnDay) && rt.returnDay > 0,
      'status/returnDay 가 JSON 왕복에서 살아남는다', `${rt.status}/${rt.returnDay}`);
    ok(typeof snap.companyName === 'string' && snap.companyName.length > 0,
      'companyName 이 JSON 왕복에서 살아남는다', snap.companyName);

    // 옛 세이브 하위 호환 — status/returnDay 가 아예 없는 부대
    const legacy = { id: 'sq_legacy', name: '옛 부대', memberUids: new Array(7).fill(null), formationId: 'basic' };
    Squad.normalizeDispatch(legacy, State.state.day);
    ok(legacy.status === 'idle' && legacy.returnDay === 0,
      '필드 없는 옛 부대는 idle 로 정규화된다', `${legacy.status}/${legacy.returnDay}`);
    ok(Squad.isSquadAway(legacy, State.state.day) === false, '옛 부대는 원정 중이 아니다');
    // 복귀일이 이미 지난 부대도 idle 로 되돌린다
    const stale = { id: 'sq_stale', name: '만료 부대', memberUids: new Array(7).fill(null), formationId: 'basic', status: 'away', returnDay: 1 };
    Squad.normalizeDispatch(stale, 999);
    ok(stale.status === 'idle' && stale.returnDay === 0, '복귀일이 지난 부대는 idle 로 복구', `${stale.status}/${stale.returnDay}`);
    pass('세이브 왕복 + 옛 세이브 하위 호환 (status/returnDay/companyName)');
  } catch (e) {
    ok(false, '파견 시스템 스모크', `${e.name}: ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}`);
  }
}

/* ─────── 12c. 도시 평판 / 단원 정원 / 부대 확장 / 클래스 특화 도시 ─────── */
// 이번 확장의 새 상태 필드는 전부 **세이브 직렬화 대상**이고, 필드가 없는 옛 세이브에서도
// 정규화되어야 한다. 여기서 보증하는 것:
//   - reputation: 시작 도시만 START_REP, 나머지 0 / 0~100 clamp / JSON 왕복 / 옛 세이브 정규화
//   - REP_TAVERN_MIN 미만이면 canUseTavern 이 막는다 (낯선 도시는 의뢰부터)
//   - rosterCap: 시작 20, 체증 비용, 상한 40, 옛 세이브 정규화, 정원 초과 고용 차단
//   - MAX_SQUADS / squadCost / canAddSquad / buySquad 의 골드 차감
//   - 도시 specialty 가 1차 클래스 id 만 담고, 7종이 전부 어딘가에 배분되었는가
//   - gradeRoll(cityTier, rng) 2인자 호출이 예전과 **완전히 같은 분포**를 유지하는가
//   - ★ 1티어 특화(평판 100) 의 S 확률 > 5티어 비특화(평판 10) 의 S 확률

section('평판 / 정원 / 부대 확장 / 특화 도시');
{
  try {
    /* ── 평판 ── */
    State.newGame(777, '평판 시험단');
    const st = State.state;
    ok(st.reputation && typeof st.reputation === 'object', 'state.reputation 이 존재한다');
    ok(State.getRep(World.START_CITY) === State.START_REP,
      `시작 도시 평판 = START_REP(${State.START_REP})`, State.getRep(World.START_CITY));
    const others = World.CITIES.filter((c) => c.id !== World.START_CITY);
    okAll(others.filter((c) => State.getRep(c.id) !== 0).map((c) => `${c.id}=${State.getRep(c.id)}`),
      '시작 도시 외 전 도시 평판 0', others.length);
    ok(State.getRep('없는도시') === 0, '기록 없는 도시는 0');

    State.addRep(World.START_CITY, 999);
    ok(State.getRep(World.START_CITY) === State.REP_MAX, `평판 상한 ${State.REP_MAX} clamp`, State.getRep(World.START_CITY));
    State.addRep(World.START_CITY, -999);
    ok(State.getRep(World.START_CITY) === State.REP_MIN, `평판 하한 ${State.REP_MIN} clamp`, State.getRep(World.START_CITY));

    // 랭크별 증감표: 성공 = REP_QUEST_GAIN, 실패 = 그 절반(최소 1) 하락
    const repBad = [];
    for (const rk of Quest.RANKS) {
      const gain = State.REP_QUEST_GAIN[rk];
      if (!isNum(gain) || gain <= 0) { repBad.push(`${rk}: gain=${gain}`); continue; }
      State.state.reputation[World.START_CITY] = 50;
      const up = State.addQuestRep(World.START_CITY, rk, true);
      if (up.delta !== gain || State.getRep(World.START_CITY) !== 50 + gain) repBad.push(`${rk} 성공: ${up.delta}`);
      State.state.reputation[World.START_CITY] = 50;
      const dn = State.addQuestRep(World.START_CITY, rk, false);
      const want = -Math.max(1, Math.floor(gain / 2));
      if (dn.delta !== want) repBad.push(`${rk} 실패: ${dn.delta} (기대 ${want})`);
    }
    okAll(repBad, '랭크별 평판 증감표 (성공 +표 / 실패 절반 하락)', Quest.RANKS.length * 2);

    /* ── 주점 잠금 ── */
    State.state.reputation[World.START_CITY] = State.REP_TAVERN_MIN;
    ok(State.canUseTavern(World.START_CITY).ok === true, `평판 ${State.REP_TAVERN_MIN} 이면 주점이 열린다`);
    State.state.reputation[World.START_CITY] = State.REP_TAVERN_MIN - 1;
    const locked = State.canUseTavern(World.START_CITY);
    ok(locked.ok === false && typeof locked.reason === 'string' && locked.reason.length > 0,
      `평판 ${State.REP_TAVERN_MIN - 1} 이면 주점이 잠기고 사유를 알려준다`, locked.reason);
    ok(locked.need === State.REP_TAVERN_MIN, 'canUseTavern 이 필요 평판을 알려준다', locked.need);

    /* ── 평판 세이브 왕복 / 옛 세이브 정규화 ── */
    State.newGame(778);
    State.addRep(World.START_CITY, 7);          // 10 + 7 = 17
    State.addRep('kingsrest', 5);
    const repSnap = JSON.parse(JSON.stringify(State.state));
    ok(repSnap.reputation[World.START_CITY] === 17 && repSnap.reputation.kingsrest === 5,
      'reputation 이 JSON 왕복에서 살아남는다', JSON.stringify({ s: repSnap.reputation[World.START_CITY], k: repSnap.reputation.kingsrest }));
    State.importState(repSnap);
    ok(State.getRep(World.START_CITY) === 17 && State.getRep('kingsrest') === 5,
      'importState 가 평판을 복원한다', `${State.getRep(World.START_CITY)}/${State.getRep('kingsrest')}`);

    // 옛 세이브: reputation 필드가 아예 없다 → 전부 0 + 시작 도시만 START_REP
    const legacySave = JSON.parse(JSON.stringify(repSnap));
    delete legacySave.reputation;
    State.importState(legacySave);
    ok(State.getRep(World.START_CITY) === State.START_REP,
      '평판 없는 옛 세이브 → 시작 도시 START_REP 로 정규화', State.getRep(World.START_CITY));
    okAll(others.filter((c) => State.getRep(c.id) !== 0).map((c) => `${c.id}=${State.getRep(c.id)}`),
      '평판 없는 옛 세이브 → 나머지 도시 0', others.length);

    // 값이 망가진 세이브 (문자열/범위 밖/누락 도시)
    const brokenSave = JSON.parse(JSON.stringify(repSnap));
    brokenSave.reputation = { [World.START_CITY]: 'abc', kingsrest: 999, thornvale: -50 };
    State.importState(brokenSave);
    ok(State.getRep(World.START_CITY) === 0, '숫자가 아닌 평판 → 0', State.getRep(World.START_CITY));
    ok(State.getRep('kingsrest') === State.REP_MAX, '범위 밖 평판 → 상한 clamp', State.getRep('kingsrest'));
    ok(State.getRep('thornvale') === State.REP_MIN, '음수 평판 → 하한 clamp', State.getRep('thornvale'));
    ok(World.CITIES.every((c) => isNum(State.state.reputation[c.id])), '정규화 후 전 도시가 숫자 평판을 갖는다');
    pass('평판 세이브 왕복 + 옛 세이브 정규화');

    /* ── 단원 정원 ── */
    State.newGame(779);
    ok(State.state.rosterCap === State.ROSTER_CAP_START,
      `새 게임 정원 = ${State.ROSTER_CAP_START}`, State.state.rosterCap);
    // 값 자체를 박아 두면 상한을 조정할 때마다 깨진다 — 관계만 검사한다.
    ok(State.ROSTER_CAP_MAX > State.ROSTER_CAP_START
       && (State.ROSTER_CAP_MAX - State.ROSTER_CAP_START) % State.ROSTER_CAP_STEP === 0,
      `ROSTER_CAP_MAX(${State.ROSTER_CAP_MAX})가 START(${State.ROSTER_CAP_START})보다 크고 STEP(${State.ROSTER_CAP_STEP}) 배수로 떨어진다`,
      `${State.ROSTER_CAP_START} → ${State.ROSTER_CAP_MAX} (step ${State.ROSTER_CAP_STEP})`);
    // 부대 정원(5부대 x 7명 = 35) 보다는 넉넉해야 예비 인원을 둘 수 있다
    ok(State.ROSTER_CAP_MAX >= 35 + State.ROSTER_CAP_STEP,
      '정원 상한이 전 부대 정원(35명)보다 넉넉하다', State.ROSTER_CAP_MAX);
    const capBad = [];
    let cap = State.ROSTER_CAP_START;
    let prevCost = 0;
    while (cap < State.ROSTER_CAP_MAX) {
      cap += State.ROSTER_CAP_STEP;
      const cost = State.rosterCapCost(cap);
      if (!isNum(cost) || cost <= prevCost) capBad.push(`${cap}명: ${cost}G (앞 단계 ${prevCost}G)`);
      prevCost = cost;
    }
    okAll(capBad, '정원 확장 비용이 단계마다 증가한다(체증)', 4);
    ok(!Number.isFinite(State.rosterCapCost(State.ROSTER_CAP_MAX + State.ROSTER_CAP_STEP)),
      '상한 초과 정원은 비용이 무한(=구매 불가)');

    State.state.gold = 0;
    ok(State.canExpandRoster(State.state).ok === false, '골드가 없으면 정원 확장 불가');
    State.state.gold = 1000000;
    let expandTimes = 0;
    while (State.canExpandRoster(State.state).ok) {
      const before = State.state.gold;
      const r = State.expandRosterCap(State.state);
      if (!r.ok) break;
      if (State.state.gold >= before) capBad.push('정원 확장이 골드를 차감하지 않는다');
      expandTimes++;
      if (expandTimes > 40) break;   // 무한루프 방지용 여유값 (상수에서 기대치를 뽑으므로 넉넉히)
    }
    // ★ 횟수를 하드코딩하지 않는다 — 정원 상한/증가폭을 바꿀 때마다 이 검사가 같이 깨진다.
    const wantExpand = Math.round((State.ROSTER_CAP_MAX - State.ROSTER_CAP_START) / State.ROSTER_CAP_STEP);
    ok(State.state.rosterCap === State.ROSTER_CAP_MAX && expandTimes === wantExpand,
      `정원을 ${State.ROSTER_CAP_MAX}명까지 ${wantExpand}번 확장할 수 있다`,
      `${State.state.rosterCap} / ${expandTimes}회 (기대 ${wantExpand})`);
    // 확장 단계마다 비용표가 있어야 한다 (없으면 확장이 조용히 막힌다)
    const costGap = [];
    for (let c = State.ROSTER_CAP_START + State.ROSTER_CAP_STEP; c <= State.ROSTER_CAP_MAX; c += State.ROSTER_CAP_STEP) {
      if (!(State.ROSTER_CAP_COST[c] > 0)) costGap.push(`${c}명 비용 없음`);
    }
    okAll(costGap, '정원 확장 단계마다 비용이 정의돼 있다', wantExpand);
    ok(State.canExpandRoster(State.state).ok === false, '상한에 닿으면 더 확장할 수 없다');

    // 정원 초과 고용 차단
    // ※ rosterCap 은 정규화가 [20, 40] 으로 잘라내므로 "정원을 낮춘다"로는 채울 수 없다.
    //   실제 상황과 같게 **단원을 정원까지 채워서** 검사한다.
    State.newGame(780);
    ok(State.canHireMore(State.state).ok === true, '정원이 남으면 고용 가능');
    let guard = 0;
    while (State.state.roster.length < State.state.rosterCap && guard++ < 60) {
      State.addMerc(Merc.createMerc({ classId: Classes.BASE_CLASSES[0], grade: 'F', level: 1 }));
    }
    ok(State.state.roster.length === State.state.rosterCap,
      `단원을 정원(${State.state.rosterCap})까지 채웠다`, State.state.roster.length);
    const full = State.canHireMore(State.state);
    ok(full.ok === false && typeof full.reason === 'string' && full.reason.length > 0,
      '정원이 찼으면 canHireMore 가 사유와 함께 막는다', full.reason);
    State.state.gold = 5000;
    State.expandRosterCap(State.state);
    ok(State.canHireMore(State.state).ok === true, '정원을 넓히면 다시 고용 가능',
      `${State.state.roster.length}/${State.state.rosterCap}`);

    // 옛 세이브에 rosterCap 이 없다
    const capSave = JSON.parse(JSON.stringify(State.state));
    delete capSave.rosterCap;
    State.importState(capSave);
    ok(State.state.rosterCap === State.ROSTER_CAP_START,
      'rosterCap 없는 옛 세이브 → 20 으로 정규화', State.state.rosterCap);
    const capSave2 = JSON.parse(JSON.stringify(State.state));
    capSave2.rosterCap = 9999;
    State.importState(capSave2);
    ok(State.state.rosterCap === State.ROSTER_CAP_MAX, '범위 밖 rosterCap → 상한 clamp', State.state.rosterCap);
    const capSave3 = JSON.parse(JSON.stringify(State.state));
    capSave3.rosterCap = 'abc';
    State.importState(capSave3);
    ok(State.state.rosterCap === State.ROSTER_CAP_START, '숫자가 아닌 rosterCap → 20', State.state.rosterCap);
    pass('단원 정원 확장 + 세이브 정규화');

    /* ── 부대 확장 ── */
    State.newGame(781);
    ok(Squad.MAX_SQUADS === 5, 'MAX_SQUADS = 5', Squad.MAX_SQUADS);
    ok(State.state.squads.length === 1, '새 게임은 부대 1개', State.state.squads.length);
    const sqBad = [];
    let prevSq = 0;
    for (let n = 2; n <= Squad.MAX_SQUADS; n++) {
      const c = Squad.squadCost(n);
      if (!isNum(c) || c <= prevSq) sqBad.push(`${n}번째: ${c}G (앞 ${prevSq}G)`);
      prevSq = c;
    }
    okAll(sqBad, '부대 구매 비용이 체증한다', Squad.MAX_SQUADS - 1);

    State.state.gold = 0;
    ok(Squad.canAddSquad(State.state).ok === false, '골드가 없으면 부대를 살 수 없다');
    State.state.gold = 1000000;
    let bought = 0;
    while (Squad.canAddSquad(State.state).ok) {
      const before = State.state.gold;
      const cost = Squad.canAddSquad(State.state).cost;
      const r = Squad.buySquad(State.state, `제${State.state.squads.length + 1}부대`);
      if (!r.ok) { sqBad.push(`buySquad 실패: ${r.reason}`); break; }
      if (State.state.gold !== before - cost) sqBad.push(`골드 차감 불일치 (${before} → ${State.state.gold}, 비용 ${cost})`);
      bought++;
      if (bought > 10) break;
    }
    ok(State.state.squads.length === Squad.MAX_SQUADS && bought === Squad.MAX_SQUADS - 1,
      `부대를 ${Squad.MAX_SQUADS}개까지 살 수 있다`, `${State.state.squads.length}개 / ${bought}회 구매`);
    const overCap = Squad.canAddSquad(State.state);
    ok(overCap.ok === false && overCap.reason.includes(String(Squad.MAX_SQUADS)),
      `${Squad.MAX_SQUADS}개를 넘으면 사유와 함께 막힌다`, overCap.reason);
    const newSquads = State.state.squads.every((s) => Array.isArray(s.memberUids) && s.memberUids.length === 7
      && s.status === 'idle' && s.returnDay === 0);
    ok(newSquads, '구매한 부대도 7슬롯 · idle 로 초기화된다');
    const sqSnap = JSON.parse(JSON.stringify(State.state));
    ok(sqSnap.squads.length === Squad.MAX_SQUADS, '늘어난 부대가 JSON 왕복에서 살아남는다', sqSnap.squads.length);
    pass('부대 확장 (구매 비용 · 상한 · 직렬화)');

    /* ── 의뢰 공급이 부대 수를 따라가는가 ── */
    const qCount = [1, 2, 3, 5].map((n) => {
      const r = new RngMod.RNG(4242);
      return Quest.genQuests(World.START_CITY, 1, r, n).length;
    });
    ok(qCount[3] > qCount[0], '부대가 많을수록 의뢰가 많이 뜬다', qCount.join(' / '));
    /* ★ 범위를 손으로 적지 말고 **상수에서 읽는다.** 예전에는 «4~16» 이 박혀 있어서
     *   목록 길이를 늘리자마자 이 검사가 거짓말을 했다 — 이번 세션에만 같은 종류의
     *   하드코딩 버그가 넷 나왔다 (HANDOFF §43). */
    const qLo = Quest.QUEST_COUNT_MIN ?? 4;
    const qHi = Quest.QUEST_COUNT_MAX ?? 20;
    ok(qCount.every((v) => v >= qLo && v <= qHi),
      `의뢰 개수가 ${qLo}~${qHi} 범위 안`, qCount.join(' / '));
    // state 없이(=순수 함수) 불러도 죽지 않아야 한다 — balance.mjs 가 이 경로를 쓴다
    ok(Quest.genQuests(World.START_CITY, 1, new RngMod.RNG(1)).length >= 4, 'squadCount 생략 호출도 동작한다');

    /* ── 클래스 특화 도시 ── */
    const base = new Set(Classes.BASE_CLASSES);
    const specBad = [];
    /* ★ 규칙: 등급별 명물 수는 **1 / 1 / 2 / 3 / 4** 다 (제작자 설계, HANDOFF §31).
     *   «= 등급» 이 아니다 — 1·2등급을 평평하게 둬서 그 7칸에 7클래스가 정확히
     *   하나씩 들어가고, 그 결과 «모든 클래스가 초반 거점을 갖는다» 가 규칙이 아니라
     *   **구조에서 저절로** 나온다. */
    const SPEC_BY_TIER = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };
    /* (옛 주석) 도시가 곧 난이도 축이 되는 개편의 일부다.
     *   도시가 곧 난이도 축이 되는 개편의 일부다 (HANDOFF §30) — 상위 도시일수록
     *   좋은 용병을 만날 창구가 넓어야 "위로 갈 이유" 가 생긴다.
     *   예전 규칙은 "1~2종" 이었고 등급과 무관했다. */
    for (const c of World.CITIES) {
      const sp = World.citySpecialty(c.id);
      const want = SPEC_BY_TIER[c.tier];
      if (!Array.isArray(sp) || sp.length !== want) {
        specBad.push(`${c.id}: ${c.tier}등급은 명물 ${want}종인데 ${Array.isArray(sp) ? sp.length : '?'}종`);
      }
      const dup = new Set();
      for (const id of sp || []) {
        if (!base.has(id)) specBad.push(`${c.id}: 1차 클래스가 아님 ${id}`);
        if (dup.has(id)) specBad.push(`${c.id}: 같은 클래스가 두 번 ${id}`);
        dup.add(id);
      }
    }
    okAll(specBad, '등급별 명물 수 (1·2등급 1종 / 3등급 2 / 4등급 3 / 5등급 4)', World.CITIES.length);

    /* ★ 도시끼리 너무 가까우면 **노드가 겹쳐 클릭이 안 된다.**
     *   실제로 sed 로 좌표를 고치다 같은 지역·등급 도시를 전부 덮어써서
     *   사막 3개·설원 2개가 완전히 같은 자리에 놓였다 — 서리관문이 안 눌렸다.
     *   라벨 검사(maplabels)는 **라벨만** 보므로 이건 못 잡는다. 여기서 잡는다. */
    const nearBad = [];
    for (let i = 0; i < World.CITIES.length; i++) {
      for (let j = i + 1; j < World.CITIES.length; j++) {
        const a = World.CITIES[i];
        const b = World.CITIES[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 110) nearBad.push(`${a.id}↔${b.id} = ${Math.round(d)}`);
      }
    }
    okAll(nearBad, '도시 노드가 서로 110 이상 떨어져 있다 (겹치면 클릭이 안 된다)', World.CITIES.length);

    const noHome = Classes.BASE_CLASSES.filter((id) => World.citiesForClass(id).length === 0);
    okAll(noHome, '1차 클래스 7종이 전부 특화 도시를 갖는다', Classes.BASE_CLASSES.length);
    const counts = Classes.BASE_CLASSES.map((id) => World.citiesForClass(id).length);
    ok(Math.max(...counts) - Math.min(...counts) <= 1,
      '클래스별 특화 도시 수가 고르다(편차 1 이하)', counts.join('/'));
    ok(World.isSpecialtyCity(World.START_CITY, World.citySpecialty(World.START_CITY)[0]) === true,
      'isSpecialtyCity 가 특화를 알아본다');

    /* ── gradeRoll 하위 호환: opts 생략 = 예전 동작 ── */
    const gBad = [];
    for (const tier of [1, 2, 3, 4, 5]) {
      const a = Merc.gradeRoll(tier, new RngMod.RNG(9999));
      const b = Merc.gradeRoll(tier, new RngMod.RNG(9999), {});
      const c = Merc.gradeRoll(tier, new RngMod.RNG(9999), { rep: State.START_REP, specialty: false });
      if (a !== b || b !== c) gBad.push(`tier${tier}: ${a}/${b}/${c}`);
      // 분포 자체가 정수 티어 표와 같아야 한다
      const w = Merc.gradeWeights(tier);
      const odds = Merc.gradeOdds(tier);
      const total = Merc.GRADES.reduce((s, g) => s + w[g], 0);
      for (const g of Merc.GRADES) {
        if (Math.abs(odds[g] - w[g] / total) > 1e-6) gBad.push(`tier${tier} ${g}: ${odds[g]} vs ${w[g] / total}`);
      }
    }
    okAll(gBad, 'gradeRoll 2인자 호출이 예전과 같은 분포를 유지한다', 5);
    ok(Merc.GRADES.every((g) => isNum(Merc.gradeOdds(3, { rep: 100, specialty: true })[g])),
      'gradeOdds(rep/specialty) 가 전부 유한값');
    const sum1 = Merc.GRADES.reduce((s, g) => s + Merc.gradeOdds(3, { rep: 55, specialty: true })[g], 0);
    ok(Math.abs(sum1 - 1) < 1e-6, 'gradeOdds 합 = 1', sum1);

    // 실효 티어 보간
    /* ★ 값을 박지 말고 **상수에서 유도**한다. 예전에는 «평판 100 = +1.5» 를 손으로 적어 둬서
     *   REP_MAX/REP_PER_TIER 를 바꾸자 바로 거짓말이 됐다. */
    const expTier = (rep) => 1 + (rep - Merc.REP_BASELINE) / Merc.REP_PER_TIER;
    ok(Math.abs(Merc.effectiveTier(1, { rep: 100 }) - expTier(100)) < 1e-9,
      '평판 보정이 REP_PER_TIER 를 그대로 따른다', Merc.effectiveTier(1, { rep: 100 }));
    ok(Math.abs(Merc.effectiveTier(1, { rep: State.REP_MAX }) - expTier(State.REP_MAX)) < 1e-9,
      '평판 만점도 상한(MAX_CITY_TIER)에 안 걸린다', Merc.effectiveTier(1, { rep: State.REP_MAX }));
    // 최고 도시 + 특화 + 만점이 천장에 눌리면 평판이 무의미해진다 — 그게 옛 버그였다
    const top = Merc.effectiveTier(5, { rep: State.REP_MAX, specialty: true });
    ok(top < Merc.MAX_CITY_TIER - 1e-9,
      '5등급 명물 도시 + 평판 만점이 실효 티어 천장에 안 눌린다', `${top} / ${Merc.MAX_CITY_TIER}`);
    ok(Math.abs(Merc.effectiveTier(1, { rep: 10, specialty: true }) - 2) < 1e-9, '특화 = 실효 티어 +1.0', Merc.effectiveTier(1, { rep: 10, specialty: true }));
    ok(Merc.effectiveTier(5, { rep: 100, specialty: true }) <= Merc.MAX_CITY_TIER, `실효 티어 상한 ${Merc.MAX_CITY_TIER}`);
    const mono = [0, 25, 50, 75, 100].map((rep) => Merc.gradeOdds(3, { rep }).S);
    ok(mono.every((v, i) => i === 0 || v >= mono[i - 1] - 1e-9), '평판이 오르면 S 확률이 줄지 않는다', mono.map((v) => (v * 100).toFixed(2)).join('/'));

    // ★ 핵심 설계 목표: 저티어 특화 도시가 고티어 비특화 도시보다 S 를 잘 뽑는다
    const sLow = Merc.gradeOdds(1, { rep: 100, specialty: true }).S;
    const sHigh = Merc.gradeOdds(5, { rep: State.START_REP, specialty: false }).S;
    ok(sLow > sHigh,
      '★ 1티어 특화(평판100) S 확률 > 5티어 비특화(평판10) S 확률 — 저티어 순회 동기',
      `${(sLow * 100).toFixed(2)}% vs ${(sHigh * 100).toFixed(2)}%`);
    pass('특화 도시 + 평판 보정 등급 확률', `저티어 특화 S ${(sLow * 100).toFixed(2)}% > 고티어 S ${(sHigh * 100).toFixed(2)}%`);
  } catch (e) {
    ok(false, '평판/정원/부대확장/특화 스모크', `${e.name}: ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}`);
  }
}

/* ─────────────── 13. 브라우저 전용 파일: 문법 + import 정합성 ─────────────── */
// ui/*.js, battle/renderer.js 는 node 에서 실행할 수 없다(최상위 DOM 사용 허용).
// 대신 (a) 파서로 문법만 검사하고 (b) import 대상/이름을 정적으로 대조한다.

section('브라우저 전용 파일 문법 (실행 없이 파싱)');
{
  const files = [...listDir('ui'), 'battle/renderer.js', 'main.js'];
  const tmp = mkdtempSync(join(tmpdir(), 'merc-smoke-'));
  const bad = [];
  for (const rel of files) {
    const abs = srcDir(rel);
    let code;
    try { code = readFileSync(abs, 'utf8'); } catch (e) { bad.push(`${rel}: 읽기 실패 ${e.message}`); continue; }
    const tf = join(tmp, rel.replace(/[\\/]/g, '_') + '.mjs');
    writeFileSync(tf, code);
    try {
      execFileSync(process.execPath, ['--check', tf], { stdio: 'pipe' });
    } catch (e) {
      const msg = String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' / ');
      bad.push(`${rel}: ${msg}`);
    }
  }
  okAll(bad, 'ui/renderer/main 문법 검사', files.length);
}

section('주점 고용가가 의뢰 보상과 같은 기울기인가');
{
  /* ★★ 제작자 지적: 「5등급 도시에서 의뢰 하나 하고 영웅 뽑고 3일 넘기고 반복하는데
   *   골드가 너무 여유있다」. 재 보니(tools/tavernecon.mjs) 원인이 **기울기 불일치**였다:
   *     의뢰 보상은 cityPower ** CITY_REWARD_POW (5등급 ×3.61)
   *     고용가는   1 + 0.2 * (tier - 1)          (5등급 ×1.80)
   *   수입은 제곱으로 오르고 지출은 선형이라 위로 갈수록 벌어진다 —
   *   의뢰 한 건으로 살 수 있는 뽑기가 1등급 1.1장 → 5등급 100.3장이었다.
   *
   * ★ 그래서 **같은 지수를 쓰기로** 했다. 이 검사는 그 약속을 지킨다:
   *   genTavern 이 quest.js 의 cityPowerOf/CITY_REWARD_POW 를 그대로 써야 한다.
   *   누가 CITY_REWARD_POW 를 바꾸면 고용가도 자동으로 따라가야지, 한쪽만 움직이면 안 된다.
   *
   * ★ 값은 여전히 C등급 기준이고 등급은 살 때 추첨한다 — 도박은 도박으로 남긴다(제작자 결정). */
  /* ★★ 주석을 걷어내고 봐야 한다. 이 검사를 처음 짰을 때 «옛 식이 되살아났다» 로 걸렸는데,
   *   범인은 코드가 아니라 «예전엔 1 + 0.2 * (tier - 1) 이었다» 고 적은 **내 주석**이었다.
   *   소스를 글자로 훑는 검사는 주석에서 오탐한다. */
  const strip = (x) => {
    let out = ''; let i = 0;
    while (i < x.length) {
      if (x[i] === '/' && x[i + 1] === '*') { const e = x.indexOf('*/', i + 2); i = e < 0 ? x.length : e + 2; continue; }
      if (x[i] === '/' && x[i + 1] === '/') { const e = x.indexOf(String.fromCharCode(10), i); i = e < 0 ? x.length : e; continue; }
      out += x[i]; i++;
    }
    return out;
  };
  const src = strip(readFileSync(srcDir('game/state.js'), 'utf8').split(String.fromCharCode(13)).join(''));
  const faults = [];

  const bodyStart = src.indexOf('function genTavern(');
  if (bodyStart < 0) faults.push('genTavern 을 못 찾았다');
  else {
    const body = src.slice(bodyStart, src.indexOf(String.fromCharCode(10) + '}', bodyStart));
    if (body.includes('1 + 0.2 * (tier - 1)')) {
      faults.push('옛 선형 배율(1 + 0.2×(t−1))이 되살아났다 — 의뢰 보상과 기울기가 어긋난다');
    }
    if (!body.includes('Quest.cityPowerOf(tier) ** Quest.CITY_REWARD_POW')) {
      faults.push('고용가가 의뢰 보상 지수(cityPowerOf ** CITY_REWARD_POW)를 안 쓴다');
    }
    if (!body.includes("Merc.hireCost(classId, 'C', 1)")) {
      faults.push("고용가 기준이 C등급이 아니다 — 등급값으로 바꾸는 안은 채택하지 않았다(도박 유지)");
    }
  }
  okAll(faults, '고용가가 의뢰 보상과 같은 지수를 쓴다', 3);

  /* ★ 무는 시늉만 하는 검사를 이 저장소에서 여러 번 만들었다 — 옛 식을 심어 확인한다 */
  const planted = strip('function genTavern(city, r) { /* 1 + 0.2 * (tier - 1) 였다 */ '
    + 'const cost = base * (1 + 0.2 * (tier - 1)); }' + String.fromCharCode(10) + '}');
  const pb = planted.slice(planted.indexOf('function genTavern('));
  if (pb.includes('1 + 0.2 * (tier - 1)')) pass('검사가 실제로 문다 (옛 선형 배율을 심으면 걸린다)');
  else ok(false, '검사가 실제로 문다', '옛 식을 심었는데 못 잡았다');
  /* 주석 안의 같은 문구는 안 걸려야 한다 — 그게 이 검사를 한 번 헛돌게 만든 원인이다 */
  const onlyComment = strip('function genTavern() { /* 옛날엔 1 + 0.2 * (tier - 1) 이었다 */ const x = 1; }');
  if (!onlyComment.includes('1 + 0.2 * (tier - 1)')) pass('주석 안의 옛 식은 오탐하지 않는다');
  else ok(false, '주석 오탐 방지', '주석을 못 걷어냈다');

  /* 숫자로도 확인한다 — 소스 문자열만 보면 «식은 맞는데 값이 이상한» 경우를 놓친다 */
  const Q = need('game/quest.js');
  if (!Q) ok(false, '보상 지수를 못 읽었다');
  else {
    const at = (t) => Q.cityPowerOf(t) ** Q.CITY_REWARD_POW;
    const bad = [];
    if (Math.abs(at(1) - 1) > 1e-9) bad.push(`1등급 배율이 ${at(1).toFixed(3)} 다 — 초반은 안 건드려야 한다`);
    for (let t = 2; t <= 5; t++) if (at(t) <= at(t - 1)) bad.push(`${t}등급 배율이 ${t - 1}등급 이하다`);
    /* 5등급이 옛 식(1.80)보다 확실히 비싸야 한다 — 안 그러면 고친 의미가 없다 */
    if (at(5) < 1.8 * 1.5) bad.push(`5등급 배율 ${at(5).toFixed(2)} — 옛 1.80 대비 1.5배도 안 된다`);
    okAll(bad, '배율이 1등급 1.00 에서 시작해 단조 증가하고 5등급이 확실히 비싸다', 6);
  }
}

section('전투 단축키');
{
  /* ★ 렌더러와 마찬가지로 battle.js 도 DOM 을 써서 node 로 못 돌린다 — 소스를 읽는다.
   *
   * ★★ 지켜야 하는 것 (HANDOFF 6차 세션 검수표에 «전투 이탈 시 keydown 리스너 0» 이 있다):
   *   1. 배속 단축키는 SPEEDS 를 **자리로** 고른다. 값을 손으로 적으면 배열을 고칠 때 어긋난다.
   *   2. 글자 입력(INPUT/TEXTAREA/SELECT/contenteditable)·모달·키 반복 중에는 안 먹는다.
   *      주점 이름 입력창은 모달이 아니라 화면 본문에 있어서 태그 검사가 반드시 필요하다.
   *   3. 리스너를 떼는 곳은 dispose() 다. detachInput() 에 얹으면 결과 화면에서 죽어
   *      정작 필요한 d/f 가 안 먹는다 — 그게 이 단축키를 넣은 이유인데 말이다.
   *
   * ★ 정규식을 안 쓴다. 이 저장소에서 heredoc 이 백슬래시를 먹어 «통과만 하고 아무것도
   *   안 잡는 검사» 를 만든 적이 여러 번이라, 글자 찾기로만 짠다. */
  /* ★ 저장소 파일은 CRLF 다. 줄바꿈으로 자리를 재는 검사는 반드시 먼저 정규화해라 —
   *   안 하면 «심어도 안 걸리는» 검사가 된다 (실제로 그랬다). */
  const src = readFileSync(srcDir('ui/battle.js'), 'utf8').split(String.fromCharCode(13)).join('');
  const has = (x) => src.includes(x);
  const NLC = String.fromCharCode(10);
  /** from 으로 시작하는 함수 본문을 그 다음 «줄머리 }» 까지 잘라 온다 */
  const bodyOf = (from) => {
    const a = src.indexOf(from);
    if (a < 0) return '';
    const b = src.indexOf(NLC + '}', a + from.length);
    return b < 0 ? src.slice(a) : src.slice(a, b);
  };
  /** const SPEEDS = [ ... ] 안의 숫자들 */
  const speedsOf = (text) => {
    const a = text.indexOf('const SPEEDS = [');
    if (a < 0) return [];
    const b = text.indexOf(']', a);
    return text.slice(a + 'const SPEEDS = ['.length, b)
      .split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
  };

  const faults = [];
  const speeds = speedsOf(src);
  if (!speeds.length) faults.push('SPEEDS 를 못 읽었다');
  if (speeds.includes(0.5)) faults.push('0.5x 가 아직 있다 — 숫자키를 1·2·3 으로 쓰기로 했다');
  if (speeds.length > 9) faults.push(`배속이 ${speeds.length} 개다 — 숫자키는 9 개뿐이다`);
  if (!has("'123456789'.indexOf(k)")) faults.push('배속 단축키가 SPEEDS 자리를 안 쓴다 (값을 손으로 적으면 어긋난다)');
  if (!has('SPEEDS[i]')) faults.push('단축키가 SPEEDS 에서 값을 안 꺼낸다');
  for (const guard of ['isContentEditable', "getElementById('modal-layer')", 'ev.repeat']) {
    if (!has(guard)) faults.push(`단축키에 ${guard} 방어가 없다`);
  }
  if (!has('S.offHotkey')) faults.push('단축키 리스너를 떼는 곳이 없다 — 전투를 나가도 키가 살아 있다');
  if (!bodyOf('export function dispose()').includes('S.offHotkey')) {
    faults.push('dispose() 가 단축키 리스너를 안 뗀다');
  }
  if (bodyOf('function detachInput()').includes('offHotkey')) {
    faults.push('detachInput() 이 단축키를 뗀다 — 결과 화면에서 d/f 가 죽는다');
  }
  okAll(faults, '단축키가 배열과 붙어 있고, 입력·모달·반복을 막고, 제때 떨어진다', 10);

  /* ★ 무는 시늉만 하는 검사를 이 저장소에서 여러 번 만들었다 — 실제로 무는지 확인한다 */
  const bit = speedsOf('const SPEEDS = [0.5, 1, 2, 4];').includes(0.5);
  if (bit) pass('검사가 실제로 문다 (0.5x 를 되살리면 걸린다)');
  else ok(false, '검사가 실제로 문다', 'SPEEDS 를 되돌려 심었는데 못 잡았다');
}

section('결과 화면은 보상을 전과보다 먼저 보여준다');
{
  /* ★★ 제작자: 「보상이 스크롤 넘어가서 바로 안 보이는데 보상이 더 궁금하다」.
   *   전과 표는 6열이라 세로를 많이 먹어서, 그 아래 보상을 두면 폰에서 결과를 열자마자
   *   보이는 게 «준 피해 표» 뿐이었다. 붙이는 순서가 곧 화면 순서다. */
  /* ★ 저장소 파일은 CRLF 다. 줄바꿈으로 자리를 재는 검사는 반드시 먼저 정규화해라 —
   *   안 하면 «심어도 안 걸리는» 검사가 된다 (실제로 그랬다). */
  const src = readFileSync(srcDir('ui/battle.js'), 'utf8').split(String.fromCharCode(13)).join('');
  const r = src.indexOf('root.appendChild(reward);');
  const c = src.indexOf('root.appendChild(record);');
  const faults = [];
  if (r < 0) faults.push('보상 패널을 붙이는 곳을 못 찾았다');
  if (c < 0) faults.push('전과 패널을 붙이는 곳을 못 찾았다');
  if (r >= 0 && c >= 0 && r > c) faults.push('전과가 보상보다 먼저 붙는다 — 순서가 뒤집혔다');

  /* ★ 자동 판매 줄이 «전리품이 하나도 안 남았을 때» 에만 보이는 버그가 있었다.
   *   두 줄이 else 블록 안에 들여쓰기만 어긋난 채 갇혀 있었다. 다시 갇히면 잡는다. */
  const soldAt = src.indexOf('const soldLine = autoSoldLine();');
  const ifAt = src.indexOf('if (items.length) {');
  if (soldAt < 0) faults.push('자동 판매 줄을 못 찾았다');
  else if (ifAt < 0) faults.push('전리품 분기를 못 찾았다');
  else if (soldAt < ifAt) faults.push('자동 판매 줄이 전리품 분기보다 앞에 있다');
  else if (soldAt < ifEnd(src, ifAt)) {
    faults.push('자동 판매 줄이 전리품 if/else 안에 있다 — 전리품이 남으면 판매 골드가 안 보인다');
  }
  okAll(faults, '보상이 먼저 오고, 자동 판매 줄이 갇혀 있지 않다', 4);

  /* ★★ 이 검사는 **처음에 헛돌았다.** 「soldLine 앞의 가장 가까운 } 를 본다」 로 짰는데,
   *   바로 윗줄 `...}));` 의 } 가 먼저 걸려서 버그를 심어도 통과했다.
   *   중괄호 깊이로 다시 짜고, 아래에서 실제로 무는지 확인한다. */
  const buggy = plantSoldLineInsideElse(src);
  const bitten = buggy !== src && soldAt >= 0
    && buggy.indexOf('const soldLine = autoSoldLine();') < ifEnd(buggy, buggy.indexOf('if (items.length) {'));
  if (bitten) pass('검사가 실제로 문다 (자동 판매 줄을 else 안에 심으면 걸린다)');
  else ok(false, '검사가 실제로 문다', '옛 버그를 심었는데 못 잡았다');
}

/** `if (...) {` 자리에서 시작해 그 if/else 사슬이 **끝나는** 위치를 돌려준다 */
function ifEnd(src, at) {
  if (at < 0) return -1;
  let i = src.indexOf('{', at);
  if (i < 0) return -1;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // `} else {` 면 사슬이 이어진다 — 다음 블록까지 따라간다
        const rest = src.slice(i, i + 10);
        if (rest.startsWith('} else')) { const n = src.indexOf('{', i); if (n > 0) { i = n; depth = 1; continue; } }
        return i;
      }
    }
  }
  return src.length;
}

/** 옛 버그를 그대로 되살린다 — 자동 판매 두 줄을 else 블록 **안**으로 옮긴다 */
function plantSoldLineInsideElse(src) {
  const two = 'const soldLine = autoSoldLine();' + String.fromCharCode(10)
    + '  if (soldLine) reward.appendChild(soldLine);';
  const cut = src.indexOf('  ' + two);
  if (cut < 0) return src;
  const without = src.slice(0, cut) + src.slice(cut + two.length + 2);
  const anchor = without.indexOf("text: win ? '쓸 만한 전리품은 없었다.'");
  if (anchor < 0) return src;
  const eol = without.indexOf(String.fromCharCode(10), anchor);
  return without.slice(0, eol + 1) + '  ' + two + String.fromCharCode(10) + without.slice(eol + 1);
}

section('순위표 «착용 칸 수» 가 실제 착용 수인가');
{
  /* ★★ state.js 의 normalizeEquipment 가 장비 10칸을 **null 로 채운다.**
   *   그래서 Object.keys(equipment).length 로 세면 **누구나 항상 10** 이 나온다 —
   *   순위표에 전원 «착용 10칸» 으로 올라가고 있었다 (실측: 실제 2, 표시 10).
   *   글자로 막지 말고 **실제로 굴려서** 잰다 — rules.js 는 node 로 돌아간다. */
  const Rules2 = need('game/rules.js');
  const st = State.newGame('검사용');
  const sc = Rules2 && Rules2.extractScore(st);
  const m0 = sc && sc.squadsFull && sc.squadsFull[0] && sc.squadsFull[0].m && sc.squadsFull[0].m[0];
  if (!m0) { ok(false, '순위표 스냅샷에서 단원을 못 꺼냈다'); } else {
    const st2 = State.newGame('검사용');
    const raw = (st2.roster || [])[0] || {};
    const real = Object.values(raw.equipment || {}).filter(Boolean).length;
    const slots = Object.keys(raw.equipment || {}).length;
    ok(m0.e === real && slots > real,
      `착용 칸 수가 실제 착용 수다 (칸 ${slots} 중 ${real} 착용 → e=${m0.e})`,
      `e=${m0.e} 인데 실제 착용은 ${real} 이다 (칸은 ${slots})`);
  }
}

section('근접이 목표를 «계속» 따라가나');
{
  /* ★★ 제작자 지적: 「접근이 앞으로만 가고 타겟에 안 붙는다. 타겟이 죽으면 어정쩡하게 멈춘다」.
   *   원인은 lunge 순간의 좌표로 stand 를 한 번 계산하고 **얼렸던** 것이다.
   *   실측: 근접 전원이 ox=187·oy=0 한 자리에 모여 굳어 있었다.
   *
   *   고친 뒤에는 매 프레임 aimStand 가 목표의 현재 위치를 다시 잰다.
   *   ★ 이 «매 프레임 호출» 이 사라지면 증상이 그대로 돌아온다 — 그래서 글자로 지킨다.
   *     (렌더러는 DOM 을 써서 node 로 실행할 수 없다.)
   *
   * ★ 목표는 **집(homeX/homeY)** 으로 잰다. 현재 그려지는 위치(+ox)를 서로 쫓으면 발산한다 —
   *   실측으로 겪었다: oy 가 14초 만에 -1976 까지 날아갔다. */
  const rsrc = readFileSync(srcDir('battle/renderer.js'), 'utf8');
  const check = (src) => {
    const faults = [];
    if (!/function aimStand\s*\(/.test(src)) faults.push('aimStand 가 없다');
    if (!/v\.foe != null && v\.dieT < 0\) aimStand\(v\)/.test(src)) {
      faults.push('매 프레임 aimStand 호출이 없다 — 자리를 얼리면 타겟이 죽어도 안 움직인다');
    }
    /* 목표 좌표에 +ox/+oy 를 더하면 서로 쫓다가 발산한다 */
    const i = src.indexOf('function aimStand');
    const body = i >= 0 ? src.slice(i, i + 2200) : '';
    if (/const tx = homeX\(t\.u\) \+/.test(body) || /const ty = homeY\(t\.u\) \+/.test(body)) {
      faults.push('목표를 현재 위치(+ox/+oy)로 잰다 — 서로 쫓으면 발산한다');
    }
    return faults;
  };
  okAll(check(rsrc), '근접은 목표의 «집» 을 매 프레임 다시 조준한다', 3);

  /* ★★ 제작자 지적 2: 「왜 근접이 서로 반대쪽에 있지」.
   *   양쪽이 **상대의 집**을 조준하니 아군은 적 집의 왼쪽, 적은 아군 집의 오른쪽에 서려 했다.
   *   둘 다 상대를 지나쳐 자리가 뒤바뀌었다 — 실측 181프레임 중 165프레임에서 통과, 최대 378px.
   *   두 최전선의 한가운데를 벽으로 삼아 막는다. */
  const wall = (src) => {
    const f2 = [];
    const i = src.indexOf('function aimStand');
    const body = i >= 0 ? src.slice(i, i + 2600) : '';
    if (!/frontLineX\('ally'\) \+ frontLineX\('enemy'\)/.test(body)) f2.push('중앙선(midline)을 안 구한다');
    if (!/Math\.min\(wantX, mid - MIDLINE_GAP_PX\)/.test(body)) f2.push('아군이 중앙선을 넘는 걸 안 막는다');
    if (!/Math\.max\(wantX, mid \+ MIDLINE_GAP_PX\)/.test(body)) f2.push('적군이 중앙선을 넘는 걸 안 막는다');
    /* 부채꼴은 벽에 눌린 «뒤» 에 빼야 한다 — 먼저 빼면 벽이 먹어서 전원이 일렬로 눌린다 */
    const clampAt = body.indexOf('MIDLINE_GAP_PX');
    const backAt = body.indexOf('wantX -= d * back');
    if (backAt < 0) f2.push('부채꼴(back)을 적용하지 않는다');
    else if (backAt < clampAt) f2.push('부채꼴을 벽보다 먼저 적용한다 — 벽이 먹어서 일렬로 눌린다');
    return f2;
  };
  okAll(wall(rsrc), '근접은 진영 중앙선을 넘지 않는다 (서로 통과 금지)', 4);
  const wallBit = wall(rsrc.replace('wantX -= d * back;', ''));
  if (wallBit.length) pass('검사가 실제로 문다 (부채꼴을 빼면 걸린다)', wallBit[0]);
  else ok(false, '검사가 실제로 문다', '부채꼴을 뺐는데 검사가 안 걸렸다');

  /* 통과만 하는 검사를 여러 번 만들었다 — 실제로 무는지 확인한다 */
  const bitten = check(rsrc.replace('v.foe != null && v.dieT < 0) aimStand(v)', 'false) aimStand(v)'));
  if (bitten.length) pass('검사가 실제로 문다 (매 프레임 호출을 빼면 걸린다)', bitten[0]);
  else ok(false, '검사가 실제로 문다', '호출을 뺐는데 검사가 안 걸렸다');
}

section('근접 연출에 «돌아가는 길» 이 없나');
{
  /* ★★ 실제로 당한 것: 근접이 왔다갔다 하는 게 안 보기 싫다고 해서 «다가가 머문다» 로
   *   바꿨는데, «한참 안 때리면 제자리로» 라는 타임아웃을 하나 남겨 뒀다.
   *   그게 그대로 왕복이었다 — 실측으로 ox 가 0→187→35→186 을 반복했다.
   *   연출이 되돌아가는 길을 **하나라도** 가지고 있으면 왕복은 다시 생긴다.
   *
   * ★ 그래서 «v.stand 를 비우는 곳» 이 사망 처리 단 한 군데인지 글자로 확인한다.
   *   렌더러는 DOM 을 써서 node 로 실행할 수 없으니 소스를 읽는 수밖에 없다. */
  const check = (src) => {
    const faults = [];
    const hits = [];
    for (let i = src.indexOf('stand = null'); i >= 0; i = src.indexOf('stand = null', i + 1)) hits.push(i);
    if (!hits.length) faults.push('v.stand 를 비우는 곳이 아예 없다 (사망 시 정리가 빠졌다)');
    if (hits.length > 1) faults.push(`v.stand 를 비우는 곳이 ${hits.length} 군데다 — 사망 처리 하나여야 한다`);
    for (const i of hits) {
      if (!src.slice(Math.max(0, i - 400), i).includes('v.dieT >= 0')) {
        faults.push('사망 처리 밖에서 v.stand 를 비운다 — 그 길이 곧 왕복이다');
      }
    }
    return faults;
  };
  const rsrc = readFileSync(srcDir('battle/renderer.js'), 'utf8');
  okAll(check(rsrc), '근접은 붙으면 죽을 때까지 안 돌아온다', 1);

  /* ★ 이 저장소에서 «통과만 하고 아무것도 안 잡는 검사» 를 여러 번 만들었다.
   *   그래서 검사가 실제로 무는지 여기서 확인한다. */
  const bitten = check(rsrc.replace('function onProj', 'function _x() { v.stand = null; } function onProj'));
  /* ok() 는 통과하면 아무것도 안 찍는다 — 메타 검사야말로 «돌았다» 가 보여야 하므로 pass() 로 찍는다 */
  if (bitten.length) pass('검사가 실제로 문다 (복귀 경로를 심으면 걸린다)', bitten[0]);
  else ok(false, '검사가 실제로 문다', '복귀 경로를 심었는데 검사가 안 걸렸다');
}

section('고용 계량기 — S 가 나올 수 있는 횟수였나');
{
  const R = need('game/rules.js');
  if (!R) { ok(false, '규칙 모듈을 못 읽었다'); } else {
    const prev = { day: 100, questsDone: 100, gold: 0, renown: 0, sMercs: 2, specHires: 40 };
    const at = (sM, spec) => R.checkGrowth(prev,
      { day: 140, questsDone: 140, gold: 0, renown: 0, sMercs: sM, specHires: spec }).length > 0;

    /* ★ 통과만 하고 아무것도 안 잡는 검사를 이 저장소에서 여러 번 만들었다.
     *   그래서 «정상은 통과하고 치트는 잡히는가» 를 **양쪽 다** 본다. */
    okAll([
      at(4, 80) ? '정상(명물 40회에 S 2명)을 잘못 잡는다' : null,
      at(8, 80) ? '운 좋은 경우(명물 40회에 S 6명)를 잘못 잡는다' : null,
      at(13, 40) ? null : '고용 0회에 S 11명이 늘어난 것을 못 잡는다',
      at(12, 45) ? null : '명물 5회에 S 10명이 늘어난 것을 못 잡는다',
    ].filter(Boolean), 'S 획득률 검사가 정상은 통과시키고 치트는 잡는다', 4);

    /* 계량기가 없던 옛 세이브(전부 0)가 걸리면 안 된다 — 증가분끼리 비교하는 이유다 */
    const legacy = R.checkGrowth(
      { day: 100, questsDone: 100, gold: 0, renown: 0, sMercs: 30, specHires: 0 },
      { day: 101, questsDone: 101, gold: 0, renown: 0, sMercs: 30, specHires: 0 });
    okAll(legacy, '계량기가 0 인 옛 세이브는 안 걸린다', 1);

    ok(R.S_CHANCE_MAX > 0 && R.S_CHANCE_MAX <= 0.1 && R.S_LUCK_SLACK >= 2,
      '상한이 넉넉하다 (운 좋은 사람을 날리지 않는다)',
      `S 확률 ${R.S_CHANCE_MAX} × 여유 ${R.S_LUCK_SLACK} = 실효 ${(R.S_CHANCE_MAX * R.S_LUCK_SLACK * 100).toFixed(0)}%`);
  }
}

section('정면 포즈 판·클래스 얼굴의 기하');
{
  /* ★ «포즈 판»(plate_*) 과 클래스 얼굴(face_*) 은 좌표 규약이 어긋나면
   *   발이 땅에서 뜨거나 머리카락이 두개골 밖으로 샌다 — 화면 전체가 한꺼번에 이상해진다.
   *   규약:
   *     plate: ay === h - 66 (마지막 줄 = 화면 y113 = 발바닥) · 마지막 줄에 그림이 있다
   *     face : 정확히 36x38 · 앵커 (18,36) · head_human 과 실루엣 거의 동일 (머리카락 호환)
   *   아직 없는 파츠는 건너뛴다 — 계열별로 순차 반영 중일 수 있다. */
  const FP = need('art/parts_front.js');
  if (!FP) { ok(false, '정면 파츠 모듈을 못 읽었다'); } else {
    const names = Object.keys(FP.FRONT_PARTS || {});
    const plates = names.filter((n) => n.startsWith('plate_'));
    const faces = names.filter((n) => n.startsWith('face_'));
    const faults = [];
    for (const n of plates) {
      const p = FP.getFrontPart(n);
      if (p.ay !== p.h - 66) faults.push(`${n}: ay(${p.ay}) != h-66(${p.h - 66}) — 발이 y113 에 안 닿는다`);
      const last = p.px[p.h - 1] || '';
      if ([...last].filter((c) => c !== '.').length < 4) faults.push(`${n}: 마지막 줄(발바닥)이 비었다`);
      if (p.px.length !== p.h || p.px.some((r) => r.length !== p.w)) faults.push(`${n}: 행렬 크기가 어긋난다`);
    }
    const head = FP.getFrontPart('head_human');
    for (const n of faces) {
      const p = FP.getFrontPart(n);
      if (p.w !== 36 || p.h !== 38 || p.ax !== 18 || p.ay !== 36) {
        faults.push(`${n}: 36x38 앵커(18,36) 이어야 한다 (지금 ${p.w}x${p.h} 앵커 ${p.ax},${p.ay})`);
        continue;
      }
      if (head) {
        let diff = 0;
        for (let y = 0; y < 38; y++) for (let x = 0; x < 36; x++) {
          if (((p.px[y] || '')[x] === '.') !== ((head.px[y] || '')[x] === '.')) diff++;
        }
        if (diff > 80) faults.push(`${n}: head_human 과 실루엣이 ${diff}칸 다르다 (80 이하) — 머리카락이 안 맞는다`);
      }
    }
    /* 일러스트(통짜) — ay 는 발바닥 행: 그 아래는 거의 비고, 근처엔 그림이 있다 */
    const ills = names.filter((n) => n.startsWith('illust_'));
    for (const n of ills) {
      const p = FP.getFrontPart(n);
      if (p.px.length !== p.h || p.px.some((r) => r.length !== p.w)) { faults.push(`${n}: 행렬 크기가 어긋난다`); continue; }
      if (p.ay >= p.h) faults.push(`${n}: ay(${p.ay}) 가 캔버스 밖`);
      const below = p.px.slice(p.ay + 1).reduce((a2, row) => a2 + [...row].filter((c) => c !== '.').length, 0);
      if (below > 60) faults.push(`${n}: 발바닥(ay=${p.ay}) 아래에 ${below}칸 — 발이 땅에 안 닿는다`);
      let near = 0;
      for (let y = Math.max(0, p.ay - 3); y <= Math.min(p.h - 1, p.ay); y++) {
        near += [...(p.px[y] || '')].filter((c) => c !== '.').length;
      }
      if (near < 8) faults.push(`${n}: 발바닥 근처가 비었다`);
    }
    /* 전투 통짜 시트(bt_*) — 96x120 · 앵커(48,114) · 지면 접촉 · 발 아래 비움.
     * 열 장이 «전부» 있어야 spritegen 이 쓴다 — 반쪽 시트는 여기서 걸린다. */
    const bts = names.filter((n) => n.startsWith('bt_'));
    const SHEET_KEYS = ['idleA', 'idleB', 'walkA', 'walkB', 'atk0', 'atk1', 'atk2', 'hit0', 'die0', 'die1'];
    const styles = [...new Set(bts.map((n) => n.replace(/^bt_/, '').replace(/_[^_]+$/, '')))];
    for (const st0 of styles) {
      const missing = SHEET_KEYS.filter((k) => !names.includes(`bt_${st0}_${k}`));
      if (missing.length) faults.push(`bt_${st0}: 프레임이 빠졌다 — ${missing.join(', ')} (반쪽 시트는 안 쓰인다)`);
    }
    for (const n of bts) {
      const p = FP.getFrontPart(n);
      if (p.w !== 96 || p.h !== 120 || p.ax !== 48 || p.ay !== 114) {
        faults.push(`${n}: 96x120 앵커(48,114) 이어야 한다 (지금 ${p.w}x${p.h} 앵커 ${p.ax},${p.ay})`);
        continue;
      }
      let ground = 0; let below = 0;
      for (let y = 106; y <= 114; y++) ground += [...(p.px[y] || '')].filter((c) => c !== '.').length;
      for (let y = 116; y < 120; y++) below += [...(p.px[y] || '')].filter((c) => c !== '.').length;
      if (ground < 6) faults.push(`${n}: 지면(행 106~114)에 안 닿는다`);
      if (below > 20) faults.push(`${n}: 발 아래(행 116~)에 ${below}칸`);
    }
    /* ★ 전용 프레임(shoot/cast/guard)이 «있으면 실제로 쓰이는가».
     *   별칭으로만 물러나면 활 쏘는 그림을 그려 넣어도 검 휘두르는 그림이 나온다 —
     *   화면에는 «그냥 예전 그대로» 로 보여서 안 잡히는 종류의 버그다. */
    const SG = need('art/spritegen.js');
    if (SG && SG.sheetPartName) {
      const optFaults = [];
      for (const st0 of styles) {
        for (const k of ['shoot0', 'shoot1', 'shoot2', 'cast0', 'cast1', 'cast2', 'guard0']) {
          if (!names.includes(`bt_${st0}_${k}`)) continue;
          const got = SG.sheetPartName(`bt_${st0}`, k);
          if (got !== `bt_${st0}_${k}`) optFaults.push(`bt_${st0}_${k} 를 그려 넣었는데 ${got} 가 쓰인다`);
        }
      }
      /* 메타 검사 — 없는 전용 프레임은 반드시 별칭으로 물러나야 한다
       * (항상 전용 이름을 돌려주면 위 검사가 영영 안 물린다) */
      const back = SG.sheetPartName('bt_존재하지않는스타일', 'shoot0');
      if (back !== 'bt_존재하지않는스타일_atk0') optFaults.push(`전용 프레임이 없을 때 별칭(atk0)으로 안 물러난다 — ${back}`);
      okAll(optFaults, '전용 전투 프레임은 있으면 쓰이고 없으면 별칭으로 물러난다', 2);
    }
    okAll(faults, `포즈 판 ${plates.length}·얼굴 ${faces.length}·일러스트 ${ills.length}·전투 프레임 ${bts.length}개가 좌표 규약을 지킨다`,
      Math.max(1, plates.length + faces.length + ills.length + bts.length));

    /* 판이 있으면 canDraw 경로도 성립해야 한다 — 얼굴이 함께 있어야 조립이 선다 */
    const archOf = (n) => n.replace(/^plate_/, '');
    const missing = plates.map(archOf).filter((a) => !faces.includes(`face_${a}`));
    okAll(missing.map((a) => `plate_${a} 는 있는데 face_${a} 가 없다`),
      '판이 있는 계열은 얼굴도 있다', Math.max(1, plates.length));
  }
}

section('적 통짜 시트 배정');
{
  /* ★ 적에게 battleSheet 를 달아 놓고 시트를 안 그리면 spritegen 이 조용히 조립으로
   *   물러난다 — 화면은 «예전 그대로» 라 안 잡힌다. 배정과 그림을 짝지어 검사한다.
   *   반대로 무기 든 인간형에 시트를 달면 «고블린 궁수가 단검을 든다» 가 된다. */
  const EN = need('data/enemies.js');
  const FP = need('art/parts_front.js');
  if (!EN || !FP) { ok(false, '적·파츠 모듈을 못 읽었다'); } else {
    const names = Object.keys(FP.FRONT_PARTS || {});
    const KEYS = ['idleA', 'idleB', 'walkA', 'walkB', 'atk0', 'atk1', 'atk2', 'hit0', 'die0', 'die1'];
    const list = Object.values(EN.ENEMIES || {});
    const assigned = list.filter((e) => e.sprite && e.sprite.battleSheet);
    const faults = [];
    const sheets = [...new Set(assigned.map((e) => e.sprite.battleSheet))];
    for (const sh of sheets) {
      const missing = KEYS.filter((k) => !names.includes(`${sh}_${k}`));
      if (missing.length) faults.push(`${sh}: 배정된 적이 있는데 프레임이 없다 — ${missing.slice(0, 3).join(', ')}...`);
    }
    /* 시트는 무기를 함께 굽는다 — 무기를 든 적에게 달면 안 된다 (wpn_none/claw 만 허용) */
    const OKW = ['wpn_none', 'wpn_claw', undefined, null, ''];
    for (const e of assigned) {
      const w = e.sprite.weapon;
      if (!OKW.includes(w)) faults.push(`${e.name}: ${w} 를 들었는데 통짜 시트(${e.sprite.battleSheet})가 배정됐다 — 무기가 그림에 구워진다`);
    }
    /* 펫도 같은 규약 — 다만 펫은 무기를 안 든다 (시트가 몸 전체를 그린다) */
    const PT = need('data/pets.js');
    const pets = PT ? Object.values(PT.PETS || {}).filter((p) => p.sprite && p.sprite.battleSheet) : [];
    for (const sh of [...new Set(pets.map((p) => p.sprite.battleSheet))]) {
      const missing = KEYS.filter((k) => !names.includes(`${sh}_${k}`));
      if (missing.length) faults.push(`${sh}: 배정된 펫이 있는데 프레임이 없다 — ${missing.slice(0, 3).join(', ')}...`);
    }
    okAll(faults, `통짜 시트를 쓰는 적 ${assigned.length}종·펫 ${pets.length}종이 시트·무기 규약을 지킨다`,
      Math.max(1, assigned.length + pets.length));
  }
}

section('던전 하루 1회 · 구걸');
{
  /* ★★ 제작자 지적 두 건:
   *   (1) 「던전이 안 죽고 그만두고 다시 1웨이브부터 할 수 있는데,
   *       그 주에 한 번 진행한 부대는 다시 못 하도록 막아 줘」
   *   (2) 「초반에 골드가 너무 부족하다. 1등급 도시에서 매일 한 번 구걸로 100~1000골드」
   *
   * ★ 둘 다 **날짜/주차 경계**가 핵심이라 경계를 직접 넘겨 본다.
   *   경계를 안 넘겨 보면 «한 번은 되더라» 만 확인하고 끝난다. */
  const D = need('game/dungeon.js');
  const S = need('game/state.js');
  if (!D || !S) { ok(false, '모듈을 못 읽었다'); } else {
    const faults = [];

    // ── 던전: 부대마다 하루 1회 (이어 가기는 안 센다)
    S.newGame(9, '일일검사');
    const st = S.state;
    const sqid = (st.squads || [])[0] && st.squads[0].id;
    if (!sqid) faults.push('검사 판을 못 차렸다: 부대가 없다');
    else {
      const d0 = st.day;
      if (D.squadUsedToday(st, sqid)) faults.push('아무것도 안 했는데 이미 썼다고 나온다');
      D.markSquadRun(st, sqid);
      if (!D.squadUsedToday(st, sqid)) faults.push('표시했는데 안 썼다고 나온다');
      st.day = d0 + 1;
      if (D.squadUsedToday(st, sqid)) faults.push('날짜를 넘겼는데 안 풀린다');
      st.day = d0;
      if (D.squadUsedToday(st, 'squad_없음')) faults.push('다른 부대까지 막힌다');
    }

    // ── 구걸: 1등급 도시 · 하루 한 번 · 100~1000
    S.newGame(9, '구걸검사');
    const s2 = S.state;
    s2.cityId = 'greenhold';                     // 1등급
    const g0 = s2.gold;
    const r1 = S.beg(s2);
    if (!r1.ok) faults.push(`1등급 도시에서 구걸이 안 된다: ${r1.reason}`);
    if (r1.gold < S.BEG_MIN || r1.gold > S.BEG_MAX) faults.push(`구걸 금액 ${r1.gold} 이 ${S.BEG_MIN}~${S.BEG_MAX} 밖이다`);
    if (s2.gold !== g0 + r1.gold) faults.push('구걸한 만큼 골드가 안 늘었다');
    const r2 = S.beg(s2);
    if (r2.ok) faults.push('같은 날 두 번 구걸된다');
    s2.day += 1;
    if (!S.beg(s2).ok) faults.push('날짜가 지나도 구걸이 안 풀린다');
    s2.cityId = 'frostgate';                     // 5등급
    s2.day += 1;
    if (S.beg(s2).ok) faults.push('고등급 도시에서도 구걸이 된다');

    okAll(faults, '던전은 부대마다 하루 1회, 구걸은 1등급 도시에서 하루 한 번', 10);

    /* ★★ **이어 가기가 막히면 안 된다.** 처음에 웨이브마다 «썼다» 를 세는 바람에
     *   1웨이브를 깬 뒤 2웨이브로 못 갔다 (제작자가 바로 잡아 줬다).
     *   ui/dungeon.js 는 DOM 을 써서 node 로 못 돌리므로 소스로 확인한다:
     *     · beginRun 은 **1웨이브일 때만** 표시한다
     *     · deployPanel 은 이어 가는 중이면 `resuming` 을 넘겨 게이트를 건너뛴다 */
    const strip = (x) => {
      let out = ''; let i = 0;
      while (i < x.length) {
        if (x[i] === '/' && x[i + 1] === '*') { const e = x.indexOf('*/', i + 2); i = e < 0 ? x.length : e + 2; continue; }
        if (x[i] === '/' && x[i + 1] === '/') { const e = x.indexOf(String.fromCharCode(10), i); i = e < 0 ? x.length : e; continue; }
        out += x[i]; i++;
      }
      return out;
    };
    const usrc = strip(readFileSync(srcDir('ui/dungeon.js'), 'utf8').split(String.fromCharCode(13)).join(''));
    const ubad = [];
    const bi = usrc.indexOf('function beginRun(');
    const bbody = bi < 0 ? '' : usrc.slice(bi, usrc.indexOf(String.fromCharCode(10) + '}', bi));
    if (!bbody) ubad.push('beginRun 을 못 찾았다');
    else if (!bbody.includes('waveIndex === 0')) {
      ubad.push('beginRun 이 웨이브를 안 가리고 표시한다 — 2웨이브로 못 간다');
    }
    if (!usrc.includes('opt.resuming')) ubad.push('deployInfo 가 resuming 을 안 본다');
    if (!usrc.includes('function resumeOwner(')) {
      ubad.push('이어 가는 판의 «주인» 을 정하는 곳이 없다 — 화면 선택으로 판정하면 부대마다 다르게 군다');
    }
    /* ★★ **이어 가기를 묻는 곳이 넷이다.** 하나라도 빠지면 그 경로만 막힌다 —
     *   실제로 그렇게 «어떤 부대는 되고 어떤 부대는 안 되는» 상태가 됐다:
     *     deployPanel(버튼) · 카드 목록 · autoNext(자동 진행) · askEnter(확인창)
     *   넷 다 resuming 을 넘기는지 글자로 확인한다. */
    const askAt = usrc.indexOf('function askEnter(');
    const askBody = askAt < 0 ? '' : usrc.slice(askAt, usrc.indexOf(String.fromCharCode(10) + '}', askAt));
    if (!askBody.includes('resuming: waveIndex > 0')) {
      ubad.push('askEnter(확인창)가 resuming 을 안 넘긴다 — 「들어간다」 에서 튕긴다');
    }
    const autoAt = usrc.indexOf('params.autoNext');
    const autoBody = autoAt < 0 ? '' : usrc.slice(autoAt, autoAt + 700);
    if (!autoBody.includes('resuming: true')) {
      ubad.push('자동 진행이 resuming 을 안 넘긴다 — 1웨이브 뒤 자동으로 안 이어진다');
    }
    if (!autoBody.includes('outcome.squadId')) {
      ubad.push('자동 진행이 판의 주인을 안 본다 — 엉뚱한 부대가 다음 웨이브에 들어갈 수 있다');
    }
    if ((usrc.split('resuming:').length - 1) < 4) {
      ubad.push(`resuming 을 넘기는 곳이 ${usrc.split('resuming:').length - 1} 곳뿐이다 — 넷이어야 한다`);
    }
    okAll(ubad, '이어 가기를 묻는 네 경로가 모두 판의 주인을 본다', 6);

    /* ★ 무는 시늉만 하는 검사를 여러 번 만들었다 — 표시를 지우면 걸리는지 본다 */
    const planted = usrc.replace('waveIndex === 0', 'true');
    const pi = planted.indexOf('function beginRun(');
    const pbody = planted.slice(pi, planted.indexOf(String.fromCharCode(10) + '}', pi));
    if (!pbody.includes('waveIndex === 0')) pass('검사가 실제로 문다 (웨이브 구분을 지우면 걸린다)');
    else ok(false, '검사가 실제로 문다', '지웠는데 그대로 남아 있다');

    /* ★ 무는 시늉만 하는 검사를 여러 번 만들었다 — 경계가 실제로 물리는지 확인한다 */
    S.newGame(9, '메타');
    const s3 = S.state;
    const id3 = s3.squads[0].id;
    D.markSquadRun(s3, id3);
    const stuck = D.squadUsedToday(s3, id3);
    s3.day += 1;
    const freed = !D.squadUsedToday(s3, id3);
    if (stuck && freed) pass('검사가 실제로 문다 (같은 날 막히고 다음 날 풀린다)');
    else ok(false, '검사가 실제로 문다', `같은날막힘 ${stuck} / 다음날풀림 ${freed}`);
  }
}

section('자동 착용 — 뺏기 · 잠금 · 세트 임자');
{
  /* ★ 제작자 요청 3건을 한 번에 지킨다:
   *   (2) 남이 낀 장비도 가져올 수 있게  (3) 잠근 것은 못 가져가게
   *   (4) 「성좌의 은총」은 사제 우선
   *
   * ★★ 자동 착용은 **되돌릴 수 없는** 조작이다. 잘못 뺏으면 플레이어가 손해를 본다 —
   *   그래서 «뺏는다» 만큼 «잠그면 안 뺏긴다» 를 같은 무게로 검사한다. */
  const G = need('game/gear.js');
  const M = need('game/merc.js');
  const S = need('game/state.js');
  if (!G || !M || !S) { ok(false, '장비 모듈을 못 읽었다'); } else {
    const build = () => {
      S.newGame(11, '검사');
      const st = S.state;
      st.roster = []; st.items = [];
      st.squads = st.squads.slice(0, 1);
      const sq1 = st.squads[0];
      sq1.memberUids = new Array(7).fill(null);
      const sq2 = { id: 'squad_2', name: '제2부대', memberUids: new Array(7).fill(null),
        formationId: 'basic', status: 'idle', returnDay: 0, petUids: [] };
      st.squads.push(sq2);
      const mk = (sq, i, lv) => {
        const m = M.createMerc({ classId: 'swordsman', grade: 'S', level: lv });
        m.hiredDay = 2; st.roster.push(m);
        sq.memberUids[i] = m.uid; m.squadId = sq.id; m.slotIndex = i;
        return m;
      };
      /* 레벨은 **아이템 착용 조건 위**로 잡는다 (ilvl 60 무기는 Lv38 이상) —
       * 못 끼우면 검사가 «기능 고장» 으로 오탐한다 */
      const strong = mk(sq1, 0, 70);
      const weak = mk(sq2, 0, 45);
      /* ★ **목걸이**로 잰다. 무기는 클래스마다 다룰 수 있는 종류가 달라서
       *   («검사는 도를 다룰 수 없습니다») `equipItem` 이 조용히 실패하고,
       *   그러면 «뺏기가 고장» 으로 오탐한다. 장신구는 그 제약이 없다. */
      const good = G.rollItem({ ilvl: 40, rarity: 4, slot: 'neck', rng: new RngMod.RNG(99) });
      st.items.push(good);
      const eq = G.equipItem(st, weak, good, 'neck');
      if (!eq || !eq.ok) return { st, strong, weak, good, setupFail: (eq && eq.reason) || '장착 실패' };
      return { st, strong, weak, good };
    };

    const faults = [];
    /* 판을 못 차렸으면 그 사실부터 말한다 — 안 그러면 «기능이 고장» 으로 오탐한다 */
    const probe = build();
    if (probe.setupFail) faults.push(`검사 판을 못 차렸다: ${probe.setupFail}`);

    // (2) 뺏어오는가 + 누구에게서인지 남는가
    {
      const { st, strong, weak, good } = build();
      const res = G.autoEquipAll(st, { squadId: 'squad_1' });
      if (strong.equipment.neck !== good.uid) faults.push('남의 장비를 못 가져온다');
      if (weak.equipment.neck === good.uid) faults.push('뺏겼는데 원래 주인도 아직 끼고 있다');
      const ch = res.perMerc.flatMap((r) => r.changed).find((c) => c.to && c.to.uid === good.uid);
      if (!ch || !ch.tookFrom) faults.push('«누구에게서» 가 계획에 안 남는다 — 미리보기가 조용해진다');
    }
    // (3) 잠그면 못 가져가는가
    {
      const { st, strong, weak, good } = build();
      good.locked = true;
      G.autoEquipAll(st, { squadId: 'squad_1' });
      if (strong.equipment.neck === good.uid) faults.push('잠근 장비를 가져갔다');
      if (weak.equipment.neck !== good.uid) faults.push('잠근 장비가 원래 주인에게서 사라졌다');
    }
    // (3) 잠근 것은 착용자에게서도 안 벗겨지고, 팔리지도 않는가
    {
      const { st, weak, good } = build();
      good.locked = true;
      const r = new RngMod.RNG(5);
      for (let i = 0; i < 40; i++) { const it = G.rollItem({ ilvl: 45, rarityBonus: 1.2, slot: 'neck', rng: r }); if (it) st.items.push(it); }
      G.autoEquipAll(st, { mercs: [weak.uid] });
      if (weak.equipment.neck !== good.uid) faults.push('잠근 장비를 착용자에게서 벗겼다');
      if (G.isSellable(good)) faults.push('잠근 장비가 팔린다');
    }

    /* ★★ **뺏긴 사람이 빈손으로 남으면 안 된다.**
     *   세트 임자에게 양보시키는 기능을 넣다가 실제로 그렇게 만들었다:
     *   재배치가 «이미 계획이 끝난 사람들» 것을 다시 가져가는 바람에 두 행이 같은 물건을
     *   주장했고, applyPlan 이 행 순서대로 적용하면서 나중 행이 도로 뺏어 갔다 —
     *   창룡제가 **10칸에서 1칸**으로 줄었다. 재배치는 창고에 남은 것으로만 메워야 한다. */
    {
      S.newGame(21, '재배치');
      const st = S.state;
      st.roster = []; st.items = [];
      const sq = st.squads[0];
      sq.memberUids = new Array(7).fill(null);
      const cls = ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'];
      cls.forEach((cid, i) => {
        const m = M.createMerc({ classId: cid, grade: 'S', level: 60 });
        m.hiredDay = 2; st.roster.push(m);
        sq.memberUids[i] = m.uid; m.squadId = sq.id; m.slotIndex = i;
      });
      const r2 = new RngMod.RNG(31);
      for (let i = 0; i < 320; i++) { const it = G.rollItem({ ilvl: 55, rarityBonus: 0.9, rng: r2 }); if (it) st.items.push(it); }
      /* ★ 「성좌의 은총」은 이제 **사제 전용**이라 사제 아닌 사람에게 못 입힌다.
       *   그래서 이 검사는 계열 제한이 느슨한 「강철 성벽」(tank·lancer)으로 잰다 —
       *   재는 것은 «임자 양보» 가 아니라 «뺏긴 사람이 다시 채워지는가» 다. */
      const victim = st.roster[2];
      let worn = 0;
      for (const slot of ['weapon', 'offhand', 'head', 'armor', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2']) {
        const it = G.rollSetItem({ setId: 'ironrampart', slot, ilvl: 60, rng: r2 });
        if (!it) continue;
        st.items.push(it);
        const rr = G.equipItem(st, victim, it, null);
        if (rr && rr.ok) worn++;
      }
      const before = Object.values(victim.equipment || {}).filter(Boolean).length;
      G.autoEquipAll(st, {});
      const after = Object.values(victim.equipment || {}).filter(Boolean).length;
      if (worn < 5) faults.push(`검사 판을 못 차렸다: 세트를 ${worn}칸밖에 못 입혔다`);
      if (after < before - 1) faults.push(`뺏긴 사람이 빈손으로 남는다 (${before}칸 → ${after}칸)`);
    }
    okAll(faults, '세트는 임자에게 가고, 뺏긴 사람은 다시 채워진다', 10);

    /* ★ 무는 시늉만 하는 검사를 여러 번 만들었다 — 잠금을 껐을 때 실제로 뺏기는지 확인한다 */
    const { st: st2, strong: s2, good: g2 } = build();
    G.autoEquipAll(st2, { squadId: 'squad_1' });
    if (s2.equipment.neck === g2.uid) pass('검사가 실제로 문다 (잠금이 없으면 뺏어온다)');
    else ok(false, '검사가 실제로 문다', '잠금 없이도 안 뺏어왔다 — 위 검사가 헛돌 수 있다');
  }
}

section('백지 재배분이 약속을 지키나');
{
  /* ★★ 배포한 뒤에 병렬 조사가 찾아낸 결함 셋을 여기서 못 박는다.
   *   전부 **되돌릴 수 없는 손실**이었고, 가장 나쁜 것은 «확인 화면이 손실을 숨긴다» 였다.
   *
   *   1) 미리보기가 실제보다 더 약속했다 — 예고 38칸 / 실제 30칸.
   *      planCard 가 «지금 장비 + 변경» 으로 그렸는데, 백지 재배분에서는
   *      재배분이 못 채운 칸이 «원래 것을 그대로 낀 것» 으로 보였다.
   *   2) 세트 먼저 잡기가 `equipIssue` 를 안 봐서, 레벨·무기 계열이 안 맞는 단원이
   *      세트를 통째로 «찜» 하고 전부 실패했다 — 정작 낄 수 있는 단원이 10칸 → 1칸.
   *   3) 대기 인원 장비 회수가 `isLocked` 를 안 봐서 잠근 장비를 벗겼다.
   *
   *   ★ 그리고 이 검사를 만들다 **내가 넷째를 만들었다**: 읽기 좋게 하려고
   *     `changed` 에서 «원래와 같은 물건» 을 걸렀는데, 그 목록이 실제 착용에도 쓰여서
   *     네 칸이 조용히 비었다. 사람이 보는 목록(`diff`)과 끼우는 목록(`changed`)은 다른 것이다. */
  const G = need('game/gear.js');
  const S = need('game/state.js');
  const M = need('game/merc.js');
  if (!G || !S || !M) { ok(false, '모듈을 못 읽었다'); } else {
    const faults = [];

    /* ── (1) 미리보기가 약속한 칸 수 = 실제 결과 ── */
    {
      S.newGame(31, '예고검사');
      const st = S.state;
      st.roster = []; st.items = [];
      const sq = st.squads[0];
      sq.memberUids = new Array(7).fill(null);
      ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'].forEach((c, i) => {
        const m = M.createMerc({ classId: c, grade: 'C', level: 40 });
        m.hiredDay = 2; st.roster.push(m);
        sq.memberUids[i] = m.uid; m.squadId = sq.id; m.slotIndex = i;
      });
      const r = new RngMod.RNG(7);
      for (let i = 0; i < 35; i++) { const it = G.rollItem({ ilvl: 35, rarityBonus: 0.3, rng: r }); if (it) st.items.push(it); }
      let k = 0;
      for (const it of st.items.slice()) {
        const rr = G.equipItem(st, st.roster[k % 7], it, null);
        if (rr && rr.ok) k++;
        if (k >= 26) break;
      }
      if (k < 20) faults.push(`검사 판을 못 차렸다: ${k}칸밖에 못 입혔다`);
      const plan = G.autoEquipAll(st, { reset: true, dryRun: true });
      // 미리보기(planCard)가 그리는 것과 같은 계산
      const promised = plan.perMerc.reduce((a, row) => a + Object.values(row.after || {}).filter(Boolean).length, 0);
      G.autoEquipAll(st, { reset: true });
      const actual = st.roster.reduce((a, m) => a + Object.values(m.equipment || {}).filter(Boolean).length, 0);
      if (promised !== actual) faults.push(`미리보기 ${promised}칸 / 실제 ${actual}칸 — 확인 화면이 거짓말한다`);
      if (!plan.perMerc.every((row) => row.after)) faults.push('계획이 최종 장비(after)를 안 준다 — 미리보기가 추측하게 된다');
    }

    /* ── (2) 못 낄 사람이 세트를 찜하지 않는다 ── */
    {
      S.newGame(41, '찜검사');
      const st = S.state;
      st.roster = []; st.items = [];
      const sq = st.squads[0];
      sq.memberUids = new Array(7).fill(null);
      const A = M.createMerc({ classId: 'shieldman', grade: 'S', level: 70 });   // 세트 minLv 75 미달
      const B = M.createMerc({ classId: 'shieldman', grade: 'F', level: 80 });   // 낄 수 있다
      [A, B].forEach((m, i) => { m.hiredDay = 2; st.roster.push(m); sq.memberUids[i] = m.uid; m.squadId = sq.id; m.slotIndex = i; });
      const r = new RngMod.RNG(3);
      for (const slot of ['weapon', 'offhand', 'head', 'armor', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2']) {
        const it = G.rollSetItem({ setId: 'ironrampart', slot, ilvl: 80, rng: r });
        if (it) st.items.push(it);
      }
      const setN = (m) => Object.values(m.equipment || {}).filter(Boolean)
        .map((u) => (st.items || []).find((x) => x && x.uid === u))
        .filter((x) => x && G.setIdOf(x) === 'ironrampart').length;
      G.autoEquipAll(st, { reset: true });
      if (setN(A) > 0) faults.push(`레벨 미달 단원이 세트를 ${setN(A)}칸 꼈다`);
      if (setN(B) < 5) faults.push(`낄 수 있는 단원이 ${setN(B)}칸뿐이다 — 못 낄 사람이 찜했다`);
    }

    /* ── (3) 대기 인원의 잠근 장비는 안 벗긴다 ── */
    {
      S.newGame(51, '잠금검사');
      const st = S.state;
      st.roster = []; st.items = [];
      const sq = st.squads[0];
      sq.memberUids = new Array(7).fill(null);
      const onDuty = M.createMerc({ classId: 'swordsman', grade: 'S', level: 50 });
      onDuty.hiredDay = 2; st.roster.push(onDuty); sq.memberUids[0] = onDuty.uid; onDuty.squadId = sq.id;
      const bench = M.createMerc({ classId: 'swordsman', grade: 'S', level: 50 });
      bench.hiredDay = 2; st.roster.push(bench);
      const it = G.rollItem({ ilvl: 40, rarity: 4, slot: 'neck', rng: new RngMod.RNG(9) });
      st.items.push(it);
      const eq = G.equipItem(st, bench, it, 'neck');
      if (!eq || !eq.ok) faults.push('검사 판을 못 차렸다: 대기 인원에게 목걸이를 못 끼웠다');
      it.locked = true;
      G.autoEquipAll(st, {});
      if (bench.equipment.neck !== it.uid) faults.push('대기 인원의 잠근 장비를 벗겼다');
    }

    /* ── (4) 조각만 낀 «고아» 가 남지 않는다 ──
     *
     * ★★ 제작자 지적 그대로: 「1부대 세라핀이 피의 서약 한 개 입고 있는데
     *   2부대 하랄드가 피의 서약 9세트야」. 3칸을 못 채운 조각은 보너스가 0 이라
     *   그냥 낱개 장비다 — 모아 주면 단계가 오르는데 흩어진 채로 굳어 있었다. */
    {
      S.newGame(77, '고아검사');
      const st = S.state;
      st.roster = []; st.items = [];
      const sq = st.squads[0];
      sq.memberUids = new Array(7).fill(null);
      ['shieldman', 'swordsman', 'rogue', 'swordsman', 'rogue', 'archer', 'acolyte'].forEach((c, i) => {
        const m = M.createMerc({ classId: c, grade: 'S', level: 80 });
        m.hiredDay = 2; st.roster.push(m);
        sq.memberUids[i] = m.uid; m.squadId = sq.id; m.slotIndex = i;
      });
      const r = new RngMod.RNG(5);
      for (let i = 0; i < 300; i++) { const it = G.rollItem({ ilvl: 75, rarityBonus: 0.9, rng: r }); if (it) st.items.push(it); }
      const SL = ['weapon', 'offhand', 'head', 'armor', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];
      const made = [];
      for (let c = 0; c < 2; c++) for (const s0 of SL) { const it = G.rollSetItem({ setId: 'bloodoath', slot: s0, ilvl: 80, rng: r }); if (it) { st.items.push(it); made.push(it); } }
      const wear = st.roster.filter((m) => ['fighter', 'rogue'].includes((Classes.getClass(m.classId) || {}).arch));
      // 흩뿌린다 — 한 명에게 9, 나머지에게 조금씩
      made.forEach((p, i) => { const tgt = i < 9 ? wear[0] : wear[((i - 9) % Math.max(1, wear.length - 1)) + 1]; if (tgt) G.equipItem(st, tgt, p, null); });
      const cnt = (m) => Object.values(m.equipment || {}).filter(Boolean)
        .map((u) => (st.items || []).find((x) => x && x.uid === u))
        .filter((x) => x && G.setIdOf(x) === 'bloodoath').length;
      if (!wear.length || cnt(wear[0]) < 5) faults.push('검사 판을 못 차렸다: 세트를 못 흩뿌렸다');
      const TIERS = [3, 5, 7, 10];
      const tierOf = (n) => TIERS.filter((x) => n >= x).length;
      const beforeT = wear.reduce((a, m) => a + tierOf(cnt(m)), 0);
      G.autoEquipAll(st, { reset: true });
      const orphans = wear.filter((m) => cnt(m) > 0 && cnt(m) < 3);
      const afterT = wear.reduce((a, m) => a + tierOf(cnt(m)), 0);
      if (orphans.length) faults.push(`3칸을 못 채운 «고아» 가 ${orphans.length}명 남았다 (${orphans.map((m) => cnt(m)).join(',')}칸)`);
      if (afterT < beforeT) faults.push(`세트 발동 단계가 줄었다 (${beforeT} → ${afterT})`);
      /* ★★ **앞 순번이 «낱개로» 쥔 조각을 임자가 되찾을 수 있어야 한다.**
       *   배분은 전투력 순인데, 앞사람이 세트 조각을 그냥 스탯 좋은 물건으로 집어 가면
       *   뒤에 오는 임자가 **9칸에서 멈춘다** — 한 칸만 옮기면 10칸 단계가 열리는데도.
       *   가진 사람에게 3칸이 안 되는 조각은 세트로서 값이 0 이므로 넘겨받을 수 있어야 한다. */
      const top = Math.max(0, ...wear.map((m) => cnt(m)));
      const leftovers = wear.reduce((a, m) => a + (cnt(m) > 0 && cnt(m) < 3 ? cnt(m) : 0), 0);
      if (top < 10 && leftovers > 0) {
        faults.push(`최다 보유가 ${top}칸인데 낱개 조각이 ${leftovers}개 떠돈다 — 되찾지 못한다`);
      }
    }

    /* ── (5) 한 벌을 다 모았으면 **누군가는 10칸을 입는다** ──
     *
     * ★★ 제작자 지적: 「강철 성벽 10세트 다 모았다고 되어 있는데 10세트 착용한 용병은 없어」.
     *   원인은 `breaksSetTier` 가 «지금 활성인 단계» 만 지킨 것이었다 —
     *   9칸 → 8칸 교체는 둘 다 «7단계» 라 통과시켜서 **10칸에 영영 못 닿았다.**
     *   실측으로 낄 수 있는 단원 1명 · 세트 1벌인데 8칸에서 멈췄다.
     *   이제 «세트 먼저 잡기» 가 정한 칸은 같은 세트끼리만 바뀐다. */
    {
      S.newGame(101, '풀세트검사');
      const st = S.state;
      st.roster = []; st.items = [];
      const sq = st.squads[0];
      sq.memberUids = new Array(7).fill(null);
      const m0 = M.createMerc({ classId: 'shieldman', grade: 'S', level: 80 });
      m0.hiredDay = 2; st.roster.push(m0); sq.memberUids[0] = m0.uid; m0.squadId = sq.id;
      const r = new RngMod.RNG(17);
      for (let i = 0; i < 200; i++) { const it = G.rollItem({ ilvl: 79, rarityBonus: 0.9, rng: r }); if (it) st.items.push(it); }
      const SL2 = ['weapon', 'offhand', 'head', 'body', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];
      let mk = 0;
      for (const s0 of SL2) { const it = G.rollSetItem({ setId: 'ironrampart', slot: s0, ilvl: 80, rng: r }); if (it) { st.items.push(it); mk++; } }
      if (mk < 10) faults.push(`검사 판을 못 차렸다: 세트 조각을 ${mk}개만 만들었다`);
      G.autoEquipAll(st, { reset: true });
      const worn = Object.values(m0.equipment || {}).filter(Boolean)
        .map((u) => (st.items || []).find((x) => x && x.uid === u))
        .filter((x) => x && G.setIdOf(x) === 'ironrampart').length;
      if (worn < SL2.length) faults.push(`한 벌을 다 가졌는데 ${worn}칸만 입는다 — 풀세트가 안 완성된다`);
    }

    okAll(faults, '미리보기가 실제와 같고, 찜·잠금·고아·풀세트가 모두 지켜진다', 9);
  }
}

section('세트 임자(prefer)가 살아 있나');
{
  /* ★★ `setDefOf` 는 **아는 필드만 남기는 화이트리스트**다. sets.js 에 `prefer` 를 더했는데
   *   거기 안 적어서 조용히 사라졌고, 배점을 고쳐도 «아무것도 안 바뀌는» 상태로 한참 헤맸다.
   *   (엣지 함수의 sanitizeSquadsFull 이 부대 전력 `p` 를 버렸던 것과 같은 병이다.)
   *   그래서 «데이터에 있는 prefer 가 setDefOf 를 통과해서 나오는가» 를 직접 확인한다. */
  const G = need('game/gear.js');
  const D = need('data/sets.js');
  if (!G || !D) { ok(false, '세트 모듈을 못 읽었다'); } else {
    const faults = [];
    const raw = (D.SETS || D.default || {});
    const declared = Object.keys(raw).filter((id) => Array.isArray(raw[id] && raw[id].prefer) && raw[id].prefer.length);
    if (!declared.length) faults.push('prefer 를 선언한 세트가 하나도 없다 — 성좌의 은총에 넣기로 했다');
    for (const id of declared) {
      const def = G.setDefOf(id);
      if (!def) { faults.push(`${id}: setDefOf 가 null`); continue; }
      if (!Array.isArray(def.prefer) || !def.prefer.length) {
        faults.push(`${id}: setDefOf 가 prefer 를 버렸다 (화이트리스트에 안 적혔다)`);
      } else if (def.prefer.join(',') !== raw[id].prefer.join(',')) {
        faults.push(`${id}: prefer 가 달라졌다 (${raw[id].prefer} → ${def.prefer})`);
      }
    }
    okAll(faults, 'sets.js 의 prefer 가 setDefOf 를 통과한다', Math.max(1, declared.length));

    /* 성좌의 은총은 사제여야 한다 — 제작자가 콕 집은 것이라 이름으로 못 박는다 */
    const c = G.setDefOf('constellation');
    ok(!!c && Array.isArray(c.prefer) && c.prefer.includes('healer'),
      '성좌의 은총의 임자는 사제(healer)다', c ? JSON.stringify(c.prefer) : 'setDefOf 없음');
  }
}

section('단원이 늘어나는 길이 둘뿐인가');
{
  /* ★★ 오늘 넣은 총량 불변식(`sMercs ≤ hiredN + START_ROSTER`)이 성립하는 **근거**가 이것이다:
   *
   *   1. `roster` 에 원소가 들어가는 곳은 `newGame`(시작 4명)과 `addMerc` **둘뿐**이다.
   *   2. `addMerc` 는 `hiredDay` 를 **무조건** 채운다.
   *   3. 시작 4명은 `hiredDay = 1` 이고 등급이 C·C·D·D 로 고정이다.
   *   → 그래서 «모든 S 는 hiredDay > 1» 이 참이고, 명부만 보고 셀 수 있다.
   *
   *   앞으로 누가 `state.roster.push(...)` 를 직접 쓰면 2번이 깨진다 —
   *   `hiredDay` 없는 단원이 생기고, 그게 S 면 정상 플레이어가 거절당한다.
   *   조용히 깨지는 종류라 여기서 못 박는다.
   *
   * ★ 주석은 걷어내고 본다. 이 저장소에서 «옛 코드를 설명한 주석» 을 코드로 오인해
   *   헛도는 검사를 만든 적이 있다. */
  const strip = (x) => {
    let out = ''; let i = 0;
    while (i < x.length) {
      if (x[i] === '/' && x[i + 1] === '*') { const e = x.indexOf('*/', i + 2); i = e < 0 ? x.length : e + 2; continue; }
      if (x[i] === '/' && x[i + 1] === '/') { const e = x.indexOf(String.fromCharCode(10), i); i = e < 0 ? x.length : e; continue; }
      out += x[i]; i++;
    }
    return out;
  };
  const countPush = (text) => {
    let n = 0;
    for (let i = text.indexOf('roster.push'); i >= 0; i = text.indexOf('roster.push', i + 1)) n++;
    return n;
  };

  const faults = [];
  /* 게임 코드(src/)만 본다 — tools/ 의 시뮬은 플레이어 세이브를 안 만든다 */
  const files = [...listDir('game'), ...listDir('ui'), ...listDir('net'), ...listDir('data'), 'main.js'];
  let total = 0;
  for (const rel of files) {
    let code = '';
    try { code = strip(readFileSync(srcDir(rel), 'utf8')); } catch { continue; }
    const n = countPush(code);
    if (!n) continue;
    total += n;
    if (rel !== 'game/state.js') faults.push(`${rel} 이 roster 에 직접 push 한다 (${n}곳) — addMerc 를 써라`);
  }
  if (total !== 2) faults.push(`roster.push 가 ${total}곳이다 — newGame 과 addMerc 둘뿐이어야 한다`);

  /* addMerc 가 hiredDay 를 채우는가 — 이게 hiredN 의 근거다 */
  const st = strip(readFileSync(srcDir('game/state.js'), 'utf8'));
  const a = st.indexOf('export function addMerc(');
  const body = a < 0 ? '' : st.slice(a, st.indexOf(String.fromCharCode(10) + '}', a));
  if (!body) faults.push('addMerc 를 못 찾았다');
  else if (!body.includes('hiredDay')) faults.push('addMerc 가 hiredDay 를 안 채운다 — hiredN 이 무너진다');

  /* 시작 단원 등급이 S 를 포함하면 «S 는 반드시 고용» 이 깨진다 */
  const g = st.indexOf('const grades = ');
  const gLine = g < 0 ? '' : st.slice(g, st.indexOf(';', g));
  if (!gLine) faults.push('시작 단원 등급 줄을 못 찾았다');
  else if (gLine.includes("'S'")) faults.push(`시작 단원에 S 가 들어갔다 — ${gLine.trim()}`);

  okAll(faults, '단원은 newGame·addMerc 로만 늘고, addMerc 가 hiredDay 를 채운다', 4);

  /* ★ 무는 시늉만 하는 검사를 여러 번 만들었다 — 실제로 무는지 확인한다 */
  const planted = strip('function x(){ state.roster.push(m); }');
  const bit1 = countPush(planted) === 1;
  const bit2 = countPush(strip('/* state.roster.push(m) 였다 */ const y = 1;')) === 0;
  if (bit1 && bit2) pass('검사가 실제로 문다 (직접 push 는 잡고, 주석 속 push 는 안 잡는다)');
  else ok(false, '검사가 실제로 문다', `코드 ${bit1} / 주석무시 ${bit2}`);
}

section('랭킹 검증 계측기 (tools/cheatcheck.mjs)');
{
  /* ★★ 왜 여기서 돌리나.
   *   cheatcheck 는 **아무도 안 돌리는 도구**였다. 그래서 checkStatic 에 명성 상한이
   *   생긴 뒤(21df0cc) 기대값이 안 따라간 채로 **80여 커밋 동안 계속 실패**하고 있었고,
   *   아무도 몰랐다. 안 도는 검사는 없는 검사다.
   *
   *   0.24초면 스모크(1.5초)에 얹어도 티가 안 난다. 여기서 돌리면 «빨간불인 줄 몰랐다» 가 없어진다.
   *
   * ★ 실패하면 그 도구의 출력을 그대로 보여 준다 — 여기서 요약하면 원인을 못 찾는다. */
  const { execFileSync } = await import('node:child_process');
  let out = '';
  let failed = false;
  try {
    out = execFileSync(process.execPath, ['tools/cheatcheck.mjs'], { encoding: 'utf8' });
  } catch (e) {
    failed = true;
    out = String(e.stdout || e.message);
  }
  const NL2 = String.fromCharCode(10);
  const rows = out.split(NL2).filter((l) => l.includes('✗'));
  ok(!failed, '정상 플레이를 안 막고 조작을 잡는다 (cheatcheck)',
    rows.slice(0, 6).join(' | ') || out.trim().split(NL2).slice(-3).join(' | '));
}

section('거절 사유가 밖으로 새지 않나');
{
  /* ★★ 실제로 당한 것 (HANDOFF §55):
   *   거절 응답에 `reasons` 를 실어 보냈더니 그게 그대로 공격 도구가 됐다.
   *   조작자가 값을 바꿔 가며 찔러 보면 서버가 «부대 전력 5,285,956 (상한 5,000,000)» 이라고
   *   상한을 알려 준다. 거절 19건을 그렇게 훑고 상한 밑으로 낮춰 통과했다.
   *
   * ★ 사유는 `rejections` 테이블에만 남긴다. 오탐 대응은 «제보» 로 한다 (제작자 결정).
   *
   * ★ 주석을 걷어내고 본다 — 이 저장소에서 «옛 코드를 설명한 주석» 을 코드로 오인해
   *   헛도는 검사를 만든 적이 있다. */
  const strip = (x) => {
    let out = ''; let i = 0;
    while (i < x.length) {
      if (x[i] === '/' && x[i + 1] === '*') { const e = x.indexOf('*/', i + 2); i = e < 0 ? x.length : e + 2; continue; }
      if (x[i] === '/' && x[i + 1] === '/') { const e = x.indexOf(String.fromCharCode(10), i); i = e < 0 ? x.length : e; continue; }
      out += x[i]; i++;
    }
    return out;
  };
  const fnPath = fileURLToPath(new URL('supabase/functions/submit-score/index.ts', ROOT));
  if (!existsSync(fnPath)) {
    ok(true, '엣지 함수가 없어 건너뜀', fnPath);
  } else {
    const src = strip(readFileSync(fnPath, 'utf8').split(String.fromCharCode(13)).join(''));
    /** 거절 분기 안의 `return json(...)` 한 줄을 뽑아 온다 */
    const rejectReturn = (text) => {
      const at = text.indexOf("verdict.verdict === 'reject'");
      if (at < 0) return null;
      const r = text.indexOf('return json(', at);
      if (r < 0) return null;
      return text.slice(r, text.indexOf(';', r) + 1);
    };
    const ret = rejectReturn(src);
    const faults = [];
    if (!ret) faults.push('거절 분기의 응답을 못 찾았다');
    else {
      if (ret.includes('reasons')) faults.push(`거절 응답에 reasons 가 실린다 → ${ret.trim()}`);
      if (ret.includes('tier')) faults.push(`거절 응답에 tier 가 실린다 → ${ret.trim()}`);
    }
    /* 사유는 «남기기는» 해야 한다 — 안 남기면 제보가 와도 판단할 재료가 없다 */
    const at = src.indexOf("verdict.verdict === 'reject'");
    const branch = at >= 0 ? src.slice(at, at + 500) : '';
    if (!branch.includes('rejections')) faults.push('거절을 rejections 에 안 남긴다');
    if (!branch.includes('payload')) faults.push('거절에 payload 를 안 남긴다 — 제보가 와도 되짚을 수 없다');
    okAll(faults, '거절은 조용히 하고, 사유·payload 는 DB 에만 남긴다', 4);

    /* ★ 클라이언트도 사유를 지어내면 안 된다 */
    const cl = strip(readFileSync(srcDir('net/cloud.js'), 'utf8'));
    ok(!cl.includes('res.data.reasons'), '클라이언트가 서버 사유를 읽지 않는다',
      '더 이상 오지 않는 값이다');

    /* ★ 무는 시늉만 하는 검사를 여러 번 만들었다 — 실제로 무는지 확인한다 */
    const planted = src.replace('return json({ ok: false }, 200);',
      'return json({ ok: false, tier: verdict.tier, reasons: verdict.reasons }, 200);');
    const pr = rejectReturn(planted);
    if (pr && pr.includes('reasons')) pass('검사가 실제로 문다 (사유를 다시 실으면 걸린다)');
    else ok(false, '검사가 실제로 문다', '사유를 심었는데 못 잡았다');
  }
}

section('제출 필드가 서버 화이트리스트와 맞나');
{
  /* ★★ 실제로 당한 것 (HANDOFF §58):
   *   rules.js 의 allSquadsOf 에 부대 전력 `p` 를 더했는데, 엣지 함수의
   *   sanitizeSquadsFull 은 **아는 필드만 남기는 화이트리스트**라 `p` 를 통째로 버렸다.
   *   클라이언트도 서버도 정상으로 보이는데 DB 에만 값이 안 들어간다 —
   *   «부대 전력이 여전히 안 보인다» 로만 드러난다.
   *
   * ★ 두 파일의 필드 이름을 **글자로** 비교한다. 완벽하지는 않지만
   *   «한쪽에만 있는 필드» 는 확실히 잡는다. */
  const rulesSrc = readFileSync(srcDir('game/rules.js'), 'utf8');
  const fnPath = fileURLToPath(new URL('supabase/functions/submit-score/index.ts', ROOT));
  if (!existsSync(fnPath)) {
    ok(true, '엣지 함수가 없어 건너뜀', fnPath);
  } else {
    const fnSrc = readFileSync(fnPath, 'utf8');
    /* ★ 끝 표식을 **시작 표식 다음부터** 찾는다.
     *   'function sanitizeSquad' 는 'function sanitizeSquadsFull' 의 접두사라,
     *   같은 자리에서 찾으면 자기 자신을 만나 빈 문자열이 나온다 — 그러면
     *   «서버에 필드가 하나도 없다» 로 오탐한다 (실제로 그랬다). */
    const between = (src, from, to) => {
      const i = src.indexOf(from);
      if (i < 0) return '';
      const j = to ? src.indexOf(to, i + from.length) : -1;
      return src.slice(i, j > 0 ? j : i + 3000);
    };
    /* allSquadsOf 가 out.push({...}) 로 넣는 부대 필드 */
    const squadFields = new Set(
      [...between(rulesSrc, 'function allSquadsOf', 'function topSquadOf')
        .matchAll(/^\s{6}([a-z])\s*:/gm)].map((m) => m[1]));
    const serverFields = new Set(
      [...between(fnSrc, 'function sanitizeSquadsFull', 'function sanitizeSquad')
        .matchAll(/^\s{6}([a-z])\s*:/gm)].map((m) => m[1]));
    const missing = [...squadFields].filter((f) => !serverFields.has(f));
    okAll(missing.map((f) => `부대 필드 '${f}' 가 sanitizeSquadsFull 에 없다 — 서버가 버린다`),
      'allSquadsOf 의 필드를 서버가 전부 통과시킨다', squadFields.size || 1);
    ok(squadFields.size >= 3, '부대 필드를 실제로 읽어 냈다 (정규식이 헛돌지 않았다)',
      `읽은 필드: ${[...squadFields].join(' ') || '없음'}`);
  }
}

section('스프라이트 캐시');
if (Spritegen) {
  /* ★ 해상도를 4배로 올리면서 아틀라스 한 벌이 약 0.25MB → 1MB 가 됐다.
   *   무제한 캐시는 그때부터 휴대폰을 죽이는 장치가 된다 (HANDOFF §50). */
  const MAX = Spritegen.SPRITE_CACHE_MAX;
  const bytes = Spritegen.spriteBytes();
  /* ★ 개수가 아니라 **바이트**를 지켜야 한다. 한 벌 크기가 해상도에 따라 네 배씩 뛰므로
   *   개수로 못박으면 해상도를 올리는 순간 조용히 몇백 MB 가 된다 (HANDOFF §52). */
  ok(MAX * bytes <= Spritegen.SPRITE_CACHE_BYTES * 1.05,
    '캐시가 바이트 예산 안에 있다',
    `${MAX}벌 × ${(bytes / 1048576).toFixed(2)}MB = ${(MAX * bytes / 1048576).toFixed(0)}MB (예산 ${Spritegen.SPRITE_CACHE_BYTES / 1048576}MB)`);
  ok(MAX >= 12, '한 전투가 돌 만큼은 담는다 (최소 12벌)', `SPRITE_CACHE_MAX=${MAX}`);

  Spritegen.clearSpriteCache();
  ok(Spritegen.spriteCacheSize() === 0, '캐시를 비울 수 있다', Spritegen.spriteCacheSize());
  // 캔버스가 없는 node 에서는 buildSprite 가 못 도니 여기까지만 본다.
} else {
  ok(false, '스프라이트 모듈을 읽지 못했다');
}

section('스프라이트 좌표계');
{
  /* ★ 실제로 당한 것 (HANDOFF §50):
   *   SPRITE_W/H 만 보고 «밖에서 안 쓴다» 고 판단했는데, renderer 가 `FOOT_Y * SPRITE_SCALE` 로
   *   머리·가슴·지평선 높이를 직접 계산하고 있었다. 해상도를 2배로 올리자
   *   체력바와 피해 숫자가 통째로 머리 위 두 배 높이로 날아갔다 — 스모크는 전부 통과한 채로.
   *
   *   상수는 **아틀라스 픽셀**이고 화면 좌표가 아니다. 밖에서는 spriteFootPx(scale) 를 쓴다. */
  const files = [];
  const walkArt = (relDir) => {
    for (const name of readdirSync(srcDir(relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${name.name}` : name.name;
      if (name.isDirectory()) walkArt(rel);
      else if (name.name.endsWith('.js')) files.push(rel);
    }
  };
  walkArt('');

  /** 상수 이름 바로 옆(공백 무시)에 곱하기·나누기가 붙어 있나.
   *  ★ 정규식으로 짜지 않는다 — 역슬래시가 도구를 거치며 먹히는 일을 이 저장소에서 여러 번 겪었다.
   *    먹힌 정규식(`\s` → `s`)은 실패가 아니라 «조용히 아무것도 안 잡는 통과» 로 위장돼 더 나쁘다. */
  const scaledBy = (code, name) => {
    const isWord = (ch) => ch != null && (/[A-Za-z0-9_$]/).test(ch);
    for (let i = code.indexOf(name); i >= 0; i = code.indexOf(name, i + 1)) {
      if (isWord(code[i - 1]) || isWord(code[i + name.length])) continue;   // 다른 이름의 일부
      let a = i - 1; while (a >= 0 && (code[a] === ' ' || code[a] === '\t')) a--;
      let b = i + name.length; while (b < code.length && (code[b] === ' ' || code[b] === '\t')) b++;
      if (code[b] === '*' || code[b] === '/') return true;
      if ((code[a] === '*' || code[a] === '/') && code[a - 1] !== '/' && code[a - 1] !== '*') return true;
    }
    return false;
  };

  const CONSTS = ['SPRITE_W', 'SPRITE_H', 'FOOT_Y', 'ROT_PIVOT'];
  const bad = [];
  for (const rel of files) {
    if (rel === 'art/spritegen.js') continue;            // 좌표계의 주인
    const code = readFileSync(srcDir(rel), 'utf8')
      .split('\n')
      .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))    // 주석 줄은 뺀다 (파츠 문서가 상수를 언급한다)
      .join('\n');
    for (const c of CONSTS) {
      if (scaledBy(code, c)) bad.push(rel + ': ' + c + ' 로 화면 좌표를 직접 계산한다 — spriteFootPx() 를 써라');
    }
  }
  okAll(bad, '아틀라스 픽셀 상수를 밖에서 화면 좌표로 쓰지 않는다', files.length);

  // 가드가 실제로 무는가 — 통과만 하고 아무것도 안 잡는 검사를 여러 번 만들었다
  okAll([
    scaledBy('x = FOOT_Y * SCALE;', 'FOOT_Y') ? null : '「FOOT_Y * SCALE」을 못 잡는다',
    scaledBy('x = 3 * FOOT_Y;', 'FOOT_Y') ? null : '「3 * FOOT_Y」를 못 잡는다',
    scaledBy('import { FOOT_Y } from "x";', 'FOOT_Y') ? '평범한 import 를 잘못 잡는다' : null,
    scaledBy('const MY_FOOT_Y = a * 2;', 'FOOT_Y') ? '다른 이름의 일부를 잘못 잡는다' : null,
  ].filter(Boolean), '가드가 실제 위반을 잡고 멀쩡한 코드는 안 잡는다', 4);

  if (Spritegen) {
    ok(Spritegen.spriteFootPx(6) === Spritegen.spriteFootPx(3) * 2,
      '발밑 높이가 scale 에 비례한다',
      `${Spritegen.spriteFootPx(6)} vs ${Spritegen.spriteFootPx(3) * 2}`);
  }
}

section('모듈 간 import 정합성 (정적 분석)');
{
  const allFiles = [];
  const walk = (relDir) => {
    for (const name of readdirSync(srcDir(relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${name.name}` : name.name;
      if (name.isDirectory()) walk(rel);
      else if (name.name.endsWith('.js')) allFiles.push(rel);
    }
  };
  walk('');

  /** 주석 제거 (URL 의 // 는 보존) */
  const strip = (code) => code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

  const exportCache = new Map();
  /** 파일의 export 이름 집합 (export * from 재귀) */
  function exportsOf(absPath, seen = new Set()) {
    if (exportCache.has(absPath)) return exportCache.get(absPath);
    if (seen.has(absPath)) return new Set();
    seen.add(absPath);
    const out = new Set();
    if (!existsSync(absPath)) return out;
    const code = strip(readFileSync(absPath, 'utf8'));
    for (const m of code.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    for (const m of code.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    for (const m of code.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
      for (const part of m[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const as = t.split(/\s+as\s+/);
        out.add((as[1] || as[0]).trim());
      }
    }
    for (const m of code.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      for (const part of m[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const as = t.split(/\s+as\s+/);
        out.add((as[1] || as[0]).trim());
      }
    }
    if (/export\s+default\b/.test(code)) out.add('default');
    for (const m of code.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
      const target = resolve(dirname(absPath), m[1]);
      for (const n of exportsOf(target, seen)) out.add(n);
    }
    exportCache.set(absPath, out);
    return out;
  }

  const bad = [];
  const extBad = [];
  let importCount = 0;
  for (const rel of allFiles) {
    const abs = srcDir(rel);
    const code = strip(readFileSync(abs, 'utf8'));
    const re = /import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
    for (const m of code.matchAll(re)) {
      const clause = m[1];
      const spec = m[2] || m[3];
      if (!spec) continue;
      importCount++;
      if (!spec.startsWith('.')) { bad.push(`${rel}: 외부 의존성 import '${spec}'`); continue; }
      if (!spec.endsWith('.js')) extBad.push(`${rel}: '${spec}' 확장자 없음`);
      const target = resolve(dirname(abs), spec);
      if (!existsSync(target)) { bad.push(`${rel}: '${spec}' 파일 없음`); continue; }
      if (!clause) continue;
      const named = clause.match(/\{([\s\S]*)\}/);
      if (!named) continue; // default 또는 * as ns
      const avail = exportsOf(target);
      if (!avail.size) continue;
      for (const part of named[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const name = t.split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!avail.has(name)) {
          bad.push(`${rel}: '${relative(rootDir, target).split(sep).join('/')}' 에 export '${name}' 없음`);
        }
      }
    }
  }
  okAll(bad, '모든 import 가 실재하는 파일/이름을 가리킴', importCount);
  okAll(extBad, '모든 상대 import 가 .js 확장자 명시', importCount);
}

/* ══════════ 8차 확장: 10슬롯 / 세트 / 던전 / 달력 ══════════ */

section('장비 슬롯 10칸 (설계 A)');
if (Items && Gear) {
  const SLOTS = Items.SLOTS;
  ok(Array.isArray(SLOTS) && SLOTS.length === 10, '슬롯이 정확히 10칸', `실제 ${SLOTS && SLOTS.length}`);
  const EXPECT = ['weapon', 'offhand', 'head', 'body', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];
  ok(JSON.stringify(SLOTS) === JSON.stringify(EXPECT), '슬롯 목록·순서가 설계와 일치', SLOTS.join(','));
  ok(JSON.stringify(Gear.SLOTS) === JSON.stringify(SLOTS), 'gear.js SLOTS 가 items.js 와 동일');
  if (Sets) ok(JSON.stringify(Sets.SET_SLOTS) === JSON.stringify(SLOTS), 'sets.js SET_SLOTS 가 items.js 와 동일');

  okAll(SLOTS.filter((sl) => !Items.SLOT_NAME[sl]).map((sl) => `${sl} 한국어 이름 없음`),
    '모든 슬롯에 한국어 이름', SLOTS.length);
  const pbad = SLOTS.filter((sl) => !(Items.SLOT_POWER[sl] > 0)).map((sl) => `${sl} 계수 없음`);
  okAll(pbad, '모든 슬롯에 SLOT_POWER 계수', SLOTS.length);
  const psum = SLOTS.reduce((a, sl) => a + Items.SLOT_POWER[sl], 0);
  ok(psum > 3.5 && psum < 6.0, `SLOT_POWER 합계가 3.5~6.0 (실제 ${psum.toFixed(2)})`, psum.toFixed(2));
  ok(Items.SLOT_POWER.weapon === 1.00, '무기 계수는 기준값 1.00', Items.SLOT_POWER.weapon);

  // 양손무기 → 왼손 잠금 → 풀세트 기준 9칸
  ok(Items.equippableSlotCount('sword') === 10, '한손무기는 10칸');
  ok(Items.equippableSlotCount('greatsword') === 9, '양손무기(대검)는 9칸');
  ok(!Items.equippableSlots('bow').includes('offhand'), '양손무기는 offhand 가 목록에서 빠진다');

  // 옛 3슬롯 세이브 정규화
  const legacyEq = Items.normalizeEquipment({ weapon: 'w1', armor: 'a1', accessory: 'c1' });
  ok(legacyEq.weapon === 'w1' && legacyEq.body === 'a1' && legacyEq.neck === 'c1',
    '옛 3슬롯(weapon/armor/accessory) → weapon/body/neck 이관', JSON.stringify(legacyEq));
  ok(SLOTS.every((sl) => sl in legacyEq), '정규화 결과가 10칸을 전부 갖는다');
  ok(SLOTS.filter((sl) => legacyEq[sl]).length === 3, '옮겨진 3칸 외에는 비어 있다');
  const emptyEq = Items.normalizeEquipment(undefined);
  ok(SLOTS.every((sl) => emptyEq[sl] === null), 'equipment 필드가 아예 없어도 빈 10칸으로 정규화');
}

section('신화 세트 4종 x 10슬롯 = 40개 (설계 B)');
if (Sets && Items && Gear && Dungeons && Classes && Merc && RngMod) {
  ok(Sets.SET_IDS.length === 4, '세트가 정확히 4종', Sets.SET_IDS.join(','));
  ok(Items.MYTHIC_RARITY === 5 && Items.RARITY_NAME[5] === '신화', '희귀도 5 = 신화',
    `${Items.MYTHIC_RARITY}/${Items.RARITY_NAME[5]}`);
  ok(Items.RARITY_COLOR.length === 6 && Items.RARITY_COLOR[5] !== Items.RARITY_COLOR[4],
    '신화 색이 전설과 다르다', `${Items.RARITY_COLOR[4]} vs ${Items.RARITY_COLOR[5]}`);

  const pieces = Sets.allSetPieceItems(80);
  ok(pieces.length === 40, '세트 파츠 총 40개', `실제 ${pieces.length}`);
  const ARCHS = new Set(Object.keys(Classes.ARCHETYPES));
  const STATS = new Set(Merc.STAT_KEYS);
  const sbad = [];
  const seenBase = new Set();
  for (const it of pieces) {
    if (!it) { sbad.push('null 파츠'); continue; }
    const tag = `${it.setId}/${it.slot}`;
    if (!Items.SLOTS.includes(it.slot)) sbad.push(`${tag}: slot 이 SLOTS 밖`);
    if (it.rarity !== 5) sbad.push(`${tag}: rarity=${it.rarity}`);
    if (!it.setId || !Sets.getSet(it.setId)) sbad.push(`${tag}: setId 미상`);
    if (seenBase.has(it.baseId)) sbad.push(`${tag}: baseId 중복 ${it.baseId}`);
    seenBase.add(it.baseId);
    if (!Array.isArray(it.archs) || !it.archs.length) sbad.push(`${tag}: archs 비어있음`);
    else for (const a of it.archs) if (!ARCHS.has(a)) sbad.push(`${tag}: 알 수 없는 아키타입 '${a}'`);
    if (!it.stats || !Object.keys(it.stats).length) sbad.push(`${tag}: stats 비어있음`);
    else {
      for (const [k, v] of Object.entries(it.stats)) {
        if (!STATS.has(k)) sbad.push(`${tag}: 알 수 없는 스탯 '${k}'`);
        if (!isNum(v)) sbad.push(`${tag}: stats.${k}=${v}`);
      }
    }
    if (!isNum(it.value) || it.value <= 0) sbad.push(`${tag}: value=${it.value}`);
  }
  okAll(sbad, '세트 파츠 40개 스키마(slot·rarity·archs·stats)', pieces.length);

  const cbad = [];
  for (const id of Sets.SET_IDS) {
    for (const sl of Items.SLOTS) if (!Sets.setPieceDef(id, sl)) cbad.push(`${id}: ${sl} 파츠 없음`);
  }
  okAll(cbad, '세트마다 10슬롯 파츠가 전부 있다', 40);

  const mbad = Dungeons.DUNGEON_LIST.filter((d) => !Sets.getSet(d.setId))
    .map((d) => `${d.id}.setId='${d.setId}' 가 sets.js 에 없음`);
  okAll(mbad, '던전 4개의 setId 가 전부 sets.js 에 실재', Dungeons.DUNGEON_LIST.length);

  const abad = [];
  for (const d of Dungeons.DUNGEON_LIST) {
    const st = Sets.getSet(d.setId);
    if (!st) continue;
    if (JSON.stringify(st.archs.slice().sort()) !== JSON.stringify(d.archs.slice().sort())) {
      abad.push(`${d.id}: 던전 archs [${d.archs}] != 세트 archs [${st.archs}]`);
    }
  }
  okAll(abad, '던전 archs 와 세트 archs 가 일치', Dungeons.DUNGEON_LIST.length);
  /* ★★ 예전 설계는 «4번 던전 세트만 전 아키타입» 이었다. 그게 바뀌었다.
   *   제작자 결정: 「성좌의 은총은 사제만 입는 걸로 하고, 나중에 사제 계열 서포터
   *   클래스를 만들든가 하자」 — 전 아키타입이라 배분이 계속 사제를 비켜 갔기 때문이다.
   *   이제 네 세트가 **아키타입을 나눠 갖는다.** 그 나눔에 빈틈이 없는지를 본다:
   *   일곱 아키타입이 전부 어딘가의 세트에 들어가 있어야 한다 — 안 그러면
   *   그 계열은 던전을 아무리 돌아도 쓸 세트가 없다. */
  const covered = new Set(Sets.SET_LIST.flatMap((x) => x.archs));
  const ARCH7 = ['tank', 'fighter', 'lancer', 'rogue', 'archer', 'mage', 'healer'];
  const uncovered = ARCH7.filter((a) => !covered.has(a));
  okAll(uncovered.map((a) => `${a} 계열이 쓸 세트가 없다`),
    '일곱 아키타입이 전부 어느 세트엔가 들어 있다', ARCH7.length);

  const b3 = Sets.setBonusAt(Sets.SET_IDS[0], 3, 10, 80);
  const b5 = Sets.setBonusAt(Sets.SET_IDS[0], 5, 10, 80);
  const b7 = Sets.setBonusAt(Sets.SET_IDS[0], 7, 10, 80);
  const b10 = Sets.setBonusAt(Sets.SET_IDS[0], 10, 10, 80);
  ok(b3.steps.length === 1 && b5.steps.length === 2 && b7.steps.length === 3 && b10.steps.length === 4,
    '세트 단계가 3/5/7/풀 에서 하나씩 누적된다',
    [b3, b5, b7, b10].map((b) => b.steps.length).join(','));
  const powerOf = (b) => Object.values(b.stats).reduce((a, v) => a + Math.abs(v), 0);
  ok(powerOf(b3) < powerOf(b5) && powerOf(b5) < powerOf(b7) && powerOf(b7) < powerOf(b10),
    '단계가 오를수록 세트 효과가 커진다');
  ok(b10.specials.length > 0 && b7.specials.length === 0,
    '고유 효과(special)는 풀세트에서만 붙는다', `7=${b7.specials.length} full=${b10.specials.length}`);

  // ★ 9차 — 고유 효과가 **엔진에서 실제로 처리되는가**. 8차까지는 sets.js 에 정의만 있고
  //    battle/engine.js 에 'special' 이라는 단어조차 없었다(플레이어에게 거짓말하는 상태).
  //    sets.js 와 엔진의 id 집합이 어긋나면 여기서 바로 FAIL 이 난다.
  {
    const dataIds = Sets.SET_SPECIAL_IDS.slice().sort();
    const engineIds = ((Engine && Engine.SPECIAL_IDS) || []).slice().sort();
    const miss = dataIds.filter((id) => !engineIds.includes(id));
    const ghost = engineIds.filter((id) => !dataIds.includes(id));
    ok(dataIds.length > 0, 'sets.js 에 고유 효과가 정의되어 있다', `${dataIds.length}종`);
    okAll(miss.map((id) => `${id}: 엔진 미구현`),
      '★ sets.js 고유 효과 전부가 엔진에서 처리된다', dataIds.length);
    okAll(ghost.map((id) => `${id}: sets.js 에 없음`),
      '엔진에만 있는 유령 고유 효과가 없다', engineIds.length);
    ok(dataIds.length === engineIds.length,
      '고유 효과 개수 일치 (sets.js == engine)', `${dataIds.length} vs ${engineIds.length}`);

    // 정의가 완결적인가 — 엔진은 `specialParams` 만 읽어 동작해야 한다
    const pbad = [];
    for (const id of dataIds) {
      const sp = Sets.getSetSpecial(id);
      if (!sp) { pbad.push(`${id}: getSetSpecial=null`); continue; }
      if (!sp.name) pbad.push(`${id}: name 없음`);
      if (!sp.desc) pbad.push(`${id}: desc 없음 (UI 가 보여줄 설명)`);
      if (!sp.params || !Object.keys(sp.params).length) pbad.push(`${id}: params 비어 있음`);
      else if (!Sets.SPECIAL_TRIGGERS.includes(sp.params.trigger)) {
        pbad.push(`${id}: trigger='${sp.params.trigger}' 가 SPECIAL_TRIGGERS 밖`);
      }
    }
    okAll(pbad, '고유 효과 4종이 name/desc/params/trigger 를 갖췄다', dataIds.length);

    // 엔진 전투에 실제로 붙는가 — 같은 시드로 ON/OFF 를 토글해 결과가 달라져야 한다.
    if (Engine && Classes && Skills) {
      const mk = (uid, side, specials) => ({
        uid, name: uid, side,
        stats: { hp: 9000, atk: 300, def: 60, res: 60, spd: 40, crit: 0, critDmg: 50, eva: 0 },
        skills: [], basicFx: 'slash', basicRange: 'melee', basicDmgType: 'phys',
        slot: { x: 0.2, y: 0.5 }, slotIndex: 0, specials,
      });
      const sp = Sets.getSetSpecial('rampart_aegis');
      const b = Engine.createBattle({
        allies: [mk('h1', 'ally', [{ id: sp.id, params: { ...sp.params } }])],
        enemies: [mk('e1', 'enemy', [])],
        seed: 99, getSkill: Skills.getSkill, record: false,
      });
      const hero = b.units.find((u) => u.uid === 'h1');
      ok(hero.specials.length === 1 && hero.shield > 0,
        '★ 엔진이 UnitDef.specials 를 소비한다 (battleStart 방어막)',
        `specials=${hero.specials.length} shield=${hero.shield}`);
    }
  }
  const b9of9 = Sets.setBonusAt(Sets.SET_IDS[0], 9, 9, 80);
  const b9of10 = Sets.setBonusAt(Sets.SET_IDS[0], 9, 10, 80);
  ok(b9of9.steps.includes('full') && !b9of10.steps.includes('full'),
    '풀세트 기준은 고정 10 이 아니라 그 용병이 낄 수 있는 칸 수(양손=9)');

  const gbad = [];
  for (const d of Dungeons.DUNGEON_LIST) {
    for (const sl of Items.SLOTS) {
      const it = Gear.rollSetItem({ setId: d.setId, slot: sl, ilvl: 80, rng: new RngMod.RNG(4242) });
      if (!it) { gbad.push(`${d.setId}/${sl}: null`); continue; }
      if (it.slot !== sl) gbad.push(`${d.setId}/${sl}: slot='${it.slot}'`);
      if (it.rarity !== 5) gbad.push(`${d.setId}/${sl}: rarity=${it.rarity}`);
      if (Gear.setIdOf(it) !== d.setId) gbad.push(`${d.setId}/${sl}: setIdOf='${Gear.setIdOf(it)}'`);
    }
  }
  okAll(gbad, 'gear.rollSetItem 이 40개 조합을 전부 만든다', 40);
}

section('던전 4개 · 주차 개방 (설계 C)');
if (Dungeons && Dungeon && World && State && Items && RngMod) {
  const list = Dungeons.DUNGEON_LIST;
  ok(list.length === 4, '던전이 정확히 4개', `실제 ${list.length}`);
  const weeks = list.map((d) => d.week).sort();
  ok(JSON.stringify(weeks) === JSON.stringify([1, 2, 3, 4]), 'week 이 1~4 중복 없이 하나씩', weeks.join(','));
  okAll(list.filter((d) => d.waves !== 10).map((d) => `${d.id}: waves=${d.waves}`),
    '던전마다 10웨이브', list.length);
  const cityIds = new Set(World.CITIES.map((c) => c.id));
  okAll(list.filter((d) => cityIds.has(d.id)).map((d) => `${d.id} 가 도시 id 와 충돌`),
    '던전 노드가 도시와 별개', list.length);
  okAll(Dungeons.validateDungeons(World.CITIES) || [], '던전 데이터 자체 검증(validateDungeons)', list.length);

  const obad = [];
  for (let day = 1; day <= 84; day++) {
    const w = State.openDungeonWeek(day);
    const open = Dungeon.openDungeonId(day);
    const want = list.find((d) => d.week === w);
    if (!want || open !== want.id) obad.push(`${day}일차: week=${w} open='${open}'`);
    for (const d of list) {
      const can = Dungeon.canEnter({ day }, d.id);
      if (can.ok !== (d.week === w)) obad.push(`${day}일차: ${d.id} 입장가능=${can.ok} (week ${d.week} vs ${w})`);
    }
  }
  okAll(obad, 'N주차에는 N번 던전만 열린다 (84일 전수)', 84 * 5);

  const dbad = [];
  for (let wi = 0; wi < 10; wi++) {
    const pool = Dungeon.dropSlotsForWave(wi);
    const want = wi <= 4 ? Items.ARMOR_SLOTS : wi <= 7 ? Items.ACC_SLOTS : Items.WEAPON_SLOTS;
    if (JSON.stringify(pool.slice().sort()) !== JSON.stringify(want.slice().sort())) {
      dbad.push(`${wi + 1}웨: [${pool}] (기대 [${want}])`);
    }
  }
  okAll(dbad, '웨이브별 드랍 슬롯이 설계대로 (1~5 방어구 / 6~8 장신구 / 9~10 무기)', 10);

  const rbad = [];
  for (const d of list) {
    for (let wi = 0; wi < d.waves; wi++) {
      const it = Dungeon.dropForWave(d.id, wi, new RngMod.RNG(1000 + wi));
      if (!it) { rbad.push(`${d.id} ${wi + 1}웨: 드랍 null`); continue; }
      if (it.setId !== d.setId) rbad.push(`${d.id} ${wi + 1}웨: setId='${it.setId}'`);
      if (it.rarity !== 5) rbad.push(`${d.id} ${wi + 1}웨: rarity=${it.rarity}`);
      if (!Dungeon.dropSlotsForWave(wi).includes(it.slot)) rbad.push(`${d.id} ${wi + 1}웨: slot='${it.slot}'`);
    }
  }
  okAll(rbad, '웨이브마다 그 던전 세트의 신화 아이템이 드랍된다', list.length * 10);

  const wbad = [];
  for (const d of list) {
    let prev = 0;
    for (let wi = 0; wi < d.waves; wi++) {
      const w = Dungeon.dungeonWave(d.id, wi);
      if (!w || !w.units.length) { wbad.push(`${d.id} ${wi + 1}웨: 편성 없음`); continue; }
      if (!w.boss) wbad.push(`${d.id} ${wi + 1}웨: boss 플래그 없음`);
      if (!isNum(w.power) || w.power < prev - 1e-9) wbad.push(`${d.id} ${wi + 1}웨: power=${w.power} 단조 위반`);
      prev = w.power;
      const defs = Dungeon.dungeonEnemyDefs(d.id, wi);
      if (!defs.length) wbad.push(`${d.id} ${wi + 1}웨: enemyDefs 비어있음`);
      for (const u of defs) {
        for (const [k, v] of Object.entries(u.stats || {})) {
          if (!isNum(v)) wbad.push(`${d.id} ${wi + 1}웨: ${u.name}.${k}=${v}`);
        }
      }
      if (!defs.some((u) => u.boss)) wbad.push(`${d.id} ${wi + 1}웨: 보스가 없다`);
    }
  }
  okAll(wbad, '웨이브 편성·배율·적 스탯이 전부 유효하고 배율이 단조 증가', list.length * 10);
}

section('년/월/주 달력 (설계 D)');
if (State) {
  const bad = [];
  const DAYS = 336 * 3 + 5;
  for (let day = 1; day <= DAYS; day++) {
    const c = State.calendar(day);
    const doy = (day - 1) % 336;
    const want = {
      year: Math.floor((day - 1) / 336) + 1,
      month: Math.floor(doy / 28) + 1,
      week: Math.floor((doy % 28) / 7) + 1,
      dayOfWeek: (doy % 7) + 1,
      day,
    };
    for (const k of Object.keys(want)) if (c[k] !== want[k]) bad.push(`${day}일차 ${k}: ${c[k]} != ${want[k]}`);
    const back = (c.year - 1) * 336 + (c.month - 1) * 28 + (c.week - 1) * 7 + (c.dayOfWeek - 1) + 1;
    if (back !== day) bad.push(`${day}일차 왕복 실패 -> ${back}`);
    if (State.openDungeonWeek(day) !== want.week) bad.push(`${day}일차 openDungeonWeek=${State.openDungeonWeek(day)}`);
  }
  okAll(bad, '달력 파생식 + day 왕복 (전수)', DAYS);
  ok(State.calendar(1).year === 1 && State.calendar(1).month === 1 && State.calendar(1).week === 1,
    '1일차 = 1년 1월 1주차');
  ok(State.calendar(336).year === 1 && State.calendar(337).year === 2, '336일이 1년, 337일차부터 2년');
  const lbl = State.calendarLabel(245);
  ok(/^\d+년 \d+월 \d+주차 \(245일차\)$/.test(lbl), 'UI 표기 형식 `N년 N월 N주차 (N일차)`', lbl);
  ok(State.DATA_VERSION === 8, 'DATA_VERSION 이 8', State.DATA_VERSION);

  /* ── 랭킹 리셋 마이그레이션 (DATA_VERSION 5) ────────────────────────────
   * ★ 리셋은 **버전 4 이하에서 올라올 때만** 일어나야 한다.
   *   조건 없이 두면 앞으로 수치를 바꿀 때마다 남의 기록이 매번 날아간다. */
  {
    /* 마이그레이션은 `load()` 경로에서만 돈다 — 세이브를 만들어 두고 다시 읽는다.
       localStorage 는 이 파일 뒤쪽에서 이미 흉내 내고 있지만 여기서는 아직이라 직접 심는다. */
    const store = {};
    const prevLs = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    const mk = (ver, best) => {
      State.newGame(4242, '마이그레이션');
      State.save();                                  // 표식이 찍힌 정상 세이브를 만든다
      const raw = JSON.parse(globalThis.localStorage.getItem(State.SAVE_KEY));
      const body = raw && raw.data ? raw.data : raw;  // 봉인 형식이면 본문을 꺼낸다
      body.dataVersion = ver;
      body.tower = { ...(body.tower || {}), best, bestDay: 10 };
      body.abyss = { ...(body.abyss || {}), best, bestDay: 12 };
      body.stats = { ...(body.stats || {}), questsDone: 37 };
      globalThis.localStorage.setItem(State.SAVE_KEY, JSON.stringify(raw));
      State.load();
      return State.state;
    };
    const a = mk(7, 120);
    ok(a.tower.best === 0 && a.abyss.best === 0,
      '옛 버전 세이브를 열면 탑·나락 기록이 리셋된다', `탑 ${a.tower.best} / 나락 ${a.abyss.best}`);
    ok(a.stats.questsDone === 37,
      '리셋이 questsDone 은 안 건드린다 (progress.js 관문을 되돌리면 안 된다)', String(a.stats.questsDone));

    globalThis.localStorage = prevLs;

    /* ★ 위 두 검사는 이빨이 있다 (리셋을 지우면 첫 번째가, questsDone 을 같이 지우면
     *   두 번째가 터진다). 그런데 **정작 위험한 건 미래**다 —
     *   DATA_VERSION 을 6 으로 올릴 때 리셋 관문이 같이 따라 올라가면
     *   그때 또 남의 기록이 날아간다.
     *
     *   그건 실행으로는 못 잰다. `cur === DATA_VERSION` 이면 마이그레이션이
     *   맨 위에서 반환하므로, 관문을 지워도 지금은 아무 검사도 안 터진다
     *   (실제로 지워 보고 확인했다). 그래서 값으로 못 박아 둔다. */
    ok(State.RANK_RESET_VERSION <= State.DATA_VERSION,
      '랭킹 리셋 기준 버전이 DATA_VERSION 을 넘지 않는다',
      `${State.RANK_RESET_VERSION} vs ${State.DATA_VERSION}`);
    /* ── 평판 감쇠 ──────────────────────────────────────────────────────
     * ★ 평판을 «유지해야 하는 값» 으로 만드는 장치다. 세 가지가 다 맞아야 한다:
     *   머무는 도시는 안 깎이고 · 바닥 아래로는 안 내려가고 · 하루 1씩만 깎인다. */
    {
      State.newGame(4242, '감쇠');
      const st = State.state;
      st.cityId = 'greenhold';
      st.day = 100;
      st.reputation = { greenhold: 300, kingsrest: 300, frostgate: 55, millford: 40 };
      /* ★ 기준은 «서 있는 곳» 이 아니라 «최근에 일한 곳» 이다 (REP_DECAY_GRACE).
       *   눌러앉기만 해도 유지되면 «신경 쓰게» 만들자는 취지가 무너진다. */
      st.repTouch = { greenhold: 100 };        // 오늘 일했다 · kingsrest 는 기록 없음
      State.advanceDays(3);
      ok(st.reputation.greenhold === 300,
        '최근에 일한 도시는 유예 안에서 안 깎인다', String(st.reputation.greenhold));
      ok(st.reputation.kingsrest === 300 - 3 * State.REP_DECAY_PER_DAY,
        '일한 적 없는 도시는 하루 REP_DECAY_PER_DAY 씩 깎인다', String(st.reputation.kingsrest));
      State.advanceDays(10);
      ok(st.reputation.greenhold < 300,
        '유예가 지나면 머물러 있어도 깎인다', String(st.reputation.greenhold));
      ok(st.reputation.frostgate === State.REP_DECAY_FLOOR,
        '바닥에서 멈춘다', String(st.reputation.frostgate));
      ok(st.reputation.millford === 40,
        '바닥보다 낮은 도시는 안 건드린다 (주점이 다시 잠기면 안 된다)', String(st.reputation.millford));

      State.advanceDays(1000);
      const lo = Math.min(...Object.values(st.reputation).filter((v) => v !== 40));
      ok(lo >= State.REP_DECAY_FLOOR, '아무리 오래 둬도 바닥 아래로 안 간다', String(lo));
    }

    /* ── 평판 초기화 (DATA_VERSION 7) ──────────────────────────────────── */
    {
      const store2 = {};
      const prev2 = globalThis.localStorage;
      globalThis.localStorage = {
        getItem: (k) => (k in store2 ? store2[k] : null),
        setItem: (k, v) => { store2[k] = String(v); },
        removeItem: (k) => { delete store2[k]; },
      };
      const mkRep = (ver) => {
        State.newGame(4242, '평판');
        State.save();
        const raw = JSON.parse(globalThis.localStorage.getItem(State.SAVE_KEY));
        const body = raw && raw.data ? raw.data : raw;
        body.dataVersion = ver;
        body.reputation = { greenhold: 100, kingsrest: 77, frostgate: 55 };
        globalThis.localStorage.setItem(State.SAVE_KEY, JSON.stringify(raw));
        State.load();
        return State.state;
      };
      const r1 = mkRep(6);
      ok(r1.reputation.kingsrest === 0 && r1.reputation.frostgate === 0,
        '버전 6 세이브를 열면 도시 평판이 초기화된다',
        `왕의안식 ${r1.reputation.kingsrest} / 서리관문 ${r1.reputation.frostgate}`);
      const startCity = World.START_CITY;
      ok(r1.reputation[startCity] === State.START_REP,
        '초기화해도 시작 도시는 START_REP 로 남는다',
        `${startCity} = ${r1.reputation[startCity]} (기대 ${State.START_REP})`);
      globalThis.localStorage = prev2;

      /* ★ 미래 위험 — DATA_VERSION 을 8 로 올릴 때 이 관문이 따라 올라가면
       *   그때 또 남의 평판이 날아간다. 실행으로는 못 잰다 (cur===DATA_VERSION 이면
       *   마이그레이션이 맨 위에서 반환한다) — §27.5 에서 겪었다. 값으로 못 박는다. */
      /* 실패 페널티가 성공 보상과 같은가 — «실패 한 번 = 성공 한 번을 통째로 날림» */
    {
      const Qm = await import('../src/game/quest.js');
      const bad = [];
      for (const rk of ['F', 'E', 'D', 'C', 'B', 'A', 'S']) {
        const g = Qm.REP_GAIN[rk];
        if (!(g > 0)) bad.push(`${rk} 획득 ${g}`);
      }
      okAll(bad, '랭크별 평판 획득이 전부 양수다', 7);
      ok(Qm.REP_GAIN.S > Qm.REP_GAIN.F, '고랭크가 저랭크보다 평판을 많이 준다',
        `F ${Qm.REP_GAIN.F} / S ${Qm.REP_GAIN.S}`);
    }

    ok(State.REP_RESET_VERSION === 7,
        'REP_RESET_VERSION 이 7 로 고정돼 있다 (DATA_VERSION 을 올려도 따라 올리지 마라)',
        String(State.REP_RESET_VERSION));
      ok(State.REP_RESET_VERSION !== State.RANK_RESET_VERSION,
        '평판 리셋과 랭킹 리셋이 따로 관리된다',
        `평판 ${State.REP_RESET_VERSION} / 랭킹 ${State.RANK_RESET_VERSION}`);
    }

    ok(State.RANK_RESET_VERSION === 8,
      'RANK_RESET_VERSION 이 8 이다 (평소엔 고정 — 리셋할 때만 올린다)',
      String(State.RANK_RESET_VERSION));
  }
}

section('10슬롯 · 세트 · 던전 진행도 세이브 왕복');
if (State && Gear && Merc && Items && RngMod) {
  State.newGame(778899, '스모크 용병단');
  const st = State.state;
  const m = st.roster[0];
  ok(!!m, '새 게임에 용병이 있다');
  if (m) {
    const rng = new RngMod.RNG(31337);
    let filled = 0;
    for (const sl of Items.SLOTS) {
      const it = Gear.rollItem({ ilvl: 5, slot: sl, rng });
      if (!it) continue;
      State.addItem(it);
      const r = Gear.equipItem(st, m, it, sl);
      if (r && r.ok !== false) filled++;
    }
    ok(filled >= 8, '용병 하나가 8칸 이상 장착할 수 있다', `실제 ${filled}`);
    ok(Object.values(Merc.mercStats(m, st.items)).every(isNum), '10슬롯 장착 후 스탯이 전부 유한값');

    /* 신화 세트는 ilvl 80 (minLv 75) 이라 만렙 용병만 낄 수 있다.
     *
     * ★★ 예전에는 4번 던전 세트(성좌의 은총)가 «아키타입 제한이 없다» 는 것에 기대어
     *   그걸 못 박아 썼다. 그 세트가 사제 전용이 되면서 이 검사가 통째로 깨졌다 —
     *   **데이터의 우연한 성질에 기대면 데이터가 바뀔 때 검사가 죽는다.**
     *   이제 «이 용병이 낄 수 있는 세트» 를 그때그때 고른다. */
    const myArch = (Classes.getClass(m.classId) || {}).arch;
    const wearable = (Sets.SET_LIST || []).find((x) => Array.isArray(x.archs) && x.archs.includes(myArch));
    const setId = wearable ? wearable.id : (Dungeons ? Dungeons.DUNGEON_LIST[3].setId : 'constellation');
    m.level = 80;
    const before = Merc.mercStats(m, st.items);
    let put = 0;
    for (const sl of ['head', 'body', 'legs']) {
      const pc = Gear.rollSetItem({ setId, slot: sl, ilvl: 80, rng });
      if (!pc) continue;
      State.addItem(pc);
      const r = Gear.equipItem(st, m, pc, sl);
      if (r && r.ok !== false) put++;
    }
    ok(put === 3, '신화 세트 3칸 장착', `실제 ${put}`);
    const row = Gear.setProgress(m, st.items).find((x) => x.setId === setId);
    ok(!!row && row.count === 3, '세트 진행도가 3개로 잡힌다', row ? row.count : 'none');
    const bonus = Gear.setBonusStats(m, st.items);
    ok(Object.keys(bonus.stats).length > 0 || Object.keys(bonus.mods).length > 0,
      '3세트 효과가 실제로 붙는다');
    const after = Merc.mercStats(m, st.items);
    ok(Object.values(after).every(isNum), '세트 장착 후 스탯이 전부 유한값');
    ok(after.hp >= before.hp || after.atk >= before.atk, '세트를 끼우면 스탯이 오른다');
  }

  if (Dungeons && Dungeon) {
    const dId = Dungeons.DUNGEON_LIST[0].id;
    try { State.recordDungeonWave(dId, 3, { total: 10 }, st); } catch { /* 폴백 경로 */ }
    ok(Dungeon.dungeonProgress(st, dId).bestWave >= 0, '던전 진행도 조회가 동작');
  }

  const json = JSON.stringify(st);
  const back = JSON.parse(json);
  const m2 = back.roster[0];
  ok(!!m2 && Items.SLOTS.every((sl) => sl in (m2.equipment || {})),
    'equipment 10칸이 JSON 왕복에서 살아남는다');
  const mythic = (back.items || []).filter((x) => x && x.rarity === 5);
  ok(mythic.length >= 3, '신화 세트 아이템이 세이브에 실린다', `실제 ${mythic.length}`);
  ok(mythic.every((x) => x.setId), '세이브의 신화 아이템이 setId 를 갖는다');

  // 옛 3슬롯 세이브 불러오기
  const legacySave = JSON.parse(json);
  legacySave.dataVersion = 1;
  legacySave.version = 1;
  for (const mm of legacySave.roster) {
    const eq = mm.equipment || {};
    mm.equipment = { weapon: eq.weapon || null, armor: eq.body || null, accessory: eq.neck || null };
  }
  delete legacySave.dungeons;
  ok(State.importState(legacySave) !== false, '옛 3슬롯 세이브 importState 성공');
  const m3 = State.state.roster[0];
  ok(!!m3 && Items.SLOTS.every((sl) => sl in (m3.equipment || {})),
    '옛 3슬롯 세이브가 10칸으로 정규화된다', JSON.stringify(m3 && m3.equipment));
  ok(!!m3 && !('armor' in m3.equipment), '옛 슬롯 키(armor)가 남아 있지 않다');
  ok(!!m3 && Object.values(Merc.mercStats(m3, State.state.items)).every(isNum),
    '옛 세이브 정규화 후 스탯이 유한값');
}


section('index.html 참조 파일');
{
  const htmlPath = join(rootDir, 'index.html');
  if (!existsSync(htmlPath)) ok(false, 'index.html 존재');
  else {
    const html = readFileSync(htmlPath, 'utf8');
    const refs = [
      ...[...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...html.matchAll(/<link[^>]*\shref=["']([^"']+)["']/g)].map((m) => m[1]),
    ].filter((r) => !/^(https?:)?\/\//.test(r) && !r.startsWith('data:'));
    const bad = refs.filter((r) => !existsSync(join(rootDir, r.split('?')[0]))).map((r) => `${r} 없음`);
    okAll(bad, 'index.html 이 참조하는 파일 실재', refs.length);
    ok(/type=["']module["']/.test(html), 'index.html 이 ES 모듈로 로드');
  }
}


/* ───────────────────── 펫 / 무한의 탑 ───────────────────── */

section('펫 / 무한의 탑');
{
  const Pets = await import('../src/data/pets.js');
  const TD = await import('../src/data/tower.js');
  const Pet = await import('../src/game/pet.js');
  const Tower = await import('../src/game/tower.js');
  const Skills = await import('../src/data/skills.js');
  const Parts = await import('../src/art/parts.js');
  const Pal = await import('../src/art/palette.js');

  // 1) 종 정의 무결성 — 어휘 밖 값은 조용히 무시되므로 여기서 잡아야 한다
  const ROLES = ['attacker', 'healer', 'buffer', 'guardian'];
  const FX = ['slash', 'pierce', 'blunt', 'arrow', 'bolt', 'heal', 'buff', 'fire', 'shadow', 'lightning', 'holy', 'nature', 'poison'];
  const DMG = ['phys', 'magic', 'none'];
  const PSLOT = { skin: 'SKIN', hair: 'HAIR', metal: 'METAL', cloth: 'CLOTH', leather: 'LEATHER', glow: 'GLOW' };
  const vocab = new Set(Parts.PART_VOCAB || Object.keys(Parts.PARTS));
  const bad = [];
  for (const p of Pets.PETS) {
    if (!ROLES.includes(p.role)) bad.push(`${p.id}: role='${p.role}'`);
    if (!(p.tier >= 1 && p.tier <= 5)) bad.push(`${p.id}: tier=${p.tier}`);
    if (!FX.includes(p.basicFx)) bad.push(`${p.id}: fx='${p.basicFx}'`);
    if (!DMG.includes(p.basicDmgType)) bad.push(`${p.id}: dmgType='${p.basicDmgType}'`);
    const FPX = need('art/parts_front.js');
    if (!['melee', 'ranged'].includes(p.basicRange)) bad.push(`${p.id}: range='${p.basicRange}'`);
    for (const sk of p.skills || []) if (!Skills.getSkill(sk)) bad.push(`${p.id}: 없는 스킬 '${sk}'`);
    for (const [k, v] of Object.entries(p.sprite || {})) {
      if (k === 'palette') {
        for (const [ps, pv] of Object.entries(v)) {
          const pool = Pal.PALETTE_SETS[PSLOT[ps]];
          const names = Array.isArray(pool) ? pool : (pool ? Object.keys(pool) : null);
          if (!names || !names.includes(pv)) bad.push(`${p.id}: palette ${ps}='${pv}'`);
        }
      } else if (k === 'battleSheet') {
        /* ★ 통짜 시트는 조립 파츠 어휘가 아니다 — 대신 «열 장이 다 있는가» 로 검사한다.
         *   이 갈래가 없으면 새 필드가 «없는 파츠» 로 걸려서, 화이트리스트가 조용히
         *   기능을 막는 그 함정에 다시 빠진다 (sanitizeSquadsFull 의 p, setDefOf 의 prefer). */
        const KEYS10 = ['idleA', 'idleB', 'walkA', 'walkB', 'atk0', 'atk1', 'atk2', 'hit0', 'die0', 'die1'];
        const miss = KEYS10.filter((kk) => !FPX || !FPX.FRONT_PARTS[`${v}_${kk}`]);
        if (miss.length) bad.push(`${p.id}: 시트 '${v}' 프레임 부족 (${miss.slice(0, 3).join(',')}…)`);
      } else if (typeof v === 'string' && !vocab.has(v)) bad.push(`${p.id}: 파츠 '${v}'`);
    }
  }
  okAll(bad, '펫 종 정의가 전부 유효한 어휘를 쓴다', Pets.PETS.length);

  // 2) 역할이 4종 다 있어야 한다 (하나라도 빠지면 기획이 반쪽이 된다)
  const roles = new Set(Pets.PETS.map((p) => p.role));
  okAll(ROLES.filter((r) => !roles.has(r)).map((r) => `${r} 없음`), '펫 역할 4종이 전부 존재', ROLES.length);

  // 3) 층별 곡선이 단조 증가하고 범위를 안 벗어난다
  let prev = -1, curveBad = [];
  for (let f = 1; f <= TD.TOWER_FLOORS; f++) {
    const p = TD.floorPower(f);
    if (p < prev - 1e-9) curveBad.push(`${f}층에서 배율 감소`);
    prev = p;
  }
  if (Math.abs(TD.floorPower(1) - TD.POWER_MIN) > 1e-6) curveBad.push('1층이 POWER_MIN 이 아니다');
  if (Math.abs(TD.floorPower(TD.TOWER_FLOORS) - TD.POWER_MAX) > 1e-6) curveBad.push('최고층이 POWER_MAX 가 아니다');
  okAll(curveBad, '층 배율이 단조 증가하고 양끝이 맞는다', TD.TOWER_FLOORS);

  // 4) 비용식 — 합산식이 «층마다 걷는 값» 의 합과 일치하나
  const costBad = [];
  for (const [a, b] of [[1, 1], [1, 100], [50, 500], [1, 500]]) {
    let loop = 0;
    for (let f = a; f <= b; f++) loop += TD.floorCost(f);
    if (loop !== TD.costRange(a, b)) costBad.push(`costRange(${a},${b})=${TD.costRange(a, b)} vs 루프 ${loop}`);
  }
  /* ★ 화면이 보여 주는 총액과 실제로 걷는 액수가 같아야 한다.
   *   한때 닫힌 식(등차수열+제곱합)을 썼는데, 실제로는 **층마다 반올림해서** 걷으므로
   *   몇 G 씩 어긋났다 (13,170 vs 13,169). 이 검사가 잡았다. */
  okAll(costBad, '층 비용 합산식이 «층마다 걷는 값» 의 합과 일치', 4);

  /* 비용은 깊이에 **가파르게** 실려야 한다 — 탑이 골드 소모 역할을 하는 근거다.
   * 값을 박지 않는다: 곡선을 조정해도 «가파른가» 만 본다. */
  const cLo = TD.floorCost(50);
  const cHi = TD.floorCost(TD.TOWER_FLOORS);
  ok(cHi / cLo >= 20,
    '깊은 층이 얕은 층보다 훨씬 비싸다 (500층 / 50층 ≥ 20배)',
    `${cLo}G → ${cHi}G (${(cHi / cLo).toFixed(1)}배)`);
  let mono = true;
  for (let f = 2; f <= TD.TOWER_FLOORS; f++) if (TD.floorCost(f) < TD.floorCost(f - 1)) { mono = false; break; }
  ok(mono, '층 비용이 단조 증가한다');

  // 5) '매달 1일' 판정 — dayOfWeek 만 보면 한 달에 4번 참이 된다(실제로 겪은 함정)
  const State = await import('../src/game/state.js');
  const entryDays = [];
  for (let d = 1; d <= State.DAYS_PER_MONTH * 3; d++) {
    if (Tower.isEntryDay({ day: d })) entryDays.push(d);
  }
  const wantEntry = [1, State.DAYS_PER_MONTH + 1, State.DAYS_PER_MONTH * 2 + 1];
  ok(JSON.stringify(entryDays) === JSON.stringify(wantEntry),
    '탑 입장일이 매달 1일뿐 (3개월 전수)', `실제 ${entryDays.join(',')} / 기대 ${wantEntry.join(',')}`);

  // 6) 소탕 상한
  const sweepBad = [];
  if (TD.sweepLimit(0) !== 0) sweepBad.push('미등반인데 소탕 구간이 생긴다');
  if (TD.sweepLimit(100) !== 0) sweepBad.push('100층에서 소탕 구간이 생긴다');
  if (TD.sweepLimit(250) !== 150) sweepBad.push(`250층 소탕이 ${TD.sweepLimit(250)}`);
  okAll(sweepBad, '소탕 상한 = 최고 기록 −100', 3);

  // 7) 펫 UnitDef 가 엔진 계약을 지키는가 — pet 표식과 진형 미개입
  State.newGame(777, '스모크');
  const st = State.state;
  const sq = st.squads[0];
  const made = [['pet_warden', 'S'], ['pet_chalice', 'A'], ['pet_starcalf', 'B']]
    .map(([sid, g]) => Pet.makePet(st, sid, g));
  made.forEach((p, i) => { st.pets.push(p); Pet.assignPet(st, sq.id, i, p.uid); });
  const defs = Pet.petUnitDefs(st, sq);
  const defBad = [];
  if (defs.length !== 3) defBad.push(`펫 UnitDef ${defs.length}개`);
  for (const d of defs) {
    if (d.pet !== true) defBad.push(`${d.name}: pet 표식 없음 (승패 판정에서 안 빠진다)`);
    if (d.slotIndex != null) defBad.push(`${d.name}: slotIndex 가 있다 (진형 보정을 잘못 받는다)`);
    if (!d.slot || d.slot.x == null) defBad.push(`${d.name}: slot 좌표 없음`);
    if (!Array.isArray(d.specials)) defBad.push(`${d.name}: specials 배열 아님`);
  }
  const guard = defs.find((d) => d.petRole === 'guardian');
  if (guard && !(guard.guardChance > 0)) defBad.push('수호 펫에 guardChance 가 없다');
  okAll(defBad, '펫 UnitDef 가 엔진 계약을 지킨다', defs.length);

  // 8) ★ 프로덕션 아군 경로에 펫이 실리는가.
  //    이 프로젝트는 진형·세트효과가 각각 한 번씩 "호출자 없는 경로"에만 배선돼 조용히 안 먹었다.
  const Quest = await import('../src/game/quest.js');
  const allies = Quest.questBattleDefs(Tower.towerQuest(st, 1, sq.id), 0, st, sq.id).allies;
  ok(allies.filter((a) => a.pet).length === 3,
    'questBattleDefs(프로덕션 경로) 아군에 펫 3기가 실린다',
    `실제 ${allies.filter((a) => a.pet).length}기 / 아군 ${allies.length}기`);

  // 9) 지휘 펫 배율이 실제로 단원 스탯에 곱해지는가 (전투 전 적용 = 최대 체력까지 오른다)
  sq.petUids = [null, null, null];
  const before = Quest.questBattleDefs(Tower.towerQuest(st, 1, sq.id), 0, st, sq.id).allies.filter((a) => !a.pet);
  Pet.assignPet(st, sq.id, 0, made[2].uid);   // starcalf = buffer
  const after = Quest.questBattleDefs(Tower.towerQuest(st, 1, sq.id), 0, st, sq.id).allies.filter((a) => !a.pet);
  const hpUp = after.length && before.length && after[0].stats.hp >= before[0].stats.hp;
  const atkUp = after.length && before.length && after[0].stats.atk > before[0].stats.atk;
  ok(atkUp, '지휘 펫이 단원 공격력을 올린다',
    `${before[0]?.stats.atk?.toFixed(1)} → ${after[0]?.stats.atk?.toFixed(1)}`);
  ok(hpUp, '지휘 펫 버프가 최대 체력에도 반영된다 (엔진 버프로는 불가능한 부분)',
    `${before[0]?.stats.hp?.toFixed(0)} → ${after[0]?.stats.hp?.toFixed(0)}`);

  // 10) 세이브 왕복 + 손상 세이브 복구
  const json = JSON.stringify(st);
  State.importState(JSON.parse(json));
  ok(State.state.pets.length === 3, '펫이 세이브 왕복을 견딘다', `${State.state.pets.length}마리`);
  const broken = JSON.parse(json);
  broken.pets = null; broken.tower = 'garbage'; broken.petSeq = -9;
  State.importState(broken);
  const r = State.state;
  ok(Array.isArray(r.pets) && r.pets.length === 0 && r.tower && typeof r.tower.best === 'number' && r.petSeq >= 0,
    '손상된 펫/탑 필드를 로드에서 복구한다',
    `pets=${JSON.stringify(r.pets)} tower=${JSON.stringify(r.tower)} seq=${r.petSeq}`);
}

/* ───────────────────── 황금 나락 ───────────────────── */

section('황금 나락');
{
  const AD = await import('../src/data/abyss.js');
  const Abyss = await import('../src/game/abyss.js');
  const State = await import('../src/game/state.js');
  const Quest = await import('../src/game/quest.js');

  // 1) 보상 합산식 — 등차수열 + 금고 가산분을 닫힌 식으로 계산한다. 루프와 일치해야 한다.
  const goldBad = [];
  for (const d of [0, 1, 9, 10, 11, 37, 60, 100, AD.DEPTH_CAP]) {
    let loop = 0;
    for (let i = 1; i <= d; i++) loop += AD.depthGold(i);
    if (loop !== AD.goldRange(d)) goldBad.push(`goldRange(${d})=${AD.goldRange(d)} vs 루프 ${loop}`);
  }
  okAll(goldBad, '나락 보상 합산식이 루프와 일치', 9);

  // 2) 금고층은 정확히 VAULT_EVERY 배수에서만, 배율만큼만 준다
  const vaultBad = [];
  for (let d = 1; d <= 60; d++) {
    const want = AD.GOLD_PER_DEPTH * d * (d % AD.VAULT_EVERY === 0 ? AD.VAULT_MULT : 1);
    if (AD.depthGold(d) !== want) vaultBad.push(`${d}심층 ${AD.depthGold(d)} != ${want}`);
  }
  okAll(vaultBad, '금고층 배율이 VAULT_EVERY 배수에서만 걸린다', 60);

  // 3) 난이도 축이 단조 증가한다 (배율·적 레벨·적 수 어느 하나도 뒤로 가면 안 된다)
  let pPrev = -1, lPrev = -1, cPrev = -1;
  const curveBad = [];
  for (let d = 1; d <= AD.DEPTH_CAP; d++) {
    const p = AD.depthPower(d), l = AD.depthEnemyLevel(d), c = AD.depthEnemyCount(d);
    if (p < pPrev - 1e-9) curveBad.push(`${d}심층 배율 감소`);
    if (l < lPrev) curveBad.push(`${d}심층 적 레벨 감소`);
    if (c < cPrev) curveBad.push(`${d}심층 적 수 감소`);
    pPrev = p; lPrev = l; cPrev = c;
  }
  if (Math.abs(AD.depthPower(1) - AD.POWER_BASE) > 1e-9) curveBad.push('1심층이 POWER_BASE 가 아니다');
  if (AD.depthEnemyLevel(AD.DEPTH_CAP) !== 80) curveBad.push('깊은 곳 적 레벨이 80 에 안 닿는다');
  okAll(curveBad, '나락 난이도 축 3개가 전부 단조 증가', AD.DEPTH_CAP);

  // 4) '주 1회' 판정 — 요일이 아니라 주 번호로 세는지. (탑은 dayOfWeek 만 보다가
  //    한 달에 4번 열리는 함정을 밟은 전례가 있다.)
  const weekBad = [];
  for (let d = 1; d <= 30; d++) {
    const want = Math.floor((d - 1) / State.DAYS_PER_WEEK);
    if (AD.weekIndex(d) !== want) weekBad.push(`day ${d} → ${AD.weekIndex(d)} (기대 ${want})`);
  }
  // 같은 주 안에서는 막히고, 주가 바뀌면 열린다
  const stub = (day, lastRunDay) => ({ day, abyss: { lastRunDay } });
  if (!Abyss.alreadyRanThisWeek(stub(3, 1))) weekBad.push('같은 주(1일→3일)에 또 들어가진다');
  if (Abyss.alreadyRanThisWeek(stub(8, 1))) weekBad.push('다음 주(8일)에 안 열린다');
  if (Abyss.alreadyRanThisWeek(stub(1, 0))) weekBad.push('한 번도 안 갔는데 막힌다');
  okAll(weekBad, '나락은 요일이 아니라 주 번호로 1회를 센다', 33);

  // 5) ★ 프로덕션 아군 경로를 그대로 타는가 (자체 조립기를 쓰면 세트 고유효과가 빠진다)
  State.newGame(778, '나락스모크');
  const st = State.state;
  const sq = st.squads[0];
  const q = Abyss.abyssQuest(st, 12, sq.id);
  const cfg = Quest.questBattleDefs(q, 0, st, sq.id);
  const defBad = [];
  if (!cfg.allies.length) defBad.push('아군이 비었다');
  if (cfg.enemies.length !== AD.depthEnemyCount(12)) defBad.push(`적 ${cfg.enemies.length}기 (기대 ${AD.depthEnemyCount(12)})`);
  if (q.reward.gold !== 0) defBad.push('합성 의뢰에 골드 보상이 붙어 있다 — 관전만으로 돈이 들어온다');
  if ((q.reward.itemRolls || []).length) defBad.push('장비 보상이 붙어 있다 — 나락은 골드 전용이다');
  if (q.days !== 0) defBad.push('부대를 날짜로 잠근다');
  if (q.cityId != null) defBad.push('cityId 가 있다 — 평판 경로를 탄다');
  okAll(defBad, '나락 편성이 프로덕션 경로를 타고 보상 계약을 지킨다', 6);

  // 6) 손상 세이브 복구
  const json = JSON.stringify(st);
  const broken = JSON.parse(json);
  broken.abyss = 'garbage';
  State.importState(broken);
  const a = State.state.abyss;
  ok(a && typeof a.best === 'number' && a.best === 0 && typeof a.lastRunDay === 'number',
    '손상된 나락 필드를 로드에서 복구한다', `abyss=${JSON.stringify(a)}`);
}

/* ───────────────────── 세이브 관문 (암호) ───────────────────── */

section('세이브 관문');
{
  /* 이 절이 있는 이유:
   * "업뎃 이전 세이브면 딱 한 번만 암호를 묻는다" 를 구현했는데, **파일 불러오기 쪽에서
   * 맞는 암호를 넣어도 실패했다.** importSaveText 가 payload 를 localStorage 에 쓴 뒤
   * load() 를 부르는데, load() 는 sealMark 가 없으면 다시 관문을 세우고 newGame() 을 돌린다.
   * 결과: 암호를 맞춘 사람이 세이브를 못 살리고 **하던 게임까지 날아갔다.**
   * 관문이 두 곳(localStorage / 파일)이라 한쪽만 고치면 조용히 어긋난다 — 둘 다 여기서 잰다. */

  // savefile.js 는 브라우저 저장소를 쓴다. node 에서 재려면 최소 스텁이 필요하다.
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  const State = await import('../src/game/state.js');
  const SaveFile = await import('../src/ui/savefile.js');
  const PW = 'qwe123!@#';

  const snapshot = () => {
    State.newGame(4242, '관문검사');
    State.state.gold = 12345;
    State.state.day = 77;
    return JSON.parse(JSON.stringify(State.state));
  };
  const base = snapshot();
  /** 봉인 이전에 내보내던 파일 (봉투 + state 평문) */
  const legacyFile = () => {
    const st = JSON.parse(JSON.stringify(base));
    delete st.sealMark;
    return JSON.stringify({
      app: 'merc-company', saveVersion: State.SAVE_VERSION, exportedAt: '2026-08-01T00:00:00.000Z',
      summary: { day: st.day, gold: st.gold, roster: st.roster.length, city: st.cityId },
      state: st,
    });
  };
  /** 아주 옛날: state 를 그대로 저장한 파일 */
  const rawFile = () => {
    const st = JSON.parse(JSON.stringify(base));
    delete st.sealMark;
    return JSON.stringify(st);
  };
  /** 다른 게임을 진행 중인 상태로 만든다 (실패한 불러오기가 이걸 날리면 안 된다) */
  const inProgress = () => { State.newGame(1, '진행중'); State.save(); };

  // 1) localStorage 관문 — 표식 없는 세이브는 한 번 붙잡고, 세이브를 지우지 않는다
  const g1 = [];
  const old = JSON.parse(JSON.stringify(base));
  delete old.sealMark;
  globalThis.localStorage.setItem(State.SAVE_KEY, JSON.stringify(old));
  if (State.load() !== false) g1.push('표식 없는 세이브가 그냥 통과했다');
  const held = State.takeLockedSave();
  if (!held) g1.push('붙잡아 둔 세이브가 없다 — 원본이 사라졌다');
  else if (held.day !== 77 || held.gold !== 12345) g1.push(`보관된 세이브가 다르다 (${held.day}일 ${held.gold}G)`);
  okAll(g1, 'localStorage 관문이 옛 세이브를 붙잡고 원본을 지킨다', 3);

  // 2) 암호 통과 후에는 다시 안 묻는다 ("딱 한 번" 계약)
  const g2 = [];
  if (!State.acceptLockedSave(held)) g2.push('acceptLockedSave 실패');
  if (State.state.day !== 77 || State.state.gold !== 12345) g2.push('살린 세이브 내용이 다르다');
  if (State.state.sealMark !== State.SEAL_MARK) g2.push('표식이 안 찍혔다');
  if (State.load() !== true) g2.push('재부팅에서 세이브를 못 읽는다');
  if (State.takeLockedSave()) g2.push('두 번째 부팅에서 또 묻는다 — "딱 한 번" 계약 위반');
  okAll(g2, '암호를 통과하면 표식이 찍혀 다시 묻지 않는다', 5);

  // 3) 파일 관문 — 암호 없이는 거절하고 needPassword 를 켠다
  const g3 = [];
  for (const [tag, text] of [['봉투형', legacyFile()], ['원시형', rawFile()]]) {
    inProgress();
    const r = SaveFile.importSaveText(text, {});
    if (r.ok) g3.push(`${tag}: 암호 없이 통과했다`);
    if (!r.needPassword) g3.push(`${tag}: needPassword 가 안 켜졌다 — 호출부가 암호를 못 묻는다`);
    const r2 = SaveFile.importSaveText(text, { password: '틀린암호' });
    if (r2.ok) g3.push(`${tag}: 틀린 암호로 통과했다`);
    // ★ 실패한 불러오기가 진행 중이던 게임을 날리면 안 된다
    if (State.state.day !== 1) g3.push(`${tag}: 실패한 불러오기가 진행 중이던 게임을 바꿨다 (${State.state.day}일차)`);
  }
  okAll(g3, '옛 형식 파일은 암호 없이 거절하고, 실패해도 진행 중인 게임을 안 건드린다', 8);

  // 4) ★ 맞는 암호로는 반드시 살아나야 한다 (여기가 실제로 깨져 있던 지점)
  const g4 = [];
  for (const [tag, text] of [['봉투형', legacyFile()], ['원시형', rawFile()]]) {
    inProgress();
    const r = SaveFile.importSaveText(text, { password: PW });
    if (!r.ok) { g4.push(`${tag}: 맞는 암호인데 실패했다 — "${r.error}"`); continue; }
    if (State.state.day !== 77 || State.state.gold !== 12345) {
      g4.push(`${tag}: 불러온 내용이 다르다 (${State.state.day}일 ${State.state.gold}G)`);
    }
    if (State.state.sealMark !== State.SEAL_MARK) g4.push(`${tag}: 표식이 안 찍혔다 — 다음 부팅에서 또 묻는다`);
    if (State.load() !== true || State.takeLockedSave()) g4.push(`${tag}: 재부팅에서 또 관문에 걸린다`);
  }
  okAll(g4, '맞는 암호로 옛 파일을 살리면 그대로 이어지고 다시 안 묻는다', 6);

  // 5) 봉인된(현재 형식) 파일은 암호를 묻지 않는다. 본문을 고치면 거절한다.
  const g5 = [];
  State.newGame(4242, '봉인검사');
  State.state.gold = 555; State.state.day = 9; State.save();
  const plain = JSON.stringify(State.state);
  // exportSave 는 DOM 을 쓴다 — 봉투는 같은 규칙으로 직접 만든다
  const sealedText = (() => {
    const sum = (() => { let h = 2166136261 >>> 0; for (let i = 0; i < plain.length; i++) { h ^= plain.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; })();
    function* ks(seed) { let x = (seed >>> 0) || 0x9e3779b9; for (;;) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; yield x & 0xff; yield (x >>> 8) & 0xff; yield (x >>> 16) & 0xff; yield (x >>> 24) & 0xff; } }
    const bytes = Buffer.from(plain, 'utf8');
    const k = ks(sum ^ 0x4d455243);
    const out = Buffer.alloc(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ k.next().value;
    return JSON.stringify({ app: 'merc-company', saveVersion: State.SAVE_VERSION, seal: 1, sum, data: out.toString('base64') });
  })();
  inProgress();
  const rs = SaveFile.importSaveText(sealedText, {});
  if (!rs.ok) g5.push(`봉인 파일이 그냥 안 열린다 — "${rs.error}"`);
  if (rs.needPassword) g5.push('봉인 파일인데 암호를 묻는다 — "그 이후로는 자유롭게" 계약 위반');
  if (State.state.day !== 9) g5.push(`봉인 파일 내용이 다르다 (${State.state.day}일차)`);
  const broken = JSON.parse(sealedText);
  broken.data = `${broken.data.slice(0, -4)}AAAA`;
  inProgress();
  if (SaveFile.importSaveText(JSON.stringify(broken), {}).ok) g5.push('본문을 고친 봉인 파일이 통과했다');
  if (State.state.day !== 1) g5.push('손상 파일 거절이 진행 중이던 게임을 건드렸다');
  okAll(g5, '봉인된 파일은 암호 없이 열리고, 본문을 고치면 거절한다', 5);

  /* 5b) ★ 관문에 걸린 세이브는 **어떤 경로로도 덮이면 안 된다.**
   *
   *  실제로 날려 먹은 버그다: 관문 분기에서 newGame() 을 부르면 seed 가 채워져
   *  started() 가 참이 되고, app.js 가 boot() 에서 걸어 둔 beforeunload → save() 가
   *  암호 모달 위에서 새로고침 한 번에 1일차 새 게임을 옛 세이브 위에 쓴다.
   *  게다가 sealMark 가 찍혀 다음 부팅엔 관문조차 안 뜬다 — 사라진 줄도 모르게 된다. */
  const g5b = [];
  {
    const old = JSON.parse(JSON.stringify(base));
    delete old.sealMark;
    old.day = 300; old.gold = 424242;
    const before = JSON.stringify(old);
    globalThis.localStorage.setItem(State.SAVE_KEY, before);

    if (State.load() !== false) g5b.push('관문에 안 걸렸다');
    // ★ 이 시점의 state 는 "시작 전 빈 상태"여야 한다. seed 가 채워지면 save() 가 통과한다.
    if (State.state.seed) g5b.push(`관문 직후 seed 가 채워져 있다 (${State.state.seed}) — save() 가 옛 세이브를 덮는다`);

    // beforeunload 가 부르는 것과 같은 호출
    const saved = State.save();
    if (saved !== false) g5b.push('관문 상태에서 save() 가 통과했다');
    if (globalThis.localStorage.getItem(State.SAVE_KEY) !== before) {
      g5b.push('save() 가 잠긴 세이브를 덮었다 — 진행이 사라진다');
    }
    // 그래도 원본은 살아 있어야 하고, 암호를 맞추면 살아나야 한다
    const held = State.takeLockedSave();
    if (!held || held.day !== 300 || held.gold !== 424242) g5b.push(`보관된 원본이 다르다 (${JSON.stringify(held && { d: held.day, g: held.gold })})`);
    if (held && !State.acceptLockedSave(held)) g5b.push('암호 통과 후 복원 실패');
    if (State.state.day !== 300 || State.state.gold !== 424242) g5b.push(`복원 결과가 다르다 (${State.state.day}일 ${State.state.gold}G)`);
  }
  okAll(g5b, '관문에 걸린 세이브는 save() 로도 덮이지 않는다', 7);

  /* 6) (제거됨) '1부대 전원 S 면 새 게임' 관문.
   *    정상 플레이어에게 반드시 걸리는 규칙이었고, 클라우드가 붙은 뒤로는 오탐이
   *    로컬과 서버를 동시에 날린다. 조작 대응은 랭킹 서버 검증이 맡는다
   *    (tools/cheatcheck.mjs 가 그쪽을 잰다). */

  // 7) 랭킹용 계측 필드 — 정규화가 화이트리스트라 여기 빠지면 로드마다 조용히 사라진다
  const g7 = [];
  State.newGame(4242, '계측필드');
  State.state.tower = { best: 120, bestDay: 57, lastRunDay: 57, lastRunFloor: 120 };
  State.state.abyss = { best: 44, bestDay: 61, lastRunDay: 68, lastRunDepth: 40, lastGold: 1000 };
  const round = JSON.parse(JSON.stringify(State.state));
  State.importState(round);
  if (State.state.tower.bestDay !== 57) g7.push(`tower.bestDay 가 왕복에서 사라졌다 (${State.state.tower.bestDay})`);
  if (State.state.abyss.bestDay !== 61) g7.push(`abyss.bestDay 가 왕복에서 사라졌다 (${State.state.abyss.bestDay})`);
  // rev 는 save() 마다 단조 증가해야 한다 (기기 간 최신 판정의 1차 기준)
  const r0 = State.state.rev || 0;
  State.save(); const r1 = State.state.rev;
  State.save(); const r2 = State.state.rev;
  if (!(r1 > r0 && r2 > r1)) g7.push(`rev 가 단조 증가하지 않는다 (${r0}→${r1}→${r2})`);
  if (!(State.state.savedAt > 0)) g7.push('savedAt 이 안 찍힌다');
  // 옛 세이브(필드 없음)도 깨지지 않고 0 으로 채워져야 한다
  const legacy = JSON.parse(JSON.stringify(State.state));
  delete legacy.rev; delete legacy.savedAt;
  delete legacy.tower.bestDay; delete legacy.abyss.bestDay;
  State.importState(legacy);
  if (State.state.tower.bestDay !== 0 || State.state.abyss.bestDay !== 0) {
    g7.push('옛 세이브에서 bestDay 가 0 으로 안 채워졌다');
  }
  okAll(g7, '랭킹용 계측 필드가 세이브 왕복을 견딘다', 6);

  delete globalThis.localStorage;
}

/* ───────────────── 서버 공유 규칙 드리프트 ───────────────── */

section('서버 공유 규칙');
{
  /* ★ 검증 규칙은 Edge Function 쪽에 **복사본**으로 산다 (supabase/functions/_shared/).
   *   복사본은 반드시 썩는다 — 밸런스를 고치고 재배포를 안 하면 서버가 옛 규칙으로
   *   판정해서 정상 플레이어를 거절하기 시작한다. 그게 조용히 일어나는 것만은 막는다. */
  const { execFileSync } = await import('node:child_process');
  let out = '';
  let failed = false;
  try {
    out = execFileSync(process.execPath, ['tools/syncshared.mjs', '--check'], { encoding: 'utf8' });
  } catch (e) {
    failed = true;
    out = String(e.stdout || e.message);
  }
  ok(!failed, '검증 규칙 복사본이 원본과 일치한다 (tools/syncshared.mjs --check)',
    out.trim().split(/\r?\n/).slice(0, 6).join(' | '));

  // 규칙 모듈이 의존성 0 모듈만 물고 있는가 — 서버(Deno)로 게임 전체가 딸려가면 안 된다
  const fsm = await import('node:fs');
  const pure = ['src/data/limits.js', 'src/data/abyss.js', 'src/data/tower.js'];
  const impure = pure.filter((f) => (fsm.readFileSync(f, 'utf8').match(/^import /gm) || []).length > 0);
  okAll(impure.map((f) => `${f} 에 import 가 생겼다`),
    '규칙이 쓰는 데이터 모듈은 의존성 0 을 유지한다', pure.length);
}

/* ─────────────────────── 전투 손실 기록 (result.margin) ─────────────────────── */
{
  section('전투 손실 기록');
  const E = await import('../src/battle/engine.js');
  const Q = await import('../src/game/quest.js');
  const St = await import('../src/game/state.js');
  const { getClass } = await import('../src/data/classes.js');
  const { rng, RNG } = await import('../src/core/rng.js');

  const SQ = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];
  St.newGame(4242, '손실');
  const st = St.state;
  st.roster = []; st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQ.forEach((c, i) => {
    st.roster.push({ uid: `m_${i}`, name: getClass(c).name, classId: c, level: 60, grade: 'B',
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 });
    sq.memberUids[i] = `m_${i}`;
  });
  const quest = Q.genQuests('frostgate', 300, new RNG(4242), 1)[0];
  const cfg = Q.questBattleDefs(quest, 0, st, sq.id);

  const run = (seed, enemyMult = 1) => {
    const b = E.createBattle({
      ...cfg,
      enemies: cfg.enemies.map((u) => ({ ...u, stats: { ...u.stats,
        hp: u.stats.hp * enemyMult, atk: u.stats.atk * enemyMult, def: u.stats.def * enemyMult } })),
      seed,
    });
    b.run();
    return b;
  };

  const b1 = run(12345);
  const m = b1.result.margin;
  ok(!!m, 'result.margin 이 채워진다');
  if (m) {
    // 살아남은 전투원 수와 어긋나면 안 된다 (펫은 양쪽 다 빼고 센다)
    const aliveAllies = b1.units.filter((u) => u.side === 'ally' && u.alive && !u.pet).length;
    ok(m.allyAlive === aliveAllies, 'margin.allyAlive 가 실제 생존자와 일치한다', `${m.allyAlive} vs ${aliveAllies}`);
    const okRange = m.allyHp >= 0 && m.allyHp <= 1 && m.enemyHp >= 0 && m.enemyHp <= 1
      && m.score >= -1.0001 && m.score <= 1.0001;
    ok(okRange, 'margin 값이 정의 범위 안에 있다', JSON.stringify(m));
    ok(m.allyCount === 7, 'margin.allyCount 가 출전 인원과 같다', String(m.allyCount));
  }

  // 이긴 판의 score 는 양수, 진 판은 음수여야 한다
  const won = run(12345, 1);
  const lost = run(12345, 40);
  ok(won.result.winner === 'ally' && won.result.margin.score > 0,
    '이긴 판의 margin.score 는 양수다', `${won.result.winner} ${won.result.margin.score.toFixed(3)}`);
  ok(lost.result.winner !== 'ally' && lost.result.margin.score < 0,
    '진 판의 margin.score 는 음수다', `${lost.result.winner} ${lost.result.margin.score.toFixed(3)}`);

  // 더 센 적을 만나면 덜 온전하게 끝난다 (단조성)
  const scores = [1, 2, 4, 8].map((k) => run(12345, k).result.margin.score);
  okAll(scores.slice(1).map((v, i) => (v > scores[i] + 1e-9 ? `x${[2, 4, 8][i]} 가 더 높다` : null)).filter(Boolean),
    '적이 세질수록 margin.score 가 내려간다', 3);

  /* ★ 가장 중요한 것: **기록이 난수를 안 먹는다.**
   *   먹으면 기존 밸런스 측정치(WAVE_POWER·탑·나락·세트)가 전부 무효가 된다.
   *   margin 은 이미 정해진 상태를 읽기만 하므로 전역 rng 도, 전투 rng 도 안 움직인다. */
  rng.s = 24680;
  const before = [rng.next(), rng.next(), rng.next()];
  rng.s = 24680;
  for (let i = 0; i < 5; i++) run(9000 + i);
  const after = [rng.next(), rng.next(), rng.next()];
  ok(before.join(',') === after.join(','), '손실 기록이 전역 rng 를 안 먹는다');

  // 같은 시드면 margin 도 같다 (전투 rng 소비가 안 늘었다는 뜻)
  const r1 = run(777).result.margin;
  const r2 = run(777).result.margin;
  ok(JSON.stringify(r1) === JSON.stringify(r2), '같은 시드면 margin 도 같다');

  /* -- 인계 누적 (쓰러진 사람이 되살아나면 안 된다) --------------------------
   * ★ `readWaveCarry(units, {})` 로 매 웨이브 새 객체를 주면 1웨이브에서 쓰러진 단원이
   *   3웨이브에 만피로 되살아난다. 실제로 balance.mjs 를 공용 함수로 합치다 밟았고
   *   3웨이브 의뢰가 쉬워져 랭크 목표가 깨졌다. 계약을 검사로 굳혀 둔다. */
  {
    const defs = [{ uid: 'x', hp: 100, maxHp: 100 }, { uid: 'y', hp: 100, maxHp: 100 }];
    const w1 = [{ uid: 'x', side: 'ally', alive: true, hp: 40, maxHp: 100 },
      { uid: 'y', side: 'ally', alive: false, hp: 0, maxHp: 100 }];
    let carry = Q.readWaveCarry(w1, {});
    const a2 = Q.applyWaveCarry(defs, carry);
    ok(a2.length === 1 && a2[0].uid === 'x', '쓰러진 단원은 다음 웨이브 편성에서 빠진다',
      a2.map((u) => u.uid).join(','));

    // 2웨이브는 x 만 싸운다. 여기서 **누적**해야 y 가 계속 빠져 있다.
    const w2 = [{ uid: 'x', side: 'ally', alive: true, hp: 20, maxHp: 100 }];
    carry = Q.readWaveCarry(w2, carry);
    const a3 = Q.applyWaveCarry(defs, carry);
    ok(a3.length === 1 && a3[0].uid === 'x', '누적하면 쓰러진 단원이 계속 빠져 있다',
      a3.map((u) => `${u.uid}:${u.hp}`).join(','));

    // 새 객체를 주면 되살아난다 — 이 검사가 «그래서 누적해야 한다» 를 못 박는다
    const wrong = Q.applyWaveCarry(defs, Q.readWaveCarry(w2, {}));
    ok(wrong.length === 2, '새 객체로 인계를 만들면 되살아난다 (그래서 누적해야 한다)',
      wrong.map((u) => `${u.uid}:${u.hp}`).join(','));
  }

  /* ── 패주 (설계 3a) ────────────────────────────────────────────────────
   * 패주는 **승자를 바꾸면 안 된다.** 전투를 일찍 끝내 남은 사람을 살려 보낼 뿐이다.
   * (실측: 3744 전투에서 승패가 달라진 판 0건 — HANDOFF §26) */
  {
    const bad = [];
    let routs = 0;
    let loserSurvived = 0;
    let losses = 0;
    for (let k = 0; k < 60; k++) {
      const b = run(5000 + k * 7919, 1 + (k % 12) * 0.6);
      const m = b.result.margin;
      if (!m) { bad.push(`시드 ${k}: margin 없음`); continue; }
      if (m.routed) {
        routs++;
        // 물러난 쪽이 진 쪽이다
        if (m.routed === b.result.winner) bad.push(`시드 ${k}: 물러난 쪽이 이겼다`);
        // 물러났다는 건 전멸이 아니라는 뜻이다 — 남은 사람이 있어야 한다
        const left = m.routed === 'ally' ? m.allyAlive : m.enemyAlive;
        if (left <= 0) bad.push(`시드 ${k}: 물러났는데 생존자 0`);
        // 개전 직후에는 안 본다
        if (b.result.time < E.ROUT_AFTER - 1e-6) bad.push(`시드 ${k}: ${b.result.time}s 에 패주 (ROUT_AFTER=${E.ROUT_AFTER})`);
      }
      if (b.result.winner !== 'ally') {
        losses++;
        if (m.allyAlive > 0) loserSurvived++;
      }
    }
    okAll(bad, '패주가 규칙을 지킨다 (진 쪽만 물러나고, 남은 사람이 있고, 개전 직후엔 없다)', 60);
    ok(routs > 0, '패주가 실제로 일어난다', `${routs}/60`);
    /* ★ 이게 3a 의 목적이다. 예전에는 지면 **반드시 전멸**이었다 (실측 평균 생존 0.00명).
     *   지금은 진 판에서도 사람이 남는다 (실측 평균 1.34명). */
    ok(losses === 0 || loserSurvived > 0,
      '진 판에서도 살아남는 단원이 있다 (부분 패)', `${loserSurvived}/${losses}`);
  }

  // 아직 아무도 안 읽는다 — 읽기 시작하면 DATA_VERSION·인계·보상을 같이 봐야 한다
  const fsm2 = await import('node:fs');
  const readers = ['src/game/quest.js', 'src/game/dungeon.js', 'src/game/tower.js', 'src/game/abyss.js', 'src/ui/battle.js']
    .filter((f) => /\.margin/.test(fsm2.readFileSync(f, 'utf8')));
  okAll(readers.map((f) => `${f} 가 margin 을 읽기 시작했다 — HANDOFF §25 를 읽어라`),
    'margin 은 아직 기록 전용이다 (읽는 곳 없음)', 5);
}

/* ─────────────────────── 난이도 예보 (game/forecast.js) ─────────────────────── */
{
  section('난이도 예보');
  const FC = await import('../src/game/forecast.js');
  const Q = await import('../src/game/quest.js');
  const { rng } = await import('../src/core/rng.js');
  const St = await import('../src/game/state.js');
  const { getClass } = await import('../src/data/classes.js');

  const SQ = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];
  const mkSquad = (grade, level) => {
    St.newGame(4242, '예보');
    const st = St.state;
    st.roster = []; st.items = [];
    const sq = st.squads[0];
    sq.memberUids = new Array(7).fill(null);
    SQ.forEach((c, i) => {
      st.roster.push({ uid: `f_${i}`, name: getClass(c).name, classId: c, level, grade,
        equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 });
      sq.memberUids[i] = `f_${i}`;
    });
    return st;
  };

  // ★ 가장 중요한 성질: 예보가 **전역 rng 를 안 민다.**
  //   밀면 예보를 볼 때마다 전리품·부상 판정이 달라진다 —
  //   화면을 보기만 해도 게임이 바뀌는, 재현 불가능한 버그가 된다.
  const st1 = mkSquad('B', 60);
  const qs = Q.genQuests('frostgate', 300, new (await import('../src/core/rng.js')).RNG(781), 1);
  const draw = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(rng.next()); return o; };
  rng.s = 987654321;
  const before = draw(6);
  rng.s = 987654321;
  for (const q of qs) FC.forecastQuest(st1, q, st1.squads[0].id, { samples: 2 });
  const after = draw(6);
  ok(before.join(',') === after.join(','),
    '예보는 전역 rng 스트림을 건드리지 않는다',
    `before ${before[0]} / after ${after[0]}`);

  // 같은 입력이면 같은 답이 나온다 (캐시가 성립하려면 필요하다)
  const st2 = mkSquad('B', 60);
  const a = FC.forecastQuest(st2, qs[0], st2.squads[0].id);
  const b = FC.forecastQuest(st2, qs[0], st2.squads[0].id);
  ok(a.wins === b.wins && a.level === b.level, '예보는 결정론이다', `${a.wins} vs ${b.wins}`);

  /* 색은 이제 **승률과 손실 둘 다** 본다 (설계 3c).
   * 승률만으로는 색이 두 개밖에 안 나온다 — 중간 색은 손실 축에서 나온다. */
  const badBand = [];
  const cases = [
    // [승률, 이겼을 때 쓰러지는 평균 인원, 기대 등급]
    [1.00, 0,   1],   // 이기고 아무도 안 쓰러진다
    [1.00, 1,   2],   // 이기지만 한 명 쓰러진다
    [1.00, 2.5, 3],   // 이기지만 두셋 쓰러진다
    [1.00, 5,   4],   // 이겨도 절반이 쓰러진다 — 위험하다
    [0.80, 0,   1],
    [0.74, 0,   4],   // 승률이 문턱 아래면 손실과 무관하게 위험
    [0.40, 0,   4],
    [0.14, 0,   5],   // 거의 진다
    [0,    0,   5],
  ];
  for (const [wr, down, want] of cases) {
    const got = FC.dangerLevelOf(wr, down);
    if (got !== want) badBand.push(`승률 ${wr}·쓰러짐 ${down} → ${got} (기대 ${want})`);
  }
  okAll(badBand, '승률+손실 → 색 경계가 표와 일치한다', cases.length);

  // 단조성: 손실이 늘면 색이 좋아지지 않는다
  const mono = [];
  let prev = 0;
  for (const d of [0, 0.5, 1, 2, 3, 4, 6]) {
    const lv = FC.dangerLevelOf(1, d);
    if (lv < prev) mono.push(`쓰러짐 ${d} 에서 색이 좋아졌다 (${prev} → ${lv})`);
    prev = lv;
  }
  okAll(mono, '쓰러지는 인원이 늘수록 색이 나빠진다', 7);

  // 부대가 강해지면 색이 나빠지지 않는다 (단조성)
  const target = qs.slice().sort((x, y) => y.waves.length - x.waves.length)[0];
  const lv = [];
  for (const g of ['F', 'D', 'B', 'A', 'S']) {
    const st = mkSquad(g, 60);
    lv.push(FC.forecastQuest(st, target, st.squads[0].id).winRate);
  }
  okAll(lv.slice(1).map((v, i) => (v + 1e-9 < lv[i] ? `${['F', 'D', 'B', 'A', 'S'][i + 1]} 가 ${['F', 'D', 'B', 'A', 'S'][i]} 보다 낮다` : null)).filter(Boolean),
    '등급을 올리면 예보 승률이 내려가지 않는다', 4);

  // 지문이 결과를 바꾸는 요소를 빠짐없이 잡는가
  const base = mkSquad('B', 60);
  const stamp0 = FC.squadStamp(base, base.squads[0].id);
  const misses = [];
  {
    const s = mkSquad('B', 60); s.roster[0].level = 59;
    if (FC.squadStamp(s, s.squads[0].id) === stamp0) misses.push('레벨');
  }
  {
    const s = mkSquad('B', 60); s.roster[0].grade = 'A';
    if (FC.squadStamp(s, s.squads[0].id) === stamp0) misses.push('등급');
  }
  {
    const s = mkSquad('B', 60); s.roster[0].equipment = { mainhand: 'zz' };
    if (FC.squadStamp(s, s.squads[0].id) === stamp0) misses.push('장비');
  }
  {
    const s = mkSquad('B', 60); s.squads[0].memberUids[6] = null;
    if (FC.squadStamp(s, s.squads[0].id) === stamp0) misses.push('인원');
  }
  {
    const s = mkSquad('B', 60); s.squads[0].formationId = 'wedge';
    if (FC.squadStamp(s, s.squads[0].id) === stamp0) misses.push('진형');
  }
  {
    const s = mkSquad('B', 60); s.roster[0].woundUntil = s.day + 3;
    if (FC.squadStamp(s, s.squads[0].id) === stamp0) misses.push('부상');
  }
  okAll(misses.map((m) => `${m} 변화를 못 잡는다`), '부대 지문이 예보를 바꾸는 요소를 전부 잡는다', 6);

  // 웨이브 인계 규칙이 한 벌인가 — ui/battle.js 가 자기 사본을 다시 만들면 안 된다
  const fsq = await import('node:fs');
  const bsrc = fsq.readFileSync('src/ui/battle.js', 'utf8');
  ok(!/const\s+WAVE_HEAL\s*=/.test(bsrc),
    'ui/battle.js 가 WAVE_HEAL 사본을 두지 않는다 (quest.js 가 유일한 출처)');
}

/* ───────────────────────────── 결과 ───────────────────────────── */

process.stdout.write('\n' + '─'.repeat(64) + '\n');
if (!failures.length) {
  process.stdout.write(`✅ 전부 통과 — 검사 ${checks}건\n`);
  process.exit(0);
}
process.stdout.write(`❌ 실패 ${failures.length}건 / 검사 ${checks}건\n\n`);
for (const f of failures) process.stdout.write(`  [${f.section}] ${f.label}\n      ${f.detail}\n`);
process.exit(1);
