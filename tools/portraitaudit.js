/* 세로 전투(폰) 실측 하네스 — **브라우저 전용**. (12차 세션 신설)
 *
 * `tools/portrait.mjs` 는 헤드리스 계산기다. 이 파일은 그 계산이 실제 브라우저에서
 * 맞는지 확인하는 **실측**기다. 두 값이 어긋나면 계산기 쪽을 고쳐라.
 *
 * ── 왜 프레임을 직접 펌프하는가 (HANDOFF §4)
 *   Browser 창이 표시되지 않으면 `document.hidden === true` 라 rAF 가 멈춘다.
 *   rAF 를 setTimeout 으로 갈아 끼워도 백그라운드 탭은 몇 분 뒤 "intensive throttling"
 *   으로 타이머가 분당 1회까지 떨어진다 — 실제로 이 함정에 빠져 캡처가 0건이 됐다.
 *   그래서 이 하네스는 화면을 띄워 DOM 크기만 읽고, **자기 렌더러를 만들어 동기 루프로
 *   펌프한다.** UI 루프는 `battle.dispose()` 로 끈다(DOM 은 그대로 남는다).
 *
 * ── 좌표 단위 세 가지를 섞지 마라 (이 파일에서 실제로 한 번 틀렸다)
 *   · 백킹 픽셀   : `getTransform()` 이 돌려주는 값. dpr 이 곱해져 있다.
 *   · 캔버스 논리 : `ctx.font` 의 px, 렌더러 코드 안의 좌표. setTransform(dpr,…) 이후 단위.
 *   · CSS px      : 사람이 보는 크기. 판정은 전부 이 단위로 한다.
 *   백킹 -> CSS 는 `cssW / canvas.width`, 논리 -> CSS 는 `cssW / logicalW` 다.
 *
 * ── 사용법 (개발 서버로 띄운 뒤 콘솔에서)
 *   const A = await import('/tools/portraitaudit.js');
 *   const r = await A.run();            // 7대7 전투를 만들고 프레임을 펌프해 실측
 *   A.brief(r);                          // 요약
 *   await A.restore();                   // 측정용으로 바꾼 상태 되돌리기
 */

const SPRITE_W = 32, SPRITE_H = 40;
/** 화면상 스프라이트 셀 폭 목표 (ui/battle.js PHONE_SPRITE_PX 와 같은 값) */
const PHONE_SPRITE_PX = 70;
/** HP 바 채움에 쓰이는 색 (renderer.js drawPlate) */
const HP_COLORS = new Set(['#6fbe7a', '#d6b64a', '#cf5a5a', '#c9584f', '#c98a3a', '#8e3a3a']);

/** 겹침 비율 = 교집합 넓이 / 작은 쪽 사각형 넓이 */
function overlapRatio(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

function pairs(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const v = overlapRatio(list[i], list[j]);
      if (v > 0) out.push({ i, j, ratio: v });
    }
  }
  out.sort((a, b) => b.ratio - a.ratio);
  return out;
}

let snapshot = null;

/** 측정용 7대7 을 만든다. 원래 상태는 `restore()` 로 되돌린다. */
export async function setup() {
  const St = await import('/src/game/state.js');
  const M = await import('/src/game/merc.js');
  const { RNG } = await import('/src/core/rng.js');
  const st = St.state;
  const sq = st.squads[0];
  const q = st.quests[st.cityId].list[0];
  if (!snapshot) {
    snapshot = {
      raw: localStorage.getItem('merc_company_save_v1'),
      roster: st.roster.filter((m) => !String(m.uid).startsWith('mc_audit_')),
      members: sq.memberUids.slice(),
      formationId: sq.formationId,
      wave: JSON.parse(JSON.stringify(q.waves[0])),
      questId: q.id,
    };
  }
  // 시드를 고정한다 — 폰/PC 를 같은 전투로 비교해야 겹침 수치가 의미를 갖는다.
  const r = new RNG(0x51ce);
  const classes = ['knight', 'soldier', 'lancer', 'archer', 'rogue', 'apprentice', 'acolyte'];
  st.roster = snapshot.roster.slice();
  sq.memberUids = new Array(7).fill(null);
  sq.formationId = 'basic';
  for (let i = 0; i < 7; i++) {
    const m = M.createMerc({ classId: classes[i], grade: 'C', level: 20, rng: r });
    m.uid = `mc_audit_${i}`;
    st.roster.push(m);
    sq.memberUids[i] = m.uid;
  }
  const ids = ['gray_wolf', 'goblin_grunt', 'goblin_archer', 'gray_wolf', 'goblin_grunt', 'goblin_archer', 'gray_wolf'];
  q.waves[0].units = ids.map((enemyId, i) => ({ enemyId, level: 20, slotIndex: i }));
  q.waves[0].formationId = 'basic';
  return { questId: q.id, squadId: sq.id };
}

/**
 * setup() 이 바꾼 상태를 되돌린다.
 * ★ `run()` 이 끝날 때 자동으로 불린다. 안 되돌리면 측정용 단원 7명이 세이브에 쌓인다
 *   (실제로 정원 40 짜리 세이브가 77명이 되는 일을 겪었다).
 */
export async function restore() {
  if (!snapshot) return false;
  const St = await import('/src/game/state.js');
  const st = St.state;
  st.roster = snapshot.roster.filter((m) => !String(m.uid).startsWith('mc_audit_'));
  st.squads[0].memberUids = snapshot.members;
  st.squads[0].formationId = snapshot.formationId;
  const q = (st.quests[st.cityId].list || []).find((x) => x.id === snapshot.questId);
  if (q) q.waves[0] = snapshot.wave;
  if (snapshot.raw != null) localStorage.setItem('merc_company_save_v1', snapshot.raw);
  snapshot = null;
  return true;
}

/**
 * 캔버스 **논리** 크기를 역산한다.
 * `ui/battle.js stageSpec()` 은 export 되지 않으므로, 실제 백킹 스토어와
 * "논리 크기는 10px 배수" 라는 규약으로 되짚는다. PC 는 항상 1280x560 이다.
 */
export function logicalSize(canvas, narrowPx = 767) {
  const cssW = canvas.getBoundingClientRect().width;
  const cssH = canvas.getBoundingClientRect().height;
  if (window.innerWidth > narrowPx) {
    return { logicalW: 1280, logicalH: 560, cssW, cssH };
  }
  const logicalW = Math.min(640, Math.max(340, Math.round((cssW * 96) / PHONE_SPRITE_PX / 10) * 10));
  const scale = canvas.width / logicalW;
  const logicalH = Math.round(canvas.height / scale / 10) * 10;
  return { logicalW, logicalH, cssW, cssH };
}

/** 스프라이트 프레임의 실제(불투명) 경계 상자 — 32x40 셀 안의 논리 좌표 */
function alphaBox(src, sx, sy) {
  const cv = document.createElement('canvas');
  cv.width = SPRITE_W; cv.height = SPRITE_H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, sx, sy, SPRITE_W, SPRITE_H, 0, 0, SPRITE_W, SPRITE_H);
  const d = g.getImageData(0, 0, SPRITE_W, SPRITE_H).data;
  let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      if (d[(y * SPRITE_W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, w: SPRITE_W, h: SPRITE_H };
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 실측.
 * @param {{frames?:number, at?:number[]}} opt at = 캡처할 프레임 번호들
 *        (0 = 전투 시작 진형 그대로 / 큰 값 = 교전 중 뭉친 상태)
 */
export async function run(opt = {}) {
  const frames = opt.frames == null ? 130 : opt.frames;
  const at = opt.at || [0, 30, 100];
  const want = new Set(at);

  const ids = await setup();
  const app = await import('/src/ui/app.js');
  const battleUI = await import('/src/ui/battle.js');
  const { createRenderer } = await import('/src/battle/renderer.js');
  const { createBattle, setSkillResolver } = await import('/src/battle/engine.js');
  const { getSkill } = await import('/src/data/skills.js');
  const Q = await import('/src/game/quest.js');
  const St = await import('/src/game/state.js');

  await app.go('battle', { questId: ids.questId, squadId: ids.squadId });
  await new Promise((r) => setTimeout(r, 300));
  const canvas = document.querySelector('.battle-stage canvas');
  if (!canvas) throw new Error('전투 캔버스를 찾지 못했다');
  const size = logicalSize(canvas);
  battleUI.dispose();                       // UI 루프 정지 (DOM 은 그대로 남는다)

  setSkillResolver(getSkill);
  const quest = (St.state.quests[St.state.cityId].list || []).find((x) => x.id === ids.questId);
  const cfg = Q.questBattleDefs(quest, 0, St.state, ids.squadId);
  cfg.getSkill = getSkill;
  const b = createBattle(cfg);
  const r = createRenderer(canvas, { width: size.logicalW, height: size.logicalH, biome: quest.biome });
  r.setBattle(b);

  /* ── draw 호출 가로채기 ── */
  const P = CanvasRenderingContext2D.prototype;
  const oDraw = P.drawImage, oFill = P.fillRect, oText = P.fillText, oStroke = P.strokeRect;
  let cap = null;
  const rectOf = (t, x0, y0, w, h) => {
    const p1 = { x: t.a * x0 + t.c * y0 + t.e, y: t.b * x0 + t.d * y0 + t.f };
    const p2 = { x: t.a * (x0 + w) + t.c * (y0 + h) + t.e, y: t.b * (x0 + w) + t.d * (y0 + h) + t.f };
    return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
  };
  P.drawImage = function (...a) {
    if (cap && this.canvas === canvas && a.length === 9 && a[3] === SPRITE_W && a[4] === SPRITE_H) {
      cap.sprites.push({ ...rectOf(this.getTransform(), a[5], a[6], a[7], a[8]), src: a[0], sx: a[1], sy: a[2] });
    }
    return oDraw.apply(this, a);
  };
  P.fillRect = function (x, y, w, h) {
    if (cap && this.canvas === canvas && typeof this.fillStyle === 'string' && HP_COLORS.has(this.fillStyle)) {
      cap.hpFill.push(rectOf(this.getTransform(), x, y, w, h));
    }
    return oFill.call(this, x, y, w, h);
  };
  // HP 바 테두리 = 바의 **전체** 폭. 채움(fillRect)은 현재 HP 비율만큼이라 폭 측정에 못 쓴다.
  P.strokeRect = function (x, y, w, h) {
    if (cap && this.canvas === canvas && this.strokeStyle === 'rgba(0, 0, 0, 0.6)') {
      cap.hpFrame.push(rectOf(this.getTransform(), x, y, w, h));
    }
    return oStroke.call(this, x, y, w, h);
  };
  // ★ 글자 크기는 `ctx.font` 문자열만 보면 안 된다. 말풍선처럼 `g.scale(us,us)` 를 걸고
  //   그리는 곳이 있어서, 변환 행렬의 배율을 곱해야 실제로 화면에 뜨는 크기가 나온다
  //   (이걸 빼먹고 재서 말풍선이 8.8px 로 보이는 오측을 한 번 했다).
  P.fillText = function (t, x, y, mw) {
    if (cap && this.canvas === canvas) {
      const m = this.getTransform();
      cap.texts.push({ text: String(t), font: this.font, k: Math.hypot(m.a, m.b) });
    }
    return oText.call(this, t, x, y, mw);
  };

  const shots = new Map();
  for (let i = 0; i < frames; i++) {
    if (want.has(i)) cap = { sprites: [], hpFill: [], hpFrame: [], texts: [] };
    if (i > 0 && !b.finished) b.step(1 / 60);
    b.drainEvents();
    r.update(i === 0 ? 0 : 1 / 60);
    r.draw();
    if (want.has(i)) { shots.set(i, cap); cap = null; }
  }
  P.drawImage = oDraw; P.fillRect = oFill; P.fillText = oText; P.strokeRect = oStroke;

  /* ── 단위 변환 ── */
  const kBack = size.cssW / canvas.width;        // 백킹 -> CSS
  const kLog = size.cssW / size.logicalW;        // 캔버스 논리 -> CSS
  const cssRect = (o) => ({ x: o.x * kBack, y: o.y * kBack, w: o.w * kBack, h: o.h * kBack });
  const fontPx = (f) => { const m = /(\d+(?:\.\d+)?)px/.exec(f || ''); return m ? Number(m[1]) : 0; };

  const out = {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    canvas: {
      logical: [size.logicalW, size.logicalH],
      css: [+size.cssW.toFixed(1), +size.cssH.toFixed(1)],
      backing: [canvas.width, canvas.height],
    },
    portrait: r.portrait,
    uiScale: +r.uiScale.toFixed(4),
    kLog: +kLog.toFixed(5),
    frames: {},
  };

  for (const [i, f] of shots) {
    const cells = f.sprites.map(cssRect);
    const bodies = f.sprites.map((s) => {
      const bb = alphaBox(s.src, s.sx, s.sy);
      const ux = s.w / SPRITE_W, uy = s.h / SPRITE_H;
      return cssRect({ x: s.x + bb.x0 * ux, y: s.y + bb.y0 * uy, w: bb.w * ux, h: bb.h * uy });
    });
    const texts = {};
    for (const t of f.texts) {
      // 글꼴 px(로컬 단위) x 변환 배율 = 백킹 픽셀 -> CSS px
      // 팝업·말풍선은 커진 상태에서 1.0 배로 줄어든다 — **가장 작을 때**로 잰다(보수적).
      const px = +(fontPx(t.font) * t.k * kBack).toFixed(2);
      if (texts[t.text] == null || texts[t.text] > px) texts[t.text] = px;
    }
    // 이름표는 오프스크린에 구워서 blit 하므로 위 훅에 안 잡힌다 — 배율로 환산한다
    // (renderer.js FS_NAME 12 · FS_LV 10 x uiScale).
    texts['[이름표]'] = +(12 * r.uiScale * kLog).toFixed(2);
    texts['[Lv]'] = +(10 * r.uiScale * kLog).toFixed(2);
    const cellW = cells.map((c) => c.w).sort((a, c) => a - c);
    const frames0 = f.hpFrame.map(cssRect);
    out.frames[i] = {
      units: cells.length,
      spriteCellCssPx: { min: +cellW[0].toFixed(2), median: +cellW[cellW.length >> 1].toFixed(2), max: +cellW[cellW.length - 1].toFixed(2) },
      spriteBodyCssPx: +Math.max(...bodies.map((x) => x.w)).toFixed(2),
      cellOverlap: pairs(cells),
      bodyOverlap: pairs(bodies),
      hpBarCssPx: frames0.length ? { w: +frames0[0].w.toFixed(2), h: +frames0[0].h.toFixed(2), n: frames0.length } : null,
      textCssPx: texts,
      cells, bodies,
    };
  }

  r.dispose();
  await restore();          // 측정용 단원·웨이브가 세이브에 남지 않게 한다
  return out;
}

/** 콘솔 요약 */
export function brief(res) {
  const rows = [];
  for (const k of Object.keys(res.frames)) {
    const f = res.frames[k];
    const bo = f.bodyOverlap;
    const texts = Object.values(f.textCssPx);
    rows.push({
      frame: k,
      units: f.units,
      '스프라이트(CSS px)': f.spriteCellCssPx.median,
      '몸통폭': f.spriteBodyCssPx,
      '몸통겹침 쌍': bo.length,
      '최대겹침': bo.length ? +bo[0].ratio.toFixed(3) : 0,
      '겹침>0.5': bo.filter((o) => o.ratio > 0.5).length,
      'HP바': f.hpBarCssPx ? `${f.hpBarCssPx.w}x${f.hpBarCssPx.h}` : '-',
      '최소글자': texts.length ? Math.min(...texts) : '-',
    });
  }
  console.log(`뷰포트 ${res.viewport.w}x${res.viewport.h} · 캔버스 논리 ${res.canvas.logical.join('x')} · CSS ${res.canvas.css.join('x')} · portrait=${res.portrait} · uiScale=${res.uiScale}`);
  console.table(rows);
  return rows;
}

export default run;
