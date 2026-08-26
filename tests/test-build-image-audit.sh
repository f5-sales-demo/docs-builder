#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORKFLOW="$REPO_ROOT/.github/workflows/build-image.yml"
PAGES_WORKFLOW="$REPO_ROOT/.github/workflows/github-pages-deploy.yml"
LINTER_WORKFLOW="$REPO_ROOT/.github/workflows/super-linter.yml"
CONTAINER_SMOKE="$REPO_ROOT/.github/workflows/self-hosted-runner-container-build-smoke.yml"
TOOL_CACHE_SMOKE="$REPO_ROOT/.github/workflows/self-hosted-runner-python-uv-smoke.yml"
DOCKERFILE="$REPO_ROOT/docker/Dockerfile"
PACKAGE_JSON="$REPO_ROOT/package.json"
PACKAGE_LOCK="$REPO_ROOT/package-lock.json"

python3 - "$WORKFLOW" "$PAGES_WORKFLOW" "$LINTER_WORKFLOW" "$CONTAINER_SMOKE" "$TOOL_CACHE_SMOKE" "$DOCKERFILE" "$PACKAGE_JSON" "$PACKAGE_LOCK" <<'PY'
import json
import re
import sys

import yaml

with open(sys.argv[1], encoding="utf-8") as workflow_file:
    workflow = yaml.safe_load(workflow_file)
with open(sys.argv[2], encoding="utf-8") as pages_file:
    pages = yaml.safe_load(pages_file)
with open(sys.argv[3], encoding="utf-8") as linter_file:
    linter = yaml.safe_load(linter_file)
with open(sys.argv[4], encoding="utf-8") as container_smoke_file:
    container_smoke = yaml.safe_load(container_smoke_file)
with open(sys.argv[5], encoding="utf-8") as tool_cache_smoke_file:
    tool_cache_smoke = yaml.safe_load(tool_cache_smoke_file)
with open(sys.argv[6], encoding="utf-8") as dockerfile:
    dockerfile_text = dockerfile.read()
with open(sys.argv[7], encoding="utf-8") as package_file:
    package = json.load(package_file)
with open(sys.argv[8], encoding="utf-8") as lock_file:
    package_lock = json.load(lock_file)

build_job = workflow["jobs"]["build"]
dispatch_job = workflow["jobs"]["dispatch"]
steps = build_job["steps"]
names = [step.get("name") for step in steps]

if workflow.get("permissions") != {}:
    raise SystemExit("workflow must deny default GitHub token permissions")
if build_job.get("runs-on") != "docs-container-build":
    raise SystemExit("image work must use the repository-scoped container ARC label")
if dispatch_job.get("runs-on") != "docs-socketless":
    raise SystemExit("downstream dispatch must use the repository-scoped socketless ARC label")
if build_job.get("permissions") != {"contents": "read", "packages": "write"}:
    raise SystemExit("image build permissions must remain least-privilege")
if dispatch_job.get("environment") != "release" or dispatch_job.get("permissions") != {}:
    raise SystemExit("downstream dispatch must retain the release environment and no token permissions")
if dispatch_job.get("if") != "github.ref == 'refs/heads/main' && github.ref_protected && inputs.dispatch_downstream":
    raise SystemExit("downstream fanout must require protected main and explicit opt-in")

inputs = workflow[True]["workflow_dispatch"]["inputs"]
if inputs.get("dispatch_downstream") != {
    "description": "Trigger Pages rebuilds after a protected-main publication",
    "required": False,
    "type": "boolean",
    "default": False,
}:
    raise SystemExit("dispatch_downstream must be an opt-in boolean defaulting false")

action_steps = [step for step in steps if "uses" in step]
if not all(re.fullmatch(r"[^@]+@[0-9a-f]{40}", step["uses"]) for step in action_steps):
    raise SystemExit("image build actions must be pinned to full commit SHAs")
required_actions = {
    "docker/setup-qemu-action@96fe6ef7f33517b61c61be40b68a1882f3264fb8",
    "docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e",
}
if not required_actions <= {step["uses"] for step in action_steps}:
    raise SystemExit("pinned QEMU and Buildx setup actions are required")

checkout_step = next(step for step in steps if step.get("uses", "").startswith("actions/checkout@"))
if checkout_step.get("with", {}).get("persist-credentials") is not False:
    raise SystemExit("image build checkout must not persist GitHub credentials")

resolve_index = names.index("Resolve latest docs-theme")
audit_index = names.index("Audit production dependencies")
publish_index = names.index("Publish protected-main multi-architecture image and cache")
if not resolve_index < audit_index < publish_index:
    raise SystemExit("production audit must run before image publication")
if steps[resolve_index].get("run") != "npm update @f5-sales-demo/docs-theme --package-lock-only --legacy-peer-deps":
    raise SystemExit("theme refresh must update only the lockfile")
if steps[audit_index].get("run") != "npm audit --omit=dev --audit-level=high":
    raise SystemExit("production audit must fail on high or critical advisories")

publish = steps[publish_index]
if publish.get("if") != "github.ref == 'refs/heads/main' && github.ref_protected":
    raise SystemExit("publication must require protected main")
publish_shell = publish["run"]
for required in (
    "--platform linux/amd64,linux/arm64",
    '--tag "$IMAGE_NAME:latest"',
    '--tag "$IMAGE_NAME:$IMAGE_SHA"',
    '--cache-from "type=registry,ref=$CACHE_IMAGE"',
    '--cache-to "type=registry,ref=$CACHE_IMAGE,mode=max"',
    '--metadata-file "$metadata"',
    "--push",
    'echo "digest=$digest" >> "$GITHUB_OUTPUT"',
):
    if required not in publish_shell:
        raise SystemExit(f"publication contract missing {required}")

pilot = steps[names.index("Build and load branch pilot")]
if pilot.get("if") != "github.ref != 'refs/heads/main'":
    raise SystemExit("pilot build must be restricted to non-main branches")
if "--load" not in pilot["run"] or "--push" in pilot["run"] or "--cache-to" in pilot["run"]:
    raise SystemExit("branch pilot must load locally without publishing images or cache")

verify_shell = steps[names.index("Verify published architectures")]["run"]
if "imagetools inspect" not in verify_shell or '"linux/amd64", "linux/arm64"' not in verify_shell:
    raise SystemExit("published manifest must be checked for both target architectures")
smoke_shell = steps[names.index("Pull and smoke-test the published native image by digest")]["run"]
if 'docker pull "$image"' not in smoke_shell or "docker run --rm --pull=never" not in smoke_shell:
    raise SystemExit("published native image must be pulled by digest once and run without repulling")

for caller, label in ((pages, "docs"), (linter, "lint")):
    inputs = caller["jobs"][label]["with"]
    if inputs.get("socketless_runner_label") != "docs-socketless":
        raise SystemExit("reusable caller must pass docs-socketless")
    if inputs.get("container_build_runner_label") != "docs-container-build":
        raise SystemExit("reusable caller must pass docs-container-build")

container_job = container_smoke["jobs"]["docker-socket-smoke"]
if container_job.get("runs-on") != "docs-container-build":
    raise SystemExit("container smoke must use the repository-scoped container ARC label")
container_boundary = container_job["steps"][0]["run"]
for required in (
    'test "${DOCKER_HOST:-}" = "unix:///var/run/docker.sock"',
    "test -S /var/run/docker.sock",
    "docker info --format '{{.Name}}'",
    "if pgrep -x dockerd; then",
):
    if required not in container_boundary:
        raise SystemExit(f"container smoke is missing ARC boundary check: {required}")
if "RUNNER_CONTAINER_TOOLS" in container_boundary or "unix:///run/docker.sock" in container_boundary:
    raise SystemExit("container smoke must not restore legacy host-socket assertions")

tool_job = tool_cache_smoke["jobs"]["tool-cache-smoke"]
if tool_job.get("runs-on") != "docs-socketless":
    raise SystemExit("tool smoke must use the repository-scoped socketless ARC label")
tool_boundary = tool_job["steps"][0]["run"]
for required in (
    "AGENT_TOOLSDIRECTORY must be set",
    'test "$catalog_dir" = /opt/hostedtoolcache',
    'test "$tool_cache" = "$catalog_dir"',
    "/opt/python-3.13.7",
    "/usr/local/bin/uv",
):
    if required not in tool_boundary:
        raise SystemExit(f"tool smoke is missing ARC image-catalog check: {required}")
if "RUNNER_RUNTIME_DIR" in tool_boundary:
    raise SystemExit("tool smoke must not restore the legacy copied-runtime assertion")

if package.get("overrides", {}).get("js-yaml") != "^4.3.1":
    raise SystemExit("production dependency graph must override js-yaml to the patched 4.3.1 line")
resolved_js_yaml = package_lock["packages"]["node_modules/js-yaml"]["version"]
if tuple(int(part) for part in resolved_js_yaml.split(".")) < (4, 3, 1):
    raise SystemExit(f"top-level js-yaml remains vulnerable: {resolved_js_yaml}")
if not package_lock["packages"]["node_modules/gray-matter/node_modules/js-yaml"]["version"].startswith("3."):
    raise SystemExit("gray-matter must retain its compatible js-yaml 3.x dependency")
if re.findall(r"(?m)^USER[ \\t]+(.+)$", dockerfile_text) != ["1000:1000"]:
    raise SystemExit("runtime container user must use the numeric node UID and GID")
PY

echo "[OK] ARC publication, cache, manifest, image-catalog, DinD, digest, and fanout contracts pass"
