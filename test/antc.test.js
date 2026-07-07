const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { encodeAtlBuffer, inspectAtlBuffer, parseAtlBuffer } = require("../src/antc");
const { main } = require("../src/cli");
const {
  MAX_IN_MEMORY_FILE_BYTES,
  decodeFile,
  detectSourceCompressionProfile,
  encodeFile,
  hexBinaryBytesToTextBytes,
  inspectFile,
  looksLikeBinary,
  preflightEncodeFile,
  prepareEncodePayload,
  textBytesToHexBinaryBytes
} = require("../src/file-ops");

function withCapturedLogs(callback) {
  const originalLog = console.log;
  const messages = [];
  console.log = (...args) => {
    messages.push(args.join(" "));
  };

  try {
    callback(messages);
  } finally {
    console.log = originalLog;
  }
}

test("encode/decode round-trip without compression", () => {
  const source = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const atl = encodeAtlBuffer(source);
  const parsed = parseAtlBuffer(atl);

  assert.deepEqual(parsed.decodedPayload, source);
  assert.equal(parsed.metadata.compression, "none");
  assert.equal(parsed.pixelDataLength % 3, 0);
});

test("encode/decode round-trip with zlib compression", () => {
  const source = Buffer.from("ANTC compresses repeated repeated repeated bytes", "utf8");
  const atl = encodeAtlBuffer(source, { compression: "zlib" });
  const info = inspectAtlBuffer(atl);
  const parsed = parseAtlBuffer(atl);

  assert.deepEqual(parsed.decodedPayload, source);
  assert.equal(info.metadata.compression, "zlib");
  assert.ok(info.encoded_size > 0);
  assert.ok(typeof info.metadata.storage_mode === "string");
});

test("encode/decode round-trip with gzip and brotli compression", () => {
  const source = Buffer.from("ANTC compresses repeated repeated repeated bytes".repeat(8), "utf8");

  for (const compression of ["gzip", "brotli"]) {
    const atl = encodeAtlBuffer(source, { compression });
    const parsed = parseAtlBuffer(atl);
    const info = inspectAtlBuffer(atl);

    assert.deepEqual(parsed.decodedPayload, source);
    assert.equal(info.metadata.compression, compression);
  }
});

test("encode/decode round-trip with additional fast and max compression variants", () => {
  const source = Buffer.from("variant compression sample ".repeat(2000), "utf8");

  for (const compression of ["zlib-fast", "zlib-max", "gzip-fast", "gzip-max", "brotli-fast", "brotli-max"]) {
    const atl = encodeAtlBuffer(source, { compression });
    const parsed = parseAtlBuffer(atl);
    const info = inspectAtlBuffer(atl);

    assert.deepEqual(parsed.decodedPayload, source);
    assert.equal(typeof info.metadata.compression_variant, "string");
    assert.equal(info.metadata.compression_requested, compression);
  }
});

test("experimental transforms round-trip cleanly", () => {
  const source = Buffer.from(Array.from({ length: 4096 }, (_, index) => index & 0xff));

  for (const experimentalTransform of ["delta", "rle", "delta-rle"]) {
    const atl = encodeAtlBuffer(source, {
      compression: "brotli",
      experimentalTransform
    });
    const parsed = parseAtlBuffer(atl);

    assert.deepEqual(parsed.decodedPayload, source);
    assert.equal(parsed.metadata.experimental_transform, experimentalTransform);
  }
});

test("new solo transforms round-trip cleanly", () => {
  const source = Buffer.from("burrows wheeler move to front bitplane sample ".repeat(256), "utf8");

  for (const experimentalTransform of ["bwt", "mtf", "bitplane"]) {
    const atl = encodeAtlBuffer(source, {
      compression: "brotli",
      experimentalTransform
    });
    const parsed = parseAtlBuffer(atl);

    assert.deepEqual(parsed.decodedPayload, source);
    assert.equal(parsed.metadata.experimental_transform, experimentalTransform);
  }
});

test("additional solo transforms round-trip cleanly", () => {
  const source = Buffer.from(
    Array.from({ length: 8192 }, (_, index) => ((index * 3) ^ (index >> 2)) & 0x0f)
  );

  for (const experimentalTransform of [
    "xor-delta",
    "byte-shuffle",
    "bitpack",
    "predictor-left",
    "predictor-paeth"
  ]) {
    const atl = encodeAtlBuffer(source, {
      compression: "zlib",
      experimentalTransform
    });
    const parsed = parseAtlBuffer(atl);

    assert.deepEqual(parsed.decodedPayload, source);
    assert.equal(parsed.metadata.experimental_transform, experimentalTransform);
  }
});

test("bwt solo encoding rejects oversized payloads with a clear error", () => {
  const source = Buffer.alloc(16 * 1024 + 1, 0x61);

  assert.throws(
    () =>
      encodeAtlBuffer(source, {
        compression: "brotli",
        experimentalTransform: "bwt"
      }),
    /Burrows-Wheeler Transform currently supports payloads up to 16384 bytes/
  );
});

test("combo encode presets round-trip cleanly", () => {
  const source = Buffer.from("combo preset sample ".repeat(4000), "utf8");

  for (const comboCompression of [
    "delta+rle",
    "brotli+delta",
    "zlib+rle",
    "byte-shuffle+zlib",
    "xor-delta+brotli",
    "delta+bitpack+zlib",
    "predictor-left+brotli"
  ]) {
    const atl = encodeAtlBuffer(source, {
      compression: "gzip",
      comboCompression
    });
    const parsed = parseAtlBuffer(atl);
    const info = inspectAtlBuffer(atl);

    assert.deepEqual(parsed.decodedPayload, source);
    assert.equal(info.metadata.combo_compression, comboCompression);
    assert.equal(info.metadata.combo_compression_requested, comboCompression);
  }
});

test("combo encode rejects overlapping experimental transforms", () => {
  const source = Buffer.from("overlap guard sample", "utf8");

  assert.throws(
    () =>
      encodeAtlBuffer(source, {
        compression: "gzip",
        comboCompression: "brotli+delta",
        experimentalTransform: "delta"
      }),
    /overlaps with Solo Encoding "delta"/
  );

  assert.throws(
    () =>
      encodeAtlBuffer(source, {
        compression: "gzip",
        comboCompression: "zlib+rle",
        experimentalTransform: "auto"
      }),
    /overlaps with Solo Encoding "auto"/
  );
});

test("parser rejects checksum mismatches", () => {
  const atl = encodeAtlBuffer(Buffer.from([1, 2, 3, 4]));
  const corrupted = Buffer.from(atl);
  corrupted[corrupted.length - 1] ^= 0xff;

  assert.throws(() => parseAtlBuffer(corrupted), /CRC32 mismatch/);
});

test("text preprocessing follows data to hex to binary and reverses cleanly", () => {
  const source = Buffer.from("Hello", "utf8");
  const transformed = textBytesToHexBinaryBytes(source);

  assert.equal(transformed.toString("ascii"), "0100100001100101011011000110110001101111");
  assert.deepEqual(hexBinaryBytesToTextBytes(transformed), source);
});

test("new encodes keep both text and binary inputs on the raw binary path", () => {
  const text = Buffer.from("plain text file", "utf8");
  const binary = Buffer.from([0, 255, 1, 12, 42, 0]);

  assert.equal(looksLikeBinary(text), false);
  assert.equal(looksLikeBinary(binary), true);
  assert.equal(prepareEncodePayload(text).metadata.input_mode, "raw");
  assert.equal(prepareEncodePayload(binary).metadata.input_mode, "raw");
});

test("file detection chooses stronger auto compression for pdf/text and balanced for compressed media", () => {
  assert.deepEqual(
    detectSourceCompressionProfile("example.pdf", Buffer.from("%PDF-1.7\nrepeat repeat repeat")),
    {
      kind: "document-pdf",
      autoCompressionProfile: "max"
    }
  );

  assert.deepEqual(
    detectSourceCompressionProfile("example.txt", Buffer.from("plain text")),
    {
      kind: "text-like",
      autoCompressionProfile: "max"
    }
  );

  assert.deepEqual(
    detectSourceCompressionProfile(
      "example.png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00])
    ),
    {
      kind: "already-compressed-media-or-archive",
      autoCompressionProfile: "balanced"
    }
  );
});

test("default ATL geometry uses a padded grid instead of a single-row strip", () => {
  const source = Buffer.from("a".repeat(124), "utf8");
  const atl = encodeAtlBuffer(source);
  const info = inspectAtlBuffer(atl);

  assert.notEqual(info.metadata.width, info.pixel_count);
  assert.notEqual(info.metadata.height, 1);
  assert.equal(info.metadata.grid_pixels, info.metadata.width * info.metadata.height);
  assert.ok(info.metadata.grid_pixels >= info.metadata.data_pixels);
});

test("cli encode, info, and decode commands work together", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-codex-"));
  const inputPath = path.join(tempRoot, "input.bin");
  const atlPath = path.join(tempRoot, "output.atl");
  const decodedPath = path.join(tempRoot, "input.bin");
  const payload = Buffer.from("cli integration sample", "utf8");

  fs.writeFileSync(inputPath, payload);

  withCapturedLogs(() => {
    assert.equal(main(["encode", inputPath, atlPath, "--compression", "zlib"]), 0);
  });
  assert.equal(fs.existsSync(atlPath), true);

  let info;
  withCapturedLogs((messages) => {
    assert.equal(main(["info", atlPath, "--json"]), 0);
    assert.equal(messages.length, 1);
    info = JSON.parse(messages[0]);
  });
  assert.equal(info.magic, "ANTC");
  assert.equal(info.metadata.compression, "zlib");
  assert.equal(info.metadata.input_mode, "raw");
  assert.equal(info.metadata.original_file_name, "input.bin");

  withCapturedLogs(() => {
    assert.equal(main(["decode", atlPath]), 0);
  });
  assert.deepEqual(fs.readFileSync(decodedPath), payload);
});

test("cli preflight estimates without writing an output file", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-preflight-cli-"));
  const inputPath = path.join(tempRoot, "input.bin");
  fs.writeFileSync(inputPath, Buffer.from("cli preflight sample ".repeat(300), "utf8"));

  let output;
  withCapturedLogs((messages) => {
    assert.equal(main(["preflight", inputPath, "--compression", "zlib"]), 0);
    output = messages.join("\n");
  });

  assert.match(output, /Estimated size:/);
  assert.match(output, /Best pipeline:/);
  assert.equal(fs.existsSync(path.join(tempRoot, "input.atl")), false);
});

test("shared file operations support encode, inspect preview, and decode", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-ops-"));
  const inputPath = path.join(tempRoot, "source.bin");
  const atlPath = path.join(tempRoot, "source.atl");
  const decodedPath = path.join(tempRoot, "source.out.bin");
  const payload = Buffer.from([7, 14, 21, 28, 35, 42, 49]);

  fs.writeFileSync(inputPath, payload);

  const encoded = encodeFile({
    inputPath,
    outputPath: atlPath,
    compression: "none",
    inputMode: "raw",
    width: 1
  });

  assert.equal(encoded.info.metadata.storage_mode, "raw_compressed");
  assert.equal(encoded.info.pixel_count, 0);

  const inspected = inspectFile(atlPath);
  assert.equal(inspected.metadata.storage_mode, "raw_compressed");
  assert.equal(inspected.metadata.original_file_name, "source.bin");
  assert.equal(inspected.metadata.original_file_extension, ".bin");
  assert.equal(inspected.preview?.omitted, true);
  assert.match(String(inspected.preview?.reason), /raw_compressed storage/);

  const decoded = decodeFile({
    inputPath: atlPath,
    outputPath: decodedPath
  });

  assert.equal(decoded.bytesWritten, payload.length);
  assert.deepEqual(fs.readFileSync(decodedPath), payload);
});

test("encode file defaults to automatic compression and records the chosen algorithm", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-auto-compress-"));
  const inputPath = path.join(tempRoot, "source.txt");
  const atlPath = path.join(tempRoot, "source.atl");
  const payload = Buffer.from("compress me ".repeat(8000), "utf8");

  fs.writeFileSync(inputPath, payload);

  const encoded = encodeFile({
    inputPath,
    outputPath: atlPath
  });

  assert.equal(encoded.info.metadata.compression_requested, "auto");
  assert.equal(encoded.info.metadata.detected_file_kind, "text-like");
  assert.equal(encoded.info.metadata.detected_auto_compression_profile, "max");
  assert.equal(encoded.info.metadata.auto_compression_profile, "max");
  assert.equal(encoded.info.metadata.compression_variant, "brotli-max");
  assert.notEqual(encoded.info.metadata.compression, "none");
  assert.ok(encoded.info.encoded_size < payload.length);

  const decoded = decodeFile({
    inputPath: atlPath
  });

  assert.deepEqual(fs.readFileSync(decoded.outputPath), payload);
});

test("preflight encode estimates size without writing output", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-preflight-"));
  const inputPath = path.join(tempRoot, "source.bin");
  const payload = Buffer.from("ANTC preflight estimation sample ".repeat(1000), "utf8");
  fs.writeFileSync(inputPath, payload);

  const estimate = preflightEncodeFile({
    inputPath,
    compression: "auto",
    inputMode: "raw"
  });

  assert.equal(typeof estimate.estimatedSize, "number");
  assert.ok(estimate.estimatedSize > 0);
  assert.equal(Array.isArray(estimate.bestPipeline), true);
  assert.match(estimate.confidence, /High|Medium|Low/);
  assert.equal(fs.existsSync(path.join(tempRoot, "source.atl")), false);
});

test("preflight encode can respect restricted candidate lists", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-preflight-restrict-"));
  const inputPath = path.join(tempRoot, "video.mp4");
  const payload = Buffer.from("high entropy style sample ".repeat(500), "utf8");
  fs.writeFileSync(inputPath, payload);

  const estimate = preflightEncodeFile({
    inputPath,
    compression: "auto",
    inputMode: "raw",
    allowedCompressionCandidates: ["none", "zlib"],
    allowedTransformCandidates: ["none"]
  });

  assert.notEqual(estimate.compression, "brotli");
  assert.equal(estimate.transform, "none");
});

test("pdf inputs use the file-aware max auto profile", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-pdf-auto-"));
  const inputPath = path.join(tempRoot, "sample.pdf");
  const atlPath = path.join(tempRoot, "sample.atl");
  const payload = Buffer.from(`%PDF-1.7\n${"stream repeated repeated repeated\n".repeat(4000)}`, "utf8");

  fs.writeFileSync(inputPath, payload);

  const encoded = encodeFile({
    inputPath,
    outputPath: atlPath,
    inputMode: "raw"
  });

  assert.equal(encoded.info.metadata.detected_file_kind, "document-pdf");
  assert.equal(encoded.info.metadata.detected_auto_compression_profile, "max");
  assert.equal(encoded.info.metadata.auto_compression_profile, "max");
  assert.equal(encoded.info.metadata.compression_requested, "auto");
  assert.ok(encoded.info.encoded_size < payload.length);
});

test("advanced exhaustive mode can auto-select an experimental transform", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-advanced-auto-"));
  const inputPath = path.join(tempRoot, "pattern.bin");
  const atlPath = path.join(tempRoot, "pattern.atl");
  const payload = Buffer.from(Array.from({ length: 16384 }, (_, index) => index & 0xff));

  fs.writeFileSync(inputPath, payload);

  const encoded = encodeFile({
    inputPath,
    outputPath: atlPath,
    inputMode: "raw",
    autoCompressionStrategy: "exhaustive",
    experimentalTransform: "auto"
  });

  assert.equal(encoded.info.metadata.auto_compression_strategy, "exhaustive");
  assert.equal(encoded.info.metadata.auto_compression_profile, "exhaustive");
  assert.equal(encoded.info.metadata.experimental_transform_requested, "auto");
  assert.equal(typeof encoded.info.metadata.experimental_transform, "string");

  const decoded = decodeFile({
    inputPath: atlPath
  });

  assert.deepEqual(fs.readFileSync(decoded.outputPath), payload);
});

test("v2 encoder records payload size and compact storage metadata", () => {
  const source = Buffer.from("storage candidate sample ".repeat(1024), "utf8");
  const atl = encodeAtlBuffer(source, { compression: "auto" });
  const info = inspectAtlBuffer(atl);
  const parsed = parseAtlBuffer(atl);

  assert.deepEqual(parsed.decodedPayload, source);
  assert.equal(typeof info.metadata.payload_size_before_padding, "number");
  assert.equal(typeof info.metadata.storage_mode, "string");
  assert.equal(typeof info.metadata.storage_encoding, "string");
  assert.equal(typeof info.metadata.source_entropy, "number");
});

test("preview reflows extreme aspect ratios into a box-shaped display grid", () => {
  const source = Buffer.from("1".repeat(498), "utf8");
  const atl = encodeAtlBuffer(source, { width: 166, height: 1 });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-preview-"));
  const atlPath = path.join(tempRoot, "line.atl");

  fs.writeFileSync(atlPath, atl);

  const inspected = inspectFile(atlPath);
  assert.equal(inspected.preview.reflowed, true);
  assert.equal(inspected.preview.sourceWidth, 166);
  assert.equal(inspected.preview.sourceHeight, 1);
  assert.notEqual(inspected.preview.width, 166);
  assert.notEqual(inspected.preview.height, 1);
});

test("inspect can omit large previews by default and allow a one-off override", () => {
  const source = Buffer.from("A".repeat(2400), "utf8");
  const atl = encodeAtlBuffer(source);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-limit-"));
  const atlPath = path.join(tempRoot, "large.atl");

  fs.writeFileSync(atlPath, atl);

  const limited = inspectFile(atlPath, { maxPreviewPixels: 100 });
  assert.equal(limited.preview.omitted, true);
  assert.equal(limited.preview.canOverride, true);

  const forced = inspectFile(atlPath, { maxPreviewPixels: Number.MAX_SAFE_INTEGER });
  assert.equal(Boolean(forced.preview.omitted), false);
  assert.equal(typeof forced.preview.pixelsBase64, "string");
});

test("inspect explains when an ATL uses raw storage and has no preview", () => {
  const source = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0x20, 0x30, 0x40, 0x50]);
  const atl = encodeAtlBuffer(source, {
    compression: "none",
    metadata: {
      detected_file_kind: "already-compressed-media-or-archive"
    }
  });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-raw-preview-"));
  const atlPath = path.join(tempRoot, "image.atl");

  fs.writeFileSync(atlPath, atl);

  const info = inspectFile(atlPath);

  assert.equal(info.preview?.omitted, true);
  assert.match(String(info.preview?.reason), /raw_(compressed|uncompressed) storage/);
});

test("inspect reports a clear error when given a directory path", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-dir-"));

  assert.throws(
    () => inspectFile(tempRoot),
    /Input path ".*" must be a file, not a folder\./
  );
});

test("text files encoded with auto mode decode back to original text bytes", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-text-"));
  const inputPath = path.join(tempRoot, "source.txt");
  const atlPath = path.join(tempRoot, "source.atl");
  const decodedPath = path.join(tempRoot, "source.decoded.txt");
  const payload = Buffer.from("ANTC text pipeline", "utf8");

  fs.writeFileSync(inputPath, payload);

  const encoded = encodeFile({
    inputPath,
    outputPath: atlPath,
    compression: "none"
  });

  assert.equal(encoded.info.metadata.input_mode, "raw");
  assert.equal(encoded.info.metadata.source_size, payload.length);
  assert.equal(encoded.info.metadata.original_size, payload.length);
  assert.equal(encoded.info.metadata.original_file_name, "source.txt");
  assert.equal(encoded.info.metadata.original_file_extension, ".txt");
  assert.equal(encoded.info.metadata.owner_name, "Air Conditioner");
  assert.equal(encoded.info.metadata.owner_tag, "AC989");
  assert.equal(encoded.info.metadata.owner_mark, "Air Conditioner (AC989)");
  assert.equal(encoded.info.metadata.license_notice, "Unauthorized resale prohibited.");
  assert.equal(typeof encoded.info.metadata.ownership_signature, "string");
  assert.ok(encoded.info.metadata.ownership_signature.length > 0);

  const decoded = decodeFile({
    inputPath: atlPath,
    outputPath: decodedPath
  });

  assert.equal(decoded.bytesWritten, payload.length);
  assert.deepEqual(fs.readFileSync(decodedPath), payload);
});

test("decode still restores legacy text-hex-binary ATL payloads", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-legacy-text-"));
  const atlPath = path.join(tempRoot, "legacy.atl");
  const payload = Buffer.from("legacy text pipeline", "utf8");
  const transformed = textBytesToHexBinaryBytes(payload);
  const legacyAtl = encodeAtlBuffer(transformed, {
    compression: "none",
    metadata: {
      input_mode: "text-hex-binary",
      source_size: payload.length,
      source_format: "text",
      preprocessing: "data-to-hex-to-binary",
      preprocessing_pipeline: ["data", "hexadecimal", "binary", "ANTC"],
      original_file_name: "legacy.txt",
      original_file_extension: ".txt"
    }
  });

  fs.writeFileSync(atlPath, legacyAtl);

  const decoded = decodeFile({
    inputPath: atlPath
  });

  assert.equal(decoded.outputPath.endsWith("legacy.txt"), true);
  assert.deepEqual(fs.readFileSync(decoded.outputPath), payload);
});

test("decode without output path restores the stored original file name", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-restore-"));
  const inputPath = path.join(tempRoot, "photo.png");
  const atlPath = path.join(tempRoot, "photo.atl");
  const payload = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  fs.writeFileSync(inputPath, payload);

  encodeFile({
    inputPath,
    outputPath: atlPath,
    inputMode: "raw"
  });

  fs.unlinkSync(inputPath);

  const decoded = decodeFile({
    inputPath: atlPath
  });

  assert.equal(decoded.outputPath.endsWith("photo.png"), true);
  assert.deepEqual(fs.readFileSync(decoded.outputPath), payload);
});

test("decode appends the original extension when a custom output path omits it", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-ext-restore-"));
  const inputPath = path.join(tempRoot, "program.exe");
  const atlPath = path.join(tempRoot, "program.atl");
  const customOutputBase = path.join(tempRoot, "restored-program");
  const payload = Buffer.from([77, 90, 144, 0, 3, 0, 0, 0]);

  fs.writeFileSync(inputPath, payload);

  encodeFile({
    inputPath,
    outputPath: atlPath,
    inputMode: "raw"
  });

  const decoded = decodeFile({
    inputPath: atlPath,
    outputPath: customOutputBase
  });

  assert.equal(decoded.outputPath.endsWith(".exe"), true);
  assert.deepEqual(fs.readFileSync(decoded.outputPath), payload);
});

test("large-file safety gate can be overridden and encode/decode expose logs", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-large-override-"));
  const inputPath = path.join(tempRoot, "source.bin");
  const atlPath = path.join(tempRoot, "source.atl");
  const payload = Buffer.from("large-file override sample".repeat(128), "utf8");
  const oversizedBytes = MAX_IN_MEMORY_FILE_BYTES + 1024;
  const originalStatSync = fs.statSync;

  fs.writeFileSync(inputPath, payload);

  fs.statSync = (targetPath, ...rest) => {
    const stats = originalStatSync(targetPath, ...rest);
    const resolved = path.resolve(String(targetPath));

    if (resolved === path.resolve(inputPath) || resolved === path.resolve(atlPath)) {
      return {
        ...stats,
        size: oversizedBytes,
        isDirectory: () => false,
        isFile: () => true
      };
    }

    return stats;
  };

  try {
    assert.throws(
      () =>
        encodeFile({
          inputPath,
          outputPath: atlPath,
          inputMode: "raw"
        }),
      /2 GB in-memory safety limit/
    );

    const encoded = encodeFile({
      inputPath,
      outputPath: atlPath,
      inputMode: "raw",
      allowLargeFiles: true
    });

    assert.ok(Array.isArray(encoded.logs));
    assert.ok(encoded.logs.some((line) => /Large-file override: enabled/.test(line)));

    assert.throws(() => inspectFile(atlPath, { preview: false }), /2 GB in-memory safety limit/);

    const inspected = inspectFile(atlPath, {
      preview: false,
      allowLargeFiles: true
    });

    assert.equal(inspected.magic, "ANTC");

    assert.throws(() => decodeFile({ inputPath: atlPath }), /2 GB in-memory safety limit/);

    const decoded = decodeFile({
      inputPath: atlPath,
      allowLargeFiles: true
    });

    assert.ok(Array.isArray(decoded.logs));
    assert.ok(decoded.logs.some((line) => /Large-file override: enabled/.test(line)));
    assert.deepEqual(fs.readFileSync(decoded.outputPath), payload);
  } finally {
    fs.statSync = originalStatSync;
  }
});

test("encoder forces .atl extension when output path omits it", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-ext-"));
  const inputPath = path.join(tempRoot, "source.txt");
  const outputPathWithoutExtension = path.join(tempRoot, "converted");
  const payload = Buffer.from("extension check", "utf8");

  fs.writeFileSync(inputPath, payload);

  const encoded = encodeFile({
    inputPath,
    outputPath: outputPathWithoutExtension,
    inputMode: "raw"
  });

  assert.equal(encoded.outputPath.endsWith(".atl"), true);
  assert.equal(fs.existsSync(`${outputPathWithoutExtension}.atl`), true);
});
