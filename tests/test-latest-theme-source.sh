#!/usr/bin/env bash
set -euo pipefail
task_repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_repo_root"
python3 -m unittest discover -s tests -p test_latest_theme.py
