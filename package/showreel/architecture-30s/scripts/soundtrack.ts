// Procedural 15.000 s cinematic soundtrack for the showreel.
// Zero dependencies. Run: bun scripts/soundtrack.ts
// Output: public/soundtrack.wav (48 kHz, stereo, 16-bit PCM, 720000 frames)

import { join } from "node:path";

const SR = 48000;
const DURATION = 15;
const N = DURATION * SR; // 720000
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- PRNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x7e4a2c1);
const noiseSrc = (seed: number) => {
  const r = mulberry32(seed);
  return () => r() * 2 - 1;
};

// ---------------------------------------------------------------- helpers
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const frame = (t: number) => Math.round(t * SR);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Attack (linear, >= 2 ms) then exponential decay. */
function envAD(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  const a = Math.max(attack, 0.002);
  if (t < a) return t / a;
  return Math.exp(-(t - a) / tau);
}

/** Linear fade to zero over `fade` seconds ending at `dur` (relative time). */
function tailCut(t: number, dur: number, fade = 0.003): number {
  if (t >= dur) return 0;
  if (t > dur - fade) return (dur - t) / fade;
  return 1;
}

function panGains(p: number): [number, number] {
  const x = clamp01(p) * Math.PI * 0.5;
  return [Math.cos(x), Math.sin(x)];
}

/** Zavalishin TPT state-variable filter (stable for any cutoff < Nyquist). */
class SVF {
  ic1 = 0;
  ic2 = 0;
  lp = 0;
  bp = 0;
  hp = 0;
  process(x: number, fc: number, q: number): void {
    const f = Math.min(fc, SR * 0.45);
    const g = Math.tan((Math.PI * f) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - k * v1 - v2;
  }
}

class OnePole {
  y = 0;
  process(x: number, fc: number): number {
    const a = 1 - Math.exp((-TAU * fc) / SR);
    this.y += a * (x - this.y);
    return this.y;
  }
}

const saw = (ph: number) => 2 * (ph - Math.floor(ph + 0.5));
const tri = (ph: number) => 1 - 4 * Math.abs(ph - Math.floor(ph + 0.5));

// ---------------------------------------------------------------- buses
type Bus = { L: Float32Array; R: Float32Array };
const mkBus = (): Bus => ({ L: new Float32Array(N), R: new Float32Array(N) });

const main = mkBus(); // everything before the final impact (ducked at 12.9)
const mainSend = mkBus(); // reverb send for main section
const fin = mkBus(); // final impact bus (starts at 13.0)
const finSend = mkBus(); // reverb send for final impact

/** Mono voice placed at an exact frame with constant pan. fn(t, i) -> sample. */
function addMono(
  bus: Bus,
  start: number,
  dur: number,
  pan: number,
  fn: (t: number, i: number) => number,
  send?: Bus,
  sendAmt = 0,
) {
  const s0 = frame(start);
  const len = frame(dur);
  const [gl, gr] = panGains(pan);
  for (let i = 0; i < len; i++) {
    const n = s0 + i;
    if (n < 0 || n >= N) continue;
    const v = fn(i / SR, i);
    bus.L[n] += v * gl;
    bus.R[n] += v * gr;
    if (send) {
      send.L[n] += v * gl * sendAmt;
      send.R[n] += v * gr * sendAmt;
    }
  }
}

/** Stereo voice. fn writes into out[0], out[1]. */
function addStereo(
  bus: Bus,
  start: number,
  dur: number,
  fn: (t: number, out: number[]) => void,
  send?: Bus,
  sendAmt = 0,
) {
  const s0 = frame(start);
  const len = frame(dur);
  const out = [0, 0];
  for (let i = 0; i < len; i++) {
    const n = s0 + i;
    if (n < 0 || n >= N) continue;
    out[0] = 0;
    out[1] = 0;
    fn(i / SR, out);
    bus.L[n] += out[0];
    bus.R[n] += out[1];
    if (send) {
      send.L[n] += out[0] * sendAmt;
      send.R[n] += out[1] * sendAmt;
    }
  }
}

// ---------------------------------------------------------------- instruments
function kick(bus: Bus, at: number, gain: number, opts: { fHi?: number; fLo?: number; tau?: number; sweep?: number } = {}) {
  const fHi = opts.fHi ?? 150;
  const fLo = opts.fLo ?? 40;
  const tau = opts.tau ?? 0.16;
  const sweep = opts.sweep ?? 0.035;
  let ph = 0;
  const nz = noiseSrc(Math.floor(at * 1000) + 11);
  const hp = new SVF();
  addMono(bus, at, tau * 7, 0.5, (t) => {
    const f = fLo + (fHi - fLo) * Math.exp(-t / sweep);
    ph += f / SR;
    const body = Math.sin(TAU * ph) * envAD(t, 0.002, tau);
    hp.process(nz(), 3000, 0.7);
    const click = hp.hp * envAD(t, 0.002, 0.004) * 0.35;
    return Math.tanh((body + click) * 1.4) * gain;
  });
}

function subBoom(bus: Bus, at: number, freq: number, tau: number, gain: number, dur: number) {
  addMono(bus, at, dur, 0.5, (t) => {
    const f = freq * (1 + 0.25 * Math.exp(-t / 0.05));
    return Math.sin(TAU * f * t) * envAD(t, 0.004, tau) * gain * tailCut(t, dur, 0.05);
  });
}

function crash(bus: Bus, at: number, gain: number, tau: number, dur: number, send?: Bus, sendAmt = 0) {
  const nl = noiseSrc(Math.floor(at * 977) + 3);
  const nr = noiseSrc(Math.floor(at * 977) + 4);
  const fl = new SVF();
  const fr = new SVF();
  addStereo(
    bus,
    at,
    dur,
    (t, o) => {
      const e = envAD(t, 0.002, tau) * gain * tailCut(t, dur, 0.05);
      const fc = 2500 + 6000 * Math.exp(-t / 0.3);
      fl.process(nl(), fc, 0.6);
      fr.process(nr(), fc, 0.6);
      // Decorrelated L/R gives width.
      o[0] = fl.hp * e;
      o[1] = fr.hp * e;
    },
    send,
    sendAmt,
  );
}

function hat(bus: Bus, at: number, gain: number, pan: number, tau = 0.025) {
  const nz = noiseSrc(Math.floor(at * 4801) + 7);
  const f = new SVF();
  addMono(bus, at, tau * 8, pan, (t) => {
    f.process(nz(), 8000, 0.9);
    return f.hp * envAD(t, 0.002, tau) * gain;
  });
}

function snare(bus: Bus, at: number, gain: number) {
  const nz = noiseSrc(Math.floor(at * 3313) + 9);
  const f = new SVF();
  let ph = 0;
  addMono(
    bus,
    at,
    0.4,
    0.5,
    (t) => {
      f.process(nz(), 2200, 0.8);
      const fb = 160 + 60 * Math.exp(-t / 0.02);
      ph += fb / SR;
      const body = Math.sin(TAU * ph) * envAD(t, 0.002, 0.04) * 0.5;
      return (f.bp * 1.6 * envAD(t, 0.002, 0.07) + body) * gain;
    },
    mainSend,
    0.15,
  );
}

function tick(bus: Bus, at: number, gain: number, pan: number, freq: number, tau = 0.012) {
  addMono(bus, at, tau * 10, pan, (t) => {
    const e = envAD(t, 0.002, tau);
    return (Math.sin(TAU * freq * t) * 0.7 + Math.sin(TAU * freq * 1.5 * t) * 0.3) * e * gain;
  });
}

function pluck(bus: Bus, at: number, freq: number, gain: number, pan: number) {
  let ph = 0;
  addMono(
    bus,
    at,
    1.2,
    pan,
    (t) => {
      const f = freq * (1 + 0.03 * Math.exp(-t / 0.008)); // tiny pitch blip
      ph += f / SR;
      const e = envAD(t, 0.002, 0.22) * tailCut(t, 1.2, 0.05);
      const s = Math.sin(TAU * ph) * 0.65 + tri(ph) * 0.35 * Math.exp(-t / 0.08);
      return s * e * gain;
    },
    mainSend,
    0.35,
  );
}

// ---------------------------------------------------------------- reverb (Schroeder / Freeverb style)
function reverb(input: Bus, out: Bus, startT: number, roomFb: number, damp: number, wet: number) {
  const scale = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const spread = 23;
  const mkCombs = (off: number) =>
    combT.map((d) => ({ buf: new Float32Array(Math.round((d + off) * scale)), idx: 0, store: 0 }));
  const mkAps = (off: number) => apT.map((d) => ({ buf: new Float32Array(Math.round((d + off) * scale)), idx: 0 }));
  const chans = [
    { inp: input.L, dst: out.L, combs: mkCombs(0), aps: mkAps(0) },
    { inp: input.R, dst: out.R, combs: mkCombs(spread), aps: mkAps(spread) },
  ];
  const s0 = frame(startT);
  for (const ch of chans) {
    for (let n = s0; n < N; n++) {
      const x = ch.inp[n] * 0.015;
      let acc = 0;
      for (const c of ch.combs) {
        const y = c.buf[c.idx];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.idx] = x + c.store * roomFb;
        c.idx = (c.idx + 1) % c.buf.length;
        acc += y;
      }
      for (const a of ch.aps) {
        const b = a.buf[a.idx];
        const y = -acc + b;
        a.buf[a.idx] = acc + b * 0.5;
        a.idx = (a.idx + 1) % a.buf.length;
        acc = y;
      }
      ch.dst[n] += acc * wet;
    }
  }
}

// ================================================================= ARRANGEMENT

// ---- 0.00-2.00 INTRO -------------------------------------------------------
{
  // Drone: A1 sine + detuned saws an octave up through an opening one-pole LP.
  const lpL = new OnePole();
  const lpR = new OnePole();
  const lpL2 = new OnePole();
  const lpR2 = new OnePole();
  const dur = 2.8;
  addStereo(
    main,
    0,
    dur,
    (t, o) => {
      const fadeIn = clamp01(t / 0.6);
      const rel = t < 2.0 ? 1 : Math.exp(-(t - 2.0) / 0.18);
      const amp = fadeIn * fadeIn * rel * tailCut(t, dur, 0.05);
      const fc = 150 * Math.pow(12, clamp01(t / 2.0));
      const sub = Math.sin(TAU * 55 * t) * 0.55;
      const sL = saw(109.7 * t) + saw(110.35 * t + 0.3);
      const sR = saw(110.25 * t + 0.6) + saw(109.6 * t + 0.1);
      const fl = lpL2.process(lpL.process(sL, fc), fc);
      const fr = lpR2.process(lpR.process(sR, fc), fc);
      o[0] = (sub + fl * 0.22) * amp * 0.5;
      o[1] = (sub + fr * 0.22) * amp * 0.5;
    },
    mainSend,
    0.1,
  );

  // Riser: filtered noise crescendo, hard-cut (3 ms fade) to land exactly at 2.0.
  const nl = noiseSrc(101);
  const nr = noiseSrc(102);
  const fl = new SVF();
  const fr = new SVF();
  addStereo(main, 0, 2.0, (t, o) => {
    const p = t / 2.0;
    const fc = 200 * Math.pow(45, p);
    fl.process(nl(), fc, 2.2);
    fr.process(nr(), fc, 2.2);
    const amp = Math.pow(p, 2.6) * 0.32 * tailCut(t, 2.0, 0.003);
    o[0] = (fl.bp * 0.8 + fl.lp * 0.4) * amp;
    o[1] = (fr.bp * 0.8 + fr.lp * 0.4) * amp;
  });

  // Ignite ping at 0.10: A6 sine, fast decay, short ping-pong delay.
  const ignite = (at: number, g: number, pan: number) =>
    addMono(
      main,
      at,
      1.6,
      pan,
      (t) => {
        const e = envAD(t, 0.002, 0.28) * tailCut(t, 1.6, 0.05);
        return (Math.sin(TAU * 1760 * t) + 0.25 * Math.sin(TAU * 3520 * t) * Math.exp(-t / 0.05)) * e * g;
      },
      mainSend,
      0.5,
    );
  ignite(0.1, 0.32, 0.5);
  ignite(0.1 + 0.125, 0.14, 0.12);
  ignite(0.1 + 0.25, 0.09, 0.88);
  ignite(0.1 + 0.375, 0.05, 0.2);

  // Glassy ticks every 0.25 s growing in volume.
  for (let k = 0; k < 8; k++) {
    const g = 0.04 + 0.2 * (k / 7) ** 1.5;
    tick(main, k * 0.25, g, k % 2 ? 0.68 : 0.32, 4186, 0.01);
  }
}

// ---- 2.00 IMPACT #1 --------------------------------------------------------
kick(main, 2.0, 1.0, { tau: 0.28, sweep: 0.045 });
subBoom(main, 2.0, 40, 0.42, 0.75, 1.6);
crash(main, 2.0, 0.42, 0.22, 1.4, mainSend, 0.4);
{
  // Slight stereo widening: Haas-offset bright transient on the sides.
  const nz = noiseSrc(222);
  const f = new SVF();
  const buf: number[] = [];
  addStereo(main, 2.0, 0.6, (t, o) => {
    f.process(nz(), 5000, 0.7);
    const v = f.hp * envAD(t, 0.002, 0.08) * 0.18;
    buf.push(v);
    const d = buf.length > 600 ? buf[buf.length - 601] : 0; // 12.5 ms
    o[0] = v - d * 0.6;
    o[1] = d - v * 0.6;
  });
}

// ---- 2.00-4.00 PAD + soft kick + reverse swell ----------------------------
{
  const notes = [45, 52, 57, 59, 60].map(mtof); // A2 E3 A3 B3 C4
  const det = [-0.11, 0.0, 0.13];
  const fl = new SVF();
  const fr = new SVF();
  const fl2 = new SVF();
  const fr2 = new SVF();
  const dur = 2.0;
  addStereo(
    main,
    2.0,
    dur,
    (t, o) => {
      const att = clamp01(t / 0.55);
      const rel = t > 1.65 ? clamp01((dur - t) / 0.35) : 1;
      const amp = att * att * (3 - 2 * att) * rel * 0.075;
      let sl = 0;
      let sr = 0;
      for (let ni = 0; ni < notes.length; ni++) {
        const f = notes[ni];
        for (let d = 0; d < det.length; d++) {
          const cents = det[d] * (d === 1 ? 0 : 1);
          sl += saw(f * (1 + cents * 0.01) * t + ni * 0.13 + d * 0.31);
          sr += saw(f * (1 - cents * 0.01) * t + ni * 0.29 + d * 0.17);
        }
      }
      const fc = 700 + 900 * att;
      fl.process(sl, fc, 0.7);
      fr.process(sr, fc, 0.7);
      fl2.process(fl.lp, fc * 1.4, 0.7);
      fr2.process(fr.lp, fc * 1.4, 0.7);
      o[0] = fl2.lp * amp;
      o[1] = fr2.lp * amp;
    },
    mainSend,
    0.3,
  );
}
kick(main, 3.0, 0.55, { tau: 0.13 });
{
  // Reverse swell into 4.0 (noise rising, cut exactly at 4.0).
  const nl = noiseSrc(301);
  const nr = noiseSrc(302);
  const fl = new SVF();
  const fr = new SVF();
  addStereo(main, 3.0, 1.0, (t, o) => {
    const p = t / 1.0;
    const fc = 400 * Math.pow(25, p);
    fl.process(nl(), fc, 1.2);
    fr.process(nr(), fc, 1.2);
    const amp = Math.pow(p, 3) * 0.3 * tailCut(t, 1.0, 0.003);
    o[0] = fl.lp * amp;
    o[1] = fr.lp * amp;
  });
}

// ---- 4.00-7.50 SEVEN PHASES -----------------------------------------------
{
  const scale = [69, 72, 74, 76, 79, 81, 84]; // A4 C5 D5 E5 G5 A5 C6
  for (let k = 0; k < 7; k++) {
    const at = 4.0 + k * 0.5;
    kick(main, at, 0.85, { tau: 0.14 });
    pluck(main, at, mtof(scale[k]), 0.26, k % 2 === 0 ? 0.28 : 0.72);
    hat(main, at + 0.25, 0.22, k % 2 === 0 ? 0.62 : 0.38);
  }
}

// ---- 7.50-8.00 WHOOSH ------------------------------------------------------
{
  const nz = noiseSrc(750);
  const f = new SVF();
  const f2 = new SVF();
  addStereo(main, 7.5, 0.5, (t, o) => {
    const p = t / 0.5;
    const fc = 300 * Math.pow(8000 / 300, p);
    const x = nz();
    f.process(x, fc, 2.5);
    f2.process(f.bp, fc, 2.5);
    const amp = Math.sin(Math.PI * Math.pow(p, 0.8)) * 0.55 * Math.min(1, p / 0.01);
    const [gl, gr] = panGains(p);
    o[0] = f2.bp * amp * gl * 1.4;
    o[1] = f2.bp * amp * gr * 1.4;
  });
}

// ---- 8.00-11.00 ROUTING ----------------------------------------------------
{
  for (let b = 0; b < 6; b++) kick(main, 8.0 + b * 0.5, 0.9, { tau: 0.13 });
  const accents = [1.0, 0.35, 0.65, 0.4];
  for (let s = 0; s < 24; s++) {
    const at = 8.0 + s * 0.125;
    hat(main, at, 0.2 * accents[s % 4], s % 2 ? 0.58 : 0.44, s % 4 === 2 ? 0.04 : 0.02);
  }
  // Sub-bass pulse on 8ths, A1/E1 pattern.
  const pat = [33, 33, 28, 33, 33, 33, 28, 28, 33, 33, 28, 33];
  for (let e = 0; e < 12; e++) {
    const at = 8.0 + e * 0.25;
    const f = mtof(pat[e]);
    const onBeat = e % 2 === 0;
    addMono(main, at, 0.24, 0.5, (t) => {
      // Duck on-beat notes so the kick punches through.
      const duck = onBeat ? 1 - 0.7 * Math.exp(-t / 0.06) : 1;
      const e2 = clamp01(t / 0.004) * tailCut(t, 0.24, 0.02) * Math.exp(-t / 0.5);
      const s = Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t);
      return Math.tanh(s * 1.3) * e2 * duck * 0.42;
    });
  }
  // Sparse data blips at seeded 16th positions.
  const slots = new Set<number>();
  while (slots.size < 14) slots.add(Math.floor(rng() * 24) * 2 + (rng() < 0.5 ? 1 : 0));
  for (const sl of [...slots].sort((a, b) => a - b)) {
    const at = 8.0 + sl * 0.0625;
    const freq = 2000 + Math.floor(rng() * 6) * 600; // 2-5 kHz quantised
    const pan = 0.1 + rng() * 0.8;
    addMono(
      main,
      at,
      0.08,
      pan,
      (t) => Math.sin(TAU * freq * t) * envAD(t, 0.002, 0.012) * 0.13 * tailCut(t, 0.08),
      mainSend,
      0.3,
    );
  }
}

// ---- 11.00-13.00 VERIFY ----------------------------------------------------
{
  for (let b = 0; b < 4; b++) kick(main, 11.0 + b * 0.5, 0.9, { tau: 0.13 });
  for (let s = 0; s < 4; s++) snare(main, 11.0 + s * 0.25, 0.32);
  for (let s = 0; s < 8; s++) snare(main, 12.0 + s * 0.125, 0.26 + s * 0.02); // 12.0 .. 12.875
  // Pitch-rising riser: saw sweeping up an octave + noise.
  const nz = noiseSrc(1100);
  const fn = new SVF();
  const fl = new SVF();
  let ph1 = 0;
  let ph2 = 0;
  addStereo(main, 11.0, 1.9, (t, o) => {
    const p = t / 1.9;
    const f = 220 * Math.pow(2, p);
    ph1 += (f * 1.003) / SR;
    ph2 += (f * 0.997) / SR;
    const fc = 800 * Math.pow(8, p);
    fl.process(saw(ph1) + saw(ph2), fc, 1.4);
    fn.process(nz(), fc * 1.5, 0.8);
    const amp = (0.02 + 0.2 * p * p) * tailCut(t, 1.9, 0.003);
    o[0] = (fl.lp * 0.6 + fn.bp * 0.7) * amp;
    o[1] = (fl.lp * 0.6 - fn.bp * 0.7) * amp;
  });
  // Accelerating ticks.
  let t = 11.0;
  let iv = 0.25;
  let k = 0;
  while (t < 12.88) {
    const p = (t - 11.0) / 1.9;
    tick(main, t, 0.08 + 0.12 * p, k % 2 ? 0.7 : 0.3, 3000 * Math.pow(2, p), 0.008);
    t += iv;
    iv = Math.max(0.035, iv * 0.86);
    k++;
  }
}

// ---- reverb on the main section -------------------------------------------
reverb(mainSend, main, 0, 0.8, 0.35, 1.0);

// ---- HARD GAP 12.90-13.00: duck the whole main bus to silence -------------
{
  const g0 = frame(12.9) - frame(0.003);
  const g1 = frame(12.9);
  for (let n = g0; n < N; n++) {
    const g = n < g1 ? (g1 - n) / (g1 - g0) : 0;
    main.L[n] *= g;
    main.R[n] *= g;
  }
}

// ---- 13.00 FINAL IMPACT ----------------------------------------------------
kick(fin, 13.0, 1.15, { tau: 0.34, sweep: 0.05, fHi: 160, fLo: 38 });
subBoom(fin, 13.0, 35, 0.66, 0.85, 2.0);
crash(fin, 13.0, 0.5, 0.35, 2.0, finSend, 0.25);
{
  // Bright chord stab: A minor add9 across 3 octaves.
  const base = [57, 60, 64, 71]; // A3 C4 E4 B4
  const freqs: number[] = [];
  for (let o = 0; o < 3; o++) for (const m of base) freqs.push(mtof(m + 12 * o));
  const fl = new SVF();
  const fr = new SVF();
  addStereo(
    fin,
    13.0,
    2.0,
    (t, o) => {
      let sl = 0;
      let sr = 0;
      for (let i = 0; i < freqs.length; i++) {
        const f = freqs[i];
        sl += saw(f * 1.004 * t + i * 0.21) + 0.5 * Math.sin(TAU * f * t);
        sr += saw(f * 0.996 * t + i * 0.37) + 0.5 * Math.sin(TAU * f * t);
      }
      const fc = 1400 + 5600 * Math.exp(-t / 0.25);
      fl.process(sl, fc, 0.8);
      fr.process(sr, fc, 0.8);
      const e = envAD(t, 0.003, 0.32) * 0.055 * tailCut(t, 2.0, 0.05);
      o[0] = fl.lp * e;
      o[1] = fr.lp * e;
    },
    finSend,
    1.0,
  );
}
reverb(finSend, fin, 13.0, 0.9, 0.5, 1.6);
{
  // Gentle shimmer: high partials slowly beating over the tail.
  const parts: Array<[number, number, number]> = [
    [1760, 1762.4, 0.2],
    [2637.0, 2640.1, 0.75],
    [3520, 3523.3, 0.35],
    [5274, 5279.5, 0.65],
  ];
  addStereo(fin, 13.0, 2.0, (t, o) => {
    const fadeIn = clamp01((t - 0.1) / 0.8);
    const amp = fadeIn * fadeIn * 0.022 * Math.exp(-t / 3);
    for (const [fa, fb, pan] of parts) {
      const v = (Math.sin(TAU * fa * t) + Math.sin(TAU * fb * t)) * 0.5 * amp;
      const [gl, gr] = panGains(pan);
      o[0] += v * gl;
      o[1] += v * gr;
    }
  });
}

// ================================================================= MASTER
const L = new Float32Array(N);
const R = new Float32Array(N);
for (let n = 0; n < N; n++) {
  L[n] = main.L[n] + fin.L[n];
  R[n] = main.R[n] + fin.R[n];
}

// Gentle 20 Hz high-pass (removes DC / subsonic).
for (const ch of [L, R]) {
  const f = new SVF();
  for (let n = 0; n < N; n++) {
    f.process(ch[n], 20, 0.707);
    ch[n] = f.hp;
  }
}

// Soft saturation for glue: pre-scale so peak drives tanh modestly.
let pk = 0;
for (let n = 0; n < N; n++) pk = Math.max(pk, Math.abs(L[n]), Math.abs(R[n]));
const drive = 1.5 / pk;
for (let n = 0; n < N; n++) {
  L[n] = Math.tanh(L[n] * drive);
  R[n] = Math.tanh(R[n] * drive);
}

// Master gap gate 12.90-13.00 (catches HPF ringing): 3 ms fade down, 3 ms fade up into 13.0.
{
  const a0 = frame(12.9) - frame(0.003);
  const a1 = frame(12.9);
  const b0 = frame(13.0) - frame(0.003);
  const b1 = frame(13.0);
  for (let n = a0; n < b1; n++) {
    const g = n < a1 ? (a1 - n) / (a1 - a0) : n < b0 ? 0 : (n - b0) / (b1 - b0);
    L[n] *= g;
    R[n] *= g;
  }
}

// Fade-out over the last 0.6 s to true digital silence at 15.000.
{
  const f0 = frame(14.4);
  const len = N - f0;
  for (let n = f0; n < N; n++) {
    const p = (n - f0 + 1) / len; // reaches exactly 1 at the last frame
    const g = 0.5 * (1 + Math.cos(Math.PI * p));
    L[n] *= g;
    R[n] *= g;
  }
  L[N - 1] = 0;
  R[N - 1] = 0;
}

// Normalize so the true sample peak is exactly -1.0 dBFS.
pk = 0;
for (let n = 0; n < N; n++) pk = Math.max(pk, Math.abs(L[n]), Math.abs(R[n]));
const target = Math.pow(10, -1 / 20);
const norm = target / pk;
for (let n = 0; n < N; n++) {
  L[n] *= norm;
  R[n] *= norm;
}

// ================================================================= WAV
const bytesPerSample = 2;
const channels = 2;
const dataSize = N * channels * bytesPerSample;
const buf = new ArrayBuffer(44 + dataSize);
const dv = new DataView(buf);
const ascii = (off: number, s: string) => {
  for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
};
ascii(0, "RIFF");
dv.setUint32(4, 36 + dataSize, true);
ascii(8, "WAVE");
ascii(12, "fmt ");
dv.setUint32(16, 16, true); // PCM fmt chunk size
dv.setUint16(20, 1, true); // PCM
dv.setUint16(22, channels, true);
dv.setUint32(24, SR, true);
dv.setUint32(28, SR * channels * bytesPerSample, true);
dv.setUint16(32, channels * bytesPerSample, true);
dv.setUint16(34, 16, true);
ascii(36, "data");
dv.setUint32(40, dataSize, true);
let off = 44;
for (let n = 0; n < N; n++) {
  const l = Math.max(-1, Math.min(1, L[n]));
  const r = Math.max(-1, Math.min(1, R[n]));
  dv.setInt16(off, Math.round(l * 32767), true);
  dv.setInt16(off + 2, Math.round(r * 32767), true);
  off += 4;
}

const outPath = join(import.meta.dir, "..", "public", "soundtrack.wav");
await Bun.write(outPath, buf);
console.log(`wrote ${outPath} — ${N} frames, ${(N / SR).toFixed(3)} s, peak scale ${norm.toFixed(4)}`);
