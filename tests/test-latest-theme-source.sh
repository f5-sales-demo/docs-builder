#!/usr/bin/env bash
set -euo pipefail
task_repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_repo_root"
uv run --no-project --with pytest pytest tests/test_latest_theme.py tests/test_refresh_latest_theme.py
