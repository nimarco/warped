/*
 * main.js
 * Starts the app and connects the pieces: the iTunes data, the audio engine,
 * the game rules, storage and the page. Handles both Daily and Free Play.
 */

import {
  BOOT_FONT_WAIT_MS,
  BUSY_RETRIES,
  BUSY_RETRY_MS,
  CUTSCENE_GIF_MS,
  CUTSCENE_MS,
  DISTORTIONS,
  FALLBACK_DISTORTION,
  FREE_PLAY_GENRES,
  MAX_TRIES,
  RICK_GIF,
  RICK_GIF_WAIT_MS,
  RICKROLL_TRACK_ID,
  TIER_NAMES,
  TRACKS_PER_DAY,
} from "./config.js";
import { SONGS } from "../data/songs.js";
import { searchShows, showName } from "./anilist.js";
import { Autocomplete } from "./autocomplete.js";
import {
  animeFranchise,
  availableDecades,
  distortionForSong,
  freePlaySongs,
  freePlayTier,
  genreCounts,
  getDailyDistortions,
  getDailyLineup,
  getPuzzleNumber,
  loadFreePlayPool,
  msUntilNextPuzzle,
  pickFreePlaySong,
  randomDistortion,
} from "./daily.js";
import { TrackRound } from "./game.js";
import { lookupSongs, searchSongs } from "./itunes.js";
import { buildShareText, copyText } from "./share.js";
import {
  displayedStreak,
  hasSeenHelp,
  loadDay,
  loadFreePlayed,
  loadStats,
  markHelpSeen,
  recordDailyResult,
  saveDay,
  saveFreePlayed,
  storageAvailable,
} from "./storage.js";
import * as ui from "./ui.js";
import { Visualizer } from "./visualizer.js";
import { playBlip, unlockAudio, WarpPlayer } from "./warp.js";

const { elements } = ui;

const puzzleNumber = getPuzzleNumber();
const lineup = getDailyLineup(puzzleNumber);
const dailyDistortions = getDailyDistortions(puzzleNumber);
const player = new WarpPlayer();
const visualizer = new Visualizer(elements.visualizer);
const autocomplete = new Autocomplete({
  input: elements.guessInput,
  list: elements.suggestions,
  search: searchGuesses,
});

const app = {
  mode: "daily",
  round: null,
  clipStart: 0,
  loadId: 0,
  progressFrame: null,
  countdownTimer: null,
  day: loadDay(puzzleNumber) ?? { puzzle: puzzleNumber, current: 0, tracks: [], finished: false },
  free: { genre: "hits", decade: "all", tier: "all", distortion: "mixed", score: 0, count: 0, played: loadFreePlayed(), poolReady: null },
};

/* ---------- Loading a track ---------- */

/**
 * iTunes data for a track's songs. Daily mode looks up every track and backup
 * for the day in one request and saves the answer with the day's progress,
 * so later tracks and reloads don't ask iTunes again.
 */
async function lookupCandidates(candidates) {
  if (app.mode === "free") {
    return lookupSongs(candidates.map((entry) => entry.id));
  }
  const known = app.day.songs ?? [];
  if (candidates.some((entry) => known.some((song) => song.id === entry.id))) {
    return known;
  }
  // The Rick Roll rides along in the same request, for the "rickroll" track.
  const ids = [...lineup.flat(), ...candidates].map((entry) => entry.id);
  app.day.songs = await lookupSongs([...ids, RICKROLL_TRACK_ID]);
  saveDay(app.day);
  return app.day.songs;
}

/**
 * Download the first candidate that plays. A backup only replaces a song that
 * is broken (gone from iTunes, no preview, bad audio). If iTunes can't be
 * reached, this fails before trying any backups, so a busy network never
 * gives one player a different daily song than everyone else.
 */
async function loadSong(candidates) {
  const songs = await lookupCandidates(candidates);
  let lastError = new Error("This track isn't available right now.");

  for (const entry of candidates) {
    const song = songs.find((item) => item.id === entry.id);
    if (!song) {
      continue;
    }
    try {
      await player.load(song.previewUrl);
      // The catalog's release year is the original one; iTunes may list a later re-release.
      return { ...song, year: entry.year, tier: entry.tier, anime: animeFranchise(entry.anime) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * The damage a track will actually use. Rick can't be taped over his own song,
 * and if the Rick Roll can't be downloaded, the fallback damage stands in.
 */
async function prepareDistortion(distortion, song) {
  const chosen = distortionForSong(distortion, song);
  if (chosen !== "rickroll" || player.hasOverlay) {
    return chosen;
  }
  try {
    const known = app.day.songs?.find((item) => item.id === RICKROLL_TRACK_ID);
    const rick = known ?? (await lookupSongs([RICKROLL_TRACK_ID]))[0];
    await player.loadOverlay(rick.previewUrl);
    return chosen;
  } catch {
    return FALLBACK_DISTORTION;
  }
}

/** Get a track ready to play: restore its progress, reset the screen. */
async function startTrack(candidates, tier, distortion, saved, attempt = 1) {
  const loadId = ++app.loadId;
  stopClip();
  autocomplete.clear();
  updateGuessReady();
  ui.hideReveal();
  ui.showPicture("visualizer");
  ui.setPlayEnabled(false);
  ui.setGuessEnabled(false);
  ui.setMessage("");
  ui.setOsdTrack(trackLabel(tier));
  ui.setTvStatus({ text: "Loading tape…", loading: true });
  ui.stopCutscene();
  ui.renderDamage(saved?.distortion ?? distortion, 0);
  ui.renderGuesses(saved?.guesses ?? []);
  ui.renderPeeks(0, false);

  try {
    const song = await loadSong(candidates);
    if (loadId !== app.loadId) {
      return;
    }
    // A saved track keeps the damage it started with.
    const damage = await prepareDistortion(saved?.distortion ?? distortion, song);
    if (loadId !== app.loadId) {
      return;
    }
    app.round = new TrackRound(song, tier, damage, saved);
    ui.setAmbience(damage);
    // Start looking for Rick's GIF now; the intro waits a moment for it.
    const gif = damage === "rickroll" ? loadRickGif() : null;
    app.clipStart = player.findLoudestStart();
    ui.setTvStatus(null);
    saveProgress();
    if (app.mode === "free") {
      // A song counts as heard once it plays, even if the player moves on.
      app.free.played.add(song.id);
      saveFreePlayed(app.free.played);
    }
    renderRound();

    if (app.round.isOver) {
      showReveal(false);
    } else {
      await showIntro(app.round, gif);
      if (loadId !== app.loadId) {
        return;
      }
      ui.setPlayEnabled(true, true);
      ui.setGuessEnabled(true);
      // The clip waits for the player to press play.
    }
  } catch (error) {
    if (loadId !== app.loadId) {
      return;
    }
    // iTunes is turning this network away for a few seconds: wait, then try again.
    if (error.busy && attempt <= BUSY_RETRIES) {
      ui.setTvStatus({ text: "The music library is busy. Trying again in a few seconds…", loading: true });
      setTimeout(() => {
        if (loadId === app.loadId) {
          startTrack(candidates, tier, distortion, saved, attempt + 1);
        }
      }, BUSY_RETRY_MS);
      return;
    }
    ui.setTvStatus({ text: error.message, retry: true });
  }
}

let rickGif = null;

/** Download the dancing Rick once, so the intro can show him straight away. Null if it fails. */
function loadRickGif() {
  rickGif ??= (async () => {
    const image = new Image();
    image.src = RICK_GIF;
    await image.decode();
    return { url: RICK_GIF, alt: "Rick Astley dancing" };
  })().catch(() => {
    rickGif = null; // try again next time
    return null;
  });
  return rickGif;
}

/**
 * The intro card naming the track's damage, before every new track (click to
 * skip). A track that already has guesses (reopened later) skips it.
 */
async function showIntro(round, gifSearch) {
  if (round.guesses.length > 0) {
    return;
  }
  const timeout = new Promise((resolve) => setTimeout(resolve, RICK_GIF_WAIT_MS, null));
  const gif = gifSearch ? await Promise.race([gifSearch, timeout]) : null;
  if (app.round !== round) {
    return;
  }
  await ui.playCutscene(round.distortion, { gif, duration: gif ? CUTSCENE_GIF_MS : CUTSCENE_MS });
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
  ui.renderTrackProgress(app.day.tracks, index, dailyDistortions);
  startTrack(candidates.length ? candidates : lineup[index], index + 1, dailyDistortions[index], saved);
}

function loadFreeTrack() {
  const { genre, decade, tier, played } = app.free;
  // A narrow mix can have no songs at one difficulty: fall back to any.
  if (tier !== "all" && freePlaySongs(genre, decade, tier).length === 0) {
    app.free.tier = "all";
    renderFreeFilters();
    ui.toast(`No ${TIER_NAMES[tier]} songs in this mix. Playing any difficulty.`);
    loadFreeTrack();
    return;
  }
  let first = pickFreePlaySong(genre, decade, played, tier);
  if (!first) {
    // Every song that fits the filters has been heard: shuffle that deck again.
    for (const song of freePlaySongs(genre, decade, tier)) {
      played.delete(song.id);
    }
    ui.toast("You've heard every song in this mix. Starting over.");
    // Don't open the new round with the song that just ended.
    first =
      pickFreePlaySong(genre, decade, new Set([...played, app.round?.song.id]), tier) ??
      pickFreePlaySong(genre, decade, played, tier);
  }
  const notFirst = new Set([...played, first.id]);
  const backups = [pickFreePlaySong(genre, decade, notFirst, tier), pickFreePlaySong("hits", "all", notFirst)].filter(Boolean);
  const distortion = app.free.distortion === "mixed" ? randomDistortion() : app.free.distortion;
  startTrack([first, ...backups], freePlayTier(first, genre, decade), distortion);
}

/** Fill the genre and era filters. An era with no songs in the chosen genre goes back to "All eras". */
function renderFreeFilters() {
  const decades = availableDecades(app.free.genre);
  if (app.free.decade !== "all" && !decades.includes(Number(app.free.decade))) {
    app.free.decade = "all";
  }
  ui.renderGenres(genreCounts(Object.keys(FREE_PLAY_GENRES)), app.free.genre);
  ui.renderDistortionChoices(app.free.distortion);
  ui.renderDecades(decades, app.free.decade);
  ui.renderDifficulties(app.free.tier);
}

/* ---------- Rendering the current round ---------- */

function renderRound(eased = false, animateLast = false) {
  const round = app.round;
  ui.renderDamage(round.distortion, round.level, eased);
  ui.renderGuesses(round.guesses, animateLast);
  ui.renderPeeks(round.peeks, round.canPeek, round.isOver ? {} : round.hints);
  ui.setWorth(round.isOver ? round.points : round.potentialPoints);
  visualizer.setDistortion(round.stepsLeft);
}

/* ---------- Audio ---------- */

function playClip({ clean = false } = {}) {
  const round = app.round;
  if (!round) {
    return;
  }
  const damage = clean ? null : round.damage;
  // The song's ID fixes where Chewed and Warp strike, the same for everyone.
  player.play({ damage, start: app.clipStart, seed: round.song.id % 1000003 });

  visualizer.setAnalyser(player.getAnalyser());
  visualizer.start();
  ui.setPlaying(true);
  ui.setOsdState(damage ? "damaged" : "play", damage ? DISTORTIONS[damage.type].osd : "");
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

// A miss is progress: the tape gets cleaner. So it reads calm, not as an error.
const RESULT_MESSAGES = {
  wrong: { text: "Not it.", tone: "miss", blip: "wrong" },
  artist: { text: "Right artist, wrong song!", tone: "partial", blip: "partial" },
  title: { text: "Right title, different artist!", tone: "partial", blip: "partial" },
  skip: { text: "Skipped.", tone: "miss", blip: null },
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
    ui.setMessage(`You already tried "${song.title}" by ${song.artist}. Pick a different one.`, "info");
    return;
  }

  const result = round.guess(song);
  autocomplete.clear();
  updateGuessReady();
  afterTry(result);
}

function skip() {
  const round = app.round;
  if (!round || round.isOver) {
    return;
  }
  round.skip();
  autocomplete.clear();
  updateGuessReady();
  afterTry("skip");
}

/** After any guess or skip: save, give feedback, and either reveal or ease the damage. */
function afterTry(result) {
  const round = app.round;
  saveProgress();

  if (result === "correct") {
    playBlip("correct");
    ui.glitchScreen();
    renderRound(null, true);
    showReveal(true);
    return;
  }

  if (round.isOver) {
    playBlip("wrong");
    ui.glitchScreen();
    renderRound(null, true);
    showReveal(true);
    return;
  }

  const feedback = RESULT_MESSAGES[result];
  ui.twitchAntenna();
  ui.glitchScreen();
  if (feedback.blip) {
    playBlip(feedback.blip);
  }
  const triesLeft = MAX_TRIES - round.guesses.length;
  const progress = round.level === null
    ? "Last try: the tape is clean now."
    : `The tape's a notch cleaner. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`;
  // The clue chips on the guess show the clues; screen readers hear them here too.
  const clues = ui.describeClues(round.guesses.at(-1).clues);
  ui.setMessage(`${feedback.text} ${progress}`, feedback.tone, clues);
  renderRound(true, true);

  // Play the slightly clearer version after a short beat.
  setTimeout(() => {
    if (app.round === round && !round.isOver) {
      playClip();
    }
  }, 650);
}

/* ---------- Peeks ---------- */

function peekTitle() {
  if (app.round?.peeks === 0) {
    usePeek();
  }
}

function peekArtist() {
  if (app.round?.peeks === 1) {
    usePeek();
  }
}

/** Show the next hint on the TV: the title's first letter, then the artist. */
function usePeek() {
  const round = app.round;
  if (!round?.canPeek) {
    return;
  }
  const peek = round.peek();
  saveProgress();
  renderRound();
  const { title, artist } = round.hints;
  ui.setMessage(peek === 1 ? ui.describeTitleHint(title) : `It's by ${artist}.`, "info");
}

/** The album cover, shown only once the track is over, so its alt text can name the song. */
function coverFor(song) {
  return { url: song.artworkUrl, alt: `Album cover for ${song.title} by ${song.artist}` };
}

/* ---------- Guess box ---------- */

const SHOWS_IN_LIST = 3;

/**
 * What the guess box lists: songs from iTunes, plus anime shows from AniList
 * when Free Play's Anime filter is on. If AniList can't be reached, songs only.
 */
async function searchGuesses(term) {
  if (app.mode !== "free" || app.free.genre !== "anime") {
    return searchSongs(term);
  }
  const [songs, shows] = await Promise.all([searchSongs(term), searchShows(term).catch(() => [])]);
  return [...shows.slice(0, SHOWS_IN_LIST), ...songs];
}

/* ---------- Reveal and next ---------- */

function showReveal(playSong) {
  const round = app.round;
  const solved = round.status === "solved";
  ui.setGuessEnabled(false);
  ui.setPlayEnabled(true);
  ui.showPicture("art", coverFor(round.song));
  ui.setMessage("");
  ui.renderDamage(round.distortion, null);
  visualizer.setDistortion(0);

  const isLastDaily = app.mode === "daily" && app.day.current === TRACKS_PER_DAY - 1;
  ui.showReveal({
    solved,
    song: round.song,
    points: round.points,
    nextLabel: app.mode === "free" ? "Next song" : isLastDaily ? "See my results" : "Next track",
  });

  if (app.mode === "daily") {
    ui.renderTrackProgress(app.day.tracks, app.day.current, dailyDistortions);
  } else if (playSong) {
    app.free.score += round.points;
    app.free.count += 1;
    ui.renderFreeScore(app.free.score, app.free.count);
  }

  // Anime songs also name their show ("From Attack on Titan").
  if (round.song.anime) {
    showName(round.song.anime[0]).then((name) => {
      if (app.round === round && name) {
        ui.setRevealShow(name);
      }
    });
  }

  // The payoff: hear the real song.
  if (playSong) {
    playClip({ clean: true });
  }
  // ui.showReveal scrolls the card into view, smoothly.
  elements.nextButton.focus({ preventScroll: true });
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
  ui.setAmbience(null);
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
  ui.setAmbience(null);
  const started = app.day.tracks.length > 0;
  ui.renderIntro({
    puzzleNumber,
    date: new Date(),
    startLabel: started ? `Resume track ${app.day.current + 1} of ${TRACKS_PER_DAY}` : "Press play",
  });
  ui.showScreen("intro");
}

function enterDaily() {
  app.mode = "daily";
  ui.setMode("daily");
  ui.setGuessPlaceholder(false);
  autocomplete.clear();
  updateGuessReady();
  stopClip();
  ui.stopCutscene();
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
  ui.setGuessPlaceholder(app.free.genre === "anime");
  autocomplete.clear();
  updateGuessReady();
  clearInterval(app.countdownTimer);
  ui.showScreen("play");
  await unlockAudio().catch(() => {});
  if (!app.free.poolReady) {
    ui.setTvStatus({ text: "Loading tape…", loading: true });
    app.free.poolReady = loadFreePlayPool().then((complete) => {
      if (!complete) {
        ui.toast("Couldn't load the extra songs. Playing the top 40 hits for now.");
      }
      renderFreeFilters();
    });
  }
  await app.free.poolReady;
  // The player may have gone back to Daily while the songs loaded.
  if (app.mode === "free") {
    loadFreeTrack();
  }
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
elements.peekTitleButton.addEventListener("click", peekTitle);
elements.peekArtistButton.addEventListener("click", peekArtist);
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

elements.genreSelect.addEventListener("change", () => {
  app.free.genre = elements.genreSelect.value;
  ui.setGuessPlaceholder(app.free.genre === "anime");
  autocomplete.clear();
  updateGuessReady();
  renderFreeFilters();
  loadFreeTrack();
});

elements.distortionSelect.addEventListener("change", () => {
  app.free.distortion = elements.distortionSelect.value;
  loadFreeTrack();
});

elements.decadeSelect.addEventListener("change", () => {
  app.free.decade = elements.decadeSelect.value;
  loadFreeTrack();
});

/* ---------- The remote's D-pad (Free Play, wide screens) ---------- */

/** Step a <select> to its previous or next option, wrapping around, as if the player picked it. */
function stepSelect(select, direction) {
  const count = select.options.length;
  select.selectedIndex = (select.selectedIndex + direction + count) % count;
  select.dispatchEvent(new Event("change"));
}

elements.dpad.up.addEventListener("click", () => stepSelect(elements.genreSelect, -1));
elements.dpad.down.addEventListener("click", () => stepSelect(elements.genreSelect, 1));
elements.dpad.left.addEventListener("click", () => stepSelect(elements.decadeSelect, -1));
elements.dpad.right.addEventListener("click", () => stepSelect(elements.decadeSelect, 1));
elements.dpad.ok.addEventListener("click", togglePlay);

// Guess stays dim until there's something to guess, so Play is the one lit button.
function updateGuessReady() {
  elements.guessButton.classList.toggle("is-waiting", elements.guessInput.value.trim().length < 2);
}
elements.guessInput.addEventListener("input", updateGuessReady);

elements.difficultySelect.addEventListener("change", () => {
  app.free.tier = elements.difficultySelect.value;
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

/**
 * Reveal the page (hidden by the "is-booting" class in index.html) once it's
 * built and the fonts it's drawn in have loaded, so a refresh never flashes
 * stand-in fonts. A slow or blocked font server only delays it so long.
 */
function showPageWhenReady() {
  const fonts = ["700 1em Archivo", "1em VT323", '1em "Permanent Marker"'].map((font) =>
    document.fonts.load(font).catch(() => null)
  );
  const timeout = new Promise((resolve) => setTimeout(resolve, BOOT_FONT_WAIT_MS));
  Promise.race([Promise.all(fonts), timeout]).then(() => {
    document.documentElement.classList.remove("is-booting");
  });
}

renderFreeFilters();
ui.showSilentTip(/iPhone|iPad|iPod/.test(navigator.userAgent));
enterDaily();
showPageWhenReady();

if (!hasSeenHelp()) {
  elements.helpDialog.showModal();
}
