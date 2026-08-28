/**
 * 서버(Edge Function)로 소스를 복사한다 — **묶음(bundle) 단위**
 * ────────────────────────────────────────────────────────────────
 *
 * ★ 왜 복사인가
 *   Supabase Edge Function 은 `supabase/functions/` 아래만 배포한다.
 *   그 밖의 상대 경로(`../../src/...`)가 번들되는지는 보장이 없어서,
 *   필요한 파일을 함수 디렉터리 안으로 **그대로** 옮겨 둔다.
 *
 * ★ 복사본은 반드시 썩는다. 그래서 원본의 해시를 같이 적어 두고,
 *   `tools/smoke.mjs` 가 어긋나면 **실패한다.** 밸런스를 고치고 재배포를 안 하면
 *   테스트가 먼저 터진다 — 조용히 어긋나는 것만은 막는다.
 *
 * ★ 이건 "빌드"가 아니라 **배포 절차**다. 게임 클라이언트는 여전히 빌드 없이 뜬다.
 *
 * ════════════════════════════════════════════════════════════════
 * ★★ 왜 «묶음» 인가 (PvP 를 만들며 바꿨다 — HANDOFF §69)
 *
 *   예전엔 파일 목록이 **전역 하나**였고 허용 집합도 하나였다. 거기에 전투 엔진을
 *   더하는 순간 두 가지가 무너진다:
 *   ① `_shared` 의 «의존성 0» 계약이 사라진다 — rules.js 가 engine.js 를 물어도 통과하게 된다.
 *   ② basename 으로 평탄화하는데 저장소에 `src/data/abyss.js` 와 `src/game/abyss.js` 가
 *      **둘 다 실재한다.** 목록이 길어지면 조용한 덮어쓰기가 실제로 일어난다.
 *
 *   그래서 묶음마다 **자기 허용 집합**을 갖고, **같은 묶음 안의 basename 충돌은 실패**다.
 *
 * ★★ 손목록은 썩는다 — 엔진 묶음은 **진입점만 적고 import 를 따라 스스로 걷는다.**
 *   (`_shared` 는 «이 목록 밖을 물면 안 된다» 가 계약 자체라 손목록을 유지한다.)
 *
 * 실행: node tools/syncshared.mjs        (복사 + 해시 기록)
 *       node tools/syncshared.mjs --check (검사만 — 스모크가 쓴다)
 */
import { BUNDLES, closureOf, ROOT } from './lib/bundles.mjs';
import { importsOf } from './lib/imports.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


/* ★ 묶음의 정의와 걷는 방식은 `tools/lib/bundles.mjs` 한 벌이다 —
 *   `tools/smoke.mjs` 도 **같은 것**을 읽어서 세 묶음을 전부 잰다. */

/** FNV-1a 32bit */
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}



const check = process.argv.includes('--check');
const problems = [];
const summary = [];

for (const b of BUNDLES) {
  const OUT = path.join(ROOT, b.dest);
  const files = b.walk ? closureOf(b.entry, problems) : b.entry.slice();

  /* ★ 같은 묶음 안에서 basename 이 겹치면 **실패한다.** 평탄화가 조용히 덮어쓰던 자리다. */
  const byBase = new Map();
  for (const rel of files) {
    const base = path.basename(rel);
    if (byBase.has(base)) {
      problems.push(`[${b.name}] 이름이 겹친다: ${byBase.get(base)} 와 ${rel}\n`
        + '      → 한 폴더로 평탄화하므로 하나가 덮어써진다. 파일 이름을 다르게 해라');
    }
    byBase.set(base, rel);
  }

  const manifest = {};
  const allowed = new Set(files.map((f) => path.basename(f)));

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { problems.push(`${rel} 이 없다`); continue; }
    const src = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');

    /* 묶음 밖 모듈을 물면 서버에서 못 쓴다. walk 묶음은 닫힘을 이미 걸었으니 자동으로 통과한다 —
     * 이 검사가 진짜 일을 하는 곳은 «목록이 곧 계약» 인 _shared 다. */
    for (const dep of importsOf(src)) {
      if (!dep.startsWith('.')) continue;
      if (!allowed.has(path.basename(dep))) {
        problems.push(`[${b.name}] ${rel} 이 묶음 밖 모듈을 import 한다: ${dep}\n`
          + `      → 그 모듈도 이 묶음에 넣거나, 쓰는 상수를 data/limits.js 로 옮겨라`);
      }
    }

    manifest[rel] = hash(src);

    if (!check) {
      // 서로를 참조하는 경로를 평평하게 만든다 (묶음 하나를 한 폴더에 둔다)
      const flat = src.replace(/from\s*['"](\.\.?\/[^'"]+)['"]/g, (m0, p) => `from './${path.basename(p)}'`)
        .replace(/(^|[\s;])import\s*['"](\.\.?\/[^'"]+)['"]/gm, (m0, pre, p) => `${pre}import './${path.basename(p)}'`);
      fs.mkdirSync(OUT, { recursive: true });
      const dest = path.join(OUT, path.basename(rel));
      fs.writeFileSync(dest, flat, 'utf8');
      /* ★★ **써 놓고 되읽는다.**
       *   한 번 이런 일이 있었다: 이 도구가 «복사했다» 고 해시까지 찍었는데
       *   복사본은 옛 내용 그대로였고, 그 상태로 Edge Function 을 배포했다.
       *   서버는 옛 규칙으로 판정하는데 도구는 성공이라고 말한 것이다. */
      const back = fs.readFileSync(dest, 'utf8');
      if (back !== flat) problems.push(`${rel} 을 썼는데 되읽은 내용이 다르다 (복사 실패)`);
    }
  }

  /* 곁들이 데이터 파일 (픽스처 등).
   *
   * ★★ **JSON 을 그대로 옮기면 안 된다.** Supabase Edge Function 은 **JS 모듈만 번들한다** —
   *   .json 은 업로드조차 안 되고, 배포된 함수가 읽으려 하면
   *   `path not found: .../battle-golden.json` 으로 죽는다. 실제로 겪었다 (HANDOFF §77.2).
   *   그래서 **JS 모듈로 감싸서** 옮긴다: `export default { … }`.
   *
   * ★ 원본은 여전히 .json 이다 — 사람이 읽고 diff 하기 좋아야 하니까. 변환은 여기서만 한다. */
  for (const rel of b.extra || []) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { problems.push(`${rel} 이 없다`); continue; }
    const src = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    manifest[rel] = hash(src);
    if (!check) {
      fs.mkdirSync(OUT, { recursive: true });
      const base = path.basename(rel);
      const isJson = base.endsWith('.json');
      const destName = isJson ? base.replace(/\.json$/, '.js') : base;
      const body = isJson
        ? `/* 자동 생성 — 원본은 ${rel}. Edge Function 은 JS 모듈만 번들해서 감싸 둔다. */\nexport default ${src.trim()};\n`
        : src;
      const dest = path.join(OUT, destName);
      fs.writeFileSync(dest, body, 'utf8');
      if (fs.readFileSync(dest, 'utf8') !== body) problems.push(`${rel} 복사 실패`);
      /* 옛 .json 사본이 남아 있으면 지운다 — 배포 번들에 쓰레기를 남기지 않는다 */
      const stale = path.join(OUT, base);
      if (isJson && fs.existsSync(stale)) fs.rmSync(stale);
    }
  }

  const manifestPath = path.join(OUT, 'HASHES.json');
  if (check) {
    if (!fs.existsSync(manifestPath)) {
      problems.push(`[${b.name}] HASHES.json 이 없다 — \`node tools/syncshared.mjs\` 를 먼저 돌려라`);
    } else {
      let old = {};
      try { old = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { old = {}; }
      for (const [rel, h] of Object.entries(manifest)) {
        if (old[rel] !== h) {
          problems.push(`[${b.name}] ${rel} 이 복사본과 다르다 (원본 ${h} / 복사본 ${old[rel] || '없음'})\n`
            + '      → 고쳤으면 `node tools/syncshared.mjs` 로 다시 복사하고\n'
            + `        \`${b.next}\` 로 재배포해라`);
        }
      }
      /* 복사본에만 남아 있는 파일 — 진입점에서 빠졌는데 서버에는 옛 파일이 남은 상태 */
      for (const rel of Object.keys(old)) {
        if (!(rel in manifest)) problems.push(`[${b.name}] ${rel} 이 더 이상 필요 없는데 복사본에 남아 있다`);
      }
    }
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  summary.push({ b, files, extra: (b.extra || []).length });
}

if (problems.length) {
  console.log(`❌ ${check ? '공유 소스가 어긋났다' : '복사 실패'}\n   ` + problems.join('\n   '));
  process.exit(1);
}

if (check) {
  console.log(`✅ 공유 소스 일치 — ${summary.map((s) => `${s.b.name} ${s.files.length + s.extra}개`).join(' · ')}`);
} else {
  for (const s of summary) {
    console.log(`✅ [${s.b.name}] ${s.files.length + s.extra}개 → ${s.b.dest}/`);
    for (const rel of s.files) console.log(`     ${rel}`);
  }
  console.log('\n다음: ' + BUNDLES.map((b) => b.next).join('  /  '));
}
