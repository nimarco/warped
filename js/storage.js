/*
 * storage.js — BROWSER API: Web Storage (localStorage)
 * https://developer.mozilla.org/docs/Web/API/Web_Storage_API
 *
 * Saves stats, streaks and today's progress in the player's browser.
 * Storage can be blocked (private browsing, strict settings), so every
 * read and write is wrapped: the game still works, it just won't remember.
 */

import { MAX_TRIES } from "./config.js";

const KEYS = {
  stats: "warped:stats",
  day: "warped:day",
  seenHelp: "warped:seen-help",
};

const DEFAULT_STATS = {
  gamesPlayed: 0,
  totalScore: 0,
  bestScore: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedPuzzle: null,
  // How many tracks were solved on try 1, 2, 3, 4, 5, plus missed (last slot).
  solvedOnTry: new Array(MAX_TRIES + 1).fill(0),
};

/** Check once whether localStorage actually works here. */
function detectStorage() {
  try {
    const testKey = "warped:test";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export const storageAvailable = detectStorage();

function read(key, fallback) {
  if (!storageAvailable) {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  if (!storageAvailable) {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked mid-session: keep playing without saving.
  }
}

export function loadStats() {
  const saved = read(KEYS.stats, {});
  return { ...DEFAULT_STATS, ...saved, solvedOnTry: saved.solvedOnTry ?? [...DEFAULT_STATS.solvedOnTry] };
}

/** The streak to show today: it's broken if yesterday's puzzle was skipped. */
export function displayedStreak(stats, puzzleNumber) {
  const last = stats.lastPlayedPuzzle;
  return last === puzzleNumber || last === puzzleNumber - 1 ? stats.currentStreak : 0;
}

/**
 * Record a finished daily puzzle.
 * @param {number} puzzleNumber
 * @param {{ points: number, solvedOnTry: number | null }[]} results  one per track
 */
export function recordDailyResult(puzzleNumber, results) {
  const stats = loadStats();
  if (stats.lastPlayedPuzzle === puzzleNumber) {
    return stats;
  }

  const total = results.reduce((sum, track) => sum + track.points, 0);
  stats.currentStreak = stats.lastPlayedPuzzle === puzzleNumber - 1 ? stats.currentStreak + 1 : 1;
  stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
  stats.lastPlayedPuzzle = puzzleNumber;
  stats.gamesPlayed += 1;
  stats.totalScore += total;
  stats.bestScore = Math.max(stats.bestScore, total);

  for (const track of results) {
    const slot = track.solvedOnTry === null ? MAX_TRIES : track.solvedOnTry - 1;
    stats.solvedOnTry[slot] += 1;
  }

  write(KEYS.stats, stats);
  return stats;
}

/** Today's saved progress, or null if it's from a different day. */
export function loadDay(puzzleNumber) {
  const day = read(KEYS.day, null);
  return day && day.puzzle === puzzleNumber ? day : null;
}

export function saveDay(day) {
  write(KEYS.day, day);
}

export function hasSeenHelp() {
  return read(KEYS.seenHelp, false);
}

export function markHelpSeen() {
  write(KEYS.seenHelp, true);
}
