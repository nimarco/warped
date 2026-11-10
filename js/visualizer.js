/*
 * visualizer.js — BROWSER API: Canvas API (with the Web Audio AnalyserNode)
 *
 * Draws the "TV screen": frequency bars that react to the clip. The more
 * damage is left, the more the picture glitches (color split and
 * tracking-error bands), so the screen gets cleaner as the song does.
 */

const BAR_COUNT = 36;

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.analyser = null;
    this.data = null;
    this.distortion = 0;
    this.running = false;
    this.frame = null;
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.colors = this.readColors();

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Colors come from CSS custom properties so the palette lives in style.css. */
  readColors() {
    const styles = getComputedStyle(this.canvas);
    return {
      left: styles.getPropertyValue("--vis-left").trim() || "#ff3d7f",
      right: styles.getPropertyValue("--vis-right").trim() || "#3df5ff",
      main: styles.getPropertyValue("--vis-main").trim() || "#f4ecd8",
      dim: styles.getPropertyValue("--vis-dim").trim() || "rgba(244, 236, 216, 0.15)",
    };
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(Math.round(width * ratio), 1);
    this.canvas.height = Math.max(Math.round(height * ratio), 1);
    if (!this.running) {
      this.drawIdle();
    }
  }

  setAnalyser(analyser) {
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
  }

  /** 0 = clean picture, 4 = the worst damage (try 1). */
  setDistortion(steps) {
    this.distortion = steps;
    if (!this.running) {
      this.drawIdle();
    }
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    const loop = () => {
      this.draw();
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.drawIdle();
  }

  /**
   * Bar heights from 0 to 1. Frequencies are spread on a log scale (like
   * hearing works) and mirrored: bass in the middle, treble at both edges.
   */
  levels() {
    const heights = new Array(BAR_COUNT).fill(0);
    if (!this.analyser) {
      return heights;
    }
    this.analyser.getByteFrequencyData(this.data);

    const half = BAR_COUNT / 2;
    const lowest = 1;
    const highest = Math.floor(this.data.length * 0.6);
    for (let step = 0; step < half; step++) {
      const index = Math.floor(lowest * Math.pow(highest / lowest, step / (half - 1)));
      const level = this.data[Math.min(index, this.data.length - 1)] / 255;
      heights[half - 1 - step] = level;
      heights[half + step] = level;
    }
    return heights;
  }

  drawBars(heights, color, shiftX) {
    const { width, height } = this.canvas;
    const context = this.context;
    const gap = width * 0.008;
    const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
    const middle = height / 2;

    context.fillStyle = color;
    heights.forEach((level, bar) => {
      const barHeight = Math.max(level * height * 0.42, height * 0.006);
      const x = bar * (barWidth + gap) + shiftX;
      context.fillRect(x, middle - barHeight, barWidth, barHeight * 2);
    });
  }

  draw() {
    const { width, height } = this.canvas;
    const context = this.context;
    const heights = this.levels();
    const split = this.reduceMotion ? 0 : this.distortion * width * 0.006;

    context.clearRect(0, 0, width, height);

    // Color split: red and cyan copies drift apart while the song is warped.
    context.globalCompositeOperation = "lighter";
    if (split > 0) {
      this.drawBars(heights, this.colors.left, -split);
      this.drawBars(heights, this.colors.right, split);
    }
    this.drawBars(heights, this.colors.main, 0);
    context.globalCompositeOperation = "source-over";

    // Tracking error: random horizontal bands slide sideways, like a bad VHS tape.
    // Try 1 tears most often, and can tear in two places at once.
    for (let tear = 0; tear < 2; tear++) {
      if (this.reduceMotion || this.distortion === 0 || Math.random() >= 0.11 * this.distortion - tear * 0.2) {
        break;
      }
      const bandHeight = height * (0.03 + Math.random() * 0.07);
      const y = Math.random() * (height - bandHeight);
      const shift = (Math.random() - 0.5) * width * 0.07 * this.distortion;
      context.drawImage(this.canvas, 0, y, width, bandHeight, shift, y, width, bandHeight);
    }
  }

  /** The resting picture: a flat line with faint static. */
  drawIdle() {
    const { width, height } = this.canvas;
    const context = this.context;
    context.clearRect(0, 0, width, height);
    this.drawBars(new Array(BAR_COUNT).fill(0), this.colors.dim, 0);
  }
}
