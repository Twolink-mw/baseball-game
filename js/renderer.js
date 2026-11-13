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
    TRIPLE: '3루타!',
    DOUBLE: '2루타!',
    SINGLE: '1루타!',
    FOUL: '파울',
    OUT_BIP: '범타 아웃',
    SWING_MISS: '헛스윙',
    LOOKING: '루킹 스트라이크',
    BALL: '볼',
  };
  const HITS = { HOMERUN: 1, TRIPLE: 1, DOUBLE: 1, SINGLE: 1 };
  // 타석별 결과 격자 (챌린지 결과·공유 카드)
  const GRID = {
    HOMERUN: ['홈런', '#ff5a5a', '#fff'],
    TRIPLE: ['3루타', '#b46cff', '#fff'],
    DOUBLE: ['2루타', '#ff9f43', '#111'],
    SINGLE: ['1루타', '#ffd34d', '#111'],
    OUT_BIP: ['범타', '#8b97a8', '#111'],
    STRIKEOUT: ['삼진', '#262d3a', '#ff8a8a'],
  };
  const BOARD_FLASH = { HOMERUN: 'HOME RUN!', TRIPLE: '3루타!', DOUBLE: '2루타!', SINGLE: 'HIT!' };

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // 공 원근: 반지름이 거리에 반비례하도록. t=0에서 ballR0, t=1에서 ballR1
  const PA = L.ballR0 / (L.ballR1 - L.ballR0);
  const ballRadius = (t) => (L.ballR1 * PA) / Math.max(PA + 1 - t, 0.05);
  // 화면상 진행도(원근 때문에 처음엔 느리고 도착 직전에 빨라짐). t=0 → 0, t=1 → 1
  const screenProgress = (t) => (1 / Math.max(PA + 1 - t, 0.05) - 1 / (PA + 1)) / (1 / PA - 1 / (PA + 1));

  function createRenderer(canvas) {
    let ctx = canvas.getContext('2d'); // 공유 카드를 그릴 때 잠시 다른 캔버스로 바꿈
    let dpr = 1;
    let hits = [];
    let bg = null; // 고정 배경 캐시(실제 픽셀 크기)
    let cssScale = 1; // 논리 1px이 화면에서 몇 CSS px인지
    // 화면이 16:9보다 넓으면 캔버스를 넓히고 게임 내용(1280)은 가운데에 둔다. 배경만 양옆으로 이어 그림
    let LW = L.width; // 캔버스 전체 논리 폭
    let ox = 0; // 게임 내용의 왼쪽 여백(논리 px)
    let touch = false; // 터치 기기 배치(큰 버튼, 존 확대)
    let zoneScale = 1;
    let minTap = 0; // 버튼 최소 높이(논리 px)
    let pointer = null; // 마우스 위치(논리 좌표, 버튼 hover용). 터치면 null
    let pressed = null; // 방금 누른 버튼 { id, age(초) }
    let release = L.release; // 지금 투수의 공 출발점 (팔 각도·체격에 따라, drawGame에서 정함)

    // 안전 영역(노치/홈바) 크기 (CSS 변수 --sa-*)
    function safeArea() {
      const cs = global.getComputedStyle(document.documentElement);
      const v = (k) => parseFloat(cs.getPropertyValue(k)) || 0;
      return { top: v('--sa-top'), right: v('--sa-right'), bottom: v('--sa-bottom'), left: v('--sa-left') };
    }

    function updateTouchLayout() {
      minTap = touch ? C.TOUCH.minTapPx / cssScale : 0;
      // 존 한 칸이 화면에서 너무 작으면 키움 (예: 아이폰 Safari 가로 + 주소창)
      zoneScale = touch && (L.zone.h / 3) * cssScale < C.TOUCH.zoneCellMinPx ? C.MOBILE_ZONE_SCALE : 1;
    }

    function setTouch(on) {
      touch = !!on;
      updateTouchLayout();
    }

    function resize() {
      const sa = safeArea();
      const vw = Math.max(1, global.innerWidth - sa.left - sa.right);
      const vh = Math.max(1, global.innerHeight - sa.top - sa.bottom);
      const prevLW = LW;
      LW = Math.max(L.width, Math.min(L.width * L.maxWide, (L.height * vw) / vh));
      ox = (LW - L.width) / 2;
      S.setExtent(ox);
      const s = Math.min(vw / LW, vh / L.height);
      const cssW = Math.max(1, Math.floor(LW * s));
      const cssH = Math.max(1, Math.floor(L.height * s));
      dpr = Math.min(global.devicePixelRatio || 1, L.maxDpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h || !bg || LW !== prevLW) {
        canvas.width = w;
        canvas.height = h;
        bg = S.buildBackground(w, h);
      }
      cssScale = cssW / LW;
      updateTouchLayout();
    }

    function toLogical(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return { x: ((clientX - r.left) / r.width) * LW - ox, y: ((clientY - r.top) / r.height) * L.height };
    }

    function zoneRect() {
      const z = L.zone;
      const w = z.w * zoneScale;
      const h = z.h * zoneScale;
      return { x: z.cx - w / 2, y: z.cy - h / 2, w, h, cw: w / 3, ch: h / 3 };
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

    // 공이 꽂히는 자리. 볼(존 바깥 칸)은 가장자리에서 BALL.outCells만큼 바깥으로 더 뺀다
    function pitchTarget(cell) {
      const z = zoneRect();
      const p = cellCenter(cell);
      const extra = C.BALL.outCells - 0.5;
      if (cell.row < 0) p.y -= z.ch * extra;
      if (cell.row > 2) p.y += z.ch * extra;
      if (cell.col < 0) p.x -= z.cw * extra;
      if (cell.col > 2) p.x += z.cw * extra;
      return p;
    }

    // 도착 뒤 지난 구간의 진행도(0~1). t는 비행 시간 기준 진행도
    function passProgress(pitch, t) {
      return t <= 1 ? 0 : Math.min(1, ((t - 1) * pitch.flightSec) / FX.passSec);
    }

    // 공 반지름. 도착 뒤에는 원근 공식 대신 passGrow 배까지만 커진다
    function ballSize(pitch, t) {
      if (t <= 1) return ballRadius(t);
      return L.ballR1 * (1 + (FX.passGrow - 1) * passProgress(pitch, t));
    }

    // 공 위치. 공개 전(시간 기준)에는 존 중앙을 향하고, 공개 구간에서 실제 코스로 휜다.
    // 화면 이동량은 원근 진행도를 따른다. t>1이면 포수 쪽(아래)으로 빠져나간다.
    function ballPos(pitch, t) {
      const center = { x: L.zone.cx, y: L.zone.cy };
      const target = pitchTarget(pitch.cell);
      const u = Math.max(0, 1 - pitch.revealSec / pitch.flightSec);
      const tt = Math.min(t, 1);
      const sp = screenProgress(tt);
      const su = screenProgress(u);
      let p;
      if (tt <= u) {
        p = lerp(release, center, sp);
      } else {
        const pu = lerp(release, center, su);
        const s = su < 1 ? (sp - su) / (1 - su) : 1;
        const base = lerp(pu, target, s);
        const bend = C.PITCH_TYPES[pitch.type].bend;
        const k = 4 * s * (1 - s);
        p = { x: base.x + bend.x * k, y: base.y - bend.y * k };
      }
      if (t > 1) p = { x: p.x, y: p.y + zoneRect().ch * FX.passDropCells * passProgress(pitch, t) };
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

    // 터치 기기에서는 화면상 최소 높이(minTapPx)를 보장: 가운데를 유지한 채 키우고 화면 안으로 맞춤
    function button(id, x, y, w, h, label, opts) {
      opts = opts || {};
      if (minTap > h && !opts.noMin) {
        y = Math.max(0, Math.min(L.height - minTap, y + h / 2 - minTap / 2));
        h = minTap;
      }
      const disabled = !!opts.disabled;
      // 반응: 마우스를 올리면 밝게, 누르면 잠깐 더 밝게
      const hot = !disabled && pointer && pointer.x >= x && pointer.x < x + w && pointer.y >= y && pointer.y < y + h;
      const down = !disabled && pressed && pressed.id === id && pressed.age < FX.pressSec;
      roundRect(x, y, w, h, 10);
      ctx.fillStyle = disabled
        ? 'rgba(60,60,60,0.8)'
        : opts.primary
          ? down ? '#7ab4ff' : hot ? '#4a91f0' : '#2f7de1'
          : down ? 'rgba(90,115,150,0.95)' : hot ? 'rgba(42,58,84,0.92)' : 'rgba(20,30,45,0.85)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = disabled ? '#555' : hot || down ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
      ctx.stroke();
      text(label, x + w / 2, y + h / 2, opts.size || 22, disabled ? '#888' : '#fff', 'center', 'bold');
      if (!disabled) hits.push({ id, x, y, w, h });
      return { x, y, w, h };
    }

    // 음소거 토글 (M 키로도 전환): 버튼 대신 스피커 아이콘으로 '지금 상태'를 보여 줌
    // 켜짐 = 스피커 + 음파, 꺼짐 = 흐린 스피커 + 빨간 사선. cx,cy: 가운데, size: 지름
    function muteButton(view, cx, cy, size) {
      const muted = !!(view.record && view.record.settings.muted);
      const s = size / 48;
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      // 스피커 몸통 + 나팔
      ctx.beginPath();
      ctx.moveTo(cx - 15 * s, cy - 6 * s);
      ctx.lineTo(cx - 7 * s, cy - 6 * s);
      ctx.lineTo(cx + 3 * s, cy - 15 * s);
      ctx.lineTo(cx + 3 * s, cy + 15 * s);
      ctx.lineTo(cx - 7 * s, cy + 6 * s);
      ctx.lineTo(cx - 15 * s, cy + 6 * s);
      ctx.closePath();
      ctx.fillStyle = muted ? '#9aa3ad' : '#fff';
      ctx.fill();
      ctx.lineCap = 'round';
      if (!muted) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3 * s;
        for (const rad of [8, 15]) {
          ctx.beginPath();
          ctx.arc(cx + 4 * s, cy, rad * s, -0.75, 0.75);
          ctx.stroke();
        }
      } else {
        // 빨간 사선 (어두운 테두리로 배경과 구분)
        for (const [col, lw] of [['rgba(0,0,0,0.7)', 7], ['#ff3b3b', 4]]) {
          ctx.beginPath();
          ctx.moveTo(cx - 17 * s, cy - 17 * s);
          ctx.lineTo(cx + 17 * s, cy + 17 * s);
          ctx.strokeStyle = col;
          ctx.lineWidth = lw * s;
          ctx.stroke();
        }
      }
      ctx.lineCap = 'butt';
      // 누르는 영역은 터치 최소 크기 보장
      const hs = Math.max(size, minTap);
      hits.push({ id: 'mute', x: cx - hs / 2, y: cy - hs / 2, w: hs, h: hs });
    }

    // 구장 배경(하늘+캐시) + 덮개
    // mood: 구장 분위기(THEME.moods 이름). 없으면 낮
    function drawBackdrop(now, shade, mood) {
      S.drawSky(ctx, now, mood);
      if (bg) ctx.drawImage(bg, -ox, 0, LW, L.height);
      if (mood && mood !== 'day') S.drawMood(ctx, mood);
      if (shade) {
        ctx.fillStyle = shade;
        ctx.fillRect(-ox, 0, LW, L.height);
      }
    }

    // ---- 게임 화면 ----
    function drawPitcher(g) {
      let el = 0;
      let holdT = 0;
      // 와인드업: 멈춤 구간은 세트 자세(사인 보며 끄덕임), 이후 투구 동작 진행도(0~1)
      if (g.phase === 'PITCH_WINDUP') {
        el = Math.max(0, (g.phaseElapsed() - g.pitch.holdSec) / g.pitch.motionSec);
        holdT = g.phaseElapsed();
      } else if (g.phase === 'PITCH_FLIGHT') el = g.time - g.releaseTime;
      else if (g.phase === 'RESULT_SHOW') el = g.phaseElapsed();
      const look = g.level.look;
      S.drawPitcher(ctx, S.pitcherPose(g.phase, el, el, look && look.arm, holdT), look);
    }

    // 결과에 따른 타자 반응 (그 타석이 끝난 결과만)
    function batterReact(g) {
      if (g.phase !== 'RESULT_SHOW' || !g.last) return null;
      const last = g.last;
      let kind = null;
      if (last.result === 'HOMERUN') kind = 'admire';
      else if (HITS[last.result]) kind = 'drop';
      else if (last.atBatOutcome === 'STRIKEOUT') kind = 'slump';
      return kind ? { kind, t: g.phaseElapsed() } : null;
    }

    function drawBatter(g, now) {
      let swing = null;
      if (g.click && (g.phase === 'PITCH_FLIGHT' || g.phase === 'RESULT_SHOW')) {
        swing = clamp01((g.time - g.click.atTime) / FX.swingSec);
      }
      // 그림은 좌타자(화면 오른쪽, 1루 쪽) 기준. 우타자는 좌우를 뒤집어 화면 왼쪽(3루 쪽)에 그린다
      const mirror = g.bats === 'R';
      // 누른 칸 중심을 그림 좌표로 (우타자는 뒤집힌 좌표)
      let target = null;
      if (g.click) {
        const p = cellCenter(g.click.cell);
        target = { x: mirror ? L.width - p.x : p.x, y: p.y };
      }
      // 투구 동작 후반에 앞발을 살짝 들었다가 릴리스에 내림 (타이밍 잡기)
      let stride = 0;
      if (g.phase === 'PITCH_WINDUP' && g.pitch) {
        const m = (g.phaseElapsed() - g.pitch.holdSec) / g.pitch.motionSec;
        if (m > 0.35 && m < 1) stride = Math.sin(Math.PI * ((m - 0.35) / 0.65));
      }
      const opts = { target, idleT: g.paused ? 0 : now, stride, react: batterReact(g), runDir: mirror ? -1 : 1 };
      if (mirror) {
        ctx.save();
        ctx.translate(L.width, 0);
        ctx.scale(-1, 1);
        S.drawBatter(ctx, swing, opts);
        ctx.restore();
      } else {
        S.drawBatter(ctx, swing, opts);
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
      const endT = g.pitch ? 1 + FX.passSec / g.pitch.flightSec : 1;
      if (t !== null && t >= 0 && t <= endT) {
        const fade = 1 - passProgress(g.pitch, t);
        for (let k = 3; k >= 1; k--) {
          const tk = t - (k * FX.trailSec) / g.pitch.flightSec;
          if (tk < 0) continue;
          ballSprite(ballPos(g.pitch, tk), ballSize(g.pitch, tk) * 0.9, (0.22 / k) * fade, 0);
        }
        ballSprite(ballPos(g.pitch, t), ballSize(g.pitch, t), fade, t * g.pitch.flightSec * 40);
      }
      // 결과 연출 중: 실제 코스를 점선 원으로 표시
      if (g.phase === 'RESULT_SHOW' && g.last) {
        const p = pitchTarget(g.last.pitch.cell);
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
        case 'TRIPLE': // 외야 구석 깊숙이 (2루타보다 멀리·옆으로)
          return { dur: 1.0, tx: 640 + side * 360 + d * 300, ty: S.fenceY() - 4, apex: 200, r1: 2.5 };
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
      const from = pitchTarget(last.pitch.cell);
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

    // HUD 높이: 챌린지는 미션 줄이 하나 더 있음
    const hudHeight = (g) => (g.mission ? 234 : 204);

    // 미션 진행 한 줄: 문구와 색
    function missionLine(g) {
      const m = g.mission;
      const pr = g.missionProgress();
      if (pr.done) return { str: '미션 ' + m.text + ' ✓', color: '#7cf29a' };
      if (pr.failed) return { str: '미션 ' + m.text + ' ✗', color: '#ff8a8a' };
      const now = m.max != null ? ' (지금 ' + pr.value + ')' : ' (' + pr.value + '/' + m.min + ')';
      return { str: '미션 ' + m.text + now, color: '#ffe9a0' };
    }

    function drawHud(g, view) {
      roundRect(16, 16, 280, hudHeight(g), 12);
      ctx.fillStyle = 'rgba(10,15,25,0.72)';
      ctx.fill();
      const R = g.rules || {};
      const speed = g.level.baseSpeed + (g.speedBonus ? g.speedBonus() : 0);
      const title = g.mode === 'challenge'
        ? view.today.slice(5).replace('-', '/') + ' 챌린지 · ' + g.level.title + ' ' + g.level.baseSpeed + 'km'
        : R.practice
          ? '연습 · ' + g.level.name + ' ' + speed + 'km'
          : g.modeName
            ? g.modeName + ' ' + speed + 'km'
            : g.level.name + ' ' + g.level.title + ' ' + g.level.baseSpeed + 'km';
      text(g.playerName + (g.bats === 'L' ? ' (좌타)' : ' (우타)'), 32, 40, 22, '#fff', 'left', 'bold');
      text(title, 32, 70, 18, '#ffd34d', 'left', 'bold');
      if (R.practice) {
        drawPracticeHud(g);
        return;
      }
      if (R.maxOuts) {
        text('타석 ' + g.atBat, 32, 98, 18);
        const outs = g.modeOuts();
        text('아웃 ' + outs + ' / ' + R.maxOuts, 280, 98, 18, outs >= R.maxOuts - 1 ? '#ff8a8a' : '#fff', 'right', 'bold');
      } else text('타석 ' + g.atBat + ' / ' + C.AT_BATS_PER_GAME, 32, 98, 18);
      text('안타 ' + g.stats.hits + '   홈런 ' + g.stats.homers, 32, 126, 18, '#fff', 'left', R.homerOnly || R.maxOuts ? 'bold' : 'normal');
      text('타율 ' + BB.formatAvg(g.currentAverage()), 32, 154, 18);
      text(g.pitchInAtBat + '구 / 총 ' + g.totalPitches + '구', 280, 154, 16, '#ccc', 'right');
      // 볼 카운트(초록) · 스트라이크(노랑)
      text('B', 32, 186, 18, '#fff', 'left', 'bold');
      for (let i = 0; i < C.MAX_BALLS; i++) lamp(60 + i * 26, 186, i < g.balls, '#4fd27a');
      text('S', 150, 186, 18, '#fff', 'left', 'bold');
      for (let i = 0; i < C.MAX_STRIKES - 1; i++) lamp(178 + i * 26, 186, i < g.strikes, '#f2c230');
      if (g.mission) {
        const ml = missionLine(g);
        text(ml.str, 32, 218, 16, ml.color, 'left', 'bold');
      }
    }

    // 연습 HUD: 스윙·코스 맞힘·안타, 최근 스윙 타이밍 띠 (카운트 없음)
    function drawPracticeHud(g) {
      const h = g.history;
      const swings = h.filter((e) => e.clickCell);
      const matched = swings.filter((e) => e.clickCell.row === e.cell.row && e.clickCell.col === e.cell.col).length;
      const balls = h.filter((e) => BB.isBallCell(e.cell));
      text('투구 ' + h.length + '   스윙 ' + swings.length, 32, 98, 18);
      text('코스 맞힘 ' + matched + '   안타 ' + g.stats.hits + '   홈런 ' + g.stats.homers, 32, 126, 18);
      text('정확 ' + g.stats.perfects + (balls.length ? '   볼 스윙 ' + balls.filter((e) => e.clickCell).length + '/' + balls.length : ''), 32, 154, 18);
      // 최근 스윙 타이밍 (빠름 ← 0 → 늦음), 최근 것일수록 진함
      const recent = swings.filter((e) => typeof e.deltaSec === 'number').slice(-C.MODES.practice.stripCount);
      const sx = 32;
      const sw = 248;
      const sy = 186;
      const Rng = C.ANALYSIS.stripRange;
      const px = (d) => sx + sw / 2 + (Math.max(-Rng, Math.min(Rng, d)) / Rng) * (sw / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(sx, sy - 9, sw, 18);
      ctx.fillStyle = 'rgba(124,242,154,0.2)';
      ctx.fillRect(px(-C.JUDGE.timing.good), sy - 9, px(C.JUDGE.timing.good) - px(-C.JUDGE.timing.good), 18);
      ctx.fillStyle = 'rgba(255,211,77,0.35)';
      ctx.fillRect(px(-C.JUDGE.timing.perfect), sy - 9, px(C.JUDGE.timing.perfect) - px(-C.JUDGE.timing.perfect), 18);
      recent.forEach((e, i) => {
        ctx.globalAlpha = 0.35 + 0.65 * ((i + 1) / recent.length);
        ctx.beginPath();
        ctx.arc(px(e.deltaSec), sy, i === recent.length - 1 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = e.timing === 'PERFECT' ? '#ffd34d' : e.timing === 'GOOD' ? '#7cf29a' : e.deltaSec < 0 ? '#7cc4ff' : '#ff9f5a';
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      text('빠름', sx, sy + 18, 12, '#7cc4ff', 'left');
      text('늦음', sx + sw, sy + 18, 12, '#ff9f5a', 'right');
    }

    function drawBoard(g, now) {
      const flash = g.phase === 'RESULT_SHOW' && g.last ? BOARD_FLASH[g.last.result] || null : null;
      const sub = g.rules && g.rules.practice ? '연습' : g.rules && g.rules.maxOuts ? (g.rules.homerOnly ? '홈런 ' : '안타 ') + g.score() + '개' : BB.formatAvg(g.currentAverage());
      S.drawScoreboard(ctx, 'BB 스타디움', g.playerName + ' · ' + sub, flash, now);
    }

    // ---- 투구 기록 패널 (화면 오른쪽) ----
    const LOG_LABEL = { HOMERUN: '홈런', TRIPLE: '3루타', DOUBLE: '2루타', SINGLE: '1루타', FOUL: '파울', OUT_BIP: '범타', SWING_MISS: '헛스윙', LOOKING: '루킹', BALL: '볼' };
    const LOG_COLOR = { HOMERUN: '#ffd34d', TRIPLE: '#ffd34d', DOUBLE: '#ffd34d', SINGLE: '#ffd34d', FOUL: '#dfe6ee', OUT_BIP: '#9aa7b8', SWING_MISS: '#ff8a8a', LOOKING: '#ff8a8a', BALL: '#4fd27a' };

    // 타석 결과 한마디 (직전 타석 제목용)
    function atBatOutcomeLabel(list) {
      const last = list[list.length - 1];
      if (!last) return '';
      if (last.result === 'SWING_MISS' || last.result === 'LOOKING') return '삼진';
      return LOG_LABEL[last.result];
    }

    // 한 줄: 번호(결과 색) · 구종 · 구속 · 결과
    function logRow(e, x, w, ry, size, dim) {
      ctx.globalAlpha = dim ? 0.75 : 1;
      ctx.beginPath();
      ctx.arc(x + 24, ry, size * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = LOG_COLOR[e.result];
      ctx.fill();
      text(String(e.n), x + 24, ry + 1, size - 4, '#111', 'center', 'bold');
      text(e.type, x + 46, ry, size, '#fff', 'left', 'bold');
      text(e.speed + 'km', x + 196, ry, size, '#cde', 'right');
      text(LOG_LABEL[e.result], x + w - 16, ry, size, LOG_COLOR[e.result], 'right', 'bold');
      ctx.globalAlpha = 1;
    }

    // 투구 기록 패널: 왼쪽 위 HUD와 같은 폭·글자 크기
    const LOG_W = 280;
    const LOG_X_RIGHT = L.width - 16 - LOG_W;

    // 위: 이번 타석(미니 존 + 목록), 아래: 직전 타석(다음 타석이 끝날 때까지 유지)
    function drawPitchLog(g, x) {
      // 연습은 타석이 끝나지 않으므로 최근 몇 개만
      const practice = !!(g.rules && g.rules.practice);
      const cur = practice ? g.history.slice(-C.MODES.practice.logRows) : g.history.filter((h) => h.atBat === g.atBat);
      const prev = !practice && g.atBat > 1 ? g.history.filter((h) => h.atBat === g.atBat - 1) : [];
      x = x == null ? LOG_X_RIGHT : x;
      const onLeft = x < L.width / 2; // 왼쪽이면 HUD 아래부터
      const y = onLeft ? 16 + hudHeight(g) + 12 : 150;
      const w = LOG_W;
      const bottom = onLeft ? 708 : 640; // 오른쪽은 아래 버튼 위까지
      const cs = 40; // 미니 존 칸 크기
      const zx = x + (w - cs * 3) / 2;
      const zy = y + 62; // 존 위·아래로 볼 자리(반 칸)를 남김
      const rowY = zy + cs * 3 + 36;
      const CUR_H = 30;
      const PREV_H = 26;
      // 줄 수가 넘치면 직전 타석은 마지막 몇 줄만
      const curRows = Math.max(1, cur.length);
      let prevRows = prev.length;
      const room = bottom - 8 - (rowY + curRows * CUR_H) - (prev.length ? 36 : 0);
      if (prevRows * PREV_H > room) prevRows = Math.max(0, Math.floor(room / PREV_H));
      const prevTop = rowY + curRows * CUR_H + 6;
      const h = (prev.length ? prevTop + 32 + prevRows * PREV_H : rowY + curRows * CUR_H) - y + 8;
      roundRect(x, y, w, h, 12);
      ctx.fillStyle = 'rgba(10,15,25,0.85)';
      ctx.fill();
      text(practice ? '최근 투구' : g.atBat + '번째 타석', x + 16, y + 22, 18, '#ffd34d', 'left', 'bold');
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
      // 이번 타석 볼/스트라이크 카운트
      if (!practice) text('B ' + g.balls + '  S ' + g.strikes, x + w - 16, y + 22, 18, '#dfe6ee', 'right', 'bold');
      if (last && last.clickCell) {
        // 직전 투구에서 휘두른 칸
        const p = center(last.clickCell);
        ctx.strokeStyle = '#ffd34d';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - cs / 2 + 2, p.y - cs / 2 + 2, cs - 4, cs - 4);
      }
      const perCell = {};
      const OFFS = [[0, 0], [-10, -10], [10, 10], [10, -10], [-10, 10]];
      cur.forEach((e) => {
        const k = e.cell.row * 3 + e.cell.col;
        const o = OFFS[(perCell[k] = (perCell[k] || 0) + 1) - 1] || [0, 0];
        const p = center(e.cell);
        ctx.beginPath();
        ctx.arc(p.x + o[0], p.y + o[1], 11, 0, Math.PI * 2);
        ctx.fillStyle = LOG_COLOR[e.result];
        ctx.fill();
        text(String(e.n), p.x + o[0], p.y + o[1] + 1, 14, '#111', 'center', 'bold');
      });
      if (!cur.length) text('첫 공을 기다리는 중', x + w / 2, rowY + 15, 17, '#789', 'center');
      cur.forEach((e, i) => logRow(e, x, w, rowY + i * CUR_H + 15, 18, false));
      // 직전 타석
      if (prev.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 12, prevTop);
        ctx.lineTo(x + w - 12, prevTop);
        ctx.stroke();
        text('직전 타석', x + 16, prevTop + 17, 17, '#9ab', 'left', 'bold');
        const out = atBatOutcomeLabel(prev);
        text(out, x + w - 16, prevTop + 17, 17, out === '삼진' ? '#ff8a8a' : out === '범타' ? '#9aa7b8' : '#ffd34d', 'right', 'bold');
        const shown = prev.slice(prev.length - prevRows);
        shown.forEach((e, i) => logRow(e, x, w, prevTop + 32 + i * PREV_H + 12, 16, true));
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

    // 승부처 문구: '안타 하나면 Lv.3 해제!'
    function clutchText(c) {
      if (c.need === 1) return '안타 하나면 ' + c.label + '!';
      if (c.need === c.remaining) return '남은 ' + c.remaining + '타석 모두 안타면 ' + c.label + '!';
      return '안타 ' + c.need + '개면 ' + c.label + '!';
    }

    // 타석 중 위쪽 가운데 알림: 승부처, 타자 유리(볼 3개). 결과 연출·타석 소개 중에는 숨김
    function drawStatusPill(g) {
      if (g.phase === 'RESULT_SHOW' || g.phase === 'AT_BAT_INTRO' || g.phase === 'GAME_OVER') return;
      const parts = [];
      const c = g.clutch && g.clutch();
      if (c) parts.push(['승부처 · ' + clutchText(c), '#ffd34d']);
      if (g.advantage && g.advantage()) parts.push(['타자 유리 · 스트라이크만!', '#7cf29a']);
      // 한 줄에 하나씩 쌓음 (가로로 길면 오른쪽 전광판을 가림)
      parts.forEach(([s, col], i) => {
        ctx.font = 'bold 18px ' + FONT;
        const w = ctx.measureText(s).width + 40;
        const y = 78 + i * 40;
        roundRect(640 - w / 2, y, w, 34, 17);
        ctx.fillStyle = 'rgba(10,15,25,0.78)';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
        text(s, 640, y + 17, 18, col, 'center', 'bold');
      });
    }

    function drawCenterMessage(g) {
      if (g.phase === 'AT_BAT_INTRO') {
        const e = g.phaseElapsed();
        ctx.globalAlpha = clamp01(e / 0.2) * clamp01((C.AT_BAT_INTRO_SEC - e) / 0.2 + 0.3);
        outlined(g.rules && g.rules.practice ? '연습 시작' : g.atBat + '번째 타석', 640, 150 - 10 * clamp01(e / 0.3), 44, '#fff');
        const c = g.clutch && g.clutch();
        if (c) outlined(clutchText(c), 640, 204, 32, '#ffd34d');
        ctx.globalAlpha = 1;
        return;
      }
      if (g.phase !== 'RESULT_SHOW' || !g.last) return;
      const last = g.last;
      const e = g.phaseElapsed();
      let main = RESULT_TEXT[last.result];
      if (last.atBatOutcome === 'STRIKEOUT') main = last.result === 'LOOKING' ? '루킹 삼진!' : '삼진 아웃!';
      if (last.foulCapped) main = '파울 → 범타 처리';
      const ht = !last.foulCapped && FX.hitText[last.result]; // 안타 종류별 크기·색
      const color = ht ? ht.color : last.atBatOutcome === 'STRIKEOUT' ? '#ff8a8a' : '#fff';
      ctx.save();
      ctx.translate(640, 140);
      const sc = Math.max(0.01, popScale(e));
      ctx.scale(sc, sc);
      outlined(main, 0, 0, ht ? ht.size : 56, color);
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
      drawBackdrop(now, null, g.level.mood);
      release = S.releasePoint(g.level.look);
      drawBoard(g, now);
      drawPitcher(g);
      drawBatter(g, now);
      drawZone(g, view.hover);
      drawBall(g);
      drawClickMarker(g);
      drawHitFx(g);
      ctx.restore();
      drawHud(g, view);
      // 터치 기기: 투구 기록은 패드 반대쪽(HUD 아래 또는 오른쪽), 버튼은 오른쪽 위 일시정지 하나
      const padLeft = view.record && view.record.settings.padSide === 'left';
      const logX = touch && !padLeft ? 16 : LOG_X_RIGHT;
      drawPitchLog(g, logX);
      drawBubble(g);
      drawStatusPill(g);
      drawCenterMessage(g);
      if (touch) {
        button('pause', L.width - 150, 8, 140, 56, '일시정지', { size: 20 });
      } else {
        muteButton(view, L.width - 326, L.height - 45, 50);
        button('pause', L.width - 280, L.height - 70, 120, 50, '일시정지', { size: 20 });
        button('menu', L.width - 150, L.height - 70, 130, 50, '메뉴로', { size: 20 });
      }
      if (g.paused) {
        hits = [];
        const practice = !!(g.rules && g.rules.practice);
        if (practice && view.pauseAnalysis) {
          // 연습 중 지금까지의 분석
          ctx.fillStyle = 'rgba(8,14,26,0.9)';
          ctx.fillRect(-ox, 0, LW, L.height);
          text('연습 분석 · 투구 ' + g.history.length + '개', 640, 50, 30, '#cde', 'center', 'bold');
          drawAnalysis(BB.analyze(g.history), 100);
          button('pauseAnalysis', 640 - 222, 610, 210, 60, '돌아가기');
          button('resume', 640 + 12, 610, 210, 60, '계속하기', { primary: true });
          return;
        }
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-ox, 0, LW, L.height);
        drawPitchLog(g, logX); // 멈춘 채로 투구 기록을 볼 수 있게 덮개 위에 다시 그림
        text('일시정지', 640, 220, 56, '#fff', 'center', 'bold');
        button('resume', 640 - 210, 290, 200, 60, '계속하기', { primary: true });
        button('menu', 640 + 10, 290, 200, 60, '메뉴로');
        // 소리, (터치 기기) 패드 위치
        muteButton(view, touch ? 640 - 110 : 640, 430, 64);
        if (touch) button('padSide', 640 + 10, 400, 200, 60, '패드: ' + (padLeft ? '왼쪽' : '오른쪽'), { size: 20 });
        if (practice) button('pauseAnalysis', 640 - 100, touch ? 480 : 490, 200, 56, '분석 보기', { size: 20 });
      }
    }

    function drawTitle(view) {
      drawBackdrop(view.now, 'rgba(8,14,26,0.62)');
      outlined('타자 시점 야구', 640, 56, 52, '#fff');
      text('코스가 보이면, 공이 도착하는 순간에 맞춰 누르세요', 640, 104, 20, '#cfe', 'center');

      // 현재 타자 배너 (대표 칭호 포함)
      const BW = 780;
      const bx = 640 - BW / 2;
      const by = 128;
      roundRect(bx, by, BW, 54, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      const p = view.player;
      if (p) {
        const career = BB.careerAvg(p);
        text(p.bats === 'L' ? '좌타' : '우타', bx + 20, by + 27, 18, '#9cf', 'left', 'bold');
        text(p.name, bx + 68, by + 27, 24, '#ffd34d', 'left', 'bold');
        text('통산 ' + (career === null ? '-' : BB.formatAvg(career)) + ' (' + p.atBats + '타수)', bx + 270, by + 27, 18, '#dde', 'left');
        const t = BB.topTitle(p);
        if (t) {
          // 이름 바로 옆에 자리가 있으면 거기, 아니면 통산 타율 뒤
          ctx.font = 'bold 24px ' + FONT;
          const nx = bx + 68 + ctx.measureText(p.name).width + 10;
          ctx.font = 'bold 16px ' + FONT;
          const pw = ctx.measureText(t.name).width + 16;
          titlePill(t.name, nx + pw <= bx + 262 ? nx : bx + 470, by + 27, 16);
        }
      } else {
        text('타자 이름을 정해 주세요', bx + 20, by + 27, 20, '#ffd34d', 'left', 'bold');
      }
      button('changeBatter', bx + BW - 140, by + 7, 130, 40, p ? '타자 변경' : '이름 입력', { size: 18, primary: !p });

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

      // 아래 줄: 오늘의 챌린지(왼쪽) + 도전 모드(오른쪽). 레벨 카드 줄과 같은 폭
      const rowX = x0;
      const rowW = cw * 3 + gap * 2;
      const cy = 436;
      const chH = 160;
      const chW = rowW - 360 - 24;
      const cx = rowX;
      const ch = BB.challengeSetup(view.today);
      roundRect(cx, cy, chW, chH, 16);
      ctx.fillStyle = 'rgba(60,46,10,0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,211,77,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      text('오늘의 챌린지 ' + view.today.slice(5).replace('-', '/'), cx + 22, cy + 30, 24, '#ffd34d', 'left', 'bold');
      text('투수 ' + ch.pitcher.name + ' ' + ch.level.baseSpeed + 'km · ' + ch.pitcher.desc, cx + 22, cy + 64, 17, '#fff', 'left', 'bold');
      const played = rec.daily && rec.daily.date === view.today;
      const missionStr = '미션 ' + ch.mission.text + (played ? (rec.daily.mission ? ' ✓ 달성' : ' ✗') : '');
      text(missionStr, cx + 22, cy + 92, 17, played ? (rec.daily.mission ? '#7cf29a' : '#ff8a8a') : '#ffe9a0', 'left', 'bold');
      // 맨 아래 줄: 최근 7일 칸(초록=미션 달성, 노랑=참여, 빈칸=안 함, 흰 테두리=오늘) + 오늘 기록/안내
      const dy = cy + chH - 34; // 맨 아래 줄 위쪽
      if (view.player) {
        const streak = BB.currentStreak(rec, view.today);
        if (streak > 0) text('연속 ' + streak + '일', cx + chW - 22, cy + 30, 20, '#ffb24d', 'right', 'bold');
        else if (rec.streakBest > 0) text('최고 연속 ' + rec.streakBest + '일', cx + chW - 22, cy + 30, 15, '#ccd', 'right');
        const days = BB.recentDays(rec, view.today, C.CHALLENGE.logDays);
        text('최근 7일', cx + 22, dy + 10, 14, '#cbb', 'left', 'bold');
        const sq = 20;
        days.forEach((d, i) => {
          const x = cx + 90 + i * (sq + 6);
          roundRect(x, dy, sq, sq, 5);
          ctx.fillStyle = d.entry ? (d.entry.mission ? '#7cf29a' : '#ffd34d') : 'rgba(255,255,255,0.08)';
          ctx.fill();
          ctx.strokeStyle = d.date === view.today ? '#fff' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = d.date === view.today ? 2 : 1;
          ctx.stroke();
        });
      }
      const d = played
        ? '오늘 ' + BB.formatAvg(rec.daily.avg) + ' · 다시 하면 연습 · 미션 누적 ' + (rec.missions || 0) + '회'
        : '첫 판만 기록 · 미션 누적 ' + (rec.missions || 0) + '회';
      text(d, cx + chW - 22, dy + 10, 14, '#ccd', 'right');
      hits.push({ id: 'challenge', x: cx, y: cy, w: chW, h: chH });

      // 도전 모드 카드
      const mx = cx + chW + 24;
      const mw = 360;
      roundRect(mx, cy, mw, chH, 16);
      ctx.fillStyle = 'rgba(30,24,60,0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(199,146,255,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      text('도전 모드', mx + mw / 2, cy + 32, 26, '#d9b8ff', 'center', 'bold');
      text('서바이벌 · 홈런 더비 · 보스 · 연습', mx + mw / 2, cy + 66, 16, '#fff', 'center');
      const pm = view.player ? view.player.modes : null;
      const best = pm && (pm.survival != null || pm.derby != null)
        ? '최고 · 서바이벌 ' + (pm.survival == null ? '-' : pm.survival + '개') + ' · 더비 ' + (pm.derby == null ? '-' : pm.derby + '개')
        : '기록은 따로, 통산 타율엔 반영 안 됨';
      text(best, mx + mw / 2, cy + 94, 14, '#bcd', 'center');
      text('열기 ▶', mx + mw / 2, cy + 132, 20, '#8fd', 'center', 'bold');
      hits.push({ id: 'modes', x: mx, y: cy, w: mw, h: chH });

      // 조작 안내: PC는 키캡 그림, 터치는 글
      if (touch) text('조작: 공이 오는 칸을 존에서 직접 누르거나, 화면 구석의 3×3 패드를 누르세요', 640, 618, 16, '#bcd', 'center');
      else drawKeyHint(640, 618);
      button('players', 20, L.height - 70, 170, 50, '타자 기록', { size: 18 });
      if (C.SHOW_BACKUP) button('backup', 206, L.height - 70, 170, 50, '기록 백업', { size: 18 });
      muteButton(view, L.width - 46, 42, 52);
      if (view.canFullscreen) button('fullscreen', 20, 16, 150, 44, view.isFullscreen ? '전체화면 끄기' : '전체화면', { size: 18 });
      if (view.iosHint) text('소리가 안 나면 무음 스위치를 확인하세요', 640, 642, 14, '#9ab', 'center');

      button('reset', L.width - 190, L.height - 70, 170, 50, '기록 초기화', { size: 18 });
    }

    // 키 안내 한 줄: 글자와 키캡을 섞어 가운데(cx) 정렬. tokens: 문자열 또는 ['키']
    function drawKeyHint(cx, cy) {
      const groups = (rows) => rows.flatMap((r, i) => (i ? [' / '] : []).concat(r.split('').map((k) => [k])));
      const tokens = ['마우스로 칸 클릭 · 키보드 ']
        .concat(groups(['789', '456', '123']), [' 또는 '], groups(['QWE', 'ASD', 'ZXC']), [' · '], [['M']], [' 소리']);
      const KW = 20;
      const size = 15;
      ctx.font = size + 'px ' + FONT;
      const width = tokens.reduce((a, t) => a + (typeof t === 'string' ? ctx.measureText(t).width : KW + 3), 0);
      let x = cx - width / 2;
      for (const t of tokens) {
        if (typeof t === 'string') {
          text(t, x, cy, size, '#bcd', 'left');
          ctx.font = size + 'px ' + FONT;
          x += ctx.measureText(t).width;
        } else {
          roundRect(x, cy - 11, KW, 22, 4);
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
          text(t[0], x + KW / 2, cy + 1, 13, '#fff', 'center', 'bold');
          x += KW + 3;
        }
      }
    }

    // ---- 도전 모드 화면: 서바이벌 · 홈런 더비 · 연습(위), 보스 투수(아래) ----
    function modeCard(x, y, w, h, color) {
      roundRect(x, y, w, h, 16);
      ctx.fillStyle = 'rgba(20,32,52,0.85)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    function drawModes(view) {
      drawBackdrop(view.now, 'rgba(8,14,26,0.7)');
      outlined('도전 모드', 640, 50, 40, '#fff');
      text('통산 타율·레벨 해제에는 반영되지 않고, 모드별 최고 기록만 남습니다', 640, 92, 17, '#bcd', 'center');
      const p = view.player;
      const M = C.MODES;
      const cw = 360;
      const gap = 30;
      const x0 = 640 - (cw * 3 + gap * 2) / 2;
      const y = 120;
      const h = 230;
      // 점수 모드 카드
      [['survival', '#ffd34d', '최고 안타 '], ['derby', '#ff7b5a', '최고 홈런 ']].forEach(([id, col, label], i) => {
        const x = x0 + i * (cw + gap);
        const m = M[id];
        modeCard(x, y, cw, h, col);
        text(m.name, x + cw / 2, y + 40, 32, col, 'center', 'bold');
        text(m.desc, x + cw / 2, y + 84, 19, '#fff', 'center', 'bold');
        const lv = C.LEVELS[m.level - 1];
        const extra = id === 'survival' ? ' · 타석마다 +' + m.speedStep + 'km' : ' · 볼 없음';
        text(lv.name + ' 투수 ' + lv.baseSpeed + 'km' + extra, x + cw / 2, y + 116, 16, '#bcd', 'center');
        const best = p && p.modes[id];
        text(label + (best == null ? '-' : best + '개'), x + cw / 2, y + 152, 20, '#dde', 'center');
        text('플레이 ▶', x + cw / 2, y + 196, 22, '#8fd', 'center', 'bold');
        hits.push({ id: 'mode:' + id, x, y, w: cw, h });
      });
      // 연습 카드: 설정 버튼 3개 + 시작
      {
        const x = x0 + 2 * (cw + gap);
        const o = view.practiceOpts;
        modeCard(x, y, cw, h, '#7cc4ff');
        text(M.practice.name, x + cw / 2, y + 40, 32, '#7cc4ff', 'center', 'bold');
        text(M.practice.desc, x + cw / 2, y + 80, 16, '#bcd', 'center');
        // 지금 설정 요약 (바꾸기는 '설정' 패널에서)
        const lv = C.LEVELS[o.levelIndex];
        text(lv.name + ' ' + lv.baseSpeed + 'km · ' + (o.type || '전 구종') + ' · ' + (o.balls ? '볼 있음' : '볼 없음'), x + cw / 2, y + 116, 17, '#fff', 'center', 'bold');
        text('코스 ' + practiceCourseLabel(o.cells), x + cw / 2, y + 144, 16, '#dde', 'center');
        button('ppanel:open', x + 20, y + 168, 130, 50, '설정', { size: 18 });
        button('practice', x + 162, y + 168, cw - 182, 50, '연습 시작 ▶', { primary: true, size: 19 });
      }
      // 보스 투수
      const by = 380;
      const bossOpen = !!(p && p.unlocked[M.boss.level - 1]);
      const base = C.LEVELS[M.boss.level - 1];
      modeCard(x0, by, cw * 3 + gap * 2, 230, bossOpen ? '#c792ff' : 'rgba(255,255,255,0.25)');
      text(M.boss.name, x0 + 24, by + 34, 28, bossOpen ? '#c792ff' : '#888', 'left', 'bold');
      text(M.boss.desc + ' · ' + base.name + '(' + base.title + ')를 바탕으로 10타석', x0 + 170, by + 34, 17, bossOpen ? '#dde' : '#999', 'left');
      const ids = M.boss.pitchers;
      const bw = (cw * 3 + gap * 2 - 48 - (ids.length - 1) * 14) / ids.length;
      ids.forEach((id, i) => {
        const pi = C.CHALLENGE.pitchers.find((q) => q.id === id);
        const lvl = BB.pitcherLevel(base, pi);
        const x = x0 + 24 + i * (bw + 14);
        const yy = by + 64;
        roundRect(x, yy, bw, 146, 12);
        ctx.fillStyle = bossOpen ? 'rgba(199,146,255,0.12)' : 'rgba(0,0,0,0.4)';
        ctx.fill();
        ctx.strokeStyle = bossOpen ? 'rgba(199,146,255,0.6)' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        text(pi.name, x + bw / 2, yy + 30, 22, bossOpen ? '#fff' : '#888', 'center', 'bold');
        text(lvl.baseSpeed + 'km', x + bw / 2, yy + 60, 17, bossOpen ? '#ffd34d' : '#777', 'center');
        text(pi.desc, x + bw / 2, yy + 88, 13, bossOpen ? '#bcd' : '#777', 'center');
        const best = p && p.boss[id];
        text('최고 ' + (best == null ? '-' : BB.formatAvg(best)), x + bw / 2, yy + 120, 17, bossOpen ? '#dde' : '#777', 'center', 'bold');
        if (bossOpen) hits.push({ id: 'boss:' + id, x, y: yy, w: bw, h: 146 });
      });
      if (!bossOpen) {
        roundRect(x0 + 300, by + 108, cw * 3 + gap * 2 - 600, 56, 28);
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fill();
        text('🔒 ' + base.name + '를 해제하면 열립니다', 640, by + 136, 20, '#ddd', 'center', 'bold');
      }
      button('title', L.width - 150, L.height - 70, 130, 50, '메뉴로', { size: 20 });
      muteButton(view, L.width - 46, 42, 52);
      if (view.practicePanel) drawPracticePanel(view.practiceOpts);
    }

    // 코스 고정 요약: 전체 / 낮은 공 / 왼쪽 / 칸 n개
    function practiceCourseLabel(cells) {
      if (!cells || !cells.length || cells.length === 9) return '전체';
      const s = cells.slice().sort((a, b) => a - b).join();
      const ROWS = ['높은 공', '가운데 높이', '낮은 공'];
      const COLS = ['왼쪽', '가운데 세로줄', '오른쪽'];
      for (let i = 0; i < 3; i++) {
        if (s === [i * 3, i * 3 + 1, i * 3 + 2].join()) return ROWS[i] + '만';
        if (s === [i, i + 3, i + 6].join()) return COLS[i] + '만';
      }
      return cells.length + '칸 고정';
    }

    // 연습 설정 패널: 레벨·구종·볼은 칩, 코스는 3×3 칸을 눌러 켜고 끔
    function drawPracticePanel(o) {
      hits = []; // 패널 아래 화면은 누를 수 없음
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-ox, 0, LW, L.height);
      const px = 60;
      const py = 90;
      const pw = L.width - 120;
      const ph = 560;
      roundRect(px, py, pw, ph, 18);
      ctx.fillStyle = 'rgba(16,24,40,0.97)';
      ctx.fill();
      ctx.strokeStyle = '#7cc4ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      text('연습 설정', px + 32, py + 40, 28, '#7cc4ff', 'left', 'bold');
      text('기록에는 남지 않아요', px + pw - 32, py + 42, 15, '#9ab', 'right');

      // 왼쪽: 칩 줄 (선택된 칩은 파란색)
      const lx = px + 32;
      const chipX = lx + 70;
      const chipH = touch ? 66 : 52; // 터치 기기는 손가락 크기에 맞춰 크게 (줄 간격 80 안에 들어감)
      const row = (label, y, items) => {
        text(label, lx, y + chipH / 2, 18, '#bcd', 'left', 'bold');
        let x = chipX;
        for (const [id, str, on, w] of items) {
          button(id, x, y, w, chipH, str, { primary: on, size: 17, noMin: true });
          x += w + 8;
        }
      };
      row('레벨', py + 80, C.LEVELS.map((lv, i) => ['pset:level:' + i, lv.name + ' ' + lv.baseSpeed + 'km', o.levelIndex === i, 150]));
      const types = [null].concat(Object.keys(C.PITCH_TYPES));
      row('구종', py + 160, types.map((t) => ['pset:type:' + (t || 'all'), t || '전 구종', o.type === t, t && t.length > 3 ? 104 : 86]));
      row('볼', py + 240, [['pset:balls:1', '볼 있음', o.balls, 130], ['pset:balls:0', '볼 없음 (스트라이크만)', !o.balls, 220]]);
      text('볼 있음이면 고른 코스 근처로만 빠지는 볼이 섞여요', chipX, py + 240 + chipH + 22, 14, '#9ab', 'left');

      // 오른쪽: 코스 3×3
      const cs = touch ? 88 : 78;
      const gx = px + pw - 32 - cs * 3;
      const gy = py + 104;
      text('코스 (칸을 눌러 켜고 끄기)', gx + (cs * 3) / 2, py + 82, 16, '#bcd', 'center', 'bold');
      const on = o.cells || [];
      for (let i = 0; i < 9; i++) {
        const x = gx + (i % 3) * cs;
        const y = gy + Math.floor(i / 3) * cs;
        const sel = on.includes(i);
        ctx.fillStyle = sel ? 'rgba(47,125,225,0.85)' : on.length ? 'rgba(255,255,255,0.05)' : 'rgba(47,125,225,0.25)';
        ctx.fillRect(x + 2, y + 2, cs - 4, cs - 4);
        ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = sel ? 2.5 : 1.5;
        ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
        if (sel) text('✓', x + cs / 2, y + cs / 2 + 1, 26, '#fff', 'center', 'bold');
        hits.push({ id: 'pcell:' + i, x, y, w: cs, h: cs });
      }
      text(on.length && on.length < 9 ? practiceCourseLabel(on) : '아무 칸도 안 고르면 전체', gx + (cs * 3) / 2, gy + cs * 3 + 24, 15, '#dde', 'center', 'bold');
      button('pcell:clear', gx + 30, gy + cs * 3 + 44, cs * 3 - 60, 44, '전체로', { size: 16, noMin: true, disabled: !on.length });

      button('ppanel:close', 640 - 230, py + ph - 76, 210, 56, '닫기', { size: 20, noMin: true });
      button('practice', 640 + 20, py + ph - 76, 210, 56, '연습 시작 ▶', { primary: true, size: 20, noMin: true });
    }

    // 칭호 표시: 왼쪽 가운데(x, cy)부터 테두리 있는 작은 글자. 폭을 돌려줌
    function titlePill(name, x, cy, size) {
      ctx.font = 'bold ' + size + 'px ' + FONT;
      const w = ctx.measureText(name).width + size;
      const h = size + 10;
      roundRect(x, cy - h / 2, w, h, h / 2);
      ctx.fillStyle = 'rgba(255,211,77,0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,211,77,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      text(name, x + w / 2, cy + 1, size, '#ffe9a0', 'center', 'bold');
      return w;
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
        // 대표 칭호: 이름 오른쪽 (통산 타율 칸과 겹치지 않을 때만)
        const t = BB.topTitle(p);
        if (t) {
          ctx.font = 'bold 22px ' + FONT;
          const nx = cols[1][1] + ctx.measureText(p.name).width + 10;
          ctx.font = 'bold 14px ' + FONT;
          if (nx + ctx.measureText(t.name).width + 14 < cols[2][1] - 32) titlePill(t.name, nx, cy, 14);
        }
        hits.push({ id: 'player:' + p.key, x: 60, y, w: 1000, h: 46 });
        button('delete:' + p.key, 1080, y + 3, 90, 40, '삭제', { size: 16, noMin: true });
      });
      text('행을 누르면 그 타자로 변경합니다', 640, 590, 16, '#9ab', 'center');
      if (pages > 1) {
        button('page:prev', 640 - 170, 640, 80, 50, '◀', { disabled: page === 0 });
        text(page + 1 + ' / ' + pages, 640, 665, 20, '#fff', 'center');
        button('page:next', 640 + 90, 640, 80, 50, '▶', { disabled: page >= pages - 1 });
      }
      button('menu', L.width - 150, L.height - 70, 130, 50, '메뉴로', { size: 20 });
    }

    // ---- 경기 후 분석 (결과 화면 '분석 보기', 연습 모드 일시정지) ----
    // a: game.analyze() 결과. y0~y0+400 영역에 한 줄 평, 코스 칸, 구종 표, 타이밍 띠·선구안을 그린다
    function drawAnalysis(a, y0) {
      // 한 줄 평
      const tips = a.tips.length ? a.tips : ['스윙 기록이 적어서 아직 평가할 것이 없어요'];
      tips.forEach((t, i) => text('· ' + t, 640, y0 + i * 30, 20, i === 0 && a.tips.length ? '#ffe9a0' : '#dde', 'center', 'bold'));
      const top = y0 + 72;

      // 왼쪽: 코스별 (맞힌 칸 수 / 들어온 공), 색이 진할수록 안타가 많음
      const cs = 92;
      const gx = 110;
      text('코스별  맞힘 / 투구', gx + cs * 1.5, top, 18, '#9ab', 'center', 'bold');
      for (let i = 0; i < 9; i++) {
        const c = a.byCell[i];
        const x = gx + (i % 3) * cs;
        const y = top + 22 + Math.floor(i / 3) * cs;
        const rate = c.pitches ? c.hits / c.pitches : 0;
        ctx.fillStyle = c.pitches ? 'rgba(255,211,77,' + (0.1 + 0.6 * rate).toFixed(2) + ')' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, y, cs, cs);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cs, cs);
        if (c.pitches) {
          text(c.matched + ' / ' + c.pitches, x + cs / 2, y + cs / 2 - 10, 22, '#fff', 'center', 'bold');
          text(c.hits ? '안타 ' + c.hits : '-', x + cs / 2, y + cs / 2 + 18, 15, c.hits ? '#ffe9a0' : '#9ab', 'center');
        }
      }

      // 가운데: 구종별
      const tx = 470;
      const cols = [['구종', tx, 'left'], ['투구', tx + 130, 'center'], ['스윙', tx + 200, 'center'], ['안타', tx + 270, 'center'], ['헛스윙', tx + 340, 'center']];
      for (const [label, x, al] of cols) text(label, x, top, 18, '#9ab', al, 'bold');
      Object.keys(C.PITCH_TYPES).filter((k) => a.byType[k]).forEach((k, i) => {
        const t = a.byType[k];
        const y = top + 40 + i * 40;
        const vals = [k, t.pitches, t.swings, t.hits, t.misses];
        vals.forEach((v, j) => text(String(v), cols[j][1], y, 20, j === 3 && t.hits ? '#ffd34d' : '#fff', cols[j][2], j === 0 ? 'bold' : 'normal'));
      });

      // 오른쪽: 타이밍 띠 (빠름 ← 0 → 늦음), 스윙마다 점
      const sx = 880;
      const sw = 300;
      const sy = top + 60;
      const R = C.ANALYSIS.stripRange;
      text('타이밍', sx + sw / 2, top, 18, '#9ab', 'center', 'bold');
      const px = (d) => sx + sw / 2 + (Math.max(-R, Math.min(R, d)) / R) * (sw / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(sx, sy - 22, sw, 44);
      ctx.fillStyle = 'rgba(124,242,154,0.18)';
      ctx.fillRect(px(-C.JUDGE.timing.good), sy - 22, px(C.JUDGE.timing.good) - px(-C.JUDGE.timing.good), 44);
      ctx.fillStyle = 'rgba(255,211,77,0.3)';
      ctx.fillRect(px(-C.JUDGE.timing.perfect), sy - 22, px(C.JUDGE.timing.perfect) - px(-C.JUDGE.timing.perfect), 44);
      const COLOR = { PERFECT: '#ffd34d', GOOD: '#7cf29a' };
      a.timing.deltas.forEach((e, i) => {
        ctx.beginPath();
        ctx.arc(px(e.d), sy - 12 + (i % 4) * 8, 5, 0, Math.PI * 2);
        ctx.fillStyle = COLOR[e.grade] || (e.d < 0 ? '#7cc4ff' : '#ff9f5a');
        ctx.fill();
      });
      text('빠름', sx, sy + 38, 15, '#7cc4ff', 'left');
      text('0', sx + sw / 2, sy + 38, 15, '#ccd', 'center');
      text('늦음', sx + sw, sy + 38, 15, '#ff9f5a', 'right');
      const T = a.timing;
      text('정확 ' + T.perfect + ' · 좋음 ' + T.good + ' · 빠름 ' + T.early + ' · 늦음 ' + T.late, sx + sw / 2, sy + 76, 18, '#fff', 'center');
      if (T.mean !== null) {
        const m = Math.abs(T.mean) < 0.005 ? '평균 딱 맞음' : '평균 ' + Math.abs(T.mean).toFixed(2) + '초 ' + (T.mean < 0 ? '빠름' : '늦음');
        text(m, sx + sw / 2, sy + 106, 18, '#ccd', 'center');
      }
      // 선구안
      const D = a.discipline;
      text('선구안', sx + sw / 2, sy + 156, 18, '#9ab', 'center', 'bold');
      text('볼 ' + D.balls + '개 중 ' + D.chased + '개 스윙', sx + sw / 2, sy + 188, 20, D.balls && D.chased / D.balls >= C.ANALYSIS.chaseRate ? '#ff8a8a' : '#fff', 'center');
      text('루킹 스트라이크 ' + D.looking + '개', sx + sw / 2, sy + 218, 18, '#ccd', 'center');
    }

    function drawResult(view) {
      const r = view.result;
      const s = r.summary;
      drawBackdrop(view.now, 'rgba(8,14,26,0.84)');
      if (view.resultTab === 'analysis' && s.analysis) {
        text(r.playerName + ' · 경기 분석', 640, 50, 30, '#cde', 'center', 'bold');
        drawAnalysis(s.analysis, 100);
        const bw = 220;
        button('tab:summary', 640 - bw - 12, 610, bw, 60, '결과 보기', { primary: true });
        button('menu', 640 + 12, 610, bw, 60, '메뉴로');
        return;
      }
      const scoreMode = !!(s.rules && s.rules.maxOuts); // 서바이벌·홈런 더비: 점수(개수)가 주인공
      const title = s.mode === 'challenge'
        ? '오늘의 챌린지 ' + r.date.slice(5).replace('-', '/') + ' · 투수 ' + s.pitcherName + (r.official ? '' : ' (연습)')
        : s.modeName ? s.modeName + ' 결과' : C.LEVELS[s.levelIndex].name + ' 결과';
      text(r.playerName + ' · ' + title, 640, 56, 30, '#cde', 'center', 'bold');
      const e = view.now - (r.shownAt || 0); // 결과 화면에 들어온 뒤 경과(초)
      // 하나씩 세며 올라감
      const k = clamp01(e / 0.7);
      const ease = 1 - (1 - k) * (1 - k);
      if (scoreMode) {
        text(s.mode === 'derby' ? '홈런' : '안타', 640, 104, 22, '#aaa', 'center');
        text(Math.round(ease * s.score) + '개', 640, 170, 96, '#ffd34d', 'center', 'bold');
      } else {
        text('이번 타율', 640, 104, 22, '#aaa', 'center');
        text(BB.formatAvg(Math.round(ease * s.hits) / C.AT_BATS_PER_GAME), 640, 170, 96, '#ffd34d', 'center', 'bold');
      }
      // 정보 한 줄: 통산 / 이전 최고 / 챌린지 미션 결과
      const avgOr = (x) => (x === null || x === undefined ? '-' : BB.formatAvg(x));
      let info = null;
      if (s.mode === 'normal') info = '통산 타율 ' + avgOr(r.careerBefore) + ' → ' + avgOr(r.careerAfter) + '  (' + r.player.hits + '안타 / ' + r.player.atBats + '타수)';
      else if (scoreMode) info = s.atBats + '타석 · 아웃 ' + s.modeOuts + ' · 이전 최고 ' + (r.prevBest == null ? '-' : r.prevBest + '개');
      else if (s.mode === 'boss') info = '이 투수 상대 이전 최고 ' + avgOr(r.prevBest);
      else if (s.mission) info = '미션 ' + s.mission.text;
      if (info) text(info, 640, 246, 22, '#fff', 'center', 'bold');

      // 타석별 결과 칸 (모든 모드. 타석 수가 많으면 최근 AT_BATS_PER_GAME개)
      const N = C.AT_BATS_PER_GAME;
      const log = s.atBatLog.slice(-N);
      drawOutcomeGrid(log, 640, 274, 42, scoreMode ? log.length : N, s.atBatLog.length - log.length + 1);

      // 배지: 한 줄에 가로로, 타율이 다 올라간 뒤 차례로 튀어나옴
      const badges = []; // [문구, 색, 등장 시각(null이면 바로·정지)]
      if (r.newRecord) badges.push(['NEW RECORD', '#ff6b6b', 0.8]);
      if (r.unlockedLevel !== null) badges.push([C.LEVELS[r.unlockedLevel].name + ' 해제!', '#7cf29a', 1.0]);
      if (r.newTitles && r.newTitles.length) badges.push(['칭호 획득! ' + titleNames(r.newTitles), '#ffe9a0', 1.2]);
      if (s.mission) {
        if (s.missionDone) badges.push(['미션 달성!' + (r.official ? '' : ' (연습)'), '#7cf29a', 0.8]);
        else badges.push(['미션 실패', '#ff8a8a', null]);
        const streak = BB.currentStreak(r.player, r.date);
        if (r.official && streak > 0) badges.push(['연속 ' + streak + '일째' + (r.player.streakBest > streak ? '' : streak > 1 ? ' 최고!' : ''), '#ffb24d', null]);
      }
      drawBadgeRow(badges, 640, 372, e);

      // 숫자 카드 4개
      const cards = [
        ['안타', s.hits, '1루타 ' + s.singles + ' · 2루타 ' + s.doubles + ' · 3루타 ' + (s.triples || 0)],
        ['홈런', s.homers, s.homers ? '담장 밖으로 ' + s.homers + '번' : '-'],
        ['삼진', s.strikeouts, '범타 ' + s.outs],
        ['정확 타이밍', s.perfects, '총 ' + s.totalPitches + '구'],
      ];
      const cw = 230;
      const cg = 18;
      const cx0 = 640 - (cw * cards.length + cg * (cards.length - 1)) / 2;
      cards.forEach(([label, value, sub], i) => statCard(cx0 + i * (cw + cg), 418, cw, 128, label, value, sub));

      const canNext = s.mode === 'normal' && s.levelIndex + 1 < C.LEVELS.length && r.player.unlocked[s.levelIndex + 1];
      const bw = canNext ? 180 : 200;
      const by = 600;
      const buttons = [['retry', '다시하기', true]];
      if (canNext) buttons.push(['next', '다음 레벨', false]);
      if (s.analysis) buttons.push(['tab:analysis', '분석 보기', false]);
      buttons.push(['share', '결과 공유', false]);
      buttons.push(['menu', '메뉴로', false]);
      const total = buttons.length * bw + (buttons.length - 1) * 24;
      buttons.forEach(([id, label, primary], i) => button(id, (L.width - total) / 2 + i * (bw + 24), by, bw, 64, label, { primary }));
    }

    // 칭호 id 목록 → '거포 · 선구안' (3개 이상이면 '거포 외 2개')
    function titleNames(ids) {
      const names = ids.map((id) => (C.TITLES.find((t) => t.id === id) || { name: id }).name);
      return names.length > 2 ? names[0] + ' 외 ' + (names.length - 1) + '개' : names.join(' · ');
    }

    // 숫자 카드: 제목(위), 큰 숫자(가운데), 설명(아래)
    function statCard(x, y, w, h, label, value, sub) {
      roundRect(x, y, w, h, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      text(label, x + w / 2, y + 24, 17, '#9ab', 'center', 'bold');
      text(String(value), x + w / 2, y + 66, 44, value ? '#fff' : '#778', 'center', 'bold');
      text(sub, x + w / 2, y + 106, 14, '#bcd', 'center');
    }

    // 배지 한 줄 (가운데 cx, 세로 가운데 cy). 넘치면 글자를 줄임. e: 화면에 들어온 뒤 경과(초)
    function drawBadgeRow(badges, cx, cy, e) {
      if (!badges.length) return;
      let size = 28;
      const gap = 28;
      const widthAt = (sz) => {
        ctx.font = 'bold ' + sz + 'px ' + FONT;
        return badges.reduce((a, b) => a + ctx.measureText(b[0]).width, 0) + gap * (badges.length - 1);
      };
      while (size > 18 && widthAt(size) > 1180) size -= 2;
      let x = cx - widthAt(size) / 2;
      for (const [str, color, t0] of badges) {
        ctx.font = 'bold ' + size + 'px ' + FONT;
        const w = ctx.measureText(str).width;
        if (t0 === null || e >= t0) {
          ctx.save();
          ctx.translate(x + w / 2, cy);
          if (t0 !== null) {
            const sc = Math.max(0.01, popScale(e - t0));
            ctx.scale(sc, sc);
            ctx.globalAlpha = 0.8 + 0.2 * Math.sin((e - t0) * 6);
          }
          outlined(str, 0, 0, size, color);
          ctx.restore();
        }
        x += w + gap;
      }
    }

    // 타석별 결과를 색 칸으로 한 줄에 (가운데 cx, 위쪽 y). n: 칸 수, startNo: 첫 칸 번호
    function drawOutcomeGrid(log, cx, y, size, n, startNo) {
      const gap = 8;
      n = n || C.AT_BATS_PER_GAME;
      startNo = startNo || 1;
      const x0 = cx - (n * size + (n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (size + gap);
        const g = GRID[log[i]];
        roundRect(x, y, size, size, 8);
        ctx.fillStyle = g ? g[1] : 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (g) text(g[0], x + size / 2, y + size / 2 + 1, Math.round(size * 0.29), g[2], 'center', 'bold');
        text(String(startNo + i), x + size / 2, y + size + 14, 13, '#9ab', 'center');
      }
    }

    // 짧은 안내(토스트): 모든 화면 맨 위
    function drawToast(str) {
      ctx.font = 'bold 18px ' + FONT;
      const w = Math.min(1100, ctx.measureText(str).width + 60);
      roundRect(640 - w / 2, 520, w, 44, 22);
      ctx.fillStyle = 'rgba(47,125,225,0.95)';
      ctx.fill();
      text(str, 640, 542, 18, '#fff', 'center', 'bold');
    }

    function draw(view) {
      hits = [];
      pointer = view.pointer || null;
      pressed = view.pressed || null;
      const k = canvas.width / LW;
      ctx.setTransform(k, 0, 0, canvas.height / L.height, ox * k, 0);
      ctx.clearRect(-ox, 0, LW, L.height);
      if (view.screen === 'title') drawTitle(view);
      else if (view.screen === 'game') drawGame(view);
      else if (view.screen === 'result') drawResult(view);
      else if (view.screen === 'players') drawPlayers(view);
      else if (view.screen === 'modes') drawModes(view);
      if (view.toast) drawToast(view.toast);
      // 화면 전환: 새 화면 위의 검은 덮개가 걷힘
      if (view.fade > 0) {
        ctx.fillStyle = 'rgba(0,0,0,' + (view.fade * view.fade).toFixed(3) + ')';
        ctx.fillRect(-ox, 0, LW, L.height);
      }
      return hits;
    }

    // 결과 공유 카드 (1280×720 PNG용 캔버스). 화면 그리기 도우미를 그대로 쓰려고 ctx를 잠시 바꾼다
    function makeShareCard(r, now) {
      const cv = document.createElement('canvas');
      cv.width = L.width;
      cv.height = L.height;
      const savedCtx = ctx;
      const savedHits = hits;
      ctx = cv.getContext('2d');
      try {
        const s = r.summary;
        drawBackdrop(now, 'rgba(8,14,26,0.6)', s.mood);
        text('타자 시점 야구', 48, 50, 26, '#cfe', 'left', 'bold');
        text(r.date.replace(/-/g, '.'), L.width - 48, 50, 24, '#cfe', 'right');
        const bats = r.player && r.player.bats === 'L' ? '좌타' : '우타';
        const scoreMode = !!(s.rules && s.rules.maxOuts);
        const mode =
          s.mode === 'challenge'
            ? r.date.slice(5).replace('-', '/') + ' 챌린지 · 투수 ' + s.pitcherName + (r.official ? '' : ' (연습)')
            : s.modeName
              ? '도전 모드 · ' + s.modeName
              : C.LEVELS[s.levelIndex].name + ' ' + C.LEVELS[s.levelIndex].title + ' · ' + C.LEVELS[s.levelIndex].baseSpeed + 'km';
        outlined(r.playerName, 640, 150, 56, '#ffd34d');
        text(bats + ' · ' + mode, 640, 210, 28, '#fff', 'center', 'bold');
        if (scoreMode) {
          text(s.mode === 'derby' ? '홈런' : '안타', 640, 280, 26, '#aab', 'center');
          outlined(s.score + '개', 640, 370, 130, '#ffd34d');
          text(s.atBats + '타석 · 안타 ' + s.hits + ' · 홈런 ' + s.homers + ' · 삼진 ' + s.strikeouts, 640, 470, 28, '#fff', 'center');
        } else {
          text('이번 타율', 640, 280, 26, '#aab', 'center');
          outlined(BB.formatAvg(s.avg), 640, 370, 130, '#ffd34d');
          text(s.hits + '안타 / ' + C.AT_BATS_PER_GAME + '타수 · 홈런 ' + s.homers + (s.triples ? ' · 3루타 ' + s.triples : '') + ' · 2루타 ' + s.doubles + ' · 삼진 ' + s.strikeouts, 640, 470, 28, '#fff', 'center');
        }
        if (s.mode === 'normal' && r.careerAfter !== null) {
          text('통산 타율 ' + BB.formatAvg(r.careerAfter) + ' (' + r.player.hits + '안타 / ' + r.player.atBats + '타수)', 640, 520, 26, '#cde', 'center', 'bold');
        }
        if (s.mode === 'challenge') drawOutcomeGrid(s.atBatLog, 640, 500, 52);
        const badges = [];
        if (s.mission && s.missionDone) badges.push(['미션 달성! ' + s.mission.text, '#7cf29a']);
        if (r.newRecord) badges.push(['NEW RECORD', '#ff6b6b']);
        if (r.unlockedLevel !== null) badges.push([C.LEVELS[r.unlockedLevel].name + ' 해제!', '#7cf29a']);
        if (r.newTitles && r.newTitles.length) badges.push(['칭호 ' + titleNames(r.newTitles), '#ffe9a0']);
        const bs = badges.length > 2 ? 32 : 40;
        badges.forEach(([str, col], i) => outlined(str, 640 + (i - (badges.length - 1) / 2) * (badges.length > 2 ? 400 : 360), 600, bs, col));
        // 대표 칭호 (이름 아래)
        const t = BB.topTitle(r.player);
        if (t) {
          ctx.font = 'bold 20px ' + FONT;
          titlePill(t.name, 640 - (ctx.measureText(t.name).width + 20) / 2, 104, 20);
        }
      } finally {
        ctx = savedCtx;
        hits = savedHits;
      }
      return cv;
    }

    resize();
    return { resize, toLogical, cellAt, draw, setTouch, makeShareCard, cssScale: () => cssScale };
  }

  Object.assign(BB, { createRenderer });
})(window);
