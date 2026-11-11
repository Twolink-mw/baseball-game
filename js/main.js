// 화면 전환, 게임 루프, 모듈 연결
(function (global) {
  'use strict';

  const BB = global.BB;
  const C = BB.CONFIG;
  const canvas = document.getElementById('game');
  const renderer = BB.createRenderer(canvas);

  const app = {
    screen: 'title', // title | game | result | players
    record: BB.storage.load(),
    game: null,
    result: null,
    hover: null,
    hits: [],
    lastFrameTs: null,
    lastLevel: 0,
    page: 0, // 타자 기록 화면 페이지
  };

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function currentPlayer() {
    return (app.record.current && app.record.players[app.record.current]) || null;
  }

  function setRecord(r) {
    app.record = r;
    BB.storage.save(r);
  }

  // ---- 타자 이름 대화상자 ----
  const dialog = {
    el: document.getElementById('name-dialog'),
    form: document.getElementById('name-form'),
    input: document.getElementById('name-input'),
    error: document.getElementById('name-error'),
    list: document.getElementById('name-list'),
    cancel: document.getElementById('name-cancel'),
    pending: null, // 확인 후 실행할 동작
  };

  function openNameDialog(pending) {
    dialog.pending = pending || null;
    const p = currentPlayer();
    dialog.input.value = p ? p.name : '';
    dialog.error.textContent = '';
    dialog.list.textContent = '';
    for (const q of BB.rankPlayers(app.record)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q.name;
      b.addEventListener('click', () => confirmName(q.name));
      dialog.list.appendChild(b);
    }
    dialog.el.hidden = false;
    dialog.input.focus();
    dialog.input.select();
  }

  function closeNameDialog() {
    dialog.el.hidden = true;
    dialog.pending = null;
    dialog.input.blur();
  }

  function confirmName(name) {
    const res = BB.ensurePlayer(app.record, name);
    if (res.error === 'invalid') {
      dialog.error.textContent = '이름을 1~' + C.NAME_MAX + '자로 입력하세요.';
      return;
    }
    if (res.error === 'full') {
      dialog.error.textContent = '타자는 최대 ' + C.MAX_PLAYERS + '명까지 저장됩니다. 타자 기록에서 삭제 후 추가하세요.';
      return;
    }
    setRecord(res.record);
    const pending = dialog.pending;
    closeNameDialog();
    if (pending) pending();
  }

  dialog.form.addEventListener('submit', (e) => {
    e.preventDefault();
    confirmName(dialog.input.value);
  });
  dialog.cancel.addEventListener('click', closeNameDialog);
  dialog.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeNameDialog();
    }
  });

  const dialogOpen = () => !dialog.el.hidden;

  // ---- 게임 ----
  function startGame(levelIndex, mode) {
    const p = currentPlayer();
    if (!p) return openNameDialog(() => startGame(levelIndex, mode));
    let seeds;
    if (mode === 'challenge') {
      levelIndex = C.CHALLENGE.level - 1;
      seeds = BB.challengeSeeds(today());
    } else {
      if (!p.unlocked[levelIndex]) return; // 이 타자는 아직 잠긴 레벨
      const now = Date.now();
      seeds = { pitchSeed: BB.hashString('p' + now), judgeSeed: BB.hashString('j' + now) };
    }
    app.game = BB.createGame({ levelIndex, mode, pitchSeed: seeds.pitchSeed, judgeSeed: seeds.judgeSeed, playerName: p.name });
    if (mode === 'normal') app.lastLevel = levelIndex;
    app.screen = 'game';
    app.lastFrameTs = null;
  }

  function finishGame() {
    const g = app.game;
    const summary = g.summary();
    const date = today();
    const key = app.record.current;
    const player = currentPlayer();
    if (!player) return goTitle(); // 게임 중 타자가 사라진 경우(정상 흐름에선 없음)
    const applied = BB.applyGameResult(app.record, {
      playerKey: key, levelIndex: g.levelIndex, hits: summary.hits, atBats: C.AT_BATS_PER_GAME, mode: g.mode, date,
    });
    setRecord(applied.record);
    app.result = Object.assign({ summary, date, playerName: player.name, player: applied.record.players[key] }, applied);
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

  function pageCount() {
    return Math.max(1, Math.ceil(Object.keys(app.record.players).length / C.LEADERBOARD_PAGE));
  }

  function doAction(id) {
    if (id.startsWith('level:')) return startGame(Number(id.slice(6)), 'normal');
    if (id.startsWith('player:')) {
      const key = id.slice(7);
      if (app.record.players[key]) setRecord(Object.assign({}, app.record, { current: key }));
      return goTitle();
    }
    if (id.startsWith('delete:')) {
      const key = id.slice(7);
      const p = app.record.players[key];
      if (p && global.confirm("'" + p.name + "' 타자의 기록을 삭제할까요?")) {
        setRecord(BB.deletePlayer(app.record, key));
        app.page = Math.min(app.page, pageCount() - 1);
      }
      return;
    }
    switch (id) {
      case 'challenge':
        return startGame(0, 'challenge');
      case 'changeBatter':
        return openNameDialog(null);
      case 'players':
        app.page = 0;
        app.screen = 'players';
        return;
      case 'page:prev':
        app.page = Math.max(0, app.page - 1);
        return;
      case 'page:next':
        app.page = Math.min(pageCount() - 1, app.page + 1);
        return;
      case 'reset':
        if (global.confirm('모든 타자의 기록과 잠금 해제 상태를 지울까요?')) setRecord(BB.storage.clear());
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
    isBlocked: dialogOpen,
    onPointerDown(x, y, ts) {
      if (dialogOpen()) return;
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
      } else if (app.screen === 'players') {
        goTitle();
      } else if (app.screen === 'title' && code !== 'Escape') {
        startGame(app.lastLevel, 'normal');
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
    const player = currentPlayer();
    app.hits = renderer.draw({
      screen: app.screen,
      record: app.record,
      player,
      playerData: player || BB.defaultPlayer(''),
      ranking: app.screen === 'players' ? BB.rankPlayers(app.record) : null,
      page: app.page,
      game: app.game,
      result: app.result,
      hover: app.hover,
      today: today(),
    });
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);
})(window);
