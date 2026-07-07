#!/usr/bin/env node

const path = require("node:path");
const { decodeFile, encodeFile, inspectFile } = require("./file-ops");

function usage() {
  return [
    "Usage:",
    "  atl_codex encode <input> <output> [--compression auto|none|zlib-fast|zlib|zlib-max|gzip-fast|gzip|gzip-max|brotli-fast|brotli|brotli-max] [--auto-strategy smart|speed|balanced|max|exhaustive] [--transform none|auto|delta|rle|delta-rle] [--input-mode auto|raw|text-hex-binary] [--width N] [--height N] [--metadata-file path]",
    "  atl_codex decode <input> [output]",
    "  atl_codex info <input> [--json]"
  ].join("\n");
}

function parseArguments(argv) {
  const args = [...argv];
  const positionals = [];
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const value = args[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Option ${arg} requires a value.`);
    }

    if (arg === "--compression") {
      options.compression = value;
    } else if (arg === "--auto-strategy") {
      options.autoCompressionStrategy = value;
    } else if (arg === "--transform") {
      options.experimentalTransform = value;
    } else if (arg === "--input-mode") {
      options.inputMode = value;
    } else if (arg === "--width") {
      options.width = Number.parseInt(value, 10);
    } else if (arg === "--height") {
      options.height = Number.parseInt(value, 10);
    } else if (arg === "--metadata-file") {
      options.metadataFile = value;
    } else {
      throw new Error(`Unknown option ${arg}.`);
    }

    index += 1;
  }

  return { positionals, options };
}

function runEncode(args) {
  const { positionals, options } = parseArguments(args);

  if (options.help) {
    console.log(usage());
    return;
  }

  if (positionals.length !== 2) {
    throw new Error("encode requires <input> and <output> paths.");
  }

  const [inputPath, outputPath] = positionals;
  const result = encodeFile({
    inputPath,
    outputPath,
    compression: options.compression,
    autoCompressionStrategy: options.autoCompressionStrategy,
    experimentalTransform: options.experimentalTransform,
    inputMode: options.inputMode,
    width: options.width,
    height: options.height,
    metadataPath: options.metadataFile
  });
  console.log(
    `Wrote ${path.resolve(result.outputPath)} (${result.info.pixel_count} pixels, checksum ${result.info.checksum}).`
  );
}

function runDecode(args) {
  const { positionals, options } = parseArguments(args);

  if (options.help) {
    console.log(usage());
    return;
  }

  if (positionals.length < 1 || positionals.length > 2) {
    throw new Error("decode requires <input> and optionally <output>.");
  }

  const [inputPath, outputPath] = positionals;
  const result = decodeFile({ inputPath, outputPath });
  console.log(
    `Decoded ${path.resolve(result.outputPath)} (${result.bytesWritten} bytes, checksum ${result.checksum}).`
  );
}

function runInfo(args) {
  const { positionals, options } = parseArguments(args);

  if (options.help) {
    console.log(usage());
    return;
  }

  if (positionals.length !== 1) {
    throw new Error("info requires <input>.");
  }

  const info = inspectFile(positionals[0], { preview: false });

  if (options.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log(`Magic: ${info.magic}`);
  console.log(`Version: ${info.version}`);
  console.log(`Metadata length: ${info.metadata_length}`);
  console.log(`Pixel data length: ${info.pixel_data_length}`);
  console.log(`Pixel count: ${info.pixel_count}`);
  console.log(`Encoded size: ${info.encoded_size}`);
  console.log(`Padding size: ${info.padding_size}`);
  console.log(`Checksum: ${info.checksum}`);
  console.log(`Metadata: ${JSON.stringify(info.metadata, null, 2)}`);
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return 0;
  }

  if (command === "encode") {
    runEncode(rest);
    return 0;
  }

  if (command === "decode") {
    runDecode(rest);
    return 0;
  }

  if (command === "info") {
    runInfo(rest);
    return 0;
  }

  throw new Error(`Unknown command "${command}".`);
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

module.exports = {
  main
};
