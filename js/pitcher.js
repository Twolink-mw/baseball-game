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
        return {
          cell: indexCell(idx),
          type,
          speed,
          flightSec: level.flightSec * (level.baseSpeed / speed),
          revealSec: level.revealSec,
        };
      },
      recordUserClick(cell) {
        clickHistory.push(cellIndex(cell));
        while (clickHistory.length > C.AI.historySize) clickHistory.shift();
      },
    };
  }

  const api = { createPitcher, cellWeights, cellIndex, indexCell };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
