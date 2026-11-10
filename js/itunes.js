/*
 * itunes.js — DATA API: iTunes Search API
 * https://performance-partners.apple.com/search-api
 *
 * Looks up songs (preview audio + album art) and powers the guess
 * autocomplete. No API key needed.
 */

import { REQUEST_TIMEOUT_MS } from "./config.js";
import { normalizeTitle, searchNamesSong, songKey, splitArtists, toWords } from "./matching.js";

const BASE_URL = "https://itunes.apple.com";

// Words that mark a result as a cover, karaoke or remix rather than the real song.
const JUNK_PATTERN =
  /karaoke|tribute|instrumental|cover|made famous|in the style of|workout|lullaby|lullapop|rockabye|kidz bop|8-bit|remix|sped up|slowed|arrangement|piano|string quartet|vitamin string|orchestra|\(live|- live|live at|live from|live in |glee cast|the voice performance|music sessions|country version|postmodern jukebox/i;

const cache = new Map();

// How well known each of the game's songs is (data/song-fame.js), loaded the
// first time the guess box searches. Without it, results keep iTunes' order.
let fame = null;
function loadFame() {
  fame ??= import("../data/song-fame.js").then((module) => module.SONG_FAME).catch(() => ({}));
  return fame;
}

/** A friendly error the UI can show directly. `busy` means trying again soon should work. */
export class ItunesError extends Error {
  constructor(message, { busy = false } = {}) {
    super(message);
    this.name = "ItunesError";
    this.busy = busy;
  }
}

function busyError() {
  return new ItunesError(
    "Couldn't reach the music library. It may be busy, or blocked on this network. Try again in a minute.",
    { busy: true }
  );
}

/** Turn a failed fetch into an error that says what most likely went wrong. */
function requestError(error) {
  if (!navigator.onLine) {
    return new ItunesError("You're offline. Check your connection and try again.");
  }
  if (error.name === "TimeoutError") {
    return new ItunesError("The music library is taking too long to answer. Check your connection and try again.");
  }
  // iTunes allows only so many requests a minute from one network, and a
  // campus Wi-Fi can be a whole class. Its "too many requests" reply has no
  // CORS header, so the browser can't read it and reports a network error
  // instead. Online but unreachable usually means that, so it's worth a retry.
  return busyError();
}

/** Fetch JSON from iTunes with a timeout and a cache. */
async function getJson(path, params) {
  const query = new URLSearchParams({ country: "us", ...params });
  const url = `${BASE_URL}/${path}?${query}`;

  if (cache.has(url)) {
    return cache.get(url);
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw requestError(error);
  }

  if (!response.ok) {
    throw busyError();
  }

  const data = await response.json();
  cache.set(url, data);
  return data;
}

/** Turn a raw iTunes result into the small shape the game uses. */
function toSong(result) {
  return {
    id: result.trackId,
    title: result.trackName,
    artist: result.artistName,
    album: result.collectionName,
    year: result.releaseDate ? new Date(result.releaseDate).getFullYear() : null,
    genre: result.primaryGenreName ?? null,
    previewUrl: result.previewUrl,
    // iTunes returns 100px art; the same URL pattern serves larger sizes.
    artworkUrl: result.artworkUrl100?.replace("100x100bb", "600x600bb"),
    storeUrl: result.trackViewUrl,
  };
}

/**
 * Look up songs by iTunes track ID, all in one request.
 * Songs that are gone from iTunes or have no preview are left out.
 */
export async function lookupSongs(ids) {
  const data = await getJson("lookup", { id: [...new Set(ids)].join(","), entity: "song" });
  return data.results.filter((item) => item.kind === "song" && item.previewUrl).map(toSong);
}

/** Search songs for the guess autocomplete, best matches first. Skips covers, duplicates and songs found only by their lyrics. */
export async function searchSongs(term) {
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const [data, known] = await Promise.all([
    getJson("search", { term: trimmed, media: "music", entity: "song", limit: 50 }),
    loadFame(),
  ]);
  const typedWords = toWords(trimmed);
  const results = data.results.filter(
    (result) =>
      result.kind === "song" &&
      !JUNK_PATTERN.test(`${result.trackName} ${result.collectionName} ${result.artistName}`) &&
      searchNamesSong(typedWords, result.trackName, result.artistName)
  );
  // An artist written only in another script (Japanese, say) cleans up to "", so default to that.
  const firstArtist = (result) => splitArtists(result.artistName)[0] ?? "";
  const artistNames = new Set(results.map(firstArtist));
  const seen = new Map();
  const songs = [];

  for (const result of results) {
    const title = normalizeTitle(result.trackName);
    const artist = firstArtist(result);

    // Knockoffs often put the real artist in the title ("Blinding Lights The Weeknd").
    const namesOtherArtist = [...artistNames].some(
      (name) => name !== artist && name.length > 3 && title.includes(name)
    );
    if (namesOtherArtist) {
      continue;
    }

    // Different songs can share a title ("Stay" by Rihanna and by The Kid LAROI),
    // so a song is a duplicate only if both the title and the artist match.
    const key = `${title}|${artist}`;
    const song = toSong(result);
    if (!seen.has(key)) {
      seen.set(key, song);
      songs.push(song);
    } else if (song.year && song.year < (seen.get(key).year ?? Infinity)) {
      // A hit's other versions are often later compilations: keep the earliest year.
      seen.get(key).year = song.year;
    }
  }

  // iTunes orders by how well the words match, not by popularity, so "Memories"
  // puts a dozen unknown songs before Maroon 5. Songs from the game's pools go
  // first, best known first; the rest keep iTunes' order after them. Pool
  // songs also take the game's own year for them, the same one the answer uses.
  return songs
    .map((song, index) => {
      const [listeners, year] = known[songKey(song.title, song.artist)] ?? [-1, 0];
      return { song: year ? { ...song, year } : song, index, listeners };
    })
    .sort((a, b) => b.listeners - a.listeners || a.index - b.index)
    .map(({ song }) => song);
}
