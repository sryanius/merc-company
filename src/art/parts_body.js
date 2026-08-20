// 도트 파츠 데이터 — 몸통 / 머리 / 헤어 / 방어구 / 팔 / 다리. (SPEC §4.3~4.4)
//
// 브라우저 API를 일절 건드리지 않는 순수 데이터 모듈.
//
// 좌표 규약 (SPEC §4.1~4.3)
//   논리 캔버스 32x40. 캐릭터는 오른쪽(+x)을 본다. 발바닥 y=38, 가로 중심 x=16.
//   파츠의 (ax, ay) 픽셀이 아래 조인트 좌표에 정확히 얹힌다.
//     head_* / hair_*  : 하단 중앙(목)     -> head    (16, 14)
//     body_* / armor_* : 상단 중앙         -> chest   (16, 14)
//     arm_*            : 상단 중앙(어깨)   -> shBack  (13, 16) / shFront (19, 16)
//     leg_*            : 상단 중앙(고관절) -> hipBack (14, 26) / hipFront(18, 26)
//   따라서 머리는 y3~y14, 몸통은 y14~y27, 팔은 y16~y26, 다리는 y26~y38 대역을 쓴다.
//
// 문자 팔레트 (art/palette.js)
//   .  투명      o  외곽선     s/S 피부     h/H 머리카락·털
//   c/C 천       m/M 금속      l/L 가죽     a/A 강조색
//   w  하이라이트  e  눈        g/G 마력광
//
// ── 이 파일의 두 가지 원칙 ────────────────────────────────────────────────
// 1) **방향 가독성**: 32x40에서는 실루엣이 8할이고, 옆모습에서 방향을 만드는 건 비대칭이다.
//    머리 조인트가 x=16 이므로 12폭 파츠(ax=6)에서는 열 c 가 곧 x=c+10 이다.
//    - 얼굴 덩어리 전체를 목(c6)보다 앞(c5~c10)에 놓는다. 뒤통수는 c4~c5 의 외곽선+그림자로
//      둥글게 닫고, 그 뒤 빈 자리는 헤어가 채운다. (목이 뒤통수 밑이 아니라 뒤쪽에 붙는다)
//    - 눈(e)은 c7~c8 = x17~x18. 투구는 이 자리를 바이저 틈으로 반드시 비운다.
//    - 앞 윤곽은 매끈하면 안 된다. 눈두덩 나옴 / 눈구멍 들어감 / 코 나옴 / 인중 들어감 /
//      턱 나옴 순으로 1px 씩 들쭉날쭉해야 옆얼굴로 읽힌다.
//    - 헤어는 정수리와 뒤통수만 덮는다. 헤어라인을 c6 에서 끊어 이마·눈·코를 비운다.
//      앞머리를 내리면 방향이 즉시 죽는다. 턱수염도 뺨을 비우고 턱 아래로만 내린다.
//    합격 기준은 `node tools/facing.mjs` 가 실제 조합 54종으로 잰다
//    (눈 평균 x ≥ 17.5 / 얼굴 ≥ 5px 이고 평균 x ≥ 16.8 / 머리카락 평균 x ≤ 16.2).
// 2) **명암 3단계**: 그림자(S/C/M/L) - 기본(s/c/m/l) - 하이라이트(w).
//    빛은 위·앞(오른쪽 위)에서 온다. 금속은 w를 넉넉히, 천은 1~2px만 찍어 재질을 구분한다.
//
// 각 파츠의 px 는 행 길이 === w, 행 개수 === h 를 항상 만족해야 한다.
// (art/parts.js 의 validateParts() 로 검사)

export const BODY_PARTS = {

  // ── 몸통 (맨몸) : 앵커 상단 중앙 -> chest(16,14) ──
  // 마른 체형. 어깨가 좁고 앞가슴 모서리에 반사광이 든다.
  body_slim: {
    w: 12, h: 13, ax: 6, ay: 0,
    px: [
      '....ossso...',
      '...ossssssso',
      '..osssssssso',
      '..oSsssssswo',
      '..oSSsssssso',
      '..oSssssssso',
      '..oSSssssswo',
      '..oSSsssssso',
      '...oSSsssso.',
      '...oSSsssso.',
      '...oSSssso..',
      '...oSssso...',
      '...oooooo...',
    ],
  },
  // 표준 체형. 앞쪽(오른쪽) 어깨가 한 칸 더 나와 비대칭이다.
  body_normal: {
    w: 36, h: 36, ax: 18, ay: 0, scale: 3,
    px: [
      '................ooooooooooo.........',
      '..............ooSSSSssssxxxoo.......',
      '.........oooooSSSsssssssxxxxxoo.....',
      '........oSSSSSSSSssssssssxxxxxxoo...',
      '......ooSSSSSSSSsssssssssxxxxxxxxo..',
      '.....oSSSSSSSSSSsssssssssxxxxxxxxo..',
      '....oCCCCCCCCcccccccccccvvvvvvvvvo..',
      '....oCCCCCCCCcccccccccccvvvvvvvvvo..',
      '....oCCCCCCCCcccccccccccvvvvvvvvvo..',
      '.....oCCCCCCCCcccccccccvvvvvvvvvo...',
      '.....oCCCCCCCCCCCCCCCCCCCCCCCCCCo...',
      '......oCCCCCCCcccccccccvvvvvvvvo....',
      '......oCCCCCCCcccccccccvvvvvvvvo....',
      '......oCCCCCCCccccccccvvvvvvvvo.....',
      '.......oCCCCCCcccccccccvvvvvvvo.....',
      '.......oCCCCCCCCCCCCCCCCCCCCCo......',
      '.......oCCCCCCccccccccvvvvvvvo......',
      '........oCCCCCccccccccvvvvvvo.......',
      '........oCCCCCccccccccvvvvvvo.......',
      '........oCCCCCcccccccvvvvvvo........',
      '.........oCCCCCCCCCCCCCCCCCo........',
      '.........oCCCCCccccccvvvvvo.........',
      '.........oCCCCCccccccvvvvvo.........',
      '.........oCCCCCccccccvvvvvo.........',
      '.........oCCCCCccccccvvvvvo.........',
      '.........oCCCCCCCCCCCCCCCCo.........',
      '.........oCCCCCccccccvvvvvvo........',
      '........oCCCCCcccccccvvvvvvo........',
      '........oCCCCCcccccccvvvvvvo........',
      '........oCCCCCcccccccvvvvvvo........',
      '........oCCCCCCCCCCCCCCCCCCo........',
      '.........oCCCCCccccccvvvvvvo........',
      '.........oCCCCCccccccvvvvvvo........',
      '.........oCCCCCccccccvvvvvo.........',
      '..........oCCCCccccccvvvvvo.........',
      '...........ooooooooooooooo..........',
    ],
  },
  // 떡대 체형. 가슴이 두껍고 앞어깨가 한 뼘 더 넓다.
  body_heavy: {
    w: 14, h: 13, ax: 7, ay: 0,
    px: [
      '.....ossso....',
      '..osssssssssso',
      '.ossssssssssso',
      '.oSssssssssswo',
      '.oSSsssssssswo',
      '.oSSssssssssso',
      '.oSSsssssssswo',
      '.oSSSsssssssso',
      '..oSSSsssssso.',
      '..oSSSsssssso.',
      '..oSSSSsssso..',
      '...oSSSsssso..',
      '...oooooooo...',
    ],
  },
  // 거구. 상체가 역삼각으로 부풀고 허리가 잘록하다.
  body_hulk: {
    w: 16, h: 14, ax: 8, ay: 0,
    px: [
      '......ossso.....',
      '..osssssssssssso',
      '.ossssssssssssso',
      '.oSSsssssssssswo',
      '.oSSSssssssssswo',
      '.oSSSsssssssssso',
      '.oSSSssssssssswo',
      '.oSSSsssssssssso',
      '.oSSSSsssssssso.',
      '..oSSSSssssssso.',
      '..oSSSSSssssso..',
      '...oSSSSssssso..',
      '...oSSSSsssso...',
      '....oooooooo....',
    ],
  },

  // ── 머리 : 앵커 하단 중앙(목) -> head(16,14) ──
  // 인간. 완전 옆얼굴 — 목(앵커 c6)보다 얼굴 전체가 앞(c5~c10)으로 나가 있다.
  // 뒤통수는 c4 외곽선 + c5 그림자로 둥글게 닫고, 눈은 c7~c8(=x17~18).
  // c11 로 튀어나온 두 줄이 눈두덩(r3)과 코(r5)다. r8 에서 턱이 앞으로 밀린다.
  // r6/r9 의 c10 외곽선은 코밑·턱밑을 닫는 그늘이다 — 빼면 밝은 피부가 배경에 그대로 닿아
  // 앞쪽 실루엣에 구멍이 뚫린 것처럼 보인다.
  head_human: {
    w: 24, h: 30, ax: 8, ay: 29, scale: 3,
    px: [
      '........ooooooo.........',
      '......ooSSsssxxoo.......',
      '....ooSSSsssssxxxo......',
      '...oSSSSSsssssxxxxo.....',
      '..oSSSSSSsssssxxxxxo....',
      '..oSSSSSSsssssxxxxxo....',
      '..oSSSSSSssssssxxxxxo...',
      '..oSSSSSSssssssxxxxxo...',
      '..oSSSSSSssssssssssoo...',
      '..oSSSSSsssssSSSSSo.....',
      '..oSSSSSsssssxxeexo.....',
      '..oSSSSSsssssSxeeSo.....',
      '..oSSSSSSsssssSSsxxo....',
      '..oSSSSSSssssssxxxxxo...',
      '..oSSSSSSsssssssxxxxxo..',
      '..oSSSSSSsssssssxxSSoo..',
      '...oSSSSSssssssdSSSo....',
      '...oSSSSSsssssxSsxo.....',
      '...oSSSSSssssssxxxSo....',
      '...oSSSSSssssssSddSo....',
      '....oSSSSSssssxSxxo.....',
      '.....oSSSSSssssxxxxo....',
      '.....oSSSSsssssxxxo.....',
      '.....oSSSSssSSSSoo......',
      '......odddSssxxo........',
      '......oddSsssxxo........',
      '......odSSsssxxo........',
      '......oSSSsssxxo........',
      '......oSSSsssxxo........',
      '......oooooooooo........',
    ],
  },
  // 고블린. 작은 두개골 + 뒤(c2~c3)로 젖혀진 뾰족귀 + r5~r6 에서 크게 꺾여 나온 매부리코.
  // 귀는 c3 한 줄짜리 살이라 r2/r5 의 c3 외곽선으로 위아래를 막아야 형태가 닫힌다.
  // r7 이 안으로 쑥 들어가 코끝과 아래턱 사이에 확실한 단차가 생긴다(=옆얼굴).
  head_goblin: {
    w: 12, h: 12, ax: 6, ay: 11,
    px: [
      '......oooo..',
      '.....osswso.',
      '...o.osssso.',
      '..osoSsssso.',
      '.oosoSseeso.',
      '...o.oSsssso',
      '.....oSsssso',
      '.....oSswso.',
      '.....oSsso..',
      '.....oSso...',
      '....oSsso...',
      '....oSsso...',
    ],
  },
  // 오크. 목(c6)보다 얼굴 전체가 앞으로 나간 각진 옆얼굴.
  // r4 의 두꺼운 눈두덩(S 띠) 아래 눈이 박히고, r6~r9 에서 주둥이와 아래턱이 앞으로 밀린다.
  // r7 의 w 한 점이 앞으로 솟은 엄니다.
  head_orc: {
    w: 12, h: 13, ax: 6, ay: 12,
    px: [
      '.....ooooo..',
      '.....osswso.',
      '....oSsssso.',
      '....oSsssso.',
      '....oSSSSso.',
      '....oSseeso.',
      '....oSssssso',
      '....oSssswso',
      '.....oSsssso',
      '.....oSssso.',
      '.....oSsso..',
      '....oSsso...',
      '....oSsso...',
    ],
  },
  // 해골. 앞쪽(c7~c9)으로만 뚫린 커다란 안와 + c8 의 코 구멍 + w 로 드러난 이빨.
  // 뒤통수(c4~c5)는 통뼈로 막아 안와가 앞에 있다는 것만으로 방향이 읽힌다.
  head_skull: {
    w: 12, h: 12, ax: 6, ay: 11,
    px: [
      '.....ooooo..',
      '.....osswso.',
      '....oSsssso.',
      '....oSssssso',
      '....oSseeeso',
      '....oSseesso',
      '....oSssosso',
      '....oSsswwso',
      '.....oSswsso',
      '.....oSssoo.',
      '....oSsso...',
      '....oSsso...',
    ],
  },
  // 늑대 수인. 털(h)은 뒤통수·귀에만 두고, 앞으로 길게 뻗은 주둥이는 맨살(s)로 밝게 뺐다.
  // 털/맨살의 경계선 자체가 방향 신호다. 눈은 주둥이 뿌리(c8~c9)에 박힌다.
  // 귀 끝(r0)은 귀 살(r1 의 c3/c7) 바로 위에 와야 하고, 두 귀 사이 골(r2 의 c5)은 외곽선으로 판다.
  head_wolf: {
    w: 12, h: 12, ax: 6, ay: 11,
    px: [
      '...o...o....',
      '..oho.oho...',
      '..ohhohhho..',
      '..oHhhhhhho.',
      '..oHhhhheeso',
      '..oHhhhhssso',
      '...oHhhsssso',
      '...oHhhswsso',
      '...oHhhssso.',
      '....oHhhoo..',
      '....oHhho...',
      '....oHhho...',
    ],
  },
  // 도마뱀족. 볏(a/A)이 뒤로만 흘러 뒤통수를 만들고, r5~r6 에서 납작한 주둥이가 앞으로 뻗는다.
  head_lizard: {
    w: 12, h: 12, ax: 6, ay: 11,
    px: [
      '....oooooo..',
      '...aoSssso..',
      '..aAoSsssso.',
      '.aA.oSsssso.',
      '.aA.oSseeso.',
      '....oSssssso',
      '....oSssssso',
      '.....oSSssso',
      '.....oSssso.',
      '.....oSsso..',
      '....oSsso...',
      '....oSsso...',
    ],
  },
  // 마족. 뿔 한 쌍(a/A)이 두개골 위(r2)에 뿌리를 박고 선다. 얼굴은 통째로 앞(c5~c10)에 있다.
  // 뿔도 비대칭이다 — 앞뿔(c9~c10)이 두 칸, 뒤뿔(c4)이 한 칸이라 앞이 더 크다.
  // 뿔은 반드시 두개골 외곽선(r2 의 c5~c9)에 상하로 맞물려야 한다. 대각선으로만 걸치면
  // 합성했을 때 떠다니는 점 세 개로 보인다.
  // r9 의 w 가 아래로 뻗은 송곳니, r10 에서 턱이 앞으로 밀린다.
  head_demon: {
    w: 12, h: 13, ax: 6, ay: 12,
    px: [
      '....a....aa.',
      '....Ao...Ao.',
      '.....ooooo..',
      '.....osswso.',
      '....oSsssso.',
      '....oSssssso',
      '....oSseesso',
      '....oSssssso',
      '....oSsssoo.',
      '....oSsswso.',
      '.....oSssso.',
      '....oSssoo..',
      '....oSsso...',
    ],
  },
  // 엘프. 인간보다 갸름한 옆얼굴 + 뒤(c2~c3)로 뻗은 뾰족귀. 턱끝(r8)이 앞으로 밀린다.
  // 고블린과 같은 규칙 — 귀는 r2/r5 의 c3 로 막고, 코밑·턱밑은 r6/r9 의 c10 으로 닫는다.
  head_elf: {
    w: 12, h: 12, ax: 6, ay: 11,
    px: [
      '.....ooooo..',
      '.....osswso.',
      '...o.osssso.',
      '..osoSssssso',
      '.oosoSseeso.',
      '...o.oSsssso',
      '.....oSssoo.',
      '.....oSsSso.',
      '.....oSsssso',
      '.....oSssoo.',
      '....oSsso...',
      '....oSsso...',
    ],
  },

  // ── 헤어 : 앵커 하단 중앙(목) -> head(16,14). 머리 위에 덧그린다 ──
  // 민머리 슬롯용 빈 파츠.
  hair_none: {
    w: 1, h: 1, ax: 0, ay: 0,
    px: [
      '.',
    ],
  },
  // 짧은 머리. 정수리와 뒤통수만 덮고 c7 앞(이마·눈·코)은 통째로 비운다.
  // 앞머리를 내리면 옆얼굴이 죽으므로 헤어라인을 c6 에서 끊는다.
  hair_short: {
    w: 32, h: 33, ax: 22, ay: 32, scale: 3,
    px: [
      '..................ooooooo.......',
      '................ooHHyyyyyooo....',
      '..............oohhHdhyyyyyyyoo..',
      '.............oHhHhHdhyhyyyyyyho.',
      '............oHHhhHHdhyhyhhyyyyho',
      '...........oHHhhHHdhyhyhhyyyyho.',
      '..........oHHhhHHdhyhyhhyyyyoo..',
      '.........oHhhhHdhyyyhhyyyyho....',
      '........oHhhhHdhyyyhhyyyyho.....',
      '........oHhHhHdhyhhhyyyyho......',
      '.......oHhHhHdhyhhhyyyyho.......',
      '.......oHhHHHdyhyhhyyyho........',
      '......oHhHhHdhyhhhyyyyho........',
      '......oHhHHdhyhyhhyyyho.........',
      '.....oHhHhHdhyhhhyyyyho.........',
      '.....oHhHhHdhyhhhyyyyho.........',
      '....oHhHhHdhyhhhyyyyho..........',
      '....oHhHhHdhyhhhyyyyho..........',
      '...oHhHhHdhyhyhhyyyyho..........',
      '...oHhHhHdhyhyhhyyyyHo..........',
      '..oHhHhHdhyhyhhyyyyHo...........',
      '..oHhHhHdhyhyhhyyyyHo...........',
      '.oHhHhHdhhyhhhhyyyyHo...........',
      '.oHHHHHdHHhHHHHHhHHHo...........',
      'oHHHHHHdHhHHHHHHhHHHo...........',
      'oHHHHHHdHhHHHHHHhHHHo...........',
      'oHHHHHHdHhHHHHHHhHHHo...........',
      '.oHHHHHdHhhHHHHHhHHHo...........',
      '..ooHHHHdHhHHHHhHHHo............',
      '....oHHHHdHhHHHHhHHo............',
      '......oHHHdhHHHhHHo.............',
      '.........oHHHhHHhHo.............',
      '............oHHHho..............',
    ],
  },
  // 긴 머리. 정수리에서 시작해 뒤통수 뒤(c2~c5)로만 등까지 흘러내린다.
  hair_long: {
    w: 12, h: 18, ax: 6, ay: 11,
    px: [
      '...hhhhhh...',
      '...hhhwwh...',
      '...hhhh.....',
      '..Hhhhh.....',
      '..HHhh......',
      '..HHhh......',
      '..HHhh......',
      '..HHhh......',
      '..HHhh......',
      '..HHhh......',
      '..HHhh......',
      '..HHhh......',
      '..HHhh......',
      '...HHh......',
      '...HHh......',
      '...HHh......',
      '....HH......',
      '....HH......',
    ],
  },
  // 말총머리. 정수리를 덮고 뒤통수에서 묶여 꽁지가 등 뒤(c0~c4)로 빠진다.
  hair_pony: {
    w: 14, h: 14, ax: 8, ay: 11,
    px: [
      '.....hhhhhh...',
      '.....hhhwwh...',
      '.....hhhh.....',
      '..hhHhhh......',
      'ohhHHh........',
      'oHhHH.........',
      '.oHH..........',
      '..HH..........',
      '..HH..........',
      '...HH.........',
      '...HH.........',
      '....HH........',
      '....H.........',
      '....H.........',
    ],
  },
  // 모히칸. 옆을 밀고 정수리에만 볏이 솟는다. 볏 끝이 뒤로 젖혀져 방향을 거든다.
  // 하이라이트(w)는 볏 안쪽에만 둔다. 바깥 테두리에 물리면 순백 픽셀이 실루엣에 튄다.
  hair_mohawk: {
    w: 12, h: 15, ax: 6, ay: 14,
    px: [
      '....hh......',
      '....hwhh....',
      '...Hhhwhh...',
      '...Hhhhhhh..',
      '...HHhh.....',
      '...HHh......',
      '...HH.......',
      '...H........',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ],
  },
  // 삭발. 정수리 반사광 + 뒤통수 그늘만 얹는다.
  // 주의: 머리 파츠의 외곽선 열(c4=x14, r1의 c5=x15)을 침범하면 실루엣에 구멍이 뚫린다.
  // 그래서 전부 한 칸 안쪽(c5~c7)에만 찍는다.
  hair_bald: {
    w: 12, h: 12, ax: 6, ay: 11,
    px: [
      '............',
      '......ww....',
      '.....HH.....',
      '.....HH.....',
      '.....H......',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ],
  },
  // 턱수염. 뺨(c7~c10)은 비우고 턱선(c4~c5) 구레나룻에서 이어져 턱 아래로만 늘어진다.
  // 뺨을 덮으면 눈·코·얼굴이 전부 지워져 방향이 사라진다.
  // 수염 끝(r10~r13)은 앞·아래를 외곽선으로 닫아 뾰족하게 모은다. 여기를 h 로 채우면
  // 머리 파츠의 턱선 외곽선까지 지워져 수염이 테두리 없는 덩어리로 보인다.
  hair_beard: {
    w: 12, h: 15, ax: 6, ay: 11,
    px: [
      '............',
      '............',
      '............',
      '............',
      '............',
      '....H.......',
      '...HH.......',
      '...HH.......',
      '...Hhhhhh...',
      '...Hhhhhh...',
      '...Hhhhho...',
      '...Hhhho....',
      '...Hhho.....',
      '....Hho.....',
      '....oo......',
    ],
  },

  // ── 방어구(몸통) : 앵커 상단 중앙 -> chest(16,14) ──
  // 맨몸. 앞어깨에서 허리로 지나가는 가죽 끈과 벨트뿐.
  armor_bare: {
    w: 12, h: 13, ax: 6, ay: 0,
    px: [
      '............',
      '............',
      '.........ll.',
      '........ll..',
      '.......ll...',
      '......lw....',
      '.....LL.....',
      '....LL......',
      '...LL.......',
      '..llllllllw.',
      '..oLLLLLLLo.',
      '............',
      '............',
    ],
  },
  // 천 튜닉. 헐렁한 통에 가죽 허리끈 하나.
  armor_cloth: {
    w: 12, h: 13, ax: 6, ay: 0,
    px: [
      '....occco...',
      '..occcwwccco',
      '.occccccccco',
      '.oCcccccccwo',
      '.oCCccccccco',
      '.oCcccccccco',
      '.oCCccccccco',
      '.oCCccccccco',
      '..oLLllllllo',
      '..oCCccccco.',
      '..oCCccccco.',
      '..oCCCccco..',
      '..oooooooo..',
    ],
  },
  // 긴 로브. 허리띠 아래로 자락이 무릎까지 퍼진다.
  armor_robe: {
    w: 14, h: 16, ax: 7, ay: 0,
    px: [
      '.....occco....',
      '...occcwwccco.',
      '..occccccccco.',
      '..oCccccccwco.',
      '.oCCccccccccwo',
      '.oCCccccccccco',
      '.oCCccccccccco',
      '.oAAaaaaaaaawo',
      '.oCCccccccccco',
      '.oCCccccccccco',
      '.oCCCcccccccco',
      '.oCCCcccccccco',
      'oCCCccccccccco',
      'oCCCCcccccccco',
      'oCCCCcccccccco',
      '.oooooooooooo.',
    ],
  },
  // 가죽 갑옷. 가슴판 이음새 + 굵은 허리 버클 + 앞모서리 반사.
  armor_leather: {
    w: 14, h: 13, ax: 7, ay: 0,
    px: [
      '.....olllo....',
      '...ollllllllo.',
      '..olllllllllo.',
      '..oLllllllwlo.',
      '.oLLlllllllllo',
      '.oLLoooolllllo',
      '.oLLlllllllwlo',
      '.oLLlllllllllo',
      '..oLLllllllllo',
      '..oaaaaaaaaawo',
      '..oLLllllllllo',
      '...oLLlllllo..',
      '...oooooooo...',
    ],
  },
  // 사슬 갑옷. 고리 짜임이 줄줄이 비치고 앞어깨가 크게 번쩍인다.
  armor_mail: {
    w: 14, h: 13, ax: 7, ay: 0,
    px: [
      '.....ommmo....',
      '...ommmmmmmmo.',
      '..ommmmmmmmmo.',
      '..oMmmmmmmwmo.',
      '.oMMmmmmmmmmwo',
      '.oMMmMmMmMmMmo',
      '.oMMmmmmmmmmmo',
      '.oMMmMmMmMmMmo',
      '..oMMmmmmmmmmo',
      '..ollllllllawo',
      '..oMMmmmmmmmmo',
      '...oMMmmmmmmo.',
      '...oooooooo...',
    ],
  },
  // 판금 갑옷. 앞 견갑이 뒤보다 한 칸 크고, 위·앞 모서리가 강하게 번쩍인다.
  armor_plate: {
    w: 40, h: 35, ax: 20, ay: 0, scale: 3,
    px: [
      '.............oooAAAaaaaaabbbbo..........',
      '..........oooMmmmmmnnnnnnnLLlaoo........',
      '........ooaMmmmmmnnnnnabLLLlllkaoo......',
      '......ooaMMmmmmmnnnnnabLLLLlllkkabo.....',
      '....ooaMMMmmmmmmnnnnnabLLLLllllkkabo....',
      '...oAaddMMMMMMMMMMMMMabLLLLllllkkabo....',
      '..oAaMmmmmnnnnnnnnnnnabLLLLlllllkkabo...',
      '.oAaMMMMMmmmmmmmnnnnabLLLLLlllllkkkabo..',
      '.oAaMMMMMmmmmmmmnnnabLLLLLlllllkkkkabo..',
      '.oAaddMMMMMMMMMMMMabLLLLLllllllkkkkabo..',
      '..oAammmmmnnnnnnnabLLLLLllllllkkkkabo...',
      '...oAaMMnMmmmmnabLLLLLLLLLLLLkkkkkabo...',
      '....oAaMMMmmmabLLLLkkkkkkkkkkkkkkabo....',
      '.....oAaMmabLLLLkLLllkllllkkkkkkkabo....',
      '......oAaLLLLLllLllllLllkkLkkkkkabo.....',
      '......oAaLLLLLLLLLLLLLLLLLLkkkkkabo.....',
      '.......oAaLLLLLkkkkkkkkkkkkkkkkabo......',
      '.......oAaLLLLLlllllllllkkkkkkkabo......',
      '........oAaLLLLlkllllklkkkkkkkabo.......',
      '........oAAAAAAAAAaaaaaaaaaaaaaao.......',
      '........oLLLLLLLLLLllllAabbbbAko........',
      '........oLLLkLLLLkLlllkAaGgfaAko........',
      '........oLLLLLLLLLLllllAaAGgaAko........',
      '........oLLLLLLLLLLllllAAAAAAAkko.......',
      '.......oLLLLLkLllllLklllkkLkkkkkko......',
      '.......oLLLLLkLllllLklllkkLkkkkkko......',
      '......oLLLLLLklllllLklllkkLkkkkkkko.....',
      '......oLLLaaLaaaaaaLaaaaaaLaaaaakko.....',
      '......oLLLAALAAAAAALAAAAAALAAAAAkko.....',
      '.....oLLddLLLkLLLLLLkLLLLLLkLLLLLkko....',
      '.....oLLLLLLLklllllLklllkkLkkkkkkkko....',
      '.....oLLLLLLLklllllLklllkkLkkkkkkkko....',
      '.....oLLLaaaLaaaaaaLaaaaaaLaaaaaakko....',
      '......oLLLAALAAAAAALAAAAAALAAAAAkko.....',
      '.......ooooooooooooooooooooooooooo......',
    ],
  },
  // 중장갑. 판금보다 한 겹 더 두껍고 앞 견갑이 산처럼 솟는다.
  armor_heavy: {
    w: 18, h: 14, ax: 9, ay: 0,
    px: [
      '.......ommmo......',
      '..oommmmmmmmmmmoo.',
      '.oommmmmmmmmmmmoo.',
      'oMMmmmwmmmmmmmmmwo',
      'oMMMmmmmmmmmmmmmwo',
      '.oMMMmmmmmmmmmmoo.',
      '..oMMMmmmmmmmmmo..',
      '..oMMMaaaaaammmo..',
      '..oMMMmmmmmmmmmo..',
      '..oAAAaaaaaaaaawo.',
      '..oMMMmmmmmmmmmo..',
      '...oMMMMmmmmmmo...',
      '....oMMMMmmmmo....',
      '....oooooooooo....',
    ],
  },
  // 뼈 갑옷. 갈비뼈가 그대로 드러난 언데드용. metal:bone 팔레트 권장.
  armor_bone: {
    w: 14, h: 13, ax: 7, ay: 0,
    px: [
      '.....ommmo....',
      '...ommmmmmmmo.',
      '..ommmmmmmmmo.',
      '..oMmmmmmmwmo.',
      '..ommmmmmmmmo.',
      '..oMoMoMoMomo.',
      '..ommmmmmmmmo.',
      '..oMoMoMoMomo.',
      '..ommmmmmmmmo.',
      '..ollllllllawo',
      '..oMMmmmmmmmo.',
      '...oMMmmmmmmo.',
      '...oooooooo...',
    ],
  },

  // ── 팔 : 앵커 상단 중앙(어깨) -> shBack(13,16) / shFront(19,16) ──
  // 가는 팔. 마법사·도적용.
  arm_slim: {
    w: 6, h: 10, ax: 2, ay: 0,
    px: [
      '.oswo.',
      '.oSso.',
      '.oSso.',
      '.oSso.',
      '..oSso',
      '..oSso',
      '..oSso',
      '..oSso',
      '..osso',
      '..oooo',
    ],
  },
  // 표준 팔. 어깨에서 주먹까지 완만하게 좁아진다.
  arm_normal: {
    w: 15, h: 40, ax: 7, ay: 0, scale: 3,
    px: [
      '..ooooooooooo..',
      '.oCCCccccvvvvo.',
      '.oCCCccccvvvvo.',
      '.oCCCccccvvvvo.',
      '.oCCCccccvvvvo.',
      '.oCCCccccvvvvo.',
      '.oCCCccccvvvo..',
      '..oCCCcccvvvo..',
      '..oCCCcccvvvo..',
      '..oCCCcccvvvo..',
      '..oCCCcccvvvo..',
      '..oCCCcccvvvo..',
      '..oCCcccvvvo...',
      '..oCCcccvvvo...',
      '...oCCcccvvo...',
      '...oCCcccvvo...',
      '...oCCcccvvo...',
      '..oaaaaaaaaao..',
      '..oAAAAAAAAAo..',
      '..oMMmmmmnnno..',
      '..oMMmwmmwnno..',
      '...oMMMmmMno...',
      '...oMMmmmnno...',
      '...oMMmmmnno...',
      '...oMMMMMMMo...',
      '...oMMmmmnno...',
      '...oMMmmmnno...',
      '..oLaaaaaaako..',
      '..oLAAAAAAAko..',
      '..oLLllllkkko..',
      '..oLLllllkkko..',
      '..oLLLlllkkkko.',
      '..oLLLlllLkkko.',
      '..oLLLllllkkko.',
      '...oLLLLLLLLLo.',
      '...oLLllllkkko.',
      '...oLdLllkkko..',
      '....oLLlllkko..',
      '....oLLllkko...',
      '.....oooooo....',
    ],
  },
  // 굵은 팔. 삼각근이 부풀고 주먹이 크다.
  arm_heavy: {
    w: 6, h: 11, ax: 2, ay: 0,
    px: [
      'osswso',
      'oSssso',
      'oSssso',
      'oSssso',
      'oSSsso',
      '.oSsso',
      '.oSsso',
      '.oSsso',
      '.ossso',
      '.ossso',
      '.ooooo',
    ],
  },

  // ── 다리 : 앵커 상단 중앙(고관절) -> hipBack(14,26) / hipFront(18,26) ──
  // 맨다리. 정강이와 맨발.
  leg_bare: {
    w: 7, h: 13, ax: 3, ay: 0,
    px: [
      '.osswo.',
      '.oSsso.',
      '.oSsso.',
      '.oSsso.',
      '.oSsso.',
      '..oSso.',
      '..oSso.',
      '..oSso.',
      '..oSso.',
      '..oSso.',
      '..osso.',
      '.osssso',
      '.oooooo',
    ],
  },
  // 천 하의. 무릎 아래까지 자락이 내려오고 발은 맨발.
  leg_cloth: {
    w: 7, h: 13, ax: 3, ay: 0,
    px: [
      'occccwo',
      'oCcccco',
      'oCcccco',
      'oCcccco',
      'oCCccco',
      'oCCccco',
      'oCCccco',
      'oCCccco',
      'oCCccco',
      '.ooooo.',
      '..oSso.',
      '.osssso',
      '.oooooo',
    ],
  },
  // 가죽 바지와 종아리 부츠. 발목에 조임끈.
  leg_leather: {
    w: 7, h: 13, ax: 3, ay: 0,
    px: [
      '.ollwlo',
      '.oLlllo',
      '.oLlllo',
      '.oLlllo',
      '.oLLllo',
      '..oLllo',
      '..oLllo',
      '..olllo',
      '..oaaao',
      '..oLllo',
      '..oLllo',
      '.oLLllo',
      '.oooooo',
    ],
  },
  // 사슬 각반에 가죽 부츠.
  leg_mail: {
    w: 7, h: 13, ax: 3, ay: 0,
    px: [
      'ommmmmo',
      'oMmmmwo',
      'oMmmmmo',
      'oMmMmMo',
      'oMmmmmo',
      '.oMmmmo',
      '.oMmMmo',
      '.oMmmmo',
      '..olllo',
      '..oaaao',
      '..oLllo',
      '.oLLllo',
      '.oooooo',
    ],
  },
  // 판금 각반. 무릎 보호대에 강조색이 박히고 정강이가 번쩍인다.
  leg_plate: {
    w: 24, h: 40, ax: 9, ay: 0, scale: 3,
    px: [
      '...ooooooooooooo........',
      '...oCCCccccvvvvo........',
      '...oCCCccccvvvvo........',
      '...oCCCvcccCvvvo........',
      '...oCCCccccvvvvo........',
      '...oCCCccccvvvo.........',
      '...oCCCccccvvvo.........',
      '...oCCCvcccCvvo.........',
      '...oCCCccccvvvo.........',
      '...oCCCccccvvvo.........',
      '....oCCccccvvvo.........',
      '....oCCCvccvCvo.........',
      '....oCCccccvvvo.........',
      '....oCCcccvvvo..........',
      '....oCCcccvvvo..........',
      '....oCCCvcvCvo..........',
      '....oCCcccvvvo..........',
      '....oCCcccvvvo..........',
      '....oCCcccvvvo..........',
      '....oCCcccvvvo..........',
      '...oaaaaaaaaaao.........',
      '...oMMMmwmmnnnno........',
      '...oMMMmMmmnnnno........',
      '...oAAAAAAAAAAo.........',
      '....odddcccvvvo.........',
      '....oCCcccvvvo..........',
      '....oCCcccvvvo..........',
      '....oCCcccvvvo..........',
      '....oCCcccvvvo..........',
      '...oLLLllllkkkoo........',
      '...oLLLkkLkkLkko........',
      '...oLLLllllkkko.........',
      '....oaaaaaaaaao.........',
      '....oAAAAAAAAAo.........',
      '....oLLLllllkkko........',
      '....oLLkkLkkLkkko.......',
      '....oLLLlllllkkkko......',
      '...oLLLLLLLLlkkkkko.....',
      '...oLLLLLLLLLLLLLLLoo...',
      '..oooooooooooooooooooo..',
    ],
  },
};

/** 이 모듈이 소유한 파츠 이름 목록 (SPEC §4.4 어휘 부분집합). */
export const BODY_PART_NAMES = Object.keys(BODY_PARTS);
