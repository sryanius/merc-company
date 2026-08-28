/**
 * `run-op` — 서버가 진행도를 **직접 고치는** 첫 함수 (§104 1단계 3번)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 지금까지 서버는 «클라가 신고한 것을 판정» 하기만 했다. 여기서부터 서버가
 *   `run_*` 을 **쓴다.** 그래서 지켜야 할 것이 늘어난다.
 *
 * ★ 규칙 표를 SQL 로 베끼지 않는다. `promoteOptions` 는 `src/data/classes.js` 에 있고,
 *   그것을 plpgsql 로 옮기면 저장소에 넷째 사본이 생긴다 (§94·§98·§107).
 *   `_rules` 묶음(2개 61KB)을 그대로 import 한다 — `tools/syncshared.mjs` 가 동기화한다.
 *
 * ★★ **멱등성.** 네트워크가 끊기면 클라는 «실패했다» 고 보지만 서버는 이미 썼을 수 있다.
 *   그래서 모든 op 은 `op_id` 를 갖고, 같은 `op_id` 로 다시 오면 **다시 하지 않고
 *   지난 결과를 그대로 돌려준다.** `run_ops` 가 그 원장이다 (db/015).
 *   ★ `promote` 자체는 같은 대상으로 두 번 부르면 두 번째가 막힌다(실측) — 그래도
 *     멱등성 키가 필요한 이유는 «막혔다» 와 «이미 됐다» 를 클라가 구별해야 하기 때문이다.
 *
 * ★ 응답에 사유를 실을 때도 «서버가 무엇을 아는지» 를 흘리지 않는다 (§55).
 *   전직은 판정이 아니라 **행동**이라 사유를 주는 게 맞다 — 사람이 고쳐서 다시 눌러야 한다.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CLASSES, getClass, promoteOptions } from './_rules/classes.js';
/* ★★ 판정부를 손으로 다시 쓰지 않는다 — 게임이 쓰는 그 함수를 그대로 부른다.
 *   손으로 옮겼다가 세 번 틀린 적이 있다 (§124). */
import { isSellable, equipIssue, getBase, sellPrice } from './_rules/gear.js';
/* ★★ 하루 넘기기도 **사본을 안 만든다** — `game/day.js` 를 그대로 부른다.
 *   그 모듈은 `state.js` 를 안 물고 상태를 인자로 받는다 (§104 14단계). */
import { advanceDays, dailyUpkeep, bindDay } from './_rules/day.js';
import { fromRows } from './_rules/runrows.js';
import { gradeRoll, createMerc, hireCost } from './_rules/merc.js';

/* ★ 서버에서는 로그·저장을 클라가 소유한다 — 빈 함수로 묶는다.
 *   ★ 안 묶으면 `advanceDays` 가 **던진다** (day.js 의 계약). 그래서 여기서 한 번 묶는다. */
bindDay({ addLog: () => {}, touch: () => {}, expireCityLists: () => {} });

/**
 * 그림자 관측을 **표에 적는다** (db/022).
 *
 * ★★ 이 CLI 에는 `supabase functions logs` 가 없다 — `console.error` 만으로는
 *   사람이 대시보드를 열어 눈으로 옮겨 적어야 하고, 그러면 「며칠 돌려야 하나」 에
 *   아무도 수치로 답할 수 없다.
 *
 * ★ 실패해도 **아무 일도 안 한다.** 관측이 그림자를 막으면 안 된다.
 * ★ 숫자와 참거짓만 적는다 — 이름·용병단명 같은 문자열을 넣지 마라.
 */
async function obs(admin: { from: (t: string) => { insert: (v: unknown) => Promise<{ error?: unknown }> } },
                   userId: string, kind: string, o: unknown) {
  try {
    const { error } = await admin.from('shadow_obs').insert({ user_id: userId, kind, obs: o });
    if (error) console.error('[그림자] 관측 기록 실패 — 넘어간다', error);
  } catch (e) { console.error('[그림자] 관측 기록 실패 — 넘어간다', String((e as Error)?.message || e)); }
}

/**
 * `run_*` 를 **끝까지** 읽는다.
 *
 * ★★★ PostgREST 는 기본 행 상한이 **1000** 이다. 그냥 `select('*')` 하면
 *   그 위는 **조용히 잘린다** — 오류도 경고도 없다.
 *
 *   실제로 물렸다: 실계정 아이템이 **1372개**인데 1000개만 와서 착용이 346 → 156 이 되고
 *   서버가 센 전력이 **166,274 → 105,411 (−36.6%)** 이 됐다.
 *   그림자가 아니라 판정이었으면 그 계정을 그 자리에서 거절했다.
 *
 * ★ 그림자 모드가 값을 한 이 첫 번째 사고다 — 로그가 아니라 **관측 표**(db/022)가 잡았다.
 */
async function allRows(admin, table, userId, cols = '*') {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(cols)
      .eq('user_id', userId).range(from, from + PAGE - 1);
    if (error) { console.error('[run_*] 읽기 실패', table, error); return out; }
    const got = data || [];
    out.push(...got);
    if (got.length < PAGE) return out;
    /* ★ 안전망 — 표가 이상하게 크면 멈춘다 (아이템 상한이 코드에 없다) */
    if (out.length >= 20000) { console.error('[run_*] 너무 많다 — 자른다', table, out.length); return out; }
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 차수. `classes.js` 의 `tier` 를 그대로 믿는다 (표가 곧 규칙이다). */
const tierOf = (id: string) => Math.max(1, Math.round(Number(getClass(id)?.tier) || 1));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 받는다' }, 405);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const auth = req.headers.get('Authorization') || '';
  if (!url || !service) return json({ error: '서버 설정이 없다' }, 500);
  if (!auth) return json({ error: '로그인이 필요하다' }, 401);

  /* ★ 사용자 JWT 로 신원만 확인한다 — 쓰기는 admin 으로 하되 **user_id 를 못 속이게** */
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asUser.auth.getUser();
  const userId = who?.user?.id || '';
  if (!userId) return json({ error: '로그인이 필요하다' }, 401);

  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { return json({ error: '본문을 읽지 못했다' }, 400); }
  const op = String(body?.op || '');
  const opId = String(body?.opId || '').slice(0, 64);
  if (!opId) return json({ error: 'opId 가 필요하다' }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  /* ── 멱등성: 같은 op_id 면 지난 결과를 그대로 돌려준다 ─────────────────── */
  {
    const { data: prev } = await admin.from('run_ops')
      .select('result').eq('user_id', userId).eq('op_id', opId).maybeSingle();
    if (prev) return json({ ok: true, replayed: true, result: prev.result });
  }

  /* ═══════════════════════ 판매 ═══════════════════════════════════════════
   * ★★ **거절하지 않는다.** 못 파는 것은 조용히 건너뛰고 판 것만 정산한다.
   *   일괄 매각은 클라가 목록을 만들어 보내는데, 그 사이 하나가 착용되거나 잠기면
   *   «클라는 팔았다고 그렸는데 서버가 통째로 거절» 이 정상 플레이에서 난다.
   *   ⇒ 부분 성공을 답으로 준다. 이 저장소의 규칙: 정상 플레이어를 막는 쪽이 더 나쁘다.
   *
   * ★ 아이템 «스탯» 은 검증하지 않는다 — §113 이 소급 불가를 못 박았다 (옛 공식 3.6%).
   *   여기서 묻는 것은 «팔 수 있는 물건인가» 뿐이다. */
  if (op === 'sell') {
    const uids = Array.isArray(body?.uids) ? body.uids.map(String).slice(0, 500) : [];
    if (!uids.length) return json({ error: 'uids 가 필요하다' }, 400);

    const { data: rows, error: readErr } = await admin.from('run_items')
      .select('uid, base_id, rarity, ilvl, set_id, locked, equipped_by, data')
      .eq('user_id', userId).in('uid', uids);
    if (readErr) { console.error('[run-op] run_items 읽기 실패', readErr); return json({ error: '읽지 못했다' }, 500); }

    const sold: string[] = [];
    const skipped: { uid: string; why: string }[] = [];
    let gold = 0;
    for (const uid of uids) {
      const r = (rows || []).find((x: { uid: string }) => x.uid === uid);
      if (!r) { skipped.push({ uid, why: '없다' }); continue; }
      if (r.equipped_by) { skipped.push({ uid, why: '착용 중' }); continue; }
      /* ★ 행 → 아이템 모양. `data` 를 먼저 펴고 컬럼이 이긴다 (§122 의 그 계약). */
      const item = { ...(r.data || {}), uid: r.uid, baseId: r.base_id, rarity: r.rarity,
        ilvl: r.ilvl, setId: r.set_id, ...(r.locked ? { locked: true } : {}) };
      if (!isSellable(item)) { skipped.push({ uid, why: '팔 수 없다' }); continue; }
      let g = 0;
      try { g = Math.max(0, Math.round(Number(sellPrice(item)) || 0)); } catch { g = 0; }
      gold += g;
      sold.push(uid);
    }

    const result = { op: 'sell', sold: sold.length, skipped: skipped.length, gold };
    const { error: opErr } = await admin.from('run_ops')
      .insert({ user_id: userId, op_id: opId, kind: 'sell', result });
    if (opErr) { console.error('[run-op] run_ops insert 실패', opErr); return json({ error: '같은 요청이 이미 처리 중이다' }, 409); }

    if (sold.length) {
      const { error: delErr } = await admin.from('run_items')
        .delete().eq('user_id', userId).in('uid', sold);
      if (delErr) {
        console.error('[run-op] run_items 삭제 실패 — 원장을 되돌린다', delErr);
        const { error: rbErr } = await admin.from('run_ops').delete().eq('user_id', userId).eq('op_id', opId);
        if (rbErr) console.error('[run-op] ★ 원장 되돌리기도 실패했다 — 이 op 은 굳는다', rbErr);
        return json({ error: '적용하지 못했다' }, 500);
      }
    }
    return json({ ok: true, replayed: false, result, skipped });
  }

  /* ═══════════════════════ 착용 / 해제 ═══════════════════════════════════
   * ★★ 판정은 `equipIssue`(gear.js) **하나**가 한다. SQL 로도, 여기서도 다시 안 쓴다.
   *   손으로 옮겼다가 세 번 틀린 적이 있다 — 그리고 맞게 짚은 뒤에도 답이 틀렸다
   *   (`equipIssue` 는 클래스 무기 타입을 **손 슬롯에만** 적용한다).
   *
   * ★★ **새 착용만 검사한다. 이미 낀 것은 소급하지 않는다.**
   *   전직 경로 98개 중 46개가 착용 타입을 좁히는데(실측) `promote` 는 아무것도 안 벗긴다.
   *   소급 검사를 켜면 그런 단원이 통째로 막힌다. 그리고 §113 의 옛 아이템 3.6% 도 있다.
   *   ★ 실계정에서는 지금 불법이 **0점**이다(`equipIssue` 로 346점 전수) — 소급 검사를
   *     켤 이유가 없고, 켜면 위험만 진다.
   *
   * ★ `weaponType`·`twoHanded` 를 **아이템이 신고한 값으로 안 읽는다.** null 로 두면
   *   관문이 통째로 꺼지기 때문이다. 베이스 표(`getBase`)에서 다시 읽는다. */
  if (op === 'equip') {
    const mercUid2 = String(body?.mercUid || '');
    const itemUid = String(body?.itemUid || '');
    const slot = body?.slot == null ? null : String(body.slot);
    if (!mercUid2 || !itemUid) return json({ error: 'mercUid 와 itemUid 가 필요하다' }, 400);

    const [{ data: m2 }, { data: it2 }] = await Promise.all([
      admin.from('run_mercs').select('uid, class_id, level, grade')
        .eq('user_id', userId).eq('uid', mercUid2).maybeSingle(),
      admin.from('run_items').select('uid, base_id, rarity, ilvl, set_id, locked, equipped_by, equipped_slot, data')
        .eq('user_id', userId).eq('uid', itemUid).maybeSingle(),
    ]);
    if (!m2) return json({ error: '그 단원이 서버에 없다' }, 404);
    if (!it2) return json({ error: '그 장비가 서버에 없다' }, 404);
    if (it2.equipped_by && it2.equipped_by !== mercUid2) {
      return json({ error: '다른 단원이 이미 끼고 있다' }, 409);
    }

    /* ★ 행 → 게임 모양. `data` 를 먼저 펴고 컬럼이 이긴다 (§122).
     *   그리고 `weaponType` 은 **베이스 표에서** 다시 읽는다 — 신고값을 안 믿는다. */
    const base = getBase(it2.base_id);
    const item2 = {
      ...(it2.data || {}), uid: it2.uid, baseId: it2.base_id, rarity: it2.rarity,
      ilvl: it2.ilvl, setId: it2.set_id, ...(it2.locked ? { locked: true } : {}),
      weaponType: base?.weaponType ?? null,
      minLv: base?.minLv ?? 1,
    };
    const merc2 = { uid: m2.uid, classId: m2.class_id, level: m2.level, grade: m2.grade, equipment: {} };

    /* 지금 그 단원이 낀 것들 — `offhandLocked` 가 볼 수 있게 채운다 */
    const { data: worn } = await admin.from('run_items')
      .select('uid, base_id, equipped_slot, data')
      .eq('user_id', userId).eq('equipped_by', mercUid2);
    const wornById = new Map<string, Record<string, unknown>>();
    for (const w of worn || []) {
      const wb = getBase(w.base_id);
      merc2.equipment[String(w.equipped_slot)] = w.uid;
      wornById.set(w.uid, { ...(w.data || {}), uid: w.uid, baseId: w.base_id,
        weaponType: wb?.weaponType ?? null });
    }
    const lookup = (uid: string) => wornById.get(uid) || null;

    let issue: string | null = null;
    try { issue = equipIssue(merc2, item2, slot, lookup); }
    catch (e) { console.error('[run-op] equipIssue 실패', e); return json({ error: '판정하지 못했다' }, 500); }
    if (issue) return json({ error: issue }, 409);

    const target = slot || null;
    const result = { op: 'equip', mercUid: mercUid2, itemUid, slot: target };
    const { error: opErr2 } = await admin.from('run_ops')
      .insert({ user_id: userId, op_id: opId, kind: 'equip', result });
    if (opErr2) { console.error('[run-op] run_ops insert 실패', opErr2); return json({ error: '같은 요청이 이미 처리 중이다' }, 409); }

    /* ★ 그 칸에 있던 것을 먼저 벗긴다 — 유니크 인덱스가 아니라 «순서» 가 지킨다 */
    if (target) {
      await admin.from('run_items')
        .update({ equipped_by: null, equipped_slot: null })
        .eq('user_id', userId).eq('equipped_by', mercUid2).eq('equipped_slot', target);
    }
    const { error: eqErr } = await admin.from('run_items')
      .update({ equipped_by: mercUid2, equipped_slot: target })
      .eq('user_id', userId).eq('uid', itemUid);
    if (eqErr) {
      console.error('[run-op] 착용 실패 — 원장을 되돌린다', eqErr);
      const { error: rbErr } = await admin.from('run_ops').delete().eq('user_id', userId).eq('op_id', opId);
      if (rbErr) console.error('[run-op] ★ 원장 되돌리기도 실패했다 — 이 op 은 굳는다', rbErr);
      return json({ error: '적용하지 못했다' }, 500);
    }
    return json({ ok: true, replayed: false, result });
  }

  /* ═══════════════════════ 하루 넘기기 ═══════════════════════════════════
   * ★★ **첫 배포는 «그림자» 다.** 서버가 계산해서 로그로만 남기고 `run_state` 를 안 고친다.
   *   이유: 하루 루프는 임금·회복·원정복귀·평판감쇠 넷을 한꺼번에 바꾸는데,
   *   그중 회복이 난수를 안 먹어도 **`m.maxHp` 를 다시 계산**하고 그 값이 아이템에
   *   의존한다. 숫자가 맞는 것을 눈으로 본 뒤에 소유를 넘긴다.
   *
   * ★ 임금의 반올림은 **«합계 1회»** 다 — 제작자 결정 (day.js 의 머리 주석).
   *   실측: 컬럼(class_id·grade·level)에서 다시 계산해도 랴니 42명에서 **차이 0**.
   *
   * ★ `day.js` 를 **그대로 부른다.** 여기서 하루 루프를 다시 쓰면 사본이 둘이 되고
   *   반드시 갈라진다 (§94·§98·§107 — 이번 세션에만 세 번 겪었다). */
  if (op === 'advanceDays') {
    const n = Math.max(1, Math.min(365, Math.round(Number(body?.n) || 1)));

    const [{ data: rs2 }, { data: rm2 }, { data: ri2 }, { data: rp2 }, { data: rq2 }] = await Promise.all([
      admin.from('run_state').select('*').eq('user_id', userId).maybeSingle(),
      /* ★★ `select('*')` 만 쓰면 **1000행에서 조용히 잘린다** — 아이템 1372개짜리
       *   실계정에서 전력이 166,274 → 105,411 이 됐다. `allRows` 가 끝까지 읽는다. */
      { data: await allRows(admin, 'run_mercs', userId) },
      { data: await allRows(admin, 'run_items', userId) },
      { data: await allRows(admin, 'run_pets', userId) },
      { data: await allRows(admin, 'run_squads', userId) },
    ]);
    if (!rs2) return json({ error: '아직 이관 전이다' }, 404);

    const st2 = fromRows({ state: rs2, mercs: rm2 || [], items: ri2 || [],
      pets: rp2 || [], squads: rq2 || [], quests: [] });
    const before = { day: st2.day, gold: st2.gold, upkeep: dailyUpkeep(st2) };
    let out = null;
    try { out = advanceDays(st2, n); }
    catch (e) { console.error('[run-op] advanceDays 실패', e); return json({ error: '계산하지 못했다' }, 500); }

    const result = {
      op: 'advanceDays', n,
      day: { 전: before.day, 후: st2.day },
      gold: { 전: before.gold, 후: st2.gold, 임금: out.upkeep, 밀린것: out.unpaid },
      회복: (out.recovered || []).length, 복귀: (out.returned || []).length,
      하루임금: before.upkeep,
    };
    console.error('[그림자] 하루 넘기기 — 계산만 하고 안 쓴다', { userId, result });
    await obs(admin, userId, 'advanceDays', {
      n, dayFrom: before.day, dayTo: st2.day,
      goldFrom: before.gold, goldTo: st2.gold,
      upkeepDay: before.upkeep, upkeepTotal: out.upkeep, unpaid: out.unpaid,
      recovered: (out.recovered || []).length, returned: (out.returned || []).length,
    });

    /* ★★ **아직 안 쓴다.** 원장도 안 남긴다 — 남기면 «했다» 가 되어
     *   다음 진짜 호출이 재생으로 막힌다. */
    return json({ ok: true, shadow: true, result });
  }

  /* ═══════════════════════ 고용 ═══════════════════════════════════════════
   * ★★ 이 계획에서 **정상 플레이어를 거절할 수 있는 유일한 행동**으로 표시된 자리다.
   *
   * ★ 그래서 목록을 «재생성해서 대조» 하지 **않는다.** 저장된 목록(`run_state.data.tavern`)에
   *   대고 묻는다. 재생성을 요구하면 `hireCost` 공식이나 `BASE_CLASSES` 가 바뀐 뒤
   *   **옛 날짜를 다시 못 만들어** 정상 고용이 거절된다 (§113 이 아이템에서 겪은 병).
   *   ★ 재현 자체는 된다 — 실측으로 저장 4개 == 재현 4개 (랴니 · lastlamp · 2129일).
   *     그래도 «믿는 근거» 로 쓰지 않는다. 그 목록은 이미 서버에 있다.
   *
   * ★★ **등급은 서버가 굴린다.** 클라가 굴리면 «S 가 나올 때까지 다시 누르기» 가 된다.
   *   그리고 시드를 `op_id` 에서 뽑아 **재시도가 같은 등급**을 내게 한다 —
   *   `run_ops` 재생과 겹치는 방어지만, 둘 다 있어야 경쟁 조건에서도 안전하다.
   *
   * ★ 여기 쓰는 해시는 «게임 규칙» 이 아니라 **멱등성의 구현 세부**다. 그래서
   *   `enemygen.hashStr` 을 끌어오지 않는다 (그거 하나 때문에 묶음이 13 → 18개가 된다). */
  if (op === 'hire') {
    const cityId = String(body?.cityId || '');
    const idx = Math.round(Number(body?.offerIndex));
    if (!cityId || !Number.isFinite(idx) || idx < 0) {
      return json({ error: 'cityId 와 offerIndex 가 필요하다' }, 400);
    }

    const { data: rs3 } = await admin.from('run_state').select('*').eq('user_id', userId).maybeSingle();
    if (!rs3) return json({ error: '아직 이관 전이다' }, 404);
    const book = ((rs3.data || {}).tavern || {})[cityId];
    const list = book && Array.isArray(book.list) ? book.list : null;
    if (!list) return json({ error: '그 도시의 주점 목록이 서버에 없다', cityId }, 409);
    if (Number(book.day) !== Number(rs3.day)) {
      /* ★ 목록이 오늘 것이 아니다 — 거절이 아니라 «다시 받아라» 다. */
      return json({ error: '주점 목록이 오늘 것이 아니다', 목록일: book.day, 오늘: rs3.day }, 409);
    }
    const offer = list[idx];
    if (!offer) return json({ error: '그 자리가 없다', 칸수: list.length }, 409);
    if (offer.hired) return json({ error: '이미 계약이 끝난 자리다' }, 409);

    const cost = Math.max(0, Math.round(Number(offer.cost) || 0));
    if (Number(rs3.gold) < cost) {
      return json({ error: '골드가 모자란다', 필요: cost, 보유: rs3.gold }, 409);
    }

    const { count: rosterN } = await admin.from('run_mercs')
      .select('uid', { count: 'exact', head: true }).eq('user_id', userId);
    if ((rosterN || 0) >= Number(rs3.roster_cap || 20)) {
      return json({ error: '단원 정원이 가득 찼다', 정원: rs3.roster_cap, 지금: rosterN }, 409);
    }

    /* ★ `op_id` → 시드. FNV-1a 32bit — 저장소의 다른 해시와 **같은 식**이지만
     *   여기서는 게임 규칙이 아니라 «재시도가 같은 답을 내게» 하는 장치다. */
    let h = 2166136261 >>> 0;
    for (let i = 0; i < opId.length; i++) { h ^= opId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const seeded = { next: (() => { let x = (h >>> 0) || 1;
      return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; })() };
    seeded.weighted = (entries: { g: string; w: number }[]) => {
      const total = entries.reduce((a, e) => a + e.w, 0);
      let t = seeded.next() * total;
      for (const e of entries) { t -= e.w; if (t <= 0) return e; }
      return entries[entries.length - 1];
    };

    const rep = Math.max(0, Math.round(Number(((rs3.data || {}).reputation || {})[cityId]) || 0));
    const tier = Math.max(1, Math.round(Number(body?.cityTier) || 1));
    const isSpec = !!body?.specialty;
    let grade = 'F';
    try { grade = gradeRoll(tier, seeded, { rep, specialty: isSpec }); }
    catch (e) { console.error('[run-op] gradeRoll 실패', e); return json({ error: '추첨하지 못했다' }, 500); }

    const result = { op: 'hire', cityId, offerIndex: idx, classId: offer.classId, cost, grade };
    const { error: opErr3 } = await admin.from('run_ops')
      .insert({ user_id: userId, op_id: opId, kind: 'hire', result });
    if (opErr3) { console.error('[run-op] run_ops insert 실패', opErr3); return json({ error: '같은 요청이 이미 처리 중이다' }, 409); }

    /* ★★ **아직 안 쓴다** — 그림자다. `run_mercs` 도 `run_state` 도 안 고친다.
     *   클라가 이 경로를 안 쓰기 때문이고(호출부 0줄), 등급 연출이 서버를 기다리게 하는
     *   UI 변경이 따로 필요하다. 숫자가 맞는 것을 본 뒤에 소유를 넘긴다. */
    console.error('[그림자] 고용 — 계산만 하고 안 쓴다', { userId, result, rep, tier, isSpec });
    await obs(admin, userId, 'hire', {
      cityId, offerIndex: idx, classId: offer.classId, cost, grade, rep, tier, isSpec,
      gold: Number(rs3.gold), rosterN: rosterN || 0, rosterCap: Number(rs3.roster_cap || 20),
    });
    return json({ ok: true, shadow: true, result });
  }

  /* ═══════════════════════ 의뢰 정산 신고 (그림자) ═══════════════════════
   * ★★ **서버가 의뢰 정산을 한 번도 본 적이 없다.** 그래서 첫 조각의 일은 판정이
   *   아니라 **채널을 파는 것**이다. 여기서는 `select` 만 하고 로그만 남긴다.
   *
   * ★★★ **`run_ops` 에 안 적는다.** 적으면 「했다」 가 되어 나중에 진짜 정산이
   *   재생으로 막힌다 — 15단계 하루 넘기기와 같은 계약이다.
   *
   * ★ 여기서 «G 가 정직한가» 는 아직 못 묻는다. `quest.reward` 는 `run_state.data`
   *   jsonb — **클라가 쓴 것을 db/016:95 가 무검증으로 넣는 통** — 에 있기 때문이다.
   *   그건 2번 조각(`genQuests` 재현)이 할 일이다. 지금은 **다음 조각을 결정할 축**만 모은다.
   *
   * ★ 밴드는 **정수**로 잰다. 실수 밴드(`G*0.94 ≤ g`)는 정상 지급을 거절한다 —
   *   실측 0.21~4.6%. 정수 밴드는 40만 굴림에서 위반 0 이다.
   *   ★★ 그리고 SQL `numeric` 으로 재지 마라 (정확 십진 vs IEEE754 — G 233개가 갈린다).
   *     여기는 Deno 라 double 이다. */
  if (op === 'questSettle') {
    const { data: rs4 } = await admin.from('run_state')
      .select('day, city_id, seed, data').eq('user_id', userId).maybeSingle();

    const q = body || {};
    const rw = (q.reward && typeof q.reward === 'object') ? q.reward : null;
    const rep = (q as { 신고?: Record<string, number> }).신고 || {};
    const G = Math.round(Number(rw?.gold) || 0);
    const E = Math.round(Number(rw?.exp) || 0);
    const R = Math.round(Number(rw?.renown) || 0);
    const gold = Math.round(Number(rep.gold) || 0);
    const exp = Math.round(Number(rep.exp) || 0);
    const renown = Math.round(Number(rep.renown) || 0);

    /* 저장본에 그 의뢰가 있나 — id 로 멤버십만 본다 (목록은 언제나 부분집합이다) */
    const book = ((rs4?.data || {}).quests || {})[String(q.cityId || '')];
    const saved = book && Array.isArray(book.list)
      ? book.list.find((x: { id?: string }) => x && x.id === q.questId) : null;

    const R2 = (x: unknown) => Math.round(Number(x) || 0);
    console.error('[그림자] 의뢰 정산 신고', {
      userId,
      questId: q.questId, cityId: q.cityId,
      날짜: { 목록: q.listDay, 오늘: q.day, 서버: rs4?.day ?? null,
        차: Number.isFinite(Number(q.day)) && rs4 ? Number(q.day) - Number(rs4.day) : null },
      도시일치: rs4 ? String(q.cityId) === String(rs4.city_id) : null,
      저장본에있나: !!saved,
      저장본reward: saved ? (saved as { reward?: unknown }).reward : null,
      클라reward: rw,
      /* ★ 정수 밴드 — 승리일 때만 뜻이 있다 */
      밴드: q.win ? {
        골드: { G, 지급: gold, 아래: R2(G * 0.94), 위: R2(G * 1.14),
          안: gold >= R2(G * 0.94) && gold <= R2(G * 1.14) },
        경험: { E, 지급: exp, 아래: R2(E * 0.96), 위: R2(E * 1.08),
          안: exp >= R2(E * 0.96) && exp <= R2(E * 1.08) },
        명성: { R, 지급: renown, 같나: renown === R },
        전리품: { 굴림: Array.isArray(rw?.itemRolls) ? rw.itemRolls.length : null, 받음: rep.itemsN },
      } : { 패배: true, exp, progress: q.progress },
      웨이브: { 신고: q.waveN, 의뢰: q.questWaveN,
        중도끝: Number(q.waveN) < Number(q.questWaveN),
        /* ★ 마지막 웨이브에 margin 이 없으면 **후퇴**다 (finish() 를 안 지났다) */
        후퇴: Array.isArray(q.waves) && q.waves.length
          ? !q.waves[q.waves.length - 1].margin : null },
      자동판매: q.autoSellRarity,
      목록도시수: Object.keys((rs4?.data || {}).quests || {}).length,
    });

    /* ★★ `run_ops` 에는 **안 적는다** (적으면 진짜 정산이 재생으로 막힌다).
     *   대신 **관측 표**에 적는다 — 판정에 안 쓰이고 운영자만 읽는다 (db/022). */
    await obs(admin, userId, 'questSettle', {
      rev: Math.max(0, Math.round(Number(q.rev) || 0)),
      questId: q.questId, cityId: q.cityId, win: !!q.win,
      dayDiff: rs4 ? R2(q.day) - R2(rs4.day) : null,
      listDayDiff: R2(q.day) - R2(q.listDay),
      cityMatch: rs4 ? String(q.cityId) === String(rs4.city_id) : null,
      inSaved: !!saved,
      rewardMatch: saved ? JSON.stringify((saved as { reward?: unknown }).reward) === JSON.stringify(rw) : null,
      G, E, R, gold, exp, renown,
      goldIn: q.win ? (gold >= R2(G * 0.94) && gold <= R2(G * 1.14)) : null,
      expIn: q.win ? (exp >= R2(E * 0.96) && exp <= R2(E * 1.08)) : null,
      renownEq: q.win ? renown === R : null,
      itemRolls: Array.isArray(rw?.itemRolls) ? rw.itemRolls.length : null,
      itemsN: R2(rep.itemsN),
      waveN: R2(q.waveN), questWaveN: R2(q.questWaveN),
      retreat: Array.isArray(q.waves) && q.waves.length ? !q.waves[q.waves.length - 1].margin : null,
      autoSell: R2(q.autoSellRarity),
      cityBooks: Object.keys((rs4?.data || {}).quests || {}).length,
    });

    return json({ ok: true, shadow: true });
  }

  if (op !== 'promote') return json({ error: '모르는 op 이다' }, 400);

  const mercUid = String(body?.mercUid || '');
  const toClass = String(body?.toClass || '');
  if (!mercUid || !toClass) return json({ error: 'mercUid 와 toClass 가 필요하다' }, 400);
  if (!CLASSES[toClass]) return json({ error: '없는 클래스다' }, 400);

  /* ── 지금 상태를 서버에서 읽는다. 클라가 보낸 «현재 클래스» 를 믿지 않는다 ── */
  const { data: merc, error: readErr } = await admin.from('run_mercs')
    .select('uid, class_id, level, grade').eq('user_id', userId).eq('uid', mercUid).maybeSingle();
  if (readErr) { console.error('[run-op] run_mercs 읽기 실패', readErr); return json({ error: '읽지 못했다' }, 500); }
  if (!merc) return json({ error: '그 단원이 서버에 없다 (이관 전이거나 uid 가 다르다)' }, 404);

  /* ── 규칙: 표가 곧 규칙이다 ──────────────────────────────────────────── */
  const from = String(merc.class_id || '');
  const allowed = promoteOptions(from).map((c: { id: string }) => c.id);
  if (!allowed.includes(toClass)) {
    return json({ error: '그 클래스로는 전직할 수 없다', from, allowed }, 409);
  }
  if (tierOf(toClass) <= tierOf(from)) {
    return json({ error: '이미 그 차수 이상이다', from }, 409);
  }

  /* ── 쓴다. ★ 원장을 **먼저** 남긴다 — 쓰고 나서 원장이 실패하면 재시도가 두 번 한다. ── */
  const result = { op: 'promote', mercUid, from, to: toClass };
  const { error: opErr } = await admin.from('run_ops')
    .insert({ user_id: userId, op_id: opId, kind: 'promote', result });
  if (opErr) {
    /* 경쟁 조건에서 같은 op_id 가 동시에 들어오면 여기서 걸린다 — 그게 맞는 동작이다. */
    console.error('[run-op] run_ops insert 실패', opErr);
    return json({ error: '같은 요청이 이미 처리 중이다' }, 409);
  }

  const { error: upErr } = await admin.from('run_mercs')
    .update({ class_id: toClass }).eq('user_id', userId).eq('uid', mercUid);
  if (upErr) {
    /* ★ 원장은 남았는데 쓰기가 실패했다 — 원장을 지워 재시도가 되게 한다.
     *   지우기가 또 실패하면 그 op 은 «했다» 고 굳는다. 그건 로그로 남긴다. */
    console.error('[run-op] run_mercs update 실패 — 원장을 되돌린다', upErr);
    const { error: rbErr } = await admin.from('run_ops')
      .delete().eq('user_id', userId).eq('op_id', opId);
    if (rbErr) console.error('[run-op] ★ 원장 되돌리기도 실패했다 — 이 op 은 굳는다', rbErr);
    return json({ error: '적용하지 못했다' }, 500);
  }

  return json({ ok: true, replayed: false, result });
});
