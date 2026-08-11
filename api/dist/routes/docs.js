"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.docsRoutes = docsRoutes;
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
  .nav { margin-bottom: 32px; }
  .nav a {
    font-size: 13px;
    color: var(--text-1);
    margin-right: 16px;
  }
  .nav a:hover { color: var(--accent); }
  .section { scroll-margin-top: 24px; }
  .hero { margin-bottom: 32px; }
  .hero h1 { margin-bottom: 4px; }
  .hero p { color: var(--text-2); font-size: 13px; }
  .response-label { font-family: var(--font-mono); font-size: 11px; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 12px; margin-bottom: 4px; }
`;
function docsPage() {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Documentation — Hydra Self-Hosted</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet"><style>${DOCS_CSS}</style></head><body>
<div class="container">
  <div class="hero">
    <h1>⬡ Hydra Self-Hosted API</h1>
    <p>REST API for managing profiles, game libraries, cloud saves, and more.</p>
  </div>

  <nav class="nav">
    <a href="#authentication">Authentication</a>
    <a href="#public">Public</a>
    <a href="#profile">Profile</a>
    <a href="#games">Games</a>
    <a href="#friends">Friends</a>
    <a href="#cloud-saves">Cloud Saves</a>
    <a href="#reviews">Reviews</a>
    <a href="#artifacts">Artifacts</a>
    <a href="#errors">Errors</a>
  </nav>

  <section class="section" id="authentication">
    <h2>Authentication</h2>
    <p>Most endpoints require a Bearer token in the <code>Authorization</code> header. Obtain tokens via the register or login endpoints.</p>
    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/auth/register</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Create a new account.</p>
      <pre><code>{
  "username": "myname",
  "password": "mypassword"
}</code></pre>
      <p class="response-label">Response 200</p>
      <pre><code>{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 2592000
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/auth/login</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Sign in with existing credentials.</p>
      <pre><code>{
  "username": "myname",
  "password": "mypassword"
}</code></pre>
      <p class="response-label">Response 200</p>
      <pre><code>{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 2592000
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/auth/refresh</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Refresh an expired access token.</p>
      <pre><code>{
  "refreshToken": "eyJ..."
}</code></pre>
      <p class="response-label">Response 200</p>
      <pre><code>{
  "accessToken": "eyJ...",
  "expiresIn": 2592000
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/auth/logout</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Logout (client discards token).</p>
      <pre><code>{ "ok": true }</code></pre>
    </div>
  </section>

  <hr>

  <section class="section" id="public">
    <h2>Public Endpoints</h2>
    <p>These endpoints are available at <code>/api</code> and require no authentication.</p>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/api</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">API info and endpoint listing.</p>
      <p class="response-label">Response 200</p>
      <pre><code>{
  "name": "Hydra Self-Hosted API",
  "version": "1.0.0",
  "docs": "/docs",
  "endpoints": { ... }
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/api/users/:username</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Get a user's public profile by username.</p>
      <dl class="params">
        <dt>:username</dt><dd>The user's username (URL param)</dd>
      </dl>
      <p class="response-label">Response 200</p>
      <pre><code>{
  "username": "entitybtw",
  "displayName": "Entity",
  "bio": "hello",
  "profileImageUrl": "https://...",
  "backgroundImageUrl": "https://...",
  "steamId": "76561198...",
  "accentColor": "#d4a574",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "stats": {
    "totalGames": 42,
    "totalHours": 1234,
    "steamHours": 800
  },
  "currentGame": {
    "title": "Dota 2",
    "shop": "steam",
    "sessionDurationInSeconds": 1800
  }
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/api/users/:username/stats</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Detailed stats for a user.</p>
      <p class="response-label">Response 200</p>
      <pre><code>{
  "totalGames": 42,
  "totalPlayTimeInSeconds": 4442400,
  "totalHours": 1234,
  "achievements": 156,
  "byShop": {
    "launcher": { "games": 10, "playtime": 100000 },
    "steam": { "games": 32, "playtime": 4342400 }
  }
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/api/users/:username/library</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Paginated game library for a user.</p>
      <dl class="params">
        <dt>?skip</dt><dd>Offset (default 0)</dd>
        <dt>?take</dt><dd>Limit, max 100 (default 30)</dd>
        <dt>?sortBy</dt><dd><code>title</code> (default) or <code>playedRecently</code></dd>
      </dl>
      <p class="response-label">Response 200</p>
      <pre><code>{
  "games": [
    {
      "id": "...",
      "objectId": "570",
      "shop": "steam",
      "title": "Dota 2",
      "playTimeInMilliseconds": 123456789000,
      "lastTimePlayed": "2024-06-01T12:00:00.000Z",
      "isFavorite": false,
      "isPinned": true
    }
  ],
  "total": 42,
  "skip": 0,
  "take": 30
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/api/users/:username/games</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Simple game list (alias for library).</p>
      <dl class="params">
        <dt>?skip</dt><dd>Offset (default 0)</dd>
        <dt>?take</dt><dd>Limit, max 100 (default 30)</dd>
      </dl>
      <p class="response-label">Response 200</p>
      <pre><code>[
  {
    "id": "...",
    "objectId": "570",
    "shop": "steam",
    "title": "Dota 2",
    "playTimeInMilliseconds": 123456789000,
    "lastTimePlayed": "2024-06-01T12:00:00.000Z",
    "isFavorite": false,
    "isPinned": true
  }
]</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/api/games/:shop/:objectId/achievements</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Steam achievements for a game.</p>
      <p class="response-label">Response 200</p>
      <pre><code>[
  {
    "name": "first_blood",
    "displayName": "First Blood",
    "description": "Get your first kill",
    "icon": "https://...",
    "iconGray": "https://..."
  }
]</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/api/health</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Health check.</p>
      <pre><code>{ "status": "ok", "timestamp": "2024-06-01T12:00:00.000Z" }</code></pre>
    </div>
  </section>

  <hr>

  <section class="section" id="profile">
    <h2>Profile (Authenticated)</h2>
    <p>Requires <code>Authorization: Bearer &lt;token&gt;</code> header.</p>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/me</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Get your own profile.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-patch">PATCH</span>
        <span class="path">/profile</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Update your profile fields.</p>
      <pre><code>{
  "displayName": "New Name",
  "bio": "New bio",
  "profileImageUrl": "https://...",
  "backgroundImageUrl": "https://..."
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/users/:userId</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Full user profile by ID (with friends, badges, recent games, current game).</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/users/:userId/stats</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">User stats by ID.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/users/:userId/library</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">User library by ID (with pinned games separated).</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/users/:userId/reviews</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">User's reviews.</p>
    </div>
  </section>

  <hr>

  <section class="section" id="games">
    <h2>Games (Authenticated)</h2>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/profile/games</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Create or update a single game entry.</p>
      <pre><code>{
  "objectId": "570",
  "shop": "steam",
  "title": "Dota 2",
  "playTimeInMilliseconds": 0,
  "lastTimePlayed": "2024-06-01T12:00:00.000Z"
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/profile/games/batch</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Batch upsert games (array of game objects).</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/games</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">List your games with pagination.</p>
      <dl class="params">
        <dt>?skip</dt><dd>Offset (default 0)</dd>
        <dt>?take</dt><dd>Limit (default 30)</dd>
      </dl>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/:shop/:objectId</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Update playtime or title for a game.</p>
      <pre><code>{
  "playTimeInSeconds": 12345,
  "playTimeDeltaInSeconds": 60,
  "lastTimePlayed": "2024-06-01T12:00:00.000Z",
  "title": "Dota 2",
  "executablePath": "/path/to/game"
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/:shop/:objectId/pin</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Pin a game to your profile.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/:shop/:objectId/unpin</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Unpin a game.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/:shop/:objectId/favorite</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Mark a game as favorite.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/:shop/:objectId/unfavorite</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Remove favorite mark.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-delete">DELETE</span>
        <span class="path">/profile/games/:remoteId</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Soft-delete a game from your library.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/achievements</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Sync achievements for a game.</p>
      <pre><code>{
  "id": "remote-game-id",
  "achievements": [
    { "name": "achievement_name", "unlockTime": 1717200000 }
  ]
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/:shop/:objectId/achievements</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Sync achievements by shop/objectId.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/games/:shop/:objectId/achievements</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">Get available achievements for a Steam game.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/games/:shop/:objectId/stats</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Get stats for a specific game (your playtime, total players).</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/games/:shop/:objectId</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Game details (proxied from official Hydra API).</p>
    </div>
  </section>

  <hr>

  <section class="section" id="friends">
    <h2>Friends (Authenticated)</h2>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/users/search?q=</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Search users by username or display name.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/friends</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">List your friends.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/profile/friends/requests</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Send a friend request.</p>
      <pre><code>{ "userId": "target-user-id" }</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/friends/requests/received</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Incoming friend requests.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/friends/requests/sent</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Outgoing friend requests.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/friends/requests/:id/accept</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Accept a friend request.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-delete">DELETE</span>
        <span class="path">/profile/friends/:id</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Remove a friend or decline a request.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/notifications/count</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Count of pending friend requests.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/blocks</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">List blocked users.</p>
    </div>
  </section>

  <hr>

  <section class="section" id="cloud-saves">
    <h2>Cloud Saves (Authenticated)</h2>
    <p>Cloud saves use a content-addressable blob store with snapshot versioning.</p>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/cloud-saves/snapshots</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Latest snapshot for a game.</p>
      <dl class="params">
        <dt>?shop</dt><dd>Shop identifier</dd>
        <dt>?objectId</dt><dd>Game object ID</dd>
      </dl>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/profile/cloud-saves/prepare-snapshot</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Prepare a new snapshot. Returns upload URLs for blobs not yet on the server.</p>
      <pre><code>{
  "shop": "steam",
  "objectId": "570",
  "snapshotHash": "abc123...",
  "baseVersion": 0,
  "variants": [...],
  "files": [
    {
      "variantId": "def456...",
      "rawPath": "C:/saves/save.dat",
      "relativePath": "save.dat",
      "hash": "abc123...",
      "sizeBytes": 1024,
      "lastModifiedAt": "2024-06-01T12:00:00.000Z"
    }
  ],
  "customPathRawPaths": []
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/profile/cloud-saves/commit-snapshot</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Commit a prepared snapshot after uploading blobs.</p>
      <pre><code>{ "pendingSnapshotId": "uuid" }</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/cloud-saves/snapshot-download-urls</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Get download URLs for all files in a snapshot.</p>
      <dl class="params">
        <dt>?snapshotId</dt><dd>Snapshot ID</dd>
      </dl>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/cloud-saves/snapshot-restore-manifest</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Full restore manifest for a snapshot.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-delete">DELETE</span>
        <span class="path">/profile/cloud-saves/snapshots</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Delete all cloud save data for a game.</p>
    </div>
  </section>

  <hr>

  <section class="section" id="reviews">
    <h2>Reviews (Authenticated)</h2>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/games/:shop/:objectId/reviews</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">List reviews for a game.</p>
      <dl class="params">
        <dt>?take</dt><dd>Limit (default 20)</dd>
        <dt>?skip</dt><dd>Offset (default 0)</dd>
        <dt>?sortBy</dt><dd><code>createdAt</code>, <code>score</code>, or <code>upvotes</code></dd>
      </dl>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/games/:shop/:objectId/reviews/check</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Check if you already reviewed this game.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/games/:shop/:objectId/reviews</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Create or update your review for a game.</p>
      <pre><code>{
  "reviewHtml": "<p>Great game!</p>",
  "score": 8
}</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-delete">DELETE</span>
        <span class="path">/games/:shop/:objectId/reviews/:reviewId</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Delete your review.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/games/:shop/:objectId/reviews/:reviewId/:voteType</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Upvote or downvote a review. <code>:voteType</code> is <code>upvote</code> or <code>downvote</code>. Toggle: same vote removes it.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/games/:shop/:objectId/reviews/:reviewId/answers</span>
        <span class="auth-badge auth-public">Public</span>
      </div>
      <p class="desc">List answers to a review.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/games/:shop/:objectId/reviews/:reviewId/answers</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Post an answer to a review.</p>
      <pre><code>{ "answerHtml": "<p>Nice review</p>" }</code></pre>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/games/:shop/:objectId/reviews/:reviewId/answers/:answerId/:voteType</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Upvote or downvote an answer.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-delete">DELETE</span>
        <span class="path">/games/:shop/:objectId/reviews/:reviewId/answers/:answerId</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Delete your answer.</p>
    </div>
  </section>

  <hr>

  <section class="section" id="artifacts">
    <h2>Artifacts (Authenticated)</h2>
    <p>Cloud save artifacts — tar archives uploaded and downloaded via pre-signed URLs.</p>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/profile/games/artifacts</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Create an artifact record and get an upload URL.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">GET</span>
        <span class="path">/profile/games/artifacts</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">List your artifacts for a game.</p>
      <dl class="params">
        <dt>?objectId</dt><dd>Game object ID</dd>
        <dt>?shop</dt><dd>Shop identifier</dd>
      </dl>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-post">POST</span>
        <span class="path">/profile/games/artifacts/:id/download</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Get a download URL for an artifact.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-delete">DELETE</span>
        <span class="path">/profile/games/artifacts/:id</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Delete an artifact.</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/artifacts/:id/freeze</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Freeze an artifact (prevent deletion).</p>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-put">PUT</span>
        <span class="path">/profile/games/artifacts/:id/unfreeze</span>
        <span class="auth-badge auth-required">Auth</span>
      </div>
      <p class="desc">Unfreeze an artifact.</p>
    </div>
  </section>

  <hr>

  <section class="section" id="errors">
    <h2>Error Responses</h2>
    <p>All errors follow the same shape:</p>
    <pre><code>{
  "error": "error message"
}</code></pre>
    <h3>Common status codes</h3>
    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method method-get">401</span>
        <span class="path">Unauthorized — missing or invalid token</span>
      </div>
      <div class="endpoint-header">
        <span class="method method-get">404</span>
        <span class="path">Not found — resource does not exist</span>
      </div>
      <div class="endpoint-header">
        <span class="method method-get">409</span>
        <span class="path">Conflict — resource already exists</span>
      </div>
      <div class="endpoint-header">
        <span class="method method-get">400</span>
        <span class="path">Bad request — invalid input</span>
      </div>
      <div class="endpoint-header">
        <span class="method method-get">500</span>
        <span class="path">Internal server error</span>
      </div>
    </div>
  </section>

  <hr>
  <p style="font-size:11px;color:var(--text-2);margin-top:16px">Powered by <a href="https://github.com/entitybtw/hydra-selfhosted">Hydra Self-Hosted</a></p>
</div>
</body></html>`;
}
async function docsRoutes(app) {
    app.get("/docs", async (_req, reply) => {
        return reply.type("text/html").send(docsPage());
    });
}
