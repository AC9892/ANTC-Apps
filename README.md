# ANTC Studio

Main ANTC desktop app.

## What It Does

- Encodes files into `.atl`
- Decodes `.atl` files back to the original file
- Inspects `.atl` metadata, storage mode, and preview data
- Supports preflight size estimation

## Run

```bash
npm install
npm start
```

## Test

```bash
npm test
```

## Build Windows Installer

```bash
npm run build:win
```

Installer output goes to `dist/`.

## Main Folders

- `desktop/` Electron window, UI, preload, IPC shell
- `src/` ANTC format logic, file ops, CLI
- `test/` automated tests
- `Icon/` app icon and build resources

## Notes

- This is the main app in the project.
- `homeM` is the separate launcher.
- `App-BinaryInspect` is a separate binary inspection tool.
