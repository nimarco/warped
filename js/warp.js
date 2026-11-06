/*
 * warp.js — BROWSER API: Web Audio API
 * https://developer.mozilla.org/docs/Web/API/Web_Audio_API
 *
 * Plays a song preview through one of four kinds of live tape damage.
 * Each takes one number (set in config.js), turned down every try:
 *
 *   fastforward  played too fast, so it's rushed and higher (value: speed)
 *   rewind       cut into pieces that each play backwards (value: seconds per
 *                piece; a whole 10-second piece is plain reversed)
 *   rickroll     someone taped Never Gonna Give You Up over it (value: how
 *                loud Rick is compared with the song)
 *   chewed       patches of tape are chewed up: hiss, stutters, backwards bits
 *                (value: share of the clip left intact; repairs never move)
 *   warp         the pitch jumps up and down in chunks, like a voice cracking,
 *                so the melody comes out wrong (value: biggest jump in semitones;
 *                chunk: about how many seconds between cracks)
 *   muffled      heard through a wall on a crackly, crunchy tape (value: low-pass
 *                cutoff in Hz; static: how loud the static is next to the song)
 *
 * The signal path is: song (+ Rick) → [low-pass → bitcrusher, + static] → level + fade in/out → analyser → speakers.
 * Every clip is evened out to the same loudness (CLIP_LOUDNESS in config.js).
 * Nothing is pre-rendered: every play builds the chain fresh.
 */

import { CLIP_LOUDNESS, CLIP_SECONDS, MAX_CLIP_BOOST } from "./config.js";

const FADE_SECONDS = 0.04;

// Loudness (RMS) of the hiss buffer below: uniform noise at ±0.5 is about 0.29.
const HISS_LOUDNESS = 0.29;

let context = null;

/** Browsers only allow audio after a click, so the context is created lazily. */
function getContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("This browser doesn't support Web Audio.");
    }
    context = new AudioContextClass();
  }
  return context;
}

/** Call from a click handler. Resolves once audio is allowed to play. */
export async function unlockAudio() {
  const ctx = getContext();
  if (ctx.state !== "running") {
    await ctx.resume();
  }
}

/**
 * Chopped reverse: cut the clip into pieces of `pieceSeconds` and play each
 * piece backwards, keeping the pieces in order. Neighbouring pieces overlap
 * by a few milliseconds and crossfade, so the cuts don't click.
 */
function chopReverseBuffer(ctx, buffer, start, duration, pieceSeconds) {
  const rate = buffer.sampleRate;
  const from = Math.floor(start * rate);
  const length = Math.min(Math.floor(duration * rate), buffer.length - from);
  const piece = Math.max(Math.floor(pieceSeconds * rate), 32);
  const overlap = Math.max(Math.floor(Math.min(0.012, pieceSeconds / 4) * rate), 1);
  const result = ctx.createBuffer(buffer.numberOfChannels, length, rate);

  // Equal-power crossfade: sin² + cos² = 1 across each overlap.
  const weight = (t, pieceStart, pieceEnd) => {
    if (t < pieceStart + overlap) {
      return Math.sin((Math.PI / 2) * Math.min(Math.max((t - (pieceStart - overlap)) / (2 * overlap), 0), 1));
    }
    if (t > pieceEnd - overlap) {
      return Math.cos((Math.PI / 2) * Math.min(Math.max((t - (pieceEnd - overlap)) / (2 * overlap), 0), 1));
    }
    return 1;
  };

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const target = result.getChannelData(channel);
    for (let pieceStart = 0; pieceStart < length; pieceStart += piece) {
      const pieceEnd = Math.min(pieceStart + piece, length);
      // Read a slightly wider window so the overlaps have audio to fade between.
      const first = Math.max(pieceStart - overlap, 0);
      const last = Math.min(pieceEnd + overlap, length);
      for (let t = first; t < last; t++) {
        const mirrored = first + last - 1 - t;
        const fadeIn = pieceStart === 0 ? 1 : 0;
        const fadeOut = pieceEnd === length ? 1 : 0;
        let w = weight(t, pieceStart, pieceEnd);
        if ((fadeIn && t < pieceStart + overlap) || (fadeOut && t > pieceEnd - overlap)) {
          w = 1;
        }
        target[t] += source[from + mirrored] * w;
      }
    }
  }
  return result;
}

/** A tiny seeded random generator, so damage sounds the same on every replay. */
function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Chewed tape: split the clip into short cells. Each cell gets a fixed random
 * rank from the seed, and cells ranked above `keepFraction` are damaged
 * (hiss, a stutter of the cell's start, or the cell backwards). The same
 * seed with a higher keepFraction repairs some cells and never moves damage.
 */
function chewBuffer(ctx, buffer, start, duration, keepFraction, seed) {
  const rate = buffer.sampleRate;
  const from = Math.floor(start * rate);
  const length = Math.min(Math.floor(duration * rate), buffer.length - from);
  const cell = Math.floor(0.35 * rate);
  const fade = Math.floor(rate * 0.008);
  const random = seededRandom(seed);
  const cells = [];
  for (let cellStart = 0; cellStart < length; cellStart += cell) {
    cells.push({ start: cellStart, end: Math.min(cellStart + cell, length), rank: random(), damage: random() });
  }

  const result = ctx.createBuffer(buffer.numberOfChannels, length, rate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const target = result.getChannelData(channel);
    const noise = seededRandom(seed + 7);
    for (const { start: cellStart, end, rank, damage } of cells) {
      const size = end - cellStart;
      const stutter = Math.max(Math.floor(size / 4), 1);
      for (let t = cellStart; t < end; t++) {
        const offset = t - cellStart;
        const edge = Math.min(offset, size - 1 - offset);
        const envelope = edge < fade ? edge / fade : 1;
        let sample;
        if (rank < keepFraction) {
          sample = source[from + t];
        } else if (damage < 0.4) {
          sample = (noise() * 2 - 1) * 0.02; // chewed through: just hiss
        } else if (damage < 0.7) {
          sample = source[from + cellStart + (offset % stutter)]; // stutter
        } else {
          sample = source[from + end - 1 - offset]; // backwards
        }
        target[t] = sample * envelope;
      }
    }
  }
  return result;
}

/**
 * Warp: cut the clip into chunks of roughly `chunkSeconds` (0.7× to 1.4×) and
 * shift each chunk's pitch up or down, keeping its timing, so the tune
 * cracks like a voice. Shorter chunks crack more often. Each chunk's direction is fixed by the seed and scaled
 * by `semitones`, so easing only shrinks the jumps.
 * Pitch shifting without changing speed: short overlapping grains (Hann
 * windows at 50% overlap add up to 1), each one read faster or slower.
 */
function crackBuffer(ctx, buffer, start, duration, semitones, chunkSeconds, seed) {
  const rate = buffer.sampleRate;
  const from = Math.floor(start * rate);
  const length = Math.min(Math.floor(duration * rate), buffer.length - from);
  const random = seededRandom(seed);

  const chunks = [];
  for (let position = 0; position < length; ) {
    position += Math.max(Math.floor(chunkSeconds * (0.7 + random() * 0.7) * rate), 1);
    const direction = random() * 2 - 1;
    // Push most chunks clearly away from 0 so the jumps are audible.
    const shift = Math.sign(direction) * (0.35 + 0.65 * Math.abs(direction)) * semitones;
    chunks.push({ end: position, ratio: 2 ** (shift / 12) });
  }

  const grain = Math.floor(0.07 * rate);
  const hop = Math.floor(grain / 2);
  const window = Float32Array.from({ length: grain }, (_, index) => Math.sin((Math.PI * index) / grain) ** 2);
  const result = ctx.createBuffer(buffer.numberOfChannels, length, rate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const target = result.getChannelData(channel);
    let chunk = 0;
    for (let center = 0; center < length + hop; center += hop) {
      while (chunk < chunks.length - 1 && center >= chunks[chunk].end) {
        chunk += 1;
      }
      const ratio = chunks[chunk].ratio;
      for (let index = 0; index < grain; index++) {
        const t = center - hop + index;
        const read = center + (index - hop) * ratio;
        if (t < 0 || t >= length || read < 0 || read >= length - 1) {
          continue;
        }
        const whole = Math.floor(read);
        const fraction = read - whole;
        const sample = source[from + whole] * (1 - fraction) + source[from + whole + 1] * fraction;
        target[t] += sample * window[index];
      }
    }
  }
  return result;
}

/** A curve that snaps the waveform to a few levels (a bitcrusher): fewer bits, more crunch. */
function makeCrushCurve(bits) {
  const steps = 2 ** bits / 2;
  const curve = new Float32Array(2048);
  for (let index = 0; index < curve.length; index++) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.round(x * steps) / steps;
  }
  return curve;
}

/** Two seconds of tape hiss with a few vinyl crackles, looped during play. */
function makeHissBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) {
    const crackle = Math.random() < 0.0004 ? (Math.random() - 0.5) * 6 : 0;
    data[index] = (Math.random() * 2 - 1) * 0.5 + crackle;
  }
  return buffer;
}

/** Loudest `duration` seconds of a buffer, as a start time in seconds. Usually the chorus. */
function loudestStart(buffer, duration) {
  const samples = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const windowSize = Math.floor(rate / 2);
  const energies = [];

  for (let index = 0; index + windowSize <= samples.length; index += windowSize) {
    let sum = 0;
    for (let offset = 0; offset < windowSize; offset += 16) {
      sum += samples[index + offset] ** 2;
    }
    energies.push(sum);
  }

  const windowsPerClip = Math.round(duration * 2);
  let bestStart = 0;
  let bestEnergy = -1;
  for (let start = 0; start + windowsPerClip <= energies.length; start++) {
    const energy = energies.slice(start, start + windowsPerClip).reduce((total, value) => total + value, 0);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = start;
    }
  }
  return bestStart / 2;
}

/** How loud a stretch of a buffer is (root mean square), sampled for speed. */
function loudness(buffer, start, duration) {
  const samples = buffer.getChannelData(0);
  const from = Math.floor(start * buffer.sampleRate);
  const to = Math.min(from + Math.floor(duration * buffer.sampleRate), samples.length);
  let sum = 0;
  let count = 0;
  for (let index = from; index < to; index += 32) {
    sum += samples[index] ** 2;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(count, 1)) || 1e-4;
}

/** Download and decode one preview. Throws a friendly error on failure. */
async function decode(url) {
  let audioData;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    audioData = await response.arrayBuffer();
  } catch {
    throw new Error("Couldn't download this song's audio.");
  }
  try {
    return await getContext().decodeAudioData(audioData);
  } catch {
    throw new Error("This browser couldn't play this song's audio.");
  }
}

/**
 * Loads one song and plays it clean or with one kind of damage.
 *
 *   const player = new WarpPlayer();
 *   await player.load(song.previewUrl);
 *   player.play({ damage: { type: "fastforward", value: 2 }, start: 12 });
 */
export class WarpPlayer {
  constructor() {
    this.buffer = null;
    this.overlay = null;
    this.overlayUrl = null;
    this.nodes = [];
    this.playing = false;
    this.startedAt = 0;
    this.playLength = 0;
    this.onEnded = null;
    this.output = null;
    this.analyser = null;
  }

  /** Download and decode a song's preview. */
  async load(url) {
    this.stop();
    this.buffer = await decode(url);
  }

  /** Download the Rick Roll once; later calls reuse it. */
  async loadOverlay(url) {
    if (this.overlayUrl !== url) {
      this.overlay = await decode(url);
      this.overlayUrl = url;
    }
  }

  get hasOverlay() {
    return this.overlay !== null;
  }

  /**
   * Find where the loudest stretch of the preview starts (in seconds).
   * The loudest part is usually the chorus, which makes the best clip.
   */
  findLoudestStart(duration = CLIP_SECONDS) {
    return loudestStart(this.buffer, duration);
  }

  /** The analyser node the visualizer reads from (created on first use). */
  getAnalyser() {
    const ctx = getContext();
    if (!this.analyser) {
      this.output = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.75;
      // Clips play quieter since loudness was evened out, so the bars read 6 dB lower.
      this.analyser.minDecibels = -106;
      this.analyser.maxDecibels = -36;
      this.output.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    }
    return this.analyser;
  }

  /**
   * Play the clip.
   * @param {object} options
   * @param {{ type: string, value: number } | null} options.damage  null plays the clean song
   * @param {number} options.start      where the clip starts in the preview (seconds)
   * @param {number} [options.duration] clip length in song seconds
   * @param {number} [options.volume]   0–1, on top of the clip's evened-out loudness
   * @param {number} [options.seed]     fixes where Chewed and Warp strike, so replays match
   */
  play({ damage = null, start, duration = CLIP_SECONDS, volume = 1, seed = 1 }) {
    if (!this.buffer) {
      return;
    }

    const ctx = getContext();
    this.stop();
    this.getAnalyser();

    const type = damage?.type ?? "clean";
    const clipStart = Math.min(start, Math.max(this.buffer.duration - duration, 0));
    const source = ctx.createBufferSource();
    let offset = clipStart;

    // These three build a new buffer holding just the damaged clip, so it plays from 0.
    if (type === "rewind") {
      source.buffer = chopReverseBuffer(ctx, this.buffer, clipStart, duration, damage.value);
      offset = 0;
    } else if (type === "chewed") {
      source.buffer = chewBuffer(ctx, this.buffer, clipStart, duration, damage.value, seed);
      offset = 0;
    } else if (type === "warp") {
      source.buffer = crackBuffer(ctx, this.buffer, clipStart, duration, damage.value, damage.chunk ?? 0.4, seed);
      offset = 0;
    } else {
      source.buffer = this.buffer;
    }

    // Faster playback also raises the pitch, like a real tape.
    const speed = type === "fastforward" ? damage.value : 1;
    source.playbackRate.value = speed;
    const realLength = duration / speed;

    // Everything is mixed into `mix`, then faded in and out to prevent clicks.
    const mix = ctx.createGain();
    let chainEnd = mix;
    source.connect(mix);

    if (type === "rickroll" && this.overlay) {
      const rick = ctx.createBufferSource();
      rick.buffer = this.overlay;
      const rickLevel = ctx.createGain();
      // damage.value is Rick's loudness compared with this song's, so quiet and loud songs match.
      const rickStart = loudestStart(this.overlay, duration);
      rickLevel.gain.value = damage.value * (loudness(this.buffer, clipStart, duration) / loudness(this.overlay, rickStart, duration));
      rick.connect(rickLevel).connect(mix);
      rick.start(ctx.currentTime, rickStart, realLength);
      this.nodes.push(rick, rickLevel);
    }

    if (type === "muffled") {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = damage.value;
      lowpass.Q.value = 0.9;
      mix.connect(lowpass);

      // The tape is crunchy too: fewer bits while the static is strong.
      const crusher = ctx.createWaveShaper();
      const staticLevel = Math.min(Math.max(damage.static ?? 0, 0), 2);
      crusher.curve = makeCrushCurve(Math.max(12 - 9 * staticLevel, 2));
      lowpass.connect(crusher);
      // The static joins after the crunch, like noise on the tape itself.
      const withStatic = ctx.createGain();
      crusher.connect(withStatic);
      chainEnd = withStatic;

      // Static over the whole range, so it covers the tune, not just the treble.
      // damage.static is its loudness next to this song's (1 = equally loud).
      const hiss = ctx.createBufferSource();
      hiss.buffer = makeHissBuffer(ctx);
      hiss.loop = true;
      const hissFilter = ctx.createBiquadFilter();
      hissFilter.type = "highpass";
      hissFilter.frequency.value = 120;
      const hissLevel = ctx.createGain();
      hissLevel.gain.value = (staticLevel * loudness(this.buffer, clipStart, duration)) / HISS_LOUDNESS;
      hiss.connect(hissFilter).connect(hissLevel).connect(withStatic);
      hiss.start();
      this.nodes.push(lowpass, crusher, withStatic, hiss, hissFilter, hissLevel);
    }

    // Even out loudness: every clip, with its added Rick or static, plays at
    // CLIP_LOUDNESS. Those layers add energy roughly as the sum of squares.
    const songLevel = loudness(this.buffer, clipStart, duration);
    const added = type === "rickroll" && this.overlay ? damage.value : type === "muffled" ? Math.min(Math.max(damage.static ?? 0, 0), 2) : 0;
    const level = volume * Math.min(CLIP_LOUDNESS / (songLevel * Math.sqrt(1 + added ** 2)), MAX_CLIP_BOOST);

    const envelope = ctx.createGain();
    const now = ctx.currentTime;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(level, now + FADE_SECONDS);
    envelope.gain.setValueAtTime(level, now + realLength - FADE_SECONDS);
    envelope.gain.linearRampToValueAtTime(0, now + realLength);
    chainEnd.connect(envelope).connect(this.output);
    this.nodes.push(mix, envelope);

    source.onended = () => {
      if (this.source === source) {
        this.stop();
        this.onEnded?.();
      }
    };

    source.start(now, offset, duration);
    this.source = source;
    this.nodes.push(source);
    this.playing = true;
    this.startedAt = now;
    this.playLength = realLength;
  }

  /** How far through the current clip we are, from 0 to 1. */
  get progress() {
    if (!this.playing) {
      return 0;
    }
    const elapsed = getContext().currentTime - this.startedAt;
    return Math.min(elapsed / this.playLength, 1);
  }

  stop() {
    this.source = null;
    for (const node of this.nodes) {
      if (typeof node.stop === "function") {
        try {
          node.stop();
        } catch {
          // Already stopped; nothing to do.
        }
      }
      node.disconnect();
    }
    this.nodes = [];
    this.playing = false;
  }
}

/** A short synth blip for right/wrong feedback, so no sound files are needed. */
export function playBlip(kind) {
  if (!context || context.state !== "running") {
    return;
  }
  const notes = kind === "correct" ? [523, 659, 784] : kind === "partial" ? [440, 494] : [220, 165];
  const now = context.currentTime;

  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "wrong" ? "sawtooth" : "triangle";
    oscillator.frequency.value = frequency;
    const at = now + index * 0.09;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.3);
  });
}
