/**
 * 「이 SQL 은 부르면 죽는다」 — 잠금절이 못 붙는 자리를 잡는다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 있나: `gold_send()` 가 **부를 때마다 죽고 있었다.** 6개월도 아니고
 *   내놓은 그날부터, 승낙이 한 번도 성공한 적이 없다 (프로덕션: 부탁 4건 전부
 *   `pending`, 보내진 적 0건). db/012_gold_gift.sql:223 이 이랬다:
 *
 *     select count(*) into cnt from public.gold_gifts
 *      where id = p_id and from_user = me and status = 'pending'
 *      for update;
 *
 *   PostgreSQL 은 **집계와 `for update` 를 같이 못 쓴다:**
 *     ERR 0A000 : FOR UPDATE is not allowed with aggregate functions
 *
 * ★★ 왜 못 잡았나 — **SQL 함수를 한 번도 실행해 본 적이 없다.**
 *   plpgsql 은 문장을 «처음 실행할 때» 계획한다. 그래서 `create function` 은
 *   멀쩡히 통과하고 **부를 때만** 터진다. 「만들어졌다」 는 아무 증거가 아니다.
 *   로컬에 Postgres 가 없어서(§102.5) 실행 검사가 없다 — 그건 여전히 숙제다.
 *   그때까지 **이 형태만이라도** 글자로 막는다.
 *
 * ★ 헛것을 안 잡으려고 **괄호 깊이**를 센다. 아래는 전부 합법이라 안 잡는다:
 *     select id from t where n = (select count(*) from u) for update;   ← 집계가 하위질의
 *     perform 1 from t where … for update;                              ← 집계가 없다
 *   깊이 0 에서 둘이 만날 때만 잡는다.
 *
 * @module tools/lib/sqllock
 */

/** 잠금절 — 이것들 뒤에는 아래 «금지» 가 못 온다 */
const LOCK = /\bfor\s+(?:update|no\s+key\s+update|share|key\s+share)\b/i;

/** 잠금절과 같은 질의 층에 있으면 PostgreSQL 이 거절하는 것들 */
const FORBIDDEN = [
  { name: '집계 함수', re: /\b(count|sum|avg|min|max|array_agg|string_agg|jsonb_agg|json_agg|bool_and|bool_or)\s*\(/i },
  { name: 'group by', re: /\bgroup\s+by\b/i },
  { name: 'having', re: /\bhaving\b/i },
  { name: 'distinct', re: /\bdistinct\b/i },
  { name: '집합 연산(union/intersect/except)', re: /\b(union|intersect|except)\b/i },
  { name: '윈도우 함수(over)', re: /\bover\s*\(/i },
];

/**
 * 주석과 문자열 리터럴을 지운다.
 *
 * ★ `$$ … $$` (달러 인용) 안은 **안 지운다** — 함수 본문이 거기 있고,
 *   우리가 보려는 문장이 바로 그 안이다.
 * ★ 자리는 유지한다 (공백으로 바꾼다) — 줄 번호를 세야 하니까.
 */
export function stripSql(src) {
  const s = String(src == null ? '' : src);
  const out = s.split('');
  let i = 0;
  const blank = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < s.length) {
    if (s[i] === '-' && s[i + 1] === '-') {
      const e = s.indexOf('\n', i); const end = e < 0 ? s.length : e;
      blank(i, end); i = end; continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2); const end = e < 0 ? s.length : e + 2;
      blank(i, end); i = end; continue;
    }
    if (s[i] === "'") {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; }
        if (s[j] === "'") { j++; break; }
        j++;
      }
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * 문장 하나 안에서 «깊이 0» 의 구간만 남긴다.
 * 하위질의(괄호 안)는 다른 질의 층이라 잠금절과 상관없다.
 */
function topLevelOf(stmt) {
  let depth = 0; let out = '';
  for (const ch of stmt) {
    /* ★ 괄호 «문자» 는 남긴다 — 안쪽만 지운다.
     *   여는 괄호까지 지우면 `count(` 의 괄호가 날아가 `집계 함수` 정규식이 영영 안 맞는다.
     *   실제로 그렇게 짰다가 아래 합성 판 ①·④ 에 걸렸다. */
    if (ch === '(') { const top = depth === 0; depth++; out += top ? '(' : ' '; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); out += depth === 0 ? ')' : ' '; continue; }
    out += depth === 0 ? ch : ' ';
  }
  return out;
}

/**
 * 잠금절이 못 붙는 자리를 찾는다.
 * @param {string} src SQL 원문
 * @returns {{line:number, lock:string, forbidden:string, snippet:string}[]}
 */
export function lockProblems(src) {
  const clean = stripSql(src);
  const problems = [];
  let at = 0;
  for (const stmt of clean.split(';')) {
    const start = at;
    at += stmt.length + 1;
    if (!LOCK.test(stmt)) continue;
    const top = topLevelOf(stmt);
    if (!LOCK.test(top)) continue;                 // 잠금절 자체가 하위질의 안이면 이 층 얘기가 아니다
    for (const f of FORBIDDEN) {
      if (!f.re.test(top)) continue;
      problems.push({
        line: clean.slice(0, start).split('\n').length,
        lock: (top.match(LOCK) || [''])[0].replace(/\s+/g, ' ').trim(),
        forbidden: f.name,
        snippet: stmt.replace(/\s+/g, ' ').trim().slice(0, 110),
      });
      break;                                        // 한 문장에 하나만 보고한다
    }
  }
  return problems;
}
