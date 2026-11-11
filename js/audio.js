// 효과음: WebAudio. 타격·미트·바람 소리는 코드 합성,
// 관중 소리(함성·환호·박수·"오~"·"아~"·웅성거림)는 CC0 녹음이 있으면 녹음(js/sounds-data.js), 없으면 합성.
// 현실감을 위해: 구장 잔향(코드로 만든 임펄스 응답), 나무 배트 공명 모드, 가죽 미트.
// 브라우저 정책상 첫 사용자 입력(unlock) 이후에만 AudioContext를 만든다.
(function (global) {
  'use strict';

  const BB = global.BB;
  const A = BB.CONFIG.AUDIO;

  // opts.context: 미리 만든 컨텍스트(OfflineAudioContext 등, 소리 확인용). 없으면 unlock 때 생성
  function createAudio(opts) {
    opts = opts || {};
    let ctx = null;
    let offline = false;
    let master = null; // 음소거용
    let dry = null; // 효과음 직접 경로
    let verbIn = null; // 잔향 보내기
    let white = null;
    let pink = null;
    let muted = false;
    let ambWanted = false;
    let amb = null; // 배경 웅성거림 { gain, stop(), kind, target }
    const samples = {}; // 슬롯 → 디코딩한 AudioBuffer
    const sampleState = {}; // 슬롯 → 'loading' | 'ready' | 'error'
    const rng = BB.createRng(4242); // 장식용 (게임 RNG와 무관)

    // ---- 초기화 ----
    function build(c) {
      ctx = c;
      const comp = ctx.createDynamicsCompressor(); // 여러 소리가 겹쳐도 찢어지지 않게
      comp.threshold.value = -6; // 평소엔 거의 손대지 않고 겹칠 때만 누름
      comp.knee.value = 6;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : A.volume;
      master.connect(comp).connect(ctx.destination);
      dry = ctx.createGain();
      dry.connect(master);
      const conv = ctx.createConvolver();
      conv.buffer = impulseResponse(A.reverb.seconds, A.reverb.decay);
      verbIn = ctx.createGain();
      verbIn.connect(conv).connect(master);
      white = noiseBuffer(2, false);
      pink = noiseBuffer(3, true);
      decodeSamples();
      if (ambWanted) setAmbience(true);
    }

    // 내장 녹음(base64) 디코딩. 실패하면 그 슬롯은 합성음으로
    function decodeSamples() {
      const data = BB.SOUND_DATA || {};
      for (const [slot, d] of Object.entries(data)) {
        sampleState[slot] = 'loading';
        try {
          const bin = global.atob(d.b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const done = (buf) => {
            samples[slot] = buf;
            sampleState[slot] = 'ready';
            // 합성 웅성거림이 이미 돌고 있으면 녹음으로 교체
            if (slot === 'ambience' && amb && amb.kind === 'synth') {
              amb.stop();
              amb = null;
              if (ambWanted) setAmbience(true);
            }
          };
          const fail = () => {
            if (sampleState[slot] !== 'ready') sampleState[slot] = 'error';
          };
          // 오래된 Safari는 콜백 방식만 지원
          const p = ctx.decodeAudioData(bytes.buffer, done, fail);
          if (p && p.catch) p.catch(fail);
        } catch (e) {
          sampleState[slot] = 'error';
        }
      }
    }

    const hasSample = (slot) => !!samples[slot];

    // 녹음 재생: config의 구간·음량에 intensity를 곱하고, 앞뒤를 부드럽게
    function playSample(slot, t, intensity, durOverride) {
      const s = A.samples[slot] || {};
      const buf = samples[slot];
      const offset = Math.min(s.offset || 0, Math.max(0, buf.duration - 0.05));
      let dur = buf.duration - offset;
      if (s.dur) dur = Math.min(dur, s.dur);
      if (durOverride) dur = Math.min(dur, durOverride);
      const peak = (s.gain == null ? 1 : s.gain) * (intensity == null ? 1 : intensity);
      const fi = Math.min(s.fadeIn || 0.02, dur / 3);
      const fo = Math.min(s.fadeOut || 0.2, dur / 2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + fi);
      g.gain.setValueAtTime(peak, t + dur - fo);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      src.connect(g).connect(out(s.wet == null ? 0.2 : s.wet));
      src.start(t, offset, dur);
    }

    function unlock() {
      if (ctx) {
        if (!offline && ctx.state === 'suspended') ctx.resume();
        return;
      }
      if (opts.context) {
        offline = true;
        return build(opts.context);
      }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try {
        build(new AC());
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {
        ctx = null; // 소리 없이 계속
      }
    }

    function setMuted(m) {
      muted = !!m;
      if (master && !offline) master.gain.setTargetAtTime(muted ? 0 : A.volume, ctx.currentTime, 0.02);
    }

    // 시작 직후(resume 진행 중)에도 예약해 두면 재생되므로 닫힌 경우만 제외
    const ready = () => ctx && !muted && (offline || ctx.state !== 'closed');

    // 노이즈 버퍼 (핑크 노이즈는 관중·바람처럼 자연스러운 소리에 사용)
    function noiseBuffer(seconds, isPink) {
      const n = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = rng.next() * 2 - 1;
        if (!isPink) {
          d[i] = w;
          continue;
        }
        // Paul Kellet 근사 핑크 노이즈
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      return buf;
    }

    // 구장 잔향: 좌우가 조금 다른, 지수적으로 줄어드는 노이즈
    function impulseResponse(seconds, decay) {
      const n = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) {
          const t = i / n;
          // 초반 짧은 지연(먼 벽 반사) 뒤 감쇠
          const early = i < ctx.sampleRate * 0.012 ? 0.2 : 1;
          d[i] = (rng.next() * 2 - 1) * Math.pow(1 - t, decay) * early;
        }
      }
      return buf;
    }

    // ---- 합성 도우미 ----
    // 출력: 직접 경로 + 잔향(wet 비율)
    function out(wet) {
      const g = ctx.createGain();
      g.connect(dry);
      if (wet > 0) {
        const s = ctx.createGain();
        s.gain.value = wet * A.reverb.wet;
        g.connect(s).connect(verbIn);
      }
      return g;
    }

    function envGain(t, peak, attack, decay, dest) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      g.connect(dest);
      return g;
    }

    function noiseSrc(t, dur, buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf || white;
      src.loop = true;
      src.start(t, rng.next() * (src.buffer.duration - 0.1));
      src.stop(t + dur + 0.05);
      return src;
    }

    function filter(type, freq, q) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q == null ? 0.7 : q;
      return f;
    }

    // ---- 효과음 ----
    // 나무 배트 타격: 짧은 충격 노이즈가 배트 공명 모드들을 울린다.
    // clean: 0(빗맞음, 둔탁) ~ 1(정타, 맑고 높은 소리), power: 0 ~ 1(홈런)
    function batCrack(t, clean, power) {
      const o = out(0.45 + 0.3 * power);
      const level = 0.55 + 0.45 * power;
      // 맞는 순간의 날카로운 충격음
      const click = noiseSrc(t, 0.02);
      const hp = filter('highpass', 1500 + 2500 * clean, 0.7);
      click.connect(hp).connect(envGain(t, 1.6 * level * (0.5 + 0.5 * clean), 0.0005, 0.006 + 0.006 * clean, o));
      // "딱" 질감: 중고역 노이즈 짧은 버스트 (정타일수록 밝고 큼)
      const tex = noiseSrc(t, 0.05);
      tex.connect(filter('bandpass', 1400 + 1400 * clean, 0.8)).connect(envGain(t, 1.5 * level * (0.4 + 0.6 * clean), 0.0008, 0.012 + 0.02 * clean, o));
      // 공명 모드(모달 합성): 감쇠하는 사인파 여러 개. 높은 모드는 정타일수록 크고 길게
      A.batModes.forEach(([f, decay, weight], i) => {
        const hi = i / (A.batModes.length - 1); // 0(낮음) ~ 1(높음)
        const amp = A.batModeGain * weight * level * (1 - hi * (1 - clean) * 0.95) * (1 + 0.5 * power * (1 - hi));
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * (0.97 + 0.06 * rng.next());
        const d = decay * (0.45 + 0.75 * clean);
        osc.connect(envGain(t, amp, 0.0006, d, o));
        osc.start(t);
        osc.stop(t + d + 0.05);
      });
      // 몸통 울림(낮은 소리): 세게 맞을수록
      if (power > 0.3) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(170, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.12);
        osc.connect(envGain(t, 0.5 * power, 0.002, 0.12, o));
        osc.start(t);
        osc.stop(t + 0.2);
      }
    }

    // 포수 미트: 가죽에 공이 꽂히는 둔탁한 "펑". 빠른 공일수록 크고 단단하게
    function mitt(t, speed) {
      const k = Math.max(0, Math.min(1, (speed - 125) / 40));
      const o = out(0.35);
      const body = noiseSrc(t, 0.1, pink);
      body.connect(filter('lowpass', 700 + 700 * k, 0.9)).connect(envGain(t, 0.9 + 0.6 * k, 0.001, 0.05 + 0.02 * k, o));
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190 + 60 * k, t);
      osc.frequency.exponentialRampToValueAtTime(75, t + 0.07);
      osc.connect(envGain(t, 0.55 + 0.35 * k, 0.001, 0.07, o));
      osc.start(t);
      osc.stop(t + 0.12);
      // 가죽 마찰
      const slap = noiseSrc(t, 0.02);
      slap.connect(filter('bandpass', 2600, 1.2)).connect(envGain(t, 0.35 + 0.2 * k, 0.0005, 0.008, o));
    }

    // 바람 가르는 소리: 대역 통과 노이즈의 중심 주파수를 움직임
    function whoosh(t, dur, f0, f1, f2, peak, q) {
      const o = out(0.2);
      const src = noiseSrc(t, dur, pink);
      const bp = filter('bandpass', f0, q);
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
      bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(o);
    }

    // 관중 함성: 핑크 노이즈를 사람 목소리 대역(포먼트) 여러 개로 거르고,
    // 음량을 불규칙하게 흔들어 여러 사람이 지르는 느낌을 낸다.
    // shape: 'cheer'(환호) | 'ooh'(파울 "오~") | 'groan'(실망 "아~")
    function crowd(t, shape, intensity, dur) {
      const o = out(0.6);
      const peak = A.crowd * intensity;
      const bands =
        shape === 'groan'
          ? [[850, 420, 3], [1500, 950, 3]]
          : shape === 'ooh'
            ? [[420, 650, 4], [900, 1200, 3]]
            : [[650, 750, 1.4], [1250, 1400, 1.8], [2600, 2800, 2.2]];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      const rise = shape === 'cheer' ? Math.min(0.35, dur * 0.25) : 0.12;
      g.gain.linearRampToValueAtTime(peak, t + rise);
      // 웅성거림: 50~90ms마다 음량을 ±30% 흔듦
      for (let s = t + rise; s < t + dur * 0.7; s += 0.05 + rng.next() * 0.04) {
        g.gain.linearRampToValueAtTime(peak * (0.7 + rng.next() * 0.6), s);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(o);
      bands.forEach(([fa, fb, q], i) => {
        const src = noiseSrc(t, dur, pink);
        const bp = filter('bandpass', fa, q);
        bp.frequency.setValueAtTime(fa, t);
        bp.frequency.linearRampToValueAtTime(fb, t + dur * 0.6);
        const lvl = ctx.createGain();
        lvl.gain.value = (i === 0 ? 1 : 0.7) * q;
        src.connect(bp).connect(lvl).connect(g);
      });
    }

    // 박수: 짧은 손뼉 소리 여러 개를 흩뿌림 + 바탕 노이즈
    function applause(t, level, dur) {
      const o = out(0.7);
      const n = Math.round(20 + 70 * level);
      for (let i = 0; i < n; i++) {
        const u = rng.next();
        const at = t + dur * (1 - Math.sqrt(1 - u)) * 0.85; // 앞쪽에 몰리게
        const src = noiseSrc(at, 0.03);
        src.connect(filter('bandpass', 1100 + rng.next() * 1900, 1.4)).connect(envGain(at, A.crowd * 1.6 * (0.6 + rng.next() * 0.8) * (0.5 + level), 0.001, 0.012 + rng.next() * 0.02, o));
      }
      const bed = noiseSrc(t, dur, pink);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(A.crowd * 0.5 * level, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      bed.connect(filter('bandpass', 2000, 0.8)).connect(g).connect(o);
    }

    // 구장 오르간: 배음을 더한 음색(PeriodicWave) + 살짝 떨림. 오리지널 짧은 화음 진행
    let organWave = null;
    function organ(t) {
      if (!organWave) {
        const h = [0, 1, 0.8, 0.5, 0.45, 0, 0.25, 0, 0.18];
        organWave = ctx.createPeriodicWave(new Float32Array(h.length), new Float32Array(h));
      }
      const o = out(0.8);
      const trem = ctx.createOscillator();
      const tg = ctx.createGain();
      trem.frequency.value = 6.2;
      tg.gain.value = 0.04;
      const bus = ctx.createGain();
      bus.gain.value = 0.03;
      trem.connect(tg).connect(bus.gain);
      bus.connect(o);
      const chords = [[261.6, 329.6, 392], [349.2, 440, 523.3], [392, 493.9, 587.3], [523.3, 659.3, 784]];
      const lens = [0.22, 0.22, 0.22, 0.9];
      let at = t;
      chords.forEach((ch, i) => {
        ch.forEach((f) => {
          const osc = ctx.createOscillator();
          osc.setPeriodicWave(organWave);
          osc.frequency.value = f;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, at);
          g.gain.linearRampToValueAtTime(1, at + 0.015);
          g.gain.setValueAtTime(1, at + lens[i] - 0.03);
          g.gain.linearRampToValueAtTime(0.0001, at + lens[i]);
          osc.connect(g).connect(bus);
          osc.start(at);
          osc.stop(at + lens[i] + 0.02);
        });
        at += lens[i] + 0.03;
      });
      trem.start(t);
      trem.stop(at + 0.1);
    }

    // 배경 웅성거림 (경기 중에만). 켜고 끌 때 서서히. 녹음이 있으면 녹음을 반복 재생
    function setAmbience(on) {
      ambWanted = !!on;
      if (!ctx) return;
      if (!amb && on && hasSample('ambience')) {
        const s = A.samples.ambience || {};
        const buf = samples.ambience;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        const lvl = ctx.createGain();
        lvl.gain.value = s.gain == null ? 1 : s.gain;
        lvl.connect(g).connect(out(s.wet == null ? 0.1 : s.wet));
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.loopStart = Math.min(s.offset || 0, Math.max(0, buf.duration - 0.1));
        src.loopEnd = s.dur ? Math.min(buf.duration, src.loopStart + s.dur) : buf.duration;
        src.connect(lvl);
        src.start(ctx.currentTime, src.loopStart);
        // 녹음 음량은 samples.ambience.gain으로 조절
        amb = { gain: g, kind: 'sample', target: 1, stop: () => src.stop() };
      }
      if (!amb && on) {
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        g.connect(out(0.5));
        const nodes = [];
        const layers = [[450, 0.6, 0.11, 1], [1100, 1.1, 0.29, 0.5], [2400, 1.5, 0.53, 0.25]];
        for (const [f, q, lfoHz, lvl] of layers) {
          const src = ctx.createBufferSource();
          src.buffer = pink;
          src.loop = true;
          const mod = ctx.createGain();
          mod.gain.value = lvl;
          // 느리고 불규칙한 음량 변화
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          lfo.frequency.value = lfoHz;
          lg.gain.value = lvl * 0.35;
          lfo.connect(lg).connect(mod.gain);
          src.connect(filter('bandpass', f, q)).connect(mod).connect(g);
          src.start(ctx.currentTime, rng.next() * 2);
          lfo.start(ctx.currentTime);
          nodes.push(src, lfo);
        }
        amb = { gain: g, kind: 'synth', target: A.ambience, stop: () => nodes.forEach((n) => n.stop()) };
      }
      if (amb) amb.gain.gain.setTargetAtTime(on ? amb.target : 0.0001, ctx.currentTime, on ? 0.6 : 0.3);
    }

    // ---- 이름으로 재생 (게임 이벤트와 소리 확인 페이지에서 사용) ----
    // opts: { clean, power, speed, intensity, level }
    function play(name, o) {
      if (!ready()) return;
      o = o || {};
      const t = ctx.currentTime + (o.delay || 0);
      switch (name) {
        case 'pitch':
          return whoosh(t, 0.3, 700, 1600, 900, 0.3, 1.5);
        case 'swing':
          return whoosh(t, 0.22, 320, 1300, 450, 1.1, 1.8);
        case 'bat':
          return batCrack(t, o.clean == null ? 1 : o.clean, o.power == null ? 0.5 : o.power);
        case 'mitt':
          return mitt(t, o.speed || 150);
        // 관중 소리: 녹음이 있으면 녹음, 없으면 합성
        case 'homerun':
          if (hasSample('homerun')) return playSample('homerun', t, 1);
          crowd(t, 'cheer', 1, 3.2);
          return play('applause', { level: 1, dur: 3, delay: (o.delay || 0) + 0.45 });
        case 'cheer':
          if (hasSample('cheer')) return playSample('cheer', t, o.intensity == null ? 0.6 : o.intensity, o.dur);
          return crowd(t, 'cheer', o.intensity == null ? 0.6 : o.intensity, o.dur || 1.6);
        case 'ooh':
          if (hasSample('ooh')) return playSample('ooh', t, o.intensity == null ? 0.5 : o.intensity, o.dur);
          return crowd(t, 'ooh', o.intensity == null ? 0.5 : o.intensity, o.dur || 0.9);
        case 'groan':
          if (hasSample('groan')) return playSample('groan', t, o.intensity == null ? 0.6 : o.intensity, o.dur);
          return crowd(t, 'groan', o.intensity == null ? 0.6 : o.intensity, o.dur || 1.1);
        case 'applause':
          if (hasSample('applause')) return playSample('applause', t, o.level == null ? 0.6 : o.level, o.dur);
          return applause(t, o.level == null ? 0.6 : o.level, o.dur || 2.5);
        case 'organ':
          return organ(t);
      }
    }

    const TIMING_CLEAN = { PERFECT: 1, GOOD: 0.65, BAD: 0.35, NONE: 0.35 };

    // 게임 이벤트 → 효과음
    function onGameEvent(e) {
      if (!ready()) return;
      if (e.type === 'release') play('pitch');
      else if (e.type === 'swing') play('swing');
      else if (e.type === 'result') {
        const last = e.last;
        const clean = TIMING_CLEAN[last.timing] || 0.5;
        switch (last.result) {
          case 'HOMERUN':
            play('bat', { clean: 1, power: 1 });
            play('homerun', { delay: 0.15 });
            break;
          case 'DOUBLE':
            play('bat', { clean, power: 0.7 });
            play('cheer', { intensity: 0.75, dur: 2, delay: 0.15 });
            break;
          case 'SINGLE':
            play('bat', { clean, power: 0.5 });
            play('cheer', { intensity: 0.55, dur: 1.4, delay: 0.15 });
            break;
          case 'FOUL':
            play('bat', { clean: 0.25, power: 0.3 });
            play('ooh', { intensity: 0.35, delay: 0.1 });
            break;
          case 'OUT_BIP':
            play('bat', { clean: last.foulCapped ? 0.25 : 0.4, power: 0.35 });
            play('groan', { intensity: 0.4, delay: 0.5 });
            break;
          default: // SWING_MISS, LOOKING: 공이 미트에 꽂힘
            play('mitt', { speed: last.pitch.speed });
            if (last.atBatOutcome === 'STRIKEOUT') play('groan', { intensity: 0.7, delay: 0.25 });
        }
        // 안드로이드 진동 (지원하는 경우만)
        const contact = last.result !== 'SWING_MISS' && last.result !== 'LOOKING';
        if (contact && global.navigator && typeof global.navigator.vibrate === 'function') {
          try {
            global.navigator.vibrate(last.result === 'HOMERUN' ? 40 : 20);
          } catch (err) {
            /* 무시 */
          }
        }
      }
    }

    // 결과 화면: 타율에 비례한 박수, 기록 갱신·레벨 해제면 오르간
    function fanfare(good, avg) {
      if (!ready()) return;
      play('applause', { level: Math.min(1, 0.25 + (avg || 0) * 1.2), dur: 2.5 });
      if (good) play('organ', { delay: 0.3 });
    }

    // 슬롯별 상태 (소리 확인 페이지 표시용): 'recording' | 'loading' | 'error' | 'synth'
    function sampleStatus() {
      const st = {};
      const data = BB.SOUND_DATA || {};
      for (const slot of Object.keys(A.samples)) {
        if (sampleState[slot] === 'ready') st[slot] = 'recording';
        else st[slot] = sampleState[slot] || (data[slot] ? 'loading' : 'synth');
      }
      return st;
    }

    return { unlock, setMuted, setAmbience, onGameEvent, fanfare, play, sampleStatus, isMuted: () => muted };
  }

  Object.assign(BB, { createAudio });
})(typeof window !== 'undefined' ? window : globalThis);
