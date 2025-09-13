# nocta-ui

CLI for [Nocta UI](https://github.com/66HEX/nocta-ui) - Modern, accessible React components built with TypeScript and Tailwind CSS.

## Quick Start

```bash
# Make sure Tailwind CSS is installed
npm install -D tailwindcss

# Initialize your project
npx nocta-ui init

# Add components
npx nocta-ui add button
npx nocta-ui add card
npx nocta-ui add alert
```

## Installation

No installation required! Use with `npx`:

```bash
npx nocta-ui <command>
```

Or install globally:

```bash
npm install -g nocta-ui
nocta-ui <command>
```

## Commands

### `init`
Initialize your project with Nocta UI configuration:
```bash
npx nocta-ui init
```
- **Validates Tailwind CSS installation** - Ensures Tailwind is properly installed
- Creates `nocta.config.json` configuration file
- **Auto-detects your framework** (Next.js, Vite, React Router 7)
- Requires Tailwind CSS v4 (v3 no longer supported)
- **Installs required dependencies:** `clsx`, `tailwind-merge` and `class-variance-authority`
- **Creates utility functions:** `@/lib/utils.ts` with `cn()` helper for className merging
- **Adds semantic design tokens** to your CSS using `@theme inline` (background, foreground, primary, border, ring, overlay, gradients)
- **Framework-specific configuration** - Automatically configures paths and aliases for your framework

**What happens during init:**
```bash
npx nocta-ui init

⠦ Checking Tailwind CSS installation...
✔ Found Tailwind CSS ^3.4.0 ✓
⠦ Detecting project framework...
✔ Found React Router 7.0.0 (Framework Mode) ✓

⠦ Installing required dependencies...
✔ nocta-ui initialized successfully!

Configuration created:
   nocta.config.json (React Router 7.0.0 Framework Mode)

Dependencies installed:
   clsx@^2.1.1
   tailwind-merge@^3.3.1
   class-variance-authority@^0.7.1

Utility functions created:
   app/lib/utils.ts
   • cn() function for className merging

Semantic tokens added:
   app/app.css
   • `:root` + `.dark` color variables
   • `@theme inline` mapping for Tailwind v4
   • Use classes: bg-background, text-foreground, border-border, text-primary
```

#### Init Command Flow

The following flowchart shows the complete initialization process:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="flowchart-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="flowchart.svg">
  <img alt="Nocta UI Init Command Flow" src="flowchart.svg">
</picture>

### `list`
Show all available components grouped by category:
```bash
npx nocta-ui list
```

### `add <component>`
Add a component to your project:
```bash
npx nocta-ui add button
npx nocta-ui add card
npx nocta-ui add dialog
```
- **Downloads component files** to your project
- **Installs required dependencies** automatically
- **Framework-aware import aliases** - Automatically uses correct import paths:
  - **Next.js/Vite**: `import { cn } from '@/lib/utils'`
  - **React Router 7**: `import { cn } from '~/lib/utils'`
- **Shows usage examples** and available variants with correct import paths 

## Advanced Features

### Framework Detection & Automatic Aliases

The CLI automatically detects your framework and configures the appropriate import aliases:

| Framework | CSS File | Component Path | Utils Path | Import Alias |
|-----------|----------|---------------|-----------|-------------|
| **Next.js (App Router)** | `app/globals.css` | `components` | `lib/utils` | `@/lib/utils` |
| **Next.js (Pages Router)** | `styles/globals.css` | `components` | `lib/utils` | `@/lib/utils` |
| **Vite + React** | `src/App.css` | `src/components` | `src/lib/utils` | `@/lib/utils` |
| **React Router 7** | `app/app.css` | `app/components` | `app/lib/utils` | `~/lib/utils` |

**Smart alias replacement:**
When adding components, the CLI automatically converts import paths to match your framework:

```tsx
// Registry component uses generic @/ alias
import { cn } from '@/lib/utils'

// Automatically converted based on your framework:
// Next.js/Vite: import { cn } from '@/lib/utils'
// React Router 7: import { cn } from '~/lib/utils'
```

**Framework detection logic:**
- **Next.js** - Detects `next` dependency and config files
- **Vite** - Detects `vite` dependency and React setup
- **React Router 7** - Detects `react-router` and `@react-router/dev` dependencies

### Design Tokens Integration (Tailwind v4)
The CLI adds semantic color variables to your CSS and maps them via `@theme inline` for Tailwind v4. You get:

- `:root` and `.dark` CSS variables like `--color-background`, `--color-foreground`, `--color-primary`, `--color-border`, etc.
- `@theme inline` mapping so you can use Tailwind classes such as `bg-background`, `text-foreground`, `border-border`, `text-primary`, `ring`, and gradient tokens.

Example usage:
```tsx
<div className="bg-background text-foreground border-border">
  <Button className="bg-primary text-primary-foreground hover:bg-primary-muted">
    Primary Action
  </Button>
</div>
```

### Theme Selection
Theme selection has been removed. Nocta UI now ships a single, neutral semantic palette designed to work well in both light and dark modes using `:root` and `.dark` variables.

**Configuration Examples:**

**Next.js (App Router):**
```json
{
  "style": "default",
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css"
  },
  "aliases": {
    "components": "components",
    "utils": "lib/utils"
  }
}
```

**Vite + React:**
```json
{
  "style": "default",
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/App.css"
  },
  "aliases": {
    "components": "src/components",
    "utils": "src/lib/utils"
  }
}
```

**React Router 7:**
```json
{
  "style": "default",
  "tsx": true,
  "theme": "jade",
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "app/app.css"
  },
  "aliases": {
    "components": "app/components",
    "utils": "app/lib/utils"
  }
}
```

### Tailwind CSS Validation
The CLI validates that Tailwind CSS is properly installed before initialization:

```bash
npx nocta-ui init

Tailwind CSS is not installed or not found in node_modules
Please install Tailwind CSS first:
   npm install -D tailwindcss
   # or
   yarn add -D tailwindcss
   # or  
   pnpm add -D tailwindcss

Visit https://tailwindcss.com/docs/installation for setup guide
```

**Smart version detection:**
- Automatically detects Tailwind v3 vs v4
- Uses appropriate method for adding design tokens
- Provides version-specific guidance

### Overwrite Protection
When adding a component that already exists in your project, the CLI will:

1. **Detect existing files** and show which ones would be overwritten
2. **Ask for confirmation** before proceeding
3. **Allow you to cancel** to prevent accidental data loss

```bash
npx nocta-ui add button

The following files already exist:
   src/components/ui/button.tsx
   
? Do you want to overwrite these files? (y/N)
```

- Choose **Y** to overwrite existing files
- Choose **N** (default) to cancel installation and preserve your changes

### Automatic Internal Dependencies
Some components depend on other components to work properly. The CLI automatically handles this:

**Example: Adding Table component**
```bash
npx nocta-ui add table

Installing table with internal dependencies:
   • spinner
   • table (main component)

Components installed:
   src/components/ui/spinner.tsx (spinner)
   src/components/ui/table.tsx (table)
```

**Smart dependency resolution:**
- **Recursive detection** - Finds all nested dependencies
- **Duplicate prevention** - Avoids installing the same component twice
- **Conflict checking** - Asks about overwriting for all affected files
- **Clear communication** - Shows exactly what will be installed

## Requirements

- React 18+
- **Tailwind CSS v3 or v4** (required - validated during init)
- TypeScript (recommended)
- Node.js 16+

## Framework Support

- **Next.js** (App Router & Pages Router)
- **Vite + React**
- **React Router 7** (Framework Mode)

## Features

- **Modern Design** - Clean, professional components with beautiful color palette  
- **4 Color Themes** - Choose from Charcoal, Jade, Copper, or Cobalt themes  
- **Accessible** - ARIA compliant, keyboard navigation  
- **Dark Mode** - Built-in dark mode support  
- **Responsive** - Mobile-first design  
- **Customizable** - Multiple variants and sizes + custom design tokens  
- **Zero Config** - Auto-detects your setup and Tailwind version  
- **Fast** - Optimized performance  
- **Safe** - Validates requirements and protects existing files  

## Usage Examples

### Next.js & Vite

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default function Example() {
  return (
    <Card className="border-nocta-200">
      <CardHeader className="bg-nocta-50">
        <CardTitle className="text-nocta-900">Welcome to Nocta UI</CardTitle>
      </CardHeader>
      <CardContent className="bg-white">
        <Button 
          variant="primary" 
          size="lg"
          className="bg-nocta-500 hover:bg-nocta-600"
        >
          Get Started
        </Button>
      </CardContent>
    </Card>
  )
}
```

### React Router 7

```tsx
import { Button } from "~/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card"

export default function Example() {
  return (
    <Card className="border-nocta-200">
      <CardHeader className="bg-nocta-50">
        <CardTitle className="text-nocta-900">Welcome to Nocta UI</CardTitle>
      </CardHeader>
      <CardContent className="bg-white">
        <Button 
          variant="primary" 
          size="lg"
          className="bg-nocta-500 hover:bg-nocta-600"
        >
          Get Started
        </Button>
      </CardContent>
    </Card>
  )
}
```

> **Note:** The example above works with all themes! Whether you choose Charcoal, Jade, Copper, or Cobalt, the class names remain the same - only the actual colors change based on your selected theme.

## Documentation

Visit [Nocta UI Documentation](https://github.com/66HEX/nocta-ui) for component demos, API reference, and customization guides.

## Contributing

Found a bug or have a feature request? Please open an issue on [GitHub](https://github.com/66HEX/nocta-ui-cli/issues).

## License

ISC License

---
