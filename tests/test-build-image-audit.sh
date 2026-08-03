#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORKFLOW="$REPO_ROOT/.github/workflows/build-image.yml"
DOCKERFILE="$REPO_ROOT/docker/Dockerfile"

python3 - "$WORKFLOW" "$DOCKERFILE" <<'PY'
import re
import sys

import yaml

with open(sys.argv[1], encoding="utf-8") as workflow_file:
    workflow = yaml.safe_load(workflow_file)
with open(sys.argv[2], encoding="utf-8") as dockerfile:
    dockerfile_text = dockerfile.read()

steps = workflow["jobs"]["build"]["steps"]
names = [step.get("name") for step in steps]
resolve_index = names.index("Resolve latest docs-theme")
audit_index = names.index("Audit production dependencies")
image_index = names.index("Build and push with retry")

if not resolve_index < audit_index < image_index:
    raise SystemExit("production audit must run after dependency resolution and before image publication")

audit_step = steps[audit_index]
if audit_step.get("run") != "npm audit --omit=dev --audit-level=high":
    raise SystemExit("production audit must fail on high or critical advisories without exclusions")

image_step = steps[image_index]
expected_env = {
    "IMAGE_NAME": "${{ env.IMAGE_NAME }}",
    "IMAGE_SHA": "${{ github.sha }}",
}
if image_step.get("env") != expected_env:
    raise SystemExit("image identifiers must enter shell through the step environment")
if "${{" in image_step["run"] or '"$IMAGE_NAME:$IMAGE_SHA"' not in image_step["run"]:
    raise SystemExit("image build shell must use environment variables, not direct expressions")

user_directives = re.findall(r"(?m)^USER[ \\t]+(.+)$", dockerfile_text)
if user_directives != ["1000:1000"]:
    raise SystemExit("runtime container user must use the numeric node UID and GID")
PY

echo "[OK] Image publication fails closed and uses hardened shell and container identities"
