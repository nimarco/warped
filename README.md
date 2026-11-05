# Warped

**Name the song before it un-warps.**

Warped is a daily song-guessing game. Every day there are four songs, from Easy to Expert, and each one has its own kind of tape damage, four of these six:

| Damage | What it sounds like | How it eases each try |
|---|---|---|
| ⏩ Fast-forward | Too fast and too high: you can't tell who's singing | Slows from 2.5× toward normal speed |
| ⏪ Rewind | Chopped into pieces that play backwards | The pieces get shorter, from the whole clip to tiny chops |
| 🕺 Rickrolled | Someone taped *Never Gonna Give You Up* over it | Rick gets quieter |
| 🐕 Chewed | A dog got to the tape: holes of hiss, stutters and backwards bits | Holes get patched (and stay patched) |
| 🌀 Warp | The pitch cracks up and down in chunks, like a breaking voice | The jumps get smaller |
| 🧱 Muffled | Heard through a wall, on a crunchy tape full of static | The wall gets thinner and the static fades |

Before each track, a two-second intro on the TV names its damage (Rickrolled's has a dancing Rick). Each day picks four of them and puts them in a new order (the same for everyone). Every wrong guess or skip eases the damage one step, and try 5 is the clean song. The sooner you name it, the more you score: 250 on try 1, down to 50 on the clean song. Stuck? **Peek** at a pixelated album cover (−25% of the track's points), then the music video (another −50%, since it usually shows the artist).

After four songs you get a score out of 1000, a streak, and a spoiler-free emoji result to share. **Free Play** offers unlimited extra songs (about 11,000), filtered by genre (country, K-pop, anime, Latin…) and era.

## APIs used

| API | Type | What it does in the game | Code |
|---|---|---|---|
| [iTunes Search API](https://performance-partners.apple.com/search-api) | Data | Song previews, album art, music video previews, and the guess autocomplete | `js/itunes.js` |
| [AniList API](https://docs.anilist.co) | Data | In Free Play's Anime filter, the guess box also lists anime shows, so you can name the show instead of the song | `js/anilist.js` |
| [Web Audio API](https://developer.mozilla.org/docs/Web/API/Web_Audio_API) | Browser | The live tape damage, chorus detection, the visualizer feed and sound effects | `js/warp.js` |
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
- **AniList can't be reached:** the Anime filter's guess box lists songs only, and the reveal leaves out the show's name.
- **The song-fame file won't load:** guess suggestions keep iTunes' order.
- **The Rick GIF won't load:** the Rickrolled intro shows its title alone. It never waits more than 2.5 seconds for it.

## How it works

- **No backend.** The day's puzzle number seeds a shuffle of the song list, so everyone gets the same four songs.
- **The damage is live.** `warp.js` downloads the normal 30-second preview, decodes it with Web Audio, and changes it as it plays: Fast-forward raises the playback rate, Rewind rebuilds the clip from backwards pieces with short crossfades so the cuts don't click, Rickrolled mixes in a second preview at a volume matched to the song's loudness, Chewed swaps fixed patches for hiss, stutters or backwards audio, Warp pitch-shifts chunks without changing their timing (short overlapping grains, each read faster or slower), and Muffled runs it through a low-pass filter and a bitcrusher, then adds static matched to the song's loudness (a filter alone kept the tune too easy to hum).
- **Every try is easier than the last, for every song.** Each track uses one kind of damage and only turns it down, so a later try can never be harder than an earlier one. (Earlier versions stacked four effects and peeled them off, but skipping the hardest one made the song suddenly easy.)
- **Free Play lets you pick the damage**, or mixes them at random.
- **The clip is the chorus.** The game measures loudness across the preview and plays the loudest 10 seconds.
- **Guesses are matched by cleaned-up title and artist,** because one song has many iTunes IDs (single, album, remaster).
- **The hit comes first.** iTunes lists search results by how well the words match, so "Memories" used to bury Maroon 5 under a dozen unknown songs. The guess box now puts the game's songs first, best known first, using listener counts stored under a scrambled key (`data/song-fame.js`) so the file doesn't list any titles.
- **Typing lyrics doesn't work.** iTunes also searches lyrics, so the guess box only lists songs whose title or artist matches at least half the typed words (small typos are fine). Otherwise you could type what you hear without knowing the song.
- **The song list stores only iTunes IDs,** so reading the source doesn't spoil answers.
- **Difficulty is how well known a song is today.** Daily's pool is every clean song from Billboard's Year-End Hot 100 top 40, 1970–2025, plus a few classics that never placed there. Each song's tier comes mostly from its Last.fm listener count, partly from that count within its genre, a little from its year-end rank, and from how recent it is (most players are college students, so older songs lean harder). Easy is songs from 2000 on, plus older ones every generation knows (*Billie Jean*, *Bohemian Rhapsody*), so a 2002 hit nobody plays anymore is Hard while *Take On Me* is Easy. (A one-time script looked the counts up; the site itself never calls Last.fm.)
- **Free Play rates songs within your filter.** With the Anime filter on, a song is compared only with other anime songs, so *Unravel* is Easy there even though plenty of pop songs have more listeners. Anime songs also count as well known if they're an early opening of a popular show, because Last.fm misses songs fans mostly hear in the show (One Piece's *We Are!* has only about 5,000 listeners there).
- **Free Play goes deeper.** Besides Daily's songs it has Billboard's genre number ones (country, R&B, rock, alternative, Latin), Korea's Circle Chart number ones, openings and endings from the 400 most popular anime on AniList, Apple's current genre charts, and Hot 100 ranks 41–100. That file only loads when Free Play opens, and Daily never uses it.
- **Name the anime instead.** In Free Play's Anime filter you can guess the show. Any season, movie or spin-off of it counts ("Naruto" is right for a *Naruto: Shippuden* opening), because the song list stores each show's whole franchise as AniList IDs (no names, so the source doesn't spoil it).
- **Free Play can't spoil Daily.** It skips every song Daily will play in the next 60 days.

```
index.html        page structure
style.css         all styling (VHS look; colors and fonts are CSS variables)
data/songs.js     Daily's song pool (iTunes IDs, difficulty tier, year, genres)
data/more-songs.js extra Free Play songs, same format
data/song-fame.js how well known each song is, for ordering guess suggestions
js/main.js        starts the app and connects everything
js/config.js      every tunable number (scoring, the six kinds of damage, timing)
js/game.js        rules for one track (tries, damage level, peeks, points)
js/daily.js       puzzle number and today's songs
js/matching.js    decides if a guess is right
js/autocomplete.js  the search-as-you-type guess box
js/anilist.js     anime show search for the Anime filter
js/ui.js          updates the page (and plays the damage intros)
```

## Running it locally

It uses JavaScript modules, so it needs to be served rather than opened as a file:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

Song previews, artwork and music videos courtesy of Apple Music via the iTunes Search API. Anime data from AniList. Dancing Rick sticker from GIPHY. Fonts: Archivo and VT323 from Google Fonts.

Built for CSE 2004 (Website #2) with help from Claude Code (Claude Opus 5.5).
