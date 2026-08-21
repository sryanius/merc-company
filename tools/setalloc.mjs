/**
 * 세트가 «누구에게» 가는가 (node tools/setalloc.mjs).
 *
 * ★★ 왜 만들었나 (제작자):
 *   「성좌의 은총은 사제한테 우선순위를 주자. 지금은 사제가 계속 세트 아이템을 못 쓰고 있어」
 *
 * 자동 착용은 **전투력 순**으로 돌면서 각자 자기 점수가 가장 높은 것을 집어 간다.
 * 사제는 전투력이 낮아 **맨 뒤**에 고르고, 게다가 healer 가중치는 atk 0.85 인데
 * 다른 아키타입은 2.2~2.6 이라 같은 조각이라도 점수가 3배 가까이 낮게 나온다.
 * 그래서 사제가 노리는 세트를 앞사람들이 먼저 나눠 가진다 — 그 현상을 여기서 잰다.
 *
 * ★ 눈으로 «사제가 못 쓴다» 를 확인할 수는 있어도, 고친 뒤 **얼마나 나아졌는지**는 재야 안다.
 *   숫자 없이 배점을 만지면 이번엔 반대로 사제가 다 가져가는 쪽으로 넘어간다.
 *
 * 실행: node tools/setalloc.mjs
 */
import * as St from '../src/game/state.js';
import * as Gear from '../src/game/gear.js';
import * as Sets from '../src/data/sets.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import * as Merc from '../src/game/merc.js';
import { RNG } from '../src/core/rng.js';

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
const head = (t) => { console.log(`\n${t}\n${'─'.repeat(86)}`); };
const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/* ────────────────────────────── 판 만들기 ────────────────────────────── */

/** 4차 만렙 7인 부대 (사제 포함) + 창고에 세트 조각을 넣는다 */
function build(setIds, { copies = 1, seed = 7, classes = null } = {}) {
  St.newGame(seed, '배분시험');
  const st = St.state;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);

  const T4 = classes || ['bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
    'masterarcher_apex', 'archmage_apex', 'highpriest_abyss'];
  T4.forEach((cid, i) => {
    const m = Merc.createMerc({ classId: cid, grade: 'S', level: 80 });
    m.hiredDay = 2;
    st.roster.push(m);
    sq.memberUids[i] = m.uid;
    m.squadId = sq.id;
    m.slotIndex = i;
  });

  const r = new RNG(seed * 31 + 5);

  /* ★★ 일반 장비를 **넉넉히** 깔아 둔다.
   *   세트만 있으면 첫 사람이 10칸을 통째로 채우고 끝난다 — 그건 «누가 선호하나» 가 아니라
   *   «누가 먼저 고르나» 만 재는 것이다. 실제 창고에는 전설 장비가 잔뜩 있으므로
   *   각자 대안이 있는 상태에서 세트가 누구에게 남는지를 봐야 한다.
   *   개수는 7명 x 10칸 = 70칸을 **넉넉히** 넘겨야 한다 — 재고가 모자라면
   *   «뺏긴 사람이 못 채운다» 가 재배치 버그인지 재고 부족인지 구분이 안 된다. */
  for (let i = 0; i < 320; i++) {
    const it = Gear.rollItem({ ilvl: 78 + r.int(0, 2), rarityBonus: 0.9, rng: r });
    if (it) st.items.push(it);
  }
  const slots = Array.isArray(Sets.SET_SLOTS) && Sets.SET_SLOTS.length
    ? Sets.SET_SLOTS : ['weapon', 'offhand', 'head', 'armor', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];
  for (const setId of setIds) {
    for (let c = 0; c < copies; c++) {
      for (const slot of slots) {
        const it = Gear.rollSetItem({ setId, slot, ilvl: 80, rng: r });
        if (it) st.items.push(it);
      }
    }
  }
  return st;
}

/** 자동 착용 후 «누가 어느 세트를 몇 조각» 가졌나 */
function allocate(st) {
  Gear.autoEquipAll(st, {});
  const rows = [];
  for (const m of st.roster) {
    const cls = getClass(m.classId);
    const cnt = {};
    for (const s of Object.keys(m.equipment || {})) {
      const uid = m.equipment[s];
      if (!uid) continue;
      const it = (st.items || []).find((x) => x && x.uid === uid);
      const sid = it && Gear.setIdOf(it);
      if (sid) cnt[sid] = (cnt[sid] || 0) + 1;
    }
    rows.push({ name: m.name, arch: (cls && cls.arch) || '?', cls: (cls && cls.name) || m.classId, cnt });
  }
  return rows;
}

/* ────────────────────────────── 본문 ────────────────────────────── */

const SETS = ['constellation'];
const NAMES = Object.fromEntries(SETS.map((id) => [id, (Sets.getSet(id) || {}).name || id]));

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(' 세트가 누구에게 가는가 — 4차 만렙 7인, 창고에 세트 한 벌');
console.log('══════════════════════════════════════════════════════════════════════════════');

head(`1. ${NAMES.constellation} 한 벌(10칸)만 창고에 있을 때`);
{
  const st = build(['constellation'], { copies: 1 });
  const rows = allocate(st).map((x) => [
    x.cls, x.arch, String(x.cnt.constellation || 0),
    (x.cnt.constellation || 0) >= 3 ? '★ 세트 발동' : '',
  ]);
  table(['클래스', '아키타입', '성좌 조각', ''], rows, ['', '', 'r', '']);
  const healer = allocate.last;
  console.log('');
  console.log('  ★ 자동 착용은 **전투력 순**으로 돈다 — 사제는 전투력이 낮아 맨 뒤에 고른다.');
  console.log(`  ★ healer 가중치는 atk 0.85 인데 fighter 2.40 · mage 2.60 이라 (gear.js ARCH_WEIGHTS)`);
  console.log('    같은 조각이라도 사제가 매기는 점수가 훨씬 낮다.');
}

head('2. 아키타입별 «성좌 조각 하나» 점수 — 왜 사제가 밀리나');
{
  const st = build(['constellation'], { copies: 1 });
  const piece = (st.items || []).find((it) => Gear.setIdOf(it) === 'constellation' && it.slot === 'armor')
    || (st.items || [])[0];
  const rows = [];
  for (const m of st.roster) {
    const cls = getClass(m.classId);
    let sc = 0;
    try {
      sc = Gear.scoreItemFor(m, piece, { slot: 'armor', items: st, checkEquip: false, worn: [] });
    } catch { sc = 0; }
    rows.push([(cls && cls.name) || m.classId, (cls && cls.arch) || '?', sc.toFixed(1)]);
  }
  rows.sort((a, b) => Number(b[2]) - Number(a[2]));
  table(['클래스', '아키타입', `${piece && piece.name} 점수`], rows, ['', '', 'r']);
}

head('3. 사제가 없는 부대 — 세트는 창고에 남는다 (제작자 결정)');
{
  /* ★ 「성좌의 은총」은 **사제 전용**이다 (sets.js archs: ['healer']).
   *   그래서 사제가 없는 부대는 아예 못 쓴다 — 버려지는 게 아니라 «자격이 없는» 것이다.
   *   제작자 결정: 「그냥 성좌의 은총은 사제만 입는 걸로 하고,
   *   나중에 사제 계열 서포터 클래스를 만들든가 하자」.
   *   여기서는 그게 **오류 없이** 동작하는지(아무도 못 끼고 창고에 남는지)만 본다. */
  const NOHEAL = ['bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
    'masterarcher_apex', 'archmage_apex', 'swordgod_apex'];
  const st = build(['constellation'], { copies: 1, classes: NOHEAL });
  const rows = allocate(st);
  const worn = rows.reduce((a, x) => a + (x.cnt.constellation || 0), 0);
  const holes = st.roster.reduce((a, m) => a + Object.keys(m.equipment || {}).filter((k) => !m.equipment[k]).length, 0);
  console.log(`  착용된 성좌 조각 ${worn}칸 (0이어야 정상) · 부대 빈 칸 ${holes}`);
  if (worn === 0 && holes <= 3) console.log('  판정: 아무도 못 끼고, 부대는 다른 장비로 정상 착용 — 통과');
  else if (worn > 0) console.log('  판정: **사제가 아닌데 끼고 있다** — archs 제한이 안 걸린다');
  else console.log(`  판정: 부대에 빈 칸이 ${holes}개 — 창고 재고를 확인해라`);
}

head('4. 사제만 낄 수 있나 — 계열 제한 확인');
{
  /* 배점(prefer)이 아니라 **자격(archs)** 으로 막는지 직접 확인한다.
   * 배점은 «덜 좋아 보이게» 할 뿐이라 여러 벌이 돌아다니면 결국 새어 나갔다
   * (제작자 화면에서 10·5·5·3·3 으로 흩어졌다). 자격 제한은 새지 않는다. */
  const st = build(['constellation'], { copies: 1 });
  const piece = (st.items || []).find((it) => Gear.setIdOf(it) === 'constellation');
  const rows = [];
  for (const m of st.roster) {
    const cls = getClass(m.classId) || {};
    const issue = Gear.equipIssue(m, piece, null, st);
    rows.push([cls.name || m.classId, cls.arch, issue ? '✗ ' + String(issue).slice(0, 30) : '✓ 낄 수 있다']);
  }
  table(['클래스', '아키타입', '성좌 조각'], rows);
  const okN = rows.filter((r) => r[2].startsWith('✓')).length;
  console.log('');
  console.log(okN === 1 ? '  판정: 사제 한 명만 낄 수 있다 — 통과' : `  판정: **${okN}명이 낄 수 있다** — 사제만이어야 한다`);
}

head('5. ★ 흩어진 상태에서 모이나 — 「강철 성벽」 2벌 (계열 제한이 느슨한 세트)');
{
  /* ★★ 제작자 화면: 성좌가 10 · 5 · 5 · 3 · 3 으로 다섯 명에게 흩어져 있었다.
   *   한 칸씩 «지금 낀 것보다 나은가» 를 보는 탐욕법은 그 상태에서 못 빠져나온다 —
   *   조각 하나를 옮겨 봐야 그 칸만 보면 손해라 아무도 안 움직인다.
   *   전원 벗기고 다시 나누는 것(reset)이 실제로 그걸 푸는지 나란히 놓고 본다. */
  const scatter = (st, setId = 'ironrampart') => {
    // 세트를 아무에게나 조금씩 나눠 입힌다 (흩어진 상태를 만든다)
    const pieces = (st.items || []).filter((it) => Gear.setIdOf(it) === setId);
    let i = 0;
    for (const it of pieces) {
      const m = st.roster[i % st.roster.length];
      Gear.equipItem(st, m, it, null);
      if (i % 3 === 2) i++;
      i++;
    }
  };
  const measure = (opt, setId = 'ironrampart') => {
    const st = build([setId], { copies: 2, seed: 13 });
    scatter(st, setId);
    const spread0 = st.roster.map((m) => Object.values(m.equipment || {}).filter(Boolean)
      .map((u) => (st.items || []).find((x) => x && x.uid === u))
      .filter((x) => x && Gear.setIdOf(x) === 'ironrampart').length).filter((n) => n > 0);
    Gear.autoEquipAll(st, opt);
    const rows = st.roster.map((m) => {
      const cls = getClass(m.classId) || {};
      const worn = Object.values(m.equipment || {}).filter(Boolean);
      const setN = worn.map((u) => (st.items || []).find((x) => x && x.uid === u))
        .filter((x) => x && Gear.setIdOf(x) === 'ironrampart').length;
      return { cls: cls.name || m.classId, arch: cls.arch, setN, worn: worn.length };
    });
    /* ★★ 진짜 잣대는 **전투력 총합**이다. 세트 단계는 그 일부일 뿐이라,
     *   단계만 보고 고르면 «세트는 모였는데 부대가 약해진» 결과를 놓친다. */
    const power = st.roster.reduce((a, m) => a + Merc.mercPower(m, st), 0);
    return { before: spread0.sort((a, b) => b - a), rows, power };
  };
  /* ★ 잣대: «몇 칸 모였나» 가 아니라 **실제로 발동한 단계**를 센다.
   *   세트 보너스는 3/5/7/풀 단계에서만 나오므로, 2칸이나 4칸은 값이 같다(각각 0단계·1단계).
   *   조각 수만 보면 «흩어져도 총합은 같다» 는 착시가 생긴다. */
  const TIERS = [3, 5, 7, 10];
  const tierOf = (n) => TIERS.filter((x) => n >= x).length;      // 발동 단계 수
  const score = (rows) => rows.reduce((a, x) => a + tierOf(x.setN), 0);

  const a1 = measure({});
  const b1 = measure({ reset: true });
  console.log(`  배분 전 흩어짐: ${a1.before.join(' · ')}칸 (발동 단계 ${a1.before.reduce((s, n) => s + tierOf(n), 0)})`);
  const fmt = (r) => r.rows.filter((x) => x.setN > 0)
    .map((x) => `${x.cls} ${x.setN}(${tierOf(x.setN)}단계)`).join(' · ') || '(아무도 없음)';
  table(['방식', '세트를 가진 사람', '발동 단계 합', '빈 칸', '부대 전투력 합'], [
    ['지금(한 칸씩)', fmt(a1), String(score(a1.rows)),
      String(a1.rows.reduce((s, x) => s + (10 - x.worn), 0)), num(a1.power)],
    ['백지 재배분', fmt(b1), String(score(b1.rows)),
      String(b1.rows.reduce((s, x) => s + (10 - x.worn), 0)), num(b1.power)],
  ], ['', '', 'r', 'r', 'r']);
  console.log(`  전투력 차이: ${b1.power >= a1.power ? '+' : ''}${num(b1.power - a1.power)} (${((b1.power / Math.max(1, a1.power) - 1) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(score(b1.rows) >= score(a1.rows)
    ? '  판정: 백지 재배분이 같거나 낫다.'
    : '  판정: **백지 재배분이 더 나쁘다** — 백지에서는 첫 조각에 세트 시너지가 0 이라');
  if (score(b1.rows) < score(a1.rows)) {
    console.log('        세트를 모으는 힘이 없다. 지금 방식은 breaksSetTier 로 세트를 지켜서 오히려 낫다.');
  }
}

head('6. 판정');
{
  const st = build(['constellation'], { copies: 1 });
  const rows = allocate(st);
  const healer = rows.find((x) => x.arch === 'healer');
  const got = healer ? (healer.cnt.constellation || 0) : 0;
  const best = Math.max(...rows.map((x) => x.cnt.constellation || 0));
  const topWho = rows.find((x) => (x.cnt.constellation || 0) === best);
  console.log(`  사제(${healer ? healer.cls : '?'}) 성좌 조각: ${got}칸`);
  console.log(`  가장 많이 가진 사람: ${topWho ? topWho.cls : '?'} (${best}칸)`);
  console.log('');
  if (got >= 3) console.log('  판정: 사제가 세트 효과(3칸 이상)를 받는다 — 통과');
  else console.log(`  판정: **사제가 세트를 못 쓴다** (${got}칸 < 3칸) — 제작자 지적 그대로다`);
}
console.log('');
