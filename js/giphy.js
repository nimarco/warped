/*
 * giphy.js — DATA API: GIPHY API
 * https://developers.giphy.com/docs/api/endpoint#search
 *
 * Finds a dancing Rick Astley GIF for the Rickrolled intro and waits until the
 * picture has downloaded, so it's ready when the intro starts. Any failure
 * (no key, offline, rate limit) just means the intro plays without the GIF.
 */

import { GIPHY_API_KEY, GIPHY_QUERY, REQUEST_TIMEOUT_MS } from "./config.js";

// The search runs once per visit; every Rickrolled intro reuses its answer.
let pending = null;

/** A ready-to-show GIF as { url, alt }, or null if there isn't one. */
export function findRickGif() {
  if (!GIPHY_API_KEY) {
    return Promise.resolve(null);
  }
  pending ??= searchGif().catch(() => {
    pending = null; // try again next time
    return null;
  });
  return pending;
}

async function searchGif() {
  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    q: GIPHY_QUERY,
    limit: "10",
    rating: "g",
    lang: "en",
  });
  const response = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GIPHY answered ${response.status}`);
  }
  const { data } = await response.json();
  const gifs = data.map((gif) => gif.images?.fixed_height).filter((image) => image?.url);
  if (gifs.length === 0) {
    return null;
  }
  // A little variety: one of the top few results.
  const image = gifs[Math.floor(Math.random() * Math.min(gifs.length, 5))];
  const url = image.webp || image.url;

  const preload = new Image();
  preload.src = url;
  await preload.decode();
  return { url, alt: "Rick Astley dancing" };
}
