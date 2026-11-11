// Canvas 그리기. 상태를 읽어서 그리기만 하고, 그린 버튼 영역을 돌려준다.
// M1: 도형만 쓰는 임시 화면
(function (global) {
  'use strict';

  const BB = global.BB;
  const C = BB.CONFIG;
  const L = C.LAYOUT;
  const FONT = 'system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  const RESULT_TEXT = {
    HOMERUN: '홈런!',
    DOUBLE: '2루타!',
    SINGLE: '안타!',
    FOUL: '파울',
    OUT_BIP: '범타 아웃',
    SWING_MISS: '헛스윙',
    LOOKING: '루킹 스트라이크',
  };

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    let dpr = 1;
    let hits = [];

    function resize() {
      const vw = global.innerWidth;
      const vh = global.innerHeight;
      const s = Math.min(vw / L.width, vh / L.height);
      const cssW = Math.max(1, Math.floor(L.width * s));
      const cssH = Math.max(1, Math.floor(L.height * s));
      dpr = Math.min(global.devicePixelRatio || 1, L.maxDpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    function toLogical(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return { x: ((clientX - r.left) / r.width) * L.width, y: ((clientY - r.top) / r.height) * L.height };
    }

    function zoneRect() {
      const z = L.zone;
      return { x: z.cx - z.w / 2, y: z.cy - z.h / 2, w: z.w, h: z.h, cw: z.w / 3, ch: z.h / 3 };
    }

    function cellAt(x, y) {
      const z = zoneRect();
      if (x < z.x || y < z.y || x >= z.x + z.w || y >= z.y + z.h) return null;
      return { row: Math.floor((y - z.y) / z.ch), col: Math.floor((x - z.x) / z.cw) };
    }

    function cellCenter(cell) {
      const z = zoneRect();
      return { x: z.x + z.cw * (cell.col + 0.5), y: z.y + z.ch * (cell.row + 0.5) };
    }

    // 공개 전에는 존 중앙을 향하고, 공개 구간에서 실제 코스로 휜다
    function ballPos(pitch, t) {
      const center = { x: L.zone.cx, y: L.zone.cy };
      const target = cellCenter(pitch.cell);
      const u = Math.max(0, 1 - pitch.revealSec / pitch.flightSec);
      const tt = Math.min(t, 1);
      if (tt <= u) return lerp(L.release, center, tt);
      const pu = lerp(L.release, center, u);
      const s = (tt - u) / (1 - u);
      const base = lerp(pu, target, s);
      const bend = C.PITCH_TYPES[pitch.type].bend;
      const k = 4 * s * (1 - s);
      return { x: base.x + bend.x * k, y: base.y - bend.y * k };
    }

    // ---- 그리기 도우미 ----
    function text(str, x, y, size, color, align, weight) {
      ctx.font = (weight || 'normal') + ' ' + size + 'px ' + FONT;
      ctx.fillStyle = color || '#fff';
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(str, x, y);
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function button(id, x, y, w, h, label, opts) {
      opts = opts || {};
      const disabled = !!opts.disabled;
      roundRect(x, y, w, h, 10);
      ctx.fillStyle = disabled ? 'rgba(60,60,60,0.8)' : opts.primary ? '#2f7de1' : 'rgba(20,30,45,0.85)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = disabled ? '#555' : 'rgba(255,255,255,0.5)';
      ctx.stroke();
      text(label, x + w / 2, y + h / 2, opts.size || 22, disabled ? '#888' : '#fff', 'center', 'bold');
      if (!disabled) hits.push({ id, x, y, w, h });
    }

    // ---- 화면별 ----
    function drawField() {
      const sky = ctx.createLinearGradient(0, 0, 0, 300);
      sky.addColorStop(0, '#3b6fb6');
      sky.addColorStop(1, '#9cc4e8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, L.width, 300);
      ctx.fillStyle = '#1f3d2a'; // 먼 관중석
      ctx.fillRect(0, 200, L.width, 60);
      ctx.fillStyle = '#2c7a3f';
      ctx.fillRect(0, 260, L.width, L.height - 260);
      ctx.fillStyle = '#b5834f'; // 마운드
      ctx.beginPath();
      ctx.ellipse(640, 300, 90, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c69460'; // 타석 흙
      ctx.beginPath();
      ctx.ellipse(640, 700, 420, 90, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff'; // 홈플레이트
      ctx.beginPath();
      ctx.moveTo(600, 660);
      ctx.lineTo(680, 660);
      ctx.lineTo(690, 680);
      ctx.lineTo(640, 700);
      ctx.lineTo(590, 680);
      ctx.closePath();
      ctx.fill();
    }

    function drawPitcher(g) {
      let pose = 'set';
      if (g.phase === 'PITCH_WINDUP') pose = g.phaseElapsed() < C.WINDUP_SEC / 2 ? 'leg' : 'back';
      else if (g.phase === 'PITCH_FLIGHT' && g.time - g.releaseTime < 0.2) pose = 'follow';
      const x = 640;
      const y = 296;
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(x - 9, y - 50, 18, 30); // 몸통
      ctx.beginPath();
      ctx.arc(x, y - 58, 8, 0, Math.PI * 2); // 머리
      ctx.fill();
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      // 다리
      ctx.moveTo(x - 5, y - 20);
      ctx.lineTo(x - 8, y);
      ctx.moveTo(x + 5, y - 20);
      if (pose === 'leg') ctx.lineTo(x + 16, y - 26);
      else ctx.lineTo(x + 8, y);
      // 팔
      ctx.moveTo(x + 8, y - 46);
      if (pose === 'back') ctx.lineTo(x + 24, y - 66);
      else if (pose === 'follow') ctx.lineTo(x - 18, y - 28);
      else ctx.lineTo(x + 12, y - 30);
      ctx.stroke();
    }

    function drawBatter(g) {
      const x = 900;
      const y = 650;
      ctx.fillStyle = '#1d2433';
      ctx.fillRect(x - 25, y - 170, 50, 110);
      ctx.beginPath();
      ctx.arc(x, y - 190, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 25, y - 60, 20, 70);
      ctx.fillRect(x + 5, y - 60, 20, 70);
      // 배트: 클릭 시점부터 스윙
      let a = -2.2; // 준비 자세(뒤로 젖힘)
      if (g.click && (g.phase === 'PITCH_FLIGHT' || g.phase === 'RESULT_SHOW')) {
        const s = clamp01((g.time - g.click.atTime) / 0.18);
        a = -2.2 + s * 3.2;
      }
      ctx.save();
      ctx.translate(x - 20, y - 130);
      ctx.rotate(a);
      ctx.fillStyle = '#c9a26b';
      ctx.fillRect(0, -6, 150, 12);
      ctx.restore();
    }

    function drawZone(g, hover) {
      const z = zoneRect();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      if (hover && g.phase === 'PITCH_FLIGHT' && !g.click) {
        ctx.fillStyle = 'rgba(255,255,160,0.22)';
        ctx.fillRect(z.x + hover.col * z.cw, z.y + hover.row * z.ch, z.cw, z.ch);
        ctx.strokeStyle = 'rgba(255,255,160,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(z.x + hover.col * z.cw + 1.5, z.y + hover.row * z.ch + 1.5, z.cw - 3, z.ch - 3);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        ctx.moveTo(z.x + z.cw * i, z.y);
        ctx.lineTo(z.x + z.cw * i, z.y + z.h);
        ctx.moveTo(z.x, z.y + z.ch * i);
        ctx.lineTo(z.x + z.w, z.y + z.ch * i);
      }
      ctx.stroke();
    }

    function drawBall(g) {
      const t = g.ballProgress();
      if (t !== null && t <= 1.15) {
        const p = ballPos(g.pitch, t);
        const tt = Math.min(t, 1);
        const r = L.ballR0 + (L.ballR1 - L.ballR0) * tt * tt;
        ctx.globalAlpha = t > 1 ? 1 - (t - 1) / 0.15 : 1;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#c33';
        ctx.lineWidth = Math.max(1, r / 6);
        ctx.beginPath();
        ctx.arc(p.x - r * 0.9, p.y, r * 0.7, -0.9, 0.9);
        ctx.arc(p.x + r * 0.9, p.y, r * 0.7, Math.PI - 0.9, Math.PI + 0.9);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // 결과 연출 중: 실제 코스를 흐린 공으로 표시
      if (g.phase === 'RESULT_SHOW' && g.last) {
        const p = cellCenter(g.last.pitch.cell);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, L.ballR1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function drawClickMarker(g) {
      if (g.phase !== 'PITCH_FLIGHT' && g.phase !== 'RESULT_SHOW') return;
      const cell = g.click ? g.click.cell : null;
      if (!cell) return;
      const p = cellCenter(cell);
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    function lamp(x, y, on, color) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = on ? color : 'rgba(255,255,255,0.15)';
      ctx.fill();
    }

    function drawHud(g, view) {
      roundRect(16, 16, 280, 204, 12);
      ctx.fillStyle = 'rgba(10,15,25,0.72)';
      ctx.fill();
      const title = g.mode === 'challenge' ? '오늘의 챌린지 ' + view.today.slice(5).replace('-', '/') : g.level.name + ' ' + g.level.baseSpeed + 'km';
      text(g.playerName, 32, 40, 22, '#fff', 'left', 'bold');
      text(title, 32, 70, 18, '#ffd34d', 'left', 'bold');
      text('타석 ' + g.atBat + ' / ' + C.AT_BATS_PER_GAME, 32, 98, 18);
      text('안타 ' + g.stats.hits + '   홈런 ' + g.stats.homers, 32, 126, 18);
      text('타율 ' + BB.formatAvg(g.currentAverage()), 32, 154, 18);
      text('S', 32, 186, 18, '#fff', 'left', 'bold');
      for (let i = 0; i < C.MAX_STRIKES - 1; i++) lamp(60 + i * 26, 186, i < g.strikes, '#f2c230');
      text(g.pitchInAtBat + '구 / 총 ' + g.totalPitches + '구', 280, 186, 16, '#ccc', 'right');
    }

    function drawBubble(g) {
      if (!g.pitch || (g.phase !== 'PITCH_FLIGHT' && g.phase !== 'RESULT_SHOW')) return;
      const s = g.pitchInAtBat + '구 ' + g.pitch.type + ' ' + g.pitch.speed + 'km/h';
      roundRect(640 - 150, 20, 300, 48, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      text(s, 640, 44, 22, '#123', 'center', 'bold');
    }

    function drawCenterMessage(g) {
      if (g.phase === 'AT_BAT_INTRO') {
        text(g.atBat + '번째 타석', 640, 150, 40, '#fff', 'center', 'bold');
        return;
      }
      if (g.phase !== 'RESULT_SHOW' || !g.last) return;
      const last = g.last;
      let main = RESULT_TEXT[last.result];
      if (last.atBatOutcome === 'STRIKEOUT') main = last.result === 'LOOKING' ? '루킹 삼진!' : '삼진 아웃!';
      if (last.foulCapped) main = '파울 → 범타 처리';
      const hit = last.result === 'HOMERUN' || last.result === 'DOUBLE' || last.result === 'SINGLE';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.font = 'bold 56px ' + FONT;
      ctx.textAlign = 'center';
      ctx.strokeText(main, 640, 140);
      text(main, 640, 140, 56, hit ? '#ffd34d' : '#fff', 'center', 'bold');
      let sub = '';
      if (last.timing === 'PERFECT') sub = '타이밍 정확';
      else if (last.timing === 'GOOD') sub = '타이밍 좋음';
      else if (last.timing === 'BAD') sub = last.deltaSec < 0 ? '타이밍 빠름' : '타이밍 늦음';
      if (sub) text(sub, 640, 192, 24, '#eee', 'center', 'bold');
    }

    function drawGame(view) {
      const g = view.game;
      drawField();
      drawPitcher(g);
      drawBatter(g);
      drawZone(g, view.hover);
      drawBall(g);
      drawClickMarker(g);
      drawHud(g, view);
      drawBubble(g);
      drawCenterMessage(g);
      button('pause', L.width - 280, L.height - 70, 120, 50, '일시정지', { size: 20 });
      button('menu', L.width - 150, L.height - 70, 130, 50, '메뉴로', { size: 20 });
      if (g.paused) {
        hits = [];
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, L.width, L.height);
        text('일시정지', 640, 260, 56, '#fff', 'center', 'bold');
        button('resume', 640 - 210, 340, 200, 60, '계속하기', { primary: true });
        button('menu', 640 + 10, 340, 200, 60, '메뉴로');
      }
    }

    function drawTitle(view) {
      const bg = ctx.createLinearGradient(0, 0, 0, L.height);
      bg.addColorStop(0, '#0f2240');
      bg.addColorStop(1, '#1d4d32');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, L.width, L.height);
      text('타자 시점 야구', 640, 56, 52, '#fff', 'center', 'bold');
      text('코스가 보이면, 공이 도착하는 순간에 맞춰 누르세요', 640, 104, 20, '#cfe', 'center');

      // 현재 타자 배너
      const bx = 640 - 330;
      const by = 128;
      roundRect(bx, by, 660, 54, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      const p = view.player;
      if (p) {
        const career = BB.careerAvg(p);
        text('타자', bx + 20, by + 27, 18, '#9ab', 'left');
        text(p.name, bx + 68, by + 27, 24, '#ffd34d', 'left', 'bold');
        text('통산 ' + (career === null ? '-' : BB.formatAvg(career)) + ' (' + p.atBats + '타수)', bx + 270, by + 27, 18, '#dde', 'left');
      } else {
        text('타자 이름을 정해 주세요', bx + 20, by + 27, 20, '#ffd34d', 'left', 'bold');
      }
      button('changeBatter', bx + 660 - 140, by + 7, 130, 40, p ? '타자 변경' : '이름 입력', { size: 18, primary: !p });

      const rec = view.playerData;
      const cw = 300;
      const gap = 40;
      const x0 = (L.width - (cw * 3 + gap * 2)) / 2;
      C.LEVELS.forEach((lv, i) => {
        const x = x0 + i * (cw + gap);
        const y = 200;
        const unlocked = rec.unlocked[i];
        roundRect(x, y, cw, 220, 16);
        ctx.fillStyle = unlocked ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.strokeStyle = unlocked ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        text(lv.name, x + cw / 2, y + 44, 36, unlocked ? '#ffd34d' : '#888', 'center', 'bold');
        text(lv.baseSpeed + 'km/h', x + cw / 2, y + 88, 24, unlocked ? '#fff' : '#888', 'center');
        const best = rec.best[i];
        if (unlocked) {
          text('최고 타율 ' + (best === null ? '-' : BB.formatAvg(best)), x + cw / 2, y + 128, 20, '#dde', 'center');
          hits.push({ id: 'level:' + i, x, y, w: cw, h: 220 });
          text('플레이 ▶', x + cw / 2, y + 180, 22, '#8fd', 'center', 'bold');
        } else {
          text('🔒 잠김', x + cw / 2, y + 128, 20, '#aaa', 'center');
          const need = Math.ceil(C.UNLOCK_AVG * C.AT_BATS_PER_GAME - 1e-9);
          text(C.LEVELS[i - 1].name + ' 타율 ' + BB.formatAvg(C.UNLOCK_AVG) + ' 이상', x + cw / 2, y + 168, 18, '#aaa', 'center');
          text('(' + C.AT_BATS_PER_GAME + '타석 ' + need + '안타)', x + cw / 2, y + 192, 16, '#999', 'center');
        }
      });

      // 오늘의 챌린지
      const cx = 640 - 300;
      const cy = 450;
      roundRect(cx, cy, 600, 110, 16);
      ctx.fillStyle = 'rgba(255,211,77,0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,211,77,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      text('오늘의 챌린지 ' + view.today.slice(5).replace('-', '/'), 640, cy + 36, 28, '#ffd34d', 'center', 'bold');
      const d = rec.daily && rec.daily.date === view.today ? '오늘 기록 ' + BB.formatAvg(rec.daily.avg) + ' (다시 하면 연습)' : '모두 같은 투구 순서 · ' + C.LEVELS[C.CHALLENGE.level - 1].name + ' 규칙 · 첫 판만 기록';
      text(d, 640, cy + 76, 18, '#eee', 'center');
      hits.push({ id: 'challenge', x: cx, y: cy, w: 600, h: 110 });

      text('조작: 마우스/터치로 칸 선택 · 키보드 7 8 9 / 4 5 6 / 1 2 3 또는 Q W E / A S D / Z X C', 640, 600, 16, '#bcd', 'center');
      button('players', 20, L.height - 70, 170, 50, '타자 기록', { size: 18 });
      button('reset', L.width - 190, L.height - 70, 170, 50, '기록 초기화', { size: 18 });
    }

    // 타자 기록(순위표)
    function drawPlayers(view) {
      ctx.fillStyle = '#0f1c30';
      ctx.fillRect(0, 0, L.width, L.height);
      text('타자 기록', 640, 56, 36, '#fff', 'center', 'bold');
      const list = view.ranking;
      const per = C.LEADERBOARD_PAGE;
      const pages = Math.max(1, Math.ceil(list.length / per));
      const page = Math.min(view.page, pages - 1);
      const cols = [
        ['순위', 90, 'center'], ['이름', 140, 'left'], ['통산 타율', 430, 'center'], ['타수', 540, 'center'],
        ['Lv.1 최고', 650, 'center'], ['Lv.2 최고', 760, 'center'], ['Lv.3 최고', 870, 'center'], ['게임', 970, 'center'],
      ];
      for (const [label, x, align] of cols) text(label, x, 112, 17, '#9ab', align, 'bold');
      if (!list.length) {
        text('아직 등록된 타자가 없습니다', 640, 300, 24, '#ccd', 'center');
      }
      const avgOr = (x) => (x === null ? '-' : BB.formatAvg(x));
      list.slice(page * per, page * per + per).forEach((p, i) => {
        const y = 140 + i * 54;
        const isCurrent = view.record.current === p.key;
        roundRect(60, y, 1000, 46, 8);
        ctx.fillStyle = isCurrent ? 'rgba(255,211,77,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.fill();
        if (isCurrent) {
          ctx.strokeStyle = 'rgba(255,211,77,0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        const cy = y + 23;
        const vals = [
          String(page * per + i + 1), p.name, avgOr(p.career), String(p.atBats),
          avgOr(p.best[0]), avgOr(p.best[1]), avgOr(p.best[2]), String(p.games),
        ];
        vals.forEach((v, k) => text(v, cols[k][1], cy, k === 1 || k === 2 ? 22 : 19, k === 2 ? '#ffd34d' : '#fff', cols[k][2], k <= 2 ? 'bold' : 'normal'));
        hits.push({ id: 'player:' + p.key, x: 60, y, w: 1000, h: 46 });
        button('delete:' + p.key, 1080, y + 3, 90, 40, '삭제', { size: 16 });
      });
      text('행을 누르면 그 타자로 변경합니다', 640, 590, 16, '#9ab', 'center');
      if (pages > 1) {
        button('page:prev', 640 - 170, 640, 80, 50, '◀', { disabled: page === 0 });
        text(page + 1 + ' / ' + pages, 640, 665, 20, '#fff', 'center');
        button('page:next', 640 + 90, 640, 80, 50, '▶', { disabled: page >= pages - 1 });
      }
      button('menu', L.width - 150, L.height - 70, 130, 50, '메뉴로', { size: 20 });
    }

    function drawResult(view) {
      const r = view.result;
      const s = r.summary;
      ctx.fillStyle = '#0f1c30';
      ctx.fillRect(0, 0, L.width, L.height);
      const title = s.mode === 'challenge' ? '오늘의 챌린지 ' + r.date.slice(5).replace('-', '/') + (r.official ? '' : ' (연습)') : C.LEVELS[s.levelIndex].name + ' 결과';
      text(r.playerName + ' · ' + title, 640, 60, 30, '#cde', 'center', 'bold');
      text('이번 타율', 640, 118, 24, '#aaa', 'center');
      text(BB.formatAvg(s.avg), 640, 196, 104, '#ffd34d', 'center', 'bold');
      let y = 280;
      const avgOr = (x) => (x === null ? '-' : BB.formatAvg(x));
      if (s.mode === 'normal') {
        text('통산 타율 ' + avgOr(r.careerBefore) + ' → ' + avgOr(r.careerAfter) + '  (' + r.player.hits + '안타 / ' + r.player.atBats + '타수)', 640, y, 24, '#fff', 'center', 'bold');
      } else {
        text('챌린지는 통산 타율에 반영되지 않습니다', 640, y, 20, '#9ab', 'center');
      }
      y += 50;
      if (r.newRecord) {
        text('NEW RECORD', 640, y, 34, '#ff6b6b', 'center', 'bold');
        y += 46;
      }
      if (r.unlockedLevel !== null) {
        text(C.LEVELS[r.unlockedLevel].name + ' 해제!', 640, y, 34, '#7cf29a', 'center', 'bold');
        y += 46;
      }
      const line1 = '안타 ' + s.hits + ' (단타 ' + s.singles + ' · 2루타 ' + s.doubles + ' · 홈런 ' + s.homers + ')';
      const line2 = '삼진 ' + s.strikeouts + ' · 범타 ' + s.outs + ' · 총 투구수 ' + s.totalPitches + ' · 정확 타이밍 ' + s.perfects;
      text(line1, 640, y + 20, 24, '#fff', 'center');
      text(line2, 640, y + 58, 22, '#ccd', 'center');

      const bw = 200;
      const by = 600;
      const canNext = s.mode === 'normal' && s.levelIndex + 1 < C.LEVELS.length && r.player.unlocked[s.levelIndex + 1];
      const buttons = [['retry', '다시하기', true]];
      if (canNext) buttons.push(['next', '다음 레벨', false]);
      buttons.push(['menu', '메뉴로', false]);
      const total = buttons.length * bw + (buttons.length - 1) * 24;
      buttons.forEach(([id, label, primary], i) => button(id, (L.width - total) / 2 + i * (bw + 24), by, bw, 64, label, { primary }));
    }

    function draw(view) {
      hits = [];
      ctx.setTransform(canvas.width / L.width, 0, 0, canvas.height / L.height, 0, 0);
      ctx.clearRect(0, 0, L.width, L.height);
      if (view.screen === 'title') drawTitle(view);
      else if (view.screen === 'game') drawGame(view);
      else if (view.screen === 'result') drawResult(view);
      else if (view.screen === 'players') drawPlayers(view);
      return hits;
    }

    resize();
    return { resize, toLogical, cellAt, draw };
  }

  Object.assign(BB, { createRenderer });
})(window);
