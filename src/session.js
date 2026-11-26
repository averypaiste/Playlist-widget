// Spotify session: everything about being logged in to Spotify.
//
// Interface:
//   createSession({ clientId, clientSecret, store, fetch })
//     .loginUrl(redirectUri)                         -> URL to send the user to
//     .finishLogin({ code, state, error, redirectUri }) -> saves the login, or throws LoginError
//     .request(path, init)                            -> Response from the Spotify Web API
//
// `request` refreshes the access token when needed, keeps rotated refresh tokens, and retries
// once on 401. It throws NotConnectedError if nobody has logged in yet.
//
// Seams: `store` (KV in production, in-memory in tests) and `fetch` (real or fake).

const API = "https://api.spotify.com/v1";
const ACCOUNTS = "https://accounts.spotify.com";

export const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "playlist-modify-private",
  "playlist-modify-public",
  "playlist-read-private",
].join(" ");

export class NotConnectedError extends Error {}
/** Login could not be finished; the message is safe to show the user. */
export class LoginError extends Error {}

const LOGIN_STATE_TTL_SECONDS = 600;

export function createSession({ clientId, clientSecret, store, fetch: fetchImpl = fetch }) {
  const basicAuth = "Basic " + btoa(`${clientId}:${clientSecret}`);

  async function tokenRequest(body) {
    const res = await fetchImpl(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: { Authorization: basicAuth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    if (!res.ok) throw new Error(`Spotify token request failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  async function saveTokens(data) {
    // Spotify sometimes rotates the refresh token; keep the newest one.
    if (data.refresh_token) await store.put("refresh_token", data.refresh_token);
    // Treat the token as expired a minute early.
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    await store.put("access_token", JSON.stringify({ token: data.access_token, expiresAt }));
    return data.access_token;
  }

  async function accessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh) {
      const cached = await store.get("access_token");
      if (cached) {
        const { token, expiresAt } = JSON.parse(cached);
        if (Date.now() < expiresAt) return token;
      }
    }
    const refreshToken = await store.get("refresh_token");
    if (!refreshToken) throw new NotConnectedError("Spotify isn't connected");
    return saveTokens(await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }));
  }

  function send(token, path, init) {
    return fetchImpl(path.startsWith("http") ? path : API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
  }

  return {
    async loginUrl(redirectUri) {
      const state = crypto.randomUUID();
      await store.put(`state:${state}`, "1", { expirationTtl: LOGIN_STATE_TTL_SECONDS });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: SCOPES,
        redirect_uri: redirectUri,
        state,
      });
      return `${ACCOUNTS}/authorize?${params}`;
    },

    async finishLogin({ code, state, error, redirectUri }) {
      if (!state || !(await store.get(`state:${state}`))) {
        throw new LoginError("This login link expired. Open /login again.");
      }
      await store.delete(`state:${state}`);
      if (error) throw new LoginError(`Spotify login was cancelled: ${error}`);
      const data = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      await saveTokens(data);
    },

    async request(path, init = {}) {
      const res = await send(await accessToken(), path, init);
      if (res.status !== 401) return res;
      // Token was revoked or expired early: refresh once and retry.
      return send(await accessToken({ forceRefresh: true }), path, init);
    },
  };
}
