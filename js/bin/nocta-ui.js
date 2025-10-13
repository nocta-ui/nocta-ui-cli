#!/usr/bin/env node

const { join } = require('node:path');
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const platform = process.platform;
const arch = process.arch;

const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc'
};

const variant = `${platform}-${arch}`;
const target = targets[variant];

if (!target) {
  console.error(`Unsupported platform/architecture combination: ${variant}`);
  console.error('Please open an issue at https://github.com/nocta-ui/nocta-ui-cli/issues');
  process.exit(1);
}

const binaryName = platform === 'win32' ? 'nocta-ui.exe' : 'nocta-ui';
const binaryPath = join(__dirname, '..', 'dist', target, binaryName);

if (!existsSync(binaryPath)) {
  console.error(`Nocta UI CLI binary not found for ${target}.`);
  console.error('Make sure you have built the Rust CLI with:');
  console.error(`  cargo build --release --target ${target}`);
  console.error('and copied the resulting binary into js/dist.');
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error);
  process.exit(result.status ?? 1);
}

process.exit(result.status ?? 0);
