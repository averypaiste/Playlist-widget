// Playlist target: choose a playlist and put a track in it.
//
// Interface:
//   addToPlaylist(session, { trackUri, requested, defaultId, skipDuplicates })
//     -> { kind: "added" | "duplicate" | "forbidden", playlist }
//      | { kind: "no-playlist" }
//      | { kind: "playlist-not-found", requested }
//
// `requested` may be a spoken playlist name, a Spotify playlist link, a playlist ID, or empty
// (use `defaultId`). Names match only playlists the user owns: exact first, then "starts with",
// then "contains", ignoring case and punctuation.
//
// `playlist` is { id, name, source } where source is "default" | "id" | "name" and name is
// known only when source is "name".

const MAX_DUPLICATE_PAGES = 40; // 40 * 50 = 2000 songs checked
const MAX_PLAYLIST_PAGES = 20;

const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function playlistIdFrom(value) {
  const link = value.match(/playlist[/:]([A-Za-z0-9]{22})/);
  if (link) return link[1];
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
  return null;
}

async function json(res, what) {
  if (!res.ok) throw new Error(`Couldn't ${what} (${res.status}): ${await res.text()}`);
  return res.json();
}

async function findOwnedByName(session, name) {
  const wanted = normalize(name);
  if (!wanted) return null;
  const me = await json(await session.request("/me"), "read your profile");
  const owned = [];
  let url = "/me/playlists?limit=50";
  for (let page = 0; url && page < MAX_PLAYLIST_PAGES; page++) {
    const data = await json(await session.request(url), "list your playlists");
    for (const p of data.items || []) if (p?.owner?.id === me.id) owned.push(p);
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

async function resolve(session, requested, defaultId) {
  const value = (requested || "").trim();
  if (!value) {
    return defaultId ? { playlist: { id: defaultId, name: null, source: "default" } } : { kind: "no-playlist" };
  }
  const id = playlistIdFrom(value);
  if (id) return { playlist: { id, name: null, source: "id" } };
  const found = await findOwnedByName(session, value);
  if (!found) return { kind: "playlist-not-found", requested: value };
  return { playlist: { id: found.id, name: found.name, source: "name" } };
}

async function contains(session, playlistId, uri) {
  let url = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50`;
  for (let page = 0; url && page < MAX_DUPLICATE_PAGES; page++) {
    const res = await session.request(url);
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

export async function addToPlaylist(session, { trackUri, requested, defaultId, skipDuplicates = true }) {
  const resolved = await resolve(session, requested, defaultId);
  if (!resolved.playlist) return resolved;
  const { playlist } = resolved;

  if (skipDuplicates && (await contains(session, playlist.id, trackUri))) {
    return { kind: "duplicate", playlist };
  }
  const res = await session.request(`/playlists/${encodeURIComponent(playlist.id)}/items`, {
    method: "POST",
    body: JSON.stringify({ uris: [trackUri] }),
  });
  if (res.status === 403 || res.status === 404) return { kind: "forbidden", playlist };
  if (!res.ok) throw new Error(`Couldn't add the song (${res.status}): ${await res.text()}`);
  return { kind: "added", playlist };
}
