/*
 * anilist.js — DATA API: AniList GraphQL API
 * https://docs.anilist.co
 *
 * In Free Play's Anime filter, the guess box also lists anime shows, so a
 * player can name the show a song is from instead of the song. No API key
 * needed. AniList allows about 30 requests a minute, so this is only used
 * there, and if it can't be reached the guess box still lists songs.
 */

import { REQUEST_TIMEOUT_MS } from "./config.js";

const ENDPOINT = "https://graphql.anilist.co";
const SHOWS_PER_SEARCH = 4;

const SEARCH_QUERY = `query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: ANIME, isAdult: false, sort: [POPULARITY_DESC]) {
      id
      title { english romaji }
      coverImage { medium }
      seasonYear
    }
  }
}`;

const NAME_QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) { title { english romaji } } }`;

const cache = new Map();

async function query(text, variables) {
  const body = JSON.stringify({ query: text, variables });
  if (cache.has(body)) {
    return cache.get(body);
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`AniList answered ${response.status}`);
  }
  const { data } = await response.json();
  cache.set(body, data);
  return data;
}

/** The English name if there is one, else the romaji one ("Shingeki no Kyojin"). */
function nameOf(media) {
  return media.title.english ?? media.title.romaji;
}

/**
 * Shows matching a search, most popular first, in the same shape as a song
 * so the guess box can list both. `show` is the AniList ID.
 */
export async function searchShows(term) {
  const data = await query(SEARCH_QUERY, { search: term.trim(), perPage: SHOWS_PER_SEARCH });
  return data.Page.media.map((media) => ({
    show: media.id,
    title: nameOf(media),
    artist: "Anime",
    // The other name, so typing "shingeki" still narrows to "Attack on Titan".
    aliases: media.title.romaji ?? "",
    year: media.seasonYear,
    artworkUrl: media.coverImage.medium,
  }));
}

/** A show's name, for the reveal ("From Attack on Titan"). Null if AniList can't be reached. */
export async function showName(id) {
  try {
    const data = await query(NAME_QUERY, { id });
    return nameOf(data.Media);
  } catch {
    return null;
  }
}
