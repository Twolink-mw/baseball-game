// 게임 설정과 튜닝값. 확률·시간·구속 등 수치는 모두 이 파일에만 둔다.
(function (global) {
  'use strict';

  const CONFIG = {
    // 게임 진행
    AT_BATS_PER_GAME: 10, // 타율이 깔끔하게 나오도록 9 → 10
    MAX_STRIKES: 3,
    MAX_BALLS: 3, // 한 타석 볼은 최대 3개 (4번째 볼은 던지지 않음, 볼넷 없음)
    // 볼 구별 돕기 (플레이 피드백: 볼인지 구별이 어려움)
    BALL: {
      outCells: 0.8, // 볼이 존 가장자리에서 몇 칸 바깥에 꽂히는지(공 중심). 0.5면 바로 옆 칸 가운데. 휴대폰 확대 존에서 아래 볼이 화면 안에 들도록 0.8
      revealMult: 1.3, // 볼은 스트라이크보다 이 배수만큼 일찍 실제 코스로 휘기 시작 (판정에는 영향 없음)
      // 볼을 골라낸 보상: 볼이 MAX_BALLS개면(이후 스트라이크만 옴) '좋음' 타이밍 구간을 넓힘. 확률표는 그대로
      advantageGood: 0.14, // JUDGE.timing.good(0.12) 대신
    },

    // 승부처: 남은 타석이 maxRemaining 이하이고 안타 몇 개면 레벨 해제/최고 타율 갱신일 때 알림 + 관중 소리 키움
    CLUTCH: { maxRemaining: 2 },

    // 칭호: 일반 게임 한 판의 기록으로 획득(타자별 영구). 앞에 있을수록 귀함 → 대표 칭호
    // conds: 모두 만족해야 함. stat은 미션과 같음(+ chases: 볼에 스윙한 횟수). level: 해당 레벨(1부터)에서만
    TITLES: [
      { id: 'perfect', name: '10할 타자', desc: '한 경기 10안타', conds: [{ stat: 'hits', min: 10 }] },
      { id: 'slugger', name: '거포', desc: '한 경기 홈런 3개', conds: [{ stat: 'homers', min: 3 }] },
      { id: 'lv3', name: '파이어볼러 킬러', desc: 'Lv.3에서 타율 .500 이상', level: 3, conds: [{ stat: 'hits', min: 5 }] },
      { id: 'streak', name: '안타 제조기', desc: '5타석 연속 안타', conds: [{ stat: 'hitStreak', min: 5 }] },
      { id: 'sharp', name: '정밀 타격', desc: '한 경기 정확 타이밍 6번', conds: [{ stat: 'perfects', min: 6 }] },
      { id: 'eye', name: '선구안', desc: '볼에 한 번도 스윙하지 않고 4안타 이상', conds: [{ stat: 'chases', max: 0 }, { stat: 'hits', min: 4 }] },
      { id: 'contact', name: '컨택 장인', desc: '삼진 없이 3안타 이상', conds: [{ stat: 'strikeouts', max: 0 }, { stat: 'hits', min: 3 }] },
    ],
    MAX_PITCHES_PER_AT_BAT: 12, // 이 투구수 이상에서 파울이면 범타 처리
    // 다음 레벨 해제 기준 타율. [i] = Lv.(i+1)에서 이 타율 이상이면 Lv.(i+2) 해제
    // 모두 .400 (10타석 4안타). 플레이 피드백·시뮬레이션으로 .300에서 상향
    UNLOCK_AVG: [0.4, 0.4],

    // 시간(초)
    AT_BAT_INTRO_SEC: 0.8,
    GRACE_SEC: 0.15, // 공 도착 후 입력 유예
    RESULT_SEC: 1.0, // 타석이 계속될 때 결과 연출
    AT_BAT_END_SEC: 2.2, // 타석 종료 결과 연출 (피드백: 타자 교체가 빨라 1.2 → 2.2)
    MAX_DT: 0.05, // update(dt) 상한

    // 구속
    SPEED_JITTER: 3, // 표시 구속 랜덤 폭(±)
    // 구속(km/h) → 공 비행 시간(초). 모든 레벨 공통이라 같은 구속이면 같은 속도로 날아온다.
    // 사이 값은 직선 보간, 표 밖은 양 끝 값. (직구 기준: Lv.1 145km=1.05초, Lv.2 152km=0.84초, Lv.3 160km=0.6초)
    SPEED_TO_FLIGHT: [[130, 1.5], [140, 1.2], [150, 0.9], [160, 0.6], [170, 0.3]],

    // 구종: 구속 보정(km/h, 직구 대비)과 공개 구간 휨(논리 px, 렌더러용)
    // 구속 차이는 메이저리그 평균(슬라이더 -14, 커브 -24)과 비교 플레이 후 이 값으로 확정(더 어려움)
    PITCH_TYPES: {
      '직구': { speedDelta: 0, bend: { x: 0, y: 0 } },
      '투심': { speedDelta: -3, bend: { x: -16, y: 0 } },
      '슬라이더': { speedDelta: -10, bend: { x: 42, y: 6 } },
      '커브': { speedDelta: -20, bend: { x: 8, y: 56 } },
      '체인지업': { speedDelta: -14, bend: { x: -10, y: 16 } }, // 직구처럼 오다가 살짝 가라앉으며 바깥으로
    },

    // 직구 기준 구속은 메이저리그 기준: 기교파 선발(90mph) / 리그 평균(94.5mph) / 정상급 마무리(99.5mph)
    LEVELS: [
      {
        id: 1, name: 'Lv.1', title: '기교파', baseSpeed: 145, revealSec: 0.6,
        // 투구 템포(초): 세트 자세 멈춤 + 투구 동작. 둘 다 범위 안에서 투구마다 랜덤
        tempo: { hold: [0.1, 0.4], motion: [0.9, 0.9] }, // 거의 일정한 리듬
        pitchMix: { '직구': 55, '투심': 25, '체인지업': 20 },
        ai: 'random',
        ballRate: 0.25, // 볼(존 바깥) 비율. 볼 3개 이후는 스트라이크만
        adjacent: { FOUL: 40, OUT_BIP: 45, SWING_MISS: 15 },
      },
      {
        id: 2, name: 'Lv.2', title: '정통파', baseSpeed: 152, revealSec: 0.40, // M3 튜닝 0.42 → 0.38, 플레이 피드백(Lv.3보다 어렵게 느껴짐) 0.38 → 0.40
        tempo: { hold: [0, 0.8], motion: [0.7, 0.9] }, // 가끔 길게 멈춤
        pitchMix: { '직구': 45, '투심': 15, '슬라이더': 25, '체인지업': 15 },
        ai: 'weak',
        ballRate: 0.3,
        adjacent: { FOUL: 30, OUT_BIP: 40, SWING_MISS: 30 },
      },
      {
        id: 3, name: 'Lv.3', title: '파이어볼러', baseSpeed: 160, revealSec: 0.36, // 플레이 피드백: 0.32 → 0.36 (너무 어려움)
        tempo: { hold: [0, 1.2], motion: [0.55, 0.9] }, // 퀵 모션과 긴 멈춤이 섞임
        pitchMix: { '직구': 40, '투심': 10, '슬라이더': 25, '커브': 15, '체인지업': 10 },
        ai: 'adaptive',
        ballRate: 0.3,
        adjacent: { FOUL: 20, OUT_BIP: 30, SWING_MISS: 50 },
      },
    ],

    // 판정
    JUDGE: {
      timing: { perfect: 0.05, good: 0.12 },
      // D=0(코스 일치) 타이밍 등급별 결과 비중. 레벨에 exact를 두면 그 값이 우선한다.
      exact: {
        PERFECT: { HOMERUN: 25, DOUBLE: 25, SINGLE: 30, OUT_BIP: 20, FOUL: 0 },
        GOOD: { HOMERUN: 5, DOUBLE: 15, SINGLE: 35, OUT_BIP: 35, FOUL: 10 },
        BAD: { HOMERUN: 0, DOUBLE: 0, SINGLE: 10, OUT_BIP: 40, FOUL: 50 },
      },
    },

    // 투수 AI
    AI: {
      repeatFactor: 0.5, // 직전 투구와 같은 칸
      cornerFactor: 1.3, // weak: 모서리 칸
      historySize: 20, // adaptive: 기억하는 클릭 수
      minHistory: 5, // adaptive: 이보다 적으면 weak처럼 동작
    },

    // 오늘의 챌린지: Lv.2(level)를 바탕으로 날짜마다 '오늘의 투수'와 '오늘의 미션'을 하나씩 고른다
    CHALLENGE: {
      level: 2, // 바탕 레벨(1부터). 결과는 이 레벨 번호로 저장되지만 최고 타율·해제에는 반영 안 됨
      logDays: 7, // 타이틀 챌린지 카드에 보여 주는 최근 날짜 수 (타자별 dailyLog 보관 개수)
      // 오늘의 투수: 바탕 레벨 값을 덮어쓴다. ai는 random/weak만 (사용자 클릭에 반응하면 기기마다 투구 순서가 달라짐)
      // id: 도전 모드 '보스 투수' 기록 키
      pitchers: [
        { id: 'classic', name: '정통파', desc: '오늘은 평범한 정통파' },
        { id: 'power', name: '강속구', desc: '직구 위주의 빠른 공', baseSpeed: 158, ballRate: 0.25, pitchMix: { '직구': 60, '투심': 20, '슬라이더': 20 } },
        { id: 'curve', name: '커브볼러', desc: '느린 커브로 타이밍을 뺏음', baseSpeed: 148, pitchMix: { '직구': 35, '커브': 40, '체인지업': 25 } },
        { id: 'wild', name: '제구 난조', desc: '볼이 많은 투수, 골라내야 산다', ballRate: 0.45 },
        { id: 'quick', name: '퀵모션', desc: '멈췄다 던졌다, 리듬이 들쭉날쭉', tempo: { hold: [0, 1.4], motion: [0.5, 0.9] } },
        { id: 'breaking', name: '변화구 장인', desc: '직구보다 변화구가 많음', baseSpeed: 150, pitchMix: { '직구': 25, '슬라이더': 30, '커브': 20, '체인지업': 25 } },
      ],
      // 오늘의 미션. stat: homers, hits, strikeouts, extraBases(2루타+홈런), perfects, hitStreak(연속 타석 안타), firstHit(첫 타석 안타 1/0)
      // min: 이 값 이상이면 달성, max: 게임이 끝났을 때 이 값 이하이면 달성
      missions: [
        { text: '홈런 1개', stat: 'homers', min: 1 },
        { text: '안타 5개 이상', stat: 'hits', min: 5 },
        { text: '삼진 2개 이하', stat: 'strikeouts', max: 2 },
        { text: '장타(2루타·홈런) 2개', stat: 'extraBases', min: 2 },
        { text: '정확 타이밍 4번', stat: 'perfects', min: 4 },
        { text: '3타석 연속 안타', stat: 'hitStreak', min: 3 },
        { text: '첫 타석 안타', stat: 'firstHit', min: 1 },
      ],
    },

    // 도전 모드 (타이틀 '도전 모드'). 통산 타율·레벨 해제·칭호에는 반영하지 않고 모드별 최고 기록만 저장
    MODES: {
      // 아웃(범타·삼진) maxOuts개까지 안타 수. 타석마다 구속 +speedStep(최대 +speedMax)
      survival: { name: '서바이벌', desc: '아웃 3개까지 안타를 몇 개?', level: 2, maxOuts: 3, speedStep: 1, speedMax: 12 },
      // 홈런이 아닌 타석 종료(단타·2루타 포함)는 모두 아웃. 아웃 maxOuts개 안에 홈런 수. 볼 없음, 빠른 공만
      derby: { name: '홈런 더비', desc: '아웃 10개 안에 홈런을 몇 개?', level: 1, maxOuts: 10, homerOnly: true, override: { ballRate: 0, pitchMix: { '직구': 70, '투심': 30 } } },
      // 챌린지 투수를 바탕 레벨(level)에 덮어써 10타석. 바탕 레벨이 해제된 타자만
      boss: { name: '보스 투수', desc: '개성 강한 투수 5명, 투수별 최고 타율', level: 3, pitchers: ['power', 'curve', 'wild', 'quick', 'breaking'] },
      // 연습: 끝없이 투구, 기록 없음. 레벨·구종·볼 여부를 고름
      practice: { name: '연습', desc: '골라서 반복 연습 · 기록 없음', logRows: 6, stripCount: 10 },
    },

    // 경기 후 분석(결과 화면의 '분석 보기')의 한 줄 평 기준
    ANALYSIS: {
      minSamples: 3, // 이보다 적은 표본으로는 평을 하지 않음
      chaseRate: 0.5, // 볼에 스윙한 비율이 이 이상이면 선구안 지적
      timingRate: 0.6, // 스윙 중 빠름(또는 늦음) 비율이 이 이상이면 타이밍 지적
      weakRate: 0.34, // 줄(높이·좌우)별로 코스를 맞힌 비율이 이 이하이면 약점
      lookingMin: 3, // 루킹 스트라이크가 이 이상이면 지적
      praisePerfects: 3, // 지적할 것이 없고 정확 타이밍이 이 이상이면 칭찬
      maxTips: 2, // 한 줄 평 최대 개수
      stripRange: 0.2, // 타이밍 띠의 좌우 범위(초)
    },

    // 화면 배치(논리 좌표)
    LAYOUT: {
      width: 1280,
      height: 720,
      zone: { cx: 640, cy: 440, w: 260, h: 270 },
      release: { x: 634, y: 258 }, // 투수 손(릴리스 자세)과 맞춘 값
      ballR0: 3,
      ballR1: 14,
      maxDpr: 2,
      maxWide: 1.45, // 화면이 넓으면 배경을 1280의 이 배수까지 넓힘 (20:9 휴대폰 ≈ 1.25)
      // 구장 원근 투영: 홈플레이트 기준 (x 좌우, z 투수 방향) 피트 → 화면
      view: { horizonY: 215, camDist: 14.74, focal: 1300, camHeight: 5.5 },
      pitcher: { x: 640, y: 312, scale: 1 }, // 발 위치
      batter: { x: 925, y: 708 }, // 발 사이 중앙
    },

    // 타이틀 '기록 백업' 버튼 표시 (기기 간 복사·붙여넣기가 불편해 숨김. 기능 코드는 유지)
    SHOW_BACKUP: false,

    // 모바일(터치 기기). 크기는 CSS px 기준
    TOUCH: {
      padCellPx: 60, // 터치 패드 한 칸 (명세 최소 56)
      padGapPx: 6, // 칸 사이 간격
      padMarginPx: 12, // 화면(안전 영역) 가장자리와의 간격
      minTapPx: 44, // 캔버스 버튼의 화면상 최소 높이
      zoneCellMinPx: 44, // 존 한 칸이 이보다 작게 보이면 존을 키움
    },
    MOBILE_ZONE_SCALE: 1.3,

    // 효과음
    AUDIO: {
      volume: 0.8, // 전체 음량
      reverb: { seconds: 1.6, decay: 3, wet: 0.35 }, // 구장 잔향: 길이, 감쇠 곡선, 섞는 비율
      ambience: 0.09, // 경기 중 관중 웅성거림 배경음
      clutchAmbience: 2.2, // 승부처 타석에서 웅성거림 배수
      crowd: 0.25, // 관중 함성·박수 기준 음량
      // 나무 배트 공명 모드 [주파수 Hz, 울림 시간 초, 상대 크기]. 높은 모드는 정타일 때만 강하게 울림
      batModes: [[540, 0.09, 1], [1220, 0.07, 0.7], [1980, 0.05, 0.55], [2760, 0.04, 0.4], [3650, 0.03, 0.3]],
      batModeGain: 0.75, // 공명 모드 음량
      // 관중 녹음(sounds/ → node tools/embed-sounds.js → js/sounds-data.js) 재생 설정. 녹음이 없으면 합성음 사용
      // offset: 시작 위치(초), dur: 길이(초, null이면 끝까지), gain: 음량, fadeIn/fadeOut(초), wet: 잔향 비율
      // mp3/wav는 내장할 때 이 구간만 잘라 넣으므로, 구간을 바꾸면 embed-sounds를 다시 실행
      samples: {
        // 녹음 0.21초쯤 자체 타격음이 있어 함성이 커지기 직전(0.9초)부터 사용 → 게임 타격음과 겹치지 않음
        homerun: { offset: 0.9, dur: 5.5, gain: 0.3, fadeIn: 0.05, fadeOut: 1.5, wet: 0.2 },
        cheer: { offset: 0, dur: 2.5, gain: 0.7, fadeIn: 0.05, fadeOut: 0.6, wet: 0.2 },
        applause: { offset: 0, dur: 3, gain: 0.6, fadeIn: 0.1, fadeOut: 0.8, wet: 0.2 },
        ooh: { offset: 0, dur: 1.2, gain: 0.6, fadeIn: 0.05, fadeOut: 0.4, wet: 0.2 },
        groan: { offset: 0, dur: 1.4, gain: 0.6, fadeIn: 0.05, fadeOut: 0.4, wet: 0.2 },
        ambience: { offset: 50, dur: 28, gain: 0.08, wet: 0.1 }, // 반복 재생: 녹음의 50초~1분18초
      },
    },

    // 연출(초)
    FX: {
      swingSec: 0.18, // 클릭 후 배트가 다 돌아가는 시간
      trailSec: 0.035, // 공 잔상 간격
      flashSec: 0.15, // 타구 순간 섬광
      // 공이 존을 지난 뒤(포수 미트로 들어가는 구간) 연출. 실제 공은 홈플레이트 약 1m 뒤에서 잡혀 10~15cm(반 칸 남짓)만 더 떨어짐
      passSec: 0.07, // 도착 후 공이 보이는 시간(점점 투명). 길면 공이 아래 칸에 꽂힌 것처럼 보임 (예전 비행 시간의 0.2배 ≈ 0.12~0.29초)
      passDropCells: 0.5, // 그동안 아래로 떨어지는 거리(존 한 칸 높이 기준)
      passGrow: 1.25, // 그동안 커지는 배수 (예전엔 3~4배)
      cloudSpeed: 6, // 구름 이동 (논리 px/초)
    },

    STORAGE_KEY: 'bbgame.v1',
    NAME_MAX: 8,
    MAX_PLAYERS: 30, // 한 기기에 저장하는 타자 수 상한
    LEADERBOARD_PAGE: 8, // 타자 기록 화면 한 페이지 인원
  };

  const api = { CONFIG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
