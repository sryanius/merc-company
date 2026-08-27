// tools/smoke.mjs — 브라우저 없이 도는 정합성 스모크 테스트.
//   실행: node tools/smoke.mjs
// 밸런스는 tools/balance.mjs 담당. 여기서는 "크래시 / 데이터 정합성"만 본다.

import { importsOf, decomment as libDecomment } from './lib/imports.mjs';
import { readdirSync, readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

/** 결과를 찍는다. 끝까지 갔든 도중에 죽었든 **같은 것**을 찍는다. */
function report(crash) {
  process.stdout.write('\n' + '─'.repeat(64) + '\n');
  if (crash) {
    process.stdout.write(`💥 «${curSection}» 절에서 죽었다 — 나머지 절은 아예 안 돌았다\n`);
    process.stdout.write(`   ${crash}\n`);
    /* ★★ 가장 흔한 원인을 **먼저** 짚어 준다.
     *   `need()` 는 못 읽은 모듈에 null 을 돌려주고, 그걸 받아 쓰는 절이
     *   «Cannot read properties of null» 로 터진다. 그러면 진짜 원인
     *   (그 모듈을 애초에 왜 못 읽었나)이 화면에서 사라진다.
     *   실제로 겪었다: 순환 import 를 되살렸더니 엉뚱한 절에서 TypeError 가 났다 (§108). */
    const bad = failures.filter((f) => f.label.startsWith('import '));
    if (bad.length) {
      process.stdout.write('\n   ★ 위쪽에서 못 읽은 모듈이 있다 — 그게 원인일 가능성이 높다:\n');
      for (const f of bad) process.stdout.write(`     · ${f.label} — ${f.detail}\n`);
      process.stdout.write('     (순환 import 를 되살리면 여기가 먼저 터진다)\n');
    }
    process.stdout.write('\n');
  }
  if (!failures.length && !crash) {
    process.stdout.write(`✅ 전부 통과 — 검사 ${checks}건\n`);
    return;
  }
  process.stdout.write(`❌ 실패 ${failures.length}건 / 검사 ${checks}건\n\n`);
  for (const f of failures) process.stdout.write(`  [${f.section}] ${f.label}\n      ${f.detail}\n`);
}

/* 도중에 죽어도 여태 모은 실패를 **반드시** 찍는다. 안 그러면 스택만 남고
 * 「무엇이 몇 건 틀렸나」 가 통째로 사라진다 — 실제로 그래서 원인을 못 봤다 (§108). */
let crashed = false;
function onCrash(e) {
  if (crashed) return;
  crashed = true;
  report(String((e && e.stack) || e).split('\n').slice(0, 3).join('\n   '));
  process.exit(1);
}
process.on('uncaughtException', onCrash);
process.on('unhandledRejection', onCrash);

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

/** 소스에서 주석을 지운다.
 *  ★ 글자로 보는 검사는 **주석을 같이 센다.** 그러면 코드에서 빼도
 *  설명 주석이 대신 세어져 검사가 안 물다 — 실제로 그러다 메타 검사에 걸렸다.
 *  ★★ 판단은 `tools/lib/imports.mjs` 한 벌이다 (아래 specsOf 와 같은 이유). */
const decomment = libDecomment;

/** 이 소스가 참조하는 모듈 전부.
 *  ★★ 판단은 `tools/lib/imports.mjs` **한 벌**이다 — `syncshared.mjs` 도 같은 것을 쓴다.
 *    예전엔 두 벌이었고 그중 하나(`syncshared`)가 부수효과 import 를 놓치고 있었다.
 *    사본이 둘이면 반드시 갈라진다 (§94). */
const specsOf = importsOf;

/** 진입점에서 import 를 따라 걸은 닫힘 (저장소 상대 경로) */
function closureOf(startRel) {
  const seen = new Set();
  const stack = [startRel];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const abs = join(rootDir, rel);
    if (!existsSync(abs)) continue;
    seen.add(rel);
    for (const spec of specsOf(readFileSync(abs, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      stack.push(relative(rootDir, resolve(dirname(abs), spec)).split(sep).join('/'));
    }
  }
  return [...seen].sort();
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

section('순위표 대표 부대');
{
  /* ★★ 제작자 요청: 「대표부대를 지정할 수 있게. 지정 안 하면 1부대」.
   *   예전엔 **레벨 합이 가장 높은 부대**가 자동으로 올라갔다 — 내걸고 싶은 부대와
   *   가장 키운 부대가 늘 같지는 않다. 글자로 막지 말고 **실제로 굴려서** 잰다. */
  const Rules3 = need('game/rules.js');
  const st = State.newGame('검사용');
  const r = st.roster;
  st.squads.push({ id: 'squad_2', name: '제2부대', memberUids: [r[0].uid], formationId: 'basic' });
  st.squads[0].memberUids = [r[1].uid, r[2].uid, r[3].uid];
  r[0].level = 80; r[1].level = 1; r[2].level = 1; r[3].level = 1;
  const pick = () => { const sc = Rules3 && Rules3.extractScore(st); return sc && sc.squad && sc.squad.name; };

  const faults = [];
  /* 지정이 없으면 «가장 센 부대» 가 아니라 첫 부대다 — 이 구분이 요청의 핵심이다 */
  if (pick() !== '제1부대') faults.push(`지정이 없을 때 ${pick()} 가 올라간다 — 1부대여야 한다`);
  st.flagSquadId = 'squad_2';
  if (pick() !== '제2부대') faults.push(`대표로 지정했는데 ${pick()} 가 올라간다`);
  /* 해산된 부대를 걸어 둔 세이브 — 부대가 통째로 사라지면 안 된다 */
  st.flagSquadId = 'squad_사라짐';
  if (pick() !== '제1부대') faults.push(`없는 부대를 지정했을 때 ${pick()} 가 올라간다 — 1부대로 물러나야 한다`);
  okAll(faults, '대표 부대 지정이 순위표에 반영된다 (미지정=1부대)', 3);
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

section('전투 골든 픽스처 (tools/goldenbattle.mjs)');
{
  /* ★★ PvP 는 **서버가 전투를 돌려** 승패를 정한다. 그러려면 «같은 입력 + 같은 시드 →
   *   항상 같은 결과» 가 보장돼야 한다. 깨지면 서버가 정한 승패와 클라 화면이 어긋난다.
   *   고정 편성 × 고정 시드 20판을 파일에 굳혀 두고 매번 대조한다.
   *   실측: Node 22 와 Deno 2.9 가 이 픽스처에서 지문까지 일치했다.
   *
   * ★ 밸런스를 **일부러** 고쳤으면 `node tools/goldenbattle.mjs --update` 로 다시 굳힌다.
   *   이 검사는 «달라진 줄 모르고 지나가는 것» 을 막는 것이지 변경을 막는 게 아니다. */
  const { execFileSync: ex2 } = await import('node:child_process');
  let out2 = '';
  let bad2 = false;
  try {
    out2 = ex2(process.execPath, ['tools/goldenbattle.mjs'], { encoding: 'utf8' });
  } catch (e) {
    bad2 = true;
    out2 = String(e.stdout || e.message);
  }
  const NL3 = String.fromCharCode(10);
  const detail = out2.split(NL3).filter((l) => l.includes('·')).slice(0, 5).join(' | ');
  ok(!bad2, '전투 결과가 골든 픽스처와 일치한다', detail || out2.trim().split(NL3).slice(-2).join(' | '));

  /* 생성된 ENGINE_HASH 상수가 픽스처와 같은 값인지 — 클라와 서버가 이 상수로 버전을 맞춘다 */
  const EV = need('data/enginever.js');
  let goldenHash = null;
  try {
    goldenHash = JSON.parse(readFileSync(new URL('../tests/fixtures/battle-golden.json', import.meta.url), 'utf8')).engineHash;
  } catch { /* 픽스처 없음은 위에서 이미 걸린다 */ }
  ok(!!(EV && EV.ENGINE_HASH) && EV.ENGINE_HASH === goldenHash,
    'ENGINE_HASH 상수가 픽스처와 같다',
    `상수 ${EV && EV.ENGINE_HASH} vs 픽스처 ${goldenHash}`);
}

section('PvP 스탯 상한 검사 (위조 1차 방어선)');
{
  /* ★★ 방어 편성은 **클라이언트가 계산해서 올린다** — 접사가 rng 로 굴려진 실수값이라
   *   서버가 그대로 되살릴 수 없기 때문이다 (HANDOFF §68.1).
   *   그래서 «정확한가» 대신 «물리적으로 가능한가» 를 묻는다.
   *
   * ★ 이 검사에서 가장 위험한 실패는 **오탐**이다 — 정상 플레이어가 등록을 못 하게 된다.
   *   그래서 «최강 장비를 낀 정상 유닛이 통과하는가» 를 먼저 본다. */
  let B = null;
  let Merc = null;
  let Gear = null;
  let CL3 = null;
  let SETS3 = null;
  try {
    B = await import('../supabase/functions/pvp-battle/statbound.js');
    Merc = await import('../src/game/merc.js');
    Gear = await import('../src/game/gear.js');
    CL3 = await import('../src/data/classes.js');
    SETS3 = await import('../src/data/sets.js');
    await import('../src/data/classes_t4.js');
  } catch (e) {
    ok(false, '상한 검사 모듈을 읽는다', String((e && e.message) || e));
  }

  if (B && Merc && Gear && CL3 && SETS3) {
    const faults = [];

    /* ① 상수 중복이 merc.js 와 같은가 —
     *   statbound.js 는 merc.js 의 상수를 옮겨 적었다 (merc.js 는 state.js 를 물어 서버로 못 옮긴다).
     *   어긋나면 **정상 유닛이 걸린다.** 값을 하나씩 대조한다. */
    const pairs = [
      ['GRADE_MULT', B.GRADE_MULT, Merc.GRADE_MULT],
      ['GRADE_IDX', B.GRADE_IDX, Merc.GRADE_IDX],
      ['TIER_MULT', B.TIER_MULT, Merc.TIER_MULT],
      ['SCALING_KEYS', B.SCALING_KEYS, Merc.SCALING_KEYS],
      ['FLAT_KEYS', B.FLAT_KEYS, Merc.FLAT_KEYS],
    ];
    for (const [name, mine, real] of pairs) {
      if (JSON.stringify(mine) !== JSON.stringify(real)) {
        faults.push(`${name} 이 merc.js 와 다르다: ${JSON.stringify(mine)} vs ${JSON.stringify(real)}`);
      }
    }
    if (B.GROWTH_RATE !== Merc.GROWTH_RATE) {
      faults.push(`GROWTH_RATE 가 다르다: ${B.GROWTH_RATE} vs ${Merc.GROWTH_RATE}`);
    }

    /* ② 맨몸 계산이 merc.js 와 맞는가 (반올림 차이는 허용 — 상한이므로 조금 후한 건 안전하다) */
    let worst = 0;
    let worstAt = '';
    for (const id of Object.keys(CL3.CLASSES)) {
      for (const lv of [1, 40, 80]) {
        for (const g of ['F', 'C', 'S']) {
          const mine = B.bareStats(id, lv, g);
          const real = Merc.mercStats({ uid: 'x', classId: id, level: lv, grade: g, equipment: {} }, {});
          for (const k of Object.keys(real)) {
            const d = ((mine[k] || 0) - real[k]) / Math.max(1, real[k]);
            if (d < -0.02 && Math.abs((mine[k] || 0) - real[k]) > 1) {
              /* 내 값이 **작으면** 위험하다 — 정상 유닛을 막게 된다 */
              if (-d > worst) { worst = -d; worstAt = `${id} lv${lv} ${g} ${k}: 상한계산 ${(mine[k] || 0).toFixed(1)} < 실제 ${real[k]}`; }
            }
          }
        }
      }
    }
    if (worst > 0) faults.push(`맨몸 계산이 실제보다 작다 (${(worst * 100).toFixed(1)}%) — ${worstAt}`);

    /* ③ ★★ **게임이 만들 수 있는 유닛은 전부 통과해야 한다** (오탐 0).
     *
     *   여기서 세 번 데였다. 매번 «재는 경로가 실제 등록 경로보다 짧아서» 였다:
     *     1차 `rollItem` 으로 재서 **세트 보너스**가 빠졌다 → 제작자 atk 8514 가 거절.
     *     2차 `mercStats` 로만 재서 **진형 보정·펫 배율**이 빠졌다.
     *     3차 S등급만 재서 **낮은 등급**이 빠졌다 → 제작자 crit 103.215 가 거절되어
     *          PvP 등록 자체가 막혔다 (치명은 고정 스탯이라 맨몸이 작은 F등급이 최악이다).
     *
     *   그래서 이제 스윕을 `tools/lib/statceiling.mjs` 하나로 모으고
     *   **도구(`node tools/statceiling.mjs`)와 이 검사가 같은 것을 쓴다.**
     *   전 클래스 × 착용 가능 세트 × 12진형 × 7슬롯 × 7등급 × (펫 있음/없음). */
    let SC = null;
    try { SC = await import('./lib/statceiling.mjs'); } catch (e) {
      faults.push(`천장 스윕 모듈을 못 읽었다: ${(e && e.message) || e}`);
    }
    if (SC) {
      /* ★ 판이 차려졌는지 먼저 — 장비가 안 붙으면 «맨몸» 을 최강 빌드로 착각한다 */
      for (const g of SC.gates()) faults.push(`천장 측정의 판이 안 차려졌다: ${g}`);

      const { tested, rejects, best } = SC.sweep(B.checkUnit, { bareStats: B.bareStats });
      if (tested < 10_000) faults.push(`스윕이 ${tested} 개밖에 안 돌았다 — 판이 덜 차려졌다`);
      if (rejects.length) {
        const byKey = {};
        for (const r of rejects) {
          const k = (r.split(': ')[1] || '').split(' ')[0];
          (byKey[k] = byKey[k] || []).push(r);
        }
        for (const [k, list] of Object.entries(byKey)) {
          faults.push(`오탐 ${k}: 정상 빌드 ${list.length}개가 걸린다 — 예) ${list[0]}`);
        }
      }
      /* ★ 상한 표가 실측 천장보다 **낮으면** 정상 등록이 막힌다. 값으로 대조한다
       *   (0.5% 는 반올림 여유). */
      for (const k of SC.KEYS) {
        const m = best[k] && best[k].v;
        const cur = B.MEASURED_MAX[k];
        if (m > 0 && !(cur * 1.005 >= m)) {
          faults.push(`MEASURED_MAX.${k} = ${cur} 가 실측 천장 ${m.toFixed(2)} 보다 낮다 — ${Math.ceil(m)} 이상이어야 한다`);
        }
      }
    }

    /* ④ 명백한 조작은 잡아야 한다 */
    const cheat = {
      uid: 'c', classId: 'swordsman', level: 1, grade: 'F',
      stats: { hp: 999999, atk: 50000, def: 1, res: 1, spd: 1, crit: 1, critDmg: 50, eva: 1 },
    };
    if (!B.checkUnit(cheat).length) faults.push('hp 999999 을 못 잡는다');
    if (!B.checkUnit({ uid: 'c', classId: '없는클래스', level: 1, grade: 'C', stats: { hp: 1 } }).length) {
      faults.push('없는 클래스를 못 잡는다');
    }
    if (!B.checkUnit({ uid: 'c', classId: 'swordsman', level: 999, grade: 'C', stats: { hp: 1 } }).length) {
      faults.push('레벨 999 를 못 잡는다');
    }

    okAll(faults, '상한 검사가 조작을 잡고 정상 유닛은 통과시킨다', 4);
  }
}

section('PvP 승점 — 골라 때리기가 이득이면 안 된다');
{
  /* ★★ 실측(HANDOFF §73): 이 게임의 PvP 는 전력 5% 차이면 **확정 승리**다.
   *   그래서 고정 점수제였다면 «나보다 조금 약한 상대만 고르기» 가 확정 이득이 되고,
   *   순위가 실력이 아니라 도전 횟수를 재게 된다.
   *
   *   Elo 로 바꾼 이유가 정확히 그것이므로, **그 성질을 검사로 못 박는다.** */
  let R = null;
  try { R = await import('../supabase/functions/pvp-battle/rating.js'); } catch (e) {
    ok(false, '승점 모듈을 읽는다', String((e && e.message) || e));
  }

  if (R) {
    const faults = [];

    /* ① 약자 사냥의 이득이 «같은 상대» 보다 뚜렷하게 작아야 한다 */
    const even = R.applyRating('attacker', 1000, 1000).attackerDelta;
    const farm = R.applyRating('attacker', 1400, 1000).attackerDelta;
    if (!(farm < even / 2)) {
      faults.push(`400 낮은 상대를 이겨 ${farm} 점 — 동급전 ${even} 점의 절반보다 커서는 안 된다`);
    }

    /* ② 약자에게 지면 크게 잃어야 한다 (그래야 «어차피 이기니까» 가 안 성립한다) */
    const upset = R.applyRating('defender', 1400, 1000).attackerDelta;
    if (!(upset < -even)) {
      faults.push(`400 낮은 상대에게 져서 ${upset} 점 — 동급 승리(${even})보다 크게 잃어야 한다`);
    }

    /* ③ 강자에게 도전하는 것이 더 크게 보상돼야 한다 */
    const up = R.applyRating('attacker', 600, 1000).attackerDelta;
    if (!(up > even)) faults.push(`400 높은 상대를 이겨 ${up} 점 — 동급전(${even})보다 커야 한다`);

    /* ④ 도전 프리미엄 — 도전자가 방어자보다 유리해야 한다 (가만히 있는 것보다 낫게) */
    const r0 = R.applyRating('attacker', 1000, 1000);
    if (!(r0.attackerDelta > Math.abs(r0.defenderDelta))) {
      faults.push(`동급전 승리에서 도전자 ${r0.attackerDelta} / 방어자 ${r0.defenderDelta} — 도전자가 더 커야 한다`);
    }

    /* ⑤ 어떤 조합에서도 DB 트리거 한계(64)를 넘지 않아야 한다 —
     *   넘으면 «전투는 끝났는데 점수 반영만 실패» 하는 상태가 된다 */
    let mx = 0;
    for (let a = 100; a <= 3000; a += 100) {
      for (let d = 100; d <= 3000; d += 100) {
        for (const w of ['attacker', 'defender', 'draw']) {
          const r = R.applyRating(w, a, d);
          mx = Math.max(mx, Math.abs(r.attackerDelta), Math.abs(r.defenderDelta));
        }
      }
    }
    if (mx > R.MAX_STEP) faults.push(`최대 이동폭 ${mx} 가 상한 ${R.MAX_STEP} 을 넘는다`);
    if (mx > 64) faults.push(`최대 이동폭 ${mx} 가 DB 트리거 한계 64 를 넘는다 — 점수 반영이 실패한다`);

    /* ⑥ 바닥 아래로 안 내려간다 */
    const floorCase = R.applyRating('defender', R.RATING_FLOOR, 3000);
    if (floorCase.attackerAfter < R.RATING_FLOOR) {
      faults.push(`바닥(${R.RATING_FLOOR}) 아래로 내려간다: ${floorCase.attackerAfter}`);
    }

    okAll(faults, '승점이 점수차를 반영한다 (약자 사냥이 무가치)', 6);
  }
}

section('태그매치 (부대가 이어 싸운다)');
{
  /* ★★ 제작자 규칙: 「모든 부대가 태그매치로. 서로 1부대 전투하고 **이긴 쪽이 그 전투에서
   *   이어서** 2부대랑 바로 이어서 전투」. 다음 웨이브 버튼 없이 한 번에 이어진다.
   *
   *   서버가 이 결과로 승패를 정하고 클라가 같은 시드로 재생한다 —
   *   **결정적이지 않으면 «화면에선 이겼는데 점수는 졌다» 가 된다.** 그래서 여기서 잰다. */
  const F = '../supabase/functions/pvp-battle/';
  let TM = null;
  let SK = null;
  let FM = null;
  let CL2 = null;
  try {
    /* ★ tagmatch 는 이제 **서버·클라 공용**이라 `_engine/` 으로 복사된다
     *   (원본은 src/battle/tagmatch.js). 가져다 쓴 사본을 보는 것이 맞다 —
     *   서버가 실제로 돌리는 게 그것이고, 원본과 어긋나면 HASHES 검사가 따로 막는다. */
    TM = await import(F + '_engine/tagmatch.js');
    SK = await import(F + '_engine/skills.js');
    FM = await import(F + '_engine/formations.js');
    CL2 = await import(F + '_engine/classes.js');
    await import(F + '_engine/classes_t4.js');
  } catch (e) {
    ok(false, '태그매치 모듈을 읽는다', String((e && e.message) || e));
  }

  if (TM && SK && FM && CL2) {
    const f = FM.getFormation('basic');
    const sq = (side, s, ids, lv) => ids.map((c, i) => ({
      uid: `${side}${s}_${i}`, name: c, classId: c, level: lv, grade: 'C',
      side, slot: f.slots[i], basicRange: CL2.CLASSES[c].range,
    }));
    const A = [
      sq('ally', 0, ['swordsman', 'shieldman', 'archer', 'apprentice', 'acolyte'], 30),
      sq('ally', 1, ['spearman', 'rogue', 'archer', 'apprentice', 'monk'], 28),
      sq('ally', 2, ['swordsman', 'swordsman', 'archer', 'acolyte', 'monk'], 26),
    ];
    const D = [
      sq('enemy', 0, ['spearman', 'shieldman', 'archer', 'apprentice', 'acolyte'], 29),
      sq('enemy', 1, ['swordsman', 'rogue', 'archer', 'apprentice', 'monk'], 30),
      sq('enemy', 2, ['monk', 'shieldman', 'archer', 'acolyte', 'rogue'], 27),
    ];
    const run = (seed) => TM.tagMatch({ attacker: A, defender: D, seed, getSkill: SK.getSkill });

    const faults = [];

    /* ① 같은 시드는 항상 같은 전개 — 재생이 성립하는 근거다 */
    const r1 = run(12345);
    const r2 = run(12345);
    if (JSON.stringify(r1) !== JSON.stringify(r2)) faults.push('같은 시드인데 결과가 다르다 (재생이 불가능해진다)');

    /* ② 반드시 한쪽이 끝난다 — 무한 루프가 나면 서버가 멈춘다 */
    if (!['attacker', 'defender', 'draw'].includes(r1.winner)) faults.push(`승자가 이상하다: ${r1.winner}`);
    if (r1.roundCount < 1) faults.push('한 합도 안 싸웠다');
    if (r1.roundCount > 32) faults.push(`합이 ${r1.roundCount} 이다 — 논리가 샌다`);

    /* ③ **이긴 쪽이 생존자 그대로 이어 싸운다** — 이게 태그매치의 핵심 규칙이다.
     *   한 합에서 이긴 쪽의 다음 합 시작 인원이 «그 합의 생존자 수» 와 같아야 한다. */
    /* ★ «어딘가 한 번이라도 계승되면 통과» 로 짜면 안 된다 — 한쪽만 고장 나도 다른 쪽이
     *   통과시켜 준다. 실제로 그렇게 짰다가 메타 검사에서 안 물려서 고쳤다.
     *   합마다 **위반을 직접 본다.** */
    for (let i = 0; i + 1 < r1.rounds.length; i++) {
      const cur = r1.rounds[i];
      const nxt = r1.rounds[i + 1];
      if (cur.winner === 'attacker') {
        if (nxt.attackerSquad !== cur.attackerSquad) {
          faults.push(`${i}합에서 도전자가 이겼는데 다음 합에 새 부대가 나온다 (${cur.attackerSquad}→${nxt.attackerSquad})`);
        }
        if (nxt.defenderSquad !== cur.defenderSquad + 1) {
          faults.push(`${i}합에서 방어자가 졌는데 다음 부대로 안 넘어간다 (${cur.defenderSquad}→${nxt.defenderSquad})`);
        }
      } else if (cur.winner === 'defender') {
        if (nxt.defenderSquad !== cur.defenderSquad) {
          faults.push(`${i}합에서 방어자가 이겼는데 다음 합에 새 부대가 나온다 (${cur.defenderSquad}→${nxt.defenderSquad})`);
        }
        if (nxt.attackerSquad !== cur.attackerSquad + 1) {
          faults.push(`${i}합에서 도전자가 졌는데 다음 부대로 안 넘어간다 (${cur.attackerSquad}→${nxt.attackerSquad})`);
        }
      } else {
        if (nxt.attackerSquad !== cur.attackerSquad + 1 || nxt.defenderSquad !== cur.defenderSquad + 1) {
          faults.push(`${i}합이 무승부인데 양쪽이 다음 부대로 안 넘어간다`);
        }
      }
    }

    /* ④ 진 쪽은 다음 부대로 넘어간다 — 같은 두 부대가 다시 붙으면 안 된다 */
    const pairs = new Set();
    for (const x of r1.rounds) {
      const key = `${x.attackerSquad}:${x.defenderSquad}`;
      if (pairs.has(key)) faults.push(`같은 부대 짝이 두 번 붙었다 (${key}) — 무한 재대결이 된다`);
      pairs.add(key);
    }

    /* ⑤ 다른 시드는 대체로 다른 전개여야 한다 (전부 같으면 시드가 안 먹는 것이다) */
    const seeds = [1, 7, 99, 4242, 31337];
    const sigs = new Set(seeds.map((s) => JSON.stringify(run(s).rounds.map((x) => x.winner))));
    if (sigs.size < 2) faults.push('시드를 바꿔도 전개가 하나뿐이다 — 시드가 안 먹는다');

    okAll(faults, '태그매치가 결정적이고 이긴 쪽이 이어 싸운다', 5);
  }
}

section('PvP 스키마 규약 (db/010_pvp.sql)');
{
  /* ★★ 이 SQL 은 **손으로 대시보드에 붙여넣는다.** 그래서 «틀리면 터지는» 실행 경로가 없다 —
   *   검사가 없으면 정책 하나를 잘못 열어 놓고도 아무도 모른다.
   *
   *   랭킹 신뢰의 뿌리는 «pvp_* 테이블에 정책이 하나도 없다» 는 것이다.
   *   정책이 없으면 anon·authenticated 는 아무것도 못 하고, 읽기는 security definer
   *   함수로만, 쓰기는 Edge Function(service_role) 으로만 열린다. */
  let sql = '';
  try { sql = readFileSync(new URL('../db/010_pvp.sql', import.meta.url), 'utf8'); } catch { sql = ''; }
  const faults = [];
  if (!sql) {
    faults.push('db/010_pvp.sql 을 못 읽었다');
  } else {
    /* 주석 안의 예시 문장이 «진짜 코드» 로 세어지면 검사가 헛돈다 — 먼저 걷어낸다
     * (이 저장소에서 실제로 겪었다: 내 설명 주석이 옛 공식 검사에 걸렸다) */
    const strip = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const tables = [...strip.matchAll(/create table if not exists public\.(pvp_\w+)/g)].map((m) => m[1]);
    if (tables.length < 5) faults.push(`pvp_* 테이블이 ${tables.length}개뿐이다 (5개여야 한다)`);
    for (const t of tables) {
      if (!strip.includes(`alter table public.${t} enable row level security`)) {
        faults.push(`${t} 에 RLS 를 안 켰다`);
      }
    }

    /* ★ 정책이 하나라도 있으면 실패 — 이게 이 검사의 핵심이다 */
    const pol = [...strip.matchAll(/create policy[^;]*on public\.(pvp_\w+)/g)].map((m) => m[1]);
    if (pol.length) {
      faults.push(`pvp_* 에 정책이 생겼다: ${[...new Set(pol)].join(', ')} — 읽기는 함수로만 연다`);
    }

    /* security definer 함수는 반드시 search_path 를 비워야 한다 (스키마 하이재킹 방지) */
    const defs = [...strip.matchAll(/create or replace function public\.(\w+)([\s\S]*?)\$\$/g)];
    for (const [, name, head] of defs) {
      if (/security definer/.test(head) && !/set search_path\s*=\s*''/.test(head)) {
        faults.push(`${name}() 이 security definer 인데 search_path 를 안 비웠다`);
      }
    }

    /* ★★ service_role 전용 함수는 **anon·authenticated 를 이름으로 지목해** 회수해야 한다.
     *   `from public` 만 적으면 안 잠긴다 — Supabase 가 default privileges 로 그 두 역할에
     *   EXECUTE 를 따로 주기 때문이다. 실제로 그렇게 적어 두고 배포했다가 뚫렸다:
     *   pg_proc.proacl 에 anon=X,authenticated=X 가 남아 있었고 pvp_bump 는 레이팅을 직접 쓴다.
     *   → **로그인한 누구나 자기 점수를 정할 수 있었다** (HANDOFF §77).
     *
     * ★ 이 검사는 그때 «revoke from public 이 있나» 만 봐서 **놓쳤다.**
     *   글자가 아니라 «두 역할이 회수 대상에 들어 있나» 를 본다. */
    for (const fn of ['pvp_claim', 'pvp_bump', 'pvp_ratings_guard']) {
      const rev = new RegExp('revoke[^;]*on function public\\.' + fn + '\\b[^;]*from([^;]*);', 'i');
      const m = strip.match(rev);
      if (!m) { faults.push(`${fn} 의 실행 권한 회수(revoke)가 없다`); continue; }
      const roles = m[1];
      if (!/\banon\b/.test(roles)) faults.push(`${fn} 을 anon 에서 회수하지 않았다 (from public 만으로는 안 잠긴다)`);
      if (!/\bauthenticated\b/.test(roles)) faults.push(`${fn} 을 authenticated 에서 회수하지 않았다 (from public 만으로는 안 잠긴다)`);
      const gr = new RegExp('grant execute on function public\\.' + fn + '\\b[^;]*to[^;]*(anon|authenticated)');
      if (gr.test(strip)) {
        faults.push(`${fn} 을 anon/authenticated 에게 다시 열어 줬다 — service_role 만이어야 한다`);
      }
    }
  }
  okAll(faults, 'PvP 테이블은 RLS 를 켜고 정책을 두지 않는다 (읽기는 함수로만)', 5);
}

section('배포될 엔진 사본이 실제로 도는가');
{
  /* ★★ `syncshared` 는 **평탄화**한다 — `../core/rng.js` 를 `./rng.js` 로 고쳐 쓴다.
   *   이 재작성이 깨지면 사본은 파일로는 멀쩡한데 **import 가 안 되는 상태**가 된다.
   *   해시 대조는 원본과 사본의 «내용» 만 보므로 이걸 못 잡는다.
   *   그래서 사본을 실제로 import 해서 골든 픽스처를 돌린다.
   *
   * ★ 서버(리눅스)에서도 같은 검사를 할 수 있게 같은 모듈을 함수에 실어 뒀다:
   *   `GET /pvp-battle?selftest=1` (§69). 여기서 도는 것과 같은 코드다. */
  let r = null;
  let err = '';
  try {
    const { selftest } = await import('../supabase/functions/pvp-battle/selftest.js');
    r = await selftest();
  } catch (e) {
    err = String((e && e.message) || e);
  }
  ok(!!(r && r.ok), '배포용 엔진 사본이 골든 픽스처와 일치한다',
    err || (r ? `${r.bad.length}건 어긋남: ${r.bad.slice(0, 3).join(' | ')}` : '실행 실패'));
  if (r) ok(r.total >= 40, `자가검사가 ${r.total}판을 돈다 (40+)`, `${r.total}판뿐이다`);
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
    /** 거절 분기 안의 `return json(...)` 을 **전부** 뽑아 온다.
     *
     * ★★ 예전엔 «첫 번째» 하나만 봤다. 탐침 차단(§97)으로 갈래가 하나 늘자
     *   검사가 **새 갈래만 보고 정작 거절 응답은 안 보게** 됐다 —
     *   아래 메타 검사가 그걸 잡았다. 갈래가 늘어도 안 무뎌지게 전부 본다. */
    const rejectReturns = (text) => {
      const at = text.indexOf("verdict.verdict === 'reject'");
      if (at < 0) return null;
      const branch = text.slice(at, at + 900);
      const outs = [];
      let i = 0;
      for (;;) {
        const r = branch.indexOf('return json(', i);
        if (r < 0) break;
        const e = branch.indexOf(';', r);
        if (e < 0) break;
        outs.push(branch.slice(r, e + 1));
        i = e + 1;
      }
      return outs;
    };
    const rets = rejectReturns(src);
    const faults = [];
    if (!rets || !rets.length) faults.push('거절 분기의 응답을 못 찾았다');
    else {
      for (const ret of rets) {
        if (ret.includes('reasons')) faults.push(`거절 응답에 reasons 가 실린다 → ${ret.trim()}`);
        if (ret.includes('tier')) faults.push(`거절 응답에 tier 가 실린다 → ${ret.trim()}`);
      }
    }

    /* ★★ 500 경로도 사유를 흘리면 안 된다.
     *   `scores` upsert 가 실패하면 예전엔 `upErr.message` 를 그대로 돌려줬는데,
     *   `scores_monotonic` 트리거 메시지가 **서버가 가진 이전 기록 4개**를 통째로 담는다
     *   (「기록은 감소할 수 없다 (나락 %→%, 탑 %→%, 의뢰 %→%, 일차 %→%)」).
     *   §55 가 막은 것과 같은 종류의 누출이 여기 남아 있었다. */
    if (/return json\(\{[^}]*upErr\.message/.test(src)) {
      faults.push('DB 오류 메시지를 그대로 돌려준다 — 트리거 문구에 이전 기록이 들어 있다');
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
    const pr = rejectReturns(planted) || [];
    if (pr.some((x) => x.includes('reasons'))) pass('검사가 실제로 문다 (사유를 다시 실으면 걸린다)');
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
    /* ★★ 부대 **와 단원** 두 층을 모두 본다.
     *
     *   옛 검사는 `/^\s{6}([a-z])\s*:/gm` 이었다 — «들여쓰기 정확히 6칸 + 한 글자 소문자».
     *   그래서 **단원 필드(m: 배열 안이라 더 깊다)** 도, **두 글자 이름**도 못 봤다.
     *   §58 재발을 막으라고 만든 검사가 정작 이번 작업(단원 이름 `nm` 추가)에 눈이 멀어 있었다.
     *
     *   이제 두 층을 다 훑고 이름 길이도 안 가린다. 흔한 오탐(주석·문자열)은
     *   «값이 있는 속성 정의» 모양으로만 잡아 걸러 낸다. */
    const fieldsOf = (src, from, to) => {
      const body = between(src, from, to);
      const out = new Set();
      for (const m of body.matchAll(/^\s{4,}([a-z][a-z0-9]{0,7})\s*:\s*[^\s/]/gm)) out.add(m[1]);
      return out;
    };

    /* ★★ **쌍이 하나가 아니다.** 스냅샷에는 두 갈래가 있다:
     *     · 상세 (누른 한 사람) : rules.js allSquadsOf  ↔ 서버 sanitizeSquadsFull
     *     · 요약 (순위표 목록)  : rules.js topSquadOf   ↔ 서버 sanitizeSquad
     *   §58 을 막으라고 만든 이 검사는 **위쪽 쌍만 봤다.** 그래서 단원 이름 `nm` 을
     *   allSquadsOf 에만 넣고 topSquadOf 를 빠뜨렸을 때 통과해 버렸고,
     *   목록은 그대로 클래스명이 떴다 (제작자가 화면으로 알려 줬다).
     *   같은 함정에 다섯 번째로 걸린 자리다 — 이제 두 쌍을 다 본다. */
    const PAIRS = [
      {
        label: '상세', from: 'function allSquadsOf', to: 'function topSquadOf',
        sFrom: 'function sanitizeSquadsFull', sTo: 'function sanitizeSquad', min: 5,
      },
      {
        label: '요약', from: 'function topSquadOf', to: 'A등급: 불가능',
        sFrom: 'function sanitizeSquad(', sTo: 'const keepMax', min: 4,
      },
    ];

    const IGNORE = new Set(['const', 'let', 'return', 'if', 'for', 'try', 'catch', 'function']);
    const drift = [];
    const seen = [];
    for (const P of PAIRS) {
      const wanted = [...fieldsOf(rulesSrc, P.from, P.to)].filter((f) => !IGNORE.has(f));
      const server = fieldsOf(fnSrc, P.sFrom, P.sTo);
      for (const f of wanted) {
        if (!server.has(f)) drift.push(`${P.label}: 필드 '${f}' 가 ${P.sFrom.replace('function ', '').replace('(', '')} 에 없다 — 서버가 조용히 버린다`);
      }
      seen.push({ label: P.label, wanted, min: P.min });
    }

    okAll(drift, '클라이언트가 싣는 필드를 서버가 전부 통과시킨다 (상세·요약 두 쌍)',
      seen.reduce((a, s) => a + s.wanted.length, 0) || 1);

    /* 정규식이 헛돌면 «어긋난 게 없다» 로 조용히 통과한다 — 읽어 낸 개수를 못 박는다 */
    okAll(seen.filter((s) => s.wanted.length < s.min)
      .map((s) => `${s.label} 쪽에서 필드를 ${s.wanted.length}개만 읽었다 (최소 ${s.min}) — 정규식이 헛돈다`),
      '두 쌍 모두에서 필드를 실제로 읽어 냈다', seen.length);

    /* 요약 쌍이 목록의 핵심인 «단원 이름» 을 정말 싣는지 못 박는다 */
    const sumFields = fieldsOf(rulesSrc, 'function topSquadOf', 'A등급: 불가능');
    ok(sumFields.has('nm'), '순위표 목록 요약이 단원 이름(nm)을 싣는다',
      `읽은 필드: ${[...sumFields].join(' ') || '없음'}`);

    /* ★★ 스냅샷 **형식이 바뀌면 SNAPSHOT_REV 를 올려야 한다.**
     *
     *   필드를 더하고 서버까지 맞춰도, 이미 제출을 끝낸 사람은 «기록이 다시 오를 때»
     *   까지 재제출하지 않는다 — 나락은 주 단위, 탑은 월 단위다. 그래서 새 필드가
     *   순위표에 **영영 안 나타난다.** 제작자가 그걸로 겪었다:
     *   단원 이름을 넣었는데 목록은 그대로 클래스명이었다.
     *
     *   그래서 «필드 목록의 지문» 을 여기 못 박는다. 필드가 바뀌면 이 검사가 깨지고,
     *   고치려면 cloud.js 의 SNAPSHOT_REV 를 올린 다음 아래 두 값을 갱신해야 한다. */
    const PINNED_REV = 2;
    const PINNED_FP = '0e59e0a8e248';

    const fpFields = [
      ...[...fieldsOf(rulesSrc, 'function allSquadsOf', 'function topSquadOf')].sort(),
      '|',
      ...[...fieldsOf(rulesSrc, 'function topSquadOf', 'A등급: 불가능')].sort(),
    ];
    const fp = createHash('sha1').update(fpFields.join(',')).digest('hex').slice(0, 12);

    const cloudSrc = readFileSync(srcDir('net/cloud.js'), 'utf8');
    const revM = cloudSrc.match(/export const SNAPSHOT_REV = (\d+);/);
    const rev = revM ? Number(revM[1]) : 0;

    ok(rev === PINNED_REV && fp === PINNED_FP,
      '스냅샷 필드가 바뀌었으면 SNAPSHOT_REV 도 올렸다',
      fp !== PINNED_FP
        ? `필드가 바뀌었다 (지문 ${PINNED_FP} → ${fp}: ${fpFields.join(' ')}) — cloud.js 의 SNAPSHOT_REV 를 ${rev + 1} 로 올리고 이 검사의 PINNED_REV/PINNED_FP 도 갱신해라`
        : `SNAPSHOT_REV 가 ${rev} 다 (검사가 못 박은 값은 ${PINNED_REV}) — 필드가 그대로인데 번호만 움직였다면 이 검사도 같이 갱신해라`);

    /* 번호를 올려도 «기억에 안 적히면» 아무 소용이 없다 — 매번 재제출하게 된다 */
    const memos = (cloudSrc.match(/rev: SNAPSHOT_REV/g) || []).length;
    /* ★ «null 로 지우는 곳»(로그아웃·계정 교체)은 세지 않는다 —
     *   처음엔 그것까지 세서 이 검사가 오탐을 냈다. 기억을 **채우는** 곳만 본다. */
    const writes = [...cloudSrc.matchAll(/writeLS\(SUBMITTED_KEY,\s*(\S+)/g)]
      .filter((m) => !m[1].startsWith('null')).length;
    ok(writes > 0 && memos === writes,
      '제출 기억을 채우는 곳마다 형식 번호를 적는다',
      `기억을 채우는 곳 ${writes}군데 중 ${memos}군데만 rev 를 적는다`);

    ok(/\(Number\(done\.rev\) \|\| 1\) !== SNAPSHOT_REV/.test(cloudSrc),
      '형식 번호가 다르면 재제출한다 (옛 기억은 rev 없음 → 1 로 본다)');
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

section('적 생성부가 가벼운 채로 남아 있는가 (game/enemygen.js)');
{
  /* ★ 왜 재는가
   *   나락·탑을 **서버에서 다시 돌리려면 «적을 만드는 절반»만** 있으면 된다
   *   (아군은 클라이언트가 편성을 올린다 — PvP 의 pvp_defense.units 와 같은 방식).
   *   그래서 그 절반을 quest.js(state·gear·squad·pet·world 를 전부 문다)에서 떼어 놨다.
   *   가벼움은 **주석으로는 안 지켜진다** — import 한 줄이면 게임 전체가 도로 딸려 온다.
   *
   * ★★ 그리고 사본을 만들면 안 된다. quest.js 가 상수를 도로 적어 두면 두 벌이 갈리고,
   *   밸런스를 고치는 날 클라와 서버의 적이 조용히 달라진다 (§94 의 교훈).
   *   quest.js 는 **import 해서 다시 내보내기만** 한다.
   */
  /* ※ specsOf·closureOf 는 하네스(맨 위)에 한 벌만 둔다 — 「나락·탑 러너」 절도 같은 것을 쓴다. */

  /* ① 직접 import — 허용 목록 밖을 물면 실패 */
  const ALLOWED_DIRECT = new Set([
    '../core/util.js', '../core/rng.js', '../data/enemies.js',
    '../data/formations.js', '../data/limits.js', '../data/classes.js',
  ]);
  const egSrc = readFileSync(srcDir('game/enemygen.js'), 'utf8');
  const direct = specsOf(egSrc);
  okAll(direct.filter((s) => !ALLOWED_DIRECT.has(s))
    .map((s) => `'${s}' 는 허용 목록 밖이다 — 왜 필요한지 먼저 따져라`),
  'enemygen 의 직접 import 가 허용 목록 안이다', ALLOWED_DIRECT.size);

  /* ② 닫힘 — 게임 쪽(src/game/*)을 하나라도 물면 서버로 게임 전체가 딸려 간다 */
  const ALLOWED_CLOSURE = new Set([
    'src/game/enemygen.js',
    'src/core/rng.js', 'src/core/util.js',
    'src/data/classes.js', 'src/data/classes_t4.js', 'src/data/enemies.js',
    'src/data/formations.js', 'src/data/limits.js', 'src/data/skills.js',
  ]);
  const eg = closureOf('src/game/enemygen.js');
  okAll(eg.filter((f) => !ALLOWED_CLOSURE.has(f))
    .map((f) => `${f} 까지 딸려 온다 — 서버로 게임 전체가 넘어간다`),
  'enemygen 의 import 닫힘이 데이터 모듈 안에서 끝난다', ALLOWED_CLOSURE.size);

  /* ③ 사본 금지 — quest.js 가 옮긴 것을 도로 정의하면 두 벌이 된다 */
  const qSrc = decomment(readFileSync(srcDir('game/quest.js'), 'utf8'));
  const dup = [];
  for (const name of ['RANK_IDX', 'RANK_POWER', 'GROWTH_RATE', 'SCALING_KEYS', 'FLAT_KEYS',
    'ENEMY_GRADE', 'FALLBACK_SLOTS', 'BOSS_SCALE', 'BOSS_SCALE_KEYS', 'MAX_QUEST_LEVEL',
    'ELITE_MULT', 'ELITE_CHAMP_MULT', 'ELITE_CHAMPS', 'ELITE_SPD_SHARE', 'ELITE_PREFIX']) {
    if (new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).test(qSrc)) dup.push(`quest.js 가 ${name} 를 다시 정의한다`);
  }
  for (const fn of ['hashStr', 'slotsOf', 'enemyStats', 'withFormation', 'applyMult',
    'dampBoss', 'eliteResolver', 'enemyUnitDefs']) {
    if (new RegExp(`function\\s+${fn}\\s*\\(`).test(qSrc)) dup.push(`quest.js 가 ${fn}() 를 다시 정의한다`);
  }
  if (!/from\s+'\.\/enemygen\.js'/.test(qSrc)) dup.push('quest.js 가 enemygen.js 를 import 하지 않는다');
  okAll(dup, 'quest.js 가 적 생성부를 베끼지 않고 import 한다', 24);

  /* ④ 재수출이 살아 있는가 — 기존 호출부(ui·tools)가 quest.js 에서 그대로 받아 간다 */
  const EG = need('game/enemygen.js');
  const Limits = need('data/limits.js');
  if (EG && Quest && Limits) {
    const reex = [];
    for (const name of ['enemyUnitDefs', 'enemyStats', 'ELITE_PREFIX', 'MAX_QUEST_LEVEL']) {
      if (Quest[name] !== EG[name]) reex.push(`quest.${name} 가 enemygen 의 것과 다르다`);
    }
    okAll(reex, 'quest.js 가 enemygen 의 이름을 그대로 다시 내보낸다', 4);
    ok(EG.MAX_QUEST_LEVEL === Limits.MAX_LEVEL,
      '레벨 상한이 limits.js 한 곳에서 온다', `${EG.MAX_QUEST_LEVEL} vs ${Limits.MAX_LEVEL}`);
  }

  /* ⑤ 실제로 적이 나오는가 (직렬화 가능한 입력만 주고 부른다 — 서버가 하는 것과 같은 호출) */
  if (EG && Enemies) {
    const boss = Enemies.ENEMY_LIST.find((e) => e.boss);
    const mob = Enemies.ENEMY_LIST.find((e) => !e.boss);
    const mobs = Enemies.ENEMY_LIST.filter((e) => !e.boss);
    const wave = { formationId: 'basic', power: 1.2, elite: true, units: [
      { enemyId: boss.id, level: 50, slotIndex: 0 },
      { enemyId: mob.id, level: 50, slotIndex: 1 },
      { enemyId: mob.id, level: 50, slotIndex: 2 },     // 같은 적 → 이름에 번호가 붙어야 한다
      { enemyId: mobs[1].id, level: 50, slotIndex: 3 },
      { enemyId: mobs[2].id, level: 50, slotIndex: 4 },
      { enemyId: mobs[3].id, level: 50, slotIndex: 5 },
      { enemyId: '없는적', level: 50, slotIndex: 6 },
    ] };
    const call = () => EG.enemyUnitDefs(wave, { id: 'smoke_q', rank: 'A', elite: false }, 0);
    const defs = call();
    const gaps = [];
    if (defs.length !== 6) gaps.push(`없는 적이 안 걸러졌다 (${defs.length}기)`);
    if (!defs.every((u) => u.side === 'enemy' && u.stats && u.stats.hp > 0)) gaps.push('스탯이 안 붙었다');
    if (!defs.some((u) => u.champion && u.name.startsWith(EG.ELITE_PREFIX))) gaps.push('정예 개체가 안 나왔다');
    if (defs[1] && defs[2] && defs[1].name === defs[2].name) gaps.push('같은 적 이름에 번호가 안 붙었다');
    if (defs[0] && !defs[0].boss) gaps.push('보스 표식이 빠졌다');
    if (defs.some((u, i) => u.slotIndex !== i)) gaps.push('슬롯이 그대로 실리지 않았다');
    /* ★ 같은 입력이면 몇 번을 불러도 같아야 한다 — 서버가 다시 계산할 수 있는 근거가 이것이다.
     *   ※ 두 번만 비교하면 «가끔 달라지는» 것을 못 잡는다(메타 검사에서 실제로 놓쳤다). */
    const shots = [JSON.stringify(defs), JSON.stringify(call()), JSON.stringify(call())];
    if (new Set(shots).size !== 1) gaps.push('같은 입력에 결과가 달라진다 (결정론이 깨졌다)');
    okAll(gaps, 'enemygen 이 단독으로 적을 만든다 (결정론)', 7);
  }
}

section('나락·탑을 서버가 다시 돌릴 수 있는가 (game/runverify.js)');
{
  /* ★ 왜 재는가
   *   서버는 클라가 올린 「45심층까지 내려갔다」를 믿을 수 없다. 나락·탑은 이미 결정론이라
   *   **아군 편성만 받으면 같은 판을 다시 돌릴 수 있다** — 그게 `runverify.js` 다.
   *   그런데 그게 성립하려면 두 가지가 동시에 참이어야 한다:
   *     ㄱ. 그 모듈이 **가벼워야** 한다 (state/quest/gear 를 물면 게임 전체가 서버로 딸려 간다)
   *     ㄴ. 클라가 실제로 돌린 것과 **같은 값**이 나와야 한다
   *   ㄴ 을 「대충 비슷하다」로 두면 안 된다. 아래 ⑤ 가 dive()/climb() 의 도달값과
   *   verify 의 도달값을 **정확히 같은지**로 본다.
   *
   * ★★ 그리고 사본을 만들면 안 된다 (§94). abyss.js·tower.js 가 시드나 층 루프를 도로
   *   적어 두면 두 벌이 갈리고, 밸런스를 고치는 날 서버 판정과 클라 화면이 조용히 달라진다.
   */
  const RVsrc = readFileSync(srcDir('game/runverify.js'), 'utf8');
  const ABsrc = readFileSync(srcDir('game/abyss.js'), 'utf8');
  const TWsrc = readFileSync(srcDir('game/tower.js'), 'utf8');

  /* ① 직접 import — 허용 목록 밖을 물면 실패 */
  const RV_DIRECT = new Set([
    '../core/util.js', '../core/rng.js', '../battle/engine.js',
    '../data/abyss.js', '../data/tower.js', '../data/skills.js',
    '../data/enemies.js', '../data/pets.js',
    './enemygen.js', './pet.js',
  ]);
  okAll(specsOf(RVsrc).filter((s) => !RV_DIRECT.has(s))
    .map((s) => `'${s}' 는 허용 목록 밖이다 — 왜 필요한지 먼저 따져라`),
  'runverify 의 직접 import 가 허용 목록 안이다', RV_DIRECT.size);

  /* ② 닫힘 — 상태를 무는 모듈이 하나라도 딸려 오면 서버로 게임 전체가 넘어간다 */
  const RV_CLOSURE = new Set([
    'src/game/runverify.js', 'src/game/enemygen.js', 'src/game/pet.js',
    'src/battle/engine.js', 'src/battle/ai.js',
    'src/core/rng.js', 'src/core/util.js',
    'src/data/abyss.js', 'src/data/tower.js', 'src/data/pets.js',
    'src/data/classes.js', 'src/data/classes_t4.js', 'src/data/enemies.js',
    'src/data/formations.js', 'src/data/limits.js', 'src/data/skills.js',
  ]);
  const rvClosure = closureOf('src/game/runverify.js');
  okAll(rvClosure.filter((f) => !RV_CLOSURE.has(f))
    .map((f) => `${f} 까지 딸려 온다 — 서버로 게임 전체가 넘어간다`),
  'runverify 의 import 닫힘이 데이터·전투 모듈 안에서 끝난다', RV_CLOSURE.size);

  /* ③ 사본 금지 — abyss.js·tower.js 가 옮긴 것을 도로 정의하면 두 벌이 된다.
   *   («상태를 만지는 것»만 저쪽에 남는다: 입장 판정·골드·펫 드랍·기록·로그 이름) */
  const dup = [];
  const MOVED = ['hashStr', 'pickWeighted', 'simulateBattle', 'depthSeed', 'abyssQuest',
    'floorSeed', 'towerQuest', 'floorPet', 'towerPetDef', 'applyCarry'];
  for (const [name, src] of [['abyss.js', decomment(ABsrc)], ['tower.js', decomment(TWsrc)]]) {
    for (const fn of MOVED) {
      if (new RegExp(`function\\s+${fn}\\s*\\(`).test(src)) dup.push(`${name} 가 ${fn}() 를 다시 정의한다`);
    }
    if (/from\s+'\.\.\/battle\/engine\.js'/.test(src)) dup.push(`${name} 가 엔진을 직접 돌린다 (전투 루프가 두 벌이 된다)`);
    if (!/from\s+'\.\/runverify\.js'/.test(src)) dup.push(`${name} 가 runverify.js 를 import 하지 않는다`);
  }
  okAll(dup, 'abyss.js·tower.js 가 러너를 베끼지 않고 import 한다', MOVED.length * 2 + 4);

  const RV = need('game/runverify.js');
  const Abyss2 = need('game/abyss.js');
  const Tower2 = need('game/tower.js');
  const Quest2 = need('game/quest.js');
  const State2 = need('game/state.js');
  const Classes2 = need('data/classes.js');

  if (RV && Abyss2 && Tower2 && Quest2 && State2 && Classes2) {
    /* ④ 재수출이 살아 있는가 — 기존 호출부(ui·tools·스모크)가 저쪽에서 그대로 받아 간다 */
    const reex = [];
    for (const n of ['depthSeed', 'abyssQuest']) if (Abyss2[n] !== RV[n]) reex.push(`Abyss.${n} 가 runverify 의 것과 다르다`);
    for (const n of ['floorSeed', 'towerQuest', 'floorPet']) if (Tower2[n] !== RV[n]) reex.push(`Tower.${n} 가 runverify 의 것과 다르다`);
    okAll(reex, 'abyss.js·tower.js 가 러너의 이름을 그대로 다시 내보낸다', 5);

    /* ⑤ ★★ 핵심 — 같은 세이브·같은 부대에서 dive()/climb() 과 verify 가 **같은 값**을 낸다.
     *   아군 편성은 JSON 왕복을 시킨다 — 서버로 올라갔다 내려오는 것과 같은 취급이라야
     *   "클라가 편성만 올리면 서버가 다시 돌린다" 를 실제로 증명한 것이 된다. */
    const SQ7 = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher',
      'masterarcher', 'archmage', 'oathshield'];
    const mkState = (seed) => {
      State2.newGame(seed, '재계산스모크');
      const st = State2.state;
      st.gold = 9999999;                       // 탑 통행료로 멈추지 않게
      st.roster = [];
      const sq = st.squads[0];
      sq.memberUids = new Array(7).fill(null);
      SQ7.forEach((classId, i) => {
        st.roster.push({
          uid: `rv_${i}`, name: `단원${i}`, classId, level: 80, grade: 'A',
          equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
        });
        sq.memberUids[i] = `rv_${i}`;
      });
      return st;
    };
    const missing = SQ7.filter((c) => !Classes2.getClass(c));
    okAll(missing.map((c) => `클래스 ${c} 가 없다 — 스모크 부대를 갱신해라`),
      '재계산 스모크가 쓰는 7인 부대가 실재한다', SQ7.length);

    const gaps = [];
    let abSame = 0, twSame = 0;
    for (const seed of [101, 202, 303]) {
      /* 나락 */
      {
        const st = mkState(seed);
        const sq = st.squads[0];
        const allies = JSON.parse(JSON.stringify(Quest2.allyUnitDefs(st, sq)));
        const real = Abyss2.dive(st, sq.id, { force: true });
        const v = RV.verifyAbyss({ allies, seed: st.seed, day: st.day, squadId: sq.id });
        if (!(real.reached > 0)) gaps.push(`나락 seed=${seed}: 0심층에서 끝났다 — 검사가 무의미해진다`);
        else if (real.reached !== v.reached) gaps.push(`나락 seed=${seed}: dive=${real.reached} verify=${v.reached}`);
        else abSame++;
      }
      /* 탑 — 소탕 구간(startFloor > 1)까지 함께 본다 */
      {
        const st = mkState(seed);
        const sq = st.squads[0];
        st.tower = { best: 110, bestDay: 1, lastRunDay: 0, lastRunFloor: 110 };
        const allies = JSON.parse(JSON.stringify(Quest2.allyUnitDefs(st, sq)));
        const real = Tower2.climb(st, sq.id, { force: true });
        const v = RV.verifyTower({ allies, seed: st.seed, day: st.day, squadId: sq.id, startFloor: real.from });
        if (real.from <= 1) gaps.push(`탑 seed=${seed}: 소탕 구간이 안 잡혔다 (from=${real.from})`);
        else if (real.log.some((e) => e.type === 'broke')) gaps.push(`탑 seed=${seed}: 골드가 모자라 멈췄다 — 검사가 무의미해진다`);
        else if (real.reached <= real.from) gaps.push(`탑 seed=${seed}: 한 층도 못 올랐다 (reached=${real.reached})`);
        else if (real.reached !== v.reached) gaps.push(`탑 seed=${seed}: climb=${real.reached} verify=${v.reached}`);
        else twSame++;
      }
    }
    okAll(gaps, `verify 가 dive()/climb() 과 같은 도달값을 낸다 (나락 ${abSame}·탑 ${twSame})`, 6);

    /* ⑥ 펫이 어느 쪽에 실리는가.
     *   아군 펫은 **편성에 실려 온다**(그래서 runverify 는 아군 펫을 몰라도 된다).
     *   반대로 «탑의 주인»은 **적**이고 `pet:true` 가 아니다 — 안 잡으면 못 이긴다.
     *   이걸 빼고 다시 돌리면 도달 층이 통째로 어긋난다(실측: 7/7 시드에서 +1~+24층). */
    const Pet2 = need('game/pet.js');
    const petBad = [];
    {
      const st = mkState(404);
      const sq = st.squads[0];
      const made = [['pet_warden', 'S'], ['pet_chalice', 'A'], ['pet_starcalf', 'B']]
        .map(([sid, g]) => Pet2.makePet(st, sid, g));
      made.forEach((p, i) => { st.pets.push(p); Pet2.assignPet(st, sq.id, i, p.uid); });
      const allies = Quest2.allyUnitDefs(st, sq);
      if (allies.filter((a) => a.pet).length !== 3) petBad.push('아군 편성에 펫이 안 실린다 — 서버가 아군 펫을 못 받는다');

      const cfg = RV.towerBattleDefs({ allies, ctx: st, squadId: sq.id, floor: 7 });
      const owner = cfg.enemies.find((e) => String(e.uid).startsWith('tw_pet_'));
      if (!owner) petBad.push('탑의 주인이 적에 안 선다 — 재계산이 한 기 모자란다');
      else {
        if (owner.pet) petBad.push('탑의 주인에 pet 표식이 붙었다 — 안 잡아도 이겨 버린다');
        if (!owner.boss) petBad.push('탑의 주인에 보스 표식이 없다');
        if (!(owner.stats.hp > 0)) petBad.push('탑의 주인 스탯이 비었다');
      }
      // 나락에는 주인이 없다 (탑 전용이다)
      const acfg = RV.abyssBattleDefs({ allies, ctx: st, squadId: sq.id, depth: 7 });
      if (acfg.enemies.some((e) => String(e.uid).startsWith('tw_pet_'))) petBad.push('나락에 탑의 주인이 섞였다');
    }
    okAll(petBad, '아군 펫은 편성으로, 탑의 주인은 적으로 실린다', 6);

    /* ⑦ 결정론 · 상태 불변.
     *   ※ 두 번만 비교하면 «가끔 달라지는» 것을 못 잡는다(enemygen 절의 메타 검사에서 실제로 놓쳤다). */
    const detBad = [];
    {
      const st = mkState(505);
      const sq = st.squads[0];
      const allies = JSON.parse(JSON.stringify(Quest2.allyUnitDefs(st, sq)));
      const args = { allies, seed: st.seed, day: st.day, squadId: sq.id, maxDepth: 12 };
      const before = JSON.stringify(allies);
      const shots = [RV.verifyAbyss(args).reached, RV.verifyAbyss(args).reached, RV.verifyAbyss(args).reached];
      if (new Set(shots).size !== 1) detBad.push(`같은 입력에 도달 심층이 달라진다 (${shots.join('/')})`);
      const targs = { allies, seed: st.seed, day: st.day, squadId: sq.id, startFloor: 1, maxFloors: 8 };
      const tshots = [RV.verifyTower(targs).reached, RV.verifyTower(targs).reached, RV.verifyTower(targs).reached];
      if (new Set(tshots).size !== 1) detBad.push(`같은 입력에 도달 층이 달라진다 (${tshots.join('/')})`);
      if (JSON.stringify(allies) !== before) detBad.push('올라온 편성을 러너가 고쳐 놨다 (다음 판이 어긋난다)');
      /* 시드를 실제로 쓰는가 — 네 축(시드·날짜·부대·깊이)이 전부 판을 바꿔야 한다.
       * ★ 「도달값이 달라지나」로 재면 안 된다. 상한에 걸리는 부대에서는 어느 시드든
       *   같은 값이 나와 **검사가 통째로 거짓 실패**한다 (실제로 그렇게 만들었다가 걸렸다). */
      const base = { seed: 12345, day: 7 };
      const d0 = RV.depthSeed(base, 9, 'sqA');
      const f0 = RV.floorSeed(base, 9, 'sqA');
      for (const [why, ctx, n, sid] of [
        ['시드', { seed: 54321, day: 7 }, 9, 'sqA'],
        ['날짜', { seed: 12345, day: 8 }, 9, 'sqA'],
        ['부대', base, 9, 'sqB'],
        ['깊이', base, 10, 'sqA'],
      ]) {
        if (RV.depthSeed(ctx, n, sid) === d0) detBad.push(`${why} 를 바꿔도 심층 시드가 같다`);
        if (RV.floorSeed(ctx, n, sid) === f0) detBad.push(`${why} 를 바꿔도 층 시드가 같다`);
      }
      /* 그리고 그 시드가 실제로 적 편성을 바꾼다.
       * ★ 두 시드만 견주면 안 된다 — 얕은 곳은 적 풀이 작아서 **우연히 같은 편성**이 나온다
       *   (실제로 9심층에서 그렇게 거짓 실패했다). 여러 시드를 모아 «전부 같은가»로 본다. */
      const SEEDS4 = [12345, 54321, 777, 20260827];
      const wave = (q) => JSON.stringify(q.waves[0].units);
      const abWaves = new Set(SEEDS4.map((s) => wave(RV.abyssQuest({ seed: s, day: 7 }, 45, 'sqA'))));
      const twWaves = new Set(SEEDS4.map((s) => wave(RV.towerQuest({ seed: s, day: 7 }, 250, 'sqA'))));
      if (abWaves.size === 1) detBad.push('시드를 바꿔도 나락 적 편성이 그대로다');
      if (twWaves.size === 1) detBad.push('시드를 바꿔도 탑 적 편성이 그대로다');
      // 상한을 넘겨 달라고 해도 더 내려가지 않는다
      if (RV.verifyAbyss({ ...args, maxDepth: 3 }).reached > 3) detBad.push('maxDepth 를 넘겨 내려간다');
      // 소탕이 꼭대기까지 닿으면 한 층도 안 오른다 (여기서 clamp 하면 마지막 층을 또 싸운다)
      const top = RV.verifyTower({ allies, seed: st.seed, day: st.day, squadId: sq.id, startFloor: 100000 });
      if (top.reached !== 99999) detBad.push(`꼭대기 위에서 시작하면 그대로 끝나야 한다 (reached=${top.reached})`);
    }
    okAll(detBad, '러너가 결정론이고 시드를 실제로 쓰며 편성을 안 고친다', 15);
  }
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

section('대표 부대를 바꾸면 순위표가 따라오는가');
{
  /* ★★ 제작자가 겪은 것: 「방금 대표를 2부대에서 1부대로 바꿨는데 그대로인데」.
   *
   *   원인은 «표시만 바뀌는 변경» 이다. cloud.js 의 worthSubmitting 은
   *   나락·탑·의뢰·S용병·전력 다섯 축이 **올랐을 때만** 제출을 내보낸다
   *   (save() 는 시간당 수백 번인데 서버 함수를 그때마다 돌릴 수는 없다).
   *   대표 부대 변경은 그 다섯 중 어느 것도 아니다 — 게다가 topPower 는
   *   «모든 부대 중 최대» 라서 대표를 누구로 바꾸든 **아예 안 움직인다.**
   *   그래서 강제 제출이 없으면 순위표는 옛 부대를 영원히 내걸고 있는다.
   *
   *   검사는 두 겹이다:
   *     ① 실측 — flagSquadId 만 바꿨을 때 «내걸리는 부대는 바뀌는데 다섯 축은 그대로» 인가
   *     ② 그러므로 대표를 바꾸는 자리가 force 제출을 하는가
   *   ①이 깨지면(대표가 제출 축에 들어가면) ②는 필요 없어진다 — 그때 이 검사를 고친다. */
  const R = need('game/rules.js');
  if (!R) { ok(false, '규칙 모듈을 못 읽었다'); } else {
    const mkState = () => ({
      seed: 7, dataVersion: 1, companyName: '실측단', day: 30, gold: 0, renown: 0,
      abyss: { best: 3 }, tower: { best: 5 }, stats: { questsDone: 9, hires: 0, specHires: 0 },
      roster: [
        { uid: 'a1', name: '가', classId: 'swordsman', level: 40, grade: 'A', hiredDay: 2, equipment: {} },
        { uid: 'b1', name: '나', classId: 'archer', level: 20, grade: 'C', hiredDay: 3, equipment: {} },
      ],
      items: [],
      squads: [
        { id: 's1', name: '1부대', formationId: 'basic', memberUids: ['a1'], power: 100 },
        { id: 's2', name: '2부대', formationId: 'basic', memberUids: ['b1'], power: 900 },
      ],
      flagSquadId: null,
    });

    /* ① 대표만 바꿔 본다 — 2부대(센 쪽) → 1부대(약한 쪽), 제작자가 한 그대로 */
    const before = mkState(); before.flagSquadId = 's2';
    const after = mkState(); after.flagSquadId = 's1';
    const sB = R.extractScore(before);
    const sA = R.extractScore(after);

    ok(sB && sA && sB.squad && sA.squad, '두 상태에서 점수를 읽어 냈다',
      `before=${sB && sB.squad && sB.squad.name} after=${sA && sA.squad && sA.squad.name}`);

    if (sB && sA && sB.squad && sA.squad) {
      /* 내걸리는 부대는 **분명히** 바뀐다 */
      ok(sB.squad.name === '2부대' && sA.squad.name === '1부대',
        '대표를 바꾸면 순위표에 실리는 부대가 바뀐다',
        `${sB.squad.name} → ${sA.squad.name}`);

      /* 그런데 제출을 트리거하는 다섯 축은 하나도 안 움직인다 */
      const AXES = ['abyssBest', 'towerBest', 'questsDone', 'sMercs', 'topPower'];
      const moved = AXES.filter((k) => sB[k] !== sA[k]);
      ok(moved.length === 0,
        '제출 트리거 다섯 축은 대표 변경에 반응하지 않는다 (= 평소 경로로는 안 나간다)',
        moved.length ? `움직인 축: ${moved.join(' ')} — 이 검사의 전제가 바뀌었다` : `축 ${AXES.join(' ')} 전부 동일`);
    }

    /* ② 그러므로 대표를 바꾸는 자리는 강제 제출을 해야 한다.
     *   setFlagSquad 함수 **본문 안**에서만 찾는다 — 파일 어딘가에 있기만 하면
     *   통과하는 검사는 이 버그를 못 잡았을 것이다 (다른 버튼의 제출을 보고 통과한다). */
    const csrc = readFileSync(srcDir('ui/company.js'), 'utf8');
    const bodyOf = (src, name) => {
      const at = src.indexOf(`function ${name}(`);
      if (at < 0) return '';
      const open = src.indexOf('{', at);
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
      }
      return src.slice(open);
    };
    const flagBody = bodyOf(csrc, 'setFlagSquad');
    ok(flagBody.length > 40, 'setFlagSquad 본문을 찾았다', `${flagBody.length}자`);
    ok(/submitScore\s*\(\s*\{[^}]*force\s*:\s*true/.test(flagBody),
      '대표를 바꾸면 그 자리에서 강제 제출한다',
      flagBody.includes('submitScore') ? 'submitScore 는 있는데 force 가 아니다' : '본문에 submitScore 가 없다');

    /* ★ 메타 검사 — 강제 제출을 지우면 위 검사가 실제로 무는가.
     *   이 저장소에서 «통과만 하고 아무것도 안 잡는 검사» 를 여러 번 만들었다. */
    const planted = flagBody.replace(/if \(Cloud\.ready\(\)\) Cloud\.submitScore\(\{ force: true \}\)[^\n]*\n/, '');
    ok(planted !== flagBody && !/submitScore\s*\(\s*\{[^}]*force\s*:\s*true/.test(planted),
      '검사가 실제로 문다 (강제 제출을 지우면 걸린다)',
      planted === flagBody ? '심을 줄을 못 찾았다 — 검사가 헛돈다' : '지웠는데도 통과한다');
  }
}

section('업데이트 내역 — 날짜와 밀림');
{
  /* ★★ 제작자가 화면을 보고 두 가지를 짚었다:
   *     「업데이트때 업데이트 내역도 안쓰고있네」
   *     「지금 8월 25일인데 날짜 왜이래」  ← 팝업에 2026-08-28 이 떠 있었다
   *
   *   실측해 보니 **내역 커밋은 전부 2026-08-21 인데 date 는 08-20~08-28** 이었다.
   *   즉 날짜를 «앞으로» 지어내 적고 있었다. 그리고 마지막 내역 갱신 뒤로
   *   커밋 27개(08-22·08-24·08-25)가 통째로 안 적혀 있었다 — PvP 한 벌이 통째로.
   *
   *   그래서 «사람이 기억하기» 대신 검사로 못 박는다. 기준 시각은 **최신 커밋 날짜**다 —
   *   벽시계를 쓰면 검사가 날마다 결과를 바꾼다. */
  const CL = need('data/changelog.js');
  if (!CL) { ok(false, '업데이트 내역 모듈을 못 읽었다'); } else {
    const list = Array.isArray(CL.CHANGELOG) ? CL.CHANGELOG : [];
    ok(list.length > 0, '내역 항목을 읽어 냈다', `${list.length}개`);

    let head = '';
    try {
      head = execFileSync('git', ['log', '-1', '--date=short', '--pretty=%ad'],
        { cwd: rootDir, encoding: 'utf8' }).trim();
    } catch { /* git 없는 환경 — 아래 검사들을 건너뛴다 */ }

    const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
    okAll(list.filter((e) => !isDate(e.date)).map((e) => `${e.id}: date '${e.date}' 가 YYYY-MM-DD 가 아니다`),
      '모든 항목이 날짜 모양을 갖췄다', list.length || 1);

    /* ① 미래 날짜 금지 — 이번에 걸린 바로 그것 */
    if (head) {
      okAll(list.filter((e) => isDate(e.date) && e.date > head)
        .map((e) => `${e.id}: ${e.date} 는 최신 커밋(${head})보다 미래다`),
        `내역 날짜가 미래가 아니다 (기준 ${head})`, list.length || 1);
    } else {
      ok(true, 'git 이 없어 날짜 기준 검사를 건너뜀');
    }

    /* ② 위가 최신 — 팝업이 위에서부터 읽는다 */
    const disorder = [];
    for (let i = 1; i < list.length; i++) {
      if (isDate(list[i - 1].date) && isDate(list[i].date) && list[i - 1].date < list[i].date) {
        disorder.push(`${list[i - 1].id}(${list[i - 1].date}) 아래에 더 최신인 ${list[i].id}(${list[i].date}) 가 있다`);
      }
    }
    okAll(disorder, '맨 위가 최신이다 (날짜가 내려간다)', Math.max(1, list.length - 1));

    /* ③ id 는 «본 적 있는가» 의 열쇠다 — 겹치면 안 본 사람이 못 본다 */
    const seen = new Set();
    const dup = [];
    for (const e of list) { if (seen.has(e.id)) dup.push(`id '${e.id}' 가 두 번 나온다`); seen.add(e.id); }
    okAll(dup, 'id 가 겹치지 않는다', list.length || 1);
    ok(CL.LATEST_ID === (list[0] && list[0].id), 'LATEST_ID 가 맨 위 항목이다',
      `${CL.LATEST_ID} vs ${list[0] && list[0].id}`);

    /* ④ 새 항목은 id 앞에 제 날짜를 단다.
     *   ★ 옛 항목 20개는 날짜를 뒤로 고쳤는데 id 는 못 고친다 — id 를 바꾸면
     *     이미 본 사람에게 팝업이 다시 뜬다 (파일 머리말의 규칙). 그래서 **날짜로 봐준다**:
     *     2026-08-22 이후 항목만 본다. 그 앞은 어긋난 채로 굳었다. */
    const GRANDFATHER = '2026-08-22';
    okAll(list.filter((e) => isDate(e.date) && e.date >= GRANDFATHER && !String(e.id).startsWith(e.date))
      .map((e) => `${e.id}: id 가 제 날짜(${e.date})로 시작하지 않는다`),
      `새 항목은 id 가 날짜로 시작한다 (${GRANDFATHER} 이후)`, list.length || 1);

    /* ⑤ **내역이 밀리지 않았는가** — 제작자가 짚은 진짜 문제.
     *   일하고 나서 적기를 잊으면 여기서 걸린다. 도구·리팩터링만 한 날을 위해 이틀 봐준다. */
    if (head && isDate(list[0] && list[0].date)) {
      const dayOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
      const behind = dayOf(head) - dayOf(list[0].date);
      ok(behind <= 2, '업데이트 내역이 밀리지 않았다',
        `최신 커밋 ${head} 인데 최신 내역은 ${list[0].date} (${behind}일 밀렸다) — src/data/changelog.js 에 항목을 더해라`);
    }
  }
}

section('PvP 화면 — 남이 움직인 것이 보이는가 · 편성이 따라가는가');
{
  /* ★★ 제작자가 화면으로 짚은 두 가지:
   *     「근데 난 왜 상대 안보이니」        — 서버엔 2행인데 화면엔 1행이었다
   *     「부대 등록하면 자동 업데이트 되나?」 — 아니었다. 옛 편성으로 싸우고 있었다
   *
   *   ① 은 모듈 변수에 담은 캐시가 **세션 내내 살아 있어서**였다. 지우는 곳이
   *      «내가 등록/도전했을 때» 뿐이라, 남이 등록하거나 나를 때린 건 영영 안 보였다.
   *      (그래서 전적엔 5판이 찍혔는데 전적표는 0승 0패였다.)
   *   ② 는 등록이 **얼어붙은 사본**이라서다. 그 사본이 곧 공격 편성이라 더 나빴다. */
  /* ★ net/ 는 MODULE_LIST 에 없다 (브라우저 전용 모듈들이라). 직접 읽는다 —
   *   pvp.js 는 DOM 없이도 들어온다 (모듈 몸신이 fetch 를 안 부른다). */
  let P = null;
  try { P = await import(srcUrl('net/pvp.js')); } catch (e) { ok(false, 'net/pvp.js 를 읽는다', String(e.message)); }
  const psrc = readFileSync(srcDir('ui/pvp.js'), 'utf8');

  const bodyOf = (src, name) => {
    const at = src.indexOf(`function ${name}(`);
    if (at < 0) return '';
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
    }
    return src.slice(open);
  };

  /* ── ① 캐시가 늙어 죽는가 ─────────────────────────────────────── */
  const faults = [];
  const ttlM = psrc.match(/const CACHE_MS = ([\d_]+)/);
  const ttl = ttlM ? Number(String(ttlM[1]).replace(/_/g, '')) : 0;
  ok(ttl > 0 && ttl <= 60_000, 'PvP 목록 캐시에 수명이 있다 (0 < TTL ≤ 60초)',
    ttlM ? `CACHE_MS = ${ttl}` : 'CACHE_MS 를 못 찾았다 — 캐시가 영원히 살 수 있다');

  const dataBody = bodyOf(psrc, 'pvpData');
  ok(/Date\.now\(\)\s*-\s*dataAt\)?\s*<\s*CACHE_MS/.test(dataBody),
    '캐시를 쓸지 말지를 시각으로 판단한다',
    dataBody ? '수명 비교가 없다 — 한 번 담으면 계속 쓴다' : 'pvpData 를 못 찾았다');

  /* 옛 «영원한 캐시» 가 되살아나지 않게 못 박는다 */
  ok(!/\b(boardCache|meCache)\b\s*=/.test(psrc),
    '세션 내내 사는 목록 캐시가 없다 (boardCache/meCache)',
    '모듈 변수 캐시가 되살아났다');

  /* me 와 board 를 한 곳에서 받는가 — 따로 받으면 «나» 표시가 비는 경합이 산다 */
  ok(/Promise\.all\(\[/.test(dataBody) && /Pvp\.me\(\)/.test(dataBody) && /Pvp\.board\(/.test(dataBody),
    'me 와 board 를 한 약속으로 묶어 받는다 (myHandle 경합 제거)');

  /* ── ② 도전 직전에 편성을 맞추는가 ────────────────────────────── */
  const chBody = bodyOf(psrc, 'doChallenge');
  ok(chBody.length > 100, 'doChallenge 본문을 찾았다', `${chBody.length}자`);

  const iStale = chBody.indexOf('lineupStale');
  const iReg = chBody.indexOf('registerNow');
  const iFight = chBody.indexOf('Pvp.challenge(');
  const iGold = chBody.indexOf('state.gold =');
  faults.push(
    iStale < 0 ? '도전 전에 편성이 낡았는지 안 본다' : null,
    iReg < 0 ? '도전 전에 다시 등록하지 않는다' : null,
    iFight < 0 ? 'Pvp.challenge 호출이 없다' : null,
    (iReg >= 0 && iFight >= 0 && iReg > iFight) ? '재등록이 도전보다 뒤에 있다 — 옛 편성으로 싸운다' : null,
    (iGold >= 0 && iReg >= 0 && iGold < iReg) ? '골드를 재등록보다 먼저 깎는다 — 등록 실패 시 골드만 날린다' : null,
    /needRebuild/.test(chBody) ? null : '엔진이 바뀌었을 때(needRebuild) 다시 접지 않는다',
  );
  okAll(faults.filter(Boolean), '도전은 최신 편성으로 나가고, 실패하면 골드를 안 쓴다', 6);

  /* 등록에 성공했을 때만 지문을 적는가 — 실패했는데 적으면 «최신» 으로 굳는다 */
  const regBody = bodyOf(psrc, 'registerNow');
  const iBad = regBody.indexOf('if (!res.ok)');
  const iFp = regBody.indexOf('writeFp(');
  ok(iFp > iBad && iBad >= 0, '지문은 등록에 성공한 뒤에만 적는다',
    iFp < 0 ? 'writeFp 가 없다' : '실패 경로에서도 지문을 적는다 — 낡은 편성이 «최신» 으로 굳는다');

  /* ── ③ 지문이 편성 변화를 실제로 잡는가 (글자가 아니라 굴려서) ── */
  if (!P || typeof P.lineupFp !== 'function') {
    ok(false, 'lineupFp 를 읽었다', 'net/pvp.js 가 안 내보낸다');
  } else {
    const base = () => ([
      [{ uid: 'a', name: '가', classId: 'swordsman', side: 'ally', stats: { hp: 900, atk: 120, def: 40 } },
        { uid: 'b', name: '나', classId: 'archer', side: 'ally', stats: { hp: 500, atk: 200, def: 10 } }],
      [{ uid: 'c', name: '다', classId: 'priest', side: 'ally', stats: { hp: 600, atk: 80, def: 20 } }],
    ]);
    const fp0 = P.lineupFp(base());
    const miss = [];
    if (P.lineupFp(base()) !== fp0) miss.push('같은 편성인데 지문이 달라진다 — 늘 «낡았다» 가 된다');

    const mut = [
      ['장비로 공격력이 올랐다', (u) => { u[0][0].stats.atk += 1; }],
      ['체력이 1 올랐다', (u) => { u[0][0].stats.hp += 1; }],
      ['단원 이름이 바뀌었다', (u) => { u[0][0].name = '라'; }],
      ['클래스가 승급했다', (u) => { u[0][0].classId = 'knight'; }],
      ['부대 안 순서가 바뀌었다', (u) => { u[0].reverse(); }],
      ['부대 순서가 바뀌었다', (u) => { u.reverse(); }],
      ['단원이 한 명 빠졌다', (u) => { u[0].pop(); }],
      ['부대가 하나 늘었다', (u) => { u.push([{ uid: 'z', name: '마', classId: 'rogue', stats: { hp: 1 } }]); }],
    ];
    for (const [why, f] of mut) {
      const u = base();
      f(u);
      if (P.lineupFp(u) === fp0) miss.push(`${why} — 지문이 안 바뀐다`);
    }
    okAll(miss, '지문이 편성 변화를 전부 잡는다', mut.length + 1);
    ok(/^[0-9a-f]{16}$/.test(fp0), '지문이 64비트 16진수다', fp0);
  }
}

section('PvP 재생 — 화면이 서버 결과를 그대로 낸다');
{
  /* ★★ 제작자: 「도전하면 전투를 보여줘야되는거 아니니」 「전적에서도 전투 보는게 없는데」.
   *
   *   재생은 **서버가 준 cfg(양쪽 부대 + 시드 하나)만으로** 다시 돌린다. 그래서 두 가지가
   *   깨지면 안 된다:
   *     ① 재생이 서버와 **같은 답**을 내야 한다 — 아니면 「화면에선 이겼는데 점수는 졌다」
   *     ② 재생은 **아무것도 정산하면 안 된다** — 아니면 「다시 보기로 경험치 벌기」
   *
   *   ②가 `ui/battle.js` 를 그대로 못 쓴 이유다. 그쪽은 경험치·부상·전리품이 얽혀 있다. */
  const rsrc = readFileSync(srcDir('ui/pvpreplay.js'), 'utf8');

  /* ── ① 재생이 서버와 같은 답을 내는가 (굴려서) ───────────────── */
  let TM2 = null;
  let EN2 = null;
  let SK2 = null;
  try {
    TM2 = await import(srcUrl('battle/tagmatch.js'));
    EN2 = await import(srcUrl('battle/engine.js'));
    SK2 = await import(srcUrl('data/skills.js'));
  } catch (e) {
    ok(false, '재생에 쓰는 모듈을 읽는다', String(e.message));
  }

  if (TM2 && EN2 && SK2) {
    const mk = (n, side, hp, atk) => Array.from({ length: n }, (_, i) => ({
      uid: `${side}${i}`, name: `${side}${i}`, classId: 'swordsman', side,
      stats: { hp, atk, def: 20, res: 10, spd: 100, crit: 5, critDmg: 150, eva: 3 },
    }));
    const cfg = {
      attacker: [mk(3, 'ally', 800, 90), mk(3, 'ally', 700, 110)],
      defender: [mk(3, 'enemy', 750, 95), mk(3, 'enemy', 820, 85), mk(2, 'enemy', 600, 130)],
    };
    const trim = (r) => r.map((x) => `${x.attackerSquad}:${x.defenderSquad}:${x.winner}:${x.attackerLeft}:${x.defenderLeft}:${x.time}`);

    const drift = [];
    for (const seed of [1, 7, 12345, 0xC0FFEE, 999983]) {
      const server = TM2.tagMatch({ ...cfg, seed, getSkill: SK2.getSkill });
      const client = TM2.tagMatch({ ...cfg, seed, getSkill: SK2.getSkill });
      if (server.winner !== client.winner) drift.push(`seed ${seed}: 승자가 갈린다 ${server.winner}/${client.winner}`);
      if (JSON.stringify(trim(server.rounds)) !== JSON.stringify(trim(client.rounds))) {
        drift.push(`seed ${seed}: 합 전개가 갈린다`);
      }

      /* ★★ 재생은 **화면용이라 record:true** 로 돈다 (이벤트가 있어야 타격이 그려진다).
       *   서버는 record:false 다. 이게 시뮬레이션을 바꾸면 재생이 통째로 어긋난다 —
       *   그래서 «합마다 실제로 다시 돌려» 서버 결과와 대조한다. */
      for (const r of server.rounds) {
        const play = EN2.createBattle({ ...r.input, getSkill: SK2.getSkill });   // record 기본값 = true
        let g = 0;
        while (!play.finished && g++ < 20000) play.step(1 / 60);
        const w = play.winner === 'ally' ? 'attacker' : play.winner === 'enemy' ? 'defender' : 'draw';
        if (w !== r.winner) drift.push(`seed ${seed} ${r.attackerSquad}:${r.defenderSquad} 합 — 재생 ${w} vs 서버 ${r.winner}`);
      }
    }
    okAll(drift, '재생(record:true)이 서버(record:false)와 같은 답을 낸다', 5 * 3);

    /* 합마다의 입력이 실려 있는가 — 없으면 클라가 재생할 방법이 없다 */
    const one = TM2.tagMatch({ ...cfg, seed: 42, getSkill: SK2.getSkill });
    const noInput = one.rounds.filter((r) => !r.input || !Array.isArray(r.input.allies) || !r.input.enemies || !r.input.seed);
    okAll(noInput.map((r, i) => `${i}번째 합에 input 이 없다`), '합마다 재생 입력(input)이 실려 있다', one.rounds.length || 1);

    /* 이긴 쪽이 **회복 없이** 이어 싸우는가 — 재생이 이걸 못 지키면 화면이 서버와 갈린다 */
    const carried = one.rounds.some((r, i) => i > 0 && (r.input.allies.some((u) => u.hp != null) || r.input.enemies.some((u) => u.hp != null)));
    ok(carried, '생존자가 HP 를 들고 다음 합으로 넘어간다 (input 에 hp 가 실린다)',
      `합 ${one.rounds.length}개 중 hp 를 들고 간 합이 없다`);
  }

  /* ── ② 재생이 아무것도 정산하지 않는가 ──────────────────────── */
  const forbidden = [
    [/\bsave\s*\(/, 'save() 를 부른다 — 재생이 세이브를 건드린다'],
    [/\baddGold\s*\(/, 'addGold() 를 부른다'],
    [/\baddLog\s*\(/, 'addLog() 를 부른다'],
    [/\bstate\.[A-Za-z_$][\w$]*\s*(?:=|\+=|-=|\+\+|--)/, 'state 를 쓴다 — 재생으로 보상을 벌 수 있다'],
    [/\bgrantExp\b|\bapplyInjury\b|\brollLoot\b/, '경험치·부상·전리품 정산을 부른다'],
  ];
  okAll(forbidden.filter(([re]) => re.test(rsrc)).map(([, why]) => why),
    '재생은 상태를 한 글자도 안 건드린다', forbidden.length);

  /* 실제로 state 를 «읽기만» 하는지도 본다 — 이름만 지운 우회를 막는다 */
  ok(/import \{ state \} from '\.\.\/game\/state\.js'/.test(rsrc) && !/from '\.\.\/game\/state\.js';[\s\S]*\bsave\b/.test(rsrc),
    '재생은 state 를 읽기 전용으로만 가져온다');

  /* ── ③ 들어가는 문이 둘 다 있는가 ──────────────────────────── */
  const psrc2 = readFileSync(srcDir('ui/pvp.js'), 'utf8');
  const bodyOf = (src, name) => {
    const at = src.indexOf(`function ${name}(`);
    if (at < 0) return '';
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
    }
    return src.slice(open);
  };
  const gaps = [];
  /* ★ 도전이 끝나면 **바로** 재생으로 가야 한다 — 제작자가 두 번 짚었다:
   *   「도전하면 전투를 보여줘야되는거 아니」 · 「전투는 안보이고 내 전적에서 봐야되네」 */
  {
    const chBody2 = bodyOf(psrc2, 'doChallenge');
    if (!/go\('pvpreplay'/.test(chBody2)) gaps.push('도전이 끝나도 재생으로 안 간다 — 전적을 찾아가야 볼 수 있다');
  }
  if (!/go\('pvpreplay',\s*\{[^}]*cfg:/.test(psrc2.replace(/\n/g, ' '))) gaps.push('도전 결과에서 «전투 보기» 로 못 들어간다');
  if (!/go\('pvpreplay',\s*\{[^}]*matchId:\s*r\.id/.test(psrc2.replace(/\n/g, ' '))) gaps.push('전적에서 «보기» 로 못 들어간다');
  okAll(gaps, '결과와 전적 두 곳에서 재생으로 들어간다', 2);

  /* ★★ 재생의 **모든** 전투 생성이 tagmatch 와 같은 조건이어야 한다.
   *   한 군데라도 `rout: false` 를 빼먹으면 **합 목록과 화면이 다른 말을 한다** —
   *   목록은 «전멸(0)» 인데 화면은 패주로 일찍 끝난다. 실제로 재생 본편이 빼먹고 있었다.
   *
   * ★ 처음 쓴 검사는 **주석 안의 `rout: false` 까지 셌다.** 그래서 코드에서 빼도
   *   주석이 대신 세어져 안 물었다 — 메타 검사가 그걸 잡았다. 주석을 지우고 센다.
   *   (같은 이유로 아래 의뢰/태그매치 검사도 주석을 지운 소스로 본다.) */
  const rcode = decomment(rsrc);
  const rcalls = (rcode.match(/createBattle\(\{/g) || []).length;
  const rrout = (rcode.match(/rout:\s*false/g) || []).length;
  ok(rcalls > 0 && rrout >= rcalls, '재생의 모든 전투가 tagmatch 와 같은 조건으로 돌아간다 (rout 꺼짐)',
    `createBattle ${rcalls}군데 중 rout:false 는 ${rrout}군데`);


  /* ★ 양쪽 편성을 표로 볼 수 있는가 (제작자: 「내꺼나 상대 부대 편성정보 볼수있나」).
   *   전적은 내가 싸운 판이라 cfg 가 온다.
   *
   * ★★ 표를 그리는 코드는 **`ui/lineupview.js` 로 옮겼다** — 순위표(`ui/pvp.js`)도 같은 것을 쓴다.
   *   그래서 여기서는 «재생이 그 공용 렌더러에 양쪽을 넘기는가» 를 본다.
   *   복사본을 남겨 두면 반드시 갈라지므로 **여기 다시 그리는 코드가 있으면 걸리게** 해 뒀다. */
  {
    const gaps3 = [];
    if (!/from '\.\/lineupview\.js'/.test(rsrc)) gaps3.push('공용 편성 렌더러를 안 쓴다');
    if (!/S\.cfg\.attacker/.test(rsrc) || !/S\.cfg\.defender/.test(rsrc)) gaps3.push('양쪽 편성을 다 안 넘긴다');
    if (!/'편성'/.test(rsrc)) gaps3.push('편성 버튼이 없다');
    /* 옮겨 놓고 복사본이 남으면 둘이 갈라진다 — 이 파일에는 표를 그리는 코드가 없어야 한다 */
    if (/rp-lu/.test(rcode)) gaps3.push('편성 표를 여기서 또 그린다 (lineupview.js 와 갈라진다)');
    okAll(gaps3, '재생이 공용 편성 렌더러에 양쪽을 넘긴다', 4);
  }

  /* ★★ **앞으로의 합을 미리 보여 주지 않는다.**
   *   제작자 지적: 「다음 라운드 결과가 하단에 리스트로 미리 나오는데 ·
   *   결과가 미리 보이니까 안좋다」.
   *   결과 칸만 비우는 걸로는 부족하다 — 목록이 길면 «몇 합짜리인지» 가 드러난다. */
  {
    const body = rsrc.slice(rsrc.indexOf('function paintRounds'), rsrc.indexOf('function paintRounds') + 1600);
    const gaps2 = [];
    if (!/S\.rounds\.slice\(0, upto\)/.test(body)) gaps2.push('합 목록을 현재 합까지 자르지 않는다');
    if (/\$\{S\.rounds\.length\}합`\s*:/.test(body) || /\/ \$\{S\.rounds\.length\}/.test(body)) {
      gaps2.push('진행 중에 총 합 수를 적는다 — 그 자체가 스포일러다');
    }
    okAll(gaps2, '재생이 앞으로의 합을 미리 안 보여 준다', 2);
  }

  /* 화면이 등록돼 있고 오프라인 목록에도 들어갔는가 */
  const asrc = readFileSync(srcDir('ui/app.js'), 'utf8');
  ok(/id: 'pvpreplay'/.test(asrc), 'pvpreplay 화면이 SCREENS 에 등록돼 있다');
  const sw = readFileSync(fileURLToPath(new URL('sw.js', ROOT)), 'utf8');
  okAll(['./src/ui/pvpreplay.js', './src/battle/tagmatch.js']
    .filter((f) => !sw.includes(f)).map((f) => `${f} 가 APP_SHELL 에 없다`),
    '새 모듈이 APP_SHELL 에 들어갔다', 2);

  /* ── ④ tagmatch 가 ENGINE_HASH 를 건드리지 않는가 ───────────── */
  const gsrc = readFileSync(fileURLToPath(new URL('tools/goldenbattle.mjs', ROOT)), 'utf8');
  const entryBlock = gsrc.slice(gsrc.indexOf('ENTRY'), gsrc.indexOf('ENTRY') + 600);
  ok(!/tagmatch/.test(entryBlock),
    'tagmatch 는 ENGINE_HASH 대상이 아니다 (넣으면 모든 사람의 PvP 등록이 한꺼번에 무효가 된다)',
    'goldenbattle 의 ENTRY 에 tagmatch 가 들어갔다');

  /* 서버가 응답에서 input 을 떼는가 — 안 떼면 응답이 합 수만큼 불어난다 */
  const isrc = readFileSync(fileURLToPath(new URL('supabase/functions/pvp-battle/index.ts', ROOT)), 'utf8');
  ok(/roundLog:\s*result\.rounds\.map\(\(\{\s*input:[^)]*\)\s*=>/.test(isrc),
    '서버가 응답에서 합별 input 을 떼고 보낸다',
    'roundLog 에 부대 전체가 실려 나간다');
}

section('PvP 는 끝까지 싸운다 (패주 끄기)');
{
  /* ★★ 제작자가 재생을 보고 짚었다: 「원거리가 아직 남아있는걸로 보이는데 왜 승리로 표시되지」.
   *   버그가 아니라 **패주**였다 (§26) — 3초 뒤 한쪽 전력이 20% 밑이고 상대가 3배 이상이면
   *   진 쪽이 살아서 물러난다. PvP 급 전력에선 **200판 중 195판(98%)** 이 그렇게 끝나고 있었다.
   *
   *   제작자 결정: **PvP 만 끝까지 싸운다.** 의뢰는 그대로다 —
   *   거기서 패주를 빼면 질 때마다 단원이 전멸한다 (§24·§25 가 고친 바로 그 문제다).
   *
   *   그래서 검사는 «PvP 는 껐고 · 의뢰는 켜져 있고 · 기본값은 안 건드렸나» 세 갈래다. */
  const EN3 = need('battle/engine.js');
  let TM3 = null;
  let SK3 = null;
  try {
    TM3 = await import(srcUrl('battle/tagmatch.js'));
    SK3 = await import(srcUrl('data/skills.js'));
  } catch (e) { ok(false, '태그매치를 읽는다', String(e.message)); }

  if (EN3 && TM3 && SK3) {
    /* 한쪽이 크게 세도록 만든다 — 패주가 반드시 걸리는 모양 */
    const mk = (n, side, hp, atk) => Array.from({ length: n }, (_, i) => ({
      uid: `${side}${i}`, name: `${side}${i}`, classId: 'swordsman', side,
      stats: { hp, atk, def: 20, res: 10, spd: 100, crit: 5, critDmg: 150, eva: 3 },
    }));
    const run = (rout, seed) => {
      const b = EN3.createBattle({
        allies: mk(6, 'ally', 4000, 400), enemies: mk(6, 'enemy', 900, 60),
        seed, getSkill: SK3.getSkill, record: false, rout,
      });
      let g = 0;
      while (!b.finished && g++ < 20000) b.step(1 / 60);
      const m = b.result.margin || {};
      return { winner: b.winner, routed: m.routed, loseLeft: b.winner === 'ally' ? m.enemyAlive : m.allyAlive };
    };

    const seeds = [1, 2, 3, 5, 8, 13, 21, 34];
    const onRout = seeds.map((s) => run(true, s));
    const offRout = seeds.map((s) => run(false, s));

    /* 기본값(안 넘기면)은 예전 그대로여야 한다 — 의뢰·나락·탑이 여기 달려 있다 */
    const dflt = seeds.map((s) => {
      const b = EN3.createBattle({
        allies: mk(6, 'ally', 4000, 400), enemies: mk(6, 'enemy', 900, 60),
        seed: s, getSkill: SK3.getSkill, record: false,
      });
      let g = 0;
      while (!b.finished && g++ < 20000) b.step(1 / 60);
      return { winner: b.winner, routed: (b.result.margin || {}).routed, loseLeft: (b.result.margin || {}).enemyAlive };
    });
    okAll(dflt.map((d, i) => (JSON.stringify(d) === JSON.stringify(onRout[i]) ? null
      : `seed ${seeds[i]}: 기본값이 rout:true 와 다르다`)).filter(Boolean),
      '옵션을 안 넘기면 예전(패주 켬) 그대로다', seeds.length);

    ok(onRout.some((r) => r.routed), '패주를 켜면 실제로 패주가 일어난다 (검사 조건이 맞다)',
      `${onRout.filter((r) => r.routed).length}/${seeds.length} 판만 패주`);

    okAll(offRout.filter((r) => r.routed).map((r, i) => `seed ${seeds[i]}: 껐는데도 패주했다`),
      'rout:false 면 패주가 안 일어난다', seeds.length);

    okAll(offRout.filter((r) => r.loseLeft > 0).map((r, i) => `seed ${seeds[i]}: 진 쪽이 ${r.loseLeft}명 남았다`),
      'rout:false 면 진 쪽이 전멸할 때까지 싸운다', seeds.length);

    /* 승자는 바뀌면 안 된다 — 패주는 «언제 멈추나» 지 «누가 이기나» 가 아니다 */
    okAll(offRout.map((r, i) => (r.winner === onRout[i].winner ? null
      : `seed ${seeds[i]}: 패주를 껐더니 승자가 바뀌었다 ${onRout[i].winner} → ${r.winner}`)).filter(Boolean),
      '패주를 꺼도 승자는 그대로다', seeds.length);

    /* ── 태그매치가 실제로 끄고 있는가 (글자가 아니라 굴려서) ── */
    const out = TM3.tagMatch({
      attacker: [mk(6, 'ally', 4000, 400), mk(6, 'ally', 3000, 300)],
      defender: [mk(6, 'enemy', 900, 60), mk(6, 'enemy', 900, 60)],
      seed: 4242, getSkill: SK3.getSkill,
    });
    const alive = out.rounds.filter((r) => r.attackerLeft > 0 && r.defenderLeft > 0);
    okAll(alive.map((r, i) => `${i}번째 합이 양쪽 다 살아 있는 채로 끝났다 (${r.attackerLeft}:${r.defenderLeft})`),
      'PvP 는 합마다 한쪽이 전멸할 때까지 싸운다', out.rounds.length || 1);
  }

  /* ── 의뢰는 그대로여야 한다 ── */
  const bsrc2 = readFileSync(srcDir('ui/battle.js'), 'utf8');
  /* ★ 처음엔 `rout : false` 꼴만 봐서 **`cfg.rout = false` 를 놓쳤다.**
   *   메타 검사로 그걸 심었는데 안 물어서 알았다 — 이제 둘 다 본다.
   *   (`\b` 를 쓰면 셸 heredoc 이 백슬래시를 먹어 백스페이스 문자가 박힌다. 문자 부류로 쓴다.) */
  const ROUT_OFF = /(^|[^A-Za-z0-9_$])rout\s*[:=]\s*false/m;
  ok(!ROUT_OFF.test(decomment(bsrc2)),
    '의뢰 전투는 패주를 그대로 둔다 (빼면 질 때마다 단원이 전멸한다 — §24·§25)',
    'ui/battle.js 가 패주를 끈다');

  const tsrc2 = readFileSync(srcDir('battle/tagmatch.js'), 'utf8');
  ok(ROUT_OFF.test(tsrc2), '태그매치가 패주를 끈다');

  /* ── 엔진 지문이 움직였을 때 방어자가 «못 맞는 사람» 이 되지 않는가 ── */
  const psrc3 = readFileSync(srcDir('ui/pvp.js'), 'utf8');
  ok(/function engineMoved\(\)/.test(psrc3) && /if \(engineMoved\(\)\)/.test(psrc3),
    '엔진 지문이 바뀌면 PvP 화면이 조용히 다시 등록한다',
    '방어자가 재등록할 때까지 아무도 그를 못 때리는 상태로 남는다');
  ok(/const stamp = \(fp\) => `\$\{ENGINE_HASH\}:\$\{fp\}`/.test(psrc3),
    '등록 지문에 엔진 지문을 같이 엮는다');
}

section('진 쪽 펫도 같이 쓰러진다');
{
  /* ★★ 제작자가 「적이 서 있는데 왜 승리」 를 두 번 짚었다. 첫 번째는 패주였고(§82),
   *   패주를 끄고 나서도 **한 갈래가 남아 있었다** — 펫이다.
   *
   *   승패는 `aliveFighters` 로 정하는데 그건 **펫을 안 센다** (수호 펫은 피해가 0이라
   *   펫까지 잡게 하면 «목적 없는 마무리 사냥» 이 된다). 그래서 단원이 전멸해도
   *   펫은 서 있는 채로 끝났다 — 실측 **펫을 넣은 60판 중 60판**이 그랬다.
   *
   *   승패 판정은 이미 끝난 뒤에 정리하는 것이라 **결과는 한 판도 안 바뀐다.**
   *   그것까지 검사한다 — 안 그러면 화면 고치려다 밸런스를 흔든 게 된다. */
  const EN4 = need('battle/engine.js');
  let SK4 = null;
  try { SK4 = await import(srcUrl('data/skills.js')); } catch (e) { ok(false, '스킬 모듈을 읽는다', String(e.message)); }

  if (EN4 && SK4) {
    const merc = (i, side, hp, atk) => ({
      uid: `${side}m${i}`, name: `${side}m${i}`, classId: 'swordsman', side,
      stats: { hp, atk, def: 20, res: 10, spd: 100, crit: 5, critDmg: 150, eva: 3 },
    });
    const pet = (i, side) => ({
      uid: `${side}p${i}`, name: `펫${i}`, side, pet: true, petRole: 'guard',
      stats: { hp: 30000, atk: 1, def: 300, res: 300, spd: 80, crit: 0, critDmg: 100, eva: 0 },
    });
    const squad = (side, hp, atk, nPets) => [
      ...Array.from({ length: 5 }, (_, i) => merc(i, side, hp, atk)),
      ...Array.from({ length: nPets }, (_, i) => pet(i, side)),
    ];
    const play = (nPets, seed) => {
      const b = EN4.createBattle({
        allies: squad('ally', 5000, 500, nPets), enemies: squad('enemy', 800, 40, nPets),
        seed, getSkill: SK4.getSkill, record: false, rout: false,
      });
      let g = 0;
      while (!b.finished && g++ < 20000) b.step(1 / 60);
      const loser = b.winner === 'ally' ? 'enemy' : 'ally';
      return {
        winner: b.winner,
        time: Math.round(b.time * 100) / 100,
        loserLeft: b.units.filter((u) => u.alive && u.side === loser).length,
        winnerPets: b.units.filter((u) => u.alive && u.pet && u.side === b.winner).length,
      };
    };

    const seeds = [1, 2, 3, 5, 8, 13, 21, 34];

    /* ① 진 쪽에 아무것도 안 남는다 — 펫이 있어도 */
    const withPets = seeds.map((s) => play(3, s));
    okAll(withPets.filter((r) => r.loserLeft > 0).map((r, i) => `seed ${seeds[i]}: 진 쪽에 ${r.loserLeft}개 남았다`),
      '단원이 전멸하면 그 쪽 펫도 같이 쓰러진다', seeds.length);

    /* ② 이긴 쪽 펫은 살아 있어야 한다 — 다음 합으로 같이 가야 하니까 */
    okAll(withPets.filter((r) => r.winnerPets !== 3).map((r, i) => `seed ${seeds[i]}: 이긴 쪽 펫이 ${r.winnerPets}마리만 남았다`),
      '이긴 쪽 펫은 그대로 살아 있다 (다음 합으로 간다)', seeds.length);

    /* ③ ★ 결과가 안 바뀐다 — 펫이 없는 판은 이 변경 전후로 완전히 같아야 한다.
     *   승자·시각이 흔들리면 화면 고치려다 밸런스를 건드린 것이다. */
    const noPets = seeds.map((s) => play(0, s));
    okAll(noPets.filter((r) => !r.winner || r.loserLeft > 0).map((r, i) => `seed ${seeds[i]}: 펫 없는 판이 이상하다`),
      '펫이 없으면 예전과 똑같이 전멸로 끝난다', seeds.length);

    /* ④ 승패 자체는 펫 유무와 무관해야 한다 (펫은 머릿수에 안 들어간다) */
    okAll(seeds.map((s, i) => (withPets[i].winner === noPets[i].winner ? null
      : `seed ${s}: 펫을 넣었더니 승자가 바뀌었다 ${noPets[i].winner} → ${withPets[i].winner}`)).filter(Boolean),
      '펫이 승패를 바꾸지 않는다', seeds.length);

    /* ⑤ ★ 패주로 «물러난» 경우에는 단원이 살아 나간다 — 그 쪽 펫도 같이 살아 나가야 한다.
     *   처음엔 «진 쪽 펫» 을 전부 죽였는데, 그러면 의뢰에서 패주할 때마다(의뢰는 그게 보통의 끝이다)
     *   단원은 멀쩡한데 펫만 죽는 그림이 된다. 조건을 «전투원이 하나도 안 남은 진영» 으로 좁혔다. */
    const routKeep = (seed) => {
      const b = EN4.createBattle({
        allies: squad('ally', 5000, 500, 3), enemies: squad('enemy', 900, 60, 3),
        seed, getSkill: SK4.getSkill, record: false, rout: true,
      });
      let g = 0;
      while (!b.finished && g++ < 20000) b.step(1 / 60);
      const loser = b.winner === 'ally' ? 'enemy' : 'ally';
      const fighters = b.units.filter((u) => u.alive && !u.pet && u.side === loser).length;
      const pets = b.units.filter((u) => u.alive && u.pet && u.side === loser).length;
      return { routed: (b.result.margin || {}).routed, fighters, pets };
    };
    const routed = seeds.map(routKeep).filter((r) => r.routed && r.fighters > 0);
    if (!routed.length) {
      ok(true, '패주로 단원이 살아 나간 판이 없어 건너뜀 (조건이 안 만들어졌다)');
    } else {
      okAll(routed.filter((r) => r.pets === 0)
        .map((r) => `단원 ${r.fighters}명이 살아 나갔는데 펫은 ${r.pets}마리다 — 펫만 죽었다`),
        '패주로 물러날 때는 펫도 같이 살아 나간다', routed.length);
    }
  }

  /* 처치 공으로 안 치는가 — 치면 MVP 가 «펫 정리» 로 뽑힌다 */
  const esrc2 = readFileSync(srcDir('battle/engine.js'), 'utf8');
  ok(/kill\(u, null\)/.test(esrc2), '정리로 쓰러뜨린 펫은 처치 공으로 안 친다 (MVP 가 안 흔들린다)',
    'srcUid 를 넘기고 있다 — 마지막에 펫을 정리한 사람이 MVP 가 된다');
}

section('명부를 계열로도 거른다');
{
  /* 제작자 요청: 「계열로도 검색할수있게 해줘 방패병이면 방패병 계열 다 검색되는식으로」.
   *   4차까지 가면 이름이 전부 달라져서(개천검제·멸망의 군신…) 「이 사람 원래 뭐였지」 로는
   *   못 찾는다. 계열의 뿌리는 `classChain` 의 첫 칸(1차)이다. */
  const CC = need('data/classes.js');
  if (!CC) { ok(false, '클래스 모듈을 못 읽었다'); } else {
    const all = Object.values(CC.CLASSES || {});
    ok(all.length > 50, '클래스를 실제로 읽어 냈다', `${all.length}종`);

    /* ① 모든 클래스가 뿌리를 갖는다 — 하나라도 없으면 그 사람은 어떤 계열에도 안 잡힌다 */
    const orphan = all.filter((c) => {
      const ch = CC.classChain(c.id);
      return !ch.length || !ch[0];
    });
    okAll(orphan.map((c) => `${c.id} 가 계열 뿌리를 못 찾는다`), '모든 클래스가 계열 뿌리를 갖는다', all.length);

    /* ② 뿌리는 1차여야 한다 — 2차가 뿌리로 잡히면 계열이 쪼개진다 */
    const badRoot = all.filter((c) => {
      const ch = CC.classChain(c.id);
      return ch.length && ch[0] && (ch[0].tier || 1) !== 1;
    });
    okAll(badRoot.map((c) => `${c.id} 의 뿌리 ${CC.classChain(c.id)[0].id} 가 1차가 아니다`),
      '계열 뿌리는 언제나 1차다', all.length);

    /* ③ 계열이 실제로 여러 차수를 아우르는가 — 전부 1개짜리면 계열 검색이 무의미하다 */
    const byRoot = new Map();
    for (const c of all) {
      const r = CC.classChain(c.id)[0];
      if (!r) continue;
      if (!byRoot.has(r.id)) byRoot.set(r.id, []);
      byRoot.get(r.id).push(c);
    }
    const biggest = [...byRoot.values()].reduce((a, b) => (b.length > a.length ? b : a), []);
    ok(byRoot.size >= 5 && biggest.length >= 8,
      '계열이 여러 차수를 아우른다 (계열 검색이 뜻을 갖는다)',
      `계열 ${byRoot.size}개 · 가장 큰 계열 ${biggest.length}종`);

    /* ④ 자기 자신도 자기 계열에 들어간다 (1차를 고르면 1차도 나와야 한다) */
    const selfMiss = [...byRoot.entries()].filter(([rid, list]) => !list.some((c) => c.id === rid));
    okAll(selfMiss.map(([rid]) => `${rid} 계열에 ${rid} 자신이 없다`), '뿌리 자신도 제 계열에 들어간다', byRoot.size);
  }

  /* ⑤ 화면이 계열 선택을 실제로 다르게 다루는가 */
  const csrc3 = decomment(readFileSync(srcDir('ui/company.js'), 'utf8'));
  const faults3 = [];
  if (!/const LINE_PREFIX = 'line:'/.test(csrc3)) faults3.push('계열 표시(LINE_PREFIX)가 없다');
  if (!/rosterFilter\.classId\.startsWith\(LINE_PREFIX\)/.test(csrc3)) faults3.push('거르는 곳에서 계열을 안 본다');
  /* ★ 단순히 `classChain(m.classId)` 만 보면 **다른 곳의 호출**을 보고 통과한다
   *   (단원 상세 카드에도 같은 호출이 있다). 메타 검사가 그걸 드러냈다.
   *   계열 판정에만 있는 «뿌리를 고른 값과 비교» 를 본다. */
  if (!/chain\[0\]\.id !== want/.test(csrc3)) faults3.push('계열 판정이 뿌리를 고른 값과 비교하지 않는다');
  if (!/group: '계열'/.test(csrc3)) faults3.push('드롭다운에 계열 묶음이 없다');
  okAll(faults3, '명부 필터가 계열을 따로 다룬다', 4);

  /* ★ 계열 표시가 클래스 id 와 안 겹쳐야 한다 — 겹치면 계열과 낱개가 섞인다 */
  if (CC) {
    const clash = Object.keys(CC.CLASSES || {}).filter((id) => id.startsWith('line:'));
    okAll(clash.map((id) => `클래스 id '${id}' 가 계열 표시와 겹친다`), '계열 표시가 클래스 id 와 안 겹친다', 1);
  }
}

section('펫은 표적이 안 된다 · 개전이 몰리지 않는다');
{
  /* 제작자 결정 두 가지:
   *   「펫은 그냥 버퍼로만 활용하고 안맞도록 하자」
   *   「뒷라인을 0.3초만에 녹이는건 문제가 있는것같아」 → 개전 게이지를 넓게 흔든다
   *
   * ★ 펫은 **역할을 유지**한다 (공격·수호·치유·버퍼). 표적만 안 될 뿐이다.
   *   실측: 공격 펫의 피해 비중이 전체의 0.3% 라 «공짜 딜러» 문제는 없다. */
  const EN5 = need('battle/engine.js');
  let SK5 = null;
  try { SK5 = await import(srcUrl('data/skills.js')); } catch (e) { ok(false, '스킬 모듈을 읽는다', String(e.message)); }

  if (EN5 && SK5) {
    const merc = (i, side) => ({
      uid: `${side}m${i}`, name: `${side}m${i}`, classId: 'archer', side,
      stats: { hp: 4000, atk: 400, def: 20, res: 10, spd: 120, crit: 5, critDmg: 150, eva: 0 },
    });
    /* 펫을 **아주 물렁하게** 만든다 — 표적이 된다면 반드시 먼저 죽을 몸이다 */
    const pet = (i, side) => ({
      uid: `${side}p${i}`, name: `펫${i}`, side, pet: true, petRole: 'attacker',
      stats: { hp: 60, atk: 10, def: 0, res: 0, spd: 100, crit: 0, critDmg: 100, eva: 0 },
    });
    const squad = (side, n, nPets) => [
      ...Array.from({ length: n }, (_, i) => merc(i, side)),
      ...Array.from({ length: nPets }, (_, i) => pet(i, side)),
    ];

    const seeds = [1, 2, 3, 5, 8, 13];
    const bad = [];
    let petHits = 0;
    for (const s of seeds) {
      const b = EN5.createBattle({
        allies: squad('ally', 4, 2), enemies: squad('enemy', 4, 2),
        seed: s, getSkill: SK5.getSkill, record: true, rout: false,
      });
      const byUid = new Map(b.units.map((u) => [u.uid, u]));
      let g = 0;
      let firstEnd = -1;
      while (!b.finished && g++ < 20000) {
        b.step(1 / 60);
        for (const e of b.drainEvents()) {
          if (e.type === 'damage' && e.amount > 0) {
            const t = byUid.get(e.targetUid);
            if (t && t.pet) petHits++;
          }
        }
        /* 전투가 끝나기 **전에** 펫이 죽었는지 본다 (끝난 뒤 정리는 정상이다) */
        if (firstEnd < 0 && b.finished) firstEnd = b.time;
      }
      /* 물렁한 펫이 한 대라도 맞았으면 표적이 된 것이다 */
    }
    ok(petHits === 0, '펫은 적에게 한 대도 안 맞는다',
      `펫이 ${petHits}대 맞았다 — 표적 풀에서 안 빠졌다`);

    /* 펫이 여전히 «일은 한다» — 역할을 지웠는지 확인 */
    const b2 = EN5.createBattle({
      allies: squad('ally', 4, 2), enemies: squad('enemy', 4, 0),
      seed: 99, getSkill: SK5.getSkill, record: false, rout: false,
    });
    let g2 = 0;
    while (!b2.finished && g2++ < 20000) b2.step(1 / 60);
    const petDmg = Object.entries(b2.result.damageDealt || {})
      .filter(([k]) => k.includes('p')).reduce((a, [, v]) => a + v, 0);
    ok(petDmg > 0, '펫은 여전히 제 역할을 한다 (표적만 안 될 뿐 싸운다)',
      '펫 피해가 0 이다 — 역할까지 지워졌다');

    /* 승패는 여전히 펫을 안 센다 */
    okAll(bad, '펫이 승패 판정에 안 들어간다', 1);
  }

  /* 개전 게이지가 넓은가 — 좁으면 전원이 같은 순간에 첫 타를 낸다 */
  const esrc3 = decomment(readFileSync(srcDir('battle/engine.js'), 'utf8'));
  /* ★★ 근접도 거리만큼 시간을 쓰는가.
   *   예전엔 거리와 무관하게 0.25초였다 — 뒤로 파고드는 암살자가 전열과 **같은 시간에**
   *   후열을 때렸다 (화면엔 걸어가는데 엔진은 순간이동). 실측으로
   *   0.4초 안 사망이 32%(앞 51 / 뒤 38) → **0%**(0 / 0) 가 됐다. */
  {
    /* ★ `skill.range === 'melee'` 는 여러 군데 나온다 (resolveHit 에도 있다).
     *   돌진을 미는 자리는 `lunge` 이벤트가 유일하게 가리킨다. */
    const mAt = esrc3.indexOf("type: 'lunge'");
    const meleeBlock = mAt < 0 ? '' : esrc3.slice(mAt, mAt + 500);
    const faults4 = [];
    if (!/Math\.hypot/.test(meleeBlock)) faults4.push('근접 타격 시각이 거리를 안 본다');
    if (!/CHARGE_SPEED/.test(meleeBlock)) faults4.push('돌진 속도를 안 쓴다');
    if (!/Math\.max\(MELEE_DELAY/.test(meleeBlock)) faults4.push('붙어 있을 때의 최소값(MELEE_DELAY)을 안 지킨다 — 정면 싸움이 빨라진다');
    okAll(faults4, '근접도 거리만큼 시간을 쓴다', 3);
  }

  /* 굴려서 확인 — 먼 목표를 때리는 데 더 오래 걸리는가 */
  if (EN5 && SK5) {
    const one = (dy) => {
      const a = { uid: 'a', name: 'a', classId: 'swordsman', side: 'ally',
        stats: { hp: 9999, atk: 300, def: 0, res: 0, spd: 60, crit: 0, critDmg: 100, eva: 0 } };
      const b2 = { uid: 'b', name: 'b', classId: 'swordsman', side: 'enemy',
        stats: { hp: 9999, atk: 1, def: 0, res: 0, spd: 1, crit: 0, critDmg: 100, eva: 0 } };
      const bt = EN5.createBattle({ allies: [a], enemies: [b2], seed: 7, getSkill: SK5.getSkill, record: true, rout: false });
      const tgt = bt.units.find((u) => u.uid === 'b');
      tgt.x += dy;                       // 멀리 밀어 둔다
      let g = 0; let firstHit = -1;
      while (!bt.finished && g++ < 3000 && firstHit < 0) {
        bt.step(1 / 60);
        for (const e of bt.drainEvents()) if (e.type === 'damage' && firstHit < 0) firstHit = bt.time;
      }
      return firstHit;
    };
    const near = one(0);
    const far = one(60);
    ok(near > 0 && far > near + 0.15, '먼 목표는 더 오래 걸린다 (굴려서 확인)',
      `가까운 목표 ${near.toFixed(2)}초 · 먼 목표 ${far.toFixed(2)}초 — 차이가 없다`);
  }

  const gm = esrc3.match(/u\.gauge = rng\.float\(0,\s*([A-Za-z_0-9]+)\)/);
  ok(!!gm && gm[1] === 'GAUGE_MAX', '개전 게이지를 한 사이클 전체로 흔든다',
    gm ? `rng.float(0, ${gm[1]}) — 좁으면 전원이 같은 순간에 친다` : '개전 게이지 배분을 못 찾았다');

  /* 적 표적 풀이 전부 펫을 뺐는가 — 한 군데라도 남으면 거기로 새어 나간다 */
  /* ★ `side !== ...side` 를 그냥 세면 **목록이 아닌 비교**까지 센다
   *   (검사 계열 반격의 `back.side !== tgt.side` 가 거기 걸려 오탐을 냈다).
   *   «같은 줄에 filter 가 있는» 것만 = 진짜 표적 목록이다. */
  const poolLines = esrc3.split(String.fromCharCode(10)).filter((l) => /\.filter\(/.test(l) && /side !== [a-z.]+\.side/.test(l));
  const foePools = poolLines.length;
  const petFree = poolLines.filter((l) => /!\w+\.pet/.test(l)).length;
  ok(foePools > 0 && petFree >= foePools, '엔진의 모든 적 목록이 펫을 뺀다',
    `적 목록 ${foePools}군데 중 펫을 뺀 곳 ${petFree}군데`);

  const asrc3 = decomment(readFileSync(srcDir('battle/ai.js'), 'utf8'));
  /* ★ «foesOf 가 어딘가 나오나» 만 보면 폴백 가지가 남아 있어도 통과한다 —
   *   메타 검사에서 그 가지에 버그를 심었는데 안 물어서 알았다. 한 갈래인지를 본다. */
  ok(/const foes = battle\.foesOf\(unit\);/.test(asrc3),
    'AI 는 엔진이 주는 적 목록 하나만 쓴다 (갈래가 하나여야 규칙이 안 갈라진다)');
}

section('계열 특성 — 7계열이 저마다 즉사를 막는다');
{
  /* 제작자 배분: 방패병 수호 · 검사 반격 · 창병 요격 · 궁수 견제 ·
   *   도적 은신 · 마법사 방벽 · 수도사(사제 축복 / 수도승 금강).
   *   「방패병 역할이 커지는데 다른 계열들도 특화가 있으면 좋겠다」 에서 나왔다. */
  let LG = null;
  let CL5 = null;
  try {
    LG = await import(srcUrl('data/lineage.js'));
    CL5 = await import(srcUrl('data/classes.js'));
    await import(srcUrl('data/classes_t4.js'));
  } catch (e) { ok(false, '계열 특성 모듈을 읽는다', String(e.message)); }

  if (LG && CL5) {
    /* ① 7계열 전부에 특성이 있는가 — 하나라도 비면 그 계열은 «즉사를 막을 자기 방식» 이 없다 */
    const roots = Object.values(CL5.CLASSES).filter((c) => (c.tier || 1) === 1);
    okAll(roots.filter((r) => !LG.traitOfChain([r])).map((r) => `${r.name}(${r.id}) 계열에 특성이 없다`),
      '7계열 전부가 자기 특성을 갖는다', roots.length);

    /* ② 모든 클래스가 특성을 받는가 (105종) */
    const all = Object.values(CL5.CLASSES);
    const miss = all.filter((c) => !LG.traitOfChain(CL5.classChain(c.id)));
    okAll(miss.slice(0, 5).map((c) => `${c.id} 가 특성을 못 받는다`), '모든 클래스가 특성을 받는다', all.length);

    /* ③ 차수가 오를수록 세지는가 — 1차가 4차보다 세면 승급이 손해다 */
    const backfire = [];
    for (const r of roots) {
      const line = all.filter((c) => { const ch = CL5.classChain(c.id); return ch.length && ch[0].id === r.id; });
      const t1 = LG.traitOfChain(CL5.classChain(r.id)) || {};
      for (const c of line.filter((x) => x.tier === 4)) {
        const t4 = LG.traitOfChain(CL5.classChain(c.id)) || {};
        for (const k of Object.keys(t1)) {
          if (k === 'traitLabel') continue;
          /* 갈래가 갈리면 다른 특성이 된다 — 같은 열쇠일 때만 견준다 */
          if (t4[k] == null) continue;
          if (t4[k] < t1[k]) backfire.push(`${c.id} 의 ${k} 가 1차보다 작다 (${t4[k]} < ${t1[k]})`);
        }
      }
    }
    okAll(backfire.slice(0, 5), '차수가 오르면 특성도 세진다', roots.length);

    /* ④ 수도사만 갈래가 갈리는가 — 사제/수도승이 서로 다른 특성이어야 배분이 성립한다 */
    const priest = LG.traitOfChain(CL5.classChain('priest')) || {};
    const monk = LG.traitOfChain(CL5.classChain('monk')) || {};
    ok(priest.traitLabel && monk.traitLabel && priest.traitLabel !== monk.traitLabel,
      '수도사 계열이 사제 / 수도승으로 갈린다',
      `사제 [${priest.traitLabel}] · 수도승 [${monk.traitLabel}] — 같으면 배분이 무너진다`);
    ok((priest.deathWard || 0) > 0 && (monk.dmgCutAura || 0) > 0,
      '사제는 즉사 방지 · 수도승은 피해 감소 (제작자 배분)');

    /* ⑤ ★ 상한 상수가 엔진과 같은가 — 엔진은 data/ 를 못 물어서 숫자를 옮겨 적었다.
     *   어긋나면 «표에는 0.25 인데 실제로는 0.6» 같은 조용한 어긋남이 생긴다. */
    const esrc5 = decomment(readFileSync(srcDir('battle/engine.js'), 'utf8'));
    const pick = (name) => {
      const m = esrc5.match(new RegExp(`const ${name} = ([0-9.]+)`));
      return m ? Number(m[1]) : null;
    };
    const pairs = [['AURA_CAP', LG.AURA_CAP], ['SLOW_CAP', LG.SLOW_CAP]];
    okAll(pairs.filter(([n, v]) => pick(n) !== v)
      .map(([n, v]) => `${n} 이 엔진 ${pick(n)} vs 표 ${v} 로 어긋났다`),
      '상한 상수가 엔진과 표에서 같다', pairs.length);
  }

  /* ⑥ 특성이 실제 편성 경로에 실리는가 — 여기가 끊기면 표만 있고 전투엔 안 나온다 */
  const qsrc = decomment(readFileSync(srcDir('game/quest.js'), 'utf8'));
  ok(/traitOfChain\(classChain\(m\.classId\)\)/.test(qsrc),
    '아군 편성(allyUnitDefs)이 계열 특성을 실어 보낸다',
    'quest.js 가 특성을 안 붙인다 — 표만 있고 전투엔 안 나온다');

  /* ⑦ 엔진이 그 숫자를 실제로 읽는가 */
  const esrc6 = decomment(readFileSync(srcDir('battle/engine.js'), 'utf8'));
  /* ★★ «어딘가 이름이 나오나» 만 보면 **UnitDef 에서 꺼내는 줄을 지워도 통과한다**
   *   (쓰는 쪽에 이름이 남아 있으니까). 메타 검사에서 실제로 안 물었다.
   *   «`def.` 에서 꺼내는가» 를 본다 — 이름이 다른 것만 따로 적는다. */
  const FROM_DEF = {
    guardChance: 'guardChance', taunt: 'taunt', riposte: 'riposte',
    intercept: 'intercept', interceptCounter: 'interceptCounter', chargeSlow: 'chargeSlow',
    shy: 'shy', dmgCutAura: 'dmgCutAura', wardShield: 'wardShield', wardRegen: 'wardRegen',
    wardLeft: 'deathWard', wardParty: 'deathWardParty',
  };
  okAll(Object.entries(FROM_DEF)
    .filter(([, src]) => !esrc6.includes(`def.${src}`))
    .map(([k, src]) => `엔진이 UnitDef 에서 '${src}' 를 안 꺼낸다 (유닛 필드 ${k})`),
    '엔진이 특성 숫자를 UnitDef 에서 전부 꺼낸다', Object.keys(FROM_DEF).length);

  /* 도발·은신은 표적 선택이라 ai.js 몫이다 */
  const asrc6 = decomment(readFileSync(srcDir('battle/ai.js'), 'utf8'));
  ok(/u\.taunt > 0/.test(asrc6) && /u\.shy > 0/.test(asrc6),
    'AI 의 근접 표적 선택이 도발과 은신을 본다');
}

section('계열 특성 설계 손질 — 네 기전이 실제로 도는가');
{
  /* §87.3 에서 「값을 올려도 안 움직인다」던 넷을 설계로 고쳤다.
   *   · 요격 : «파고들 때만» → «내 앞에 창병이 있으면» (원거리도 막는다, 도발과 안 겹친다)
   *   · 방벽 : 일회용 → **재생**
   *   · 축복 : 체력 1로 살린 뒤 **잠깐 보호**를 같이 준다
   *   · 반격 : 근접 피격 한정 → **모든 피격** (지속피해 제외)
   *
   * ★ 전부 **굴려서** 본다. 글자로만 보면 「값은 있는데 안 도는」 상태를 못 잡는다 —
   *   그게 §87.3 에서 나를 오래 붙잡은 것이다. */
  const EN7 = need('battle/engine.js');
  let SK7 = null;
  try { SK7 = await import(srcUrl('data/skills.js')); } catch (e) { ok(false, '스킬 모듈을 읽는다', String(e.message)); }

  if (EN7 && SK7) {
    const G = SK7.getSkill;
    /** 앞(적 쪽)에 설 유닛 / 뒤에 설 유닛 — slot.x 가 클수록 앞이다 (ally 기준) */
    const at = (x) => ({ x, y: 0.5 });
    const unit = (uid2, side, slotX, extra) => ({
      uid: uid2, name: uid2, classId: 'swordsman', side, slot: at(slotX),
      stats: { hp: 20000, atk: 500, def: 30, res: 30, spd: 110, crit: 0, critDmg: 100, eva: 0 },
      ...extra,
    });
    const play = (allies, enemies, seed, secs) => {
      const b = EN7.createBattle({ allies, enemies, seed, getSkill: G, record: true, rout: false });
      const seen = [];
      let g = 0;
      while (!b.finished && g++ < 20000 && (!secs || b.time < secs)) {
        b.step(1 / 60);
        for (const e of b.drainEvents()) seen.push(e);
      }
      return { b, seen, of: (id) => b.units.find((u) => u.uid === id) };
    };

    /* ★ 세 시험이 같이 쓰는 «뒷줄을 노리는 원거리».
     *   기본공격은 select 가 'front' 라 뒷줄이 안 맞는다 — 그러면
     *   요격·반격·이중전달 조건이 아예 안 만들어져 검사가 헛돌았다. */
    /* ★ power 를 크게 준다 — 요격은 이젠 **위험한 한 방**에만 나서기 때문이다
     *   (잔툃기를 다 대신 맞으면 앞줄이 먼저 무너져 기여도가 마이너스가 됐다). */
    const SNIPE = { id: 'snipe', range: 'ranged', target: 'enemy', select: 'back',
      count: 1, power: 12, dmgType: 'phys', fx: 'arrow', cd: 0, effects: [] };
    const faults = [];

    /* ① 요격이 **원거리**도 막는가 — 예전엔 근접이 파고들 때만이었다 */
    {
      /* ★ 적은 원거리로 **뒷줄을** 노린다.
       *   처음엕 기본공격만 원거리로 바꿨는데, 기본공격은 select 가 'front' 라
       *   창병 자신을 켤다 — 그러면 «내 앞에 창병» 이 없어 요격이 안 도는 게 맞다.
       *   검사가 아니라 시험 설계가 틀렸던 것이다. */
      const foe = { ...unit('f', 'enemy', 0, {}), skills: [SNIPE] };
      /* ★ slot.x 는 **작을수록 앞**이다 (basic 진형이 0.14 / 0.46 / 0.8).
       *   처음엕 거꾸로 적어서 «창병이 뒤» 이 돼 요격이 안 도는 게 맞았다. */
      const spear = unit('spear', 'ally', 0, { intercept: 1 });       // 앞 (확률 1 로 확실히)
      const back = unit('back', 'ally', 1, {});                       // 뒤
      const r = play([spear, back], [foe], 3, 6);
      const guarded = r.seen.filter((e) => e.type === 'guard' && e.uid === 'spear').length;
      if (!guarded) faults.push('요격이 원거리를 안 막는다 — 설계 손질이 안 먹었다');
      /* ★★ 이젠 **대신 맞는 게 아니라 지우는** 것이다.
       *   대신 맞으면 창병이 닳아 결국 손해라는 걸 네 번 재고 알았다 (§90).
       *   가로채는 순간 **아무도 피해를 안 받아야** 한다. */
      const spearHurt = r.seen.some((e) => e.type === 'damage' && e.targetUid === 'spear');
      if (spearHurt) faults.push('요격하면서 창병이 대신 맞았다 — 쳐내는 게 아니다');
    }

    /* ② 방벽이 재생하는가 — 깎아 놓고 시간이 지나면 차올라야 한다 */
    {
      const mage = unit('mage', 'ally', 0, { wardShield: 0.5, wardRegen: 0.5 });
      const foe = unit('f2', 'enemy', 1, {});
      const r = play([mage], [foe], 5, 0.1);
      const u = r.of('mage');
      const full = u.shield;
      u.shield = 1;                                  // 손으로 깎는다
      let g = 0;
      while (g++ < 120) r.b.step(1 / 60);            // 2초 돌린다
      if (!(u.shield > full * 0.5)) faults.push(`방벽이 안 차오른다 (${Math.round(u.shield)} / ${Math.round(full)})`);
    }

    /* ③ 축복이 살린 뒤 **잠깐 보호**가 붙는가 */
    {
      const src = decomment(readFileSync(srcDir('battle/engine.js'), 'utf8'));
      if (!/tgt\.graceT = GRACE_S;/.test(src)) faults.push('축복이 살린 뒤 보호를 안 준다');
      if (!/graceT > 0\) amount \*= \(1 - GRACE_CUT\)/.test(src)) faults.push('보호가 피해 계산에 안 들어간다');
      if (!/graceT = Math\.max\(0, u\.graceT - dt\)/.test(src)) faults.push('보호가 시간이 지나도 안 풀린다');
    }

    /* ④ 반격이 **원거리 피격**에도 도는가 — 예전엔 근접 한정이었다 */
    {
      const foe = { ...unit('f3', 'enemy', 0, {}), skills: [SNIPE] };
      /* ★ 검사를 **못 움직이게** 한다 (spd 1). 안 그러면 검사 자신의 공격까지
       *   «sw 가 준 피해» 로 세어져, 반격을 꺼도 검사가 통과했다. */
      const sword = { ...unit('sw', 'ally', 1, { riposte: 1 }),
        stats: { hp: 200000, atk: 500, def: 30, res: 30, spd: 1, crit: 0, critDmg: 100, eva: 0 } };
      const r = play([sword], [foe], 7, 4);
      const backHits = r.seen.filter((e) => e.type === 'damage' && e.uid === 'sw').length;
      if (!backHits) faults.push('반격이 원거리 피격에 안 돈다 — 설계 손질이 안 먹었다');
    }

    /* ⑤ 요격과 수호가 **배타적**인가 — 한 피해가 두 번 넘어가면 안 된다 */
    {
      /* ★ 아군을 전부 못 움직이게 해서 **들어온 피해만** 남긴다.
       *   아군이 때리면 damage 수가 불어나 guards > dmg 가 영영 안 된다. */
      const slow = { hp: 200000, atk: 1, def: 30, res: 30, spd: 1, crit: 0, critDmg: 100, eva: 0 };
      const spear = { ...unit('sp2', 'ally', 0, { intercept: 1 }), stats: slow };
      const shield = { ...unit('sh2', 'ally', 0, { guardChance: 1, guardCut: 0.5 }), stats: slow };
      const back = { ...unit('b2', 'ally', 1, {}), stats: slow };
      const foe = { ...unit('f4', 'enemy', 0, {}), skills: [SNIPE] };
      const r = play([spear, shield, back], [foe], 11, 3);
      /* 한 damage 이벤트당 guard 이벤트가 둘 이상 붙으면 이중 전달이다 */
      let dmg = 0; let guards = 0;
      for (const e of r.seen) { if (e.type === 'damage') dmg++; if (e.type === 'guard') guards++; }
      if (dmg > 0 && guards > dmg) faults.push(`피해 ${dmg}회에 대신맞기 ${guards}회 — 한 피해가 두 번 넘어간다`);
    }

    okAll(faults, '네 기전이 굴려서 확인된다 (요격·방벽·축복·반격) + 이중 전달 없음', 5);
  }

  /* 값이 표에 실제로 들어 있는가 — 설계만 고치고 값을 0 으로 두면 아무 일도 안 난다 */
  const lsrc = decomment(readFileSync(srcDir('data/lineage.js'), 'utf8'));
  const need2 = ['wardRegen', 'intercept', 'riposte', 'deathWard'];
  okAll(need2.filter((k) => !new RegExp(`${k}:\\s*[0-9.]+`).test(lsrc)).map((k) => `표에 ${k} 값이 없다`),
    '표에 네 특성 값이 들어 있다', need2.length);
}

section('엔진을 고쳐도 상대를 때릴 수 있는가');
{
  /* ★★ 제작자가 겪은 것: 「지금 pvp 안된다 · 내 부대 등록 다시 눌렀는데 똑같이 뜨네」.
   *
   *   서버가 **상대의** `engine_hash` 까지 보고 거절하고 있었다. 그래서 엔진을 고칠 때마다
   *   **접속 안 한 사람은 아무도 못 때리는 상태**로 순위표에 남았다 —
   *   공격자가 자기를 아무리 다시 등록해도 소용이 없고, 내가 대신 해 줄 수도 없다.
   *   오늘만 엔진 지문을 아홉 번 올렸으니 PvP 가 통째로 멈춰 있었다.
   *
   * ★ 상대 지문을 안 봐도 안전하다 — 저장된 `units` 는 그냥 스탯 덩어리고
   *   승패는 **지금 엔진으로 그 자리에서** 계산한다. 재생도 같은 cfg 로 같은 엔진을 돌린다.
   *
   * ★ 내 것은 여전히 막는다. 그건 내가 고칠 수 있고 클라가 자동으로 다시 올린다. */
  const fnPath2 = fileURLToPath(new URL('supabase/functions/pvp-battle/index.ts', ROOT));
  if (!existsSync(fnPath2)) {
    ok(true, 'PvP 엣지 함수가 없어 건너뜀');
  } else {
    const isrc2 = decomment(readFileSync(fnPath2, 'utf8'));
    const faults = [];
    if (/def\.engine_hash\s*!==\s*ENGINE_HASH/.test(isrc2)) {
      faults.push('상대의 engine_hash 로 거절한다 — 접속 안 한 사람은 아무도 못 때린다');
    }
    if (!/mine\.engine_hash\s*!==\s*ENGINE_HASH/.test(isrc2)) {
      faults.push('내 engine_hash 는 봐야 한다 — 안 보면 옛 편성으로 싸우게 된다');
    }
    if (!/needRebuild: true/.test(isrc2)) {
      faults.push('needRebuild 를 안 알려 준다 — 클라가 자동 재등록을 못 한다');
    }
    okAll(faults, '내 등록만 막고, 상대가 낡았다고 막지 않는다', 3);

    /* 클라 쪽 자동 재등록이 살아 있는가 — 이게 없으면 사람이 손으로 눌러야 한다 */
    const psrc4 = decomment(readFileSync(srcDir('ui/pvp.js'), 'utf8'));
    ok(/needRebuild/.test(psrc4), '클라가 needRebuild 를 받아 다시 등록한다');
    ok(/function engineMoved\(\)/.test(psrc4) && /if \(engineMoved\(\)\)/.test(psrc4),
      'PvP 화면에 들어오면 엔진이 움직였는지 보고 알아서 다시 올린다');
  }
}

section('도전 쿨타임 표시 · 도감 계열/스킬');
{
  /* 제작자 요청 둘:
   *   「도전 쿨타임일때 도전 버튼 자체가 클릭안되고 남은 초 표시되면 좋겠어」
   *   「도감에 계열별 특징이랑 각 클래스별 스킬을 같이 넣어두면 좋을것같아」 */
  const psrc5 = decomment(readFileSync(srcDir('ui/pvp.js'), 'utf8'));

  /* ★★ 클라의 쿨타임 값이 서버와 **같아야** 한다.
   *   짧게 잡으면 눌리는 버튼이 서버에서 튕겨 나고, 길게 잡으면 눌 수 있는데 막힌다. */
  const cm = psrc5.match(/CHALLENGE_COOLDOWN_S = (\d+)/);
  const fnPath3 = fileURLToPath(new URL('supabase/functions/pvp-battle/index.ts', ROOT));
  if (!existsSync(fnPath3)) {
    ok(true, 'PvP 엣지 함수가 없어 쿨타임 대조를 건너뜀');
  } else {
    const sm = decomment(readFileSync(fnPath3, 'utf8')).match(/COOLDOWN = '(\d+) seconds'/);
    ok(!!cm && !!sm && Number(cm[1]) === Number(sm[1]),
      '도전 쿨타임이 클라와 서버에서 같다',
      `클라 ${cm && cm[1]} vs 서버 ${sm && sm[1]}`);
  }

  const faults = [];
  if (!/disabled: left \? true : undefined/.test(psrc5)) faults.push('쿨타임일 때 버튼을 안 막는다');
  if (!/left \? `\$\{left\}초` : '도전'/.test(psrc5)) faults.push('남은 초를 안 보여 준다');
  if (!/if \(!cooldownLeft\(r\.handle\)\) doChallenge/.test(psrc5)) faults.push('막아 놓고도 눌리면 도전이 나간다');
  if (!/localStorage/.test(psrc5) || !/COOL_KEY/.test(psrc5)) faults.push('쿨타임을 저장 안 해 새로고침하면 잊는다');
  /* ★ `clearInterval` 는 타이머를 시작하는 쪽에도 있다 — 파일 전체를 보면
   *   dispose 에서 지워도 통과한다 (메타 검사에서 안 물었다). **dispose 몸안**을 본다. */
  const dspAt = psrc5.indexOf('export function dispose()');
  /* ★ 길이로 자르면 **다음 함수까지 넘어가** 거기 있는 clearInterval 을 보고 통과한다
   *   (메타 검사에서 안 물었다). 함수가 닫히는 줄까지만 본다. */
  const dspEnd = psrc5.indexOf(String.fromCharCode(10) + '}', dspAt);
  const dsp = dspAt < 0 ? '' : psrc5.slice(dspAt, dspEnd < 0 ? dspAt + 320 : dspEnd);
  if (!/clearInterval\(coolTimer\)/.test(dsp)) faults.push('화면을 떠나도 타이머를 안 멈춘다');
  okAll(faults, '쿨타임이면 버튼이 막히고 남은 초가 뜬다', 5);

  /* ── 도감 ── */
  const csrc5 = decomment(readFileSync(srcDir('ui/codex.js'), 'utf8'));
  const gaps = [];
  /* ★ 이름만 보면 «const LINEAGE_TRAIT = {}» 로 바꿔도 통과한다 —
   *   **진짜 표에서 가져오는지** (import) 를 본다. */
  if (!/import\s*\{[^}]*LINEAGE_TRAIT[^}]*\}\s*from\s*'\.\.\/data\/lineage\.js'/.test(csrc5)) {
    gaps.push('계열 특성을 data/lineage.js 에서 안 가져온다');
  }
  if (!/BRANCH_TRAIT/.test(csrc5)) gaps.push('갈래 특성(사제/수도승)을 안 읽는다');
  if (!/import\s*\{[^}]*getSkill[^}]*\}\s*from\s*'\.\.\/data\/skills\.js'/.test(csrc5)) {
    gaps.push('클래스 스킬을 data/skills.js 에서 안 가져온다');
  }
  if (!/classChain/.test(csrc5)) gaps.push('계열로 묶지 않는다');
  if (!/mercView/.test(csrc5)) gaps.push('계열/차수 보기 전환이 없다');
  okAll(gaps, '도감이 계열 특성과 클래스 스킬을 보여준다', 5);

  /* ★ 예전에 여기서 상수를 통째로 지운 적이 있다 (TIER_LABEL) — 쓰는 이름이 다 있는지 본다 */
  const used = [...csrc5.matchAll(/\b([A-Z][A-Z_0-9]{2,})\b/g)].map((m) => m[1]);
  const declared = new Set([...csrc5.matchAll(/(?:const|let)\s+([A-Z][A-Z_0-9]{2,})\s*=/g)].map((m) => m[1]));
  const imported = new Set([...csrc5.matchAll(/import\s*\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(',').map((x) => x.trim())));
  const missing = [...new Set(used)].filter((n) => !declared.has(n) && !imported.has(n));
  okAll(missing.map((n) => `도감이 '${n}' 를 쓰는데 선언도 import 도 없다`),
    '도감이 쓰는 상수가 전부 있다', Math.max(1, [...new Set(used)].length));
}

section('PvP 등록은 부상을 무시한다');
{
  /* ★★ 제작자 보고: 「내꺼 3,4,5 부대가 순식간에 지는데 이거 버그같은데」.
   *   진단(판 53)을 보니 그 부대들이 **«용병 1명 + 펫 3»** 으로 등록돼 있었다 —
   *   `allyUnitDefs` 가 **부상자를 빼기** 때문이다.
   *
   *   의뢰에서는 맞는 규칙이다 (지금 못 나가는 사람이니까). 그런데 PvP 등록은
   *   «내 용병단의 사진» 이라, 나락·탑을 돌고 온 직후에 등록하면 부대가 통째로 비고
   *   **스냅샷이라 나중에 다 나아도 그 상태로 굳는다.**
   *
   * ★ 굴려서 본다 — 글자로만 보면 «옵션은 있는데 안 먹는» 상태를 못 잡는다. */
  const QU = need('game/quest.js');
  const MC = need('game/merc.js');
  if (!QU || !MC) { ok(false, '의뢰/용병 모듈을 못 읽었다'); } else {
    const day = 100;
    const mk = (i, w) => ({
      uid: `w${i}`, name: `단원${i}`, classId: 'swordsman', level: 40, grade: 'C',
      hiredDay: 2, equipment: {}, exp: 0,
      ...(w ? { status: 'wounded', woundUntil: day + 5 } : {}),
    });
    const roster = [mk(0, false), mk(1, true), mk(2, true), mk(3, true), mk(4, false), mk(5, true), mk(6, true)];
    const st = {
      day, roster, items: [], pets: [],
      squads: [{ id: 'sw', name: '시험부대', formationId: 'basic', memberUids: roster.map((m) => m.uid) }],
    };
    /* 판이 차려졌는지 먼저 본다 — 부상 판정이 실제로 돌아야 이 검사가 뜻이 있다 */
    const wounded = roster.filter((m) => MC.isWounded(m, day)).length;
    ok(wounded === 5, '시험이 부상자를 실제로 만들었다 (판이 차려졌다)', `부상 ${wounded}명 (5명이어야 한다)`);

    if (wounded === 5) {
      const q = QU.allyUnitDefs(st, st.squads[0]).filter((u) => !u.pet).length;
      const p = QU.allyUnitDefs(st, st.squads[0], { ignoreWounds: true }).filter((u) => !u.pet).length;
      ok(q === 2, '의뢰 편성은 부상자를 뺀다 (예전 그대로)', `${q}명 — 2명이어야 한다`);
      ok(p === 7, 'PvP 편성은 부상자도 싣는다', `${p}명 — 7명이어야 한다`);
    }
  }

  /* PvP 화면이 그 옵션을 실제로 넘기는가 — 안 넘기면 위 기능이 있으나 마나다 */
  const psrc6 = decomment(readFileSync(srcDir('ui/pvp.js'), 'utf8'));
  ok(/allyUnitDefs\(state, sq, \{ ignoreWounds: true \}\)/.test(psrc6),
    'PvP 화면이 부상 무시 옵션을 넘긴다',
    'myLineup 이 옵션 없이 부른다 — 부상자가 또 빠진다');

  /* ★ 조용히 빠지는 걸 막는 두 번째 그물 — 인원을 사람에게 보여준다 */
  const faults = [];
  if (!/단원 \$\{r\.mercs\}명을 등록했다/.test(psrc6)) faults.push('등록 결과에 단원 수를 안 적는다');
  if (!/지금 편성/.test(psrc6)) faults.push('화면에 지금 편성 인원을 안 보여준다');
  if (!/단원이 3명 미만인 부대/.test(psrc6)) faults.push('인원이 모자란 부대를 경고하지 않는다');
  okAll(faults, '편성 인원이 사람 눈에 보인다 (조용히 비는 일이 없게)', 3);
}

section('순위표에서 편성 보기');
{
  /* ★★ 제작자: 「pvp 순위에서 부대 보는거 안되나?」 → 「순위표의 누구나」 로 정했다.
   *
   *   §93 에서는 **일부러 막아 뒀던** 것이라, 이 검사는 «막혔나» 가 아니라
   *   «제대로 열렸나» 를 본다. 열어 두기로 한 이상 **반쯤 열린 상태가 제일 나쁘다** —
   *   버튼은 보이는데 서버가 거절하면 사람은 고장으로 읽는다.
   */
  const psrc7 = decomment(readFileSync(srcDir('ui/pvp.js'), 'utf8'));
  const nsrc7 = decomment(readFileSync(srcDir('net/pvp.js'), 'utf8'));
  const lsrc7 = decomment(readFileSync(srcDir('ui/lineupview.js'), 'utf8'));

  /* ① 화면 — 버튼이 있고, 눌러서 받아 오고, 공용 렌더러로 그린다 */
  const gaps7 = [];
  if (!/'편성'/.test(psrc7)) gaps7.push('순위표에 편성 버튼이 없다');
  if (!/Pvp\.lineup\(/.test(psrc7)) gaps7.push('편성을 서버에서 안 받아 온다');
  if (!/lineupNode\(/.test(psrc7)) gaps7.push('공용 렌더러로 안 그린다');
  if (/rp-lu/.test(psrc7)) gaps7.push('편성 표를 여기서 또 그린다 (lineupview.js 와 갈라진다)');
  /* ★ 받은 걸 캐시하고, «새로고침» 이 그 캐시도 비우는가 —
   *   안 비우면 상대가 다시 등록해도 옛 편성이 계속 보인다 */
  if (!/lineupCache/.test(psrc7)) gaps7.push('편성을 캐시하지 않는다 (접을 때마다 다시 받는다)');
  if (!/function dropCache\(\)[^\n]*lineupCache\.clear\(\)/.test(psrc7)) {
    gaps7.push('새로고침이 편성 캐시를 안 비운다 — 상대가 다시 등록해도 옛 편성이 보인다');
  }
  okAll(gaps7, '순위표에서 편성을 눌러 볼 수 있다', 6);

  /* ② 통로 — 순위표와 **같은 방식**으로 부른다.
   *   `board()` 는 로그인 없이 부르는 `call` 이다. 편성만 `authed` 로 부르면
   *   로그아웃 상태에서 «버튼은 보이는데 눌리면 실패» 가 된다. */
  const wants7 = [];
  if (!/export async function lineup\(/.test(nsrc7)) wants7.push('lineup() 이 없다');
  if (!/rpc\('pvp_lineup'\)/.test(nsrc7)) wants7.push('pvp_lineup RPC 를 안 부른다');
  {
    const m = nsrc7.match(/export async function lineup\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    const body = m ? m[1] : '';
    if (!body) wants7.push('lineup() 본문을 못 읽었다');
    else if (!/\bcall\(/.test(body) || /\bauthed\(/.test(body)) {
      wants7.push('편성을 순위표와 다른 방식으로 부른다 (board 는 call, 편성도 call 이어야 한다)');
    }
  }
  okAll(wants7, '편성 통로가 순위표와 같다 (로그인 없이도 열린다)', 3);

  /* ③ 서버 — 마이그레이션이 있고, 노출면이 좁고, 순위표와 같은 대상에게 열려 있는가.
   *   ★ 여기서 틀리면 화면만 고쳐도 안 된다. SQL 을 글자로 대조한다. */
  const sqlPath7 = fileURLToPath(new URL('db/011_pvp_lineup.sql', ROOT));
  if (!existsSync(sqlPath7)) {
    ok(false, '편성 RPC 마이그레이션이 있다', 'db/011_pvp_lineup.sql 이 없다');
  } else {
    /* ★★ **주석을 지우고 본다.** 이 파일 머리에 설계를 길게 적어 뒀는데,
     *   거기 `r.status = 'ok'` 같은 조각이 그대로 들어 있어서
     *   코드에서 그 줄을 지워도 검사가 **주석에 맞아 통과**했다 (메타 검사로 잡았다).
     *   이 저장소가 전에 `rout: false` 로 똑같이 당한 적이 있다. */
    /* ★ 줄로 쪼갤 때 `\r` 까지 떼어 낸다. 처음엔 `/--.*$/` 로 썼는데 **한 줄도 안 지워졌다** —
     *   JS 의 `.` 은 `\r` 을 안 먹어서 CRLF 파일에서는 `$` 앵커가 영영 안 맞는다.
     *   검사는 통과인데 하는 일이 없는 상태였고, 메타 검사가 아니었으면 못 봤다. */
    const sql7 = readFileSync(sqlPath7, 'utf8').split(/\r?\n/).map((ln) => ln.replace(/--.*/, '')).join('\n');
    const bad7 = [];
    if (!/create or replace function public\.pvp_lineup\(p_handle uuid\)/.test(sql7)) {
      bad7.push('pvp_lineup(p_handle uuid) 를 안 만든다');
    }
    /* RLS 를 우회하는 유일한 통로 — security definer + search_path 고정이 아니면 위험하다 */
    if (!/language sql stable security definer set search_path = ''/.test(sql7)) {
      bad7.push("language sql stable security definer set search_path = '' 형태가 아니다");
    }
    /* ★★ 노출면 — raw(장비 원본)와 user_id 는 **절대 안 나간다** */
    if (/\bd\.raw\b/.test(sql7)) bad7.push('raw(장비 원본)를 내보낸다 — 남의 굴림값까지 열린다');
    if (/\bd\.user_id\b|\bselect[\s\S]*user_id/.test(sql7.replace(/r\.user_id|d\.user_id = |on r\.user_id = d\.user_id/g, ''))) {
      bad7.push('user_id 를 내보낸다');
    }
    /* 순위에서 숨긴 사람(flagged)은 편성도 숨어야 한다 — 순위표와 같은 조건 */
    if (!/r\.status = 'ok'/.test(sql7)) bad7.push("순위에서 숨긴 사람(status != 'ok')의 편성도 준다");
    if (!/grant execute on function public\.pvp_lineup\(uuid\) to anon, authenticated/.test(sql7)) {
      bad7.push('순위표와 같은 대상에게 열지 않는다 (anon, authenticated)');
    }
    okAll(bad7, '편성 RPC 가 순위표와 같은 범위로만 열린다', 6);
  }

  /* ④ 공용 렌더러가 **자기 CSS 를 들고 있는가.**
   *   ★★ 예전엔 `.rp-lu*` 를 재생 화면이 넣었다. 그대로 뒀다면
   *   «재생을 한 번도 안 연 사람은 순위표에서 표가 깨진다» 가 된다. 눈에 안 띄는 종류다. */
  const css7 = [];
  if (!/\.rp-lu \{/.test(lsrc7)) css7.push('편성 표 CSS 를 안 들고 있다');
  if (!/export function injectLineupStyle/.test(lsrc7)) css7.push('CSS 를 넣는 함수가 없다');
  if (!/injectLineupStyle\(\)/.test(lsrc7.replace(/export function injectLineupStyle[^\n]*/, ''))) {
    css7.push('CSS 를 넣는 함수를 아무도 안 부른다');
  }
  okAll(css7, '편성 표가 자기 CSS 를 들고 다닌다', 3);

  /* ⑤ 새 모듈이 오프라인 목록에 들어갔는가 —
   *   빠지면 PWA 로 설치한 사람은 순위표에서 편성이 통째로 안 뜬다 */
  const swsrc7 = readFileSync(fileURLToPath(new URL('sw.js', ROOT)), 'utf8');
  ok(/\.\/src\/ui\/lineupview\.js/.test(swsrc7),
    '새 편성 모듈이 오프라인 목록(APP_SHELL)에 있다',
    'sw.js 의 APP_SHELL 에 ./src/ui/lineupview.js 가 없다');
}

section('순위표 치트 — 부대 전력·S용병 상한');
{
  /* ★★ 순위표 부대 전력 1위에 **게임이 만들 수 없는 값**이 올라왔다 (§96).
   *   `숨단` — 1일차 · 의뢰 1건 · 최고레벨 37 인데 전력 259,803 (실측 천장 190,470).
   *
   *   통과한 이유가 둘이었고 **둘 다 «재 놓고 안 쓴» 종류**다:
   *     ① POWER_CAP 이 5,000,000 — 바로 위 주석엔 「실측 74,148」 이라 적혀 있었다.
   *     ② S용병 일차 상한을 `hires`(자기 신고값)가 **넓히는 데** 쓰였다.
   *        주석은 「넓히는 데는 안전하다」 고 했지만 오탐에만 안전하고 위조에는 아니었다.
   *
   * ★ 그래서 글자가 아니라 **판정을 굴려서** 본다. 상수 이름만 확인하면
   *   값이 헐거워져도 안 걸린다 — 이 저장소가 여러 번 당한 방식이다. */
  let RL = null; let PC = null;
  try {
    RL = await import('../src/game/rules.js');
    PC = await import('./powerceiling.mjs');
  } catch (e) { ok(false, '규칙·천장 모듈을 읽는다', String((e && e.message) || e)); }

  if (RL && PC) {
    /* ── ① 판이 차려졌는가 (장비가 안 붙으면 천장을 낮게 잡는다) ── */
    for (const g of PC.gates()) faultsPush(`천장 측정의 판이 안 차려졌다: ${g}`);

    /* ── ② 박아 둔 표가 실측과 같은가 ──
     *   낮으면 정상 플레이어가 표시되고, 높으면 치트가 샌다. 양쪽 다 막는다. */
    const drift = [];
    const measured = PC.ceilingTable('S');
    if (measured.length !== RL.POWER_BY_LEVEL.length) {
      drift.push(`표 길이가 다르다 (실측 ${measured.length} vs 박힌 값 ${RL.POWER_BY_LEVEL.length})`);
    } else {
      measured.forEach((m, i) => {
        const baked = RL.POWER_BY_LEVEL[i];
        const off = Math.abs(baked - m.total) / Math.max(1, m.total);
        if (off > 0.005) {
          drift.push(`Lv${m.lv} 천장 ${baked} vs 실측 ${m.total} — node tools/powerceiling.mjs 로 다시 떠라`);
        }
      });
    }
    okAll(drift, '전력 천장 표가 실측과 맞는다', Math.max(1, measured.length));

    /* ── ③ 거절 상한이 실측 천장보다 충분히 위인가 ──
     *   ★ 거절은 되돌릴 수 없다 — 여기가 좁으면 정상 플레이어가 통째로 막힌다. */
    const topCeil = measured.length ? measured[measured.length - 1].total : 0;
    const capFaults = [];
    if (!(RL.POWER_CAP > topCeil * 3)) capFaults.push(`POWER_CAP ${RL.POWER_CAP} 이 실측 천장 ${topCeil} 의 3배 이하다 — 정상 플레이어를 거절할 수 있다`);
    if (!(RL.POWER_CAP < 2_000_000)) capFaults.push(`POWER_CAP ${RL.POWER_CAP} 이 아직 헐겁다 (예전 5,000,000 은 천장의 26배였다)`);
    /* ★ 여유는 **0 보다 크고 넉넉하지 않아야** 한다.
     *   1.25 로 잡았다가 천장의 1.15배짜리 치트를 통과시켰다 (§100).
     *   세트 조각이 고정 스탯이라 천장이 정확하므로 크게 둘 이유가 없다. */
    if (!(RL.POWER_SLACK > 1 && RL.POWER_SLACK <= 1.15)) {
      capFaults.push(`POWER_SLACK ${RL.POWER_SLACK} — 1 보다 크고 1.15 이하여야 한다 (천장이 정확하다)`);
    }
    okAll(capFaults, '전력 거절 상한이 천장보다 위, 옛 값보다 아래', 3);

    /* ── ④ ★★ 실제 판정 — 치트는 걸리고 정상은 안 걸려야 한다 ──
     *   프로덕션에 실제로 올라온 값 그대로 쓴다. */
    const mk = (o) => ({
      seed: 1, dataVersion: 1, gold: 0, renown: 0, cityId: null, cityTier: 0,
      squadsN: 5, rosterCap: 0, squad: [], squadsFull: [],
      abyssBest: 0, abyssBestDay: 0, abyssLastRunDay: 0,
      towerBest: 0, towerBestDay: 0, towerLastRunDay: 0,
      hires: 0, specHires: 0,
      ...o,
      battlesWon: o.battlesWon != null ? o.battlesWon : (o.questsDone || 0) * 3,
      hiredN: o.hiredN != null ? o.hiredN : o.rosterN,
    });
    /* 실제로 올라왔던 치트 등재 둘.
     * ★★ 두 번째가 중요하다 — 259,803 을 막은 **뒤에** 219,474 가 통과했다.
     *   천장(190,470) 위인데 그때 여유가 1.25 라 199,994 가 아니라 238,088 이 선이었다.
     *   「막았다」 가 아니라 «얼마나 위까지 열어 뒀나» 를 봐야 한다. */
    const CHEATS = [
      { nm: '숨단', day: 1, questsDone: 1, rosterN: 7, sMercs: 7, topLevel: 37, topPower: 259803 },
      { nm: '삶이…빛난다', day: 120, questsDone: 300, rosterN: 7, sMercs: 7, topLevel: 80, topPower: 219474 },
    ];
    const CHEAT = CHEATS[0];
    /* 실제 정상 등재 — 계량기가 0 인 옛 세이브까지 포함해 가장 빡빡한 조건으로 본다 */
    const FAIR = [
      { nm: '치젤캔', day: 2381, questsDone: 1022, rosterN: 35, sMercs: 35, topLevel: 80, topPower: 184136 },
      { nm: '랴니', day: 2122, questsDone: 809, rosterN: 38, sMercs: 38, topLevel: 80, topPower: 166894 },
      { nm: '349일차', day: 349, questsDone: 588, rosterN: 26, sMercs: 0, topLevel: 79, topPower: 46581 },
      { nm: '34일차', day: 34, questsDone: 27, rosterN: 14, sMercs: 0, topLevel: 20, topPower: 8959 },
      { nm: '1일차 새 판', day: 1, questsDone: 0, rosterN: 4, sMercs: 0, topLevel: 1, topPower: 0 },
    ];

    const behave = [];
    /* 치트는 계량기를 얼마로 적어 올려도 걸려야 한다 — 그게 예전에 뚫린 자리다 */
    for (const c of CHEATS) {
      for (const h of [0, 7, 100, 100000]) {
        const v = RL.judge(null, mk({ ...c, hires: h, specHires: h }));
        if (v.verdict === 'ok') behave.push(`치트 등재 ${c.nm} 이 hires=${h} 로 통과한다`);
        else if (!v.reasons.some((x) => x.includes('부대 전력'))) {
          behave.push(`치트 등재 ${c.nm} 이 hires=${h} 에서 전력 사유로 안 걸린다 (${v.reasons.join(' / ')})`);
        }
      }
    }
    /* ★★ S용병 상한을 **따로** 겨눈다.
     *   처음엔 위 치트 프로필 하나로만 봤는데, `hires` 구멍을 도로 열어도
     *   **전력 검사가 대신 물어서** 검사가 통과했다 (메타 검사로 잡았다).
     *   그래서 «전력은 정상인데 S만 이상한» 프로필을 따로 둔다 — 한 검사가
     *   다른 검사의 구멍을 가리지 못하게. */
    /* ★★ **기록 ↔ 전력 교차 검증** (§103).
     *   세 번째 치트는 «전력만 낮춰서» 통과했다 — 값끼리 안 견줬기 때문이다.
     *   실측: 나락 96 은 최소 57,122 · 탑 490 은 최소 125,086 이 필요하다.
     *
     * ★ 비율(전력÷층)로 보면 안 된다 — 2인 풀세트가 7인 맨몸보다 깊이 간다.
     *   반드시 «전력 P 이하로 도달한 최대» 라는 상단 포락선이어야 한다. */
    const CROSS = [
      { nm: '전력만 낮춘 치트', day: 122, questsDone: 301, battlesWon: 302, rosterN: 7, sMercs: 7,
        topLevel: 80, topPower: 27127, abyssBest: 96, towerBest: 490 },
    ];
    for (const c of CROSS) {
      const v = RL.judge(null, mk(c));
      if (v.verdict === 'ok') behave.push(`${c.nm} 이 통과한다 — 기록과 전력을 안 견준다`);
      else if (!v.reasons.some((x) => /나락 .* 부대 전력|탑 .* 부대 전력/.test(x))) {
        behave.push(`${c.nm} 이 걸리긴 하는데 기록↔전력 사유가 아니다 (${v.reasons.join(' / ')})`);
      }
    }
    /* ★ 그리고 **정상 최강**은 걸리면 안 된다 — 랴니는 탑 500 에 전력 166,894 로
     *   실측 최소(165,368)와 1% 차이다. 여기서 오탐이 나면 최상위가 통째로 잘린다. */
    for (const f of [
      { nm: '랴니(탑500)', day: 2129, questsDone: 811, battlesWon: 3861, rosterN: 38, sMercs: 38,
        topLevel: 80, topPower: 166894, abyssBest: 92, towerBest: 500 },
      { nm: '여기이름(탑191)', day: 349, questsDone: 588, battlesWon: 1013, rosterN: 26, sMercs: 0,
        topLevel: 79, topPower: 46581, abyssBest: 52, towerBest: 191 },
    ]) {
      const v = RL.judge(null, mk(f));
      if (v.verdict !== 'ok') behave.push(`정상 등재 ${f.nm} 이 기록↔전력에 걸린다 — ${v.reasons.join(' / ')}`);
    }

    /* ★ 곡선이 «전력이 오르면 도달도 오른다» 로 정렬돼 있어야 한다 (포락선이 깨지면 판정이 뒤집힌다) */
    for (const [nm, curve] of [['나락', RL.ABYSS_POWER_CURVE], ['탑', RL.TOWER_POWER_CURVE]]) {
      if (!Array.isArray(curve) || curve.length < 4) { behave.push(`${nm} 곡선이 없거나 너무 성기다`); continue; }
      for (let i = 1; i < curve.length; i++) {
        if (!(curve[i][0] > curve[i - 1][0] && curve[i][1] >= curve[i - 1][1])) {
          behave.push(`${nm} 곡선이 단조가 아니다 (${curve[i - 1]} → ${curve[i]})`);
        }
      }
    }

    const S_ONLY = [
      /* 실제 치트가 쓴 모양 — 1일차에 전원 S */
      { nm: '1일차 S 7명', day: 1, questsDone: 1, rosterN: 7, sMercs: 7, topLevel: 37, topPower: 100000 },
      /* ★ 며칠 지난 뒤의 모양도 본다. «고용했다고 다 S 가 아니다» 는 환산을 빼면
       *   1일차는 여전히 걸리지만 10일차가 통째로 뚫린다 — 프로필 하나로는 그걸 못 본다. */
      { nm: '10일차 S 30명', day: 10, questsDone: 10, rosterN: 30, sMercs: 30, topLevel: 40, topPower: 100000 },
    ];
    for (const p of S_ONLY) {
      for (const h of [0, 7, 100, 100000]) {
        const v = RL.judge(null, mk({ ...p, hires: h, specHires: h }));
        if (v.verdict === 'ok') behave.push(`${p.nm} 이 hires=${h} 로 통과한다 (전력은 정상인 경우)`);
        else if (!v.reasons.some((x) => x.includes('S 용병'))) {
          behave.push(`${p.nm} 이 hires=${h} 에서 S용병 사유로 안 걸린다 (${v.reasons.join(' / ')})`);
        }
      }
    }

    /* 정상은 계량기 0 에서도 통과해야 한다 */
    for (const f of FAIR) {
      const v = RL.judge(null, mk(f));
      if (v.verdict !== 'ok') behave.push(`정상 등재 ${f.nm} 이 걸린다 — ${v.reasons.join(' / ')}`);
    }
    okAll(behave, '치트 등재는 걸리고 정상 등재는 통과한다', 20 + FAIR.length);

    /* ── ⑤ 미래 고용을 안 센다 ──
     *   1일차 세이브에 hiredDay:2 를 적어 넣어 «고용된 단원» 을 부풀리던 자리다. */
    const st9 = {
      day: 1, seed: 1, dataVersion: 1, gold: 0, renown: 0, squads: [], items: [],
      stats: { battlesWon: 0, questsDone: 0, hires: 0, specHires: 0 },
      roster: [
        { uid: 'a', classId: 'swordsman', level: 1, grade: 'S', hiredDay: 2 },
        { uid: 'b', classId: 'swordsman', level: 1, grade: 'S', hiredDay: 9 },
        { uid: 'c', classId: 'swordsman', level: 1, grade: 'C', hiredDay: 1 },
      ],
    };
    const ex9 = RL.extractScore(st9);
    ok(ex9 && ex9.hiredN === 0,
      '1일차 세이브의 «미래 고용» 은 안 센다',
      `hiredN ${ex9 && ex9.hiredN} — 0 이어야 한다 (hiredDay 2·9 는 1일차에 불가능)`);
    const ex9b = RL.extractScore({ ...st9, day: 20 });
    ok(ex9b && ex9b.hiredN === 2,
      '지난 고용은 그대로 센다 (20일차면 hiredDay 2·9 는 정상)',
      `hiredN ${ex9b && ex9b.hiredN} — 2 여야 한다`);

    /* ── ⑥ 서버가 상한을 **손으로 옮겨 적지 않는가** ──
     *   예전엔 index.ts 에 5_000_000 이 박혀 있었고 rules.js 와 갈라졌다. */
    const fnPath9 = fileURLToPath(new URL('supabase/functions/submit-score/index.ts', ROOT));
    if (!existsSync(fnPath9)) {
      ok(true, '제출 함수가 없어 상한 대조를 건너뜀');
    } else {
      const isrc9 = decomment(readFileSync(fnPath9, 'utf8'));
      const dup = [];
      if (isrc9.includes('5_000_000') || isrc9.includes('5000000')) dup.push('아직 5,000,000 을 손으로 적어 둔다');
      if (!isrc9.includes('POWER_CAP')) dup.push('POWER_CAP 을 안 쓴다 — 값이 갈라질 수 있다');
      okAll(dup, '제출 함수가 전력 상한을 상수로 가져다 쓴다', 2);
    }
  }

  function faultsPush(m) { ok(false, '천장 측정의 판', m); }
}

section('탐침 차단 — 거절을 반복하면 신호를 끊는다');
{
  /* ★★ 제작자: 「해킹하려면 차단되는거 여러번 반복할껀데 이거 체크해서도 막을수있나?」
   *
   *   실제로 그 공격이 일어났다 (rejections 시간순):
   *     전력 5285956 → 5296011 → 5535173 → 5720690 → 5763505 로 바꿔 가며 찔렀고,
   *     8분 뒤 통과한 값이 순위 1위에 올라왔다 (§96 숨단).
   *
   *   사유는 이미 안 준다(§55). 그런데 **«걸렸다» 그 자체가 1비트 신탁**이라
   *   그것만으로 이분 탐색이 된다. 몇 번 반복되면 그 비트마저 닫는다. */
  let RP = null;
  try { RP = await import('../src/game/rules.js'); } catch (e) {
    ok(false, '규칙 모듈을 읽는다', String((e && e.message) || e));
  }

  if (RP) {
    /* ① 순서가 맞는가 — 조용해지는 게 먼저, 잡아 두는 게 나중이다 */
    const order = [];
    if (!(RP.PROBE_QUIET >= 1)) order.push(`PROBE_QUIET ${RP.PROBE_QUIET} — 첫 거절부터 조용하면 오탐 피해자가 단서를 잃는다`);
    if (!(RP.PROBE_QUIET < RP.PROBE_HOLD)) order.push(`PROBE_QUIET ${RP.PROBE_QUIET} 이 PROBE_HOLD ${RP.PROBE_HOLD} 보다 작아야 한다`);
    if (!(RP.PROBE_QUIET <= 5)) order.push(`PROBE_QUIET ${RP.PROBE_QUIET} 이 너무 후하다 — 그만큼 찔러 볼 수 있다`);
    if (!(RP.PROBE_WINDOW_H >= 1)) order.push(`PROBE_WINDOW_H ${RP.PROBE_WINDOW_H} 이 이상하다`);
    okAll(order, '탐침 상한이 «알려주기 → 조용히 → 잡아두기» 순서다', 4);

    /* ② ★ 굴려서 본다 — 글자 검사는 값이 헐거워져도 안 문다 */
    const beh = [];
    const p0 = RP.probePolicy(0);
    if (p0.quiet || p0.hold) beh.push('거절이 없는데도 조용해진다 — 정상 플레이어가 단서를 잃는다');
    for (let n = 1; n < RP.PROBE_QUIET; n++) {
      if (RP.probePolicy(n).quiet) beh.push(`거절 ${n}회에서 벌써 조용해진다 (${RP.PROBE_QUIET}회부터여야 한다)`);
    }
    if (!RP.probePolicy(RP.PROBE_QUIET).quiet) beh.push(`거절 ${RP.PROBE_QUIET}회에서 아직 알려 준다 — 신탁이 안 닫힌다`);
    if (!RP.probePolicy(RP.PROBE_QUIET + 50).quiet) beh.push('한참 반복해도 계속 알려 준다');
    if (RP.probePolicy(RP.PROBE_HOLD - 1).hold) beh.push(`거절 ${RP.PROBE_HOLD - 1}회에서 벌써 잡아 둔다`);
    if (!RP.probePolicy(RP.PROBE_HOLD).hold) beh.push(`거절 ${RP.PROBE_HOLD}회인데도 순위에 그대로 올린다`);
    /* 이상한 입력에 조용해지면 안 된다 — 세는 데 실패했을 때 막히면 정상 제출이 깨진다 */
    for (const junk of [null, undefined, NaN, -5, 'abc']) {
      const r = RP.probePolicy(junk);
      if (r.quiet || r.hold) beh.push(`셀 수 없는 값(${String(junk)})에서 막아 버린다 — 실패하면 열어 둬야 한다`);
    }
    okAll(beh, '거절이 쌓이면 조용해지고, 더 쌓이면 순위에서 잡아 둔다', 6 + RP.PROBE_QUIET);

    /* ③ 엣지 함수가 **그 함수를 실제로 쓰는가** — 여기 if 로 다시 적으면 검사가 헛돈다 */
    const fnPath10 = fileURLToPath(new URL('supabase/functions/submit-score/index.ts', ROOT));
    if (!existsSync(fnPath10)) {
      ok(true, '제출 함수가 없어 탐침 차단 연결을 건너뜀');
    } else {
      const isrc10 = decomment(readFileSync(fnPath10, 'utf8'));
      /* ★★ **import 줄을 걷어내고 본다.** 「이름이 보인다」 로 검사하면
       *   호출을 통째로 지워도 import 에 남은 이름 때문에 통과한다 —
       *   이 저장소가 도감(TIER_LABEL)에서 똑같이 당했고, 여기서도 메타 검사가 잡았다. */
      const body10 = isrc10.split(String.fromCharCode(10))
        .filter((ln) => !ln.trimStart().startsWith('import ')).join(String.fromCharCode(10));
      const wire = [];
      if (!body10.includes('probePolicy(')) wire.push('probePolicy 를 실제로 부르지 않는다 (여기서 다시 적으면 검사가 헛돈다)');
      if (!isrc10.includes('probe.quiet')) wire.push('조용히 답하는 갈래가 없다');
      if (!isrc10.includes('probe.hold')) wire.push('순위에서 잡아 두는 갈래가 없다');
      if (!isrc10.includes("'held'")) wire.push("held 상태를 안 쓴다");
      /* 조용할 때의 응답이 **성공과 같은 모양**이어야 한다 — 다르면 그것도 신탁이다 */
      if (!/if \(probe\.quiet\)[\s\S]{0,220}ok: true/.test(isrc10)) {
        wire.push('조용할 때 ok:true 로 답하지 않는다 — 응답 모양이 다르면 그대로 신호가 된다');
      }
      /* 세는 데 실패하면 열어 둬야 한다 */
      if (!isrc10.includes('recentRejects = 0')) wire.push('세기에 실패했을 때 0 으로 안 열어 둔다');
      okAll(wire, '엣지 함수가 탐침 차단을 실제로 물려 놨다', 6);
    }
  }
}

section('RLS 전수 — 공개 키로 읽히는 테이블이 없나');
{
  /* ★★ 이 Supabase 프로젝트는 **다른 앱과 공유한다** (침묵의 기록자, `tsa_*`).
   *   그래서 anon 키도 공유되는데, 이 게임의 anon 키는 저장소에 공개돼 있다
   *   (설계상 그렇다 — RLS 가 방어선이다).
   *   ⇒ **어느 쪽이든 RLS 없는 테이블을 하나 만들면 양쪽 모두에게 열린다.**
   *
   * ★ 실제 조회는 `node tools/rlscheck.mjs` 가 한다 (DB 가 필요하다).
   *   여기서는 그 **판단 함수**를 굴려 본다 — 판단이 무디면 도구를 돌려도 소용없다. */
  let RJ = null;
  try { RJ = await import('./lib/rlsjudge.mjs'); } catch (e) {
    ok(false, 'RLS 판정 모듈을 읽는다', String((e && e.message) || e));
  }

  if (RJ) {
    const T = (tbl, rls_on, policies = 0) => ({ tbl, rls_on, policies });
    const P = (tablename, cmd, roles, qual, with_check = null) =>
      ({ tablename, policyname: `${tablename}_${cmd}`.toLowerCase(), cmd, roles, qual, with_check });

    const bites = [];

    /* ① 지금 상태(전부 RLS 켜짐)는 통과해야 한다 — 오탐이 나면 아무도 안 믿는다 */
    const now = RJ.GAME_TABLES.map((t) => T(t, true, 0)).concat([T('tsa_progress', true, 4)]);
    const okCase = RJ.judgeTables(now, [
      P('tsa_progress', 'SELECT', '{authenticated}', '(( SELECT auth.uid() AS uid) = user_id)'),
    ]);
    if (okCase.fatal.length) bites.push(`정상 상태를 문제로 본다 — ${okCase.fatal[0]}`);
    if (okCase.warn.length) bites.push(`정상 상태에 경고가 뜬다 — ${okCase.warn[0]}`);

    /* ② RLS 를 끄면 잡아야 한다 */
    const off = RJ.judgeTables(now.map((t) => (t.tbl === 'scores' ? T('scores', false, 1) : t)), []);
    if (!off.fatal.some((x) => x.includes('scores'))) bites.push('RLS 꺼진 테이블을 못 잡는다');

    /* ③ ★ RLS 를 켜 놓고 `using (true)` 를 거는 게 더 흔한 실수다 */
    const openAnon = RJ.judgeTables(now, [P('scores', 'SELECT', '{anon}', 'true')]);
    if (!openAnon.fatal.length) bites.push('anon 에게 조건 없이 열린 정책을 못 잡는다 (RLS 를 켠 의미가 없다)');
    const openAuth = RJ.judgeTables(now, [P('tsa_progress', 'SELECT', '{authenticated}', 'true')]);
    if (!openAuth.warn.length) bites.push('로그인한 누구나 남의 것을 보는 정책을 못 잡는다');
    const openWrite = RJ.judgeTables(now, [P('scores', 'INSERT', '{anon}', null, 'true')]);
    if (!openWrite.fatal.length) bites.push('anon 이 조건 없이 쓰는 정책을 못 잡는다');

    /* ④ ★★ Storage — 테이블이 아무리 안전해도 버킷이 열려 있으면 소용없다.
     *   자료실(침묵의 기록자)이 버킷을 쓰고, **auth 를 공유**하므로 여기도 같이 본다. */
    const B = (id, is_public) => ({ id, is_public });
    const SP = (policyname, roles, qual) => ({ tablename: 'objects', policyname, cmd: 'SELECT', roles, qual, with_check: null });
    const okStore = [B('tsa-data', false)];
    const okStorePol = [SP('tsa_data_read', '{authenticated}', '((SELECT auth.uid()) = owner)')];

    const clean = RJ.judgeTables(now, [], okStore, okStorePol);
    if (clean.fatal.length || clean.warn.length) bites.push(`정상 Storage 를 문제로 본다 — ${(clean.fatal[0] || clean.warn[0])}`);

    const pubBucket = RJ.judgeTables(now, [], [B('tsa-data', true)], okStorePol);
    if (!pubBucket.fatal.length) bites.push('public 버킷을 못 잡는다 — 주소만 알면 로그인 없이 받아진다');

    const anonPol = RJ.judgeTables(now, [], okStore, [SP('tsa_data_read', '{anon}', 'true')]);
    if (!anonPol.fatal.length) bites.push('anon 에게 열린 Storage 정책을 못 잡는다');

    /* ★ auth 를 공유하므로 «authenticated 전체» 는 «남의 프로젝트 가입자 전체» 다 */
    const sharedAuth = RJ.judgeTables(now, [], okStore, [SP('tsa_data_read', '{authenticated}', "(bucket_id = 'tsa-data')")]);
    if (!sharedAuth.warn.length) bites.push('소유자 조건 없는 Storage 정책을 안 알려 준다 (auth 를 공유한다)');

    /* ⑤ 처음 보는 테이블이 생기면 알려 줘야 한다 — 공유 프로젝트라 남이 만들 수 있다 */
    const stranger = RJ.judgeTables(now.concat([T('mystery_box', true, 0)]), []);
    if (!stranger.warn.some((x) => x.includes('mystery_box'))) bites.push('처음 보는 테이블을 안 알려 준다');

    /* ⑥ 아무것도 못 읽었으면 «통과» 가 아니라 «실패» 여야 한다.
     *   ★ 조회가 깨졌을 때 조용히 초록불이 뜨는 게 제일 나쁘다. */
    if (!RJ.judgeTables([], []).fatal.length) bites.push('테이블을 하나도 못 읽었는데 통과시킨다');

    okAll(bites, 'RLS 판정이 실제로 문다 (꺼짐 · using true · 버킷 · 낯선 테이블)', 12);

    /* ⑦ 도구가 그 판단 함수를 **실제로 부르는가** — import 줄은 걷어내고 본다 */
    const tsrc = decomment(readFileSync(new URL('rlscheck.mjs', import.meta.url), 'utf8'));
    const body = tsrc.split(String.fromCharCode(10))
      .filter((ln) => !ln.trimStart().startsWith('import ')).join(String.fromCharCode(10));
    const wire = [];
    if (!body.includes('judgeTables(')) wire.push('rlscheck 가 judgeTables 를 안 부른다');
    if (!/judgeTables\([^)]*buckets/.test(body)) wire.push('rlscheck 가 Storage 를 판정에 안 넘긴다');
    if (!body.includes('RLS_SQL')) wire.push('도구와 판정이 다른 SQL 을 본다');
    if (!/exitCode = fatal\.length/.test(body)) wire.push('문제를 찾아도 실패로 안 끝난다');
    okAll(wire, 'RLS 도구가 판정 함수를 실제로 물려 놨다', 4);
  }
}

section('로그인은 구글 — 익명은 일부러 껐다');
{
  /* ★★ 제작자: 「익명 로그인은 일부러 막았어 … 클라우드에 데이터 올리려면 로그인 해야돼」
   *
   *   §19.3 의 결정이다: 익명은 **브라우저 저장소가 지워지면 계정이 통째로 사라진다**
   *   (iOS PWA 는 며칠 안 쓰면 실제로 정리한다). 복구 코드도 「잃으면 끝」이라 문제를 미룰 뿐이었다.
   *
   * ★★ 그런데 `supacheck` 는 그 뒤로도 「익명 로그인이 꺼져 있다 → 활성화」 를 **실패로** 띄웠다.
   *   늘 빨간 검사는 아무도 안 믿게 된다 — 실제로 나도 그 줄을 두 번이나
   *   «오탐이겠지» 하고 넘겼다. 그 사이 진짜 문제(치트 등재)는 다른 곳에 있었다.
   *   ⇒ **낡은 기대가 검사에 남아 있지 않은지** 글자로 못 박는다. */
  const sup = decomment(readFileSync(new URL('supacheck.mjs', import.meta.url), 'utf8'));
  const rme = readFileSync(fileURLToPath(new URL('db/README.md', ROOT)), 'utf8');

  const stale = [];
  /* 「익명을 켜라」 는 지시가 남아 있으면 안 된다 */
  if (/Anonymous Sign-ins.{0,12}활성화/.test(sup)) stale.push('supacheck 가 아직 익명 로그인을 켜라고 한다');
  if (/Anonymous Sign-ins.{0,12}활성화/.test(rme)) stale.push('db/README 가 아직 익명 로그인을 켜라고 한다');
  /* 지금 맞는 상태를 실제로 보는가 */
  if (!/anonMigrated|anonOn === false/.test(sup)) stale.push('supacheck 가 «익명 꺼짐» 을 정상으로 안 본다');
  if (!/googleOn/.test(sup)) stale.push('supacheck 가 구글 로그인을 안 본다');
  /* 구글이 꺼지면 아무도 못 올린다 — 그건 실패여야 한다 */
  if (!/구글 로그인이 꺼져 있다/.test(sup)) stale.push('구글 로그인이 꺼진 경우를 실패로 안 다룬다');
  okAll(stale, 'supacheck·README 가 지금의 로그인 방식(구글)을 본다', 5);

  /* ★ 클라이언트도 익명 가입을 부르면 안 된다 — §19.3 이후로는 쓰지 않는다 */
  const auth = decomment(readFileSync(srcDir('net/auth.js'), 'utf8'));
  const used = /signInAnonymously|anonymous/i.test(auth);
  ok(!used || /google/i.test(auth),
    '클라이언트 로그인이 구글을 쓴다',
    '익명 가입 경로만 남아 있다');
}

section('튜토리얼이 대상까지 화면을 끌어온다');
{
  /* ★★ 제작자 제보: 「튜토리얼이 화면 스크롤이 넘어가서 에러처럼 보이나보다」
   *
   *   구멍(`#tut-hole`)과 말풍선은 **뷰포트 좌표**로 놓인다 (`#tut-root` 가 position:fixed).
   *   대상이 스크롤 밖이면 구멍이 화면 밖에 그려지고, `box-shadow: 0 0 0 9999px` 때문에
   *   화면 전체가 어두워진 채 말풍선만 남는다 — **아무 데도 안 가리키는 먹통**으로 보인다.
   *
   * ★ 스모크에는 DOM 이 없다(위 «document 전역이 없는 환경» 참고). 그래서 글자로 보되
   *   **이름이 아니라 «제 일을 하는가»** 를 본다 — 이 저장소가 이름 검사로 여러 번 당했다. */
  const tsrc = readFileSync(srcDir('ui/tutorial.js'), 'utf8');
  const code = decomment(tsrc);

  /** 함수 하나의 본문을 대충 떠 온다 (다음 최상위 `function` 전까지) */
  const bodyOf = (name) => {
    const at = code.indexOf(`function ${name}(`);
    if (at < 0) return '';
    const nxt = code.indexOf(String.fromCharCode(10) + 'function ', at + 1);
    return code.slice(at, nxt < 0 ? code.length : nxt);
  };

  const faults = [];
  const ev = bodyOf('ensureVisible');
  const pl = bodyOf('place');

  if (!ev) faults.push('대상을 화면 안으로 끌어오는 함수가 없다');
  else {
    /* ★ 대체 경로(`scrollIntoView()` 인자 없음)만 남아도 통과하면 안 된다 —
     *   주 경로는 **옵션을 준 호출**이다 (block:'center'). 메타 검사로 잡았다. */
    if (!/scrollIntoView\(\s*\{/.test(ev)) faults.push('scrollIntoView 주 경로가 없다 — 스크롤이 안 따라간다');
    if (!/block:\s*'center'/.test(ev)) faults.push('대상을 화면 가운데로 안 맞춘다 — 가장자리에 걸려 말풍선이 못 붙는다');
    /* ★ 이미 보이면 건드리면 안 된다 — 조건 없이 매번 스크롤하면 화면이 튄다 */
    if (!/innerHeight/.test(ev)) faults.push('«이미 보이는가» 를 안 본다 — 볼 때마다 화면을 옮긴다');
    /* ★ 정착 창이 있어야 한다: 화면이 다시 그려지며 자리가 밀리므로 한 번으론 모자라고,
     *   무한히 맞추면 사람이 손으로 내리는 것과 싸운다 */
    if (!/scrollUntil/.test(ev)) faults.push('정착 창이 없다 — 한 번만 맞추면 다시 그려질 때 어긋난다');
    if (!/scrollUntil\s*\)?\s*(return|\))/.test(ev) && !/Date\.now\(\)\s*>\s*scrollUntil/.test(ev)) {
      faults.push('정착 창이 닫혀도 계속 스크롤한다 — 사람이 내리는 것과 싸운다');
    }
    /* ★ smooth 는 다시 그려질 때 끊기고, 200ms 마다 다시 걸면 덜컹거린다 */
    if (/behavior:\s*'smooth'/.test(ev)) faults.push("behavior:'smooth' 는 다시 그려질 때 끊긴다 — 'auto' 여야 한다");
  }

  /* ★★ 정의만 있고 **아무도 안 부르면** 아무 일도 안 일어난다 (도감 TIER_LABEL 과 같은 병).
   *   그리고 `place()` 안에서 **위치를 재기 전에** 불러야 한다 — 뒤에 부르면 그 판은 옛 자리다. */
  if (!pl) faults.push('place() 를 못 찾았다');
  else {
    const callAt = pl.indexOf('ensureVisible(');
    const rectAt = pl.indexOf('getBoundingClientRect(');
    if (callAt < 0) faults.push('place() 가 ensureVisible 을 안 부른다 — 정의만 있고 안 돈다');
    else if (rectAt >= 0 && callAt > rectAt) {
      faults.push('place() 가 위치를 잰 뒤에 스크롤한다 — 그 판은 옛 자리에 그려진다');
    }
  }

  /* ★ 정착 창의 길이가 말이 되는가 */
  const ms = code.match(/SETTLE_MS\s*=\s*(\d+)/);
  if (!ms) faults.push('정착 창 길이(SETTLE_MS)가 없다');
  else if (!(Number(ms[1]) >= 300 && Number(ms[1]) <= 5000)) {
    faults.push(`SETTLE_MS ${ms[1]} — 300~5000 이어야 한다 (짧으면 못 맞추고 길면 사람과 싸운다)`);
  }

  /* ★ 다시 시작할 때 표식을 풀어야 1단계에서도 맞춘다 */
  if (!/scrollStep = -1/.test(code.slice(code.indexOf('export function start')))) {
    faults.push('start() 가 스크롤 표식을 안 푼다 — 다시 시작하면 1단계에서 안 맞춘다');
  }

  okAll(faults, '튜토리얼이 대상이 화면 밖이면 끌어온다 (그리고 그 뒤엔 안 건드린다)', 9);
}

section('골드 송금 — 복사되지 않고, 받은 사람이 치트로 안 찍힌다');
{
  /* ★★ 제작자 요청: 「순위표 보고 구걸하고 승낙하면 1만/10만/50만 선택해서 보내줄수 있는」
   *
   *   골드는 클라이언트가 신고하는 값이라, 송금은 그대로 «세탁 경로» 가 될 수 있다.
   *   그래서 검사가 볼 것은 두 가지다:
   *     ① **복사되지 않는가** (두 번 반영하면 골드가 늘어난다)
   *     ② **받은 사람이 치트로 안 찍히는가** (실측: 50만을 받으면 flag(B) 가 찍힌다) */
  const gPath = fileURLToPath(new URL('db/012_gold_gift.sql', ROOT));
  if (!existsSync(gPath)) {
    ok(false, '골드 송금 마이그레이션이 있다', 'db/012_gold_gift.sql 이 없다');
  } else {
    /* ★ SQL 주석을 지우고 본다 — §94 에서 검사가 주석에 맞아 통과한 적이 있다.
     *   (`.` 은 `\r` 을 안 먹으므로 `\r` 을 먼저 뗀다.) */
    const sql = readFileSync(gPath, 'utf8').split(/\r?\n/).map((l) => l.replace(/--.*/, '')).join('\n');
    const bad = [];

    /* ① 멱등성 — 반영 표식을 보고 한 번만 준다 */
    const ap = sql.slice(sql.indexOf('function public.gold_apply'));
    if (!/to_applied_at is null/.test(ap)) bad.push('받는 쪽 반영 표식을 안 본다 — 두 번 부르면 골드가 복사된다');
    if (!/from_applied_at is null/.test(ap)) bad.push('보내는 쪽 반영 표식을 안 본다');
    if (!/set to_applied_at = now\(\)/.test(ap)) bad.push('반영했다는 표식을 안 찍는다');

    /* ② ★★ 장부 맞추기 — 이게 없으면 50만 받은 사람이 checkGrowth 에 걸린다 */
    if (!/update public\.ledger set gold/.test(ap)) {
      bad.push('gold_apply 가 ledger.gold 를 안 움직인다 — 받은 사람이 치트로 표시된다');
    }

    /* ③ 없는 돈을 못 보낸다 · 하루 한도 · 동시 요청 */
    const sd = sql.slice(sql.indexOf('function public.gold_send'), sql.indexOf('function public.gold_decline'));
    if (!/for update/.test(sd)) bad.push('gold_send 가 행을 안 잠근다 — 동시에 둘이 통과한다');
    /* ★★ **이름이 아니라 «비교문» 을 본다.** 처음엔 `public.ledger` 와 `gold_daily_cap()` 이
     *   나오는지만 봤는데, 비교하는 줄을 지워도 **오류 메시지 문구에 이름이 남아** 통과했다.
     *   메타 검사가 잡았다 — 이 저장소가 같은 방식으로 여러 번 당했다. */
    if (!/bal\s*<\s*p_amount/.test(sd)) bad.push('잔액을 안 본다 — 없는 골드를 보낼 수 있다');
    if (!/coalesce\(\(select l\.gold/.test(sd)) {
      bad.push('잔액을 select .. into 로만 읽는다 — 원장이 없으면 NULL 이라 검사를 통과한다');
    }
    if (!/used \+ p_amount > public\.gold_daily_cap\(\)/.test(sd)) bad.push('하루 한도를 안 본다');
    if (!/from_user = me/.test(sd)) bad.push('본인 것인지 안 본다 — 남의 부탁을 승낙할 수 있다');

    /* ④ 자기 자신에게 못 보낸다 (골드를 스스로 늘리는 가장 쉬운 길) */
    if (!/from_user <> to_user/.test(sql)) bad.push('자기 자신에게 보내는 것을 안 막는다');

    /* ⑤ RLS — 새 테이블은 켜고 정책을 안 만든다 (§010 규칙) */
    if (!/alter table public\.gold_gifts enable row level security/.test(sql)) {
      bad.push('gold_gifts 에 RLS 를 안 켠다 — 공개 anon 키로 읽힌다');
    }
    if (/create policy[^;]*gold_gifts/.test(sql)) bad.push('gold_gifts 에 정책을 만든다 — 통로는 함수뿐이어야 한다');

    /* ⑥ 내부 전용 함수를 열지 않는다 */
    if (/grant execute on function public\.gold_user_at/.test(sql)) {
      bad.push('gold_user_at 을 열어 준다 — 순위로 남을 지목하는 내부 함수다');
    }
    /* ⑦ §77 — revoke from public 만으로는 안 잠긴다 */
    if (!/revoke all on function public\.gold_apply\(\)\s*from anon, authenticated, public/.test(sql)) {
      bad.push('회수 대상에 anon·authenticated 를 안 적었다 (§77: from public 만으로는 안 잠긴다)');
    }
    okAll(bad, '송금 SQL 이 복사·위조·노출을 막는다', 13);

    /* ⑧ ★★ 금액이 **서버와 클라에서 같은가.**
     *   다르면 화면에 보이는 버튼이 서버에서 튕겨 난다 (PvP 쿨타임 때와 같은 종류). */
    const mAmt = sql.match(/amount in \(([^)]*)\)/);
    const srvAmts = mAmt ? mAmt[1].split(',').map((x) => Number(x.trim())).filter((n) => n) : [];
    let cliAmts = [];
    try {
      const gsrc = decomment(readFileSync(srcDir('net/gold.js'), 'utf8'));
      const m2 = gsrc.match(/AMOUNTS = \[([^\]]*)\]/);
      cliAmts = m2 ? m2[1].split(',').map((x) => Number(String(x).replace(/_/g, '').trim())).filter((n) => n) : [];
    } catch { /* 아래에서 걸린다 */ }
    ok(srvAmts.length === 3 && JSON.stringify(srvAmts) === JSON.stringify(cliAmts),
      '보낼 수 있는 금액이 서버와 클라에서 같다',
      `서버 ${JSON.stringify(srvAmts)} vs 클라 ${JSON.stringify(cliAmts)}`);

    /* ⑨ 하루 한도도 화면 문구와 같아야 한다 — 다르면 사람이 헛걸음한다 */
    const mCap = sql.match(/gold_daily_cap\(\)[\s\S]{0,120}?select (\d+)/);
    const cap = mCap ? Number(mCap[1]) : 0;
    const rsrc = decomment(readFileSync(srcDir('ui/rank.js'), 'utf8'));
    ok(cap === 500000 && /하루 50만까지/.test(rsrc),
      '하루 한도가 서버와 화면에서 같다 (50만)',
      `서버 ${cap} · 화면 문구 ${/하루 50만까지/.test(rsrc) ? '있다' : '없다'}`);
  }

  /* ⑩ 클라이언트 — 받은 몫을 **바로 저장**해야 한다 (중간에 죽으면 그 몫은 사라진다) */
  const rsrc2 = decomment(readFileSync(srcDir('ui/rank.js'), 'utf8'));
  const gaps = [];
  if (!/Gold\.applyPending\(\)/.test(rsrc2)) gaps.push('받을 몫을 안 가져온다');
  {
    const at = rsrc2.indexOf('applyPending()');
    const near = at >= 0 ? rsrc2.slice(at, at + 420) : '';
    if (!/gs\.gold/.test(near)) gaps.push('받은 delta 를 세이브에 안 더한다');
    if (!/save\(\)/.test(near)) gaps.push('더하고 나서 저장을 안 한다 — 새로고침하면 사라진다');
  }
  if (!/Gold\.beg\(/.test(rsrc2)) gaps.push('부탁을 보내는 곳이 없다');
  if (!/Gold\.send\(/.test(rsrc2)) gaps.push('승낙해서 보내는 곳이 없다');
  if (!/mine \? null :/.test(rsrc2)) gaps.push('내 줄에도 부탁 버튼이 붙는다');
  okAll(gaps, '화면이 골드를 받아 저장하고, 부탁·승낙을 실제로 부른다', 6);

  /* ⑪ 새 모듈이 오프라인 목록에 있는가 (없으면 PWA 에서 통째로 안 뜬다) */
  const swsrc = readFileSync(fileURLToPath(new URL('sw.js', ROOT)), 'utf8');
  ok(/\.\/src\/net\/gold\.js/.test(swsrc),
    '골드 모듈이 오프라인 목록(APP_SHELL)에 있다',
    'sw.js 의 APP_SHELL 에 ./src/net/gold.js 가 없다');
}

section('업데이트 내역이 치트 방어의 속을 안 흘린다');
{
  /* ★★ 제작자 지적: 「이건 적으면 업데이트 내역에 적으면 안되지...」
   *
   *   맞다. **업데이트 내역은 플레이어 전원이 본다 — 치트 계정도 본다.**
   *   거기에 «어떻게 걸러내는지» 나 «상한이 얼마인지» 를 적으면
   *   §55 에서 거절 사유를 숨긴 이유가 통째로 무너진다. 그대로 우회 설명서가 된다.
   *
   *   실제로 그렇게 적었다가 지웠다: 실측 천장 값 · 옛 상한 값 ·
   *   「여러 번 반복하면 더 이상 알려 주지 않는다」 같은 방어 동작 설명.
   *
   * ★ 그래서 **숫자로 못 박는다.** 「조심하자」 는 다음에 또 잊는다.
   *   판정 상수의 값이 내역에 글자로 나타나면 실패다. */
  let RL2 = null;
  try { RL2 = await import('../src/game/rules.js'); } catch (e) {
    ok(false, '규칙 모듈을 읽는다 (내역 검사용)', String((e && e.message) || e));
  }

  const clRaw = readFileSync(srcDir('data/changelog.js'), 'utf8');

  if (RL2) {
    /* 흘리면 안 되는 값들 — **판정에 쓰는 경계**다.
     * ★ 작은 수(3, 12 같은)는 아무 데나 나오므로 안 본다. 1000 이상만 본다.
     * ★ 골드 하루 한도(50만)는 **일부러 뺀다** — 그건 기능을 쓰려면 알아야 하는 규칙이다. */
    const secret = [
      ...(RL2.POWER_BY_LEVEL || []),
      RL2.POWER_CAP,
      ...Object.values(RL2.MEASURED_MAX || {}),
      5_000_000,          // 옛 POWER_CAP — 지금도 적으면 «예전엔 여기까지 됐다» 를 알려 준다
    ].filter((n) => Number.isFinite(n) && n >= 1000);

    const leaked = [];
    for (const n of new Set(secret)) {
      const raw = String(Math.round(n));
      const grouped = Number(raw).toLocaleString('en-US');
      if (clRaw.includes(raw)) leaked.push(`${raw} 가 그대로 적혀 있다`);
      else if (clRaw.includes(grouped)) leaked.push(`${grouped} 가 그대로 적혀 있다`);
    }
    okAll(leaked, '판정 경계값이 업데이트 내역에 안 적혀 있다', Math.max(1, new Set(secret).size));
  }

  /* ★ 「서버가 안 본다」 류는 **그 자체가 초대장**이다.
   *   실제로 「순위표의 편성·전력은 … 서버가 검증하지는 않는다」 가 적혀 있었다. */
  const invites = [];
  for (const bad of ['검증하지는 않는다', '검증하지 않는다', '서버가 안 본다', '검사하지 않는다']) {
    if (clRaw.includes(bad)) invites.push(`«${bad}» — 무엇이 안 막혀 있는지 알려 준다`);
  }
  okAll(invites, '내역이 «무엇을 안 본다» 를 알려 주지 않는다', 4);

  /* ★ 방어가 **어떻게** 도는지도 적으면 안 된다 (횟수·조건·동작).
   *   문구를 통째로 막으면 오탐이 나므로, «반복 + 알려 주지 않는다» 처럼 짝으로 본다. */
  const how = [];
  const pair = (a, b) => clRaw.includes(a) && clRaw.includes(b);
  if (pair('반복하면', '알려 주지 않는다')) how.push('반복 시 조용해지는 동작을 설명한다');
  if (pair('거절이 계속', '순위에 안 올라')) how.push('누적 거절이 어떻게 되는지 설명한다');
  if (clRaw.includes('찔러 보는')) how.push('«찔러 보기» 를 어떻게 막는지 설명한다');
  /* ★★ 제작자: 「이런것도 보여줄 필요는 없을것같네」 —
   *   **«검사를 한 겹 더 두었다» 자체가 신호다.** 어뷰징 대응은 내역에 아예 안 적는다.
   *   (플레이어가 **뭘 해야 하는** 경우만 예외다 — 예: 「부대를 다시 등록해라」)
   *   ★ 파일 머리말은 이 규칙을 설명하는 자리라 빼고 본다 — 안 그러면 규칙이 스스로 걸린다. */
  const clBody = decomment(clRaw);
  for (const w of ['판정 기준', '우회', '순위표에 안 올라', '검증을']) {
    if (clBody.includes(w)) how.push(`«${w}» — 어뷰징 대응은 내역에 안 적는다`);
  }
  okAll(how, '내역이 방어가 도는 방식을 설명하지 않는다', 7);
}

section('import 를 걷는 눈이 부수효과 import 를 놓치지 않는다');
{
  /* ★★ 왜 이 절이 있나 — **조용히 빠진 채로 배포될 뻔했다.**
   *
   *   공유 묶음(전투 엔진)은 손목록이 아니라 «진입점에서 import 를 따라 걷는다».
   *   그 «걷는 눈» 이 `syncshared.mjs` 와 여기 두 벌이었고, 그중 하나가 틀려 있었다:
   *
   *     /(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?['"]…['"]/
   *
   *   `?` 는 있는 쪽을 먼저 시도한다 → 게으른 `[\s\S]*?\sfrom` 이 **다음 줄까지 건너뛰어**
   *   `import './x.js';` 를 통째로 삼키고 그 아래 평범한 import 하나만 잡는다.
   *   부수효과 import 가 **혼자** 있으면 삼킬 대상이 없어 잡힌다 — 그래서 지금까지 조용했다.
   *
   *   놓친 파일은 서버에 복사되지 않는다. 그런데 도구는 «일치» 라고 말한다.
   *   ⇒ **형태별로 따로 본다.** 그리고 그 사실을 여기서 **실제로 굴려** 못 박는다.
   *
   * ★ 글자 검사가 아니라 **동작 검사**다. 정규식 모양이 바뀌어도, 답만 맞으면 통과다. */

  /** 한 판: 소스를 주고 나와야 할 것들을 확인한다 */
  function walkCase(label, src, want, forbid) {
    const got = importsOf(src);
    const miss = (want || []).filter((w) => !got.includes(w));
    const extra = (forbid || []).filter((f) => got.includes(f));
    ok(!miss.length && !extra.length, label,
      miss.length ? `놓쳤다: ${miss.join(', ')} (잡은 것: ${got.join(', ') || '없음'})`
        : `잡으면 안 되는 것을 잡았다: ${extra.join(', ')}`);
  }

  const NL = String.fromCharCode(10);

  /* ①  **이게 실제로 물던 자리다** — 부수효과 import 뒤에 평범한 import */
  walkCase('부수효과 import 다음에 평범한 import 가 와도 둘 다 잡는다',
    `import './side.js';${NL}import { a } from './norm.js';`,
    ['./side.js', './norm.js']);

  /* ② 혼자 있으면 예전 눈도 잡았다 — 그래서 조용했다. 여기서도 당연히 잡혀야 한다 */
  walkCase('부수효과 import 가 혼자 있어도 잡는다',
    `import './only.js';${NL}const x = 1;`, ['./only.js']);

  /* ③ 부수효과가 **연달아** 있는 경우 */
  walkCase('부수효과 import 가 연달아 있어도 전부 잡는다',
    `import './a.js';${NL}import './b.js';${NL}import { c } from './c.js';`,
    ['./a.js', './b.js', './c.js']);

  /* ④ 여러 줄 named import — 줄바꿈이 끼어도 from 을 놓치면 안 된다 */
  walkCase('여러 줄에 걸친 named import 를 잡는다',
    `import {${NL}  a,${NL}  b,${NL}} from './multi.js';`, ['./multi.js']);

  /* ⑤ 재수출 두 형태 */
  walkCase('export … from / export * from 을 잡는다',
    `export { a } from './re1.js';${NL}export * from './re2.js';`, ['./re1.js', './re2.js']);

  /* ⑥ 큰따옴표 · 동적 import */
  walkCase('큰따옴표와 동적 import 를 잡는다',
    `import { a } from "./dq.js";${NL}const m = await import('./dyn.js');`, ['./dq.js', './dyn.js']);

  /* ⑦ **주석 안의 import 는 파일을 끌고 오면 안 된다.**
   *   예전에 지웠던 import 를 주석으로 남겨 두는 일이 흔하다 — 그게 묶음을 부풀리면
   *   서버에 쓸데없는 파일이 실리고, 더 나쁘게는 ENGINE_HASH 가 흔들린다. */
  walkCase('주석 처리된 import 는 무시한다',
    `// import './dead.js';${NL}/* import './dead2.js'; */${NL}import { a } from './live.js';`,
    ['./live.js'], ['./dead.js', './dead2.js']);

  /* ⑧ CRLF 에서도 같아야 한다 — 이 저장소는 CRLF 다.
   *   §102 에서 «CRLF 라 정규식이 조용히 아무 일도 안 하는» 판을 실제로 겪었다. */
  const CR = String.fromCharCode(13);
  walkCase('CRLF 줄바꿈에서도 같게 잡는다',
    `import './side.js';${CR}${NL}import { a } from './norm.js';${CR}${NL}`,
    ['./side.js', './norm.js']);

  /* ⑨ **저장소의 진짜 파일로 확인한다.** 위 여덟은 내가 지어낸 소스라
   *   현실과 어긋날 수 있다. `src/ui/codex.js` 에 그 형태가 실재한다:
   *     import '../data/classes_t4.js';   ← 부수효과
   *     import { PETS, … } from '../data/pets.js';   ← 바로 다음 줄
   *   (아직 공유 묶음 밖이라 안 물렸을 뿐이다. 언젠가 들어오면 그날 조용히 빠진다.) */
  const codexSrc = readFileSync(srcDir('ui/codex.js'), 'utf8');
  const codexGot = importsOf(codexSrc);
  ok(codexSrc.includes("import '../data/classes_t4.js'"),
    '실물 확인 대상(codex.js)에 부수효과 import 가 아직 있다',
    '없어졌다면 이 검사의 근거가 사라진 것이다 — 다른 실물을 찾아 바꿔라');
  ok(codexGot.includes('../data/classes_t4.js') && codexGot.includes('../data/pets.js'),
    '실물 codex.js 에서 부수효과 import 와 그 다음 import 를 둘 다 잡는다',
    `잡은 것: ${codexGot.join(', ')}`);

  /* ⑩ **사본이 다시 생기지 않았나.** 이 병의 뿌리는 «두 벌» 이었다.
   *   누가 편하다고 지역 함수를 다시 만들면 그날부터 또 갈라진다. */
  const dupes = [];
  for (const rel of ['tools/syncshared.mjs', 'tools/smoke.mjs']) {
    const raw = readFileSync(join(rootDir, rel), 'utf8');
    const body = decomment(raw);
    if (!/from\s*['"][^'"]*lib\/imports\.mjs['"]/.test(body)) {
      dupes.push(`${rel} 이 lib/imports.mjs 를 안 쓴다`);
    }
    if (/function\s+(importsOf|specsOf|decomment)\s*\(/.test(body)) {
      dupes.push(`${rel} 이 걷는 눈을 스스로 또 만든다 — 사본이 둘이면 반드시 갈라진다`);
    }
  }
  okAll(dupes, '걷는 눈은 lib/imports.mjs 한 벌뿐이다', 4);
}

section('전력 계산이 게임 전체를 안 끌고 온다 — ambient 한 칸');
{
  /* ★★ 왜 이 절이 있나 — **서버가 전력을 스스로 계산하려면 필요했다** (§104 1단계).
   *
   *   `gear.js` · `merc.js` · `squad.js` 가 `state.js` 를 **되물고** 있었다.
   *   쓰는 것은 딱 하나 — 「첫 인자를 생략하면 전역 state 를 쓴다」 는 **편의 기본값**이다.
   *   그런데 `state.js` 는 quest·world·enemies·abyss·tower 까지 게임 전체를 문다.
   *
   *     전력 계산의 닫힘:  23개 · 774KB   →  15개 · 462KB
   *     (참고: 이미 배포 중인 전투 엔진 묶음이 9개 · 212KB)
   *
   *   ⇒ 편의 기본값 하나 때문에 게임 전체가 끌려오고 있었다. `game/ambient.js` 로 끊었다.
   *
   * ★ 이 절이 막는 것은 **조용한 되돌림**이다. 누가 편하다고 `state.js` 를 다시 물면
   *   그날 닫힘이 도로 774KB 가 되고, 서버로 못 가져간다 — 그런데 게임은 멀쩡히 돈다.
   *   숫자로 못 박는다. */

  const LIGHT = ['src/game/gear.js', 'src/game/merc.js', 'src/game/squad.js'];

  /* ① 되물기가 다시 생기지 않았나 */
  const back = [];
  for (const rel of LIGHT) {
    for (const spec of specsOf(readFileSync(join(rootDir, rel), 'utf8'))) {
      if (/(^|\/)state\.js$/.test(spec)) back.push(`${rel} 이 ${spec} 를 다시 문다`);
    }
  }
  okAll(back, '전력 모듈 셋이 state.js 를 되물지 않는다', LIGHT.length);

  /* ② 닫힘을 **수로** 본다. 무엇이 들어오면 안 되는지도 이름으로 못 박는다 —
   *   개수만 보면 «가벼운 파일 하나로 바꿔치기» 를 못 잡는다. */
  const POWER_CLOSURE = closureOf('src/game/squad.js')
    .concat(closureOf('src/game/merc.js'))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
  const HEAVY = ['src/game/state.js', 'src/game/quest.js', 'src/data/world.js',
    'src/data/enemies.js', 'src/data/abyss.js', 'src/data/tower.js', 'src/game/enemygen.js'];
  const dragged = HEAVY.filter((h) => POWER_CLOSURE.includes(h));
  okAll(dragged.map((h) => `${h} 가 끌려온다`), '무거운 것들이 전력 닫힘에 안 들어온다', HEAVY.length);

  /* ★ 20개는 «지금 15개» 에 여유를 둔 선이다. 늘리기 전에 무엇이 늘었는지 봐라 —
   *   서버 묶음으로 갈 목록이다. */
  ok(POWER_CLOSURE.length <= 20, '전력 닫힘이 가벼운 채로 남아 있다',
    `${POWER_CLOSURE.length}개: ${POWER_CLOSURE.join(', ')}`);

  /* ③ **묶는 쪽이 실제로 묶나.** 안 묶으면 `gs()` 가 조용히 null 이 되고
   *   화면이 «말없이 빈다» — 오류도 안 난다. 가장 무서운 실패다. */
  const stSrc = decomment(readFileSync(srcDir('game/state.js'), 'utf8'));
  ok(/bindAmbient\s*\(\s*\{[^}]*\bstate\b[^}]*\baddLog\b[^}]*\}\s*\)/.test(stSrc),
    'state.js 가 bindAmbient({ state, addLog }) 를 실제로 부른다',
    '부르는 곳이 없다 — gear·merc·squad 의 «인자 생략» 이 전부 null 이 된다');

  /* ④ **스냅샷 전제**: `state` 는 재대입이 없다.
   *   `export const` 이 아니게 되거나 어딘가에서 `state = …` 하면
   *   ambient 가 옛 객체를 붙들고 조용히 어긋난다. */
  ok(/export\s+const\s+state\s*=/.test(stSrc), 'state 는 export const 다 (재대입 금지)',
    'let 이 되면 ambient 스냅샷이 옛 객체를 붙든다');
  const reassign = stSrc.split(/\r?\n/)
    .filter((l) => /(^|[^.\w'"])state\s*=[^=>]/.test(l) && !/export\s+const\s+state\s*=/.test(l));
  okAll(reassign.map((l) => `재대입처럼 보인다: ${l.trim().slice(0, 70)}`),
    'state 에 재대입하는 곳이 없다', 1);

  /* ⑤ **굴려서 확인한다.** 위 넷은 전부 글자 검사다 — 글자가 맞아도 안 묶일 수 있다. */
  try {
    const ST = await import('../src/game/state.js');
    const AM = await import('../src/game/ambient.js');
    const GE = await import('../src/game/gear.js');
    const SQ = await import('../src/game/squad.js');

    ok(AM.ambientState() === ST.state, 'ambient 가 살아 있는 그 state 를 가리킨다',
      AM.ambientState() == null ? 'null 이다 — 안 묶였다' : '다른 객체다');

    /* 인자를 생략한 호출이 전역을 실제로 본다 */
    const probe = { uid: 'smoke-amb-1', baseId: 'x', slot: 'weapon', name: '스모크검' };
    ST.state.items.push(probe);
    ok(GE.itemFinder()('smoke-amb-1') === probe, 'gear.itemFinder() 가 인자 없이 전역을 찾는다');
    ST.state.items.pop();

    /* 일지 — ambientLog 가 state.addLog 에 닿나 */
    const n = ST.state.log.length;
    AM.ambientLog('스모크 한 줄');
    ok(ST.state.log.length === n + 1 && ST.state.log[0].text === '스모크 한 줄',
      'ambientLog 가 전역 일지에 닿는다', `${n} → ${ST.state.log.length}`);
    ST.state.log.shift();

    /* 전력이 실제로 «값» 을 낸다. ★ 0 을 통과로 세면 안 된다 —
     *   전에 0 대 0 을 비교해 놓고 통과라고 한 적이 있다. */
    ST.newGame(20260827, '스모크단');
    const sqId = ST.state.squads[0] && ST.state.squads[0].id;
    const pw = sqId ? SQ.squadPower(ST.state, sqId) : 0;
    ok(pw > 0, '끊은 뒤에도 부대 전력이 실제 값을 낸다 (0 은 통과가 아니다)', `전력 ${pw}`);
    SQ.stampSquadPower(ST.state);
    ok(ST.state.squads.every((q) => Number(q.power) > 0), 'stampSquadPower 가 값을 찍는다',
      ST.state.squads.map((q) => q.power).join(', '));
  } catch (e) {
    ok(false, 'ambient 를 굴려 본다', String((e && e.stack) || e).split(String.fromCharCode(10))[0]);
  }
}

section('SQL 이 부르면 죽는 모양을 갖고 있지 않은가');
{
  /* ★★ 왜 이 절이 있나 — `gold_send()` 가 **내놓은 날부터 부를 때마다 죽고 있었다.**
   *
   *     select count(*) into cnt from public.gold_gifts … for update;
   *     → ERR 0A000 : FOR UPDATE is not allowed with aggregate functions
   *
   *   PostgreSQL 은 집계와 잠금절을 같이 못 쓴다. 그런데 plpgsql 은 문장을
   *   **처음 실행할 때** 계획한다 — `create function` 은 멀쩡히 통과하고
   *   **부를 때만** 터진다. 프로덕션에서 확인했다: 부탁 4건 전부 `pending`,
   *   보내진 적 **0건**. 승낙이 한 번도 성공한 적이 없었다.
   *
   * ★★ 근본 원인은 **SQL 함수를 한 번도 실행해 본 적이 없다는 것**이다.
   *   로컬에 Postgres 가 없어서(§102.5) 실행 검사가 없다 — 그건 여전히 숙제다.
   *   그때까지 **이 형태만이라도** 글자로 막는다. 「만들어졌다」 는 증거가 아니다.
   *
   * ★ 판단부는 `tools/lib/sqllock.mjs` 다. 여기서는 ① 실제 파일에 대고 굴리고
   *   ② **지어낸 판으로 판단부 자체가 썩지 않았는지** 본다 (rlsjudge 와 같은 짜임새). */
  let SL = null;
  try { SL = await import('./lib/sqllock.mjs'); } catch (e) {
    ok(false, 'sqllock 판단부를 읽는다', String((e && e.message) || e));
  }

  if (SL) {
    /* ① 저장소의 SQL 전부 */
    const dbDir = join(rootDir, 'db');
    const sqls = existsSync(dbDir) ? readdirSync(dbDir).filter((f) => f.endsWith('.sql')) : [];
    ok(sqls.length >= 10, 'db/*.sql 을 찾았다', `${sqls.length}개`);
    const found = [];
    for (const f of sqls) {
      for (const p of SL.lockProblems(readFileSync(join(dbDir, f), 'utf8'))) {
        found.push(`db/${f}:${p.line} — ${p.forbidden} 와 ${p.lock} 이 같은 질의 층에 있다\n`
          + `        ${p.snippet}\n`
          + '        → PostgreSQL 이 0A000 으로 거절한다. 집계를 빼고 `perform … for update`'
          + ' + `get diagnostics … = row_count` 로 바꿔라 (db/014 참고)');
      }
    }
    okAll(found, 'SQL 에 잠금절이 못 붙는 자리가 없다', Math.max(1, sqls.length));

    /* ② 판단부가 실제로 무는가 — 지어낸 판으로 양쪽을 다 본다.
     *   ★ 「물어야 하는 것」만 보면 «전부 문다» 는 판단부도 통과한다. 반대쪽을 같이 본다. */
    const CASES = [
      ['우리를 문 그 문장', "select count(*) into cnt from g where id = p and status = 'x' for update;", true],
      ['group by + for update', 'select a from t group by a for update;', true],
      ['distinct + for update', 'select distinct a from t for update;', true],
      ['over() + for update', 'select row_number() over (order by a) from t for update;', true],
      ['union + for update', 'select a from t union select b from u for update;', true],
      ['하위질의 집계는 합법', 'select id from t where n = (select count(*) from u) for update;', false],
      ['perform + for update (고친 형태)', 'perform 1 from t where id = p for update;', false],
      ['컬럼 잠금 (pvp_claim 형태)', 'select day_used into v from r where user_id = p for update;', false],
      ['집계만, 잠금 없음', 'select count(*) into cnt from t where id = p;', false],
      ['주석 처리된 것', '-- select count(*) from t for update;\nselect 1;', false],
      ['문자열 리터럴 안', "select 'count(*) ... for update' as s;", false],
      ['두 문장으로 나뉘어 있으면', 'select count(*) from t; select 1 from u for update;', false],
    ];
    const wrong = [];
    for (const [label, sql, want] of CASES) {
      const got = SL.lockProblems(sql).length > 0;
      if (got !== want) wrong.push(`${label} — ${want ? '물어야 하는데 안 물었다' : '물면 안 되는데 물었다'}`);
    }
    okAll(wrong, '판단부가 무는 것과 안 무는 것을 가른다', CASES.length);
  }
}

/* ───────────────────────────── 결과 ───────────────────────────── */

report();
process.exit(failures.length ? 1 : 0);
