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
/* ★★ 의뢰 목록을 **다시 만든다** (§104 17단계 2번 조각).
 *   §138 이 `genQuests` 를 `state.js` 에서 떼어 냈다 — 여기서 부르는 것은 게임이
 *   부르는 **바로 그 함수**다. 손으로 다시 쓰지 않는다 (§124 에서 세 번 틀렸다). */
import { genQuests, resolveSquadCount } from './_rules/questgen.js';
import { hashStr } from './_rules/enemygen.js';
/* ★★ 정산 판정은 **손으로 다시 쓰지 않는다.** 밴드 계산이 여기 인라인으로 있었는데,
 *   그러면 오프라인으로 굴려 볼 수가 없어서 「정직한 판이 걸리나」 를 못 물었다.
 *   `tools/settleband.mjs` 가 **같은 함수**로 324판(후퇴 108·패배 67)을 굴려
 *   오탐 0 · 심은 조작 1892건 전부 적발을 확인했다. */
import { judgeSettle } from './_rules/settlejudge.js';
import { RNG } from './_rules/rng.js';

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
/* ★ 인자 타입을 좁게 적었더니 `deno check` 가 부르는 자리마다 물었다 (4곳).
 *   여기서 필요한 것은 «insert 할 수 있는가» 뿐이라 넓게 받는다 — 검사 잡음을 줄이면
 *   진짜 오류가 그 안에 안 묻힌다. */
// deno-lint-ignore no-explicit-any
async function obs(admin: any, userId: string, kind: string, o: unknown) {
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

/* ★★★ **CORS 가 통째로 빠져 있었다.** 이 함수만 그랬다 —
 *   `submit-score`·`pvp-battle` 은 처음부터 갖고 있었다.
 *
 *   그래서 브라우저가 이 함수를 **한 번도 못 불렀다.** `Authorization`·`content-type` 이
 *   붙으면 브라우저는 먼저 `OPTIONS` 를 던지는데(프리플라이트), 여기서 405 에 헤더 0개가
 *   돌아가니 **POST 는 아예 나가지도 않는다.** 실패가 네트워크 탭에만 남고 응답도 없다.
 *
 *   ⇒ 이것이 며칠간 `questSettle` 관측이 0건이던 진짜 이유다. 그리고 전직·판매·착용을
 *     화면에 이었더라도 **똑같이 전부 실패했을 것**이다 (`run_ops` 가 0건인 것도 이 탓이다).
 *
 * ★ 왜 여태 몰랐나 — 확인을 **node/curl 로만** 했다. 그쪽은 프리플라이트를 안 한다.
 *   `GET → 405` 를 보고 「핸들러까지 닿는다」 고 판단했는데, 그 판정이 브라우저에 대해서는
 *   아무것도 증명하지 못했다. 이제 스모크가 세 함수의 CORS 를 나란히 비교한다. */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

/** 차수. `classes.js` 의 `tier` 를 그대로 믿는다 (표가 곧 규칙이다). */
const tierOf = (id: string) => Math.max(1, Math.round(Number(getClass(id)?.tier) || 1));

Deno.serve(async (req) => {
  /* ★ 프리플라이트를 **먼저** 받는다. 이 줄이 없으면 브라우저는 POST 를 보내지도 않는다. */
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
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

  /* ★★★ **요청이 닿기는 하나** 를 먼저 남긴다.
   *   `questSettle` 관측이 며칠째 0건인데 원인을 못 갈랐다 —
   *   「클라가 안 보내나 · 여기까지 못 오나 · 분기에서 새나 · 적기가 실패하나」 를
   *   구별할 값이 하나도 없었다. 도착을 세면 그 넷 중 앞의 둘이 바로 갈린다.
   *
   * ★ 판정에 안 쓴다. 실패해도 넘어간다 (obs 의 계약).
   * ★ 지금 이 함수를 부르는 것은 정산 신고뿐이라 의뢰 한 건에 한 줄이다. */
  await obs(admin, userId, 'op', { op: op.slice(0, 24), rev: Math.max(0, Math.round(Number(body?.rev) || 0)) });

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
      /* ★ 행 → 아이템 모양. `data` 를 먼저 펴고 컬럼이 이긴다 (§122 의 그 계약).
       *
       * ★★★ **`locked` 는 일부러 안 싣는다.** 그건 «실수로 팔지 마라» 는 클라 편의 표시지
       *   치트 방어가 아니다 — 조작자는 그냥 풀고 판다. 그런데 서버 사본의 잠금은
       *   **낡는다** (플레이어가 껐다 켰다 하는데 서버는 모른다).
       *   ⇒ 그것으로 거절하면 **오탐만 만들고 얻는 게 없다.** 실측 9.7% 가 그 탓이었다.
       *   서버가 볼 것은 낡지 않는 것들뿐이다: `noSell`·희귀도·신화·세트 조각, 그리고
       *   **착용 여부는 위에서 `equipped_by` 로 따로 본다** (그건 거울이 따라온다). */
      const item = { ...(r.data || {}), uid: r.uid, baseId: r.base_id, rarity: r.rarity,
        ilvl: r.ilvl, setId: r.set_id, locked: false };
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
      /* ★★★ **레벨 관문을 일부러 안 건다** (`minLv: 1`).
       *
       *   서버가 아는 `merc.level` 은 결국 **클라가 준 값**이다 (정산 쓰기·재동기화로
       *   올라온다). 그런 값으로 「레벨 N 이상」 을 막으면 **얻는 것이 0 이고
       *   오탐만 남는다** — 조작자는 자기 레벨을 올려 보내면 그만이다.
       *   게다가 탑·나락 레벨업은 신고 경로가 **아예 없어서** 서버가 영영 모른다.
       *   실측: 그 관문 때문에 정직한 착용의 **16.1%** 가 막혔다 (`tools/opstale.mjs`).
       *
       * ★ 서버가 무는 것은 **낡지 않는 것들**뿐이다:
       *   부위 적합 · 무기 타입 vs 클래스 · 세트 계열 — 전부 `base_id` 와
       *   `class_id` 에서 나오고, `class_id` 는 **서버가 소유한다** (9단계).
       *   `locked` 를 안 보는 것과 같은 잣대다 (§150.2). */
      minLv: 1,
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
   *   `enemygen.hashStr` 로 **바꾸지 마라** — 지금은 그 모듈이 묶음에 들어와 있어서
   *   부르는 것 자체는 되지만, 바꾸는 순간 **이미 나간 고용의 등급이 전부 달라진다.**
   *   (예전 사유였던 「묶음이 13 → 18개가 된다」 는 §138 이후 더 이상 안 맞는다.) */
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
   * ★★ «G 가 정직한가» 를 **이제 묻는다** (2번 조각, §138). `quest.reward` 는
   *   `run_state.data` jsonb — **클라가 쓴 것을 db/016:95 가 무검증으로 넣는 통** — 에
   *   있어서 저장본과 대조해 봐야 「내가 쓴 값이 내가 쓴 값과 같다」 일 뿐이다.
   *   그래서 아래에서 목록을 **(판·도시·날) 로 재생성**해 거기 적힌 G 와 비교한다.
   *   ★ 그래도 여기서 **판정하지 않는다.** 관측만 하고, 켜는 것은 4번 조각이다.
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

    /* ═══════════════ 의뢰 목록을 **다시 만든다** (17단계 2번 조각) ═══════════════
     * ★★ 여기까지 서버는 «저장본에 그 의뢰가 있나» 만 물을 수 있었다. 그런데 저장본의
     *   `data` jsonb 는 **클라가 쓴 것을 그대로 넣는 통**이다 (db/016:95) — 거기 적힌
     *   보상 G 를 근거로 삼으면 「내가 쓴 값이 내가 쓴 값과 같다」 를 확인하는 꼴이다.
     *   목록을 (판·도시·날) 로 **재생성**해야 비로소 «G 가 정직한가» 를 물을 수 있다.
     *
     * ★★★ 부대 수를 **반드시 명시해서** 부른다. 생략하면 `resolveSquadCount` 가
     *   전역 상태를 못 찾아 **1부대**로 보고 목록이 6~7건만 생긴다. 그러면 7번 이후
     *   의뢰가 전부 «없는 의뢰» 가 되어 정상 플레이어가 통째로 걸린다.
     *   ★ 그런데 «그 목록을 만들 때의 부대 수» 는 아무도 안 적어 놨다 (목록은 3일마다
     *     다시 만들어지고, 그 사이에 부대가 늘 수 있다). 그래서 **1~8 을 전부 굴려**
     *     어느 값이 맞는지 관측한다 — 8회에 13ms 다 (실측).
     *
     * ★ 판정하지 않는다. 계산해서 **표에 적기만** 한다. */
    let gen: Record<string, unknown> = { ran: false };
/* ★ 재생성해서 **찾아낸 의뢰 자체**. `gen` 은 관측용으로 접은 값이라 판정부가 못 쓴다.
 *   판정부는 «그 의뢰» 를 통째로 봐야 보상표·웨이브·전리품 굴림을 다 물을 수 있다. */
    let genHit: Record<string, unknown> | null = null;
    try {
      const qid = String(q.questId || '');
      /* id 는 `q_<도시>_<날>_<번호>` 다. 도시 id 에 `_` 가 있을 수 있어 뒤에서 자른다. */
      const mm = /^q_(.+)_(\d+)_(\d+)$/.exec(qid);
      const genDay = mm ? Number(mm[2]) : 0;
      const genIdx = mm ? Number(mm[3]) : -1;
      const bookDay = book ? R2(book.day) : 0;
      const seed = (Number(rs4?.seed) || 0) >>> 0;
      const cityId = String(q.cityId || '');

      /* 지금 살아 있는 부대 수 («그때» 의 값이 아니다 — 그래서 아래에서 훑는다) */
      const { count: squadN } = await admin.from('run_squads')
        .select('idx', { count: 'exact', head: true }).eq('user_id', userId);

      /* ★★★ **시드를 모르면 재현하지 않는다.**
       *   `rs4` 가 없으면(아직 이관 전) 위에서 seed 가 **0** 이 된다. 그러면 전혀 다른
       *   목록이 나오는데, 의뢰 id 는 `q_<도시>_<날>_<번호>` 라 **내용이 아니라 자리**만
       *   가리킨다 — 길이만 넉넉하면 «찾았다» 가 되고, 보상은 당연히 다르다.
       *
       *   실측으로 그랬다: 이관 안 한 계정의 정직한 의뢰가 `gEq:false` 로 찍혔다
       *   (재생성 82G vs 실제 2,288G). **판정이었으면 그 자리에서 거절했다.**
       *   같은 시각 이관한 계정은 `57,605 == 57,605` 로 정확히 맞았다.
       *
       * ★ 그래서 «못 잰다» 와 «틀렸다» 를 절대 섞지 않는다 — 18단계의 계약과 같다. */
      if (!rs4) {
        gen = { ran: false, why: 'no-seed', genDay, genIdx };
      } else if (mm && cityId && genDay > 0) {
        /* `state.js refreshCity` 의 seedFor('qs') 와 **같은 식**이어야 한다 */
        const rngFor = () => new RNG((hashStr(`qs#${cityId}#${genDay}`) ^ seed) >>> 0);
        const hits: number[] = [];
        let match: Record<string, unknown> | null = null;
        let listLen = 0;
        for (let sq = 1; sq <= 8; sq++) {
          const list = genQuests(cityId, genDay, rngFor(), resolveSquadCount(sq));
          if (sq === Math.max(1, R2(squadN))) listLen = list.length;
          const hit = list.find((x: { id?: string }) => x && x.id === qid);
          if (!hit) continue;
          hits.push(sq);
          if (!match) match = hit as Record<string, unknown>;
        }
        genHit = match;
        const rw2 = match ? (match.reward as Record<string, unknown> | null) : null;
        gen = {
          ran: true, genDay, genIdx, bookDay, dayEq: genDay === bookDay,
          squadN: R2(squadN), listLen,
          /* 어느 부대 수로 굴려야 그 의뢰가 나오나 — 비면 «재현 불가» 다 */
          /* ★ 이 축은 **약하다.** id 가 자리만 가리켜서 길이만 넉넉하면 «찾았다» 가 된다
           *   (실측 hitsN 8/8). 진짜 신호는 아래 `gEq`·`eEq`·`rEq` 다. */
          hitsN: hits.length, hitLo: hits.length ? hits[0] : null,
          hitHi: hits.length ? hits[hits.length - 1] : null,
          hitCur: hits.includes(Math.max(1, R2(squadN))),
          /* ★★ 여기서 처음으로 «G 가 정직한가» 를 묻는다 — 저장본이 아니라 **재생성**과 비교한다 */
          genG: rw2 ? R2(rw2.gold) : null,
          genE: rw2 ? R2(rw2.exp) : null,
          genR: rw2 ? R2(rw2.renown) : null,
          gEq: rw2 ? R2(rw2.gold) === G : null,
          eEq: rw2 ? R2(rw2.exp) === E : null,
          rEq: rw2 ? R2(rw2.renown) === R : null,
          genRolls: rw2 && Array.isArray(rw2.itemRolls) ? rw2.itemRolls.length : null,
          genRank: match ? String(match.rankLabel || '') : null,
          genLevel: match ? R2(match.level) : null,
          genWaveN: match && Array.isArray(match.waves) ? match.waves.length : null,
          /* 저장본 ↔ 재생성 대조 (저장본이 위조됐는지 본다) */
          savedEqGen: saved && rw2
            ? JSON.stringify((saved as { reward?: unknown }).reward) === JSON.stringify(rw2) : null,
        };
      } else {
        gen = { ran: false, why: !mm ? 'id모양' : (!cityId ? '도시없음' : '날짜없음') };
      }
    } catch (e) {
      /* ★ 재현이 터져도 신고 처리는 그대로 간다 — 그림자의 계약이다.
       *   ★ 그리고 **실패도 표에 남긴다** — 「안 돌았나 실패했나」 를 못 갈라 헤맨 적이 있다. */
      gen = { ran: false, failed: true, why: String((e as Error)?.message || e).slice(0, 120) };
    }

    console.error('[그림자] 의뢰 정산 신고', {
      재현: gen,
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

    /* ═══════════ 판정을 **굴려 보기만** 한다 (17단계 4번 조각) ═══════════
     * ★★★ **아직 아무것도 막지 않는다.** `judgeSettle` 은 최대가 `flag` 이고,
     *   그 결과를 여기서 **관측 표에만** 적는다. 응답도 안 바뀐다.
     *   먼저 라이브에서 «정직한 판이 안 걸린다» 를 확인한 뒤에 켠다 —
     *   오프라인 324판은 오탐 0 이었지만, 라이브는 아직 후퇴 표본이 0건이다.
     *
     * ★ 재현이 없으면(`gen.ran === false`) 판정부가 스스로 «못 잰다» 로 남긴다.
     *   이관 전 계정이 걸리면 안 된다 — 실제로 그럴 뻔했다 (시드 0 → 82G vs 2,288G). */
    let verdict: { verdict?: string; cantJudge?: boolean; reasons?: string[] } = {};
    try {
      verdict = judgeSettle({ report: q, gen: genHit });
    } catch (e) {
      verdict = { verdict: 'ok', cantJudge: true, reasons: ['판정실패'] };
      console.error('[그림자] 정산 판정 실패 — 넘어간다', String((e as Error)?.message || e));
    }

    /* ═══════════ 정산을 **실제로 쓴다** (§104 17단계의 진짜 형태) ═══════════
     *
     * ★★★ 여기까지 정산은 «보기만» 했다. 그래서 서버 사본의 `level` 이 낡았고,
     *   그 낡음이 판매·착용 권한 이전을 막고 있었다 (실측 착용 16.1% 가 정직한데 막힌다).
     *   ⇒ 판정을 통과한 정산은 **사본에 반영한다.**
     *
     * ★★ **판정을 통과할 때만** 쓴다. `flag` 면 원장에만 남기고 안 쓴다.
     *   `cantJudge`(이관 전·재현 불가)도 안 쓴다 — 못 재는데 쓰면 그게 곧 무검증이다.
     *
     * ★★ **새로운 신뢰 구멍이 아니다.** `run_resync` 가 이미 열려 있어 클라는 언제든
     *   사본 전체를 덮을 수 있다 (§141.2). 여기서 늘어나는 것은 «사본이 얼마나 자주
     *   맞느냐» 뿐이다. 신뢰는 여전히 쓰기 op 이 **판정까지** 가질 때 온다.
     *
     * ★ **원장을 남긴다.** 이제 이게 진짜 정산이므로 같은 신고가 두 번 오면 두 번
     *   적용하면 안 된다. (예전 계약 「run_ops 에 안 적는다」 는 이게 **그림자일 때**의
     *   이야기였다 — 그때는 적으면 나중의 진짜 정산이 재생으로 막혔다.)
     *
     * ★ 아이템은 **안 쓴다.** 서버가 전리품의 정체를 확인할 방법이 없고(§113),
     *   사본에 없는 아이템은 404 로만 나타나는데 그건 애초에 안 막는 경우다 (§146).
     *   다음 재동기화 때 따라온다.
     *
     * ★ 여기서 죽어도 신고 응답은 그대로 `{ok:true}` 다 — 게임을 막지 않는다. */
    let wrote: Record<string, unknown> = { did: false, why: '' };
    if (verdict.verdict === 'ok' && !verdict.cantJudge) {
      try {
        const { error: ledErr } = await admin.from('run_ops')
          .insert({ user_id: userId, op_id: opId, kind: 'questSettle', result: { questId: q.questId } });
        if (ledErr) {
          /* 같은 신고가 이미 처리됐다 — 두 번 쓰지 않는다. 그게 맞는 동작이다. */
          wrote = { did: false, why: '재생' };
        } else {
          const rows = Array.isArray((q as { mercsAfter?: unknown[] }).mercsAfter)
            ? (q as { mercsAfter: Record<string, unknown>[] }).mercsAfter.slice(0, 8) : [];
          const uids = rows.map((m) => String(m.uid || '')).filter(Boolean);
          /* ★★ `run_mercs` 는 **`level` 만 열**이고 `exp`·`hp`·`status`·`woundUntil` 은
           *   `data` jsonb 안이다 (db/013:94). 그래서 통째로 덮으면 나머지(이름·외모·
           *   전적)를 **지운다.** 읽어서 **합쳐** 쓴다.
           *   ★ `fromRows` 는 `data` 를 먼저 펴고 **열이 이긴다** (§122 의 그 계약) —
           *     그래서 `level` 은 열로, 나머지는 `data` 로 넣는 것이 맞다. */
          const { data: cur } = uids.length
            ? await admin.from('run_mercs').select('uid, data').eq('user_id', userId).in('uid', uids)
            : { data: [] };
          const byUid = new Map((cur || []).map((r: { uid: string; data: unknown }) => [r.uid, r.data]));
          let n = 0;
          for (const m of rows) {
            const uid = String(m.uid || '');
            if (!uid || !byUid.has(uid)) continue;        // 사본에 없는 단원은 건드리지 않는다
            const old = (byUid.get(uid) || {}) as Record<string, unknown>;
            /* ★ 열 제약은 db/013 이 갖고 있다(level 1~80). 여기서도 한 번 더 접는다 —
             *   제약에 걸려 **정산 전체가 500** 이 되는 것보다 잘리는 편이 낫다. */
            const { error } = await admin.from('run_mercs').update({
              level: Math.max(1, Math.min(80, Math.round(Number(m.level) || 1))),
              data: {
                ...old,
                exp: Math.max(0, Math.round(Number(m.exp) || 0)),
                hp: Math.max(0, Math.round(Number(m.hp) || 0)),
                status: String(m.status || 'idle').slice(0, 16),
                woundUntil: Math.max(0, Math.round(Number(m.woundUntil) || 0)),
              },
            }).eq('user_id', userId).eq('uid', uid);
            if (!error) n++;
          }
          const af = (q as { after?: Record<string, unknown> }).after || {};
          const { error: stErr } = await admin.from('run_state').update({
            gold: Math.max(0, Math.round(Number(af.gold) || 0)),
            renown: Math.max(0, Math.round(Number(af.renown) || 0)),
            quests_done: Math.max(0, Math.round(Number(af.questsDone) || 0)),
            battles_won: Math.max(0, Math.round(Number(af.battlesWon) || 0)),
            battles_lost: Math.max(0, Math.round(Number(af.battlesLost) || 0)),
          }).eq('user_id', userId);
          wrote = { did: true, mercs: n, state: !stErr };
        }
      } catch (e) {
        wrote = { did: false, why: '실패' };
        console.error('[정산] 사본 반영 실패 — 넘어간다', String((e as Error)?.message || e));
      }
    } else {
      wrote = { did: false, why: verdict.cantJudge ? '못잼' : '표시됨' };
    }

    /* ★ 관측 표에도 적는다 — 판정에 안 쓰이고 운영자만 읽는다 (db/022).
     *   ★★ 예전 주석은 「`run_ops` 에 안 적는다」 였다. 그건 이게 **그림자일 때**의
     *     계약이었다 — 적으면 나중의 진짜 정산이 재생으로 막히기 때문이다.
     *     이제 이게 그 «진짜 정산» 이므로 원장을 남기는 것이 맞다 (위 쓰기 블록). */
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
      /* ★ 재현 결과 — 판정에 안 쓴다. 4번 조각(판정 켜기)이 이 값을 보고 결정한다. */
      gen,
      /* ★ 판정을 굴려 본 결과. **아무것도 막지 않는다** — 라이브에서 오탐 0 을
       *   확인한 뒤에 켠다. 그때까지는 이 칸이 «켜면 어떻게 됐을까» 를 알려 준다. */
      judge: { v: verdict.verdict || null, cant: !!verdict.cantJudge, why: (verdict.reasons || []).slice(0, 6) },
      /* ★ 사본에 실제로 썼나 — 로그로만 남기면 또 못 센다 (§145 에서 같은 실수를 했다) */
      wrote,
    });

    /* ═══════════ 판정을 **켠다** — 다만 «표시» 까지다 (17단계 4번 조각) ═══════════
     *
     * ★★★ 근거를 쌓고 켠다:
     *   · 오프라인 324판(승리 149 · 패배 67 · **후퇴 108** · 자동판매 162) — 오탐 **0**
     *     그리고 심은 조작 1892건을 **하나도 안 놓쳤다** (`tools/settleband.mjs`)
     *   · 라이브 재현 4건 — 그중 **후퇴 2건**이 `ok` 로 지나갔다 (rev 173)
     *
     * ★★ **여기서 하는 일은 원장에 적는 것뿐이다.**
     *   · `scores.status` 를 **안 건드린다** — 순위표에서 안 숨긴다
     *   · 응답도 안 바뀐다 (`{ok:true}` 그대로). 사유를 흘리지 않는다 (§55)
     *   · 게임 흐름은 그대로다 — 신고는 애초에 fire-and-forget 이다
     *   ⇒ 오탐이 나도 **아무에게도 아무 일이 안 일어난다.** 사람이 표를 보고 판단한다.
     *
     * ★ tier 는 **'C'** 다. `probePolicy` 는 `tier='A'` 만 세므로(submit-score:214)
     *   여기 쌓여도 누군가 `held` 로 묶이는 일이 없다. **A 를 새로 만들지 않는다** —
     *   §104 가 17단계를 «거절 위험 최대» 로 못 박았다.
     *
     * ★ 라이브 표시가 한동안 0 인 것을 본 뒤에 `scores.status` 로 넘어간다. */
    if (verdict.verdict === 'flag' && !verdict.cantJudge) {
      try {
        await admin.from('rejections').insert({
          user_id: userId, tier: 'C',
          reasons: ['정산', ...(verdict.reasons || []).slice(0, 8)],
          /* ★ 원본을 남긴다 — 제보가 들어와도 판단할 재료가 없으면 되돌릴 수가 없다.
           *   ★★ 이름·용병단명 같은 문자열은 애초에 신고에 없다 (숫자와 id 뿐). */
          payload: JSON.stringify({ questId: q.questId, cityId: q.cityId, win: q.win, rev: q.rev,
            신고: q['신고'], reward: q.reward, waveN: q.waveN, questWaveN: q.questWaveN }),
        });
      } catch (e) {
        /* ★ 원장에 못 적어도 신고 처리는 그대로 간다 — 게임을 막지 않는다 */
        console.error('[정산] 원장 기록 실패 — 넘어간다', String((e as Error)?.message || e));
      }
    }

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
