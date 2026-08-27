/**
 * 아이템 스탯이 **게임이 만들 수 있는 값인가** — 정확히 되짚는다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 있나 — §104 1단계의 명분이 여기 걸려 있었다.
 *
 *   서버가 부대 전력을 스스로 세게 돼도(§110), 그 계산이 읽는 `item.stats` 는
 *   **클라가 적어 보낸 값**이다. `merc.js:578` 이 `it.stats[k]` 를 검증 없이 그대로 더하고,
 *   `runrows` 는 `stats` 를 `data jsonb` 에 통째로 넣는다.
 *   ⇒ 그대로 두면 「서버가 센다」 는 **위조된 스탯을 서버가 성실히 센다** 는 뜻이다.
 *   db/013:106-108 의 「data.stats 는 서버가 굴린 값이다」 는 아직 참이 아니었다.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ 그런데 **상한(envelope)이 필요 없었다.** 재 보니 아이템은 결정론이다.
 *
 *   PvP 의 `statbound.js` 는 「접사가 `rng.float(min,max)` 라 서버가 되살릴 수 없다」 며
 *   배율 상한으로 눌렀다. **지금은 그 전제가 안 맞는다** — 실측:
 *
 *     · 접사 정의 60개의 스탯 값 108개 중 **배열(굴림)이 0개**다. 전부 스칼라다.
 *       ⇒ `resolveAffixStats` 에 무작위가 **아예 없다.**
 *     · `baseStats` 는 (baseId, ilvl, rarity) 로 **완전한 결정론** (200회 굴려 1가지).
 *     · `stats == baseStats + Σ접사` 가 **6000/6000** · 세트 **72/72** 로 성립.
 *
 *   ⇒ 접사 **id 만 알면** 그 스탯을 정확히 다시 만들 수 있다.
 *     「가능한 범위인가」 가 아니라 **「그 값이 맞는가」** 를 물을 수 있다.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ 무엇을 묻나 (전부 정확한 대조다 — 여유값이 없다)
 *
 *   ① `baseId` 가 실재하나. ★ 없으면 `rollItem` 이 **무작위 베이스로 대체**해 버려서
 *      아무 값이나 통과한다 (재다가 실제로 걸렸다 — 없는 id 를 넣었더니 17가지가 나왔다).
 *   ② `baseStats` 가 (baseId, ilvl, rarity) 로 만든 값과 같나.
 *   ③ 접사 하나하나가 실재하는 접사이고, 그 스탯이 (정의, ilvl, slot) 재계산과 같나.
 *   ④ `stats == baseStats + Σ접사` 인가.
 *   ⑤ 접사 개수가 희귀도가 허용하는 만큼인가.
 *
 * ★ 판단만 한다 — 고치거나 지우지 않는다. 쓰는 쪽이 정한다
 *   (이관에서 거절할지, 낮은 쪽으로 깎을지, 표시만 할지).
 *
 * ★★ **import 가 0개다.** 게임 모듈을 인자로 받는다 — 그래서 서버 묶음(`_power`)에
 *   넣어도 닫힘이 한 파일도 안 늘어난다. 그게 이 모양을 고른 이유다.
 *
 * @module game/itembound
 */

/** 소수 비교 — 접사는 `Math.round(x*10)/10` 이라 0.05 면 넉넉하다 */
const EPS = 0.05;

/** 스탯 두 벌이 같은가 */
function sameStats(a, b) {
  const A = a || {}; const B = b || {};
  const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
  const bad = [];
  for (const k of keys) {
    const x = Number(A[k]) || 0; const y = Number(B[k]) || 0;
    if (Math.abs(x - y) > EPS) bad.push(`${k} ${x} ≠ ${y}`);
  }
  return bad;
}

function sumStats(baseStats, affixes) {
  const out = { ...(baseStats || {}) };
  for (const a of affixes || []) {
    for (const [k, v] of Object.entries((a && a.stats) || {})) out[k] = (out[k] || 0) + Number(v || 0);
  }
  /* 접사 합산은 소수를 더하므로 자릿수를 맞춘다 (0.1+0.2 문제) */
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 1000) / 1000;
  return out;
}

/**
 * 검사기를 만든다. 게임 모듈을 **주입받는다** — 이 파일이 `src/` 를 직접 물면
 * 서버 묶음(`_power`)의 닫힘이 흔들린다.
 *
 * @param {object} deps
 * @param {object} deps.gear   `src/game/gear.js` (getBase · rollItem · rollSetItem)
 * @param {object} deps.items  `src/data/items.js` (PREFIXES · SUFFIXES · scaleAffixStats)
 * @param {object} [deps.sets] `src/data/sets.js` (getSet — 세트 아이템 판별)
 * @param {object} [deps.rng]  결정론이라 아무 rng 나 된다. 없으면 만들어 쓴다.
 */
export function makeItemBound({ gear, items, sets = null, rng = null }) {
  /* 접사 id → 정의. PREFIXES·SUFFIXES 는 **데이터**라 여기서 색인해도 «사본» 이 아니다
   * (계산식은 여전히 items.js 의 scaleAffixStats 하나뿐이다). */
  const AFFIX = new Map();
  for (const a of [...(items.PREFIXES || []), ...(items.SUFFIXES || [])]) {
    if (a && a.id) AFFIX.set(a.id, a);
  }

  /* rng 는 «있어야 부를 수 있어서» 넣는 것이다 — `baseStats` 는 결정론이라 결과에 영향이 없다.
   * ★★ **손으로 만든 가짜 rng 를 쓰지 마라.** 처음에 그렇게 했다가 `rng.weighted is not a
   *   function` 으로 8000개 중 6154개를 오탐했다. `rollItem` 이 rng 의 어떤 메서드를 부르는지는
   *   앞으로도 늘어날 수 있다 — **진짜 RNG 를 받는다.** */
  const anyRng = rng;
  if (!anyRng || typeof anyRng.next !== 'function') {
    throw new Error('makeItemBound: 진짜 RNG 인스턴스를 넘겨라 (src/core/rng.js 의 RNG). '
      + '가짜 객체를 쓰면 rollItem 이 부르는 메서드가 없어 전부 오탐한다.');
  }

  /** 희귀도가 허용하는 접사 최대 개수 — 실측: r0=0 · r1=1 · r2=2 · r3=3 · r4·r5=4 */
  const maxAffixes = (rarity) => Math.min(4, Math.max(0, Math.round(Number(rarity) || 0)));

  /**
   * 아이템 하나를 되짚는다.
   * @returns {{ok: boolean, problems: string[], expected: object|null}}
   */
  function verifyItem(it) {
    const problems = [];
    if (!it || typeof it !== 'object') return { ok: false, problems: ['아이템이 아니다'], expected: null };

    const ilvl = Math.round(Number(it.ilvl) || 0);
    const rarity = Math.round(Number(it.rarity) || 0);
    const slot = it.slot;

    /* ════════════════════════════════════════════════════════════════════
     * 세트 파츠는 **다른 길로 간다.**
     *
     *   `baseId` 가 `set_<setId>_<slot>` 규약이고 `ITEM_BASES` 에 없다
     *   (`sets.js` 의 `setPieceItem` 이 완성품을 준다). `getBase` 로 찾으면 전부 거절된다 —
     *   처음에 그렇게 짰다가 세트 108개를 통째로 오탐했다.
     *
     * ★ 대신 **더 강하게** 검사할 수 있다: 완성품이 결정론이라
     *   `stats`·`baseStats`·`affixes` 를 **통째로** 대조한다. 접사 규칙이 필요 없다.
     * ════════════════════════════════════════════════════════════════════ */
    const setRef = sets && typeof sets.parseSetBaseId === 'function' ? sets.parseSetBaseId(it.baseId) : null;
    if (setRef) {
      if (typeof sets.setPieceItem !== 'function') {
        return { ok: false, problems: ['세트 파츠 생성기(setPieceItem)가 없다'], expected: null };
      }
      let want = null;
      try {
        want = sets.setPieceItem(setRef.setId, setRef.slot, ilvl, { weaponType: it.weaponType || null });
      } catch (e) {
        return { ok: false, problems: [`세트 파츠를 다시 만들다 터졌다: ${(e && e.message) || e}`], expected: null };
      }
      if (!want) return { ok: false, problems: [`세트 파츠 ${it.baseId} 를 못 만든다`], expected: null };

      for (const [label, mine, theirs] of [
        ['stats', it.stats, want.stats],
        ['기본 스탯', it.baseStats, want.baseStats],
      ]) {
        const d = sameStats(mine, theirs);
        if (d.length) problems.push(`${label}이 세트 정의와 다르다 — ${d.join(' · ')}`);
      }
      /* 세트 파츠의 접사는 정의가 준 것 그대로여야 한다 */
      const mineAf = JSON.stringify((it.affixes || []).map((a) => [a && a.id, a && a.stats]));
      const wantAf = JSON.stringify((want.affixes || []).map((a) => [a && a.id, a && a.stats]));
      if (mineAf !== wantAf) problems.push('세트 파츠의 접사가 정의와 다르다');
      if (Number(it.rarity) !== Number(want.rarity)) {
        problems.push(`희귀도 ${it.rarity} ≠ 세트 정의 ${want.rarity}`);
      }
      return { ok: problems.length === 0, problems, expected: want };
    }

    /* ① 베이스가 실재하나 — ★ 없으면 rollItem 이 무작위 베이스로 대체한다 */
    const base = gear.getBase(it.baseId);
    if (!base) {
      problems.push(`베이스 ${JSON.stringify(it.baseId)} 가 없다`);
      return { ok: false, problems, expected: null };
    }
    if (slot && base.slot && slot !== base.slot && !(base.slot === 'ring' && /^ring/.test(slot))) {
      problems.push(`슬롯 ${slot} 이 베이스의 슬롯 ${base.slot} 과 다르다`);
    }
    if (!(ilvl >= 1)) problems.push(`ilvl ${it.ilvl} 이 이상하다`);
    if (!(rarity >= 0)) problems.push(`희귀도 ${it.rarity} 가 이상하다`);

    /* ② baseStats — (baseId, ilvl, rarity) 로 다시 만든다. 결정론이다. */
    let ref = null;
    try {
      const isSet = !!(it.setId && sets && typeof sets.getSet === 'function' && sets.getSet(it.setId));
      ref = isSet
        ? gear.rollSetItem({ setId: it.setId, slot: base.slot, ilvl, rng: anyRng })
        : gear.rollItem({ baseId: base.id, ilvl, rarity, rng: anyRng });
    } catch (e) {
      problems.push(`다시 만들다 터졌다: ${(e && e.message) || e}`);
    }
    if (ref) {
      const d = sameStats(it.baseStats, ref.baseStats);
      if (d.length) problems.push(`기본 스탯이 다르다 — ${d.join(' · ')}`);
    }

    /* ⑤ 접사 개수 */
    const affixes = Array.isArray(it.affixes) ? it.affixes : [];
    const cap = maxAffixes(rarity);
    /* ★ 세트·고유 아이템은 자기 접사를 갖는다 (kind: 'set'/'unique') — 개수 규칙이 다르다.
     *   그 경우는 위 ② 에서 통째로 대조했으므로 여기서 또 세지 않는다. */
    const rolled = affixes.filter((a) => a && a.kind !== 'set' && a.kind !== 'unique');
    if (rolled.length > cap) problems.push(`접사 ${rolled.length}개 (희귀도 ${rarity} 상한 ${cap})`);

    /* ③ 접사 하나하나 — 정의를 찾아 (ilvl, slot) 로 다시 계산한다 */
    for (const a of rolled) {
      const def = AFFIX.get(a && a.id);
      if (!def) { problems.push(`접사 ${JSON.stringify(a && a.id)} 가 없다`); continue; }
      let want = null;
      try {
        want = typeof items.scaleAffixStats === 'function'
          ? items.scaleAffixStats(def.stats || def.mods || {}, ilvl, base.slot)
          : null;
      } catch (e) { problems.push(`접사 ${a.id} 재계산 실패: ${(e && e.message) || e}`); continue; }
      if (!want) { problems.push('접사 계산기(scaleAffixStats)가 없다'); continue; }
      const d = sameStats(a.stats, want);
      if (d.length) problems.push(`접사 ${a.id} 의 값이 다르다 — ${d.join(' · ')}`);
    }

    /* ④ 항등식 — 이걸 어기면 `stats` 를 손으로 부풀린 것이다 */
    const d4 = sameStats(it.stats, sumStats(it.baseStats, affixes));
    if (d4.length) problems.push(`stats ≠ 기본 + 접사합 — ${d4.join(' · ')}`);

    return { ok: problems.length === 0, problems, expected: ref };
  }

  /** 여러 개를 한 번에. `{uid, problems}` 만 모은다 */
  function verifyAll(list) {
    const out = [];
    for (const it of list || []) {
      const r = verifyItem(it);
      if (!r.ok) out.push({ uid: (it && it.uid) || '(uid 없음)', problems: r.problems });
    }
    return out;
  }

  return { verifyItem, verifyAll, maxAffixes };
}
