/**
 * 「이 소스가 어떤 모듈을 참조하는가」 — **한 벌만 둔다**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 이 파일이 따로 있는 이유: 같은 판단이 **두 벌**이었다.
 *   `tools/syncshared.mjs` 의 `importsOf` 와 `tools/smoke.mjs` 의 `specsOf`.
 *   그리고 그중 하나가 틀려 있었다 — 사본이 둘이면 반드시 갈라진다 (§94·§98 과 같은 병).
 *
 * ★★ 무엇이 틀렸었나: **`from` 을 optional 로 둔 정규식 하나로 훑으면
 *   부수효과 import 를 놓친다.**
 *
 *     /(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?['"]…['"]/
 *
 *   `?` 는 «있는 쪽» 을 먼저 시도한다. 그래서 게으른 `[\s\S]*?\sfrom` 이
 *   **다음 줄까지 건너뛰어** `import './x.js';` 를 통째로 삼키고,
 *   그 아래 평범한 import 하나만 잡고 끝난다.
 *
 *   실측:
 *     `import './side.js';` + 다음 줄 평범한 import  → **side.js 를 놓친다**
 *     `import './side.js';` 혼자                     → 잡힌다 (삼킬 대상이 없어서)
 *   후자 때문에 지금까지 조용했다. 저장소에 이미 그 형태가 있다 —
 *   `src/ui/{codex,lineupview,pvpreplay}.js` 의 `import '../data/classes_t4.js';`
 *   (아직 공유 묶음 밖이라 안 물렸을 뿐이다.)
 *
 *   ⇒ 놓치면 그 파일이 **조용히 빠진 채 배포된다.** 형태마다 따로 본다.
 *
 * @module tools/lib/imports
 */

/**
 * 주석을 지운다 — 주석 안의 import 가 파일을 끌고 오면 안 된다.
 *
 * ★ 문자 단위로 훑는다. 정규식(`/--.*$/` 류)으로 하면 **CRLF 에서 조용히 아무 일도 안 한다**
 *   (`.` 이 `\r` 을 안 먹어 `$` 앵커가 영영 안 맞는다 — §102 에서 실제로 겪었다).
 */
export function decomment(x) {
  let out = '';
  let i = 0;
  const s = String(x == null ? '' : x);
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (s[i] === '/' && s[i + 1] === '/') { const e = s.indexOf(String.fromCharCode(10), i); i = e < 0 ? s.length : e; continue; }
    out += s[i]; i++;
  }
  return out;
}

/**
 * 이 소스가 참조하는 모듈 **전부** (상대·절대 구분 없이 적힌 그대로).
 * @param {string} src 소스 원문 (주석은 여기서 지운다)
 * @returns {string[]}
 */
export function importsOf(src) {
  const code = decomment(src);
  const out = [];
  /* import/export … from '…'  ·  export * from '…' */
  for (const m of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  /* 부수효과 import '…' — 위 정규식이 삼키던 자리다 */
  for (const m of code.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  /* 동적 import('…') */
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

/**
 * import 를 **가져오는 이름까지** 같이 본다.
 *
 * ★★ 왜 여기 있나 — `smoke.mjs` 의 「모듈 간 import 정합성」 절이 자기 정규식을 갖고
 *   있었다. **세 번째 사본**이었고, 왼쪽 경계가 없어서
 *
 *     rpc('run_import'), { method: 'POST' }
 *              ~~~~~~   ← 이 `import` 를 부수효과 import 로 오인했다
 *
 *   `src/net/run.js` 를 넣자마자 물렸다. 사본이 셋이면 셋 다 갈라진다 (§107).
 *
 * ★ `importsOf` 와 **같은 정규식**을 쓴다 — 여기가 넓은 쪽이고, `importsOf` 는
 *   그 결과에서 경로만 뽑아 쓴다고 보면 된다.
 *
 * @param {string} src
 * @returns {{spec: string, names: string[]|null, kind: 'named'|'side'|'dynamic'}[]}
 *   `names` 가 `null` 이면 default·`* as ns`·부수효과·동적 import 다.
 */
export function importBindings(src) {
  const code = decomment(src);
  const out = [];

  /* ① `import <절> from '…'` — 절에서 이름을 뽑는다.
   *
   * ★★ 절은 `[^;'"]*?` 다 — **`;` 나 따옴표를 넘지 못한다.**
   *   `[\s\S]*?` 로 두면 §107 의 삼킴이 그대로 재현된다: 앞 줄의 부수효과
   *   `import './side.js';` 에서 시작해 **다음 줄의 `from './y.js'` 까지** 건너뛰어
   *   엉뚱한 짝을 만든다 (검사가 `./y.js` 가 두 번 나오는 것으로 잡았다).
   *   import 절에는 `;` 도 따옴표도 안 들어가므로 이 제한이 정확하다. */
  for (const m of code.matchAll(/(?:^|[\s;])import\s+([^;'"]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1];
    const named = clause.match(/\{([\s\S]*)\}/);
    out.push({
      spec: m[2],
      kind: 'named',
      names: named
        ? named[1].split(',').map((t) => t.trim()).filter(Boolean).map((t) => t.split(/\s+as\s+/)[0].trim())
        : null,                                   // default 또는 `* as ns`
    });
  }
  /* ② `export … from '…'` — 이름 검사는 안 한다 (재수출).
   *   ★ ① 과 **같은 이유로** `[^;'"]*?` 다. 문장 경계를 넘으면 엉뚱한 짝이 생긴다. */
  for (const m of code.matchAll(/(?:^|[\s;])export\s+[^;'"]*?\s+from\s*['"]([^'"]+)['"]/g)) {
    out.push({ spec: m[1], kind: 'named', names: null });
  }
  /* ③ 부수효과 — ★ **왼쪽 경계가 있어야 한다.** 없으면 `run_import'` 의 `import` 를 문다 */
  for (const m of code.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) {
    out.push({ spec: m[1], kind: 'side', names: null });
  }
  /* ④ 동적 */
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push({ spec: m[1], kind: 'dynamic', names: null });
  }
  return out;
}
