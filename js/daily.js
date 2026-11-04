/*
 * daily.js
 * Picks today's songs. Everyone gets the same 4 songs on the same day with
 * no server: the puzzle number seeds a shuffle, so the result is the same
 * on every device.
 */

import { FREE_PLAY_SKIPS_DAILY_DAYS, LAUNCH_DATE, TRACKS_PER_DAY } from "./config.js";
import { SONGS } from "../data/songs.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// How many extra songs to keep in line in case a preview fails to load.
const BACKUPS_PER_TRACK = 3;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Puzzle #1 is launch day. Uses the player's local midnight, like Wordle. */
export function getPuzzleNumber(date = new Date()) {
  // Math.round absorbs the 1-hour shift on daylight saving days.
  const days = Math.round((startOfDay(date) - startOfDay(LAUNCH_DATE)) / DAY_MS);
  return Math.max(days + 1, 1);
}

/** Milliseconds until the next puzzle unlocks at local midnight. */
export function msUntilNextPuzzle(now = new Date()) {
  const tomorrow = startOfDay(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow - now;
}

/** A small, fast random number generator that always gives the same sequence for a seed. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/**
 * Today's lineup: one list per track (tier 1–4). The first song in each list
 * is today's pick; the rest are backups if its preview fails.
 * Songs don't repeat until a tier's whole pool has been used.
 */
export function getDailyLineup(puzzleNumber) {
  const lineup = [];

  for (let tier = 1; tier <= TRACKS_PER_DAY; tier++) {
    const pool = SONGS.filter((song) => song.tier === tier);
    const dayIndex = puzzleNumber - 1;
    const cycle = Math.floor(dayIndex / pool.length);
    const order = shuffle(pool, seededRandom(tier * 7919 + cycle * 104729));
    const position = dayIndex % pool.length;

    const candidates = [];
    for (let offset = 0; offset <= BACKUPS_PER_TRACK; offset++) {
      candidates.push(order[(position + offset) % order.length]);
    }
    lineup.push(candidates);
  }

  return lineup;
}

/** Every song from a decade (e.g. 1980), or all songs for "all". */
export function songsInDecade(decade) {
  return SONGS.filter((song) => decade === "all" || Math.floor(song.year / 10) * 10 === Number(decade));
}

let upcoming = { puzzle: null, ids: new Set() };

/** IDs of the songs Daily will play from today through the next FREE_PLAY_SKIPS_DAILY_DAYS days. */
function upcomingDailyIds() {
  const today = getPuzzleNumber();
  if (upcoming.puzzle !== today) {
    const ids = new Set();
    for (let day = today; day < today + FREE_PLAY_SKIPS_DAILY_DAYS; day++) {
      for (const candidates of getDailyLineup(day)) {
        ids.add(candidates[0].id);
      }
    }
    upcoming = { puzzle: today, ids };
  }
  return upcoming.ids;
}

/**
 * A random Free Play song from a decade that isn't in `playedIds`, like
 * drawing from a shuffled deck. Null once every song there has been played.
 * Songs coming up in Daily are left out, unless that would leave the decade empty.
 */
export function pickFreePlaySong(decade, playedIds) {
  const reserved = upcomingDailyIds();
  const songs = songsInDecade(decade);
  const unreserved = songs.filter((song) => !reserved.has(song.id));
  const fresh = (unreserved.length > 0 ? unreserved : songs).filter((song) => !playedIds.has(song.id));
  return fresh.length > 0 ? fresh[Math.floor(Math.random() * fresh.length)] : null;
}

/** Decades that have at least a few songs, for the Free Play filter. */
export function availableDecades() {
  const counts = new Map();
  for (const song of SONGS) {
    const decade = Math.floor(song.year / 10) * 10;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 5)
    .map(([decade]) => decade)
    .sort((a, b) => a - b);
}
