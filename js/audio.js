// 효과음: WebAudio로 코드 합성 (외부 음원 파일 없음)
// 브라우저 정책상 첫 사용자 입력(unlock) 이후에만 AudioContext를 만든다.
(function (global) {
  'use strict';

  const BB = global.BB;
  const A = BB.CONFIG.AUDIO;
  const fxRng = BB.createRng(77); // 노이즈 시작 위치용 장식 RNG

  function createAudio() {
    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let muted = false;

    function unlock() {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try {
        if (!ctx) {
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = muted ? 0 : A.volume;
          master.connect(ctx.destination);
          noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          // 장식용 소리라 게임 RNG를 쓰지 않는 고정 패턴 노이즈(시드 RNG)
          const rng = BB.createRng(4242);
          for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {
        ctx = null; // 소리 없이 계속
      }
    }

    function setMuted(m) {
      muted = !!m;
      if (master) master.gain.setTargetAtTime(muted ? 0 : A.volume, ctx.currentTime, 0.02);
    }

    const ready = () => ctx && !muted && ctx.state === 'running';

    // ---- 합성 도우미 ----
    function env(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    function noise(t, dur, filterType, f0, f1, peak, attack, q) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.Q.value = q || 1;
      f.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      env(g, t, peak, attack || 0.005, dur);
      src.connect(f).connect(g).connect(master);
      src.start(t, fxRng.next() * 0.5);
      src.stop(t + dur + 0.05);
    }

    function tone(t, type, f0, f1, dur, peak, attack) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      env(g, t, peak, attack || 0.004, dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    // ---- 효과음 ----
    const sfx = {
      pitch() {
        // 공이 날아가는 휙 소리
        const t = ctx.currentTime;
        noise(t, 0.35, 'bandpass', 600, 2400, 0.25, 0.08, 2);
      },
      swing() {
        const t = ctx.currentTime;
        noise(t, 0.16, 'bandpass', 1800, 500, 0.35, 0.03, 1.5);
      },
      // power: 0(약)~1(홈런), clear: PERFECT면 더 맑게
      hit(power, clear) {
        const t = ctx.currentTime;
        noise(t, 0.05 + 0.04 * power, 'highpass', 1800, 1800, 0.6 + 0.3 * power, 0.001);
        tone(t, 'triangle', clear ? 1500 : 1100, clear ? 1200 : 800, 0.08 + 0.06 * power, 0.5, 0.001);
        if (power > 0.6) tone(t, 'sine', 160, 60, 0.25, 0.7, 0.002); // 홈런: 묵직한 울림
      },
      foul() {
        const t = ctx.currentTime;
        tone(t, 'triangle', 700, 500, 0.06, 0.4, 0.001);
        noise(t, 0.04, 'highpass', 2500, 2500, 0.3, 0.001);
      },
      mitt() {
        // 포수 미트에 공이 꽂히는 소리
        const t = ctx.currentTime;
        noise(t, 0.08, 'lowpass', 900, 300, 0.7, 0.001);
        tone(t, 'sine', 180, 90, 0.08, 0.5, 0.001);
      },
      out() {
        const t = ctx.currentTime + 0.25;
        tone(t, 'square', 330, 330, 0.12, 0.12);
        tone(t + 0.14, 'square', 247, 247, 0.2, 0.12);
      },
      strikeout() {
        const t = ctx.currentTime + 0.1;
        tone(t, 'square', 440, 440, 0.12, 0.12);
        tone(t + 0.14, 'square', 349, 349, 0.12, 0.12);
        tone(t + 0.28, 'square', 262, 220, 0.3, 0.12);
      },
      // 관중 환호: 대역 통과 노이즈를 천천히 키웠다 줄임
      cheer(big) {
        const t = ctx.currentTime + 0.05;
        const dur = big ? 2.2 : 1.1;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1100;
        f.Q.value = 0.7;
        const g = ctx.createGain();
        const peak = big ? 0.35 : 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.25);
        g.gain.setValueAtTime(peak, t + dur * 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        // 웅성거림: 느린 진폭 흔들림
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 7;
        lg.gain.value = peak * 0.3;
        lfo.connect(lg).connect(g.gain);
        src.connect(f).connect(g).connect(master);
        src.start(t);
        lfo.start(t);
        src.stop(t + dur + 0.05);
        lfo.stop(t + dur + 0.05);
      },
      // 결과 화면 팡파르. good: 기록 갱신/해제면 더 길게
      fanfare(good) {
        const t = ctx.currentTime + 0.1;
        const notes = good ? [523, 659, 784, 1047, 784, 1047] : [392, 523, 659];
        notes.forEach((f, i) => tone(t + i * 0.12, 'triangle', f, f, i === notes.length - 1 ? 0.5 : 0.12, 0.25));
      },
    };

    // 게임 이벤트 → 효과음
    function onGameEvent(e) {
      if (!ready()) return;
      if (e.type === 'release') sfx.pitch();
      else if (e.type === 'swing') sfx.swing();
      else if (e.type === 'result') {
        const last = e.last;
        const clear = last.timing === 'PERFECT';
        switch (last.result) {
          case 'HOMERUN':
            sfx.hit(1, clear);
            sfx.cheer(true);
            break;
          case 'DOUBLE':
            sfx.hit(0.6, clear);
            sfx.cheer(false);
            break;
          case 'SINGLE':
            sfx.hit(0.4, clear);
            sfx.cheer(false);
            break;
          case 'FOUL':
            sfx.foul();
            break;
          case 'OUT_BIP':
            if (last.foulCapped) sfx.foul();
            else sfx.hit(0.2, false);
            sfx.out();
            break;
          default: // SWING_MISS, LOOKING
            sfx.mitt();
            if (last.atBatOutcome === 'STRIKEOUT') sfx.strikeout();
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

    function fanfare(good) {
      if (ready()) sfx.fanfare(good);
    }

    return { unlock, setMuted, onGameEvent, fanfare, isMuted: () => muted };
  }

  Object.assign(BB, { createAudio });
})(window);
