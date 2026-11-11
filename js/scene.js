// 타자 시점 구장 그리기: 배경(캐시), 구름, 전광판, 투수, 타자
// 실존 구단/광고/선수와 무관한 오리지널 디자인. 모든 그래픽은 코드로 그린다.
(function (global) {
  'use strict';

  const BB = global.BB;
  const C = BB.CONFIG;
  const L = C.LAYOUT;
  const V = L.view;
  const W = L.width;
  // 배경을 그리는 가로 범위(게임 좌표). 화면이 16:9보다 넓으면 양옆으로 넓혀 그린다
  let X0 = 0;
  let X1 = W;
  function setExtent(ox) {
    X0 = -ox;
    X1 = W + ox;
  }
  const H = L.height;

  // 구장 좌표(피트) → 화면 좌표. 카메라 바로 앞(뒤)는 잘라서 화면 밖으로 보낸다.
  function project(x, z) {
    const zz = Math.max(z + V.camDist, 2);
    return { x: W / 2 + (V.focal * x) / zz, y: V.horizonY + (V.focal * V.camHeight) / zz };
  }

  function polyField(c, pts) {
    c.beginPath();
    pts.forEach(([x, z], i) => {
      const p = project(x, z);
      if (i) c.lineTo(p.x, p.y);
      else c.moveTo(p.x, p.y);
    });
    c.closePath();
  }

  function circleField(c, cx, cz, r, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    polyField(c, pts);
  }

  const FENCE_Z = 400;
  const fenceY = () => project(0, FENCE_Z).y; // 펜스 밑동
  const FENCE_H = 22;

  // ---- 고정 배경 (하늘 제외) ----
  function paintStatic(c) {
    const fy = fenceY();
    const deco = BB.createRng(20261111); // 장식 전용 RNG (게임 RNG와 무관)

    // 관중석: 가장자리가 높은 그릇 모양
    const topAt = (x) => 96 + 50 * Math.cos(((x - W / 2) / W) * Math.PI); // 가운데 146, 가장자리 96
    c.beginPath();
    c.moveTo(X0, fy);
    for (let x = X0; x <= X1 + 20; x += 20) c.lineTo(x, topAt(x));
    c.lineTo(X1 + 20, fy);
    c.closePath();
    const st = c.createLinearGradient(0, 90, 0, fy);
    st.addColorStop(0, '#1b2438');
    st.addColorStop(1, '#2c3a55');
    c.fillStyle = st;
    c.fill();
    // 관중(점)
    const crowd = ['#e8e2d0', '#c94f4f', '#3f6fb5', '#f0c04a', '#ffffff', '#6aa86a', '#2b2b2b', '#d98a4a'];
    for (let y = 104; y < fy - FENCE_H - 4; y += 5) {
      for (let x = X0 + 2; x < X1; x += 5) {
        if (y < topAt(x) + 6) continue;
        if (deco.next() < 0.18) continue;
        c.fillStyle = crowd[deco.int(crowd.length)];
        c.globalAlpha = 0.35 + deco.next() * 0.4;
        c.fillRect(x + deco.next(), y + deco.next(), 3, 3);
      }
    }
    c.globalAlpha = 1;
    // 층 구분선
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 3;
    c.beginPath();
    for (let x = X0; x <= X1 + 20; x += 20) {
      const y = topAt(x) + (fy - topAt(x)) * 0.45;
      if (x > X0) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.stroke();
    // 지붕 끝선
    c.strokeStyle = '#c7ccd8';
    c.lineWidth = 3;
    c.beginPath();
    for (let x = X0; x <= X1 + 20; x += 20) {
      if (x > X0) c.lineTo(x, topAt(x));
      else c.moveTo(x, topAt(x));
    }
    c.stroke();

    // 조명탑
    // 넓은 화면이면 양옆 조명탑도 보임
    for (const tx of [-330, 96, 420, 1184, 1610]) if (tx > X0 - 80 && tx < X1 + 80) drawLightTower(c, tx, topAt(tx));

    // 전광판(틀). 글자는 매 프레임 drawScoreboard에서 그림
    const sb = SCOREBOARD;
    c.fillStyle = '#3a3f4a';
    c.fillRect(sb.x + 30, sb.y + sb.h, 10, 40);
    c.fillRect(sb.x + sb.w - 40, sb.y + sb.h, 10, 40);
    c.fillStyle = '#20242c';
    c.fillRect(sb.x - 6, sb.y - 6, sb.w + 12, sb.h + 12);
    c.fillStyle = '#05070a';
    c.fillRect(sb.x, sb.y, sb.w, sb.h);
    c.strokeStyle = '#59606e';
    c.lineWidth = 2;
    c.strokeRect(sb.x - 6, sb.y - 6, sb.w + 12, sb.h + 12);

    // 외야 펜스 + 가상의 광고판
    c.fillStyle = '#1c5537';
    c.fillRect(X0, fy - FENCE_H, X1 - X0, FENCE_H);
    const ads = [
      ['BB 스포츠', '#d9442b', '#fff'], ['홈런 음료', '#f2c230', '#222'], ['야구 교실', '#2f7de1', '#fff'],
      ['배트 공방', '#ffffff', '#1c5537'], ['구장 분식', '#e07a2e', '#fff'], ['스윙 체육관', '#7a4fc2', '#fff'],
    ];
    const aw = 150;
    // 광고판은 원래 위치(20부터 174 간격)를 유지한 채 왼쪽으로도 이어 붙임
    const step = aw + 24;
    const firstI = Math.floor((X0 - 20) / step);
    for (let i = firstI, x = 20 + firstI * step; x < X1; i++, x += step) {
      const [label, bg, fg] = ads[((i % ads.length) + ads.length) % ads.length];
      c.fillStyle = bg;
      c.fillRect(x, fy - FENCE_H + 4, aw, FENCE_H - 8);
      c.fillStyle = fg;
      c.font = 'bold 11px ' + FONT;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, x + aw / 2, fy - FENCE_H / 2);
    }
    c.fillStyle = '#f2c230'; // 펜스 위 노란 선
    c.fillRect(X0, fy - FENCE_H - 2, X1 - X0, 3);

    // 잔디
    const gy = fy;
    const grass = c.createLinearGradient(0, gy, 0, H);
    grass.addColorStop(0, '#2a7a3e');
    grass.addColorStop(1, '#358f48');
    c.fillStyle = grass;
    c.fillRect(X0, gy, X1 - X0, H - gy);
    // 깎은 자국(체크무늬): 깊이 방향 띠 + 좌우 방향 띠
    c.fillStyle = 'rgba(255,255,255,0.05)';
    for (let z = 0; z < FENCE_Z; z += 30) polyField(c, [[-400, z], [400, z], [400, z + 15], [-400, z + 15]]), c.fill();
    c.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = -390; x < 390; x += 30) polyField(c, [[x, -10], [x + 15, -10], [x + 15, FENCE_Z], [x, FENCE_Z]]), c.fill();
    // 워닝 트랙
    c.fillStyle = '#9c6e45';
    polyField(c, [[-500, FENCE_Z - 15], [500, FENCE_Z - 15], [500, FENCE_Z], [-500, FENCE_Z]]);
    c.fill();

    // 내야 흙(마운드 중심 반지름 95ft 부채꼴) → 내야 잔디 → 베이스 → 마운드 → 홈 주변
    c.fillStyle = '#b98352';
    circleField(c, 0, 60.5, 95, 64);
    c.fill();
    c.fillStyle = '#2f8544';
    polyField(c, [[0, 6], [57, 63.6], [0, 121], [-57, 63.6]]);
    c.fill();
    // 베이스 라인(흰 선) — 홈에서 1·3루 방향
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 2;
    for (const s of [-1, 1]) {
      const a = project(0, 0);
      const b = project(s * 300, 300);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.fillStyle = '#f4f4f4';
    for (const [bx, bz] of [[63.6, 63.6], [0, 127.3], [-63.6, 63.6]]) {
      polyField(c, [[bx - 1, bz], [bx, bz - 1], [bx + 1, bz], [bx, bz + 1]]);
      c.fill();
    }
    // 마운드
    c.fillStyle = '#c4905e';
    circleField(c, 0, 60.5, 9, 40);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.12)';
    circleField(c, 0, 61.5, 7, 40);
    c.fill();
    c.fillStyle = '#fafafa'; // 투수판
    polyField(c, [[-1, 60.3], [1, 60.3], [1, 60.8], [-1, 60.8]]);
    c.fill();
    // 홈 주변 흙 + 타석
    c.fillStyle = '#b98352';
    circleField(c, 0, 0, 13, 48);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = 3;
    for (const s of [-1, 1]) {
      polyField(c, [[s * 1.2, -3], [s * 5.2, -3], [s * 5.2, 3], [s * 1.2, 3]]);
      c.stroke();
    }
    // 홈플레이트(뾰족한 쪽이 포수 방향)
    c.fillStyle = '#ffffff';
    polyField(c, [[-0.71, 1.42], [0.71, 1.42], [0.71, 0.71], [0, 0], [-0.71, 0.71]]);
    c.fill();

    // 가장자리 어둡게
    const vg = c.createRadialGradient(W / 2, H * 0.55, H * 0.4, W / 2, H * 0.55, (X1 - X0) * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = vg;
    c.fillRect(X0, 0, X1 - X0, H);
  }

  function drawLightTower(c, x, baseY) {
    c.fillStyle = '#4a5160';
    c.fillRect(x - 3, 40, 6, baseY - 40);
    c.fillStyle = '#2b303a';
    c.fillRect(x - 34, 18, 68, 30);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 7; k++) {
        c.fillStyle = '#fff6d8';
        c.beginPath();
        c.arc(x - 27 + k * 9, 24 + r * 9, 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    const glow = c.createRadialGradient(x, 33, 4, x, 33, 70);
    glow.addColorStop(0, 'rgba(255,248,220,0.35)');
    glow.addColorStop(1, 'rgba(255,248,220,0)');
    c.fillStyle = glow;
    c.fillRect(x - 70, -40, 140, 150);
  }

  const FONT = 'system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const SCOREBOARD = { x: 820, y: 58, w: 250, h: 74 };

  // 배경 캐시: 실제 픽셀 크기(w,h)로 한 번 그려 두고 매 프레임 drawImage
  // w,h: 실제 픽셀 크기. 캐시는 X0~X1 전체 폭을 담는다
  function buildBackground(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d');
    const lw = X1 - X0;
    c.setTransform(w / lw, 0, 0, h / H, (-X0 * w) / lw, 0);
    paintStatic(c);
    return cv;
  }

  // ---- 매 프레임 ----
  function drawSky(c, nowSec) {
    const sky = c.createLinearGradient(0, 0, 0, fenceY());
    sky.addColorStop(0, '#2d5f9e');
    sky.addColorStop(0.7, '#8fc0e6');
    sky.addColorStop(1, '#d2e8f6');
    c.fillStyle = sky;
    c.fillRect(X0, 0, X1 - X0, fenceY());
    // 구름: 정해진 모양이 천천히 흘러간다
    const clouds = [[80, 52, 1], [460, 30, 0.8], [760, 70, 1.2], [1100, 40, 0.9]];
    c.fillStyle = 'rgba(255,255,255,0.85)';
    const span = X1 - X0 + 300;
    for (const [x0, y, s] of clouds) {
      const x = ((((x0 - X0 + nowSec * C.FX.cloudSpeed * s) % span) + span) % span) - 150 + X0;
      c.beginPath();
      c.ellipse(x, y, 46 * s, 14 * s, 0, 0, Math.PI * 2);
      c.ellipse(x - 28 * s, y + 4 * s, 26 * s, 10 * s, 0, 0, Math.PI * 2);
      c.ellipse(x + 30 * s, y + 3 * s, 30 * s, 11 * s, 0, 0, Math.PI * 2);
      c.ellipse(x + 4 * s, y - 9 * s, 24 * s, 12 * s, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  // 전광판 글자(LED 느낌). flash: 홈런 등 강조 문구
  function drawScoreboard(c, line1, line2, flash, nowSec) {
    const sb = SCOREBOARD;
    c.save();
    c.beginPath();
    c.rect(sb.x, sb.y, sb.w, sb.h);
    c.clip();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (flash && Math.floor(nowSec * 6) % 2 === 0) {
      c.fillStyle = '#3b2a00';
      c.fillRect(sb.x, sb.y, sb.w, sb.h);
    }
    c.font = 'bold 22px ' + FONT;
    c.fillStyle = flash ? '#ffd34d' : '#ff9a3c';
    c.fillText(flash || line1, sb.x + sb.w / 2, sb.y + 26);
    c.font = 'bold 15px ' + FONT;
    c.fillStyle = '#7cf29a';
    c.fillText(line2, sb.x + sb.w / 2, sb.y + 55);
    c.restore();
  }

  // ---- 투수 ----
  // 관절 키프레임(발 중앙 기준, 위가 -). 화면 왼쪽 팔이 던지는 팔(정면에서 본 우투수).
  // 순서: hip, neck, head, tElbow, tHand, gElbow, gHand, pKnee, pFoot, sKnee, sFoot
  const POSES = {
    set: [[0, -38], [0, -64], [0, -73], [-8, -50], [-2, -46], [8, -50], [2, -46], [-6, -19], [-7, 0], [6, -19], [7, 0]],
    lift: [[-2, -40], [-2, -66], [-2, -75], [-9, -54], [0, -56], [7, -54], [1, -56], [-4, -20], [-6, 0], [12, -44], [7, -28]],
    cock: [[2, -36], [4, -60], [5, -69], [-18, -62], [-26, -76], [16, -60], [24, -58], [-8, -20], [-10, 0], [12, -16], [15, 6]],
    release: [[2, -32], [0, -54], [0, -62], [-10, -58], [-6, -54], [12, -48], [6, -44], [-10, -16], [-14, -6], [10, -14], [14, 6]],
    follow: [[4, -28], [8, -46], [9, -54], [4, -36], [16, -22], [14, -40], [10, -42], [-6, -16], [-16, -14], [10, -14], [14, 6]],
  };
  // (시각, 자세) 목록에서 보간
  const WINDUP_KEYS = [[0, 'set'], [0.15, 'set'], [0.5, 'lift'], [0.8, 'cock'], [1, 'release']];

  function blendPose(a, b, t) {
    const e = t * t * (3 - 2 * t);
    return POSES[a].map((p, i) => [p[0] + (POSES[b][i][0] - p[0]) * e, p[1] + (POSES[b][i][1] - p[1]) * e]);
  }

  function pitcherPose(phase, windupT, flightElapsed) {
    if (phase === 'PITCH_WINDUP') {
      for (let i = 1; i < WINDUP_KEYS.length; i++) {
        const [t1, p1] = WINDUP_KEYS[i];
        const [t0, p0] = WINDUP_KEYS[i - 1];
        if (windupT <= t1) return blendPose(p0, p1, t1 > t0 ? (windupT - t0) / (t1 - t0) : 1);
      }
      return POSES.release;
    }
    if (phase === 'PITCH_FLIGHT') {
      if (flightElapsed < 0.12) return blendPose('release', 'follow', flightElapsed / 0.12);
      return POSES.follow;
    }
    if (phase === 'RESULT_SHOW') return blendPose('follow', 'set', Math.min(1, flightElapsed / 0.6));
    return POSES.set;
  }

  function drawPitcher(c, pose) {
    const P = L.pitcher;
    const s = P.scale;
    const pt = (i) => ({ x: P.x + pose[i][0] * s, y: P.y + pose[i][1] * s });
    const [hip, neck, head, tE, tH, gE, gH, pK, pF, sK, sF] = pose.map((_, i) => pt(i));
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // 그림자
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(P.x, P.y + 2, 18 * s, 4 * s, 0, 0, Math.PI * 2);
    c.fill();
    const limb = (pts, w, col) => {
      c.strokeStyle = col;
      c.lineWidth = w * s;
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
      c.stroke();
    };
    // 다리(바지) + 신발
    limb([hip, pK, pF], 7, '#d6d8de');
    limb([hip, sK, sF], 7, '#e4e6ec');
    c.fillStyle = '#1a1f2b';
    for (const f of [pF, sF]) c.fillRect(f.x - 4 * s, f.y - 2 * s, 8 * s, 4 * s);
    // 몸통
    limb([hip, neck], 15, '#f2f3f6');
    c.strokeStyle = '#2b4a8b'; // 허리 띠
    c.lineWidth = 3 * s;
    c.beginPath();
    c.moveTo(hip.x - 7 * s, hip.y - 2 * s);
    c.lineTo(hip.x + 7 * s, hip.y - 2 * s);
    c.stroke();
    // 팔
    limb([neck, gE, gH], 5, '#eceef2');
    limb([neck, tE, tH], 5, '#eceef2');
    c.fillStyle = '#7a4a24'; // 글러브
    c.beginPath();
    c.arc(gH.x, gH.y, 4.5 * s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#e0b48c'; // 던지는 손
    c.beginPath();
    c.arc(tH.x, tH.y, 2.5 * s, 0, Math.PI * 2);
    c.fill();
    // 머리 + 모자
    c.fillStyle = '#e0b48c';
    c.beginPath();
    c.arc(head.x, head.y, 6.5 * s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1f3566';
    c.beginPath();
    c.arc(head.x, head.y - 1 * s, 6.8 * s, Math.PI, 0);
    c.fill();
    c.fillRect(head.x - 8 * s, head.y - 2 * s, 16 * s, 2.5 * s);
    c.restore();
  }

  // ---- 타자 (화면 오른쪽, 등 쪽에서 본 모습) ----
  // swing: 0(준비) → 1(팔로스루). null이면 준비 자세
  function drawBatter(c, swing) {
    const B = L.batter;
    const s = swing === null ? 0 : swing;
    const bs = Math.min(1, s / 0.45); // 몸통 회전 진행도
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const bx = B.x;
    const by = B.y;
    // 그림자
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    c.ellipse(bx, by + 4, 90, 16, 0, 0, Math.PI * 2);
    c.fill();
    // 다리: 스윙하면서 앞발(왼쪽)로 체중 이동
    const hip = { x: bx - 4 - 22 * bs, y: by - 150 };
    const fL = { x: bx - 56, y: by };
    const fR = { x: bx + 48, y: by - 2 * bs };
    const kL = { x: bx - 48 - 6 * bs, y: by - 76 };
    const kR = { x: bx + 36 - 14 * bs, y: by - 72 + 6 * bs };
    const leg = (k, f, col) => {
      c.strokeStyle = col;
      c.lineWidth = 30;
      c.beginPath();
      c.moveTo(hip.x, hip.y);
      c.lineTo(k.x, k.y);
      c.lineTo(f.x, f.y - 14);
      c.stroke();
      c.fillStyle = '#14171f';
      c.beginPath();
      c.ellipse(f.x, f.y - 6, 22, 10, 0, 0, Math.PI * 2);
      c.fill();
    };
    leg(kR, fR, '#d2d5dc');
    leg(kL, fL, '#e3e5eb');
    // 몸통: 등 번호 없는 남색 유니폼, 스윙 때 왼쪽으로 회전
    const sh = { x: bx - 2 - 34 * bs, y: by - 262 + 6 * bs };
    const torsoW = 74 - 18 * Math.sin(bs * Math.PI);
    c.fillStyle = '#24345a';
    c.beginPath();
    c.moveTo(hip.x - 30, hip.y + 12);
    c.lineTo(hip.x + 30, hip.y + 12);
    c.lineTo(sh.x + torsoW / 2, sh.y + 10);
    c.quadraticCurveTo(sh.x, sh.y - 16, sh.x - torsoW / 2, sh.y + 10);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(hip.x - 30, hip.y - 4, 60, 10); // 벨트 부분
    // 손 위치와 배트 각도 (키프레임 보간)
    const { hand, ang, len } = batPose(bx, by, s);
    // 배트 잔상: 조금 전 스윙 자세들
    if (swing !== null && swing > 0 && swing < 1) {
      for (let g = 1; g <= 3; g++) {
        const prev = batPose(bx, by, Math.max(0, s - g * 0.07));
        drawBat(c, prev.hand, prev.ang, 0.2 / g, prev.len);
      }
    }
    // 뒷팔 → 배트 → 앞팔 순서로 겹치게
    c.strokeStyle = '#24345a';
    c.lineWidth = 20;
    c.beginPath();
    c.moveTo(sh.x + torsoW / 2 - 8, sh.y + 14);
    c.quadraticCurveTo(sh.x + torsoW / 2 + 10, sh.y + 50, hand.x, hand.y);
    c.stroke();
    drawBat(c, hand, ang, 1, len);
    c.beginPath();
    c.moveTo(sh.x - torsoW / 2 + 8, sh.y + 14);
    c.quadraticCurveTo(sh.x - 10, sh.y + 56, hand.x, hand.y);
    c.stroke();
    c.fillStyle = '#efefef'; // 장갑
    c.beginPath();
    c.arc(hand.x, hand.y, 11, 0, Math.PI * 2);
    c.fill();
    // 헬멧(뒤에서 본 모습)
    const hx = sh.x + 6 - 10 * bs;
    const hy = sh.y - 34;
    c.fillStyle = '#c99a72'; // 목
    c.fillRect(hx - 10, hy + 14, 20, 20);
    const hg = c.createRadialGradient(hx - 8, hy - 10, 4, hx, hy, 34);
    hg.addColorStop(0, '#3d5791');
    hg.addColorStop(1, '#16213d');
    c.fillStyle = hg;
    c.beginPath();
    c.arc(hx, hy, 30, 0, Math.PI * 2);
    c.fill();
    c.beginPath(); // 귀 보호대(포수 쪽에서 보이는 왼쪽)
    c.ellipse(hx - 24, hy + 10, 12, 16, 0.3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // 손 위치와 배트 각도 키프레임. 클릭 시각에 공을 맞히도록 존 통과(0.3)를 앞쪽에 둔다.
  // [진행도, 손 x, 손 y(발 기준), 배트 각도, 보이는 길이 비율(멀어지면 짧게)]
  const BAT_KEYS = [
    [0, 28, -278, -1.2, 1], // 준비: 배트를 뒤로 세움
    [0.12, 0, -252, -2.0, 1], // 끌고 나옴
    [0.3, -80, -222, -3.15, 1], // 존 통과(수평)
    [0.55, -96, -262, -2.75, 0.7], // 앞으로 돌아감
    [1, -62, -300, -1.95, 0.6], // 팔로스루: 어깨 위로 감김
  ];

  function batPose(bx, by, s) {
    let k = 1;
    while (k < BAT_KEYS.length - 1 && s > BAT_KEYS[k][0]) k++;
    const a = BAT_KEYS[k - 1];
    const b = BAT_KEYS[k];
    const u = Math.max(0, Math.min(1, (s - a[0]) / (b[0] - a[0])));
    return {
      hand: { x: bx + a[1] + (b[1] - a[1]) * u, y: by + a[2] + (b[2] - a[2]) * u },
      ang: a[3] + (b[3] - a[3]) * u,
      len: a[4] + (b[4] - a[4]) * u,
    };
  }

  function drawBat(c, hand, ang, alpha, lenScale) {
    c.save();
    c.globalAlpha = alpha;
    c.translate(hand.x, hand.y);
    c.rotate(ang);
    const len = 190 * (lenScale || 1);
    const grad = c.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, '#8a6a3e');
    grad.addColorStop(1, '#d8b27a');
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(-14, -4);
    c.lineTo(len * 0.45, -4.5);
    c.quadraticCurveTo(len * 0.7, -10, len, -9);
    c.arc(len, 0, 9, -Math.PI / 2, Math.PI / 2);
    c.quadraticCurveTo(len * 0.7, 10, len * 0.45, 4.5);
    c.lineTo(-14, 4);
    c.closePath();
    c.fill();
    c.fillStyle = '#222'; // 손잡이 테이프
    c.fillRect(-16, -5, 30, 10);
    c.restore();
  }

  Object.assign(BB, {
    scene: { project, setExtent, buildBackground, drawSky, drawScoreboard, pitcherPose, drawPitcher, drawBatter, fenceY, SCOREBOARD },
  });
})(window);
