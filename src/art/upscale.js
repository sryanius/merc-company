/**
 * 파츠 2배 확대 (EPX / Scale2x)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 «단순 2배» 가 아니라 EPX 인가
 *   최근접 2배는 계단이 그대로 두 배가 돼 «크게 만든 저해상도» 로 보인다.
 *   EPX 는 이웃 4방향을 보고 **대각선만 메워** 실루엣을 부드럽게 한다 —
 *   픽셀아트를 위해 만들어진 규칙이라 도트 느낌이 안 죽는다.
 *
 * ★★ 이건 **발판이지 목적지가 아니다.** 파츠를 64×80 으로 손수 다시 찍기 전까지
 *   전 파츠를 자동으로 승격시켜 게임이 계속 돌아가게 하는 장치다 (HANDOFF §50).
 *   손으로 그린 2배 파츠는 `hd: true` 를 달아 **이 변환을 건너뛴다.**
 *
 * ★ DOM 을 안 쓴다 — 문자열 행렬만 다룬다. 도구·테스트에서 그대로 쓴다.
 *
 * @module art/upscale
 */

/**
 * EPX 한 번 = 가로세로 2배.
 *
 *   원본 픽셀 P 와 상하좌우 A(위) B(오른) C(왼) D(아래) 로 2×2 를 만든다.
 *
 *      1 2        기본은 넷 다 P
 *      3 4        C==A 이고 C!=D 이고 A!=B  → 1 = A   (왼위 대각을 메운다)
 *                 A==B 이고 A!=C 이고 B!=D  → 2 = B
 *                 D==C 이고 D!=B 이고 C!=A  → 3 = C
 *                 B==D 이고 B!=A 이고 D!=C  → 4 = D
 *
 * ★ 가장자리 밖은 자기 자신으로 본다 — 테두리에 헛대각선이 생기지 않는다.
 *
 * @param {string[]} px 행 길이가 모두 같은 문자열 배열
 * @returns {string[]} 2배 배열
 */
export function epx2x(px) {
  const rows = Array.isArray(px) ? px : [];
  const h = rows.length;
  if (!h) return [];
  const w = rows[0].length;
  const at = (y, x) => {
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
    return rows[yy][xx];
  };

  const out = [];
  for (let y = 0; y < h; y++) {
    let top = '';
    let bot = '';
    for (let x = 0; x < w; x++) {
      const p = at(y, x);
      const a = at(y - 1, x);
      const b = at(y, x + 1);
      const c = at(y, x - 1);
      const d = at(y + 1, x);
      let p1 = p;
      let p2 = p;
      let p3 = p;
      let p4 = p;
      if (c === a && c !== d && a !== b) p1 = a;
      if (a === b && a !== c && b !== d) p2 = b;
      if (d === c && d !== b && c !== a) p3 = c;
      if (b === d && b !== a && d !== c) p4 = d;
      top += p1 + p2;
      bot += p3 + p4;
    }
    out.push(top, bot);
  }
  return out;
}

/**
 * 파츠 하나를 2배로. 픽셀뿐 아니라 **크기와 앵커도** 같이 배로 만든다 —
 * 앵커(ax, ay)를 안 옮기면 조립할 때 팔다리가 어긋난다.
 *
 * @param {{w:number,h:number,ax?:number,ay?:number,px:string[],hd?:boolean}} part
 */
export function upscalePart(part) {
  if (!part || !Array.isArray(part.px)) return part;
  if (part.hd) return part;                       // 이미 고해상도로 그린 파츠
  return {
    ...part,
    w: part.w * 2,
    h: part.h * 2,
    ax: (part.ax || 0) * 2,
    ay: (part.ay || 0) * 2,
    px: epx2x(part.px),
    hd: true,                                     // 두 번 확대되지 않게 표시한다
  };
}
