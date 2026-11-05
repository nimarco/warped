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
  tape: $("tape"),
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
}

export function renderIntro({ puzzleNumber, dateText, startLabel }) {
  $("intro-number").textContent = `#${puzzleNumber}`;
  $("intro-date").textContent = dateText;
  $("start-label").textContent = startLabel;
}

/* ---------- Daily track progress ---------- */

/**
 * @param {({ status: string, points: number } | undefined)[]} tracks
 * @param {number} currentIndex
 */
export function renderTrackProgress(tracks, currentIndex) {
  const steps = [1, 2, 3, 4].map((tier, index) => {
    const track = tracks[index];
    const step = document.createElement("li");
    step.className = "track-step";

    const name = document.createElement("span");
    name.textContent = TIER_NAMES[tier];
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

    step.append(value, name);
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

// How hard the Warp ripple pulls the cassette at each damage step (SVG displacement).
const WARP_RIPPLE = [20, 12, 7, 3];

/**
 * The cassette on the TV: shows the track's damage and how bad it still is.
 * Hidden once the song is clean. eased: play the "repair" jolt.
 */
export function setTape(distortion, level, eased = false) {
  const tape = elements.tape;
  tape.hidden = !distortion || level === null;
  if (tape.hidden) {
    return;
  }
  tape.dataset.damage = distortion;
  tape.dataset.level = level;
  $("tape-label").textContent = DISTORTIONS[distortion].name;
  $("warp-displace").setAttribute("scale", WARP_RIPPLE[level]);
  if (eased) {
    tape.classList.remove("is-easing");
    // Reading layout restarts the jolt animation when it's already running.
    void tape.offsetWidth;
    tape.classList.add("is-easing");
  }
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

export function setPlaying(isPlaying) {
  elements.tv.classList.toggle("is-playing", isPlaying);
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

  const eyebrow = $("reveal-eyebrow");
  eyebrow.textContent = solved ? "You got it" : "The song was";
  eyebrow.classList.toggle("is-missed", !solved);

  $("reveal-title").textContent = song.title;
  $("reveal-meta").textContent = [song.artist, song.year].filter(Boolean).join(" · ");

  const pointsText = $("reveal-points");
  pointsText.textContent = solved ? `+${points} pts` : "0 pts";
  pointsText.classList.toggle("is-zero", !solved);

  const link = $("store-link");
  link.href = song.storeUrl;
  link.setAttribute("aria-label", `Listen to ${song.title} on Apple Music (opens in a new tab)`);

  elements.nextButton.textContent = nextLabel;
}

export function hideReveal() {
  $("guess-area").hidden = false;
  $("reveal").hidden = true;
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
  $("summary-number").textContent = `#${puzzleNumber}`;
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
