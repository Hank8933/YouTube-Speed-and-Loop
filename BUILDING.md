# Development

The userscript source is split by responsibility under `src/`. The metadata
block lives in `src/metadata.txt`, while `scripts/source-manifest.mjs` defines
the deterministic assembly order for the JavaScript source files.

The repository-root `script.user.js` is the generated installable artifact used
by Tampermonkey and Greasy Fork.

## Requirements

- Node.js 20 or newer

No third-party npm packages are required.

## Commands

```bash
npm ci
npm run build
npm run verify
```

`npm run build` performs the following steps:

1. checks that every JavaScript file under `src/` is listed exactly once in the
   source manifest;
2. validates the metadata block and its version;
3. validates each source file as classic JavaScript;
4. assembles the files inside one userscript IIFE using LF line endings; and
5. writes `script.user.js` through a temporary file before renaming it into
   place.

`npm run verify` checks that the generated artifact is current, validates the
source files and output syntax, and runs the Node.js test suite.

Do not edit `script.user.js` directly. Edit the appropriate file under `src/`,
run `npm run build`, and commit both the source changes and generated artifact.

## Source layout

```text
src/
├─ metadata.txt
├─ config/
├─ core/
├─ i18n/
├─ storage/
├─ services/
├─ controllers/
├─ youtube/
├─ ui/
│  └─ panel-view/
├─ app/
└─ main.js
```

Most files are classic-script source fragments rather than independently loaded
browser modules. Large classes may be stored as independently valid class fragments;
the build removes their duplicate class wrappers and rejoins the method bodies in
manifest order. Their order is explicit in `scripts/source-manifest.mjs`, and
they are always distributed as the single generated `script.user.js` file.
