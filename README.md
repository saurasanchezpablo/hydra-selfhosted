# hydra-selfhosted

Self-hosted backend for the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork of Hydra Launcher.

Run your own server for cloud saves, accounts, profiles, and game data — no Hydra Cloud subscription needed.

## Features

### Accounts & profiles

- **Accounts** — register and log in with username and password
- **Public profile** — shareable page at `/u/username` with playtime, library, and recent activity
- **Avatar & banner** — upload and crop a profile picture and banner image
- **Bio and display name** — editable from the launcher or web dashboard
- **Accent color & custom CSS** — personalize your profile appearance
- **Steam integration** — connect your Steam account to show Steam hours and Steam library on your profile

### Library & game management

- **Cloud saves** — game save backups stored on your own server, unlimited slots
- **Pin games** — pin any game to the top of your profile; pinned state syncs to the launcher sidebar
- **Favorite games** — mark games as favorites; heart icon shown on library cards
- **Playtime tracking** — accurate playtime recorded per game and shown on profile
- **Recent activity** — last played games shown per tab (Hydra / Steam) with configurable visibility and section order

### Web dashboard

Full web interface at `http://your-server:3000`:

- Edit profile: avatar (with crop editor), banner, display name, bio
- Browse your Hydra library and Steam library (if connected)
- Pin and unpin games, mark favorites
- Toggle visibility of library and recent activity sections
- Reorder sections (library above or below recent activity) per tab
- Change password

### Optional proxies

| Feature | What it does |
|---|---|
| Reviews | Read and write game reviews stored on your server |

### Big Picture support

The [entitybtw/hydra](https://github.com/entitybtw/hydra) fork's Big Picture mode fully supports self-hosted accounts:

- **Self-hosted profile in Big Picture** — library, stats, friends, and recent activity all load correctly even when the server does not return optional fields
- **Dual accounts** — if you also have an official Hydra account, both avatars appear in the Big Picture sidebar; clicking the small official avatar opens that profile without affecting your self-hosted session

### Other

- **No subscription required** — all features work without Hydra Cloud
- **Friendships API stub** — enough for the launcher to work without errors
- **Download sources** — the launcher routes `/download-sources` to the official Hydra API automatically

## Requirements

- Docker + Docker Compose

## Setup

```bash
git clone https://github.com/entitybtw/hydra-selfhosted.git
cd hydra-selfhosted
cp .env.example .env
# edit .env — set API_TOKEN to a random secret string
docker compose up -d --build
```

The server runs on port 3000 by default.

## .env options

```env
API_TOKEN=your-random-secret        # required
PORT=3000
SESSION_TTL_DAYS=30                 # launcher session duration (default 30)
PUBLIC_URL=http://your-server:3000  # shown in the web dashboard
```

## Connecting to Hydra Launcher

1. Open the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork
2. **Settings → Integrations → Self-Hosted API**
3. Enter your server URL and `API_TOKEN`, click **Save**
4. A login window opens — register or sign in
5. The launcher connects automatically and syncs your library

## Data

Everything is stored in `./data/` — back this folder up to preserve all user data.

```
data/
  hydra.db        # SQLite database (users, games, achievements, artifacts)
  images/         # uploaded avatars and banners
  artifacts/      # cloud save archives
```

## Cloud save size limit

Cloud save uploads are capped at **50 MB** by default. To change the limit, set `MAX_SAVE_SIZE_MB` (in megabytes) in your `.env`:

```env
MAX_SAVE_SIZE_MB=100
```

Then restart the API (`docker compose up -d`). No code changes needed.

## Updating

```bash
git fetch origin && git checkout origin/main -- api/ docker-compose.yml && docker compose up --build -d
```

Your `.env` and `data/` are never touched by updates.
