# `nocta-ui list`

## Overview
`list` queries the Nocta registry and prints an organised catalogue of available components, grouped by category with descriptions, variants, and sizes. Use it to discover component names that can be passed to `nocta-ui add`.

```bash
npx @nocta-ui/cli list
```

## What It Does
- Downloads the registry manifest from the configured endpoint (defaults to `https://nocta-ui.com/registry`).
- Sorts categories alphabetically and prints each component in lowercase (the `add` command is case-insensitive).
- Shows available variants and sizes when the registry provides them.
- Ends with quick examples for installing components.

## Notes
- The command is read-only: it never writes to disk or installs dependencies.
- You can override the registry location with `--registry-url` or the `NOCTA_REGISTRY_URL` environment variable.
- Output is designed for humans; use the public registry JSON if you need to script against the data.
