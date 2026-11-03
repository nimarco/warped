/*
 * itunes.js — DATA API: iTunes Search API
 * https://performance-partners.apple.com/search-api
 *
 * Looks up songs (preview audio + album art), powers the guess autocomplete,
 * and finds music video previews for the Peek hint. No API key needed.
 */

import { REQUEST_TIMEOUT_MS } from "./config.js";
import { normalizeTitle, splitArtists } from "./matching.js";

const BASE_URL = "https://itunes.apple.com";

// Words that mark a result as a cover, karaoke or remix rather than the real song.
const JUNK_PATTERN =
  /karaoke|tribute|instrumental|cover|made famous|in the style of|workout|lullaby|lullapop|rockabye|kidz bop|8-bit|remix|sped up|slowed|arrangement|piano|string quartet|vitamin string|orchestra|\(live|- live|live at|live from|live in /i;

const cache = new Map();

/** A friendly error the UI can show directly. */
export class ItunesError extends Error {
  constructor(message) {
    super(message);
    this.name = "ItunesError";
  }
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
  } catch {
    throw new ItunesError("Couldn't reach the music library. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new ItunesError("The music library is busy right now. Give it a few seconds and try again.");
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
    previewUrl: result.previewUrl,
    // iTunes returns 100px art; the same URL pattern serves larger sizes.
    artworkUrl: result.artworkUrl100?.replace("100x100bb", "600x600bb"),
    storeUrl: result.trackViewUrl,
  };
}

/** Look up one song by its iTunes track ID. */
export async function lookupSong(id) {
  const data = await getJson("lookup", { id, entity: "song" });
  const result = data.results.find((item) => item.kind === "song");

  if (!result || !result.previewUrl) {
    throw new ItunesError("This song's preview isn't available right now.");
  }

  return toSong(result);
}

/** Search songs for the guess autocomplete. Skips covers and duplicates. */
export async function searchSongs(term, limit = 8) {
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const data = await getJson("search", { term: trimmed, media: "music", entity: "song", limit: 25 });
  const seen = new Set();
  const songs = [];

  for (const result of data.results) {
    const text = `${result.trackName} ${result.collectionName} ${result.artistName}`;
    if (result.kind !== "song" || JUNK_PATTERN.test(text)) {
      continue;
    }

    // iTunes ranks the original first, so later songs with the same title are usually covers.
    const key = normalizeTitle(result.trackName);
    if (!seen.has(key)) {
      seen.add(key);
      songs.push(toSong(result));
    }

    if (songs.length === limit) {
      break;
    }
  }

  return songs;
}

/** Find a music video preview for a song, or null if there isn't one. */
export async function findMusicVideo(title, artist) {
  const data = await getJson("search", { term: `${artist} ${title}`, entity: "musicVideo", limit: 10 });
  const wantedTitle = normalizeTitle(title);
  const mainArtist = splitArtists(artist)[0];
  const match = data.results.find(
    (item) =>
      item.previewUrl &&
      normalizeTitle(item.trackName) === wantedTitle &&
      splitArtists(item.artistName).includes(mainArtist)
  );

  return match ? match.previewUrl : null;
}
