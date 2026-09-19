// §193 무대용 큰 그림 — 클래스 105 + 영웅 56 의 raw 를 **원본 해상도**로 → art/big/<name>.webp (+ <name>.mask.png) + art/big/manifest.json
//   node tools/art/bigart.mjs [--only=name,name] [--classes] [--heroes]   (아무 것도 안 주면 둘 다)
//   · 목록(illust_manifest.js)엔 안 넣는다 — 부팅 때 전부 메모리에 펴지므로(§162) 큰 그림은 «열 때만» 받는다 (src/art/bigart.js).
//   · ★ §193.3 제작자 「여전히 화질이 별로」 — 원인은 원본이 아니라 **이 파이프라인**이었다: 448×560 으로 절반 줄이고(역할별 줄이기)
//     192색으로 깎았다. 머리·옷 음영이 계단이 됐다 (머리 부분 확대 비교 실측). ⇒ 줄이지도 깎지도 않는다 (--fit=none --colors=0).
//   · 무손실 PNG 는 한 장 ~970KB 라 손실 WebP(q90, ~90KB)로 싣는다. 그런데 손실 WebP 는 머리 가장자리 색이 번져,
//     게임이 색으로 머리를 가르면 머리 픽셀 16% 가 어긋났다(실측). ⇒ **무손실 원본에서 게임의 분류 함수(`roleMaskOf`)로 마스크를 굽고**
//     게임은 그 마스크로 칠한다. 마스크는 0·1·2 를 R 채널에 0·127·254 로 담은 PNG (~10KB).
//   · 영웅은 표식이 없어(--nohair) 마스크가 없다. 영웅 무대는 장면(_scene.webp)이 먼저라 이것은 폴백이다.
//   · manifest.json 은 각성 장면 생성기와 **같이 쓰는 파일**이다 — 끝에 한 번만 읽고-합쳐-쓴다 (장면 항목은 안 건드린다).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const GAME = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const HERE = process.env.MERC_ART_DIR || 'C:/claude/artwork';
const PY = 'C:/pinokio/api/inteliweb-comfyui/app/env/Scripts/python.exe';
const OUT = `${GAME}/art/big`;
const META = `${OUT}/manifest.json`;
const TMP = `${HERE}/_bigart_tmp`;
const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const only = arg('only', '').split(',').filter(Boolean);
const all = !flag('classes') && !flag('heroes');
const QUALITY = Number(arg('q', 90)) || 90;

const { CLASSES } = await import(`file:///${GAME}/src/data/classes.js`);
await import(`file:///${GAME}/src/data/classes_t4.js`);
const { HERO_IDS } = await import(`file:///${GAME}/src/data/heroes.js`);
const { decodePng, encodePng } = await import(`file:///${GAME}/tools/lib/png.mjs`);
const { roleMaskOf } = await import(`file:///${GAME}/src/art/illustpng.js`);

const jobs = [];
/* §193.3 그림은 **언제나 원본 raw** 다 (라임 배경 — 배경 빼기가 검증된 그림). 머리를 자홍으로 다시 칠한 편집본(tools/art/remark_hair.mjs)은
 *   «머리가 어디인가» 를 알려 주는 **지도로만** 쓴다. 편집본을 그림으로 쓰면 편집 모델이 배경을 크림색으로 바꾼 그림에서
 *   배경 빼기가 밝은 피부를 파먹었다(광전사 얼굴·배, 기사 허리 — 실측). 편집본은 원본을 늘린 것뿐이라 위치가 1:1 로 맞는다
 *   (448×576 로 줄여 비교: 이동 0 에서 차이가 가장 작다). 없으면 원본의 탁한 보라 표식으로 가른다(옷이 보라면 얼룩이 질 수 있다). */
if (all || flag('classes')) for (const id of Object.keys(CLASSES)) {
  const rm = `${HERE}/gen_remark/${id}_raw.png`;
  jobs.push({ name: `illust_${id}`, raw: `${HERE}/gen/${id}_raw.png`, nohair: false, oracle: fs.existsSync(rm) ? rm : null });
}
if (all || flag('heroes')) for (const id of HERO_IDS) jobs.push({ name: `illust_hero_${id}`, raw: `${HERE}/gen_hero/${id}_raw.png`, nohair: true });

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const tmpMeta = `${TMP}/meta.json`;
const done = [];
const bad = [];
for (const j of jobs) {
  if (only.length && !only.includes(j.name)) continue;
  if (!fs.existsSync(j.raw)) { bad.push(`${j.name}: raw 없음`); continue; }
  const png = `${TMP}/${j.name}.png`;
  const a = ['tools/illustpng.mjs', j.raw, `--name=${j.name}`, '--bg=auto', '--fit=none', '--colors=0', '--alpha=soft',
    `--out=${png}`, `--metaout=${tmpMeta}`];
  if (j.nohair) a.push('--nohair');
  const r = spawnSync(process.execPath, a, { cwd: GAME, encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0 || !fs.existsSync(png)) { bad.push(`${j.name}: ${(r.stderr || '').split('\n').filter((l) => /✗/.test(l)).join(' | ').slice(0, 160)}`); continue; }
  done.push(j);
}

/**
 * §193.3 머리 가장자리의 분홍 테두리를 머리로 편입한다. 자홍 머리와 피부·옷이 섞인 경계 픽셀은 색상이 330~360° 로 밀려
 * 표식 색상대(280~330°) 밖이라 안 칠해지고 분홍 선으로 남았다 (실측: 앞머리 끝·흰 망토 위 머리카락 가닥).
 * 머리에 **붙어 있는** 보라~분홍 기운(색상 235~340° · 채도 0.12+ · 명도 0.2+) 픽셀만 iters 번 먹는다. 지도를 원본 크기로 옮길 때 생기는 1~2px 어긋남도 이것이 메운다.
 */
function growFringe(role, w, h, rgba, iters) {
  let cur = role;
  for (let it = 0; it < iters; it++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (cur[p] || rgba[p * 4 + 3] < 8) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (cur[yy * w + xx] === 1) { near = true; break; }
        }
        if (!near) continue;
        const r = rgba[p * 4] / 255, g = rgba[p * 4 + 1] / 255, b = rgba[p * 4 + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (!d || !mx) continue;
        let hh = mx === r ? ((g - b) / d) % 6 : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
        hh *= 60; if (hh < 0) hh += 360;
        if (hh >= 235 && hh <= 340 && d / mx >= 0.12 && mx >= 0.2) next[p] = 1;   // 빨강(치마 테두리)은 안 먹는다 — 기사 실측
      }
    }
    cur = next;
  }
  return cur;
}

/* ── 마스크 — 무손실 원본에서 게임의 분류로 ── */
const meta = fs.existsSync(tmpMeta) ? JSON.parse(fs.readFileSync(tmpMeta, 'utf8')) : {};
let masks = 0;
for (const j of done) {
  const e = meta[j.name];
  if (!e || !Array.isArray(e.roles) || !e.roles.length) continue;
  const src = decodePng(fs.readFileSync(`${TMP}/${j.name}.png`));
  let role = roleMaskOf({ w: src.w, h: src.h, data: src.rgba, eyeBox: e.eyeBox || null, marker: e.marker || null, roles: e.roles });
  if (j.oracle) {
    /* 지도(자홍 편집본)에서 머리를 가른다 — 같은 게임 분류 함수, 표식만 자홍(280~330°). 그리고 원본 크기로 옮긴다 (가장 가까운 칸) */
    const o = decodePng(fs.readFileSync(j.oracle));
    const om = roleMaskOf({ w: o.w, h: o.h, data: o.rgba, eyeBox: null, marker: { hair: [280, 330], eye: [165, 200] }, roles: ['hair'] });
    const next = new Uint8Array(src.w * src.h);
    /* 원본 픽셀의 보랏빛 등급 — 0 아님 · 1 약함(탁한 보라: 색상 235~335° · 채도 0.12+ · 명도 0.15+) · 2 핵심(채도 0.24+ · 명도 0.30+) */
    const tier = (p) => {
      const r0 = src.rgba[p * 4], g0 = src.rgba[p * 4 + 1], b0 = src.rgba[p * 4 + 2];
      const mx0 = Math.max(r0, g0, b0), mn0 = Math.min(r0, g0, b0), d0 = mx0 - mn0;
      if (!d0 || mx0 < 38 || d0 / mx0 < 0.12) return 0;
      let hh0 = mx0 === r0 ? ((g0 - b0) / d0) % 6 : (mx0 === g0 ? (b0 - r0) / d0 + 2 : (r0 - g0) / d0 + 4);
      hh0 *= 60; if (hh0 < 0) hh0 += 360;
      if (hh0 < 235 || hh0 > 335) return 0;
      return d0 / mx0 >= 0.24 && mx0 >= 77 ? 2 : 1;
    };
    const onMap = new Uint8Array(src.w * src.h);   // 지도가 머리라 한 칸 (원본 크기로 옮김)
    for (let y = 0; y < src.h; y++) {
      const sy = Math.min(o.h - 1, Math.floor((y + 0.5) * o.h / src.h));
      for (let x = 0; x < src.w; x++) {
        const p = y * src.w + x;
        if (src.rgba[p * 4 + 3] < 8) continue;
        if (role[p] === 2) { next[p] = 2; continue; }   // 눈은 원본 것 (청록 표식 · 눈 상자 안)
        const sx = Math.min(o.w - 1, Math.floor((x + 0.5) * o.w / src.w));
        if (om[sy * o.w + sx] === 1) onMap[p] = 1;
      }
    }
    /* ★ 지도는 «원본에서도 보랏빛» 인 곳만 믿는다. 편집 모델은 색만 바꾸지 않고 머리를 **더 길게 다시 그리기도** 한다 —
     *   기사는 원래 치마·갑옷이던 자리까지 머리를 늘어뜨렸다. 그리고 그 치마가 **보랏빛 도는 검정**이라 «보랏빛» 조건만으론 새었다.
     *   재 보니 머리는 밝고 선명(명도 0.36+ · 채도 0.30+, 하위 10%), 치마는 어둡고 탁했다(명도 0.25 · 채도 0.18).
     *   ⇒ ① 지도 ∩ 핵심(tier 2) = 확실한 머리. ② 지도 ∩ 약함(tier 1) 은 **주변 7×7 의 절반 이상이 확실한 머리일 때만** —
     *     머리 안쪽의 어두운 그늘은 들어오고, 옷 한가운데 덩어리는 주변이 옷이라 안 들어온다. */
    const W1 = src.w + 1;
    const integral = (pred) => {
      const I0 = new Uint32Array(W1 * (src.h + 1));
      for (let y = 0; y < src.h; y++) {
        let row = 0;
        for (let x = 0; x < src.w; x++) { row += pred(y * src.w + x) ? 1 : 0; I0[(y + 1) * W1 + x + 1] = I0[y * W1 + x + 1] + row; }
      }
      return I0;
    };
    const boxSum = (I0, x, y, R) => {
      const x0 = Math.max(0, x - R), x1 = Math.min(src.w - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(src.h - 1, y + R);
      return [I0[(y1 + 1) * W1 + x1 + 1] - I0[y0 * W1 + x1 + 1] - I0[(y1 + 1) * W1 + x0] + I0[y0 * W1 + x0], (x1 - x0 + 1) * (y1 - y0 + 1)];
    };
    const tiers = new Uint8Array(src.w * src.h);
    for (let p = 0; p < tiers.length; p++) if (onMap[p]) tiers[p] = tier(p);
    for (let p = 0; p < tiers.length; p++) if (onMap[p] && tiers[p] === 2) next[p] = 1;
    /* ★ 얼굴 둘레(머리통)에서는 지도를 **색과 무관하게** 믿는다. 성직자 윗머리는 짙은 남색이라 원본 색으로는 «보랏빛 검정 옷» 과
     *   구분이 안 됐다(기사 치마 덩어리와 색·지도·명암 무늬까지 같았다 — 실측). 둘을 가르는 것은 **자리**다: 머리통의 머리는 눈 위·옆,
     *   옷으로 번진 것은 허리 아래. 머리통 = 눈 상자 가운데에서 눈 폭의 2.2배 좌우 · 위로는 끝까지 · 아래로는 눈 폭의 1.2배.
     *   눈 상자가 없으면(눈 감은 그림) 지도 머리 상자의 위 25% 를 머리통으로 본다. */
    {
      let hx0, hx1, hy1;
      if (e.eyeBox) {
        const [ex0, , ex1, ey1] = e.eyeBox;
        const ew = Math.max(40, ex1 - ex0), cx = (ex0 + ex1) / 2;
        hx0 = cx - ew * 2.2; hx1 = cx + ew * 2.2; hy1 = ey1 + ew * 1.2;
      } else {
        let bx0 = src.w, by0 = src.h, bx1 = -1, by1 = -1;
        for (let p = 0; p < onMap.length; p++) if (onMap[p]) { const x = p % src.w, y = (p / src.w) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
        hx0 = bx0; hx1 = bx1; hy1 = by0 + (by1 - by0) * 0.25;
      }
      for (let p = 0; p < onMap.length; p++) {
        if (!onMap[p] || next[p]) continue;
        const x = p % src.w, y = (p / src.w) | 0;
        if (x >= hx0 && x <= hx1 && y <= hy1) next[p] = 1;
      }
    }
    /* 분모는 **불투명 칸만** 센다 — 머리 바깥 가장자리는 이웃 절반이 투명 배경이라 안 그러면 늘 떨어졌다 (성직자 윗머리의 검은 줄, 실측).
     *   더 붙을 게 없을 때까지(최대 20회) 되풀이해 안쪽부터 채운다 — 다수결이라 곧은 경계 너머(옷)로는 번지지 않는다 (경계 바로 밖 칸은 이웃의 3/7 만 머리). */
    const Io = integral((p) => src.rgba[p * 4 + 3] >= 8);
    for (let it = 0; it < 20; it++) {   // 두꺼운 어두운 그늘(성직자 윗머리)은 3회로는 안쪽까지 못 채웠다 — 더 붙을 게 없을 때까지
      const Ic = integral((p) => next[p] === 1);
      const add = [];
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const p = y * src.w + x;
        /* tier 0(보랏빛조차 없는 거의 검정 머리 — 성직자 윗머리)도 같은 다수결로 들어온다. 옷 한가운데는 주변이 옷이라 안 들어온다 */
        if (next[p] || !onMap[p] || tiers[p] === 2) continue;
        const c = boxSum(Ic, x, y, 3)[0], opq = boxSum(Io, x, y, 3)[0];
        if (c * 2 >= opq) add.push(p);
      }
      if (!add.length) break;
      for (const p of add) next[p] = 1;
    }
    /* 지도가 놓친 가는 가닥 — 원본의 보라 표식(role 1) 중 **확실한 머리에서 NEAR px 안**이고 **핵심 보라**인 것만 편입한다.
     *   멀리 떨어진 보라(드레스)는 안 먹는다 (세계수의 궁성 목 부근 보라 잔여, 실측). 기사 갑옷 그늘(명도 0.23·채도 0.21)은 핵심이 아니다. */
    const NEAR = 6;
    {
      const In = integral((p) => next[p] === 1);
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const p = y * src.w + x;
        if (next[p] || role[p] !== 1 || tier(p) !== 2) continue;
        if (boxSum(In, x, y, NEAR)[0] > 0) next[p] = 1;
      }
    }
    role = growFringe(next, src.w, src.h, src.rgba, 2);
  }
  const out = new Uint8Array(src.w * src.h * 4);
  for (let p = 0; p < role.length; p++) { out[p * 4] = role[p] * 127; out[p * 4 + 3] = 255; }
  fs.writeFileSync(`${OUT}/${j.name}.mask.png`, encodePng(src.w, src.h, Buffer.from(out.buffer)));
  masks++;
}

/* ── WebP — 한 번의 파이썬으로 전부 ── */
const list = done.map((j) => [`${TMP}/${j.name}.png`, `${OUT}/${j.name}.webp`]);
fs.writeFileSync(`${TMP}/list.json`, JSON.stringify(list));
const py = [
  'import json, sys',
  'from PIL import Image',
  `for s, d in json.load(open(r'${TMP}/list.json')):`,
  `    Image.open(s).convert('RGBA').save(d, 'WEBP', quality=${QUALITY}, method=6, alpha_quality=100)`,
  "print('ok')",
].join('\n');
const g = spawnSync(PY, ['-c', py], { encoding: 'utf8', maxBuffer: 1 << 24 });
if (g.status !== 0) { console.error('WebP 변환 실패', (g.stderr || '').slice(-300)); process.exit(1); }

/* ── manifest 합치기 — 끝에 한 번. 장면(scene) 항목은 안 건드린다 ── */
const cur = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};
for (const j of done) {
  const e = meta[j.name];
  if (!e) continue;
  const hasMask = fs.existsSync(`${OUT}/${j.name}.mask.png`) && Array.isArray(e.roles) && e.roles.length > 0;
  cur[j.name] = { ...e, file: `${j.name}.webp`, ...(hasMask ? { mask: `${j.name}.mask.png` } : {}) };
  /* 옛 448×560 PNG 는 지운다 — 남겨 두면 스모크가 «쓰지 않는 파일» 로 문다 */
  const old = `${OUT}/${j.name}.png`;
  if (fs.existsSync(old)) fs.unlinkSync(old);
}
fs.writeFileSync(META, JSON.stringify(cur, null, 1));
fs.rmSync(TMP, { recursive: true, force: true });
console.error(`완료: ${done.length}장 (마스크 ${masks}) · 실패 ${bad.length}${bad.length ? '\n  ' + bad.join('\n  ') : ''}`);
process.exit(bad.length ? 1 : 0);
