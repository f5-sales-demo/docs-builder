"""Resolve the latest published theme and refresh its verified build receipt."""

import argparse
import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

THEME = "@f5-sales-demo/docs-theme"
RELEASE = "https://api.github.com/repos/f5-sales-demo/docs-theme/releases/latest"


def require(condition: bool, message: str) -> None:
    """Reject incomplete or inconsistent upstream evidence before changing source."""
    if not condition:
        raise ValueError(message)


def selected_version(release: dict[str, Any], metadata: dict[str, Any]) -> str:
    """Select latest independently of event payloads and existing receipts."""
    tag = release.get("tag_name")
    require(
        isinstance(tag, str)
        and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag) is not None,
        "Invalid latest theme release",
    )
    require(
        release.get("draft") is False and release.get("prerelease") is False,
        "Latest theme is not a completed release",
    )
    version = str(tag)[1:]
    require(
        metadata.get("name") == THEME and metadata.get("version") == version,
        "GitHub and npm latest theme identities differ",
    )
    return version


def verified_archive(version: str, metadata: dict[str, Any], archive: bytes) -> str:
    """Check package identity and npm integrity without extracting archive paths."""
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive).digest()).decode()
    require(
        metadata["dist"].get("integrity") == integrity,
        "Latest theme archive integrity differs from npm",
    )
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        package_file = bundle.extractfile("package/package.json")
        require(
            package_file is not None, "Latest theme archive has no package identity"
        )
        package = json.loads(package_file.read()) if package_file else {}
    require(
        package.get("name") == THEME and package.get("version") == version,
        "Latest theme archive contains another package or version",
    )
    return integrity


def refresh(
    root: Path, release: dict[str, Any], metadata: dict[str, Any], archive: bytes
) -> bool:
    """Update only theme ownership and bump the builder once per new source release."""
    version = selected_version(release, metadata)
    integrity = verified_archive(version, metadata, archive)
    vendor = root / "vendor/npm"
    manifest_path = vendor / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    owners = [entry for entry in manifest["artifacts"] if entry["name"] == THEME]
    require(len(owners) == 1, "Theme must have exactly one source owner")
    owner = owners[0]
    old_file = owner["file"]
    require(
        re.fullmatch(r"docs-theme-[0-9]+\.[0-9]+\.[0-9]+\.tgz", old_file) is not None,
        "Unsafe existing theme receipt path",
    )
    old_version = owner["version"]
    require(
        re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", old_version) is not None,
        "Invalid existing theme version",
    )
    require(
        tuple(map(int, version.split("."))) >= tuple(map(int, old_version.split("."))),
        "Latest publication is older than the captured source",
    )
    if old_version == version:
        require(
            owner["integrity"] == integrity,
            "Existing theme version has conflicting publication bytes",
        )
        require(
            (vendor / old_file).read_bytes() == archive,
            "Captured theme archive differs from verified publication",
        )
        return False
    package_path = root / "package.json"
    package = json.loads(package_path.read_text())
    require(
        re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", package["version"]) is not None,
        "Invalid builder version",
    )
    major, minor, patch = map(int, package["version"].split("."))
    filename = "docs-theme-" + version + ".tgz"
    package["version"] = f"{major}.{minor}.{patch + 1}"
    package["dependencies"][THEME] = "file:vendor/npm/" + filename
    owner.update(
        version=version,
        file=filename,
        integrity=integrity,
        source=metadata["dist"]["tarball"],
    )
    (vendor / filename).write_bytes(archive)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    package_path.write_text(json.dumps(package, indent=2) + "\n")
    (vendor / old_file).unlink()
    return True


def main() -> None:
    """Resolve current GitHub/npm publications, then regenerate the normal lockfile."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[1]
    )
    args = parser.parse_args()
    headers = {"Accept": "application/vnd.github+json", "Cache-Control": "no-cache"}
    if os.environ.get("GH_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    request = urllib.request.Request(RELEASE, headers=headers)  # noqa: S310 -- Fixed HTTPS GitHub publication endpoint.
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 -- Fixed HTTPS GitHub publication endpoint.
        release = json.load(response)
    npm = shutil.which("npm")
    require(npm is not None, "npm executable is unavailable")
    result = subprocess.run(  # noqa: S603 -- Verified executable, fixed package and argument array.
        [npm, "view", THEME + "@latest", "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
    metadata = json.loads(result.stdout)
    version = selected_version(release, metadata)
    url = metadata["dist"]["tarball"]
    parsed = urllib.parse.urlparse(url)
    require(
        parsed.scheme == "https"
        and parsed.hostname == "registry.npmjs.org"
        and parsed.path.startswith("/" + THEME + "/-/"),
        "Theme archive must come from the official npm package",
    )
    with urllib.request.urlopen(url, timeout=60) as response:  # noqa: S310 -- Validated official npm HTTPS archive.
        archive = response.read()
    changed = refresh(args.root, release, metadata, archive)
    if changed:
        subprocess.run(  # noqa: S603 -- Normal lock generation from verified local source.
            [
                npm,
                "install",
                "--package-lock-only",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ],
            cwd=args.root,
            check=True,
        )
    print(f"Latest theme {version}: {'refreshed' if changed else 'already current'}")


if __name__ == "__main__":
    main()
