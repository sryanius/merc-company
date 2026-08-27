/**
 * 주점 목록 생성 — **서버가 「이 후보가 실제로 그 주점에 있었나」 를 물을 수 있게**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 `state.js` 에서 떼어냈나 (§120)
 *
 *   고용을 서버가 검증하려면 서버가 주점 목록을 **다시 만들 수 있어야** 한다.
 *   §119 로 목록이 (판·도시·날) 로 재현되게 만들었지만, 생성기가 `state.js` 안에
 *   있어서 서버 묶음으로 못 가져왔다 — `state.js` 는 게임 전체를 문다.
 *
 *   실측: `quest.js` 를 물면 닫힘이 **17개 494KB → 26개 813KB** 가 되고
 *   `state.js` 가 딸려 온다. §108 이 끊어 놓은 것이 통째로 무너진다.
 *
 * ★ 그래서 셋을 했다:
 *   ① 도시 배율 상수(`cityPowerOf`·`CITY_REWARD_POW`)를 `data/limits.js` 로 (의존성 0)
 *   ② 이 함수를 여기로
 *   ③ `city` 는 **인자로 받는다** — `data/world.js` 조차 안 물어도 된다
 *   ⇒ 서버 묶음 닫힘이 **파일 하나만** 늘어난다.
 *
 * ★ `state.js` 는 이 파일을 쓴다. 생성기가 두 벌이 되면 서버와 클라가 다른 목록을
 *   만들고, 그러면 정상 고용이 «그 주점에 없던 사람» 으로 거절된다.
 *
 * @module game/tavern
 */
import { clamp } from '../core/util.js';
import { BASE_CLASSES } from '../data/classes.js';
import { cityPowerOf, CITY_REWARD_POW } from '../data/limits.js';
import { hireCost } from './merc.js';

/**
 * 그 도시·그 날의 주점 후보 목록.
 *
 * ★ `r` 은 **자리마다 정해진 시드**여야 한다 (§119). 전역 rng 를 넘기면
 *   목록이 «그때까지 난수를 몇 번 썼나» 에 의존해 서버가 재현하지 못한다.
 *
 * @param {{tier:number, specialty?:string[]}} city
 * @param {{int:Function, float:Function, pickMany:Function}} r
 * @returns {{classId:string, cost:number}[]}
 */
export function genTavern(city, r) {
  const tier = clamp(city.tier || 1, 1, 5);
  const count = clamp(3 + r.int(0, 2) + (tier >= 4 ? 1 : 0), 3, 6);

  /* ★ 그 도시의 특화 클래스는 **항상** 목록에 넣는다.
   * 예전에는 전체 1차 클래스에서 무작위로만 뽑아서, S 등급이 특화 도시에서만 나오는데
   * 정작 그 도시에 특화 클래스가 안 뜨는 날이 많았다. 특화 도시를 찾아간 이유가 사라진다.
   * 나머지 자리는 예전대로 무작위로 채운다. */
  const base = Array.isArray(BASE_CLASSES) ? BASE_CLASSES : [];
  const spec = (Array.isArray(city.specialty) ? city.specialty : []).filter((c) => base.includes(c));
  const rest = r.pickMany(base.filter((c) => !spec.includes(c)), Math.max(0, count - spec.length));
  const classes = [...spec, ...rest];

  /* ★★ 고용가 배율은 **의뢰 보상과 같은 기울기**를 쓴다 (cityPower ** CITY_REWARD_POW).
   *
   *   예전엔 `1 + 0.2 * (tier - 1)` 이라 5등급에서 1.80배였는데, 같은 도시의 의뢰 보상은
   *   `cityPower ** 2` 라 3.61배였다. 수입은 제곱으로 오르고 지출은 선형이니 위로 갈수록
   *   벌어진다 — 실측(tools/tavernecon.mjs)으로 의뢰 한 건에 살 수 있는 뽑기가
   *   **1등급 1.1장 → 5등급 100.3장** 이었다. 5등급에서 목록을 통째로 사도 수입의 5% 다.
   *
   *   같은 지수를 쓰면 «도시를 올라가도 뽑기의 상대 가격은 그대로» 가 된다.
   *   1등급은 그대로(1.00), 2등급은 +16% 뿐이라 초반은 거의 안 건드린다.
   *
   * ★ 값은 여전히 **C등급 기준**이고 등급은 살 때 추첨한다 — 도박은 도박으로 남긴다
   *   (제작자 결정). 등급을 미리 보여 주거나 등급값으로 받는 안은 채택하지 않았다. */
  const cityMult = cityPowerOf(tier) ** CITY_REWARD_POW;
  return classes.map((classId) => {
    let base = 0;
    try { base = hireCost(classId, 'C', 1) || 0; } catch { base = 0; }
    if (!base) base = 260;
    const cost = Math.round(base * cityMult * r.float(0.88, 1.18) / 5) * 5;
    return { classId, cost };
  });
}
