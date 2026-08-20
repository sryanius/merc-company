/* 임시 공용 헬퍼 — 끝나면 지운다 */
import * as State from '../src/game/state.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import * as Abyss from '../src/game/abyss.js';
import { questBattleDefs } from '../src/game/quest.js';

export const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function setup(grade, level, seed) {
  State.newGame(seed, `${grade}${level}`);
  const st = State.state; st.roster = []; st.items = [];
  const sq = st.squads[0]; sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    const m = { uid: `d_${i}`, name: getClass(classId).name, classId, level, grade, equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 };
    st.roster.push(m); sq.memberUids[i] = m.uid;
  });
  return st;
}

/** ★ 만든 즉시 값으로 꺼낸다 (State.state 싱글턴 함정) */
export function unitsOf(grade = 'A', level = 80, seed = 1000) {
  const st = setup(grade, level, seed); const sqId = st.squads[0].id;
  return questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies
    .map((u) => ({ ...u, stats: { ...u.stats } }));
}

export const mix = (i) => { let x = ((i + 1) * 2654435761 + 12345) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) || 1; };

export const scaled = (defs, k, extra = {}) => defs.map((u) => ({
  ...u, stats: { ...u.stats, atk: u.stats.atk * k, hp: u.stats.hp * k, def: u.stats.def * k, res: u.stats.res * k, ...extra },
}));
