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
# also paste your playlist ID into wrangler.toml

npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
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

### iPhone: Shortcut + Siri + lock-screen widget + CarPlay
1. Open **Shortcuts** and tap **+**. Name it **Save This Song**.
2. Add the **Get Contents of URL** action:
   - URL: `https://playlist-widget.yourname.workers.dev/add`
   - Method: **POST**
   - Headers: add `Authorization` = `Bearer YOUR_ADD_KEY`
3. Add the **Speak Text** action. It speaks the output of *Get Contents of URL*.
4. Optional, for a silent version: also add **Show Notification** with that same output.

Now you can use it any of these ways:
- **Voice (best while driving):** *"Hey Siri, Save This Song."* This works from the lock screen
  and through CarPlay.
- **Lock-screen widget:** long-press the lock screen, then **Customize → Lock Screen → add widget →
  Shortcuts**, and pick *Save This Song*.
- **Action Button** (iPhone 15 Pro and later): Settings → Action Button → Shortcut → *Save This Song*.
- **Back Tap:** Settings → Accessibility → Touch → Back Tap → Double Tap → *Save This Song*.

To run it without unlocking, go to **Settings → Face ID & Passcode** and check that **Siri** is
allowed when locked.

### Android: home-screen widget + Google Assistant
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
