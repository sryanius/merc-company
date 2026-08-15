/**
 * 펫 — 보유 목록 · 부대 배치
 * ════════════════════════════════════════════════════════════════════════════
 * 부대마다 3칸. 한 마리는 한 부대에만 들어간다.
 * 칸을 누르면 아래 목록에서 고르는 흐름이다 — 폰에 hover 가 없어 툴팁에 정보를 두면 안 된다.
 *
 * @module ui/pets
 */

import { el, num } from '../core/util.js';
import { state, save } from '../game/state.js';
import * as Pet from '../game/pet.js';
import { getPetSpecies, ROLE_NAME, ROLE_DESC, PETS_PER_SQUAD, PET_GRADES } from '../data/pets.js';
import { GRADE_COLOR } from '../art/palette.js';
import { go, refresh, toast } from './app.js';

/** 지금 고르고 있는 칸 `{squadId, slot}` — 화면을 다시 그려도 유지한다 */
let picking = null;
/** 목록 정렬 */
let sortBy = 'power';

/**
 * ★ 여기서 `picking` 을 지우면 안 된다.
 *   `app.js` 의 `refresh()` 는 다시 그리기 전에 `dispose()` 를 부른다 — 화면을 나갈 때만
 *   부르는 게 아니다. 여기서 선택을 지우면 "칸을 누른다 → 다시 그린다 → 선택이 사라진다"가 되어
 *   목록에서 펫을 눌러도 아무 일도 안 일어난다(실제로 그렇게 안 먹었다).
 */
export function dispose() { /* rAF·타이머 없음. picking 은 유지한다 */ }

const CSS = `
.pt-slots { display:flex; gap:8px; flex-wrap:wrap; }
.pt-slot { flex:1 1 130px; min-height:76px; border-radius:10px; padding:8px 10px; cursor:pointer;
           background:rgba(255,255,255,.04); border:1px dashed rgba(255,255,255,.14);
           display:flex; flex-direction:column; gap:3px; justify-content:center; }
.pt-slot.filled { border-style:solid; background:rgba(224,180,74,.07); border-color:rgba(224,180,74,.32); }
.pt-slot.active { border-color:var(--gold); background:rgba(224,180,74,.16); }
.pt-slot .nm { font-weight:700; font-size:13px; }
.pt-slot .ab { font-size:10px; color:var(--ink-faint); line-height:1.35; }
.pt-card { display:flex; gap:10px; align-items:center; padding:8px 10px; border-radius:8px;
           background:rgba(255,255,255,.04); cursor:pointer; }
.pt-card:hover { background:rgba(255,255,255,.08); }
.pt-card.used { opacity:.5; }
.pt-g { font-weight:800; font-size:15px; min-width:18px; text-align:center; }
.pt-list { display:flex; flex-direction:column; gap:6px; max-height:420px; overflow-y:auto; }
@media (max-width: 767px) {
  .pt-slot { flex:1 1 100%; }
  .pt-list { max-height:none; }
  /* 폰에서는 10px 이 안 읽힌다 — 프로젝트 하한(12px)까지 올린다.
     칸이 세로 1열로 펴지므로 글자를 키워도 넘치지 않는다. */
  .pt-slot .ab { font-size:12px; }
}
`;
function injectStyle() {
  if (document.getElementById('pets-style')) return;
  document.head.appendChild(el('style', { id: 'pets-style', text: CSS }));
}

/* ─────────────────────────── 화면 ─────────────────────────── */

export function render(root) {
  injectStyle();
  const st = state;
  const pets = Pet.allPets(st);

  root.appendChild(el('div', { class: 'col', style: { gap: '12px' } },
    el('div', { class: 'panel col', style: { gap: '8px' } },
      el('div', { class: 'row spread center', style: { gap: '10px', flexWrap: 'wrap' } },
        el('div', {},
          el('h3', { text: `펫 ${pets.length}마리`, style: { margin: '0' } }),
          el('div', { class: 'faint tiny', text: `부대마다 ${PETS_PER_SQUAD}마리까지. 무한의 탑에서 얻는다.` })),
        el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
          pets.length
            ? el('button', {
              class: 'btn sm',
              onClick: () => {
                const r = Pet.autoAssign(st);
                picking = null;
                save(); refresh();
                toast(r.placed ? `${r.squads}개 부대에 펫 ${r.placed}마리를 배치했다.` : '배치할 펫이 없다.',
                  r.placed ? 'good' : '');
              },
            }, '자동 배치')
            : null,
          el('button', { class: 'btn sm', onClick: () => go('tower') }, '탑으로'),
          el('button', { class: 'btn sm', onClick: () => go('company') }, '용병단으로'))),
      pets.length === 0
        ? el('div', { class: 'faint tiny', text: '아직 한 마리도 없다. 매달 1일에 열리는 무한의 탑에서 얻을 수 있다.' })
        : null),
    ...(st.squads || []).map((sq) => squadPanel(st, sq)),
    pets.length ? listPanel(st, pets) : null,
  ));
}

function squadPanel(st, sq) {
  const uids = Pet.petUidsOf(sq);
  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('div', { class: 'row spread center' },
      el('h3', { text: sq.name, style: { margin: '0' } }),
      el('span', { class: 'faint tiny', text: sq.status === 'away' ? '원정 중' : '' })),
    el('div', { class: 'pt-slots' },
      ...uids.map((uid, i) => slotBox(st, sq, i, uid))));
}

function slotBox(st, sq, i, uid) {
  const pet = uid ? Pet.getPet(st, uid) : null;
  const sp = pet ? getPetSpecies(pet.sid) : null;
  const active = picking && picking.squadId === sq.id && picking.slot === i;

  const cls = `pt-slot${pet ? ' filled' : ''}${active ? ' active' : ''}`;
  const onClick = () => {
    if (pet && active) {            // 이미 고른 칸을 다시 누르면 비운다
      Pet.assignPet(st, sq.id, i, null);
      picking = null;
      save(); refresh();
      return;
    }
    picking = active ? null : { squadId: sq.id, slot: i };
    refresh();
  };

  if (!pet) {
    return el('div', { class: cls, onClick },
      el('div', { class: 'nm', style: { color: 'var(--ink-faint)' }, text: active ? '아래에서 고르세요' : '빈 자리' }),
      el('div', { class: 'ab', text: active ? '다시 누르면 취소' : '눌러서 펫 배치' }));
  }
  return el('div', { class: cls, onClick },
    el('div', { class: 'row center', style: { gap: '6px' } },
      el('span', { class: 'pt-g', style: { color: GRADE_COLOR[pet.grade] || 'var(--ink)' }, text: pet.grade }),
      el('span', { class: 'nm', text: sp ? sp.name : '?' }),
      el('span', { class: 'faint tiny', text: sp ? ROLE_NAME[sp.role] : '' })),
    el('div', { class: 'ab', text: Pet.petAbilityText(pet) }),
    el('div', { class: 'ab', style: { color: 'var(--ink-faint)' }, text: active ? '다시 누르면 뺀다' : '' }));
}

function listPanel(st, pets) {
  const sorted = pets.slice().sort((a, b) => {
    if (sortBy === 'grade') return PET_GRADES.indexOf(b.grade) - PET_GRADES.indexOf(a.grade);
    if (sortBy === 'role') {
      const ra = getPetSpecies(a.sid)?.role || '', rb = getPetSpecies(b.sid)?.role || '';
      return ra.localeCompare(rb) || Pet.petPower(b) - Pet.petPower(a);
    }
    return Pet.petPower(b) - Pet.petPower(a);
  });

  const sortBtn = (k, label) => el('button', {
    class: `btn sm${sortBy === k ? ' on' : ''}`,
    onClick: () => { sortBy = k; refresh(); },
  }, label);

  return el('div', { class: 'panel col', style: { gap: '8px' } },
    el('div', { class: 'row spread center', style: { gap: '8px', flexWrap: 'wrap' } },
      el('h3', { text: picking ? '배치할 펫을 고르세요' : '보유 펫', style: { margin: '0' } }),
      el('div', { class: 'row', style: { gap: '4px' } },
        sortBtn('power', '전투력'), sortBtn('grade', '등급'), sortBtn('role', '역할'))),
    picking ? el('div', { class: 'muted tiny', text: '누르면 그 자리에 들어간다. 다른 부대에 있던 펫이면 거기서 빠진다.' }) : null,
    el('div', { class: 'pt-list' },
      ...sorted.map((p) => petCard(st, p))));
}

function petCard(st, pet) {
  const sp = getPetSpecies(pet.sid);
  const owner = Pet.squadOfPet(st, pet.uid);
  const onClick = () => {
    if (!picking) { toast(owner ? `${owner.name} 소속이다. 부대 칸을 눌러 바꿔라.` : '위의 부대 칸을 먼저 고르세요.'); return; }
    const r = Pet.assignPet(st, picking.squadId, picking.slot, pet.uid);
    if (!r.ok) { toast(r.error, 'bad'); return; }
    picking = null;
    save(); refresh();
  };
  return el('div', { class: `pt-card${owner && !picking ? ' used' : ''}`, onClick },
    el('span', { class: 'pt-g', style: { color: GRADE_COLOR[pet.grade] || 'var(--ink)' }, text: pet.grade }),
    el('div', { class: 'grow col', style: { gap: '2px' } },
      el('div', { class: 'row center', style: { gap: '6px' } },
        el('b', { text: sp ? sp.name : '?' }),
        el('span', { class: 'faint tiny', text: sp ? ROLE_NAME[sp.role] : '' }),
        owner ? el('span', { class: 'tiny', style: { color: 'var(--gold-dim)' }, text: owner.name }) : null),
      el('div', { class: 'faint tiny', text: Pet.petAbilityText(pet) })),
    el('div', { class: 'col', style: { gap: '2px', textAlign: 'right' } },
      el('div', { class: 'tiny', text: `전투력 ${num(Pet.petPower(pet))}` }),
      el('button', {
        class: 'btn sm',
        onClick: (ev) => {
          ev.stopPropagation();
          if (!confirm(`${Pet.petLabel(pet)} 을(를) 놓아줍니까? 되돌릴 수 없습니다.`)) return;
          Pet.releasePet(st, pet.uid);
          save(); refresh();
        },
      }, '놓아주기')));
}
