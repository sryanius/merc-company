# 용병단 (Mercenary Company) — 기술 스펙 v1

세계를 떠돌며 의뢰를 수행하고, 용병을 고용·성장시키고, 장비를 파밍하며 용병단을 키우는
브라우저 기반 자동전투 RPG.

> **이 문서는 모듈 간 계약이다.** 각 모듈은 여기 명시된 export/데이터 형태를 정확히 지켜야 한다.
> 여기에 없는 공용 타입을 임의로 만들지 말 것. 필요하면 이 문서를 먼저 고친다.

---

## 0. 기술 제약

- **순수 ES 모듈 + Canvas 2D. 빌드 스텝 없음. 외부 의존성 0.**
- 모든 import는 확장자까지 명시: `import { rng } from '../core/rng.js'`
- 브라우저 전용 API는 `ui/`, `battle/renderer.js`, `art/` 에서만 사용.
  `data/`, `game/`, `battle/engine.js` 는 **순수 JS**여야 한다 (node에서 import 가능해야 테스트 가능).
- UI 표기 문자열·주석은 한국어. 식별자는 영어.
- 파일당 대략 400줄 이내를 목표로 한다.

## 1. 디렉터리

```
index.html
css/style.css
docs/SPEC.md
src/
  core/rng.js          [완료] RNG 클래스, 전역 rng, uid()
  core/util.js         [완료] clamp/lerp/num/pct/el/$/emitter/addStats/scaleStats/clone
  art/palette.js       [완료] makePalette(), GRADE_COLOR, RARITY_COLOR/NAME
  art/parts.js         도트 파츠 라이브러리 (PARTS)
  art/spritegen.js     파츠 조합 -> 프레임 아틀라스 생성
  art/fx.js            전투 이펙트/파티클
  data/skills.js       스킬 정의
  data/classes.js      클래스 트리 (1~3차, 49종)
  data/items.js        장비 베이스/접두사/접미사, ★10슬롯 정의(SLOTS/SLOT_POWER)
  data/sets.js         ★신화 세트 4종 x 10슬롯 = 40개 + 세트 효과(3/5/7/full)
  data/dungeons.js     ★던전 4개 (주차 개방 · 고정 편성 · 월드맵 노드)
  data/formations.js   진형
  data/enemies.js      적 템플릿 / 적 부대 구성
  data/world.js        지역·도시
  data/names.js        용병 이름 생성
  game/merc.js         용병 생성/스탯/성장/전직
  game/gear.js         아이템 롤링/장착
  game/squad.js        부대 편성
  game/quest.js        의뢰 생성 / 전투 변환
  game/dungeon.js      ★던전 진행 (개방 판정 · 웨이브 · 세트 드랍 · 진행도)
  game/state.js        전역 상태 + 세이브/로드 + 날짜 진행
  battle/engine.js     결정론적 자동전투 시뮬레이터
  battle/ai.js         타게팅/행동 선택
  battle/renderer.js   전투 화면 렌더러
  ui/*.js              화면들
```

---

## 2. 스탯 모델

```js
STAT_KEYS = ['hp','atk','def','res','spd','crit','critDmg','eva']
```

| 키 | 의미 | 비고 |
|---|---|---|
| `hp` | 최대 체력 | |
| `atk` | 공격력 | 물리·마법 공용. 어떤 방어로 막히는지는 스킬의 `dmgType`이 결정 |
| `def` | 물리 방어 | |
| `res` | 마법 저항 | |
| `spd` | 행동 속도 | 게이지가 초당 `spd` 만큼 찬다. 100이 되면 행동 |
| `crit` | 치명타 확률 (%) | 0~100 |
| `critDmg` | 치명타 추가 피해 (%) | 기본 50 = 1.5배 |
| `eva` | 회피율 (%) | |

### 2.1 스케일링

`hp/atk/def/res/spd` 만 레벨·등급·차수로 곱연산된다. `crit/critDmg/eva` 는 평탄 가산.

```js
SCALING_KEYS = ['hp','atk','def','res','spd']
FLAT_KEYS    = ['crit','critDmg','eva']

GROWTH_RATE = 0.085                        // 레벨당 8.5%
TIER_MULT   = [1.00, 1.30, 1.66, 2.10]     // 1/2/3/4차
GRADE_MULT  = { F:0.78, E:0.88, D:0.97, C:1.06, B:1.18, A:1.34, S:1.55 }
GRADE_IDX   = { F:0, E:1, D:2, C:3, B:4, A:5, S:6 }

// 최종 = 아키타입기본 * 클래스보정 * (1 + 0.085*(lv-1)) * TIER_MULT * GRADE_MULT + 장비
// crit  += GRADE_IDX * 0.8
// eva   += GRADE_IDX * 0.5
```

### 2.2 아키타입 기준값 (`data/classes.js`가 `ARCHETYPES`로 export)

```js
export const ARCHETYPES = {
  tank:    { hp:340, atk:22, def:31, res:16, spd:38, crit:3,  critDmg:50, eva:2 },
  fighter: { hp:245, atk:34, def:18, res:10, spd:48, crit:8,  critDmg:50, eva:5 },
  lancer:  { hp:255, atk:32, def:20, res:11, spd:45, crit:6,  critDmg:50, eva:4 },
  archer:  { hp:185, atk:36, def:11, res:10, spd:53, crit:12, critDmg:55, eva:8 },
  rogue:   { hp:180, atk:33, def:10, res:9,  spd:66, crit:20, critDmg:65, eva:14 },
  mage:    { hp:168, atk:41, def:8,  res:21, spd:42, crit:8,  critDmg:50, eva:4 },
  healer:  { hp:200, atk:24, def:13, res:23, spd:46, crit:5,  critDmg:50, eva:5 },
};
```

### 2.3 피해 공식 (engine 고정)

```js
mit   = 100 / (100 + (dmgType==='phys' ? target.def : target.res))
raw   = src.atk * skill.power * mit * rng.float(0.93, 1.07)
crit  = rng.chance(src.crit/100)  ->  raw *= 1 + src.critDmg/100
회피  = rng.chance(clamp(target.eva - src.acc0, 0, 60)/100)  // acc0 = 0, 회피는 eva만
최소 피해 = 1
```

### 2.4 레벨·경험치

```js
MAX_LEVEL = 80
expToNext(lv) = Math.round(60 * Math.pow(lv, 1.55))   // quest.js EXP_SCALE = 2.45
PROMOTE_LEVEL = { 2: 15, 3: 35, 4: 55 }   // 2차 Lv15, 3차 Lv35, 4차 Lv55
```
성장 목표(도시 이동 포함 실측): Lv15 30~45일 / Lv35 80~120일 / Lv55 160~220일 / Lv80 300일+.
(설계 원안은 `60·lv^1.72`·`EXP_SCALE 1.8` 였으나 도시 이동을 넣은 실측이 목표보다 ~2배 느려
지수를 1.55, EXP_SCALE 을 2.45 로 조정했다. 성장 노브는 전투 밸런스와 독립이다.)

---

## 3. 데이터 형태

### 3.1 Skill — `data/skills.js`

```js
{
  id: 'slash',
  name: '베기',
  cd: 6,                    // 재사용 대기(초). 쿨이 안 돌면 기본공격
  power: 1.8,               // atk 배율. 기본공격은 1.0 고정
  dmgType: 'phys'|'magic'|'none',
  target: 'enemy'|'ally'|'self'|'allEnemy'|'allAlly',
  select: 'front'|'back'|'lowestHp'|'highestAtk'|'random'|'self'|'lowestHpAlly',
  count: 1,                 // 타겟 수 (allEnemy/allAlly면 무시)
  range: 'melee'|'ranged',  // melee = 돌진 모션, ranged = 제자리 + 투사체
  fx: 'slash'|'pierce'|'arrow'|'bolt'|'fire'|'ice'|'holy'|'shadow'|'nature'|'lightning'|'blunt'|'poison'|'buff'|'heal',
  effects: [                // 피해 외 부가효과 (없으면 생략)
    { type:'heal',   power:1.2, target:'self' },
    { type:'buff',   stat:'atk', amount:0.25, dur:8, target:'allAlly' },
    { type:'debuff', stat:'def', amount:-0.3, dur:6 },
    { type:'dot',    dmgType:'magic', power:0.35, tick:1, dur:5 },
    { type:'shield', power:1.0, dur:8 },
    { type:'stun',   dur:1.5, chance:0.35 },
    { type:'lifesteal', ratio:0.35 },
  ],
  desc: '전방의 적을 강하게 벤다.',
}
```

`export const SKILLS = {...}` / `export function getSkill(id)`

> 기본공격은 엔진이 자동 생성한다. 클래스의 `basicFx`, `basicRange`, `basicDmgType` 을 사용.

### 3.2 Class — `data/classes.js`

```js
{
  id: 'swordsman', name: '검사', tier: 1,
  arch: 'fighter',                       // ARCHETYPES 키
  mods: { atk:1.05, hp:0.98 },           // 아키타입 대비 배율 (생략된 키는 1.0)
  role: '근접 딜러',                      // UI 표기용 한국어
  dmgType: 'phys',                        // 기본공격 속성
  range: 'melee'|'ranged',                // 기본공격 사거리 타입
  rank: 1|2,                              // 선호 배치: 1=전열, 2=후열 (UI 힌트)
  basicFx: 'slash',
  equip: ['sword','shield'],              // 장착 가능 무기 타입
  skills: ['slash'],                      // 보유 스킬 id (1~2개)
  next: ['berserker','duelist','knight'], // 상위 전직 후보 (3차는 [])
  sprite: {                               // 스프라이트 레시피 (§4.4 어휘만 사용)
    body:'body_normal', head:'head_human', hair:'hair_short',
    helm:'helm_iron', armor:'armor_mail', cape:'cape_none',
    weapon:'wpn_sword', offhand:'shd_round',
    palette:{ skin:'pale', hair:'brown', metal:'iron', cloth:'crimson', leather:'brown', accent:'gold', glow:'none' },
  },
  desc: '균형 잡힌 검술 용병.',
}
```

**클래스 트리 요구사항**
- 1차 7종 (주점에서 고용 가능): 검사 / 창병 / 방패병 / 궁수 / 도적 / 견습마법사 / 수도사
- 각 1차 → 2차 2종 = **14종**, 각 2차 → 3차 2종 = **28종**, 각 3차 → 4차 2종 = **56종**.
  총 7+14+28+56 = **105종**.
- 4차는 전부 `next: []`, `tier: 4`. 4차 56종은 `data/classes_t4.js` 가 소유하고 `classes.js`
  가 `CLASSES` 로 병합한다. 3차의 `next`(4차 2종)는 `classes.js` 가 채운다.
- 4차 스킬 id 규약: `skills = [3차에서 물려받은 스킬, 't4_<클래스id>']` (스모크가 검사한다).
- 아키타입은 상위 전직에서 바뀔 수 있다 (예: 수도사 → 수도승은 `fighter`; 4차는 극단 공격형/
  생존·지원형으로 갈려 아키타입이 바뀌기도 한다).

export: `ARCHETYPES`, `CLASSES`(id 맵), `BASE_CLASSES`(1차 id 배열), `getClass(id)`, `promoteOptions(id)`, `classChain(id)`, `classesOfTier(tier)`
(`classes_t4.js`: `T4_CLASSES`, `T4_IDS`)

### 3.3 Item — `data/items.js` / `game/gear.js`

```js
// 베이스 (data/items.js) — stats 는 "슬롯 계수 1.0(무기) 기준 ilvl 1" 원본 수치다
{ id:'longsword', name:'롱소드', slot:'weapon', weaponType:'sword',
  minLv:1, stats:{atk:12}, weight:10, desc:'' }

// 롤링된 실물 (game/gear.js가 생성)
{ uid:'it_x1', baseId:'longsword', name:'날카로운 롱소드 +2',
  slot:SLOTS 중 하나, weaponType:'sword'|null,
  rarity:0..5, ilvl:12, stats:{atk:19, crit:4}, affixes:[{id,name,stats}], value:340,
  setId:null }              // 세트 아이템만 setId/archs/mythic 을 갖는다
```

#### 장비 슬롯 10칸 (설계 A)

```js
export const SLOTS = ['weapon','offhand','head','body','legs','hands','feet','neck','ring1','ring2'];
```

| 슬롯 | 한국어 | 비고 |
|---|---|---|
| `weapon` | 오른손(무기) | `weaponType` 유지 |
| `offhand` | 왼손 | 방패·보조무기. **양손무기를 들면 잠긴다** → 실질 9칸 |
| `head` `body` `legs` `hands` `feet` | 머리·상의·하의·장갑·신발 | 방어구 5칸 |
| `neck` `ring1` `ring2` | 목걸이·반지1·반지2 | 장신구 3칸 (반지 두 칸은 같은 `'ring'` 베이스 풀) |

- 무기 타입: `sword, greatsword, spear, axe, bow, crossbow, dagger, staff, wand, mace, shield, tome, claw, scythe, katana`
  — **`shield` 만 `WEAPON_TYPES.shield.slot === 'offhand'`** 다.
- 희귀도 0~5 = 일반/고급/희귀/영웅/전설/**신화**. 접사 개수 = `RARITY_AFFIX_COUNT[rarity]`.
  **신화(5)는 던전 세트 전용**이며 일반 드랍 테이블에 넣지 않는다 (`gear.RARITY_WEIGHTS` 는 0~4만 굴린다).
- `baseStat = base.stats[k] * SLOT_POWER[slot] * (1 + 0.13*(ilvl-1)) * RARITY_MULT[rarity]`
  `RARITY_MULT = [1, 1.15, 1.35, 1.62, 2.0, 2.7]`
- ★ **`SLOT_POWER` 가 장비 총량의 유일한 노브다.** 슬롯 계수는 `items.js` 안에서 **한 번만** 곱한다
  (gear.js 는 절대 다시 곱하지 않는다 — 두 군데서 곱하면 랭크 대역이 통째로 무너진다).

```js
export const SLOT_POWER = {           // 무기 1.00 기준 · 합계 4.70
  weapon:1.00, offhand:0.50,
  head:0.45, body:0.60, legs:0.45, hands:0.35, feet:0.35,
  neck:0.40, ring1:0.30, ring2:0.30,
};
```
합계 4.70 = 옛 3슬롯(≈2.4) 대비 약 2배. 10칸을 다 채우는 건 후반이라 성장 여지로 남겨 둔 값이다.
`tools/balance.mjs` 의 랭크 승률은 **장비 없는** 부대로 재므로 이 값에 영향을 받지 않는다 —
장비 총량을 바꿀 때는 `tools/dungeon.mjs` 1번 섹션(부대 전투력 배수)으로 확인해라.

- 접두사(prefix)/접미사(suffix) 각각 풀에서 롤. 이름 = `접두사 + 베이스명 + 접미사`
- 옛 세이브 `equipment:{weapon, armor, accessory}` 는 `LEGACY_SLOT_MAP` 으로
  `weapon→weapon / armor→body / accessory→neck` 이관하고 나머지는 빈 칸으로 둔다.

export: `SLOTS`, `SLOT_NAME`, `SLOT_POWER`, `slotPowerOf`, `SLOT_DROP_WEIGHT`, `LEGACY_SLOT_MAP`,
`WEAPON_SLOTS`, `ARMOR_SLOTS`, `ACC_SLOTS`, `RING_SLOTS`, `emptyEquipment()`, `normalizeEquipment(eq)`,
`basePoolsFor(slot)`, `isTwoHanded(t)`, `equippableSlots(w)`, `equippableSlotCount(w)`,
`ITEM_BASES`, `PREFIXES`, `SUFFIXES`, `WEAPON_TYPES`, `OFFHAND_TYPES`, `basesFor(slot, ilvl)`,
`MYTHIC_RARITY`, `RARITY_MULT/NAME/COLOR`, `registerItemBases`, `registerItemSets`

`game/gear.js` 는 위 정의를 그대로 재export 하고(`SLOTS`/`SLOT_NAME`/`SLOT_POWER`),
`offhandLocked(merc)`, `equippableSlotCount(merc)`, `lockedSlots(merc)`, `wornItems(merc)`,
`equipIssue/canEquip/equipItem/unequipSlot`, `setProgress(merc)`, `setBonusStats(merc)`,
`setBonusFromWorn(worn, maxSlots)`, `rollSetItem({setId, slot, ilvl})`, `setIdOf/setArchAllows` 를 더한다.

### 3.3b 세트 아이템 (신화) — `data/sets.js`

**던전 하나당 세트 하나, 4세트 × 10슬롯 = 40개.** `data/sets.js` 가 유일한 진실의 원천이며
**완성된 아이템 객체를 직접 돌려준다** (`preScaled:true` — gear.js 는 다시 스케일하지 않는다).

| 세트 id | 이름 | 던전 | 착용 아키타입 |
|---|---|---|---|
| `ironrampart` | 강철 성벽 | 1주차 얼어붙은 성채 | tank, lancer |
| `bloodoath` | 피의 서약 | 2주차 피의 투기장 | fighter, rogue |
| `starseeker` | 별의 사수 | 3주차 별이 떨어진 관측탑 | archer, mage |
| `constellation` | 성좌의 은총 | 4주차 성좌의 신전 | 전 아키타입 7종 |

- 클래스 105종에 개별 제한을 걸 수 없으므로 **제한은 아키타입 7종 기준**이다
  (`set.archs`, 아이템에도 `item.archs` 로 실린다. `gear.equipIssue` 가 검사).
- 개별 성능은 같은 ilvl 전설의 `LEGEND_MULT`(=1.35)배. 슬롯 배분은 `SLOT_COEF`(= SLOT_POWER 와 같은 표).
- **세트 효과는 3 / 5 / 7 / `full` 단계에서 누적**된다. `stats` 는 절대값 가산, `mods` 는 비율 가산,
  `special` 은 풀세트에서만 붙는 고유 효과다.
  **`full` 기준은 고정 10 이 아니라 그 용병이 낄 수 있는 최대 칸 수**다
  (양손무기 사용자는 9칸이 풀세트 — `gear.equippableSlotCount(merc)` 가 판정).

#### 세트 고유 효과 (`special`) — 엔진 계약

풀세트 단계 하나가 `special`(id) / `specialLabel`(한국어 이름) / `specialParams`(엔진이 소비할 수치)
/ `desc`(UI 가 그대로 보여줄 설명) 를 갖는다. 넷은 항상 같이 다닌다.
**`data/sets.js` 가 유일한 정의처다** — 엔진에도 gear.js 에도 수치를 다시 적지 마라.

```
data/sets.js  specialParams
   ↓ setBonusAt().specials        (id/name/label/params/desc/setId/step)
gear.js       setSpecialsFor(merc)          ← 전투·UI 공용 진입점
   ↓ UnitDef.specials = [{id, label, params}]
quest.js allyUnitDefs · squad.js squadUnitDefs · dungeon.js dungeonBattleDefs   ← 세 경로 전부
   ↓
battle/engine.js  SPECIAL_HOOKS[id]          §5.5
```

| id | 세트 | 이름 | trigger | 요약 |
|---|---|---|---|---|
| `rampart_aegis` | 강철 성벽 | 불락(不落)의 가호 | `battleStart` | 최대체력 25% 방어막 12초(1회). 그 방어막이 **피해로** 깨지면 아군 전체 def +15% 8초 |
| `bloodoath_frenzy` | 피의 서약 | 피의 갈증 | `onKill` | 처치 시 전 스킬 쿨 −2.5초 + atk +12% 5초(최대 3중첩). **직접 가한** 피해의 12% 흡혈 |
| `starseeker_starfall` | 별의 사수 | 유성 낙하 | `hit` | 원거리 명중 시 **그 피해의 45%** 로 다른 적 1기 추가 타격. 처치 시 행동 게이지 +40 |
| `constellation_grace` | 성좌의 은총 | 성좌의 은총 | `fatal` | 전투 불능 피해를 가로채 최대체력 35% 로 부활(1회) + 아군 전체 최대체력 12% 회복 |

파라미터 어휘 (`sets.js SPECIAL_TRIGGERS` 주석이 원본):

| 키 | 뜻 |
|---|---|
| `trigger` | `battleStart` / `onKill` / `hit` / `fatal` / `shieldBreak` |
| `buffId` | 엔진 `addBuff` 의 `src` 키. 같은 키는 중첩되지 않고 **갱신**된다 |
| `*Target` | `self` / `allAlly` / `allEnemy` |
| `*Select` | 추가 대상 선택. `nearest` = 원 대상에서 가장 가까운 적, 동률이면 `idx` 오름차순 |
| `*Once` | 전투당 1회인가 |
| `...Mod` | 비율 (0.15 = +15%) · `...Ratio`/`...Hp`/`...Heal` 최대 체력 대비 · `...Gauge` 게이지 비율(100 기준) · `...Dur` 초 |
| `splashOf` | `damage` = **그 타격이 실제로 넣은 피해량** 기준. atk 로 다시 계산하지 않는다 |
| `splashRoll` | `false` = 치명타·회피를 **다시 굴리지 않는다** (결정론 유지) |
| `splashChain` | `false` = 추가 타격이 자기 자신을 다시 부르지 않는다 (무한 연쇄 방지) |
| `lifestealDot` | `false` = 지속 피해(dot)는 흡혈 대상이 아니다 |
| `reviveClear` | `true` = 부활할 때 자기 dot·디버프를 지운다 |

> ★ **엔진은 `params` 만 읽는다.** 새 상수를 엔진에 만들면 다시 두 벌이 된다 —
> 8차까지 `gear.js` 에 `steel_rampart('받는 피해 20% 경감')` 같은 **다른 이름·다른 수치**가
> 따로 박혀 있었고, 정작 전투에는 **아무것도 적용되지 않았다**. 9차에 하드코딩을 지우고
> 엔진 훅을 붙였다. `tools/setspecial.mjs` 와 스모크가 매번 양방향 일치를 검사한다.

export: `SET_SLOTS`, `SLOT_COEF`, `SETS`, `SET_IDS`, `SET_LIST`, `SET_ORDER`, `getSet(id)`,
`setsForArch(arch)`, `canWearSet(setId,arch)`, `setForWeek(week)`, `setPieceDef(setId,slot)`,
`setPieceStats(setId,slot,ilvl)`, `setPieceItem(setId,slot,ilvl,opts)`, `allSetPieceItems(ilvl)`,
`activeBonusSteps(count,fullCount)`, `setBonusAt(setId,count,fullCount,ilvl)`,
`countSetPieces`, `isSetItem`, `setOfItem`, `activeSetBonuses`, `dropSlotsForWave(wave)`,
`MYTHIC_RARITY/NAME/COLOR`, `SET_TUNE`(전역 세기 노브), `LEGEND_MULT`, `SET_REF_ILVL`
고유 효과: `SET_SPECIALS`(id→정의), `SET_SPECIAL_IDS`, `getSetSpecial(id)`, `SPECIAL_TRIGGERS`

### 3.4 Formation — `data/formations.js`

```js
{
  id:'basic', name:'기본진', 
  slots:[ {x:0.15,y:0.30}, ... ],   // 정확히 7개. x:0=최전방 1=최후방, y:0=위 1=아래
  effects:[
    { scope:'all'|'front'|'back'|'role:archer'|'arch:tank', mods:{ atk:0.2, def:-0.1 } },
  ],
  cost: 0,                 // 골드 구매가 (0 = 시작 보유)
  source: '기본 지급'|'상점'|'이벤트',
  tier: 1..3,
  desc: '특별한 효과가 없는 표준 대형.',
}
```
- `front` = `slot.x < 0.34`, `back` = `slot.x >= 0.66`, 나머지는 middle
- `mods` 는 §2.1 최종 스탯에 곱연산으로 적용 (`scaleStats`)
- **8종 이상** 정의: 기본진 / 방원진 / 봉시진 / 학익진 / 장사진 / 어린진 / 안행진 / 언월진

export: `FORMATIONS`, `getFormation(id)`, `formationMods(formation, slotIndex, unit)` → `{atk:0.2,...}`

### 3.5 Enemy — `data/enemies.js`

```js
{ id:'goblin_grunt', name:'고블린 병졸', arch:'fighter', mods:{hp:0.8},
  dmgType:'phys', range:'melee', basicFx:'slash',
  skills:['goblin_stab'], tier:1,          // tier: 등장 난이도 대역
  biome:['forest','cave'],                 // 어느 지역에서 나오는지
  sprite:{ ... },                          // Class와 동일 형태
  boss:false, expMul:1, goldMul:1 }
```
- 30종 이상. 보스 5종 이상 (`boss:true`, 스탯 배율 큼)
- export: `ENEMIES`, `getEnemy(id)`, `enemiesFor(biome, tier)`, `buildEnemySquad(quest, rng)`
  - `buildEnemySquad` 는 `{units:[{enemyId, level, slotIndex}], formationId}` 반환

### 3.6 World — `data/world.js`

```js
Region { id, name, biome:'plains'|'forest'|'mountain'|'desert'|'swamp'|'coast'|'tundra'|'cave', tier:1..5, desc }
City {
  id, name, regionId, tier:1..5,      // tier = 주점 등급 = 고급 용병 확률
  x, y,                               // 월드맵 좌표 (0~1000 x 0~700)
  services:['tavern','shop','guild','smith'],
  links:[{ to:cityId, days:2 }],      // 이동 경로 (양방향으로 정의 필요)
  specialty:[classId, ...],           // ★ 이 도시가 배출하는 1차 클래스 1~2종
  desc
}
```
- 도시 12~16개, 지역 6~8개. 시작 도시 `START_CITY`.
- export: `REGIONS`, `CITIES`, `START_CITY`, `getCity(id)`, `travelDays(a,b)`, `pathBetween(a,b)`,
  `citySpecialty(cityId)`, `isSpecialtyCity(cityId, classId)`, `citiesForClass(classId)`

**`specialty` 규칙 (지키지 않으면 저티어 도시를 갈 이유가 사라진다)**
- 값은 **1차 클래스 id 만** (`BASE_CLASSES`). 정의 시점에 걸러지고 스모크가 검사한다.
- 1차 7종이 **정확히 3개 도시씩**(총 21칸) 나눠 갖고, 특화가 없는 도시는 없다.
- **도시 tier 와 무관하게 배분한다.** 7종 전부 tier 1~2 도시에 거점이 하나씩 있어야 한다 —
  그래야 초반부터 특화가 의미를 갖는다.
- 특화 클래스는 그 도시 주점에서 실효 티어 +1.0 과 **S·A 가중치 ×4** 를 받는다(§3.7).
  설계 목표: *1티어 특화 도시(평판 100)의 S 확률 > 5티어 비특화 도시(평판 10)의 S 확률.*
  실측 **4.00% > 3.00%** (`tools/reputation.mjs` 가 매번 검증한다).

### 3.7 Mercenary (런타임, `game/merc.js`)

```js
{
  uid, name, grade:'F'..'S', classId, level, exp,
  hp,                       // 현재 체력 (전투 후 유지)
  status:'ready'|'wounded', woundUntil: dayNumber,
  equipment:{ weapon:itemUid|null, armor:null, accessory:null },
  squadId:null, slotIndex:-1,
  upkeep,                   // 일당
  hiredDay, kills, battles,
}
```
export: `createMerc({classId, grade, level})`, `mercStats(merc, {items})`, `gainExp(merc, amount)`,
`canPromote(merc)`, `promote(merc, toClassId)`, `mercSprite(merc)`, `gradeRoll(cityTier, rng, opts)`, `hireCost(classId, grade, level)`

#### 등급 롤 — 평판 · 특화 보정

```js
gradeRoll(cityTier, rng, opts)   // opts = { rep = 10, specialty = false }
```
**`opts` 를 생략하면 예전 2인자 호출과 결과가 완전히 같다** (스모크가 5개 티어에서 검사한다).

```js
effTier = clamp(cityTier + (rep - REP_BASELINE)/REP_PER_TIER + (specialty ? 1.0 : 0), 1, 6)
//        REP_BASELINE = 10, REP_PER_TIER = 60  → 평판 100 이면 +1.5 티어
```
- `GRADE_WEIGHTS` 는 티어 1~6 표다. **6 은 도시에 없다** — 평판·특화로만 닿는 실효 티어 상한.
- 정수 티어 사이는 **선형 보간**한다 (`gradeWeightsAt`).
- 특화 도시면 그 위에 **S·A 가중치 ×`SPECIALTY_TOP_MULT`(=4)**, 나머지 등급은 비례 축소해 합을 유지한다.
  (설계안은 ×3 이었지만 실측 결과 목표가 3.0% vs 3.0% 동률로 깨져 ×4 로 올렸다.)

추가 export: `GRADE_WEIGHTS`, `MAX_CITY_TIER`, `REP_BASELINE`, `REP_PER_TIER`,
`SPECIALTY_TIER_BONUS`, `SPECIALTY_TOP_GRADES`, `SPECIALTY_TOP_MULT`,
`effectiveTier(cityTier, opts)`, `gradeWeights(cityTier)`, `gradeWeightsAt(effTier)`,
`gradeWeightsFor(cityTier, opts)`, `gradeOdds(cityTier, opts)`(합 1), `gradeChances(cityTier, opts)`(%)

### 3.8 GameState (`game/state.js`)

```js
{
  version:1, seed,
  companyName:'',
  day:1, gold:800, renown:0,
  cityId:'greenhold',
  roster:[Mercenary], items:[Item], squads:[Squad],
  formations:['basic'],                // 보유 진형 id
  reputation:{ [cityId]: 0..100 },     // ★ 도시 평판. 시작 도시만 START_REP, 나머지 0
  rosterCap:20,                        // ★ 단원 정원 (20 → 40, 골드로 확장)
  dungeons:{ [dungeonId]: {bestWave, clearedAt} },  // ★ 던전 진행도 (설계 C)
  quests:{ [cityId]: {day, list:[Quest]} },
  tavern:{ [cityId]: {day, list:[TavernOffer]} },
  shop:{   [cityId]: {day, list:[Item]} },
  log:[{day, text}],
  stats:{ battlesWon, battlesLost, questsDone },
}
Squad { id, name, memberUids:[7개, 빈 슬롯은 null], formationId, status:'idle'|'away', returnDay }
```
export: `state`, `newGame(seed, companyName)`, `save()`, `load()`, `importState(data)`, `hasSave()`,
`advanceDays(n)`, `addLog(text)`, `bus`(emitter), `DATA_VERSION`(=4),
`calendar(day)`, `calendarLabel(day)`, `openDungeonWeek(day)`,
`getDungeonProgress(id, st)`, `recordDungeonWave(id, waveNo, opts, st)`

#### 년 / 월 / 주 달력 (설계 D)

`state.day` 는 그대로 **유일한 진실의 원천**이고 달력은 전부 파생값이다.

```
1주 = 7일 · 1개월 = 4주 = 28일 · 1년 = 12개월 = 336일

year        = floor((day-1)/336) + 1
dayOfYear   = (day-1) % 336
month       = floor(dayOfYear/28) + 1
weekOfMonth = floor((dayOfYear%28)/7) + 1     ← 던전 개방 주차
dayOfWeek   = (dayOfYear%7) + 1
```
- `calendar(day = state.day)` → `{year, month, week, dayOfWeek, day}`
- `openDungeonWeek(day)` = `weekOfMonth` (1~4)
- **UI 표기는 `calendarLabel()` 로 통일한다: `3년 7월 2주차 (245일차)`**
- 세이브에 따로 저장하지 않는다 (day 하나로 항상 복원된다). 옛 세이브도 그대로 동작한다.

#### 도시 평판 (`reputation`)

```js
REP_MIN = 0 · REP_MAX = 100 · START_REP = 10 · REP_TAVERN_MIN = 10
REP_QUEST_GAIN = { F:2, E:3, D:4, C:5, B:6, A:8, S:10 }   // 실패는 이 값의 절반(최소 1) 하락
```
- `getRep(cityId, st)` 기록이 없으면 0 / `addRep(cityId, delta, st)` 0~100 clamp + 로그, 변경 후 값 반환
- `addQuestRep(cityId, rank, success, st)` → `{delta, rep}` — `quest.js applyQuestResult` 가 한 번만 부른다
- `canUseTavern(cityId, st)` → `{ok, reason, rep, need}` — **평판 10 미만이면 그 도시 주점에서 고용 불가**
- **세이브 직렬화 대상.** 필드가 없거나 빈 옛 세이브는 "전 도시 0 + 시작 도시 `START_REP`" 로 정규화한다.
  값이 있으면 도시별로 0~100 정수로 자르고, 빠진 도시는 0 으로 채운다.

#### 단원 정원 (`rosterCap`)

```js
ROSTER_CAP_START = 20 · ROSTER_CAP_MAX = 40 · ROSTER_CAP_STEP = 5
ROSTER_CAP_COST  = { 25:1200, 30:3000, 35:6500, 40:12000 }
```
- `rosterCapCost(nextCap)` (표 밖이면 `Infinity`) / `canExpandRoster(st)` → `{ok, reason, cost, nextCap}`
- `expandRosterCap(st)` → `{ok, reason, cost, cap}` (골드 차감)
- `canHireMore(st)` → `{ok, reason, count, cap}` — 고용 경로가 반드시 먼저 확인한다
- 옛 세이브에 없으면 20, 범위 밖/숫자 아님이면 [20, 40] 으로 정규화한다.

#### 부대 확장 (`game/squad.js`)

```js
MAX_SQUADS = 5                                  // 시작은 1개
SQUAD_COSTS = [0, 0, 1500, 4000, 9000, 18000]   // 인덱스 = 만들려는 부대 번호
```
- `squadCost(nextCount)` — n번째 부대를 만드는 비용
- `canAddSquad(state)` → `{ok, reason, cost, count, max}`
- `buySquad(state, name)` → `{ok, reason, squad}` — **골드를 차감하고** `state.squads` 에 넣는다
- `createSquad(name, formationId)` 는 **시그니처와 동작이 그대로다** (골드를 받지 않는다).
  구매 경로는 반드시 `buySquad` 를 쓴다.

### 3.9b Dungeon (`data/dungeons.js` / `game/dungeon.js`) — 설계 C

```js
{ id, name, week:1..4, setId, setName, archs:[arch], biome, x, y, desc,
  formationId, lineup:[enemyId x6], bosses:[enemyId], waves:10, tier:5, level:80, power }
```

- **던전 4개 · 각 10웨이브. 웨이브마다 보스가 나온다.** 던전은 도시가 아니라 **월드맵의 별도 노드**다.
- **주차 제한**: 그 달의 N주차에는 N번 던전만 열린다 (`openDungeonWeek(day)` → `openDungeonId(day)`).
- **편성은 고정이다** (`lineup` 6기 + `bosses`). 무작위로 세우면 tier 5 개체차 때문에 같은 배율에서도
  웨이브 승률이 0%↔100% 로 튄다(실측). `bosses` 는 약한 순서대로 적고 웨이브 구간을 통째로 나눠 갖는다.
- 보스를 잡을 때마다 **세트 아이템 1개**를 드랍한다:
  1~5웨이브 → 방어구 5칸 / 6~8 → 장신구 3칸 / 9~10 → 무기·왼손. ilvl = `71 + waveIndex`(71~80).
- 난이도 노브는 `dungeon.js WAVE_POWER`(웨이브별 적 전스탯 배율) × `dungeons.js power`(던전별 정규화).
  ★ **드랍 구간이 곧 게이트다** — 방어구만 모은 부대가 6웨이브에, 장신구까지 모은 부대가 9웨이브에
  닿을 수 있어야 세트를 완성할 수 있다. 곡선을 세게 잡으면 세트를 영원히 못 모으는 순환 고리가 생긴다.
- 적 스탯 파이프라인은 **quest.js 를 그대로 재사용**한다 (`dungeonQuest` → `questBattleDefs`).

export(`data/dungeons.js`): `DUNGEONS`, `DUNGEON_LIST`, `DUNGEON_IDS`, `SET_IDS`, `DUNGEON_WAVES`,
`DUNGEON_WEEKS`, `getDungeon`, `dungeonForWeek`, `dungeonsForWeek`, `dungeonBySet`, `archsForSet`,
`allowsArch`, `setAllowsArch`, `isDungeonId`, `validateDungeons(cities)`
export(`game/dungeon.js`): `WAVE_POWER`, `WAVES`, `openDungeonId(day)`, `openDungeon(day)`,
`canEnter(state, id)`, `dungeonProgress`, `wavePower`, `bossForWave`, `dungeonWave`, `dungeonQuest`,
`dungeonEnemyDefs`, `dungeonBattleDefs`, `dropSlotsForWave`, `dropSlotForWave`, `dropIlvl`,
`dropForWave`, `setDungeonDropFactory`, `applyDungeonResult`

### 3.9 Quest (`game/quest.js`)

```js
{
  id, name, type:'토벌'|'호위'|'탐색'|'섬멸'|'수호',
  cityId, biome, rank:'F'..'S', level,       // 권장 레벨
  sub:-1|0|1, rankLabel:'E+',                 // 서브랭크(설계 D). rank 문자엔 기호를 섞지 않는다
  elite:false,                               // 정예 의뢰(설계 E)
  days, waves:[ EnemySquadDef ],             // 1~3 웨이브 (wave.power/wave.elite 로 난이도 반영)
  reward:{ gold, exp, renown, itemRolls:[{ilvl, rarityBonus}] },
  desc, expiresDay,
}
```
export: `RANKS`, `RANK_LEVEL`, `RANK_DAYS`, `QUEST_TYPES`, `SUBS`, `SUB_LABEL`, `SUB_NAME`, `SUB_POWER`,
`RANK_SUB_LEVEL`, `subLevelRange(rank,sub)`, `subOf(q)`, `rankLabelOf(q[,sub])`, `normalizeQuest(q)`,
`isEliteQuest(q)`, `ELITE_MIN_RANK`, `ELITE_PREFIX`, `ELITE_LABEL`, `ELITE_WARN`,
`genQuests(cityId, day, rng, squadCount)`, `questBattleDefs(quest, waveIndex, state, squadId)`,
`enemyUnitDefs(wave, quest, waveIndex)`, `questRewards(quest, result, rng)`,
`applyQuestResult(quest, results)`, `enemyStats(enemy, level)`

**서브랭크(설계 D)**: 랭크 하나를 `-`(입문)/기본/`+`(고난도) 셋으로 쪼개 21단계. `quest.rank` 는
F~S 문자 그대로 두고 `quest.sub`(-1|0|1)·`quest.rankLabel`('E+')을 따로 둔다. `-` 는 적 스탯 ×0.96·
보상 ×0.80·등장 비중 높음, `+` 는 적 스탯 ×1.06·보상 ×1.35. 옛 세이브는 `sub=0`·`elite=false` 로 정규화.

**정예(설계 E)**: `quest.elite=true`. D랭크↑ 확률 12~20%. 적 전원 스탯 ×`ELITE_MULT`, 그중 1~2기는
`정예 ` 접두사 챔피언 ×`ELITE_CHAMP_MULT`. 보상 골드·경험치 ×2.2·평판 ×1.5·전리품 희귀도 +1.
같은 랭크 일반 대비 승률 -18~28%p 가 목표.

**의뢰 공급량은 부대 수에 비례한다.** 부대를 5개까지 살 수 있게 되면서 "부대는 늘렸는데 시킬
의뢰가 없다"가 곧바로 부대 구입비를 헛돈으로 만든다.
```js
count = clamp(3 + squadCount * 2 + r.int(0,1), 4, 16)
```
`squadCount` 를 생략하면 `state.squads.length` 를 읽고, state 가 없으면 1 로 본다 (순수 함수 유지 —
`balance.mjs` / `smoke.mjs` 가 state 없이 부른다). 랭크 분포는 건드리지 않는다.

`applyQuestResult` 는 결과에 `rep:{cityId, delta, after}` 를 실어 돌려준다. `delta` 는 0~100 clamp 를
**반영한 실제 변동량**이다 (이미 100 인 도시에서 성공하면 0).

```js
// 랭크 하나는 반드시 전직 차수 하나 안에만 들어간다 (차수 경계 Lv15 / Lv35 / Lv55).
// 경계를 걸치면 같은 랭크 안에서 저차수·고차수 부대의 체감 난이도가 갈려 한쪽이 반드시 무너진다.
//   F/E → 1차 · D/C → 2차 · B/A → 3차 · S → 4차
RANK_LEVEL = { F:[1,7], E:[8,14], D:[15,24], C:[25,34], B:[35,44], A:[45,54], S:[55,80] }
// S 구간(26레벨)은 서브랭크가 쪼갠다: S-[55,63] / S[64,71] / S+[72,80] (RANK_SUB_LEVEL).
```

**난이도 목표 대역(설계 F, 권장 레벨 표준 부대·비정예 기준)** — `tools/balance.mjs` 가 검사:
```
F 88~100% / E 72~86 / D 62~78 / C 55~70 / B 48~64 / A 44~60 / S 40~56
```
F 만 초반 보호 구간으로 남기고 E 부터 확실히 조인다. 실패가 잦아도 부상 완화·"출전 불가 0회"
계약은 그대로 지켜 진행이 막히지 않는다.

---

## 4. 스프라이트 시스템 (가장 중요)

### 4.1 캔버스 규격

- 논리 해상도 **32 x 40 픽셀**. 화면에는 3배 확대(96x120), `imageSmoothingEnabled=false`.
- 캐릭터는 **오른쪽(+x)을 바라본다**. 적은 렌더러가 좌우 반전한다.
- 발바닥(지면) = `y=38`. 가로 중심 = `x=16`.

### 4.2 조인트 좌표 (스프라이트 로컬, 기본 포즈)

```js
export const JOINTS = {
  head:      {x:16, y:14},   // 목 (머리/투구/헤어 앵커가 여기 놓임)
  chest:     {x:16, y:14},   // 몸통 상단 중앙
  pelvis:    {x:16, y:26},
  shBack:    {x:13, y:16},   // 먼쪽 어깨
  shFront:   {x:19, y:16},   // 가까운쪽 어깨
  handBack:  {x:11, y:24},
  handFront: {x:21, y:24},
  hipBack:   {x:14, y:26},
  hipFront:  {x:18, y:26},
};
```

### 4.3 파츠 포맷 — `art/parts.js`

```js
export const PARTS = {
  helm_iron: {
    w: 12, h: 8,
    ax: 6, ay: 7,          // 이 파츠의 (ax,ay) 픽셀이 조인트 좌표에 정확히 놓인다
    px: [
      '...oooooo...',      // 각 행 길이 === w, 행 개수 === h
      '..omMMMMmo..',
      // ...
    ],
  },
};
```

문자 팔레트 (`art/palette.js` 참고): `.`투명 `o`외곽선 `s/S`피부 `h/H`머리 `c/C`천 `m/M`금속 `l/L`가죽 `a/A`강조 `w`하이라이트 `e`눈 `g/G`마력광

**앵커 규칙 (파츠 종류별)**
| 파츠 | 앵커 위치 | 조인트 |
|---|---|---|
| `head_*`,`hair_*`,`helm_*` | 하단 중앙(목) | `head` |
| `body_*`(맨몸통), `armor_*` | 상단 중앙 | `chest` |
| `cape_*` | 상단 중앙 | `chest` (몸통 **뒤**에 그려짐) |
| `arm_*` | 상단 중앙(어깨) | `shBack` / `shFront` |
| `leg_*` | 상단 중앙(고관절) | `hipBack` / `hipFront` |
| `wpn_*` | 손잡이 그립점 | `handFront` |
| `shd_*` | 손잡이 중심 | `handBack` |

### 4.4 파츠 어휘 (이 목록 외 이름 금지)

```
body_slim body_normal body_heavy body_hulk
head_human head_goblin head_orc head_skull head_wolf head_lizard head_demon head_elf
hair_none hair_short hair_long hair_pony hair_mohawk hair_bald hair_beard
helm_none helm_iron helm_horned helm_great helm_circlet helm_hood helm_wizard helm_crown helm_plume helm_mask
armor_cloth armor_robe armor_leather armor_mail armor_plate armor_heavy armor_bare armor_bone
cape_none cape_short cape_long cape_tattered cape_wing
arm_slim arm_normal arm_heavy          (좌우 공용, 렌더 시 색만 다름)
leg_cloth leg_leather leg_mail leg_plate leg_bare
wpn_none wpn_sword wpn_greatsword wpn_katana wpn_rapier wpn_dagger wpn_twindagger
wpn_axe wpn_greataxe wpn_mace wpn_hammer wpn_spear wpn_pike wpn_halberd wpn_scythe
wpn_bow wpn_longbow wpn_crossbow wpn_staff wpn_wand wpn_tome wpn_claw wpn_orb
shd_none shd_buckler shd_round shd_kite shd_tower shd_orb shd_torch shd_dagger
```

### 4.5 프레임 & 포즈 — `art/spritegen.js`

```js
export const FRAMES = [
  'idle0','idle1','idle2','idle3',
  'walk0','walk1','walk2','walk3',
  'atk0','atk1','atk2','atk3',      // 근접: 준비-내리침-follow-복귀
  'shoot0','shoot1','shoot2',        // 원거리: 당김-발사-복귀
  'cast0','cast1','cast2',           // 시전
  'guard0','hit0',
  'die0','die1','die2','die3',
];
```

포즈는 조인트별 오프셋 + 무기 회전:
```js
{ dx:0, dy:0,                       // 전체 이동
  head:{dx,dy}, chest:{dx,dy}, shFront:{dx,dy}, shBack:{dx,dy},
  handFront:{dx,dy}, handBack:{dx,dy}, hipFront:{dx,dy}, hipBack:{dx,dy},
  weaponRot:0, offhandRot:0,        // 도(°). 15도 배수만 사용 (도트 깨짐 최소화)
  rot:0, alpha:1 }                  // rot/alpha는 사망 프레임용, 전체에 적용
```

**export**
```js
export function buildSprite(recipe) -> {
  canvas,            // 아틀라스 (프레임 가로 배열)
  flash,             // 동일 크기, 전체 흰색 실루엣 (피격 플래시용)
  w:32, h:40,
  frames: { idle0:{sx,sy}, ... },
}
export function getSprite(recipe) -> 위와 동일 (recipe 키 기준 캐시)
export function spriteKey(recipe) -> string
export const JOINTS, FRAMES, POSES
```
`recipe` = §3.2 `sprite` 형태 + `palette`는 `makePalette()`에 넘길 인자 객체.

### 4.6 그리기 순서

```
cape → arm(back) → leg(back) → leg(front) → body/armor → head → hair → helm
     → offhand(shield) → arm(front) → weapon
```

### 4.7 구현 지침

- 파츠는 **픽셀 행렬 그대로 합성**한다. 회전이 필요한 무기는 행렬을 최근접 이웃으로 회전
  (`rotateMatrix(part, deg)`)시킨 뒤 합성 — 캔버스 회전 금지 (블러/서브픽셀 방지).
- 합성은 `ImageData`(Uint8ClampedArray) 버퍼에 직접 쓰고 마지막에 `putImageData` 1회.
- 결과는 `spriteKey(recipe)` 로 캐시. 같은 레시피는 재생성하지 않는다.

---

## 5. 전투 엔진 — `battle/engine.js`

**순수 JS. DOM/Canvas 참조 금지.** 필드 좌표계는 픽셀이 아니라 논리 단위:

```
필드 = 가로 100 x 세로 60
아군: x = 44 - slot.x * 36   (전열 44 ~ 후열 8)
적군: x = 56 + slot.x * 36   (전열 56 ~ 후열 92)
y   = 8 + slot.y * 44
```

### 5.1 입력

```js
createBattle({
  allies:  [UnitDef], enemies: [UnitDef],
  allyFormationId, enemyFormationId,
  seed,
})

UnitDef {
  uid, name, side:'ally'|'enemy',
  classId|enemyId, level, grade,
  stats:{hp,atk,def,res,spd,crit,critDmg,eva},
  skills:[skillId], basicFx, basicRange, basicDmgType,
  slot:{x,y}, slotIndex,
  recipe,                 // 스프라이트 레시피 (엔진은 안 쓰고 렌더러에 전달만)
  boss:false,
  specials:[{id, label, params}],   // 선택 — 세트 고유 효과(§3.3b·§5.5). 없거나 []면 예전과 동일
  formationMods,                    // 선택 — 스탯 곱연산 보정
}
```

`specials` 는 **아군 전용**이다. `enemyUnitDefs` 에는 절대 싣지 않는다.
문자열 id 만 넘겨도 되고(`normalizeSpecials` 가 정규화), 모르는 id 는 조용히 무시된다.

### 5.2 런타임 유닛

```js
{
  ...UnitDef,
  hp, maxHp, gauge, alive:true,
  x, y,                       // 필드 좌표
  buffs:[{stat,amount,dur,src}], dots:[...], shield:0, stunUntil:0,
  cds:{ skillId: readyAtTime },
  st:{ atk, def, res, spd, crit, critDmg, eva },   // 버프 반영 현재값
  specials:[{id,label,params}],                    // 정규화된 세트 고유 효과 (없으면 [])
  specialState:{ [id]: {…, fired, fired_<hook>} }, // 효과별 런타임 상태 + 발동 계수기
}
```

### 5.3 API

```js
const b = createBattle(cfg);
b.step(dt);          // dt 초. 내부적으로 FIXED=1/60 스텝으로 쪼개 결정론 유지
b.drainEvents();     // 지난 step 동안의 이벤트 배열을 반환하고 큐를 비움
b.units;             // 전체 유닛 (aliveAllies/aliveEnemies 헬퍼도 제공)
b.time;              // 경과 시뮬 시간(초)
b.finished; b.winner;// 'ally'|'enemy'|'draw'
b.result;            // {winner, time, survivors:[uid], damageDealt:{uid:n}, kills:{uid:n}}
simulate(cfg)        // 렌더 없이 끝까지 돌려 result만 반환 (밸런스 테스트용)
```

`TIME_LIMIT = 120` 초. 초과 시 총 HP 비율이 높은 쪽 승리, 동률이면 `draw`.

### 5.4 이벤트 스키마 (렌더러가 소비)

```js
{ t, type:'act',    uid, skillId|null }                 // 행동 개시 (모션 시작)
{ t, type:'lunge',  uid, targetUid }                    // 근접 돌진
{ t, type:'proj',   uid, targetUid, fx, speed }         // 투사체 발사
{ t, type:'damage', uid, targetUid, amount, crit, dmgType, fx, killed }
{ t, type:'heal',   uid, targetUid, amount }
{ t, type:'miss',   uid, targetUid }
{ t, type:'buff',   uid, targetUid, stat, amount, dur }
{ t, type:'status', targetUid, status:'stun'|'shield'|'dot', dur }
{ t, type:'death',  targetUid }
{ t, type:'end',    winner }
```

### 5.5 세트 고유 효과 훅 (`specials`)

`UnitDef.specials` 가 비어 있으면 **관련 경로를 통째로 건너뛴다**(`hasSpecials`) — 비용 0, 하위 호환.
훅은 전부 `applySpecial(unit, hook, ctx)` 하나로 들어오고, 표는 `SPECIAL_HOOKS[id]` 다.

| hook | 시점 | ctx |
|---|---|---|
| `battleStart` | 전투 시작 직후 (t=0) | `{}` |
| `act` | 행동을 개시할 때 | `{skill, targets}` |
| `dealDamage` | 피해를 준 직후 (가해자) | `{target, amount, total, crit, dmgType, skill, killed, fromDot}` |
| `takeDamage` | 피해를 받은 직후 (피격자) | `{srcUid, amount, total, crit, dmgType, killed}` |
| `shieldBreak` | 방어막이 **피해로** 0 이 된 순간 | `{srcUid, amount}` |
| `lethal` | 전투 불능이 될 피해를 받기 직전 ★ | `{srcUid, amount, total, dmgType, after:[]}` |
| `kill` | 적을 처치한 직후 (가해자) | `{target, skill}` |
| `tick` | 매 시뮬 스텝 | `{dt}` (항상 `FIXED`) |

- ★ `lethal` 이 `true` 를 돌려주면 **죽지 않는다**(부활). 연출을 damage 이벤트 뒤로 미루려면
  `ctx.after` 에 함수를 넣는다 — damage 이벤트를 큐에 넣은 직후 순서대로 실행된다.
- `applyDamage(..., {fromSpecial:true})` 로 만들어진 피해는 `dealDamage` 훅을 **다시 태우지 않는다**
  (추가 타격의 무한 연쇄 방지). `{fromDot:true}` 는 지속 피해 표시다 (`lifestealDot:false` 계약).
- 훅 함수는 발동했으면 `true` 를 돌려준다. 그때 `specialState[id].fired` 계수기가 1 오른다
  (검증 도구가 "정말 발동했는가"를 세는 근거 — 결정론에는 영향이 없다).
- **반드시 결정론적이어야 한다.** 난수가 필요하면 전투 `rng` 만, 시간은 `B.time` 만 본다.
  대상 선택은 결정적 규칙 + `idx` 오름차순 tie-break (`spSelect`).
- 이벤트는 §5.4 스키마를 재사용한다. **새 이벤트 타입을 만들지 마라.**

export 추가: `SPECIAL_IDS`(엔진이 구현한 id 목록 — `sets.js SET_SPECIAL_IDS` 와 1:1),
`normalizeSpecials(list)`. `b.applySpecial(unit, hook, ctx)` 도 테스트용으로 노출된다.

검증: `node tools/setspecial.mjs` (어휘 일치 · 세 경로 배선 · 훅 단위 · ON/OFF · 개별 기여도 · 결정론)

---

## 6. 렌더러 — `battle/renderer.js`

```js
const r = createRenderer(canvas);
r.setBattle(battle);
r.update(dtReal);   // 애니메이션 상태/파티클 갱신 + battle.drainEvents() 소비
r.draw();
r.speed = 1|2|4;
r.isSettled();      // 승패 + 마무리 연출까지 끝났는가 (UI가 진행 버튼을 띄울 시점)
r.skipEnding();     // UI가 자기 오버레이를 띄운다 — 캔버스 승패 글자를 걷어낸다
r.setShakeScale();  // 하위 호환용 빈 함수. 흔들림 연출은 존재하지 않는다
```

**화면 전체를 움직이는 연출은 금지다.** 흔들림·줌 펀치·카메라 이동/회전 전부 넣지 마라
(플레이어가 눈이 아프다고 해서 걷어냈다). 타격감은 전부 **국소** 연출로 낸다.
카메라 변환은 항상 `setTransform(dpr,0,0,dpr,0,0)` 고정이어야 한다 — 회귀 검사는
"배경 오프스크린 캔버스를 그릴 때의 변환행렬 + 대상 사각형이 매 프레임 동일한가"로 한다.

요구 연출:
- 좌: 아군(원본 방향), 우: 적군(좌우 반전). 배경은 biome별 그라디언트 + 지면 + 원경 실루엣.
- 행동 게이지 바, HP 바, 이름/레벨/등급 색, 보스 표시.
- 근접 공격: 돌진 → 타격(히트스톱 45ms · 치명타 110ms) → 복귀.
- 피격(맞는 유닛에만): 실루엣 플래시 2프레임(치명타는 노란색 4프레임) + 스케일 펀치 +
  스프링 넉백 + 충격파 링 + 데미지 숫자 펀치.
- 화면 단위 피드백은 **가장자리 비네트 색 펄스**만 허용한다 (색만 변하고 위치는 그대로).
- 투사체: 화살/마법탄이 실제로 날아가고 명중 시 파티클 폭발.
- 사망: die 프레임 재생 후 페이드아웃.
- 하단 전투 로그 (최근 6줄), 좌상단 속도 버튼(1x/2x/4x).

`art/fx.js` 는 파티클 시스템(`spawn(type, x, y, opts)`, `update(dt)`, `draw(ctx)`)과
fx 종류별 색/모양 프리셋을 담당한다. 여기서 만드는 이펙트는 전부 타격 지점 주변에서만
일어나야 한다 — 화면 전체를 덮거나 미는 이펙트를 추가하지 마라.

---

## 7. UI 화면 (`ui/`)

| 화면 | 내용 |
|---|---|
| `ui/app.js` | 라우팅, 상단 HUD(골드/날짜/명성/현재도시), 저장/불러오기 |
| `ui/worldmap.js` | 도시 노드 + 경로. 이동 시 일수 소모, 이동 중 랜덤 이벤트 |
| `ui/city.js` | 도시 허브: 주점/상점/의뢰소/대장간/휴식 |
| `ui/tavern.js` | 클래스 지정 고용 → 등급 랜덤. 등급 확률표 표기, 고용 연출 |
| `ui/company.js` | 부대 편성(7슬롯 드래그), 진형 선택/미리보기, 용병 상세/전직 |
| `ui/inventory.js` | 장비 목록/필터/장착/판매/비교 툴팁 |
| `ui/quests.js` | 의뢰 목록 → 부대 선택 → 출정 |
| `ui/battle.js` | 전투 화면 컨테이너 + 결과 정산(경험치/전리품/전직 알림) |
| `ui/dungeon.js` | 던전 화면 — 주차 개방 표시, 웨이브 진행도, 세트 수집 현황, 드랍 구간 안내 |

**전투 화면은 저절로 넘어가지 않는다.** 웨이브가 끝나면 전장을 그대로 둔 채 진행 오버레이만
띄우고, 다음 웨이브·결과 화면으로 가는 것은 **오직 클릭 / Enter / Space** 뿐이다.
결과 화면도 마찬가지로 버튼을 눌러야 닫힌다. 타이머로 화면을 넘기는 코드를 넣지 마라
(`sinceFinish > 5` 는 렌더러가 영영 안 끝날 때 **버튼을 대신 띄우는** 안전장치일 뿐,
화면을 넘기지 않는다).

---

## 8. 게임 루프 요약

```
도시 도착 → (평판 10 미만이면 주점이 닫혀 있다 → 의뢰부터) → 주점에서 용병 고용
        → 부대 편성 + 진형 지정 + 장비 장착
        → 의뢰 수주 → 자동 전투 → 보상(골드/경험치/장비/★도시 평판) → 레벨업/전직
        → 일수 경과(임금 지출) → 다음 도시로 이동 → 반복
```

- **도시 평판**: 의뢰 성공/실패로만 움직인다. 평판이 오르면 그 도시 주점의 실효 등급이 올라간다
  (평판 100 = +1.5 티어). 낯선 도시는 평판 0 이라 주점이 잠겨 있고, F랭크 5건이면 열린다(실측).
- **도시 특화**: 도시마다 1차 클래스 1~2종이 유독 잘 나온다. 특화 클래스는 S·A 확률이 크게 뛰어서
  **저티어 특화 도시가 고티어 일반 도시보다 좋은 등급을 뽑는다** — 부대가 커져도 지도를 도는 이유다.
- **부대/정원 확장**: 부대는 골드로 산다(최대 5). 단원 정원도 골드로 넓힌다(20 → 40).
  둘 다 체증 비용이라 확장할 때마다 의뢰를 더 돌아야 한다.

- **임금**: 매일 `sum(용병.upkeep)` 골드 지출. 파산 시 사기 하락/이탈.
- **부상**: 사망은 없음(v1). 전투 중 HP 0 은 **전투불능(다운)**일 뿐이고 부상은 예외적으로만 발생한다.
  - 의뢰 **성공**: 다운돼도 부상 없음. `status:'ready'`, HP = maxHp의 25%.
  - 의뢰 **실패**: 다운된 용병만 랭크별 확률(F·E 0.20 / D·C 0.35 / B·A·S 0.50)로
    `status:'wounded'`, `woundUntil = day + 2~4`. 부상이 아니면 `ready` + HP = maxHp의 15%.
  - 전투 후 HP 하한은 **maxHp의 15%**. 절대 1로 떨어뜨리지 않는다
    (HP 1로 복귀시키면 다음 전투에서 즉사해 부상 나선이 반복된다).
- **출전**: 부상자는 출전을 막지 않고 **자동 벤치**된다. 건강한 인원이 1명이라도 있으면 출전 가능하며,
  전열이 통째로 비었을 때만 남은 인원을 전열부터 다시 채운다. 전원 부상일 때만 출전 불가다.
- **회복**: 하루 자연 회복 = ready 30% / wounded 20% (maxHp 비율).
  여관 휴식은 1일당 maxHp 45% 추가 회복 + 부상 잔여 기간 1일 추가 단축.
- **의뢰/주점/상점 갱신**: 도시별로 3일마다 목록 리롤.
