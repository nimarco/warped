/*
 * main.js
 * Starts the app and connects the pieces: the iTunes data, the audio engine,
 * the game rules, storage and the page. Handles both Daily and Free Play.
 */

import { LAYER_LABELS, LAYER_ORDER, MAX_TRIES, TIER_NAMES, TRACKS_PER_DAY } from "./config.js";
import { SONGS } from "../data/songs.js";
import { Autocomplete } from "./autocomplete.js";
import { availableDecades, getDailyLineup, getPuzzleNumber, msUntilNextPuzzle, pickFreePlaySong } from "./daily.js";
import { intensityForTier, TrackRound } from "./game.js";
import { findMusicVideo, lookupSong, searchSongs } from "./itunes.js";
import { drawPixelated } from "./peek.js";
import { buildShareText, copyText } from "./share.js";
import {
  displayedStreak,
  hasSeenHelp,
  loadDay,
  loadStats,
  markHelpSeen,
  recordDailyResult,
  saveDay,
  storageAvailable,
} from "./storage.js";
import * as ui from "./ui.js";
import { Visualizer } from "./visualizer.js";
import { audioUnlocked, playBlip, unlockAudio, WarpPlayer } from "./warp.js";

const { elements } = ui;

const puzzleNumber = getPuzzleNumber();
const lineup = getDailyLineup(puzzleNumber);
const player = new WarpPlayer();
const visualizer = new Visualizer(elements.visualizer);
const autocomplete = new Autocomplete({
  input: elements.guessInput,
  list: elements.suggestions,
  search: searchSongs,
});

const app = {
  mode: "daily",
  round: null,
  clipStart: 0,
  loadId: 0,
  progressFrame: null,
  countdownTimer: null,
  day: loadDay(puzzleNumber) ?? { puzzle: puzzleNumber, current: 0, tracks: [], finished: false },
  free: { decade: "all", score: 0, count: 0, played: new Set() },
};

/* ---------- Loading a track ---------- */

/** Look up a song and download its audio. Tries backups if one fails. */
async function loadSong(candidates) {
  let lastError = null;
  for (const entry of candidates) {
    try {
      const song = await lookupSong(entry.id);
      await player.load(song.previewUrl);
      // The catalog's release year is the original one; iTunes may list a later re-release.
      return { ...song, year: entry.year, tier: entry.tier };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Couldn't load a song.");
}

/** Get a track ready to play: restore its progress, reset the screen. */
async function startTrack(candidates, tier, saved) {
  const loadId = ++app.loadId;
  stopClip();
  autocomplete.clear();
  ui.hideReveal();
  ui.showPicture("visualizer");
  ui.setPlayEnabled(false);
  ui.setGuessEnabled(false);
  ui.setMessage("");
  ui.setOsdTrack(trackLabel(tier));
  ui.setTvStatus({ text: "Loading tape…", loading: true });
  ui.renderLayers(LAYER_ORDER);
  ui.renderGuesses(saved?.guesses ?? []);
  ui.renderPeeks(0, false);

  try {
    const song = await loadSong(candidates);
    if (loadId !== app.loadId) {
      return;
    }
    app.round = new TrackRound(song, tier, saved);
    app.clipStart = player.findLoudestStart();
    ui.setTvStatus(null);
    saveProgress();
    renderRound();

    if (app.round.isOver) {
      showReveal(false);
    } else {
      ui.setPlayEnabled(true, true);
      ui.setGuessEnabled(true);
      if (app.round.peeks > 0) {
        restorePeek();
      }
      // Every track is loaded by a click (Press play, Next, Free Play), so the
      // clip can start right away instead of asking for a second click.
      if (audioUnlocked()) {
        playClip();
      }
    }
  } catch (error) {
    if (loadId !== app.loadId) {
      return;
    }
    ui.setTvStatus({ text: error.message, retry: true });
  }
}

function trackLabel(tier) {
  if (app.mode === "free") {
    return `FREE · ${TIER_NAMES[tier].toUpperCase()}`;
  }
  return `TRACK ${app.day.current + 1}/${TRACKS_PER_DAY}`;
}

function loadDailyTrack() {
  const index = app.day.current;
  const saved = app.day.tracks[index];
  // A saved track keeps the exact song it started with (even if it was a backup).
  const candidates = saved ? SONGS.filter((song) => song.id === saved.id).slice(0, 1) : lineup[index];
  ui.renderTrackProgress(app.day.tracks, index);
  startTrack(candidates.length ? candidates : lineup[index], index + 1, saved);
}

function loadFreeTrack() {
  const first = pickFreePlaySong(app.free.decade, app.free.played);
  const backups = [pickFreePlaySong(app.free.decade, app.free.played), pickFreePlaySong("all", app.free.played)];
  startTrack([first, ...backups], first.tier);
}

/* ---------- Rendering the current round ---------- */

function renderRound(justRemoved = null, animateLast = false) {
  const round = app.round;
  ui.renderLayers(round.activeLayers, justRemoved);
  ui.renderGuesses(round.guesses, animateLast);
  ui.renderPeeks(round.peeks, round.canPeek);
  ui.setWorth(round.isOver ? round.points : round.potentialPoints);
  visualizer.setDistortion(round.activeLayers.length);
}

/* ---------- Audio ---------- */

function playClip({ clean = false } = {}) {
  const round = app.round;
  if (!round) {
    return;
  }
  const layers = clean ? [] : round.activeLayers;
  player.play({ layers, intensity: intensityForTier(round.tier), start: app.clipStart });

  visualizer.setAnalyser(player.getAnalyser());
  visualizer.start();
  ui.setPlaying(true);
  ui.setOsdState(layers.includes("reversed") ? "rewind" : "play");
  trackProgress();
}

function stopClip() {
  player.stop();
  visualizer.stop();
  cancelAnimationFrame(app.progressFrame);
  ui.setPlaying(false);
  ui.setOsdState("stop");
  ui.setProgress(0);
  ui.setOsdTime(0);
}

player.onEnded = () => stopClip();

/** Keep the progress bar and timecode in step with the clip. */
function trackProgress() {
  const tick = () => {
    if (!player.playing) {
      return;
    }
    ui.setProgress(player.progress);
    ui.setOsdTime(player.progress * player.playLength);
    app.progressFrame = requestAnimationFrame(tick);
  };
  tick();
}

async function togglePlay() {
  if (!app.round || elements.playButton.disabled) {
    return;
  }
  if (player.playing) {
    stopClip();
    return;
  }
  try {
    await unlockAudio();
    playClip({ clean: app.round.isOver });
  } catch {
    ui.setMessage("Your browser blocked audio. Click play again to allow it.", "wrong");
  }
}

/* ---------- Guessing ---------- */

const RESULT_MESSAGES = {
  wrong: { text: "Not it.", tone: "wrong", blip: "wrong" },
  artist: { text: "Right artist, wrong song!", tone: "partial", blip: "partial" },
  title: { text: "Right title, different artist!", tone: "partial", blip: "partial" },
  skip: { text: "Skipped.", tone: "info", blip: null },
};

async function submitGuess(event) {
  event.preventDefault();
  const round = app.round;
  if (!round || round.isOver) {
    return;
  }

  const song = await autocomplete.resolveChoice();
  if (!song) {
    ui.setMessage("Type a song or artist, then pick from the list.", "info");
    elements.guessInput.focus();
    return;
  }
  if (round.hasGuessed(song)) {
    ui.setMessage(`You already tried "${song.title}". Pick a different one.`, "info");
    return;
  }

  const removedBefore = round.activeLayers[0];
  const result = round.guess(song);
  autocomplete.clear();
  afterTry(result, removedBefore);
}

function skip() {
  const round = app.round;
  if (!round || round.isOver) {
    return;
  }
  const removedBefore = round.activeLayers[0];
  round.skip();
  autocomplete.clear();
  afterTry("skip", removedBefore);
}

/** After any guess or skip: save, give feedback, and either reveal or unwarp. */
function afterTry(result, removedLayer) {
  const round = app.round;
  saveProgress();

  if (result === "correct") {
    playBlip("correct");
    renderRound(null, true);
    showReveal(true);
    return;
  }

  if (round.isOver) {
    playBlip("wrong");
    renderRound(null, true);
    showReveal(true);
    return;
  }

  const feedback = RESULT_MESSAGES[result];
  if (feedback.blip) {
    playBlip(feedback.blip);
  }
  const triesLeft = MAX_TRIES - round.guesses.length;
  const unwarp = round.activeLayers.length === 0
    ? `${LAYER_LABELS[removedLayer]} is off. Last try: this is the real song.`
    : `${LAYER_LABELS[removedLayer]} is off. ${triesLeft} tries left.`;
  ui.setMessage(`${feedback.text} ${unwarp}`, feedback.tone);
  renderRound(removedLayer, true);

  // Play the slightly clearer version right away.
  setTimeout(() => {
    if (app.round === round && !round.isOver) {
      playClip();
    }
  }, 650);
}

/* ---------- Peeks ---------- */

async function peekArt() {
  const round = app.round;
  if (!round?.canPeek || round.peeks >= 1) {
    return;
  }
  round.peek();
  saveProgress();
  renderRound();
  await showPixelatedCover(round);
}

async function showPixelatedCover(round) {
  try {
    await drawPixelated(elements.peekCanvas, round.song.artworkUrl);
    if (app.round === round && !round.isOver) {
      ui.showPicture("peek");
    }
  } catch (error) {
    ui.toast(error.message);
  }
}

async function peekVideo() {
  const round = app.round;
  if (!round?.canPeek || round.peeks !== 1) {
    return;
  }
  round.peek();
  saveProgress();
  renderRound();
  await showVideoOrCover(round);
}

async function showVideoOrCover(round) {
  ui.setTvStatus({ text: "Finding the video…", loading: true });
  let videoUrl = null;
  try {
    videoUrl = await findMusicVideo(round.song.title, round.song.artist);
  } catch {
    videoUrl = null;
  }
  ui.setTvStatus(null);
  if (app.round !== round || round.isOver) {
    return;
  }

  if (videoUrl) {
    elements.peekVideo.src = videoUrl;
    ui.showPicture("video");
    elements.peekVideo.play().catch(() => ui.showPicture("art", coverFor(round.song, true)));
  } else {
    ui.toast("No music video for this one. Here's the clear cover instead.");
    ui.showPicture("art", coverFor(round.song, true));
  }
}

/** After a reload, show whichever peek was already used. */
function restorePeek() {
  const round = app.round;
  if (round.peeks >= 2) {
    showVideoOrCover(round);
  } else {
    showPixelatedCover(round);
  }
}

function coverFor(song, hint = false) {
  // While the track is unsolved, the alt text must not give the answer away.
  const alt = hint ? "Album cover hint" : `Album cover for ${song.title} by ${song.artist}`;
  return { url: song.artworkUrl, alt };
}

/* ---------- Reveal and next ---------- */

function showReveal(playSong) {
  const round = app.round;
  const solved = round.status === "solved";
  ui.setGuessEnabled(false);
  ui.setPlayEnabled(true);
  ui.showPicture("art", coverFor(round.song));
  ui.setMessage("");
  ui.renderLayers([]);
  visualizer.setDistortion(0);

  const isLastDaily = app.mode === "daily" && app.day.current === TRACKS_PER_DAY - 1;
  ui.showReveal({
    solved,
    song: round.song,
    points: round.points,
    nextLabel: app.mode === "free" ? "Next song" : isLastDaily ? "See my results" : "Next track",
  });

  if (app.mode === "daily") {
    ui.renderTrackProgress(app.day.tracks, app.day.current);
  } else if (playSong) {
    app.free.score += round.points;
    app.free.count += 1;
    app.free.played.add(round.song.id);
    ui.renderFreeScore(app.free.score, app.free.count);
  }

  // The payoff: hear the real song.
  if (playSong) {
    playClip({ clean: true });
  }
  elements.nextButton.focus();
}

function next() {
  stopClip();
  if (app.mode === "free") {
    loadFreeTrack();
    return;
  }

  if (app.day.current < TRACKS_PER_DAY - 1) {
    app.day.current += 1;
    saveDay(app.day);
    loadDailyTrack();
  } else {
    finishDay();
  }
}

/* ---------- Daily progress ---------- */

function saveProgress() {
  if (app.mode !== "daily" || !app.round) {
    return;
  }
  const song = app.round.song;
  app.day.tracks[app.day.current] = {
    ...app.round.toJSON(),
    points: app.round.points,
    song: { title: song.title, artist: song.artist, artworkUrl: song.artworkUrl, year: song.year },
  };
  saveDay(app.day);
}

function finishDay() {
  app.day.finished = true;
  saveDay(app.day);
  recordDailyResult(
    puzzleNumber,
    app.day.tracks.map((track) => ({
      points: track.points,
      solvedOnTry: track.status === "solved" ? track.guesses.length : null,
    }))
  );
  showSummary();
}

function dayTotal() {
  return app.day.tracks.reduce((sum, track) => sum + (track?.points ?? 0), 0);
}

function showSummary() {
  stopClip();
  const stats = loadStats();
  ui.renderSummary({
    puzzleNumber,
    total: dayTotal(),
    streak: displayedStreak(stats, puzzleNumber),
    tracks: app.day.tracks,
  });
  ui.showScreen("summary");
  startCountdown();
}

function startCountdown() {
  clearInterval(app.countdownTimer);
  const update = () => {
    const remaining = msUntilNextPuzzle();
    ui.setCountdown(remaining);
    if (remaining <= 1000) {
      clearInterval(app.countdownTimer);
      window.location.reload();
    }
  };
  update();
  app.countdownTimer = setInterval(update, 1000);
}

async function share() {
  const stats = loadStats();
  const text = buildShareText({
    puzzleNumber,
    rounds: app.day.tracks,
    total: dayTotal(),
    streak: displayedStreak(stats, puzzleNumber),
  });
  if (await copyText(text)) {
    ui.toast("Copied! Paste it anywhere.");
  } else {
    ui.showShareFallback(text);
  }
}

/* ---------- Screens and modes ---------- */

function showDailyIntro() {
  const started = app.day.tracks.length > 0;
  ui.renderIntro({
    puzzleNumber,
    dateText: new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" }),
    startLabel: started ? `Resume track ${app.day.current + 1} of ${TRACKS_PER_DAY}` : "Press play",
  });
  ui.showScreen("intro");
}

function enterDaily() {
  app.mode = "daily";
  ui.setMode("daily");
  stopClip();
  app.loadId++;
  if (app.day.finished) {
    showSummary();
  } else {
    showDailyIntro();
  }
}

async function enterFreePlay() {
  app.mode = "free";
  ui.setMode("free");
  clearInterval(app.countdownTimer);
  ui.showScreen("play");
  await unlockAudio().catch(() => {});
  loadFreeTrack();
}

async function startDaily() {
  try {
    await unlockAudio();
  } catch {
    // Audio stays locked until the play button is pressed; the game still loads.
  }
  ui.showScreen("play");
  loadDailyTrack();
}

function retry() {
  if (app.mode === "free") {
    loadFreeTrack();
  } else {
    loadDailyTrack();
  }
}

function openStats() {
  const stats = loadStats();
  ui.renderStats(stats, displayedStreak(stats, puzzleNumber), storageAvailable);
  elements.statsDialog.showModal();
}

/* ---------- Events ---------- */

elements.startButton.addEventListener("click", startDaily);
elements.playButton.addEventListener("click", togglePlay);
elements.guessForm.addEventListener("submit", submitGuess);
elements.skipButton.addEventListener("click", skip);
elements.peekArtButton.addEventListener("click", peekArt);
elements.peekVideoButton.addEventListener("click", peekVideo);
elements.nextButton.addEventListener("click", next);
elements.retryButton.addEventListener("click", retry);
elements.shareButton.addEventListener("click", share);
elements.freePlayButton.addEventListener("click", enterFreePlay);
elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
elements.statsButton.addEventListener("click", openStats);

for (const button of elements.modeButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.mode === app.mode) {
      return;
    }
    if (button.dataset.mode === "free") {
      enterFreePlay();
    } else {
      enterDaily();
    }
  });
}

elements.decadeSelect.addEventListener("change", () => {
  app.free.decade = elements.decadeSelect.value;
  loadFreeTrack();
});

// Space bar plays and stops the clip, unless you're typing or on a button.
document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (event.code !== "Space" || ["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A"].includes(tag)) {
    return;
  }
  if (!elements.playScreen.hidden && document.querySelector("dialog[open]") === null) {
    event.preventDefault();
    togglePlay();
  }
});

// Clicking the dark area around a dialog closes it.
for (const dialog of [elements.helpDialog, elements.statsDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
}

elements.helpDialog.addEventListener("close", markHelpSeen);

/* ---------- Start ---------- */

ui.renderDecades(availableDecades(), app.free.decade);
ui.showSilentTip(/iPhone|iPad|iPod/.test(navigator.userAgent));
enterDaily();

if (!hasSeenHelp()) {
  elements.helpDialog.showModal();
}
