# Remote GPU Cluster Dashboard

A browser-based dashboard for monitoring remote GPU clusters over SSH. View GPU/CPU/RAM metrics, running processes, run terminal commands, and launch Claude Code sessions — all from a single browser window instead of juggling multiple SSH sessions.

## Features

- **Overview** — All clusters at a glance with GPU utilization, memory, CPU load, RAM, and disk usage
- **GPU Detail** — Per-GPU stats from `nvidia-smi` in a grid layout: utilization, memory, temperature, power, and running processes
- **Process Viewer** — Sortable, filterable process table (`ps aux`)
- **Interactive Terminal** — Tabbed terminal emulator (xterm.js) with one tab per cluster, auto-navigates to project directory and attaches to screen sessions
- **Claude Code** — Dedicated tab to launch Claude Code on any cluster with a file explorer sidebar and markdown viewer
- **File Explorer** — Browse remote project files with rendered markdown previews
- **Dark / Light Mode** — VS Code-inspired themes, toggle with emoji button, preference saved across sessions

## Architecture

```
browser <--WebSocket--> FastAPI <--SSH/paramiko--> clusters
browser <---REST API--> FastAPI <--SSH/paramiko--> clusters
```

- **Backend**: Python FastAPI with paramiko for SSH
- **Frontend**: Vanilla HTML/CSS/JS with xterm.js and marked.js loaded from CDN (no npm, no build step)
- **Auth**: SSH password entered once in the browser, held in server memory only (never written to disk)

## Setup

```bash
conda env create -f environment.yml
conda activate gpu-dashboard
```

## Usage

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Open http://localhost:8000, enter your SSH password, and the dashboard connects to all configured clusters.

## Configuration

All settings live in `config.yaml`:

```yaml
server:
  host: 0.0.0.0
  port: 8000

project:
  directory: /home/jovyan/vast/kaiwen/track-mjx   # file explorer root, terminal auto-cd
  screen_session: train-vqvae                      # auto-attach in Terminal tab
  claude_screen_session: claude                    # screen session for Claude tab
  claude_user: devuser                             # su to this user for Claude

clusters:
  my-cluster:
    host: 10.0.0.1
    port: 22
    username: root
```

- `project.directory` controls the file explorer, terminal auto-cd, and Claude tab working directory
- `project.screen_session` is auto-attached in the Terminal tab if it exists
- `clusters` defines SSH connection targets (host, port, username)

## Project Structure

```
config.yaml         # All configuration (clusters, project, server)
config.py           # Loads config.yaml into Python
app.py              # FastAPI app — REST routes, WebSocket terminal, file browser, metric parsing
ssh_manager.py      # SSH connection pool & command execution via paramiko
environment.yml     # Conda environment (fastapi, uvicorn, paramiko, pyyaml)
static/
  index.html        # Single-page dashboard UI
  style.css         # VS Code-inspired dark/light theme styles
  app.js            # Frontend: metrics polling, process table, xterm.js terminals, file explorer
docs/
  vqvae.md          # VQVAE training quick reference (config overrides, troubleshooting)
```
