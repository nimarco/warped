/*
 * ui.js
 * Everything that changes the page. These functions only display what
 * they're given; the game decisions happen in game.js and main.js.
 */

import { DISTORTION_ORDER, DISTORTIONS, FREE_PLAY_GENRES, MAX_TRIES, TIER_NAMES } from "./config.js";

const $ = (id) => document.getElementById(id);

/** The revealed album cover. Created here because an <img> needs a real src to be valid HTML. */
function createRevealArt() {
  const image = document.createElement("img");
  image.className = "tv-picture";
  image.id = "reveal-art";
  image.alt = "";
  image.hidden = true;
  document.querySelector(".tv-glass").before(image);
  return image;
}

export const elements = {
  modeButtons: document.querySelectorAll(".mode-button"),
  helpButton: $("help-button"),
  statsButton: $("stats-button"),
  helpDialog: $("help-dialog"),
  statsDialog: $("stats-dialog"),

  introScreen: $("intro-screen"),
  playScreen: $("play-screen"),
  summaryScreen: $("summary-screen"),
  startButton: $("start-button"),

  trackProgress: $("track-progress"),
  freeBar: $("free-bar"),
  genreSelect: $("genre-select"),
  distortionSelect: $("distortion-select"),
  decadeSelect: $("decade-select"),

  tv: $("tv"),
  visualizer: $("visualizer"),
  peekCanvas: $("peek-canvas"),
  peekVideo: $("peek-video"),
  revealArt: createRevealArt(),
  retryButton: $("retry-button"),

  playButton: $("play-button"),
  guessForm: $("guess-form"),
  guessInput: $("guess-input"),
  suggestions: $("suggestions"),
  skipButton: $("skip-button"),
  guessButton: $("guess-button"),
  peekArtButton: $("peek-art-button"),
  peekVideoButton: $("peek-video-button"),

  nextButton: $("next-button"),
  shareButton: $("share-button"),
  freePlayButton: $("free-play-button"),
};

/* ---------- Screens and modes ---------- */

export function showScreen(name) {
  elements.introScreen.hidden = name !== "intro";
  elements.playScreen.hidden = name !== "play";
  elements.summaryScreen.hidden = name !== "summary";
}

export function setMode(mode) {
  for (const button of elements.modeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  elements.trackProgress.hidden = mode !== "daily";
  elements.freeBar.hidden = mode !== "free";
  $("shelf-label").textContent = mode === "daily" ? "Today's tape" : "Free Play mix";
}

/**
 * The room behind the TV: its glow takes the damage's color (null for the
 * default pink), and brightens while a clip plays (see setPlaying).
 */
export function setAmbience(distortion) {
  if (distortion) {
    document.body.dataset.damage = distortion;
  } else {
    delete document.body.dataset.damage;
  }
}

/** "NOV 05 2026", the way a camcorder stamps the date. */
function dateStamp(date) {
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(date.getDate()).padStart(2, "0")} ${date.getFullYear()}`;
}

/** Tape numbers read like a VCR counter: 04, 12, 103. */
function tapeNumber(puzzleNumber) {
  return String(puzzleNumber).padStart(2, "0");
}

export function renderIntro({ puzzleNumber, date, startLabel }) {
  $("intro-number").textContent = tapeNumber(puzzleNumber);
  $("intro-date").textContent = dateStamp(date);
  $("start-label").textContent = startLabel;
}

/* ---------- Daily track progress ---------- */

/**
 * Today's four tapes. On wide screens they stand on the shelf like cassette
 * spines, each in its damage's color.
 * @param {({ status: string, points: number } | undefined)[]} tracks
 * @param {number} currentIndex
 * @param {string[]} distortions  each track's damage
 */
export function renderTrackProgress(tracks, currentIndex, distortions) {
  const steps = [1, 2, 3, 4].map((tier, index) => {
    const track = tracks[index];
    const step = document.createElement("li");
    step.className = "track-step";
    step.dataset.damage = distortions[index];

    const name = document.createElement("span");
    name.textContent = TIER_NAMES[tier];
    const damage = document.createElement("span");
    damage.className = "track-damage";
    damage.textContent = DISTORTIONS[distortions[index]].osd;
    const value = document.createElement("strong");

    if (track?.status === "solved") {
      step.classList.add("is-solved");
      value.textContent = `+${track.points}`;
    } else if (track?.status === "missed") {
      step.classList.add("is-missed");
      value.textContent = "0";
    } else {
      value.textContent = `0${index + 1}`;
    }

    if (index === currentIndex) {
      step.classList.add("is-current");
      step.setAttribute("aria-current", "step");
    }

    step.append(value, name, damage);
    return step;
  });
  elements.trackProgress.replaceChildren(...steps);
}

/** Replace a <select>'s options with [value, label] pairs. */
function fillSelect(select, options, selected) {
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === selected;
      return option;
    })
  );
}

/** @param {[string, number][]} counts  genre key and how many songs it has */
export function renderGenres(counts, selected) {
  const options = counts.map(([genre, count]) => [genre, `${FREE_PLAY_GENRES[genre]} (${count.toLocaleString()})`]);
  fillSelect(elements.genreSelect, options, selected);
}

export function renderDistortionChoices(selected) {
  const options = [["mixed", "Mixed"], ...DISTORTION_ORDER.map((key) => [key, DISTORTIONS[key].name])];
  fillSelect(elements.distortionSelect, options, selected);
}

export function renderDecades(decades, selected) {
  const options = [["all", "All eras"], ...decades.map((decade) => [String(decade), `${decade}s`])];
  fillSelect(elements.decadeSelect, options, selected);
}

export function renderFreeScore(score, count) {
  $("free-score").textContent = score;
  $("free-count").textContent = `${count} ${count === 1 ? "song" : "songs"}`;
}

/* ---------- The TV ---------- */

export function setOsdTrack(text) {
  $("osd-track").textContent = text;
}

/**
 * state: "stop" | "play" (the clean song) | "damaged" (shows `label`, like "▶▶ FF")
 */
export function setOsdState(state, label = "") {
  const osd = $("osd-state");
  const labels = { stop: "STOP ■", play: "PLAY ▶", damaged: label };
  osd.textContent = labels[state];
  osd.classList.toggle("is-playing", state === "play");
  osd.classList.toggle("is-rewinding", state === "damaged");
}

export function setOsdTime(seconds) {
  const whole = Math.floor(seconds);
  $("osd-time").textContent = `0:${String(whole).padStart(2, "0")}`;
}

export function setProgress(fraction) {
  $("progress-fill").style.transform = `scaleX(${fraction})`;
}

/** Show a message over the TV. Pass null to hide it. */
export function setTvStatus(status) {
  const panel = $("tv-status");
  if (!status) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.classList.toggle("is-loading", Boolean(status.loading));
  $("tv-status-text").textContent = status.text;
  elements.retryButton.hidden = !status.retry;
}

/* ---------- The damage intro ---------- */

let cutscene = null;

/**
 * Play the short intro that names a track's damage. gif: { url, alt } shows
 * the dancing Rick (Rickrolled). Resolves when it ends, or early when the
 * player clicks it or stopCutscene() is called.
 */
export function playCutscene(distortion, { gif = null, duration = 2200 } = {}) {
  stopCutscene();
  const panel = $("cutscene");
  const { name, osd, about } = DISTORTIONS[distortion];
  panel.dataset.damage = distortion;
  panel.classList.remove("is-leaving");
  panel.classList.toggle("has-gif", Boolean(gif));
  // The tape deck symbol (▶▶, ◀◀, ●…) from the OSD label.
  $("cutscene-osd").textContent = `${osd.split(" ")[0]} TAPE DAMAGE`;
  $("cutscene-about").textContent = about[0].toUpperCase() + about.slice(1);

  // One span per letter, so Warp can knock each to its own pitch.
  const title = $("cutscene-title");
  const letters = [...name].map((character, index) => {
    const letter = document.createElement("span");
    letter.className = "letter";
    letter.setAttribute("aria-hidden", "true");
    letter.style.setProperty("--i", index);
    letter.textContent = character;
    return letter;
  });
  const spoken = document.createElement("span");
  spoken.className = "visually-hidden";
  spoken.textContent = `${name}: ${about}`;
  title.replaceChildren(spoken, ...letters);

  const figure = $("cutscene-gif");
  figure.hidden = !gif;
  figure.replaceChildren();
  if (gif) {
    const image = document.createElement("img");
    image.src = gif.url;
    image.alt = gif.alt;
    figure.prepend(image);
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    duration = Math.min(duration, 1400);
  }
  panel.hidden = false;

  return new Promise((resolve) => {
    const leaveTimer = setTimeout(() => panel.classList.add("is-leaving"), duration - 300);
    const endTimer = setTimeout(finish, duration);
    function finish() {
      clearTimeout(leaveTimer);
      clearTimeout(endTimer);
      panel.removeEventListener("click", finish);
      panel.hidden = true;
      cutscene = null;
      resolve();
    }
    panel.addEventListener("click", finish);
    cutscene = finish;
  });
}

/** End the intro now, if one is playing. */
export function stopCutscene() {
  cutscene?.();
}

/** What the TV shows: "visualizer", "peek" (pixelated cover), "video" or "art". */
export function showPicture(kind, art) {
  elements.visualizer.hidden = kind !== "visualizer";
  elements.peekCanvas.hidden = kind !== "peek";
  elements.peekVideo.hidden = kind !== "video";
  elements.revealArt.hidden = kind !== "art";

  if (kind !== "video") {
    elements.peekVideo.pause();
  }
  if (kind === "art" && art) {
    elements.revealArt.src = art.url;
    elements.revealArt.alt = art.alt;
  }
}

/* ---------- Controls ---------- */

/** The antennas twitch, as if someone's fiddling for a better signal (after a miss). */
export function twitchAntenna() {
  const antenna = $("antenna");
  antenna.classList.remove("is-twitching");
  void antenna.offsetWidth; // restart the animation
  antenna.classList.add("is-twitching");
  // Then hand the antennas back to the playing wiggle (only once the twitch itself ends).
  const done = (event) => {
    if (event.animationName === "antenna-twitch") {
      antenna.classList.remove("is-twitching");
      antenna.removeEventListener("animationend", done);
    }
  };
  antenna.addEventListener("animationend", done);
}

export function setPlaying(isPlaying) {
  elements.tv.classList.toggle("is-playing", isPlaying);
  document.body.classList.toggle("is-playing", isPlaying);
  elements.playButton.classList.toggle("is-playing", isPlaying);
  elements.playButton.classList.remove("is-inviting");
  elements.playButton.setAttribute("aria-label", isPlaying ? "Stop the clip" : "Play the clip");
}

export function setPlayEnabled(enabled, invite = false) {
  elements.playButton.disabled = !enabled;
  elements.playButton.classList.toggle("is-inviting", enabled && invite);
}

export function setGuessEnabled(enabled) {
  elements.guessInput.disabled = !enabled;
  elements.guessButton.disabled = !enabled;
  elements.skipButton.disabled = !enabled;
}

export function setWorth(points) {
  $("worth").textContent = points;
}

/**
 * The damage track: the distortion's name, then its four steps, with the
 * steps already eased crossed out. level: the current step (0–3), or null when clean.
 */
export function renderDamage(distortion, level, eased = false) {
  const { name, levels } = DISTORTIONS[distortion];
  const title = document.createElement("li");
  title.className = "chip chip-title";
  title.dataset.layer = distortion;
  title.textContent = name;

  const current = level ?? levels.length;
  const steps = levels.map((step, index) => {
    const chip = document.createElement("li");
    chip.className = "chip chip-step";
    chip.dataset.layer = distortion;
    chip.textContent = step.label;
    if (index < current) {
      chip.classList.add("is-off");
      chip.setAttribute("aria-label", `${step.label} (eased)`);
    }
    if (eased && index === current - 1) {
      chip.classList.add("is-removing");
    }
    if (index === current) {
      chip.setAttribute("aria-current", "step");
    }
    return chip;
  });

  // Try 5 is always the clean song, so "Clean" only appears once it's reached.
  if (level === null) {
    const clean = document.createElement("li");
    clean.className = "chip is-clean";
    clean.textContent = "Clean";
    steps.push(clean);
  }

  $("layers").setAttribute("aria-label", `${name}: ${level === null ? "clean" : levels[level].label}`);
  $("layers").replaceChildren(title, ...steps);
}

/** tone: "wrong" | "partial" | "info" | "" */
export function setMessage(text, tone = "") {
  const message = $("message");
  message.textContent = text;
  message.className = tone ? `message is-${tone}` : "message";
}

const GUESS_STYLES = {
  correct: { className: "is-correct", icon: "✓", note: "" },
  artist: { className: "is-partial", icon: "~", note: "Right artist" },
  title: { className: "is-partial", icon: "~", note: "Right title" },
  wrong: { className: "is-wrong", icon: "✕", note: "" },
  skip: { className: "is-skip", icon: "»", note: "" },
};

/** Five rows: past guesses, then empty slots. */
export function renderGuesses(guesses, animateLast = false) {
  $("tries-label").textContent = `Tries ${guesses.length}/${MAX_TRIES}`;
  const rows = [];
  for (let index = 0; index < MAX_TRIES; index++) {
    const guess = guesses[index];
    const row = document.createElement("li");
    row.className = "guess";

    const icon = document.createElement("span");
    icon.className = "guess-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "guess-text";
    const note = document.createElement("span");
    note.className = "guess-note";

    if (!guess) {
      row.classList.add("is-empty");
      icon.textContent = String(index + 1);
      text.textContent = index === guesses.length ? "Your guess goes here" : "";
    } else {
      const style = GUESS_STYLES[guess.result];
      row.classList.add(style.className);
      icon.textContent = style.icon;
      note.textContent = style.note;
      if (guess.result === "skip") {
        text.textContent = "Skipped";
      } else {
        const artist = document.createElement("span");
        artist.textContent = ` — ${guess.artist}`;
        text.append(guess.title, artist);
      }
      if (animateLast && index === guesses.length - 1) {
        row.classList.add("is-new");
      }
    }

    row.append(icon, text, note);
    rows.push(row);
  }
  $("guesses").replaceChildren(...rows);
}

export function renderPeeks(peeks, canPeek) {
  const artUsed = peeks >= 1;
  const videoUsed = peeks >= 2;
  elements.peekArtButton.disabled = artUsed || !canPeek;
  elements.peekArtButton.classList.toggle("is-used", artUsed);
  elements.peekVideoButton.disabled = !artUsed || videoUsed || !canPeek;
  elements.peekVideoButton.classList.toggle("is-used", videoUsed);
}

/* ---------- Reveal ---------- */

export function showReveal({ solved, song, points, nextLabel }) {
  $("guess-area").hidden = true;
  $("reveal").hidden = false;
  elements.playScreen.classList.add("is-revealed");

  const eyebrow = $("reveal-eyebrow");
  eyebrow.textContent = solved ? "▶ Got it" : "■ The song was";
  eyebrow.classList.toggle("is-missed", !solved);

  $("reveal-title").textContent = song.title;
  $("reveal-show").hidden = true;
  $("reveal-meta").textContent = [song.artist, song.year].filter(Boolean).join(" · ");

  const pointsText = $("reveal-points");
  pointsText.textContent = solved ? `+${points} pts` : "0 pts";
  pointsText.classList.toggle("is-zero", !solved);

  const link = $("store-link");
  link.href = song.storeUrl;
  link.setAttribute("aria-label", `Listen to ${song.title} on Apple Music (opens in a new tab)`);

  elements.nextButton.textContent = nextLabel;

  // On a short window the result card ends below the fold: bring it (and the
  // Next button) into view once the page has settled.
  const reveal = $("reveal");
  setTimeout(() => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reveal.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }, 50);
}

/** The anime an anime song is from, under its artist. */
export function setRevealShow(name) {
  const line = $("reveal-show");
  line.textContent = `From ${name}`;
  line.hidden = false;
}

/** The guess box also takes anime names in Free Play's Anime filter. */
export function setGuessPlaceholder(anime) {
  elements.guessInput.placeholder = anime ? "Search a song, artist or anime…" : "Search a song or artist…";
}

export function hideReveal() {
  $("guess-area").hidden = false;
  $("reveal").hidden = true;
  elements.playScreen.classList.remove("is-revealed");
}

/* ---------- Summary ---------- */

function verdictFor(total) {
  if (total >= 900) return "Perfect pitch. Were you in the studio?";
  if (total >= 700) return "Golden ears. Seriously impressive.";
  if (total >= 500) return "Solid tape. You know your music.";
  if (total >= 300) return "Not bad. The warp got you a few times.";
  if (total > 0) return "Rough tape today. Tomorrow's a new one.";
  return "The warp won today. Shake it off.";
}

/**
 * @param {object} options
 * @param {number} options.puzzleNumber
 * @param {number} options.total
 * @param {number} options.streak
 * @param {{ song: object, status: string, points: number, guesses: object[], peeks: number }[]} options.tracks
 */
export function renderSummary({ puzzleNumber, total, streak, tracks }) {
  $("summary-number").textContent = tapeNumber(puzzleNumber);
  $("summary-verdict").textContent = verdictFor(total);
  $("summary-streak").textContent = streak;
  $("share-fallback").hidden = true;
  countUp($("summary-score"), total);

  const rows = tracks.map((track, index) => {
    const row = document.createElement("li");
    row.className = "summary-track";

    const art = document.createElement("img");
    art.src = track.song.artworkUrl;
    art.alt = `Album cover for ${track.song.title} by ${track.song.artist}`;
    art.width = 56;
    art.height = 56;
    art.loading = "lazy";

    const text = document.createElement("div");
    text.className = "summary-track-text";
    const title = document.createElement("strong");
    title.textContent = track.song.title;
    const artist = document.createElement("span");
    artist.textContent = `${TIER_NAMES[index + 1]} · ${track.song.artist}`;
    text.append(title, artist);

    const score = document.createElement("p");
    score.className = "summary-track-score";
    const detail = document.createElement("small");
    if (track.status === "solved") {
      score.textContent = `+${track.points}`;
      detail.textContent = `try ${track.guesses.length}${track.peeks ? ` · ${track.peeks} peek${track.peeks > 1 ? "s" : ""}` : ""}`;
    } else {
      score.textContent = "0";
      detail.textContent = "missed";
    }
    score.append(detail);

    row.append(art, text, score);
    return row;
  });
  $("summary-tracks").replaceChildren(...rows);
}

/** Animate a number counting up from 0. */
function countUp(element, target) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || target === 0) {
    element.textContent = target;
    return;
  }
  const duration = 900;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(target * eased);
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

export function setCountdown(milliseconds) {
  const totalSeconds = Math.max(Math.floor(milliseconds / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  $("countdown").textContent = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function showShareFallback(text) {
  $("share-fallback").hidden = false;
  const box = $("share-text");
  box.value = text;
  box.focus();
  box.select();
}

/* ---------- Stats ---------- */

export function renderStats(stats, streak, storageWorks) {
  $("stat-played").textContent = stats.gamesPlayed;
  $("stat-average").textContent = stats.gamesPlayed ? Math.round(stats.totalScore / stats.gamesPlayed) : 0;
  $("stat-streak").textContent = streak;
  $("stat-max-streak").textContent = stats.maxStreak;
  $("stats-note").hidden = storageWorks;

  const most = Math.max(...stats.solvedOnTry, 1);
  const rows = stats.solvedOnTry.map((count, index) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.className = "distribution-label";
    const isMissed = index === MAX_TRIES;
    label.textContent = isMissed ? "Missed" : `Try ${index + 1}`;

    const bar = document.createElement("span");
    bar.className = "distribution-bar";
    if (count > 0) {
      bar.classList.add(isMissed ? "is-missed" : "is-solved");
    }
    bar.style.width = `${Math.max((count / most) * 100, 8)}%`;
    bar.textContent = count;

    row.append(label, bar);
    return row;
  });
  $("distribution").replaceChildren(...rows);
}

/* ---------- Toast ---------- */

let toastTimer = null;

export function toast(text) {
  const element = $("toast");
  element.textContent = text;
  element.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 2400);
}

export function showSilentTip(show) {
  $("silent-tip").hidden = !show;
}
