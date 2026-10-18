"""Verify latest-source updates reject incomplete evidence and remain idempotent."""

import base64
import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest

from scripts.refresh_latest_theme import THEME, refresh, selected_version


def publication(version: str, name: str = THEME):
    """Build synthetic npm bytes and their public integrity receipt."""
    buffer = io.BytesIO()
    content = json.dumps({"name": name, "version": version}).encode()
    with tarfile.open(fileobj=buffer, mode="w:gz") as bundle:
        info = tarfile.TarInfo("package/package.json")
        info.size = len(content)
        bundle.addfile(info, io.BytesIO(content))
    archive = buffer.getvalue()
    release = {"tag_name": "v" + version, "draft": False, "prerelease": False}
    metadata = {
        "name": THEME,
        "version": version,
        "dist": {
            "integrity": "sha512-"
            + base64.b64encode(hashlib.sha512(archive).digest()).decode(),
            "tarball": "https://registry.npmjs.org/"
            + THEME
            + "/-/docs-theme-"
            + version
            + ".tgz",
        },
    }
    return release, metadata, archive


def source(root: Path):
    """Preserve another dependency while exercising theme ownership updates."""
    _, metadata, archive = publication("1.0.0")
    vendor = root / "vendor/npm"
    vendor.mkdir(parents=True)
    (vendor / "docs-theme-1.0.0.tgz").write_bytes(archive)
    owner = {
        "name": THEME,
        "version": "1.0.0",
        "file": "docs-theme-1.0.0.tgz",
        **metadata["dist"],
    }
    other = {"name": "other", "version": "2.0.0", "file": "other.tgz"}
    (vendor / "manifest.json").write_text(json.dumps({"artifacts": [owner, other]}))
    (root / "package.json").write_text(
        json.dumps(
            {"version": "3.2.1", "dependencies": {THEME: "old", "other": "unchanged"}}
        )
    )
    return owner, other


def test_refresh_selects_new_publication_and_preserves_other_ownership(tmp_path):
    _, other = source(tmp_path)
    release, metadata, archive = publication("1.1.0")
    assert refresh(tmp_path, release, metadata, archive)
    package = json.loads((tmp_path / "package.json").read_text())
    assert package["version"] == "3.2.2"
    assert package["dependencies"][THEME] == "file:vendor/npm/docs-theme-1.1.0.tgz"
    assert package["dependencies"]["other"] == "unchanged"
    manifest = json.loads((tmp_path / "vendor/npm/manifest.json").read_text())
    assert manifest["artifacts"][1] == other
    assert not (tmp_path / "vendor/npm/docs-theme-1.0.0.tgz").exists()
    assert not refresh(tmp_path, release, metadata, archive)
    assert json.loads((tmp_path / "package.json").read_text())["version"] == "3.2.2"


@pytest.mark.parametrize("change", ["npm_stale", "draft", "prerelease", "invalid_tag"])
def test_incomplete_latest_metadata_is_rejected(change):
    release, metadata, _ = publication("1.1.0")
    if change == "npm_stale":
        metadata["version"] = "1.0.0"
    elif change == "invalid_tag":
        release["tag_name"] = "latest"
    else:
        release[change] = True
    expected = {
        "npm_stale": "GitHub and npm latest theme identities differ",
        "draft": "Latest theme is not a completed release",
        "prerelease": "Latest theme is not a completed release",
        "invalid_tag": "Invalid latest theme release",
    }
    with pytest.raises(ValueError, match=expected[change]):
        selected_version(release, metadata)


@pytest.mark.parametrize(
    "change", ["integrity", "identity", "duplicate_owner", "unsafe_path"]
)
def test_bad_evidence_cannot_mutate_source(tmp_path, change):
    source(tmp_path)
    release, metadata, archive = publication(
        "1.1.0", "other" if change == "identity" else THEME
    )
    path = tmp_path / "vendor/npm/manifest.json"
    manifest = json.loads(path.read_text())
    if change == "integrity":
        metadata["dist"]["integrity"] = "wrong"
    elif change == "duplicate_owner":
        manifest["artifacts"].append(manifest["artifacts"][0].copy())
    elif change == "unsafe_path":
        manifest["artifacts"][0]["file"] = "../outside.tgz"
    path.write_text(json.dumps(manifest))
    before = {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    expected = {
        "integrity": "Latest theme archive integrity differs from npm",
        "identity": "Latest theme archive contains another package or version",
        "duplicate_owner": "Theme must have exactly one source owner",
        "unsafe_path": "Unsafe existing theme receipt path",
    }
    with pytest.raises(ValueError, match=expected[change]):
        refresh(tmp_path, release, metadata, archive)
    assert before == {
        str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()
    }
