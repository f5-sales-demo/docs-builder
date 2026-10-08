#!/bin/sh
set -e

CONTENT_DIR="${CONTENT_DIR:-/content/docs}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
GENERATE_PDF="${GENERATE_PDF:-false}"
MACHINE_CORPUS_DIR="${MACHINE_CORPUS_DIR:-}"

# A verified machine corpus is mounted separately from Starlight content. Its
# Markdown feeds only the progressive text routes; the complete immutable tree
# is copied to public/snapshot for provenance and stable asset URLs.
if [ -n "$MACHINE_CORPUS_DIR" ]; then
  if [ ! -d "$MACHINE_CORPUS_DIR" ]; then
    echo "ERROR: Machine corpus directory not found at $MACHINE_CORPUS_DIR"
    exit 1
  fi
  CORPUS_ROOT=$(realpath "$MACHINE_CORPUS_DIR")
  case "$CORPUS_ROOT" in
  /app/src/content/docs | /app/src/content/docs/*)
    echo "ERROR: Machine corpus must remain outside the Starlight docs collection"
    exit 1
    ;;
  esac
  for required in manifest.json SHA256SUMS content; do
    if [ ! -e "$CORPUS_ROOT/$required" ]; then
      echo "ERROR: Machine corpus is missing $required"
      exit 1
    fi
  done
  if find "$CORPUS_ROOT" -type l | grep -q .; then
    echo "ERROR: Machine corpus must not contain symbolic links"
    exit 1
  fi
  if ! node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1])); if(m.schema_version!==2||!Array.isArray(m.documents)||!Array.isArray(m.assets)) process.exit(1)" "$CORPUS_ROOT/manifest.json"; then
    echo "ERROR: Machine corpus manifest is not schema version 2"
    exit 1
  fi
  rm -rf /app/public/snapshot
  mkdir -p /app/public/snapshot
  cp -R "$CORPUS_ROOT"/. /app/public/snapshot/
  MACHINE_CORPUS_DIR="$CORPUS_ROOT"
  export MACHINE_CORPUS_DIR
  echo "Progressive machine corpus mounted from $CORPUS_ROOT"
fi

# Load publication configuration directly from the selected source root before
# staging; canonical staging copies only manifest-owned content.
if [ "${DOCS_PROFILE:-}" = canonical-provider ]; then
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$CONTENT_DIR/llms-config.json"
  LLMS_CONFIG=$(cat "$CONTENT_DIR/llms-config.json")
  export LLMS_CONFIG
fi

# Inject content
if [ -d "$CONTENT_DIR" ]; then
  if [ "${DOCS_PROFILE:-}" = canonical-provider ]; then
    export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=14336}"
    export PROVIDER_NAVIGATION=/app/provider-navigation.json
    export CANONICAL_MANIFEST="$CONTENT_DIR/generated-manifest.json"
    node /app/docker/canonical-provider.mjs stage "$CONTENT_DIR" /app/src/content/docs
  else
    cp -r "$CONTENT_DIR"/* /app/src/content/docs/
  fi
else
  echo "ERROR: No content found at $CONTENT_DIR"
  exit 1
fi

# Detect locale-aware content structure
DOCS_ROOT="/app/src/content/docs"
if [ -d "$DOCS_ROOT/en" ]; then
  EN_ROOT="$DOCS_ROOT/en"
  echo "Locale-aware content detected (en/ subdirectory)"
else
  EN_ROOT="$DOCS_ROOT"
fi

# Normalize ingested Markdown frontmatter for Starlight.
# Terraform-style docs carry a `page_title` (browser-tab title) plus a body `# H1`
# (visible heading); Starlight renders the frontmatter `title` AS the page <h1>, so
# feeding both renders the title twice. The normalizer promotes the body H1 to the
# frontmatter `title` and strips it from the body (single source of truth), and
# renames a lone `page_title` to `title` on pages that have no body H1. Pages needing
# no change are left untouched.
node /app/docker/normalize-frontmatter.mjs /app/src/content/docs

# Placeholder form: if content repo provides placeholders.json, activate
if [ -f /app/src/content/docs/placeholders.json ]; then
  cp /app/src/content/docs/placeholders.json /app/src/data/placeholders.json
  rm /app/src/content/docs/placeholders.json
  export DOCS_MARKDOWN_CONTENT="./src/overrides/MarkdownContent.astro"
  node /app/docker/validate-form.mjs /app/src/data/placeholders.json
  echo "Placeholder form enabled"
fi

# Extract title from index.mdx frontmatter (if not set via env)
if [ -z "$DOCS_TITLE" ] && [ -f "$EN_ROOT/index.mdx" ]; then
  DOCS_TITLE=$(grep -m1 '^title:' "$EN_ROOT/index.mdx" | sed 's/title: *["]*//;s/["]*$//' || echo "Documentation")
  export DOCS_TITLE
fi

# Extract description from index.mdx frontmatter (if not set via env)
if [ -z "$DOCS_DESCRIPTION" ] && [ -f "$EN_ROOT/index.mdx" ]; then
  DOCS_DESCRIPTION=$(grep -m1 '^description:' "$EN_ROOT/index.mdx" | sed 's/description: *["]*//;s/["]*$//' || echo "")
  export DOCS_DESCRIPTION
fi

# Read optional LLM links from llms-links.json (if present in content)
if [ -z "$LLMS_OPTIONAL_LINKS" ] && [ -f /app/src/content/docs/llms-links.json ]; then
  LLMS_OPTIONAL_LINKS=$(cat /app/src/content/docs/llms-links.json)
  export LLMS_OPTIONAL_LINKS
  rm /app/src/content/docs/llms-links.json
fi

# Read optional LLMs configuration from llms-config.json (if present in content)
if [ -z "$LLMS_CONFIG" ] && [ -f /app/src/content/docs/llms-config.json ]; then
  # Validate JSON using Node.js (guaranteed available in node:24-alpine; python3
  # may not be installed or may behave unexpectedly in minimal Alpine images).
  if ! node -e "JSON.parse(require('fs').readFileSync('/app/src/content/docs/llms-config.json','utf8'))" 2>/dev/null; then
    echo "WARNING: llms-config.json is invalid JSON — ignoring, using defaults"
  else
    LLMS_CONFIG=$(cat /app/src/content/docs/llms-config.json)
    export LLMS_CONFIG
    rm /app/src/content/docs/llms-config.json
    echo "LLMs config loaded"
  fi
fi

# Read optional LLMs federated sites from llms-federated-sites.json (if present in content)
if [ -z "$LLMS_FEDERATED_SITES" ] && [ -f /app/src/content/docs/llms-federated-sites.json ]; then
  if ! node -e "JSON.parse(require('fs').readFileSync('/app/src/content/docs/llms-federated-sites.json','utf8'))" 2>/dev/null; then
    echo "WARNING: llms-federated-sites.json is invalid JSON — ignoring, using defaults"
  else
    LLMS_FEDERATED_SITES=$(cat /app/src/content/docs/llms-federated-sites.json)
    export LLMS_FEDERATED_SITES
    rm /app/src/content/docs/llms-federated-sites.json
    echo "LLMs federated sites loaded"
  fi
fi

# Read optional LLMs federated site categories from llms-federated-site-categories.json
if [ -z "$LLMS_FEDERATED_SITE_CATEGORIES" ] && [ -f /app/src/content/docs/llms-federated-site-categories.json ]; then
  if ! node -e "JSON.parse(require('fs').readFileSync('/app/src/content/docs/llms-federated-site-categories.json','utf8'))" 2>/dev/null; then
    echo "WARNING: llms-federated-site-categories.json is invalid JSON — ignoring, using defaults"
  else
    LLMS_FEDERATED_SITE_CATEGORIES=$(cat /app/src/content/docs/llms-federated-site-categories.json)
    export LLMS_FEDERATED_SITE_CATEGORIES
    rm /app/src/content/docs/llms-federated-site-categories.json
    echo "LLMs federated site categories loaded"
  fi
fi

# Read OpenAPI specs configuration for starlight-openapi plugin
if [ -z "$OPENAPI_SPECS_CONFIG" ] && [ -f /app/src/content/docs/openapi-specs-config.json ]; then
  if ! node -e "JSON.parse(require('fs').readFileSync('/app/src/content/docs/openapi-specs-config.json','utf8'))" 2>/dev/null; then
    echo "WARNING: openapi-specs-config.json is invalid JSON — ignoring"
  else
    OPENAPI_SPECS_CONFIG=$(cat /app/src/content/docs/openapi-specs-config.json)
    export OPENAPI_SPECS_CONFIG
    rm /app/src/content/docs/openapi-specs-config.json
    echo "OpenAPI specs config loaded (starlight-openapi plugin enabled)"
  fi
fi

# Extract base path from repo name (if not set via env)
if [ -z "$DOCS_BASE" ] && [ -n "$GITHUB_REPOSITORY" ]; then
  DOCS_BASE="/${GITHUB_REPOSITORY#*/}"
  export DOCS_BASE
fi

# A corpus landing page is its own navigation root. Keep the site title local
# unless the caller explicitly supplies a different home URL.
if [ -n "$MACHINE_CORPUS_DIR" ] && [ -z "${DOCS_HOME:-}" ]; then
  DOCS_HOME="${DOCS_BASE%/}/"
  export DOCS_HOME
fi

# Derive site URL from repository owner (if not set via env)
if [ -z "$DOCS_SITE" ] && [ -n "$GITHUB_REPOSITORY_OWNER" ]; then
  DOCS_SITE="https://${GITHUB_REPOSITORY_OWNER}.github.io"
  export DOCS_SITE
fi

# Ensure public directory exists for static asset symlinks
mkdir -p /app/public

# Auto-detect static asset directories (no .md/.mdx files) and symlink to public
for dir in "$CONTENT_DIR"/*/; do
  [ -d "$dir" ] || continue
  [ "${DOCS_PROFILE:-}" != canonical-provider ] || continue
  dirname=$(basename "$dir")
  # Skip if directory contains any .md or .mdx files
  if ! find "$dir" -maxdepth 1 -name '*.md' -o -name '*.mdx' | grep -q .; then
    # Skip if already mounted by the CI workflow (avoids read-only mount conflict)
    if [ -e "/app/public/$dirname" ]; then
      echo "Static asset directory already mounted: $dirname"
    else
      ln -sfn "$dir" "/app/public/$dirname"
      echo "Static asset directory detected: $dirname"
    fi
  fi
done

# Dev mode: run live dev server instead of building
if [ "$MODE" = "dev" ]; then
  echo "Starting dev server..."
  exec npx astro dev --host
fi

# Root owns shared releases. Consumers only emit qualified external references.
DOCS_SHARED_MODE=$(node /app/docker/shared-publication.mjs prepare "${GITHUB_REPOSITORY:-}" "${SHARED_ASSETS_DIR:-}" /app/public)
export DOCS_SHARED_MODE
if [ "$DOCS_SHARED_MODE" != local ]; then
  rm -f /app/public/favicon.svg
fi

# Build
npm run build

if [ "${DOCS_PROFILE:-}" = canonical-provider ]; then
  node /app/docker/canonical-provider.mjs receipt "$CONTENT_DIR" /app/dist
  node /app/docker/compact-publication.mjs /app/dist
  node /app/docker/verify-provider-output.mjs "$CONTENT_DIR" /app/dist
fi

node /app/docker/shared-publication.mjs verify "${GITHUB_REPOSITORY:-}" /app/dist

# --- PDF Generation (optional) ---
if [ "$GENERATE_PDF" = "true" ]; then
  echo "PDF generation enabled. Starting preview server..."

  PDF_FILENAME="${PDF_FILENAME:-docs}"

  # Construct preview URL with base path
  PREVIEW_BASE="${DOCS_BASE:-/}"
  PREVIEW_URL="http://localhost:4321${PREVIEW_BASE}"

  # Start preview server in background
  npm run preview &
  PREVIEW_PID=$!

  # Wait for preview server to be ready
  echo "Waiting for preview server to start..."
  RETRIES=0
  MAX_RETRIES=30
  until wget -q --spider "$PREVIEW_URL" 2>/dev/null; do
    RETRIES=$((RETRIES + 1))
    if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
      echo "ERROR: Preview server did not start within ${MAX_RETRIES} seconds"
      kill "$PREVIEW_PID" 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done
  echo "Preview server is ready at $PREVIEW_URL"

  # Generate PDF into dist so it ships with the static site
  mkdir -p /app/dist/_pdf
  echo "Generating PDF..."
  npx starlight-to-pdf "$PREVIEW_URL" \
    --browser-executable /usr/bin/chromium-browser \
    --path /app/dist/_pdf \
    --filename "$PDF_FILENAME" \
    --pdf-outline \
    --print-bg

  echo "PDF generated at /app/dist/_pdf/${PDF_FILENAME}.pdf"

  # Stop preview server
  kill "$PREVIEW_PID" 2>/dev/null || true
  wait "$PREVIEW_PID" 2>/dev/null || true
  echo "Preview server stopped."
fi

# Copy output
if [ -d "$OUTPUT_DIR" ]; then
  if [ ! -w "$OUTPUT_DIR" ]; then
    echo "ERROR: Output directory $OUTPUT_DIR is not writable by UID $(id -u)."
    echo "If running in CI, ensure the workflow sets proper permissions on the mounted volume."
    echo "Example: chmod 777 \$RUNNER_TEMP/docs-output  (before docker run)"
    exit 1
  fi
  cp -r /app/dist/* "$OUTPUT_DIR"/
fi
