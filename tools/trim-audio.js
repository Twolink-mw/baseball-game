// 음원 자르기 (재인코딩 없음, Node 내장 모듈만 사용)
// - mp3: 프레임(약 0.026초) 단위로 필요한 구간만 남긴다. ID3 태그(앨범 그림 등)와 VBR 정보 프레임은 제거.
// - wav(PCM): 샘플 단위로 자른다.
'use strict';

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG1 Layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG2/2.5 Layer III
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

// pos 위치의 mp3 프레임 헤더 해석. 올바르지 않으면 null
function frameAt(buf, pos) {
  if (pos + 4 > buf.length) return null;
  const b1 = buf[pos + 1];
  const b2 = buf[pos + 2];
  if (buf[pos] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const ver = (b1 >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layer = (b1 >> 1) & 3; // 1=Layer III
  if (ver === 1 || layer !== 1) return null;
  const bi = b2 >> 4;
  const si = (b2 >> 2) & 3;
  if (bi === 0 || bi === 15 || si === 3) return null;
  const mpeg1 = ver === 3;
  const bitrate = BITRATES[mpeg1 ? 1 : 2][bi] * 1000;
  const sr = SAMPLE_RATES[ver][si];
  const pad = (b2 >> 1) & 1;
  const len = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sr) + pad;
  const samples = mpeg1 ? 1152 : 576;
  return { pos, len, sr, dur: samples / sr, mpeg1, channels: (buf[pos + 3] >> 6) === 3 ? 1 : 2 };
}

// VBR 정보 프레임(Xing/Info/VBRI)이면 true: 재생 길이를 잘못 알려 줄 수 있어 잘라낸 파일에서는 뺀다
function isInfoFrame(buf, f) {
  const side = f.mpeg1 ? (f.channels === 1 ? 17 : 32) : f.channels === 1 ? 9 : 17;
  const tag = buf.toString('latin1', f.pos + 4 + side, f.pos + 8 + side);
  return tag === 'Xing' || tag === 'Info' || buf.toString('latin1', f.pos + 36, f.pos + 40) === 'VBRI';
}

function mp3Frames(buf) {
  let pos = 0;
  // ID3v2 태그 건너뛰기
  if (buf.toString('latin1', 0, 3) === 'ID3' && buf.length > 10) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    pos = 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  let end = buf.length;
  if (end >= 128 && buf.toString('latin1', end - 128, end - 125) === 'TAG') end -= 128; // ID3v1
  const frames = [];
  while (pos + 4 <= end) {
    const f = frameAt(buf, pos);
    // 다음 프레임 헤더까지 맞아야 진짜 프레임으로 인정 (우연히 0xFF가 나온 경우 대비)
    if (f && pos + f.len <= end && (pos + f.len === end || frameAt(buf, pos + f.len) || pos + f.len + 4 > end)) {
      frames.push(f);
      pos += f.len;
    } else {
      pos++;
    }
  }
  if (frames.length && isInfoFrame(buf, frames[0])) frames.shift();
  return frames;
}

// [startSec, startSec + durSec) 를 덮는 프레임만 남긴다. durSec가 없으면 끝까지.
// 돌려주는 start는 실제로 남긴 첫 프레임의 시각(초)
function trimMp3(buf, startSec, durSec) {
  const frames = mp3Frames(buf);
  if (!frames.length) throw new Error('mp3 프레임을 찾지 못했습니다');
  const total = frames.reduce((a, f) => a + f.dur, 0);
  const from = Math.max(0, startSec || 0);
  const to = durSec ? from + durSec : Infinity;
  const kept = [];
  let t = 0;
  let start = null;
  for (const f of frames) {
    if (t + f.dur > from && t < to) {
      if (start === null) start = t;
      kept.push(buf.subarray(f.pos, f.pos + f.len));
    }
    t += f.dur;
  }
  if (!kept.length) throw new Error(`자를 구간(${from}초~)이 파일 길이(${total.toFixed(1)}초)를 벗어났습니다`);
  const keptDur = kept.length * frames[0].dur;
  return { buf: Buffer.concat(kept), start, duration: keptDur, total };
}

// PCM wav 자르기
function trimWav(buf, startSec, durSec) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('wav 형식이 아닙니다');
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(pos + 10), sr: buf.readUInt32LE(pos + 12), block: buf.readUInt16LE(pos + 20) };
    if (id === 'data' && fmt) {
      const data = buf.subarray(pos + 8, pos + 8 + size);
      const total = data.length / fmt.block / fmt.sr;
      const s0 = Math.min(Math.floor((startSec || 0) * fmt.sr), Math.floor(data.length / fmt.block));
      const s1 = durSec ? Math.min(Math.floor(data.length / fmt.block), s0 + Math.ceil(durSec * fmt.sr)) : Math.floor(data.length / fmt.block);
      const body = data.subarray(s0 * fmt.block, s1 * fmt.block);
      // 표준 44바이트 헤더(RIFF + 16바이트 fmt + data)로 다시 씀
      const out = Buffer.alloc(44 + body.length);
      out.write('RIFF', 0, 'latin1');
      out.writeUInt32LE(36 + body.length, 4);
      out.write('WAVE', 8, 'latin1');
      out.write('fmt ', 12, 'latin1');
      out.writeUInt32LE(16, 16);
      out.writeUInt16LE(1, 20);
      out.writeUInt16LE(fmt.channels, 22);
      out.writeUInt32LE(fmt.sr, 24);
      out.writeUInt32LE(fmt.sr * fmt.block, 28);
      out.writeUInt16LE(fmt.block, 32);
      out.writeUInt16LE((fmt.block / fmt.channels) * 8, 34);
      out.write('data', 36, 'latin1');
      out.writeUInt32LE(body.length, 40);
      body.copy(out, 44);
      return { buf: out, start: s0 / fmt.sr, duration: (s1 - s0) / fmt.sr, total };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error('wav data 청크를 찾지 못했습니다');
}

module.exports = { trimMp3, trimWav, mp3Frames, frameAt };
