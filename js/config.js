// 게임 설정과 튜닝값. 확률·시간·구속 등 수치는 모두 이 파일에만 둔다.
(function (global) {
  'use strict';

  const CONFIG = {
    // 게임 진행
    AT_BATS_PER_GAME: 9,
    MAX_STRIKES: 3,
    MAX_PITCHES_PER_AT_BAT: 12, // 이 투구수 이상에서 파울이면 범타 처리
    UNLOCK_AVG: 0.3,

    // 시간(초)
    AT_BAT_INTRO_SEC: 0.8,
    WINDUP_SEC: 1.0,
    GRACE_SEC: 0.15, // 공 도착 후 입력 유예
    RESULT_SEC: 1.0, // 타석이 계속될 때 결과 연출
    AT_BAT_END_SEC: 1.2, // 타석 종료 결과 연출
    MAX_DT: 0.05, // update(dt) 상한

    // 구속
    SPEED_JITTER: 3, // 표시 구속 랜덤 폭(±)

    // 구종: 구속 보정과 공개 구간 휨(논리 px, 렌더러용)
    PITCH_TYPES: {
      '직구': { speedDelta: 0, bend: { x: 0, y: 0 } },
      '투심': { speedDelta: -3, bend: { x: -16, y: 0 } },
      '슬라이더': { speedDelta: -10, bend: { x: 42, y: 6 } },
      '커브': { speedDelta: -20, bend: { x: 8, y: 56 } },
    },

    LEVELS: [
      {
        id: 1, name: 'Lv.1', baseSpeed: 140, flightSec: 1.2, revealSec: 0.6,
        pitchMix: { '직구': 70, '투심': 30 },
        ai: 'random',
        adjacent: { FOUL: 40, OUT_BIP: 45, SWING_MISS: 15 },
      },
      {
        id: 2, name: 'Lv.2', baseSpeed: 150, flightSec: 0.9, revealSec: 0.42,
        pitchMix: { '직구': 50, '투심': 20, '슬라이더': 30 },
        ai: 'weak',
        adjacent: { FOUL: 30, OUT_BIP: 40, SWING_MISS: 30 },
      },
      {
        id: 3, name: 'Lv.3', baseSpeed: 160, flightSec: 0.6, revealSec: 0.32,
        pitchMix: { '직구': 40, '투심': 15, '슬라이더': 25, '커브': 20 },
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
      release: { x: 640, y: 290 },
      ballR0: 3,
      ballR1: 14,
      maxDpr: 2,
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
