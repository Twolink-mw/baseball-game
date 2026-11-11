// PWA 아이콘 생성: node tools/make-icons.js → icons/*.png
// 오리지널 디자인(남색 바탕 + 비스듬한 배트 + 야구공). Node 내장 모듈(zlib)만 사용해 PNG를 직접 만든다.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- PNG 인코더 (RGBA 8비트) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // 필터 없음
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 도형 (단위 정사각형 0~1 좌표) ----
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const NAVY_TOP = hex('#24467f');
const NAVY_BOT = hex('#0f1c30');
const BALL = hex('#fbfbf6');
const BALL_SHADE = hex('#d9d6cc');
const SEAM = hex('#d23b33');
const BAT_LIGHT = hex('#e2bd84');
const BAT_DARK = hex('#a77a43');
const TAPE = hex('#1a1f2b');

// 둥근 사각형 안이면 음수인 거리
function roundRectDist(x, y, r) {
  const qx = Math.abs(x - 0.5) - (0.5 - r);
  const qy = Math.abs(y - 0.5) - (0.5 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// 선분까지 거리와 선분 위 위치(0~1)
function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

// 한 점의 색 [r,g,b,a]. opts.full: 바탕을 꽉 채움(maskable/apple), scale: 그림 크기
function shade(x, y, opts) {
  // 그림 좌표: 가운데 기준으로 scale만큼 줄임
  const s = opts.scale;
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  let col = null;
  // 바탕
  const inBg = opts.full ? true : roundRectDist(x, y, 0.22) < 0;
  if (inBg) {
    const k = y;
    col = [0, 1, 2].map((i) => NAVY_TOP[i] + (NAVY_BOT[i] - NAVY_TOP[i]) * k);
  }
  // 배트: 왼쪽 아래 → 오른쪽 위, 손잡이는 가늘고 끝은 굵게
  const bat = segment(u, v, 0.2, 0.86, 0.86, 0.18);
  const batR = 0.028 + 0.05 * Math.pow(bat.t, 1.6);
  if (bat.d < batR && bat.t > 0.001) {
    if (bat.t < 0.16) col = TAPE;
    else {
      const k = Math.min(1, bat.d / batR);
      col = [0, 1, 2].map((i) => BAT_LIGHT[i] + (BAT_DARK[i] - BAT_LIGHT[i]) * k * k);
    }
  }
  // 야구공: 오른쪽 아래
  const bx = 0.6;
  const by = 0.6;
  const R = 0.25;
  const d = Math.hypot(u - bx, v - by);
  if (d < R) {
    // 왼쪽 위에서 빛을 받는 음영
    const lit = Math.max(0, Math.min(1, (Math.hypot(u - (bx - R * 0.35), v - (by - R * 0.35)) / (R * 1.4))));
    col = [0, 1, 2].map((i) => BALL[i] + (BALL_SHADE[i] - BALL[i]) * lit * lit);
    // 실밥: 공 양쪽에 바깥쪽으로 휜 곡선 두 개
    for (const side of [-1, 1]) {
      const cx = bx + side * R * 1.32;
      const seamD = Math.abs(Math.hypot(u - cx, v - by) - R * 0.98);
      if (seamD < R * 0.045) col = SEAM;
      // 바늘땀
      const ang = Math.atan2(v - by, u - cx);
      const ring = Math.hypot(u - cx, v - by) - R * 0.98;
      const tick = Math.abs(((ang * 180) / Math.PI / 11) % 1);
      if (Math.abs(ring) < R * 0.13 && Math.abs(ring) > R * 0.05 && (tick < 0.18 || tick > 0.82)) col = SEAM;
    }
  }
  if (!col) return [0, 0, 0, 0];
  return [col[0], col[1], col[2], 255];
}

// 4×4 슈퍼샘플링으로 가장자리를 부드럽게
function render(size, opts) {
  const rgba = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = shade((px + (sx + 0.5) / N) / size, (py + (sy + 0.5) / N) / size, opts);
          const al = c[3] / 255;
          r += c[0] * al;
          g += c[1] * al;
          b += c[2] * al;
          a += al;
        }
      }
      const o = (py * size + px) * 4;
      rgba[o] = a ? Math.round(r / a) : 0;
      rgba[o + 1] = a ? Math.round(g / a) : 0;
      rgba[o + 2] = a ? Math.round(b / a) : 0;
      rgba[o + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const ICONS = [
  // any: 둥근 사각형 바탕, 투명 모서리
  { file: 'icon-192.png', size: 192, full: false, scale: 0.92 },
  { file: 'icon-512.png', size: 512, full: false, scale: 0.92 },
  // maskable: 바탕을 꽉 채우고 그림은 가운데 안전 영역(지름 80%) 안에
  { file: 'icon-maskable-512.png', size: 512, full: true, scale: 0.74 },
  // iOS 홈 화면: 꽉 채움 (iOS가 모서리를 둥글게 자름)
  { file: 'apple-touch-icon.png', size: 180, full: true, scale: 0.86 },
  { file: 'favicon-32.png', size: 32, full: false, scale: 1 },
];

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(dir, { recursive: true });
  for (const ic of ICONS) {
    const png = render(ic.size, ic);
    fs.writeFileSync(path.join(dir, ic.file), png);
    console.log(`icons/${ic.file} ${ic.size}x${ic.size} ${(png.length / 1024).toFixed(1)}KB`);
  }
}

module.exports = { encodePng, render, crc32, ICONS };
