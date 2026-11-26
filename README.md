# Playlist Widget 🚗🎵

Save the song that's playing to a Spotify playlist **without unlocking your phone**. Use your voice
("Hey Siri, save this song") or tap a lock-screen widget. Your phone says back
*"Added Song Name by Artist."*

```
 Lock-screen widget / Siri / Google Assistant
                │  (one web request)
                ▼
   Your free Cloudflare Worker  ──►  Spotify: what's playing? ──► add it to your playlist
```

> **Driving safety:** use the **voice** option while moving. Set up the widget for when you're
> parked or at a stop.

---

## One-time setup (about 15 minutes, on a computer)

### 1. Create a Spotify app
1. Go to <https://developer.spotify.com/dashboard> and log in. Spotify requires **Premium** for
   personal API apps.
2. **Create app**. Use any name. Pick **Web API**. For **Redirect URI**, enter something temporary
   like `https://example.com/callback`. You'll fix it in step 3.
3. Open the app's **Settings** and copy the **Client ID** and **Client Secret**.

### 2. Find your playlist ID
In Spotify, open the playlist and choose **Share → Copy link to playlist**. The link looks like
`https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=…`. The ID is the part between
`/playlist/` and `?`. **You must own the playlist.**

### 3. Deploy the Worker (free)
You need [Node.js](https://nodejs.org) and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.

```bash
git clone <this repo> && cd Playlist-widget
npx wrangler login
npx wrangler kv namespace create TOKENS     # copy the id it prints into wrangler.toml

npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put PLAYLIST_ID
npx wrangler secret put ADD_KEY             # make up a long random password, e.g. from a password manager

npx wrangler deploy
```

`deploy` prints your Worker's address, e.g. `https://playlist-widget.yourname.workers.dev`.

Back in the Spotify dashboard, set the app's **Redirect URI** to that address plus `/callback`.
For example: `https://playlist-widget.yourname.workers.dev/callback`. Save it.

### 4. Connect your Spotify account (once)
On your phone or computer, open:

```
https://playlist-widget.yourname.workers.dev/login?key=YOUR_ADD_KEY
```

Approve the request. You should see *"Spotify is connected."* You won't need to do this again.

Test it: play a song, then open `…/add?key=YOUR_ADD_KEY`. The song should appear in your playlist.

---

## On your phone

### iPhone (about 5 minutes)

#### A. Build the shortcut
1. Open the **Shortcuts** app and tap **+** (top right).
2. Tap the name at the top, choose **Rename**, and type **Save This Song**. Siri listens for this
   name, so keep it short and easy to say.
3. Tap **Add Action**, search for **Get Contents of URL**, and tap it.
4. Tap the blue **URL** placeholder and paste your full link, key included:
   `https://playlist-widget.yourname.workers.dev/add?key=YOUR_ADD_KEY`
   Leave **Method** set to **GET**. You don't need headers.
5. Tap the search bar at the bottom, add **Speak Text**, and check that it says
   *Speak **Contents of URL***. If it shows something else, tap that word and pick
   *Contents of URL*.
6. Tap **Done**.

#### B. Run it once by hand (important)
Play a song in Spotify, then tap the shortcut in the Shortcuts app. The first time, iPhone asks
**"Allow 'Save This Song' to connect to playlist-widget…workers.dev?"**. Tap **Always Allow**.
If you skip this, the question will pop up the first time you use it while driving.
You should hear "Added *Song* by *Artist*."

#### C. Make it work without unlocking
- **Settings → Apple Intelligence & Siri** (or **Siri**): turn on **Allow Siri When Locked**.
- **Settings → General → CarPlay → your car**: make sure Siri is on. CarPlay speaks the result
  through the car speakers.

#### D. Pick your triggers
- 🗣️ **Voice, best while driving:** *"Hey Siri, Save This Song."* This works with the phone locked,
  in a mount, and through CarPlay. You can also press and hold the car's steering-wheel voice
  button and say "Save This Song."
- 🔒 **Lock-screen widget:** touch and hold the lock screen → **Customize** → **Lock Screen** →
  tap the widget area → **Shortcuts** → pick *Save This Song*. Tap it to run, no unlock needed.
- 🔘 **Action Button** (iPhone 15 Pro and later): **Settings → Action Button** → swipe to
  **Shortcut** → *Save This Song*. Press and hold the button to save the song.
- 👆 **Back Tap** (any recent iPhone): **Settings → Accessibility → Touch → Back Tap → Double Tap**
  → *Save This Song*. Double-tap the back of the phone.

#### More than one playlist
Add `&playlist=` and a playlist **name** to the link (or a playlist link/ID). You must own the playlist.
Names ignore capitals and punctuation, and a partial name works ("road" finds "Road Trip 2026").

- **One shortcut per playlist:** duplicate *Save This Song*, rename the copy (e.g. **Save To Chill**),
  and change its URL to `…/add?key=YOUR_ADD_KEY&playlist=Chill`.
- **One shortcut that asks you:** before *Get Contents of URL*, add **Ask for Input** (Prompt:
  "Which playlist?"). Then in the URL, put `&playlist=` and insert the **Provided Input** variable
  after it. Say *"Hey Siri, Save This Song"*, and Siri will ask which playlist. Say its name.
  Leave the URL without `&playlist=` in your original shortcut to keep using your default.

#### If something goes wrong
| You hear / see | Fix |
|---|---|
| "Wrong or missing key." | The `?key=` part of the URL doesn't match your `ADD_KEY`. |
| "Spotify isn't connected yet…" | Open the `/login?key=…` link from step 4 again. |
| "I couldn't find a playlist of yours called …" | Say the name the way it's spelled in Spotify, or use a shorter part of it. |
| "Spotify wouldn't let me change that playlist…" | Re-run `npx wrangler secret put PLAYLIST_ID` with the right ID, and make sure you own the playlist. |
| Siri says "You need to unlock your iPhone first" | Turn on **Allow Siri When Locked** (step C), and re-run step B. |
| Siri starts a web search instead | Rename the shortcut to something more distinctive, like "Add Song To Road Trip". |

### Android (if you ever switch)
1. Install **HTTP Shortcuts** (free, from the Play Store).
2. Create a new shortcut named **Save This Song**:
   - Method **POST**, URL `https://playlist-widget.yourname.workers.dev/add`
   - Under **Request Headers**, add `Authorization` = `Bearer YOUR_ADD_KEY`
   - Under **Response Handling**, choose *Show as toast*. If you want the response read aloud,
     use the app's scripting with `speak(response.body)`.
3. Long-press the home screen and choose **Widgets → HTTP Shortcuts**. Place *Save This Song*.
4. **Voice:** HTTP Shortcuts supports app shortcuts, so *"Hey Google, open Save This Song"* runs it.
   You can also make a Google Assistant **Routine** for a phrase like *"save this song"*.

---

## What it says back
| Situation | Response |
|---|---|
| Added | "Added *Song* by *Artist*." |
| Already in playlist | "*Song* by *Artist* is already in your playlist." |
| Nothing playing | "Nothing is playing on Spotify right now." |
| Podcast playing | "That's not a song, so I can't add it to the playlist." |

To allow duplicates, set `SKIP_DUPLICATES = "false"` in `wrangler.toml` and redeploy.

## Notes
- Your `ADD_KEY` is the only thing protecting the endpoint. Don't share it. If it leaks, run
  `npx wrangler secret put ADD_KEY` again and update your shortcut.
- The Worker uses Spotify's 2026 `/playlists/{id}/items` endpoint. It works with Spotify apps in
  Development Mode for up to 5 users.
- Development: `npm test` runs the unit tests against a fake Spotify.
