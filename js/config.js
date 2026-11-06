/*
 * config.js
 * Every tunable number in the game lives here, so balancing the game
 * never means hunting through logic code.
 */

// The kinds of tape damage. Each day uses four of them, one per track, and
// every wrong guess or skip turns it down one step: try 1 uses levels[0],
// try 4 uses levels[3], and try 5 is the clean song.
// `value` is the setting warp.js uses; `label` is what the screen shows.
export const DISTORTIONS = {
  fastforward: {
    name: "Fast-forward",
    osd: "▶▶ FF",
    emoji: "⏩",
    about: "too fast and too high, slowing down each try",
    // Playback speed. Higher pitch hides who's singing until it slows down.
    levels: [
      { value: 2.5, label: "2.5×" },
      { value: 2, label: "2×" },
      { value: 1.6, label: "1.6×" },
      { value: 1.3, label: "1.3×" },
    ],
  },
  rewind: {
    name: "Rewind",
    osd: "◀◀ REW",
    emoji: "⏪",
    about: "chopped into pieces that play backwards, smaller each try",
    // Seconds per backwards piece. A whole clip (10) is simply reversed.
    levels: [
      { value: 10, label: "Backwards" },
      { value: 1, label: "1 s chops" },
      { value: 0.25, label: "¼ s chops" },
      { value: 0.06, label: "Tiny chops" },
    ],
  },
  rickroll: {
    name: "Rickrolled",
    osd: "● REC",
    emoji: "🕺",
    about: "someone taped Never Gonna Give You Up over it, and it fades each try",
    // Rick's loudness compared with the song's (1 = equally loud). Labels show it as a %.
    levels: [
      { value: 1.6, label: "160%" },
      { value: 1, label: "100%" },
      { value: 0.55, label: "55%" },
      { value: 0.25, label: "25%" },
    ],
  },
  chewed: {
    name: "Chewed",
    osd: "▒ CHEWED",
    emoji: "🐕",
    about: "a dog got to the tape, and each try patches a few holes",
    // Share of the clip left intact. Patches never move: what you heard stays.
    levels: [
      { value: 0.05, label: "Shredded" },
      { value: 0.25, label: "Mauled" },
      { value: 0.5, label: "Bitten" },
      { value: 0.75, label: "Nibbled" },
    ],
  },
  warp: {
    name: "Warp",
    osd: "∿ WARP",
    emoji: "🌀",
    about: "the pitch cracks up and down like a breaking voice, steadier each try",
    // value: biggest pitch jump in semitones (12 = an octave).
    // chunk: about how many seconds between cracks (shorter = more often).
    levels: [
      { value: 9, chunk: 0.14, label: "±9 notes" },
      { value: 6, chunk: 0.2, label: "±6" },
      { value: 3.5, chunk: 0.3, label: "±3.5" },
      { value: 1.5, chunk: 0.45, label: "±1.5" },
    ],
  },
  muffled: {
    name: "Muffled",
    osd: "◖ MUFFLED",
    emoji: "🧱",
    about: "heard through a wall on a crackly, crunchy tape, clearer each try",
    // value: low-pass cutoff in Hz (the wall). static: how loud the static is
    // next to the song (1 = equally loud); it also sets how crunchy the tape is.
    levels: [
      { value: 150, static: 0.9, label: "Next door" },
      { value: 350, static: 0.55, label: "Thick wall" },
      { value: 800, static: 0.28, label: "Thin wall" },
      { value: 1800, static: 0.08, label: "Pillow" },
    ],
  },
};

export const DISTORTION_ORDER = Object.keys(DISTORTIONS);

// The Rick Roll's iTunes track ID, for the "rickroll" distortion. If the
// answer is Rick Astley himself, that track uses FALLBACK_DISTORTION instead.
export const RICKROLL_TRACK_ID = 1559885421;
export const FALLBACK_DISTORTION = "muffled";

export const TIER_NAMES = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
  4: "Expert",
};

// Audio clip length in seconds of song time.
export const CLIP_SECONDS = 10;

// Every clip plays at this loudness (RMS, 0–1), whatever the song's mastering:
// the loudest 10 s of iTunes previews measured 0.07–0.48 (2026-11-05), with
// 2000s+ hits at 0.33–0.48. 0.15 was still too loud (user, 2026-11-05), so 30% lower.
// Added static or Rick count toward it, so damaged clips aren't louder either.
export const CLIP_LOUDNESS = 0.105;
// A quiet song is raised at most this much (more would mostly raise its hiss).
export const MAX_CLIP_BOOST = 2;

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

// Free Play leaves out the songs Daily will play in this many days, so it can't spoil them.
export const FREE_PLAY_SKIPS_DAILY_DAYS = 60;

// Free Play rates a song against the songs its filters allow, by Last.fm
// listeners: the best-known 15% are Easy, the next 35% Medium, then 30% Hard
// and the last 20% Expert. So the Anime filter's best-known openings are Easy
// even though a mid-level pop song has more listeners overall. (The Anime
// filter ranks by `fame` in more-songs.js instead of listeners.)
export const FREE_PLAY_TIER_SHARES = [0.15, 0.35, 0.3, 0.2];

// Free Play's song filter. "hits" is Daily's song list (Billboard top 40),
// "all" adds every extra song, and the rest are genres.
export const FREE_PLAY_GENRES = {
  hits: "Top 40 hits",
  all: "Everything",
  pop: "Pop",
  rock: "Rock",
  country: "Country",
  rnb: "R&B and soul",
  hiphop: "Hip-hop",
  alternative: "Alternative",
  latin: "Latin",
  kpop: "K-pop",
  anime: "Anime",
  dance: "Dance",
  soundtrack: "Soundtracks",
};

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

// The intro card that names a track's damage before it plays, in milliseconds.
// Rickrolled runs longer so Rick gets to dance before the title drops.
export const CUTSCENE_MS = 2200;
export const CUTSCENE_GIF_MS = 2800;

// The dancing Rick in the Rickrolled intro. If it hasn't loaded after
// RICK_GIF_WAIT_MS, the intro starts with just the title.
export const RICK_GIF = "assets/rick-dance.gif";
export const RICK_GIF_WAIT_MS = 2500;
