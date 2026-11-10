/*
 * daily.js
 * Picks today's songs. Everyone gets the same 4 songs on the same day with
 * no server: the puzzle number seeds a shuffle, so the result is the same
 * on every device.
 */

import {
  DISTORTION_ORDER,
  FALLBACK_DISTORTION,
  FREE_PLAY_SKIPS_DAILY_DAYS,
  FREE_PLAY_ANY_TIER_ODDS,
  FREE_PLAY_TIER_SHARES,
  LAUNCH_DATE,
  RICKROLL_TRACK_ID,
  TRACKS_PER_DAY,
} from "./config.js";
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

/**
 * Which damage each of today's tracks gets: four different kinds, picked and
 * ordered fresh each day (the same for everyone).
 */
export function getDailyDistortions(puzzleNumber) {
  return shuffle(DISTORTION_ORDER, seededRandom(puzzleNumber * 9973 + 17)).slice(0, TRACKS_PER_DAY);
}

/** Rick can't be taped over his own song: that track gets the fallback damage. */
export function distortionForSong(distortion, song) {
  const isRick = song.id === RICKROLL_TRACK_ID || /rick astley/i.test(song.artist ?? "");
  return distortion === "rickroll" && isRick ? FALLBACK_DISTORTION : distortion;
}

/** A random distortion for Free Play's "Mixed" setting. */
export function randomDistortion() {
  return DISTORTION_ORDER[Math.floor(Math.random() * DISTORTION_ORDER.length)];
}

/* ---------- Free Play ---------- */

// Daily's songs plus data/more-songs.js, loaded the first time Free Play opens.
let freePlayPool = null;
let animeFranchises = {};

/**
 * Load the extra Free Play songs. If that file can't load (offline, say),
 * Free Play still works with Daily's songs.
 * @returns {Promise<boolean>} false if only Daily's songs are available
 */
export async function loadFreePlayPool() {
  if (freePlayPool) {
    return freePlayPool.length > SONGS.length;
  }
  try {
    const { MORE_SONGS, ANIME_FRANCHISES } = await import("../data/more-songs.js");
    freePlayPool = [...SONGS, ...MORE_SONGS];
    animeFranchises = ANIME_FRANCHISES ?? {};
    return true;
  } catch {
    freePlayPool = SONGS;
    return false;
  }
}

/**
 * Every AniList ID that counts as naming an anime song's show: the show
 * itself first, then its other seasons, movies and spin-offs. Null if the
 * song isn't from an anime.
 */
export function animeFranchise(showId) {
  if (!showId) {
    return null;
  }
  return [showId, ...(animeFranchises[showId] ?? []).filter((id) => id !== showId)];
}

/**
 * Songs that fit Free Play's filters: a genre key from FREE_PLAY_GENRES, a
 * decade (e.g. 1980) or "all", and a tier (1-4) or "all".
 */
export function freePlaySongs(genre, decade, tier = "all") {
  const songs = genre === "hits" ? SONGS : freePlayPool ?? SONGS;
  const fitting = songs.filter(
    (song) =>
      (genre === "hits" || genre === "all" || song.genres.includes(genre)) &&
      (decade === "all" || Math.floor(song.year / 10) * 10 === Number(decade))
  );
  if (tier === "all") {
    return fitting;
  }
  const tiers = tiersFor(genre, decade, fitting);
  return fitting.filter((song) => tiers.get(song.id) === Number(tier));
}

// Each filter's tiers, worked out once: Map of song ID -> tier.
const tierCache = new Map();

/**
 * Tiers among the songs a filter allows, by how many of them are better known
 * (FREE_PLAY_TIER_SHARES: the best-known 15% are Easy, and so on). Usually
 * that's Last.fm listeners; the Anime filter uses `fame`, which also counts the
 * show's popularity, because Last.fm misses songs fans hear in the show.
 */
function tiersFor(genre, decade, songs) {
  const key = `${genre}|${decade}|${songs.length}`;
  if (!tierCache.has(key)) {
    const known = genre === "anime" ? (song) => song.fame ?? 0 : (song) => song.listeners ?? 0;
    const sorted = [...songs].sort((a, b) => known(b) - known(a));
    const tiers = new Map();
    let ahead = 0;
    sorted.forEach((song, index) => {
      // Songs that are equally well known share a tier.
      if (index > 0 && known(song) !== known(sorted[index - 1])) {
        ahead = index;
      }
      tiers.set(song.id, tierAt(ahead / sorted.length));
    });
    tierCache.set(key, tiers);
  }
  return tierCache.get(key);
}

function tierAt(position) {
  let reached = 0;
  for (const [index, share] of FREE_PLAY_TIER_SHARES.entries()) {
    reached += share;
    if (position < reached) {
      return index + 1;
    }
  }
  return FREE_PLAY_TIER_SHARES.length;
}

/** A Free Play song's tier among the songs its genre and era filters allow. */
export function freePlayTier(song, genre, decade) {
  return tiersFor(genre, decade, freePlaySongs(genre, decade)).get(song.id) ?? FREE_PLAY_TIER_SHARES.length;
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
 * A random Free Play song that fits the filters and isn't in `playedIds`,
 * like drawing from a shuffled deck. Null once every song there has been played.
 * Songs coming up in Daily are left out, unless that would leave nothing.
 * On "Any" difficulty, easier tiers come up more often (FREE_PLAY_ANY_TIER_ODDS).
 */
export function pickFreePlaySong(genre, decade, playedIds, tier = "all") {
  const reserved = upcomingDailyIds();
  const songs = freePlaySongs(genre, decade, tier);
  const unreserved = songs.filter((song) => !reserved.has(song.id));
  const fresh = (unreserved.length > 0 ? unreserved : songs).filter((song) => !playedIds.has(song.id));
  if (fresh.length === 0) {
    return null;
  }
  return tier === "all" ? pickByTierOdds(fresh, tiersFor(genre, decade, songs)) : randomItem(fresh);
}

/** Deal a tier by FREE_PLAY_ANY_TIER_ODDS (among tiers with songs left), then a song from it. */
function pickByTierOdds(songs, tiers) {
  const byTier = new Map();
  for (const song of songs) {
    const tier = tiers.get(song.id) ?? FREE_PLAY_TIER_SHARES.length;
    byTier.set(tier, [...(byTier.get(tier) ?? []), song]);
  }
  const odds = [...byTier.keys()].map((tier) => [tier, FREE_PLAY_ANY_TIER_ODDS[tier - 1] ?? 0]);
  let roll = Math.random() * odds.reduce((sum, [, odd]) => sum + odd, 0);
  for (const [tier, odd] of odds) {
    roll -= odd;
    if (roll < 0) {
      return randomItem(byTier.get(tier));
    }
  }
  return randomItem(songs);
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

// A filter option needs at least this many songs to be offered.
const MIN_SONGS_PER_OPTION = 5;

/** How many songs each genre has, for the genre filter. Genres with too few are left out. */
export function genreCounts(genres) {
  return genres
    .map((genre) => [genre, freePlaySongs(genre, "all").length])
    .filter(([, count]) => count >= MIN_SONGS_PER_OPTION);
}

/** Decades with at least a few songs in a genre, for the era filter. */
export function availableDecades(genre) {
  const counts = new Map();
  for (const song of freePlaySongs(genre, "all")) {
    const decade = Math.floor(song.year / 10) * 10;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_SONGS_PER_OPTION)
    .map(([decade]) => decade)
    .sort((a, b) => a - b);
}
