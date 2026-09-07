/* 용병단 — 서비스 워커 (오프라인 실행 + 새 배포 반영)
 *
 * 이 파일은 ES 모듈이 아니라 **클래식 워커 스크립트**다. import 를 쓰지 마라
 * (`navigator.serviceWorker.register('./sw.js')` 를 모듈 타입 없이 부르기 때문이다).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 경로 규약 — 이 사이트는 도메인 루트가 아니다
 *   배포 위치가 `https://sryanius.github.io/merc-company/` 이므로 절대 경로(`/src/...`)를 쓰면
 *   전부 404 가 난다. 아래 목록과 폴백은 **전부 상대 경로**이고, 등록도 `./sw.js` 로 한다.
 *   워커의 기본 스코프 = 자기 파일이 있는 디렉터리 = `/merc-company/` 라 scope 를 따로 줄 필요가 없다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 배포 절차 (★ 이거 안 하면 폰에 옛 버전이 남는다)
 *   1. `CACHE` 의 버전을 올린다 (`merc-v1` → `merc-v2`).
 *   2. 모듈을 추가/삭제했으면 `APP_SHELL` 도 같이 손본다.
 *   버전을 깜빡해도 완전히 망가지지는 않는다 — 정적 자산은 stale-while-revalidate 라
 *   한 번 더 새로고침하면 최신이 된다. 다만 **즉시** 반영되게 하려면 버전을 올려라.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 캐시 전략
 *   · 내비게이션(문서 요청) → network-first + 캐시 폴백(`./index.html`).
 *     온라인이면 항상 최신 HTML 을 보고, 오프라인이면 캐시된 셸로 뜬다.
 *   · 그 외 동일 출처 GET → cache-first + 백그라운드 갱신(stale-while-revalidate).
 *     화면은 캐시로 즉시 뜨고, 뒤에서 새 파일을 받아 캐시를 갈아 끼운다.
 *   · 다른 출처 / GET 아닌 요청 → 손대지 않는다(그대로 네트워크).
 *
 * ★ 목록 하드코딩의 안전핀
 *   `APP_SHELL` 에서 빠진 모듈이 있어도 앱이 죽지 않는다.
 *   (a) install 은 `allSettled` 라 몇 개 실패해도 통과하고,
 *   (b) 목록에 없던 파일도 **온라인에서 처음 쓰는 순간 캐시에 들어간다**.
 *   즉 이 목록은 "첫 오프라인 실행을 보장하는 부팅 목록"이지 정답표가 아니다.
 */

/* ★ 배포할 때마다 올려라.
 * v17 — 이름 변경 아이콘 · 전투 로그 색상 · 의뢰 후 의뢰소 복귀.
 * v16 — 도시 설명문·시설 카드 접기.
 * v15 — 업데이트 이전 브라우저 세이브 1회 암호 확인.
 * v14 — 세이브 파일 봉인(변조 검출) + 옛 평문 파일 차단.
 * v13 — 따라하기 튜토리얼 + 진행도 해금 + 지금 할 일 안내.
 * v12 — 장비탭에서 화면 이동 없이 단원 상세 모달만 띄운다.
 * v11 — 자동착용이 대기 인원을 대상에서 제외 · 장비표 이름 클릭으로 단원 상세.
 * v10 — 장비표 부대별 구분 · 자동착용에 대기 해제 통합 · 이름변경 드래그 버그 · 툴팁 null.
 * v9 — 던전 드랍 30% · 단원별 착용 장비 표 · 자동착용 세트 유지 · 대기 인원 장비 해제.
 * v8 — 경제 조정: 탑 비용 1/2 · 의뢰 보상 +20% · 대기 인원 임금 할인.
 * v7 — 진행 재밸런스: 드랍 등급 곡선 / 세트 예산 / 진형 6종 / 던전·탑 재조정.
 * v6 — 장비 자동/일괄 판매 등급 선택 · 용병 이름 변경.
 * v5 — 던전 웨이브 연속 진행 / 세트 드랍이 전투 결과에 바로 표시.
 * v4 — 월드맵 탑 노드 / 정원 70 / 펫 자동배치 / 주점 특화 클래스 고정.
 * v3 — 무한의 탑 + 펫. 새 모듈 6개가 APP_SHELL 에 들어갔다.
 * v2 — 월드맵 라벨 겹침 수정(worldmap.js). */
const CACHE = 'merc-v205';
const CACHE_PREFIX = 'merc-';

/** 오프라인 첫 실행에 필요한 것 전부 (src 전 모듈 + css + manifest + icons). */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',

  './src/main.js',
  './src/core/rng.js',
  './src/core/util.js',

  './src/art/palette.js',
  './src/art/parts.js',
  './src/art/parts_body.js',
  './src/art/parts_gear.js',
  './src/art/spritegen.js',
  './src/art/scale.js',
  './src/art/pixel.js',
  './src/art/upscale.js',
  './src/art/portrait.js',
  './src/art/parts_front.js',
  './src/art/illustpng.js',
  './src/art/illust_manifest.js',
  './src/art/showcase.js',
  './src/art/fx.js',

  './src/data/skills.js',
  './src/data/classes.js',
  './src/data/classes_t4.js',
  './src/data/enginever.js',
  './src/data/items.js',
  './src/data/sets.js',
  './src/data/dungeons.js',
  './src/data/formations.js',
  './src/data/enemies.js',
  './src/data/world.js',
  './src/data/changelog.js',
  './src/data/names.js',

  './src/game/merc.js',
  './src/game/gear.js',
  './src/game/squad.js',
  './src/game/quest.js',
  './src/game/questgen.js',
  './src/game/questbattle.js',
  './src/game/settlejudge.js',
  './src/game/enemygen.js',
  './src/game/forecast.js',
  './src/game/dungeon.js',
  './src/game/state.js',
  './src/game/ambient.js',
  /* ★ 지금은 클라가 안 물지만, 물게 되는 날 오프라인에서 빠지지 않게 미리 넣는다 */
  './src/game/itembound.js',
  './src/game/runrows.js',
  './src/game/tavern.js',
  './src/game/day.js',
  './src/net/run.js',
  './src/net/settle.js',
  './src/net/mirror.js',

  './src/battle/engine.js',
  './src/battle/ai.js',
  './src/battle/renderer.js',

  './src/ui/app.js',
  './src/ui/city.js',
  './src/ui/worldmap.js',
  './src/ui/tavern.js',
  './src/ui/quests.js',
  './src/ui/company.js',
  './src/ui/inventory.js',
  './src/ui/battle.js',
  './src/ui/dungeon.js',
  './src/ui/savefile.js',

  './src/data/pets.js',
  './src/data/tower.js',
  './src/game/pet.js',
  './src/game/tower.js',
  './src/ui/tower.js',
  './src/ui/pets.js',
  './src/game/progress.js',
  './src/ui/tutorial.js',
  './src/data/abyss.js',
  './src/game/abyss.js',
  './src/game/runverify.js',
  './src/ui/abyss.js',
  './src/net/config.js',
  './src/net/rest.js',
  './src/net/auth.js',
  './src/net/cloud.js',
  './src/net/pvp.js',
  './src/net/gold.js',
  './src/game/rules.js',
  './src/data/limits.js',
  './src/data/heroes.js',
  './src/ui/rank.js',
  './src/ui/codex.js',
  './src/ui/pvp.js',
  './src/ui/pvpreplay.js',
  './src/ui/lineupview.js',
  './src/battle/tagmatch.js',
  './src/data/lineage.js',
  './src/ui/ranknote.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',

  /* PNG 일러스트 (art/illustpng.js, HANDOFF §161) — tools/illustpng.mjs 로 넣을 때마다 여기도 넣는다 (스모크가 검사) */
  './art/illust/illust_fighter.png',
  './art/illust/illust_swordsman.png',
  './art/illust/illust_spearman.png',
  './art/illust/illust_shieldman.png',
  './art/illust/illust_apprentice.png',
  './art/illust/illust_acolyte.png',
  './art/illust/illust_berserker.png',
  './art/illust/illust_swordmaster.png',
  './art/illust/illust_dragoon.png',
  './art/illust/illust_guardian.png',
  './art/illust/illust_sniper.png',
  './art/illust/illust_hunter.png',
  './art/illust/illust_assassin.png',
  './art/illust/illust_outlaw.png',
  './art/illust/illust_elementalist.png',
  './art/illust/illust_priest.png',
  './art/illust/illust_monk.png',
  './art/illust/illust_bloodfiend.png',
  './art/illust/illust_swordgod.png',
  './art/illust/illust_skysplitter.png',
  './art/illust/illust_dragoonlord.png',
  './art/illust/illust_skylancer.png',
  './art/illust/illust_gatewarden.png',
  './art/illust/illust_bulwark.png',
  './art/illust/illust_bloodfiend_apex.png',
  './art/illust/illust_bloodfiend_abyss.png',
  './art/illust/illust_swordgod_apex.png',
  './art/illust/illust_skysplitter_abyss.png',
  './art/illust/illust_skylancer_apex.png',
  './art/illust/illust_skylancer_abyss.png',
  './art/illust/illust_reaper_apex.png',
  './art/illust/illust_paladin_apex.png',
  './art/illust/illust_paladin_abyss.png',
  './art/illust/illust_blackknight_abyss.png',
  './art/illust/illust_bulwark_abyss.png',
  './art/illust/illust_shadowarcher_apex.png',
  './art/illust/illust_beastlord_apex.png',
  './art/illust/illust_shadowblade_abyss.png',
  './art/illust/illust_banditking_apex.png',
  './art/illust/illust_banditking_abyss.png',
  './art/illust/illust_archmage_apex.png',
  './art/illust/illust_highpriest_apex.png',
  './art/illust/illust_inquisitor_abyss.png',
  './art/illust/illust_paladin.png',
  './art/illust/illust_beastlord.png',
  './art/illust/illust_arhat.png',
  './art/illust/illust_swordgod_abyss.png',
  './art/illust/illust_dragoonlord_apex.png',
  './art/illust/illust_dragoonlord_abyss.png',
  './art/illust/illust_beastlord_abyss.png',
  './art/illust/illust_stormcaller_abyss.png',
  './art/illust/illust_arhat_apex.png',
  './art/illust/illust_archer.png',
  './art/illust/illust_rogue.png',
  './art/illust/illust_halberdier.png',
  './art/illust/illust_knight.png',
  './art/illust/illust_necromancer.png',
  './art/illust/illust_madgeneral.png',
  './art/illust/illust_reaper.png',
  './art/illust/illust_blackknight.png',
  './art/illust/illust_oathshield.png',
  './art/illust/illust_masterarcher.png',
  './art/illust/illust_shadowarcher.png',
  './art/illust/illust_spiritranger.png',
  './art/illust/illust_shadowblade.png',
  './art/illust/illust_venomfang.png',
  './art/illust/illust_banditking.png',
  './art/illust/illust_bladedancer.png',
  './art/illust/illust_archmage.png',
  './art/illust/illust_stormcaller.png',
  './art/illust/illust_lichlord.png',
  './art/illust/illust_plaguelord.png',
  './art/illust/illust_highpriest.png',
  './art/illust/illust_inquisitor.png',
  './art/illust/illust_fallenmonk.png',
  './art/illust/illust_madgeneral_apex.png',
  './art/illust/illust_madgeneral_abyss.png',
  './art/illust/illust_skysplitter_apex.png',
  './art/illust/illust_gatewarden_abyss.png',
  './art/illust/illust_gatewarden_apex.png',
  './art/illust/illust_reaper_abyss.png',
  './art/illust/illust_blackknight_apex.png',
  './art/illust/illust_bulwark_apex.png',
  './art/illust/illust_oathshield_abyss.png',
  './art/illust/illust_oathshield_apex.png',
  './art/illust/illust_masterarcher_apex.png',
  './art/illust/illust_masterarcher_abyss.png',
  './art/illust/illust_shadowarcher_abyss.png',
  './art/illust/illust_spiritranger_apex.png',
  './art/illust/illust_spiritranger_abyss.png',
  './art/illust/illust_shadowblade_apex.png',
  './art/illust/illust_venomfang_apex.png',
  './art/illust/illust_venomfang_abyss.png',
  './art/illust/illust_bladedancer_apex.png',
  './art/illust/illust_bladedancer_abyss.png',
  './art/illust/illust_archmage_abyss.png',
  './art/illust/illust_stormcaller_apex.png',
  './art/illust/illust_lichlord_apex.png',
  './art/illust/illust_lichlord_abyss.png',
  './art/illust/illust_plaguelord_apex.png',
  './art/illust/illust_plaguelord_abyss.png',
  './art/illust/illust_highpriest_abyss.png',
  './art/illust/illust_inquisitor_apex.png',
  './art/illust/illust_arhat_abyss.png',
  './art/illust/illust_fallenmonk_apex.png',
  './art/illust/illust_fallenmonk_abyss.png',
  './art/illust/illust_enemy_goblin_grunt.png',
  './art/illust/illust_enemy_goblin_archer.png',
  './art/illust/illust_enemy_goblin_bomber.png',
  './art/illust/illust_enemy_hobgoblin.png',
  './art/illust/illust_enemy_wild_boar.png',
  './art/illust/illust_enemy_harpy.png',
  './art/illust/illust_enemy_bandit_thug.png',
  './art/illust/illust_enemy_bandit_archer.png',
  './art/illust/illust_enemy_cutthroat.png',
  './art/illust/illust_enemy_bandit_brute.png',
  './art/illust/illust_enemy_rogue_mage.png',
  './art/illust/illust_enemy_orc_archer.png',
  './art/illust/illust_enemy_orc_berserker.png',
  './art/illust/illust_enemy_orc_shaman.png',
  './art/illust/illust_enemy_orc_shieldbearer.png',
  './art/illust/illust_enemy_bone_knight.png',
  './art/illust/illust_enemy_necromancer.png',
  './art/illust/illust_enemy_swamp_troll.png',
  './art/illust/illust_enemy_cave_troll.png',
  './art/illust/illust_enemy_ogre_bruiser.png',
  './art/illust/illust_enemy_frost_ogre.png',
  './art/illust/illust_enemy_darkelf_blade.png',
  './art/illust/illust_enemy_cultist_zealot.png',
  './art/illust/illust_enemy_lizardman_scout.png',
  './art/illust/illust_enemy_lizardman_spear.png',
  './art/illust/illust_enemy_lizardman_shaman.png',
  './art/illust/illust_enemy_lizardman_bruiser.png',
  './art/illust/illust_enemy_flame_wisp.png',
  './art/illust/illust_enemy_imp.png',
  './art/illust/illust_enemy_succubus.png',
  './art/illust/illust_enemy_void_sentinel.png',
  './art/illust/illust_enemy_bandit_lord.png',
  './art/illust/illust_enemy_cult_hierarch.png',
  './art/illust/illust_enemy_ancient_troll.png',
  './art/illust/illust_enemy_darkelf_priestess.png',
  './art/illust/illust_enemy_lich.png',
  './art/illust/illust_enemy_demon_lord.png',
  './art/illust/illust_enemy_flame_dragon.png',
  './art/illust/illust_enemy_cave_bear.png',
  './art/illust/illust_enemy_iron_juggernaut.png',
  './art/illust/illust_enemy_storm_herald.png',
  './art/illust/illust_enemy_blood_captain.png',
  './art/illust/illust_enemy_nightmare_stalker.png',
  './art/illust/illust_enemy_blight_archon.png',
  './art/illust/illust_enemy_wight.png',
  './art/illust/illust_enemy_cultist_acolyte.png',
  './art/illust/illust_enemy_cult_priest.png',
  './art/illust/illust_enemy_skeleton_soldier.png',
  './art/illust/illust_enemy_plague_zombie.png',
  './art/illust/illust_enemy_ghoul.png',
  './art/illust/illust_enemy_darkelf_ranger.png',
  './art/illust/illust_enemy_hellhound.png',
  './art/illust/illust_enemy_abyss_reaper.png',
  './art/illust/illust_enemy_abyss_hierophant.png',
  './art/illust/illust_enemy_abyss_marksman.png',
  './art/illust/illust_enemy_goblin_chief.png',
  './art/illust/illust_enemy_orc_warlord.png',
  './art/illust/illust_enemy_void_titan.png',
  './art/illust/illust_enemy_darkelf_warlock.png',
  './art/illust/illust_enemy_hoarfrost_seer.png',
  './art/illust/illust_archer_atk.png',
  './art/illust/illust_berserker_atk.png',
  './art/illust/illust_hunter_atk.png',
  './art/illust/illust_monk_atk.png',
  './art/illust/illust_madgeneral_atk.png',
  './art/illust/illust_bloodfiend_atk.png',
  './art/illust/illust_swordgod_atk.png',
  './art/illust/illust_reaper_atk.png',
  './art/illust/illust_paladin_atk.png',
  './art/illust/illust_bladedancer_atk.png',
  './art/illust/illust_archmage_atk.png',
  './art/illust/illust_madgeneral_abyss_atk.png',
  './art/illust/illust_swordgod_apex_atk.png',
  './art/illust/illust_swordgod_abyss_atk.png',
  './art/illust/illust_reaper_abyss_atk.png',
  './art/illust/illust_paladin_abyss_atk.png',
  './art/illust/illust_spiritranger_apex_atk.png',
  './art/illust/illust_spiritranger_abyss_atk.png',
  './art/illust/illust_shadowblade_abyss_atk.png',
  './art/illust/illust_bladedancer_abyss_atk.png',
  './art/illust/illust_highpriest_abyss_atk.png',
  './art/illust/illust_highpriest_apex_atk.png',
  './art/illust/illust_arhat_abyss_atk.png',
  './art/illust/illust_enemy_goblin_shaman.png',
  './art/illust/illust_enemy_goblin_rider.png',
  './art/illust/illust_enemy_dire_wolf.png',
  './art/illust/illust_enemy_cave_spider.png',
  './art/illust/illust_enemy_orc_warrior.png',
  './art/illust/illust_enemy_stone_golem.png',
  './art/illust/illust_enemy_storm_wisp.png',
  './art/illust/illust_enemy_demon_warrior.png',
  './art/illust/illust_enemy_blight_druid.png',
  './art/illust/illust_swordsman_atk.png',
  './art/illust/illust_spearman_atk.png',
  './art/illust/illust_shieldman_atk.png',
  './art/illust/illust_acolyte_atk.png',
  './art/illust/illust_halberdier_atk.png',
  './art/illust/illust_sniper_atk.png',
  './art/illust/illust_outlaw_atk.png',
  './art/illust/illust_elementalist_atk.png',
  './art/illust/illust_necromancer_atk.png',
  './art/illust/illust_priest_atk.png',
  './art/illust/illust_skysplitter_atk.png',
  './art/illust/illust_dragoonlord_atk.png',
  './art/illust/illust_skylancer_atk.png',
  './art/illust/illust_masterarcher_atk.png',
  './art/illust/illust_shadowarcher_atk.png',
  './art/illust/illust_beastlord_atk.png',
  './art/illust/illust_shadowblade_atk.png',
  './art/illust/illust_venomfang_atk.png',
  './art/illust/illust_stormcaller_atk.png',
  './art/illust/illust_lichlord_atk.png',
  './art/illust/illust_plaguelord_atk.png',
  './art/illust/illust_inquisitor_atk.png',
  './art/illust/illust_arhat_atk.png',
  './art/illust/illust_fallenmonk_atk.png',
  './art/illust/illust_bloodfiend_apex_atk.png',
  './art/illust/illust_bloodfiend_abyss_atk.png',
  './art/illust/illust_skylancer_apex_atk.png',
  './art/illust/illust_skylancer_abyss_atk.png',
  './art/illust/illust_gatewarden_abyss_atk.png',
  './art/illust/illust_paladin_apex_atk.png',
  './art/illust/illust_blackknight_apex_atk.png',
  './art/illust/illust_bulwark_abyss_atk.png',
  './art/illust/illust_oathshield_abyss_atk.png',
  './art/illust/illust_oathshield_apex_atk.png',
  './art/illust/illust_masterarcher_apex_atk.png',
  './art/illust/illust_masterarcher_abyss_atk.png',
  './art/illust/illust_beastlord_apex_atk.png',
  './art/illust/illust_beastlord_abyss_atk.png',
  './art/illust/illust_shadowblade_apex_atk.png',
  './art/illust/illust_venomfang_abyss_atk.png',
  './art/illust/illust_banditking_apex_atk.png',
  './art/illust/illust_banditking_abyss_atk.png',
  './art/illust/illust_archmage_apex_atk.png',
  './art/illust/illust_archmage_abyss_atk.png',
  './art/illust/illust_stormcaller_apex_atk.png',
  './art/illust/illust_stormcaller_abyss_atk.png',
  './art/illust/illust_lichlord_apex_atk.png',
  './art/illust/illust_lichlord_abyss_atk.png',
  './art/illust/illust_plaguelord_apex_atk.png',
  './art/illust/illust_inquisitor_apex_atk.png',
  './art/illust/illust_inquisitor_abyss_atk.png',
  './art/illust/illust_fallenmonk_abyss_atk.png',
  './art/illust/illust_enemy_gray_wolf.png',
  './art/illust/illust_enemy_skeleton_archer.png',
  './art/illust/illust_enemy_alpha_wolf.png',
  './art/illust/illust_apprentice_atk.png',
  './art/illust/illust_knight_atk.png',
  './art/illust/illust_assassin_atk.png',
  './art/illust/illust_oathshield_atk.png',
  './art/illust/illust_spiritranger_atk.png',
  './art/illust/illust_madgeneral_apex_atk.png',
  './art/illust/illust_skysplitter_apex_atk.png',
  './art/illust/illust_skysplitter_abyss_atk.png',
  './art/illust/illust_dragoonlord_apex_atk.png',
  './art/illust/illust_gatewarden_apex_atk.png',
  './art/illust/illust_blackknight_abyss_atk.png',
  './art/illust/illust_shadowarcher_apex_atk.png',
  './art/illust/illust_shadowarcher_abyss_atk.png',
  './art/illust/illust_plaguelord_abyss_atk.png',
  './art/illust/illust_enemy_saber_cat.png',
  './art/illust/illust_enemy_highwayman.png',
  './art/illust/illust_enemy_frost_spirit.png',
  './art/illust/illust_bulwark_atk.png',
  './art/illust/illust_dragoonlord_abyss_atk.png',
  './art/illust/illust_bladedancer_apex_atk.png',
  './art/illust/illust_arhat_apex_atk.png',
  './art/illust/illust_swordmaster_atk.png',
  './art/illust/illust_venomfang_apex_atk.png',
  './art/illust/illust_rogue_atk.png',
  './art/illust/illust_reaper_apex_atk.png',
  './art/illust/illust_blackknight_atk.png',
  './art/illust/illust_banditking_atk.png',
  './art/illust/illust_fallenmonk_apex_atk.png',
  './art/illust/illust_gatewarden_atk.png',
  './art/illust/illust_dragoon_atk.png',
  './art/illust/illust_bulwark_apex_atk.png',
  './art/illust/illust_guardian_atk.png',
  './art/illust/illust_highpriest_atk.png',
  './art/illust/illust_hero_swordgod_apex.png',
  './art/illust/illust_hero_swordgod_apex_atk.png',
  './art/illust/illust_hero_swordgod_abyss.png',
  './art/illust/illust_hero_swordgod_abyss_atk.png',
  './art/illust/illust_hero_madgeneral_apex.png',
  './art/illust/illust_hero_madgeneral_apex_atk.png',
  './art/illust/illust_hero_madgeneral_abyss.png',
  './art/illust/illust_hero_madgeneral_abyss_atk.png',
  './art/illust/illust_hero_skysplitter_apex.png',
  './art/illust/illust_hero_skysplitter_apex_atk.png',
  './art/illust/illust_hero_skysplitter_abyss.png',
  './art/illust/illust_hero_skysplitter_abyss_atk.png',
  './art/illust/illust_hero_bloodfiend_apex.png',
  './art/illust/illust_hero_bloodfiend_apex_atk.png',
  './art/illust/illust_hero_bloodfiend_abyss.png',
  './art/illust/illust_hero_bloodfiend_abyss_atk.png',
  './art/illust/illust_hero_gatewarden_apex.png',
  './art/illust/illust_hero_gatewarden_apex_atk.png',
  './art/illust/illust_hero_gatewarden_abyss.png',
  './art/illust/illust_hero_gatewarden_abyss_atk.png',
  './art/illust/illust_hero_reaper_apex.png',
  './art/illust/illust_hero_reaper_apex_atk.png',
  './art/illust/illust_hero_reaper_abyss.png',
  './art/illust/illust_hero_reaper_abyss_atk.png',
  './art/illust/illust_hero_dragoonlord_apex.png',
  './art/illust/illust_hero_dragoonlord_apex_atk.png',
  './art/illust/illust_hero_dragoonlord_abyss.png',
  './art/illust/illust_hero_dragoonlord_abyss_atk.png',
  './art/illust/illust_hero_skylancer_apex.png',
  './art/illust/illust_hero_skylancer_apex_atk.png',
  './art/illust/illust_hero_skylancer_abyss.png',
  './art/illust/illust_hero_skylancer_abyss_atk.png',
  './art/illust/illust_hero_bulwark_apex.png',
  './art/illust/illust_hero_bulwark_apex_atk.png',
  './art/illust/illust_hero_bulwark_abyss.png',
  './art/illust/illust_hero_bulwark_abyss_atk.png',
  './art/illust/illust_hero_oathshield_apex.png',
  './art/illust/illust_hero_oathshield_apex_atk.png',
  './art/illust/illust_hero_oathshield_abyss.png',
  './art/illust/illust_hero_oathshield_abyss_atk.png',
  './art/illust/illust_hero_paladin_apex.png',
  './art/illust/illust_hero_paladin_apex_atk.png',
  './art/illust/illust_hero_paladin_abyss.png',
  './art/illust/illust_hero_paladin_abyss_atk.png',
  './art/illust/illust_hero_blackknight_apex.png',
  './art/illust/illust_hero_blackknight_apex_atk.png',
  './art/illust/illust_hero_blackknight_abyss.png',
  './art/illust/illust_hero_blackknight_abyss_atk.png',
  './art/illust/illust_hero_shadowarcher_apex.png',
  './art/illust/illust_hero_shadowarcher_apex_atk.png',
  './art/illust/illust_hero_shadowarcher_abyss.png',
  './art/illust/illust_hero_shadowarcher_abyss_atk.png',
  './art/illust/illust_hero_masterarcher_apex.png',
  './art/illust/illust_hero_masterarcher_apex_atk.png',
  './art/illust/illust_hero_masterarcher_abyss.png',
  './art/illust/illust_hero_masterarcher_abyss_atk.png',
  './art/illust/illust_hero_beastlord_apex.png',
  './art/illust/illust_hero_beastlord_apex_atk.png',
  './art/illust/illust_hero_beastlord_abyss.png',
  './art/illust/illust_hero_beastlord_abyss_atk.png',
  './art/illust/illust_hero_spiritranger_apex.png',
  './art/illust/illust_hero_spiritranger_apex_atk.png',
  './art/illust/illust_hero_spiritranger_abyss.png',
  './art/illust/illust_hero_spiritranger_abyss_atk.png',
  './art/illust/illust_hero_shadowblade_apex.png',
  './art/illust/illust_hero_shadowblade_apex_atk.png',
  './art/illust/illust_hero_shadowblade_abyss.png',
  './art/illust/illust_hero_shadowblade_abyss_atk.png',
  './art/illust/illust_hero_banditking_apex.png',
  './art/illust/illust_hero_banditking_apex_atk.png',
  './art/illust/illust_hero_banditking_abyss.png',
  './art/illust/illust_hero_banditking_abyss_atk.png',
  './art/illust/illust_hero_venomfang_apex.png',
  './art/illust/illust_hero_venomfang_apex_atk.png',
  './art/illust/illust_hero_venomfang_abyss.png',
  './art/illust/illust_hero_venomfang_abyss_atk.png',
  './art/illust/illust_hero_bladedancer_apex.png',
  './art/illust/illust_hero_bladedancer_apex_atk.png',
  './art/illust/illust_hero_bladedancer_abyss.png',
  './art/illust/illust_hero_bladedancer_abyss_atk.png',
  './art/illust/illust_hero_archmage_apex.png',
  './art/illust/illust_hero_archmage_apex_atk.png',
  './art/illust/illust_hero_archmage_abyss.png',
  './art/illust/illust_hero_archmage_abyss_atk.png',
  './art/illust/illust_hero_lichlord_apex.png',
  './art/illust/illust_hero_lichlord_apex_atk.png',
  './art/illust/illust_hero_lichlord_abyss.png',
  './art/illust/illust_hero_lichlord_abyss_atk.png',
  './art/illust/illust_hero_plaguelord_apex.png',
  './art/illust/illust_hero_plaguelord_apex_atk.png',
  './art/illust/illust_hero_plaguelord_abyss.png',
  './art/illust/illust_hero_plaguelord_abyss_atk.png',
  './art/illust/illust_hero_stormcaller_apex.png',
  './art/illust/illust_hero_stormcaller_apex_atk.png',
  './art/illust/illust_hero_stormcaller_abyss.png',
  './art/illust/illust_hero_stormcaller_abyss_atk.png',
  './art/illust/illust_hero_arhat_apex.png',
  './art/illust/illust_hero_arhat_apex_atk.png',
  './art/illust/illust_hero_arhat_abyss.png',
  './art/illust/illust_hero_arhat_abyss_atk.png',
  './art/illust/illust_hero_highpriest_apex.png',
  './art/illust/illust_hero_highpriest_apex_atk.png',
  './art/illust/illust_hero_highpriest_abyss.png',
  './art/illust/illust_hero_highpriest_abyss_atk.png',
  './art/illust/illust_hero_inquisitor_apex.png',
  './art/illust/illust_hero_inquisitor_apex_atk.png',
  './art/illust/illust_hero_inquisitor_abyss.png',
  './art/illust/illust_hero_inquisitor_abyss_atk.png',
  './art/illust/illust_hero_fallenmonk_apex.png',
  './art/illust/illust_hero_fallenmonk_apex_atk.png',
  './art/illust/illust_hero_fallenmonk_abyss.png',
  './art/illust/illust_hero_fallenmonk_abyss_atk.png',
];

/** 모든 클라이언트에 알린다 (index.html 의 갱신 배너가 받는다). */
/* ★★★ **스스로 새로고침할 줄 아는 셸**의 id (§160).
 *
 *   184판부터 페이지 안에 자동 갱신이 있다 — «안전한 때»(전투 아님·창 없음)를
 *   게임에 물어보고 그때 새로고침한다. 그 셸은 여기에 «내가 한다» 고 답한다.
 *
 * ★ **답이 없는 창이 곧 옛 셸이다.** 그 코드가 아예 없으니 답을 못 한다.
 *   실측(9/1): 도는 계정 4개가 전부 163~180판이었다 — 자동 갱신이 **아무에게도
 *   없었다.** 서버 쪽 공사(§146~§159)가 통째로 아무에게도 안 닿고 있었다. */
const ALIVE = new Set();
const GRACE_MS = 3000;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 답 없는 창을 **워커가 직접 새로고침시킨다.**
 *
 * ★ 왜 워커가 하나: 옛 셸에는 새로고침을 스스로 할 코드가 없다. 배너를 띄워도
 *   누르지 않으면 그만이고, 실제로 한 계정이 그렇게 **나흘을 옛 판으로 놀았다**.
 *   워커는 배포와 함께 통째로 갈리므로 **옛 셸의 협조가 필요 없는 유일한 자리**다.
 *
 * ★ 안 보는 탭부터 돌린다 — 보고 있는 화면이 갑자기 바뀌는 것보다 낫다.
 * ★ 고리가 안 생긴다: activate 는 **판마다 한 번**만 돈다.
 */
async function reloadOldShells() {
  await nap(GRACE_MS);                       // 새 셸이 답할 시간
  let list = [];
  try { list = await self.clients.matchAll({ type: 'window' }); } catch { return; }
  const rank = (c) => (c.visibilityState === 'hidden' ? 0 : 1);
  for (const c of [...list].sort((a, b) => rank(a) - rank(b))) {
    if (ALIVE.has(c.id)) continue;           // 스스로 하는 셸은 안 건드린다
    try { await c.navigate(c.url); } catch (err) { console.warn('[sw] 새로고침 못 시켰다', err); }
  }
}

async function tellClients(msg) {
  const list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of list) c.postMessage(msg);
}

// ── install: 부팅 목록을 통째로 캐시한다 ────────────────────────────────────
/**
 * 부팅 목록을 캐시하고, 실패한 것만 한 번 더 시도한다.
 *
 * · `cache.addAll` 을 안 쓰는 이유: 하나만 404 나도 **전부** 실패한다.
 *   목록이 손으로 관리되는 이상(빌드 스텝이 없다) 그건 너무 취약하다.
 * · 배치로 쪼개 `await` 를 여러 번 거는 방식은 **일부러 쓰지 않는다.** 실측에서
 *   배경 탭처럼 스로틀링된 상태일 때 배치 사이에서 워커가 잘려 캐시가 0건으로 끝났다.
 *   한 번에 던지면 요청이 전부 큐에 올라간 뒤라 그 사이 잘릴 틈이 없다
 *   (동시 연결 수는 어차피 브라우저가 알아서 제한한다).
 * @returns {Promise<string[]>} 두 번 시도하고도 실패한 URL
 */
async function precache(cache) {
  const tryAll = async (urls, init) => {
    const rs = await Promise.allSettled(urls.map((u) => cache.add(new Request(u, init))));
    return urls.filter((_, i) => rs[i].status === 'rejected');
  };
  // 1차: HTTP 캐시를 건너뛰고 네트워크에서 새로 받는다 (옛 파일이 박제되는 걸 막는다).
  const failed = await tryAll(APP_SHELL, { cache: 'reload' });
  // 2차: 남은 것만 평범하게 한 번 더. 여기서도 실패하면 포기하고 런타임 캐시에 맡긴다.
  return failed.length ? tryAll(failed, undefined) : [];
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const failed = await precache(cache);
    if (failed.length) console.warn('[sw] 캐시 실패(무시하고 진행):', failed);
    // 대기 상태로 머물지 않는다 — 새 배포가 다음 새로고침에 바로 잡히게.
    await self.skipWaiting();
  })());
});

// ── activate: 옛 캐시를 지우고 즉시 제어권을 가져온다 ───────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    const old = names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE);
    await Promise.all(old.map((n) => caches.delete(n)));
    await self.clients.claim();
    // 옛 캐시를 지웠다 = 첫 설치가 아니라 **갱신**이다. 이때만 새로고침을 권한다
    // (첫 방문자에게 "새 버전이 있다"고 띄우면 거짓말이다).
    if (old.length) {
      await tellClients({ type: 'merc-sw-updated', version: CACHE });
      /* ★ 배너·자동 갱신으로 안 되는 창을 **여기서** 끝낸다 (§160) */
      await reloadOldShells();
    }
  })());
});

// ── fetch ──────────────────────────────────────────────────────────────────
/** 캐시에 넣어도 되는 응답인가 (opaque·에러·부분응답 제외) */
const cacheable = (res) => res && res.ok && res.status === 200 && res.type === 'basic';

/** 백그라운드 갱신. 실패는 조용히 삼킨다(오프라인이 정상 상태다). */
function revalidate(req, cache) {
  return fetch(req)
    .then((res) => { if (cacheable(res)) cache.put(req, res.clone()); return res; })
    .catch(() => null);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 외부 리소스는 건드리지 않는다
  // 개발 도구(`tools/mobileaudit.js` 등)는 캐시 대상이 아니다.
  // `startsWith('/tools/')` 로 쓰면 안 된다 — 이 사이트는 `/merc-company/` 하위다.
  if (url.pathname.includes('/tools/')) return;

  // 내비게이션 = network-first. 온라인이면 항상 최신 index.html 을 본다.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (cacheable(fresh)) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(req))
          || (await cache.match('./index.html'))
          || (await cache.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  // 그 외 정적 자산 = cache-first + 백그라운드 갱신.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) {
      e.waitUntil(revalidate(req, cache));   // 응답은 이미 돌려줬다 — 갱신은 뒤에서
      return hit;
    }
    // 목록에 없던 모듈이 여기로 온다. 성공하면 그대로 캐시에 들어가 다음부터 오프라인이 된다.
    const res = await revalidate(req, cache);
    return res || Response.error();
  })());
});

// ── 페이지에서 오는 명령 ────────────────────────────────────────────────────
self.addEventListener('message', (e) => {
  const t = e.data && e.data.type;
  if (t === 'merc-skip-waiting') self.skipWaiting();
  if (t === 'merc-version' && e.source) e.source.postMessage({ type: 'merc-sw-version', version: CACHE });
  /* ★ «내가 안전한 때에 알아서 새로고침한다» — 이 답이 있는 창만 안 건드린다 (§160) */
  if (t === 'merc-alive' && e.source && e.source.id) ALIVE.add(e.source.id);
});
