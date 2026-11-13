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

  // 오늘의 챌린지 구성: 날짜로 투수·미션을 고르고, 바탕 레벨에 투수 값을 덮어쓴 레벨을 만든다.
  // 투구·판정 RNG와 별도의 해시를 쓰므로 투구 순서에는 영향이 없다
  function challengeSetup(dateStr, config) {
    const C = config || BB.CONFIG;
    const CH = C.CHALLENGE;
    const base = C.LEVELS[CH.level - 1];
    const pitcher = CH.pitchers[BB.hashString('bbgame-challenge-pitcher:' + dateStr) % CH.pitchers.length];
    const mission = CH.missions[BB.hashString('bbgame-challenge-mission:' + dateStr) % CH.missions.length];
    const level = pitcherLevel(base, pitcher);
    return Object.assign({ levelIndex: CH.level - 1, level, pitcher, mission }, challengeSeeds(dateStr));
  }

  // 바탕 레벨에 챌린지 투수 값을 덮어쓴 레벨 (챌린지, 보스 투수)
  function pitcherLevel(base, pitcher) {
    const over = Object.assign({}, pitcher);
    delete over.id;
    delete over.name;
    delete over.desc;
    return Object.assign({}, base, over, { title: pitcher.name });
  }

  // 도전 모드 구성 → { mode, levelIndex, level, rules, modeName, bossId? }
  // practice opts: { levelIndex, type(구종 이름|null), balls(true면 볼도 던짐) }
  function modeSetup(modeId, opts, config) {
    const C = config || BB.CONFIG;
    const M = C.MODES[modeId];
    if (!M) throw new Error('없는 모드: ' + modeId);
    opts = opts || {};
    if (modeId === 'practice') {
      const levelIndex = Math.max(0, Math.min(C.LEVELS.length - 1, opts.levelIndex || 0));
      const level = Object.assign({}, C.LEVELS[levelIndex]);
      if (opts.type && C.PITCH_TYPES[opts.type]) level.pitchMix = { [opts.type]: 1 };
      if (!opts.balls) level.ballRate = 0;
      return { mode: modeId, levelIndex, level, rules: { practice: true }, modeName: M.name };
    }
    const levelIndex = M.level - 1;
    const base = C.LEVELS[levelIndex];
    if (modeId === 'boss') {
      const pitcher = C.CHALLENGE.pitchers.find((p) => p.id === opts.bossId && M.pitchers.includes(p.id));
      if (!pitcher) throw new Error('없는 보스: ' + opts.bossId);
      return { mode: modeId, levelIndex, level: pitcherLevel(base, pitcher), rules: {}, modeName: M.name + ' ' + pitcher.name, bossId: pitcher.id };
    }
    const level = Object.assign({}, base, M.override || {});
    const rules = { maxOuts: M.maxOuts, homerOnly: !!M.homerOnly, speedStep: M.speedStep || 0, speedMax: M.speedMax || 0 };
    return { mode: modeId, levelIndex, level, rules, modeName: M.name };
  }

  // 연속 타석 안타 최대 길이
  function hitStreak(atBatLog) {
    let best = 0;
    let cur = 0;
    for (const o of atBatLog) {
      cur = HIT_RESULTS[o] ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    return best;
  }

  function missionStat(stat, stats, atBatLog) {
    switch (stat) {
      case 'extraBases':
        return stats.doubles + stats.homers;
      case 'hitStreak':
        return hitStreak(atBatLog);
      case 'firstHit':
        return atBatLog.length && HIT_RESULTS[atBatLog[0]] ? 1 : 0;
      default:
        return stats[stat] || 0;
    }
  }

  // 미션 진행: { value, done, failed }. min형은 도중에 달성 확정, max형은 넘으면 실패 확정·끝나야 달성
  // firstHit은 첫 타석이 끝나면 확정
  function missionProgress(mission, stats, atBatLog, finished) {
    const value = missionStat(mission.stat, stats, atBatLog);
    if (mission.max != null) {
      const failed = value > mission.max;
      return { value, done: !!finished && !failed, failed };
    }
    const done = value >= mission.min;
    const decided = mission.stat === 'firstHit' ? atBatLog.length > 0 : !!finished;
    return { value, done, failed: !done && decided };
  }

  // ---- 승부처 ----
  // 이 타자가 이번 판에서 노릴 목표: 다음 레벨 해제(잠겨 있을 때), 최고 타율 갱신(기록이 있을 때). 해제가 먼저
  function clutchTargets(player, levelIndex, config) {
    const C = config || BB.CONFIG;
    const N = C.AT_BATS_PER_GAME;
    const out = [];
    const next = levelIndex + 1;
    if (player && next < C.LEVELS.length && !player.unlocked[next]) {
      out.push({ kind: 'unlock', hits: Math.ceil(C.UNLOCK_AVG[levelIndex] * N - 1e-9), label: C.LEVELS[next].name + ' 해제' });
    }
    const best = player && player.best[levelIndex];
    if (best !== null && best !== undefined && best < 1) {
      out.push({ kind: 'record', hits: Math.floor(best * N + 1e-9) + 1, label: '최고 타율 갱신' });
    }
    return out;
  }

  // 지금 타석이 승부처인지: 남은 타석(지금 타석 포함)이 maxRemaining 이하이고, 남은 타석 안에 닿을 수 있는 목표
  // → { kind, label, need, remaining } 또는 null
  function clutchState(targets, hits, atBatsDone, config) {
    const C = config || BB.CONFIG;
    const remaining = C.AT_BATS_PER_GAME - atBatsDone;
    if (!targets || remaining < 1 || remaining > C.CLUTCH.maxRemaining) return null;
    for (const t of targets) {
      const need = t.hits - hits;
      if (need >= 1 && need <= remaining) return { kind: t.kind, label: t.label, need, remaining };
    }
    return null;
  }

  // ---- 칭호 ----
  // 일반 게임 요약(summary)으로 얻은 칭호 id 목록 (TITLES 순서)
  function earnedTitles(summary, config) {
    const C = config || BB.CONFIG;
    if (summary.mode !== 'normal') return [];
    return C.TITLES.filter(
      (t) => (!t.level || t.level === summary.levelIndex + 1) && t.conds.every((c) => missionProgress(c, summary, summary.atBatLog, true).done)
    ).map((t) => t.id);
  }

  // ---- 경기 후 분석 ----
  // 투구 기록(history)을 코스·구종·타이밍·선구안으로 집계하고 한 줄 평을 만든다 (순수 함수)
  const ROW_NAMES = ['높은 공', '가운데 높이 공', '낮은 공'];
  const COL_NAMES = ['왼쪽 공', '가운데 세로줄 공', '오른쪽 공'];

  function analyze(history, config) {
    const C = config || BB.CONFIG;
    const A = C.ANALYSIS;
    const byCell = [];
    for (let i = 0; i < 9; i++) byCell.push({ pitches: 0, swings: 0, matched: 0, hits: 0 });
    const byType = {};
    const timing = { swings: 0, perfect: 0, good: 0, early: 0, late: 0, mean: null, deltas: [] };
    const discipline = { balls: 0, chased: 0, looking: 0 };
    let sum = 0;
    for (const h of history) {
      const swung = !!h.clickCell;
      const hit = !!HIT_RESULTS[h.result];
      const t = byType[h.type] || (byType[h.type] = { pitches: 0, swings: 0, hits: 0, misses: 0, early: 0, late: 0 });
      t.pitches++;
      if (swung) {
        t.swings++;
        if (hit) t.hits++;
        if (h.result === 'SWING_MISS') t.misses++;
      }
      if (BB.isBallCell(h.cell)) {
        discipline.balls++;
        if (swung) discipline.chased++;
      } else {
        const c = byCell[h.cell.row * 3 + h.cell.col];
        c.pitches++;
        if (swung) {
          c.swings++;
          if (h.clickCell.row === h.cell.row && h.clickCell.col === h.cell.col) c.matched++;
        }
        if (hit) c.hits++;
        if (h.result === 'LOOKING') discipline.looking++;
      }
      if (swung && typeof h.deltaSec === 'number') {
        timing.swings++;
        sum += h.deltaSec;
        timing.deltas.push({ d: h.deltaSec, grade: h.timing });
        if (h.timing === 'PERFECT') timing.perfect++;
        else if (h.timing === 'GOOD') timing.good++;
        else if (h.deltaSec < 0) {
          timing.early++;
          t.early++;
        } else {
          timing.late++;
          t.late++;
        }
      }
    }
    if (timing.swings) timing.mean = sum / timing.swings;

    // 한 줄 평: 고칠 점부터, 최대 maxTips개
    const tips = [];
    if (discipline.balls >= A.minSamples && discipline.chased / discipline.balls >= A.chaseRate) {
      tips.push('볼 ' + discipline.balls + '개 중 ' + discipline.chased + '개에 스윙했어요. 일찍 바깥으로 휘는 공은 참아 보세요');
    }
    for (const [name, t] of Object.entries(byType)) {
      if (t.swings < A.minSamples) continue;
      if (t.early / t.swings >= A.timingRate) tips.push(name + '에 ' + t.swings + '번 중 ' + t.early + '번 빨랐어요. 조금 더 기다려 보세요');
      else if (t.late / t.swings >= A.timingRate) tips.push(name + '에 ' + t.swings + '번 중 ' + t.late + '번 늦었어요. 조금 더 일찍 누르세요');
    }
    if (timing.swings >= A.minSamples + 2) {
      const sec = Math.abs(timing.mean).toFixed(2);
      if (timing.early / timing.swings >= A.timingRate) tips.push('전체적으로 스윙이 빨라요 (평균 ' + sec + '초 빠름)');
      else if (timing.late / timing.swings >= A.timingRate) tips.push('전체적으로 스윙이 늦어요 (평균 ' + sec + '초 늦음)');
    }
    const groups = [];
    for (let i = 0; i < 3; i++) {
      groups.push([ROW_NAMES[i], [0, 1, 2].map((c) => byCell[i * 3 + c])]);
      groups.push([COL_NAMES[i], [0, 1, 2].map((r) => byCell[r * 3 + i])]);
    }
    let weak = null;
    for (const [name, cells] of groups) {
      const swings = cells.reduce((a, c) => a + c.swings, 0);
      const matched = cells.reduce((a, c) => a + c.matched, 0);
      if (swings < A.minSamples || matched / swings > A.weakRate) continue;
      if (!weak || matched / swings < weak.rate || (matched / swings === weak.rate && swings > weak.swings)) {
        weak = { name, swings, matched, rate: matched / swings };
      }
    }
    if (weak) tips.push(weak.name + '에 ' + weak.swings + '번 스윙해 ' + weak.matched + '번만 코스를 맞혔어요');
    if (discipline.looking >= A.lookingMin) tips.push('스트라이크 ' + discipline.looking + '개를 그냥 보냈어요. 존 안의 공은 과감하게');
    if (!tips.length && timing.perfect >= A.praisePerfects) tips.push('정확 타이밍 ' + timing.perfect + '번! 타이밍 감각이 좋아요');

    return { byCell, byType, timing, discipline, tips: tips.slice(0, A.maxTips) };
  }

  // opts: { levelIndex, level?, mode: 'normal'|'challenge', pitchSeed, judgeSeed, mission?, config?, judgeFn? }
  // level을 주면 LEVELS 대신 사용 (챌린지의 오늘의 투수)
  function createGame(opts) {
    const C = opts.config || BB.CONFIG;
    const level = opts.level || C.LEVELS[opts.levelIndex];
    const pitchRng = BB.createRng(opts.pitchSeed);
    const judgeRng = BB.createRng(opts.judgeSeed);
    const pitcher = BB.createPitcher(level, pitchRng, C);
    const judgeFn = opts.judgeFn || BB.judge;

    // rules: { maxOuts?: 아웃 n개면 끝(서바이벌·더비), homerOnly?: 홈런 아닌 타석 종료는 아웃,
    //          speedStep?/speedMax?: 타석마다 구속 가산, practice?: 끝없이 투구·카운트 없음 }
    const rules = opts.rules || {};
    const g = {
      config: C,
      level,
      levelIndex: opts.levelIndex,
      mode: opts.mode || 'normal',
      rules,
      modeName: opts.modeName || null, // 도전 모드 표시 이름
      bossId: opts.bossId || null,
      mission: opts.mission || null, // 챌린지 미션
      targets: opts.targets || null, // 승부처 목표 (clutchTargets)
      playerName: opts.playerName || '', // 표시용
      bats: opts.bats === 'L' ? 'L' : 'R', // 표시용: 우타(R) / 좌타(L)
      phase: 'AT_BAT_INTRO',
      time: 0,
      phaseStart: 0,
      paused: false,
      atBat: 1,
      strikes: 0,
      balls: 0, // 볼 카운트 (MAX_BALLS개가 되면 이후는 스트라이크만, 볼넷 없음)
      pitchInAtBat: 0,
      totalPitches: 0,
      stats: { hits: 0, singles: 0, doubles: 0, homers: 0, strikeouts: 0, outs: 0, perfects: 0, chases: 0 }, // chases: 볼에 스윙한 횟수
      atBatLog: [], // 타석별 결과
      pitchLog: [], // 던진 투구 순서
      history: [], // 투구별 결과 { atBat, n, type, speed, cell, clickCell, result, timing } (투구 기록 패널용)
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
        if (rules.maxOuts) return g.atBatLog.length ? g.stats.hits / g.atBatLog.length : 0;
        return g.stats.hits / C.AT_BATS_PER_GAME;
      },

      // 도전 모드 아웃 수: 범타·삼진, 홈런 더비는 홈런이 아닌 타석 종료 전부
      modeOuts() {
        return g.atBatLog.filter((o) => (rules.homerOnly ? o !== 'HOMERUN' : !HIT_RESULTS[o])).length;
      },

      // 도전 모드 점수: 홈런 더비는 홈런 수, 나머지는 안타 수
      score() {
        return rules.homerOnly ? g.stats.homers : g.stats.hits;
      },

      // 서바이벌: 지금 타석의 구속 가산
      speedBonus() {
        return rules.speedStep ? Math.min(rules.speedMax || Infinity, (g.atBat - 1) * rules.speedStep) : 0;
      },

      // 지금 타석이 끝났을 때 게임이 끝나는지
      isOver() {
        if (rules.practice) return false;
        if (rules.maxOuts) return g.modeOuts() >= rules.maxOuts;
        return g.atBat >= C.AT_BATS_PER_GAME;
      },

      missionProgress() {
        return g.mission ? missionProgress(g.mission, g.stats, g.atBatLog, g.phase === 'GAME_OVER') : null;
      },

      // 지금 타석이 승부처면 { kind, label, need, remaining }
      clutch() {
        if (g.phase === 'GAME_OVER') return null;
        return clutchState(g.targets, g.stats.hits, g.atBatLog.length, C);
      },

      // 볼을 MAX_BALLS개 골라내 타자 유리 (이후 스트라이크만, '좋음' 구간 넓어짐)
      advantage() {
        return g.balls >= C.MAX_BALLS;
      },

      summary() {
        const s = Object.assign({}, g.stats, {
          atBatLog: g.atBatLog.slice(), // 타석별 결과 (HOMERUN/DOUBLE/SINGLE/OUT_BIP/STRIKEOUT)
          mission: g.mission,
          missionDone: g.mission ? missionProgress(g.mission, g.stats, g.atBatLog, true).done : false,
          pitcherName: g.mode === 'challenge' ? g.level.title : null,
          analysis: analyze(g.history, C),
          avg: g.finalAverage(),
          totalPitches: g.totalPitches,
          levelIndex: g.levelIndex,
          mode: g.mode,
          modeName: g.modeName,
          bossId: g.bossId,
          rules,
          score: g.score(),
          modeOuts: g.modeOuts(),
          atBats: g.atBatLog.length,
        });
        s.titles = earnedTitles(s, C); // 이번 판에서 조건을 만족한 칭호 (일반 게임만)
        return s;
      },

      drainEvents() {
        const e = g.events;
        g.events = [];
        return e;
      },

      // 판정 결과를 카운트에 반영 (테스트에서도 사용)
      applyResult(result, timing) {
        if (rules.practice) {
          // 연습: 기록만 하고 카운트·타석은 그대로 (끝없이 투구)
          if (HIT_RESULTS[result]) {
            g.stats.hits++;
            g.stats[HIT_RESULTS[result]]++;
          } else if (result === 'OUT_BIP') g.stats.outs++;
          if (timing === 'PERFECT') g.stats.perfects++;
          return { result, timing, atBatEnded: false, atBatOutcome: null, foulCapped: false };
        }
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
        } else if (result === 'BALL') {
          g.balls = Math.min(g.balls + 1, C.MAX_BALLS);
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
      g.pitch = pitcher.nextPitch({ allowBall: g.balls < C.MAX_BALLS, speedBonus: g.speedBonus() });
      g.pitchLog.push(g.pitch);
      g.pitchInAtBat++;
      g.totalPitches++;
      g.click = null;
      g.windupStart = at;
      g.releaseTime = at + g.pitch.windupSec;
      g.arrivalTime = g.releaseTime + g.pitch.flightSec;
      enter('PITCH_WINDUP', at);
      g.events.push({ type: 'windup' });
    }

    function resolve() {
      enter('RESOLVE', g.time);
      const click = g.click ? { cell: g.click.cell, deltaSec: g.click.atTime - g.arrivalTime } : null;
      const j = judgeFn(click, g.pitch.cell, g.level, judgeRng, C, { advantage: g.advantage() });
      const applied = g.applyResult(j.result, j.timing);
      if (click && BB.isBallCell(g.pitch.cell)) g.stats.chases++;
      g.last = Object.assign(applied, {
        clickCell: click ? click.cell : null,
        deltaSec: click ? click.deltaSec : null,
        pitch: g.pitch,
      });
      g.history.push({
        atBat: g.atBat, n: g.pitchInAtBat, type: g.pitch.type, speed: g.pitch.speed, cell: g.pitch.cell,
        clickCell: g.last.clickCell, result: applied.result, timing: applied.timing, deltaSec: g.last.deltaSec,
      });
      enter('RESULT_SHOW', g.time);
      g.events.push({ type: 'result', last: g.last });
    }

    function nextAfterResult() {
      if (g.last && g.last.atBatEnded) {
        if (g.isOver()) {
          enter('GAME_OVER', g.time);
          g.events.push({ type: 'gameover' });
          return;
        }
        g.atBat++;
        g.strikes = 0;
        g.balls = 0;
        g.pitchInAtBat = 0;
        enter('AT_BAT_INTRO', g.phaseStart + resultDuration());
        g.events.push({ type: 'atbat', clutch: g.clutch() }); // 승부처면 관중 소리를 키움
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

  const api = {
    createGame, formatAvg, challengeSeeds, challengeSetup, missionProgress, hitStreak, analyze,
    clutchTargets, clutchState, earnedTitles, pitcherLevel, modeSetup,
  };
  if (isNode) module.exports = api;
  else Object.assign((global.BB = global.BB || {}), api);
})(typeof window !== 'undefined' ? window : globalThis);
