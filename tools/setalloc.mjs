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

head('3. 사제가 없는 부대 — 세트가 버려지지 않나');
{
  /* ★★ 비임자 배율을 너무 내리면 **아무도 안 끼고 창고에 남는다.**
   *   임자가 그 부대에 없을 수도 있기 때문이다. 그 경계를 여기서 지킨다 —
   *   사제 없는 부대라도 누군가는 세트를 써야 한다(안 쓰면 그냥 손해다). */
  const NOHEAL = ['bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
    'masterarcher_apex', 'archmage_apex', 'swordgod_apex'];
  const st = build(['constellation'], { copies: 1, classes: NOHEAL });
  const rows = allocate(st);
  const worn = rows.reduce((a, x) => a + (x.cnt.constellation || 0), 0);
  const best = Math.max(...rows.map((x) => x.cnt.constellation || 0));
  table(['클래스', '아키타입', '성좌 조각', ''],
    rows.map((x) => [x.cls, x.arch, String(x.cnt.constellation || 0),
      (x.cnt.constellation || 0) >= 3 ? '★ 세트 발동' : '']), ['', '', 'r', '']);
  console.log('');
  console.log(`  착용된 조각 ${worn}/10 · 한 사람 최대 ${best}칸`);
  if (best >= 3) console.log('  판정: 사제가 없어도 누군가 세트를 쓴다 — 통과');
  else console.log('  판정: **아무도 세트를 못 쓴다** — 비임자 배율이 너무 낮다');
}

head('4. ★ 이미 남이 세트를 끼고 있을 때 — 제작자가 겪은 상황');
{
  /* ★★ 제작자 화면: 창룡제가 성좌 7칸, 사제는 3칸.
   *   갓 주운 조각을 나눠 주는 것과 **이미 남이 입고 있는 세트를 옮기는 것**은 다른 문제다.
   *   (a) 배분은 전투력 순이라 사제가 맨 뒤 → 앞사람 것을 못 가져온다
   *   (b) `breaksSetTier` 가 착용자의 세트 단계를 지켜 준다 → 스스로도 안 벗는다
   *   그래서 세트가 한번 남에게 붙으면 그대로 굳는다. 그 상태를 여기서 재현한다. */
  const st = build(['constellation'], { copies: 1 });
  // 창룡제(lancer)에게 성좌를 통째로 입혀 둔다 — 제작자 화면의 출발점
  const lancer = st.roster.find((m) => (getClass(m.classId) || {}).arch === 'lancer');
  const pieces = (st.items || []).filter((it) => Gear.setIdOf(it) === 'constellation');
  let worn = 0;
  for (const it of pieces) {
    const r = Gear.equipItem(st, lancer, it, null);
    if (r && r.ok) worn++;
  }
  console.log(`  준비: 창룡제에게 성좌 ${worn}칸을 입혀 뒀다.`);
  const rows = allocate(st);
  table(['클래스', '아키타입', '성좌 조각', ''],
    rows.map((x) => [x.cls, x.arch, String(x.cnt.constellation || 0),
      (x.cnt.constellation || 0) >= 3 ? '★ 세트 발동' : '']), ['', '', 'r', '']);
  const healer = rows.find((x) => x.arch === 'healer');
  const got = healer ? (healer.cnt.constellation || 0) : 0;
  const lan = rows.find((x) => x.arch === 'lancer');
  console.log('');
  console.log(`  자동 착용 뒤 — 사제 ${got}칸 · 창룡제 ${lan ? (lan.cnt.constellation || 0) : 0}칸`);
  if (got >= 5) console.log('  판정: 세트가 사제에게 옮겨 갔다 — 통과');
  else console.log(`  판정: **세트가 안 옮겨진다** (사제 ${got}칸) — 제작자가 본 그대로다`);

  /* ★★ 뺏긴 사람이 **빈손으로 남으면 안 된다.** 세트를 옮기는 대가로 부대가 약해지면
   *   그건 고친 게 아니다. 창고에 돌아온 물건으로 자리가 메워졌는지 센다. */
  const empt = [];
  for (const m of st.roster) {
    const holes = Object.keys(m.equipment || {}).filter((k) => !m.equipment[k]);
    if (holes.length) empt.push(`${(getClass(m.classId) || {}).name || m.classId} ${holes.length}칸`);
  }
  console.log(`  빈 칸: ${empt.length ? empt.join(' · ') : '없음'}`);
  console.log(empt.length ? '  ※ 창고 재고가 모자라면 빌 수 있다 — 재고를 늘려 아래에서 다시 본다' : '  ※ 전원 빈 칸 없음');
}

head('4b. 뺏긴 사람이 다시 채워지는가 (창고 재고 충분)');
{
  const st = build(['constellation'], { copies: 1 });
  const lancer = st.roster.find((m) => (getClass(m.classId) || {}).arch === 'lancer');
  for (const it of (st.items || []).filter((x) => Gear.setIdOf(x) === 'constellation')) Gear.equipItem(st, lancer, it, null);
  const before = Object.values(lancer.equipment || {}).filter(Boolean).length;
  Gear.autoEquipAll(st, {});
  const after = Object.values(lancer.equipment || {}).filter(Boolean).length;
  const setN = Object.values(lancer.equipment || {}).filter(Boolean)
    .map((u) => (st.items || []).find((x) => x && x.uid === u))
    .filter((x) => x && Gear.setIdOf(x) === 'constellation').length;
  console.log(`  창룡제 착용 칸: ${before} → ${after} (성좌 ${setN}칸)`);
  if (after >= before - 1) console.log('  판정: 뺏겨도 다시 채워진다 — 통과');
  else console.log(`  판정: **빈손으로 남는다** (${before} → ${after}) — 재배치가 안 돈다`);
}

head('5. 판정');
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
