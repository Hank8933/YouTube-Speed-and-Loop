# Development

`src/userscript.js` is the editable source of the Tampermonkey userscript.
The repository-root `script.user.js` is the installable artifact consumed by
Tampermonkey and Greasy Fork.

## Requirements

- Node.js 20 or newer

No third-party npm packages are required by this bootstrap pipeline.

## Commands

```bash
npm run build
npm run verify
```

`npm run build` validates the userscript metadata and reproduces
`script.user.js` from `src/userscript.js` using LF line endings and an atomic
file replacement.

`npm run verify` checks that the generated artifact is current, validates both
files with classic-script syntax (the form used by Tampermonkey), and runs the
Node.js test suite.

Do not edit `script.user.js` directly. Make changes in `src/userscript.js`, run
`npm run build`, and commit both files.

This bootstrap step intentionally preserves the v1.2.0 script byte-for-byte
apart from normalized LF line endings. Source modules and a bundler belong in a
separate refactoring change so build-system regressions and module-wiring
regressions remain independently reviewable.
