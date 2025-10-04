import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  dts: false,
  external: [
    "chalk",
    "commander",
    "inquirer",
    "ora",
    "semver",
    "fs-extra",
  ],
});

