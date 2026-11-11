// 순수 로직 테스트: node tests/run.js
'use strict';
const assert = require('node:assert/strict');
const { CONFIG } = require('../js/config.js');
const { createRng, hashString } = require('../js/rng.js');
const { createPitcher, cellIndex } = require('../js/pitcher.js');
const { cellDistance, timingGrade, judge } = require('../js/judge.js');
const { createGame, formatAvg, challengeSeeds } = require('../js/game.js');
const { defaultRecord, validateRecord, mergeRecords, applyGameResult, normalizeRecord } = require('../js/storage.js');

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

test('미클릭이면 루킹 판정(실제 판정 함수)', () => {
  const g = createGame({ levelIndex: 0, pitchSeed: 3, judgeSeed: 4 });
  runUntil(g, (x) => x.phase === 'RESULT_SHOW');
  assert.equal(g.last.result, 'LOOKING');
  assert.equal(g.strikes, 1);
});

for (const r of ['SINGLE', 'DOUBLE', 'HOMERUN', 'OUT_BIP']) {
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

test('9타석 → GAME_OVER, 타율 = 안타÷9 (홈런·2루타 포함)', () => {
  const g = newGame(['SINGLE', 'DOUBLE', 'HOMERUN', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP', 'OUT_BIP']);
  for (let i = 0; i < 9; i++) playPitch(g);
  assert.equal(g.phase, 'GAME_OVER');
  assert.equal(g.stats.hits, 3);
  assert.equal(g.finalAverage(), 3 / 9);
  assert.equal(formatAvg(g.finalAverage()), '.333');
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

section('투수 AI');
CONFIG.LEVELS.forEach((level, i) => {
  test(level.name + ': 비행 시간 공식, 공개 시간, 구속 범위', () => {
    const p = createPitcher(level, createRng(300 + i));
    for (let k = 0; k < 500; k++) {
      const pitch = p.nextPitch();
      assert.equal(pitch.revealSec, level.revealSec);
      assert.ok(Math.abs(pitch.flightSec - level.flightSec * (level.baseSpeed / pitch.speed)) < 1e-12);
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
  for (let k = 0; k < N; k++) counts[cellIndex(p.nextPitch().cell)]++;
  for (const c of counts) assert.ok(Math.abs(c / N - 1 / 9) < 0.015);
});

test('adaptive: 클릭이 몰린 칸을 덜 던짐', () => {
  const p = createPitcher(CONFIG.LEVELS[2], createRng(8));
  const counts = new Array(9).fill(0);
  const N = 9000;
  for (let k = 0; k < N; k++) {
    counts[cellIndex(p.nextPitch().cell)]++;
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

section('오늘의 챌린지');
function pitchesOf(results, seeds) {
  const g = createGame(Object.assign({ levelIndex: CONFIG.CHALLENGE.level - 1, mode: 'challenge', judgeFn: scriptedJudge(results) }, seeds));
  while (g.phase !== 'GAME_OVER') playPitch(g);
  return g.pitchLog.map((p) => [p.cell.row, p.cell.col, p.type, p.speed].join());
}
test('같은 날짜면 판정과 관계없이 투구 순서가 같음', () => {
  const seeds = challengeSeeds('2026-11-11');
  const a = pitchesOf(new Array(9).fill('SINGLE'), seeds);
  const b = pitchesOf(new Array(27).fill('SWING_MISS'), seeds);
  assert.equal(a.length, 9);
  assert.deepEqual(b.slice(0, 9), a);
});
test('다른 날짜면 투구 순서가 다름', () => {
  const a = pitchesOf(new Array(9).fill('SINGLE'), challengeSeeds('2026-11-11'));
  const b = pitchesOf(new Array(9).fill('SINGLE'), challengeSeeds('2026-11-12'));
  assert.notDeepEqual(a, b);
});
test('문자열 해시는 결정적', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

section('잠금 해제와 기록');
test('.300 미만이면 다음 레벨 잠김', () => {
  const { record, unlockedLevel } = applyGameResult(defaultRecord(), { levelIndex: 0, avg: 2 / 9, mode: 'normal' });
  assert.equal(record.unlocked[1], false);
  assert.equal(unlockedLevel, null);
});
test('.300 이상이면 해제, 이후 낮은 타율이어도 유지', () => {
  let r = applyGameResult(defaultRecord(), { levelIndex: 0, avg: 3 / 9, mode: 'normal' });
  assert.equal(r.record.unlocked[1], true);
  assert.equal(r.unlockedLevel, 1);
  r = applyGameResult(r.record, { levelIndex: 0, avg: 0, mode: 'normal' });
  assert.equal(r.record.unlocked[1], true);
  assert.equal(r.unlockedLevel, null);
});
test('최고 타율은 갱신 시에만 변경', () => {
  let r = applyGameResult(defaultRecord(), { levelIndex: 0, avg: 4 / 9, mode: 'normal' });
  assert.equal(r.newRecord, true);
  r = applyGameResult(r.record, { levelIndex: 0, avg: 2 / 9, mode: 'normal' });
  assert.equal(r.newRecord, false);
  assert.equal(r.record.best[0], 4 / 9);
  r = applyGameResult(r.record, { levelIndex: 0, avg: 4 / 9, mode: 'normal' });
  assert.equal(r.newRecord, false);
  r = applyGameResult(r.record, { levelIndex: 0, avg: 5 / 9, mode: 'normal' });
  assert.equal(r.record.best[0], 5 / 9);
});
test('챌린지는 해제/최고 타율에 영향 없음, 그날 첫 판만 기록', () => {
  let r = applyGameResult(defaultRecord(), { levelIndex: 1, avg: 1, mode: 'challenge', date: '2026-11-11' });
  assert.equal(r.official, true);
  assert.deepEqual(r.record.unlocked, [true, false, false]);
  assert.deepEqual(r.record.best, [null, null, null]);
  assert.deepEqual(r.record.daily, { date: '2026-11-11', avg: 1 });
  r = applyGameResult(r.record, { levelIndex: 1, avg: 0, mode: 'challenge', date: '2026-11-11' });
  assert.equal(r.official, false);
  assert.equal(r.record.daily.avg, 1);
  r = applyGameResult(r.record, { levelIndex: 1, avg: 0, mode: 'challenge', date: '2026-11-12' });
  assert.equal(r.official, true);
  assert.deepEqual(r.record.daily, { date: '2026-11-12', avg: 0 });
});

section('저장 검증/병합');
test('validateRecord: 잘못된 형식 거부', () => {
  assert.equal(validateRecord(null), null);
  assert.equal(validateRecord('x'), null);
  assert.equal(validateRecord({ v: 2 }), null);
  const ok = defaultRecord();
  assert.notEqual(validateRecord(ok), null);
  assert.equal(validateRecord(Object.assign({}, ok, { unlocked: [true, 'y', false] })), null);
  assert.equal(validateRecord(Object.assign({}, ok, { best: [2, null, null] })), null);
  assert.equal(validateRecord(Object.assign({}, ok, { games: -1 })), null);
  assert.equal(validateRecord(Object.assign({}, ok, { daily: { date: 'nope', avg: 0.1 } })), null);
});
test('normalizeRecord: 깨진 데이터에서 살릴 수 있는 필드만 살림', () => {
  const r = normalizeRecord({ unlocked: [true, true, 'x'], best: [0.5, 'a'], games: 3.5, name: '가나다라마바사아자차' });
  assert.deepEqual(r.unlocked, [true, true, false]);
  assert.deepEqual(r.best, [0.5, null, null]);
  assert.equal(r.games, 0);
  assert.equal(r.name.length, CONFIG.NAME_MAX);
});
test('mergeRecords: 최고 타율 큰 값, 해제 OR, games 큰 값, daily 늦은 날짜, 이름/설정 유지', () => {
  const a = Object.assign(defaultRecord(), {
    name: 'A', unlocked: [true, true, false], best: [0.333, null, null], games: 4,
    daily: { date: '2026-11-10', avg: 0.2 }, settings: { muted: true, padSide: 'left' },
  });
  const b = Object.assign(defaultRecord(), {
    name: 'B', unlocked: [true, false, true], best: [0.222, 0.444, null], games: 9,
    daily: { date: '2026-11-11', avg: 0.1 },
  });
  const m = mergeRecords(a, b);
  assert.deepEqual(m.unlocked, [true, true, true]);
  assert.deepEqual(m.best, [0.333, 0.444, null]);
  assert.equal(m.games, 9);
  assert.deepEqual(m.daily, { date: '2026-11-11', avg: 0.1 });
  assert.equal(m.name, 'A');
  assert.deepEqual(m.settings, { muted: true, padSide: 'left' });
});

console.log(`\n${passed} 통과, ${failed} 실패`);
process.exitCode = failed ? 1 : 0;
