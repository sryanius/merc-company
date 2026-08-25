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
import { getFormation } from './_engine/formations.js';
import { CLASSES } from './_engine/classes.js';
import './_engine/classes_t4.js';

/** 픽스처를 읽는다 (배포 번들에 같이 들어간다) */
async function loadGolden() {
  const url = new URL('./_engine/battle-golden.json', import.meta.url);
  /* Deno(서버) — 파일로 읽는다 */
  if (typeof Deno !== 'undefined' && Deno.readTextFile) {
    return JSON.parse(await Deno.readTextFile(url));
  }
  /* Node(개발 PC) — fetch 는 file:// 을 못 읽는다. 스모크가 여기로 온다. */
  if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const res = await fetch(url);
  return await res.json();
}

/** 픽스처의 편성 그대로 한 판을 돌린다 — goldenbattle.mjs 와 같은 계산이어야 한다 */
function runCase(lineup, seed) {
  const f = getFormation('basic');
  const side = (key) => lineup[key].map((u, i) => ({
    uid: `${key}${i}`, name: u.c, classId: u.c, level: u.l, grade: 'C',
    side: key, slot: f.slots[i], basicRange: CLASSES[u.c] ? CLASSES[u.c].range : 'melee',
  }));
  const b = createBattle({
    allies: side('ally'), enemies: side('enemy'),
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
  const golden = await loadGolden();
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
