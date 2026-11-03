/*
 * game.js
 * The rules for one track: tries, layers, peeks and points.
 * Pure logic with no page code, so it's easy to read and test.
 */

import { LAYER_ORDER, LAYER_INTENSITY, MAX_PEEKS, MAX_TRIES, PEEK_COST, POINTS_BY_TRY, TIER_MULTIPLIER } from "./config.js";
import { checkGuess, normalizeTitle } from "./matching.js";

/** Points for solving on a given try after a number of peeks. */
export function pointsFor(tryNumber, peeks) {
  const base = POINTS_BY_TRY[tryNumber - 1] ?? 0;
  return Math.round(base * (1 - PEEK_COST * peeks));
}

/** Layer strengths for a tier: harder tracks get stronger distortion. */
export function intensityForTier(tier) {
  const multiplier = TIER_MULTIPLIER[tier] ?? 1;
  const result = {};
  for (const [layer, value] of Object.entries(LAYER_INTENSITY)) {
    result[layer] = Math.min(value * multiplier, 1);
  }
  return result;
}

export class TrackRound {
  /**
   * @param {object} song   { id, title, artist, ... } from itunes.js
   * @param {number} tier   1–4
   * @param {object} [saved] progress restored from storage
   */
  constructor(song, tier, saved = {}) {
    this.song = song;
    this.tier = tier;
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

  /** Layers still on: one comes off per miss, so try 5 is the clean song. */
  get activeLayers() {
    return LAYER_ORDER.slice(Math.min(this.misses, LAYER_ORDER.length));
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

  /** Skip this try: costs a try, removes a layer. */
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
    return { id: this.song.id, guesses: this.guesses, peeks: this.peeks, status: this.status };
  }
}
