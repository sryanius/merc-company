// 평판 / 특화 도시 검증 스크립트 (node tools/reputation.mjs).
//
// 이 게임의 노림수는 "부대가 커져도 저티어 도시를 순회할 이유가 있어야 한다" 이다.
// 그 이유를 만드는 장치가 **도시 평판 + 클래스 특화 도시** 두 개이고, 여기서 실제로 재서 확인한다.
//
//   1) 도시 tier × 평판(0/10/50/100) × 특화 여부 조합별 등급 분포 (조합당 10만 회 롤)
//   2) ★핵심 판정: 1티어 특화 도시(평판 100)의 S 확률 > 5티어 비특화 도시(평판 10)의 S 확률
//   3) 1차 클래스 7종이 14개 도시에 고루 퍼졌는가 (특화 도시가 없는 클래스가 있으면 실패)
//   4) 평판 0 → 100 까지 의뢰를 몇 건 수행해야 하는가 (F랭크 / C랭크 기준, 실패 섞임 포함)
//   5) 주점 잠금(평판 10)이 진행을 막지 않는가 — 처음 온 도시에서 몇 건이면 주점이 열리나
//
// 순수 JS 모듈만 import 한다 (DOM 참조 금지).
import { RNG } from '../src/core/rng.js';
import { GRADES, gradeRoll, gradeOdds, gradeChances, effectiveTier, MAX_CITY_TIER, REP_BASELINE, REP_PER_TIER, SPECIALTY_TIER_BONUS } from '../src/game/merc.js';
import { CITIES, citySpecialty, citiesForClass, START_CITY, getCity } from '../src/data/world.js';
import { BASE_CLASSES, getClass } from '../src/data/classes.js';
import { REP_QUEST_GAIN, REP_TAVERN_MIN, REP_MAX, START_REP } from '../src/game/state.js';

/* ────────────────────────────── 실행 옵션 ────────────────────────────── */

const ARGV = process.argv.slice(2);
const optNum = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.slice(k.length + 3)) : d;
};
const N_ROLL = optNum('n', 100000);   // 조합당 롤 횟수 (설계 요구: 10만)

/* ────────────────────────────── 출력 헬퍼 ────────────────────────────── */

const wide = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf)
    || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60);
};
const wlen = (s) => [...String(s)].reduce((a, c) => a + (wide(c) ? 2 : 1), 0);
const pad = (s, w, right = false) => {
  const t = String(s);
  const gap = Math.max(0, w - wlen(t));
  return right ? ' '.repeat(gap) + t : t + ' '.repeat(gap);
};
function table(head, rows, align = []) {
  const all = [head, ...rows];
  const w = head.map((_, i) => Math.max(...all.map((r) => wlen(r[i] ?? ''))));
  const line = (r) => '  ' + r.map((c, i) => pad(c ?? '', w[i], align[i] === 'r')).join('  ').trimEnd();
  console.log(line(head));
  console.log('  ' + w.map((x) => '─'.repeat(x)).join('  '));
  for (const r of rows) console.log(line(r));
}
const head = (t) => { console.log(`\n${t}\n${'─'.repeat(84)}`); };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

const ISSUES = [];
const flag = (m) => ISSUES.push(m);
function verdict(pass, okMsg, ngMsg) {
  console.log(`\n판정: ${pass ? okMsg : `[실패] ${ngMsg}`}`);
  if (!pass) flag(ngMsg);
}

/* ───────────────────── 1. tier × 평판 × 특화 등급 분포 ───────────────────── */

/** 조합 하나를 N_ROLL 회 굴려 등급별 백분율을 낸다 */
function rollDist(tier, opts, seed) {
  const r = new RNG(seed >>> 0 || 1);
  const cnt = Object.fromEntries(GRADES.map((g) => [g, 0]));
  for (let i = 0; i < N_ROLL; i++) cnt[gradeRoll(tier, r, opts)]++;
  const out = {};
  for (const g of GRADES) out[g] = (cnt[g] / N_ROLL) * 100;
  return out;
}

const REPS = [0, 10, 50, 100];
const TIERS = [1, 2, 3, 4, 5];
/** 측정 결과 캐시: key `${tier}|${rep}|${spec}` → {실측 분포, 이론 분포} */
const DIST = new Map();
const key = (t, rep, spec) => `${t}|${rep}|${spec ? 1 : 0}`;

function measureAll() {
  head(`1. 도시 tier × 평판 × 특화 — 등급 분포 (조합당 ${N_ROLL.toLocaleString()}회 롤, 단위 %)`);
  const rows = [];
  let seed = 1;
  let maxErr = 0;
  for (const t of TIERS) {
    for (const rep of REPS) {
      for (const spec of [false, true]) {
        const opts = { rep, specialty: spec };
        const got = rollDist(t, opts, seed++ * 7919);
        const want = gradeChances(t, opts);          // 이론 확률(%) — gradeOdds 기반
        DIST.set(key(t, rep, spec), { got, want, eff: effectiveTier(t, opts) });
        for (const g of GRADES) maxErr = Math.max(maxErr, Math.abs(got[g] - (want[g] || 0)));
        rows.push([
          `T${t}`, String(rep), spec ? '특화' : '-', f2(effectiveTier(t, opts)),
          ...GRADES.map((g) => f2(got[g])),
          f2(want.S ?? 0),
        ]);
      }
    }
  }
  table(
    ['tier', '평판', '특화', '실효T', ...GRADES, '이론S'],
    rows,
    ['l', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
  );
  // 실측이 이론표(gradeOdds)와 어긋나면 UI 확률표가 거짓말을 하는 것이다.
  console.log(`\n  실측 vs 이론(gradeOdds) 최대 오차: ${f2(maxErr)}%p`);
  verdict(maxErr < 0.6,
    `주점 확률표(gradeOdds)가 실제 롤과 일치한다 (최대 오차 ${f2(maxErr)}%p).`,
    `주점 확률표와 실제 롤이 ${f2(maxErr)}%p 어긋난다 — UI 표기가 거짓이 된다.`);
}

/* ───────────────────── 2. ★ 핵심 판정: 저티어 특화 > 고티어 ───────────────────── */

function coreCheck() {
  head('2. ★ 핵심 판정 — 1티어 특화 도시(평판 100) vs 5티어 비특화 도시(평판 10)');
  const lo = DIST.get(key(1, 100, true));
  const hi = DIST.get(key(5, 10, false));
  const rows = [
    ['1티어 · 평판100 · 특화', f2(lo.eff), ...GRADES.map((g) => f2(lo.got[g]))],
    ['5티어 · 평판10 · 비특화', f2(hi.eff), ...GRADES.map((g) => f2(hi.got[g]))],
    ['차이(저티어 − 고티어)', '', ...GRADES.map((g) => f2(lo.got[g] - hi.got[g]))],
  ];
  table(['조합', '실효T', ...GRADES], rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);

  const sLo = lo.got.S, sHi = hi.got.S;
  const aLo = lo.got.A + lo.got.S, aHi = hi.got.A + hi.got.S;
  console.log(`\n  S 확률   : 1티어 특화 ${f2(sLo)}%  vs  5티어 비특화 ${f2(sHi)}%  → ${sLo > sHi ? '저티어 승' : '고티어 승'}`);
  console.log(`  S+A 확률 : 1티어 특화 ${f2(aLo)}%  vs  5티어 비특화 ${f2(aHi)}%`);

  // 표본오차: p≈3% / n=10만 이면 표준편차 ≈ 0.054%p. 0.3%p 차이면 우연이 아니다.
  const margin = 0.3;
  verdict(sLo > sHi + margin,
    `1티어 특화 도시가 5티어 비특화 도시보다 S를 더 잘 뽑는다 (+${f2(sLo - sHi)}%p) — 저티어 순회 동기가 성립한다.`,
    `1티어 특화 S ${f2(sLo)}% ≤ 5티어 비특화 S ${f2(sHi)}% — 저티어 도시를 갈 이유가 없다. merc.js SPECIALTY_TOP_MULT 를 올려라.`);

  /* ── 상한 검사 ──
   * 플레이어 피드백: "특화 영웅들 수치가 과도하게 높은 것 같다".
   * 실제로 특화 도시에서 A 48% / S 20% (A 이상 68%) 가 나오고 있었다 — 등급 뽑기가 무의미해지는 수준.
   * 규칙을 셋으로 못 박고 여기서 매번 검사한다.
   *   1) 비특화 도시는 S 가 절대 나오지 않는다 (특화 도시를 도는 유일한 이유가 S 다)
   *   2) 특화 도시 S 는 5% 를 넘지 않는다
   *   3) 특화 도시라도 A 이상이 35% 를 넘지 않는다 (넘으면 고등급이 흔해져 뽑기가 죽는다) */
  head('2-c. 상한 검사 — 특화 보정이 과하지 않은가');
  // DIST 항목에는 특화 여부가 들어 있지 않으므로 조합을 직접 훑는다.
  const pick = (spec) => TIERS.flatMap((t) => REPS.map((rep) => DIST.get(key(t, rep, spec)).got));
  const worstNonSpecS = Math.max(...pick(false).map((d) => d.S));
  const worstSpecS = Math.max(...pick(true).map((d) => d.S));
  const worstSpecTop = Math.max(...pick(true).map((d) => d.S + d.A));
  console.log(`  비특화 S 최댓값      : ${f2(worstNonSpecS)}%  (0 이어야 한다)`);
  console.log(`  특화 S 최댓값        : ${f2(worstSpecS)}%  (상한 5%)`);
  console.log(`  특화 A 이상 최댓값   : ${f2(worstSpecTop)}%  (상한 35%)`);
  // 10만 회 롤이라 S 가중치가 0이면 표본 S 도 정확히 0 이다 (반올림 여유 0.02%p)
  verdict(worstNonSpecS <= 0.02,
    '비특화 도시에서는 S가 나오지 않는다 — S는 특화 도시 전용이다.',
    `비특화 도시에서 S가 ${f2(worstNonSpecS)}% 나온다. GRADE_WEIGHTS 의 S 는 전부 0 이어야 한다.`);
  verdict(worstSpecS <= 5.3,
    `특화 도시 S 가 상한(5%) 안에 있다 (최대 ${f2(worstSpecS)}%).`,
    `특화 도시 S 가 ${f2(worstSpecS)}% — 상한 5% 를 넘었다. merc.js SPEC_S_MAX 를 확인해라.`);
  verdict(worstSpecTop <= 35,
    `특화 도시라도 A 이상이 ${f2(worstSpecTop)}% 로 뽑기가 살아 있다.`,
    `특화 도시 A 이상이 ${f2(worstSpecTop)}% 다 — 고등급이 흔해서 등급 뽑기가 무의미해진다. SPECIALTY_TOP_MULT 를 낮춰라.`);

  // 부수 확인: 평판이 실제로 등급을 끌어올리는가 (같은 tier 안에서 단조 증가여야 한다)
  head('2-b. 평판이 등급을 실제로 끌어올리는가 (같은 tier, 비특화, S+A+B 확률 %)');
  const rows2 = TIERS.map((t) => {
    const v = REPS.map((rep) => {
      const d = DIST.get(key(t, rep, false)).got;
      return d.S + d.A + d.B;
    });
    return [`T${t}`, ...v.map(f2), v[3] > v[0] ? '증가' : '★역행'];
  });
  table(['tier', ...REPS.map((r) => `평판${r}`), '단조'], rows2, ['l', 'r', 'r', 'r', 'r', 'l']);
  const mono = TIERS.every((t) => {
    let prev = -1;
    for (const rep of REPS) {
      const d = DIST.get(key(t, rep, false)).got;
      const v = d.S + d.A + d.B;
      if (v < prev - 0.2) return false;
      prev = v;
    }
    return true;
  });
  verdict(mono,
    '평판이 오르면 상위 등급(B 이상) 확률이 단조 증가한다.',
    '평판을 올려도 상위 등급 확률이 오르지 않는 tier 가 있다.');
}

/* ───────────────────── 3. 특화 분포 — 7종이 14도시에 고루 ───────────────────── */

function spreadCheck() {
  head('3. 1차 클래스 7종의 특화 도시 배분 (도시 14개)');
  const rows = BASE_CLASSES.map((id) => {
    const cs = citiesForClass(id);
    const tiers = cs.map((c) => getCity(c).tier).sort((a, b) => a - b);
    return [
      getClass(id)?.name || id,
      String(cs.length),
      tiers.join(','),
      cs.map((c) => getCity(c).name).join(', '),
    ];
  });
  table(['1차 클래스', '도시수', 'tier', '특화 도시'], rows, ['l', 'r', 'l', 'l']);

  const missing = BASE_CLASSES.filter((id) => citiesForClass(id).length === 0);
  const slots = CITIES.reduce((a, c) => a + citySpecialty(c.id).length, 0);
  const noSpec = CITIES.filter((c) => citySpecialty(c.id).length === 0);
  const counts = BASE_CLASSES.map((id) => citiesForClass(id).length);
  const spread = Math.max(...counts) - Math.min(...counts);
  console.log(`\n  특화 슬롯 합계 ${slots}칸 / 도시 ${CITIES.length}개 · 특화 없는 도시 ${noSpec.length}개`);
  console.log(`  클래스당 도시 수 ${Math.min(...counts)}~${Math.max(...counts)} (편차 ${spread})`);

  // 저티어에도 거점이 있어야 초반부터 특화가 의미 있다.
  const lowTier = BASE_CLASSES.filter((id) => citiesForClass(id).some((c) => getCity(c).tier <= 2));
  console.log(`  tier 1~2 도시에 거점이 있는 클래스: ${lowTier.length}/${BASE_CLASSES.length}종`);

  verdict(missing.length === 0 && noSpec.length === 0 && spread <= 1,
    `7종 전부 특화 도시를 갖고, 14개 도시 전부 특화가 있다 (편차 ${spread}).`,
    missing.length
      ? `특화 도시가 없는 클래스: ${missing.join(', ')}`
      : noSpec.length
        ? `특화가 없는 도시: ${noSpec.map((c) => c.name).join(', ')}`
        : `클래스별 특화 도시 수 편차가 ${spread} 로 고르지 않다.`);
  verdict(lowTier.length === BASE_CLASSES.length,
    '7종 전부 tier 1~2 도시에 거점이 있어 초반부터 특화를 쓸 수 있다.',
    `tier 1~2 거점이 없는 클래스가 있다: ${BASE_CLASSES.filter((id) => !lowTier.includes(id)).join(', ')}`);
}

/* ───────────────────── 4. 평판 0→100 에 필요한 의뢰 건수 ───────────────────── */

/** 성공률 p 로 랭크 rank 의뢰를 반복해 평판이 target 에 닿는 데 걸리는 건수 */
function questsToRep(rank, from, target, winRate = 1) {
  const gain = REP_QUEST_GAIN[rank];
  const loss = -Math.max(1, Math.floor(gain / 2));
  // 기대값으로 계산한다 (결정론적이라 시드 의존이 없다)
  const per = gain * winRate + loss * (1 - winRate);
  if (per <= 0) return Infinity;
  return Math.ceil((target - from) / per);
}

function questCountCheck() {
  head('4. 평판을 올리는 데 필요한 의뢰 건수');
  const rows = [];
  for (const rank of ['F', 'E', 'D', 'C', 'B', 'A', 'S']) {
    const gain = REP_QUEST_GAIN[rank];
    const loss = Math.max(1, Math.floor(gain / 2));
    rows.push([
      rank, `+${gain}`, `-${loss}`,
      String(questsToRep(rank, 0, REP_TAVERN_MIN, 1)),
      String(questsToRep(rank, 0, REP_MAX, 1)),
      String(questsToRep(rank, 0, REP_MAX, 0.8)),
      String(questsToRep(rank, 0, REP_MAX, 0.6)),
    ]);
  }
  table(
    ['랭크', '성공', '실패', '0→10(주점개방)', '0→100 전승', '0→100 승률80%', '0→100 승률60%'],
    rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
  );

  const fOpen = questsToRep('F', 0, REP_TAVERN_MIN, 1);
  const cOpen = questsToRep('C', 0, REP_TAVERN_MIN, 1);
  const fMax = questsToRep('F', 0, REP_MAX, 1);
  const cMax = questsToRep('C', 0, REP_MAX, 1);
  console.log(`\n  F랭크: 주점 개방 ${fOpen}건 · 평판 만점 ${fMax}건`);
  console.log(`  C랭크: 주점 개방 ${cOpen}건 · 평판 만점 ${cMax}건`);
  console.log(`  ※ 평판 ${REP_MAX} = 실효 티어 +${((REP_MAX - REP_BASELINE) / REP_PER_TIER).toFixed(2)}. 특화까지 겹치면 +${(((REP_MAX - REP_BASELINE) / REP_PER_TIER) + SPECIALTY_TIER_BONUS).toFixed(2)}.`);

  // 주점 개방이 5건 이상 걸리면 낯선 도시가 사실상 잠긴 것과 같다.
  verdict(fOpen <= 5 && cOpen <= 3,
    `낯선 도시 주점은 F랭크 ${fOpen}건 / C랭크 ${cOpen}건이면 열린다 — 진행을 막지 않는다.`,
    `주점 개방에 F ${fOpen}건 / C ${cOpen}건이나 걸린다 — 낯선 도시가 사실상 잠긴다.`);
  /* ★ 상한이 100 → 300 으로 늘었으므로 기준도 같이 늘렸다.
   *   제작자 지적이 "평판 100 은 너무 금방 찍는다" 였으니 **오래 걸리는 게 목적**이다.
   *   다만 «오래 걸린다» 와 «못 간다» 는 다르다 — 저랭크만으로도 언젠간 닿아야 한다.
   *   C랭크 기준을 본다: 높은 랭크는 훨씬 빨리 쌓이므로(REP_GAIN) 저기가 상한선이다. */
  verdict(fMax <= 160 && cMax <= 45,
    `평판 만점은 F랭크 ${fMax}건 / C랭크 ${cMax}건 — 장기 목표로 적당하다.`,
    `평판 만점에 F ${fMax}건 / C ${cMax}건이 필요하다 — 사실상 도달 불가다.`);
}

/* ───────────────────── 5. 주점 잠금이 진행을 막지 않는가 ───────────────────── */

function lockCheck() {
  head('5. 주점 잠금 — 시작 도시와 낯선 도시');
  const start = getCity(START_CITY);
  const rows = CITIES.map((c) => {
    const rep0 = c.id === START_CITY ? START_REP : 0;
    return [
      c.name, `T${c.tier}`, String(rep0),
      rep0 >= REP_TAVERN_MIN ? '열림' : '잠김',
      rep0 >= REP_TAVERN_MIN ? '-' : `F랭크 ${questsToRep('F', rep0, REP_TAVERN_MIN, 1)}건`,
      (c.services || []).includes('guild') ? '의뢰소 O' : '★의뢰소 없음',
      citySpecialty(c.id).map((id) => getClass(id)?.name || id).join('/'),
    ];
  });
  table(['도시', 'tier', '초기평판', '주점', '개방까지', '의뢰소', '특화'], rows, ['l', 'l', 'r', 'l', 'l', 'l', 'l']);

  const startOpen = START_REP >= REP_TAVERN_MIN;
  // 의뢰소가 없는 도시는 평판을 올릴 수단이 없다 = 주점이 영영 안 열린다 (=막힘)
  const dead = CITIES.filter((c) => c.id !== START_CITY
    && (c.services || []).includes('tavern')
    && !(c.services || []).includes('guild'));
  console.log(`\n  시작 도시(${start?.name}) 평판 ${START_REP} → 주점 ${startOpen ? '열림' : '잠김'}`);
  console.log(`  주점은 있는데 의뢰소가 없어 평판을 올릴 수 없는 도시: ${dead.length}개`
    + (dead.length ? ` (${dead.map((c) => c.name).join(', ')})` : ''));

  verdict(startOpen,
    '시작 도시는 처음부터 주점이 열려 있다 — 초반이 막히지 않는다.',
    `시작 도시 평판 ${START_REP} < 개방선 ${REP_TAVERN_MIN} — 새 게임이 주점부터 막힌다.`);
  verdict(dead.length === 0,
    '모든 도시에서 의뢰로 평판을 올려 주점을 열 수 있다 (막다른 도시 없음).',
    `평판을 올릴 수단이 없는데 주점만 잠긴 도시가 있다: ${dead.map((c) => c.name).join(', ')}`);
}

/* ───────────────────── 6. 도시별 "가장 좋은 S 확률" 랭킹 ───────────────────── */

function cityRanking() {
  head('6. 도시별 최대 S 확률 (평판 100 기준) — 저티어가 실제로 경쟁력이 있나');
  const rows = CITIES.map((c) => {
    const spec = citySpecialty(c.id);
    const sSpec = spec.length ? gradeChances(c.tier, { rep: 100, specialty: true }).S : 0;
    const sPlain = gradeChances(c.tier, { rep: 100 }).S;
    return {
      name: c.name, tier: c.tier,
      spec: spec.map((id) => getClass(id)?.name || id).join('/') || '-',
      sSpec, sPlain,
    };
  }).sort((a, b) => Math.max(b.sSpec, b.sPlain) - Math.max(a.sSpec, a.sPlain));
  table(
    ['도시', 'tier', '특화', '특화클래스 S%', '그 외 S%'],
    rows.map((r) => [r.name, `T${r.tier}`, r.spec, f2(r.sSpec), f2(r.sPlain)]),
    ['l', 'l', 'l', 'r', 'r'],
  );
  const bestLow = Math.max(...rows.filter((r) => r.tier <= 2).map((r) => r.sSpec));
  const bestHigh = Math.max(...rows.filter((r) => r.tier >= 4).map((r) => r.sPlain));
  console.log(`\n  tier 1~2 도시의 특화 클래스 최고 S%: ${f2(bestLow)}   vs   tier 4~5 도시의 비특화 최고 S%: ${f2(bestHigh)}`);
  verdict(bestLow > bestHigh,
    '저티어 특화 도시가 고티어 도시의 일반 고용보다 S를 잘 뽑는다 — 순회할 이유가 있다.',
    '저티어 특화 도시가 고티어 도시를 못 이긴다 — 결국 고티어에 눌러앉게 된다.');
}

/* ────────────────────────────── 실행 ────────────────────────────── */

console.log(`평판 · 특화 도시 검증 (조합당 ${N_ROLL.toLocaleString()}회 롤)`);
console.log(`실효 티어 상한 ${MAX_CITY_TIER} · 주점 개방선 평판 ${REP_TAVERN_MIN} · 시작 도시 평판 ${START_REP}`);

measureAll();
coreCheck();
spreadCheck();
questCountCheck();
lockCheck();
cityRanking();

console.log(`\n${'═'.repeat(84)}`);
if (ISSUES.length) {
  console.log(`종합: ${ISSUES.length}건 실패`);
  ISSUES.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
  process.exit(1);
} else {
  console.log('종합: 전부 통과  [확률표 일치]  [저티어 특화 우위]  [7종 배분]  [평판 속도]  [주점 잠금]');
}
