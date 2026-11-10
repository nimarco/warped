/*
 * game.js
 * The rules for one track: tries, how damaged the tape is, peeks and points.
 * Pure logic with no page code, so it's easy to read and test.
 */

import {
  CLUE_CLOSE_YEARS,
  DISTORTIONS,
  GENRE_FAMILIES,
  MAX_PEEKS,
  MAX_TRIES,
  PEEK_COSTS,
  POINTS_BY_TRY,
} from "./config.js";
import { checkGuess, sameGuess } from "./matching.js";

/** Points for solving on a given try after a number of peeks. */
export function pointsFor(tryNumber, peeks) {
  const base = POINTS_BY_TRY[tryNumber - 1] ?? 0;
  const peekCost = PEEK_COSTS.slice(0, peeks).reduce((total, cost) => total + cost, 0);
  return Math.round(base * (1 - peekCost));
}

/** The broad kind of music an iTunes genre name belongs to ("Alternative" → "Rock"). */
export function genreFamily(genre) {
  if (!genre) {
    return null;
  }
  return GENRE_FAMILIES.find((family) => family.pattern.test(genre))?.name ?? genre;
}

/**
 * What a wrong guess tells the player about the answer. Either part is left
 * out when a year or genre isn't known.
 * @returns {{ year?: number, when?: "same" | "before" | "after", close?: boolean, genre?: string, sameGenre?: boolean }}
 *   when: the answer came out the same year as the guess, before it or after it
 */
export function cluesFor(guess, answer) {
  const clues = {};
  if (guess.year && answer.year) {
    const gap = answer.year - guess.year;
    clues.year = guess.year;
    clues.when = gap === 0 ? "same" : gap < 0 ? "before" : "after";
    clues.close = gap !== 0 && Math.abs(gap) <= CLUE_CLOSE_YEARS;
  }
  const guessGenre = genreFamily(guess.genre);
  const answerGenre = genreFamily(answer.genre);
  if (guessGenre && answerGenre) {
    clues.genre = guessGenre;
    clues.sameGenre = guessGenre === answerGenre;
  }
  return clues;
}

/** A title without "(Remastered 2011)", "- Single Version" or "feat. X", keeping its letters' case. */
export function cleanTitle(title) {
  const cleaned = title
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/ - .*$/, "")
    .replace(/\s+(feat|ft)\..*$/i, "")
    .trim();
  return cleaned || title;
}

/**
 * The first peek: the title's first letter, and a blank for every other
 * letter, word by word, so you can count them.
 * "Billie Jean" → ["B_____", "____"], "1999" → ["1___"]. Punctuation stays visible.
 */
export function titleHint(title) {
  let shown = false;
  return cleanTitle(title)
    .split(/\s+/)
    .map((word) =>
      [...word]
        .map((char) => {
          if (!/[\p{L}\p{N}]/u.test(char)) {
            return char;
          }
          if (shown) {
            return "_";
          }
          shown = true;
          return char.toUpperCase();
        })
        .join("")
    );
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

  /** What the peeks have shown: the title's letters (peek 1), then the artist (peek 2). */
  get hints() {
    return {
      title: this.peeks >= 1 ? titleHint(this.song.title) : null,
      artist: this.peeks >= 2 ? this.song.artist : null,
    };
  }

  get canPeek() {
    return !this.isOver && this.peeks < MAX_PEEKS;
  }

  /** True if this song (same title and artist, any version) or anime show was already guessed. */
  hasGuessed(choice) {
    return this.guesses.some((guess) => guess.result !== "skip" && sameGuess(choice, guess));
  }

  /** Make a guess (a song, or an anime show). Returns "correct", "artist", "title" or "wrong". */
  guess(choice) {
    const result = checkGuess(choice, this.song);
    const show = choice.show ? { show: choice.show } : {};
    // A wrong song still narrows it down: older or newer, same genre or not.
    const clues = result !== "correct" && !choice.show ? { clues: cluesFor(choice, this.song) } : {};
    this.guesses.push({ title: choice.title, artist: choice.artist, ...show, ...clues, result });
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
