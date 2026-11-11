// 판정 (순수 로직)
(function (global) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const { CONFIG } = isNode ? require('./config.js') : global.BB;

  // 맨해튼 거리 (대각선 = 2)
  function cellDistance(a, b) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  }

  // deltaSec = 클릭 시각 - 공 도착 시각
  function timingGrade(deltaSec, config) {
    const C = config || CONFIG;
    if (deltaSec == null || deltaSec > C.GRACE_SEC) return 'NONE';
    const a = Math.abs(deltaSec);
    if (a <= C.JUDGE.timing.perfect) return 'PERFECT';
    if (a <= C.JUDGE.timing.good) return 'GOOD';
    return 'BAD';
  }

  // 존(3×3) 바깥 칸이면 볼
  function isBall(cell) {
    return cell.row < 0 || cell.row > 2 || cell.col < 0 || cell.col > 2;
  }

  // click: { cell, deltaSec } | null
  // 볼을 그냥 보내면 BALL. 볼에 휘두르면 볼 위치와 가까운 칸(D=1)만 맞힐 수 있다 (파울·범타·헛스윙)
  function judge(click, pitchCell, level, rng, config) {
    const C = config || CONFIG;
    const timing = click ? timingGrade(click.deltaSec, C) : 'NONE';
    if (timing === 'NONE') return { result: isBall(pitchCell) ? 'BALL' : 'LOOKING', timing };
    const D = cellDistance(click.cell, pitchCell);
    if (D === 0) {
      const table = (level.exact && level.exact[timing]) || C.JUDGE.exact[timing];
      return { result: rng.pickWeighted(table), timing };
    }
    if (D === 1) return { result: rng.pickWeighted(level.adjacent), timing };
    return { result: 'SWING_MISS', timing };
  }

  const api = { cellDistance, timingGrade, judge, isBall };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
