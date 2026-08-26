/**
 * 스탯 천장 실측 — 「등록 상한을 어디에 둘 것인가」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 이 도구가 생긴 이유는 **같은 실패를 세 번 했기 때문**이다.
 *
 *   1차 (§68.1): `rollItem` 으로 재서 **세트 보너스**가 빠졌다 → 제작자의 atk 8514 가 거절됐다.
 *   2차 (§94):   `mercStats` 로만 재서 **진형 보정·펫 배율**이 빠졌다.
 *   3차 (§94):   S등급만 재서 **낮은 등급**이 빠졌다 (치명은 고정 스탯이라 맨몸이 작을수록
 *                배율이 커진다 — 최악은 언제나 F등급 쪽에 있었다).
 *
 *   세 번 다 원인이 같다 — **재는 경로가 실제 등록 경로보다 짧았다.**
 *   그래서 스윕은 `tools/lib/statceiling.mjs` 하나로 모았고, **스모크도 같은 것을 쓴다.**
 *
 * 사용: node tools/statceiling.mjs
 */
import { sweep, gates, KEYS } from './lib/statceiling.mjs';
import {
  checkUnit, bareStats, ABSOLUTE, MAX_RATIO, MEASURED_MAX, SLACK,
} from '../supabase/functions/pvp-battle/statbound.js';

const gateBad = gates();
if (gateBad.length) {
  for (const b of gateBad) console.log(`✗ ${b} — 멈춘다`);
  process.exit(1);
}

const { tested, rejects, best, ratio, petBest } = sweep(checkUnit, { bareStats });

/* ★ 반올림 잡음으로 «낮다» 를 띄우면 다음번엔 그 경고를 안 믿게 된다.
 *   0.5% 여유를 두고, 정말 낮을 때만 **고쳐 넣을 값까지** 같이 적어 준다. */
const EPS = 1.005;
const low = [];

console.log('펫 지휘 최대 합산 ' + Object.entries(petBest).map(([k, v]) => `${k} +${(v * 100).toFixed(0)}%`).join(' · '));
console.log('');
console.log('key        실측 최대   지금 MEASURED_MAX     여유   어디서');
for (const k of KEYS) {
  const b = best[k];
  if (!b) continue;
  const cur = MEASURED_MAX[k];
  const slack = cur ? cur / b.v : NaN;
  const isLow = !cur || cur * EPS < b.v;
  if (isLow) low.push(`MEASURED_MAX.${k} = ${Math.ceil(b.v)}  (지금 ${cur})`);
  const flag = isLow ? ' ← 낮다!' : '';
  console.log(`${k.padEnd(9)} ${b.v.toFixed(2).padStart(11)} ${String(cur ?? '-').padStart(18)} ${slack.toFixed(2).padStart(6)}${flag}   ${b.who}`);
}

console.log('');
console.log('맨몸 대비 최대 배율 (전 등급 포함)');
for (const k of KEYS) {
  const r = ratio[k];
  if (!r) continue;
  const cur = MAX_RATIO[k];
  const isLow = !cur || cur * EPS < r.r;
  if (isLow) low.push(`MAX_RATIO.${k} = ${(Math.ceil(r.r * 100) / 100).toFixed(2)}  (지금 ${cur})`);
  const flag = isLow ? ' ← 낮다!' : '';
  console.log(`  ${k.padEnd(9)} x${r.r.toFixed(2).padStart(7)}   지금 ${String(cur).padStart(6)}${flag}   ${r.who}`);
}

console.log('');
if (low.length) {
  console.log('★ statbound.js 에 이렇게 고쳐 넣어야 한다:');
  for (const l of low) console.log(`    ${l}`);
  console.log('');
}
console.log(`절대 상한 = 실측 최대 × 여유 ${SLACK} → ${JSON.stringify(ABSOLUTE)}`);
console.log('');
if (rejects.length) {
  console.log(`✗ 정상 빌드 ${rejects.length} / ${tested} 개가 등록에서 거절된다`);
  /* 같은 사유끼리 묶어서 보여준다 — 무엇을 고쳐야 하는지가 사유다 */
  const byKey = {};
  for (const r of rejects) {
    const k = (r.split(': ')[1] || '').split(' ')[0];
    (byKey[k] = byKey[k] || []).push(r);
  }
  for (const [k, list] of Object.entries(byKey)) console.log(`  ${k}: ${list.length}개 — 예) ${list[0]}`);
  process.exitCode = 1;
} else {
  console.log(`✓ 정상 빌드 ${tested} 개가 전부 등록에 통과한다`);
}
