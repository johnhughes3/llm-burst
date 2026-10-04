# Repository guidance

LLM Burst is a Manifest V3 Chrome extension that sends a prompt to selected chat providers. Read `README.md` and `package.json` before changing the development workflow.

- Shipped extension code lives in `chrome_ext/`; provider-specific injectors live in `chrome_ext/content/injectors/` and share `utils.js`.
- `scripts/build-extension.mjs` validates and copies the extension into `dist/chrome_ext`. Edit source files, not build output.
- `docs/specs.md` describes an unimplemented Python CLI. `docs/reference/` contains historical macros and an archived UI prototype, outside the root build and tests.
- Use Node.js 24 and the pnpm version pinned in `package.json`. Install with `pnpm install --frozen-lockfile`.
- Run `pnpm format` for the configured formatting check and `pnpm verify` for build, both TypeScript projects, lint, and Playwright tests. Install the browser with `pnpm exec playwright install chromium` when needed. The format and lint scripts currently cover the Claude injector; inspect their scope before claiming repository-wide coverage.
- Keep automated checks independent of personal browser sessions and live provider accounts. Do not commit chat content, cookies, credentials, or browser profiles.
- Reload an unpacked extension in Chrome after source edits when performing manual validation. Distinguish local browser tests from live-provider behavior.
- Keep agent instructions in root `AGENTS.md`, or use a root symlink to `.agents/AGENTS.md` if the guidance is moved there.
