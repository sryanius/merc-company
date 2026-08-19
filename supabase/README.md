# Edge Function 배포

랭킹 제출을 검증하는 `submit-score` 함수를 올린다.

## 왜 서버에서 검증하나

`scores` 테이블에는 **INSERT/UPDATE 정책이 아예 없다.** 클라이언트는 못 쓴다.
오직 이 함수가 service_role 로 쓴다 — 그게 랭킹 신뢰의 전부다.

검증 규칙은 `src/game/rules.js` **한 벌**이고, `tools/syncshared.mjs` 가
`_shared/` 로 복사한다. SQL 로 옮겨 적으면 손으로 베낀 두 번째 사본이 생기고
밸런스를 고치는 날 정상 플레이어가 전원 거절당한다.

> 정직하게: 이건 "조작 방지"가 아니라 **개연성 검사**다.
> 전투 승패나 아이템 스탯 위조는 못 잡는다. 그렇게 광고하면 안 된다.

## 배포 (직접 하셔야 하는 부분)

CLI 는 `npx supabase` 로 쓴다 (PATH 에 없다).

```
npx supabase login
npx supabase link --project-ref peilvwrqgauwlaqojttq
npx supabase functions deploy submit-score
```

- `login` 은 브라우저가 열리고 계정 인증을 한다. **이 단계는 사람이 해야 한다.**
- `link` 는 데이터베이스 비밀번호를 물을 수 있다 — 프로젝트 만들 때 정한 그 값이다.
- 환경변수(`SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`)는
  **따로 설정할 필요가 없다.** 런타임이 자동으로 넣어 준다.

## 규칙을 고쳤을 때

게임 밸런스나 `src/game/rules.js` 를 고쳤으면 **반드시** 다시 복사하고 재배포한다:

```
node tools/syncshared.mjs
npx supabase functions deploy submit-score
```

빼먹으면 서버가 옛 규칙으로 판정해서 정상 플레이어를 거절하기 시작한다.
`node tools/smoke.mjs` 가 복사본 해시를 검사하므로 **테스트가 먼저 터진다** —
조용히 어긋나지는 않는다.

## 배포 후 확인

```
node tools/supacheck.mjs
```
