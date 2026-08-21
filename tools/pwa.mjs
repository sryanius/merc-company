// PWA 설치 요건 검증 — 헤드리스. 실패 시 exit 1. (12차 세션 신설)
//
// 배포 위치가 `https://sryanius.github.io/merc-company/` 라 **도메인 루트가 아니다.**
// 그래서 이 검사의 절반은 "경로가 전부 상대 경로인가" 다. 절대 경로(`/src/...`)를 하나라도
// 쓰면 배포본에서 404 가 난다 — 로컬(루트 서빙)에서는 멀쩡히 돌아가서 눈치채지 못한다.
//
//   node tools/pwa.mjs
//   node tools/pwa.mjs --verbose
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fails = 0, checks = 0;
function check(ok, label, detail) {
  checks++;
  if (!ok) fails++;
  if (!ok || VERBOSE) console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
}
const head = (s) => console.log(`\n── ${s}`);

console.log('용병단 — PWA 설치 요건 검증');
console.log('='.repeat(64));

/* ─────────────────────────────── 1. manifest */
head('1. manifest.webmanifest');
let mf = null;
check(exists('manifest.webmanifest'), 'manifest.webmanifest 존재');
try {
  mf = JSON.parse(rd('manifest.webmanifest'));
  check(true, '유효한 JSON');
} catch (e) {
  check(false, '유효한 JSON', String(e.message));
}
if (mf) {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'orientation', 'icons']) {
    check(mf[k] != null && mf[k] !== '', `필수 필드 ${k}`, JSON.stringify(mf[k]).slice(0, 60));
  }
  check(mf.display === 'standalone' || mf.display === 'fullscreen',
    `display = ${mf.display}`, '브라우저 껍데기로 뜨지 않으려면 standalone');
  check(String(mf.orientation).startsWith('portrait'),
    `orientation = ${mf.orientation}`, '세로 고정 (플레이어 요청)');
  // ★ 하위 경로 배포 — 절대 경로면 배포본에서 전부 404
  for (const k of ['start_url', 'scope']) {
    check(String(mf[k]).startsWith('./') || !String(mf[k]).startsWith('/'),
      `${k} 가 상대 경로`, `${mf[k]} (도메인 루트가 아니다)`);
  }
  const icons = Array.isArray(mf.icons) ? mf.icons : [];
  const has = (sz, purpose) => icons.some((i) => String(i.sizes).split(' ').includes(sz)
    && String(i.purpose || 'any').split(' ').includes(purpose));
  check(has('192x192', 'any'), '아이콘 192x192 any');
  check(has('512x512', 'any'), '아이콘 512x512 any');
  check(has('192x192', 'maskable') || has('512x512', 'maskable'), 'maskable 아이콘');
  for (const i of icons) {
    check(!String(i.src).startsWith('/'), `아이콘 경로가 상대 경로 (${i.src})`);
  }
}

/* ─────────────────────────────── 2. 아이콘 파일 */
head('2. 아이콘 PNG');
/** PNG 헤더를 직접 읽는다 (외부 의존성 0). 시그니처 + IHDR 의 폭/높이/색타입 */
function pngInfo(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  const sig = b.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  const ihdr = b.slice(12, 16).toString() === 'IHDR';
  return {
    ok: sig && ihdr, bytes: b.length,
    w: b.readUInt32BE(16), h: b.readUInt32BE(20),
    depth: b[24], colorType: b[25],
  };
}
for (const i of (mf && mf.icons) || []) {
  const rel = String(i.src).replace(/^\.\//, '');
  if (!exists(rel)) { check(false, `${rel} 존재`); continue; }
  const p = pngInfo(rel);
  const [w, h] = String(i.sizes).split('x').map(Number);
  check(p.ok, `${rel} 이 유효한 PNG`, `${p.bytes}B`);
  check(p.w === w && p.h === h, `${rel} 크기 ${p.w}x${p.h}`, `manifest 는 ${i.sizes}`);
  // maskable 은 배경이 불투명해야 마스크가 씌워졌을 때 구멍이 안 뚫린다.
  // 색타입 6(RGBA)이어도 알파가 전부 255 면 된다 — tools/icons.mjs 가 그렇게 굽는다.
  check(p.depth === 8, `${rel} 8bit`, `depth=${p.depth} colorType=${p.colorType}`);
}
// iOS 는 manifest 를 무시하고 apple-touch-icon 을 본다
check(exists('icons/apple-touch-icon.png'), 'icons/apple-touch-icon.png (iOS 전용)');

/* ─────────────────────────────── 3. index.html 배선 */
head('3. index.html 배선');
const html = rd('index.html');
check(/<link[^>]+rel=["']manifest["'][^>]+href=["']\.\/manifest\.webmanifest["']/.test(html),
  'manifest 링크가 상대 경로');
check(/rel=["']apple-touch-icon["']/.test(html), 'apple-touch-icon 링크');
check(/name=["']apple-mobile-web-app-capable["'][^>]+content=["']yes["']/.test(html),
  'apple-mobile-web-app-capable (iOS 홈 화면 standalone)');
check(/viewport-fit=cover/.test(html), 'viewport-fit=cover (노치 대응)');
check(/register\(\s*['"]\.\/sw\.js['"]\s*\)/.test(html), '서비스 워커를 상대 경로로 등록');
// ★ 개발 캐시 함정 방지 — http(로컬)에서는 등록하지 않는다
check(/location\.protocol\s*!==\s*['"]https:['"]/.test(html),
  'https 에서만 서비스 워커를 등록 (로컬 개발 캐시 함정 방지)');

/* ─────────────────────────────── 4. sw.js */
head('4. sw.js');
const swSrc = rd('sw.js');
// 문법: 함수로 감싸 파싱만 시킨다 (실행하지 않는다)
try { new Function(swSrc); check(true, '문법 오류 없이 파싱'); }
catch (e) { check(false, '문법 오류 없이 파싱', String(e.message)); }
check(!/^\s*import\s/m.test(swSrc), 'ES import 없음 (클래식 워커 스크립트다)');
check(/addEventListener\(\s*['"]fetch['"]/.test(swSrc), 'fetch 핸들러 (설치 가능 요건)');
check(/addEventListener\(\s*['"]install['"]/.test(swSrc), 'install 핸들러');
check(/addEventListener\(\s*['"]activate['"]/.test(swSrc), 'activate 핸들러');

const mShell = /const APP_SHELL\s*=\s*\[([\s\S]*?)\];/.exec(swSrc);
check(!!mShell, 'APP_SHELL 목록을 찾음');
const shell = mShell ? [...mShell[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const mCache = /const CACHE\s*=\s*'([^']+)'/.exec(swSrc);
check(!!mCache, `캐시 버전 ${mCache ? mCache[1] : '?'}`, '배포할 때마다 올려야 폰에 반영된다');

// (a) 목록의 모든 경로가 상대 경로인가
check(shell.every((p) => p.startsWith('./')), '캐시 목록이 전부 상대 경로',
  shell.filter((p) => !p.startsWith('./')).join(', ') || '');
// (b) 목록의 파일이 **실제로 존재**하는가 — 없으면 install 이 그 항목만 실패하고 오프라인에서 죽는다
const missing = shell.filter((p) => p !== './' && !exists(p.replace(/^\.\//, '')));
check(missing.length === 0, `캐시 목록의 파일이 전부 실재 (${shell.length}건)`, missing.join(', '));
// (c) src 아래 모든 모듈이 목록에 들어 있는가 — 빠지면 오프라인 첫 실행에서 죽는다
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(`./${p}`);
  }
  return out;
};
const mods = walk('src');
const notListed = mods.filter((f) => !shell.includes(f));
check(notListed.length === 0, `src 모듈 ${mods.length}개가 전부 캐시 목록에 있음`, notListed.join(', '));
// (d) index.html 이 참조하는 정적 자산도 들어 있는가
for (const need of ['./index.html', './manifest.webmanifest', './css/style.css', './src/main.js']) {
  check(shell.includes(need), `캐시 목록에 ${need}`);
}
// (e) 개발 도구는 캐시하지 않는다
check(!shell.some((p) => p.startsWith('./tools/')), 'tools/ 는 캐시 목록에 없음');
check(/'\/tools\/'/.test(swSrc) === false || /pathname\.includes\('\/tools\/'\)/.test(swSrc),
  'fetch 핸들러가 tools/ 를 건너뛴다 (하위 경로라 startsWith 로 쓰면 안 된다)');

/* ─────────────────────────────── 5. 개발 서버 MIME */
head('5. 개발 서버');
const serve = rd('tools/serve.mjs');
check(/\.webmanifest/.test(serve), 'serve.mjs 가 .webmanifest MIME 을 안다',
  '없으면 개발 중에만 매니페스트가 무시된다');

head('6. 캐시 버전이 소스보다 낡지 않았나');
/* ★★ 실제로 두 번 밟은 함정이다.
 *   서비스워커는 `CACHE` 이름으로 캐시를 통째로 가른다. 소스를 고치고 배포하면서
 *   버전을 안 올리면, **이미 방문한 사람에게는 옛 파일이 그대로 나간다.**
 *   새 사람만 새 게임을 보고 기존 사용자는 «아무것도 안 바뀌었다» 고 느낀다.
 *
 * ★ git 으로 판단한다 — sw.js 를 마지막으로 건드린 커밋 이후에
 *   src/ 나 index.html 이 바뀌었으면 버전을 안 올린 것이다.
 *   (커밋 안 된 작업 중 변경은 세지 않는다. 배포 직전에만 의미가 있다.) */
try {
  const last = execSync('git log -1 --format=%H -- sw.js', { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!last) {
    check(true, 'sw.js 이력 없음 — 건너뜀', '');
  } else {
    const changed = execSync(`git diff --name-only ${last} HEAD -- src index.html`, { cwd: ROOT, encoding: 'utf8' })
      .split(String.fromCharCode(10)).map((v) => v.trim()).filter(Boolean);
    check(changed.length === 0,
      'sw.js 를 마지막으로 고친 뒤 소스가 안 바뀌었다 (= 캐시 버전이 최신)',
      changed.length ? `${changed.length}개 파일이 그 뒤에 바뀌었다 — sw.js 의 CACHE 를 올려라: ${changed.slice(0, 5).join(', ')}` : '');
  }
} catch (e) {
  check(true, 'git 을 못 읽어 건너뜀', String(e.message || e).slice(0, 60));
}

/* ─────────────────────────────── 결과 */
console.log(`\n${'─'.repeat(64)}`);
if (fails) {
  console.log(`❌ ${fails}건 실패 / 검사 ${checks}건`);
  process.exit(1);
}
console.log(`✅ 전부 통과 — 검사 ${checks}건`);
