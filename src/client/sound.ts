/** Tiny synthesized sound effects (no audio files, nothing downloaded). */
let ctx: AudioContext | null = null;
let enabled = true;
let lastHit = 0;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on) audio();
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
  const a = enabled ? audio() : null;
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, freq: number, vol: number) {
  const a = enabled ? audio() : null;
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  flick(power: number) {
    noise(0.09, 1800 + power * 1600, 0.25 + power * 0.25);
    tone(520 + power * 300, 180, 0.08, 'triangle', 0.12);
  },
  hit() {
    const now = performance.now();
    if (now - lastHit < 60) return;
    lastHit = now;
    tone(1400, 500, 0.05, 'square', 0.07);
    noise(0.04, 3200, 0.18);
  },
  fall() {
    tone(620, 110, 0.45, 'sawtooth', 0.06);
    noise(0.12, 260, 0.45);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.12, i * 0.11));
  },
  draw() {
    tone(440, 330, 0.25, 'triangle', 0.1);
    tone(440, 330, 0.25, 'triangle', 0.08, 0.2);
  },
  click() {
    tone(900, 700, 0.04, 'triangle', 0.05);
  },
};
