/**
 * «보여주기용» 스프라이트 창구 — 정면이 되면 정면, 아니면 옆모습
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 창구가 따로 있나
 *   단원 탭·주점은 **정면**으로 보여주고 전투는 **옆모습**이다 (플레이어 요청).
 *   그런데 정면 파츠는 한 번에 다 그려지지 않고 계열별로 채워진다.
 *   부르는 쪽이 매번 «이 레시피는 정면이 되나» 를 묻게 하면 그 판단이 여러 곳에 흩어진다.
 *   여기 한 곳에서 고르고, 부르는 쪽은 결과만 쓴다.
 *
 * ★★ 정면 파츠가 없으면 **옆모습으로 물러난다.** 빠진 채 정면으로 그리면
 *   머리 없는 몸통이 나온다 — 없는 것보다 나쁘다 (`portrait.canDraw`).
 *
 * ★ 두 경로가 **같은 모양**을 돌려준다: { sprite, draw, frames, front }.
 *   그래서 부르는 쪽 코드가 갈라지지 않는다.
 *
 * @module art/showcase
 */

import { getSprite, drawSpriteFrame } from './spritegen.js';
import { getPortrait, drawPortraitFrame, canDraw, FRAMES as FRONT_FRAMES } from './portrait.js';

/** 옆모습에서 «세워 놓고 보는» 데 쓰는 프레임 (숨쉬기) */
const SIDE_IDLE = ['idle0', 'idle1', 'idle2', 'idle3'];

/**
 * @param {object} recipe mercRecipe() 결과
 * @param {{front?: boolean}} [opts] front=false 면 무조건 옆모습 (전투용)
 * @returns {{sprite:object, draw:Function, frames:string[], front:boolean}|null}
 */
export function getShowcase(recipe = {}, opts = {}) {
  const wantFront = opts.front !== false;
  if (wantFront && canDraw(recipe)) {
    try {
      return { sprite: getPortrait(recipe), draw: drawPortraitFrame, frames: FRONT_FRAMES, front: true };
    } catch (e) {
      console.warn('[showcase] 정면 생성 실패 — 옆모습으로 물러난다', e);
    }
  }
  try {
    return { sprite: getSprite(recipe), draw: drawSpriteFrame, frames: SIDE_IDLE, front: false };
  } catch (e) {
    console.warn('[showcase] 스프라이트 생성 실패', e);
    return null;
  }
}

/**
 * 한 프레임을 캔버스에 그린다. (x, y) 는 **발 밑 중앙**.
 * `scale` 은 논리 픽셀(32×40 기준) 하나가 화면에서 몇 px 인가 — 양쪽 경로에서 같은 뜻이다.
 */
export function drawShowcase(ctx, show, frame, x, y, opts = {}) {
  if (!show) return;
  show.draw(ctx, show.sprite, frame, x, y, opts);
}
