# Nocta UI CLI

> **Note:** This CLI is built with Rust for blazing-fast performance and reliability, with a lightweight JavaScript wrapper for seamless npm distribution.

Modern command line tooling for [Nocta UI](https://github.com/nocta-ui/nocta-ui). Initialize projects, browse the component registry, and scaffold UI files without leaving your terminal.

## Features
- **Lightning-fast execution** powered by a Rust core with minimal JavaScript overhead
- Auto-detects Next.js, Vite + React, and React Router 7 (framework mode)
- Creates `nocta.config.json`, injects Tailwind v4 tokens, and sets up shared utilities
- Fetches live component metadata from the Nocta registry
- Adds components with internal dependencies, import normalization, and npm packages
- Understands linked monorepo workspaces (apps, shared UI packages) and routes files and dependencies automatically
- Respects your package manager (`npm`, `yarn`, `pnpm`, or `bun`) based on lockfiles

## Requirements
- Node.js 18+
- React 18+
- Tailwind CSS v4 installed in your project
- Internet access when running commands (registry + assets are downloaded on demand)

## Quick Start
```bash
# Initialize your project (no global install required)
npx @nocta-ui/cli init

# Browse available components
npx @nocta-ui/cli list

# Add components (installs dependencies and files)
npx @nocta-ui/cli add button card badge
```

## Installation
The CLI is distributed via npm. You can run it with `npx` (recommended) or add it to the `scripts` section of your project.
```bash
npx @nocta-ui/cli --help
```

Prefer a global install? Install once and invoke it anywhere with the `nocta-ui` command.
```bash
npm install -g @nocta-ui/cli
nocta-ui --help
```

## Commands

### `init`
```bash
npx @nocta-ui/cli init
# Preview without changes
npx @nocta-ui/cli init --dry-run
```
- Validates Tailwind CSS v4 and shows upgrade guidance when an older version is detected
- Detects supported frameworks (Next.js App Router / Pages Router, Vite + React, React Router 7)
- Detects monorepo layouts, prompts for app/UI/library roles, and links to shared UI packages when present
- Generates `nocta.config.json` tailored to your project directories
- Creates or updates `nocta.workspace.json` so other workspaces can discover this package
- Downloads shared helpers (`lib/utils.ts`) and a base `icons.ts`
- Injects Nocta design tokens into the configured Tailwind CSS entry file
- Installs core dependencies: `clsx`, `tailwind-merge`, `class-variance-authority`, `@ariakit/react`, `@radix-ui/react-icons`
- Rolls back created files if initialization fails midway

### `list`
```bash
npx @nocta-ui/cli list
```
- Loads categories and component descriptions from `https://nocta-ui.com/registry`
- Displays variants and sizes when provided
- Reminds you to install components with `npx @nocta-ui/cli add <name>`

### `add <components...>`
```bash
npx @nocta-ui/cli add button card dialog
# Preview without changes
npx @nocta-ui/cli add button --dry-run
```
- Requires a valid `nocta.config.json`
- Accepts one or multiple component names; nested dependencies are resolved automatically
- Writes files into the folder configured by `aliases.components`
- In monorepos, writes shared UI files to linked workspaces and updates imports automatically
- Prompts before overwriting existing files
- Normalizes import aliases using the prefix from `nocta.config.json` (defaults to `@/` for Next.js/Vite or `~/` for React Router 7)
- Installs missing npm packages and reports satisfied or updated versions
- Scopes dependency installation commands to the workspace that owns each component
- Prints created paths plus ready-to-copy import statements, variants, and sizes
- Supports `--dry-run` to preview all file writes and dependency changes without modifying the project

### `--help`
```bash
npx @nocta-ui/cli --help
```
View the top-level help output and available commands.

## Performance

The Nocta CLI delivers near-instant command execution thanks to its **Rust-powered core**. File operations, dependency resolution, and registry parsing run at native speeds, while a thin JavaScript wrapper ensures seamless integration with npm and Node.js tooling. Whether you're initializing a project or installing dozens of components, you'll experience the speed of a compiled binary with the convenience of an npm package.

## Configuration
`nocta.config.json` governs where files are written and which CSS entry receives design tokens.

```json
{
  "$schema": "https://nocta-ui.com/registry/config-schema.json",
  "style": "default",
  "tailwind": {
    "css": "app/globals.css"
  },
  "aliases": {
    "components": {
      "filesystem": "app/components/ui",
      "import": "@workspace/ui/components"
    },
    "utils": {
      "filesystem": "app/lib/utils"
    }
  },
  "aliasPrefixes": {
    "components": "@",
    "utils": "@"
  },
  "workspace": {
    "kind": "app",
    "packageName": "@workspace/web",
    "root": ".",
    "linkedWorkspaces": [
      {
        "kind": "ui",
        "packageName": "@workspace/ui",
        "root": "packages/ui",
        "config": "../packages/ui/nocta.config.json"
      }
    ]
  }
}
```
- Next.js App Router defaults to `app/globals.css`, `components/ui`, and `lib/utils`
- Next.js Pages Router uses `styles/globals.css`
- Vite + React uses `src/App.css`, `src/components/ui`, and `src/lib/utils`
- Tanstack Start uses `src/styles.css`, `src/components/ui`, and `src/lib/utils`
- React Router 7 uses `app/app.css`, `app/components/ui`, and `app/lib/utils`
- `aliases.*` can be a string (legacy) or an object with `filesystem` and optional `import` keys
- `aliasPrefixes` still override the default shorthand used when no explicit `import` prefix is provided
- The `workspace` block records the current package role, npm name, relative root, and any linked workspaces the CLI should write to

The CLI also maintains a repository manifest named `nocta.workspace.json` at the repo root:

```json
{
  "packageManager": "pnpm",
  "workspaces": [
    {
      "name": "@workspace/web",
      "kind": "app",
      "root": "apps/web",
      "config": "apps/web/nocta.config.json"
    },
    {
      "name": "@workspace/ui",
      "kind": "ui",
      "root": "packages/ui",
      "config": "packages/ui/nocta.config.json"
    }
  ]
}
```
- The manifest enables workspace discovery when commands are run from any package
- `init` keeps this file synchronised whenever you register new workspaces

## How Component Installation Works
1. Fetch component metadata and source files from the registry.
2. Normalize imports and file paths for your framework.
3. Write component files, utilities, and icons to your project.
4. Inspect existing files and prompt before overwriting.
5. Detect installed dependencies, install missing versions, and log the results.

## Networking Notes
- The registry, component source files, and design tokens are hosted remotely; commands need network access.
- Built-in caching reduces repeated network calls and allows offline fallback:
  - Cache directory: `./.nocta-cache` (override with `NOCTA_CACHE_DIR`)
  - Default TTLs: registry 10 minutes, assets 24 hours (override via `NOCTA_CACHE_TTL_MS`, `NOCTA_ASSET_CACHE_TTL_MS`)
  - On network failure, the CLI falls back to the most recent cached content when available.

## Troubleshooting
- **Missing Tailwind CSS v4**: Install or upgrade with `npm install -D tailwindcss@latest` (or the equivalent for your package manager).
- **Unsupported framework detected**: Ensure you're using one of the supported frameworks or adjust your project structure so detection can succeed.
- **Component not found**: Run `npx @nocta-ui/cli list` to confirm the component name, then try again.

## License
MIT License
