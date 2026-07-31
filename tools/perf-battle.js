// 전투 프레임 성능 측정 하네스 (브라우저에서만 돌아간다).
//
// 사용법: 개발 서버(`node tools/serve.mjs 5174`)를 띄운 뒤 페이지에서
//   const m = await import('/tools/perf-battle.js'); await m.run();
// 로 부른다. 콘솔/반환값으로 프레임 시간 분포를 돌려준다.
//
// ★ 왜 별도 하네스인가
//   전투 성능은 캔버스 래스터 비용이 대부분이라 node 에서는 잴 수 없다. 그리고 브라우저 창이
//   보이지 않으면 requestAnimationFrame 이 멈추므로(HANDOFF §4) rAF 대신 **수동 펌프**로
//   ui/battle.js 의 루프와 같은 순서(update → step → drainEvents → draw)를 그대로 돌린다.
//   래스터는 지연 실행되므로 프레임 끝에서 getImageData 로 **강제로 끝낸 뒤** 시간을 잰다 —
//   이걸 빼면 "명령을 쌓는 시간"만 재고 실제 비용의 1/6 밖에 안 보인다.
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { createRenderer } from '../src/battle/renderer.js';
import { getSkill } from '../src/data/skills.js';
import '../src/data/enemies.js';
import { newGame, state } from '../src/game/state.js';
import { addToSquad } from '../src/game/squad.js';
import { createMerc } from '../src/game/merc.js';
import { questBattleDefs, genQuests } from '../src/game/quest.js';
import { CITIES } from '../src/data/world.js';
import { BASE_CLASSES } from '../src/data/classes.js';
import { RNG } from '../src/core/rng.js';

setSkillResolver(getSkill);

const STAGE_W = 960;
const STAGE_H = 576;

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** 7대7 전투 설정 하나를 만든다 (실제 의뢰 경로 questBattleDefs 를 그대로 탄다). */
export function build7v7(seed = 12345) {
  newGame(seed);
  const r = new RNG(seed >>> 0 || 1);
  const sq = state.squads[0];
  // 부대를 7명으로 채운다 (시작은 4명)
  let guard = 0;
  while (sq.memberUids.filter(Boolean).length < 7 && guard++ < 20) {
    const m = createMerc({ classId: r.pick(BASE_CLASSES), grade: 'C', level: 45, rng: r, day: state.day });
    state.roster.push(m);
    addToSquad(state, sq.id, m.uid);
  }
  // 적도 7기가 되도록 고티어 도시의 고랭크 의뢰를 찾는다 (적 수는 랭크 비례다).
  // 시작 도시는 tier 1 이라 F~D 뿐이고 적이 3~4기밖에 안 나온다 — 7대7 이 안 된다.
  let best = null;
  for (const city of CITIES.slice().sort((a, b) => b.tier - a.tier)) {
    for (let d = 0; d < 6 && (!best || best.enemies < 7); d++) {
      const qs = genQuests(city.id, 1 + d * 3, r, 4);
      for (const q of qs) {
        // 웨이브별로 적 수가 다르다 — 가장 많은 웨이브를 쓴다 (최악 프레임이 여기서 나온다)
        for (let w = 0; w < q.waves.length; w++) {
          let cfg;
          try { cfg = questBattleDefs(q, w, state, sq.id); } catch (e) { continue; }
          const n = cfg.enemies.length;
          if (!best || n > best.enemies) best = { cfg, quest: q, allies: cfg.allies.length, enemies: n, wave: w };
          if (n >= 7) break;
        }
        if (best && best.enemies >= 7) break;
      }
    }
    if (best && best.enemies >= 7) break;
  }
  if (!best) throw new Error('의뢰를 찾지 못했다');
  return best;
}

/**
 * 프레임 시간을 잰다.
 * @param {{frames?:number, dpr?:number, seed?:number, speed?:number, warmup?:number, cfg?:object}} o
 */
export function measure(o = {}) {
  const frames = o.frames ?? 900;
  const warmup = o.warmup ?? 60;
  const speed = o.speed ?? 1;
  const built = o.cfg ? { cfg: o.cfg } : build7v7(o.seed ?? 12345);
  const cfg = built.cfg;

  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  canvas.style.width = STAGE_W + 'px';
  canvas.style.height = STAGE_H + 'px';
  // 화면 밖에 두되 display:none 은 쓰지 않는다 (래스터가 통째로 생략될 수 있다).
  canvas.style.position = 'fixed';
  canvas.style.left = '-4000px';
  canvas.style.top = '0';
  document.body.appendChild(canvas);

  const battle = createBattle({ ...cfg, seed: (o.seed ?? 12345) >>> 0 || 1, getSkill });
  const renderer = createRenderer(canvas, { biome: cfg.biome || 'plains' });
  renderer.setBattle(battle, { biome: cfg.biome || 'plains' });
  renderer.speed = speed;

  const ctx = canvas.getContext('2d');
  const times = [];
  const dt = 1 / 60;
  let steps = false;
  let ended = 0;

  for (let i = 0; i < frames + warmup; i++) {
    // 전투가 끝난 뒤의 프레임은 유닛도 파티클도 거의 없어서 값이 싸다.
    // 그걸 섞으면 분포가 통째로 낙관적으로 기운다 — **전투 중 프레임만** 표본에 넣는다.
    const live = !battle.finished;
    const t0 = performance.now();
    const bt = battle.time;
    renderer.update(dt);
    if (battle.time > bt + 1e-9) steps = true;
    if (!steps && !battle.finished) battle.step(dt * speed);
    battle.drainEvents();
    renderer.draw();
    // 캔버스 2D 는 명령을 모아 뒀다가 나중에 래스터한다. 여기서 강제로 끝내야
    // 프레임 시간에 래스터 비용이 포함된다.
    // ※ 다만 getImageData 를 매 프레임 부르면 크롬이 그 캔버스의 GPU 가속을 꺼 버릴 수 있다.
    //   flush:false 로도 재서 두 수치를 비교해라.
    if (o.flush !== false) { try { ctx.getImageData(0, 0, 1, 1); } catch (e) { /* noop */ } }
    const ms = performance.now() - t0;
    if (i >= warmup && live) times.push(ms);
    if (battle.finished) ended++;
    // 전투가 끝나면 마무리 연출 90프레임(1.5초)까지만 더 돌리고 끝낸다
    if (ended > 90) break;
  }

  canvas.remove();
  const sorted = times.slice().sort((a, b) => a - b);
  const sum = times.reduce((a, v) => a + v, 0);
  return {
    times: o.keepTimes ? times : undefined,
    n: times.length,
    allies: built.allies, enemies: built.enemies,
    avg: sum / (times.length || 1),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1] || 0,
    over12: times.filter((v) => v > 12).length,
    over25: times.filter((v) => v > 25).length,
    battleTime: battle.time,
    finished: battle.finished,
  };
}

/**
 * 여러 시드로 돌려 **프레임 시간을 전부 모아** 하나의 분포로 본다.
 * 시드별 p95 를 평균내면 꼬리가 희석되므로 표본을 합쳐서 잰다.
 */
export function run(o = {}) {
  const seeds = o.seeds || [12345, 777, 20260729, 4242, 999983, 31337, 606060, 88888, 5150, 24601];
  // 첫 전투는 스프라이트 아틀라스를 굽느라 느리다 — 실제 게임에서도 한 번뿐인 비용이라
  // 워밍업으로 빼고 잰다(측정 대상은 "전투 중 프레임"이다).
  if (o.warmRun !== false) measure({ ...o, seed: seeds[0], frames: 120, warmup: 30 });
  const rows = [];
  const pool = [];
  for (const s of seeds) {
    const r = measure({ ...o, seed: s, keepTimes: true });
    pool.push(...r.times);
    delete r.times;
    rows.push(r);
  }
  const sorted = pool.slice().sort((a, b) => a - b);
  const out = {
    seeds: seeds.length,
    frames: pool.length,
    allies: rows[0].allies, enemies: rows[0].enemies,
    avg: pool.reduce((a, v) => a + v, 0) / (pool.length || 1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.90),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1] || 0,
    over12: pool.filter((v) => v > 12).length,
    over25: pool.filter((v) => v > 25).length,
    rows,
  };
  out.pass = out.p95 < 12 && out.max < 25;
  return out;
}

/** 단계별 프로파일 (renderer.__prof) — 어느 단계가 비싼지 본다 */
export function profile(o = {}) {
  const built = build7v7(o.seed ?? 12345);
  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W; canvas.height = STAGE_H;
  canvas.style.position = 'fixed'; canvas.style.left = '-4000px';
  document.body.appendChild(canvas);
  const battle = createBattle({ ...built.cfg, seed: 12345, getSkill });
  const renderer = createRenderer(canvas, { biome: built.cfg.biome || 'plains' });
  renderer.setBattle(battle, { biome: built.cfg.biome || 'plains' });
  const frames = o.frames ?? 300;
  for (let i = 0; i < 60; i++) { renderer.update(1 / 60); battle.step(1 / 60); battle.drainEvents(); renderer.draw(); }
  const prof = renderer.__prof;
  if (!prof) { canvas.remove(); return { error: '__prof 없음' }; }
  prof.acc = Object.create(null);
  prof.flush = true;
  prof.on = true;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    renderer.update(1 / 60);
    if (!battle.finished) battle.step(1 / 60);
    battle.drainEvents();
    renderer.draw();
  }
  const total = performance.now() - t0;
  prof.on = false;
  const acc = { ...prof.acc };
  canvas.remove();
  const perFrame = {};
  for (const k of Object.keys(acc)) perFrame[k] = acc[k] / frames;
  return { frames, totalPerFrame: total / frames, perFrame };
}

if (typeof window !== 'undefined') window.__perfBattle = { build7v7, measure, run, profile };
