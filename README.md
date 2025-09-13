# nocta-ui

CLI for [Nocta UI](https://github.com/66HEX/nocta-ui) - Modern, accessible React components built with TypeScript and Tailwind CSS.

## Quick Start

```bash
# Install Tailwind CSS v4
npm install -D tailwindcss

# Initialize your project
npx nocta-ui init

# Add components
npx nocta-ui add button
npx nocta-ui add card
```

## Commands

### `init`
Initialize your project with Nocta UI:
```bash
npx nocta-ui init
```
- Auto-detects your framework (Next.js, Vite, React Router 7)
- Creates `nocta.config.json` configuration
- Installs required dependencies
- Adds semantic design tokens to your CSS
- Creates utility functions

### `list`
Show all available components:
```bash
npx nocta-ui list
```

### `add <component>`
Add components to your project:
```bash
npx nocta-ui add button card dialog
```

## Framework Support

- **Next.js** (App Router & Pages Router)
- **Vite + React**
- **React Router 7** (Framework Mode)

## Requirements

- React 18+
- Tailwind CSS v4
- TypeScript (recommended)
- Node.js 16+

## License

ISC License
