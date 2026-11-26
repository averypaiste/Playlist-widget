// Tests for each deep module through its own interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, NotConnectedError, LoginError } from "../src/session.js";
import { addToPlaylist } from "../src/playlistTarget.js";
import { addCurrentSong } from "../src/addSong.js";
import { speak } from "../src/speak.js";

class MemoryKV {
  constructor(init = {}) { this.map = new Map(Object.entries(init)); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** In-memory session adapter: routes "METHOD path" (no query) to handlers. */
function fakeSession(routes) {
  const calls = [];
  return {
    calls,
    async request(path, init = {}) {
      const url = new URL(path, "https://api.spotify.com/v1/");
      const key = `${init.method || "GET"} ${url.pathname.replace(/^\/v1/, "")}`;
      calls.push({ key, url, init });
      if (routes[key] instanceof Error) throw routes[key];
      if (!routes[key]) throw new Error(`unexpected ${key}`);
      return routes[key](url, init);
    },
  };
}

// --- Spotify session ---------------------------------------------------------

test("session: retries once with a fresh token when Spotify says 401", async () => {
  const store = new MemoryKV({
    refresh_token: "r",
    access_token: JSON.stringify({ token: "stale", expiresAt: Date.now() + 60_000 }),
  });
  const seen = [];
  const fetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/api/token") return json({ access_token: "fresh", expires_in: 3600 });
    seen.push(init.headers.Authorization);
    return init.headers.Authorization === "Bearer stale" ? new Response("", { status: 401 }) : json({ ok: 1 });
  };
  const session = createSession({ clientId: "c", clientSecret: "s", store, fetch });
  const res = await session.request("/me");
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ["Bearer stale", "Bearer fresh"]);
});

test("session: request without a login throws NotConnectedError", async () => {
  const session = createSession({ clientId: "c", clientSecret: "s", store: new MemoryKV(), fetch: async () => { throw new Error("no"); } });
  await assert.rejects(session.request("/me"), NotConnectedError);
});

test("session: login state is single-use and a cancelled login is reported", async () => {
  const store = new MemoryKV();
  const fetch = async () => json({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  const session = createSession({ clientId: "c", clientSecret: "s", store, fetch });
  const state = new URL(await session.loginUrl("https://x/callback")).searchParams.get("state");
  await session.finishLogin({ code: "c", state, redirectUri: "https://x/callback" });
  assert.equal(await store.get("refresh_token"), "r");
  await assert.rejects(session.finishLogin({ code: "c", state, redirectUri: "https://x/callback" }), LoginError);

  const state2 = new URL(await session.loginUrl("https://x/callback")).searchParams.get("state");
  await assert.rejects(session.finishLogin({ state: state2, error: "access_denied" }), /cancelled/);
});

// --- Playlist target ---------------------------------------------------------

const owned = {
  "GET /me": () => json({ id: "me" }),
  "GET /me/playlists": () => json({
    items: [
      { id: "x", name: "Chill Vibes", owner: { id: "other" } },
      { id: "c2", name: "Chill Vibes Too", owner: { id: "me" } },
      { id: "c1", name: "chill vibes", owner: { id: "me" } },
      { id: "w", name: "My Workout Mix", owner: { id: "me" } },
    ],
    next: null,
  }),
};
const accepts = (id) => ({
  [`GET /playlists/${id}/items`]: () => json({ items: [], next: null }),
  [`POST /playlists/${id}/items`]: () => json({}, 201),
});

test("target: exact name beats starts-with; only owned playlists count", async () => {
  const s = fakeSession({ ...owned, ...accepts("c1") });
  const r = await addToPlaylist(s, { trackUri: "t", requested: "Chill-Vibes" });
  assert.deepEqual(r, { kind: "added", playlist: { id: "c1", name: "chill vibes", source: "name" } });
});

test("target: falls back to contains", async () => {
  const s = fakeSession({ ...owned, ...accepts("w") });
  const r = await addToPlaylist(s, { trackUri: "t", requested: "workout" });
  assert.equal(r.playlist.id, "w");
});

test("target: no default and nothing requested", async () => {
  assert.deepEqual(await addToPlaylist(fakeSession({}), { trackUri: "t" }), { kind: "no-playlist" });
});

test("target: a playlist Spotify won't let us change is 'forbidden'", async () => {
  const s = fakeSession({
    "GET /playlists/d/items": () => json({ items: [], next: null }),
    "POST /playlists/d/items": () => new Response("", { status: 403 }),
  });
  const r = await addToPlaylist(s, { trackUri: "t", defaultId: "d" });
  assert.equal(r.kind, "forbidden");
});

// --- Add outcome ------------------------------------------------------------

test("add: not connected becomes an outcome, not an error", async () => {
  const s = fakeSession({ "GET /me/player/currently-playing": new NotConnectedError() });
  assert.deepEqual(await addCurrentSong(s, { defaultId: "d" }), { kind: "not-connected" });
});

test("add: carries the track into the outcome", async () => {
  const track = { uri: "spotify:track:1", name: "S", artists: [] };
  const s = fakeSession({
    "GET /me/player/currently-playing": () => json({ currently_playing_type: "track", item: track }),
    ...accepts("d"),
  });
  const r = await addCurrentSong(s, { defaultId: "d" });
  assert.equal(r.kind, "added");
  assert.deepEqual(r.track, track);
});

// --- Speech -----------------------------------------------------------------

test("speak: wording per outcome", () => {
  const track = { name: "Song", artists: [{ name: "A" }, { name: "B" }] };
  assert.equal(speak({ kind: "added", track, playlist: { source: "default" } }), "Added Song by A, B.");
  assert.equal(speak({ kind: "added", track, playlist: { source: "name", name: "Chill" } }), "Added Song by A, B to Chill.");
  assert.equal(speak({ kind: "duplicate", track, playlist: { source: "id" } }), "Song by A, B is already in that playlist.");
  for (const kind of ["forbidden", "nothing-playing", "not-a-song", "not-connected", "no-playlist"]) {
    assert.ok(speak({ kind }).length > 0, kind);
  }
  assert.throws(() => speak({ kind: "mystery" }));
});
