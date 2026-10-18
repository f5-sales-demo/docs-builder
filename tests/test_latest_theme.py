"""Verify latest policy rejects internally consistent stale build receipts."""

import pytest

from scripts.check_latest_theme import verify_latest_source


def source():
    """Use an arbitrary future version rather than a project version assertion."""
    return {"artifacts": [{"name": "@f5-sales-demo/docs-theme", "version": "99.2.3"}]}


def release():
    """Represent a completed upstream publication."""
    return {"tag_name": "v99.2.3", "draft": False, "prerelease": False}


def test_current_source_is_accepted():
    """Accept the actual latest source identity."""
    assert verify_latest_source(source(), release()) == "99.2.3"


def test_consistent_but_stale_source_is_rejected():
    """A newer upstream release invalidates an otherwise consistent receipt."""
    with pytest.raises(ValueError, match="refreshed to latest"):
        verify_latest_source(source(), {**release(), "tag_name": "v99.2.4"})


@pytest.mark.parametrize(
    "change", [{"draft": True}, {"prerelease": True}, {"tag_name": None}]
)
def test_unpublished_or_unknown_latest_is_rejected(change):
    """Do not treat an unverifiable release as latest."""
    with pytest.raises(ValueError, match="Latest theme"):
        verify_latest_source(source(), {**release(), **change})


def test_ambiguous_source_receipt_is_rejected():
    """Require one authoritative theme source."""
    manifest = source()
    manifest["artifacts"] *= 2
    with pytest.raises(ValueError, match="exactly one"):
        verify_latest_source(manifest, release())
