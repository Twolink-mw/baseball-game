// Canvas 그리기. 상태를 읽어서 그리기만 하고, 그린 버튼 영역을 돌려준다.
// 구장/투수/타자 그림은 scene.js, 여기서는 공·존·연출·HUD·각 화면을 그린다.
(function (global) {
  'use strict';

  const BB = global.BB;
  const C = BB.CONFIG;
  const L = C.LAYOUT;
  const S = BB.scene;
  const FX = C.FX;
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
  const HITS = { HOMERUN: 1, DOUBLE: 1, SINGLE: 1 };
  const BOARD_FLASH = { HOMERUN: 'HOME RUN!', DOUBLE: '2루타!', SINGLE: 'HIT!' };

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // 공 원근: 반지름이 거리에 반비례하도록. t=0에서 ballR0, t=1에서 ballR1
  const PA = L.ballR0 / (L.ballR1 - L.ballR0);
  const ballRadius = (t) => (L.ballR1 * PA) / Math.max(PA + 1 - t, 0.05);
  // 화면상 진행도(원근 때문에 처음엔 느리고 도착 직전에 빨라짐). t=0 → 0, t=1 → 1
  const screenProgress = (t) => (1 / Math.max(PA + 1 - t, 0.05) - 1 / (PA + 1)) / (1 / PA - 1 / (PA + 1));

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    let dpr = 1;
    let hits = [];
    let bg = null; // 고정 배경 캐시(실제 픽셀 크기)

    function resize() {
      const vw = global.innerWidth;
      const vh = global.innerHeight;
      const s = Math.min(vw / L.width, vh / L.height);
      const cssW = Math.max(1, Math.floor(L.width * s));
      const cssH = Math.max(1, Math.floor(L.height * s));
      dpr = Math.min(global.devicePixelRatio || 1, L.maxDpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h || !bg) {
        canvas.width = w;
        canvas.height = h;
        bg = S.buildBackground(w, h);
      }
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

    // 공 위치. 공개 전(시간 기준)에는 존 중앙을 향하고, 공개 구간에서 실제 코스로 휜다.
    // 화면 이동량은 원근 진행도를 따른다. t>1이면 포수 쪽(아래)으로 빠져나간다.
    function ballPos(pitch, t) {
      const center = { x: L.zone.cx, y: L.zone.cy };
      const target = cellCenter(pitch.cell);
      const u = Math.max(0, 1 - pitch.revealSec / pitch.flightSec);
      const tt = Math.min(t, 1);
      const sp = screenProgress(tt);
      const su = screenProgress(u);
      let p;
      if (tt <= u) {
        p = lerp(L.release, center, sp);
      } else {
        const pu = lerp(L.release, center, su);
        const s = su < 1 ? (sp - su) / (1 - su) : 1;
        const base = lerp(pu, target, s);
        const bend = C.PITCH_TYPES[pitch.type].bend;
        const k = 4 * s * (1 - s);
        p = { x: base.x + bend.x * k, y: base.y - bend.y * k };
      }
      if (t > 1) p = { x: p.x, y: p.y + (t - 1) * 600 };
      return p;
    }

    // ---- 그리기 도우미 ----
    function text(str, x, y, size, color, align, weight) {
      ctx.font = (weight || 'normal') + ' ' + size + 'px ' + FONT;
      ctx.fillStyle = color || '#fff';
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(str, x, y);
    }

    // 외곽선 있는 큰 글자
    function outlined(str, x, y, size, color) {
      ctx.font = 'bold ' + size + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, size / 8);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color;
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

    // 음소거 토글 (M 키로도 전환)
    function muteButton(view, x, y, w, h) {
      const muted = view.record && view.record.settings.muted;
      button('mute', x, y, w, h, muted ? '소리 끔' : '소리 켬', { size: 18 });
      if (muted) {
        ctx.strokeStyle = '#ff8a8a';
        ctx.lineWidth = 2;
        roundRect(x, y, w, h, 10);
        ctx.stroke();
      }
    }

    // 구장 배경(하늘+캐시) + 덮개
    function drawBackdrop(now, shade) {
      S.drawSky(ctx, now);
      if (bg) ctx.drawImage(bg, 0, 0, L.width, L.height);
      if (shade) {
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, L.width, L.height);
      }
    }

    // ---- 게임 화면 ----
    function drawPitcher(g) {
      let el = 0;
      // 와인드업: 멈춤 구간은 세트 자세, 이후 투구 동작 진행도(0~1)
      if (g.phase === 'PITCH_WINDUP') el = Math.max(0, (g.phaseElapsed() - g.pitch.holdSec) / g.pitch.motionSec);
      else if (g.phase === 'PITCH_FLIGHT') el = g.time - g.releaseTime;
      else if (g.phase === 'RESULT_SHOW') el = g.phaseElapsed();
      S.drawPitcher(ctx, S.pitcherPose(g.phase, el, el));
    }

    function drawBatter(g) {
      let swing = null;
      if (g.click && (g.phase === 'PITCH_FLIGHT' || g.phase === 'RESULT_SHOW')) {
        swing = clamp01((g.time - g.click.atTime) / FX.swingSec);
      }
      // 그림은 좌타자(화면 오른쪽, 1루 쪽) 기준. 우타자는 좌우를 뒤집어 화면 왼쪽(3루 쪽)에 그린다
      if (g.bats === 'R') {
        ctx.save();
        ctx.translate(L.width, 0);
        ctx.scale(-1, 1);
        S.drawBatter(ctx, swing);
        ctx.restore();
      } else {
        S.drawBatter(ctx, swing);
      }
    }

    function drawZone(g, hover) {
      const z = zoneRect();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      if (hover && g.phase === 'PITCH_FLIGHT' && !g.click) {
        ctx.fillStyle = 'rgba(255,255,160,0.22)';
        ctx.fillRect(z.x + hover.col * z.cw, z.y + hover.row * z.ch, z.cw, z.ch);
        ctx.strokeStyle = 'rgba(255,255,160,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(z.x + hover.col * z.cw + 1.5, z.y + hover.row * z.ch + 1.5, z.cw - 3, z.ch - 3);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(z.x + z.cw * i, z.y);
        ctx.lineTo(z.x + z.cw * i, z.y + z.h);
        ctx.moveTo(z.x, z.y + z.ch * i);
        ctx.lineTo(z.x + z.w, z.y + z.ch * i);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(z.x, z.y, z.w, z.h);
    }

    function ballSprite(p, r, alpha, spin) {
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (r >= 4) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(spin);
        ctx.strokeStyle = '#c33';
        ctx.lineWidth = Math.max(1, r / 7);
        ctx.beginPath();
        ctx.arc(-r * 0.9, 0, r * 0.7, -0.9, 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.9, 0, r * 0.7, Math.PI - 0.9, Math.PI + 0.9);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function drawBall(g) {
      const t = g.ballProgress();
      if (t !== null && t >= 0 && t <= 1.2) {
        const fade = t > 1 ? Math.max(0, 1 - (t - 1) / 0.2) : 1;
        for (let k = 3; k >= 1; k--) {
          const tk = t - (k * FX.trailSec) / g.pitch.flightSec;
          if (tk < 0) continue;
          ballSprite(ballPos(g.pitch, tk), ballRadius(tk) * 0.9, (0.22 / k) * fade, 0);
        }
        ballSprite(ballPos(g.pitch, t), ballRadius(t), fade, t * g.pitch.flightSec * 40);
      }
      // 결과 연출 중: 실제 코스를 점선 원으로 표시
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

    // ---- 타구 연출 ----
    // 타이밍이 빠르면 당겨 친 방향(좌타는 화면 오른쪽, 우타는 왼쪽), 늦으면 반대 방향.
    // 몸쪽 코스(타자 쪽 칸)는 당기는 쪽으로 조금 더 간다
    function hitDir(last, bats) {
      const pull = bats === 'R' ? -1 : 1;
      let d = last.deltaSec === null ? 0 : (pull * -last.deltaSec) / 0.1;
      d += (last.pitch.cell.col - 1) * 0.25;
      return Math.max(-1, Math.min(1, d));
    }

    function flightSpec(g) {
      const last = g.last;
      const d = hitDir(last, g.bats);
      const side = d >= 0 ? 1 : -1;
      switch (last.result) {
        case 'HOMERUN':
          return { dur: 1.0, tx: 640 + d * 380, ty: 110, apex: 300, r1: 2 };
        case 'DOUBLE':
          return { dur: 0.9, tx: 640 + side * 220 + d * 300, ty: S.fenceY() - 8, apex: 170, r1: 3 };
        case 'SINGLE':
          return { dur: 0.7, tx: 640 + d * 300, ty: 300, apex: 60, r1: 4 };
        case 'FOUL':
          return { dur: 0.6, tx: 640 + side * 760, ty: -140, apex: 0, r1: 34 };
        case 'OUT_BIP':
          return g.totalPitches % 2
            ? { dur: 1.0, tx: 640 + d * 150, ty: 250, apex: 420, r1: 4 } // 뜬공
            : { dur: 0.8, tx: 640 + d * 120, ty: 322, apex: 0, r1: 4, ground: true }; // 땅볼
      }
      return null;
    }

    function flightPos(spec, from, e) {
      const u = clamp01(e / spec.dur);
      const uu = 1 - (1 - u) * (1 - u);
      const x = from.x + (spec.tx - from.x) * uu;
      let y = from.y + (spec.ty - from.y) * uu - spec.apex * 4 * uu * (1 - uu);
      if (spec.ground) y -= 36 * Math.abs(Math.sin(uu * Math.PI * 3)) * (1 - uu);
      return { x, y, r: L.ballR1 + (spec.r1 - L.ballR1) * uu };
    }

    function isContact(last) {
      return !!last.clickCell && last.result !== 'SWING_MISS' && last.result !== 'LOOKING';
    }

    function drawHitFx(g) {
      if (g.phase !== 'RESULT_SHOW' || !g.last || !isContact(g.last)) return;
      const last = g.last;
      const e = g.phaseElapsed();
      const from = cellCenter(last.pitch.cell);
      // 맞는 순간 섬광
      if (e < FX.flashSec) {
        const k = e / FX.flashSec;
        ctx.save();
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#fff8d0';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(from.x + Math.cos(a) * (14 + 30 * k), from.y + Math.sin(a) * (14 + 30 * k));
          ctx.lineTo(from.x + Math.cos(a) * (30 + 60 * k), from.y + Math.sin(a) * (30 + 60 * k));
          ctx.stroke();
        }
        ctx.restore();
      }
      const spec = flightSpec(g);
      if (!spec) return;
      const fade = e > spec.dur ? Math.max(0, 1 - (e - spec.dur) / 0.25) : 1;
      if (fade > 0) {
        // 궤적 꼬리
        ctx.save();
        ctx.globalAlpha = 0.45 * fade;
        ctx.strokeStyle = '#fff';
        ctx.lineCap = 'round';
        let prev = flightPos(spec, from, e);
        for (let k = 1; k <= 6; k++) {
          const p = flightPos(spec, from, Math.max(0, e - k * 0.03));
          ctx.lineWidth = Math.max(1, prev.r * 0.7 * (1 - k / 7));
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          prev = p;
        }
        ctx.restore();
        const p = flightPos(spec, from, e);
        ballSprite(p, p.r, fade, e * 30);
      }
      if (last.result === 'HOMERUN') drawFireworks(g, e);
    }

    // 홈런 불꽃: 위치와 색은 타석마다 고정된 장식용 RNG로 정함(게임 RNG와 무관)
    function drawFireworks(g, e) {
      const rng = BB.createRng(g.totalPitches * 7919 + g.atBat);
      const colors = ['#ffd34d', '#ff6b6b', '#7cf29a', '#7cc4ff', '#ffffff'];
      for (let b = 0; b < 3; b++) {
        const t0 = 0.45 + b * 0.15;
        const cx = 260 + rng.next() * 760;
        const cy = 50 + rng.next() * 70;
        const col = colors[rng.int(colors.length)];
        const k = (e - t0) / 0.7;
        if (k <= 0 || k >= 1) continue;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = col;
        const rr = 70 * (1 - (1 - k) * (1 - k));
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + 30 * k * k, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
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
      const title = g.mode === 'challenge' ? '오늘의 챌린지 ' + view.today.slice(5).replace('-', '/') : g.level.name + ' ' + g.level.title + ' ' + g.level.baseSpeed + 'km';
      text(g.playerName + (g.bats === 'L' ? ' (좌타)' : ' (우타)'), 32, 40, 22, '#fff', 'left', 'bold');
      text(title, 32, 70, 18, '#ffd34d', 'left', 'bold');
      text('타석 ' + g.atBat + ' / ' + C.AT_BATS_PER_GAME, 32, 98, 18);
      text('안타 ' + g.stats.hits + '   홈런 ' + g.stats.homers, 32, 126, 18);
      text('타율 ' + BB.formatAvg(g.currentAverage()), 32, 154, 18);
      text('S', 32, 186, 18, '#fff', 'left', 'bold');
      for (let i = 0; i < C.MAX_STRIKES - 1; i++) lamp(60 + i * 26, 186, i < g.strikes, '#f2c230');
      text(g.pitchInAtBat + '구 / 총 ' + g.totalPitches + '구', 280, 186, 16, '#ccc', 'right');
    }

    function drawBoard(g, now) {
      const flash = g.phase === 'RESULT_SHOW' && g.last ? BOARD_FLASH[g.last.result] || null : null;
      S.drawScoreboard(ctx, 'BB 스타디움', g.playerName + ' · ' + BB.formatAvg(g.currentAverage()), flash, now);
    }

    // ---- 투구 기록 패널 (화면 오른쪽) ----
    const LOG_LABEL = { HOMERUN: '홈런', DOUBLE: '2루타', SINGLE: '안타', FOUL: '파울', OUT_BIP: '범타', SWING_MISS: '헛스윙', LOOKING: '루킹' };
    const LOG_COLOR = { HOMERUN: '#ffd34d', DOUBLE: '#ffd34d', SINGLE: '#ffd34d', FOUL: '#dfe6ee', OUT_BIP: '#9aa7b8', SWING_MISS: '#ff8a8a', LOOKING: '#ff8a8a' };

    // 타석 결과 한마디 (직전 타석 제목용)
    function atBatOutcomeLabel(list) {
      const last = list[list.length - 1];
      if (!last) return '';
      if (last.result === 'SWING_MISS' || last.result === 'LOOKING') return '삼진';
      return LOG_LABEL[last.result];
    }

    function logRow(e, x, w, ry, size, dim) {
      ctx.globalAlpha = dim ? 0.75 : 1;
      ctx.beginPath();
      ctx.arc(x + 18, ry, size === 14 ? 9 : 8, 0, Math.PI * 2);
      ctx.fillStyle = LOG_COLOR[e.result];
      ctx.fill();
      text(String(e.n), x + 18, ry + 1, size - 2, '#111', 'center', 'bold');
      text(e.type, x + 34, ry, size, '#fff', 'left', 'bold');
      text(String(e.speed), x + 130, ry, size, '#cde', 'right');
      text(LOG_LABEL[e.result], x + w - 10, ry, size, LOG_COLOR[e.result], 'right', 'bold');
      ctx.globalAlpha = 1;
    }

    // 위: 이번 타석(미니 존 + 목록), 아래: 직전 타석(다음 타석이 끝날 때까지 유지)
    function drawPitchLog(g) {
      const cur = g.history.filter((h) => h.atBat === g.atBat);
      const prev = g.atBat > 1 ? g.history.filter((h) => h.atBat === g.atBat - 1) : [];
      const x = 1066;
      const y = 150;
      const w = 200;
      const bottom = 640; // 오른쪽 아래 버튼 위까지
      const cs = 34; // 미니 존 칸 크기
      const zx = x + (w - cs * 3) / 2;
      const zy = y + 34;
      const rowY = zy + cs * 3 + 14;
      const CUR_H = 24;
      const PREV_H = 21;
      // 줄 수가 넘치면 직전 타석은 마지막 몇 줄만
      const curRows = Math.max(1, cur.length);
      let prevRows = prev.length;
      const room = bottom - 8 - (rowY + curRows * CUR_H) - (prev.length ? 30 : 0);
      if (prevRows * PREV_H > room) prevRows = Math.max(0, Math.floor(room / PREV_H));
      const prevTop = rowY + curRows * CUR_H + 6;
      const h = (prev.length ? prevTop + 26 + prevRows * PREV_H : rowY + curRows * CUR_H) - y + 8;
      roundRect(x, y, w, h, 12);
      ctx.fillStyle = 'rgba(10,15,25,0.85)';
      ctx.fill();
      text(g.atBat + '번째 타석', x + 12, y + 18, 15, '#9ab', 'left', 'bold');
      // 미니 존: 공이 들어온 칸에 투구 번호
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(zx + cs * i, zy);
        ctx.lineTo(zx + cs * i, zy + cs * 3);
        ctx.moveTo(zx, zy + cs * i);
        ctx.lineTo(zx + cs * 3, zy + cs * i);
        ctx.stroke();
      }
      const center = (c) => ({ x: zx + cs * (c.col + 0.5), y: zy + cs * (c.row + 0.5) });
      const last = cur[cur.length - 1];
      if (last && last.clickCell) {
        // 직전 투구에서 휘두른 칸
        const p = center(last.clickCell);
        ctx.strokeStyle = '#ffd34d';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - cs / 2 + 2, p.y - cs / 2 + 2, cs - 4, cs - 4);
      }
      const perCell = {};
      const OFFS = [[0, 0], [-8, -8], [8, 8], [8, -8], [-8, 8]];
      cur.forEach((e) => {
        const k = e.cell.row * 3 + e.cell.col;
        const o = OFFS[(perCell[k] = (perCell[k] || 0) + 1) - 1] || [0, 0];
        const p = center(e.cell);
        ctx.beginPath();
        ctx.arc(p.x + o[0], p.y + o[1], 9, 0, Math.PI * 2);
        ctx.fillStyle = LOG_COLOR[e.result];
        ctx.fill();
        text(String(e.n), p.x + o[0], p.y + o[1] + 1, 12, '#111', 'center', 'bold');
      });
      if (!cur.length) text('첫 공을 기다리는 중', x + w / 2, rowY + 12, 14, '#789', 'center');
      cur.forEach((e, i) => logRow(e, x, w, rowY + i * CUR_H + 12, 14, false));
      // 직전 타석
      if (prev.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 10, prevTop);
        ctx.lineTo(x + w - 10, prevTop);
        ctx.stroke();
        text('직전 타석', x + 12, prevTop + 14, 14, '#9ab', 'left', 'bold');
        const out = atBatOutcomeLabel(prev);
        text(out, x + w - 10, prevTop + 14, 14, out === '삼진' ? '#ff8a8a' : out === '범타' ? '#9aa7b8' : '#ffd34d', 'right', 'bold');
        const shown = prev.slice(prev.length - prevRows);
        shown.forEach((e, i) => logRow(e, x, w, prevTop + 26 + i * PREV_H + 10, 13, true));
      }
    }

    function drawBubble(g) {
      if (!g.pitch || (g.phase !== 'PITCH_FLIGHT' && g.phase !== 'RESULT_SHOW')) return;
      const s = g.pitchInAtBat + '구 ' + g.pitch.type + ' ' + g.pitch.speed + 'km/h';
      roundRect(640 - 150, 20, 300, 48, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      text(s, 640, 44, 22, '#123', 'center', 'bold');
    }

    // 타이밍 피드백: 등급 + 얼마나 빠르고 늦었는지
    function timingBadge(last) {
      if (!last.timing || last.timing === 'NONE' || last.deltaSec === null) return null;
      const d = last.deltaSec;
      const detail = Math.abs(d) < 0.005 ? '딱 맞음' : Math.abs(d).toFixed(2) + '초 ' + (d < 0 ? '빠름' : '늦음');
      if (last.timing === 'PERFECT') return { label: '정확', detail, color: '#ffd34d' };
      if (last.timing === 'GOOD') return { label: '좋음', detail, color: '#7cf29a' };
      return d < 0 ? { label: '빠름', detail, color: '#7cc4ff' } : { label: '늦음', detail, color: '#ff9f5a' };
    }

    // 튀어나오는 크기 (0→1.15→1)
    function popScale(e) {
      const k = clamp01(e / 0.22);
      const c1 = 2.2;
      return 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
    }

    function drawCenterMessage(g) {
      if (g.phase === 'AT_BAT_INTRO') {
        const e = g.phaseElapsed();
        ctx.globalAlpha = clamp01(e / 0.2) * clamp01((C.AT_BAT_INTRO_SEC - e) / 0.2 + 0.3);
        outlined(g.atBat + '번째 타석', 640, 150 - 10 * clamp01(e / 0.3), 44, '#fff');
        ctx.globalAlpha = 1;
        return;
      }
      if (g.phase !== 'RESULT_SHOW' || !g.last) return;
      const last = g.last;
      const e = g.phaseElapsed();
      let main = RESULT_TEXT[last.result];
      if (last.atBatOutcome === 'STRIKEOUT') main = last.result === 'LOOKING' ? '루킹 삼진!' : '삼진 아웃!';
      if (last.foulCapped) main = '파울 → 범타 처리';
      const hit = !!HITS[last.result];
      const color = last.result === 'HOMERUN' ? '#ffd34d' : hit ? '#ffe9a0' : last.atBatOutcome === 'STRIKEOUT' ? '#ff8a8a' : '#fff';
      ctx.save();
      ctx.translate(640, 140);
      const sc = Math.max(0.01, popScale(e));
      ctx.scale(sc, sc);
      outlined(main, 0, 0, last.result === 'HOMERUN' ? 72 : 56, color);
      ctx.restore();
      const badge = timingBadge(last);
      if (badge) {
        ctx.globalAlpha = clamp01((e - 0.08) / 0.15);
        const w = 250;
        roundRect(640 - w / 2, 184, w, 40, 20);
        ctx.fillStyle = 'rgba(10,15,25,0.75)';
        ctx.fill();
        ctx.strokeStyle = badge.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        text(badge.label, 640 - w / 2 + 22, 204, 22, badge.color, 'left', 'bold');
        text(badge.detail, 640 + w / 2 - 22, 204, 18, '#eee', 'right');
        ctx.globalAlpha = 1;
      }
    }
    // 홈런 직후 짧은 화면 흔들림
    function shakeOffset(g) {
      if (g.phase !== 'RESULT_SHOW' || !g.last || g.last.result !== 'HOMERUN') return 0;
      const e = g.phaseElapsed();
      if (e > 0.35) return 0;
      return Math.sin(e * 90) * 6 * (1 - e / 0.35);
    }

    function drawGame(view) {
      const g = view.game;
      const now = view.now;
      const sh = g.paused ? 0 : shakeOffset(g);
      ctx.save();
      ctx.translate(0, sh);
      drawBackdrop(now);
      drawBoard(g, now);
      drawPitcher(g);
      drawBatter(g);
      drawZone(g, view.hover);
      drawBall(g);
      drawClickMarker(g);
      drawHitFx(g);
      ctx.restore();
      drawHud(g, view);
      drawPitchLog(g);
      drawBubble(g);
      drawCenterMessage(g);
      muteButton(view, L.width - 410, L.height - 70, 120, 50);
      button('pause', L.width - 280, L.height - 70, 120, 50, '일시정지', { size: 20 });
      button('menu', L.width - 150, L.height - 70, 130, 50, '메뉴로', { size: 20 });
      if (g.paused) {
        hits = [];
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, L.width, L.height);
        drawPitchLog(g); // 멈춘 채로 투구 기록을 볼 수 있게 덮개 위에 다시 그림
        text('일시정지', 640, 260, 56, '#fff', 'center', 'bold');
        button('resume', 640 - 210, 340, 200, 60, '계속하기', { primary: true });
        button('menu', 640 + 10, 340, 200, 60, '메뉴로');
      }
    }

    function drawTitle(view) {
      drawBackdrop(view.now, 'rgba(8,14,26,0.62)');
      outlined('타자 시점 야구', 640, 56, 52, '#fff');
      text('코스가 보이면, 공이 도착하는 순간에 맞춰 누르세요', 640, 104, 20, '#cfe', 'center');

      // 현재 타자 배너
      const bx = 640 - 330;
      const by = 128;
      roundRect(bx, by, 660, 54, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      const p = view.player;
      if (p) {
        const career = BB.careerAvg(p);
        text(p.bats === 'L' ? '좌타' : '우타', bx + 20, by + 27, 18, '#9cf', 'left', 'bold');
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
        ctx.fillStyle = unlocked ? 'rgba(20,32,52,0.82)' : 'rgba(0,0,0,0.6)';
        ctx.fill();
        ctx.strokeStyle = unlocked ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        text(lv.name, x + cw / 2, y + 44, 36, unlocked ? '#ffd34d' : '#888', 'center', 'bold');
        text(lv.title + ' · ' + lv.baseSpeed + 'km/h', x + cw / 2, y + 88, 24, unlocked ? '#fff' : '#888', 'center');
        const best = rec.best[i];
        if (unlocked) {
          text('최고 타율 ' + (best === null ? '-' : BB.formatAvg(best)), x + cw / 2, y + 128, 20, '#dde', 'center');
          hits.push({ id: 'level:' + i, x, y, w: cw, h: 220 });
          text('플레이 ▶', x + cw / 2, y + 180, 22, '#8fd', 'center', 'bold');
        } else {
          text('🔒 잠김', x + cw / 2, y + 128, 20, '#aaa', 'center');
          const need = Math.ceil(C.UNLOCK_AVG[i - 1] * C.AT_BATS_PER_GAME - 1e-9);
          text(C.LEVELS[i - 1].name + ' 타율 ' + BB.formatAvg(C.UNLOCK_AVG[i - 1]) + ' 이상', x + cw / 2, y + 168, 18, '#aaa', 'center');
          text('(' + C.AT_BATS_PER_GAME + '타석 ' + need + '안타)', x + cw / 2, y + 192, 16, '#999', 'center');
        }
      });

      // 오늘의 챌린지
      const cx = 640 - 300;
      const cy = 450;
      roundRect(cx, cy, 600, 110, 16);
      ctx.fillStyle = 'rgba(60,46,10,0.8)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,211,77,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      text('오늘의 챌린지 ' + view.today.slice(5).replace('-', '/'), 640, cy + 36, 28, '#ffd34d', 'center', 'bold');
      const d = rec.daily && rec.daily.date === view.today ? '오늘 기록 ' + BB.formatAvg(rec.daily.avg) + ' (다시 하면 연습)' : '모두 같은 투구 순서 · ' + C.LEVELS[C.CHALLENGE.level - 1].name + ' 규칙 · 첫 판만 기록';
      text(d, 640, cy + 76, 18, '#eee', 'center');
      hits.push({ id: 'challenge', x: cx, y: cy, w: 600, h: 110 });

      text('조작: 마우스/터치로 칸 선택 · 키보드 7 8 9 / 4 5 6 / 1 2 3 또는 Q W E / A S D / Z X C · M 소리 켜기/끄기', 640, 600, 16, '#bcd', 'center');
      button('players', 20, L.height - 70, 170, 50, '타자 기록', { size: 18 });
      muteButton(view, L.width - 150, 16, 130, 44);
      button('reset', L.width - 190, L.height - 70, 170, 50, '기록 초기화', { size: 18 });
    }

    // 타자 기록(순위표)
    function drawPlayers(view) {
      drawBackdrop(view.now, 'rgba(8,14,26,0.86)');
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
      drawBackdrop(view.now, 'rgba(8,14,26,0.84)');
      const title = s.mode === 'challenge' ? '오늘의 챌린지 ' + r.date.slice(5).replace('-', '/') + (r.official ? '' : ' (연습)') : C.LEVELS[s.levelIndex].name + ' 결과';
      text(r.playerName + ' · ' + title, 640, 60, 30, '#cde', 'center', 'bold');
      const e = view.now - (r.shownAt || 0); // 결과 화면에 들어온 뒤 경과(초)
      text('이번 타율', 640, 118, 24, '#aaa', 'center');
      // 안타 수를 하나씩 세며 타율이 올라감
      const k = clamp01(e / 0.7);
      const shownHits = Math.round((1 - (1 - k) * (1 - k)) * s.hits);
      text(BB.formatAvg(shownHits / C.AT_BATS_PER_GAME), 640, 196, 104, '#ffd34d', 'center', 'bold');
      let y = 280;
      const avgOr = (x) => (x === null ? '-' : BB.formatAvg(x));
      if (s.mode === 'normal') {
        text('통산 타율 ' + avgOr(r.careerBefore) + ' → ' + avgOr(r.careerAfter) + '  (' + r.player.hits + '안타 / ' + r.player.atBats + '타수)', 640, y, 24, '#fff', 'center', 'bold');
      } else {
        text('챌린지는 통산 타율에 반영되지 않습니다', 640, y, 20, '#9ab', 'center');
      }
      y += 50;
      // 기록 갱신·레벨 해제: 타율이 다 올라간 뒤 차례로 튀어나오고 깜빡임
      const badge = (str, color, t0) => {
        if (e < t0) return;
        const sc = Math.max(0.01, popScale(e - t0));
        ctx.save();
        ctx.translate(640, y);
        ctx.scale(sc, sc);
        ctx.globalAlpha = 0.8 + 0.2 * Math.sin((e - t0) * 6);
        outlined(str, 0, 0, 36, color);
        ctx.restore();
      };
      if (r.newRecord) {
        badge('NEW RECORD', '#ff6b6b', 0.8);
        y += 46;
      }
      if (r.unlockedLevel !== null) {
        badge(C.LEVELS[r.unlockedLevel].name + ' 해제!', '#7cf29a', r.newRecord ? 1.1 : 0.8);
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
