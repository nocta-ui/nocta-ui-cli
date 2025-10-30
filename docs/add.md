# `nocta-ui add`

## Overview
`add` installs one or more UI components from the Nocta registry into the workspaces defined by your `nocta.config.json`. It downloads source files, writes them to the correct packages, normalises imports, and installs any npm dependencies that are required.

```bash
npx @nocta-ui/cli add button card avatar
# Preview the full plan without touching disk or dependencies
npx @nocta-ui/cli add dialog --dry-run
```

## Prerequisites
- A valid `nocta.config.json` in the current directory (run `nocta-ui init` first).
- Tailwind CSS tokens inserted by `init` (optional but recommended).
- Network access to fetch the registry manifest, component source files, and helper assets.

## Command Options
| Flag | Description |
|------|-------------|
| `--dry-run` | Outputs every planned file write and dependency action without touching the filesystem or running package managers. |
| `--help` | Displays usage help. |

Component names are case-insensitive. You can pass multiple names in one run; the CLI resolves internal dependencies automatically.

## How Component Resolution Works
1. Fetch the latest registry manifest and build a lookup table for slugs and display names.
2. For each requested component, load its metadata plus internal dependencies (if component A depends on B, both are installed automatically).
3. Use the metadata `files[].target` value to determine which workspace should receive each file:
   - If the file targets a linked shared UI workspace, the CLI writes directly into that workspace.
   - Files without an explicit target go to the primary workspace configured in `nocta.config.json`.
4. Component source files are fetched individually from the registry and normalised before writing (import prefixes, alias adjustments, flattening of folder structures, etc.).

## File Placement & Import Normalisation
- Files are written relative to the `aliases.components` and `aliases.utils` paths defined in the config.
- Imports that used the registry’s default `@/` prefix are rewritten to match your configured alias. React Router projects default to `~/`.
- When a linked workspace exposes a custom import alias (`aliases.components.import`), the CLI emits imports using that alias.
- Existing files trigger a prompt. You can decline to cancel the run, or accept to overwrite. Dry runs list the conflicts but never prompt.

## Export Barrels
- If a workspace defines `exports.components` in its `nocta.config.json`, `nocta-ui add` keeps the referenced barrel file in sync.
- New components are appended as named re-exports (`export { Button } from "./components/ui/button";`) inside a marked section so you can still add custom code above or below.
- Dry runs preview the statements that would be added without touching disk.
- Shared UI workspaces initialised with the current CLI default to `src/index.ts`, allowing consumers to import from the package root immediately.

## Dependency Management
- Dependencies declared in the registry (for example `clsx`, `tailwind-merge`, `class-variance-authority`, `@ariakit/react`, `@radix-ui/react-icons`) are grouped by workspace.
- The CLI inspects each workspace’s `package.json` and installed versions. It only installs packages that are missing or incompatible.
- Install commands are scoped to the right workspace:
  - Workspaces with an npm package name use `npm|pnpm|yarn|bun workspace <name> add`.
  - Otherwise the command runs from the workspace root with `--dir`/`--filter` flags when supported.
- When run with `--dry-run`, the CLI reports which dependencies would be installed or updated without modifying anything.

## Summary Output
At the end of a successful run you will see:
- Files written per workspace, including the component name that produced each file.
- Ready-to-copy import statements using your project’s alias prefix.
- Lists of available variants and sizes when the registry provides them.
- Dependency actions (installed, updated, already satisfied) per workspace.

## Monorepo Behaviour
- Linked shared UI workspaces receive the shared component files (and dependency installs) automatically.
- Application workspaces typically only get integration shims or route-specific files; the bulk of the component source lives in the shared package.
- The command honours the same linking rules that `init` recorded in `nocta.config.json` and `nocta.workspace.json`.

## Dry Runs & Automation
- `--dry-run` is ideal for CI or code review. It prints everything that would happen and exits with success without touching files.
- Combine dry runs with `git diff --stat` to preview changes before committing.

## Troubleshooting
- **Component not found** – Run `npx @nocta-ui/cli list` to confirm the canonical component name.
- **Workspace unresolved** – Ensure linked workspaces are defined in `nocta.config.json` and that the relative `config` paths are correct.
- **Dependency conflicts** – Resolve manual overrides in your `package.json` if you want to keep a different version; re-run `add` afterwards to ensure compatibility.

Repeat the command any time you need to scaffold new components or refresh existing ones with the latest registry updates.
