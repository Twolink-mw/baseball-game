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
      assert.equal(pitch.revealSec, level.revealSec);
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

console.log(`\n${passed} 통과, ${failed} 실패`);
process.exitCode = failed ? 1 : 0;
