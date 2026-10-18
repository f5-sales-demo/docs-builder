"""Require the current build receipt to match the latest published theme."""

import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


def verify_latest_source(manifest: dict[str, Any], release: dict[str, Any]) -> str:
    """Reject stale source even when its local receipts are internally consistent."""
    tag = release.get("tag_name")
    if not isinstance(tag, str) or not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        message = "Latest theme release has no valid version identity"
        raise ValueError(message)
    if release.get("draft") is not False or release.get("prerelease") is not False:
        message = "Latest theme must be a completed published release"
        raise ValueError(message)
    sources = [
        entry
        for entry in manifest["artifacts"]
        if entry["name"] == "@f5-sales-demo/docs-theme"
    ]
    if len(sources) != 1:
        message = "The theme must have exactly one source receipt"
        raise ValueError(message)
    if sources[0].get("version") != tag[1:]:
        message = f"Theme source must be refreshed to latest {tag}"
        raise ValueError(message)
    return tag[1:]


def main() -> None:
    """Read latest independently of the captured build source."""
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "vendor/npm/manifest.json").read_text())
    headers = {"Accept": "application/vnd.github+json", "Cache-Control": "no-cache"}
    token = os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(
        "https://api.github.com/repos/f5-sales-demo/docs-theme/releases/latest",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 -- Fixed HTTPS GitHub endpoint.
        release = json.load(response)
    version = verify_latest_source(manifest, release)
    print(f"Latest docs-theme source verified: {version}")


if __name__ == "__main__":
    main()
