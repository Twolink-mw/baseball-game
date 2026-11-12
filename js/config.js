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
    },
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
        id: 2, name: 'Lv.2', title: '정통파', baseSpeed: 152, revealSec: 0.38, // M3 시뮬레이션 튜닝: 0.42 → 0.38 (Lv.1 ≥ Lv.2 유지)
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
      // 오늘의 투수: 바탕 레벨 값을 덮어쓴다. ai는 random/weak만 (사용자 클릭에 반응하면 기기마다 투구 순서가 달라짐)
      pitchers: [
        { name: '정통파', desc: '오늘은 평범한 정통파' },
        { name: '강속구', desc: '직구 위주의 빠른 공', baseSpeed: 158, ballRate: 0.25, pitchMix: { '직구': 60, '투심': 20, '슬라이더': 20 } },
        { name: '커브볼러', desc: '느린 커브로 타이밍을 뺏음', baseSpeed: 148, pitchMix: { '직구': 35, '커브': 40, '체인지업': 25 } },
        { name: '제구 난조', desc: '볼이 많은 투수, 골라내야 산다', ballRate: 0.45 },
        { name: '퀵모션', desc: '멈췄다 던졌다, 리듬이 들쭉날쭉', tempo: { hold: [0, 1.4], motion: [0.5, 0.9] } },
        { name: '변화구 장인', desc: '직구보다 변화구가 많음', baseSpeed: 150, pitchMix: { '직구': 25, '슬라이더': 30, '커브': 20, '체인지업': 25 } },
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
