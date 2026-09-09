# tools/art — 일러스트·영웅 데이터 생성기 (§183)

세션 임시 폴더에만 있던 생성기를 저장소로 들여왔다. **한 번 쓰고 버리는 패치 스크립트는 안 가져왔다** —
여기 있는 것은 전부 «다시 돌릴 수 있어야 하는» 것들이다.

## 경로 규칙

| | 어디 | 무엇 |
|---|---|---|
| 입력 | `tools/art/data/` (저장소 안) | 원고·클래스/적 목록·손으로 쓴 보정표 |
| 산출 | `MERC_ART_DIR` (기본 `C:/claude/artwork`, 저장소 밖) | raw PNG·중간물·results\*.json — 수백 MB |

작업 폴더를 옮기려면 환경변수만 바꾸면 된다 (경로는 `/` 로 적는다):

    MERC_ART_DIR=D:/art node tools/art/gen_all.mjs --reuse

## 스크립트

| 스크립트 | 하는 일 | 필요한 것 |
|---|---|---|
| `gen_heroes.cjs` | `data/t4.json` + `data/herotext.json` → **`src/data/heroes.js` 를 통째로 다시 쓴다** | node 만 |
| `gen_hero_art.mjs` | 영웅 56명 대기(txt2img) + 공격(Qwen «자세만») → `illust_hero_<id>(_atk)` | ComfyUI :8188 · edit.py |
| `gen_all.mjs` | 클래스 105종 대기 일러스트 | ComfyUI :8188 |
| `gen_atk_cn.mjs` | 공격 자세 — ControlNet OpenPose (§166·§170, 지금 쓰는 것) | ComfyUI :8188 |
| `gen_atk.mjs` | 공격 자세 — img2img (옛 방식, 기록용) | ComfyUI :8188 |
| `gen_enemies.mjs` | 적 75종 일러스트 | ComfyUI :8188 |
| `grid_dg.mjs` | 던전 난이도 격자 — `tools/dungeon.mjs` 를 (early, wall) 여러 조합으로 돌린다 (§180) | node 만 |

공통 손잡이: `--only=id,id` · `--seed=` · `--reuse`(이미 뽑은 raw 재사용) · `--apply`(검수 뒤 게임에 넣기).
`--apply` 없이 먼저 돌려 `MERC_ART_DIR` 안의 결과를 눈으로 보고 넣는다.

## data/

| 파일 | 무엇 | 잃으면 |
|---|---|---|
| `t4.json` | 4차 클래스 56종의 기계 필드 (영웅의 뼈대) | `heroes.js` 재생성 불가 |
| `herotext.json` | **영웅 원고** — 이름·칭호·사연·스킬 이름/설명 | 사람이 쓴 글이 사라진다 |
| `classes.json` · `enemies.json` | 그림 프롬프트용 클래스/적 목록 | 그림 재생성 불가 |
| `fixes.json` · `fixes_enemy.json` | 검수가 준 **손 보정** (태그·시드·부정어) | 실패했던 그림이 다시 실패한다 |
| `class_skeletons.json` | 클래스 전용 OpenPose 골격 (§170) | 공격 자세가 대기와 닮아 실패한다 |

## ComfyUI 를 먼저 띄운다

    node "C:/pinokio/bin/npm/node_modules/pterm/index.js" run C:/pinokio/api/inteliweb-comfyui --default start.js

모델은 Animagine XL 4.0(대기·적) + Qwen-Image-Edit(공격 자세). 자세한 파이프라인은 `docs/HANDOFF.md` §165~§171·§176.
