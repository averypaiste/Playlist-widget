// Cloudflare Worker entry point: wires HTTP to the Spotify session and the add flow.
//
// Routes (all need ?key=<ADD_KEY> or "Authorization: Bearer <ADD_KEY>", except /callback):
//   GET /login       -> one-time: connect your Spotify account
//   GET /callback    -> Spotify sends you back here after login
//   GET|POST /add    -> add the currently playing song; optional ?playlist=<name|link|id>
//
// Responses are short plain text so Siri / Google Assistant can read them aloud.

import { createSession, LoginError } from "./session.js";
import { addCurrentSong } from "./addSong.js";
import { speak } from "./speak.js";

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
  const redirectUri = `${url.origin}/callback`;
  const session = createSession({
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    store: env.TOKENS,
    fetch: fetchImpl,
  });

  if (url.pathname === "/callback") {
    try {
      await session.finishLogin({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        error: url.searchParams.get("error"),
        redirectUri,
      });
    } catch (err) {
      if (err instanceof LoginError) return text(err.message, 400);
      throw err;
    }
    return text("Spotify is connected. You can close this page and use your widget.");
  }

  if (!keyMatches(providedKey(request, url), env.ADD_KEY)) {
    return text("Wrong or missing key.", 401);
  }

  if (url.pathname === "/login") {
    return Response.redirect(await session.loginUrl(redirectUri), 302);
  }

  if (url.pathname === "/add" && (request.method === "GET" || request.method === "POST")) {
    try {
      const outcome = await addCurrentSong(session, {
        requested: url.searchParams.get("playlist"),
        defaultId: env.PLAYLIST_ID,
        skipDuplicates: env.SKIP_DUPLICATES !== "false",
      });
      return text(speak(outcome));
    } catch (err) {
      console.error(err);
      return text("Sorry, something went wrong adding that song.", 502);
    }
  }

  return text("Not found.", 404);
}

export default {
  fetch: (request, env) => handle(request, env),
};
