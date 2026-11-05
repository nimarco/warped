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
 * @param {object} guess   a song { title, artist }, or an anime show { show: AniList ID }
 * @param {object} answer  the song, with `anime` (AniList IDs of its show's franchise) for anime songs
 * @returns {"correct" | "artist" | "title" | "wrong"}
 *   artist = right artist, wrong song · title = right song name, wrong artist
 */
export function checkGuess(guess, answer) {
  // A named anime show (Free Play's Anime filter) is right if the song is from
  // that show or another season, movie or spin-off of it.
  if (guess.show) {
    return answer.anime?.includes(guess.show) ? "correct" : "wrong";
  }
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

/** True if two guesses name the same thing: the same show, or the same song (any version). */
export function sameGuess(a, b) {
  if (a.show || b.show) {
    return a.show === b.show;
  }
  return checkGuess(a, b) === "correct";
}

/** Edits to turn one word into another (a swap of two neighbouring letters counts as one). */
function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) {
    rows[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const change = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + change);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

/** A typed word fits a word of the song: the start of it, or the word with a small typo. */
function wordFits(typed, word) {
  if (word.startsWith(typed)) {
    return true;
  }
  const allowed = typed.length >= 8 ? 2 : typed.length >= 4 ? 1 : 0;
  return allowed > 0 && editDistance(typed, word) <= allowed;
}

/**
 * True if a search names this song: at least half the typed words fit its
 * title or artist. iTunes also searches lyrics, so without this, typing the
 * words you hear would find the song without knowing its name.
 */
export function searchNamesSong(typedWords, title, artist) {
  const songWords = toWords(`${title} ${artist}`);
  const fitting = typedWords.filter((typed) => songWords.some((word) => wordFits(typed, word)));
  return fitting.length * 2 >= typedWords.length;
}
