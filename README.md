<p align="center">
  <img src="assets/logo.svg" alt="vibes" width="260">
</p>

<p align="center">
  <em>a collection of small tools and hacks — all sharing one environment, one repo, many vibes.</em>
</p>

---

## What this is

`vibes` is a monorepo of lightweight, self-contained tools I reach for while doing research — dashboards, viewers, visualizers, small utilities. Each one lives in its own top-level directory and is independent; they just share a single conda environment so nothing is ever more than `conda activate vibes` away.

Inspired by [@LeoMeow123/vibes](https://github.com/LeoMeow123/vibes) — the idea being that research code accumulates a lot of *little* things, and they deserve a home together rather than scattered across a dozen orphan repos.

## Layout

```
vibes/
├── README.md              # this file
├── environment.yml        # shared conda env for every vibe
├── assets/                # logos, shared static assets
├── shared/                # reusable helpers (grows as vibes overlap)
├── vibes.py               # discover / list the available vibes
│
├── gpu-dashboard/         # browser dashboard for remote GPU clusters
│   └── README.md
│
└── <your next vibe>/
    └── README.md
```

Every vibe is a directory with its own `README.md` describing what it is and how to run it. The top-level `vibes.py` script discovers them.

## Setup (once)

```bash
conda env create -f environment.yml
conda activate vibes
```

The `vibes` env is the union of dependencies across all vibes. Add what your vibe needs to `environment.yml` when you add a new one.

## Using a vibe

List what's here:

```bash
python vibes.py
```

Read a specific vibe's instructions:

```bash
python vibes.py gpu-dashboard
```

Then run it per its README.

## Current vibes

| vibe | what it does |
|---|---|
| [`gpu-dashboard`](gpu-dashboard/) | browser dashboard for monitoring remote GPU clusters (RunAI + DSMLP) over SSH |

## Adding a new vibe

1. Create a new top-level directory: `mkdir my-vibe`
2. Drop in a `README.md` that explains what it does and how to run it
3. Add any new dependencies to the root `environment.yml`
4. (Optional) If it imports from a previous vibe, consider promoting the shared code to `shared/`

Keep vibes small and self-contained. A vibe shouldn't need a framework — it just needs to work.

