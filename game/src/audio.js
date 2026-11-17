// LANTERNFALL sound — WebAudio synthesis only. Every effect is a short
// oscillator envelope built on the fly: no audio files, no network, and the
// AudioContext is created lazily on the first user gesture (ensure()).
// Every method is safe to call before ensure() and when WebAudio is
// unavailable: it simply does nothing.
export function createAudio() {
  let ctx = null;
  let muted = false;
  let master = null;
  let shotCount = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (err) {
      ctx = null;
    }
  }

  // One enveloped oscillator: quick attack, exponential decay to silence.
  function tone(freq, endFreq, dur, type, vol, delay) {
    if (!ctx || !master || muted) return;
    try {
      const when = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, when);
      if (endFreq && endFreq !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), when + dur);
      }
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(vol || 0.15, when + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(when);
      osc.stop(when + dur + 0.05);
    } catch (err) {
      // A failed blip must never break the game loop.
    }
  }

  // Two detuned oscillators struck together for a fuller horn.
  function hornNote(freq, delay) {
    tone(freq, freq, 0.5, 'sawtooth', 0.1, delay);
    tone(freq * 1.005, freq * 1.005, 0.5, 'sawtooth', 0.08, delay);
  }

  return {
    ensure,
    shoot() {
      // Alternate the blip pitch on successive shots so rapid fire from
      // several Ember Spires does not drone on one note. Deterministic:
      // a plain counter, no randomness involved.
      shotCount += 1;
      const base = shotCount % 2 === 0 ? 760 : 680;
      tone(base, 340, 0.08, 'square', 0.07);
    },
    kill() {
      tone(320, 55, 0.18, 'triangle', 0.16);
      tone(540, 260, 0.09, 'sine', 0.1);
    },
    coin() {
      tone(990, 990, 0.07, 'sine', 0.12);
      tone(1320, 1320, 0.1, 'sine', 0.12, 0.07);
    },
    horn() {
      hornNote(196, 0);
      hornNote(262, 0.16);
      hornNote(330, 0.32);
    },
    leak() {
      tone(130, 45, 0.32, 'sine', 0.22);
      tone(90, 40, 0.3, 'triangle', 0.14, 0.02);
    },
    victory() {
      const notes = [523, 659, 784, 1046, 1318];
      for (let i = 0; i < notes.length; i += 1) {
        tone(notes[i], notes[i], 0.22, 'triangle', 0.14, i * 0.11);
      }
    },
    defeat() {
      const notes = [392, 311, 233, 175];
      for (let i = 0; i < notes.length; i += 1) {
        tone(notes[i], notes[i] * 0.94, 0.3, 'sawtooth', 0.11, i * 0.16);
      }
    },
    click() { tone(840, 840, 0.05, 'sine', 0.1); },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    isMuted() { return muted; },
  };
}
