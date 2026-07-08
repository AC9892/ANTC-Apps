# App-BinaryInspect

This directory is the separate binary inspection desktop app.

It is not the main ANTC encoder app. It is a companion tool for static inspection of executable and binary-style files.

## What This App Does

The binary inspector is meant for local static analysis of files such as:

- `.exe`
- `.dll`
- `.sys`
- `.bin`
- ELF binaries
- Mach-O binaries
- similar executable/library formats

Current workflows:

- inspect a binary file and report format/architecture details
- compute hashes
- calculate entropy
- parse available structural/header information
- extract printable strings
- use the current second tab for deeper import/export/resource/string/structural extraction flow

## Folder Structure

- `desktop/`
  Electron window, UI, preload bridge, renderer, and IPC shell
- `src/`
  binary inspection logic, file parsing, format detection, string extraction, and decompile-style export helpers
- `test/`
  automated tests for binary detection and string extraction
- `null/`
  currently present generated/result-style data folder in this project copy

## Run

Install dependencies and launch the desktop app:

```bash
npm install
npm start
```

## Test

Run the current test suite:

```bash
npm test
```

## UI

The live BinaryInspect app currently uses a compact utility-style desktop UI to match the smaller ANTC Studio layout direction.

Current interface includes:

- compact title row
- horizontal top tabs
- smaller fixed-size window
- inspect tab for normal binary inspection
- placeholder/second tab for deeper extraction workflow

## Inspect Workflow

The main inspect tab currently supports:

- selecting a binary input file
- running inspection
- showing summary values:
  - format
  - architecture
  - entropy
- showing result info such as:
  - file name
  - path
  - size
  - detected format
  - detected architecture
- showing hashes
- showing parsed file details
- showing printable strings

## Binary Formats

Current built-in format detection supports:

- PE
- ELF
- Mach-O
- unknown fallback

Short meaning:

- `PE`
  Windows executable format used by files such as `.exe`, `.dll`, and `.sys`
- `ELF`
  Linux/Unix executable format used by executables, shared objects, and object files
- `Mach-O`
  Apple executable format used by macOS binaries and libraries

### PE

The app can currently inspect/report items such as:

- architecture / machine type
- entry point
- image base
- subsystem
- section count
- section layout
- timestamp

### ELF

The app can currently inspect/report items such as:

- class
  - `ELF32`
  - `ELF64`
- endianness
- machine/architecture
- entry point
- section count
- section table entries

### Mach-O

The app can currently inspect/report items such as:

- 32-bit vs 64-bit class
- cpu architecture
- load command count
- load command size
- discovered sections

## Hashes and Analysis

The current inspector reports:

- `md5`
- `sha1`
- `sha256`
- entropy

Entropy is useful for spotting:

- likely packed/compressed binaries
- already-random-looking data
- differences between structured and highly compressed regions at a file-wide level

## String Extraction

The app extracts printable strings from the binary and returns unique values from the scanned data.

Current behavior:

- scans up to a bounded amount of the file
- keeps unique printable strings
- surfaces them directly in the UI

## Second Tab / Deeper Extraction

The current second tab is wired for deeper extraction-style output and save behavior.

It can currently drive:

- file or directory selection
- optional output folder selection
- import/export extraction
- PE resource extraction
- deeper string extraction
- structural report generation
- save results to disk

Current saved result types include:

- imports/exports JSON
- resources JSON
- strings text output
- structural report JSON

## Important Scope Note

This app is separate from ANTC Studio.

It does not replace:

- `../App` for ANTC encode/decode/inspect
- `../homeM` for launcher behavior

This app is specifically the binary/static inspection tool.

## Related Project Folders

- `../App`
  main ANTC Studio app
- `../homeM`
  separate home/start menu launcher

## Notes

- This is the live binary inspector project.
- The backup folder is the legacy UI version of this app.
