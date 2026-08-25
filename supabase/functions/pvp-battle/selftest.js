/**
 * 배포된 엔진 자가검사
 * ────────────────────────────────────────────────────────────────
 *
 * ★★ 왜 서버에서 또 재나
 *   PvP 는 **서버가 전투를 돌려** 승패를 정한다. 그 결과를 클라이언트가 같은 시드로 재생한다.
 *   두 곳의 결과가 다르면 «화면에선 이겼는데 점수는 졌다» 가 된다.
 *
 *   개발 PC 에서 Node 와 Deno 가 일치하는 것은 이미 쟀다 (HANDOFF §68.2).
 *   하지만 **실제 서버는 리눅스**다 — 거기서도 같은지는 거기서 재야 안다.
 *   그래서 배포된 함수가 자기 자신을 검사할 수 있게 해 둔다: `GET /pvp-battle?selftest=1`
 *
 * ★ 이 파일은 `_engine/` 의 **복사본**을 import 한다. 원본이 아니라 배포된 것을 재야
 *   의미가 있다 — 평탄화(import 경로 재작성)가 깨졌는지도 여기서 같이 잡힌다.
 */
import { createBattle } from './_engine/engine.js';
import { getSkill } from './_engine/skills.js';

/* ★★ 픽스처는 **JS 모듈로** 들어온다 (`syncshared` 가 .json 을 감싼다).
 *   .json 을 그대로 두면 Edge Function 번들에 **아예 안 들어가서** 배포본이
 *   `path not found: .../battle-golden.json` 으로 죽는다 — 실제로 겪었다 (HANDOFF §77.2).
 *   정적 import 라 번들러가 확실히 집어 간다. */
import GOLDEN from './_engine/battle-golden.js';

/**
 * 픽스처에 굳어 있는 **완성된 UnitDef 를 그대로** 쓴다.
 *
 * ★★ 예전엔 픽스처에 `{클래스, 레벨}` 만 있어서 여기서 다시 유닛을 만들었다.
 *   그때 `stats` 를 안 채워서 **엔진이 기본값(hp 100)으로 돌고 있었다** (HANDOFF §73.5).
 *   생성기와 이 함수가 «각자 만들면» 언제든 어긋난다 — 굳은 것을 그냥 쓰는 것이 정답이다.
 */
function runCase(lineup, seed) {
  const b = createBattle({
    allies: lineup.ally, enemies: lineup.enemy,
    allyFormationId: 'basic', enemyFormationId: 'basic', seed, getSkill, record: false,
  });
  let guard = 0;
  while (!b.finished && guard++ < 20000) b.step(1 / 60);
  const units = b.units || b.all || [];
  return {
    winner: b.winner ?? null,
    time: Number((b.time ?? 0).toFixed(3)),
    survivors: units.filter((u) => u.hp > 0).length,
    hpsum: Math.round(units.reduce((a, u) => a + Math.max(0, u.hp || 0), 0)),
  };
}

/**
 * 배포된 엔진이 골든 픽스처와 일치하는가.
 * @returns {{ok:boolean, total:number, bad:Array<string>, engineHash:string, ms:number}}
 */
export async function selftest() {
  const t0 = Date.now();
  const golden = GOLDEN;
  const bad = [];
  for (const c of golden.cases || []) {
    const lineup = (golden.lineups || {})[c.tag];
    if (!lineup) { bad.push(`${c.tag}: 편성이 픽스처에 없다`); continue; }
    const got = runCase(lineup, c.seed);
    for (const k of ['winner', 'time', 'survivors', 'hpsum']) {
      if (got[k] !== c[k]) bad.push(`${c.tag}/${c.seed} ${k}: 픽스처 ${c[k]} vs 서버 ${got[k]}`);
    }
  }
  return {
    ok: bad.length === 0,
    total: (golden.cases || []).length,
    bad: bad.slice(0, 20),
    engineHash: golden.engineHash,
    ms: Date.now() - t0,
  };
}
