/*
 * autocomplete.js
 * The guess box. Searches iTunes as you type (after a short pause) and shows
 * a keyboard-friendly list of songs (and anime shows, in Free Play's Anime filter), following the ARIA combobox pattern.
 * iTunes allows only so many searches a minute, so typing more words of the
 * same search narrows the songs it already found instead of searching again.
 */

import { BUSY_RETRIES, BUSY_RETRY_MS, MAX_SUGGESTIONS, SEARCH_DEBOUNCE_MS } from "./config.js";
import { namesTitle, toWords } from "./matching.js";

/** True if every typed word is the start of a word in the song's title or artist (or a show's other name). */
function matchesTyping(song, typedWords) {
  const songWords = toWords(`${song.title} ${song.artist} ${song.aliases ?? ""}`);
  return typedWords.every((typed) => songWords.some((word) => word.startsWith(typed)));
}

/**
 * The order to list suggestions in. Songs whose title was typed come first,
 * best known first (the order the search gave them). Songs found only by
 * their artist's name follow from A to Z: listing an artist's biggest hit
 * first would hand over the answer to anyone who knows (or peeked) the artist.
 * Anime shows stay on top.
 */
function orderForTyping(items, typedWords) {
  const shows = items.filter((item) => item.show);
  const songs = items.filter((item) => !item.show);
  const named = songs.filter((song) => namesTitle(typedWords, song.title, song.artist));
  const byArtist = songs
    .filter((song) => !named.includes(song))
    .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  return { ordered: [...shows, ...named, ...byArtist], named: named.length + shows.length, byArtist };
}

/**
 * When only an artist was typed and their songs don't all fit, say why the
 * hit isn't on top: "8 of 31 songs by Outkast, A to Z. Type part of the title."
 * Null when the list needs no explaining.
 */
function artistHint(byArtist, named, shown) {
  if (named > 0 || byArtist.length <= shown) {
    return null;
  }
  const counts = new Map();
  for (const song of byArtist) {
    counts.set(song.artist, (counts.get(song.artist) ?? 0) + 1);
  }
  const [artist] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${shown} of ${byArtist.length} songs by ${artist}, A to Z. Type part of the title to find yours.`;
}

export class Autocomplete {
  /**
   * @param {object} options
   * @param {HTMLInputElement} options.input
   * @param {HTMLUListElement} options.list
   * @param {(term: string) => Promise<object[]>} options.search
   */
  constructor({ input, list, search }) {
    this.input = input;
    this.list = list;
    this.search = search;
    this.songs = [];
    this.hint = null;
    this.found = { term: "", songs: [] };
    this.activeIndex = -1;
    this.chosen = null;
    this.timer = null;
    this.requestId = 0;

    input.addEventListener("input", () => this.handleInput());
    input.addEventListener("keydown", (event) => this.handleKeydown(event));
    input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
    input.addEventListener("focus", () => {
      if (this.songs.length > 0 && !this.chosen) {
        this.open();
      }
    });

    // mousedown (not click) so the choice lands before the input loses focus.
    list.addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-index]");
      if (option) {
        event.preventDefault();
        this.choose(Number(option.dataset.index));
      }
    });
  }

  handleInput() {
    this.chosen = null;
    clearTimeout(this.timer);
    const term = this.input.value;

    if (term.trim().length < 2) {
      this.songs = [];
      this.close();
      return;
    }

    // Typing more of the last search narrows its songs right away, with no new request.
    const known = this.knownSongsFor(term);
    if (known) {
      this.show(known);
      return;
    }

    // The list on screen no longer fits what's typed, so Enter shouldn't pick from it.
    this.setActive(-1);
    this.timer = setTimeout(() => this.runSearch(term), SEARCH_DEBOUNCE_MS);
  }

  /**
   * The last search's songs, if what's typed only adds to that search: all of
   * them for the same words, or the ones that still match when more words are
   * typed. Null means it needs a new search.
   */
  knownSongsFor(term) {
    const searched = toWords(this.found.term).join(" ");
    const typedWords = toWords(term);
    const typed = typedWords.join(" ");

    if (!searched || !typed.startsWith(searched)) {
      return null;
    }
    if (typed === searched) {
      return this.found.songs;
    }
    const narrowed = this.found.songs.filter((song) => matchesTyping(song, typedWords));
    return narrowed.length > 0 ? narrowed : null;
  }

  async runSearch(term, attempt = 1) {
    // A search that finished during the pause may already cover this.
    const known = this.knownSongsFor(term);
    if (known) {
      this.show(known);
      return;
    }

    const requestId = ++this.requestId;
    this.renderMessage("Searching…");

    try {
      const songs = await this.search(term);
      // Ignore answers to old searches that arrive after newer ones.
      if (requestId !== this.requestId) {
        return;
      }
      this.found = { term, songs };
      // The player may have typed more while this search ran.
      const forInput = this.knownSongsFor(this.input.value);
      if (forInput) {
        this.show(forInput);
      }
    } catch (error) {
      if (requestId !== this.requestId) {
        return;
      }
      this.songs = [];
      if (error.busy && attempt <= BUSY_RETRIES) {
        // iTunes is turning this network away for a few seconds. Search again
        // soon; typing anything new cancels this and searches for that instead.
        this.renderMessage("Search is busy. Trying again in a few seconds…");
        this.timer = setTimeout(() => this.runSearch(term, attempt + 1), BUSY_RETRY_MS);
      } else {
        this.renderMessage(error.message);
      }
    }
  }

  /** List the best few songs, or say that nothing matched. */
  show(songs) {
    const { ordered, named, byArtist } = orderForTyping(songs, toWords(this.input.value));
    this.songs = ordered.slice(0, MAX_SUGGESTIONS);
    this.hint = artistHint(byArtist, named, this.songs.length);
    this.activeIndex = this.songs.length > 0 ? 0 : -1;
    if (this.songs.length > 0) {
      this.render();
    } else {
      this.renderMessage("No songs found. Try the artist's name too.");
    }
  }

  handleKeydown(event) {
    const isOpen = !this.list.hidden && this.songs.length > 0;

    if (event.key === "ArrowDown" && isOpen) {
      event.preventDefault();
      this.setActive((this.activeIndex + 1) % this.songs.length);
    } else if (event.key === "ArrowUp" && isOpen) {
      event.preventDefault();
      this.setActive(this.activeIndex <= 0 ? this.songs.length - 1 : this.activeIndex - 1);
    } else if (event.key === "Escape") {
      this.close();
    }
  }

  setActive(index) {
    this.activeIndex = index;
    this.input.removeAttribute("aria-activedescendant");
    for (const option of this.list.querySelectorAll("[role=option]")) {
      const selected = Number(option.dataset.index) === index;
      option.setAttribute("aria-selected", String(selected));
      if (selected) {
        this.input.setAttribute("aria-activedescendant", option.id);
        this.keepInList(option);
      }
    }
  }

  choose(index) {
    const song = this.songs[index];
    if (!song) {
      return;
    }
    this.chosen = song;
    this.input.value = `${song.title} — ${song.artist}`;
    this.close();
  }

  /** The song to guess: the one picked from the list, or else the highlighted one. */
  getChoice() {
    if (this.chosen) {
      return this.chosen;
    }
    return this.songs[this.activeIndex] ?? null;
  }

  /** For Enter pressed before results arrive: search right away, then return the best match. */
  async resolveChoice() {
    const existing = this.getChoice();
    if (existing || this.input.value.trim().length < 2) {
      return existing;
    }
    clearTimeout(this.timer);
    await this.runSearch(this.input.value);
    return this.getChoice();
  }

  clear() {
    clearTimeout(this.timer);
    this.requestId++;
    this.input.value = "";
    this.songs = [];
    this.found = { term: "", songs: [] };
    this.chosen = null;
    this.close();
  }

  /** Scroll the list (never the page) so the highlighted song is visible. */
  keepInList(option) {
    const { list } = this;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }

  open() {
    this.list.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
    // Near the bottom of the window (the guess box under the TV on a laptop,
    // or above a phone's keyboard), open upward over the set instead.
    const box = this.input.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    this.list.classList.toggle("opens-up", below < 260 && box.top > below);
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
  }

  renderMessage(text) {
    const item = document.createElement("li");
    item.className = "suggestion-message";
    item.textContent = text;
    this.list.replaceChildren(item);
    this.open();
  }

  render() {
    const options = this.songs.map((song, index) => {
      const option = document.createElement("li");
      option.id = `suggestion-${index}`;
      option.className = "suggestion";
      option.setAttribute("role", "option");
      option.dataset.index = index;

      const art = document.createElement("img");
      art.src = song.artworkUrl.replace("600x600bb", "100x100bb");
      art.alt = "";
      art.width = 40;
      art.height = 40;

      const text = document.createElement("span");
      text.className = "suggestion-text";
      const title = document.createElement("strong");
      title.textContent = song.title;
      const artist = document.createElement("span");
      artist.textContent = song.year ? `${song.artist} · ${song.year}` : song.artist;
      text.append(title, artist);

      option.append(art, text);
      return option;
    });

    if (this.hint) {
      const hint = document.createElement("li");
      hint.className = "suggestion-message suggestion-hint";
      hint.textContent = this.hint;
      options.push(hint);
    }
    this.list.replaceChildren(...options);
    this.open();
    this.setActive(this.activeIndex);
  }
}
