/**
 * "지금 몇 위" 한 줄 — 나락·탑 결과 화면이 같이 쓴다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 공용 모듈인가
 *   이 프로젝트는 같은 규칙이 두 곳에 복사돼 한쪽만 고쳐진 사고가 여러 번 있었다
 *   (아군 편성 경로, 임금 합산, 진형 슬롯 수…). 결과 화면이 둘이라고 같은 20줄을
 *   두 벌 두면 다음에 문구나 계산을 고칠 때 반드시 한쪽이 남는다.
 *
 * ★ 기록을 세운 **직후**에 보여 주는 것이 핵심이다. 경쟁이 가장 잘 붙는 순간이고,
 *   아직 로그인 안 한 사람에게는 이게 로그인할 이유가 된다.
 *
 * @module ui/ranknote
 */

import { el, num } from '../core/util.js';
import * as Cloud from '../net/cloud.js';

/**
 * 순위 한 줄을 만든다. **바로 값을 채우지 않고** 자리만 잡아 두고 비동기로 갈아 끼운다.
 * 순위를 못 불러왔다고 결과 화면을 가리거나 늦출 이유가 없다.
 *
 * @param {object} o
 * @param {'abyss'|'tower'|'quests'} o.kind
 * @param {number} o.value  이번에 세운 값 (최고 기록이 아니라 **방금 한 것**)
 * @param {number} o.best   지금까지의 최고 기록
 * @param {string} o.unit   '심층' · '층' 등
 * @returns {HTMLElement}
 */
export function rankNote({ kind, value, best = 0, unit = '' }) {
  const node = el('div', { class: 'faint tiny', text: '순위 확인 중…' });
  const v = Math.max(0, Math.round(Number(value) || 0));
  if (!v) { node.textContent = ''; return node; }
  fill(node, kind, v, Number(best) || 0, unit);
  return node;
}

async function fill(node, kind, value, best, unit) {
  let r = null;
  try { r = await Cloud.rankOf(kind, value); } catch (e) { r = null; }
  if (!node.isConnected) return;                  // 화면을 이미 떠났다
  if (!r || !r.ok) { node.textContent = ''; return; }

  /* ★ 총원은 `max(등재 인원, 내 순위)` 다.
   *   `rank_of` 는 "나보다 잘한 사람 + 1" 이라 **아직 안 올라간 사람도 순위가 나온다.**
   *   그때 등재 인원을 그대로 쓰면 "3위 · 2명 중" 같은 말이 된다 —
   *   내가 올라가면 3명이 되므로 그 수를 보여 주는 게 맞다. */
  const total = Math.max(r.total || 0, r.rank || 0);
  const isBest = value >= best;

  node.innerHTML = '';
  node.appendChild(el('span', {},
    el('b', { style: { color: '#f0c05a' }, text: `${num(r.rank)}위` }),
    total ? ` · ${num(total)}명 중` : '',
    isBest ? ' · 최고 기록' : ` · 내 최고는 ${num(best)}${unit}`));

  // 아직 로그인 안 했으면 이 줄이 로그인할 이유가 된다
  if (!Cloud.ready()) {
    node.appendChild(el('div', { class: 'faint tiny', style: { marginTop: '2px' } },
      '로그인하면 이 기록이 순위표에 오른다.'));
  }
}
