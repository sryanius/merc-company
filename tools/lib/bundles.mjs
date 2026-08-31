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
      'src/game/tavern.js',
      /* ★★ 나락·탑 재현 (§104 2단계). 여기서 닫힘이 **18 → 26개**(401→569KB)로 뛴다 —
       *   `battle/engine.js`·`battle/ai.js`·`data/abyss.js`·`data/enemies.js`·`data/tower.js`·
       *   `game/enemygen.js`·`game/pet.js` 가 따라온다. basename 충돌은 없다 (확인).
       *
       * ★ 이 순간부터 `_power` 가 ENGINE_HASH 대상 8개를 **전부** 품는다 (겹침 6 → 8).
       *   복사본이라 지문 자체는 안 바뀐다. 그리고 그 8개는 **이미** `_engine` 묶음에
       *   들어 있어서 «고치면 PvP 등록이 무효» 인 것도 **이 단계가 만든 제약이 아니다** —
       *   전부터 그랬다. 늘어나는 것은 «사본이 하나 더» 라는 사실뿐이고,
       *   그건 `syncshared` 의 HASHES.json 이 지킨다. */
      'src/game/runverify.js',
      /* ★ 하루 넘기기 (§104 3단계). `state.js` 를 안 물어서 닫힘이 **자기 하나만** 는다. */
      'src/game/day.js'],
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
    entry: ['src/data/classes.js',
      /* ★★ 판정부를 **손으로 다시 쓰지 않는다.** `isSellable`(판매)·`equipIssue`(착용)가
       *   `gear.js` 에 있다. 손으로 옮기면 반드시 갈라진다 — 실제로 겪었다:
       *   「전직이 무기 타입을 좁히는가」 를 손으로 재려다 필드 이름을 세 번 잘못 짚었고,
       *   맞게 짚은 뒤에도 답이 틀렸다 (`equipIssue` 는 클래스 무기 타입을 **손 슬롯에만**
       *   적용하는데 방어구·장신구까지 셌다). 판정부를 부르니 한 번에 맞았다.
       *   ⇒ 닫힘이 2개 61KB → **8개 230KB** 로 는다. 그 값을 치를 만하다. */
      'src/game/gear.js',
      /* ★ 하루 넘기기 (§104 3단계). `day.js` 는 `state.js` 를 안 물어서
       *   `merc.js`·`runrows.js` 와 함께 와도 닫힘이 8 → 13개다. */
      'src/game/day.js', 'src/game/runrows.js',
      /* ★ 고용 (§104 1단계 3번). `tavern.js` 는 city 를 인자로 받아서 닫힘이 **자기 하나만** 는다
       *   (§120 이 그렇게 떼어 놨다).
       *   ★ 여기엔 원래 「`enemygen.js` 는 안 넣는다」 고 적혀 있었다 — 고용은 목록을
       *     **저장본**으로만 검증해서 `hashStr` 하나 때문에 5개를 끌고 올 이유가 없었다.
       *     아래 `questgen.js` 가 그 이유를 뒤집는다 (재생성으로 검증한다). */
      'src/game/tavern.js',
      /* ★★ 의뢰 목록 재생성 (§104 17단계 2번 조각). 서버가 「이 의뢰가 그 도시 목록에
       *   실제로 있었나 · 보상 G 가 정직한가」 를 물으려면 `genQuests` 를 **다시 돌려야** 한다.
       *   §138 이 그 절반을 `state.js` 에서 떼어 냈다. 닫힘이 14 → **20개**로 는다
       *   (`world`·`enemies`·`enemygen`·`formations`·`skills` 가 따라온다).
       *   ★ `enemygen.js` 를 여기서 처음 물게 된다 — 규칙 표 주석이 「안 넣는다」 고
       *     적어 둔 그 파일이다. 그때는 «목록을 저장본으로만 검증한다» 였고,
       *     지금은 **재생성으로** 검증하므로 이유가 뒤집혔다. */
      'src/game/questgen.js'],
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
