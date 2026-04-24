#!/usr/bin/env python3
"""gpu-dashboard-agent — push nvidia-smi + system metrics to a GitHub Gist.

Runs on a GPU workstation. Every N seconds, scrapes metrics and PATCHes a
shared Gist so the static dashboard can render them. Stdlib only — no pip
install needed on the workstation beyond whatever ships with Python 3.8+.

Usage:
    python agent.py path/to/config.json

Config schema (config.json):
    {
      "gist_id":          "<gist id>",        # required
      "github_token":     "ghp_xxx",          # required (scope: gist)
      "workstation_name": "salk-ws-1",        # optional (default: hostname)
      "interval_seconds": 30,                 # optional (default: 30)
      "gist_file":        "metrics.json"      # optional (default: metrics.json)
    }
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone


def _normalize_gist_id(raw: str) -> str:
    """Accept either a bare gist id or a full URL (https://gist.github.com/<user>/<id>)."""
    s = raw.strip().rstrip("/")
    if "/" in s:
        s = s.split("/")[-1]
    return s.split("#")[0].split("?")[0]


def _resolve_workstation_name(cfg_value: str | None) -> str:
    """Pick a per-pod name. Env var wins; then config; then hostname fallback.

    Supports `${hostname}` / `{hostname}` placeholders so a shared config file
    across multiple pods can still produce unique names per pod.
    """
    env = os.environ.get("WORKSTATION_NAME", "").strip()
    raw = (env or (cfg_value or "")).strip()
    if not raw:
        return socket.gethostname()
    hostname = socket.gethostname()
    return raw.replace("${hostname}", hostname).replace("{hostname}", hostname)


def read_config(path: str) -> dict:
    with open(path) as f:
        cfg = json.load(f)
    for key in ("gist_id", "github_token"):
        if not cfg.get(key):
            sys.exit(f"[agent] missing required config key: {key}")
    cfg["gist_id"] = _normalize_gist_id(cfg["gist_id"])
    cfg["workstation_name"] = _resolve_workstation_name(cfg.get("workstation_name"))
    cfg.setdefault("interval_seconds", 30)
    cfg.setdefault("gist_file", "metrics.json")
    return cfg


def run(cmd: str, timeout: int = 10) -> str:
    try:
        return subprocess.check_output(
            cmd, shell=True, text=True, timeout=timeout, stderr=subprocess.DEVNULL
        )
    except Exception:
        return ""


def _safe_float(s: str) -> float:
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def collect_system() -> dict:
    uptime = 0.0
    try:
        with open("/proc/uptime") as f:
            uptime = float(f.read().split()[0])
    except Exception:
        pass

    nproc = int(run("nproc").strip() or "1")
    load_1m = 0.0
    try:
        with open("/proc/loadavg") as f:
            load_1m = float(f.read().split()[0])
    except Exception:
        pass
    cpu_percent = min(round(load_1m / max(nproc, 1) * 100, 1), 100.0)

    mem_total_mb = mem_avail_mb = 0
    try:
        meminfo = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, _, v = line.partition(":")
                meminfo[k.strip()] = v.strip()
        mem_total_mb = int(meminfo["MemTotal"].split()[0]) // 1024
        mem_avail_mb = int(meminfo["MemAvailable"].split()[0]) // 1024
    except Exception:
        pass

    return {
        "uptime_seconds": round(uptime),
        "cpu_percent": cpu_percent,
        "nproc": nproc,
        "load_1m": load_1m,
        "mem_total_mb": mem_total_mb,
        "mem_used_mb": max(mem_total_mb - mem_avail_mb, 0),
    }


def collect_gpus() -> list:
    query = (
        "nvidia-smi --query-gpu="
        "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw"
        " --format=csv,noheader,nounits"
    )
    gpus = []
    for line in run(query).strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 7:
            continue
        gpus.append({
            "index": int(parts[0]),
            "name": parts[1],
            "utilization": _safe_float(parts[2]),
            "memory_used": _safe_float(parts[3]),
            "memory_total": _safe_float(parts[4]),
            "temperature": _safe_float(parts[5]),
            "power_draw": _safe_float(parts[6]),
        })
    return gpus


def collect_processes(limit: int = 10) -> list:
    """GPU compute processes enriched with user + elapsed time from ps."""
    out = run(
        "nvidia-smi --query-compute-apps=pid,used_memory,process_name"
        " --format=csv,noheader,nounits"
    )
    procs = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        pid = parts[0]
        ps_out = run(f"ps -p {pid} -o user=,etime=")
        ps_parts = ps_out.strip().split()
        user = ps_parts[0] if len(ps_parts) >= 1 else ""
        etime = ps_parts[1] if len(ps_parts) >= 2 else ""
        procs.append({
            "pid": pid,
            "user": user,
            "runtime": etime,
            "memory_mib": _safe_float(parts[1]),
            "command": parts[2],
        })
    return procs[:limit]


def snapshot(name: str) -> dict:
    return {
        "hostname": name,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **collect_system(),
        "gpus": collect_gpus(),
        "processes": collect_processes(),
    }


def github_request(method: str, url: str, token: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def push(cfg: dict, payload: dict) -> None:
    url = f"https://api.github.com/gists/{cfg['gist_id']}"
    try:
        gist = github_request("GET", url, cfg["github_token"])
        content = gist["files"].get(cfg["gist_file"], {}).get("content", "")
        current = json.loads(content) if content.strip() else {}
    except Exception:
        current = {}

    current.setdefault("schema", 1)
    current.setdefault("workstations", {})
    current["workstations"][cfg["workstation_name"]] = payload
    current["updated_at"] = payload["updated_at"]

    body = {"files": {cfg["gist_file"]: {"content": json.dumps(current, indent=2)}}}
    github_request("PATCH", url, cfg["github_token"], body)


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python agent.py <config.json>")
    cfg = read_config(sys.argv[1])
    print(
        f"[agent] {cfg['workstation_name']} → gist {cfg['gist_id']}"
        f" every {cfg['interval_seconds']}s",
        flush=True,
    )
    while True:
        try:
            payload = snapshot(cfg["workstation_name"])
            push(cfg, payload)
            print(
                f"[agent] {payload['updated_at']} ok "
                f"cpu {payload['cpu_percent']}% "
                f"mem {payload['mem_used_mb']}/{payload['mem_total_mb']}mb "
                f"gpus={len(payload['gpus'])}",
                flush=True,
            )
        except Exception as e:
            print(f"[agent] error: {e}", file=sys.stderr, flush=True)
        time.sleep(cfg["interval_seconds"])


if __name__ == "__main__":
    main()
