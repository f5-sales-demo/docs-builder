"""Strict runtime peer selection and interrupted lock recovery remain reproducible."""

import json
from types import SimpleNamespace

import pytest

from scripts.astro_runtime_peers import (
    MARKDOWN,
    lock_matches_source,
    resolve_markdown_pin,
)


def package(markdown="7.2.4"):
    return {"version": "1.0.0", "dependencies": {"astro": "7.4.12", MARKDOWN: markdown}}


def registry(monkeypatch, *, versions=None, metadata=None, theme_versions=None):
    calls = []
    runtime = metadata or {
        "name": "astro",
        "version": "7.4.12",
        "peerDependencies": {MARKDOWN: "^7.3.0"},
    }

    def run(args, **options):
        calls.append((args, options))
        if args[2] == "astro@7.4.12":
            value = runtime
        elif args[2] == MARKDOWN + "@^7.2.4":
            value = (
                theme_versions
                if theme_versions is not None
                else ["7.2.4", "7.3.0", "7.3.12"]
            )
        else:
            value = (
                versions
                if versions is not None
                else ["7.3.0", "7.3.12", "7.4.0-beta.1"]
            )
        return SimpleNamespace(stdout=json.dumps(value))

    monkeypatch.setattr("scripts.astro_runtime_peers.subprocess.run", run)
    return calls


def test_observed_conflict_selects_stable_compatible_peer_without_forcing_npm(
    monkeypatch,
):
    calls = registry(monkeypatch)
    selected = resolve_markdown_pin(
        package(), {"peerDependencies": {MARKDOWN: "^7.2.4"}}, "/npm"
    )
    assert selected == "7.3.12"
    assert len(calls) == 3
    assert all(
        args[:2] == ["/npm", "view"] and opts["check"] and opts["timeout"] == 60
        for args, opts in calls
    )
    assert all(
        "--force" not in args and "--legacy-peer-deps" not in args for args, _ in calls
    )


def test_satisfied_exact_pin_is_preserved(monkeypatch):
    registry(monkeypatch)
    assert resolve_markdown_pin(package("7.3.0"), {}, "/npm") is None


def test_future_runtime_peer_range_comes_from_metadata(monkeypatch):
    registry(
        monkeypatch,
        metadata={
            "name": "astro",
            "version": "7.4.12",
            "peerDependencies": {MARKDOWN: "^8.0.0"},
        },
        versions=["8.0.0", "8.0.9", "8.1.0-beta.1"],
    )
    assert resolve_markdown_pin(package(), {}, "/npm") == "8.0.9"


def test_unowned_optional_companion_is_not_added(monkeypatch):
    calls = registry(monkeypatch)
    assert (
        resolve_markdown_pin({"dependencies": {"astro": "7.4.12"}}, {}, "/npm") is None
    )
    assert not calls


@pytest.mark.parametrize("version", ["latest", "^7.4.0", "file:other", True])
def test_exact_runtime_identity_is_required(monkeypatch, version):
    calls = registry(monkeypatch)
    value = package()
    value["dependencies"]["astro"] = version
    with pytest.raises(ValueError, match="exact stable"):
        resolve_markdown_pin(value, {}, "/npm")
    assert not calls


@pytest.mark.parametrize("change", ["name", "version", "peers"])
def test_registry_identity_mismatch_is_visible(monkeypatch, change):
    metadata = {
        "name": "astro",
        "version": "7.4.12",
        "peerDependencies": {MARKDOWN: "^7.3.0"},
    }
    if change == "peers":
        metadata["peerDependencies"] = []
    else:
        metadata[change] = "different"
    registry(monkeypatch, metadata=metadata)
    with pytest.raises(ValueError, match="identity differs"):
        resolve_markdown_pin(package(), {}, "/npm")


@pytest.mark.parametrize(
    "value",
    [
        [],
        {},
        [12],
        ["7.4.0-beta.1"],
        ["7.3.0", "malformed"],
        ["7.3.0", "7.4.0-beta..1"],
    ],
)
def test_missing_or_malformed_stable_peer_results_fail(monkeypatch, value):
    registry(monkeypatch, versions=value)
    with pytest.raises(ValueError, match=r"metadata|stable"):
        resolve_markdown_pin(package(), {}, "/npm")


def test_incompatible_theme_and_runtime_peer_requirements_fail(monkeypatch):
    registry(monkeypatch, theme_versions=["7.2.4"])
    with pytest.raises(ValueError, match="incompatible"):
        resolve_markdown_pin(
            package(), {"peerDependencies": {MARKDOWN: "^7.2.4"}}, "/npm"
        )


@pytest.mark.parametrize(
    "requirement", ["file:private", "https://example.invalid", "7.3.0\nother", 12]
)
def test_peer_specifications_cannot_change_the_registry_interface(
    monkeypatch, requirement
):
    registry(
        monkeypatch,
        metadata={
            "name": "astro",
            "version": "7.4.12",
            "peerDependencies": {MARKDOWN: requirement},
        },
    )
    with pytest.raises(ValueError, match="peer range"):
        resolve_markdown_pin(package(), {}, "/npm")


def test_interrupted_source_and_old_lock_need_resolution_then_replay_is_idempotent(
    tmp_path,
):
    value = package("7.3.12")
    (tmp_path / "package.json").write_text(json.dumps(value))
    old = {"version": "1.0.0", "dependencies": {"astro": "7.4.12", MARKDOWN: "7.2.4"}}
    path = tmp_path / "package-lock.json"
    path.write_text(
        json.dumps(
            {
                "packages": {
                    "": old,
                    "node_modules/astro": {"version": "7.4.12"},
                    "node_modules/" + MARKDOWN: {"version": "7.2.4"},
                }
            }
        )
    )
    assert not lock_matches_source(tmp_path)
    lock = {
        "packages": {
            "": value,
            "node_modules/astro": {"version": "7.4.12"},
            "node_modules/" + MARKDOWN: {"version": "7.3.12"},
        }
    }
    path.write_text(json.dumps(lock))
    assert lock_matches_source(tmp_path)
    before = path.read_bytes()
    assert lock_matches_source(tmp_path)
    assert path.read_bytes() == before


def test_matching_root_specs_cannot_hide_a_stale_runtime_package(tmp_path):
    value = package("7.3.12")
    (tmp_path / "package.json").write_text(json.dumps(value))
    (tmp_path / "package-lock.json").write_text(
        json.dumps(
            {
                "packages": {
                    "": value,
                    "node_modules/astro": {"version": "7.4.12"},
                    "node_modules/" + MARKDOWN: {"version": "7.2.4"},
                }
            }
        )
    )
    assert not lock_matches_source(tmp_path)
