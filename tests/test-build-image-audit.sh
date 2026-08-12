#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORKFLOW="$REPO_ROOT/.github/workflows/build-image.yml"
DOCKERFILE="$REPO_ROOT/docker/Dockerfile"
PACKAGE_JSON="$REPO_ROOT/package.json"
PACKAGE_LOCK="$REPO_ROOT/package-lock.json"

python3 - "$WORKFLOW" "$DOCKERFILE" "$PACKAGE_JSON" "$PACKAGE_LOCK" <<'PY'
import json
import re
import sys

import yaml

with open(sys.argv[1], encoding="utf-8") as workflow_file:
    workflow = yaml.safe_load(workflow_file)
with open(sys.argv[2], encoding="utf-8") as dockerfile:
    dockerfile_text = dockerfile.read()
with open(sys.argv[3], encoding="utf-8") as package_file:
    package = json.load(package_file)
with open(sys.argv[4], encoding="utf-8") as lock_file:
    package_lock = json.load(lock_file)

build_job = workflow["jobs"]["build"]
dispatch_job = workflow["jobs"]["dispatch"]
steps = build_job["steps"]
names = [step.get("name") for step in steps]

if workflow.get("permissions") != {}:
    raise SystemExit("workflow must deny default GitHub token permissions")
if build_job.get("name") != "Build and publish multi-architecture image":
    raise SystemExit("image build job must have an explicit display name")
if build_job.get("permissions") != {"contents": "read", "packages": "write"}:
    raise SystemExit("image build permissions must remain least-privilege")
if dispatch_job.get("environment") != "release" or dispatch_job.get("permissions") != {}:
    raise SystemExit("downstream dispatch must use the release environment with no GitHub token permissions")
dispatch_step = next(
    step for step in dispatch_job["steps"] if step.get("name") == "Dispatch to docs-sites repos"
)
dispatch_filter = "jq -r '.[] | select(.rebuild_dispatch != false) | .url'"
if dispatch_filter not in dispatch_step.get("run", ""):
    raise SystemExit(
        "downstream dispatch must exclude sites that explicitly disable generic rebuilds"
    )
resolve_index = names.index("Resolve latest docs-theme")
audit_index = names.index("Audit production dependencies")
image_index = names.index("Build and push with retry")

action_steps = [step for step in steps if "uses" in step]
if not all(re.fullmatch(r"[^@]+@[0-9a-f]{40}", step["uses"]) for step in action_steps):
    raise SystemExit("image build actions must be pinned to full commit SHAs")

checkout_step = next(
    step for step in steps if step.get("uses", "").startswith("actions/checkout@")
)
if checkout_step.get("with", {}).get("persist-credentials") is not False:
    raise SystemExit("image build checkout must not persist GitHub credentials")

if package.get("overrides", {}).get("js-yaml") != "^4.3.1":
    raise SystemExit("production dependency graph must override js-yaml to the patched 4.3.1 line")

resolve_step = steps[resolve_index]
expected_resolve = "npm update @f5-sales-demo/docs-theme --package-lock-only --legacy-peer-deps"
if resolve_step.get("run") != expected_resolve:
    raise SystemExit("theme refresh must update only the lockfile through the declared dependency range")

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

resolved_js_yaml = package_lock["packages"]["node_modules/js-yaml"]["version"]
resolved_parts = tuple(int(part) for part in resolved_js_yaml.split("."))
if resolved_parts < (4, 3, 1):
    raise SystemExit(f"top-level js-yaml remains vulnerable: {resolved_js_yaml}")

gray_matter_js_yaml = package_lock["packages"][
    "node_modules/gray-matter/node_modules/js-yaml"
]["version"]
if not gray_matter_js_yaml.startswith("3."):
    raise SystemExit("gray-matter must retain its compatible js-yaml 3.x dependency")

user_directives = re.findall(r"(?m)^USER[ \\t]+(.+)$", dockerfile_text)
if user_directives != ["1000:1000"]:
    raise SystemExit("runtime container user must use the numeric node UID and GID")
PY

echo "[OK] Image publication fails closed and uses hardened shell and container identities"
