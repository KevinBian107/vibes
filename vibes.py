"""vibes — list the available vibes in this repo.

Each top-level directory (excluding assets/, shared/, .git/, etc.) that contains
a README.md is treated as a vibe. Each vibe's README explains how to run it.

Usage:
    python vibes.py           # list vibes
    python vibes.py <name>    # print that vibe's README
"""

import sys
from pathlib import Path

REPO = Path(__file__).parent
SKIP = {"assets", "shared", "__pycache__"}


def discover_vibes() -> list[Path]:
    vibes = []
    for p in sorted(REPO.iterdir()):
        if not p.is_dir() or p.name.startswith(".") or p.name in SKIP:
            continue
        if (p / "README.md").exists():
            vibes.append(p)
    return vibes


def first_line_summary(readme: Path) -> str:
    for line in readme.read_text().splitlines():
        s = line.strip()
        if s and not s.startswith("#") and not s.startswith("<"):
            return s
    return ""


def main():
    vibes = discover_vibes()

    if len(sys.argv) > 1:
        name = sys.argv[1]
        match = next((v for v in vibes if v.name == name), None)
        if not match:
            print(f"unknown vibe: {name}")
            print("available:", ", ".join(v.name for v in vibes))
            sys.exit(1)
        print((match / "README.md").read_text())
        return

    print("vibes in this repo:\n")
    for v in vibes:
        print(f"  {v.name:<20} {first_line_summary(v / 'README.md')}")
    print("\nrun `python vibes.py <name>` to see how to launch one.")


if __name__ == "__main__":
    main()
