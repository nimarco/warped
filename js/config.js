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

// What each peek removes from the track's points, in order. The music video
// usually shows the artist, so it costs much more than the blurry cover:
// both peeks on try 1 leave 25% (63 points), less than an honest try 4 (100).
// The costs are also written out in index.html (peek buttons and help).
export const PEEK_COSTS = [0.25, 0.5];

export const MAX_PEEKS = PEEK_COSTS.length;

export const TRACKS_PER_DAY = 4;

// Puzzle #1 is this date (local time). Month is 0-based.
export const LAUNCH_DATE = new Date(2026, 10, 2);

// Search box waits this long after typing stops before asking iTunes.
export const SEARCH_DEBOUNCE_MS = 300;

// How many songs the search box lists at once.
export const MAX_SUGGESTIONS = 8;

// Give up on an iTunes request after this long.
export const REQUEST_TIMEOUT_MS = 8000;

// iTunes turns requests away for a few seconds when too many come from one
// network (like a campus Wi-Fi). Wait this long before trying again (Apple
// asks for about 12 seconds), and give up after this many retries.
export const BUSY_RETRY_MS = 12000;
export const BUSY_RETRIES = 3;
