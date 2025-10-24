# Bun + Nocta UI Monorepo Setup Guide

Follow these steps to configure a monorepo with Next.js (`apps/web`) and a shared Nocta UI package (`packages/ui`). The UI package compiles TypeScript to `dist/` and builds Tailwind v4 CSS to `dist/styles.css`.

## Prerequisites

- Bun ≥ 1.1
- Node + npx (for one-time tools)
- Git (optional)

## 1. Initialize Blank Repository

```bash
mkdir nocta-bun-monorepo
cd nocta-bun-monorepo
bun init --y
```

Install dependencies:

```bash
bun install concurrently rimraf
```

## 1.1 Modify Root package.json

```json
{
  "name": "nocta-bun-monorepo",
  "module": "index.ts",
  "type": "module",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^5"
  }
}
```

## 2. Shared UI Package (packages/ui)

### 2.1 Setup Blank Repository

```bash
mkdir -p packages/ui/
cd packages/ui
bun init --y
```

Install dependencies:

```bash
bun add -D tsc-alias rimraf concurrently tailwindcss
```

### 2.3 packages/ui/tsconfig.json

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": true,
    "outDir": "dist",
    "declaration": true,
    "declarationDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  }
}
```

**Note:** Using `baseUrl: "src"` together with `paths` allows `@/...` aliases in source files. After compilation, `tsc-alias` rewrites those imports to relative paths in `dist/`.

### 2.4 packages/ui/package.json

```json
{
  "devDependencies": {
    "@types/bun": "latest",
    "concurrently": "^9.2.1",
    "rimraf": "^6.0.1",
    "tailwindcss": "^4.1.15",
    "tsc-alias": "^1.8.16",
    "typescript": "^5.9.3"
  },
  "exports": {
    ".": {
      "import": "./dist/src/index.js",
      "types": "./dist/src/index.d.ts"
    },
    "./dist/styles.css": "./dist/styles.css"
  },
  "files": [
    "dist"
  ],
  "main": "./dist/src/index.js.",
  "module": "./dist/src/index.js.",
  "name": "ui",
  "peerDependencies": {
    "typescript": "^5.9.3"
  },
  "private": true,
  "scripts": {
    "build": "bun run clean && bun run build:css && bun run build:ts",
    "build:css": "mkdir -p dist && bunx tailwindcss --input src/styles.css --output dist/styles.css --minify",
    "build:ts": "tsc -p tsconfig.json && tsc-alias -p tsconfig.json",
    "clean": "rimraf dist",
    "dev": "concurrently -k -n TS,ALIAS,CSS \"bun run dev:ts\" \"bun run dev:alias\" \"bun run dev:css\"",
    "dev:alias": "tsc-alias -w -p tsconfig.json",
    "dev:css": "bunx tailwindcss --input src/styles.css --output dist/styles.css --watch",
    "dev:ts": "tsc -w -p tsconfig.json"
  },
  "type": "module",
  "types": "./dist/src/index.d.ts"
}
```

Running `bun run --filter ui build` compiles TypeScript to `dist/` and CSS to `dist/styles.css`.
Running `bun run --filter ui dev` enables watch mode for TypeScript, aliases, and CSS.

## 3. Next.js Application (apps/web)

### 3.1 Setup

```bash
cd ../../
mkdir -p apps/web
cd apps/web
bun create next-app@latest . --yes
```

### 3.2 apps/web/package.json

Add the UI package dependency via workspaces:

```json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "next": "16.0.0",
    "ui": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4",
    "eslint": "^9",
    "eslint-config-next": "16.0.0"
  }
}
```

### 3.5 Using the UI Package

Import global UI styles in `app/layout.tsx`:

```typescript
import "ui/dist/styles.css";
```

Import components wherever needed:

```typescript
import { Button } from "ui";
```

## 4. Nocta CLI

### In packages/ui:

```bash
npx @nocta-ui/cli init   # Shared UI workspace
```

### In apps/web:

```bash
npx @nocta-ui/cli init   # Application workspace, point to packages/ui
```

```bash
npx @nocta-ui/cli add button   # Add Button component (installed to Shared UI)
```

After adding or modifying components via CLI, run in `packages/ui`:
- `bun run build` (production), or
- Keep `bun run dev` running (watch mode)

## 5. Monorepo Commands

From the root directory:

```bash
# Install workspace links
bun install

# Development (separate terminals)
bun run --filter ui dev
bun run --filter web dev

# Production build
bun run --filter ui build
bun run --filter web build
```

## 6. Best Practices

- Package sources can use `@/...` aliases; after build, `tsc-alias` converts them to relative paths in `dist/`.
- The application does not transpile the package; it only imports from `dist/`.
- Do not add paths to `packages/ui/src/*` in the app; doing so would reintroduce aliases and direct source imports.
- After any style or component changes, keep `bun run --filter ui dev` running or execute `bun run --filter ui build`.
