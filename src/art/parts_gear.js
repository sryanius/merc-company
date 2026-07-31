// 장비 도트 파츠: 투구 / 망토 / 무기 / 방패. (SPEC §4.3~4.4)
// 순수 데이터 모듈 — document/window 를 건드리지 않는다.
//
// 앵커 규칙
//   helm_* : 하단 중앙(목) = JOINTS.head      -> ax = w/2, ay = h-1
//   cape_* : 상단 중앙      = JOINTS.chest     -> ax = 어깨 부착점, ay = 0 (몸통 뒤에 그려짐)
//   wpn_*  : 손잡이 그립점  = JOINTS.handFront (회전축이기도 하다)
//   shd_*  : 손잡이 중심    = JOINTS.handBack
//
// 무기는 전부 "세워 든 상태"(칼끝이 위 = y가 작은 쪽)로 그린다. 회전 0도가 기본 자세다.
// 문자: '.'투명 'o'외곽선 'm/M'금속 'l/L'가죽 'c/C'천 'a/A'강조 'w'하이라이트 'e'눈 'g/G'마력광
//
// ── 방향 가독성 규약 (가장 중요) ──────────────────────────────────────────
// 캐릭터는 오른쪽(+x)을 본다. 머리 조인트는 (16,14)다. 어느 머리 파츠든
//   * 눈(e)   은 y=7, x17~x18
//   * 얼굴 앞면(뺨·턱·목 앞) 은 y8~y14 의 x17 이상
// 에 놓이도록 그려져 있다. 그리기 순서가 머리 → 헤어 → 투구이므로 **투구가 이 자리를
// 덮으면 그대로 뒷모습이 된다.**
//
// 그래서 이 파일의 모든 helm_* 은 아래 한 가지 규칙을 지킨다.
//
//   ┌ y3~y6 : 정수리·이마는 통째로 덮는다. 앞쪽(x20~x21)으로 **이마 챙**이 1px 튀어나온다.
//   └ y7~y14: **x17 이상은 절대 덮지 않는다.** 뒤통수·귀·목덜미(x10~x16)만 덮는다.
//
// 즉 투구는 "뒤통수를 덮고 앞은 트인" 비대칭 실루엣이 되고, 그 트인 틈으로 눈과 옆뺨이
// 그대로 비친다. 통짜 투구(great/horned/mask)는 앞쪽 x19~x21 에 코·부리 가리개를
// 따로 띄워 붙여 얼굴 틈(x17~x18)을 사이에 둔 바이저 슬릿을 만든다.
//
// 망토는 어깨에서 **뒤(왼쪽)로 쏠리게** 그려 몸통에 가리지 않고 밖으로 삐져나오게 한다.
// 방패는 손잡이가 handBack 이지만 spritegen 의 SHIELD_OFFSET(+8) 로 몸 앞쪽에 놓인다.
// 방패면이 앞을 향해 보이도록 **뒤(x 작은 쪽)에 그림자 M/C, 앞(x 큰 쪽)에 하이라이트 w**,
// 가운데에 문양(a/A)을 넣는다. 세로 길이는 머리(y14 위)를 침범하지 않게 잡는다.
//
// 명암은 3단계다: 그림자(M/C/L/A) - 기본(m/c/l/a) - 하이라이트(w).
// 금속은 w를 넉넉히(모서리 한 줄), 천은 1~2px만 찍는다.

export const GEAR_PARTS = {
  // ── 투구 ──────────────────────────────────────────────────────────────────
  // 머리 파츠는 전부 x14~x21 폭의 좁은 옆얼굴이다. 투구는 그 뒤통수(x13~x16)만 물고
  // 앞(x17~)은 통째로 비운다. 챙만 x21~x22 까지 앞으로 튀어나온다.
  /** 철투구: 돔 + 이마 챙 + 귀를 덮는 뺨가리개. y7 부터 앞이 트여 눈·뺨·턱이 드러나고,
   *  뒤쪽 x11~x12 도 비워 뒷머리 한 줌이 투구 밖으로 삐져나온다. */
  helm_iron: {
    w: 13, h: 12, ax: 6, ay: 11,
    px: [
      '....ooooooo..',  // y3  정수리
      '....ommwwmmo.',  // y4
      '...ommmmmmmo.',  // y5
      '...oMmmmmmmwo',  // y6  이마 챙 — 얼굴보다 1px 앞(x22)까지
      '...oMmo......',  // y7  ← x17 부터 트임. 눈이 여기로 보인다
      '...oMmo......',  // y8
      '...oMwo......',  // y9
      '....oMo......',  // y10 뺨가리개가 좁아지며
      '....oMo......',  // y11 귀 뒤에서 끝난다
      '.............',
      '.............',
      '.............',
    ],
  },

  /** 뿔투구: 앞뿔(x21~x23)이 뒤뿔(x10~x12)보다 훨씬 크고 앞으로 뻗는다 —
   *  뿔의 좌우 비대칭 자체가 방향 신호다. 얼굴 앞면은 전부 트여 있다. */
  helm_horned: {
    w: 16, h: 13, ax: 8, ay: 12,
    px: [
      '.............aa.',  // y2  앞뿔 끝
      '...a..oooooooaAo',  // y3  뒤뿔 끝(x11) / 앞뿔
      '..oAo.ommwwmmoaA',  // y4
      '....AommmmmmmoAo',  // y5
      '.....ommmmmmmmwo',  // y6  이마 챙
      '....oMMmo.......',  // y7  ← 앞이 트임
      '....oMMmo.......',  // y8
      '....oMMwo.......',  // y9
      '....oMMmo.......',  // y10
      '.....oMmo.......',  // y11
      '.....oMmo.......',  // y12 목덜미
      '......oMo.......',  // y13
      '......ooo.......',  // y14
    ],
  },

  /** 대형 투구: 목까지 내려오는 통짜 투구. 앞쪽 x19~x22 에 부리 모양 코가리개를
   *  띄워 붙였다. 그 사이(x17~x18)가 세로 바이저 슬릿이 되어 눈과 뺨이 비친다. */
  helm_great: {
    w: 13, h: 13, ax: 6, ay: 12,
    px: [
      '.....ooooo...',  // y2  머리보다 한 칸 높은 돔
      '....ommwwmo..',  // y3
      '....ommmmmmo.',  // y4
      '...ommmmmmmo.',  // y5
      '...oMmmmmmmwo',  // y6  이마 챙
      '..oMMmo..omMo',  // y7  ← x17~x18 슬릿 / 앞은 부리
      '..oMMmo..oMMo',  // y8
      '..oMMmo..oMMo',  // y9
      '..oMMmo..ooo.',  // y10 부리 끝
      '..oMMmo......',  // y11
      '...oMmo......',  // y12
      '...oMwo......',  // y13 목덜미
      '...oooo......',  // y14
    ],
  },

  /** 서클릿: 이마를 두르는 가는 띠 + 앞쪽 보석. 띠가 뒤(x13~x16)로만 한 단 더
   *  내려가 뒤통수를 물고, 앞은 눈 위에서 끊긴다. */
  helm_circlet: {
    w: 13, h: 12, ax: 6, ay: 11,
    px: [
      '.............',
      '..........ag.',  // y4  앞 보석이 이마 위로 솟는다
      '...ooooooooGo',  // y5
      '...oaaaaaaawo',  // y6  띠
      '...oAAo......',  // y7  뒤테 — x17 앞은 비운다
      '.............',
      '.............',
      '.............',
      '.............',
      '.............',
      '.............',
      '.............',
    ],
  },

  /** 후드: 천이 뒤통수·목덜미를 덮고 앞(x17~)이 통째로 트여 옆얼굴이 드러난다.
   *  트인 가장자리를 x16 에 세로로 딱 맞춰 얼굴선이 곧게 선다. */
  helm_hood: {
    w: 13, h: 12, ax: 6, ay: 11,
    px: [
      '....ooooooo..',  // y3
      '...occwwccco.',  // y4
      '..occcccccco.',  // y5
      '..oCcccccccco',  // y6  이마까지 덮는다
      '..oCcco......',  // y7  ← 후드 앞단. 여기부터 얼굴
      '..oCcco......',  // y8
      '..oCCco......',  // y9
      '..oCcco......',  // y10
      '..oCCco......',  // y11
      '...oCco......',  // y12
      '...oCCo......',  // y13
      '...oooo......',  // y14 어깨로 떨어진다
    ],
  },

  /** 마법사 고깔모자: 앞으로 살짝 기운 고깔 + 챙. 챙은 y6(눈 위)에서만 앞으로 뻗고
   *  뒤로는 어깨까지 늘어져 뒤통수를 덮는다 — 이 비대칭이 방향 신호다. */
  helm_wizard: {
    w: 18, h: 15, ax: 10, ay: 14,
    px: [
      '..........oo......',  // y0
      '.........occo.....',  // y1
      '.........oCco.....',  // y2
      '........oCccco....',  // y3
      '........oCccco....',  // y4
      '.......oCcgGcco...',  // y5  마력석
      '.....ooCcccccccwo.',  // y6  챙 — 앞은 여기서 끝(눈 위)
      '......oCCCo.......',  // y7  ← x17 부터 트임
      '......oCcCo.......',  // y8  뒤로 늘어진 자락
      '......oCcCo.......',  // y9
      '......oCcCo.......',  // y10
      '.......oCCo.......',  // y11
      '.......oCCo.......',  // y12
      '.......oCCo.......',  // y13
      '.......oooo.......',  // y14
    ],
  },

  /** 왕관: 앞 첨두가 가장 높고 뒤로 갈수록 낮아진다. 띠가 뒤쪽(x13~x16)으로만
   *  두 단 더 내려와 뒤통수를 물기 때문에 앞얼굴만 남아 방향이 읽힌다. */
  helm_crown: {
    w: 13, h: 12, ax: 6, ay: 11,
    px: [
      '..........a..',  // y3  앞 첨두
      '....a..a..ag.',  // y4  첨두 셋 + 보석
      '...oaooaooawo',  // y5
      '...oaaaaaaaAo',  // y6  띠
      '...oAAo......',  // y7  뒤테 — x17 앞은 비운다
      '...oAAo......',  // y8
      '....ooo......',  // y9
      '.............',
      '.............',
      '.............',
      '.............',
      '.............',
    ],
  },

  /** 깃털 투구: 정수리에 볏이 솟고 꽁지가 뒤로 흐른다. 철투구와 같은 규칙 —
   *  y7 부터 앞이 트여 눈·뺨·수염이 드러난다. */
  helm_plume: {
    w: 13, h: 14, ax: 6, ay: 13,
    px: [
      '....aaaa.....',  // y1  볏
      '..aAAAAAAa...',  // y2
      '..aAooooooo..',  // y3  꽁지가 뒤로
      '.aAAommwwmmo.',  // y4
      '..Aommmmmmmo.',  // y5
      '...oMmmmmmmwo',  // y6  이마 챙
      '...oMmo......',  // y7  ← 앞이 트임
      '...oMmo......',  // y8
      '...oMwo......',  // y9
      '....oMo......',  // y10
      '....oMo......',  // y11
      '.............',
      '.............',
      '.............',
    ],
  },

  /** 가면 투구: 금속 가면 + 뒤통수를 감싸는 두정판. 가면 앞판(x19~x22)과 뒤통수 사이의
   *  세로 틈(x17~x18)으로 눈과 뺨이 번득인다. 턱 끝이 앞으로 뾰족하다. */
  helm_mask: {
    w: 13, h: 13, ax: 6, ay: 12,
    px: [
      '.....ooooo...',  // y2  머리보다 한 칸 높은 돔
      '....ommwwmo..',  // y3
      '....ommmmmmo.',  // y4
      '...ommmmmmmo.',  // y5
      '...oMmmmmmaao',  // y6  이마 — 앞에 강조 문양
      '..oMMmo..oaAo',  // y7  ← 눈이 보이는 틈
      '..oMMmo..oaAo',  // y8  가면 앞판
      '..oMMmo..oAAo',  // y9
      '..oMMmo..oao.',  // y10
      '..oMMmo..oo..',  // y11 턱 끝
      '...oMmo......',  // y12
      '...oMwo......',  // y13
      '...oooo......',  // y14
    ],
  },

  // ── 망토 (어깨에서 뒤쪽으로 쏠려 몸통 밖으로 나온다) ──────────────────────
  /** 짧은 망토: 앞어깨에 걸치고 뒤(왼쪽)로 삼각으로 퍼지는 숄.
   *  뒤로 흐르는 앞단(왼쪽 사선)에만 반사광 2px — 천은 하이라이트를 아껴 찍는다. */
  cape_short: {
    w: 16, h: 10, ax: 12, ay: 0,
    px: [
      '..........occcco',
      '........owccccco',
      '......owcccccCCo',
      '....occccccccCCo',
      '..occccccccccCCo',
      '.occcccccccccCCo',
      'occccccccccccCCo',
      'oCccccccccccCCCo',
      'oCCCCCCCCCCCCCCo',
      '.oooooooooooooo.',
    ],
  },

  /** 긴 망토: 종아리까지 내려오는 정식 망토. 뒤로 길게 나부낀다. */
  cape_long: {
    w: 18, h: 18, ax: 13, ay: 0,
    px: [
      '............occcco',
      '..........owccccco',
      '........owcccccCCo',
      '......occccccccCCo',
      '....occccccccccCCo',
      '..occccccccccccCCo',
      '.occcccccccccccCCo',
      'occccccccccccccCCo',
      'oCcccccccccccccCCo',
      'oCccccccccccccCCCo',
      'oCCcccccccccccCCCo',
      'oCCccccccccccCCCCo',
      'oCCCcccccccccCCCCo',
      'oCCCcccccccccCCCo.',
      'oCCCCcccccccCCCo..',
      '.oCCCCcccccCCCo...',
      '.oCCCCCCCCCCCo....',
      '..ooooooooooo.....',
    ],
  },

  /** 넝마 망토: 밑단이 찢겨 들쭉날쭉하다. */
  cape_tattered: {
    w: 18, h: 17, ax: 13, ay: 0,
    px: [
      '............occcco',
      '..........owccccco',
      '........owcccccCCo',
      '......occccccccCCo',
      '....occccccccccCCo',
      '..occccccccccccCCo',
      '.occcccccccccccCCo',
      'occccccccccccccCCo',
      'oCcccccccccccccCCo',
      'oCccccccccccccCCCo',
      'oCCcccccccccccCCCo',
      'oCCccccc.ccccCCCCo',
      'oCCccc..ccc.cCCCCo',
      'oCc...occo..CCCCo.',
      'oo....occo...CCo..',
      '......oCo.....Co..',
      '.......o.......o..',
    ],
  },

  /** 날개 망토: 좌우로 활짝 펼쳐진 막 형태. */
  cape_wing: {
    w: 20, h: 16, ax: 10, ay: 0,
    px: [
      '.o.....occcco.....o.',
      '.oc....occcco....co.',
      '.occ...occcco...cco.',
      '.occc..occwco..ccco.',
      '.occcc.occwco.cccco.',
      '.occcccccccccccccco.',
      '.occcccccccccccccco.',
      '.oCcccccccccccccCCo.',
      '..occcccccccccccco..',
      '...occcccccccccco...',
      '....oCCCCCCCCCCo....',
      '.....occcccccco.....',
      '......oCCCCCCo......',
      '.......oCCCCo.......',
      '........oCCo........',
      '.........oo.........',
    ],
  },

  // ── 무기 (칼끝이 위, 앵커 = 그립) ────────────────────────────────────────
  /** 한손검: 곧은 양날검. 날 중앙에 반사광 한 줄, 가드는 강조색. */
  wpn_sword: {
    w: 5, h: 17, ax: 2, ay: 13,
    px: [
      '..o..',
      '.omo.',
      '.omo.',
      'omwmo',
      'omwmo',
      'omwmo',
      'omwmo',
      'omwmo',
      'omwmo',
      'omwmo',
      'omMmo',
      'oaaao',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.oao.',
      '..o..',
    ],
  },

  /** 대검: 폭 넓고 긴 양손검. */
  wpn_greatsword: {
    w: 7, h: 24, ax: 3, ay: 19,
    px: [
      '...o...',
      '..owo..',
      '..omo..',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omwmo.',
      '.omMmo.',
      'oaaaaao',
      'oAAaaAo',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..oao..',
      '...o...',
    ],
  },

  /** 카타나: 외날 도. 등날은 어둡고 날은 하얗게 선다. 원형 츠바. */
  wpn_katana: {
    w: 6, h: 20, ax: 2, ay: 16,
    px: [
      '...oo.',
      '..owo.',
      '..owo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omwo.',
      '.omMo.',
      'oaaaao',
      '.oLo..',
      '.olo..',
      '.oLo..',
      '.olo..',
      '.ooo..',
    ],
  },

  /** 레이피어: 아주 가는 찌르기 검 + 바구니형 손잡이. */
  wpn_rapier: {
    w: 5, h: 20, ax: 2, ay: 16,
    px: [
      '..o..',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.owo.',
      '.omo.',
      'oaoao',
      'oaaao',
      '.olo.',
      '.oLo.',
      '.oao.',
      '..o..',
    ],
  },

  /** 단검: 짧은 양날 단도. */
  wpn_dagger: {
    w: 5, h: 11, ax: 2, ay: 7,
    px: [
      '..o..',
      '.owo.',
      'omwmo',
      'omwmo',
      'omMmo',
      'oaaao',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.oao.',
      '..o..',
    ],
  },

  /** 쌍단검: 손을 사이에 두고 두 자루를 나란히 쥔다. 날 밑동에 그림자 한 줄. */
  wpn_twindagger: {
    w: 9, h: 11, ax: 4, ay: 7,
    px: [
      '.o.....o.',
      'owo...owo',
      'owo...owo',
      'omo...omo',
      'oMo...oMo',
      'aaa...aaa',
      'olo...olo',
      'olo...olo',
      'oLo...oLo',
      'oao...oao',
      '.o.....o.',
    ],
  },

  /** 손도끼: 한손용 도끼. 날 바깥쪽 초승달에 반사광. */
  wpn_axe: {
    w: 7, h: 16, ax: 3, ay: 11,
    px: [
      '...o...',
      '.oooooo',
      'owwmmmo',
      'owmmmmo',
      'oommmMo',
      '..ommMo',
      '..oooo.',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..oao..',
      '...o...',
    ],
  },

  /** 대도끼: 거대한 양손 도끼. 날이 자루 바깥(오른쪽)으로만 뻗어 얼굴을 가리지 않는다. */
  wpn_greataxe: {
    w: 9, h: 24, ax: 2, ay: 18,
    px: [
      '..o......',
      '.oloooo..',
      '.olmwwmmo',
      '.olmwmmmo',
      '.olmwmmMo',
      '.olmmmmMo',
      '.olommMo.',
      '.olooo...',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.olo.....',
      '.olo.....',
      '.oao.....',
      '..o......',
    ],
  },

  /** 철퇴: 가시 달린 타격 머리. */
  wpn_mace: {
    w: 7, h: 17, ax: 3, ay: 10,
    px: [
      '...a...',
      '..oao..',
      '.omwmo.',
      'aMmwmMa',
      'oMmmmMo',
      '.omMmo.',
      '..ooo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..oao..',
      '...o...',
    ],
  },

  /** 워해머: 네모난 육중한 머리 + 긴 자루. */
  wpn_hammer: {
    w: 9, h: 20, ax: 2, ay: 15,
    px: [
      '..o......',
      '.oloooooo',
      '.olmwwwmo',
      '.olmmwmMo',
      '.olmmmmMo',
      '.oloooooo',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.olo.....',
      '.olo.....',
      '.oLo.....',
      '.oao.....',
      '..o......',
    ],
  },

  /** 창: 나뭇대에 나뭇잎형 창날. */
  wpn_spear: {
    w: 5, h: 26, ax: 2, ay: 20,
    px: [
      '..o..',
      '.owo.',
      'omwmo',
      'omwmo',
      'omMmo',
      '.omo.',
      '.oao.',
      'oaaao',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.oao.',
      '..o..',
    ],
  },

  /** 파이크: 창보다 훨씬 긴 장창. 밀집대형용. */
  wpn_pike: {
    w: 5, h: 28, ax: 2, ay: 22,
    px: [
      '..o..',
      '.owo.',
      '.owo.',
      'omwmo',
      'omwmo',
      'omMmo',
      '.omo.',
      'oaaao',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.oao.',
      '..o..',
    ],
  },

  /** 미늘창: 찌르기 첨두 + 자루 바깥쪽에 붙은 도끼날. */
  wpn_halberd: {
    w: 8, h: 26, ax: 1, ay: 20,
    px: [
      '.o......',
      'owo.....',
      'owo.....',
      'omo.....',
      'oloooo..',
      'olommwwo',
      'olommwmo',
      'olommMo.',
      'oloooo..',
      'olo.....',
      'oLo.....',
      'olo.....',
      'olo.....',
      'oLo.....',
      'olo.....',
      'olo.....',
      'oLo.....',
      'olo.....',
      'olo.....',
      'oLo.....',
      'olo.....',
      'olo.....',
      'oLo.....',
      'olo.....',
      'oao.....',
      '.o......',
    ],
  },

  /** 낫: 자루 위쪽에서 앞쪽(오른쪽)으로 크게 휘어 나가는 날. */
  wpn_scythe: {
    w: 12, h: 24, ax: 3, ay: 18,
    px: [
      '..ooo.......',
      '..oloooo....',
      '..olommwwwo.',
      '..olommmmwwo',
      '..olo...omMo',
      '..oLo....ooo',
      '..olo.......',
      '..oLo.......',
      '..olo.......',
      '..olo.......',
      '..oLo.......',
      '..olo.......',
      '..olo.......',
      '..oLo.......',
      '..olo.......',
      '..olo.......',
      '..oLo.......',
      '..olo.......',
      '..olo.......',
      '..oLo.......',
      '..olo.......',
      '..olo.......',
      '..oao.......',
      '...o........',
    ],
  },

  /** 활: 앞쪽으로 불룩한 목재 활대와 팽팽한 시위. */
  wpn_bow: {
    w: 6, h: 19, ax: 4, ay: 9,
    px: [
      '..oo..',
      '.wol..',
      '.wol..',
      '.w.ol.',
      '.w.ol.',
      '.w.ol.',
      '.w..ol',
      '.w..ol',
      '.w..ol',
      '.w..oL',
      '.w..ol',
      '.w..ol',
      '.w..ol',
      '.w.ol.',
      '.w.ol.',
      '.w.ol.',
      '.wol..',
      '.wol..',
      '..oo..',
    ],
  },

  /** 장궁: 키만큼 긴 활. 사거리형 궁수용. */
  wpn_longbow: {
    w: 7, h: 25, ax: 5, ay: 12,
    px: [
      '..oo...',
      '.wol...',
      '.w.ol..',
      '.w.ol..',
      '.w.ol..',
      '.w.ol..',
      '.w..ol.',
      '.w..ol.',
      '.w..ol.',
      '.w...ol',
      '.w...ol',
      '.w...ol',
      '.w...oL',
      '.w...ol',
      '.w...ol',
      '.w...ol',
      '.w..ol.',
      '.w..ol.',
      '.w..ol.',
      '.w.ol..',
      '.w.ol..',
      '.w.ol..',
      '.w.ol..',
      '.wol...',
      '..oo...',
    ],
  },

  /** 석궁: 위로 향한 볼트 + 가로로 뻗은 활대 + 개머리. */
  wpn_crossbow: {
    w: 11, h: 16, ax: 5, ay: 12,
    px: [
      '.....o.....',
      '.....w.....',
      '.....m.....',
      '.wwwwmwwww.',
      'oLLLLmLLLLo',
      '.ooooooooo.',
      '....omo....',
      '....omo....',
      '....omo....',
      '....olo....',
      '....olo....',
      '....olo....',
      '....olo....',
      '....olo....',
      '....oLo....',
      '.....o.....',
    ],
  },

  /** 마법 지팡이: 긴 나무대 끝에 마력 결정이 박혀 있다. */
  wpn_staff: {
    w: 7, h: 26, ax: 3, ay: 19,
    px: [
      '..ooo..',
      '.ogwgo.',
      '.ogwgo.',
      '.ogGgo.',
      '.oGGGo.',
      '..ooo..',
      '..oao..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..oao..',
      '...o...',
    ],
  },

  /** 완드: 짧은 지휘봉. 끝에 작은 마력 보석. */
  wpn_wand: {
    w: 5, h: 13, ax: 2, ay: 9,
    px: [
      '..o..',
      '.ogo.',
      'ogwgo',
      '.oGo.',
      '.oao.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.olo.',
      '.oao.',
      '..o..',
    ],
  },

  /** 마도서: 손 위에 펼쳐 든 두꺼운 책. 중앙에 마력 문양. */
  wpn_tome: {
    w: 11, h: 8, ax: 5, ay: 7,
    px: [
      '.ooooooooo.',
      'occcccccwco',
      'ocaaaaaaaco',
      'ocaagGgaaco',
      'ocaaaaaaaco',
      'oCcccccccCo',
      'oCCCCCCCCCo',
      '.ooooooooo.',
    ],
  },

  /** 클로: 주먹에 채우는 세 갈래 갈고리 발톱. */
  wpn_claw: {
    w: 7, h: 11, ax: 3, ay: 8,
    px: [
      '.o.o.o.',
      'owowowo',
      'owowowo',
      'omomomo',
      'oMmmmMo',
      'oLllllo',
      'oLLLLLo',
      '.ooooo.',
      '..olo..',
      '..oLo..',
      '...o...',
    ],
  },

  /** 오브: 손 위에 떠 있는 마력 구슬 + 금속 받침. */
  wpn_orb: {
    w: 9, h: 10, ax: 4, ay: 8,
    px: [
      '...ooo...',
      '.oogggoo.',
      'oggwwgggo',
      'oggwgggGo',
      'ogggggGGo',
      '.oggGGGo.',
      '...ooo...',
      '....a....',
      '...oao...',
      '....o....',
    ],
  },

  // ── 방패 / 보조장비 (앵커 = 손잡이 중심. spritegen 이 SHIELD_OFFSET 만큼 앞으로 민다) ──
  // 방패면이 "앞을 향해 있다"고 읽히도록 전부 같은 규칙으로 칠한다.
  //   뒤(x 작은 쪽) = 그림자 M/C  →  가운데 = 기본 m/c + 문양 a/A  →  앞(x 큰 쪽) = 하이라이트 w
  // 세로로는 머리(y14 위)를 절대 침범하지 않게 잡는다. 타워 실드도 목 아래에서 시작한다.
  /** 버클러: 주먹만 한 소형 원형 방패. 가운데 돌기(보스)에 앞쪽 반사광. */
  shd_buckler: {
    w: 9, h: 8, ax: 4, ay: 4,
    px: [
      '...ooo...',
      '.oMmmmwo.',
      'oMMmaamwo',
      'oMMmawamo',
      'oMMmaaamo',
      'oMMmmmmwo',
      '.oMMmmmo.',
      '...ooo...',
    ],
  },

  /** 라운드 실드: 금속 테 + 천을 씌운 방패면. 앞 테가 번쩍이고 가운데 십자 문양이 선다. */
  shd_round: {
    w: 11, h: 11, ax: 5, ay: 5,
    px: [
      '...ooooo...',
      '.ooMmmmmoo.',
      'omMCcccccwo',
      'omMCccaccmo',
      'omMCcaaacwo',
      'omMCccaccmo',
      'omMCcccccwo',
      'omMCCccccmo',
      '.omMCcccwo.',
      '..ommmmmo..',
      '...ooooo...',
    ],
  },

  /** 카이트 실드: 위는 둥글고 아래로 뾰족한 기병용 방패. 앞모서리 한 줄이 하얗게 선다. */
  shd_kite: {
    w: 9, h: 15, ax: 4, ay: 7,
    px: [
      '..ooooo..',
      '.oCcccwo.',
      'oCCccccwo',
      'oCCcaacwo',
      'oCCcawcwo',
      'oCCcaacwo',
      'oCCccccwo',
      'oCCccccwo',
      'oCCccccwo',
      '.oCcccwo.',
      '.oCCccwo.',
      '..oCccwo.',
      '..oCcwo..',
      '...oCwo..',
      '....oo...',
    ],
  },

  /** 타워 실드: 몸 절반을 가리는 대형 장방형 방패. 위 모서리를 한 칸 내려
   *  어떤 포즈에서도 턱·머리를 가리지 않는다. 문양 두 단이 앞을 향해 보인다. */
  shd_tower: {
    w: 10, h: 20, ax: 5, ay: 8,
    px: [
      '.oooooooo.',
      'oMmmmmmmwo',
      'oMMmmmmmmo',
      'oMMmmmmmwo',
      'oMMmaaammo',
      'oMMmawammo',
      'oMMmaaammo',
      'oMMmmmmmwo',
      'oooooooooo',
      'oMmmmmmmwo',
      'oMMmmmmmmo',
      'oMMmaaammo',
      'oMMmawammo',
      'oMMmaaammo',
      'oMMmmmmmwo',
      'oMMmmmmmmo',
      'oMMMmmmmwo',
      'oMMMMMMMMo',
      '.oMMMMMMo.',
      '..oooooo..',
    ],
  },

  /** 보조 오브: 왼손에 띄우는 마력 구체. 빛은 앞·위에서 든다. */
  shd_orb: {
    w: 9, h: 8, ax: 4, ay: 4,
    px: [
      '...ooo...',
      '.oogggoo.',
      'oGgggwwgo',
      'oGGgggwgo',
      'oGGgggggo',
      'oGGGggggo',
      '.oGGGggo.',
      '...ooo...',
    ],
  },

  /** 횃불: 불꽃이 타오르는 보조 손 장비. */
  shd_torch: {
    w: 7, h: 14, ax: 3, ay: 9,
    px: [
      '...g...',
      '..ggg..',
      '.gggGg.',
      '.gGwGg.',
      '.ggGGg.',
      '..gGg..',
      '..oao..',
      '..oao..',
      '..olo..',
      '..oLo..',
      '..olo..',
      '..olo..',
      '..oLo..',
      '..oao..',
    ],
  },

  /** 패링 대거: 왼손에 드는 방어용 단검. */
  shd_dagger: {
    w: 5, h: 12, ax: 2, ay: 8,
    px: [
      '..o..',
      '.owo.',
      'omwmo',
      'omwmo',
      'omMmo',
      '.omo.',
      'oaaao',
      '.olo.',
      '.olo.',
      '.oLo.',
      '.oao.',
      '..o..',
    ],
  },
};
