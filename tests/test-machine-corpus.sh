#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENTRYPOINT="$REPO_ROOT/docker/entrypoint.sh"
WORKFLOW="$REPO_ROOT/.github/workflows/build-image.yml"
PACKAGE_JSON="$REPO_ROOT/package.json"

python3 - "$ENTRYPOINT" "$WORKFLOW" "$PACKAGE_JSON" <<'PY'
import json
import sys

import yaml

entrypoint = open(sys.argv[1], encoding="utf-8").read()
workflow = yaml.safe_load(open(sys.argv[2], encoding="utf-8"))
package = json.load(open(sys.argv[3], encoding="utf-8"))

if package.get("version") != "1.3.2":
    raise SystemExit("docs-builder package version must be 1.3.2")
if "vite" not in package.get("dependencies", {}):
    raise SystemExit("docs-builder must install Vite explicitly for the container runtime")
for required in ("MACHINE_CORPUS_DIR", "/app/public/snapshot", "manifest.json", "SHA256SUMS"):
    if required not in entrypoint:
        raise SystemExit(f"machine corpus entrypoint contract missing {required}")
if 'DOCS_HOME="${DOCS_BASE%/}/"' not in entrypoint:
    raise SystemExit("corpus mode must make the project base the site-title home")

steps = workflow["jobs"]["build"]["steps"]
names = [step.get("name") for step in steps]
for required_name in (
    "Exercise progressive machine corpus in branch pilot",
    "Exercise progressive machine corpus in published image",
):
    if required_name not in names:
        raise SystemExit(f"image workflow missing {required_name}")
publish = steps[names.index("Publish protected-main multi-architecture image and cache")]["run"]
if '--tag "$IMAGE_NAME:$IMAGE_VERSION"' not in publish:
    raise SystemExit("image publication must include the immutable package-version tag")
if "IMAGE_VERSION" not in steps[names.index("Set image coordinates")]["run"]:
    raise SystemExit("image version must be derived from package.json")
PY

if [ -z "${DOCS_BUILDER_IMAGE:-}" ]; then
  echo "[OK] machine corpus static contracts pass"
  exit 0
fi

command -v docker >/dev/null
FIXTURE_PARENT=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
FIXTURE=$(mktemp -d "$FIXTURE_PARENT/docs-builder-machine-corpus.XXXXXX")
cleanup_fixture() {
  docker run --rm --pull=never \
    --user 0:0 \
    --entrypoint chown \
    -v "$FIXTURE:/fixture" \
    "$DOCS_BUILDER_IMAGE" \
    -R "$(id -u):$(id -g)" /fixture
  rm -rf "$FIXTURE"
}
trap cleanup_fixture EXIT
DOCS="$FIXTURE/docs"
CORPUS="$FIXTURE/corpus"
OUTPUT_ONE="$FIXTURE/output-one"
OUTPUT_TWO="$FIXTURE/output-two"
mkdir -p "$DOCS" "$CORPUS/content/source-a/guide/assets" \
  "$CORPUS/content/source-b/reference/assets" "$OUTPUT_ONE" "$OUTPUT_TWO"
chmod 0777 "$OUTPUT_ONE" "$OUTPUT_TWO"

cat >"$DOCS/index.mdx" <<'EOF'
---
title: F5 Docs Corpus
description: Progressive machine-readable F5 documentation.
---

Use the machine-readable entry points to browse the immutable corpus.
EOF

cat >"$DOCS/llms-config.json" <<'EOF'
{
  "progressiveCorpus": {
    "taxonomy": {
      "levels": ["category", "subcategory"],
      "collapseSingletonSubcategories": true
    },
    "hints": {
      "strategy": "first-sentence",
      "maxCharacters": 64
    }
  }
}
EOF

cat >"$CORPUS/content/source-a/guide/index.md" <<'EOF'
---
sourceId: source-a
title: Source A Guide
category: Guides
subcategory: Installation
description: A representative **guide**. This sentence must not appear in a hint.
---

SOURCE_A_UNIQUE_BODY

![Diagram](assets/a.png)
EOF

mkdir -p "$CORPUS/content/source-a/install"
cat >"$CORPUS/content/source-a/install/index.md" <<'EOF'
---
sourceId: source-a
title: Source A Installation
category: Guides
subcategory: Installation
description: A second installation guide.
---

SOURCE_A_INSTALL_BODY
EOF

cat >"$CORPUS/content/source-b/reference/index.md" <<'EOF'
---
sourceId: source-b
title: Source B Reference
category: Knowledge
subcategory: API
description: A singleton API reference.
---

SOURCE_B_UNIQUE_BODY

![Diagram](assets/b.svg)
EOF

printf 'png-fixture\n' >"$CORPUS/content/source-a/guide/assets/a.png"
printf '<svg xmlns="http://www.w3.org/2000/svg"/>\n' >"$CORPUS/content/source-b/reference/assets/b.svg"
printf '{"quality":"accepted"}\n' >"$CORPUS/quality-report.json"
printf '# Snapshot provenance\n\nExact immutable fixture.\n' >"$CORPUS/provenance.md"

python3 - "$CORPUS" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
documents = []
for source_id, relative in (
    ("source-a", "content/source-a/guide/index.md"),
    ("source-a", "content/source-a/install/index.md"),
    ("source-b", "content/source-b/reference/index.md"),
):
    data = (root / relative).read_bytes()
    body = data.split(b"---\n", 2)[-1].strip()
    documents.append({
        "sourceId": source_id,
        "url": f"https://{source_id}.example.invalid/",
        "path": relative,
        "body_sha256": hashlib.sha256(body).hexdigest(),
        "file_sha256": hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
    })
assets = []
for relative, media_type in (
    ("content/source-a/guide/assets/a.png", "image/png"),
    ("content/source-b/reference/assets/b.svg", "image/svg+xml"),
):
    data = (root / relative).read_bytes()
    assets.append({
        "path": relative,
        "sha256": hashlib.sha256(data).hexdigest(),
        "media_type": media_type,
        "size_bytes": len(data),
    })
manifest = {
    "schema_version": 2,
    "source_roots": {
        "source-a": "https://source-a.example.invalid/",
        "source-b": "https://source-b.example.invalid/",
    },
    "documents": documents,
    "assets": assets,
}
(root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
members = sorted(path for path in root.rglob("*") if path.is_file())
checksums = "".join(
    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(root).as_posix()}\n"
    for path in members
)
(root / "SHA256SUMS").write_text(checksums, encoding="utf-8")
PY

run_builder() {
  local output=$1
  docker run --rm --pull=never \
    -e DOCS_TITLE='F5 Docs Corpus' \
    -e DOCS_DESCRIPTION='Progressive machine-readable F5 documentation.' \
    -e DOCS_BASE=/html-to-markdown \
    -e DOCS_SITE=https://example.invalid \
    -e MACHINE_CORPUS_DIR=/content/machine-corpus \
    -v "$DOCS:/content/docs:ro" \
    -v "$CORPUS:/content/machine-corpus:ro" \
    -v "$output:/output" \
    "$DOCS_BUILDER_IMAGE"
}

run_builder "$OUTPUT_ONE"
run_builder "$OUTPUT_TWO"

test -f "$OUTPUT_ONE/index.html"
test -f "$OUTPUT_ONE/llms.txt"
test -f "$OUTPUT_ONE/llms-full.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-a.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-a/_taxonomy/guides.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-a/_taxonomy/guides/installation.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-a/guide.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-a/install.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-b.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-b/_taxonomy/knowledge.txt"
test -f "$OUTPUT_ONE/_llms-txt/source-b/reference.txt"
test ! -e "$OUTPUT_ONE/_llms-txt/source-b/_taxonomy/knowledge/api.txt"
test ! -e "$OUTPUT_ONE/llms-config.json"
test ! -e "$OUTPUT_ONE/llms-small.txt"
test ! -e "$OUTPUT_ONE/context.txt"
test ! -e "$OUTPUT_ONE/source-a/guide/index.html"
test ! -e "$OUTPUT_ONE/fr/llms.txt"
test -f "$OUTPUT_ONE/snapshot/manifest.json"
test -f "$OUTPUT_ONE/snapshot/SHA256SUMS"
test -f "$OUTPUT_ONE/snapshot/quality-report.json"
test -f "$OUTPUT_ONE/snapshot/provenance.md"
test -f "$OUTPUT_ONE/snapshot/content/source-a/guide/assets/a.png"
test -f "$OUTPUT_ONE/snapshot/content/source-b/reference/assets/b.svg"
grep -Fq 'SOURCE_A_UNIQUE_BODY' "$OUTPUT_ONE/_llms-txt/source-a/guide.txt"
grep -Fq 'SOURCE_A_INSTALL_BODY' "$OUTPUT_ONE/_llms-txt/source-a/install.txt"
grep -Fq 'SOURCE_B_UNIQUE_BODY' "$OUTPUT_ONE/_llms-txt/source-b/reference.txt"
if grep -Fq 'SOURCE_A_UNIQUE_BODY' "$OUTPUT_ONE/llms-full.txt"; then
  echo "ERROR: llms-full.txt must be a link-only inventory" >&2
  exit 1
fi
if grep -Fq 'SOURCE_B_UNIQUE_BODY' "$OUTPUT_ONE/llms-full.txt"; then
  echo "ERROR: llms-full.txt must be a link-only inventory" >&2
  exit 1
fi
grep -Fq 'https://example.invalid/html-to-markdown/snapshot/content/source-a/guide/assets/a.png' \
  "$OUTPUT_ONE/_llms-txt/source-a/guide.txt"
grep -Fq 'https://example.invalid/html-to-markdown/snapshot/content/source-b/reference/assets/b.svg' \
  "$OUTPUT_ONE/_llms-txt/source-b/reference.txt"
test "$(grep -c '/_llms-txt/source-a/guide.txt' "$OUTPUT_ONE/llms-full.txt")" -eq 1
test "$(grep -c '/_llms-txt/source-b/reference.txt' "$OUTPUT_ONE/llms-full.txt")" -eq 1
grep -Fq ': A representative guide.' "$OUTPUT_ONE/_llms-txt/source-a/_taxonomy/guides/installation.txt"
if grep -Fq 'This sentence must not appear' "$OUTPUT_ONE/_llms-txt/source-a/_taxonomy/guides/installation.txt"; then
  echo "ERROR: semantic index leaked text after the first sentence" >&2
  exit 1
fi
grep -Eq 'href="/html-to-markdown/?"' "$OUTPUT_ONE/index.html"
if grep -Eq 'href="(https://f5-sales-demo.github.io)?/docs/?"' "$OUTPUT_ONE/index.html"; then
  echo "ERROR: corpus landing page still links to the shared docs portal" >&2
  exit 1
fi
diff -ru "$OUTPUT_ONE" "$OUTPUT_TWO"

echo "[OK] two-source progressive machine corpus build is complete and deterministic"
