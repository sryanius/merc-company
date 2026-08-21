/**
 * 정면 파츠 — 단원 탭·주점 초상용
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 이름은 **옆모습 파츠와 같다** (`head_human`, `armor_plate` …).
 *   레시피를 그대로 쓰고 여기서 정면 그림만 갈아 끼운다.
 *
 * ★★ 없는 파츠는 **그리지 않는다.** 옆모습 것으로 대신 채우면 정면 조인트에 옆얼굴이 얹혀
 *   기괴해진다 — 빈 자리가 «아직 안 그렸다» 로 읽혀서 낫다 (`portrait.canDraw`).
 *
 * ★ 좌표 규약 (96×120, SCALE=3)
 *     head_* / hair_* / helm_*  : 앵커 = **하단 중앙(목)**   → head    (48, 44)
 *     body_* / armor_* / cape_* : 앵커 = **상단 중앙**       → chest   (48, 44)
 *     arm_*                     : 앵커 = **상단 안쪽 모서리(어깨)** → shLeft(38,48) / shRight(58,48)
 *     leg_*                     : 앵커 = **상단 중앙(고관절)** → hipLeft(42,75) / hipRight(54,75)
 *     wpn_* / shd_*             : 앵커 = **손잡이 그립점**   → handRight(62,80) / handLeft(34,80)
 *   발바닥 y=114, 가로 중심 x=48.
 *
 * ★ **왼쪽 파츠는 앵커를 축으로 좌우가 뒤집혀** 그려진다 (`pixel.js` 의 flipX).
 *   즉 팔·다리는 **오른쪽(빛 받는 쪽) 기준 한 짝만** 그리면 된다.
 *
 * ★ `scale` 은 이 그림이 몇 배로 그려졌는지다 (3 = 96×120 기준). 빼먹으면 또 늘어난다.
 *
 * @module art/parts_front
 */

/** @type {Record<string, {w:number,h:number,ax:number,ay:number,px:string[],scale:number}>} */
export const FRONT_PARTS = {
  arm_normal: {
    w: 9, h: 36, ax: 0, ay: 0, scale: 3,
    px: [
      '.ooooooo.',
      'oMMmmnnno',
      'oMMmwnnno',
      'oMMmmnnno',
      'oaaaaaaao',
      'oAAAAAAAo',
      '.oCCcccvo',
      '.oCCcccvo',
      '.oCCCCCCo',
      '.oCCcccvo',
      '.oCCcccvo',
      '.oCCcccvo',
      '.oCCCCCCo',
      '.oaaaaaao',
      '.oAAAAAAo',
      '.oMMmmnno',
      '.oMMmwnno',
      '.oMMmmnno',
      '.oMMMMMMo',
      '.oMMmmnno',
      '.oMMmmnno',
      '.oMMmwnno',
      '.oMMMMMMo',
      '.oaaaaaao',
      '..oLLlkko',
      '..oLLlkko',
      '..oLLLLLo',
      '..oLLlkko',
      '..oLLlkko',
      '..oaaaaao',
      '.oAAAAAAo',
      '.oLLllkko',
      '.oLLllkko',
      '.oLLkkLko',
      '.oLLllkko',
      '..ooooo..',
    ],
  },
  armor_plate: {
    w: 23, h: 36, ax: 11, ay: 0, scale: 3,
    px: [
      '.......oAaaaaaAo.......',
      '.....oAaMMmnnnnaAo.....',
      '...oAaMMMmmmnnnnnaAo...',
      '.oAaMMdMMmmmnnnnndnaAo.',
      '.oAaMmdMMmmmnnnnndnaAo.',
      '.oAaaaAdMmmmnnndAaaaAo.',
      '.oAAAAAdMMmmnnndAAAAAo.',
      '..oAaMMMmmmnnnnnnMaAo..',
      '..oAaMMMmmmmnnnnnMaAo..',
      '...oAaMMmmmnnnnnwaAo...',
      '...oAaMMmmmnnnnnnaAo...',
      '....oAaMAaaaaaAnaAo....',
      '....oAaMAagfgaAnaAo....',
      '....oAaMAaGgGaAnaAo....',
      '....oAaMAAaGaAAnaAo....',
      '....oAaMMAAAAAnnaAo....',
      '....oAaMMmmmnnnnaAo....',
      '.....oAaMMmnnnnaAo.....',
      '.....oAaMMmnnnnaAo.....',
      '.....oaaaaaaaaaaao.....',
      '....oLLLlllkkkkkkko....',
      '....oLLllAabaAkkkko....',
      '....oLLLllAAAkkkkko....',
      '...oaaaaaaaaaaaaaaao...',
      '..oLLLllllldkkkkkkkko..',
      '..oLLLalllldkkkkakkko..',
      '.oLLLLllllldkkkkkkkkko.',
      '.oaaaaaaaaaAaaaaaaaaao.',
      '.oAAAAAAAAAAAAAAAAAAAo.',
      '.oLLLLllllldkkkkkkkkko.',
      '..oLLLllllldkkkkkkkko..',
      '..oLLLalllldkkkkakkko..',
      '..oLLLllllldkkkkkkkko..',
      '...oaaaaaaaAaaaaaaao...',
      '...oAAAAAAAAAAAAAAAo...',
      '...ooooooooooooooooo...',
    ],
  },
  body_normal: {
    w: 21, h: 34, ax: 10, ay: 0, scale: 3,
    px: [
      '......oSSsssxxo......',
      '......oSSsssxxo......',
      '.....oCCCSssvvvo.....',
      '...oCCCCSssxxvvvvo...',
      '.oCCCCCcSssxxvvvvvvo.',
      '.oCCCCCcSssxxvvvvvvo.',
      '.oCCCCCCcccccvvvvvvo.',
      '..oCCCCCcccccvvvvvo..',
      '..oCCCCCCCCCCCCCCCo..',
      '...oCCCCccccvvvvvo...',
      '...oCCCCccccvvvvvo...',
      '...oCCCCCCCCCCCCCo...',
      '....oCCCcccvvvvvo....',
      '....oCCCcccvvvvvo....',
      '.....oCCCcccvvvo.....',
      '.....oCCCcccvvvo.....',
      '.....oCCCCCCCCCo.....',
      '.....oCCCcccvvvo.....',
      '.....oCCCcccvvvo.....',
      '.....oCCCcccvvvo.....',
      '....oCCCcccvvvvvo....',
      '....oCCCcccvvvvvo....',
      '....oCCCCCCCCCCCo....',
      '...oCCCCccccvvvvvo...',
      '...oCCCCccccvvvvvo...',
      '...oCCCCccccvvvvvo...',
      '...oCCCCCCCCCCCCCo...',
      '...oCCCCccccvvvvvo...',
      '...oCCCCccccvvvvvo...',
      '....oCCCcccvvvvvo....',
      '....oCCCcccvvvvvo....',
      '....oCCCcccvvvvvo....',
      '.....oCCCcccvvvo.....',
      '.....ooooooooooo.....',
    ],
  },
  hair_short: {
    w: 27, h: 23, ax: 13, ay: 32, scale: 3,
    px: [
      '.........ooooooooo.........',
      '.......oHHHhhhyyyyyo.......',
      '.....oHHHHhhhhyyyyyyyo.....',
      '....oHHHHhhhhdyyyyyyyyo....',
      '...oHHHHhhhdhhyyyyyyyyyo...',
      '...oHHHdHhhdhhyyyydyyyyo...',
      '..oHHHdHhhdhhhyyyydyyyyyo..',
      '..oHHdHHhhdhhhyyydyyyyyyo..',
      '..oHHdHHhhdhhhyyydyyyyyyo..',
      '..oHHdHhhhdhhhyyydyyyyyyo..',
      '..oHHdHhhdhhhyydyyyydyyyo..',
      '..oHdHhhdhhhyydyyyydyyyyo..',
      '..oHHhho..ohhyyyo..oyyyyo..',
      '..oHHho.............oyyyo..',
      '..oHHho.............oyyyo..',
      '..oHHho.............oyyyo..',
      '...oHho.............oyyo...',
      '...oHho.............oyyo...',
      '...oHho.............oyyo...',
      '...oHo...............oyo...',
      '...oHo...............oyo...',
      '...oHo...............oyo...',
      '...ooo...............ooo...',
    ],
  },
  head_human: {
    w: 23, h: 30, ax: 11, ay: 29, scale: 3,
    px: [
      '.......ooooooooo.......',
      '.....oSSSsssxxxxxo.....',
      '....oSSSsssssxxxxxo....',
      '...oSSSsssssxxxxxxxo...',
      '..oSSSssssssxxxxxxxxo..',
      '..oSSSssssssxxxxxxxxo..',
      '..oSSSssssssxxxxxxxxo..',
      '..oSSSssssssxxxxxxxxo..',
      '..oSSSssssssxxxxxxxxo..',
      '..oSSSssssssxxxxxxxxo..',
      '..oSHHHHHsssxxHHHHHxo..',
      '..oSSSssssssxxxxxxxxo..',
      '..oSSSssssssxxxxxxxxo..',
      '..oSooooosssxxoooooxo..',
      '..oSoweeqsssxxqeewoxo..',
      '..oSoeEeqsssxxqeEeoxo..',
      '..oSoeEEqsssxxqEEeoxo..',
      '..oSSoooosssxxooooxxo..',
      '...oSSSsssssxxxxxxxo...',
      '...oSSSssssdxxxxxxxo...',
      '....oSSSsssssxxxxxo....',
      '.....oSSSsdodxxxxo.....',
      '......oSSsssxxxxo......',
      '........oSSsxxo........',
      '........ooooooo........',
      '........oddSSSo........',
      '........odSSSso........',
      '........odSSsso........',
      '........odSSsso........',
      '........ooooooo........',
    ],
  },
  leg_plate: {
    w: 9, h: 40, ax: 5, ay: 0, scale: 3,
    px: [
      'ooooooooo',
      'oCCcccvvo',
      'oCCcccvvo',
      'oCCcccvvo',
      'oCCCCCCCo',
      'oCCcccvvo',
      'oCCcccvvo',
      'oCCcccvvo',
      'oaaaaaaao',
      'oAAAAAAAo',
      'oMMmmmnno',
      'oMMmwmnno',
      'oMMmmmnno',
      'oMMMMMMMo',
      '.oMMmnno.',
      '.oMMmnno.',
      '.oMMwnno.',
      '.oMMMMMo.',
      '.oMMmnno.',
      '.oaaaaao.',
      'oaaaaaaao',
      'oMMMmwnno',
      'oAAAAAAAo',
      '.oLLlkko.',
      '.oLLlkko.',
      '.oLLLLLo.',
      '.oLLlkko.',
      '.oLLlkko.',
      '.oLLlkko.',
      '.oaaaaao.',
      '.oLLlkko.',
      '.oLLlkko.',
      '.oaaaaao.',
      '.oAAAAAo.',
      'oLLLllkko',
      'oLLLllkko',
      'oLLLllkko',
      'oLLLLLLLo',
      'oLLLllkko',
      'ooooooooo',
    ],
  },
};

/** 이 슬롯이 채워졌나. 비어도 되는 슬롯(투구 없음 등)은 언제나 참이다. */
export function hasFrontPart(name) {
  if (!name || name === 'none' || String(name).endsWith('_none')) return true;
  return !!FRONT_PARTS[name];
}

export function getFrontPart(name) {
  if (!name || name === 'none' || String(name).endsWith('_none')) return null;
  return FRONT_PARTS[name] || null;
}

/** 얼마나 그렸나 (도구가 진행률을 찍는다) */
export const frontPartCount = () => Object.keys(FRONT_PARTS).length;
