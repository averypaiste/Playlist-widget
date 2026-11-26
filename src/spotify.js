// Core logic: talk to Spotify and add the currently playing song to a playlist.
// Kept free of Cloudflare-specific APIs (except the KV-like `store`) so it can be unit tested.

const API = "https://api.spotify.com/v1";
const ACCOUNTS = "https://accounts.spotify.com";

export const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "playlist-modify-private",
  "playlist-modify-public",
  "playlist-read-private",
].join(" ");

const MAX_DUPLICATE_PAGES = 40; // 40 * 50 = 2000 songs checked for duplicates

function basicAuth(env) {
  return "Basic " + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
}

export function authorizeUrl(env, redirectUri, state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

async function tokenRequest(env, body, fetchImpl) {
  const res = await fetchImpl(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(env),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(`Spotify login failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Exchange the one-time code from the login redirect and save the refresh token. */
export async function exchangeCode(env, store, code, redirectUri, fetchImpl = fetch) {
  const data = await tokenRequest(
    env,
    { grant_type: "authorization_code", code, redirect_uri: redirectUri },
    fetchImpl,
  );
  await store.put("refresh_token", data.refresh_token);
  await cacheAccessToken(store, data);
}

async function cacheAccessToken(store, data) {
  // Refresh a minute early to avoid using a token right as it expires.
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  await store.put("access_token", JSON.stringify({ token: data.access_token, expiresAt }));
}

export async function getAccessToken(env, store, fetchImpl = fetch) {
  const cached = await store.get("access_token");
  if (cached) {
    const { token, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) return token;
  }
  const refreshToken = await store.get("refresh_token");
  if (!refreshToken) {
    throw new UserFacingError("Spotify isn't connected yet. Open the login link once to connect it.");
  }
  const data = await tokenRequest(
    env,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl,
  );
  // Spotify sometimes rotates the refresh token; keep the newest one.
  if (data.refresh_token) await store.put("refresh_token", data.refresh_token);
  await cacheAccessToken(store, data);
  return data.access_token;
}

/** An error whose message is safe and friendly enough to be read aloud by Siri. */
export class UserFacingError extends Error {}

async function api(token, path, fetchImpl, init = {}) {
  const res = await fetchImpl(path.startsWith("http") ? path : API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  return res;
}

async function getCurrentTrack(token, fetchImpl) {
  const res = await api(token, "/me/player/currently-playing", fetchImpl);
  if (res.status === 204) return null; // nothing playing
  if (!res.ok) throw new Error(`Couldn't read what's playing (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data || !data.item) return null;
  if (data.currently_playing_type && data.currently_playing_type !== "track") {
    throw new UserFacingError("That's not a song, so I can't add it to the playlist.");
  }
  return data.item;
}

async function playlistContains(token, playlistId, uri, fetchImpl) {
  let url = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50`;
  for (let page = 0; url && page < MAX_DUPLICATE_PAGES; page++) {
    const res = await api(token, url, fetchImpl);
    if (!res.ok) return false; // don't block adding just because the check failed
    const data = await res.json();
    for (const entry of data.items || []) {
      const thing = entry.item || entry.track; // `item` is the 2026 name; `track` the old one
      if (thing && thing.uri === uri) return true;
    }
    url = data.next;
  }
  return false;
}

function describe(track) {
  const artists = (track.artists || []).map((a) => a.name).join(", ");
  return artists ? `${track.name} by ${artists}` : track.name;
}

const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Accepts a playlist ID, a Spotify playlist link, or null (use the default). */
function playlistIdFrom(value) {
  const link = value.match(/playlist[/:]([A-Za-z0-9]{22})/);
  if (link) return link[1];
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
  return null;
}

/**
 * Find one of the user's own playlists by (spoken) name.
 * Tries an exact match, then "starts with", then "contains", ignoring case and punctuation.
 */
async function findPlaylistByName(token, name, fetchImpl) {
  const wanted = normalize(name);
  if (!wanted) return null;
  const meRes = await api(token, "/me", fetchImpl);
  if (!meRes.ok) throw new Error(`Couldn't read your Spotify profile (${meRes.status})`);
  const me = await meRes.json();

  const owned = [];
  let url = "/me/playlists?limit=50";
  for (let page = 0; url && page < 20; page++) {
    const res = await api(token, url, fetchImpl);
    if (!res.ok) throw new Error(`Couldn't list your playlists (${res.status})`);
    const data = await res.json();
    for (const p of data.items || []) {
      if (p && p.owner && p.owner.id === me.id) owned.push(p);
    }
    url = data.next;
  }
  const n = (p) => normalize(p.name || "");
  return (
    owned.find((p) => n(p) === wanted) ||
    owned.find((p) => n(p).startsWith(wanted)) ||
    owned.find((p) => n(p).includes(wanted)) ||
    null
  );
}

async function resolvePlaylist(env, token, requested, fetchImpl) {
  const value = (requested || "").trim();
  if (!value) {
    if (!env.PLAYLIST_ID) throw new UserFacingError("No playlist is set up yet. Run: npx wrangler secret put PLAYLIST_ID");
    return { id: env.PLAYLIST_ID, label: "your playlist" };
  }
  const id = playlistIdFrom(value);
  if (id) return { id, label: "that playlist" };
  const found = await findPlaylistByName(token, value, fetchImpl);
  if (!found) throw new UserFacingError(`I couldn't find a playlist of yours called ${value}.`);
  return { id: found.id, label: found.name };
}

/**
 * Add whatever is playing right now to a playlist: the default PLAYLIST_ID, or `requested`
 * (a playlist name, ID or link). Returns a short sentence for Siri / Google Assistant to speak.
 */
export async function addCurrentSong(env, store, fetchImpl = fetch, requested = null) {
  const token = await getAccessToken(env, store, fetchImpl);
  const track = await getCurrentTrack(token, fetchImpl);
  if (!track) return "Nothing is playing on Spotify right now.";

  const { id: playlistId, label } = await resolvePlaylist(env, token, requested, fetchImpl);
  if (env.SKIP_DUPLICATES !== "false" && (await playlistContains(token, playlistId, track.uri, fetchImpl))) {
    return `${describe(track)} is already in ${label}.`;
  }

  const res = await api(token, `/playlists/${encodeURIComponent(playlistId)}/items`, fetchImpl, {
    method: "POST",
    body: JSON.stringify({ uris: [track.uri] }),
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 404) {
      throw new UserFacingError("Spotify wouldn't let me change that playlist. Check the playlist ID and that you own it.");
    }
    throw new Error(`Couldn't add the song (${res.status}): ${await res.text()}`);
  }
  return requested && requested.trim() ? `Added ${describe(track)} to ${label}.` : `Added ${describe(track)}.`;
}
