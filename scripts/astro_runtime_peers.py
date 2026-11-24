"""Resolve an owned Markdown runtime pin against the exact Astro peer contract."""

import json
import re

# Fixed argument-array npm interface.
import subprocess  # nosec B404
from pathlib import Path
from typing import Any

MARKDOWN = "@astrojs/markdown-remark"
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
SEMVER = re.compile(
    r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    r"(?:-(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*)?"
    r"(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?"
)
RANGE = re.compile(r"[0-9v.xX*^~<>=| .-]{1,128}")


def require(condition: bool, message: str) -> None:
    """Reject inconsistent registry or lock metadata before reporting completion."""
    if not condition:
        raise ValueError(message)


def _view(npm: str, arguments: list[str]) -> Any:
    # Fixed npm read interface and argument array.
    result = subprocess.run(  # noqa: S603  # nosec B603
        [npm, "view", *arguments, "--json"],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    if len(result.stdout) > 1024 * 1024:
        require(False, "npm peer metadata exceeds the size bound")
    return json.loads(result.stdout)


def _versions(npm: str, requirement: str) -> set[str]:
    if not isinstance(requirement, str) or not RANGE.fullmatch(requirement):
        require(False, "invalid Astro Markdown peer range")
    value = _view(npm, [MARKDOWN + "@" + requirement, "version"])
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or any(
        not isinstance(v, str) or not SEMVER.fullmatch(v) for v in value
    ):
        require(False, "invalid npm Markdown version metadata")
    stable = {v for v in value if VERSION.fullmatch(v)}
    if not stable:
        require(False, "no stable Markdown version satisfies the peer range")
    return stable


def resolve_markdown_pin(
    package: dict[str, Any], theme: dict[str, Any], npm: str
) -> str | None:
    """Preserve a satisfied pin; change only an existing direct runtime companion."""
    dependencies = package.get("dependencies", {})
    if MARKDOWN not in dependencies or "astro" not in dependencies:
        return None
    astro = dependencies["astro"]
    current = dependencies[MARKDOWN]
    if not isinstance(astro, str) or not VERSION.fullmatch(astro):
        require(False, "Astro runtime must have an exact stable version")
    if not isinstance(current, str) or not VERSION.fullmatch(current):
        require(False, "Markdown runtime must have an exact stable version")
    metadata = _view(npm, ["astro@" + astro])
    if (
        not isinstance(metadata, dict)
        or metadata.get("name") != "astro"
        or metadata.get("version") != astro
        or not isinstance(metadata.get("peerDependencies", {}), dict)
    ):
        require(False, "Astro peer metadata identity differs from selected runtime")
    requirement = metadata.get("peerDependencies", {}).get(MARKDOWN)
    if requirement is None:
        return None
    candidates = _versions(npm, requirement)
    peers = theme.get("peerDependencies", {})
    if not isinstance(peers, dict):
        require(False, "invalid theme peer metadata")
    if MARKDOWN in peers:
        candidates &= _versions(npm, peers[MARKDOWN])
    if not candidates:
        require(False, "Astro and theme Markdown peer requirements are incompatible")
    selected = (
        current
        if current in candidates
        else max(candidates, key=lambda value: tuple(map(int, value.split("."))))
    )
    return selected if selected != current else None


def lock_matches_source(root: Path) -> bool:
    """A current theme does not prove an interrupted lock update completed."""
    lock_path = root / "package-lock.json"
    if not lock_path.is_file():
        return False
    package = json.loads((root / "package.json").read_text())
    lock = json.loads(lock_path.read_text())
    packages = lock.get("packages", {})
    if not isinstance(packages, dict) or not isinstance(packages.get(""), dict):
        return False
    current = packages[""]
    if current.get("version") != package.get("version"):
        return False
    for field in ("dependencies", "devDependencies", "optionalDependencies"):
        if current.get(field, {}) != package.get(field, {}):
            return False
    for name in ("astro", MARKDOWN):
        version = package.get("dependencies", {}).get(name)
        if (
            version
            and packages.get("node_modules/" + name, {}).get("version") != version
        ):
            return False
    return True
