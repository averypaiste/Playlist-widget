# Context

Domain language for the playlist widget. Code and docs use these names.

**Spotify session**: being logged in to Spotify as the owner. It covers starting and finishing the
one-time login, keeping the access token fresh, and saving rotated refresh tokens. Lives in
`src/session.js`. Its seams are the token store (Cloudflare KV, or in-memory in tests) and `fetch`.

**Playlist target**: the playlist a song goes into, chosen by spoken name, playlist link or ID, or
the default (`PLAYLIST_ID`). Names match only playlists the owner owns: exact, then "starts with",
then "contains", ignoring case and punctuation. Lives in `src/playlistTarget.js`.

**Add outcome**: what happened when the owner asked to save the song that's playing: `added`,
`duplicate`, `forbidden`, `nothing-playing`, `not-a-song`, `not-connected`, `no-playlist` or
`playlist-not-found`. Produced by `src/addSong.js`. Unexpected Spotify failures are errors, not
outcomes.

**Speech**: the sentence Siri reads back for an add outcome (`src/speak.js`). Every add outcome is
returned with HTTP 200, so iPhone Shortcuts always has something to say. Only unexpected failures
return 502.
