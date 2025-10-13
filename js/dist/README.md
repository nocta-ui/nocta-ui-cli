# JavaScript Distribution Artifacts

Place platform-specific release binaries for the Nocta UI CLI in this
directory before publishing the npm package.

Expected layout:

```
js/dist/
  x86_64-apple-darwin/
    nocta-ui
  aarch64-apple-darwin/
    nocta-ui
  x86_64-unknown-linux-gnu/
    nocta-ui
  aarch64-unknown-linux-gnu/
    nocta-ui
  x86_64-pc-windows-msvc/
    nocta-ui.exe
  aarch64-pc-windows-msvc/
    nocta-ui.exe
```

Use `cargo build --release --target <triple>` to produce the binaries and
copy them into the corresponding subdirectories.
