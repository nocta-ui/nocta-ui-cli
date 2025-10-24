# Configuration Files

The Nocta CLI maintains two JSON documents: `nocta.config.json` inside each workspace and `nocta.workspace.json` at the repository root. This guide explains their structure and how they are used.

---

## `nocta.config.json`
Created by `nocta-ui init`, this file describes how the CLI should scaffold components and where shared helpers live.

### Top-Level Fields
| Field | Type | Description |
|-------|------|-------------|
| `$schema` | string (optional) | Points to the public config schema. Added automatically to help IDEs validate the file. |
| `style` | string | Preset name for styling. Currently `default`. Reserved for future themes. |
| `tailwind.css` | string | Relative path to the Tailwind entry file (for design token injection). |
| `aliases` | object | File system destinations and optional import aliases for components and utilities. |
| `aliasPrefixes` | object (optional) | Overrides for the shorthand aliases used when `aliases.*.import` is not provided. |
| `workspace` | object (optional) | Metadata about the workspace in monorepo scenarios (kind, root, links). |

### `aliases`
`aliases.components` and `aliases.utils` accept either a string or an object:

```json
"components": "components/ui"
```
or

```json
"components": {
  "filesystem": "app/components/ui",
  "import": "@app/ui"
}
```

- `filesystem` (string) – Where the CLI writes files relative to the workspace root.
- `import` (string, optional) – The alias used in generated import statements. If omitted, the CLI derives an alias from `aliasPrefixes`.
- `utils` follows the same structure and controls where `lib/utils.ts` (and other helpers) live.

### `aliasPrefixes`
An optional object with `components` and `utils` entries. It is primarily useful when `aliases.*` uses the simple string form and you want to change the default shorthand:

```json
"aliasPrefixes": {
  "components": "@",
  "utils": "@"
}
```

React Router projects default to `"~"`; other frameworks default to `"@"`.

### `workspace`
Describes the current workspace so the CLI can coordinate multi-package repos.

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"app" \| "ui" \| "library"` | Declares the role of this workspace. |
| `packageName` | string (optional) | npm workspace/package name. Enables package-manager-specific install commands. |
| `root` | string | Path from the repo root to this workspace (defaults to `"."`). |
| `linkedWorkspaces` | array (optional) | Workspaces that should receive shared files and dependency updates when running `add`. |

Each entry in `linkedWorkspaces` contains:

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"app" \| "ui" \| "library"` | Role of the linked workspace. Applications typically link to a UI workspace. |
| `packageName` | string (optional) | npm workspace/package name (if available). |
| `root` | string | Path from the repo root to the linked workspace. |
| `config` | string | Relative path (from the current workspace) to the linked workspace’s `nocta.config.json`. |

### Framework Defaults
`init` fills the fields above based on the detected framework:

| Framework | Tailwind CSS file | Component path | Utils path | Alias prefix |
|-----------|------------------|----------------|------------|--------------|
| Next.js (App Router) | `app/globals.css` | `components/ui` | `lib/utils` | `@` |
| Next.js (Pages Router) | `styles/globals.css` | `components/ui` | `lib/utils` | `@` |
| Vite + React | `src/App.css` | `src/components/ui` | `src/lib/utils` | `@` |
| React Router 7 (Framework Mode) | `app/app.css` | `app/components/ui` | `app/lib/utils` | `~` |
| TanStack Start | `src/styles.css` (auto-detected) | `src/components/ui` | `src/lib/utils` | `@` |
| Shared UI / Library | CLI searches common CSS filenames and defaults to `src/styles.css`; component/utils paths live under `src/`. |

You can edit the config after running `init`; future runs merge new information while preserving customisations where possible.

---

## `nocta.workspace.json`
Stored at the repository root, this manifest tracks every workspace that has run `init`. It enables cross-package coordination when you run commands from different directories.

### Structure
```json
{
  "packageManager": "pnpm",
  "repoRoot": ".",
  "workspaces": [
    {
      "name": "@workspace/ui",
      "kind": "ui",
      "packageName": "@workspace/ui",
      "root": "packages/ui",
      "config": "packages/ui/nocta.config.json"
    },
    {
      "name": "@workspace/admin",
      "kind": "app",
      "packageName": "@workspace/admin",
      "root": "apps/admin",
      "config": "apps/admin/nocta.config.json"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `packageManager` | `"npm" \| "pnpm" \| "yarn" \| "bun"` | Detected from repo lockfiles. Used for all install commands. |
| `repoRoot` | string (optional) | Normalised path to the repo root (usually `"."`). |
| `workspaces` | array | Each entry mirrors information from the corresponding `nocta.config.json`. |

Each workspace entry contains:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name (defaults to `root` when no package name is provided). |
| `kind` | `"app" \| "ui" \| "library"` | Workspace role. |
| `packageName` | string (optional) | npm workspace/package name. Helps route package-manager commands. |
| `root` | string | Path from repo root to the workspace. |
| `config` | string | Relative path from repo root to `nocta.config.json`. |

### Lifecycle
- `nocta-ui init` creates or updates the manifest whenever a workspace is registered.
- The file keeps entries sorted by `root` for readability.
- Commands like `add` rely on the manifest to resolve linked workspaces even when you run the CLI from a different directory.

Keep the manifest committed to version control so collaborators share the same workspace topology.
