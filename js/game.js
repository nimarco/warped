/*
 * game.js
 * The rules for one track: tries, how damaged the tape is, peeks and points.
 * Pure logic with no page code, so it's easy to read and test.
 */

import { DISTORTIONS, MAX_PEEKS, MAX_TRIES, PEEK_COSTS, POINTS_BY_TRY } from "./config.js";
import { checkGuess, normalizeTitle } from "./matching.js";

/** Points for solving on a given try after a number of peeks. */
export function pointsFor(tryNumber, peeks) {
  const base = POINTS_BY_TRY[tryNumber - 1] ?? 0;
  const peekCost = PEEK_COSTS.slice(0, peeks).reduce((total, cost) => total + cost, 0);
  return Math.round(base * (1 - peekCost));
}

export class TrackRound {
  /**
   * @param {object} song   { id, title, artist, ... } from itunes.js
   * @param {number} tier   1–4
   * @param {string} distortion  a key of DISTORTIONS
   * @param {object} [saved] progress restored from storage
   */
  constructor(song, tier, distortion, saved = {}) {
    this.song = song;
    this.tier = tier;
    this.distortion = distortion;
    this.guesses = saved.guesses ?? [];
    this.peeks = saved.peeks ?? 0;
    this.status = saved.status ?? "playing";
  }

  get misses() {
    return this.guesses.filter((guess) => guess.result !== "correct").length;
  }

  get tryNumber() {
    return Math.min(this.guesses.length + 1, MAX_TRIES);
  }

  /** How damaged the tape is now: 0 = worst (try 1), one step less per miss. Null once it's clean. */
  get level() {
    const levels = DISTORTIONS[this.distortion].levels;
    return this.misses < levels.length && !this.isOver ? this.misses : null;
  }

  /** Damage steps left before the clean song (4 on try 1, 0 when clean). */
  get stepsLeft() {
    return this.level === null ? 0 : DISTORTIONS[this.distortion].levels.length - this.level;
  }

  /** What warp.js should play right now, or null for the clean song. */
  get damage() {
    if (this.level === null) {
      return null;
    }
    // The step's settings (value, plus static for Muffled), minus its screen label.
    const { label, ...settings } = DISTORTIONS[this.distortion].levels[this.level];
    return { type: this.distortion, ...settings };
  }

  get isOver() {
    return this.status !== "playing";
  }

  /** Points available if the next guess is right. */
  get potentialPoints() {
    return pointsFor(this.tryNumber, this.peeks);
  }

  get solvedOnTry() {
    return this.status === "solved" ? this.guesses.length : null;
  }

  get points() {
    return this.status === "solved" ? pointsFor(this.solvedOnTry, this.peeks) : 0;
  }

  get canPeek() {
    return !this.isOver && this.peeks < MAX_PEEKS;
  }

  hasGuessed(song) {
    const title = normalizeTitle(song.title);
    return this.guesses.some((guess) => guess.result !== "skip" && normalizeTitle(guess.title) === title);
  }

  /** Make a guess. Returns "correct", "artist", "title" or "wrong". */
  guess(song) {
    const result = checkGuess(song, this.song);
    this.guesses.push({ title: song.title, artist: song.artist, result });
    this.updateStatus(result);
    return result;
  }

  /** Skip this try: costs a try, and the damage eases one step. */
  skip() {
    this.guesses.push({ title: "", artist: "", result: "skip" });
    this.updateStatus("skip");
  }

  /** Use a peek. Returns the peek number (1 or 2). */
  peek() {
    if (this.canPeek) {
      this.peeks += 1;
    }
    return this.peeks;
  }

  updateStatus(result) {
    if (result === "correct") {
      this.status = "solved";
    } else if (this.guesses.length >= MAX_TRIES) {
      this.status = "missed";
    }
  }

  /** What gets saved to storage. */
  toJSON() {
    return { id: this.song.id, distortion: this.distortion, guesses: this.guesses, peeks: this.peeks, status: this.status };
  }
}
