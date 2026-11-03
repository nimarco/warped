/*
 * config.js
 * Every tunable number in the game lives here, so balancing the game
 * never means hunting through logic code.
 */

// The four distortion layers, in the order they are removed.
// Each wrong guess or skip peels off the first remaining layer.
export const LAYER_ORDER = ["reversed", "static", "warble", "muffled"];

export const LAYER_LABELS = {
  reversed: "Reversed",
  static: "Static",
  warble: "Warble",
  muffled: "Muffled",
};

// How strong each layer is, from 0 (barely there) to 1 (maximum).
// warp.js turns these into actual audio settings.
export const LAYER_INTENSITY = {
  static: 0.6,
  warble: 0.55,
  muffled: 0.6,
};

// Later tracks in the day get stronger distortion.
// The layer intensity is multiplied by this value (capped at 1).
export const TIER_MULTIPLIER = {
  1: 0.75,
  2: 0.9,
  3: 1,
  4: 1.15,
};

export const TIER_NAMES = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
  4: "Expert",
};

// Audio clip length in seconds of song time.
export const CLIP_SECONDS = 10;

// Points for a correct guess on try 1, 2, 3, 4, 5.
export const POINTS_BY_TRY = [250, 200, 150, 100, 50];

export const MAX_TRIES = POINTS_BY_TRY.length;

// Each peek removes this fraction of the track's points.
export const PEEK_COST = 0.25;

export const MAX_PEEKS = 2;

export const TRACKS_PER_DAY = 4;

// Puzzle #1 is this date (local time). Month is 0-based.
export const LAUNCH_DATE = new Date(2026, 10, 2);

// Search box waits this long after typing stops before asking iTunes.
export const SEARCH_DEBOUNCE_MS = 300;

// Give up on an iTunes request after this long.
export const REQUEST_TIMEOUT_MS = 8000;
