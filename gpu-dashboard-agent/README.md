# gpu-dashboard-agent

A server-less GPU monitor — workstation agents push `nvidia-smi` metrics to a shared GitHub Gist, and a static page reads it.

> This vibe is a direct reimplementation of [@LeoMeow123/vibes/gpu-dashboard](https://github.com/LeoMeow123/vibes/tree/main/gpu-dashboard). All architectural credit to **Leo** — the push-based, server-less design is his. This version keeps the same idea with minor UX adjustments (URL param login, optional PAT for higher rate limits, styling to match the `vibes` repo). Small Python agents run on each GPU workstation and push `nvidia-smi` metrics to a **shared GitHub Gist** every 30 seconds. A static HTML dashboard reads the Gist and renders the fleet in a single page.

No SSH, no VPN, no FastAPI, no server of any kind. The dashboard is pure HTML/JS and can be hosted anywhere (GitHub Pages, a laptop, a phone bookmark) because all state lives in the Gist.

```
workstation (nvidia-smi + agent.py)  ──►  GitHub Gist (JSON)  ──►  index.html (anywhere)
                    every 30s                                       every 30s
```

## Setup friction (the Leo way)

This design trades friction for simplicity. Once, you:

1. Create a **GitHub Gist** (secret is fine — the URL is the secret). Add a file called `metrics.json` with contents `{}`.
2. Create a **GitHub Personal Access Token** with `gist` scope only. Copy it.
3. Copy the Gist ID + token into a `config.json` on every workstation you want to monitor.
4. Paste the Gist ID into the dashboard (or use `?gist=<id>` in the URL) — it remembers.

That's it. No usernames, no passwords, no 2FA, no SSH keys. The Gist is the login.

## From scratch — full walkthrough

Follow these four steps in order. The first two are one-time GitHub setup; the last two are repeated per workstation.

### 1. Create the Gist (one time)

1. Go to <https://gist.github.com>
2. In the **Filename** field, enter `metrics.json`
3. In the content box, paste: `{}`
4. Scroll down and click **Create secret gist** (don't use "Create public gist" unless you want anyone who guesses the URL to see your workstation data)
5. Look at the URL in your address bar — it'll look like
   `https://gist.github.com/<your-username>/0123456789abcdef0123456789abcdef`
   **Copy that last hex string — that's your `gist_id`.** Save it somewhere you can find later.

### 2. Create the Personal Access Token (one time)

1. Go to <https://github.com/settings/tokens> (Developer settings → Personal access tokens → Tokens (classic))
2. Click **Generate new token (classic)**
3. Name it something like `gpu-dashboard-agent`
4. Set expiration (90 days or longer is fine — note it in your calendar)
5. Under **Select scopes**, check **only** `gist` (nothing else — this token can't touch anything besides Gists)
6. Click **Generate token**
7. **Copy the token now** (starts with `ghp_...`) — GitHub won't show it again. Treat it like a password.

### 3. Install + run the agent on each workstation

SSH into a GPU workstation. Python 3.8+ is already there on any modern GPU box; you don't need to install anything.

```bash
# pick a home for the agent (anywhere you have write access)
mkdir -p ~/gpu-agent && cd ~/gpu-agent

# grab the two files you need from this repo
curl -O https://raw.githubusercontent.com/KevinBian107/vibes/master/gpu-dashboard-agent/agent/agent.py
curl -O https://raw.githubusercontent.com/KevinBian107/vibes/master/gpu-dashboard-agent/agent/config.example.json

# make a real config and lock it down
cp config.example.json config.json
chmod 600 config.json
```

**Now edit `config.json`** — open it in any text editor you have available on that box (`nano config.json`, `vi config.json`, or if `$EDITOR` is set, `"$EDITOR" config.json`). Fill in the four fields below; everything on the right of `//` is a comment — delete those before saving since JSON doesn't allow comments:

```jsonc
{
  "gist_id":          "0123456789abcdef0123456789abcdef",  // just the hex ID, NOT the full https://gist.github.com/... URL
  "github_token":     "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",  // the PAT from step 2 (scope: gist)
  "workstation_name": "salk-ws-1",                         // any label — must be unique per machine
  "interval_seconds": 30,                                  // how often to push; 30s is usually fine
  "gist_file":        "metrics.json"                       // leave as-is unless you named your Gist file something else
}
```

A common first-time mistake: pasting the full Gist URL into `gist_id` instead of just the hex string at the end. The agent will normalize it automatically now, but the cleanest value is the bare ID.

Pick a unique `workstation_name` per machine — that's the key each agent writes to, and what shows up as the card title on the dashboard. If two agents push with the same name, they overwrite each other and only one card shows up.

**Shared-volume / multi-pod setups (e.g. RunAI pods mounting the same `vast/`):** you probably want one `config.json` that works on *every* pod. In that case, either:

- Leave `workstation_name` out of the config entirely → each pod defaults to its own `socket.gethostname()`.
- Or use the `${hostname}` placeholder: `"workstation_name": "${hostname}"` (what the example config now ships with).
- Or set the `WORKSTATION_NAME` env var per pod: `WORKSTATION_NAME=vqmimic-0 python agent.py config.json` — the env var overrides whatever the config says.

Run it:

```bash
python agent.py config.json
```

You should see one line every ~30 seconds:

```
[agent] salk-ws-1 → gist 0123...cdef every 30s
[agent] 2026-04-24T12:34:56+00:00 ok cpu 12.3% mem 4200/257000mb gpus=4
```

Leave it running in `screen` / `tmux` so it survives logout:

```bash
screen -dmS gpu-agent python agent.py config.json
# check later: screen -r gpu-agent   (detach with Ctrl-A D)
```

Repeat step 3 on every workstation you want monitored.

### 4. Open the dashboard

Pick one of three hosting options. For a real "log on from anywhere" setup, use **Option C (GitHub Pages)** — that's the one that gives you a real URL you can bookmark on your phone.

#### Option A — just open the file (local, quick-check)

```bash
cd gpu-dashboard-agent && open index.html    # macOS
# or double-click index.html in your file explorer
```

Fine for a quick check. Some browsers are picky about `fetch()` from `file://`, so if the page loads but never shows data, switch to option B.

#### Option B — local HTTP server (private to your machine)

```bash
cd gpu-dashboard-agent
python -m http.server 8000
```

Then visit <http://localhost:8000> in your browser. Same dashboard, served over HTTP so every browser is happy. Nothing leaves your laptop.

#### Option C — GitHub Pages (online, bookmark-able, recommended)

This gives you a real URL like `https://<you>.github.io/vibes/gpu-dashboard-agent/` that works from anywhere with no VPN and no server to keep running. One-time setup:

1. Make sure this repo is pushed to GitHub (e.g. `https://github.com/<you>/vibes`).
2. Go to your repo's **Settings → Pages** (direct link: `https://github.com/<you>/vibes/settings/pages`).
3. Under **Source**, pick **Deploy from a branch**.
4. Set **Branch** to your default branch (`master` or `main`) and **Folder** to `/ (root)`. Click **Save**.
5. Wait ~30–60 seconds. Refresh the Pages settings page — you'll see a green banner saying *"Your site is live at https://&lt;you&gt;.github.io/vibes/"*.
6. Your dashboard is at: `https://<you>.github.io/vibes/gpu-dashboard-agent/`

That URL is the one to bookmark. It's public, but the dashboard is useless without the Gist ID — and your Gist is unlisted, so only people you share the ID with can see metrics.

**Pages caveats:**

- Pushes to the default branch trigger a rebuild; it takes 30–90s before your edits are live.
- Pages caches aggressively — if you update `app.js`/`style.css` and don't see changes, hard-refresh with ⌘⇧R (Chrome/Safari) or ⌃⇧R (Windows/Linux).
- Want to revoke access? Switch Pages source to `None`. The URL goes 404 immediately.

#### Connecting the dashboard to your Gist

Once the page loads (from any of the three options above):

1. Paste your **gist_id** into the Gist ID field (just the hex string, not the URL — the page will strip the URL down for you either way)
2. (Optional) Paste a **GitHub PAT** with `gist` scope into the PAT field — raises the read rate limit from 60/hr → 5000/hr. Stored only in your browser's localStorage.
3. Click **Connect**.

The Gist ID is saved to localStorage so you only type it once. For a truly one-click bookmark, put the Gist ID in the URL:

```
https://<you>.github.io/vibes/gpu-dashboard-agent/?gist=<gist_id>
```

Now bookmark that URL. Every 30s the dashboard re-fetches the Gist and each workstation card refreshes.

## Components

```
gpu-dashboard-agent/
├── README.md
├── index.html            # static dashboard
├── style.css
├── app.js
└── agent/
    ├── agent.py          # stdlib-only — runs on each GPU workstation
    └── config.example.json
```

## Running an agent on a workstation

On each workstation (Python 3.8+, no pip install needed):

```bash
cp config.example.json config.json
chmod 600 config.json
nano config.json         # or: vi config.json  /  "${EDITOR:-nano}" config.json
                         # fill in gist_id, github_token, workstation_name

python agent.py config.json
```

Or keep it alive in a `screen` / `tmux` / systemd unit:

```bash
screen -dmS gpu-agent python agent.py config.json
```

The agent loops forever, scraping `/proc` + `nvidia-smi` and PATCHing the Gist's `metrics.json`. Each agent writes only its own key under `workstations.<workstation_name>`, merging with whatever other agents have reported.

## Running the dashboard

Any of these work — it's a plain static page:

```bash
# Option A: just open the file
open index.html              # macOS

# Option B: local HTTP server
python -m http.server 8000   # then http://localhost:8000

# Option C: GitHub Pages — serve the repo and visit /gpu-dashboard-agent/
```

Paste the Gist ID. Optionally paste a GitHub PAT (raises the 60 reads/hour limit to 5000/hour). Bookmark the URL with `?gist=<id>` for one-click access later.

## What's on the dashboard

One card per workstation, each showing:

- **Freshness dot** — green if last update < 90s, yellow < 5min, red otherwise
- **CPU / RAM / uptime** with live bars
- **Per-GPU** utilization, VRAM, temp, power draw
- **Processes** (collapsible) — GPU compute processes only, with user, runtime, VRAM, command

The page auto-pauses fetching when the browser tab is hidden (saves rate limit and spares your battery).

## Gist data shape

Agents collaboratively write this to `metrics.json`:

```jsonc
{
  "schema": 1,
  "updated_at": "2026-04-24T12:34:56+00:00",
  "workstations": {
    "salk-ws-1": {
      "hostname": "salk-ws-1",
      "updated_at": "2026-04-24T12:34:50+00:00",
      "uptime_seconds": 123456,
      "cpu_percent": 42.3, "nproc": 32, "load_1m": 8.1,
      "mem_total_mb": 257000, "mem_used_mb": 120000,
      "gpus": [ { "index": 0, "name": "A100", "utilization": 85, ... } ],
      "processes": [ { "pid": "12345", "user": "kbian", "command": "python train.py", ... } ]
    }
  }
}
```

## Security notes

- A **secret Gist** is unlisted but not private — anyone with the URL / ID can read it. Don't put secrets in metrics.
- The **PAT on each workstation** has `gist` scope only — it can write to any of your Gists, but nothing else on your GitHub account. Still, keep `config.json` at mode `600`.
- The **PAT pasted into the dashboard** (optional, client-side only) is stored in the browser's localStorage. It only needs read access — use a token with `gist` scope or even just `public_repo` if your Gist is public.

## Why this and not the other GPU vibe?

| | `gpu-dashboard-agent` (this) | `gpu-access-board` |
|---|---|---|
| needs a server | ❌ no | ✅ yes (FastAPI) |
| needs SSH credentials | ❌ no | ✅ yes (password / key + Duo) |
| can run terminals | ❌ no | ✅ yes |
| can launch Claude / files / processes | ❌ no | ✅ yes |
| works from a phone / random machine | ✅ yes | ⚠️ requires VPN + server |
| good for "glance at utilization from anywhere" | ✅ yes | overkill |
| good for "ssh in and train a model" | ❌ no | ✅ yes |

Use both. They complement each other.
