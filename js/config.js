// 게임 설정과 튜닝값. 확률·시간·구속 등 수치는 모두 이 파일에만 둔다.
(function (global) {
  'use strict';

  const CONFIG = {
    // 게임 진행
    AT_BATS_PER_GAME: 9,
    MAX_STRIKES: 3,
    MAX_PITCHES_PER_AT_BAT: 12, // 이 투구수 이상에서 파울이면 범타 처리
    // 다음 레벨 해제 기준 타율. [i] = Lv.(i+1)에서 이 타율 이상이면 Lv.(i+2) 해제
    // 모두 .400 (9타석 4안타). 플레이 피드백·시뮬레이션으로 .300에서 상향
    UNLOCK_AVG: [0.4, 0.4],

    // 시간(초)
    AT_BAT_INTRO_SEC: 0.8,
    WINDUP_SEC: 1.0,
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
        pitchMix: { '직구': 55, '투심': 25, '체인지업': 20 },
        ai: 'random',
        adjacent: { FOUL: 40, OUT_BIP: 45, SWING_MISS: 15 },
      },
      {
        id: 2, name: 'Lv.2', title: '정통파', baseSpeed: 152, revealSec: 0.38, // M3 시뮬레이션 튜닝: 0.42 → 0.38 (Lv.1 ≥ Lv.2 유지)
        pitchMix: { '직구': 45, '투심': 15, '슬라이더': 25, '체인지업': 15 },
        ai: 'weak',
        adjacent: { FOUL: 30, OUT_BIP: 40, SWING_MISS: 30 },
      },
      {
        id: 3, name: 'Lv.3', title: '파이어볼러', baseSpeed: 160, revealSec: 0.36, // 플레이 피드백: 0.32 → 0.36 (너무 어려움)
        pitchMix: { '직구': 40, '투심': 10, '슬라이더': 25, '커브': 15, '체인지업': 10 },
        ai: 'adaptive',
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

    CHALLENGE: { level: 2 }, // 오늘의 챌린지에 쓰는 레벨(1부터)

    // 화면 배치(논리 좌표)
    LAYOUT: {
      width: 1280,
      height: 720,
      zone: { cx: 640, cy: 440, w: 260, h: 270 },
      release: { x: 634, y: 258 }, // 투수 손(릴리스 자세)과 맞춘 값
      ballR0: 3,
      ballR1: 14,
      maxDpr: 2,
      // 구장 원근 투영: 홈플레이트 기준 (x 좌우, z 투수 방향) 피트 → 화면
      view: { horizonY: 215, camDist: 14.74, focal: 1300, camHeight: 5.5 },
      pitcher: { x: 640, y: 312, scale: 1 }, // 발 위치
      batter: { x: 925, y: 708 }, // 발 사이 중앙
    },

    // 효과음
    AUDIO: { volume: 0.6 },

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
