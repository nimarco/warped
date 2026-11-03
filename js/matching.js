/*
 * matching.js
 * Decides whether a guess is right. The same song has many iTunes IDs
 * (single, album, remaster, deluxe edition), so guesses are compared by
 * cleaned-up title and artist instead of by ID.
 */

/** "Beyoncé" → "Beyonce": split each letter from its accent, then drop the accents. */
function removeAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Lowercase, strip accents, "(Remastered 2011)", "- Single Version", "feat. X" and punctuation. */
export function normalizeTitle(title) {
  return removeAccents(title.toLowerCase())
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/ - .*$/, "")
    .replace(/\bfeat\..*$|\bft\..*$/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Split "Mark Ronson & Bruno Mars feat. X" into ["mark ronson", "bruno mars", "x"]. */
export function splitArtists(artist) {
  return removeAccents(artist.toLowerCase())
    .split(/,|&| and | x | feat\.? | ft\.? | with /)
    .map((name) => name.replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
}

/** Every word in a title or artist: "Don't Stop (Live)" → ["don", "t", "stop", "live"]. */
export function toWords(text) {
  return removeAccents(text.toLowerCase())
    .replace(/&/g, "and")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function sharesArtist(a, b) {
  const first = splitArtists(a);
  const second = splitArtists(b);
  return first.some((name) => second.includes(name));
}

/**
 * Compare a guessed song to the answer.
 * @returns {"correct" | "artist" | "title" | "wrong"}
 *   artist = right artist, wrong song · title = right song name, wrong artist
 */
export function checkGuess(guess, answer) {
  const sameTitle = normalizeTitle(guess.title) === normalizeTitle(answer.title);
  const sameArtist = sharesArtist(guess.artist, answer.artist);

  if (sameTitle && sameArtist) {
    return "correct";
  }
  if (sameArtist) {
    return "artist";
  }
  if (sameTitle) {
    return "title";
  }
  return "wrong";
}
