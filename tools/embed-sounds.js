// 관중 녹음을 브라우저 코드에 내장한다: node tools/embed-sounds.js
// sounds/ 폴더의 <슬롯>.(mp3|m4a|wav|ogg) 파일을 base64로 js/sounds-data.js 에 넣는다.
// mp3/wav는 js/config.js AUDIO.samples의 구간(offset ~ offset+dur)만 잘라서 넣는다(재인코딩 없음).
// file:// 로 열어도 동작해야 해서(로컬 파일 fetch 불가) 음원을 일반 <script> 안의 텍스트로 싣는다.
// Node 내장 모듈만 사용.
'use strict';

const fs = require('fs');
const path = require('path');
const { trimMp3, trimWav } = require('./trim-audio.js');
const { CONFIG } = require('../js/config.js');

const TRIM_MARGIN = 0.25; // 자를 때 뒤쪽 여유(초)

// 쓰는 슬롯 (js/config.js의 AUDIO.samples와 같은 이름)
const SLOTS = ['homerun', 'cheer', 'applause', 'ooh', 'groan', 'ambience'];
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
const WARN_TOTAL_BYTES = 1.5 * 1024 * 1024; // 전체가 이보다 크면 경고 (첫 로딩·PWA 캐시 부담)

function findFiles(dir) {
  const found = {};
  if (!fs.existsSync(dir)) return found;
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    const slot = path.basename(name, path.extname(name)).toLowerCase();
    if (MIME[ext] && SLOTS.includes(slot)) {
      if (found[slot]) throw new Error(`슬롯 '${slot}' 파일이 두 개 이상입니다: ${found[slot].name}, ${name}`);
      found[slot] = { name, slot, file: path.join(dir, name), mime: MIME[ext] };
    }
  }
  return found;
}

// 설정 구간만 남김. { bytes, start(실제 시작 초), duration, total } — 자를 수 없는 형식은 원본 그대로
function prepare(f, samples) {
  const raw = fs.readFileSync(f.file);
  const s = (samples || {})[f.slot] || {};
  const dur = s.dur ? s.dur + TRIM_MARGIN : null;
  if (f.mime === 'audio/mpeg') {
    const r = trimMp3(raw, s.offset || 0, dur);
    return { bytes: r.buf, start: r.start, duration: r.duration, total: r.total };
  }
  if (f.mime === 'audio/wav') {
    const r = trimWav(raw, s.offset || 0, dur);
    return { bytes: r.buf, start: r.start, duration: r.duration, total: r.total };
  }
  return { bytes: raw, start: 0, duration: null, total: null };
}

// 파일 목록 → sounds-data.js 내용
function buildSource(found, prepared) {
  const lines = [
    '// 자동 생성 파일: node tools/embed-sounds.js 로 다시 만든다. 직접 고치지 말 것.',
    '// 출처와 라이선스는 sounds/CREDITS.md 참고.',
    '(function (global) {',
    "  'use strict';",
    '  const BB = (global.BB = global.BB || {});',
    '  BB.SOUND_DATA = {',
  ];
  for (const slot of SLOTS) {
    const f = found[slot];
    if (!f) continue;
    const p = prepared[slot];
    const start = Math.round(p.start * 1e6) / 1e6;
    lines.push(`    ${slot}: { mime: '${f.mime}', src: '${f.name}', start: ${start}, b64: '${p.bytes.toString('base64')}' },`);
  }
  lines.push('  };', "})(typeof window !== 'undefined' ? window : globalThis);", '');
  return lines.join('\n');
}

// samples: 구간 설정(기본은 config의 AUDIO.samples)
function embed(soundsDir, outFile, samples) {
  samples = samples || CONFIG.AUDIO.samples;
  const found = findFiles(soundsDir);
  const prepared = {};
  for (const [slot, f] of Object.entries(found)) prepared[slot] = prepare(f, samples);
  const src = buildSource(found, prepared);
  fs.writeFileSync(outFile, src);
  let total = 0;
  const report = SLOTS.map((slot) => {
    const f = found[slot];
    if (!f) return `  ${slot.padEnd(9)} 없음 (합성음 사용)`;
    const size = fs.statSync(f.file).size;
    const p = prepared[slot];
    total += p.bytes.length;
    const len = p.total ? ` 전체 ${p.total.toFixed(1)}초 중 ${p.start.toFixed(2)}~${(p.start + p.duration).toFixed(2)}초 사용,` : '';
    return `  ${slot.padEnd(9)} ${f.name}:${len} ${(size / 1024).toFixed(0)}KB → ${(p.bytes.length / 1024).toFixed(0)}KB`;
  });
  return { found, prepared, total, report, outBytes: Buffer.byteLength(src) };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const r = embed(path.join(root, 'sounds'), path.join(root, 'js', 'sounds-data.js'));
  console.log('sounds/ → js/sounds-data.js');
  console.log(r.report.join('\n'));
  console.log(`음원 합계 ${(r.total / 1024).toFixed(0)}KB, 내장 파일 ${(r.outBytes / 1024).toFixed(0)}KB`);
  if (r.total > WARN_TOTAL_BYTES) console.log('경고: 음원이 큽니다. 필요한 구간만 잘라 mp3(모노, 96~128kbps)로 넣는 것을 권장합니다.');
  if (Object.keys(r.found).length && !fs.existsSync(path.join(root, 'sounds', 'CREDITS.md'))) {
    console.log('주의: sounds/CREDITS.md 에 파일별 출처 URL·작성자·라이선스를 적어 주세요.');
  }
}

module.exports = { embed, findFiles, SLOTS };
