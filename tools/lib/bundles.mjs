/**
 * 서버로 복사되는 **묶음의 정의**, 그리고 그 묶음을 «걷는» 방식 — 한 벌
 * ────────────────────────────────────────────────────────────────
 *
 * ★★ 왜 여기 있나. 예전엔 `tools/syncshared.mjs` 와 `tools/smoke.mjs` 가
 *   `closureOf` 를 **각자 한 벌씩** 갖고 있었다. 그리고 실제로 갈라져 있었다 —
 *   스모크는 `squad.js` + `merc.js` 둘만 접어 **15개**를 보고 있었고,
 *   syncshared 는 진짜 묶음 **18개**를 복사하고 있었다.
 *   `itembound`·`runrows`·`tavern` 은 스모크의 시야 밖이었다.
 *   ⇒ 앞으로 모든 단계가 근거로 삼는 «+N 파일» 계약을 아무도 안 지키고 있었다.
 *
 *   «사본이 둘이면 반드시 갈라진다» (§94·§98·§107). 그래서 한 벌로 접었다.
 *
 * ★ import 를 읽는 판단부는 여기가 아니라 `tools/lib/imports.mjs` 다 — 그것도 한 벌이다.
 */
import { importsOf } from './imports.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const BUNDLES = [
  {
    name: '검증 규칙',
    dest: 'supabase/functions/_shared',
    /* ★ 이 묶음은 «목록이 곧 계약» 이다 — 목록 밖을 물면 실패.
     *   게임 전체를 서버로 끌고 가면 배포가 느려지고 Deno 에서 깨질 여지가 생긴다. */
    entry: ['src/data/limits.js', 'src/data/abyss.js', 'src/data/tower.js', 'src/game/rules.js'],
    walk: false,
    next: 'supabase functions deploy submit-score',
  },
  {
    name: '전투 엔진',
    dest: 'supabase/functions/pvp-battle/_engine',
    /* ★ 진입점만 적는다. 나머지는 import 를 따라 걷는다 (goldenbattle.mjs 의 ENTRY 와 같아야 한다 —
     *   다르면 ENGINE_HASH 가 서버에 실제로 올라간 파일과 다른 것을 가리키게 된다). */
    entry: ['src/battle/engine.js', 'src/data/skills.js', 'src/data/classes.js',
      'src/data/classes_t4.js', 'src/data/formations.js',
      /* 엔진 지문 상수 — 서버와 클라가 «같은 상수» 를 각자 import 한다 */
      'src/data/enginever.js'],
    walk: true,
    /* ★ extra 는 «복사만 하고 import 를 따라 걷지 않는» 칸이다.
     *   tagmatch 를 entry 가 아니라 여기 둘다 — entry 에 넣으면 goldenbattle 의
     *   ENTRY 와 같아야 하고(아래 주석), 그러면 ENGINE_HASH 가 바뀌어
     *   **모든 사람의 PvP 등록이 한꺼번에 무효**가 된다.
     *   순서 규칙은 «유닛을 접은 엔진» 이 아니므로 지문에 넣을 이유도 없다.
     *   어긋나는 것은 HASHES.json 이 막는다. */
    extra: ['tests/fixtures/battle-golden.json',   // 자가검사가 읽는다
      'src/battle/tagmatch.js'],                   // 서버·클라 공용 (재생)
    next: 'supabase functions deploy pvp-battle',
  },
  {
    /* ════════════════════════════════════════════════════════════════════
     * 전력 계산 — 서버가 S용병 수·부대 전력을 **스스로 센다** (§104 1단계)
     *
     * ★★ 왜 «검증 규칙»(_shared) 에 안 넣나
     *   허용 집합은 **묶음 공용**이다 (아래 `allowed`). _shared 에 14개를 더하면
     *   「rules.js 는 의존성 0 데이터 모듈만 문다」 는 계약이 **조용히 사라진다** —
     *   rules.js 가 engine.js 를 물어도 --check 가 초록이 된다.
     *   그래서 별도 묶음이다 (§106.6 도 「서버로 보낼 때는 별도 묶음으로 격리해라」).
     *
     * ★★ 왜 «전투 엔진» 에 안 넣나
     *   entry 를 건드리면 ENGINE_HASH 가 바뀌어 **모든 사람의 PvP 등록이 한꺼번에
     *   무효가 된다.** 절대 안 건드린다.
     *
     * ★ 겹치는 파일 6개(rng·util·classes·classes_t4·formations·skills)는 엔진 묶음에도
     *   있다 — 하지만 dest 가 다르니 서로 안 덮는다. 어긋나는 것은 HASHES.json 이 막는다.
     *
     * ★ 이 묶음이 성립하는 이유는 §108 이다. 그전엔 gear·merc·squad 가 state.js 를
     *   되물어 닫힘이 23개·774KB(게임 전체)였다. §108 이 그걸 끊어 15개·462KB 가 됐고,
     *   그 뒤 itembound·runrows·tavern 이 더해져 **지금은 18개**다 (셋 다 import 0개라
     *   닫힘은 안 늘고 파일 수만 는다). 이 숫자는 `tools/smoke.mjs` 가 매번 다시 잰다 —
     *   손으로 적은 숫자는 썩는다.
     * ════════════════════════════════════════════════════════════════════ */
    name: '전력 계산',
    dest: 'supabase/functions/submit-score/_power',
    entry: ['src/game/squad.js', 'src/game/merc.js', 'src/game/gear.js',
      /* ★ 아이템 위조 검사 (§113). import 가 0개라 닫힘이 안 늘어난다 —
       *   게임 모듈을 인자로 받는 모양이라 그렇다. */
      'src/game/itembound.js',
      /* ★ 세이브 ↔ run_* 사상(§112). 이것도 import 가 0개다 —
       *   서버의 run_import/run_snapshot 이 **그대로** 쓴다. 두 벌이 되면 갈라진다. */
      'src/game/runrows.js',
      /* ★ 주점 생성기 (§120) — 서버가 「이 후보가 실제로 그 주점에 있었나」 를 물으려면 필요하다.
       *   city 를 인자로 받아서 닫힘이 이 파일 하나만 늘어난다. */
      'src/game/tavern.js'],
    walk: true,
    next: 'supabase functions deploy submit-score',
  },
  {
    /* ════════════════════════════════════════════════════════════════════
     * 규칙 표 — 서버가 «이 전직이 합법인가» 를 물으려면 필요하다 (§104 1단계 3번)
     *
     * ★★ **SQL 로 베끼지 않는다.** `promoteOptions` 는 `src/data/classes.js` 에 있고,
     *   그 표를 plpgsql 로 옮기면 저장소에 **넷째 사본**이 생긴다 (상한 상수가 그랬듯이).
     *   사본이 둘이면 반드시 갈라진다 (§94·§98·§107).
     *
     * ★ 닫힘이 **2개 61KB** 뿐이다 — `classes.js` → `classes_t4.js`. 그래서 `_power`
     *   18개를 통째로 세 번째 복사하는 대신 이 작은 묶음을 따로 둔다.
     *   (`statbound` 때 「18개를 또 복사하는 거래는 손해」 라고 판단한 것과 같은 잣대다.)
     *
     * ★★ 이 둘은 **ENGINE_HASH 의 재료**다. 그런데 지문은 «파일의 내용» 이라
     *   묶음을 늘려도 해시는 안 바뀐다 — 확인했다. **내용을 고치는 것만** 위험하다.
     * ════════════════════════════════════════════════════════════════════ */
    name: '규칙 표',
    dest: 'supabase/functions/run-op/_rules',
    entry: ['src/data/classes.js'],
    walk: true,
    next: 'supabase functions deploy run-op',
  },
];

/** 진입점에서 import 를 따라 걷는다.
 *  `problems` 를 주면 없는 파일을 거기 적고, 안 주면 조용히 건너뛴다. */
export function closureOf(entries, problems) {
  const seen = new Set();
  /* ★ 진입점 하나만 걷는 자리가 여럿 있어서 문자열도 받는다 (배열/문자열 둘 다). */
  const stack = Array.isArray(entries) ? entries.slice() : [entries];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { problems.push(`${rel} 이 없다`); continue; }
    seen.add(rel);
    const src = fs.readFileSync(abs, 'utf8');
    for (const spec of importsOf(src)) {
      if (!spec.startsWith('.')) continue;                    // 외부 모듈은 없다 (의존성 0)
      stack.push(path.relative(ROOT, path.resolve(path.dirname(abs), spec)).replace(/\\/g, '/'));
    }
  }
  return [...seen].sort();
}
