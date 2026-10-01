# xcsh Docs Builder

🌐 English |
[日本語](https://f5-sales-demo.github.io/docs-builder/ja/) |
[한국어](https://f5-sales-demo.github.io/docs-builder/ko/) |
[简体中文](https://f5-sales-demo.github.io/docs-builder/zh-cn/) |
[繁體中文](https://f5-sales-demo.github.io/docs-builder/zh-tw/) |
[Español](https://f5-sales-demo.github.io/docs-builder/es/) |
[Português](https://f5-sales-demo.github.io/docs-builder/pt-br/) |
[Français](https://f5-sales-demo.github.io/docs-builder/fr/) |
[Deutsch](https://f5-sales-demo.github.io/docs-builder/de/) |
[Italiano](https://f5-sales-demo.github.io/docs-builder/it/) |
[العربية](https://f5-sales-demo.github.io/docs-builder/ar/) |
[हिन्दी](https://f5-sales-demo.github.io/docs-builder/hi/) |
[ไทย](https://f5-sales-demo.github.io/docs-builder/th/)

[![GitHub Pages Deploy](https://github.com/f5-sales-demo/docs-builder/actions/workflows/github-pages-deploy.yml/badge.svg)](https://github.com/f5-sales-demo/docs-builder/actions/workflows/github-pages-deploy.yml)
[![Repository Settings](https://github.com/f5-sales-demo/docs-builder/actions/workflows/enforce-repo-settings.yml/badge.svg)](https://github.com/f5-sales-demo/docs-builder/actions/workflows/enforce-repo-settings.yml)
[![Build Image](https://github.com/f5-sales-demo/docs-builder/actions/workflows/build-image.yml/badge.svg)](https://github.com/f5-sales-demo/docs-builder/actions/workflows/build-image.yml)
[![License](https://img.shields.io/github/license/f5-sales-demo/docs-builder)](LICENSE)

Containerized Astro + Starlight documentation build system

## Documentation

Full documentation is available at __[https://f5-sales-demo.github.io/docs-builder/](https://f5-sales-demo.github.io/docs-builder/)__.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow rules,
branch naming, and CI requirements.

## License

See [LICENSE](LICENSE).

## Verified npm artifact cache

The builder keeps the published docs-theme archive in `vendor/npm/`. Its manifest
records the original npm URL, exact version, and SHA-512 integrity. The dependency
and lockfile use a repository-relative archive path. `npm run cache:seed` rejects
bytes or versions that disagree with the manifest or lockfile before caching them.

On macOS, Windows PowerShell, and Linux, run from the repository root:

```sh
npm run cache:seed
npm ci --legacy-peer-deps --prefer-offline
```

The JavaScript helper invokes npm directly and supports paths containing spaces.
Install native dependencies separately for each operating system. The theme
archive is portable; `node_modules` is platform-specific. Other dependencies still
need registry access unless already cached.

Docker verifies and installs the archive during image construction and bakes the
installed theme and configuration into the image. Runtime documentation builds
require no theme download. To update the archive, retrieve the exact published
version, verify npm `dist.integrity`, update the manifest, and regenerate the
lockfile. Preserve the published bytes rather than repacking source.
