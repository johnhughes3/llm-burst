# llm-burst

A Chrome extension for sending one prompt to multiple LLM chat providers.

## Overview

LLM Burst Helper opens selected ChatGPT, Claude, Gemini, and Grok sessions, injects the prompt, and supports provider-specific research and temporary-chat modes. The shipped project is a Manifest V3 Chrome extension in `chrome_ext`; there is no Python package or CLI.

## Prerequisites

- Google Chrome
- Node.js 24 LTS
- pnpm 10 (managed through Corepack)

## Installation

```bash
# Clone the repository
git clone https://github.com/johnhughes3/llm-burst.git
cd llm-burst
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Load `chrome_ext` as an unpacked extension from `chrome://extensions`, or run `pnpm build` and load the validated copy from `dist/chrome_ext`.

## Development

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test:playwright
```

The full local gate runs the build, type checks, lint, and Playwright tests:

```bash
pnpm verify
```

Run the dependency security audit separately:

```bash
pnpm audit --audit-level=high
```

When developing against the unpacked extension in Chrome, reload the extension at `chrome://extensions` after source edits so Chrome picks up the latest files.

## Historical references

`docs/specs.md` records an earlier Python CLI design that was not implemented. `docs/reference/original_macros` preserves the Keyboard Maestro source material, and `docs/reference/extension-ui-template` is an archived Bolt/Vite UI prototype; neither reference tree is part of the root build, dependency graph, tests, or shipped extension.

## License

MIT
