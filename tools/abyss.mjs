/**
 * 황금 나락 난이도·수입 계측기
 * ────────────────────────────────────────────────────────────────
 * 요구 목표(플레이어 원문): "매주 등반을 한다면 용병 유지비 + 무한의탑을 돌 수 있을 정도의 골드"
 *
 * 주간 필요 골드 = 임금 7일 + 탑 비용/4주 (실측):
 *   정원 21 · Lv55 B · 4차 →  ~20,000G
 *   정원 70 · Lv80 A · 4차 →  107,571G
 *   정원 70 · Lv80 S · 4차 →  151,055G
 *
 * ★ 아군 편성을 **직접 조립하지 않는다.** `game/abyss.js` 가 실제로 쓰는 경로
 *   (합성 의뢰 → questBattleDefs)를 그대로 탄다. 자체 조립기가 세트 고유효과를
 *   빠뜨려 "풀세트를 반쪽 성능으로 재던" 사고가 있었다(9차 세션).
 *
 * 실행: node tools/abyss.mjs [--n=6]
 */
import * as State from '../src/game/state.js';
import * as Abyss from '../src/game/abyss.js';
import * as Pet from '../src/game/pet.js';
import * as Gear from '../src/game/gear.js';
import * as Sets from '../src/data/sets.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { RNG } from '../src/core/rng.js';
import { depthPower, depthEnemyCount, goldRange } from '../src/data/abyss.js';

// ★ 이걸 빼먹으면 스킬이 전부 사라져 승률이 통째로 틀린다 (6차 세션 사고)
setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const RUNS = parseInt(arg('n', '6'), 10);

/* ─────────────────────────── 부대 만들기 ─────────────────────────── */

const SQUAD4 = [
  'bulwark_abyss', 'swordgod_apex', 'dragoonlord_apex', 'shadowblade_apex',
  'masterarcher_apex', 'archmage_apex', 'highpriest_abyss',
];
// 중반 부대 — 3차 클래스, 아키타입이 겹치지 않게 고른다
const SQUAD3 = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];
const SQUAD2 = ['knight', 'berserker', 'dragoon', 'assassin', 'sniper', 'elementalist', 'priest'];

const FILL_ORDER = ['body', 'head', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'weapon', 'offhand'];

function setForArch(arch) {
  const hit = Sets.SET_LIST.find((s) => s.archs.includes(arch) && s.archs.length < Sets.ALL_ARCHS.length);
  return (hit || Sets.getSet('constellation')).id;
}

/**
 * 실제 게임 상태를 만든다.
 * @param {object} o `{classes, level, grade, gear:'none'|'shop'|'sets', pets:'none'|'low'|'mid'}`
 */
function setup(o = {}) {
  State.newGame(20260819, '나락계측단');
  const st = State.state;
  st.gold = 0;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  const rng = new RNG(4242);
  const level = o.level || 80;

  (o.classes || SQUAD4).forEach((classId, i) => {
    const cls = getClass(classId);
    if (!cls) throw new Error(`클래스 ${classId} 없음 — 도구를 갱신해라`);
    const merc = {
      uid: `ab_a${i}`, name: cls.name, classId, level, grade: o.grade || 'A',
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    };
    if (o.gear === 'sets') {
      const setId = setForArch(cls.arch);
      for (const slot of FILL_ORDER) {
        const it = Sets.setPieceItem(setId, slot, level, { uid: `ab_it_${i}_${slot}` });
        if (!it) continue;
        st.items.push(it);
        merc.equipment[slot] = it.uid;
      }
      Gear.setSpecialsFor(merc, State.itemsById(st.items));
    } else if (o.gear === 'shop') {
      // 상점·의뢰로 굴러 나오는 평범한 장비 (세트 아님)
      for (const slot of FILL_ORDER) {
        const it = Gear.rollItem({ ilvl: level, slot, rng });
        if (!it || !Gear.slotAccepts(slot, it)) continue;
        it.uid = `ab_it_${i}_${slot}`;
        st.items.push(it);
        merc.equipment[slot] = it.uid;
      }
    }
    st.roster.push(merc);
    sq.memberUids[i] = merc.uid;
  });

  for (const m of st.roster) m.hp = 0;   // 0 이면 mercStats.hp 로 채워진다

  sq.petUids = [null, null, null];
  const PET_SETS = {
    low: [['pet_shell', 'D'], ['pet_moss', 'D'], ['pet_lantern', 'C']],
    mid: [['pet_kite', 'C'], ['pet_saint', 'C'], ['pet_banner', 'B']],
  };
  for (const [sid, g] of (PET_SETS[o.pets] || [])) {
    const p = Pet.makePet(st, sid, g);
    if (!p) continue;
    st.pets.push(p);
    Pet.assignPet(st, sq.id, st.pets.length - 1, p.uid);
  }
  return st;
}

/* ─────────────────────────── 측정 ─────────────────────────── */

const CONFIGS = [
  { key: '초반 Lv30 2차 상점템', o: { classes: SQUAD2, level: 30, grade: 'D', gear: 'shop' } },
  { key: '중반 Lv55 3차 상점템', o: { classes: SQUAD3, level: 55, grade: 'C', gear: 'shop' } },
  { key: '중후 Lv70 3차 상점템', o: { classes: SQUAD3, level: 70, grade: 'B', gear: 'shop' } },
  { key: '후반 Lv80 4차 상점템', o: { classes: SQUAD4, level: 80, grade: 'A', gear: 'shop' } },
  { key: '후반 Lv80 4차 풀세트', o: { classes: SQUAD4, level: 80, grade: 'A', gear: 'sets' } },
  { key: '   〃  + 저급펫     ', o: { classes: SQUAD4, level: 80, grade: 'A', gear: 'sets', pets: 'low' } },
  { key: '   〃  + 중급펫     ', o: { classes: SQUAD4, level: 80, grade: 'A', gear: 'sets', pets: 'mid' } },
];

// 주간 필요 골드 (state 기반 실측값 — tools/.econ 참조)
const NEED = [
  ['정원21 Lv55 B', 20000],
  ['정원35 Lv80 A', 92318],
  ['정원70 Lv80 A', 107571],
  ['정원70 Lv80 S', 151055],
];

console.log(`황금 나락 — 잠수 ${RUNS}회 평균 (체력 이월 포함, 1심층부터)`);
console.log('='.repeat(78));
console.log('구성                        도달심층   최저~최고    주간 수입');
console.log('-'.repeat(78));

for (const cfg of CONFIGS) {
  const st = setup(cfg.o);
  const sq = st.squads[0];
  const reached = [];
  const golds = [];
  for (let i = 0; i < RUNS; i++) {
    st.day = 1 + i * 337;
    st.abyss = { best: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0 };
    st.gold = 0;
    const r = Abyss.dive(st, sq.id, { force: true });
    reached.push(r.reached);
    golds.push(r.gold);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(
    `${cfg.key.padEnd(24)} ${avg(reached).toFixed(1).padStart(8)}   ${String(Math.min(...reached)).padStart(3)}~${String(Math.max(...reached)).padEnd(4)}  ${Math.round(avg(golds)).toLocaleString().padStart(10)}G`,
  );
}

console.log('\n주간 필요 골드 (임금 7일 + 탑/4주)');
for (const [k, v] of NEED) console.log(`  ${k.padEnd(16)} ${v.toLocaleString().padStart(9)}G  → 필요 심층 ≈ ${neededDepth(v)}`);

function neededDepth(g) {
  for (let d = 1; d <= 300; d++) if (goldRange(d) >= g) return d;
  return '300+';
}

console.log('\n곡선 참고');
for (const d of [1, 10, 20, 30, 40, 50, 60, 70, 80, 100]) {
  console.log(`  ${String(d).padStart(3)}심층  배율 ${depthPower(d).toFixed(2)}  적 ${depthEnemyCount(d)}  누적 ${goldRange(d).toLocaleString().padStart(9)}G`);
}
