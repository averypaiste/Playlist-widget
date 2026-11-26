import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/worker.js";

class MemoryKV {
  constructor(init = {}) { this.map = new Map(Object.entries(init)); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const TRACK = { uri: "spotify:track:abc", name: "Song A", artists: [{ name: "Band" }] };

function makeEnv(kv = new MemoryKV({ refresh_token: "r1" })) {
  return {
    SPOTIFY_CLIENT_ID: "cid",
    SPOTIFY_CLIENT_SECRET: "secret",
    PLAYLIST_ID: "pl1",
    ADD_KEY: "k3y",
    TOKENS: kv,
  };
}

/** Fake Spotify. `routes` maps "METHOD path" (no query) to a handler returning a Response. */
function fakeSpotify(routes) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const key = `${init.method || "GET"} ${url.pathname}`;
    calls.push({ key, url, init });
    const h = routes[key];
    if (!h) throw new Error(`unexpected request ${key}`);
    return h(url, init);
  };
  return { fetchImpl, calls };
}

const baseRoutes = (overrides = {}) => ({
  "POST /api/token": () => json({ access_token: "at", expires_in: 3600 }),
  "GET /v1/me/player/currently-playing": () => json({ currently_playing_type: "track", item: TRACK }),
  "GET /v1/playlists/pl1/items": () => json({ items: [], next: null }),
  "POST /v1/playlists/pl1/items": () => json({ snapshot_id: "s" }, 201),
  ...overrides,
});

const req = (path, init) => new Request(`https://w.example${path}`, init);

test("rejects requests without the right key", async () => {
  const { fetchImpl } = fakeSpotify(baseRoutes());
  const res = await handle(req("/add?key=nope"), makeEnv(), fetchImpl);
  assert.equal(res.status, 401);
});

test("adds the currently playing song and speaks a confirmation", async () => {
  const { fetchImpl, calls } = fakeSpotify(baseRoutes());
  const res = await handle(req("/add?key=k3y"), makeEnv(), fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "Added Song A by Band.");
  const add = calls.find((c) => c.key === "POST /v1/playlists/pl1/items");
  assert.deepEqual(JSON.parse(add.init.body), { uris: ["spotify:track:abc"] });
});

test("accepts the key as a Bearer header", async () => {
  const { fetchImpl } = fakeSpotify(baseRoutes());
  const res = await handle(req("/add", { method: "POST", headers: { Authorization: "Bearer k3y" } }), makeEnv(), fetchImpl);
  assert.equal(res.status, 200);
});

test("skips songs already in the playlist, checking every page", async () => {
  const { fetchImpl, calls } = fakeSpotify(baseRoutes({
    "GET /v1/playlists/pl1/items": (url) =>
      url.searchParams.get("offset") === "50"
        ? json({ items: [{ item: TRACK }], next: null })
        : json({ items: [{ item: { uri: "spotify:track:other" } }], next: "https://api.spotify.com/v1/playlists/pl1/items?offset=50&limit=50" }),
  }));
  const res = await handle(req("/add?key=k3y"), makeEnv(), fetchImpl);
  assert.equal(await res.text(), "Song A by Band is already in your playlist.");
  assert.ok(!calls.some((c) => c.key === "POST /v1/playlists/pl1/items"));
});

test("says so when nothing is playing", async () => {
  const { fetchImpl } = fakeSpotify(baseRoutes({
    "GET /v1/me/player/currently-playing": () => new Response(null, { status: 204 }),
  }));
  const res = await handle(req("/add?key=k3y"), makeEnv(), fetchImpl);
  assert.equal(await res.text(), "Nothing is playing on Spotify right now.");
});

test("refuses podcasts", async () => {
  const { fetchImpl } = fakeSpotify(baseRoutes({
    "GET /v1/me/player/currently-playing": () => json({ currently_playing_type: "episode", item: { uri: "spotify:episode:x" } }),
  }));
  const res = await handle(req("/add?key=k3y"), makeEnv(), fetchImpl);
  assert.equal(res.status, 200, "every expected outcome is a 200 so Shortcuts speaks it");
  assert.equal(await res.text(), "That's not a song, so I can't add it to the playlist.");
});

test("tells you to log in when Spotify isn't connected", async () => {
  const { fetchImpl } = fakeSpotify(baseRoutes());
  const res = await handle(req("/add?key=k3y"), makeEnv(new MemoryKV()), fetchImpl);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /isn't connected/);
});

test("reuses a cached access token and stores rotated refresh tokens", async () => {
  const kv = new MemoryKV({ refresh_token: "r1" });
  const { fetchImpl, calls } = fakeSpotify(baseRoutes({
    "POST /api/token": () => json({ access_token: "at", expires_in: 3600, refresh_token: "r2" }),
  }));
  await handle(req("/add?key=k3y"), makeEnv(kv), fetchImpl);
  await handle(req("/add?key=k3y"), makeEnv(kv), fetchImpl);
  assert.equal(calls.filter((c) => c.key === "POST /api/token").length, 1);
  assert.equal(await kv.get("refresh_token"), "r2");
});

test("login redirects to Spotify and callback saves the refresh token", async () => {
  const kv = new MemoryKV();
  const { fetchImpl } = fakeSpotify(baseRoutes({
    "POST /api/token": (_u, init) => {
      assert.equal(new URLSearchParams(init.body).get("code"), "c0de");
      return json({ access_token: "at", expires_in: 3600, refresh_token: "fresh" });
    },
  }));
  const login = await handle(req("/login?key=k3y"), makeEnv(kv), fetchImpl);
  assert.equal(login.status, 302);
  const auth = new URL(login.headers.get("Location"));
  assert.equal(auth.searchParams.get("redirect_uri"), "https://w.example/callback");
  const state = auth.searchParams.get("state");

  const cb = await handle(req(`/callback?code=c0de&state=${state}`), makeEnv(kv), fetchImpl);
  assert.equal(cb.status, 200);
  assert.equal(await kv.get("refresh_token"), "fresh");

  const replay = await handle(req(`/callback?code=c0de&state=${state}`), makeEnv(kv), fetchImpl);
  assert.equal(replay.status, 400, "state can only be used once");
});

const myPlaylists = {
  "GET /v1/me": () => json({ id: "me" }),
  "GET /v1/me/playlists": () => json({
    items: [
      { id: "someoneElses", name: "Road Trip", owner: { id: "other" } },
      { id: "rt", name: "Road Trip!! 2026", owner: { id: "me" } },
      { id: "chill", name: "Chill", owner: { id: "me" } },
    ],
    next: null,
  }),
};

test("picks one of your playlists by spoken name, ignoring case and punctuation", async () => {
  const { fetchImpl, calls } = fakeSpotify(baseRoutes({
    ...myPlaylists,
    "GET /v1/playlists/rt/items": () => json({ items: [], next: null }),
    "POST /v1/playlists/rt/items": () => json({ snapshot_id: "s" }, 201),
  }));
  const res = await handle(req("/add?key=k3y&playlist=road%20trip"), makeEnv(), fetchImpl);
  assert.equal(await res.text(), "Added Song A by Band to Road Trip!! 2026.");
  assert.ok(calls.some((c) => c.key === "POST /v1/playlists/rt/items"));
  assert.ok(!calls.some((c) => c.key === "POST /v1/playlists/pl1/items"));
});

test("accepts a pasted Spotify playlist link", async () => {
  const id = "37i9dQZF1DXcBWIGoYBM5M";
  const { fetchImpl, calls } = fakeSpotify(baseRoutes({
    [`GET /v1/playlists/${id}/items`]: () => json({ items: [], next: null }),
    [`POST /v1/playlists/${id}/items`]: () => json({ snapshot_id: "s" }, 201),
  }));
  const link = encodeURIComponent(`https://open.spotify.com/playlist/${id}?si=xyz`);
  const res = await handle(req(`/add?key=k3y&playlist=${link}`), makeEnv(), fetchImpl);
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.key === `POST /v1/playlists/${id}/items`));
});

test("says so when no playlist matches the name", async () => {
  const { fetchImpl } = fakeSpotify(baseRoutes(myPlaylists));
  const res = await handle(req("/add?key=k3y&playlist=workout"), makeEnv(), fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "I couldn't find a playlist of yours called workout.");
});
