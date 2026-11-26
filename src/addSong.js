// Add outcome: what happened when the user asked to save the song that's playing.
//
// Interface:
//   addCurrentSong(session, { requested, defaultId, skipDuplicates }) -> AddOutcome
//
// AddOutcome.kind is one of:
//   added, duplicate, forbidden       (with track and playlist)
//   nothing-playing, not-a-song, not-connected, no-playlist
//   playlist-not-found                (with requested)
// Unexpected Spotify failures throw. Turning an outcome into words is speak.js's job.

import { NotConnectedError } from "./session.js";
import { addToPlaylist } from "./playlistTarget.js";

async function currentTrack(session) {
  const res = await session.request("/me/player/currently-playing");
  if (res.status === 204) return { kind: "nothing-playing" };
  if (!res.ok) throw new Error(`Couldn't read what's playing (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data || !data.item) return { kind: "nothing-playing" };
  if (data.currently_playing_type && data.currently_playing_type !== "track") return { kind: "not-a-song" };
  return { track: data.item };
}

export async function addCurrentSong(session, { requested = null, defaultId = null, skipDuplicates = true } = {}) {
  try {
    const now = await currentTrack(session);
    if (!now.track) return now;
    const result = await addToPlaylist(session, { trackUri: now.track.uri, requested, defaultId, skipDuplicates });
    return { ...result, track: now.track };
  } catch (err) {
    if (err instanceof NotConnectedError) return { kind: "not-connected" };
    throw err;
  }
}
