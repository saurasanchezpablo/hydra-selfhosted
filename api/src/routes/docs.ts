import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "../auth";
import { db } from "../db";

const DOCS_CSS = `
  :root {
    --bg-0: #0f0f0f;
    --bg-1: #1a1a1a;
    --bg-2: #222222;
    --bg-3: #2a2a2a;
    --text-0: #dddddd;
    --text-1: #999999;
    --text-2: #666669;
    --border-1: #2a2a2a;
    --border-2: #333333;
    --accent: #d4a574;
    --accent-bright: #e6bb93;
    --accent-glow: rgba(212,165,116,0.15);
    --border-acc: rgba(212,165,116,0.3);
    --ok: #7a9;
    --err: #d77;
    --warn: #e6a23c;
    --font-sans: system-ui, -apple-system, sans-serif;
    --font-mono: ui-monospace, "JetBrains Mono", "Cascadia Code", "Fira Code", monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg-0);
    color: var(--text-0);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
  }
  .container { max-width: 900px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 1.4rem; font-weight: 600; color: var(--text-0); margin-bottom: 8px; letter-spacing: -0.3px; }
  h2 { font-size: 1rem; font-weight: 600; color: var(--accent); margin: 40px 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border-1); }
  h3 { font-size: 13px; font-weight: 600; color: var(--text-0); margin: 24px 0 8px; }
  p { color: var(--text-1); font-size: 13px; margin-bottom: 12px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--bg-2);
    border: 1px solid var(--border-1);
    padding: 2px 6px;
    color: var(--accent);
  }
  pre {
    background: var(--bg-1);
    border: 1px solid var(--border-1);
    padding: 16px;
    overflow-x: auto;
    margin: 12px 0;
    font-size: 12px;
    line-height: 1.5;
  }
  pre code { background: none; border: none; padding: 0; color: var(--text-0); }
  .endpoint {
    background: var(--bg-1);
    border: 1px solid var(--border-1);
    padding: 16px 20px;
    margin: 12px 0;
    transition: border-color 0.15s;
  }
  .endpoint:hover { border-color: var(--border-2); }
  .endpoint-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .method {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    text-transform: uppercase;
    display: inline-block;
    min-width: 50px;
    text-align: center;
  }
  .method-get { background: rgba(119,170,153,0.12); color: var(--ok); border: 1px solid rgba(119,170,153,0.25); }
  .method-post { background: rgba(212,165,116,0.12); color: var(--accent); border: 1px solid var(--border-acc); }
  .method-put { background: rgba(119,153,184,0.12); color: #7a9db8; border: 1px solid rgba(119,153,184,0.25); }
  .method-patch { background: rgba(138,122,212,0.12); color: #8a7ad4; border: 1px solid rgba(138,122,212,0.25); }
  .method-delete { background: rgba(221,119,119,0.12); color: var(--err); border: 1px solid rgba(221,119,119,0.25); }
  .path { font-family: var(--font-mono); font-size: 13px; color: var(--text-0); }
  .auth-badge {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .auth-public { background: rgba(119,170,153,0.1); color: var(--ok); border: 1px solid rgba(119,170,153,0.2); }
  .auth-required { background: rgba(212,165,116,0.1); color: var(--accent); border: 1px solid var(--border-acc); }
  .auth-admin { background: rgba(138,122,212,0.1); color: #8a7ad4; border: 1px solid rgba(138,122,212,0.25); }
  .desc { color: var(--text-1); font-size: 13px; margin-top: 6px; }
  .params { margin-top: 10px; }
  .params dt {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent);
    margin-top: 6px;
  }
  .params dd { color: var(--text-1); font-size: 12px; margin-left: 16px; }
  .tag {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--accent-glow);
    border: 1px solid var(--border-acc);
    padding: 2px 8px;
    color: var(--accent);
    display: inline-block;
    margin-right: 6px;
  }
  hr { border: none; border-top: 1px solid var(--border-1); margin: 32px 0; }
  .nav { margin-bottom: 32px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .nav a { font-size: 13px; color: var(--text-1); }
  .nav a:hover { color: var(--accent); }
  .section { scroll-margin-top: 24px; }
  .hero { margin-bottom: 32px; }
  .hero h1 { margin-bottom: 4px; }
  .hero p { color: var(--text-2); font-size: 13px; }
  .response-label { font-family: var(--font-mono); font-size: 11px; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 12px; margin-bottom: 4px; }
  .auth-notice {
    background: var(--bg-2);
    border: 1px solid var(--border-1);
    padding: 16px 20px;
    margin-bottom: 24px;
    font-size: 13px;
    color: var(--text-1);
  }
  .auth-notice strong { color: var(--accent); }
`;

function ep(method: string, path: string, auth: "public" | "auth" | "admin", desc: string, body?: string, response?: string) {
  const methodClass = `method-${method.toLowerCase()}`;
  const authClass = auth === "admin" ? "auth-admin" : auth === "auth" ? "auth-required" : "auth-public";
  const authLabel = auth === "admin" ? "Admin" : auth === "auth" ? "Auth" : "Public";
  let html = `<div class="endpoint"><div class="endpoint-header">
    <span class="method ${methodClass}">${method}</span>
    <span class="path">${path}</span>
    <span class="auth-badge ${authClass}">${authLabel}</span>
  </div><p class="desc">${desc}</p>`;
  if (body) html += `<pre><code>${body}</code></pre>`;
  if (response) html += `<p class="response-label">Response 200</p><pre><code>${response}</code></pre>`;
  html += `</div>`;
  return html;
}

function publicDocsOnly() {
  return `
  <nav class="nav">
    <a href="#overview">Overview</a>
    <a href="#public">Public Endpoints</a>
    <a href="#authentication">Authentication</a>
    <a href="#errors">Errors</a>
  </nav>

  <div class="auth-notice">
    <strong>Public documentation.</strong> Showing only unauthenticated endpoints.
    <a href="/web/dashboard">Sign in</a> to access the full API docs.
  </div>

  <section class="section" id="overview">
    <h2>Overview</h2>
    <p>Hydra Self-Hosted provides a REST API for managing game profiles, libraries, cloud saves, and more.</p>
    <p>Base URL: <code>${process.env.PUBLIC_URL ?? "http://localhost:" + (process.env.PORT ?? "3000")}</code></p>
    <p>Authentication: Bearer token in <code>Authorization</code> header. Obtain via <code>/auth/register</code>, <code>/auth/login</code>, or <code>/passkeys/login/verify</code>.</p>
    <p>Full API docs: <a href="/docs?all=1">/docs?all=1</a> (requires authentication)</p>
  </section>

  <hr>

  <section class="section" id="public">
    <h2>Public Endpoints</h2>
    <p>These endpoints require no authentication.</p>
    ${ep("GET", "/api", "public", "API info and endpoint listing.")}
    ${ep("GET", "/api/health", "public", "Health check.", undefined,
      `{"status":"ok","timestamp":"2024-06-01T12:00:00.000Z"}`)}
    ${ep("GET", "/api/users/:username", "public", "Get a user's public profile by username.", undefined,
      `{
  "username": "entitybtw",
  "displayName": "Entity",
  "bio": "hello",
  "profileImageUrl": "https://...",
  "accentColor": "#d4a574",
  "stats": { "totalGames": 42, "totalHours": 1234, "steamHours": 800 },
  "currentGame": { "title": "Dota 2", "shop": "steam", "sessionDurationInSeconds": 1800 }
}`)}
    ${ep("GET", "/api/users/:username/stats", "public", "Detailed stats for a user.", undefined,
      `{
  "totalGames": 42,
  "totalHours": 1234,
  "achievements": 156,
  "byShop": { "steam": { "games": 32, "playtime": 4342400 } }
}`)}
    ${ep("GET", "/api/users/:username/library", "public", "Paginated game library.",
      `<dl class="params"><dt>?skip</dt><dd>Offset (default 0)</dd><dt>?take</dt><dd>Limit, max 100 (default 30)</dd><dt>?sortBy</dt><dd>title or playedRecently</dd></dl>`,
      `{"games":[{...}],"total":42,"skip":0,"take":30}`)}
    ${ep("GET", "/api/games/:shop/:objectId/achievements", "public", "Steam achievements for a game.")}
  </section>

  <hr>

  <section class="section" id="authentication">
    <h2>Authentication</h2>
    <p>To access the full API, you need an account. Use one of these methods:</p>
    ${ep("POST", "/auth/register", "public", "Create a new account.",
      `{"username":"myname","password":"mypassword"}`,
      `{"accessToken":"eyJ...","refreshToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("POST", "/auth/login", "public", "Sign in with existing credentials.",
      `{"username":"myname","password":"mypassword"}`,
      `{"accessToken":"eyJ...","refreshToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("POST", "/passkeys/login/options", "public", "Start passkey login (WebAuthn).",
      `{"username":"myname"}`,
      `{challenge, allowCredentials, userVerification}`)}
    ${ep("POST", "/passkeys/login/verify", "public", "Verify passkey login.",
      `{webauthn response}`,
      `{"accessToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("POST", "/auth/refresh", "public", "Refresh an expired access token.",
      `{"refreshToken":"eyJ..."}`,
      `{"accessToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("POST", "/auth/logout", "auth", "Logout (client discards token).", undefined, `{"ok":true}`)}
  </section>

  <hr>

  <section class="section" id="errors">
    <h2>Error Responses</h2>
    <p>All errors follow the same shape: <code>{"error": "message"}</code></p>
    <h3>Common status codes</h3>
    <div class="endpoint">
      <p class="desc"><strong>401</strong> — Unauthorized (missing or invalid token)<br>
      <strong>404</strong> — Not found<br>
      <strong>409</strong> — Conflict (already exists)<br>
      <strong>400</strong> — Bad request (invalid input)<br>
      <strong>500</strong> — Internal server error</p>
    </div>
  </section>`;
}

function fullDocs() {
  return `
  <nav class="nav">
    <a href="#authentication">Authentication</a>
    <a href="#passkeys">Passkeys</a>
    <a href="#public">Public</a>
    <a href="#profile">Profile</a>
    <a href="#games">Games</a>
    <a href="#friends">Friends</a>
    <a href="#cloud-saves">Cloud Saves</a>
    <a href="#reviews">Reviews</a>
    <a href="#artifacts">Artifacts</a>
    <a href="#admin">Admin</a>
    <a href="#errors">Errors</a>
  </nav>

  <section class="section" id="authentication">
    <h2>Authentication</h2>
    <p>Most endpoints require a Bearer token in the <code>Authorization</code> header. Obtain tokens via register, login, or passkey endpoints.</p>
    ${ep("POST", "/auth/register", "public", "Create a new account.",
      `{"username":"myname","password":"mypassword"}`,
      `{"accessToken":"eyJ...","refreshToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("POST", "/auth/login", "public", "Sign in with existing credentials.",
      `{"username":"myname","password":"mypassword"}`,
      `{"accessToken":"eyJ...","refreshToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("POST", "/auth/refresh", "public", "Refresh an expired access token.",
      `{"refreshToken":"eyJ..."}`,
      `{"accessToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("POST", "/auth/logout", "auth", "Logout.", undefined, `{"ok":true}`)}
    ${ep("POST", "/auth/verify-instance", "auth", "Verify instance token.", `{"token":"..."}`, `{"valid":true}`)}
    ${ep("POST", "/auth/ws", "auth", "Get a WebSocket token.", undefined, `{"token":"eyJ..."}`)}
  </section>

  <hr>

  <section class="section" id="passkeys">
    <h2>Passkeys (WebAuthn)</h2>
    <p>Passwordless authentication using device biometrics or security keys. Recommended for convenience.</p>
    ${ep("POST", "/passkeys/register/options", "auth", "Generate passkey registration options.",
      undefined, `{challenge, rp, user, pubKeyCredParams, ...}`)}
    ${ep("POST", "/passkeys/register/verify", "auth", "Verify passkey registration.",
      `{"id":"...","rawId":"...","response":{...},"label":"My YubiKey"}`,
      `{"verified":true,"passkeyId":"uuid"}`)}
    ${ep("POST", "/passkeys/login/options", "public", "Generate passkey login options.",
      `{"username":"myname"}`,
      `{challenge, allowCredentials, userVerification}`)}
    ${ep("POST", "/passkeys/login/verify", "public", "Verify passkey login and get tokens.",
      `{"id":"...","rawId":"...","response":{...}}`,
      `{"accessToken":"eyJ...","expiresIn":2592000}`)}
    ${ep("GET", "/passkeys", "auth", "List your registered passkeys.", undefined,
      `[{"id":"uuid","label":"My YubiKey","createdAt":"2024-..."}]`)}
    ${ep("DELETE", "/passkeys/:id", "auth", "Delete a passkey.", undefined, `{"ok":true}`)}
  </section>

  <hr>

  <section class="section" id="public">
    <h2>Public Endpoints</h2>
    ${ep("GET", "/api", "public", "API info and endpoint listing.")}
    ${ep("GET", "/api/health", "public", "Health check.")}
    ${ep("GET", "/api/users/:username", "public", "Get a user's public profile by username.")}
    ${ep("GET", "/api/users/:username/stats", "public", "Detailed stats for a user.")}
    ${ep("GET", "/api/users/:username/library", "public", "Paginated game library.",
      `<dl class="params"><dt>?skip</dt><dd>Offset (default 0)</dd><dt>?take</dt><dd>Limit, max 100 (default 30)</dd><dt>?sortBy</dt><dd>title or playedRecently</dd></dl>`)}
    ${ep("GET", "/api/users/:username/games", "public", "Simple game list.")}
    ${ep("GET", "/api/games/:shop/:objectId/achievements", "public", "Steam achievements for a game.")}
  </section>

  <hr>

  <section class="section" id="profile">
    <h2>Profile</h2>
    ${ep("GET", "/profile/me", "auth", "Get your own profile.")}
    ${ep("PATCH", "/profile", "auth", "Update your profile.",
      `{"displayName":"Name","bio":"bio","profileImageUrl":"https://..."}`)}
    ${ep("GET", "/users/:userId", "auth", "Full user profile by ID (friends, badges, recent games, current game).")}
    ${ep("GET", "/users/:userId/stats", "auth", "User stats by ID.")}
    ${ep("GET", "/users/:userId/library", "auth", "User library by ID.")}
    ${ep("GET", "/users/:userId/reviews", "auth", "User's reviews.")}
  </section>

  <hr>

  <section class="section" id="games">
    <h2>Games</h2>
    ${ep("POST", "/profile/games", "auth", "Create or update a single game.",
      `{"objectId":"570","shop":"steam","title":"Dota 2","playTimeInMilliseconds":0}`)}
    ${ep("POST", "/profile/games/batch", "auth", "Batch upsert games (array).")}
    ${ep("GET", "/profile/games", "auth", "List your games with pagination.",
      `<dl class="params"><dt>?skip</dt><dd>Offset</dd><dt>?take</dt><dd>Limit</dd></dl>`)}
    ${ep("PUT", "/profile/games/:shop/:objectId", "auth", "Update playtime or title.",
      `{"playTimeInSeconds":12345,"playTimeDeltaInSeconds":60}`)}
    ${ep("PUT", "/profile/games/:shop/:objectId/pin", "auth", "Pin a game.")}
    ${ep("PUT", "/profile/games/:shop/:objectId/unpin", "auth", "Unpin a game.")}
    ${ep("PUT", "/profile/games/:shop/:objectId/favorite", "auth", "Mark as favorite.")}
    ${ep("PUT", "/profile/games/:shop/:objectId/unfavorite", "auth", "Remove favorite.")}
    ${ep("DELETE", "/profile/games/:remoteId", "auth", "Soft-delete a game.")}
    ${ep("PUT", "/profile/games/achievements", "auth", "Sync achievements.",
      `{"id":"remote-id","achievements":[{"name":"ach","unlockTime":1717200000}]}`)}
    ${ep("GET", "/games/:shop/:objectId/achievements", "public", "Get available Steam achievements.")}
    ${ep("GET", "/games/:shop/:objectId/stats", "auth", "Game stats (playtime, total players).")}
    ${ep("GET", "/games/:shop/:objectId", "auth", "Game details (proxied from Hydra API).")}
    ${ep("POST", "/download-sources/changes", "auth", "Download source changes (empty for self-hosted).")}
  </section>

  <hr>

  <section class="section" id="friends">
    <h2>Friends</h2>
    ${ep("GET", "/users/search?q=", "auth", "Search users by username or display name.")}
    ${ep("GET", "/profile/friends", "auth", "List your friends.")}
    ${ep("POST", "/profile/friends/requests", "auth", "Send friend request.", `{"userId":"..."}`)}
    ${ep("GET", "/profile/friends/requests/received", "auth", "Incoming friend requests.")}
    ${ep("GET", "/profile/friends/requests/sent", "auth", "Outgoing friend requests.")}
    ${ep("PUT", "/profile/friends/requests/:id/accept", "auth", "Accept friend request.")}
    ${ep("DELETE", "/profile/friends/:id", "auth", "Remove friend or decline request.")}
    ${ep("GET", "/profile/notifications/count", "auth", "Pending friend request count.")}
    ${ep("GET", "/profile/blocks", "auth", "List blocked users.")}
  </section>

  <hr>

  <section class="section" id="cloud-saves">
    <h2>Cloud Saves</h2>
    <p>Content-addressable blob store with snapshot versioning.</p>
    ${ep("GET", "/profile/cloud-saves/snapshots", "auth", "Latest snapshot for a game.",
      `<dl class="params"><dt>?shop</dt><dd>Shop ID</dd><dt>?objectId</dt><dd>Game ID</dd></dl>`)}
    ${ep("POST", "/profile/cloud-saves/prepare-snapshot", "auth", "Prepare snapshot. Returns upload URLs for new blobs.",
      `{"shop":"steam","objectId":"570","snapshotHash":"abc...","baseVersion":0,"variants":[],"files":[...]}`)}
    ${ep("POST", "/profile/cloud-saves/commit-snapshot", "auth", "Commit a prepared snapshot.",
      `{"pendingSnapshotId":"uuid"}`)}
    ${ep("GET", "/profile/cloud-saves/snapshot-download-urls", "auth", "Download URLs for a snapshot.",
      `<dl class="params"><dt>?snapshotId</dt><dd>Snapshot ID</dd></dl>`)}
    ${ep("GET", "/profile/cloud-saves/snapshot-restore-manifest", "auth", "Full restore manifest.")}
    ${ep("DELETE", "/profile/cloud-saves/snapshots", "auth", "Delete all cloud save data for a game.")}
  </section>

  <hr>

  <section class="section" id="reviews">
    <h2>Reviews</h2>
    ${ep("GET", "/games/:shop/:objectId/reviews", "public", "List reviews for a game.",
      `<dl class="params"><dt>?take</dt><dd>Limit (20)</dd><dt>?skip</dt><dd>Offset (0)</dd><dt>?sortBy</dt><dd>createdAt, score, or upvotes</dd></dl>`)}
    ${ep("GET", "/games/:shop/:objectId/reviews/check", "auth", "Check if you reviewed this game.")}
    ${ep("POST", "/games/:shop/:objectId/reviews", "auth", "Create or update your review.",
      `{"reviewHtml":"<p>Great!</p>","score":8}`)}
    ${ep("DELETE", "/games/:shop/:objectId/reviews/:reviewId", "auth", "Delete your review.")}
    ${ep("PUT", "/games/:shop/:objectId/reviews/:reviewId/:voteType", "auth", "Upvote/downvote a review (toggle).")}
    ${ep("GET", "/games/:shop/:objectId/reviews/:reviewId/answers", "public", "List answers to a review.")}
    ${ep("POST", "/games/:shop/:objectId/reviews/:reviewId/answers", "auth", "Post an answer.",
      `{"answerHtml":"<p>Nice</p>"}`)}
    ${ep("PUT", "/games/:shop/:objectId/reviews/:reviewId/answers/:answerId/:voteType", "auth", "Upvote/downvote answer.")}
    ${ep("DELETE", "/games/:shop/:objectId/reviews/:reviewId/answers/:answerId", "auth", "Delete your answer.")}
  </section>

  <hr>

  <section class="section" id="artifacts">
    <h2>Artifacts</h2>
    <p>Cloud save artifacts — tar archives via pre-signed URLs.</p>
    ${ep("POST", "/profile/games/artifacts", "auth", "Create artifact and get upload URL.")}
    ${ep("GET", "/profile/games/artifacts", "auth", "List artifacts for a game.",
      `<dl class="params"><dt>?objectId</dt><dd>Game ID</dd><dt>?shop</dt><dd>Shop</dd></dl>`)}
    ${ep("POST", "/profile/games/artifacts/:id/download", "auth", "Get download URL.")}
    ${ep("DELETE", "/profile/games/artifacts/:id", "auth", "Delete an artifact.")}
    ${ep("PUT", "/profile/games/artifacts/:id/freeze", "auth", "Freeze (prevent deletion).")}
    ${ep("PUT", "/profile/games/artifacts/:id/unfreeze", "auth", "Unfreeze.")}
  </section>

  <hr>

  <section class="section" id="admin">
    <h2>Admin</h2>
    <p>Endpoints requiring admin role. Check via <code>GET /profile/me</code> → <code>roles</code> field.</p>
    ${ep("PUT", "/settings/global-accent-color", "admin", "Set the global accent color for all users.",
      `{"color":"#d4a574"}`, `{"ok":true,"color":"#d4a574"}`)}
    ${ep("DELETE", "/settings/global-accent-color", "admin", "Reset global accent color to default.",
      undefined, `{"ok":true}`)}
  </section>

  <hr>

  <section class="section" id="errors">
    <h2>Error Responses</h2>
    <p>All errors: <code>{"error": "message"}</code></p>
    <h3>Status codes</h3>
    <div class="endpoint">
      <p class="desc"><strong>400</strong> — Bad request<br>
      <strong>401</strong> — Unauthorized<br>
      <strong>403</strong> — Forbidden (admin required)<br>
      <strong>404</strong> — Not found<br>
      <strong>409</strong> — Conflict<br>
      <strong>500</strong> — Internal server error</p>
    </div>
  </section>`;
}

function docsPage(isAuthenticated: boolean) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Documentation — Hydra Self-Hosted</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet"><style>${DOCS_CSS}</style></head><body>
<div class="container">
  <div class="hero">
    <h1>⬡ Hydra Self-Hosted API</h1>
    <p>REST API for managing profiles, game libraries, cloud saves, and more.</p>
  </div>
  ${isAuthenticated ? fullDocs() : publicDocsOnly()}
  <hr>
  <p style="font-size:11px;color:var(--text-2);margin-top:16px">Powered by <a href="https://github.com/entitybtw/hydra-selfhosted">Hydra Self-Hosted</a></p>
</div>
</body></html>`;
}

export async function docsRoutes(app: FastifyInstance) {
  app.get("/docs", async (req: FastifyRequest<{ Querystring: { all?: string } }>, reply: FastifyReply) => {
    // Check if user wants full docs via query param
    if (req.query.all === "1") {
      // Check cookie auth
      const token = (req as any).cookies?.["web_token"];
      if (token) {
        try {
          verifyToken(token, "access");
          return reply.type("text/html").send(docsPage(true));
        } catch {}
      }
      // Not authenticated — redirect to dashboard to login
      return reply.redirect("/web/dashboard");
    }

    // Default: check auth for full vs public docs
    let isAuthenticated = false;
    const token = (req as any).cookies?.["web_token"];
    if (token) {
      try {
        verifyToken(token, "access");
        isAuthenticated = true;
      } catch {}
    }

    return reply.type("text/html").send(docsPage(isAuthenticated));
  });
}
