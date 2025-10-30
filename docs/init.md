# `nocta-ui init`

## Overview
`init` bootstraps the current workspace so it can consume Nocta UI components. It analyses your project structure, writes `nocta.config.json`, ensures the repository manifest is updated, and prepares shared helpers. The command respects monorepo layouts and only creates files in the workspace that should own them.

```bash
npx @nocta-ui/cli init
# Preview without touching the filesystem
npx @nocta-ui/cli init --dry-run
```

## Prerequisites
- Node.js 18+ and an existing React project (Next.js, Vite + React, React Router 7, or TanStack Start). Custom apps are supported for shared UI workspaces.
- Tailwind CSS v4 declared (and installed when possible). The command aborts with guidance if v4 is missing.
- Network access to fetch the registry, helper assets, and CSS tokens.
- A clean or at least recoverable working tree — the CLI performs partial rollback if something fails after writing files.

## Command Options
| Flag | Description |
|------|-------------|
| `--dry-run` | Reports every action (files, dependencies, manifest changes) without touching disk or running package managers. |
| `--help` | Displays command-specific help. |

You can also point the CLI at a custom registry with `--registry-url` or `NOCTA_REGISTRY_URL`.

## Interactive Prompts
`init` inspects your repository and asks extra questions only when needed:
1. **Workspace kind** – If the repo looks like a monorepo and the current folder is not yet registered, you choose between *Application*, *Shared UI*, or *Library*. The defaults are inferred from folder names (e.g. `packages/ui` → Shared UI).
2. **Workspace package name** – In monorepos you can provide the npm workspace/package name so other commands can target it precisely. Leave blank to skip.
3. **Linked workspaces** – When configuring an Application workspace inside a monorepo, you can link one or more existing Shared UI workspaces. Linked workspaces receive shared files and dependency updates when you later run `add`.

## Initialization Flow
1. **Existing config check** – If `nocta.config.json` already exists, the command exits without touching anything.
2. **Repository resolution** – Detects the repo root, loads `nocta.workspace.json` (creating it later if missing), and determines whether multiple workspaces exist.
3. **Framework detection** – Locates the supported framework. For Application workspaces the command aborts with a helpful message when the framework is unknown.
4. **Tailwind verification** – Ensures Tailwind CSS v4 is declared/installed.
5. **Configuration synthesis** – Builds a `nocta.config.json` tailored to the detected framework. The file includes:
   - `tailwind.css` entry where design tokens will be inserted.
   - `aliases.components` and `aliases.utils` pointing at the default component/lib folders.
   - `aliasPrefixes` (`@` for most frameworks, `~` for React Router).
   - `workspace` block containing the workspace kind, root, package name, and any links you selected.
6. **Dependency handling** – Reads the registry requirements (React, Tailwind helpers, Ariakit, etc.) and only installs them when the current workspace manages its own dependencies. Application workspaces linked to a shared UI package skip these installs because the shared package already owns them.
7. **Helper assets** – When the current workspace manages its own components, the CLI writes:
   - `lib/utils.ts` with the canonical `cn()` helper.
   - `components/ui/icons.ts` with the base icon map.
   Linked Application workspaces reuse the helpers from the shared UI package and therefore skip these files.
8. **Design tokens** – Adds Nocta semantic color tokens to the configured Tailwind CSS file when the workspace manages its own components. Linked applications skip this step because the shared UI package already owns the tokens.
9. **Workspace manifest** – Creates or updates `nocta.workspace.json` at the repo root so other workspaces can discover this configuration. Package manager detection (npm, pnpm, yarn, bun) is stored here as well.
10. **Summary** – Prints a concise report including created files, dependency actions, and linked workspaces. Dry runs label each item as “would do”.

## Generated Files
- `nocta.config.json` – Main project configuration (always written unless `--dry-run`).
- `nocta.workspace.json` – Repository manifest (created/updated once per repo).
- `lib/utils.ts` – Shared utility helper (skipped in linked app workspaces).
- `components/ui/icons.ts` – Base icons module (skipped in linked app workspaces).
- Tailwind CSS entry file – Updated with Nocta design tokens.

All generated paths are made relative to the current workspace. Failures during execution trigger a rollback that deletes any newly created files.

## Re-running the Command
You can safely re-run `init` when you:
- Change framework routing structure (e.g. move from Pages Router to App Router).
- Add or rename linked workspaces in a monorepo.
- Want to regenerate the config after manual edits.

Existing files are preserved: helper files are skipped when already present, and design tokens are only inserted once.

## Troubleshooting
- **Tailwind CSS v4 missing** – Install or upgrade Tailwind, then run `init` again.
- **Unsupported framework detected** – Ensure your project matches one of the supported setups or initialise the shared UI package separately before linking from an app.
- **Package manager mismatch** – The CLI honours the lockfile at the repo root; delete stale lockfiles if you intentionally switch managers.
