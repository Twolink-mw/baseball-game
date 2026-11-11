// 난이도 시뮬레이션 (SPEC 12.2): node tests/sim.js [게임 수]
// 실제 게임 상태 머신(createGame)·투수 AI·판정을 그대로 쓰고, 클릭 칸과 시각만 봇이 정한다.
'use strict';

const { CONFIG } = require('../js/config.js');
const { createRng } = require('../js/rng.js');
const { createGame, formatAvg } = require('../js/game.js');

const GAMES = Number(process.argv[2]) || 1000;
const C = CONFIG;

// 표준정규분포 (Box-Muller), 봇 전용 RNG 사용
function gauss(rng, mean, sd) {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clampCell = (x) => Math.max(0, Math.min(2, x));

// 각 봇: (게임, 봇 RNG) → { cell, atTime } 또는 null(스윙 안 함). 비행 시작 시점에 한 번 호출
const BOTS = {
  무작위(g, rng) {
    const cell = { row: rng.int(3), col: rng.int(3) };
    const atTime = g.releaseTime + rng.next() * (g.arrivalTime + C.GRACE_SEC - g.releaseTime);
    return { cell, atTime };
  },
  가운데만(g, rng) {
    return { cell: { row: 1, col: 1 }, atTime: g.arrivalTime + gauss(rng, 0, 0.05) };
  },
  '반응 지연'(g, rng) {
    const revealAt = g.arrivalTime - g.pitch.revealSec;
    const earliest = revealAt + Math.max(0.1, gauss(rng, 0.25, 0.05)) + 0.15;
    const atTime = Math.max(earliest, g.arrivalTime + gauss(rng, 0, 0.05));
    if (atTime > g.arrivalTime + C.GRACE_SEC) return null; // 늦어서 못 침
    let cell = g.pitch.cell;
    if (g.pitch.ball) {
      // 볼은 대부분 골라냄. 가끔(15%) 볼 쪽 가장자리 칸으로 따라 나감
      if (rng.next() >= 0.15) return null;
      return { cell: { row: clampCell(cell.row), col: clampCell(cell.col) }, atTime };
    }
    if (rng.next() < 0.05) {
      // 상하좌우 인접 칸을 잘못 누름
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dr, dc]) => clampCell(cell.row + dr) === cell.row + dr && clampCell(cell.col + dc) === cell.col + dc);
      const [dr, dc] = dirs[rng.int(dirs.length)];
      cell = { row: cell.row + dr, col: cell.col + dc };
    }
    return { cell, atTime };
  },
};

function playGame(levelIndex, bot, seed) {
  const g = createGame({ levelIndex, mode: 'normal', pitchSeed: seed * 2 + 1, judgeSeed: seed * 2 + 2 });
  const rng = createRng(seed * 7 + 3);
  let swungFor = -1;
  for (let guard = 0; g.phase !== 'GAME_OVER' && guard < 200000; guard++) {
    if (g.phase === 'PITCH_FLIGHT' && swungFor !== g.totalPitches) {
      swungFor = g.totalPitches;
      const c = bot(g, rng);
      if (c) g.input(c.cell, c.atTime);
    }
    g.update(C.MAX_DT);
  }
  return g.summary();
}

function run() {
  const rows = [];
  const t0 = Date.now();
  for (const [name, bot] of Object.entries(BOTS)) {
    const row = { name, avg: [], unlock: [], perfect: [] };
    C.LEVELS.forEach((lv, li) => {
      let hits = 0;
      let unlocks = 0;
      let perfects = 0;
      let pitches = 0;
      for (let i = 0; i < GAMES; i++) {
        const s = playGame(li, bot, 100000 * (li + 1) + i);
        hits += s.hits;
        perfects += s.perfects;
        pitches += s.totalPitches;
        if (li < C.UNLOCK_AVG.length && s.avg >= C.UNLOCK_AVG[li]) unlocks++;
      }
      row.avg.push(hits / (GAMES * C.AT_BATS_PER_GAME));
      row.unlock.push(li < C.UNLOCK_AVG.length ? unlocks / GAMES : null);
      row.perfect.push(perfects / pitches);
    });
    rows.push(row);
  }

  const pct = (x) => (x === null ? '-' : (x * 100).toFixed(1) + '%');
  console.log(`난이도 시뮬레이션: 봇별 레벨당 ${GAMES}게임 (${((Date.now() - t0) / 1000).toFixed(1)}초)\n`);
  console.log('평균 타율');
  console.log('| 봇 | Lv.1 | Lv.2 | Lv.3 |');
  console.log('|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.name} | ${r.avg.map(formatAvg).join(' | ')} |`);
  console.log('\n다음 레벨 해제 확률 (한 게임에서 기준 타율 이상)');
  console.log(`| 봇 | Lv.1 → Lv.2 (${formatAvg(C.UNLOCK_AVG[0])}) | Lv.2 → Lv.3 (${formatAvg(C.UNLOCK_AVG[1])}) |`);
  console.log('|---|---|---|');
  for (const r of rows) console.log(`| ${r.name} | ${pct(r.unlock[0])} | ${pct(r.unlock[1])} |`);

  // 목표치 확인 (SPEC 12.2)
  const by = Object.fromEntries(rows.map((r) => [r.name, r.avg]));
  const checks = [
    ['무작위 < .100 (모든 레벨)', by['무작위'].every((a) => a < 0.1)],
    ['가운데만 < .200 (모든 레벨)', by['가운데만'].every((a) => a < 0.2)],
    ['반응 지연: Lv.1 ≥ Lv.2 > Lv.3', by['반응 지연'][0] >= by['반응 지연'][1] && by['반응 지연'][1] > by['반응 지연'][2]],
    ['반응 지연: Lv.3 ≥ .450', by['반응 지연'][2] >= 0.45],
  ];
  console.log('\n목표치');
  for (const [label, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  return checks.every(([, ok]) => ok);
}

if (require.main === module) process.exitCode = run() ? 0 : 1;
module.exports = { playGame, BOTS };
