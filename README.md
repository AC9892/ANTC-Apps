# ANTC Studio

This directory is the main ANTC desktop app and CLI project.

It contains the primary implementation of the `ANTC` / `.atl` format used in this workspace, including:

- desktop encode, decode, inspect, and settings UI
- CLI commands for encode, decode, inspect/info, and preflight estimation
- the current compact ANTC Studio interface
- Windows installer build configuration

## What This App Does

ANTC Studio treats input files as raw bytes and stores those bytes in ANTC form.

Main workflows:

- Encode any source file into `.atl`
- Decode `.atl` back into the original file bytes
- Inspect `.atl` metadata, checksum, storage mode, and preview information
- Run preflight estimation without writing an output file

Important behavior:

- encode input is byte-based, not semantic
- the app does not need to understand a file format in order to encode it
- decode restores the original bytes if the file was encoded correctly
- the app stores original file name and extension metadata so decode can restore them automatically when possible

## Folder Structure

- `desktop/`
  Electron window, preload bridge, renderer UI, layout, tabs, and IPC shell
- `src/`
  core ANTC format logic, file operations, and CLI entry point
- `test/`
  automated tests for format behavior, CLI integration, inspect behavior, and pipeline changes
- `Icon/`
  desktop/build icon assets
- `dist/`
  generated installer/build output when packaging the app

## Run

Install dependencies and start the desktop app:

```bash
npm install
npm start
```

## Test

Run the automated test suite:

```bash
npm test
```

## Build Windows Installer

This app is configured to build a full NSIS installer, not just a portable app folder.

```bash
npm run build:win
```

Build output goes to:

- `dist/ANTC Studio-Setup-<version>.exe`

## CLI

You can also run the ANTC functions from the command line.

Examples:

```bash
node ./src/cli.js encode input.bin output.atl
node ./src/cli.js decode input.atl output.bin
node ./src/cli.js info input.atl
node ./src/cli.js preflight input.bin --compression auto
```

If installed on your `PATH`, the binary name is:

```bash
atl_codex
```

## Supported File Workflows

There is no finite whitelist for encode input.

Current workflow support:

- Encode input: any readable file
- Encode output: `.atl`
- Decode input: `.atl`
- Decode output: original file name/extension when metadata is present, or a custom output path
- Inspect input: `.atl`
- Optional metadata input: `.json`

Common encode examples:

- text and config: `.txt`, `.md`, `.json`, `.yaml`, `.xml`
- images: `.png`, `.jpg`, `.jpeg`, `.bmp`, `.gif`, `.webp`, `.svg`
- audio/video: `.mp3`, `.wav`, `.flac`, `.mp4`, `.mov`, `.mkv`
- documents: `.pdf`, `.docx`, `.xlsx`, `.pptx`
- archives/installers: `.zip`, `.rar`, `.7z`, `.gz`, `.exe`, `.dll`
- source/code: `.js`, `.ts`, `.py`, `.rs`, `.cpp`, `.html`, `.css`
- generic binary data: `.bin`, `.dat`, custom formats

## Current ANTC Pipeline

The app’s current encode path is storage-aware and no longer forces color packing when it makes the file larger.

High-level pipeline:

```text
source file
-> raw bytes
-> file-type + entropy analysis
-> transform/compression candidate search
-> best payload selected
-> storage mode candidate search
-> best final ATL layout selected
-> compact metadata + checksum
-> write .atl
```

Current storage modes include:

- `color_rgb`
- `color_rgba`
- `raw_compressed`
- `raw_uncompressed`

Current storage encodings include:

- `interleaved`
- `channel_split`
- `pixel_rle`

So color mode is one storage option, not a forced final step.

## Encode Options

The desktop app and CLI support these main compression values:

- `auto`
- `zlib-fast`
- `zlib`
- `zlib-max`
- `gzip-fast`
- `gzip`
- `gzip-max`
- `brotli-fast`
- `brotli`
- `brotli-max`
- `none`

`auto` is the normal default and is file-aware.

The current file-aware behavior generally uses:

- stronger profiles for text-like files and PDFs
- more conservative profiles for already-compressed media, archives, installers, and libraries

## Advanced Encode

The desktop `Encode` tab includes an advanced section.

Current controls:

- `Auto strategy`
  - `smart`
  - `speed`
  - `balanced`
  - `max`
  - `exhaustive`
- `Solo Encoding`
  - `none`
  - `auto`
  - `bwt`
  - `mtf`
  - `bitplane`
  - `bitpack`
  - `byte-shuffle`
  - `delta`
  - `xor-delta`
  - `predictor-left`
  - `predictor-paeth`
  - `rle`
- `Combo Encode`
  - `combo-none`
  - `delta+rle`
  - `brotli+delta`
  - `zlib+rle`
  - `byte-shuffle+zlib`
  - `xor-delta+brotli`
  - `delta+bitpack+zlib`
  - `predictor-left+brotli`

Notes:

- solo transforms run before compression
- combo presets can override normal compression behavior
- overlapping solo/combo transforms are guarded against
- some transforms are intentionally limited for stability, such as `bwt`

## Preflight Estimation

The app includes an estimate/preflight mode that does not write output.

It:

- samples a fraction of the source file
- tries the current transform/compression search logic
- estimates final size
- includes metadata/padding overhead
- reports confidence and best pipeline

This is available in:

- desktop `Estimate` button
- CLI `preflight` command

## Inspect

The inspect workflow is for `.atl` files, not arbitrary binaries.

It can show:

- metadata
- checksum
- storage mode
- preview eligibility
- inspector subviews such as color, hex, ascii, integers, floats, strings, stats, and metadata

For raw-storage ATL files, inspect may intentionally report that no color preview is available.

## Metadata JSON

Encode supports an optional metadata JSON file.

Rules:

- the file must be valid JSON
- the root value must be an object
- custom descriptive fields are preserved
- structural ANTC fields are still owned by the encoder and may overwrite matching keys

Typical custom metadata uses:

- `title`
- `author`
- `description`
- `tags`
- `notes`
- `created_at`
- `source_mime`
- `source_sha256`

## Settings

The desktop settings area currently covers:

- preview limit
- large-file override
- show operation logs
- default input/compression settings
- extension restriction override
- estimate restriction override

Important note:

- large-file override bypasses the app’s guard, but it does not guarantee Electron/Node can hold the file in memory

## Related Project Folders

- `../homeM`
  separate launcher/start menu app
- `../App-BinaryInspect`
  separate binary inspector app

## Notes

- This is the main app in the project.
- If you only want the ANTC Studio application, this is the directory you run and build.
