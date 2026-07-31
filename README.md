# 용병단 (Mercenary Company)

세계를 떠돌며 의뢰를 받아 용병단을 키우는 **브라우저 자동전투 판타지 RPG**.

- 용병단은 부대를 여러 개 운용하고, 부대마다 최대 7명
- 용병 등급 F~S — 도시 주점에서 **클래스를 고르면 등급은 운에 맡긴다**
- 전투는 자동. 아군 왼쪽 / 적군 오른쪽, 절차 생성 픽셀아트로 관전
- 1차 → 4차까지 **클래스 105종**, 상위 전직은 여러 후보 중 선택
- 장비 10슬롯, 진형 12종, 던전 4개와 신화 세트 아이템

## 실행

빌드 스텝이 없다. 정적 파일을 서빙하기만 하면 된다.

```bash
node tools/serve.mjs 5174
```

브라우저에서 `http://localhost:5174`.

> `python -m http.server` 는 쓰지 마라 — no-cache 헤더를 안 보내서 브라우저가 ES 모듈을
> 캐시한다. 소스를 고치고 새로고침해도 옛 코드가 돈다. `tools/serve.mjs` 는 항상
> `no-store` 로 응답한다.

## 기술 구성

| 항목 | 내용 |
|---|---|
| 스택 | 순수 ES 모듈 + Canvas 2D. **빌드 스텝 없음, 외부 의존성 0** |
| 아트 | 절차 생성 픽셀아트 (32×40 논리 픽셀, 파츠 조합 + 팔레트 스왑) |
| 세이브 | localStorage. 파일로 내보내기/불러오기 지원 |

`docs/SPEC.md` 가 모듈 간 계약이고, `docs/HANDOFF.md` 가 현재 상태와 그동안의 밸런스 근거다.

## 검증 도구

전부 node 로 바로 돌아간다 (실패 시 exit 1).

```bash
node tools/smoke.mjs        # 정합성·크래시
node tools/earlygame.mjs 24 # 초반 진행·파견 루프·경제
node tools/balance.mjs      # 랭크/클래스/진형 승률
node tools/reputation.mjs   # 평판·특화 도시 등급 확률
node tools/dungeon.mjs      # 던전 난이도 곡선
node tools/setspecial.mjs   # 세트 고유 효과가 실제로 적용되는지
```
