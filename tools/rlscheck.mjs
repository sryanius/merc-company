/**
 * RLS 전수 확인 — 「공개 키로 읽히는 테이블이 하나도 없는가」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 상설 도구인가: 이 Supabase 프로젝트는 **다른 앱과 공유한다**
 *   (침묵의 기록자, `tsa_*`). anon 키도 같이 공유되고, 이 게임의 anon 키는
 *   저장소에 공개돼 있다. 그래서 **어느 쪽이든 RLS 없는 테이블을 만들면
 *   양쪽 모두에게 열린다.** 명령을 문서에 적어 두는 것만으로는 안 돌리게 된다.
 *
 * ★ 판단은 `tools/lib/rlsjudge.mjs` 가 한다 — 스모크가 DB 없이 같은 함수를 굴려 본다.
 *   여기서는 **조회만** 한다.
 *
 * 사용: node tools/rlscheck.mjs
 *   (`npx supabase link` 가 되어 있어야 한다. 로그인 토큰은 Windows 자격 증명에 있다.)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { judgeTables, RLS_SQL, GAME_TABLES, KNOWN_FOREIGN } from './lib/rlsjudge.mjs';

function fetchRows() {
  const dir = mkdtempSync(join(tmpdir(), 'rlscheck-'));
  const f = join(dir, 'rls.sql');
  writeFileSync(f, RLS_SQL, 'utf8');
  let out = '';
  try {
    out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', f],
      { encoding: 'utf8', shell: true, maxBuffer: 16 * 1024 * 1024 });
  } finally {
    try { unlinkSync(f); } catch { /* 지워지든 말든 */ }
  }
  const at = out.indexOf('{');
  if (at < 0) throw new Error(`조회 결과를 못 읽었다: ${out.slice(0, 200)}`);
  const res = JSON.parse(out.slice(at));
  const row = Array.isArray(res.rows) ? res.rows[0] : null;
  const data = row && (typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
  if (!data) throw new Error('조회 결과에 data 가 없다');
  return data;
}

let data;
try {
  data = fetchRows();
} catch (e) {
  console.log(`✗ 조회에 실패했다 — ${String((e && e.message) || e)}`);
  console.log('  `npx supabase link --project-ref <ref>` 가 되어 있는지 보라.');
  process.exit(2);
}

const { fatal, warn, seen } = judgeTables(data.tables, data.policies, data.buckets, data.storage_policies);

console.log('public 테이블');
for (const t of data.tables) {
  const owner = GAME_TABLES.includes(t.tbl) ? '용병단'
    : (KNOWN_FOREIGN.find((f) => t.tbl.startsWith(f.prefix)) || {}).owner || '???';
  console.log(`  ${t.tbl.padEnd(22)} RLS ${t.rls_on ? '켜짐' : '꺼짐'}  정책 ${String(t.policies).padStart(2)}   ${owner}`);
}
console.log('');
console.log('Storage 버킷');
for (const b of (data.buckets || [])) {
  console.log(`  ${String(b.id).padEnd(22)} ${b.is_public ? 'public(누구나)' : 'private'}`);
}
for (const p of (data.storage_policies || [])) {
  console.log(`  정책 ${String(p.policyname).padEnd(18)} ${String(p.roles).padEnd(18)} ${p.qual || p.with_check || ''}`);
}
console.log('');
console.log(`용병단 ${seen.game}개 · 남의 것 ${seen.foreign}개 · 모르는 것 ${seen.unknown.length}개`);
console.log('');

for (const w of warn) console.log(`⚠ ${w}`);
for (const f of fatal) console.log(`✗ ${f}`);
if (!fatal.length && !warn.length) console.log('✓ 전부 RLS 켜짐 · 조건 없이 열린 정책 없음');
else if (!fatal.length) console.log('');

process.exitCode = fatal.length ? 1 : 0;
