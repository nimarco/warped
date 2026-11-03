/*
 * warp.js — BROWSER API: Web Audio API
 * https://developer.mozilla.org/docs/Web/API/Web_Audio_API
 *
 * Plays a song preview through live "tape damage" effects (layers):
 *
 *   reversed     the clip plays backwards (◀◀ REW)
 *   fastforward  sped up, so it's higher and rushed (▶▶ FF)
 *   melted       slowed down with a strong pitch wobble, like a tape left in the sun
 *   chewed       the player "eats" the tape: stutters, skips and dropouts
 *   static       bitcrush + tape hiss
 *   warble       slowed down with a gentle pitch wobble
 *   muffled      low-pass filter
 *
 * The signal path is: song → [static] → [muffled] → analyser → speakers.
 * Speed and pitch effects act on the song player itself, and "reversed" and
 * "chewed" change which audio it plays. Nothing is pre-rendered: changing
 * layers just rebuilds the chain.
 */

import { CLIP_SECONDS } from "./config.js";

const FADE_SECONDS = 0.04;

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

/** True once the browser allows sound, so a clip can start without another click. */
export function audioUnlocked() {
  return context?.state === "running";
}

/** Blend between two numbers: t = 0 gives a, t = 1 gives b. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Turn a 0–1 intensity into concrete effect settings. */
export function settingsFor(intensity) {
  const i = Math.min(Math.max(intensity, 0), 1);
  return {
    // Fewer bits = crunchier, like a cheap old recording.
    bits: lerp(9, 2.5, i),
    hiss: lerp(0.015, 0.14, i),
    // Below 1 = slower and lower-pitched. The wobble mimics a warped record.
    speed: lerp(0.94, 0.68, i),
    wobbleCents: lerp(12, 90, i),
    wobbleHz: lerp(0.4, 1.4, i),
    // Low-pass cutoff in Hz (lower = more muffled). Exponential so it sounds even.
    cutoff: 2200 * Math.pow(250 / 2200, i),
    // Fast-forward: 1.4× (like a "sped up" TikTok edit) up to 2.4× (chipmunk).
    fastSpeed: lerp(1.4, 2.4, i),
    // Melted: much slower and wobblier than warble, enough to bend the melody.
    meltSpeed: lerp(0.88, 0.62, i),
    meltCents: lerp(150, 800, i),
    meltHz: lerp(0.5, 1.3, i),
    // Chewed: chance that each bit of tape stutters, skips ahead or drops out.
    stutterChance: lerp(0.12, 0.35, i),
    skipChance: lerp(0.05, 0.2, i),
    dropoutChance: lerp(0.04, 0.18, i),
  };
}

/** A tiny seeded random generator, so a chewed clip sounds the same on every replay. */
function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Build a "chewed tape" version of a clip: walk through it in short pieces,
 * and for each piece either play it, stutter (repeat a tiny slice), skip it,
 * or drop out to near silence. Every piece fades in and out so cuts don't click.
 */
function chewBuffer(ctx, buffer, start, duration, settings, seed) {
  const rate = buffer.sampleRate;
  const random = seededRandom(seed);
  const seconds = (min, max) => Math.floor((min + random() * (max - min)) * rate);
  const end = Math.min(Math.floor((start + duration) * rate), buffer.length);
  let position = Math.floor(start * rate);

  // Each entry: copy `length` samples from `from` (or silence if from is null).
  const pieces = [];
  while (position < end) {
    const roll = random();
    if (roll < settings.stutterChance) {
      const slice = seconds(0.05, 0.12);
      const repeats = 2 + Math.floor(random() * 3);
      for (let count = 0; count < repeats; count++) {
        pieces.push({ from: position, length: slice });
      }
      position += slice;
    } else if (roll < settings.stutterChance + settings.skipChance) {
      position += seconds(0.15, 0.4);
    } else if (roll < settings.stutterChance + settings.skipChance + settings.dropoutChance) {
      const gap = seconds(0.1, 0.25);
      pieces.push({ from: null, length: gap });
      position += gap;
    } else {
      const length = Math.min(seconds(0.2, 0.5), end - position);
      pieces.push({ from: position, length });
      position += length;
    }
  }

  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const result = ctx.createBuffer(buffer.numberOfChannels, Math.max(total, 1), rate);
  const fade = Math.floor(rate * 0.006);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const target = result.getChannelData(channel);
    let writeAt = 0;
    for (const piece of pieces) {
      for (let offset = 0; offset < piece.length; offset++) {
        const edge = Math.min(offset, piece.length - 1 - offset);
        const envelope = edge < fade ? edge / fade : 1;
        const sample = piece.from === null ? 0 : source[Math.min(piece.from + offset, source.length - 1)];
        target[writeAt + offset] = sample * envelope;
      }
      writeAt += piece.length;
    }
  }
  return result;
}

/** A curve that snaps the waveform to a few levels (a bitcrusher). */
function makeCrushCurve(bits) {
  const steps = Math.pow(2, bits) / 2;
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

/** Make a backwards copy of an audio buffer. */
function reverseBuffer(ctx, buffer) {
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    for (let index = 0; index < source.length; index++) {
      target[index] = source[source.length - 1 - index];
    }
  }
  return reversed;
}

/**
 * Loads one song and plays it with any combination of layers.
 *
 *   const player = new WarpPlayer();
 *   await player.load(song.previewUrl);
 *   player.play({ layers: ["static", "muffled"], intensity: 0.8, start: 12 });
 */
export class WarpPlayer {
  constructor() {
    this.buffer = null;
    this.reversedBuffer = null;
    this.nodes = [];
    this.playing = false;
    this.startedAt = 0;
    this.playLength = 0;
    this.onEnded = null;
    this.output = null;
    this.analyser = null;
  }

  /** Download and decode a preview. Throws a friendly error on failure. */
  async load(url) {
    const ctx = getContext();
    this.stop();

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
      this.buffer = await ctx.decodeAudioData(audioData);
    } catch {
      throw new Error("This browser couldn't play this song's audio.");
    }

    this.reversedBuffer = reverseBuffer(ctx, this.buffer);
  }

  /**
   * Find where the loudest stretch of the preview starts (in seconds).
   * The loudest part is usually the chorus, which makes the best clip.
   */
  findLoudestStart(duration = CLIP_SECONDS) {
    const samples = this.buffer.getChannelData(0);
    const rate = this.buffer.sampleRate;
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

  /** The analyser node the visualizer reads from (created on first use). */
  getAnalyser() {
    const ctx = getContext();
    if (!this.analyser) {
      this.output = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.75;
      this.output.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    }
    return this.analyser;
  }

  /**
   * Play the clip.
   * @param {object} options
   * @param {string[]} options.layers   active layers, e.g. ["reversed", "static"]
   * @param {object|number} options.intensity  0–1, or { static, warble, muffled }
   * @param {number} options.start      where the clip starts in the preview (seconds)
   * @param {number} [options.duration] clip length in song seconds
   * @param {number} [options.volume]   0–1
   * @param {number} [options.seed]     fixes where a "chewed" tape stutters and skips
   */
  play({ layers, intensity, start, duration = CLIP_SECONDS, volume = 0.9, seed = 1 }) {
    if (!this.buffer) {
      return;
    }

    const ctx = getContext();
    this.stop();
    this.getAnalyser();

    const active = new Set(layers);
    const levelFor = (layer) => (typeof intensity === "number" ? intensity : intensity[layer] ?? 0.5);
    const clipStart = Math.min(start, Math.max(this.buffer.duration - duration, 0));

    // The source: forwards or backwards. A reversed clip covers the same section of the song.
    const source = ctx.createBufferSource();
    let buffer = active.has("reversed") ? this.reversedBuffer : this.buffer;
    let offset = active.has("reversed") ? this.buffer.duration - clipStart - duration : clipStart;
    let clipLength = duration;

    // Chewed: play a damaged copy of just the clip, from its beginning.
    if (active.has("chewed")) {
      buffer = chewBuffer(ctx, buffer, Math.max(offset, 0), duration, settingsFor(levelFor("chewed")), seed);
      offset = 0;
      clipLength = buffer.duration;
    }
    source.buffer = buffer;

    let chainEnd = source;
    const connect = (node) => {
      chainEnd.connect(node);
      chainEnd = node;
      this.nodes.push(node);
    };

    if (active.has("static")) {
      const settings = settingsFor(levelFor("static"));
      const crusher = ctx.createWaveShaper();
      crusher.curve = makeCrushCurve(settings.bits);
      connect(crusher);

      const hiss = ctx.createBufferSource();
      hiss.buffer = makeHissBuffer(ctx);
      hiss.loop = true;
      const hissFilter = ctx.createBiquadFilter();
      hissFilter.type = "highpass";
      hissFilter.frequency.value = 1500;
      const hissGain = ctx.createGain();
      hissGain.gain.value = settings.hiss;
      hiss.connect(hissFilter).connect(hissGain).connect(crusher);
      hiss.start();
      this.nodes.push(hiss, hissFilter, hissGain);
    }

    // A slow oscillator bends the pitch up and down, like a warped record.
    const addWobble = (frequency, cents) => {
      const wobble = ctx.createOscillator();
      wobble.frequency.value = frequency;
      const wobbleDepth = ctx.createGain();
      wobbleDepth.gain.value = cents;
      wobble.connect(wobbleDepth).connect(source.detune);
      wobble.start();
      this.nodes.push(wobble, wobbleDepth);
    };

    // Speed effects multiply: playing faster also raises the pitch, like a real tape.
    let speed = 1;
    if (active.has("fastforward")) {
      speed *= settingsFor(levelFor("fastforward")).fastSpeed;
    }
    if (active.has("melted")) {
      const settings = settingsFor(levelFor("melted"));
      speed *= settings.meltSpeed;
      // Two wobbles at unrelated speeds make the drift feel uneven, not like a steady siren.
      addWobble(settings.meltHz, settings.meltCents * 0.65);
      addWobble(settings.meltHz * 0.37, settings.meltCents * 0.35);
    }
    if (active.has("warble")) {
      const settings = settingsFor(levelFor("warble"));
      speed *= settings.speed;
      addWobble(settings.wobbleHz, settings.wobbleCents);
    }
    source.playbackRate.value = speed;

    if (active.has("muffled")) {
      const settings = settingsFor(levelFor("muffled"));
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = settings.cutoff;
      lowpass.Q.value = 0.9;
      connect(lowpass);
    }

    // Short fades at both ends prevent clicks.
    const realLength = clipLength / speed;
    const envelope = ctx.createGain();
    const now = ctx.currentTime;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(volume, now + FADE_SECONDS);
    envelope.gain.setValueAtTime(volume, now + realLength - FADE_SECONDS);
    envelope.gain.linearRampToValueAtTime(0, now + realLength);
    connect(envelope);
    chainEnd.connect(this.output);

    source.onended = () => {
      if (this.source === source) {
        this.stop();
        this.onEnded?.();
      }
    };

    source.start(now, Math.max(offset, 0), clipLength);
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
