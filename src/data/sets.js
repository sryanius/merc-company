// 세트 아이템 (희귀도 5 = 신화) — 던전 하나당 한 세트, 4세트 x 10슬롯 = 40개.
// 순수 JS. DOM 참조 금지 (node 에서 import 가능해야 한다).
//
// ─────────────────────────────────────────────────────────────────────────────
// [계약 요약 — 다른 모듈이 알아야 할 것]
//
//  1) 이 파일은 **아이템을 스스로 완성해서 돌려준다.** `setPieceItem()` 이 내보내는 객체는
//     `gear.js rollItem()` 결과와 같은 형태이며 **이미 ilvl/희귀도/슬롯계수가 전부 반영**되어 있다.
//     gear.js 는 이걸 다시 스케일하지 마라 (`preScaled:true` 플래그로 표시해 둔다).
//
//  2) 슬롯별 스탯 총량은 `SLOT_COEF` 하나로 관리한다 (무기 1.00 기준, 합계 4.70).
//     세트 개별 성능은 같은 ilvl 전설의 `LEGEND_MULT`(=1.35) 배다.
//     밸런스를 조일 땐 **`SET_TUNE` 한 개만** 만지면 40개 아이템 + 세트 효과가 같이 움직인다.
//
//  3) 세트 효과(`bonuses`)는 3 / 5 / 7 / full 단계이고 **누적**이다.
//     `full` 기준은 고정 10 이 아니라 **그 용병이 낄 수 있는 최대 칸 수**다
//     (양손무기는 offhand 가 잠겨 9칸 = 풀세트). 그 판정은 `gear.js equippableSlotCount(merc)`
//     가 하고, 이 파일은 결과 숫자를 받아 쓰기만 한다 → `setBonusAt(setId, count, fullCount)`.
//
//  4) `stats` 는 절대값 가산, `mods` 는 비율 가산이다.
//     여러 단계의 `mods` 는 **키별로 더한 뒤** 최종 스탯에 한 번 곱한다 (`util.scaleStats` 와 동일).
//
//  5) 착용 제한은 클래스가 아니라 **아키타입**이다 (`set.archs`, 아이템에도 `archs` 로 실린다).
//     gear.js 의 장착 검사가 `item.archs` 를 보면 SETS 를 import 하지 않아도 된다.
//
//  6) ★ **고유 효과(special)의 유일한 정의처도 이 파일이다.**
//     단계 하나가 `special`(id) / `specialLabel`(한국어 이름) / `specialParams`(엔진이 소비할 수치)
//     / `desc`(UI 가 그대로 보여줄 한국어 설명) 를 갖는다. 셋은 항상 같이 다닌다.
//     `setBonusAt().specials` 가 이걸 그대로 실어 내보내고 `gear.js setSpecialsFor(merc)` 가
//     전투/UI 진입점이다. **gear.js 에 고유 효과를 다시 적지 마라** — 8차까지 두 벌이 따로
//     존재해 이름도 수치도 어긋나 있었다(gear 의 하드코딩은 9차에 제거했다).
//     엔진 구현은 §고유 효과 파라미터 어휘(아래 SPECIAL_TRIGGERS 주석) 를 그대로 따른다.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp } from '../core/util.js';
import { uid } from '../core/rng.js';

/* ─────────────────────────── 슬롯 / 희귀도 상수 ─────────────────────────── */

/** 장비 슬롯 10칸. **`gear.js SLOTS` 와 순서까지 같아야 한다.** */
export const SET_SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];

/** 슬롯 한국어 (UI 표기 통일용) */
export const SLOT_LABEL = {
  weapon: '오른손', offhand: '왼손', head: '머리', body: '상의', legs: '하의',
  hands: '장갑', feet: '신발', neck: '목걸이', ring1: '반지1', ring2: '반지2',
};

/**
 * ★ 밸런스 노브 — 슬롯별 스탯 계수. 무기를 1.00 으로 본 상대 총량이다.
 * 합계 4.10.
 *
 * ★ 이 값들은 **ilvl80 전설의 슬롯별 실측 파워 비율**이다 (표본 11,000~22,000개/슬롯).
 *   예전 값은 `items.js SLOT_POWER` 를 그대로 베낀 것이라 실제 전설이 받는 예산과 어긋났고,
 *   그 결과 최종 보상인 신화(세트)가 같은 ilvl 전설보다 **약했다** —
 *   실측 10슬롯 합계 신화 2,916 vs 전설 2,962 (x0.98), 상의는 327 vs 609 로 x0.54였다.
 *   sets.js 가 스스로 선언한 LEGEND_MULT 1.35 와 정반대였던 셈이다.
 *   반지는 일반 전리품에 존재하지 않아(실측 표본 0) 목걸이 근처 값으로 뒀다.
 *
 * 랭크 승률이 흔들리면 **여기와 `SET_TUNE` 부터** 만져라.
 */
export const SLOT_COEF = {
  weapon: 1.00, offhand: 0.39,
  head: 0.39, body: 0.74, legs: 0.43, hands: 0.24, feet: 0.19,
  neck: 0.22, ring1: 0.25, ring2: 0.25,
};

/** 희귀도 5 = 신화 */
export const MYTHIC_RARITY = 5;
export const MYTHIC_NAME = '신화';
/** 전설(#e8a13a)보다 붉은 금빛. UI 는 이 색 + MYTHIC_GLOW 로 그라디언트를 만들면 된다. */
export const MYTHIC_COLOR = '#ff5f3a';
export const MYTHIC_COLOR_DEEP = '#b8281c';
export const MYTHIC_GLOW = '#ffd27a';
/**
 * `items.js RARITY_MULT` 를 5단계로 늘릴 때 쓸 값. 전설 2.0 x 1.35 = 2.7.
 * (= 신화가 "같은 ilvl 전설의 1.35배"라는 설계를 희귀도 배율로 표현한 것)
 */
export const MYTHIC_RARITY_MULT = 2.7;

/* ─────────────────────────── 스탯 예산 상수 ─────────────────────────── */

/** 세트 수치의 기준 ilvl. 던전 드랍은 전부 이 레벨이다. */
export const SET_REF_ILVL = 80;
/** 같은 ilvl 전설 대비 배율 */
export const LEGEND_MULT = 1.35;
/**
 * ilvl 80 전설 **무기 한 자루**의 파워 기준값(atk 환산).
 * ★ 700 은 손계산값이었고 실제 전설과 안 맞았다. 실측(ilvl80 전설 무기 22,101개 평균 파워 824,
 *   10슬롯 합계 2,962)에 맞춰 1100 으로 올렸다 — 신화 합계가 전설의 1.35배(약 4,000)가 되게 하는 값이다.
 */
export const SET_REF_POWER = 1100;
/** ★ 전역 세기 노브. 랭크/던전 승률이 목표를 벗어나면 이 값 하나로 40개를 같이 움직인다. */
export const SET_TUNE = 1.00;

/**
 * ★ 스탯 "가격" — 예산 1 파워를 그 스탯 몇 포인트로 바꿔 주는지의 역수.
 * `gear.js itemPower` 의 표기용 가중치와 **일부러 다르다**:
 *  - def/res 는 `mit = 100/(100+def)` 로 수확체감이 있어 표기 가중치(0.85/0.75)대로 사면
 *    ilvl80 에서 방어가 1,400 을 넘어 물리 피해가 통째로 무의미해진다 → 2.2 / 2.0 으로 비싸게 매겼다.
 *  - spd 는 레벨 스케일을 그대로 타서 총량이 쉽게 폭주한다 → 1.6.
 *  - hp 는 수치 자체가 커서 0.15.
 * 값을 **올리면** 그 스탯을 덜 사게 되어 총량이 줄어든다.
 */
export const STAT_POWER = { hp: 0.15, atk: 1.0, def: 2.2, res: 2.0, spd: 1.6 };

/** 예산으로 배분하는 스탯(레벨 스케일) / 고정값으로 주는 스탯(평탄) */
const BUDGET_KEYS = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT_KEYS = ['crit', 'critDmg', 'eva'];

// ilvl 스케일 계수 (items.js 와 동일한 곡선)
const LV_SCALE = 0.13;
const FLAT_SCALE = 0.012;
const lvRatio = (ilvl) => (1 + LV_SCALE * (ilvl - 1)) / (1 + LV_SCALE * (SET_REF_ILVL - 1));
const flatRatio = (ilvl) => (1 + FLAT_SCALE * (ilvl - 1)) / (1 + FLAT_SCALE * (SET_REF_ILVL - 1));

/** 세트 효과가 붙는 착용 개수 단계 (full 은 용병별 최대 칸 수라 별도) */
export const BONUS_STEPS = [3, 5, 7];

export const ALL_ARCHS = ['tank', 'fighter', 'lancer', 'archer', 'rogue', 'mage', 'healer'];

/* ───────────────────── 고유 효과 파라미터 어휘 (엔진 계약) ─────────────────────
 *
 * `specialParams` 는 **엔진이 그대로 읽어 쓸 수 있을 만큼 완결적**이어야 한다.
 * 배틀 엔진은 결정론적이다(같은 시드 = 같은 결과) — 고유 효과도 이 성질을 깨면 안 되므로
 * 아래 규칙을 지킨다:
 *   · 확률 롤을 새로 굴리지 않는다 (굴려야 한다면 반드시 `chance` 를 파라미터로 노출한다).
 *   · 대상 선택은 항상 **결정적 규칙 + idx 오름차순 tie-break** 다 (`*Select` 참조).
 *   · 한 번만 발동하는 것은 `*Once:true` 로 못 박는다.
 *
 * 공통 키
 *   trigger      언제 발동하는가
 *                'battleStart' 전투 시작 시 1회 | 'onKill' 그 유닛이 적을 처치한 순간
 *                'hit' 그 유닛이 피해를 입힌 직후 | 'fatal' 전투 불능이 될 피해를 받기 직전
 *                'shieldBreak' 자기 방어막이 **피해로** 0 이 된 순간(시간 만료는 제외)
 *   buffId       엔진 `addBuff` 의 `src` 키. 같은 키는 중첩되지 않고 갱신된다
 *   *Target      'self' | 'allAlly' | 'allEnemy'
 *   *Once        전투당 1회만 발동하는가
 *   *Select      추가 대상 선택 규칙. 'nearest' = 원 대상에서 가장 가까운 다른 적,
 *                거리가 같으면 `idx` 가 작은 쪽 (결정론 보장)
 *
 * 비율 표기
 *   ...Mod   엔진 `addBuff(amount)` 와 같은 **비율**(0.15 = +15%)
 *   ...Ratio / ...Hp / ...Heal   **최대 체력 대비 비율**
 *   ...Gauge 행동 게이지 비율 (엔진 GAUGE_MAX = 100 기준. 0.40 = 게이지 40 즉시 충전)
 *   ...Dur   초(second)
 *
 * 단계별 고유 효과: `special` 은 **그 단계 객체 안에** 둔다 (3/5/7 에 둬도 `setBonusAt` 이
 * 그대로 실어 보낸다). 현재 4종은 전부 `full` 에만 있다 — 스모크가
 * "고유 효과는 풀세트에만" 을 검사하므로 저단계에 추가하려면 그 검사부터 같이 고쳐야 한다.
 */
export const SPECIAL_TRIGGERS = ['battleStart', 'onKill', 'hit', 'fatal', 'shieldBreak'];

/* ─────────────────────────── 세트 정의 (원본) ─────────────────────────── */
//
// profile 키 조회 순서: profile[slot] -> profile[그룹]
//   그룹: weapon / offhand / armor(head·body·legs·hands·feet) / acc(neck·ring1·ring2)
// mix 는 예산 배분 비율(합이 1 이 아니어도 코드가 정규화한다).
// flat 은 "슬롯계수 1.0 기준" 평탄 스탯 — 실제 값 = flat x SLOT_COEF x LEGEND_MULT.

const ACC_SLOTS = ['neck', 'ring1', 'ring2'];
const ARMOR_SLOTS = ['head', 'body', 'legs', 'hands', 'feet'];

function groupOf(slot) {
  if (slot === 'weapon' || slot === 'offhand') return slot;
  return ACC_SLOTS.includes(slot) ? 'acc' : 'armor';
}

const RAW_SETS = {
  // ── 던전1 「강철 성벽」 — tank / lancer. 전열이 무너지지 않게 만드는 세트.
  ironrampart: {
    id: 'ironrampart', name: '강철 성벽', order: 1,
    archs: ['tank', 'lancer'],
    color: '#8fa6c0', colorDeep: '#4d5f78',
    palette: { metal: 'steel', cloth: 'azure', leather: 'dark', accent: 'silver', glow: 'frost' },
    desc: '무너진 국경 요새의 수비대가 마지막까지 벗지 않았던 한 벌. 걸친 자는 자신이 성벽이 된다.',
    profile: {
      weapon: { mix: { atk: 0.52, hp: 0.30, def: 0.18 } },
      offhand: { mix: { hp: 0.44, def: 0.38, res: 0.18 } },
      armor: { mix: { hp: 0.46, def: 0.34, res: 0.20 }, flat: { eva: 1 } },
      hands: { mix: { hp: 0.34, def: 0.36, atk: 0.30 } },
      feet: { mix: { hp: 0.42, def: 0.24, res: 0.14, spd: 0.20 }, flat: { eva: 2 } },
      acc: { mix: { hp: 0.40, res: 0.28, def: 0.16, atk: 0.16 }, flat: { crit: 2 } },
    },
    bonuses: {
      3: { stats: { hp: 700, def: 30, res: 15 }, desc: '성벽의 기초 — 체력·방어가 오른다.' },
      5: {
        stats: { hp: 1100, def: 48, res: 28 }, mods: { hp: 0.06, def: 0.16, res: 0.16 },
        desc: '겹쳐 쌓은 벽 — 방어와 저항이 비율로 오른다.',
      },
      7: {
        stats: { hp: 600, def: 32, res: 17 }, mods: { hp: 0.04, def: 0.09, res: 0.09 },
        desc: '흔들리지 않는 성채 — 받는 피해가 눈에 띄게 줄어든다.',
      },
      full: {
        stats: { hp: 1100, def: 60, res: 30, atk: 200 }, mods: { hp: 0.12, def: 0.20, res: 0.20 },
        special: 'rampart_aegis',
        specialLabel: '불락(不落)의 가호',
        specialParams: {
          trigger: 'battleStart',       // 전투 시작 시
          shieldRatio: 0.25,            // 방어막 = 자기 최대 체력 x 0.25
          shieldDur: 12,                // 방어막 지속(초)
          shieldOnce: true,             // 전투당 1회. 다시 깔리지 않는다
          breakTrigger: 'shieldBreak',  // 그 방어막이 **피해로** 0 이 된 순간 (시간 만료는 발동 안 함)
          breakOnce: true,              // 깨짐 발동도 전투당 1회
          allyTarget: 'allAlly',        // 살아 있는 아군 전체 (자신 포함)
          allyStat: 'def',              // 올릴 스탯
          allyDefMod: 0.15,             // +15% (엔진 addBuff amount 와 같은 비율)
          allyDur: 8,                   // 그 버프 지속(초)
          buffId: 'set_rampart_aegis',  // 같은 키는 중첩되지 않고 갱신만 된다
        },
        desc: '전투를 시작할 때 최대 체력의 25%인 방어막을 12초간 두른다(전투당 1회). 그 방어막이 피해로 깨지면 8초간 아군 전체의 방어가 15% 오른다.',
      },
    },
  },

  // ── 던전2 「피의 서약」 — fighter / rogue. 죽일수록 빨라지는 폭발형 세트.
  bloodoath: {
    id: 'bloodoath', name: '피의 서약', order: 2,
    archs: ['fighter', 'rogue'],
    color: '#c94a4a', colorDeep: '#6e1f22',
    palette: { metal: 'blood', cloth: 'crimson', leather: 'dark', accent: 'blood', glow: 'blood' },
    desc: '피로 서명하고 피로만 지울 수 있는 계약. 착용자는 벨수록 목마르다.',
    profile: {
      weapon: { mix: { atk: 0.72, hp: 0.16, spd: 0.12 }, flat: { crit: 7, critDmg: 26 } },
      offhand: { mix: { atk: 0.60, hp: 0.22, spd: 0.18 }, flat: { crit: 6, critDmg: 22 } },
      armor: { mix: { atk: 0.42, hp: 0.40, def: 0.10, spd: 0.08 }, flat: { crit: 4, critDmg: 16 } },
      hands: { mix: { atk: 0.56, hp: 0.26, spd: 0.18 }, flat: { crit: 5, critDmg: 20 } },
      feet: { mix: { atk: 0.34, hp: 0.30, spd: 0.36 }, flat: { crit: 4, eva: 3 } },
      acc: { mix: { atk: 0.60, hp: 0.24, spd: 0.16 }, flat: { crit: 6, critDmg: 22 } },
    },
    bonuses: {
      3: { stats: { atk: 70, crit: 3, critDmg: 8 }, desc: '서약의 첫 줄 — 공격력과 치명타가 오른다.' },
      5: {
        stats: { atk: 115, crit: 6, critDmg: 15 }, mods: { atk: 0.12, critDmg: 0.09 },
        desc: '피의 대가 — 공격력이 비율로 오른다.',
      },
      7: {
        stats: { atk: 70, crit: 3, critDmg: 9 }, mods: { atk: 0.06, critDmg: 0.06 },
        desc: '광란의 계약 — 치명타 피해가 폭발적으로 커진다.',
      },
      full: {
        stats: { atk: 130, crit: 6, critDmg: 18 }, mods: { atk: 0.12, crit: 0.15, critDmg: 0.20 },
        special: 'bloodoath_frenzy',
        specialLabel: '피의 갈증',
        specialParams: {
          trigger: 'onKill',              // 그 용병이 적을 처치한 순간
          cdReduce: 2.5,                  // 자기 보유 스킬 전부의 남은 재사용 대기 -2.5초
          buffTarget: 'self',
          buffStat: 'atk',
          atkMod: 0.12,                   // 중첩 하나당 공격력 +12% (2중첩 = +24%)
          stacks: 3,                      // 최대 중첩
          stackDur: 5,                    // 지속(초). 새로 쌓으면 전체 지속이 갱신된다
          buffId: 'set_bloodoath_frenzy',
          lifesteal: 0.12,                // 상시 — 직접 가한 피해의 12%를 자신이 회복
          lifestealDot: false,            // 지속 피해(dot)는 흡혈 대상이 아니다
        },
        desc: '적을 처치하면 보유 스킬의 남은 재사용 대기가 2.5초 줄고, 5초간 공격력이 12% 오른다(최대 3중첩). 직접 가한 피해의 12%를 체력으로 회복한다.',
      },
    },
  },

  // ── 던전3 「별의 사수」 — archer / mage. 사거리와 연사를 밀어 올리는 세트.
  starseeker: {
    id: 'starseeker', name: '별의 사수', order: 3,
    archs: ['archer', 'mage'],
    color: '#8c7fe0', colorDeep: '#3b2f6e',
    palette: { metal: 'silver', cloth: 'night', leather: 'dark', accent: 'silver', glow: 'arcane' },
    desc: '천문대의 마지막 관측자가 별을 겨누기 위해 맞춘 한 벌. 밤이 짙을수록 잘 보인다.',
    profile: {
      weapon: { mix: { atk: 0.72, spd: 0.10, res: 0.10, hp: 0.08 }, flat: { crit: 6, critDmg: 18 } },
      offhand: { mix: { atk: 0.58, spd: 0.14, res: 0.14, hp: 0.14 }, flat: { crit: 5, critDmg: 14 } },
      armor: { mix: { atk: 0.40, hp: 0.34, res: 0.16, spd: 0.10 }, flat: { crit: 4, eva: 2 } },
      hands: { mix: { atk: 0.54, hp: 0.24, spd: 0.14, res: 0.08 }, flat: { crit: 5, critDmg: 12 } },
      feet: { mix: { atk: 0.30, hp: 0.28, spd: 0.26, res: 0.16 }, flat: { eva: 4, crit: 3 } },
      acc: { mix: { atk: 0.56, spd: 0.14, res: 0.16, hp: 0.14 }, flat: { crit: 5, critDmg: 14 } },
    },
    bonuses: {
      3: { stats: { atk: 70, spd: 30, crit: 3 }, desc: '조준선 — 공격력과 행동 속도가 오른다.' },
      5: {
        stats: { atk: 115, spd: 50, crit: 4 }, mods: { atk: 0.12, spd: 0.10, crit: 0.06 },
        desc: '별자리 정렬 — 공격력과 속도가 비율로 오른다.',
      },
      7: {
        stats: { atk: 70, spd: 30, crit: 3 }, mods: { atk: 0.07, spd: 0.06, crit: 0.04 },
        desc: '천구 관측 — 사격과 시전이 눈에 띄게 빨라진다.',
      },
      full: {
        stats: { atk: 130, spd: 55, crit: 5, critDmg: 20 }, mods: { atk: 0.14, spd: 0.12, crit: 0.15 },
        special: 'starseeker_starfall',
        specialLabel: '유성 낙하',
        specialParams: {
          trigger: 'hit',            // 그 용병이 피해를 입힌 직후
          rangeFilter: 'ranged',     // 원거리 공격(skill.range==='ranged')에만. 근접은 발동 안 함
          splashCount: 1,            // 추가로 때리는 **다른** 적 수
          splashPower: 0.45,         // 그 타격이 실제로 넣은 **피해량의 45%**
          splashOf: 'damage',        // 'damage' = 피해량 기준 (atk 로 다시 계산하지 않는다)
          splashRoll: false,         // ★ 치명타·회피를 다시 굴리지 않는다 (결정론 유지)
          splashSelect: 'nearest',   // 원 대상 제외, 원 대상에서 가장 가까운 적. 동률이면 idx 오름차순
          splashChain: false,        // 추가 타격은 유성 낙하를 다시 부르지 않는다 (무한 연쇄 방지)
          killTrigger: 'onKill',
          killGauge: 0.40,           // 처치 시 자기 행동 게이지 +40 (GAUGE_MAX=100 기준)
        },
        desc: '원거리 공격이 명중하면 그 피해의 45%로 다른 적 1기를 함께 때린다. 적을 처치하면 행동 게이지가 즉시 40% 찬다.',
      },
    },
  },

  // ── 던전4 「성좌의 은총」 — 전 아키타입. 어느 부대에 넣어도 손해가 없는 범용 생존/유틸 세트.
  constellation: {
    id: 'constellation', name: '성좌의 은총', order: 4,
    archs: ALL_ARCHS.slice(),
    /* ★★ `prefer` — «누구 손에 쥐어지길 바라는가» (자동 착용 배분에만 쓴다. 스탯과 무관).
     *
     *   이 세트의 풀 효과 `constellation_grace` 는 **쓰러질 때 되살아나고 아군 전체를 회복**시킨다 —
     *   생존 축이라 사제가 들고 있어야 값어치가 산다. 그런데 `profile` 은 atk 비중이 높아서
     *   healer 가중치(atk 0.85)로는 점수가 낮게 나오고, 배분이 전투력 순이라
     *   사제는 맨 뒤에 골라 **한 조각도 못 받았다** (실측: tools/setalloc.mjs — 탱커 7 · 전사 3 · 사제 0).
     *
     *   `archs` 는 «낄 수 있는가» 이고 이건 «누가 먼저 가져가나» 다 — 둘은 다른 축이다. */
    prefer: ['healer'],
    color: '#e8c85a', colorDeep: '#8a6a1c',
    palette: { metal: 'gold', cloth: 'ivory', leather: 'tan', accent: 'gold', glow: 'holy' },
    desc: '열두 별자리가 각각 한 조각씩 맡아 벼렸다는 한 벌. 직업을 가리지 않고 착용자를 지킨다.',
    profile: {
      weapon: { mix: { atk: 0.50, hp: 0.24, def: 0.10, res: 0.10, spd: 0.06 }, flat: { crit: 4, critDmg: 12 } },
      offhand: { mix: { atk: 0.34, hp: 0.30, def: 0.16, res: 0.14, spd: 0.06 }, flat: { crit: 3, eva: 2 } },
      armor: { mix: { hp: 0.38, atk: 0.26, def: 0.16, res: 0.14, spd: 0.06 }, flat: { crit: 3, eva: 2 } },
      hands: { mix: { hp: 0.30, atk: 0.38, def: 0.12, res: 0.12, spd: 0.08 }, flat: { crit: 4, critDmg: 10 } },
      feet: { mix: { hp: 0.32, atk: 0.22, def: 0.12, res: 0.12, spd: 0.22 }, flat: { eva: 3, crit: 2 } },
      acc: { mix: { hp: 0.30, atk: 0.34, def: 0.14, res: 0.14, spd: 0.08 }, flat: { crit: 4, critDmg: 10, eva: 2 } },
    },
    bonuses: {
      3: { stats: { hp: 550, atk: 45, def: 20, res: 20 }, desc: '별의 인도 — 모든 능력이 고르게 오른다.' },
      5: {
        stats: { hp: 820, atk: 70, def: 31, res: 31, spd: 18 }, mods: { hp: 0.09, atk: 0.09, def: 0.05, res: 0.05 },
        desc: '은총의 시작 — 체력과 공격력이 비율로 오른다.',
      },
      7: {
        stats: { hp: 480, atk: 40, def: 19, res: 19, spd: 12 }, mods: { hp: 0.05, atk: 0.05, def: 0.03, res: 0.03 },
        desc: '열두 별의 가호 — 공격·방어·저항이 함께 오른다.',
      },
      full: {
        stats: { hp: 900, atk: 75, def: 35, res: 35, spd: 40 },
        mods: { hp: 0.10, atk: 0.10, def: 0.10, res: 0.10, spd: 0.08 },
        special: 'constellation_grace',
        specialLabel: '성좌의 은총',
        specialParams: {
          trigger: 'fatal',        // 전투 불능이 될 피해를 **적용하기 직전**에 가로챈다
          reviveHp: 0.35,          // 자기 최대 체력의 35% 로 다시 선다
          reviveOnce: true,        // 전투당 1회
          reviveClear: true,       // 되살아날 때 자신의 지속 피해(dot)·디버프를 지운다
          allyTarget: 'allAlly',   // 살아 있는 아군 전체 (자신 포함)
          allyHeal: 0.12,          // 각자 **자기** 최대 체력의 12% 회복
          allyHealOf: 'maxHp',
        },
        desc: '전투 불능이 될 피해를 받으면 전투당 1회에 한해 최대 체력의 35%로 다시 일어나고, 그때 아군 전체가 각자 최대 체력의 12%를 회복한다.',
      },
    },
  },
};

/* ─────────────────────────── 파츠 이름 / 설명 ─────────────────────────── */

// [이름, 설명]
const PIECE_TEXT = {
  ironrampart: {
    weapon: ['성벽지기의 철추', '성문을 부수던 공성추를 사람이 들 수 있게 줄였다.'],
    offhand: ['불락의 성문', '단 한 번도 안쪽을 보여 준 적이 없는 문짝.'],
    head: ['성루의 투구', '망루에 서서 사흘 밤을 버틴 자의 투구.'],
    body: ['강철 성벽의 흉갑', '두드리면 성벽과 똑같은 소리가 난다.'],
    legs: ['주춧돌 경갑', '발을 딛는 자리가 곧 방어선이 된다.'],
    hands: ['쇠빗장 건틀릿', '한번 쥔 것은 놓지 않도록 빗장이 걸려 있다.'],
    feet: ['요새의 발판', '밀려나지 않기 위해 밑창에 쇠못을 박았다.'],
    neck: ['수호 서약의 목걸이', '수비대 전원이 같은 문구를 새겨 걸었다.'],
    ring1: ['초석의 반지', '무너진 성의 주춧돌을 깎아 만들었다.'],
    ring2: ['망루의 반지', '멀리 보는 자에게 주어지던 인장.'],
  },
  bloodoath: {
    weapon: ['피의 서약검', '날에 이름을 새기면 그자의 피를 본다고 한다.'],
    offhand: ['배신자의 단검', '서약을 어긴 자의 손에서 되찾아 왔다.'],
    head: ['핏빛 서약 투구', '안쪽이 마르지 않는다.'],
    body: ['맹세의 혈갑', '심장 위치에 손도장이 찍혀 있다.'],
    legs: ['학살자의 다리보호구', '뒤로 물러선 흔적이 없다.'],
    hands: ['피에 젖은 손아귀', '쥘수록 손아귀에 힘이 붙는다.'],
    feet: ['살육의 발걸음', '발소리가 뒤에서 한 박자 늦게 들린다.'],
    neck: ['심장의 서약', '착용자의 맥박에 맞춰 붉게 뛴다.'],
    ring1: ['피맹세의 반지', '뺄 때마다 손가락이 아리다.'],
    ring2: ['적혈의 반지', '보석 안에서 아직 피가 돈다.'],
  },
  starseeker: {
    weapon: ['별을 꿰는 활', '겨눈 곳의 별이 먼저 흔들린다.'],
    offhand: ['별무리 화살통', '꺼낼 때마다 빛나는 것이 하나씩 딸려 나온다.'],
    head: ['천문관의 관', '쓰고 있으면 밤하늘의 눈금이 보인다.'],
    body: ['성층의 외투', '옷자락이 늘 위쪽으로 떠오른다.'],
    legs: ['유성의 각반', '달릴 때 흰 선이 남는다.'],
    hands: ['별을 세는 손', '손끝이 저절로 궤도를 그린다.'],
    feet: ['은하를 걷는 신발', '디딘 자리에 잔별이 흩어진다.'],
    neck: ['북극성의 목걸이', '어느 방향에서도 길을 잃지 않는다.'],
    ring1: ['유성우의 반지', '밤이 되면 스스로 빛을 뿌린다.'],
    ring2: ['천구의 반지', '작은 별자리가 안쪽을 돌고 있다.'],
  },
  constellation: {
    weapon: ['은총의 무구', '누가 들어도 제 손에 맞게 무게가 바뀐다.'],
    offhand: ['가호의 성표', '들고 있으면 등 뒤가 든든하다.'],
    head: ['별관(星冠)', '열두 개의 작은 빛이 테두리를 돈다.'],
    body: ['성좌가 수놓인 성의', '별자리 실밥이 상처를 대신 받는다.'],
    legs: ['천상의 각반', '먼 길을 걸어도 무릎이 상하지 않는다.'],
    hands: ['축복받은 손길', '쥔 것을 부수기보다 지키게 만든다.'],
    feet: ['순례자의 신발', '열두 성소를 전부 돌고도 닳지 않았다.'],
    neck: ['열두 별의 목걸이', '별 하나가 꺼질 때마다 하나가 켜진다.'],
    ring1: ['은총의 반지', '주인이 쓰러지려 할 때 뜨거워진다.'],
    ring2: ['성좌의 반지', '밤하늘 전체를 한 바퀴 담았다.'],
  },
};

/**
 * 무기 타입별 이름 변형. `setPieceItem(setId, slot, ilvl, {weaponType})` 로 타입을 지정하면
 * 이름이 바뀐다. 지정하지 않으면 `weaponType:null` (= 모든 클래스가 착용 가능) 로 나간다.
 */
const WEAPON_VARIANT = {
  ironrampart: {
    weapon: { sword: '성벽지기의 장검', mace: '성벽지기의 철추', axe: '성벽지기의 전부', spear: '성벽지기의 장창' },
    offhand: { shield: '불락의 성문', sword: '성벽지기의 부검' },
  },
  bloodoath: {
    weapon: { sword: '피의 서약검', greatsword: '피의 서약대검', katana: '피의 서약도', axe: '피의 서약부', dagger: '피의 서약단검', claw: '피의 서약발톱' },
    offhand: { dagger: '배신자의 단검', shield: '배신자의 방패' },
  },
  starseeker: {
    weapon: { bow: '별을 꿰는 활', crossbow: '별을 꿰는 석궁', staff: '별을 꿰는 지팡이', wand: '별을 꿰는 완드', tome: '별을 꿰는 성도서' },
    offhand: { tome: '별무리 성도서', shield: '별무리 보주' },
  },
  constellation: {
    weapon: { sword: '은총의 성검', greatsword: '은총의 성대검', spear: '은총의 성창', mace: '은총의 성추', bow: '은총의 성궁', staff: '은총의 성장', wand: '은총의 성완드', tome: '은총의 성전' },
    offhand: { shield: '가호의 성표', tome: '가호의 성전' },
  },
};

/* ─────────────────────────── 스탯 산출 ─────────────────────────── */

function profileFor(set, slot) {
  return set.profile[slot] || set.profile[groupOf(slot)] || { mix: { atk: 1 } };
}

/** 그 슬롯의 파워 예산 (ilvl 80 기준) */
export function slotBudget(slot) {
  const coef = SLOT_COEF[slot] || 0;
  return SET_REF_POWER * LEGEND_MULT * SET_TUNE * coef;
}

/** ref ilvl(80) 기준 파츠 스탯 */
function refPieceStats(set, slot) {
  const prof = profileFor(set, slot);
  const mix = prof.mix || {};
  const coef = SLOT_COEF[slot] || 0;
  const budget = slotBudget(slot);

  // mix 합이 1 이 아니어도 되도록 정규화한다 (튜닝할 때 실수를 흡수)
  let total = 0;
  for (const k of BUDGET_KEYS) total += Math.max(0, mix[k] || 0);
  const out = {};
  if (total > 0) {
    for (const k of BUDGET_KEYS) {
      const w = Math.max(0, mix[k] || 0);
      if (!w) continue;
      const v = (budget * (w / total)) / STAT_POWER[k];
      out[k] = k === 'hp' ? Math.round(v / 5) * 5 : Math.round(v);
    }
  }
  const flat = prof.flat || {};
  for (const k of FLAT_KEYS) {
    const v = (flat[k] || 0) * coef * LEGEND_MULT * SET_TUNE;
    if (v) out[k] = Math.round(v * 10) / 10;
  }
  return out;
}

/** ref 스탯을 임의 ilvl 로 옮긴다 (레벨 스케일 / 평탄 스케일 분리) */
function scaleToIlvl(stats, ilvl) {
  const lv = lvRatio(ilvl);
  const fl = flatRatio(ilvl);
  const out = {};
  for (const k of Object.keys(stats)) {
    const v = stats[k];
    if (!v) continue;
    if (FLAT_KEYS.includes(k)) out[k] = Math.round(v * fl * 10) / 10;
    else {
      const s = v * lv;
      out[k] = s < 0 ? -Math.max(1, Math.round(-s)) : Math.max(1, k === 'hp' ? Math.round(s / 5) * 5 : Math.round(s));
    }
  }
  return out;
}

/* ─────────────────────────── SETS 조립 ─────────────────────────── */

/** `set_<setId>_<slot>` — 세트 파츠의 baseId 규약 */
export function setBaseId(setId, slot) { return `set_${setId}_${slot}`; }

/** baseId 를 되돌려 `{setId, slot}` 로 (세트 파츠가 아니면 null) */
export function parseSetBaseId(baseId) {
  const m = /^set_([a-z0-9]+)_([a-z0-9]+)$/.exec(String(baseId || ''));
  if (!m || !RAW_SETS[m[1]] || !SET_SLOTS.includes(m[2])) return null;
  return { setId: m[1], slot: m[2] };
}

/**
 * 세트 정의 4종. 각 세트는 10슬롯 `pieces` 를 전부 갖는다 (4 x 10 = 40).
 * `pieces[slot] = { setId, slot, baseId, name, desc, stats, weaponTypes }`
 * `stats` 는 **ref ilvl(80) 기준 절대값**이다. 다른 ilvl 은 `setPieceStats()` 를 써라.
 */
export const SETS = (() => {
  const out = {};
  for (const id of Object.keys(RAW_SETS)) {
    const raw = RAW_SETS[id];
    const pieces = {};
    for (const slot of SET_SLOTS) {
      const [name, desc] = (PIECE_TEXT[id] && PIECE_TEXT[id][slot]) || [`${raw.name} 장비`, ''];
      const variants = (WEAPON_VARIANT[id] && WEAPON_VARIANT[id][slot]) || null;
      pieces[slot] = {
        setId: id, slot, baseId: setBaseId(id, slot),
        name, desc,
        stats: refPieceStats(raw, slot),
        variants,
        weaponTypes: variants ? Object.keys(variants) : null,
      };
    }
    out[id] = { ...raw, pieces };
  }
  return out;
})();

export const SET_IDS = Object.keys(SETS);
export const SET_LIST = SET_IDS.map((id) => SETS[id]);
/** 던전 주차(1~4) -> 세트 id */
export const SET_ORDER = SET_LIST.slice().sort((a, b) => a.order - b.order).map((s) => s.id);

/* ─────────────────────────── 조회 API ─────────────────────────── */

/** 세트 정의 (없으면 null) */
export function getSet(id) {
  if (!id) return null;
  if (typeof id === 'object') return SETS[id.setId || id.id] || null;
  return SETS[id] || null;
}

/** 그 아키타입이 착용할 수 있는 세트 목록 (order 순) */
export function setsForArch(arch) {
  if (!arch) return [];
  return SET_LIST.filter((s) => s.archs.includes(arch)).sort((a, b) => a.order - b.order);
}

/** 아키타입 착용 가능 여부 */
export function canWearSet(setId, arch) {
  const s = getSet(setId);
  return !!(s && arch && s.archs.includes(arch));
}

/** 던전 주차(1~4)에 대응하는 세트 정의 */
export function setForWeek(week) {
  const w = clamp(Math.round(week || 1), 1, SET_ORDER.length);
  return SETS[SET_ORDER[w - 1]] || null;
}

/** 파츠 정의 (없으면 null) */
export function setPieceDef(setId, slot) {
  const s = getSet(setId);
  return (s && s.pieces[slot]) || null;
}

/** 파츠 스탯을 ilvl 에 맞춰 돌려준다 (ref 는 80) */
export function setPieceStats(setId, slot, ilvl = SET_REF_ILVL) {
  const p = setPieceDef(setId, slot);
  if (!p) return {};
  const lv = clamp(Math.round(ilvl || SET_REF_ILVL), 1, 200);
  return lv === SET_REF_ILVL ? { ...p.stats } : scaleToIlvl(p.stats, lv);
}

/**
 * 웨이브에서 드랍될 수 있는 슬롯 후보 (설계 C).
 *  1~5웨이브 방어구 5칸 / 6~8 장신구 3칸 / 9~10 무기·왼손
 * 추첨(rng)은 던전 쪽에서 한다 — 여기는 순수 데이터만 준다.
 */
export function dropSlotsForWave(wave = 1) {
  const w = Math.max(1, Math.round(wave || 1));
  if (w <= 5) return ARMOR_SLOTS.slice();
  if (w <= 8) return ACC_SLOTS.slice();
  return ['weapon', 'offhand'];
}

/* ─────────────────────────── 실물 아이템 ─────────────────────────── */

/** 신화 파츠의 기준가 (골드) */
function pieceValue(slot, ilvl) {
  const coef = SLOT_COEF[slot] || 0.3;
  const v = 26 * (1 + 0.34 * (ilvl - 1)) * Math.pow(MYTHIC_RARITY_MULT, 2.1) * (0.45 + 0.55 * coef);
  return Math.max(10, Math.round(v / 10) * 10);
}

/**
 * 세트 파츠를 **실물 아이템 객체**로 만든다 (`gear.js rollItem()` 과 같은 형태).
 * 반환값은 이미 ilvl·희귀도·슬롯계수가 전부 반영된 최종 수치다 — 다시 스케일하지 마라.
 *
 * @param {string} setId
 * @param {string} slot   SET_SLOTS 중 하나
 * @param {number} [ilvl] 기본 80
 * @param {{weaponType?:string|null, uid?:string, minLv?:number}} [opts]
 *   weaponType 을 주면 이름이 그 무기 타입 변형으로 바뀌고 아이템에 타입이 박힌다.
 *   주지 않으면 `weaponType:null` = 무기 타입 제한 없이 누구나 착용 가능(아키타입 제한은 남는다).
 * @returns {object|null}
 */
export function setPieceItem(setId, slot, ilvl = SET_REF_ILVL, opts = {}) {
  const set = getSet(setId);
  const def = setPieceDef(setId, slot);
  if (!set || !def) return null;

  const lv = clamp(Math.round(ilvl || SET_REF_ILVL), 1, 200);
  const stats = setPieceStats(setId, slot, lv);
  const wt = (slot === 'weapon' || slot === 'offhand') && opts.weaponType ? opts.weaponType : null;
  const name = (wt && def.variants && def.variants[wt]) || def.name;
  const minLv = opts.minLv != null ? clamp(Math.round(opts.minLv), 1, 200) : clamp(lv - 5, 1, 200);

  return {
    uid: opts.uid || uid('it'),
    baseId: def.baseId,
    name,
    slot,
    weaponType: wt,
    armorType: ARMOR_SLOTS.includes(slot) ? 'set' : null,
    accType: ACC_SLOTS.includes(slot) ? 'set' : null,
    rarity: MYTHIC_RARITY,
    ilvl: lv,
    minLv,
    stats,
    baseStats: { ...stats },
    affixes: [],
    // ── 세트 식별
    setId: set.id,
    setName: set.name,
    setSlot: slot,
    archs: set.archs.slice(),
    mythic: true,
    preScaled: true,   // gear.js: 이 아이템은 재스케일 금지
    noSell: true,      // 던전 세트는 매각 대상이 아니다 (UI/gear 가 존중해 주면 좋다)
    value: pieceValue(slot, lv),
    weight: 0,
    desc: def.desc,
  };
}

/** 세트 40개를 전부 만들어 본다 (스모크/검증용). rng 를 안 쓰므로 결정론적이다. */
export function allSetPieceItems(ilvl = SET_REF_ILVL) {
  const out = [];
  for (const id of SET_IDS) for (const slot of SET_SLOTS) out.push(setPieceItem(id, slot, ilvl));
  return out;
}

/* ─────────────────────────── 고유 효과 (special) ─────────────────────────── */

/**
 * 단계 정의 하나를 **고유 효과 객체**로 정규화한다. 엔진·UI 가 보는 유일한 형태다.
 * `label`/`name` 은 같은 값이다 (옛 호출부가 `label` 을 읽는다).
 * @param {string} setId
 * @param {number|'full'} step
 * @param {object} b  bonuses[step]
 * @returns {{id:string, name:string, label:string, params:object, desc:string, setId:string, step:number|'full', tier:number|'full', setName:string}}
 */
function makeSpecial(setId, step, b) {
  const set = SETS[setId] || RAW_SETS[setId] || null;
  const label = b.specialLabel || b.special;
  return {
    id: b.special,
    name: label,
    label,                                                  // 하위 호환 (옛 UI 가 label 을 읽는다)
    params: b.specialParams ? { ...b.specialParams } : {},  // 항상 사본 — 소비자가 만져도 원본이 안 바뀐다
    desc: b.specialDesc || b.desc || '',
    setId,
    setName: (set && set.name) || setId,
    step,
    tier: step,                                             // gear.js 가 쓰던 이름
  };
}

/**
 * 고유 효과 4종 색인 — `id -> 정규화된 효과 객체`.
 * 엔진이 `specials` 를 못 받은 경로에서도 id 하나로 파라미터를 되찾을 수 있게 열어 둔다.
 */
export const SET_SPECIALS = (() => {
  const out = {};
  for (const id of Object.keys(RAW_SETS)) {
    const bonuses = RAW_SETS[id].bonuses || {};
    for (const step of [...BONUS_STEPS, 'full']) {
      const b = bonuses[step];
      if (b && b.special) out[b.special] = makeSpecial(id, step, b);
    }
  }
  return out;
})();

/** 고유 효과 정의 (없으면 null) */
export function getSetSpecial(id) {
  if (!id) return null;
  const key = typeof id === 'object' ? id.id : id;
  const s = SET_SPECIALS[key];
  return s ? { ...s, params: { ...s.params } } : null;
}

/** 고유 효과 id 목록 (4종) */
export const SET_SPECIAL_IDS = Object.keys(SET_SPECIALS);

/* ─────────────────────────── 세트 효과 ─────────────────────────── */

/**
 * 착용 개수로 발동한 단계 목록.
 * @param {number} count      착용한 그 세트 파츠 개수
 * @param {number} [fullCount] 그 용병이 낄 수 있는 최대 칸 수 (양손무기면 9). 기본 10
 * @returns {Array<number|'full'>}
 */
export function activeBonusSteps(count, fullCount = SET_SLOTS.length) {
  const n = Math.max(0, Math.round(count || 0));
  const full = Math.max(1, Math.round(fullCount || SET_SLOTS.length));
  const out = [];
  for (const s of BONUS_STEPS) if (n >= s) out.push(s);
  if (n >= full) out.push('full');
  return out;
}

/**
 * 발동한 세트 효과를 **누적 합산**해서 돌려준다.
 *  - `stats` 는 절대값 합 (ilvl 스케일 적용)
 *  - `mods` 는 비율 합 (0.08 + 0.10 = 0.18 → 최종 스탯에 x1.18)
 *  - `specials` 는 발동한 고유 효과 목록 —
 *    `{id, name, label, params, desc, setId, setName, step, tier}` (`makeSpecial` 참조).
 *    **엔진이 소비하는 유일한 형태다.** 전투 진입점은 `gear.js setSpecialsFor(merc)`.
 *
 * @param {string} setId
 * @param {number} count
 * @param {number} [fullCount] 그 용병이 낄 수 있는 최대 칸 수 (gear.js equippableSlotCount)
 * @param {number} [ilvl]
 * @returns {{steps:Array, stats:object, mods:object, specials:Array, lines:string[], next:{need:number|null, step:number|'full'|null}}}
 */
export function setBonusAt(setId, count, fullCount = SET_SLOTS.length, ilvl = SET_REF_ILVL) {
  const set = getSet(setId);
  const empty = { steps: [], stats: {}, mods: {}, specials: [], lines: [], next: { need: null, step: null } };
  if (!set) return empty;

  const full = Math.max(1, Math.round(fullCount || SET_SLOTS.length));
  const steps = activeBonusSteps(count, full);
  const rawStats = {};
  const mods = {};
  const specials = [];
  const lines = [];

  for (const step of steps) {
    const b = set.bonuses[step];
    if (!b) continue;
    for (const k of Object.keys(b.stats || {})) rawStats[k] = (rawStats[k] || 0) + b.stats[k];
    for (const k of Object.keys(b.mods || {})) mods[k] = Math.round(((mods[k] || 0) + b.mods[k]) * 1000) / 1000;
    if (b.special) specials.push(makeSpecial(set.id, step, b));
    lines.push(`${step === 'full' ? '풀세트' : `${step}세트`} — ${b.desc || ''}`);
  }

  // 다음 단계 안내 (UI 용)
  const n = Math.max(0, Math.round(count || 0));
  let next = { need: null, step: null };
  for (const s of BONUS_STEPS) if (n < s) { next = { need: s - n, step: s }; break; }
  if (!next.step && n < full) next = { need: full - n, step: 'full' };

  return { steps, stats: scaleToIlvl(rawStats, ilvl), mods, specials, lines, next };
}

/**
 * 착용 아이템 배열에서 세트별 착용 수를 센다.
 * @param {object[]} items
 * @returns {Map<string, number>}
 */
export function countSetPieces(items = []) {
  const m = new Map();
  for (const it of items) {
    const id = it && it.setId;
    if (id && SETS[id]) m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
}

/** 세트 파츠인가 */
export function isSetItem(item) { return !!(item && item.setId && SETS[item.setId]); }
/** 아이템이 속한 세트 정의 (없으면 null) */
export function setOfItem(item) { return isSetItem(item) ? SETS[item.setId] : null; }

/**
 * 착용 아이템 전체에 대한 세트 효과 요약 (UI/스탯 계산 진입점).
 * @param {object[]} items 착용 중인 아이템 배열
 * @param {number} [fullCount] 그 용병이 낄 수 있는 최대 칸 수
 * @returns {Array<{set:object, count:number, bonus:object}>}
 */
export function activeSetBonuses(items = [], fullCount = SET_SLOTS.length) {
  const out = [];
  for (const [id, n] of countSetPieces(items)) {
    const ilvl = Math.round(
      items.filter((i) => i && i.setId === id).reduce((a, i) => a + (i.ilvl || SET_REF_ILVL), 0) / n,
    );
    out.push({ set: SETS[id], count: n, bonus: setBonusAt(id, n, fullCount, ilvl) });
  }
  return out.sort((a, b) => a.set.order - b.set.order);
}
