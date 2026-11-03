/*
 * autocomplete.js
 * The guess box. Searches iTunes as you type (after a short pause) and shows
 * a keyboard-friendly list of songs, following the ARIA combobox pattern.
 */

import { SEARCH_DEBOUNCE_MS } from "./config.js";

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

    this.timer = setTimeout(() => this.runSearch(term), SEARCH_DEBOUNCE_MS);
  }

  async runSearch(term) {
    const requestId = ++this.requestId;
    this.renderMessage("Searching…");

    try {
      const songs = await this.search(term);
      // Ignore answers to old searches that arrive after newer ones.
      if (requestId !== this.requestId) {
        return;
      }
      this.songs = songs;
      this.activeIndex = songs.length > 0 ? 0 : -1;
      if (songs.length > 0) {
        this.render();
      } else {
        this.renderMessage("No songs found. Try the artist's name too.");
      }
    } catch (error) {
      if (requestId === this.requestId) {
        this.songs = [];
        this.renderMessage(error.message);
      }
    }
  }

  handleKeydown(event) {
    const isOpen = !this.list.hidden && this.songs.length > 0;

    if (event.key === "ArrowDown" && isOpen) {
      event.preventDefault();
      this.setActive((this.activeIndex + 1) % this.songs.length);
    } else if (event.key === "ArrowUp" && isOpen) {
      event.preventDefault();
      this.setActive((this.activeIndex - 1 + this.songs.length) % this.songs.length);
    } else if (event.key === "Escape") {
      this.close();
    }
  }

  setActive(index) {
    this.activeIndex = index;
    for (const option of this.list.children) {
      const selected = Number(option.dataset.index) === index;
      option.setAttribute("aria-selected", String(selected));
      if (selected) {
        this.input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
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
    this.chosen = null;
    this.close();
  }

  open() {
    this.list.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
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
      artist.textContent = song.artist;
      text.append(title, artist);

      option.append(art, text);
      return option;
    });

    this.list.replaceChildren(...options);
    this.open();
    this.setActive(this.activeIndex);
  }
}
