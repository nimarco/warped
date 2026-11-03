# Warped

**Name the song before it un-warps.**

Warped is a daily song-guessing game. Every day there are four songs, from Easy to Expert. Each one starts out heavily distorted, with four layers stacked on top of each other:

| Layer | What it sounds like |
|---|---|
| Reversed | The clip plays backwards |
| Static | Crunchy, low-quality audio with tape hiss |
| Warble | Slowed down and wobbling, like a melted record |
| Muffled | Like hearing it through a wall |

Every wrong guess or skip peels off one layer, so the song gets clearer. Fewer layers needed means more points: 250 on try 1, down to 50 on the clean song. Stuck? **Peek** at a pixelated album cover (−25% of the track's points), then the music video (another −50%, since it usually shows the artist).

After four songs you get a score out of 1000, a streak, and a spoiler-free emoji result to share. **Free Play** offers unlimited extra songs, with an optional era filter.

## APIs used

| API | Type | What it does in the game | Code |
|---|---|---|---|
| [iTunes Search API](https://performance-partners.apple.com/search-api) | Data | Song previews, album art, music video previews, and the guess autocomplete | `js/itunes.js` |
| [Web Audio API](https://developer.mozilla.org/docs/Web/API/Web_Audio_API) | Browser | The live distortion layers, chorus detection, the visualizer feed and sound effects | `js/warp.js` |
| [Canvas API](https://developer.mozilla.org/docs/Web/API/Canvas_API) | Browser | The pixelated cover hint and the glitching TV visualizer | `js/peek.js`, `js/visualizer.js` |
| [Web Storage API](https://developer.mozilla.org/docs/Web/API/Web_Storage_API) | Browser | Streaks, stats and resuming today's progress after a reload | `js/storage.js` |
| [Clipboard API](https://developer.mozilla.org/docs/Web/API/Clipboard_API) | Browser | Copying the share result | `js/share.js` |

### When something fails

- **A preview is missing or broken:** the game swaps in a backup song from the same tier.
- **iTunes can't be reached:** the game shows a friendly message with a Try again button. It doesn't switch to a backup song, so everyone still gets the same daily songs.
- **Too many players on one network:** iTunes allows only so many requests a minute from one IP address (a campus Wi-Fi can be a whole class), and its "slow down" reply looks like a network error to the browser. If the device is online, the game says the music library is busy and tries again every 12 seconds, up to three times. To stay under the limit, it looks up all of the day's songs in one request and saves them with the day's progress. Typing more of a search narrows the results it already has instead of searching again.
- **Audio is blocked until a click:** the game waits for the Press play button. iPhone players get a tip about the silent switch.
- **Storage is blocked** (private browsing): the game still works, and the stats screen explains that nothing will be saved.
- **Clipboard is blocked:** the result appears in a text box to copy by hand.
- **No music video exists, or it won't load:** the second peek shows the clear album cover instead.

## How it works

- **No backend.** The day's puzzle number seeds a shuffle of the song list, so everyone gets the same four songs.
- **The distortion is live.** `warp.js` downloads the normal 30-second preview, decodes it with Web Audio, and plays it through a chain of effects (a bitcrusher, filtered noise, a slowed source with an LFO on its pitch, and a low-pass filter). Reversed plays a backwards copy of the decoded audio.
- **The clip is the chorus.** The game measures loudness across the preview and plays the loudest 10 seconds.
- **Guesses are matched by cleaned-up title and artist,** because one song has many iTunes IDs (single, album, remaster).
- **The song list stores only iTunes IDs,** so reading the source doesn't spoil answers.

```
index.html        page structure
style.css         all styling (VHS look; colors and fonts are CSS variables)
data/songs.js     curated song pool (iTunes IDs, difficulty tier, year)
js/main.js        starts the app and connects everything
js/config.js      every tunable number (scoring, layer strength, timing)
js/game.js        rules for one track (tries, layers, peeks, points)
js/daily.js       puzzle number and today's songs
js/matching.js    decides if a guess is right
js/autocomplete.js  the search-as-you-type guess box
js/ui.js          updates the page
```

## Running it locally

It uses JavaScript modules, so it needs to be served rather than opened as a file:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

Song previews, artwork and music videos courtesy of Apple Music via the iTunes Search API. Fonts: Archivo and VT323 from Google Fonts.

Built for CSE 2004 (Website #2) with help from Claude Code (Claude Opus 5.5).
