/**
 * 서버(Deno)에서 전력을 센다 — `tools/powerparity.mjs` 가 부른다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ **이 파일은 Deno 로 돈다.** node 로 부르지 마라 (import 경로가 서버 사본을 가리킨다).
 *     deno run --allow-read tools/powerdeno.js <입력.json> <출력.json>
 *
 * ★★ 왜 Deno 인가: Edge Function 이 도는 곳이 Deno 다. node 에서 되는 것이
 *   Deno 에서 된다는 보장이 없다 (§77.2 에서 JSON import 로 실제로 겪었다).
 *   그래서 **서버에 실제로 올라갈 사본**(`supabase/functions/submit-score/_power/`)을
 *   **서버가 쓸 런타임**으로 부른다. 원본 `src/` 를 부르면 아무것도 증명 못 한다.
 *
 * 입력:  { cases: [ { name, state } ] }
 * 출력:  { cases: [ { name, sMercs, powers: {sid: n}, topPower, error } ] }
 */
import { squadPower } from '../supabase/functions/submit-score/_power/squad.js';

const [inPath, outPath] = Deno.args;
if (!inPath || !outPath) {
  console.error('사용: deno run --allow-read --allow-write tools/powerdeno.js <입력> <출력>');
  Deno.exit(2);
}

const input = JSON.parse(await Deno.readTextFile(inPath));
const out = [];

for (const c of input.cases || []) {
  try {
    const st = c.state;
    const powers = {};
    for (const q of st.squads || []) powers[q.id] = squadPower(st, q.id);
    const vals = Object.values(powers);
    out.push({
      name: c.name,
      /* ★ S 용병 수도 여기서 센다 — 순위표 두 축을 같이 재려는 것이다 */
      sMercs: (st.roster || []).filter((m) => m && m.grade === 'S').length,
      powers,
      topPower: vals.length ? Math.max(...vals) : 0,
    });
  } catch (e) {
    out.push({ name: c.name, error: String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ') });
  }
}

await Deno.writeTextFile(outPath, JSON.stringify({ cases: out }, null, 1));
console.log(`deno: ${out.length}판 계산`);
