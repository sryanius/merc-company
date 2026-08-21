// 주점 경제 시뮬 (node tools/tavernecon.mjs).
//
// ★★ 왜 만들었나 (제작자):
//   「5등급 도시에서 의뢰 하나 하고 주점에서 영웅 뽑고 3일 넘기고 반복하고 있는데
//     골드가 너무 여유있는 것 같다. 도시 등급이 올라갈수록 고용가를 올려도 될 것 같은데」
//
// 이 반복은 우연이 아니라 **게임이 만든 주기**다. `REFRESH_DAYS = 3` 이라 주점 목록이
// 3일마다 갈리므로, 「의뢰 1건 → 목록 전부 훑기 → 3일 넘기기」 가 최적 순환이 된다.
//
// 여기서 재는 것:
//   1) 도시 등급별 «의뢰 1건 수입» vs «주점 목록 전부 사는 값» vs «3일 임금»
//   2) 한 번의 순환으로 골드가 얼마나 남는가 (이게 «여유»의 정체다)
//   3) 낸 돈 대비 **받는 것의 값어치** — 고용가는 C등급 기준인데 S가 나온다
//   4) 고용가를 도시 등급으로 더 올리면 1~3 이 어떻게 바뀌는가
//
// 순수 JS 모듈만 import 한다 (DOM 참조 금지).
import { readFileSync } from 'node:fs';
import { RNG } from '../src/core/rng.js';
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import * as Quest from '../src/game/quest.js';
import { CITIES, citySpecialty } from '../src/data/world.js';
import { BASE_CLASSES, getClass } from '../src/data/classes.js';

/* ────────────────────────────── 실행 옵션 ────────────────────────────── */

const ARGV = process.argv.slice(2);
const optNum = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.slice(k.length + 3)) : d;
};
const N = optNum('n', 4000);          // 도시 등급별 표본 순환 수
const SQUADS = optNum('squads', 1);   // 부대 수 (의뢰 개수에 영향)

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
const head = (t) => { console.log(`\n${t}\n${'─'.repeat(92)}`); };
const num = (n) => Math.round(n).toLocaleString('en-US');
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/* ─────────────────────── 게임 코드에서 그대로 가져오는 것 ─────────────────────── */

/**
 * 주점 후보 한 장의 값.
 *
 * ★★ `genTavern` 은 state.js 안의 **비공개 함수**라 부를 수 없다. 그래서 공식을 옮겼는데,
 *   옮긴 것은 언제든 원본과 어긋난다. 아래 `assertMirror()` 가 매 실행마다
 *   원본 소스를 읽어 이 식이 아직 같은지 확인한다 — 어긋나면 시뮬을 멈춘다.
 */
const OFFER_TIER_MULT = (tier) => Quest.cityPowerOf(tier) ** Quest.CITY_REWARD_POW;
const offerCost = (classId, tier, r, extra = 1) => {
  let base = 0;
  try { base = Merc.hireCost(classId, 'C', 1) || 0; } catch { base = 0; }
  if (!base) base = 260;
  return Math.round(base * OFFER_TIER_MULT(tier) * extra * r.float(0.88, 1.18) / 5) * 5;
};

/** 주점 목록 한 벌 (genTavern 과 같은 규칙: 특화는 항상, 나머지는 무작위) */
function genOffers(city, r, extra = 1) {
  const tier = Math.max(1, Math.min(5, city.tier || 1));
  const count = Math.max(3, Math.min(6, 3 + r.int(0, 2) + (tier >= 4 ? 1 : 0)));
  const base = Array.isArray(BASE_CLASSES) ? BASE_CLASSES : [];
  const spec = (Array.isArray(city.specialty) ? city.specialty : []).filter((c) => base.includes(c));
  const rest = r.pickMany(base.filter((c) => !spec.includes(c)), Math.max(0, count - spec.length));
  return [...spec, ...rest].map((classId) => ({
    classId, cost: offerCost(classId, tier, r, extra), spec: spec.includes(classId),
  }));
}

/** 옮겨 적은 식이 원본과 아직 같은지 — 어긋나면 이 도구의 결론이 전부 거짓이 된다 */
function assertMirror() {
  const src = readFileSync(new URL('../src/game/state.js', import.meta.url), 'utf8');
  const want = [
    'const count = clamp(3 + r.int(0, 2) + (tier >= 4 ? 1 : 0), 3, 6);',
    "Merc.hireCost(classId, 'C', 1)",
    'const cityMult = Quest.cityPowerOf(tier) ** Quest.CITY_REWARD_POW;',
    'const cost = Math.round(base * cityMult * r.float(0.88, 1.18) / 5) * 5;',
  ];
  const missing = want.filter((w) => !src.includes(w));
  if (missing.length) {
    console.error('\n[중단] genTavern 이 바뀌었다. 이 도구의 공식이 원본과 다르다:\n');
    for (const m of missing) console.error('  · 못 찾음: ' + m);
    console.error('\n  tools/tavernecon.mjs 의 offerCost/genOffers 를 원본에 맞춰 고쳐라.\n');
    process.exit(1);
  }
}

/* ────────────────────────────── 부대 만들기 ────────────────────────────── */

/** 그 등급 도시에서 실제로 굴릴 만한 부대 — 평균 레벨을 도시 하한에 맞춘다 */
function makeSquad(tier, level, grade) {
  const cls = ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'];
  return cls.map((classId, i) => ({
    uid: 'u' + i, classId, level, grade,
    upkeep: 0,
  })).map((m) => ({ ...m, upkeep: Merc.upkeepOf(m) }));
}

/* ────────────────────────────── 한 순환 ────────────────────────────── */

/**
 * 「의뢰 1건 → 주점 훑기 → 3일 넘기기」 한 바퀴.
 * @returns {{income:number, hire:number, upkeep:number, offers:number, rank:string}}
 */
function oneCycle(city, squad, r, extra) {
  const tier = Math.max(1, Math.min(5, city.tier || 1));

  // ── 수입: 그 도시에 뜬 의뢰 중 **부대가 감당할 만한 것 하나**
  const quests = Quest.genQuests(city.id, 1 + r.int(0, 60), r, SQUADS) || [];
  const lv = squad[0].level;
  // 권장 레벨이 부대 레벨을 크게 넘지 않는 것 중 보상이 가장 큰 것 (플레이어의 실제 선택)
  const doable = quests.filter((q) => (q.level || 1) <= lv + 6);
  const pick = (doable.length ? doable : quests)
    .slice().sort((a, b) => (b.reward?.gold || 0) - (a.reward?.gold || 0))[0];
  const income = pick ? (pick.reward?.gold || 0) : 0;

  // ── 지출 1: 주점 목록을 **전부** 산다 (제작자가 하고 있는 «영웅 뽑기» 반복)
  const offers = genOffers(city, r, extra);
  const hire = offers.reduce((a, o) => a + o.cost, 0);

  /* ── 지출 2: 임금.
   *
   * ★★ 순환 길이는 3일이 **아니다.** 의뢰가 날짜를 먹는다 (RANK_DAYS: S는 6~7일).
   *   주점은 3일마다 갈리므로 실제 한 바퀴는 max(의뢰 소요일, 3일) 이다.
   *   이걸 3일로 고정해서 재면 임금을 절반 이하로 과소평가한다 — 임금이 이 게임의
   *   유일한 브레이크이므로 그 오차가 결론을 통째로 바꾼다. */
  const cycleDays = Math.max(State.REFRESH_DAYS, Math.max(1, Math.round(pick?.days || 1)));
  const daily = squad.reduce((a, m) => a + Merc.upkeepOf(m), 0);

  return {
    income, hire, upkeep: daily * cycleDays, days: cycleDays, offers: offers.length,
    rank: pick ? pick.rank : '—', qLevel: pick ? pick.level : 0,
    specCost: offers.filter((o) => o.spec).reduce((a, o) => a + o.cost, 0),
    specN: offers.filter((o) => o.spec).length,
  };
}

/* ────────────────────────────── 뽑기의 값어치 ────────────────────────────── */

/**
 * 「낸 돈」 대비 「받은 것의 값어치」.
 *
 * ★ 고용가는 **항상 C등급 기준**으로 매겨진다 (`hireCost(classId, 'C', 1)`).
 *   그런데 실제로 나오는 등급은 추첨이다. 그래서 S 가 나오면 4,000/380 = 10.5배짜리를
 *   C 값에 가져오는 셈이 된다 — 이게 «여유»의 진짜 출처다.
 */
function drawValue(tier, rep, spec, classId) {
  const odds = Merc.gradeOdds(tier, { rep, specialty: spec });
  let val = 0;
  for (const g of Merc.GRADES) val += (odds[g] || 0) * Merc.hireCost(classId, g, 1);
  return { val, odds };
}

/* ────────────────────────────── 본문 ────────────────────────────── */

assertMirror();

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(' 주점 경제 — 「의뢰 1건 → 주점 훑기 → 3일」 순환');
console.log(`   표본 ${num(N)} 순환/등급 · 부대 ${SQUADS}개 · 주점 갱신 주기 ${State.REFRESH_DAYS}일`);
console.log('══════════════════════════════════════════════════════════════════════════════');

/* 도시 등급별로 «그 등급에서 실제로 굴릴 부대» 를 잡는다.
 * 5등급 도시를 도는 사람은 만렙에 가깝다 — 그래야 임금(유일한 브레이크)이 제대로 반영된다. */
const PROFILE = {
  1: { level: 8, grade: 'D' },
  2: { level: 22, grade: 'C' },
  3: { level: 38, grade: 'C' },
  4: { level: 55, grade: 'B' },
  5: { level: 72, grade: 'B' },
};

function runAll(extra, label) {
  head(label);
  const rows = [];
  const keep = {};
  for (let tier = 1; tier <= 5; tier++) {
    const city = CITIES.find((c) => (c.tier || 1) === tier && (c.specialty || []).length)
      || CITIES.find((c) => (c.tier || 1) === tier);
    const p = PROFILE[tier];
    const squad = makeSquad(tier, p.level, p.grade);
    const r = new RNG(1000 + tier);
    const inc = []; const hire = []; const up = []; const net = []; const card = []; const dys = [];
    for (let i = 0; i < N; i++) {
      const c = oneCycle(city, squad, r, extra);
      inc.push(c.income); hire.push(c.hire); up.push(c.upkeep); dys.push(c.days);
      card.push(c.hire / Math.max(1, c.offers));
      net.push(c.income - c.hire - c.upkeep);
    }
    const mi = med(inc); const mh = med(hire); const mu = med(up); const mn = med(net);
    const mc = med(card); const md = med(dys);
    keep[tier] = { income: mi, hire: mh, upkeep: mu, net: mn, card: mc, days: md };
    rows.push([
      `${tier}등급`, `Lv${p.level} ${p.grade}`, `${md}일`, num(mi), num(mc), num(mh), num(mu), num(mn),
      // ★ 제일 잘 와닿는 수치: 의뢰 한 건 값으로 뽑기를 몇 장 살 수 있나
      `${(mi / Math.max(1, mc)).toFixed(1)}장`,
      `${(mh / Math.max(1, mi) * 100).toFixed(0)}%`,
    ]);
  }
  table(
    ['도시', '부대', '순환', '의뢰 수입', '뽑기 1장', '주점 전부', '순환 임금', '순환 순익', '의뢰 1건 = 몇 장', '고용/수입'],
    rows, ['', '', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
  );
  return keep;
}

const NOW = runAll(1, '1. 지금 — 고용가 배율 = cityPower^CITY_REWARD_POW (의뢰 보상과 같은 기울기)');

head('2. 기울기 맞춤 — 고용가가 의뢰 보상과 같은 지수를 쓴다');
{
  const rows = [];
  for (let tier = 1; tier <= 5; tier++) {
    const power = Quest.cityPowerOf(tier);
    rows.push([
      `${tier}등급`,
      power.toFixed(2),
      `×${(power ** Quest.CITY_REWARD_POW).toFixed(2)}`,
      `×${OFFER_TIER_MULT(tier).toFixed(2)}`,
      `${((power ** Quest.CITY_REWARD_POW) / OFFER_TIER_MULT(tier)).toFixed(2)}배`,
      num(NOW[tier].income), num(NOW[tier].hire),
    ]);
  }
  table(
    ['도시', 'cityPower', '의뢰 보상 배율', '고용가 배율', '벌어진 폭', '실측 수입', '실측 고용'],
    rows, ['', 'r', 'r', 'r', 'r', 'r', 'r'],
  );
  console.log('');
  console.log('  «벌어진 폭» 이 전 등급 1.00 이면 도시를 올라가도 뽑기의 상대 가격이 그대로다.');
  console.log('  옛 식(1 + 0.2×(t−1))에서는 5등급이 1.80배뿐이라 폭이 2.01 까지 벌어져 있었다 —');
  console.log('  의뢰 한 건으로 살 수 있는 뽑기가 100.3장이었고, 지금은 그 절반이다.');
  console.log('');
  console.log('  ★ 그래도 5등급 순환은 여전히 크게 흑자다. 아래 5·7번이 그 이유를 말한다 —');
  console.log('    주점은 애초에 작은 지출처이고, 하루 지출이 임금 하나뿐이다.');
}

head('3. 낸 돈 대비 받는 값어치 — 고용가는 «C등급 기준»인데 등급은 추첨이다');
{
  const rows = [];
  const cls = 'swordsman';
  for (let tier = 1; tier <= 5; tier++) {
    for (const [repL, rep] of [['평판 10', 10], ['평판 100', 100]]) {
      for (const spec of [false, true]) {
        const { val, odds } = drawValue(tier, rep, spec, cls);
        const price = Merc.hireCost(cls, 'C', 1) * OFFER_TIER_MULT(tier);
        rows.push([
          `${tier}등급`, repL, spec ? '명물' : '일반',
          num(price), num(val), `${(val / price).toFixed(2)}배`,
          `${((odds.S || 0) * 100).toFixed(2)}%`,
          `${(((odds.A || 0) + (odds.S || 0)) * 100).toFixed(1)}%`,
        ]);
      }
    }
  }
  table(['도시', '평판', '슬롯', '내는 값', '기대 값어치', '배수', 'S 확률', 'A+S'], rows,
    ['', '', '', 'r', 'r', 'r', 'r', 'r']);
  console.log('');
  console.log('  «배수» 가 1을 넘으면 뽑을수록 이득이다. 이 값이 도시 등급을 따라 오르면');
  console.log('  고등급 도시에서 목록을 통째로 사는 게 항상 옳은 선택이 된다 — 고를 이유가 사라진다.');
}

head('4. 여기서 더 올리면 — 참고용 후보');
{
  /* 후보는 «5등급에서 몇 배인가» 로 고른다.
   *   지금       1 + 0.20×(t−1)  → 5등급 1.80배
   *   가) 완만   1 + 0.45×(t−1)  → 5등급 2.80배
   *   나) 보상연동  cityPower^2 그대로 → 5등급 3.61배 (수입과 같은 기울기)
   *   다) 가파름  cityPower^2.6      → 5등급 5.44배 (고등급에서 확실히 아프다) */
  const CANDS = [
    { key: '옛', label: '옛 식  1 + 0.20×(t−1)', f: (t) => 1 + 0.2 * (t - 1) },
    { key: '★', label: '지금  cityPower²  (채택)', f: (t) => Quest.cityPowerOf(t) ** 2 },
    { key: '가', label: '가파름  cityPower^2.6', f: (t) => Quest.cityPowerOf(t) ** 2.6 },
  ];
  const rows = [];
  for (const c of CANDS) {
    for (let tier = 1; tier <= 5; tier++) {
      const city = CITIES.find((x) => (x.tier || 1) === tier && (x.specialty || []).length)
        || CITIES.find((x) => (x.tier || 1) === tier);
      const p = PROFILE[tier];
      const squad = makeSquad(tier, p.level, p.grade);
      const r = new RNG(1000 + tier);
      const net = []; const hire = []; const inc = [];
      const extra = c.f(tier) / OFFER_TIER_MULT(tier);   // 기존 배율 위에 얹는 계수
      for (let i = 0; i < N; i++) {
        const x = oneCycle(city, squad, r, extra);
        inc.push(x.income); hire.push(x.hire); net.push(x.income - x.hire - x.upkeep);
      }
      const mi = med(inc); const mh = med(hire); const mn = med(net);
      rows.push([
        tier === 1 ? c.key : '', tier === 1 ? c.label : '', `${tier}등급`,
        `×${c.f(tier).toFixed(2)}`, num(mi), num(mh), num(mn),
        `${(mh / Math.max(1, mi) * 100).toFixed(0)}%`,
        `${(mn / Math.max(1, mi) * 100).toFixed(0)}%`,
      ]);
    }
  }
  table(['', '안', '도시', '배율', '의뢰 수입', '주점 전부', '순환 순익', '고용/수입', '순익률'],
    rows, ['', '', '', 'r', 'r', 'r', 'r', 'r', 'r']);
}

head('5. 그래서 얼마나 올려야 «느껴지나»');
{
  /* ★★ 4번 표가 뒤집은 결론: 가장 가파른 안(5등급 ×5.31)도 고용/수입을 5% → 14% 로만 올린다.
   *   주점 목록은 3~6장뿐이라 **애초에 지출처로서 너무 작다.**
   *   목표 비율을 정해 놓고 역산하면 필요한 배율이 얼마나 큰지 바로 보인다. */
  const rows = [];
  for (let tier = 1; tier <= 5; tier++) {
    const now = NOW[tier];
    const r = [`${tier}등급`, num(now.income), num(now.hire), `${(now.hire / Math.max(1, now.income) * 100).toFixed(0)}%`];
    for (const target of [0.10, 0.25, 0.50]) {
      const need = now.income * target;
      const mult = OFFER_TIER_MULT(tier) * (need / Math.max(1, now.hire));
      r.push(mult <= OFFER_TIER_MULT(tier) ? '지금도 넘음' : `×${mult.toFixed(1)}`);
    }
    rows.push(r);
  }
  table(['도시', '의뢰 수입', '지금 고용', '지금 비율', '10% 되려면', '25% 되려면', '50% 되려면'],
    rows, ['', 'r', 'r', 'r', 'r', 'r', 'r']);
  console.log('');
  console.log('  5등급에서 «의뢰 한 건의 25%» 만큼 쓰게 하려면 배율이 지금 1.8배에서 **9배 근처**로 가야 한다.');
  console.log('  그 정도면 저등급 도시는 손도 못 대므로, 배율 하나로는 못 푼다.');
}

head('6. 다른 지렛대 — 값을 «뽑힌 등급»으로 매기면');
{
  /* ★ 지금은 `hireCost(classId, 'C', 1)` 로 **항상 C등급 값**을 매긴다.
   *   등급은 살 때 추첨되므로 S가 나와도 C값만 낸다 — 이게 차익의 진짜 출처다.
   *   값을 뽑힌 등급으로 매기면 배율을 안 건드려도 평균 지출이 오른다. */
  const rows = [];
  const cls = 'swordsman';
  for (let tier = 1; tier <= 5; tier++) {
    for (const [repL, rep] of [['평판 10', 10], ['평판 100', 100]]) {
      const specOdds = Merc.gradeOdds(tier, { rep, specialty: true });
      const genOdds = Merc.gradeOdds(tier, { rep, specialty: false });
      let sv = 0; let gv = 0;
      for (const g of Merc.GRADES) {
        sv += (specOdds[g] || 0) * Merc.hireCost(cls, g, 1);
        gv += (genOdds[g] || 0) * Merc.hireCost(cls, g, 1);
      }
      const cbase = Merc.hireCost(cls, 'C', 1);
      rows.push([
        `${tier}등급`, repL,
        num(cbase * OFFER_TIER_MULT(tier)),
        num(gv * OFFER_TIER_MULT(tier)), `${(gv / cbase).toFixed(2)}배`,
        num(sv * OFFER_TIER_MULT(tier)), `${(sv / cbase).toFixed(2)}배`,
      ]);
    }
  }
  table(['도시', '평판', '지금(C기준)', '등급값·일반', '배수', '등급값·명물', '배수'],
    rows, ['', '', 'r', 'r', 'r', 'r', 'r']);
  console.log('');
  console.log('  ★ 다만 등급은 **살 때** 추첨된다(genTavern 은 classId·cost 만 저장한다).');
  console.log('    등급으로 값을 매기려면 셋 중 하나를 골라야 한다:');
  console.log('      (A) 목록 만들 때 등급까지 뽑아 «S등급 검사 — 8,000G» 로 내건다 → 도박이 사라지고 상점이 된다');
  console.log('      (B) 추첨은 그대로 두고 **값만** 기대 등급 기준으로 올린다 → 운 나쁘면 손해, 운 좋으면 이득');
  console.log('      (C) 뽑기 수수료를 먼저 받고, 등급을 보여 준 뒤 **등급값으로 후불** (거절 가능)');
}

head('7. 정원을 늘리면 — 임금이 유일한 브레이크다');
{
  /* ★ 하루에 골드가 빠지는 곳은 **임금 하나뿐**이다.
   *   시설 유지비·수리비·이동비 같은 반복 지출은 코드에 아예 없다.
   *   벤치 단원은 BENCH_UPKEEP_MULT(0.25) 로 25% 만 낸다 — 그래서 정원을 키워야 브레이크가 걸린다.
   *   「의뢰 1건 → 3일」 순환 기준으로, 정원이 몇이어야 순익이 꺾이는지 본다. */
  const rows = [];
  const tier = 5;
  const p = PROFILE[tier];
  const income = NOW[tier].income;
  const hire = NOW[tier].hire;
  const one = Merc.upkeepOf({ classId: 'swordsman', level: p.level, grade: p.grade });
  const cycle = NOW[tier].days;      // 실제 한 바퀴 일수 (의뢰 소요일과 주점 갱신 중 큰 쪽)
  for (const cap of [7, 14, 20, 28, 40, 60, 80, 120]) {
    const bench = Math.max(0, cap - 7);
    const daily = one * 7 + one * bench * State.BENCH_UPKEEP_MULT;
    const up3 = daily * cycle;
    const net = income - hire - up3;
    rows.push([
      `정원 ${cap}`, num(daily), num(up3), num(income), num(hire), num(net),
      `${(up3 / income * 100).toFixed(0)}%`, net > 0 ? '흑자' : '적자',
    ]);
  }
  table(['정원', '일 임금', `${cycle}일 임금`, '의뢰 수입', '주점 전부', '순환 순익', '임금/수입', ''],
    rows, ['', 'r', 'r', 'r', 'r', 'r', 'r', '']);
  console.log('');
  const need = Math.ceil(((income - hire) / cycle / one - 7) / State.BENCH_UPKEEP_MULT) + 7;
  console.log(`  5등급에서 이 순환(${cycle}일)이 적자로 도는 정원은 **${num(need)}명** 근처다 (Lv${p.level} ${p.grade} 기준).`);
  console.log('  즉 지금 구조에서는 «단원을 잔뜩 데리고 있는 것» 말고는 골드를 태울 방법이 없다.');
  console.log('  하루 지출이 임금 하나뿐이라는 게 «여유»의 구조적 원인이다 —');
  console.log('  시설 유지비·수리비·이동비 같은 반복 지출은 코드에 아예 없다.');
}

head('8. 요약');
{
  console.log('  · 이 반복은 게임이 만든 주기다 — REFRESH_DAYS = 3 이라 3일마다 주점이 갈린다.');
  console.log('  · 고용가를 의뢰 보상과 **같은 지수**로 맞췄다 (cityPower ** CITY_REWARD_POW).');
  console.log('    5등급 1.80배 → 3.61배. 의뢰 1건에 살 수 있는 뽑기가 100.3장 → 50.4장.');
  console.log('  · 고용가 기준이 **항상 C등급**이라(hireCost(cls, \'C\', 1)) 명물 슬롯에서 S가 나오면');
  console.log('    C값(380)으로 S(4,000)를 사는 셈이다. 고등급 도시일수록 이 차익이 커진다.');
  console.log('');
  console.log(`  임금이 이 게임의 유일한 브레이크인데(merc.js 주석), 한 순환(${NOW[5].days}일) 임금은 의뢰 한 건 수입의`);
  console.log(`  ${(NOW[5].upkeep / NOW[5].income * 100).toFixed(0)}% 뿐이라 5등급에서는 사실상 브레이크가 안 걸린다.`);
  console.log('');
  console.log('  ★★ 배율은 맞췄지만 «여유» 자체는 남아 있다 — 주점이 작은 지출처라 어쩔 수 없다.');
  console.log('     골드를 더 태우려면 지출처를 **늘려야** 한다 (반복 지출이 임금 하나뿐이다).');
  console.log('     값을 등급으로 매기는 안은 채택하지 않았다 — 도박은 도박으로 남긴다(제작자 결정).');
  console.log('');
}
