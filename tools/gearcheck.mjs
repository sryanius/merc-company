/**
 * 난이도 곡선이 «장비» 를 감안하고 있는가
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 만들었나 — 제작자가 실제 플레이 중에 물었다:
 *   "평균 Lv80 · 전투력 88,000 · 10/10칸 풀장비인데 S급 의뢰를 쉽게 깬다. 맞나?"
 *
 *   라벨은 맞았다. 문제는 **난이도 곡선이 장비 없는 부대 기준으로 잡혀 있다**는 것이다.
 *   `tools/balance.mjs` 의 표준 부대(`stdSquad`)는 장비가 **하나도 없다.**
 *   랭크별 승률 목표(S 40~56% 등)가 전부 그 맨몸 부대 기준이다.
 *
 * ★ 그래서 이 도구는 «맨몸 기준선» 과 «실제 플레이어 스펙» 을 나란히 놓고 잰다.
 *
 * 실행: node tools/gearcheck.mjs
 */
import * as St from '../src/game/state.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import * as E from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Q from '../src/game/quest.js';
import * as Merc from '../src/game/merc.js';
import { RNG } from '../src/core/rng.js';
E.setSkillResolver(getSkill);
const S4=['bulwark_abyss','swordgod_apex','dragoonlord_apex','shadowblade_apex','masterarcher_apex','archmage_apex','highpriest_abyss'];
const SLOTS=['mainhand','offhand','head','body','legs','hands','feet','neck','ring1','ring2'];

function mk(classes, levels, grade, gear) {
  St.newGame(4242,'x'); const st=St.state; st.roster=[]; st.items=[];
  const sq=st.squads[0]; sq.memberUids=new Array(7).fill(null);
  const rng=new RNG(20260731);
  classes.forEach((c,i)=>{
    const m={uid:`g_${i}`,name:getClass(c).name,classId:c,level:levels[i],grade,equipment:{},hp:0,status:'idle',woundUntil:0,exp:0};
    if(gear){
      for(const s of SLOTS){ const it=St.rollLoot({ilvl:Math.min(80,levels[i]),rarityBonus:3,rng});
        if(it){st.items.push(it); m.equipment[it.slot||s]=it.uid;} }
    }
    st.roster.push(m); sq.memberUids[i]=`g_${i}`;
  });
  return st;
}
const pow=(st)=>{const idx=St.itemsById(st.items);return Math.round(st.roster.reduce((a,m)=>a+Merc.mercPower(m,{items:idx}),0));};
function mix(i){let z=(i+0x9e3779b9)>>>0;z=Math.imul(z^(z>>>16),0x21f0aaad)>>>0;z=Math.imul(z^(z>>>15),0x735a2d97)>>>0;return (z^(z>>>15))>>>0||1;}
function clear(st,q,n){const sqId=st.squads[0].id;let w2=0;
  for(let i=0;i<n;i++){let carry=null,ok=true;
    for(let w=0;w<q.waves.length;w++){const cfg=Q.questBattleDefs(q,w,st,sqId);
      const allies=Q.applyWaveCarry(cfg.allies,carry); if(!allies.length){ok=false;break;}
      const b=E.createBattle({...cfg,allies,seed:mix(i*31+w)});b.run();
      if(b.result.winner!=='ally'){ok=false;break;} carry=Q.readWaveCarry(b.units,carry||{});}
    if(ok)w2++;}
  return w2/n;}

const pool=[]; for(let s=0;s<40;s++) pool.push(...Q.genQuests('frostgate',300+s*3,new RNG(8000+s),1));
const Splus = pool.filter(q=>q.rank==='S' && q.sub===1 && !q.elite).slice(0,6);
const Elite = pool.filter(q=>q.rank==='S' && q.elite).slice(0,6);
console.log(`S+ 의뢰 ${Splus.length}건 (권장 Lv${Splus.map(q=>q.level).join('/')})`);

console.log('\n── 1. 장비가 전투력을 몇 배로 만드나 (4차 Lv80 7인)');
let base=0;
for (const [lab,gr,gear] of [['장비없음·B','B',false],['장비없음·S','S',false],['전설10칸·B','B',true],['전설10칸·S','S',true]]) {
  const st=mk(S4,new Array(7).fill(80),gr,gear);
  const p=pow(st); if(!base)base=p;
  console.log(`  ${lab.padEnd(14)} ${String(p).padStart(7)}   x${(p/base).toFixed(2)}`);
}

console.log('\n── 2. S+ 완주율');
const CASES = [
  ['7인 · Lv77 · B · 장비없음  (balance 기준)', S4, new Array(7).fill(77), 'B', false],
  ['7인 · Lv80 · B · 장비없음',                S4, new Array(7).fill(80), 'B', false],
  ['7인 · Lv80 · A · 전설10칸',                S4, new Array(7).fill(80), 'A', true],
  ['3인 · Lv80x2 + Lv36x1 · A · 전설10칸',
    ['bulwark_abyss','highpriest_abyss','dragoon'], [80,80,36], 'A', true],
  ['3인 · 같은 구성 · 장비없음 (대조)',
    ['bulwark_abyss','highpriest_abyss','dragoon'], [80,80,36], 'A', false],
  ['7인 · Lv80 · A · 전설10칸 (재확인)', S4, new Array(7).fill(80), 'A', true],
  ['2인 · Lv80 · A · 전설10칸',
    ['bulwark_abyss','highpriest_abyss'], [80,80], 'A', true],
];
for (const [lab, cls, lv, gr, gear] of CASES) {
  const st = mk(cls, lv, gr, gear);
  const p = pow(st);
  const avg = Splus.reduce((a,q)=>a+clear(st,q,9),0)/Splus.length;
  console.log(`  ${lab.padEnd(40)} 전투력 ${String(p).padStart(6)}   완주 ${(avg*100).toFixed(0)}%`);
}

console.log('\n── 3. 정예 S 의뢰 (보상 x2.2) 완주율');
for (const [lab, cls, lv, gr, gear] of CASES) {
  if (!Elite.length) break;
  const st = mk(cls, lv, gr, gear);
  const avg = Elite.reduce((a,q)=>a+clear(st,q,9),0)/Elite.length;
  console.log(`  ${lab.padEnd(40)} 완주 ${(avg*100).toFixed(0)}%`);
}
