// Cloudflare Worker entry point.
//
// Routes (all need ?key=<ADD_KEY>, except /callback which Spotify calls):
//   GET /login     -> one-time: connect your Spotify account
//   GET /callback  -> Spotify sends you back here after login
//   GET|POST /add  -> add the currently playing song to your playlist
//
// Responses are short plain text so Siri / Google Assistant can read them aloud.

import { addCurrentSong, authorizeUrl, exchangeCode, UserFacingError } from "./spotify.js";

function text(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function keyMatches(provided, expected) {
  if (!expected || typeof provided !== "string" || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function providedKey(request, url) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return url.searchParams.get("key");
}

export async function handle(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const store = env.TOKENS;
  const redirectUri = `${url.origin}/callback`;

  if (url.pathname === "/callback") {
    const state = url.searchParams.get("state");
    const expected = state && (await store.get(`state:${state}`));
    if (!expected) return text("This login link expired. Open /login again.", 400);
    await store.delete(`state:${state}`);
    if (url.searchParams.get("error")) return text(`Spotify login was cancelled: ${url.searchParams.get("error")}`, 400);
    await exchangeCode(env, store, url.searchParams.get("code"), redirectUri, fetchImpl);
    return text("Spotify is connected. You can close this page and use your widget.");
  }

  if (!keyMatches(providedKey(request, url), env.ADD_KEY)) {
    return text("Wrong or missing key.", 401);
  }

  if (url.pathname === "/login") {
    const state = crypto.randomUUID();
    await store.put(`state:${state}`, "1", { expirationTtl: 600 });
    return Response.redirect(authorizeUrl(env, redirectUri, state), 302);
  }

  if (url.pathname === "/add" && (request.method === "GET" || request.method === "POST")) {
    try {
      return text(await addCurrentSong(env, store, fetchImpl, url.searchParams.get("playlist")));
    } catch (err) {
      if (err instanceof UserFacingError) return text(err.message, 409);
      console.error(err);
      return text("Sorry, something went wrong adding that song.", 502);
    }
  }

  return text("Not found.", 404);
}

export default {
  fetch: (request, env) => handle(request, env),
};
