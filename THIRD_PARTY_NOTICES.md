# Third-party notices

WorkNote's original source is MIT-licensed. This does **not** replace or relicense dependencies, fonts, build tools or native libraries. The two package lockfiles identify the exact resolved packages and integrity hashes. Preserve the licenses and notices supplied with those packages when redistributing a build or container.

## Main components

| Component | License / source |
|---|---|
| React / React DOM, React Router | MIT; https://github.com/facebook/react ; https://github.com/remix-run/react-router |
| Headless UI / Heroicons / Tailwind CSS | MIT; https://github.com/tailwindlabs |
| Fastify / static plugin | MIT; https://github.com/fastify |
| marked | MIT; https://github.com/markedjs/marked |
| sanitize-html | MIT; https://github.com/apostrophecms/sanitize-html |
| TypeScript | Apache-2.0; https://github.com/microsoft/TypeScript |
| Vite / React plugin | MIT; https://github.com/vitejs/vite |
| sharp | Apache-2.0; https://github.com/lovell/sharp |
| libvips and sharp's prebuilt native bundle | LGPL-3.0-or-later plus constituent library licenses; https://github.com/libvips/libvips ; https://github.com/lovell/sharp-libvips |
| Lightning CSS build dependency | MPL-2.0; https://github.com/parcel-bundler/lightningcss |
| caniuse-lite browser data | CC-BY-4.0; https://github.com/browserslist/caniuse-lite |

Installed dependencies also include packages under BSD-2-Clause, BSD-3-Clause, ISC, 0BSD and BlueOak-1.0.0. Consult each package's included LICENSE/NOTICE rather than relying only on package metadata.

## Native image libraries

The application calls sharp through its ordinary Node interface and does not modify libvips. sharp installs platform-specific native packages; `@img/sharp-libvips-*` includes its library bundle and a `versions.json` identifying components. The bundle's source/build tooling is available from https://github.com/lovell/sharp-libvips and libvips from https://github.com/libvips/libvips. When you distribute prebuilt containers or installers, retain the supplied notices and meet the corresponding LGPL/source and replacement requirements for the exact native versions you distribute. A link in this document alone is not a substitute for those obligations.

The Dockerfile installs official npm packages and keeps their package files with the runtime dependencies. Development-only build tooling is not copied into the runtime image. This repository does not ship vendored native binaries as Git-tracked source.

## Icons and examples

The included WorkNote application icons and fictional examples are part of this repository's original materials. No customer screenshots, original working records, Android APKs, signing keys or third-party business documents are included.

This inventory documents the resolved dependencies used during preparation; it is not legal advice or a full transitive license audit. Recheck dependencies and accompanying files whenever lockfiles change.
