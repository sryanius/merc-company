/**
 * 파츠 확대 (EPX / Scale3x)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 «단순 확대» 가 아닌가
 *   최근접 확대는 계단이 그대로 커져 «크게 만든 저해상도» 로 보인다.
 *   EPX(2배)·Scale3x(3배)는 이웃을 보고 **대각선만 메워** 실루엣을 부드럽게 한다 —
 *   픽셀아트를 위해 만들어진 규칙이라 도트 느낌이 안 죽는다.
 *
 * ★★ 이건 **발판이지 목적지가 아니다.** 파츠를 목표 해상도로 손수 다시 찍기 전까지
 *   전 파츠를 자동으로 승격시켜 게임이 계속 돌아가게 하는 장치다 (HANDOFF §50).
 *
 * ★★★ 파츠는 **자기가 몇 배로 그려졌는지 스스로 밝힌다** (`scale` 필드, 없으면 1 = 32×40 기준).
 *   예전엔 `hd: true`(«이미 고해상도») 하나였는데, 64×80 으로 그린 파츠와 96×120 으로 그린 파츠를
 *   구분할 수 없어서 해상도를 한 번 더 올리는 순간 64×80 파츠만 작게 남는다.
 *   배수를 적어 두면 **필요한 만큼만** 더 늘린다.
 *
 * ★ DOM 을 안 쓴다 — 문자열 행렬만 다룬다. 도구·테스트에서 그대로 쓴다.
 *
 * @module art/upscale
 */

/** 행렬 접근 — 바깥은 자기 자신으로 본다(테두리에 헛대각선이 안 생긴다). */
const reader = (rows, w, h) => (y, x) => rows[y < 0 ? 0 : y >= h ? h - 1 : y][x < 0 ? 0 : x >= w ? w - 1 : x];

/**
 * EPX 한 번 = 가로세로 2배.
 *
 *      1 2        기본은 넷 다 P (가운데)
 *      3 4        C==A 이고 C!=D 이고 A!=B  → 1 = A   (왼위 대각을 메운다)
 *                 A==B 이고 A!=C 이고 B!=D  → 2 = B
 *                 D==C 이고 D!=B 이고 C!=A  → 3 = C
 *                 B==D 이고 B!=A 이고 D!=C  → 4 = D
 *
 * @param {string[]} px 행 길이가 모두 같은 문자열 배열
 * @returns {string[]} 2배 배열
 */
export function epx2x(px) {
  const rows = Array.isArray(px) ? px : [];
  const h = rows.length;
  if (!h) return [];
  const w = rows[0].length;
  const at = reader(rows, w, h);

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
      let p1 = p; let p2 = p; let p3 = p; let p4 = p;
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
 * Scale3x = 가로세로 3배. EPX 를 두 번 돌리면 4배라 3배가 안 나온다.
 *
 *   A B C        E0 E1 E2
 *   D E F   -->  E3 E4 E5      가운데 E4 는 언제나 E
 *   G H I        E6 E7 E8
 *
 * @param {string[]} px
 * @returns {string[]} 3배 배열
 */
export function scale3x(px) {
  const rows = Array.isArray(px) ? px : [];
  const h = rows.length;
  if (!h) return [];
  const w = rows[0].length;
  const at = reader(rows, w, h);

  const out = [];
  for (let y = 0; y < h; y++) {
    let r0 = ''; let r1 = ''; let r2 = '';
    for (let x = 0; x < w; x++) {
      const A = at(y - 1, x - 1); const B = at(y - 1, x); const C = at(y - 1, x + 1);
      const D = at(y, x - 1); const E = at(y, x); const F = at(y, x + 1);
      const G = at(y + 1, x - 1); const H = at(y + 1, x); const I = at(y + 1, x + 1);

      const DB = D === B && B !== F && D !== H;
      const BF = B === F && B !== D && F !== H;
      const DH = D === H && D !== B && H !== F;
      const FH = F === H && D !== H && B !== F;

      r0 += (DB ? D : E) + ((DB && E !== C) || (BF && E !== A) ? B : E) + (BF ? F : E);
      r1 += ((DB && E !== G) || (DH && E !== A) ? D : E) + E + ((BF && E !== I) || (FH && E !== C) ? F : E);
      r2 += (DH ? D : E) + ((FH && E !== G) || (DH && E !== I) ? H : E) + (FH ? F : E);
    }
    out.push(r0, r1, r2);
  }
  return out;
}

/** 최근접 n배 — 2·3배 조합으로 안 떨어지는 배수의 마지막 수단. */
export function nearest(px, n) {
  const out = [];
  for (const row of px) {
    let s = '';
    for (const ch of row) s += ch.repeat(n);
    for (let k = 0; k < n; k++) out.push(s);
  }
  return out;
}

/**
 * 파츠를 목표 배율까지 올린다. 픽셀뿐 아니라 **크기와 앵커도** 같이 곱한다 —
 * 앵커(ax, ay)를 안 옮기면 조립할 때 팔다리가 어긋난다.
 *
 * @param {{w:number,h:number,ax?:number,ay?:number,px:string[],scale?:number}} part
 * @param {number} target 목표 배율 (spritegen 의 SCALE)
 */
export function upscalePart(part, target = 1) {
  if (!part || !Array.isArray(part.px)) return part;
  const from = part.scale || 1;
  if (from === target) return part;
  if (from > target) return part;               // 목표보다 크게 그려진 파츠는 안 건드린다
  const n = target / from;

  let px = part.px;
  let mul = 1;
  // 3배씩 먼저 접고 남은 것을 2배로 — Scale3x 가 EPX 두 번보다 대각선을 곱게 만든다
  let rest = n;
  while (rest % 3 === 0) { px = scale3x(px); mul *= 3; rest /= 3; }
  while (rest % 2 === 0) { px = epx2x(px); mul *= 2; rest /= 2; }
  if (rest !== 1) { px = nearest(px, rest); mul *= rest; }   // 정수배가 아니면 여기서 깨진다

  return {
    ...part,
    w: part.w * mul, h: part.h * mul,
    ax: (part.ax || 0) * mul, ay: (part.ay || 0) * mul,
    px,
    scale: from * mul,                          // 몇 배로 올라왔는지 기록한다
  };
}
