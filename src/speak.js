// Turn an AddOutcome into the sentence Siri / Google Assistant reads aloud.
// Every expected outcome is a normal answer, so the Worker returns them all with HTTP 200;
// that way iPhone Shortcuts always has a sentence to speak.

function describe(track) {
  const artists = (track.artists || []).map((a) => a.name).join(", ");
  return artists ? `${track.name} by ${artists}` : track.name;
}

function where(playlist) {
  if (playlist.name) return playlist.name;
  return playlist.source === "default" ? "your playlist" : "that playlist";
}

export function speak(outcome) {
  switch (outcome.kind) {
    case "added":
      return outcome.playlist.source === "default"
        ? `Added ${describe(outcome.track)}.`
        : `Added ${describe(outcome.track)} to ${where(outcome.playlist)}.`;
    case "duplicate":
      return `${describe(outcome.track)} is already in ${where(outcome.playlist)}.`;
    case "forbidden":
      return "Spotify wouldn't let me change that playlist. Make sure it's one you own.";
    case "nothing-playing":
      return "Nothing is playing on Spotify right now.";
    case "not-a-song":
      return "That's not a song, so I can't add it to the playlist.";
    case "not-connected":
      return "Spotify isn't connected yet. Open the login link once to connect it.";
    case "no-playlist":
      return "No default playlist is set up yet.";
    case "playlist-not-found":
      return `I couldn't find a playlist of yours called ${outcome.requested}.`;
    default:
      throw new Error(`No wording for outcome ${outcome.kind}`);
  }
}
