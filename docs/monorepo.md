# Monorepo Guide

Nocta CLI understands multi-package repositories out of the box. This guide shows how to configure shared UI workspaces, link applications, and keep dependencies in sync.

---

## Terminology
- **Application workspace** – A frontend app (e.g. Next.js) that consumes shared UI components.
- **Shared UI workspace** – A package (often `packages/ui`) that owns the reusable component source.
- **Library workspace** – Any other package that should participate in component scaffolding.

Every workspace gets its own `nocta.config.json`. The repository root stores a manifest (`nocta.workspace.json`) listing all known workspaces.

---

## Recommended Workflow

### 1. Initialise the Shared UI Workspace
```bash
cd packages/ui
npx @nocta-ui/cli init
```
- Choose **Shared UI workspace** when prompted.
- Provide the npm workspace/package name (for example `@workspace/ui`) if you use one.
- The CLI writes `nocta.config.json`, helper files (`src/lib/utils.ts`, `src/components/ui/icons.ts`), and updates `nocta.workspace.json`.
- Dependencies such as `@ariakit/react`, `clsx`, and `tailwind-merge` are installed here.
- `package.json` is updated (or reported in dry-run) so `exports["."]` points at `src/index.ts`, the auto-generated barrel file.

### 2. Initialise Each Application Workspace
```bash
cd apps/admin
npx @nocta-ui/cli init
```
- Select **Application workspace** when prompted.
- Pick the shared UI workspace(s) to link. The CLI stores relative config paths so later commands can find them.
- Dependencies are *not* re-installed in the application workspace; they remain centralised in the shared UI package.
- Helper files (`lib/utils.ts`, `components/ui/icons.ts`) are skipped because they already exist in the linked workspace.

### 3. Add Components From an Application
```bash
cd apps/admin
npx @nocta-ui/cli add button
```
- Component source files are written into the linked shared UI workspace.
- Any app-specific adapters (routes, providers) are written into the application itself when the registry marks them with `target: "app"`.
- Dependency installation commands run against the workspace that owns each file:
  - Shared UI workspace receives the component dependencies.
  - Application workspace only receives integration packages if the registry explicitly marks them as such.
- When the shared UI workspace defines `exports.components`, the CLI updates that barrel (default `src/index.ts`) so consumers can import from the package root without extra steps.

### 4. Repeat for Additional Apps or Libraries
Each new workspace should run `init` once to register itself. Linking to the shared UI package ensures components stay centralised.

---

## How Linking Works
When you link a workspace in the `init` prompt, the CLI records an entry in `linkedWorkspaces` inside the application’s `nocta.config.json`:

```json
"linkedWorkspaces": [
  {
    "kind": "ui",
    "packageName": "@workspace/ui",
    "root": "packages/ui",
    "config": "../packages/ui/nocta.config.json"
  }
]
```

- `root` is relative to the repository. It ensures commands can reach the shared workspace even when executed from another directory.
- `config` is a relative path from the application workspace to the linked workspace’s configuration. The CLI uses it to load alias information, import prefixes, and dependency metadata.
- Multiple links are supported. For example, an app could target both a shared UI package and a utilities library.

---

## Dependency Strategy
- Shared UI workspaces are the canonical place for component dependencies (React, Tailwind helpers, headless UI libraries).
- Application workspaces skip dependency installation during `init` when they link to a UI package. This prevents duplicated versions of React, Tailwind, and related libraries.
- During `add`, each workspace is inspected individually. Only missing or incompatible packages are installed, and commands are scoped (`pnpm add --filter`, `yarn workspace`, `bun add`, etc.) using the information from `nocta.workspace.json`.

---

## Keeping the Manifest in Sync
- `nocta.workspace.json` is updated every time you run `init` in any workspace. Commit this file so collaborators share the same topology.
- The manifest keeps entries sorted by root path for readability.
- If the package manager at the repo root changes, re-run `init` (or edit the manifest manually) so the CLI knows which tool to use.

---

## Best Practices
- **Run `init` before `add`** in every workspace that needs Nocta components.
- **Use npm workspace names** (`packageName`) to improve dependency installation fidelity.
- **Keep relative paths correct** – if you move a workspace, update both `root` and `config` in your `nocta.config.json`.
- **Opt into auto-exports** – ensure your shared UI config includes `\"exports\": { \"components\": { \"barrel\": \"src/index.ts\" } }` (added automatically by the latest CLI) so new components are re-exported for consumers.
- **Leverage `--dry-run`** for both `init` and `add` to validate changes before committing.
- **Regenerate configs after restructuring** (e.g. when upgrading Next.js routing) to ensure aliases and Tailwind paths stay correct.

---

## Troubleshooting
- **Linked workspace not found** – Check that `config` points to a valid `nocta.config.json` and that the linked workspace has run `init`.
- **Dependencies installed in the wrong package** – Ensure each workspace has the correct `packageName`. Remove stale `node_modules` folders if you moved packages without re-running `init`.
- **Component files appear in the app instead of the shared UI** – Confirm the registry metadata for that component. Some files (providers, route-level wrappers) intentionally target the application.

Following this workflow keeps shared UI code centralised, avoids duplicate dependencies, and allows the CLI to orchestrate complex installations across your monorepo with minimal effort.
