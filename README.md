# nocta-ui

CLI for [Nocta UI](https://github.com/66HEX/nocta-ui) - Modern, accessible React components built with TypeScript and Tailwind CSS.

## Quick Start

```bash
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
- Creates `components.json` configuration file
- Auto-detects your framework (Next.js, Vite, or generic React)
- Supports Tailwind CSS v3 and v4

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
- Downloads component files to your project
- Installs required dependencies automatically
- Shows usage examples and available variants 

## Requirements

- React 18+
- TypeScript (recommended)
- Tailwind CSS

## Framework Support

- Next.js
- Vite + React
- Create React App
- Any React project with Tailwind CSS

## Features

 **Modern Design** - Clean, professional components  
 **Accessible** - ARIA compliant, keyboard navigation  
 **Dark Mode** - Built-in dark mode support  
 **Responsive** - Mobile-first design  
 **Customizable** - Multiple variants and sizes  
 **Zero Config** - Auto-detects your setup  
 **Fast** - Optimized performance  

## Usage Example

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default function Example() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to Nocta UI</CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="primary" size="lg">
          Get Started
        </Button>
      </CardContent>
    </Card>
  )
}
```

## Documentation

Visit [Nocta UI Documentation](https://github.com/66HEX/nocta-ui) for component demos, API reference, and customization guides.

## Contributing

Found a bug or have a feature request? Please open an issue on [GitHub](https://github.com/66HEX/nocta-ui-cli/issues).

## License

MIT License

---