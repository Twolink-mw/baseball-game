# 관중 녹음 출처

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
- 라이선스: **CC0** 또는 **Pixabay Content License**(게임 안에 포함해 사용 가능, 원본만 따로 재배포 금지)처럼 출처 표기 없이 게임에 쓸 수 있는 것만.
- 실존 구단·선수 이름 연호, 장내 아나운서 목소리, 음악(저작권)이 **들리는** 구간은 쓰지 않음.
- mp3 권장. `js/config.js`의 `AUDIO.samples`에 정한 구간(시작 위치·길이)만 잘라 넣으므로 원본이 길어도 됨(재인코딩 없음). 구간을 바꾸면 도구를 다시 실행.

## 사용한 파일

| 슬롯 | 제목 | 작성자 | 출처 URL | 라이선스 | 사용 구간 |
|---|---|---|---|---|---|
| homerun | baseball home run | ballparkfanatic444 | https://pixabay.com/ko/sound-effects/%EC%98%81%ED%99%94-%EB%B0%8F-%ED%8A%B9%EC%88%98-%ED%9A%A8%EA%B3%BC-baseball-home-run-419442/ | Pixabay Content License | 0.9~6.4초 (전체 33초) |
| ambience | baseball sounds | bowlingballout (Freesound), Pixabay 계정 freesound_community | https://pixabay.com/ko/sound-effects/%EB%8F%84%EC%8B%9C-baseball-sounds-52818/ | Pixabay Content License | 50초~1분18초 반복 (전체 7분 10초) |

원본 mp3는 `.gitignore`로 저장소에서 제외한다(원본 단독 재배포 금지). 다른 PC에서 다시 내장하려면 원본을 이 폴더에 다시 넣고 도구를 실행.

확인일: 2026-11-11 (두 페이지 모두 "Pixabay 콘텐츠 라이선스에 따른 무료 사용" 표시)
