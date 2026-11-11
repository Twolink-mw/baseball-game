// 게임 상태 머신, 카운트, 타석/타율 (순수 로직)
// 시간(dt)과 입력({cell, atTime})만 받아 상태를 바꾸고, 렌더러는 상태를 읽어서 그리기만 한다.
(function (global) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const BB = isNode
    ? Object.assign({}, require('./config.js'), require('./rng.js'), require('./pitcher.js'), require('./judge.js'))
    : global.BB;

  const HIT_RESULTS = { HOMERUN: 'homers', DOUBLE: 'doubles', SINGLE: 'singles' };

  function formatAvg(avg) {
    if (avg >= 1) return '1.000';
    return '.' + String(Math.round(avg * 1000)).padStart(3, '0');
  }

  // 챌린지 시드: 같은 날짜면 같은 투구 순서
  function challengeSeeds(dateStr) {
    return {
      pitchSeed: BB.hashString('bbgame-challenge-pitch:' + dateStr),
      judgeSeed: BB.hashString('bbgame-challenge-judge:' + dateStr),
    };
  }

  // opts: { levelIndex, mode: 'normal'|'challenge', pitchSeed, judgeSeed, config?, judgeFn? }
  function createGame(opts) {
    const C = opts.config || BB.CONFIG;
    const level = C.LEVELS[opts.levelIndex];
    const pitchRng = BB.createRng(opts.pitchSeed);
    const judgeRng = BB.createRng(opts.judgeSeed);
    const pitcher = BB.createPitcher(level, pitchRng, C);
    const judgeFn = opts.judgeFn || BB.judge;

    const g = {
      config: C,
      level,
      levelIndex: opts.levelIndex,
      mode: opts.mode || 'normal',
      playerName: opts.playerName || '', // 표시용
      bats: opts.bats === 'L' ? 'L' : 'R', // 표시용: 우타(R) / 좌타(L)
      phase: 'AT_BAT_INTRO',
      time: 0,
      phaseStart: 0,
      paused: false,
      atBat: 1,
      strikes: 0,
      pitchInAtBat: 0,
      totalPitches: 0,
      stats: { hits: 0, singles: 0, doubles: 0, homers: 0, strikeouts: 0, outs: 0, perfects: 0 },
      atBatLog: [], // 타석별 결과
      pitchLog: [], // 던진 투구 순서
      pitch: null,
      windupStart: 0,
      releaseTime: 0,
      arrivalTime: 0,
      click: null,
      last: null, // 직전 판정
      events: [], // 렌더/사운드용 이벤트 큐

      update(dt) {
        if (g.paused || g.phase === 'GAME_OVER') return;
        dt = Math.min(Math.max(dt || 0, 0), C.MAX_DT);
        g.time += dt;
        step();
      },

      // atTime: 게임 시각 기준 입력 시각(생략하면 현재 시각)
      input(cell, atTime) {
        if (g.paused || g.phase !== 'PITCH_FLIGHT' || g.click) return false;
        const t = atTime == null ? g.time : atTime;
        if (t < g.releaseTime) return false; // 와인드업 중 입력
        if (t - g.arrivalTime > C.GRACE_SEC) return false; // 지각
        g.click = { cell: { row: cell.row, col: cell.col }, atTime: t };
        pitcher.recordUserClick(cell);
        g.events.push({ type: 'swing', cell: g.click.cell });
        return true;
      },

      setPaused(p) {
        g.paused = !!p;
      },

      // 공 진행도 (0=릴리스, 1=도착). 비행 중이 아니면 null
      ballProgress() {
        if (!g.pitch) return null;
        if (g.phase !== 'PITCH_FLIGHT') return null;
        return (g.time - g.releaseTime) / g.pitch.flightSec;
      },

      phaseElapsed() {
        return g.time - g.phaseStart;
      },

      currentAverage() {
        const done = g.atBatLog.length;
        return done ? g.stats.hits / done : 0;
      },

      finalAverage() {
        return g.stats.hits / C.AT_BATS_PER_GAME;
      },

      summary() {
        return Object.assign({}, g.stats, {
          avg: g.finalAverage(),
          totalPitches: g.totalPitches,
          levelIndex: g.levelIndex,
          mode: g.mode,
        });
      },

      drainEvents() {
        const e = g.events;
        g.events = [];
        return e;
      },

      // 판정 결과를 카운트에 반영 (테스트에서도 사용)
      applyResult(result, timing) {
        let ended = false;
        let outcome = null;
        let foulCapped = false;
        if (HIT_RESULTS[result]) {
          g.stats.hits++;
          g.stats[HIT_RESULTS[result]]++;
          ended = true;
          outcome = result;
        } else if (result === 'OUT_BIP') {
          g.stats.outs++;
          ended = true;
          outcome = 'OUT_BIP';
        } else if (result === 'FOUL') {
          if (g.pitchInAtBat >= C.MAX_PITCHES_PER_AT_BAT) {
            foulCapped = true;
            result = 'OUT_BIP';
            g.stats.outs++;
            ended = true;
            outcome = 'OUT_BIP';
          } else if (g.strikes < C.MAX_STRIKES - 1) {
            g.strikes++;
          }
        } else {
          // SWING_MISS, LOOKING
          g.strikes++;
          if (g.strikes >= C.MAX_STRIKES) {
            g.stats.strikeouts++;
            ended = true;
            outcome = 'STRIKEOUT';
          }
        }
        if (timing === 'PERFECT') g.stats.perfects++;
        if (ended) g.atBatLog.push(outcome);
        return { result, timing, atBatEnded: ended, atBatOutcome: outcome, foulCapped };
      },
    };

    function enter(phase, at) {
      g.phase = phase;
      g.phaseStart = at;
    }

    function startPitch(at) {
      g.pitch = pitcher.nextPitch();
      g.pitchLog.push(g.pitch);
      g.pitchInAtBat++;
      g.totalPitches++;
      g.click = null;
      g.windupStart = at;
      g.releaseTime = at + C.WINDUP_SEC;
      g.arrivalTime = g.releaseTime + g.pitch.flightSec;
      enter('PITCH_WINDUP', at);
      g.events.push({ type: 'windup' });
    }

    function resolve() {
      enter('RESOLVE', g.time);
      const click = g.click ? { cell: g.click.cell, deltaSec: g.click.atTime - g.arrivalTime } : null;
      const j = judgeFn(click, g.pitch.cell, g.level, judgeRng, C);
      const applied = g.applyResult(j.result, j.timing);
      g.last = Object.assign(applied, {
        clickCell: click ? click.cell : null,
        deltaSec: click ? click.deltaSec : null,
        pitch: g.pitch,
      });
      enter('RESULT_SHOW', g.time);
      g.events.push({ type: 'result', last: g.last });
    }

    function nextAfterResult() {
      if (g.last && g.last.atBatEnded) {
        if (g.atBat >= C.AT_BATS_PER_GAME) {
          enter('GAME_OVER', g.time);
          g.events.push({ type: 'gameover' });
          return;
        }
        g.atBat++;
        g.strikes = 0;
        g.pitchInAtBat = 0;
        enter('AT_BAT_INTRO', g.phaseStart + resultDuration());
        return;
      }
      startPitch(g.phaseStart + resultDuration());
    }

    function resultDuration() {
      return g.last && g.last.atBatEnded ? C.AT_BAT_END_SEC : C.RESULT_SEC;
    }

    function step() {
      for (let guard = 0; guard < 8; guard++) {
        const el = g.time - g.phaseStart;
        if (g.phase === 'AT_BAT_INTRO' && el >= C.AT_BAT_INTRO_SEC) {
          startPitch(g.phaseStart + C.AT_BAT_INTRO_SEC);
        } else if (g.phase === 'PITCH_WINDUP' && g.time >= g.releaseTime) {
          enter('PITCH_FLIGHT', g.releaseTime);
          g.events.push({ type: 'release', pitch: g.pitch });
        } else if (
          g.phase === 'PITCH_FLIGHT' &&
          ((g.click && g.time >= Math.max(g.arrivalTime, g.click.atTime)) || g.time >= g.arrivalTime + C.GRACE_SEC)
        ) {
          resolve();
        } else if (g.phase === 'RESULT_SHOW' && el >= resultDuration()) {
          nextAfterResult();
        } else {
          break;
        }
      }
    }

    return g;
  }

  const api = { createGame, formatAvg, challengeSeeds };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
