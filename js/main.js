// 화면 전환, 게임 루프, 모듈 연결
(function (global) {
  'use strict';

  const BB = global.BB;
  const C = BB.CONFIG;
  const canvas = document.getElementById('game');
  const renderer = BB.createRenderer(canvas);

  const app = {
    screen: 'title',
    record: BB.storage.load(),
    game: null,
    result: null,
    hover: null,
    hits: [],
    lastFrameTs: null,
    lastLevel: 0,
    lastMode: 'normal',
  };

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function startGame(levelIndex, mode) {
    let seeds;
    if (mode === 'challenge') {
      levelIndex = C.CHALLENGE.level - 1;
      seeds = BB.challengeSeeds(today());
    } else {
      const now = Date.now();
      seeds = { pitchSeed: BB.hashString('p' + now), judgeSeed: BB.hashString('j' + now) };
    }
    app.game = BB.createGame({ levelIndex, mode, pitchSeed: seeds.pitchSeed, judgeSeed: seeds.judgeSeed });
    app.lastLevel = levelIndex;
    app.lastMode = mode;
    app.screen = 'game';
    app.lastFrameTs = null;
  }

  function finishGame() {
    const g = app.game;
    const summary = g.summary();
    const date = today();
    const applied = BB.applyGameResult(app.record, { levelIndex: g.levelIndex, avg: summary.avg, mode: g.mode, date });
    app.record = applied.record;
    BB.storage.save(app.record);
    app.result = Object.assign({ summary, date }, applied);
    app.game = null;
    app.screen = 'result';
  }

  function goTitle() {
    app.game = null;
    app.screen = 'title';
  }

  function setPaused(p) {
    if (app.game) app.game.setPaused(p);
  }

  // event.timeStamp → 게임 시각. 마지막 프레임 이후 경과분만큼 보정한다.
  function toGameTime(ts) {
    const g = app.game;
    if (app.lastFrameTs === null || typeof ts !== 'number' || Math.abs(ts - performance.now()) > 10000) return g.time;
    const offset = (ts - app.lastFrameTs) / 1000;
    return g.time + Math.max(-0.1, Math.min(offset, C.MAX_DT));
  }

  function swingAt(cell, ts) {
    const g = app.game;
    if (!g || g.paused) return;
    g.input(cell, toGameTime(ts));
  }

  function doAction(id) {
    if (id.startsWith('level:')) return startGame(Number(id.slice(6)), 'normal');
    switch (id) {
      case 'challenge':
        return startGame(0, 'challenge');
      case 'reset':
        if (global.confirm('모든 기록과 잠금 해제 상태를 지울까요?')) app.record = BB.storage.clear();
        return;
      case 'pause':
        return setPaused(true);
      case 'resume':
        return setPaused(false);
      case 'menu':
        return goTitle();
      case 'retry':
        return startGame(app.result.summary.levelIndex, app.result.summary.mode);
      case 'next':
        return startGame(app.result.summary.levelIndex + 1, 'normal');
    }
  }

  BB.attachInput(canvas, renderer, {
    onPointerDown(x, y, ts) {
      for (const h of app.hits) {
        if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return doAction(h.id);
      }
      if (app.screen === 'game') {
        const cell = renderer.cellAt(x, y);
        if (cell) swingAt(cell, ts); // 존 바깥 클릭은 무시
      }
    },
    onPointerMove(x, y, type) {
      app.hover = type === 'mouse' && app.screen === 'game' ? renderer.cellAt(x, y) : null;
    },
    onCellKey(cell, ts) {
      if (app.screen === 'game') swingAt(cell, ts);
    },
    onKey(code) {
      if (app.screen === 'game') {
        if (code === 'Escape') setPaused(!app.game.paused);
        else if (app.game.paused) setPaused(false);
      } else if (app.screen === 'result') {
        if (code === 'Escape') goTitle();
        else doAction('retry');
      } else if (app.screen === 'title' && code !== 'Escape') {
        if (app.record.unlocked[app.lastLevel]) startGame(app.lastLevel, 'normal');
      }
    },
  });

  global.addEventListener('resize', () => renderer.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
  });

  function frame(ts) {
    const dt = app.lastFrameTs === null ? 0 : (ts - app.lastFrameTs) / 1000;
    app.lastFrameTs = ts;
    if (app.screen === 'game' && app.game) {
      app.game.update(dt);
      app.game.drainEvents(); // M3에서 사운드에 연결
      if (app.game.phase === 'GAME_OVER') finishGame();
    }
    app.hits = renderer.draw({
      screen: app.screen,
      record: app.record,
      game: app.game,
      result: app.result,
      hover: app.hover,
      today: today(),
    });
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);
})(window);
