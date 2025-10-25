#!/usr/bin/env bash
set -e  # exit immediately if a command exits with a non-zero status

# 1. Build the Rust project in release mode
echo "Building Rust project in release mode..."
cargo build --release

# 2. Paths
SOURCE="./target/release/nocta-ui"
DEST="./js/dist/aarch64-apple-darwin/nocta-ui"

# 3. Copy the new binary and replace the old one
echo "Copying nocta-ui binary..."
if [ -f "$SOURCE" ]; then
    cp "$SOURCE" "$DEST"
    echo "Binary copied to $DEST"
else
    echo "Error: $SOURCE not found"
    exit 1
fi

# 4. Go to js directory
cd js

# 5. Uninstall the global package
echo "Uninstalling global @nocta-ui/cli..."
npm uninstall -g @nocta-ui/cli

# 6. Link the local package
echo "Linking local package..."
npm link

echo "Done."
