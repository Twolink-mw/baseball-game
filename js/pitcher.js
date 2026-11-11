// 투구 생성과 투수 AI (순수 로직)
(function (global) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const { CONFIG } = isNode ? require('./config.js') : global.BB;

  const CORNERS = [0, 2, 6, 8];
  const cellIndex = (cell) => cell.row * 3 + cell.col;
  const indexCell = (i) => ({ row: Math.floor(i / 3), col: i % 3 });

  // 9칸 가중치 계산
  function cellWeights(ai, lastIdx, clickHistory, C) {
    const A = C.AI;
    const w = new Array(9).fill(1);
    if (ai === 'random') return w;
    if (ai === 'adaptive' && clickHistory.length >= A.minHistory) {
      const counts = new Array(9).fill(0);
      for (const i of clickHistory) counts[i]++;
      for (let i = 0; i < 9; i++) w[i] = 1 / (1 + counts[i]);
    } else {
      for (const i of CORNERS) w[i] *= A.cornerFactor;
    }
    if (lastIdx != null) w[lastIdx] *= A.repeatFactor;
    return w;
  }

  // 구속 → 비행 시간 (SPEED_TO_FLIGHT 표를 직선 보간, 표 밖은 양 끝 값)
  function flightForSpeed(speed, config) {
    const T = (config || CONFIG).SPEED_TO_FLIGHT;
    if (speed <= T[0][0]) return T[0][1];
    for (let i = 1; i < T.length; i++) {
      if (speed <= T[i][0]) {
        const [s0, f0] = T[i - 1];
        const [s1, f1] = T[i];
        return f0 + ((f1 - f0) * (speed - s0)) / (s1 - s0);
      }
    }
    return T[T.length - 1][1];
  }

  // 투구 시작 시점에 코스를 확정한다. 사용자의 현재 클릭은 보지 않는다.
  function createPitcher(level, rng, config) {
    const C = config || CONFIG;
    let lastIdx = null;
    const clickHistory = []; // 칸 인덱스, 최근 historySize개

    return {
      nextPitch() {
        const w = cellWeights(level.ai, lastIdx, clickHistory, C);
        const idx = rng.pickWeighted(w.map((x, i) => [i, x]));
        lastIdx = idx;
        const type = rng.pickWeighted(level.pitchMix);
        const delta = C.PITCH_TYPES[type].speedDelta;
        const speed = Math.round(level.baseSpeed + delta + rng.range(-C.SPEED_JITTER, C.SPEED_JITTER));
        // 투구 템포: 세트 자세에서 멈추는 시간 + 투구 동작 시간 (투구용 RNG라 챌린지에서도 기기마다 같음)
        const holdSec = rng.range(level.tempo.hold[0], level.tempo.hold[1]);
        const motionSec = rng.range(level.tempo.motion[0], level.tempo.motion[1]);
        return {
          cell: indexCell(idx),
          type,
          speed,
          flightSec: flightForSpeed(speed, C),
          revealSec: level.revealSec,
          holdSec,
          motionSec,
          windupSec: holdSec + motionSec, // 와인드업 시작 → 릴리스
        };
      },
      recordUserClick(cell) {
        clickHistory.push(cellIndex(cell));
        while (clickHistory.length > C.AI.historySize) clickHistory.shift();
      },
    };
  }

  const api = { createPitcher, flightForSpeed, cellWeights, cellIndex, indexCell };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
