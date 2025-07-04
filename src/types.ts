export interface ComponentFile {
  name: string;
  path: string;
  type: string;
}

export interface ComponentFileWithContent extends ComponentFile {
  content: string;
  componentName: string;
}

export interface Component {
  name: string;
  description: string;
  category: string;
  files: ComponentFile[];
  dependencies: Record<string, string>;
  internalDependencies?: string[];
  exports: string[];
  props?: Record<string, string[]>;
  variants?: string[];
  sizes?: string[];
  features: string[];
}

export interface Registry {
  name: string;
  description: string;
  version: string;
  components: Record<string, Component>;
  categories: Record<string, {
    name: string;
    description: string;
    components: string[];
  }>;
  features: string[];
  requirements: Record<string, string>;
}

export interface Config {
  style: string;
  tsx: boolean;
  theme: string;
  tailwind: {
    config: string;
    css: string;
  };
  aliases: {
    components: string;
    utils: string;
  };
}

export interface ThemeColors {
  [key: string]: string;
}

export interface Theme {
  name: string;
  displayName: string;
  description: string;
  colors: ThemeColors;
}

export const AVAILABLE_THEMES: Theme[] = [
  {
    name: 'charcoal',
    displayName: 'Charcoal',
    description: 'Neutral gray theme (default)',
    colors: {
      '50': 'oklch(.985 0 0)',
      '100': 'oklch(.97 0 0)',
      '200': 'oklch(.922 0 0)',
      '300': 'oklch(.87 0 0)',
      '400': 'oklch(.708 0 0)',
      '500': 'oklch(.556 0 0)',
      '600': 'oklch(.444 .011 73.639)',
      '700': 'oklch(.371 0 0)',
      '800': 'oklch(.269 0 0)',
      '900': 'oklch(.205 0 0)',
      '950': 'oklch(.145 0 0)'
    }
  },
  {
    name: 'jade',
    displayName: 'Jade',
    description: 'Subtle green theme',
    colors: {
      '50': 'oklch(.985 .002 185)',
      '100': 'oklch(.97 .004 182)',
      '200': 'oklch(.922 .007 179)',
      '300': 'oklch(.87 .010 176)',
      '400': 'oklch(.708 .013 173)',
      '500': 'oklch(.556 .015 170)',
      '600': 'oklch(.444 .013 167)',
      '700': 'oklch(.371 .011 164)',
      '800': 'oklch(.269 .009 161)',
      '900': 'oklch(.205 .007 158)',
      '950': 'oklch(.145 .006 155)'
    }
  },
  {
    name: 'copper',
    displayName: 'Copper',
    description: 'Warm copper theme',
    colors: {
      '50': 'oklch(.985 .003 84)',
      '100': 'oklch(.97 .005 80)',
      '200': 'oklch(.922 .007 76)',
      '300': 'oklch(.87 .010 72)',
      '400': 'oklch(.708 .013 68)',
      '500': 'oklch(.556 .015 64)',
      '600': 'oklch(.444 .014 60)',
      '700': 'oklch(.371 .012 56)',
      '800': 'oklch(.269 .010 52)',
      '900': 'oklch(.205 .009 48)',
      '950': 'oklch(.145 .008 45)'
    }
  },
  {
    name: 'cobalt',
    displayName: 'Cobalt',
    description: 'Cool blue theme',
    colors: {
      '50': 'oklch(.985 .003 315)',
      '100': 'oklch(.97 .005 312)',
      '200': 'oklch(.922 .008 309)',
      '300': 'oklch(.87 .011 306)',
      '400': 'oklch(.708 .014 303)',
      '500': 'oklch(.556 .016 300)',
      '600': 'oklch(.444 .014 297)',
      '700': 'oklch(.371 .012 294)',
      '800': 'oklch(.269 .010 291)',
      '900': 'oklch(.205 .008 288)',
      '950': 'oklch(.145 .007 285)'
    }
  }
];