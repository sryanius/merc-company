/**
 * 전투 골든 픽스처 (node tools/goldenbattle.mjs [--update])
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 필요한가 — PvP 는 **서버가 전투를 돌려** 승패를 정한다. 그러려면
 *   «같은 입력 + 같은 시드 → 항상 같은 결과» 가 보장돼야 한다. 이게 깨지면
 *   서버가 정한 승패와 클라이언트가 재생한 화면이 어긋난다.
 *
 *   깨지는 길은 두 가지다:
 *   ① **런타임이 다르다** (서버는 Deno, 클라는 브라우저) — 부동소수·내장함수 차이
 *   ② **엔진이 바뀌었다** — 밸런스를 만지면 결과가 달라지는 게 당연하지만,
 *      «달라진 줄 모르고» 지나가면 안 된다.
 *
 *   그래서 고정 입력 × 고정 시드의 결과를 파일에 굳혀 두고 매번 대조한다.
 *   실측: Node 22 와 Deno 2.9 가 무작위 200판에서 지문까지 일치했다 (HANDOFF §68).
 *
 * ★ 밸런스를 **일부러** 고쳤으면 `--update` 로 다시 굳히고 커밋한다.
 *   그때 «몇 판이 달라졌나» 가 출력되니 의도한 만큼인지 눈으로 확인해라.
 *
 * ★ ENGINE_HASH — 엔진 의존 파일 전체를 접은 지문. `src/data/enginever.js` 로 생성한다.
 *   클라와 서버가 **같은 상수를 각자 import** 하므로 손으로 베낀 사본이 어긋날 일이 없다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'battle-golden.json');
const VERFILE = path.join(ROOT, 'src', 'data', 'enginever.js');

const update = process.argv.includes('--update');

/* ── FNV-1a 32bit — syncshared.mjs 와 같은 함수를 쓴다 (지문 규칙을 하나로) ── */
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ── 엔진 의존 파일 닫힘 — import 를 따라 끝까지 걷는다 ──────────────
 * ★ 손으로 적은 목록은 반드시 썩는다. 진입점만 적고 나머지는 스스로 걷는다. */
const ENTRY = ['src/battle/engine.js', 'src/data/skills.js', 'src/data/classes.js',
  'src/data/classes_t4.js', 'src/data/formations.js'];

function importsOf(src) {
  const out = [];
  const re = /(?:^|\n)\s*(?:import\s[^'"]*from\s*|import\s*|export\s[^'"]*from\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function closure(entries) {
  const seen = new Set();
  const stack = entries.slice();
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    seen.add(rel);
    const src = fs.readFileSync(abs, 'utf8');
    for (const spec of importsOf(src)) {
      if (!spec.startsWith('.')) continue;                 // 외부 모듈은 없다 (의존성 0)
      const next = path.relative(ROOT, path.resolve(path.dirname(abs), spec)).replace(/\\/g, '/');
      stack.push(next);
    }
  }
  return [...seen].sort();
}

function engineHash() {
  const files = closure(ENTRY);
  const blob = files.map((f) => f + '\n' + fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')).join('\n');
  return { hash: hash(blob), files };
}

/* ── 고정 편성 ────────────────────────────────────────────────────────
 *
 * ★★ **완성된 UnitDef 를 통째로 굳힌다** (클래스 id + 레벨만 적지 않는다).
 *   처음엔 `{c, l}` 만 적고 돌릴 때마다 다시 만들었는데, 거기에 `stats` 를 안 넣어서
 *   **엔진이 기본값(hp 100)으로 40판을 돌고 있었다** — 스탯 계산 경로를 아예 안 지났다
 *   (HANDOFF §73.5). 레벨을 0~20 바꿔도 승률이 전부 같게 나와서 들통났다.
 *
 *   완성본을 굳히면 두 가지가 같이 해결된다:
 *   ① 생성기와 서버 자가검사가 **같은 입력**을 재계산 없이 쓴다 (어긋날 자리가 없다)
 *   ② 실제 스탯·스킬로 도는 전투가 된다
 *
 * ★ 편성 세 벌: 근접 위주 · 원거리 위주(투사체 비행시간이 결과에 닿게) ·
 *   4차 클래스(스킬이 둘씩이라 스킬 경로가 실제로 돈다).
 */
const LINEUP_SPEC = {
  melee: {
    ally: [['swordsman', 30], ['shieldman', 28], ['archer', 32], ['apprentice', 26], ['acolyte', 24]],
    enemy: [['spearman', 29], ['rogue', 31], ['monk', 27], ['archer', 30], ['apprentice', 25]],
  },
  ranged: {
    ally: [['archer', 34], ['archer', 30], ['apprentice', 33], ['apprentice', 28], ['acolyte', 31]],
    enemy: [['archer', 32], ['apprentice', 34], ['acolyte', 29], ['shieldman', 35], ['rogue', 27]],
  },
  /* ★ 4차 — 스킬이 둘씩이라 스킬 선택·쿨다운 경로가 실제로 돈다 */
  apex: {
    ally: [['madgeneral_apex', 70], ['swordgod_apex', 68], ['skysplitter_apex', 72],
      ['archmage_apex', 66], ['paladin_apex', 64]],
    enemy: [['bloodfiend_apex', 69], ['madgeneral_abyss', 71], ['swordgod_abyss', 67],
      ['archmage_abyss', 70], ['paladin_abyss', 65]],
  },
};

const SEEDS = Array.from({ length: 20 }, (_, i) => 1 + i * 7717);

/**
 * 편성 규격을 **완성된 UnitDef** 로 굽는다.
 * ★ 여기서만 `mercStats` 를 쓴다 — 구운 결과는 픽스처에 들어가므로
 *   서버 자가검사는 이 함수를 몰라도 된다 (엔진 묶음에 merc.js 를 넣을 필요가 없다).
 */
async function bakeLineups() {
  const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
  const { getFormation } = await import(url('src/data/formations.js'));
  const CL = await import(url('src/data/classes.js'));
  await import(url('src/data/classes_t4.js'));
  const { mercStats } = await import(url('src/game/merc.js'));
  const f = getFormation('basic');

  const bake = (rows, side) => rows.map(([c, l], i) => {
    const cls = CL.CLASSES[c];
    if (!cls) throw new Error(`픽스처 편성에 없는 클래스: ${c}`);
    const stats = mercStats({ uid: `${side}${i}`, classId: c, level: l, grade: 'C', equipment: {} }, {});
    return {
      uid: `${side}${i}`, name: c, classId: c, level: l, grade: 'C',
      stats,
      side, slot: f.slots[i],
      basicRange: cls.range,
      basicDmgType: cls.dmgType,
      skills: cls.skills || [],
    };
  });

  const out = {};
  for (const [tag, spec] of Object.entries(LINEUP_SPEC)) {
    out[tag] = { ally: bake(spec.ally, 'ally'), enemy: bake(spec.enemy, 'enemy') };
  }
  return out;
}

async function runCases(lineups) {
  const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
  const { createBattle } = await import(url('src/battle/engine.js'));
  const { getSkill } = await import(url('src/data/skills.js'));

  const out = [];
  for (const [tag, lineup] of Object.entries(lineups)) {
    for (const seed of SEEDS) {
      const b = createBattle({
        allies: lineup.ally, enemies: lineup.enemy,
        allyFormationId: 'basic', enemyFormationId: 'basic', seed, getSkill, record: false,
      });
      let guard = 0;
      while (!b.finished && guard++ < 20000) b.step(1 / 60);
      const units = b.units || b.all || [];
      out.push({
        tag,
        seed,
        winner: b.winner ?? null,
        time: Number((b.time ?? 0).toFixed(3)),
        survivors: units.filter((u) => u.hp > 0).length,
        hpsum: Math.round(units.reduce((a, u) => a + Math.max(0, u.hp || 0), 0)),
      });
    }
  }
  return out;
}

const { hash: eh, files } = engineHash();
const lineups = await bakeLineups();
const cases = await runCases(lineups);

if (update) {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  let changed = 0;
  if (fs.existsSync(FIXTURE)) {
    try {
      const old = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
      for (const c of cases) {
        const o = (old.cases || []).find((x) => x.seed === c.seed && x.tag === c.tag);
        if (!o || o.winner !== c.winner || o.time !== c.time || o.survivors !== c.survivors || o.hpsum !== c.hpsum) changed++;
      }
    } catch { /* 처음 만드는 중 */ }
  }
  fs.writeFileSync(FIXTURE, JSON.stringify({ engineHash: eh, lineups, cases }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(VERFILE,
    '/* 자동 생성 — 손으로 고치지 마라. `node tools/goldenbattle.mjs --update` 가 쓴다.\n'
    + ' * 엔진 의존 파일 전체를 접은 지문. 클라와 서버가 **같은 상수를 각자 import** 한다.\n'
    + ` * 대상 ${files.length}개: ${files.join(', ')} */\n`
    + `export const ENGINE_HASH = '${eh}';\n`, 'utf8');
  console.log(`✅ 픽스처 ${cases.length}판 · ENGINE_HASH ${eh}`);
  console.log(`   달라진 판: ${changed} (의도한 만큼인지 확인해라)`);
  process.exit(0);
}

/* ── 검사 ── */
if (!fs.existsSync(FIXTURE)) {
  console.error('❌ 픽스처가 없다 — `node tools/goldenbattle.mjs --update` 로 만들어라');
  process.exit(1);
}
const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const faults = [];
for (const c of cases) {
  const o = (golden.cases || []).find((x) => x.seed === c.seed && x.tag === c.tag);
  if (!o) { faults.push(`${c.tag}/시드 ${c.seed}: 픽스처에 없다`); continue; }
  for (const k of ['winner', 'time', 'survivors', 'hpsum']) {
    if (o[k] !== c[k]) faults.push(`${c.tag}/시드 ${c.seed} ${k}: 픽스처 ${o[k]} vs 지금 ${c[k]}`);
  }
}
if (golden.engineHash !== eh) faults.push(`ENGINE_HASH: 픽스처 ${golden.engineHash} vs 지금 ${eh}`);

if (faults.length) {
  console.error(`❌ 전투 결과가 달라졌다 — ${faults.length}건`);
  for (const x of faults.slice(0, 12)) console.error('   · ' + x);
  console.error('   일부러 고쳤으면 `node tools/goldenbattle.mjs --update` 로 다시 굳히고 커밋해라.');
  process.exit(1);
}
console.log(`✅ 골든 픽스처 ${cases.length}판 일치 · ENGINE_HASH ${eh}`);
