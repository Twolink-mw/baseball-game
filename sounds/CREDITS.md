# 관중 녹음 출처 (CC0만 사용)

이 폴더에 아래 이름으로 파일을 넣고 `node tools/embed-sounds.js`를 실행하면 `js/sounds-data.js`에 내장됩니다.
파일이 없는 슬롯은 코드로 합성한 소리를 그대로 씁니다.

| 슬롯 (파일 이름) | 쓰는 곳 |
|---|---|
| `homerun.mp3` | 홈런 함성 (길게 커지는 함성, 박수 포함 가능) |
| `cheer.mp3` | 안타·2루타 환호 |
| `applause.mp3` | 결과 화면 박수 (홈런 녹음이 없으면 홈런 때도 사용) |
| `ooh.mp3` | 파울 "오~" |
| `groan.mp3` | 범타·삼진 "아~" |
| `ambience.mp3` | 경기 중 관중 웅성거림 (반복 재생) |

규칙
- 라이선스가 **CC0(Creative Commons 0)** 인 녹음만 사용.
- 실존 구단·선수 이름 연호, 장내 아나운서 목소리, 음악(저작권)이 **들리는** 구간은 쓰지 않음.
- mp3(모노, 96~128kbps) 권장. 필요한 구간만 쓰려면 `js/config.js`의 `AUDIO.samples`에서 시작 위치·길이·음량을 조정.

## 사용한 파일

| 슬롯 | 제목 | 작성자 | 출처 URL | 라이선스 | 사용 구간 |
|---|---|---|---|---|---|
| (예) cheer | Crowd Cheer | FoolBoyMedia | https://freesound.org/people/FoolBoyMedia/sounds/397434/ | CC0 | 0~4초 |
