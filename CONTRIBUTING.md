# Contributing to Permanent Ink

Thanks for taking an interest. Bug reports, feature ideas, and pull requests
are all welcome.

## Reporting bugs

Open an issue at
[github.com/thdngan/permanent-ink/issues](https://github.com/thdngan/permanent-ink/issues)
and include:

- your Obsidian version and operating system,
- whether Restricted Mode was on or off,
- the steps that reproduce the problem, and the note content if it matters.

Editor behaviour is easiest to debug with a short before/after example of what
the note looked like and what you expected.

## Setting up

The plugin requires Node 22 (see `.nvmrc`) and builds with npm.

```bash
git clone https://github.com/thdngan/permanent-ink.git
cd permanent-ink
npm ci
```

`npm run dev` bundles the plugin and the stylesheet in watch mode into
`sandbox/.obsidian/plugins/plugin`, so you can open `sandbox` as a vault in
Obsidian and reload the plugin as you work.

`npm run build` runs the type check and the linter, then writes the release
artifacts (`main.js`, `styles.css`, `manifest.json`) into `build`.

## Before opening a pull request

- Run `npm run build`. It must pass cleanly, since the release workflow runs the
  same steps.
- Keep the source formatted with Prettier (tabs, as configured in `.prettierrc`).
- Describe what changed in the editor behaviour, and mention anything a user
  would notice.

## Releasing

Maintainers only. `npm version <patch|minor|major>` bumps `package.json`,
`manifest.json`, and `versions.json`, then pushing the tag triggers
`.github/workflows/release.yml`, which builds from source, attaches a build
provenance attestation, and opens a draft release for review.

## Code layout

| Path | What lives there |
|---|---|
| `src/main.ts` | Plugin entry point, Restricted Mode key handling, commands |
| `src/editor/` | CodeMirror 6 extension, inline widgets, popovers |
| `src/preview/` | Reading view post-processor |
| `src/view.tsx` | Annotations sidebar |
| `src/styles.css` | Tailwind entry point and plugin styles |
