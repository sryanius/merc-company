/**
 * 검증 규칙을 Edge Function 쪽으로 복사한다
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
 * 실행: node tools/syncshared.mjs        (복사 + 해시 기록)
 *       node tools/syncshared.mjs --check (검사만 — 스모크가 쓴다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'supabase', 'functions', '_shared');

/**
 * 복사할 파일.
 * ★ 전부 **import 가 0이거나 이 목록 안만 참조**해야 한다. 아래에서 검사한다 —
 *   게임 전체를 서버로 끌고 가면 배포가 느려지고 Deno 에서 깨질 여지가 생긴다.
 */
const FILES = [
  'src/data/limits.js',
  'src/data/abyss.js',
  'src/data/tower.js',
  'src/game/rules.js',
];

/** FNV-1a 32bit */
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 이 파일이 어떤 모듈을 import 하는가 (상대 경로만) */
function importsOf(src) {
  return [...src.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
}

const check = process.argv.includes('--check');
const problems = [];
const manifest = {};
const allowed = new Set(FILES.map((f) => path.basename(f)));

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { problems.push(`${rel} 이 없다`); continue; }
  const src = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');

  // 의존성 검사 — 목록 밖 모듈을 물면 서버에서 못 쓴다
  for (const dep of importsOf(src)) {
    const name = path.basename(dep);
    if (!allowed.has(name)) {
      problems.push(`${rel} 이 목록 밖 모듈을 import 한다: ${dep}\n`
        + `      → 그 모듈도 FILES 에 넣거나, 쓰는 상수를 data/limits.js 로 옮겨라`);
    }
  }

  manifest[rel] = hash(src);

  if (!check) {
    // 서로를 참조하는 경로를 평평하게 만든다 (전부 _shared 한 폴더에 둔다)
    const flat = src.replace(/from\s+'(\.\.?\/[^']+)'/g, (m, p) => `from './${path.basename(p)}'`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, path.basename(rel)), flat, 'utf8');
  }
}

const manifestPath = path.join(OUT, 'HASHES.json');

if (check) {
  if (!fs.existsSync(manifestPath)) {
    problems.push('HASHES.json 이 없다 — `node tools/syncshared.mjs` 를 먼저 돌려라');
  } else {
    let old = {};
    try { old = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { old = {}; }
    for (const [rel, h] of Object.entries(manifest)) {
      if (old[rel] !== h) {
        problems.push(`${rel} 이 복사본과 다르다 (원본 ${h} / 복사본 ${old[rel] || '없음'})\n`
          + '      → 게임 규칙을 고쳤으면 `node tools/syncshared.mjs` 로 다시 복사하고\n'
          + '        `supabase functions deploy submit-score` 로 재배포해라');
      }
    }
  }
  if (problems.length) {
    console.log('❌ 공유 규칙이 어긋났다\n   ' + problems.join('\n   '));
    process.exit(1);
  }
  console.log(`✅ 공유 규칙 일치 — ${FILES.length}개 파일`);
} else {
  if (problems.length) {
    console.log('❌ 복사 실패\n   ' + problems.join('\n   '));
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`✅ ${FILES.length}개 파일을 supabase/functions/_shared/ 로 복사했다`);
  for (const [rel, h] of Object.entries(manifest)) console.log(`   ${h}  ${rel}`);
  console.log('\n다음: supabase functions deploy submit-score');
}
