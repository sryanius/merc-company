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
