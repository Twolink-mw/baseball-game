// 화면 전환, 게임 루프, 모듈 연결
(function (global) {
  'use strict';

  const BB = global.BB;
  const C = BB.CONFIG;
  const canvas = document.getElementById('game');
  const renderer = BB.createRenderer(canvas);
  const audio = BB.createAudio();

  const app = {
    screen: 'title', // title | game | result | players
    record: BB.storage.load(),
    game: null,
    result: null,
    resultTab: 'summary', // 결과 화면 탭: summary | analysis
    hover: null,
    hits: [],
    lastFrameTs: null,
    lastLevel: 0,
    page: 0, // 타자 기록 화면 페이지
    touch: false, // 터치 기기 (터치 패드·큰 버튼)
    portrait: false, // 세로 화면
    toast: null, // { text, until }
  };

  const isIOS = /iPad|iPhone|iPod/.test(global.navigator.userAgent) || (global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1);
  const isStandalone = (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || global.navigator.standalone === true;
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const canFullscreen = () => !isIOS && !isStandalone && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

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
    audio.setMuted(r.settings.muted);
  }

  function toggleMute() {
    const settings = Object.assign({}, app.record.settings, { muted: !app.record.settings.muted });
    setRecord(Object.assign({}, app.record, { settings }));
  }

  // 브라우저 정책: 첫 사용자 입력 이후에 소리 시작 (iOS 포함)
  audio.setMuted(app.record.settings.muted);
  for (const type of ['pointerdown', 'keydown', 'touchend']) {
    global.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
  }

  // ---- 타자 이름 대화상자 ----
  const dialog = {
    el: document.getElementById('name-dialog'),
    form: document.getElementById('name-form'),
    input: document.getElementById('name-input'),
    error: document.getElementById('name-error'),
    list: document.getElementById('name-list'),
    cancel: document.getElementById('name-cancel'),
    bats: Array.from(document.querySelectorAll('#name-form input[name="bats"]')),
    pending: null, // 확인 후 실행할 동작
  };

  function getBats() {
    const r = dialog.bats.find((b) => b.checked);
    return r ? r.value : 'R';
  }

  function setBats(v) {
    for (const b of dialog.bats) b.checked = b.value === v;
  }

  function openNameDialog(pending) {
    dialog.pending = pending || null;
    const p = currentPlayer();
    dialog.input.value = p ? p.name : '';
    setBats(p ? p.bats : 'R');
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
    // 터치 기기에서는 키보드가 화면 대부분을 가리므로 바로 띄우지 않는다.
    // (우타/좌타·기존 타자를 먼저 고르고, 이름 칸을 누르면 키보드 → '완료'로 확인)
    if (!app.touch) {
      dialog.input.focus();
      dialog.input.select();
    }
  }

  function closeNameDialog() {
    dialog.el.hidden = true;
    dialog.pending = null;
    dialog.input.blur();
  }

  // bats를 생략하면(기존 타자 버튼) 그 타자의 저장된 타석 방향을 그대로 쓴다
  function confirmName(name, bats) {
    const res = BB.ensurePlayer(app.record, name, bats);
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
    confirmName(dialog.input.value, getBats());
  });
  // 기존 타자 이름을 입력하면 그 타자의 우타/좌타를 미리 선택
  dialog.input.addEventListener('input', () => {
    const key = BB.playerKey(dialog.input.value);
    const q = key && app.record.players[key];
    if (q) setBats(q.bats);
  });
  dialog.cancel.addEventListener('click', closeNameDialog);
  dialog.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeNameDialog();
    }
  });

  // ---- 기록 백업 대화상자 ----
  const backup = {
    el: document.getElementById('backup-dialog'),
    exportText: document.getElementById('export-text'),
    importText: document.getElementById('import-text'),
    file: document.getElementById('import-file'),
    msg: document.getElementById('backup-msg'),
  };

  function backupMessage(str, isError) {
    backup.msg.textContent = str;
    backup.msg.classList.toggle('error', !!isError);
  }

  function openBackupDialog() {
    backup.exportText.value = BB.exportRecord(app.record);
    backup.importText.value = '';
    backupMessage('');
    backup.el.hidden = false;
  }

  function closeBackupDialog() {
    backup.el.hidden = true;
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
  }

  // 파일 내려받기 (공유를 지원하지 않는 환경, 기록 저장)
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function importText(text) {
    const r = BB.importRecordText(app.record, text);
    if (r.error === 'parse') return backupMessage('기록 형식(JSON)이 아닙니다. 기존 기록은 그대로입니다.', true);
    if (r.error) return backupMessage('이 게임의 기록이 아니거나 손상된 기록입니다. 기존 기록은 그대로입니다.', true);
    setRecord(r.record);
    backup.exportText.value = BB.exportRecord(app.record);
    const parts = [];
    if (r.added.length) parts.push('새 타자 ' + r.added.length + '명(' + r.added.join(', ') + ')');
    if (r.updated.length) parts.push('갱신 ' + r.updated.length + '명(' + r.updated.join(', ') + ')');
    if (r.skipped.length) parts.push('타자 수 제한으로 ' + r.skipped.length + '명 제외');
    backupMessage(parts.length ? '가져왔습니다: ' + parts.join(' · ') : '이미 같은 기록입니다. 바뀐 것이 없습니다.');
  }

  document.getElementById('export-copy').addEventListener('click', () => {
    const text = backup.exportText.value;
    const fallback = () => {
      backup.exportText.select();
      try {
        document.execCommand('copy');
        backupMessage('복사했습니다. 다른 기기의 가져오기 칸에 붙여넣으세요.');
      } catch (e) {
        backupMessage('복사하지 못했습니다. 글자를 길게 눌러 직접 복사하세요.', true);
      }
    };
    if (global.navigator.clipboard && global.isSecureContext) {
      global.navigator.clipboard.writeText(text).then(() => backupMessage('복사했습니다. 다른 기기의 가져오기 칸에 붙여넣으세요.'), fallback);
    } else fallback();
  });
  document.getElementById('export-file').addEventListener('click', () => {
    downloadBlob(new Blob([backup.exportText.value], { type: 'application/json' }), 'bbgame-기록-' + today() + '.json');
    backupMessage('파일로 저장했습니다.');
  });
  document.getElementById('import-paste').addEventListener('click', () => importText(backup.importText.value));
  document.getElementById('import-file-btn').addEventListener('click', () => backup.file.click());
  backup.file.addEventListener('change', () => {
    const f = backup.file.files && backup.file.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => importText(reader.result);
    reader.onerror = () => backupMessage('파일을 읽지 못했습니다.', true);
    reader.readAsText(f);
    backup.file.value = '';
  });
  document.getElementById('backup-close').addEventListener('click', closeBackupDialog);
  backup.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBackupDialog();
    }
  });

  const dialogOpen = () => !dialog.el.hidden || !backup.el.hidden;

  function showToast(text, sec) {
    app.toast = { text, until: performance.now() + (sec || 2.5) * 1000 };
  }

  // 결과 카드 PNG 공유 (지원하면 공유 시트, 아니면 내려받기)
  function shareResult() {
    const r = app.result;
    if (!r) return;
    const card = renderer.makeShareCard(r, performance.now() / 1000);
    const s = r.summary;
    const title = s.mode === 'challenge' ? r.date.slice(5).replace('-', '/') + ' 챌린지(' + s.pitcherName + ')' : C.LEVELS[s.levelIndex].name + ' ' + C.LEVELS[s.levelIndex].title;
    let msg = '타자 시점 야구 · ' + r.playerName + ' · ' + title + ' ' + BB.formatAvg(s.avg) + ' (' + s.hits + '/' + C.AT_BATS_PER_GAME + ')';
    if (s.mode === 'challenge') {
      // 타석별 결과 격자: 같은 날 같은 공을 상대했으니 타석끼리 비교할 수 있다
      const EMOJI = { HOMERUN: '🟥', DOUBLE: '🟧', SINGLE: '🟨', OUT_BIP: '⬜', STRIKEOUT: '⬛' };
      msg += '\n' + s.atBatLog.map((o) => EMOJI[o] || '⬜').join('');
      msg += '\n미션 ' + s.mission.text + (s.missionDone ? ' 달성!' : ' 실패');
      const streak = BB.currentStreak(r.player, r.date);
      if (r.official && streak > 1) msg += ' · 연속 ' + streak + '일째';
    }
    const filename = 'bbgame-' + r.date + '-' + r.playerName + '.png';
    card.toBlob((blob) => {
      if (!blob) return showToast('이미지를 만들지 못했습니다');
      let file = null;
      try {
        file = new File([blob], filename, { type: 'image/png' });
      } catch (e) {
        file = null;
      }
      const nav = global.navigator;
      if (file && nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        nav.share({ files: [file], title: '타자 시점 야구', text: msg }).catch((e) => {
          if (e && e.name !== 'AbortError') {
            downloadBlob(blob, filename);
            showToast('결과 이미지를 저장했습니다');
          }
        });
      } else {
        downloadBlob(blob, filename);
        showToast('결과 이미지를 저장했습니다');
      }
    }, 'image/png');
  }

  // ---- 게임 ----
  function startGame(levelIndex, mode) {
    const p = currentPlayer();
    if (!p) return openNameDialog(() => startGame(levelIndex, mode));
    let setup;
    if (mode === 'challenge') {
      setup = BB.challengeSetup(today()); // 오늘의 투수·미션·시드
    } else {
      if (!p.unlocked[levelIndex]) return; // 이 타자는 아직 잠긴 레벨
      const now = Date.now();
      setup = { levelIndex, pitchSeed: BB.hashString('p' + now), judgeSeed: BB.hashString('j' + now) };
    }
    app.game = BB.createGame({
      levelIndex: setup.levelIndex, level: setup.level, mission: setup.mission, mode,
      pitchSeed: setup.pitchSeed, judgeSeed: setup.judgeSeed, playerName: p.name, bats: p.bats,
      targets: mode === 'normal' ? BB.clutchTargets(p, levelIndex) : null, // 승부처 목표 (해제·최고 타율)
    });
    audio.setAmbienceBoost(false);
    if (mode === 'normal') app.lastLevel = levelIndex;
    app.screen = 'game';
    app.lastFrameTs = null;
    audio.setAmbience(true);
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
      missionDone: summary.missionDone, titles: summary.titles,
    });
    setRecord(applied.record);
    app.result = Object.assign(
      { summary, date, playerName: player.name, player: applied.record.players[key], shownAt: performance.now() / 1000 },
      applied
    );
    app.game = null;
    app.screen = 'result';
    app.resultTab = 'summary';
    audio.setAmbience(false);
    audio.fanfare(applied.newRecord || applied.unlockedLevel !== null, summary.avg);
  }

  function goTitle() {
    audio.setAmbience(false);
    app.game = null;
    app.screen = 'title';
  }

  function setPaused(p) {
    if (!app.game) return;
    app.game.setPaused(p);
    audio.setAmbience(!p);
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
      case 'mute':
        return toggleMute();
      case 'padSide': {
        const settings = Object.assign({}, app.record.settings, { padSide: app.record.settings.padSide === 'left' ? 'right' : 'left' });
        setRecord(Object.assign({}, app.record, { settings }));
        return;
      }
      case 'fullscreen':
        return toggleFullscreen();
      case 'backup':
        return openBackupDialog();
      case 'share':
        return shareResult();
      case 'tab:analysis':
        app.resultTab = 'analysis';
        return;
      case 'tab:summary':
        app.resultTab = 'summary';
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
      if (code === 'KeyM') return toggleMute();
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

  // ---- 모바일: 터치 감지, 터치 패드, 세로 화면, 전체화면 ----
  const pad = document.getElementById('touch-pad');
  const rotate = document.getElementById('rotate');
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--pad-cell', C.TOUCH.padCellPx + 'px');
  rootStyle.setProperty('--pad-gap', C.TOUCH.padGapPx + 'px');
  rootStyle.setProperty('--pad-margin', C.TOUCH.padMarginPx + 'px');

  function setTouchMode(on) {
    if (app.touch === on) return;
    app.touch = on;
    document.body.classList.toggle('touch', on);
    renderer.setTouch(on);
  }
  if (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) setTouchMode(true);
  // 첫 터치 입력으로도 감지 (마우스·터치 겸용 기기)
  global.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') setTouchMode(true);
  }, { capture: true, passive: true });

  // 패드: 누른 칸으로 스윙. 누른 시각(event.timeStamp)을 그대로 넘긴다
  for (const b of pad.querySelectorAll('button')) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (app.screen !== 'game' || !app.game || app.game.paused) return;
      const cell = { row: Number(b.dataset.row), col: Number(b.dataset.col) };
      audio.unlock();
      swingAt(cell, e.timeStamp);
      // 존의 같은 칸에도 잠깐 하이라이트
      app.hover = cell;
      app.padFlashUntil = performance.now() + 150;
      b.classList.add('hit');
      setTimeout(() => b.classList.remove('hit'), 120);
    });
  }
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  function updatePad() {
    const show = app.touch && app.screen === 'game' && app.game && !app.game.paused && !app.portrait && !dialogOpen();
    if (pad.hidden === show) pad.hidden = !show;
    pad.classList.toggle('left', app.record.settings.padSide === 'left');
  }

  function checkOrientation() {
    const portrait = (app.touch || isIOS) && global.innerHeight > global.innerWidth;
    if (portrait !== app.portrait) {
      app.portrait = portrait;
      rotate.hidden = !portrait;
      if (portrait) setPaused(true); // 세로로 돌리면 자동 일시정지
    }
  }

  function toggleFullscreen() {
    try {
      if (fsElement()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        const p = req && req.call(el);
        // 안드로이드: 전체화면이면 가로 고정 시도 (지원하지 않으면 무시)
        if (p && p.then) p.then(() => global.screen.orientation && global.screen.orientation.lock && global.screen.orientation.lock('landscape').catch(() => {}));
      }
    } catch (e) {
      /* 지원하지 않는 브라우저 */
    }
  }

  function onResize() {
    renderer.resize();
    checkOrientation();
  }
  global.addEventListener('resize', onResize);
  global.addEventListener('orientationchange', () => setTimeout(onResize, 100));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setPaused(true);
      audio.suspend();
    } else {
      audio.resume();
    }
  });
  checkOrientation();

  // ---- 안드로이드 뒤로가기 ----
  // 한 페이지짜리 앱이라 그냥 두면 뒤로가기 한 번에 앱이 꺼진다.
  // 1) CloseWatcher(크롬 126+): 안드로이드 뒤로가기 전용 API. 사용자 입력 없이도 하나는 만들 수 있어
  //    앱을 열자마자 눌러도 잡힌다. 뒤로가기를 받으면(close) 화면 안에서 처리하고 새로 만든다.
  // 2) CloseWatcher가 없으면 history 가드. 크롬은 사용자 입력 없이 쌓은 기록을 뒤로가기에서 건너뛰고,
  //    그때 직전 기록까지 '건너뛸 기록'으로 표시하므로, 가드는 사용자 입력 직후에만 쌓는다.
  //    (터치는 손을 뗄 때(pointerup/touchend)부터 사용자 입력으로 인정되므로 pointerdown은 쓰지 않는다)
  // 타이틀에서는 '한 번 더 누르면 종료' 안내 후, 그 시간 안에 다시 누르면 종료한다.
  const BACK_EXIT_SEC = 2;
  let exitArmedUntil = 0;
  let exitTimer = 0;

  // 뒤로가기 처리. false를 돌려주면 다음 뒤로가기는 잡지 않는다(앱 종료)
  function handleBack() {
    if (!dialog.el.hidden) closeNameDialog();
    else if (!backup.el.hidden) closeBackupDialog();
    else if (app.screen === 'game' && app.game) {
      if (!app.game.paused) setPaused(true); // 경기 중: 일시정지 메뉴
      else goTitle(); // 일시정지 중 한 번 더: 타이틀로
    } else if (app.screen !== 'title') goTitle();
    else if (performance.now() >= exitArmedUntil) {
      exitArmedUntil = performance.now() + BACK_EXIT_SEC * 1000;
      showToast('뒤로 버튼을 한 번 더 누르면 종료됩니다', BACK_EXIT_SEC);
      return false;
    }
    return true;
  }

  const back = { watcher: null, guard: false };
  const hasCloseWatcher = typeof global.CloseWatcher === 'function';

  function armBack() {
    if (performance.now() < exitArmedUntil) return; // 종료 대기 중에는 잡지 않음
    if (hasCloseWatcher) {
      if (back.watcher) return;
      try {
        const w = new global.CloseWatcher();
        w.onclose = () => {
          if (back.watcher === w) back.watcher = null;
          if (handleBack()) armBack();
          else scheduleRearm();
        };
        back.watcher = w;
      } catch (e) {
        back.watcher = null;
      }
      return;
    }
    if (back.guard) return;
    try {
      global.history.pushState({ bbGuard: true }, '');
      back.guard = true;
    } catch (e) {
      /* 지원하지 않는 환경 */
    }
  }

  // 종료 대기 시간이 지나면 다시 잡는다. CloseWatcher만 (history 가드는 입력 없이 쌓으면 안 되므로 다음 입력 때)
  function scheduleRearm() {
    if (!hasCloseWatcher) return;
    clearTimeout(exitTimer);
    exitTimer = setTimeout(armBack, BACK_EXIT_SEC * 1000 + 50);
  }

  if (!hasCloseWatcher) {
    global.addEventListener('popstate', () => {
      back.guard = false;
      // 여기서 바로 가드를 다시 쌓으면(사용자 입력 없음) 크롬이 직전 기록을 건너뛸 기록으로 표시해
      // 다음 뒤로가기에 앱이 꺼진다 → 다음 사용자 입력 때 쌓는다
      if (!handleBack()) scheduleRearm();
    });
  }
  for (const type of ['pointerup', 'touchend', 'keydown', 'click']) {
    global.addEventListener(type, armBack, { capture: true, passive: true });
  }
  if (hasCloseWatcher) armBack(); // 앱을 열자마자 누른 뒤로가기도 잡힘 (history 가드는 첫 입력 때)

  // ---- PWA: 서비스 워커는 http/https에서만 (file://, Electron 제외) ----
  if ('serviceWorker' in global.navigator && /^https?:$/.test(global.location.protocol)) {
    try {
      const hadController = !!global.navigator.serviceWorker.controller;
      global.navigator.serviceWorker.addEventListener('controllerchange', () => {
        // 이미 설치돼 있던 앱이 새 버전으로 바뀐 경우만 안내
        if (hadController) showToast('새 버전이 적용되었습니다', 4);
      });
      global.navigator.serviceWorker.register('./sw.js').catch(() => {});
    } catch (e) {
      /* 등록 실패해도 게임은 동작 */
    }
  }

  function frame(ts) {
    const dt = app.lastFrameTs === null ? 0 : (ts - app.lastFrameTs) / 1000;
    app.lastFrameTs = ts;
    if (app.screen === 'game' && app.game) {
      app.game.update(dt);
      for (const e of app.game.drainEvents()) audio.onGameEvent(e);
      if (app.game.phase === 'GAME_OVER') finishGame();
    }
    if (app.padFlashUntil && performance.now() > app.padFlashUntil) {
      app.hover = null;
      app.padFlashUntil = 0;
    }
    updatePad();
    if (app.toast && performance.now() > app.toast.until) app.toast = null;
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
      resultTab: app.resultTab,
      hover: app.hover,
      today: today(),
      now: ts / 1000, // 구름 등 장식 애니메이션용
      canFullscreen: canFullscreen(),
      isFullscreen: !!fsElement(),
      iosHint: isIOS,
      toast: app.toast ? app.toast.text : null,
    });
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);
})(window);
