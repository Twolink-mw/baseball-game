# 프로젝트: 타자 시점 야구 게임
- 명세는 SPEC.md를 따른다. 마일스톤(M1→M2→M3→M5, M4는 선택) 순서대로 진행하고 각 마일스톤마다 실행 확인 후 커밋한다.
- 서버/외부 리소스 금지. 브라우저 코드는 일반 <script> 사용 (ES module 금지), file://로 열려야 한다.
- 모든 튜닝 수치는 js/config.js에만 둔다. 난수는 js/rng.js의 시드 RNG만 사용하고, 투구용(pitchRng)과 판정용(judgeRng)을 분리한다.
- 순수 로직(rng/pitcher/judge/game/config, storage의 검증/병합)은 DOM에 의존하지 않고 node tests/run.js로 테스트 가능해야 한다.
- game.update(dt)는 dt를 config.MAX_DT로 자른다. 입력 시각은 event.timeStamp 기준으로 게임 시각에 맞춰 전달한다.
- 입력은 Pointer Events, 모든 경로는 상대경로, 서비스 워커는 http/https에서만 등록한다 (PC/갤럭시/아이폰 지원).
- 실존 구단/선수/중계 화면 에셋 사용 금지. 그래픽은 코드로 직접 그린다.
- 응답과 주석은 한국어로 작성한다.
