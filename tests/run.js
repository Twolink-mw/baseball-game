// 순수 로직 테스트: node tests/run.js
'use strict';
const assert = require('node:assert/strict');
const { CONFIG } = require('../js/config.js');
const { createRng, hashString } = require('../js/rng.js');
const { createPitcher, flightForSpeed, cellIndex } = require('../js/pitcher.js');
const { cellDistance, timingGrade, judge } = require('../js/judge.js');
const { createGame, formatAvg, challengeSeeds } = require('../js/game.js');
const S = require('../js/storage.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').join('\n      '));
  }
}
function section(name) {
  console.log('\n' + name);
}

// ---- 테스트 도우미 ----
// 결과를 순서대로 돌려주는 가짜 판정 함수
function scriptedJudge(results) {
  const queue = results.slice();
  return () => {
    const r = queue.shift();
    if (!r) throw new Error('스크립트 결과 부족');
    return typeof r === 'string' ? { result: r, timing: 'GOOD' } : r;
  };
}
function newGame(results, extra) {
  return createGame(Object.assign({ levelIndex: 0, pitchSeed: 1, judgeSeed: 2, judgeFn: scriptedJudge(results) }, extra));
}
function runUntil(g, pred, maxSteps = 100000) {
  for (let i = 0; i < maxSteps; i++) {
    if (pred(g)) return;
    g.update(0.01);
  }
  throw new Error('조건에 도달하지 못함 (phase=' + g.phase + ')');
}
// 투구 하나를 진행: 비행 상태에서 클릭(도착 시각) 후 결과 표시까지
function playPitch(g) {
  runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
  g.input({ row: 1, col: 1 }, g.arrivalTime);
  runUntil(g, (x) => x.phase === 'RESULT_SHOW');
  const last = g.last;
  runUntil(g, (x) => x.phase !== 'RESULT_SHOW');
  return last;
}

section('카운트');
test('파울: S=0→1, S=1→2, S=2 유지', () => {
  const g = newGame(['FOUL', 'FOUL', 'FOUL']);
  playPitch(g);
  assert.equal(g.strikes, 1);
  playPitch(g);
  assert.equal(g.strikes, 2);
  playPitch(g);
  assert.equal(g.strikes, 2);
  assert.equal(g.atBat, 1);
});

test('3스트라이크(헛스윙+루킹 포함) → 삼진, 타석 종료', () => {
  const g = newGame(['SWING_MISS', 'LOOKING', 'SWING_MISS']);
  playPitch(g);
  playPitch(g);
  const last = playPitch(g);
  assert.equal(last.atBatEnded, true);
  assert.equal(last.atBatOutcome, 'STRIKEOUT');
  assert.equal(g.stats.strikeouts, 1);
  assert.equal(g.atBat, 2);
  assert.equal(g.strikes, 0);
});

test('미클릭이면 스트라이크는 루킹, 볼은 볼 (실제 판정 함수)', () => {
  const g = createGame({ levelIndex: 0, pitchSeed: 3, judgeSeed: 4 });
  runUntil(g, (x) => x.phase === 'RESULT_SHOW');
  assert.equal(g.last.result, g.pitch.ball ? 'BALL' : 'LOOKING');
  assert.equal(g.strikes, g.pitch.ball ? 0 : 1);
  assert.equal(g.balls, g.pitch.ball ? 1 : 0);
});

for (const r of ['SINGLE', 'DOUBLE', 'TRIPLE', 'HOMERUN', 'OUT_BIP']) {
  test(r + ' → 즉시 타석 종료', () => {
    const g = newGame([r]);
    const last = playPitch(g);
    assert.equal(last.atBatEnded, true);
    assert.equal(g.atBat, 2);
  });
}

test('타석 투구수 12 이상에서 파울 → 범타로 타석 종료', () => {
  const g = newGame(new Array(12).fill('FOUL'));
  for (let i = 0; i < 11; i++) {
    const last = playPitch(g);
    assert.equal(last.atBatEnded, false, i + 1 + '구째에서 끝나면 안 됨');
  }
  const last = playPitch(g);
  assert.equal(last.atBatEnded, true);
  assert.equal(last.result, 'OUT_BIP');
  assert.equal(last.foulCapped, true);
  assert.equal(g.stats.outs, 1);
  assert.equal(g.totalPitches, 12);
});

test('10타석 → GAME_OVER, 타율 = 안타÷10 (홈런·2루타 포함)', () => {
  assert.equal(CONFIG.AT_BATS_PER_GAME, 10);
  const g = newGame(['SINGLE', 'DOUBLE', 'HOMERUN', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP']);
  for (let i = 0; i < 9; i++) playPitch(g);
  assert.notEqual(g.phase, 'GAME_OVER');
  playPitch(g);
  assert.equal(g.phase, 'GAME_OVER');
  assert.equal(g.stats.hits, 3);
  assert.equal(g.finalAverage(), 3 / 10);
  assert.equal(formatAvg(g.finalAverage()), '.300');
});

test('볼: B 증가, 타석은 계속, 다음 타석에서 B=0', () => {
  const g = newGame(['BALL', 'BALL', 'SWING_MISS', 'SINGLE', 'LOOKING']);
  playPitch(g);
  playPitch(g);
  assert.equal(g.balls, 2);
  assert.equal(g.atBat, 1);
  playPitch(g);
  assert.deepEqual([g.balls, g.strikes], [2, 1]);
  playPitch(g); // 안타 → 다음 타석
  assert.deepEqual([g.atBat, g.balls, g.strikes], [2, 0, 0]);
});

test('볼 3개 이후에는 스트라이크만 (볼넷 없음)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = createGame({ levelIndex: 2, pitchSeed: seed, judgeSeed: seed + 1 });
    let pitches = 0;
    while (g.phase !== 'GAME_OVER' && pitches < 400) {
      runUntil(g, (x) => x.phase === 'PITCH_FLIGHT' || x.phase === 'GAME_OVER');
      if (g.phase === 'GAME_OVER') break;
      if (g.balls >= CONFIG.MAX_BALLS) assert.equal(g.pitch.ball, false, '볼 3개 뒤 볼');
      pitches++;
      runUntil(g, (x) => x.phase === 'RESULT_SHOW'); // 스윙 안 함 → 볼 또는 루킹
      assert.ok(g.balls <= CONFIG.MAX_BALLS);
      runUntil(g, (x) => x.phase !== 'RESULT_SHOW');
    }
    assert.equal(g.phase, 'GAME_OVER');
    assert.equal(g.stats.strikeouts, CONFIG.AT_BATS_PER_GAME, '안 치면 모두 삼진');
  }
});

test('타율 표시 반올림', () => {
  assert.equal(formatAvg(0), '.000');
  assert.equal(formatAvg(1 / 9), '.111');
  assert.equal(formatAvg(2 / 3), '.667');
  assert.equal(formatAvg(1), '1.000');
});

section('판정 거리/타이밍');
test('맨해튼 거리', () => {
  const c = (row, col) => ({ row, col });
  assert.equal(cellDistance(c(0, 0), c(0, 0)), 0);
  assert.equal(cellDistance(c(0, 0), c(0, 1)), 1);
  assert.equal(cellDistance(c(0, 0), c(1, 1)), 2);
  assert.equal(cellDistance(c(0, 0), c(2, 1)), 3);
});

test('타이밍 등급 경계', () => {
  assert.equal(timingGrade(0.05), 'PERFECT');
  assert.equal(timingGrade(-0.05), 'PERFECT');
  assert.equal(timingGrade(0.051), 'GOOD');
  assert.equal(timingGrade(0.12), 'GOOD');
  assert.equal(timingGrade(0.121), 'BAD');
  assert.equal(timingGrade(-0.2), 'BAD');
  assert.equal(timingGrade(0.151), 'NONE');
  assert.equal(timingGrade(null), 'NONE');
});

section('판정 확률 (각 10,000회, ±2%p)');
function checkDist(table, sample) {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  const N = 10000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    const r = sample();
    counts[r] = (counts[r] || 0) + 1;
  }
  for (const k of Object.keys(table)) {
    const want = table[k] / total;
    const got = (counts[k] || 0) / N;
    assert.ok(Math.abs(want - got) <= 0.02, `${k}: 기대 ${want.toFixed(3)}, 실제 ${got.toFixed(3)}`);
  }
  for (const k of Object.keys(counts)) assert.ok(k in table, '표에 없는 결과 ' + k);
}
const P = { row: 1, col: 1 };
const DELTA = { PERFECT: 0, GOOD: 0.1, BAD: -0.3 };
for (const grade of ['PERFECT', 'GOOD', 'BAD']) {
  test('D=0, ' + grade, () => {
    const rng = createRng(100 + grade.length);
    checkDist(CONFIG.JUDGE.exact[grade], () => judge({ cell: P, deltaSec: DELTA[grade] }, P, CONFIG.LEVELS[0], rng).result);
  });
}
test('구속 기준 145/152/160, 체인지업은 모든 레벨에 있고 직구보다 14km 느림', () => {
  assert.deepEqual(CONFIG.LEVELS.map((l) => l.baseSpeed), [145, 152, 160]);
  for (const l of CONFIG.LEVELS) assert.ok(l.pitchMix['체인지업'] > 0, l.name + ' 체인지업 없음');
  assert.equal(CONFIG.PITCH_TYPES['체인지업'].speedDelta, -14);
});
test('투구 템포: 멈춤·동작이 레벨 범위 안, 릴리스 = 와인드업 시작 + 멈춤 + 동작, Lv.3은 템포 폭이 큼', () => {
  CONFIG.LEVELS.forEach((level, i) => {
    const p = createPitcher(level, createRng(700 + i));
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 500; k++) {
      const x = p.nextPitch();
      assert.ok(x.holdSec >= level.tempo.hold[0] && x.holdSec <= level.tempo.hold[1]);
      assert.ok(x.motionSec >= level.tempo.motion[0] && x.motionSec <= level.tempo.motion[1]);
      assert.ok(Math.abs(x.windupSec - (x.holdSec + x.motionSec)) < 1e-12);
      lo = Math.min(lo, x.windupSec);
      hi = Math.max(hi, x.windupSec);
    }
    if (i === 2) assert.ok(hi - lo > 1.2, 'Lv.3 템포 폭 ' + (hi - lo));
  });
  const g = createGame({ levelIndex: 2, pitchSeed: 3, judgeSeed: 4 });
  runUntil(g, (x) => x.phase === 'PITCH_WINDUP');
  const start = g.phaseStart;
  runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
  assert.ok(Math.abs(g.releaseTime - (start + g.pitch.windupSec)) < 1e-9);
});
CONFIG.LEVELS.forEach((level, i) => {
  test('D=1, ' + level.name, () => {
    const rng = createRng(200 + i);
    checkDist(level.adjacent, () => judge({ cell: { row: 0, col: 1 }, deltaSec: 0 }, P, level, rng).result);
  });
});
test('D≥2 → 항상 헛스윙, 클릭 없음 → 루킹', () => {
  const rng = createRng(5);
  for (let i = 0; i < 1000; i++) {
    assert.equal(judge({ cell: { row: 0, col: 0 }, deltaSec: 0 }, P, CONFIG.LEVELS[0], rng).result, 'SWING_MISS');
  }
  assert.equal(judge(null, P, CONFIG.LEVELS[0], rng).result, 'LOOKING');
  assert.equal(judge({ cell: P, deltaSec: 0.2 }, P, CONFIG.LEVELS[0], rng).result, 'LOOKING');
});
test('볼: 안 치면 BALL, 볼 옆 칸(D=1)은 인접 판정, 먼 칸은 헛스윙', () => {
  const rng = createRng(6);
  const level = CONFIG.LEVELS[0];
  const B = { row: -1, col: 1 }; // 존 바로 위
  assert.equal(judge(null, B, level, rng).result, 'BALL');
  assert.equal(judge({ cell: { row: 0, col: 1 }, deltaSec: 0.2 }, B, level, rng).result, 'BALL');
  for (let i = 0; i < 300; i++) {
    assert.ok(Object.keys(level.adjacent).includes(judge({ cell: { row: 0, col: 1 }, deltaSec: 0 }, B, level, rng).result));
    assert.equal(judge({ cell: { row: 2, col: 1 }, deltaSec: 0 }, B, level, rng).result, 'SWING_MISS');
  }
});

section('투수 AI');
test('구속표: 같은 구속이면 레벨과 관계없이 같은 비행 시간, 느릴수록 오래 걸림', () => {
  assert.equal(flightForSpeed(140), 1.2);
  assert.equal(flightForSpeed(150), 0.9);
  assert.equal(flightForSpeed(160), 0.6);
  assert.ok(Math.abs(flightForSpeed(145) - 1.05) < 1e-12, '사이 값 직선 보간');
  assert.equal(flightForSpeed(100), 1.5, '표 밖은 끝 값');
  assert.equal(flightForSpeed(200), 0.3);
  for (let s = 130; s < 170; s++) assert.ok(flightForSpeed(s) > flightForSpeed(s + 1));
  // Lv.3 커브(약 140km)는 Lv.1 직구 140km와 같은 속도
  const lv3 = createPitcher(CONFIG.LEVELS[2], createRng(9));
  for (let k = 0; k < 300; k++) {
    const p = lv3.nextPitch();
    if (p.speed === 140) assert.equal(p.flightSec, 1.2);
  }
});
CONFIG.LEVELS.forEach((level, i) => {
  test(level.name + ': 구속표대로 비행 시간, 공개 시간, 구속 범위', () => {
    const p = createPitcher(level, createRng(300 + i));
    for (let k = 0; k < 500; k++) {
      const pitch = p.nextPitch();
      assert.equal(pitch.revealSec, pitch.ball ? Math.min(level.revealSec * CONFIG.BALL.revealMult, 1) : level.revealSec);
      assert.ok(Math.abs(pitch.flightSec - flightForSpeed(pitch.speed)) < 1e-12);
      assert.ok(pitch.type in level.pitchMix, '레벨에 없는 구종 ' + pitch.type);
      const base = level.baseSpeed + CONFIG.PITCH_TYPES[pitch.type].speedDelta;
      assert.ok(Math.abs(pitch.speed - base) <= CONFIG.SPEED_JITTER, '구속 범위 밖 ' + pitch.speed);
    }
  });
});

test('random: 9칸 모두 대략 균등', () => {
  const p = createPitcher(CONFIG.LEVELS[0], createRng(7));
  const counts = new Array(9).fill(0);
  const N = 18000;
  for (let k = 0; k < N; k++) counts[cellIndex(p.nextPitch({ allowBall: false }).cell)]++;
  for (const c of counts) assert.ok(Math.abs(c / N - 1 / 9) < 0.015);
});

test('볼 비율은 레벨 ballRate, 볼은 존 바로 바깥 칸, allowBall=false면 볼 없음', () => {
  CONFIG.LEVELS.forEach((level, i) => {
    const p = createPitcher(level, createRng(800 + i));
    const N = 10000;
    let balls = 0;
    for (let k = 0; k < N; k++) {
      const x = p.nextPitch();
      const out = x.cell.row < 0 || x.cell.row > 2 || x.cell.col < 0 || x.cell.col > 2;
      assert.equal(out, x.ball);
      if (x.ball) {
        balls++;
        assert.ok(x.cell.row >= -1 && x.cell.row <= 3 && x.cell.col >= -1 && x.cell.col <= 3);
        assert.ok((x.cell.row >= 0 && x.cell.row <= 2) || (x.cell.col >= 0 && x.cell.col <= 2), '대각선 모서리 바깥');
      }
    }
    assert.ok(Math.abs(balls / N - level.ballRate) < 0.02, level.name + ' 볼 비율 ' + balls / N);
    for (let k = 0; k < 500; k++) assert.equal(p.nextPitch({ allowBall: false }).ball, false);
  });
});

test('adaptive: 클릭이 몰린 칸을 덜 던짐', () => {
  const p = createPitcher(CONFIG.LEVELS[2], createRng(8));
  const counts = new Array(9).fill(0);
  const N = 9000;
  for (let k = 0; k < N; k++) {
    counts[cellIndex(p.nextPitch({ allowBall: false }).cell)]++;
    p.recordUserClick({ row: 1, col: 1 }); // 항상 가운데 클릭
  }
  const center = counts[4] / N;
  const othersAvg = (N - counts[4]) / 8 / N;
  assert.ok(center < othersAvg * 0.3, `가운데 ${center.toFixed(3)}, 나머지 평균 ${othersAvg.toFixed(3)}`);
});

section('상태 머신');
test('와인드업/결과 연출 중 클릭 무시, 첫 클릭만 인정', () => {
  const g = newGame(['FOUL', 'FOUL']);
  runUntil(g, (x) => x.phase === 'PITCH_WINDUP');
  assert.equal(g.input({ row: 0, col: 0 }), false);
  runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
  assert.equal(g.input({ row: 0, col: 0 }), true);
  assert.equal(g.input({ row: 2, col: 2 }), false);
  assert.deepEqual(g.click.cell, { row: 0, col: 0 });
  runUntil(g, (x) => x.phase === 'RESULT_SHOW');
  assert.equal(g.input({ row: 0, col: 0 }), false);
});

test('릴리스 이전 시각의 입력, 유예 이후 시각의 입력 무시', () => {
  const g = newGame(['FOUL']);
  runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
  assert.equal(g.input({ row: 0, col: 0 }, g.releaseTime - 0.01), false);
  assert.equal(g.input({ row: 0, col: 0 }, g.arrivalTime + CONFIG.GRACE_SEC + 0.01), false);
});

test('클릭이 있으면 도착 시점에 판정, 없으면 도착+유예 후 판정', () => {
  const g = newGame(['FOUL', 'LOOKING']);
  runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
  g.input({ row: 1, col: 1 });
  runUntil(g, (x) => x.phase === 'RESULT_SHOW');
  assert.ok(g.time >= g.arrivalTime && g.time < g.arrivalTime + 0.02);
  runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
  runUntil(g, (x) => x.phase === 'RESULT_SHOW');
  assert.ok(g.time >= g.arrivalTime + CONFIG.GRACE_SEC);
});

test('dt 상한: update(1)은 MAX_DT만큼만 진행', () => {
  const g = newGame([]);
  g.update(1);
  assert.ok(Math.abs(g.time - CONFIG.MAX_DT) < 1e-12);
});

test('일시정지 중에는 시간과 입력이 멈춤', () => {
  const g = newGame(['FOUL']);
  runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
  g.setPaused(true);
  const t = g.time;
  g.update(0.03);
  assert.equal(g.time, t);
  assert.equal(g.input({ row: 1, col: 1 }), false);
  g.setPaused(false);
  assert.equal(g.input({ row: 1, col: 1 }), true);
});

test('투구 기록: 투구마다 타석 번호·순번·구종·구속·코스·클릭·결과를 남김', () => {
  const g = newGame(['SWING_MISS', 'FOUL', 'SINGLE', 'OUT_BIP']);
  for (let i = 0; i < 4; i++) playPitch(g);
  assert.deepEqual(g.history.map((h) => [h.atBat, h.n, h.result]), [[1, 1, 'SWING_MISS'], [1, 2, 'FOUL'], [1, 3, 'SINGLE'], [2, 1, 'OUT_BIP']]);
  g.history.forEach((h, i) => {
    assert.equal(h.type, g.pitchLog[i].type);
    assert.equal(h.speed, g.pitchLog[i].speed);
    assert.deepEqual(h.cell, g.pitchLog[i].cell);
    assert.deepEqual(h.clickCell, { row: 1, col: 1 });
  });
});
section('오늘의 챌린지');
function pitchesOf(results, seeds) {
  const g = createGame(Object.assign({ levelIndex: CONFIG.CHALLENGE.level - 1, mode: 'challenge', judgeFn: scriptedJudge(results) }, seeds));
  while (g.phase !== 'GAME_OVER') playPitch(g);
  return g.pitchLog.map((p) => [p.cell.row, p.cell.col, p.type, p.speed].join());
}
test('같은 날짜면 판정과 관계없이 투구 순서가 같음', () => {
  const seeds = challengeSeeds('2026-11-11');
  const a = pitchesOf(new Array(10).fill('SINGLE'), seeds);
  const b = pitchesOf(new Array(30).fill('SWING_MISS'), seeds);
  assert.equal(a.length, 10);
  assert.deepEqual(b.slice(0, 10), a);
});
test('다른 날짜면 투구 순서가 다름', () => {
  const a = pitchesOf(new Array(10).fill('SINGLE'), challengeSeeds('2026-11-11'));
  const b = pitchesOf(new Array(10).fill('SINGLE'), challengeSeeds('2026-11-12'));
  assert.notDeepEqual(a, b);
});
test('오늘의 투수·미션: 같은 날짜면 같음, 여러 날짜에 고루 나옴, 투수 AI는 클릭과 무관', () => {
  const { challengeSetup } = require('../js/game.js');
  const a = challengeSetup('2026-11-12');
  const b = challengeSetup('2026-11-12');
  assert.equal(a.pitcher.name, b.pitcher.name);
  assert.equal(a.mission.text, b.mission.text);
  assert.equal(a.levelIndex, CONFIG.CHALLENGE.level - 1);
  const pitchers = new Set();
  const missions = new Set();
  for (let d = 1; d <= 60; d++) {
    const date = '2026-' + String(1 + Math.floor((d - 1) / 28)).padStart(2, '0') + '-' + String(1 + ((d - 1) % 28)).padStart(2, '0');
    const x = challengeSetup(date);
    pitchers.add(x.pitcher.name);
    missions.add(x.mission.text);
    assert.ok(x.level.ai === 'random' || x.level.ai === 'weak', '챌린지에 adaptive 금지');
    assert.equal(x.level.title, x.pitcher.name);
  }
  assert.equal(pitchers.size, CONFIG.CHALLENGE.pitchers.length);
  assert.equal(missions.size, CONFIG.CHALLENGE.missions.length);
  // 투수 덮어쓰기
  const fast = CONFIG.CHALLENGE.pitchers.find((p) => p.name === '강속구');
  for (let d = 1; d <= 200; d++) {
    const x = challengeSetup('2027-01-' + d);
    if (x.pitcher === fast) {
      assert.equal(x.level.baseSpeed, fast.baseSpeed);
      assert.deepEqual(x.level.pitchMix, fast.pitchMix);
      assert.equal(x.level.revealSec, CONFIG.LEVELS[1].revealSec, '나머지는 바탕 레벨 값');
      break;
    }
  }
});
test('챌린지 게임: 오늘의 투수 레벨로 던지고, 투구 순서는 판정과 무관', () => {
  const { challengeSetup } = require('../js/game.js');
  for (const date of ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) {
    const s = challengeSetup(date);
    const mk = (results) => createGame({ levelIndex: s.levelIndex, level: s.level, mission: s.mission, mode: 'challenge', pitchSeed: s.pitchSeed, judgeSeed: s.judgeSeed, judgeFn: scriptedJudge(results) });
    const g1 = mk(new Array(10).fill('SINGLE'));
    while (g1.phase !== 'GAME_OVER') playPitch(g1);
    const g2 = mk(new Array(30).fill('SWING_MISS'));
    while (g2.phase !== 'GAME_OVER') playPitch(g2);
    const key = (p) => [p.cell.row, p.cell.col, p.type, p.speed].join();
    assert.deepEqual(g2.pitchLog.slice(0, 10).map(key), g1.pitchLog.map(key));
    for (const p of g1.pitchLog) assert.ok(p.type in s.level.pitchMix);
    assert.equal(g1.summary().pitcherName, s.pitcher.name);
    assert.deepEqual(g1.summary().atBatLog, new Array(10).fill('SINGLE'));
  }
});

section('챌린지 미션');
test('미션 진행: min형은 도중 달성, max형은 넘으면 실패·끝나야 달성, 첫 타석/연속 안타', () => {
  const { missionProgress, hitStreak } = require('../js/game.js');
  const st = (o) => Object.assign({ hits: 0, singles: 0, doubles: 0, homers: 0, strikeouts: 0, outs: 0, perfects: 0 }, o);
  assert.deepEqual(missionProgress({ stat: 'homers', min: 1 }, st({ homers: 1 }), ['HOMERUN'], false), { value: 1, done: true, failed: false });
  assert.deepEqual(missionProgress({ stat: 'homers', min: 1 }, st({}), [], true), { value: 0, done: false, failed: true });
  assert.deepEqual(missionProgress({ stat: 'strikeouts', max: 2 }, st({ strikeouts: 2 }), [], false), { value: 2, done: false, failed: false });
  assert.deepEqual(missionProgress({ stat: 'strikeouts', max: 2 }, st({ strikeouts: 2 }), [], true), { value: 2, done: true, failed: false });
  assert.equal(missionProgress({ stat: 'strikeouts', max: 2 }, st({ strikeouts: 3 }), [], false).failed, true);
  assert.equal(missionProgress({ stat: 'extraBases', min: 2 }, st({ doubles: 1, homers: 1 }), [], false).done, true);
  assert.equal(missionProgress({ stat: 'firstHit', min: 1 }, st({}), ['OUT_BIP', 'SINGLE'], false).failed, true);
  assert.equal(missionProgress({ stat: 'firstHit', min: 1 }, st({}), ['DOUBLE'], false).done, true);
  assert.equal(hitStreak(['SINGLE', 'OUT_BIP', 'SINGLE', 'HOMERUN', 'DOUBLE', 'STRIKEOUT']), 3);
  assert.equal(missionProgress({ stat: 'hitStreak', min: 3 }, st({}), ['SINGLE', 'HOMERUN', 'DOUBLE'], false).done, true);
});
test('미션 달성은 그날 공식 판만 누적, 저장 검증·병합', () => {
  let rec = S.ensurePlayer(S.defaultRecord ? S.defaultRecord() : S.normalizeRecord(null), '미션').record;
  const key = rec.current;
  const ch = (r, done, date) => S.applyGameResult(r, { playerKey: key, levelIndex: 1, hits: 3, atBats: 10, mode: 'challenge', date, missionDone: done });
  let r = ch(rec, true, '2026-11-12');
  assert.equal(r.record.players[key].missions, 1);
  assert.equal(r.record.players[key].daily.mission, true);
  r = ch(r.record, true, '2026-11-12'); // 같은 날 연습
  assert.equal(r.official, false);
  assert.equal(r.record.players[key].missions, 1);
  r = ch(r.record, false, '2026-11-13');
  assert.equal(r.record.players[key].missions, 1);
  assert.equal(r.record.players[key].daily.mission, undefined);
  // 저장했다 불러와도 유지, 잘못된 값은 버림
  const back = S.normalizeRecord(JSON.parse(JSON.stringify(ch(r.record, true, '2026-11-14').record)));
  assert.equal(back.players[key].missions, 2);
  assert.equal(back.players[key].daily.mission, true);
  const bad = JSON.parse(JSON.stringify(back));
  bad.players[key].missions = -1;
  assert.equal(S.normalizeRecord(bad).players[key].missions, 0);
  // 병합: 큰 쪽
  const other = JSON.parse(JSON.stringify(back));
  other.players[key].missions = 5;
  assert.equal(S.mergeRecords(back, other).players[key].missions, 5);
});

test('문자열 해시는 결정적', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

section('타자 이름');
test('이름 정규화: 공백 정리, 1~8자', () => {
  assert.equal(S.normalizeName('  홍  길동 '), '홍 길동');
  assert.equal(S.normalizeName(''), null);
  assert.equal(S.normalizeName('   '), null);
  assert.equal(S.normalizeName('가나다라마바사아'), '가나다라마바사아');
  assert.equal(S.normalizeName('가나다라마바사아자'), null);
  assert.equal(S.normalizeName(null), null);
});
test('같은 이름 판정: 공백/영문 대소문자 무시', () => {
  assert.equal(S.playerKey(' Kim  A '), S.playerKey('kim a'));
  assert.notEqual(S.playerKey('홍길동'), S.playerKey('홍길순'));
});
test('ensurePlayer: 새 타자 생성 후 같은 이름이면 기존 타자 재사용', () => {
  const r = S.ensurePlayer(S.defaultRecord(), '홍길동');
  assert.equal(r.created, true);
  assert.equal(r.record.current, r.key);
  const again = S.ensurePlayer(r.record, ' 홍길동 ');
  assert.equal(again.created, false);
  assert.equal(again.key, r.key);
  assert.equal(Object.keys(again.record.players).length, 1);
  assert.deepEqual(S.ensurePlayer(r.record, ''), { error: 'invalid' });
});
test('MAX_PLAYERS 초과 시 새 타자 거부(기존 타자는 선택 가능)', () => {
  let rec = S.defaultRecord();
  for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) rec = S.ensurePlayer(rec, 'p' + i).record;
  assert.deepEqual(S.ensurePlayer(rec, '새타자'), { error: 'full' });
  assert.equal(S.ensurePlayer(rec, 'p0').created, false);
});

section('타자별 기록과 잠금 해제');
function withPlayers(...names) {
  let rec = S.defaultRecord();
  for (const n of names) rec = S.ensurePlayer(rec, n).record;
  return rec;
}
const play = (rec, key, levelIndex, hits, extra) =>
  S.applyGameResult(rec, Object.assign({ playerKey: key, levelIndex, hits, atBats: 9, mode: 'normal', date: '2026-11-11' }, extra));

test('같은 이름 재플레이 시 통산 타율 누적 (3/9 + 6/9 → 9/18)', () => {
  let r = play(withPlayers('홍길동'), '홍길동', 0, 3);
  assert.equal(r.careerBefore, null);
  assert.equal(r.careerAfter, 3 / 9);
  r = play(r.record, '홍길동', 0, 6);
  assert.equal(r.careerBefore, 3 / 9);
  assert.equal(r.careerAfter, 0.5);
  const p = r.record.players['홍길동'];
  assert.deepEqual([p.hits, p.atBats, p.games], [9, 18, 2]);
});
test('해제 기준: 모든 레벨 .400(4안타), 3안타는 미달. 이후 낮은 타율이어도 유지', () => {
  assert.deepEqual(CONFIG.UNLOCK_AVG, [0.4, 0.4]);
  let r = play(withPlayers('a'), 'a', 0, 3); // .333: Lv.1 기준 미달
  assert.equal(r.record.players.a.unlocked[1], false);
  assert.equal(r.unlockedLevel, null);
  r = play(r.record, 'a', 0, 4); // .444
  assert.equal(r.record.players.a.unlocked[1], true);
  assert.equal(r.unlockedLevel, 1);
  r = play(r.record, 'a', 0, 0);
  assert.equal(r.record.players.a.unlocked[1], true);
  assert.equal(r.unlockedLevel, null);
});
test('잠금 해제는 타자별: A의 해제가 B에 영향 없음', () => {
  const r = play(withPlayers('a', 'b'), 'a', 0, 5);
  assert.equal(r.record.players.a.unlocked[1], true);
  assert.equal(r.record.players.b.unlocked[1], false);
  assert.equal(r.record.players.b.atBats, 0);
});
test('최고 타율은 갱신 시에만 변경, 첫 .000은 NEW RECORD 아님', () => {
  let r = play(withPlayers('a'), 'a', 0, 0);
  assert.equal(r.newRecord, false);
  assert.equal(r.record.players.a.best[0], 0);
  r = play(r.record, 'a', 0, 4);
  assert.equal(r.newRecord, true);
  r = play(r.record, 'a', 0, 2);
  assert.equal(r.newRecord, false);
  assert.equal(r.record.players.a.best[0], 4 / 9);
  r = play(r.record, 'a', 0, 4);
  assert.equal(r.newRecord, false);
  r = play(r.record, 'a', 0, 5);
  assert.equal(r.record.players.a.best[0], 5 / 9);
});
test('챌린지: 통산/해제/최고 타율 미반영, 타자별 그날 첫 판만 기록', () => {
  const ch = (rec, key, hits, date) => play(rec, key, 1, hits, { mode: 'challenge', date });
  let r = ch(withPlayers('a', 'b'), 'a', 9, '2026-11-11');
  const a = r.record.players.a;
  assert.equal(r.official, true);
  assert.deepEqual([a.hits, a.atBats], [0, 0]);
  assert.deepEqual(a.unlocked, [true, false, false]);
  assert.deepEqual(a.best, [null, null, null]);
  assert.deepEqual(a.daily, { date: '2026-11-11', avg: 1 });
  r = ch(r.record, 'a', 0, '2026-11-11');
  assert.equal(r.official, false);
  assert.equal(r.record.players.a.daily.avg, 1);
  r = ch(r.record, 'b', 0, '2026-11-11');
  assert.equal(r.official, true, '다른 타자는 같은 날도 첫 판');
  r = ch(r.record, 'a', 0, '2026-11-12');
  assert.equal(r.official, true);
});
test('순위: 통산 타율 내림차순, 동률이면 타수 많은 순, 타수 0은 맨 아래', () => {
  let rec = withPlayers('zero', 'low', 'high', 'tieMore', 'tieLess');
  rec = play(rec, 'low', 0, 1).record;
  rec = play(rec, 'high', 0, 6).record;
  rec = play(rec, 'tiemore', 0, 3).record;
  rec = play(rec, 'tiemore', 0, 3).record;
  rec = play(rec, 'tieless', 0, 3).record;
  assert.deepEqual(S.rankPlayers(rec).map((p) => p.key), ['high', 'tiemore', 'tieless', 'low', 'zero']);
});
test('타자 삭제: 현재 타자면 선택 해제', () => {
  const r = S.deletePlayer(withPlayers('a', 'b'), 'b'); // 현재 타자 b
  assert.deepEqual(Object.keys(r.players), ['a']);
  assert.equal(r.current, null);
});

section('저장 검증/병합/이전');
test('v1 기록 → v2 타자로 이전', () => {
  const v1 = { v: 1, name: '', unlocked: [true, true, false], best: [0.444, null, null], games: 3, daily: { date: '2026-11-10', avg: 0.3 } };
  const r = S.normalizeRecord(v1);
  assert.equal(r.v, 2);
  const p = r.players[r.current];
  assert.equal(p.name, '타자1');
  assert.deepEqual(p.unlocked, [true, true, false]);
  assert.deepEqual(p.best, [0.444, null, null]);
  assert.deepEqual([p.hits, p.atBats, p.games], [0, 0, 3]);
  assert.deepEqual(S.normalizeRecord({ v: 1, unlocked: [true, false, false], best: [null, null, null], games: 0 }).players, {});
});
test('validateRecord: 잘못된 형식 거부', () => {
  assert.equal(S.validateRecord(null), null);
  assert.equal(S.validateRecord({ v: 3, players: {} }), null);
  const ok = play(withPlayers('a'), 'a', 0, 3).record;
  assert.notEqual(S.validateRecord(JSON.parse(JSON.stringify(ok))), null);
  const bad = (mut) => {
    const x = JSON.parse(JSON.stringify(ok));
    mut(x.players.a);
    return S.validateRecord(x);
  };
  assert.equal(bad((p) => (p.name = '')), null);
  assert.equal(bad((p) => (p.unlocked = [true, 'y', false])), null);
  assert.equal(bad((p) => (p.best = [2, null, null])), null);
  assert.equal(bad((p) => (p.hits = 10)), null, '안타 > 타수');
  assert.equal(bad((p) => (p.daily = { date: 'x', avg: 0.1 })), null);
});
test('normalizeRecord: 깨진 데이터에서 살릴 수 있는 필드만 살림', () => {
  const r = S.normalizeRecord({
    v: 2, current: 'nobody',
    players: { x: { name: '  A ', unlocked: [true, true, 'x'], best: [0.5, 'a'], hits: 3, atBats: 'n', games: 1.5 }, y: { name: '' } },
  });
  assert.deepEqual(Object.keys(r.players), ['a']);
  const p = r.players.a;
  assert.equal(p.name, 'A');
  assert.deepEqual(p.unlocked, [true, true, false]);
  assert.deepEqual(p.best, [0.5, null, null]);
  assert.deepEqual([p.hits, p.atBats, p.games], [0, 0, 0]);
  assert.equal(r.current, null);
});
test('mergeRecords: 타자별 병합 + 없는 타자 추가 + 현재 타자/설정 유지', () => {
  let a = withPlayers('공통', 'A만');
  a = play(a, '공통', 0, 4).record; // 4/9, Lv.2 해제
  a.settings.muted = true;
  a.players['공통'].daily = { date: '2026-11-10', avg: 0.2 };
  let b = withPlayers('공통', 'B만');
  b = play(b, '공통', 1, 1).record;
  b = play(b, '공통', 0, 2).record; // 통산 3/18
  b.players['공통'].unlocked[2] = true;
  b.players['공통'].daily = { date: '2026-11-11', avg: 0.1 };
  const m = S.mergeRecords(a, b);
  const p = m.players['공통'];
  assert.deepEqual(Object.keys(m.players).sort(), ['a만', 'b만', '공통'].sort());
  assert.deepEqual(p.unlocked, [true, true, true]);
  assert.deepEqual(p.best, [4 / 9, 1 / 9, null]);
  assert.deepEqual([p.hits, p.atBats], [3, 18], '타수가 많은 쪽 채택');
  assert.equal(p.games, 2);
  assert.deepEqual(p.daily, { date: '2026-11-11', avg: 0.1 });
  assert.equal(m.current, a.current);
  assert.equal(m.settings.muted, true);
});

test('우타/좌타: 새 타자는 우타, 지정하면 저장, 생략하면 기존 값 유지', () => {
  let r = S.ensurePlayer(S.defaultRecord(), '가').record;
  assert.equal(r.players['가'].bats, 'R');
  r = S.ensurePlayer(r, '나', 'L').record;
  assert.equal(r.players['나'].bats, 'L');
  r = S.ensurePlayer(r, '나').record; // 기존 타자 버튼으로 선택
  assert.equal(r.players['나'].bats, 'L');
  r = S.ensurePlayer(r, ' 나 ', 'R').record; // 같은 이름 + 우타로 변경
  assert.equal(r.players['나'].bats, 'R');
  r = S.ensurePlayer(r, '다', 'X').record; // 잘못된 값은 무시
  assert.equal(r.players['다'].bats, 'R');
});
test('우타/좌타: 저장값 정규화·검증·병합', () => {
  const base = S.ensurePlayer(S.defaultRecord(), '가', 'L').record;
  // 이전 기록(bats 없음)은 우타, 잘못된 값도 우타로 복구
  const old = JSON.parse(JSON.stringify(base));
  delete old.players['가'].bats;
  assert.equal(S.normalizeRecord(old).players['가'].bats, 'R');
  old.players['가'].bats = 'X';
  assert.equal(S.normalizeRecord(old).players['가'].bats, 'R');
  assert.equal(S.validateRecord(old), null, '가져오기는 잘못된 값 거부');
  // 병합 시 현재 기기의 설정 유지
  const other = S.ensurePlayer(S.defaultRecord(), '가', 'R').record;
  assert.equal(S.mergeRecords(base, other).players['가'].bats, 'L');
});


test('기록 백업: 내보내기 → 다른 기기 가져오기 왕복, 잘못된 내용은 거부하고 기존 기록 유지', () => {
  // 기기 A: 두 타자
  let a = withPlayers('홍길동', '이순신');
  a = play(a, '홍길동', 0, 4).record; // 4/9, Lv.2 해제
  const text = S.exportRecord(a);
  assert.equal(JSON.parse(text).v, 2);
  // 기기 B: 홍길동은 적게 쳤고, 다른 타자 한 명
  let b = withPlayers('홍길동', '강감찬');
  b = play(b, '홍길동', 0, 1).record;
  b = play(b, '홍길동', 0, 2).record; // 3/18
  b.settings.padSide = 'left';
  const r = S.importRecordText(b, text);
  assert.ok(!r.error);
  assert.deepEqual(r.added, ['이순신']);
  assert.deepEqual(r.updated, ['홍길동']);
  const p = r.record.players['홍길동'];
  assert.deepEqual([p.hits, p.atBats], [3, 18], '통산은 타수가 많은 쪽(B)');
  assert.equal(p.best[0], 4 / 9, '최고 타율은 큰 값(A)');
  assert.equal(p.unlocked[1], true, '해제는 하나라도 해제면 해제');
  assert.equal(r.record.current, b.current, '현재 타자는 이 기기 값');
  assert.equal(r.record.settings.padSide, 'left', '설정은 이 기기 값');
  // 같은 내용을 다시 가져오면 바뀌는 것 없음
  const again = S.importRecordText(r.record, text);
  assert.deepEqual([again.added, again.updated], [[], []]);
  // 잘못된 내용
  assert.equal(S.importRecordText(b, '{오류').error, 'parse');
  assert.equal(S.importRecordText(b, '{"v":2,"players":[]}').error, 'invalid');
  assert.equal(S.importRecordText(b, '').error, 'parse');
  // 이전 버전(v1) 파일도 받아들임
  const v1 = JSON.stringify({ v: 1, name: '옛타자', unlocked: [true, true, false], best: [0.5, null, null], games: 3 });
  const r1 = S.importRecordText(b, v1);
  assert.deepEqual(r1.added, ['옛타자']);
});

section('경기 후 분석');
{
  const { analyze } = require('../js/game.js');
  const P = (type, cell, click, result, timing, deltaSec) => ({
    atBat: 1, n: 1, type, speed: 150, cell, clickCell: click, result, timing, deltaSec,
  });
  const c = (row, col) => ({ row, col });
  test('코스별·구종별·타이밍·선구안 집계', () => {
    const h = [
      P('직구', c(0, 0), c(0, 0), 'SINGLE', 'PERFECT', 0.01),
      P('직구', c(0, 0), c(0, 1), 'FOUL', 'GOOD', -0.1),
      P('커브', c(2, 1), c(2, 1), 'OUT_BIP', 'BAD', -0.2),
      P('커브', c(-1, 1), c(0, 1), 'SWING_MISS', 'BAD', 0.13),
      P('커브', c(1, 3), null, 'BALL', 'NONE', null),
      P('직구', c(1, 1), null, 'LOOKING', 'NONE', null),
    ];
    const a = analyze(h, CONFIG);
    assert.deepEqual(a.byCell[0], { pitches: 2, swings: 2, matched: 1, hits: 1 });
    assert.deepEqual(a.byCell[7], { pitches: 1, swings: 1, matched: 1, hits: 0 });
    assert.equal(a.byCell[4].pitches, 1);
    assert.deepEqual(a.byType['커브'], { pitches: 3, swings: 2, hits: 0, misses: 1, early: 1, late: 1 });
    assert.equal(a.timing.swings, 4);
    assert.equal(a.timing.perfect, 1);
    assert.equal(a.timing.good, 1);
    assert.equal(a.timing.early, 1);
    assert.equal(a.timing.late, 1);
    assert.ok(Math.abs(a.timing.mean - (0.01 - 0.1 - 0.2 + 0.13) / 4) < 1e-9);
    assert.deepEqual(a.discipline, { balls: 2, chased: 1, looking: 1 });
  });
  test('한 줄 평: 볼 스윙·구종 타이밍·약한 높이, 최대 개수 제한', () => {
    const balls = [0, 1, 2].map(() => P('직구', c(3, 1), c(2, 1), 'SWING_MISS', 'GOOD', 0));
    let a = analyze(balls, CONFIG);
    assert.ok(a.tips[0].startsWith('볼 3개 중 3개'), a.tips[0]);
    const curves = [0, 1, 2].map(() => P('커브', c(1, 1), c(1, 1), 'FOUL', 'BAD', -0.2));
    a = analyze(curves, CONFIG);
    assert.ok(a.tips.some((t) => t.startsWith('커브에 3번 중 3번 빨랐어요')), a.tips.join(' / '));
    const low = [0, 1, 2].map((i) => P('직구', c(2, i), c(1, i), 'SWING_MISS', 'GOOD', 0));
    a = analyze(low, CONFIG);
    assert.ok(a.tips.some((t) => t.startsWith('낮은 공에 3번 스윙해 0번')), a.tips.join(' / '));
    a = analyze(balls.concat(curves, low), CONFIG);
    assert.equal(a.tips.length, CONFIG.ANALYSIS.maxTips);
    assert.deepEqual(analyze([], CONFIG).tips, []);
  });
  test('게임 요약에 분석 포함, 볼에 스윙하면 chases 증가', () => {
    const g = newGame(['BALL', 'SINGLE']);
    g.pitch = null;
    runUntil(g, (x) => x.phase === 'PITCH_FLIGHT');
    g.pitch.cell = { row: -1, col: 1 }; // 볼로 바꿔 스윙
    g.input({ row: 0, col: 1 }, g.arrivalTime);
    runUntil(g, (x) => x.phase === 'RESULT_SHOW');
    assert.equal(g.stats.chases, 1);
    assert.equal(g.history[0].deltaSec, 0);
    const s = g.summary();
    assert.equal(s.analysis.discipline.chased, 1);
  });
}

section('승부처 · 칭호 · 타자 유리');
{
  const { clutchTargets, clutchState, earnedTitles } = require('../js/game.js');
  test('승부처 목표: 다음 레벨이 잠겨 있으면 해제, 최고 타율이 있으면 갱신', () => {
    const p = S.defaultPlayer('가');
    assert.deepEqual(clutchTargets(p, 0, CONFIG).map((t) => [t.kind, t.hits]), [['unlock', 4]]);
    p.unlocked[1] = true;
    p.best[0] = 0.5;
    assert.deepEqual(clutchTargets(p, 0, CONFIG).map((t) => [t.kind, t.hits]), [['record', 6]]);
    p.best[2] = 1;
    assert.deepEqual(clutchTargets(p, 2, CONFIG), []); // 마지막 레벨·10할은 목표 없음
  });
  test('승부처: 남은 타석 2 이하이고 남은 타석 안에 닿을 때만', () => {
    const T = [{ kind: 'unlock', hits: 4, label: 'Lv.2 해제' }, { kind: 'record', hits: 6, label: '최고 타율 갱신' }];
    assert.equal(clutchState(T, 3, 7, CONFIG), null); // 남은 3타석
    assert.deepEqual(clutchState(T, 3, 8, CONFIG), { kind: 'unlock', label: 'Lv.2 해제', need: 1, remaining: 2 });
    assert.deepEqual(clutchState(T, 2, 8, CONFIG), { kind: 'unlock', label: 'Lv.2 해제', need: 2, remaining: 2 }); // 남은 2타석 모두 안타면
    assert.equal(clutchState(T, 2, 9, CONFIG), null); // 2개 필요, 1타석 남음
    assert.equal(clutchState(T, 1, 9, CONFIG), null); // 3개 필요, 1타석 남음 → 불가
    assert.deepEqual(clutchState(T, 5, 9, CONFIG), { kind: 'record', label: '최고 타율 갱신', need: 1, remaining: 1 }); // 해제는 이미 달성
    assert.equal(clutchState(T, 6, 9, CONFIG), null);
    assert.equal(clutchState(null, 3, 9, CONFIG), null);
  });
  test('게임: 승부처 타석에 atbat 이벤트, 클러치 상태 노출', () => {
    const g = newGame(['OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'SINGLE', 'SINGLE', 'SINGLE', 'OUT_BIP', 'OUT_BIP'], {
      targets: [{ kind: 'unlock', hits: 4, label: 'Lv.2 해제' }],
    });
    for (let i = 0; i < 8; i++) playPitch(g);
    const ev = g.drainEvents().filter((e) => e.type === 'atbat');
    assert.equal(ev.length, 8);
    assert.equal(ev[6].clutch, null); // 8번째 타석 시작: 남은 3
    assert.deepEqual(ev[7].clutch, { kind: 'unlock', label: 'Lv.2 해제', need: 1, remaining: 2 });
    assert.equal(g.clutch().need, 1);
  });
  test('칭호: 조건을 모두 만족할 때만, 레벨 조건, 챌린지는 없음', () => {
    const base = { hits: 3, homers: 0, perfects: 0, strikeouts: 0, chases: 0, doubles: 0, singles: 3, outs: 7, levelIndex: 0, mode: 'normal', atBatLog: ['SINGLE', 'OUT_BIP', 'SINGLE', 'OUT_BIP', 'SINGLE'] };
    assert.deepEqual(earnedTitles(base, CONFIG), ['contact']);
    const big = Object.assign({}, base, { hits: 5, homers: 3, chases: 1, strikeouts: 1, levelIndex: 2, atBatLog: ['HOMERUN', 'HOMERUN', 'HOMERUN', 'SINGLE', 'SINGLE'] });
    assert.deepEqual(earnedTitles(big, CONFIG), ['slugger', 'lv3', 'streak']);
    assert.deepEqual(earnedTitles(Object.assign({}, big, { levelIndex: 1 }), CONFIG), ['slugger', 'streak']);
    assert.deepEqual(earnedTitles(Object.assign({}, big, { mode: 'challenge' }), CONFIG), []);
  });
  test('칭호 저장: 새로 얻은 것만 newTitles, 중복 없음, 모르는 id 버림, 병합은 합집합', () => {
    let r = S.ensurePlayer(S.defaultRecord(), '가').record;
    let a = S.applyGameResult(r, { playerKey: '가', levelIndex: 0, hits: 3, atBats: 10, mode: 'normal', date: '2026-11-13', titles: ['contact', 'zzz'] });
    assert.deepEqual(a.newTitles, ['contact']);
    a = S.applyGameResult(a.record, { playerKey: '가', levelIndex: 0, hits: 3, atBats: 10, mode: 'normal', date: '2026-11-13', titles: ['contact', 'slugger'] });
    assert.deepEqual(a.newTitles, ['slugger']);
    assert.deepEqual(a.record.players['가'].titles, ['slugger', 'contact']); // 귀한 순
    assert.equal(S.topTitle(a.record.players['가']).id, 'slugger');
    const c = S.applyGameResult(a.record, { playerKey: '가', levelIndex: 0, hits: 3, atBats: 10, mode: 'challenge', date: '2026-11-13', titles: ['perfect'] });
    assert.deepEqual(c.newTitles, []);
    assert.deepEqual(S.normalizeRecord({ v: 2, players: { x: { name: 'x', titles: ['eye', 'nope', 'eye'] } } }).players.x.titles, ['eye']);
    const other = S.ensurePlayer(S.defaultRecord(), '가').record;
    other.players['가'].titles = ['eye'];
    assert.deepEqual(S.mergeRecords(a.record, other).players['가'].titles, ['slugger', 'eye', 'contact']);
    const bad = JSON.parse(S.exportRecord(a.record));
    bad.players['가'].titles = 'slugger';
    assert.equal(S.validateRecord(bad), null);
    assert.equal(S.topTitle(S.defaultPlayer('나')), null);
  });
  test('타자 유리(볼 3개): 좋음 구간이 BALL.advantageGood로 넓어짐, 확률표는 그대로', () => {
    const d = (CONFIG.JUDGE.timing.good + CONFIG.BALL.advantageGood) / 2;
    assert.equal(timingGrade(d, CONFIG), 'BAD');
    assert.equal(timingGrade(d, CONFIG, CONFIG.BALL.advantageGood), 'GOOD');
    const lv = CONFIG.LEVELS[0];
    const a = judge({ cell: { row: 1, col: 1 }, deltaSec: d }, { row: 1, col: 1 }, lv, createRng(5), CONFIG, { advantage: true });
    assert.equal(a.timing, 'GOOD');
    const b = judge({ cell: { row: 1, col: 1 }, deltaSec: d }, { row: 1, col: 1 }, lv, createRng(5), CONFIG);
    assert.equal(b.timing, 'BAD');
  });
  test('게임: 볼 3개면 advantage, 판정 함수에 전달', () => {
    const seen = [];
    const g = createGame({
      levelIndex: 0, pitchSeed: 1, judgeSeed: 2,
      judgeFn: (click, cell, level, rng, cfg, ctx) => {
        seen.push(ctx.advantage);
        return seen.length <= 3 ? { result: 'BALL', timing: 'NONE' } : { result: 'SINGLE', timing: 'GOOD' };
      },
    });
    for (let i = 0; i < 4; i++) playPitch(g);
    assert.deepEqual(seen, [false, false, false, true]);
  });
}

section('챌린지 연속 참여');
{
  const play = (rec, date, mission, hits) =>
    S.applyGameResult(rec, { playerKey: '가', levelIndex: 1, hits: hits == null ? 3 : hits, atBats: 10, mode: 'challenge', date, missionDone: !!mission }).record;
  const fresh = () => S.ensurePlayer(S.defaultRecord(), '가').record;
  test('날짜 계산: 월말·연말·윤년', () => {
    assert.equal(S.prevDate('2026-03-01'), '2026-02-28');
    assert.equal(S.prevDate('2028-03-01'), '2028-02-29');
    assert.equal(S.prevDate('2027-01-01'), '2026-12-31');
    assert.equal(S.shiftDate('2026-12-31', 1), '2027-01-01');
  });
  test('연속: 어제 했으면 +1, 하루 빠지면 1부터, 같은 날 재도전은 그대로', () => {
    let r = play(fresh(), '2026-12-30');
    r = play(r, '2026-12-31', true);
    r = play(r, '2027-01-01');
    let p = r.players['가'];
    assert.equal(p.streak, 3);
    assert.equal(S.currentStreak(p, '2027-01-01'), 3);
    assert.equal(S.currentStreak(p, '2027-01-02'), 3); // 아직 오늘 안 해도 이어지는 중
    assert.equal(S.currentStreak(p, '2027-01-03'), 0); // 끊김
    r = play(r, '2027-01-01', false, 9); // 연습 판
    assert.equal(r.players['가'].streak, 3);
    r = play(r, '2027-01-03');
    p = r.players['가'];
    assert.equal(p.streak, 1);
    assert.equal(p.streakBest, 3);
    assert.deepEqual(p.dailyLog.map((e) => [e.date, e.mission]), [['2026-12-30', false], ['2026-12-31', true], ['2027-01-01', false], ['2027-01-03', false]]);
    assert.equal(p.dailyLog[2].avg, 0.3); // 연습 판은 기록 안 됨
  });
  test('최근 기록은 logDays개만, 최근 7일 칸', () => {
    let r = fresh();
    for (let d = 1; d <= 10; d++) r = play(r, '2026-11-' + String(d).padStart(2, '0'), d % 2 === 0);
    const p = r.players['가'];
    assert.equal(p.dailyLog.length, CONFIG.CHALLENGE.logDays);
    assert.equal(p.dailyLog[0].date, '2026-11-04');
    const days = S.recentDays(p, '2026-11-12', 7);
    assert.deepEqual(days.map((d) => d.date.slice(8)), ['06', '07', '08', '09', '10', '11', '12']);
    assert.deepEqual(days.map((d) => (d.entry ? (d.entry.mission ? 'M' : 'P') : '-')).join(''), 'MPMPM--');
  });
  test('이전 저장본(daily만 있음)은 1일로, 잘못된 값 검증, 병합', () => {
    const old = S.normalizeRecord({ v: 2, players: { 가: { name: '가', daily: { date: '2026-11-12', avg: 0.4, mission: true } } } });
    assert.equal(old.players['가'].streak, 1);
    assert.deepEqual(old.players['가'].dailyLog, [{ date: '2026-11-12', avg: 0.4, mission: true }]);
    assert.equal(S.currentStreak(old.players['가'], '2026-11-13'), 1);
    const bad = JSON.parse(S.exportRecord(old));
    bad.players['가'].dailyLog = [{ date: 'x', avg: 0.1 }];
    assert.equal(S.validateRecord(bad), null);
    bad.players['가'].dailyLog = [];
    bad.players['가'].streak = -1;
    assert.equal(S.validateRecord(bad), null);
    // 병합: 마지막 공식 판이 늦은 쪽의 연속, 최근 기록은 합침, 최고 연속은 큰 값
    let a = play(play(fresh(), '2026-11-01'), '2026-11-02'); // 연속 2
    let b = play(play(play(fresh(), '2026-11-08'), '2026-11-09'), '2026-11-10'); // 연속 3
    b.players['가'].streakBest = 5;
    const m = S.mergeRecords(a, b).players['가'];
    assert.equal(m.streak, 3);
    assert.equal(m.streakBest, 5);
    assert.deepEqual(m.dailyLog.map((e) => e.date.slice(8)), ['01', '02', '08', '09', '10']);
    assert.equal(S.mergeRecords(b, a).players['가'].streak, 3);
  });
}

section('도전 모드');
{
  const { modeSetup, pitcherLevel, challengeSetup } = require('../js/game.js');
  const modeGame = (modeId, results, opts) => {
    const s = modeSetup(modeId, opts, CONFIG);
    return createGame({ levelIndex: s.levelIndex, level: s.level, mode: s.mode, rules: s.rules, modeName: s.modeName, bossId: s.bossId, pitchSeed: 1, judgeSeed: 2, judgeFn: scriptedJudge(results) });
  };
  const playAtBat = (g) => {
    let last;
    do last = playPitch(g);
    while (!last.atBatEnded && g.phase !== 'GAME_OVER');
    return last;
  };
  test('서바이벌: 범타·삼진 3개면 끝, 안타는 아웃 아님, 점수 = 안타, 타석마다 구속 상승', () => {
    const g = modeGame('survival', ['SINGLE', 'OUT_BIP', 'DOUBLE', 'SWING_MISS', 'SWING_MISS', 'SWING_MISS', 'HOMERUN', 'OUT_BIP']);
    const speeds = [];
    for (let i = 0; i < 6; i++) {
      runUntil(g, (x) => x.phase === 'PITCH_FLIGHT' || x.phase === 'GAME_OVER');
      if (g.phase === 'GAME_OVER') break;
      speeds.push(g.speedBonus());
      playAtBat(g);
    }
    assert.equal(g.phase, 'GAME_OVER');
    assert.deepEqual(speeds, [0, 1, 2, 3, 4, 5]);
    const s = g.summary();
    assert.equal(s.score, 3);
    assert.equal(s.modeOuts, 3);
    assert.equal(s.atBats, 6);
    assert.equal(s.avg, 0.5);
    assert.deepEqual(s.titles, []); // 도전 모드는 칭호 없음
  });
  test('서바이벌 구속 가산은 speedMax까지, 투구 구속에 반영', () => {
    const g = modeGame('survival', []);
    g.atBat = 100;
    assert.equal(g.speedBonus(), CONFIG.MODES.survival.speedMax);
    const base = createPitcher(g.level, createRng(9), CONFIG).nextPitch();
    const fast = createPitcher(g.level, createRng(9), CONFIG).nextPitch({ speedBonus: 7 });
    assert.equal(fast.speed - base.speed, 7);
    assert.ok(fast.flightSec < base.flightSec);
    assert.deepEqual(fast.cell, base.cell); // 난수 순서는 그대로
  });
  test('홈런 더비: 홈런이 아닌 타석 종료는 모두 아웃, 볼 없음, 빠른 공만', () => {
    const results = ['HOMERUN', 'SINGLE'].concat(new Array(9).fill('OUT_BIP'));
    const g = modeGame('derby', results);
    for (let i = 0; i < 11 && g.phase !== 'GAME_OVER'; i++) playAtBat(g);
    runUntil(g, (x) => x.phase === 'GAME_OVER');
    const s = g.summary();
    assert.equal(s.score, 1);
    assert.equal(s.modeOuts, 10);
    assert.equal(s.atBats, 11);
    const p = createPitcher(g.level, createRng(3), CONFIG);
    for (let i = 0; i < 300; i++) {
      const x = p.nextPitch();
      assert.ok(!x.ball && (x.type === '직구' || x.type === '투심'));
    }
  });
  test('보스 투수: 챌린지 투수 값을 바탕 레벨에 덮어씀, 10타석, 모르는 보스는 오류', () => {
    const s = modeSetup('boss', { bossId: 'curve' }, CONFIG);
    const base = CONFIG.LEVELS[CONFIG.MODES.boss.level - 1];
    assert.equal(s.level.baseSpeed, 148);
    assert.equal(s.level.revealSec, base.revealSec);
    assert.equal(s.level.ai, base.ai);
    assert.equal(s.level.title, '커브볼러');
    assert.equal(s.level.id, base.id); // 투수 id가 레벨 id를 덮지 않음
    assert.throws(() => modeSetup('boss', { bossId: 'classic' }, CONFIG));
    const g = modeGame('boss', new Array(10).fill('OUT_BIP'), { bossId: 'curve' });
    for (let i = 0; i < 10; i++) playAtBat(g);
    runUntil(g, (x) => x.phase === 'GAME_OVER');
    assert.equal(g.summary().atBats, 10);
    // 챌린지 구성도 같은 함수를 씀
    const ch = challengeSetup('2026-11-13', CONFIG);
    assert.deepEqual(ch.level, pitcherLevel(CONFIG.LEVELS[CONFIG.CHALLENGE.level - 1], ch.pitcher));
  });
  test('연습: 카운트·타석 없이 계속, GAME_OVER 없음, 구종·볼 선택', () => {
    const g = modeGame('practice', new Array(40).fill('SWING_MISS').concat(['SINGLE']), { levelIndex: 2, type: '커브', balls: false });
    for (let i = 0; i < 41; i++) playPitch(g);
    assert.equal(g.phase === 'GAME_OVER', false);
    assert.equal(g.atBat, 1);
    assert.equal(g.strikes, 0);
    assert.equal(g.stats.hits, 1);
    assert.equal(g.history.length, 41);
    assert.ok(g.history.every((h) => h.type === '커브'));
    assert.equal(g.level.baseSpeed, CONFIG.LEVELS[2].baseSpeed);
    const all = modeSetup('practice', { levelIndex: 0, type: null, balls: true }, CONFIG);
    assert.deepEqual(all.level.pitchMix, CONFIG.LEVELS[0].pitchMix);
    assert.equal(all.level.ballRate, CONFIG.LEVELS[0].ballRate);
  });
  test('도전 모드 기록: 최고 점수·보스별 최고 타율만, 통산·해제 영향 없음, 검증·병합', () => {
    let r = S.ensurePlayer(S.defaultRecord(), '가').record;
    let a = S.applyGameResult(r, { playerKey: '가', levelIndex: 1, hits: 7, atBats: 9, mode: 'survival', score: 7 });
    assert.equal(a.newRecord, true);
    assert.equal(a.prevBest, null);
    a = S.applyGameResult(a.record, { playerKey: '가', levelIndex: 1, hits: 5, atBats: 8, mode: 'survival', score: 5 });
    assert.equal(a.newRecord, false);
    assert.equal(a.prevBest, 7);
    a = S.applyGameResult(a.record, { playerKey: '가', levelIndex: 0, hits: 4, atBats: 14, mode: 'derby', score: 4 });
    a = S.applyGameResult(a.record, { playerKey: '가', levelIndex: 2, hits: 6, atBats: 10, mode: 'boss', bossId: 'wild' });
    const p = a.record.players['가'];
    assert.deepEqual(p.modes, { survival: 7, derby: 4 });
    assert.deepEqual(p.boss, { wild: 0.6 });
    assert.equal(p.atBats, 0);
    assert.deepEqual(p.unlocked, [true, false, false]);
    assert.equal(p.games, 4);
    assert.throws(() => S.applyGameResult(a.record, { playerKey: '가', levelIndex: 2, hits: 1, atBats: 10, mode: 'boss', bossId: 'nope' }));
    const n = S.normalizeRecord({ v: 2, players: { x: { name: 'x', modes: { survival: 3, derby: -1, foo: 2 }, boss: { curve: 0.3, nope: 0.5, wild: 2 } } } }).players.x;
    assert.deepEqual(n.modes, { survival: 3, derby: null });
    assert.deepEqual(n.boss, { curve: 0.3 });
    const bad = JSON.parse(S.exportRecord(a.record));
    bad.players['가'].boss.wild = 'x';
    assert.equal(S.validateRecord(bad), null);
    const other = S.ensurePlayer(S.defaultRecord(), '가').record;
    other.players['가'].modes.survival = 9;
    other.players['가'].boss = { wild: 0.4, curve: 0.5 };
    const m = S.mergeRecords(a.record, other).players['가'];
    assert.deepEqual(m.modes, { survival: 9, derby: 4 });
    assert.deepEqual(m.boss, { wild: 0.6, curve: 0.5 });
  });
}

section('3루타');
test('3루타: 안타로 집계, 장타 미션에 포함, 2루타 몫에서 떼어 와 안타 합계는 그대로', () => {
  const g = newGame(['TRIPLE']);
  playPitch(g);
  assert.equal(g.stats.hits, 1);
  assert.equal(g.stats.triples, 1);
  assert.deepEqual(g.atBatLog, ['TRIPLE']);
  const { missionProgress } = require('../js/game.js');
  assert.equal(missionProgress({ stat: 'extraBases', min: 2 }, Object.assign({}, g.stats, { doubles: 1 }), g.atBatLog, false).done, true);
  const hitSum = (t) => ['HOMERUN', 'TRIPLE', 'DOUBLE', 'SINGLE'].reduce((a, k) => a + (t[k] || 0), 0);
  assert.equal(hitSum(CONFIG.JUDGE.exact.PERFECT), 80);
  assert.equal(hitSum(CONFIG.JUDGE.exact.GOOD), 55);
  assert.ok(CONFIG.JUDGE.exact.PERFECT.TRIPLE > 0 && CONFIG.JUDGE.exact.PERFECT.TRIPLE < CONFIG.JUDGE.exact.PERFECT.DOUBLE);
});

section('연습 코스 고정');
{
  const { modeSetup } = require('../js/game.js');
  const throwMany = (opts, n = 600) => {
    const p = createPitcher(modeSetup('practice', opts, CONFIG).level, createRng(31), CONFIG);
    const out = [];
    for (let i = 0; i < n; i++) out.push(p.nextPitch());
    return out;
  };
  test('높이만 고르면 그 줄, 좌우도 고르면 한 칸, 안 고르면 전체', () => {
    assert.deepEqual(modeSetup('practice', { row: 2 }, CONFIG).level.cells, [6, 7, 8]);
    assert.deepEqual(modeSetup('practice', { col: 0 }, CONFIG).level.cells, [0, 3, 6]);
    assert.deepEqual(modeSetup('practice', { row: 2, col: 0 }, CONFIG).level.cells, [6]);
    assert.equal(modeSetup('practice', { row: null, col: null }, CONFIG).level.cells, undefined);
    const low = throwMany({ levelIndex: 2, row: 2, balls: false });
    assert.ok(low.every((x) => x.cell.row === 2));
    assert.equal(new Set(low.map((x) => x.cell.col)).size, 3);
    assert.ok(throwMany({ levelIndex: 1, row: 0, col: 2, balls: false }).every((x) => x.cell.row === 0 && x.cell.col === 2));
  });
  test('볼은 고정한 칸과 맞닿은 자리로만, 가운데 칸만 고르면 볼 없음', () => {
    const low = throwMany({ levelIndex: 1, row: 2, balls: true }, 2000);
    const balls = low.filter((x) => x.ball);
    assert.ok(balls.length > 300);
    assert.ok(balls.every((x) => x.cell.row >= 2), '아래 줄 옆·아래의 볼만');
    assert.ok(balls.some((x) => x.cell.row === 3) && balls.some((x) => x.cell.col === -1 || x.cell.col === 3));
    assert.ok(low.filter((x) => !x.ball).every((x) => x.cell.row === 2));
    assert.ok(throwMany({ levelIndex: 1, row: 1, col: 1, balls: true }).every((x) => !x.ball && x.cell.row === 1 && x.cell.col === 1));
  });
}

section('수싸움 (카운트를 보는 투수)');
{
  const { modeSetup, challengeSetup } = require('../js/game.js');
  const { seqBallRate, seqPitchMix } = require('../js/pitcher.js');
  const ballShare = (level, count, n = 20000) => {
    const p = createPitcher(level, createRng(11), CONFIG);
    let balls = 0;
    for (let i = 0; i < n; i++) if (p.nextPitch({ count }).ball) balls++;
    return balls / n;
  };
  test('2스트라이크면 볼(유인구)이 늘고, 초구는 줄어듦 (Lv.3 통계)', () => {
    const lv = CONFIG.LEVELS[2];
    const s = lv.sequencing;
    const mid = ballShare(lv, { balls: 1, strikes: 1 });
    const two = ballShare(lv, { balls: 1, strikes: 2 });
    const first = ballShare(lv, { balls: 0, strikes: 0 });
    assert.ok(Math.abs(mid - lv.ballRate) < 0.015, 'mid ' + mid);
    assert.ok(Math.abs(two - lv.ballRate * s.twoStrikeBallMult) < 0.015, 'two ' + two);
    assert.ok(Math.abs(first - lv.ballRate * s.firstPitchBallMult) < 0.015, 'first ' + first);
    assert.equal(seqBallRate(CONFIG.LEVELS[0], { balls: 0, strikes: 2 }), CONFIG.LEVELS[0].ballRate); // Lv.1은 수싸움 없음
  });
  test('직구·투심 다음에는 변화구 가중치가 오름', () => {
    const lv = CONFIG.LEVELS[2];
    const after = seqPitchMix(lv, '직구');
    assert.equal(after['직구'], lv.pitchMix['직구']);
    assert.equal(after['커브'], lv.pitchMix['커브'] * lv.sequencing.afterFastballOffspeed);
    assert.equal(seqPitchMix(lv, '커브'), lv.pitchMix);
    // 통계: 직구 다음 변화구 비율 > 변화구 다음 변화구 비율
    const p = createPitcher(lv, createRng(21), CONFIG);
    const tally = { fast: [0, 0], off: [0, 0] };
    let prev = null;
    for (let i = 0; i < 30000; i++) {
      const t = p.nextPitch().type;
      if (prev) {
        const k = prev === '직구' || prev === '투심' ? 'fast' : 'off';
        tally[k][0]++;
        if (t !== '직구' && t !== '투심') tally[k][1]++;
      }
      prev = t;
    }
    assert.ok(tally.fast[1] / tally.fast[0] > tally.off[1] / tally.off[0] + 0.05, JSON.stringify(tally));
  });
  test('챌린지·보스·연습에는 수싸움 없음 (같은 날 같은 투구 순서)', () => {
    assert.equal(challengeSetup('2026-11-13', CONFIG).level.sequencing, undefined);
    assert.equal(modeSetup('boss', { bossId: 'power' }, CONFIG).level.sequencing, undefined);
    assert.equal(modeSetup('practice', { levelIndex: 2 }, CONFIG).level.sequencing, undefined);
    assert.ok(modeSetup('survival', null, CONFIG).level.sequencing); // 서바이벌은 있음
  });
  test('수싸움이 있어도 같은 시드·같은 카운트면 같은 투구 (난수 순서 유지)', () => {
    const lv = CONFIG.LEVELS[2];
    const a = createPitcher(lv, createRng(5), CONFIG);
    const b = createPitcher(lv, createRng(5), CONFIG);
    for (let i = 0; i < 200; i++) {
      const count = { balls: i % 3, strikes: (i >> 1) % 3 };
      assert.deepEqual(a.nextPitch({ count }), b.nextPitch({ count }));
    }
    // 카운트만 달라도 코스 칸 난수는 같은 자리에서 뽑힘
    const c = createPitcher(lv, createRng(8), CONFIG).nextPitch({ count: { balls: 0, strikes: 0 } });
    const d = createPitcher(lv, createRng(8), CONFIG).nextPitch({ count: { balls: 1, strikes: 2 } });
    assert.equal(c.speed, d.speed);
    assert.equal(c.holdSec, d.holdSec);
  });
}

section('관중 녹음 내장 도구');
// 가짜 mp3: MPEG1 Layer III 128kbps 44.1kHz 프레임(417바이트, 0.0261초)을 n개, 앞에 ID3 태그
function fakeMp3(n, withId3) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = Buffer.alloc(417, i % 251);
    f[0] = 0xff;
    f[1] = 0xfb;
    f[2] = 0x90;
    f[3] = 0x00;
    frames.push(f);
  }
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)]);
  return Buffer.concat(withId3 ? [id3, ...frames] : frames);
}
test('trimMp3: ID3 태그를 빼고 프레임 단위로 구간만 남김', () => {
  const { trimMp3, mp3Frames } = require('../tools/trim-audio.js');
  const src = fakeMp3(200, true); // 약 5.22초
  assert.equal(mp3Frames(src).length, 200);
  const r = trimMp3(src, 1, 1);
  const fd = 1152 / 44100;
  assert.ok(Math.abs(r.total - 200 * fd) < 1e-9);
  assert.ok(r.start <= 1 && r.start > 1 - fd, '시작은 1초를 덮는 프레임');
  assert.ok(r.start + r.duration >= 2 && r.duration < 1 + 2 * fd + 1e-9);
  assert.equal(r.buf.length % 417, 0);
  assert.equal(r.buf[0], 0xff, '맨 앞이 바로 프레임(ID3 제거)');
  assert.equal(mp3Frames(r.buf).length, r.buf.length / 417);
  assert.equal(trimMp3(src, 0, null).buf.length, 200 * 417, '길이 미지정이면 끝까지');
  assert.throws(() => trimMp3(src, 10, 1), /벗어났습니다/);
});
test('embed-sounds: 슬롯 이름 파일만 설정 구간으로 잘라 내장, base64 왕복, 같은 슬롯 중복은 오류', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const vm = require('vm');
  const { embed } = require('../tools/embed-sounds.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-snd-'));
  const load = (file) => {
    const sandbox = {};
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { globalThis: sandbox });
    return sandbox.BB.SOUND_DATA;
  };
  try {
    const mp3 = fakeMp3(200, false);
    fs.writeFileSync(path.join(dir, 'Cheer.mp3'), mp3); // 대소문자 무시
    fs.writeFileSync(path.join(dir, 'random.mp3'), mp3); // 슬롯 아님 → 무시
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x'); // 음원 아님 → 무시
    const out = path.join(dir, 'data.js');
    // 구간 지정: 2초부터 1초 → 내장 데이터의 start는 약 2초, 크기는 원본보다 작음
    const r = embed(dir, out, { cheer: { offset: 2, dur: 1 } });
    assert.deepEqual(Object.keys(r.found), ['cheer']);
    let d = load(out);
    assert.deepEqual(Object.keys(d), ['cheer']);
    assert.equal(d.cheer.mime, 'audio/mpeg');
    assert.ok(Math.abs(d.cheer.start - 2) < 0.03);
    assert.ok(Buffer.from(d.cheer.b64, 'base64').length < mp3.length / 3);
    // 구간 설정이 없으면 전체를 그대로
    embed(dir, out, {});
    d = load(out);
    assert.deepEqual(Buffer.from(d.cheer.b64, 'base64'), mp3);
    assert.equal(d.cheer.start, 0);
    // 파일이 없으면 빈 데이터
    fs.rmSync(path.join(dir, 'Cheer.mp3'));
    embed(dir, out, {});
    assert.deepEqual(Object.keys(load(out)), []);
    // 같은 슬롯 두 개 → 오류
    fs.writeFileSync(path.join(dir, 'groan.mp3'), mp3);
    fs.writeFileSync(path.join(dir, 'groan.wav'), mp3);
    assert.throws(() => embed(dir, out, {}), /두 개 이상/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


section('PWA');
test('서비스 워커 캐시 목록: index.html이 쓰는 파일·매니페스트·아이콘을 모두 포함, 실제 파일 존재, 모두 상대경로', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const assets = JSON.parse(sw.slice(sw.indexOf('[', sw.indexOf('const ASSETS')), sw.indexOf('];', sw.indexOf('const ASSETS')) + 1).replace(/'/g, '"').replace(/,\s*]/, ']'));
  assert.ok(/const CACHE = 'bbgame-v\d+'/.test(sw), '캐시 이름에 버전');
  const norm = (p) => './' + p.replace(/^\.\//, '');
  // index.html이 불러오는 파일
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 10);
  for (const r of refs) {
    assert.ok(!r.startsWith('/') && !/^https?:/.test(r), '상대경로가 아님: ' + r);
    assert.ok(assets.includes(norm(r)), '캐시 목록에 없음: ' + r);
  }
  // 매니페스트
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((i) => i.sizes + ':' + i.purpose);
  assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'));
  for (const ic of manifest.icons) assert.ok(assets.includes(norm(ic.src)), '아이콘이 캐시 목록에 없음: ' + ic.src);
  // 목록의 파일이 모두 존재 (./ 는 index.html)
  for (const a of assets) {
    if (a === './') continue;
    assert.ok(fs.existsSync(path.join(root, a)), '파일 없음: ' + a);
  }
  assert.ok(fs.existsSync(path.join(root, '.nojekyll')), 'GitHub Pages용 .nojekyll');
});
test('아이콘 PNG: 서명·크기·CRC가 올바름', () => {
  const fs = require('fs');
  const path = require('path');
  const zlib = require('zlib');
  const { crc32, ICONS } = require('../tools/make-icons.js');
  for (const ic of ICONS) {
    const b = fs.readFileSync(path.join(__dirname, '..', 'icons', ic.file));
    assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(b.readUInt32BE(16), ic.size);
    assert.equal(b.readUInt32BE(20), ic.size);
    // 모든 청크의 CRC 확인 + 압축 해제한 크기
    let pos = 8;
    let idat = [];
    while (pos < b.length) {
      const len = b.readUInt32BE(pos);
      const type = b.toString('latin1', pos + 4, pos + 8);
      assert.equal(b.readUInt32BE(pos + 8 + len), crc32(b.subarray(pos + 4, pos + 8 + len)), ic.file + ' ' + type + ' CRC');
      if (type === 'IDAT') idat.push(b.subarray(pos + 8, pos + 8 + len));
      pos += 12 + len;
    }
    assert.equal(zlib.inflateSync(Buffer.concat(idat)).length, (ic.size * 4 + 1) * ic.size);
  }
});

section('문법 검사');
test('브라우저용 js 파일이 모두 문법 오류 없이 읽힘 (main.js 등 DOM 파일 포함)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const dir = path.join(__dirname, '..', 'js');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
  files.push(path.join(__dirname, '..', 'sw.js'));
  for (const f of files) {
    try {
      new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
    } catch (e) {
      throw new Error(path.basename(f) + ': ' + e.message);
    }
  }
});

console.log(`\n${passed} 통과, ${failed} 실패`);
process.exitCode = failed ? 1 : 0;
