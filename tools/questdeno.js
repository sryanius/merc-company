/**
 * 서버(Deno)에서 의뢰 목록을 **다시 만든다** — `tools/questparity.mjs` 가 부른다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ **이 파일은 Deno 로 돈다.** node 로 부르지 마라 (import 가 서버 사본을 가리킨다).
 *     deno run --allow-read --allow-write tools/questdeno.js <입력.json> <출력.json>
 *
 * ★★ 왜 Deno 인가: Edge Function 이 도는 곳이 Deno 다. node 에서 되는 것이 Deno 에서
 *   된다는 보장이 없다 (§77.2 에서 JSON import 로 실제로 겪었다). 그래서 **서버에 실제로
 *   올라갈 사본**(`supabase/functions/run-op/_rules/`)을 **서버가 쓸 런타임**으로 부른다.
 *   원본 `src/` 를 부르면 아무것도 증명 못 한다.
 *
 * 입력:  { cases: [ { name, cityId, day, seed, squadCount } ] }
 * 출력:  { cases: [ { name, ids, golds, exps, renowns, ranks, levels, waveNs, error } ] }
 *
 * ★ 의뢰 전체를 돌려주지 않는다 — 비교에 쓸 축만 뽑는다 (JSON 이 수십 MB 가 된다).
 */
import { genQuests, resolveSquadCount } from '../supabase/functions/run-op/_rules/questgen.js';
import { hashStr } from '../supabase/functions/run-op/_rules/enemygen.js';
import { RNG } from '../supabase/functions/run-op/_rules/rng.js';

const [inPath, outPath] = Deno.args;
if (!inPath || !outPath) {
  console.error('사용: deno run --allow-read --allow-write tools/questdeno.js <입력> <출력>');
  Deno.exit(2);
}

const input = JSON.parse(await Deno.readTextFile(inPath));
const out = [];

for (const c of input.cases || []) {
  try {
    /* ★★ `state.js refreshCity` 의 seedFor('qs') 와 **같은 식**이어야 한다.
     *   다르면 목록이 통째로 달라지고, 그러면 판정이 정상 플레이어를 거절한다. */
    const r = new RNG((hashStr(`qs#${c.cityId}#${c.day}`) ^ ((c.seed || 0) >>> 0)) >>> 0);
    const list = genQuests(c.cityId, c.day, r, resolveSquadCount(c.squadCount));
    out.push({
      name: c.name,
      n: list.length,
      ids: list.map((q) => q.id),
      golds: list.map((q) => Math.round(Number(q.reward?.gold) || 0)),
      exps: list.map((q) => Math.round(Number(q.reward?.exp) || 0)),
      renowns: list.map((q) => Math.round(Number(q.reward?.renown) || 0)),
      rolls: list.map((q) => (Array.isArray(q.reward?.itemRolls) ? q.reward.itemRolls.length : -1)),
      ranks: list.map((q) => String(q.rankLabel || '')),
      levels: list.map((q) => Math.round(Number(q.level) || 0)),
      waveNs: list.map((q) => (Array.isArray(q.waves) ? q.waves.length : -1)),
      names: list.map((q) => String(q.name || '')),
    });
  } catch (e) {
    out.push({ name: c.name, error: String(e?.message || e) });
  }
}

await Deno.writeTextFile(outPath, JSON.stringify({ cases: out }));
