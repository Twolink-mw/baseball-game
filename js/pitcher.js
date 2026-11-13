// 투구 생성과 투수 AI (순수 로직)
(function (global) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const { CONFIG } = isNode ? require('./config.js') : global.BB;

  const CORNERS = [0, 2, 6, 8];
  const cellIndex = (cell) => cell.row * 3 + cell.col;
  const indexCell = (i) => ({ row: Math.floor(i / 3), col: i % 3 });
  // 볼: 존 바로 바깥 12칸(위·아래·왼쪽·오른쪽 한 줄, 모서리 대각선 제외). row/col이 -1 또는 3
  const BALL_CELLS = [];
  for (let i = 0; i < 3; i++) {
    BALL_CELLS.push({ row: -1, col: i }, { row: 3, col: i }, { row: i, col: -1 }, { row: i, col: 3 });
  }
  const isBallCell = (cell) => cell.row < 0 || cell.row > 2 || cell.col < 0 || cell.col > 2;

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

  const FASTBALLS = { '직구': 1, '투심': 1 };

  // 수싸움(level.sequencing): 카운트에 따른 볼 비율, 직전 구종에 따른 구종 가중치. 없으면 그대로
  function seqBallRate(level, count) {
    const s = level.sequencing;
    let rate = level.ballRate || 0;
    if (!s || !count) return rate;
    if (count.strikes >= 2) rate *= s.twoStrikeBallMult;
    else if (count.strikes === 0 && count.balls === 0) rate *= s.firstPitchBallMult;
    return Math.min(rate, 1);
  }

  function seqPitchMix(level, lastType) {
    const s = level.sequencing;
    if (!s || !lastType || !FASTBALLS[lastType]) return level.pitchMix;
    const mix = {};
    for (const [k, w] of Object.entries(level.pitchMix)) mix[k] = FASTBALLS[k] ? w : w * s.afterFastballOffspeed;
    return mix;
  }

  // 투구 시작 시점에 코스를 확정한다. 사용자의 현재 클릭은 보지 않는다.
  function createPitcher(level, rng, config) {
    const C = config || CONFIG;
    let lastIdx = null;
    let lastType = null;
    const clickHistory = []; // 칸 인덱스, 최근 historySize개

    return {
      // opts.allowBall: false면 반드시 스트라이크 (볼 3개 이후, 볼넷 없음)
      // opts.speedBonus: 구속 가산(km/h, 서바이벌). 난수 순서에는 영향 없음
      // opts.count: { balls, strikes } 수싸움용. 비교 기준·가중치만 바뀌고 뽑는 난수 개수·순서는 같음
      // 난수는 볼 허용 여부와 관계없이 항상 같은 순서로 뽑는다 → 챌린지 투구 순서가 판정 결과에 흔들리지 않음
      nextPitch(opts) {
        const allowBall = !opts || opts.allowBall !== false;
        const speedBonus = (opts && opts.speedBonus) || 0;
        const w = cellWeights(level.ai, lastIdx, clickHistory, C);
        const idx = rng.pickWeighted(w.map((x, i) => [i, x]));
        lastIdx = idx;
        const ballRoll = rng.next();
        const ballCell = BALL_CELLS[rng.int(BALL_CELLS.length)];
        const ball = allowBall && ballRoll < seqBallRate(level, opts && opts.count);
        const type = rng.pickWeighted(seqPitchMix(level, lastType));
        lastType = type;
        const delta = C.PITCH_TYPES[type].speedDelta;
        const speed = Math.round(level.baseSpeed + speedBonus + delta + rng.range(-C.SPEED_JITTER, C.SPEED_JITTER));
        // 투구 템포: 세트 자세에서 멈추는 시간 + 투구 동작 시간 (투구용 RNG라 챌린지에서도 기기마다 같음)
        const holdSec = rng.range(level.tempo.hold[0], level.tempo.hold[1]);
        const motionSec = rng.range(level.tempo.motion[0], level.tempo.motion[1]);
        return {
          cell: ball ? { row: ballCell.row, col: ballCell.col } : indexCell(idx),
          ball,
          type,
          speed,
          flightSec: flightForSpeed(speed, C),
          revealSec: ball ? Math.min(level.revealSec * C.BALL.revealMult, 1) : level.revealSec, // 볼은 일찍 바깥으로 휨
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

  const api = { createPitcher, flightForSpeed, cellWeights, cellIndex, indexCell, isBallCell, BALL_CELLS, seqBallRate, seqPitchMix };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
