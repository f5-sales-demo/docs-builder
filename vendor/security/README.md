# Patched build dependencies

The canonical documentation builder vendors two narrowly patched upstream packages because no fixed npm release is available. These are distinct local packages, not relabeled upstream releases. Original license and source attribution remain in each directory.

- `@f5-sales-demo/braces-security` derives from braces 3.0.3. A 128-level parser nesting limit and iterative AST depth/cycle validation protect every recursive walker before execution. Normal ranges, quoting and nested expansion remain compatible.
- `@f5-sales-demo/http-cache-semantics-security` derives from http-cache-semantics 4.2.0. Storage exclusions, no-cache, shared cookies without explicit opt-in, and Vary star require revalidation before max-stale, stale-while-revalidate or stale-if-error can reuse a response. The same predicate controls maxAge; serialized policies retain the behavior.

The upstream advisory identifiers are GHSA-vfj7-8cjw-p6xm and GHSA-ch52-4w7c-c8xp. `upstream-receipts.json` records exact downloaded upstream tarball digests. The local tarballs are locked by SHA-512 in package-lock.json; direct dependencies and npm override references route all nested consumers to the same patched artifact.

Run `npm run test:security`, `npm run test:cache`, and `npm audit --omit=dev --audit-level=high`. The Docker build runs security regressions against installed dependencies. Tests prove vulnerable upstream behavior fails and patched behavior passes without disabling the audit gate.
