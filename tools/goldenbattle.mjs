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

/* ── 고정 편성 — 픽스처 안에 입력까지 함께 굳힌다 (파일 하나로 재현된다)
 *
 * ★ **두 벌**을 쓴다. 처음엔 근접 위주 한 벌만 뒀는데, 메타 검사에서
 *   `PROJ_SPEED`(투사체 속도)를 바꿔도 **20판 결과가 하나도 안 달라졌다** —
 *   행동 검사가 그 축을 아예 안 건드리고 있었다는 뜻이다.
 *   원거리·주문 위주 한 벌을 더해 투사체 비행시간이 결과에 닿게 만든다.
 *
 * ★ 이 «달라진 판 수» 는 --update 때 «내가 의도한 만큼만 바뀌었나» 를 보는 눈이다.
 *   눈이 멀면 0 이라는 거짓 안심을 준다. */
const LINEUPS = {
  melee: {
    ally: [
      { c: 'swordsman', l: 30 }, { c: 'shieldman', l: 28 }, { c: 'archer', l: 32 },
      { c: 'apprentice', l: 26 }, { c: 'acolyte', l: 24 },
    ],
    enemy: [
      { c: 'spearman', l: 29 }, { c: 'rogue', l: 31 }, { c: 'monk', l: 27 },
      { c: 'archer', l: 30 }, { c: 'apprentice', l: 25 },
    ],
  },
  ranged: {
    ally: [
      { c: 'archer', l: 34 }, { c: 'archer', l: 30 }, { c: 'apprentice', l: 33 },
      { c: 'apprentice', l: 28 }, { c: 'acolyte', l: 31 },
    ],
    enemy: [
      { c: 'archer', l: 32 }, { c: 'apprentice', l: 34 }, { c: 'acolyte', l: 29 },
      { c: 'shieldman', l: 35 }, { c: 'rogue', l: 27 },
    ],
  },
};
const SEEDS = Array.from({ length: 20 }, (_, i) => 1 + i * 7717);

async function runCases() {
  const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
  const { createBattle } = await import(url('src/battle/engine.js'));
  const { getSkill } = await import(url('src/data/skills.js'));
  const { getFormation } = await import(url('src/data/formations.js'));
  const CL = await import(url('src/data/classes.js'));
  await import(url('src/data/classes_t4.js'));
  const f = getFormation('basic');

  const side = (lineup, key) => lineup[key].map((u, i) => ({
    uid: `${key}${i}`, name: u.c, classId: u.c, level: u.l, grade: 'C',
    side: key, slot: f.slots[i], basicRange: CL.CLASSES[u.c] ? CL.CLASSES[u.c].range : 'melee',
  }));

  const out = [];
  for (const [tag, lineup] of Object.entries(LINEUPS)) {
    for (const seed of SEEDS) {
      const b = createBattle({
        allies: side(lineup, 'ally'), enemies: side(lineup, 'enemy'),
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
const cases = await runCases();

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
  fs.writeFileSync(FIXTURE, JSON.stringify({ engineHash: eh, lineups: LINEUPS, cases }, null, 2) + '\n', 'utf8');
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
