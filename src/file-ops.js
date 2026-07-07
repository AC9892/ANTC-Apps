const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  AUTO_COMPRESSION_PROFILE_EXHAUSTIVE,
  AUTO_COMPRESSION_PROFILE_SPEED,
  AUTO_COMPRESSION_PROFILE_BALANCED,
  AUTO_COMPRESSION_PROFILE_MAX,
  COMPRESSION_AUTO,
  EXPERIMENTAL_TRANSFORM_AUTO,
  EXPERIMENTAL_TRANSFORM_NONE,
  encodeAtlBuffer,
  estimateEncodingFromSample,
  formatHex32,
  inspectAtlBuffer,
  normalizeAutoCompressionProfile,
  normalizeExperimentalTransform,
  parseAtlBuffer
} = require("./antc");

const MAX_PREVIEW_PIXELS = 262144;
const MAX_IN_MEMORY_FILE_BYTES = 2147483647;
const MAX_INSPECT_SAMPLE_BYTES = 65536;
const DEFAULT_PREFLIGHT_SAMPLE_FRACTION = 0.03;
const INPUT_MODE_AUTO = "auto";
const INPUT_MODE_RAW = "raw";
const INPUT_MODE_TEXT_HEX_BINARY = "text-hex-binary";
const AUTO_COMPRESSION_STRATEGY_SMART = "smart";
const COMBO_NONE = "combo-none";
const OWNER_NAME = "Air Conditioner";
const OWNER_TAG = "AC989";
const LICENSE_NOTICE = "Unauthorized resale prohibited.";
const APP_OWNER_MARK = `${OWNER_NAME} (${OWNER_TAG})`;
const TEXT_LIKE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".log",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".java",
  ".cs",
  ".go",
  ".php",
  ".rb",
  ".sql",
  ".bat",
  ".ps1",
  ".sh",
  ".svg"
]);
const DOCUMENT_EXTENSIONS = new Set([".pdf"]);
const ALREADY_COMPRESSED_EXTENSIONS = new Set([
  ".zip",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".mp3",
  ".aac",
  ".ogg",
  ".flac",
  ".wav",
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".docx",
  ".xlsx",
  ".pptx",
  ".apk",
  ".jar",
  ".epub"
]);
const EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".msi",
  ".sys",
  ".bin",
  ".wasm",
  ".so",
  ".dylib"
]);

function resolvePath(filePath) {
  return path.resolve(String(filePath));
}

function requirePath(name, filePath) {
  if (filePath === undefined || filePath === null || String(filePath).trim() === "") {
    throw new Error(`${name} is required.`);
  }

  return String(filePath).trim();
}

function formatBinarySize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "unknown size";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;

  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

function computeSummary(inputSize, outputSize, isEncode = true) {
  const inputStr = formatBinarySize(inputSize);
  const outputStr = formatBinarySize(outputSize);
  const delta = outputSize - inputSize;
  const percent = inputSize > 0 ? Math.abs((delta / inputSize) * 100) : 0;
  const ratio = (inputSize / Math.max(outputSize, 1)).toFixed(2) + 'x';

  let emoji, direction, verb;
  
  if (delta < 0) {
    emoji = '🟢';
    direction = 'smaller';
    verb = isEncode ? 'Compressed' : 'Restored';
  } else if (delta > 0) {
    emoji = '🔴';
    direction = 'larger';
    verb = isEncode ? 'Expanded' : 'Restored';
  } else {
    emoji = '⚪';
    direction = 'no change';
    verb = isEncode ? 'No change' : 'Restored';
  }

  if (isEncode) {
    const dirStr = delta !== 0 ? ` (${percent.toFixed(1)}% ${direction}, ${ratio})` : ` (0%, ${ratio})`;
    return `${emoji} ${verb} ${inputStr} → ATL ${outputStr}${dirStr}`;
  } else {
    const dirStr = delta !== 0 ? ` (${percent.toFixed(1)}% ${direction})` : ' (no change)';
    return `${emoji} ${verb} ${outputStr} ATL → ${inputStr}${dirStr}`;
  }
}

function buildLargeFileLimitMessage(name, resolvedPath, size) {
  const sizeGB = (size / (1024 * 1024 * 1024)).toFixed(1);
  return [
    `${name} "${resolvedPath}" is over the 2 GB in-memory safety limit.`,
    `Size: ${sizeGB} GB (${size.toLocaleString()} bytes).`,
    "Enable the large-file override in Settings to attempt this anyway."
  ].join(" ");
}

function getReadableFileInfo(name, filePath, options = {}) {
  const resolvedPath = resolvePath(requirePath(name, filePath));
  const allowLargeFiles = options.allowLargeFiles === true;
  let stats;

  try {
    stats = fs.statSync(resolvedPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${name} "${resolvedPath}" does not exist.`);
    }

    throw new Error(`Could not access ${name.toLowerCase()} "${resolvedPath}": ${error.message}`);
  }

  if (stats.isDirectory()) {
    throw new Error(`${name} "${resolvedPath}" must be a file, not a folder.`);
  }

  if (!stats.isFile()) {
    throw new Error(`${name} "${resolvedPath}" must be a regular file.`);
  }

  if (stats.size > MAX_IN_MEMORY_FILE_BYTES && !allowLargeFiles) {
    throw new Error(buildLargeFileLimitMessage(name, resolvedPath, stats.size));
  }

  return { resolvedPath, stats };
}

function ensureFileExtension(filePath, extension) {
  const trimmed = requirePath("Output path", filePath);
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;

  if (trimmed.toLowerCase().endsWith(normalizedExtension.toLowerCase())) {
    return trimmed;
  }

  return `${trimmed}${normalizedExtension}`;
}

function ensureReadableFile(name, filePath, options) {
  return getReadableFileInfo(name, filePath, options).resolvedPath;
}

function readBinaryFile(filePath, name = "Input path", options = {}) {
  const resolvedPath = ensureReadableFile(name, filePath, options);

  try {
    return fs.readFileSync(resolvedPath);
  } catch (error) {
    if (error.code === "EISDIR") {
      throw new Error(`${name} "${resolvedPath}" must be a file, not a folder.`);
    }

    throw new Error(`Could not read ${name.toLowerCase()} "${resolvedPath}": ${error.message}`);
  }
}

function clampPreflightSampleFraction(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PREFLIGHT_SAMPLE_FRACTION;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("sampleFraction must be a positive number.");
  }

  return Math.min(0.05, Math.max(0.01, numeric));
}

function readBinarySample(filePath, totalSize, sampleFraction = DEFAULT_PREFLIGHT_SAMPLE_FRACTION) {
  if (totalSize <= 0) {
    return Buffer.alloc(0);
  }

  const clampedFraction = clampPreflightSampleFraction(sampleFraction);
  const targetBytes = Math.max(4096, Math.min(totalSize, Math.round(totalSize * clampedFraction)));
  const chunkCount = Math.min(4, Math.max(1, Math.ceil(targetBytes / 65536)));
  const chunkSize = Math.max(1, Math.floor(targetBytes / chunkCount));
  const fd = fs.openSync(filePath, "r");

  try {
    const buffers = [];
    for (let index = 0; index < chunkCount; index += 1) {
      const remaining = totalSize - chunkSize;
      const position =
        chunkCount === 1
          ? 0
          : Math.max(0, Math.min(remaining, Math.floor((remaining * index) / (chunkCount - 1))));
      const buffer = Buffer.allocUnsafe(Math.min(chunkSize, totalSize - position));
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead > 0) {
        buffers.push(buffer.subarray(0, bytesRead));
      }
    }

    return Buffer.concat(buffers);
  } finally {
    fs.closeSync(fd);
  }
}

function writeBinaryFile(filePath, contents) {
  const resolved = resolvePath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents);
  return resolved;
}

function getStoredOriginalFileName(metadata = {}) {
  if (typeof metadata.original_file_name === "string" && metadata.original_file_name.trim() !== "") {
    return path.basename(metadata.original_file_name.trim());
  }

  return null;
}

function getStoredOriginalFileExtension(metadata = {}) {
  if (
    typeof metadata.original_file_extension === "string" &&
    metadata.original_file_extension.trim() !== ""
  ) {
    const extension = metadata.original_file_extension.trim();
    return extension.startsWith(".") ? extension : `.${extension}`;
  }

  const fileName = getStoredOriginalFileName(metadata);
  return fileName ? path.extname(fileName) : "";
}

function buildDecodeOutputPath(inputPath, outputPath, metadata = {}) {
  const resolvedInputPath = resolvePath(requirePath("Input path", inputPath));
  const preferredFileName =
    getStoredOriginalFileName(metadata) ??
    `${path.basename(resolvedInputPath, path.extname(resolvedInputPath))}.bin`;

  if (outputPath === undefined || outputPath === null || String(outputPath).trim() === "") {
    return path.join(path.dirname(resolvedInputPath), preferredFileName);
  }

  const requestedPath = String(outputPath).trim();
  if (path.extname(requestedPath) !== "") {
    return requestedPath;
  }

  const originalExtension = getStoredOriginalFileExtension(metadata);
  return originalExtension ? `${requestedPath}${originalExtension}` : requestedPath;
}

function resolveInputMode(value = INPUT_MODE_AUTO) {
  const normalized = String(value).trim().toLowerCase();

  if (normalized === "" || normalized === INPUT_MODE_AUTO) {
    return INPUT_MODE_AUTO;
  }

  if (normalized === INPUT_MODE_RAW || normalized === "binary") {
    return INPUT_MODE_RAW;
  }

  if (
    normalized === INPUT_MODE_TEXT_HEX_BINARY ||
    normalized === "text" ||
    normalized === "hex-binary" ||
    normalized === "text-to-hex-binary"
  ) {
    return INPUT_MODE_TEXT_HEX_BINARY;
  }

  throw new Error(
    `Unsupported input mode "${value}". Use auto, raw, or text-hex-binary.`
  );
}

function resolveEncodeInputMode(value = INPUT_MODE_AUTO) {
  const normalized = String(value ?? INPUT_MODE_AUTO).trim().toLowerCase();

  if (normalized === "" || normalized === INPUT_MODE_AUTO) {
    return INPUT_MODE_AUTO;
  }

  if (normalized === INPUT_MODE_RAW || normalized === "binary") {
    return INPUT_MODE_RAW;
  }

  if (
    normalized === INPUT_MODE_TEXT_HEX_BINARY ||
    normalized === "text" ||
    normalized === "hex-binary" ||
    normalized === "text-to-hex-binary"
  ) {
    return INPUT_MODE_RAW;
  }

  throw new Error(`Unsupported input mode "${value}". Use auto or raw.`);
}

function looksLikeBinary(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    return false;
  }

  for (const byte of input) {
    if (byte === 0x00) {
      return true;
    }
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    return true;
  }

  let suspiciousControlBytes = 0;

  for (const byte of input) {
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if ((byte >= 0x01 && byte <= 0x08) || (byte >= 0x0b && byte <= 0x0c) || (byte >= 0x0e && byte <= 0x1f)) {
      if (!isAllowedControl) {
        suspiciousControlBytes += 1;
      }
    }
  }

  return suspiciousControlBytes / input.length > 0.1;
}

function matchesSignature(input, bytes) {
  return input.length >= bytes.length && input.subarray(0, bytes.length).equals(Buffer.from(bytes));
}

function detectSourceCompressionProfile(filePath, input) {
  const extension = path.extname(filePath).toLowerCase();
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);

  if (DOCUMENT_EXTENSIONS.has(extension) || matchesSignature(source, "%PDF-")) {
    return {
      kind: "document-pdf",
      autoCompressionProfile: AUTO_COMPRESSION_PROFILE_MAX
    };
  }

  if (TEXT_LIKE_EXTENSIONS.has(extension) || (!looksLikeBinary(source) && source.length <= 4 * 1024 * 1024)) {
    return {
      kind: "text-like",
      autoCompressionProfile: AUTO_COMPRESSION_PROFILE_MAX
    };
  }

  if (
    ALREADY_COMPRESSED_EXTENSIONS.has(extension) ||
    matchesSignature(source, [0x50, 0x4b, 0x03, 0x04]) ||
    matchesSignature(source, [0x89, 0x50, 0x4e, 0x47]) ||
    matchesSignature(source, [0xff, 0xd8, 0xff]) ||
    matchesSignature(source, "GIF8") ||
    matchesSignature(source, [0x1f, 0x8b, 0x08]) ||
    matchesSignature(source, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) ||
    matchesSignature(source, "Rar!")
  ) {
    return {
      kind: "already-compressed-media-or-archive",
      autoCompressionProfile: AUTO_COMPRESSION_PROFILE_BALANCED
    };
  }

  if (
    EXECUTABLE_EXTENSIONS.has(extension) ||
    matchesSignature(source, "MZ") ||
    matchesSignature(source, [0x7f, 0x45, 0x4c, 0x46]) ||
    matchesSignature(source, [0xcf, 0xfa, 0xed, 0xfe]) ||
    matchesSignature(source, [0xfe, 0xed, 0xfa, 0xcf])
  ) {
    return {
      kind: "executable-or-library",
      autoCompressionProfile: AUTO_COMPRESSION_PROFILE_BALANCED
    };
  }

  if (source.length <= 4 * 1024 * 1024) {
    return {
      kind: "generic-binary-small",
      autoCompressionProfile: AUTO_COMPRESSION_PROFILE_MAX
    };
  }

  return {
    kind: "generic-binary",
    autoCompressionProfile: AUTO_COMPRESSION_PROFILE_BALANCED
  };
}

function resolveAutoCompressionStrategy(value = AUTO_COMPRESSION_STRATEGY_SMART) {
  const normalized = String(value ?? AUTO_COMPRESSION_STRATEGY_SMART).trim().toLowerCase();

  if (normalized === "" || normalized === AUTO_COMPRESSION_STRATEGY_SMART) {
    return AUTO_COMPRESSION_STRATEGY_SMART;
  }

  return normalizeAutoCompressionProfile(normalized);
}

function buildOwnershipMetadata(sourceLabel = "") {
  const normalizedSourceLabel = String(sourceLabel ?? "").trim().toLowerCase();
  const ownershipSignature = crypto
    .createHash("sha256")
    .update(`antc|${OWNER_NAME}|${OWNER_TAG}|${normalizedSourceLabel}|anti-selling-license`)
    .digest("hex")
    .slice(0, 24);

  return {
    owner_name: OWNER_NAME,
    owner_tag: OWNER_TAG,
    owner_mark: APP_OWNER_MARK,
    license_notice: LICENSE_NOTICE,
    ownership_signature: ownershipSignature,
    encoded_with_app: "ANTC Studio"
  };
}

function textBytesToHexBinaryBytes(input) {
  const hex = Buffer.from(input).toString("hex");
  const bitChunks = new Array(hex.length);

  for (let index = 0; index < hex.length; index += 1) {
    bitChunks[index] = Number.parseInt(hex[index], 16).toString(2).padStart(4, "0");
  }

  return Buffer.from(bitChunks.join(""), "ascii");
}

function hexBinaryBytesToTextBytes(input) {
  const bitString = Buffer.from(input).toString("ascii");

  if (bitString.length % 4 !== 0) {
    throw new Error("Hex-binary payload length must be divisible by 4 bits.");
  }

  if (!/^[01]*$/.test(bitString)) {
    throw new Error("Hex-binary payload must contain only ASCII 0 and 1 digits.");
  }

  const hexChunks = new Array(bitString.length / 4);

  for (let index = 0; index < bitString.length; index += 4) {
    hexChunks[index / 4] = Number.parseInt(bitString.slice(index, index + 4), 2).toString(16);
  }

  return Buffer.from(hexChunks.join(""), "hex");
}

function prepareEncodePayload(input, requestedMode) {
  const source = Buffer.from(input);
  const actualMode = resolveEncodeInputMode(requestedMode);

  return {
    payload: source,
    metadata: {
      input_mode: actualMode === INPUT_MODE_AUTO ? INPUT_MODE_RAW : actualMode,
      source_size: source.length,
      source_format: looksLikeBinary(source) ? "binary" : "text",
      preprocessing: "none"
    }
  };
}

function restoreDecodedPayload(decodedPayload, metadata = {}) {
  const inputMode = resolveInputMode(metadata.input_mode ?? INPUT_MODE_RAW);

  if (inputMode === INPUT_MODE_RAW) {
    return Buffer.from(decodedPayload);
  }

  const restored = hexBinaryBytesToTextBytes(decodedPayload);

  if (metadata.source_size !== undefined && restored.length !== metadata.source_size) {
    throw new Error(
      `Decoded source length ${restored.length} does not match metadata.source_size ${metadata.source_size}.`
    );
  }

  return restored;
}

function buildEncodeLogs({
  inputPath,
  inputSize,
  requestedCompression,
  requestedTransform,
  resolvedAutoCompressionStrategy,
  resolvedAutoCompressionProfile,
  detectedSource,
  allowLargeFiles,
  prepared,
  info,
  outputPath,
  atlSize
}) {
  return [
    `Input path: ${inputPath}`,
    `Input size: ${formatBinarySize(inputSize)} (${inputSize.toLocaleString()} bytes)`,
    `Large-file override: ${allowLargeFiles ? "enabled" : "disabled"}`,
    `Input mode resolved: ${prepared.metadata.input_mode}`,
    `Detected file kind: ${detectedSource.kind}`,
    `Compression requested: ${requestedCompression}`,
    `Combo encoding requested: ${info.metadata.combo_compression_requested ?? COMBO_NONE}`,
    `Auto strategy: ${resolvedAutoCompressionStrategy}`,
    `Auto profile used: ${resolvedAutoCompressionProfile}`,
    `Experimental transform requested: ${requestedTransform}`,
    `Storage mode stored: ${info.metadata.storage_mode ?? "color_rgb"}`,
    `Storage encoding stored: ${info.metadata.storage_encoding ?? "interleaved"}`,
    `Pixel format stored: ${info.metadata.pixel_format ?? "rgb"}`,
    `Combo encoding stored: ${info.metadata.combo_compression ?? COMBO_NONE}`,
    `Compression stored: ${info.metadata.compression} / ${info.metadata.compression_variant ?? info.metadata.compression}`,
    `Experimental transform stored: ${info.metadata.experimental_transform ?? "none"}`,
    `Encoded payload size: ${formatBinarySize(info.encoded_size)} (${info.encoded_size.toLocaleString()} bytes)`,
    `ATL output size: ${formatBinarySize(atlSize)} (${atlSize.toLocaleString()} bytes)`,
    `Pixel grid: ${info.metadata.width} x ${info.metadata.height} (${info.pixel_count.toLocaleString()} pixels)`,
    `Output path: ${outputPath}`
  ];
}

function buildDecodeLogs({
  inputPath,
  inputSize,
  allowLargeFiles,
  parsed,
  restoredPayload,
  outputPath
}) {
  return [
    `Input path: ${inputPath}`,
    `ATL input size: ${formatBinarySize(inputSize)} (${inputSize.toLocaleString()} bytes)`,
    `Large-file override: ${allowLargeFiles ? "enabled" : "disabled"}`,
    `Stored original file: ${parsed.metadata.original_file_name ?? "unknown"}`,
    `Stored input mode: ${parsed.metadata.input_mode ?? "raw"}`,
    `Stored combo encoding: ${parsed.metadata.combo_compression ?? COMBO_NONE}`,
    `Stored storage mode: ${parsed.metadata.storage_mode ?? "color_rgb"}`,
    `Stored storage encoding: ${parsed.metadata.storage_encoding ?? "interleaved"}`,
    `Compression stored: ${parsed.metadata.compression ?? "none"} / ${parsed.metadata.compression_variant ?? parsed.metadata.compression ?? "none"}`,
    `Experimental transform stored: ${parsed.metadata.experimental_transform ?? "none"}`,
    `Checksum verified: ${formatHex32(parsed.checksumStored)}`,
    `Decoded payload size: ${formatBinarySize(parsed.decodedPayload.length)} (${parsed.decodedPayload.length.toLocaleString()} bytes)`,
    `Restored output size: ${formatBinarySize(restoredPayload.length)} (${restoredPayload.length.toLocaleString()} bytes)`,
    `Output path: ${outputPath}`
  ];
}

function normalizeOptionalInteger(name, value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function loadMetadataFile(filePath) {
  if (!filePath) {
    return undefined;
  }

  let parsed;

  try {
    parsed = JSON.parse(readBinaryFile(filePath, "Metadata file").toString("utf8"));
  } catch (error) {
    throw new Error(`Could not parse metadata file "${filePath}": ${error.message}`);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Metadata file must contain a JSON object.");
  }

  return parsed;
}

function encodeFile({
  inputPath,
  outputPath,
  compression,
  comboCompression,
  autoCompressionStrategy,
  experimentalTransform,
  inputMode,
  width,
  height,
  metadataPath,
  metadata,
  allowLargeFiles
}) {
  const inputFile = getReadableFileInfo("Input path", inputPath, { allowLargeFiles });

  const sourceBytes = readBinaryFile(inputFile.resolvedPath, "Input path", {
    allowLargeFiles: true
  });

  const prepared = prepareEncodePayload(sourceBytes, inputMode);
  const normalizedOutputPath = ensureFileExtension(outputPath, ".atl");
  const originalFileName = path.basename(inputFile.resolvedPath);
  const originalFileExtension = path.extname(originalFileName);

  const detectedSource = detectSourceCompressionProfile(
    inputFile.resolvedPath,
    sourceBytes
  );

  const resolvedAutoCompressionStrategy =
    resolveAutoCompressionStrategy(autoCompressionStrategy);

  const resolvedAutoCompressionProfile =
    resolvedAutoCompressionStrategy === AUTO_COMPRESSION_STRATEGY_SMART
      ? detectedSource.autoCompressionProfile
      : resolvedAutoCompressionStrategy;

  const resolvedExperimentalTransform =
    experimentalTransform === undefined || experimentalTransform === null
      ? EXPERIMENTAL_TRANSFORM_NONE
      : normalizeExperimentalTransform(experimentalTransform);

  const requestedCombo = comboCompression || COMBO_NONE;

  const requestedCompression =
    compression === undefined ||
    compression === null ||
    String(compression).trim() === ""
      ? COMPRESSION_AUTO
      : compression;

  const atlBuffer = encodeAtlBuffer(prepared.payload, {
    compression: requestedCompression,
    comboCompression: requestedCombo,
    autoCompressionProfile: resolvedAutoCompressionProfile,
    experimentalTransform: resolvedExperimentalTransform,
    detectedFileKind: detectedSource.kind,
    width: normalizeOptionalInteger("width", width),
    height: normalizeOptionalInteger("height", height),
    metadata: {
      ...(metadata ?? loadMetadataFile(metadataPath)),
      ...prepared.metadata,
      detected_file_kind: detectedSource.kind,
      detected_auto_compression_profile:
        detectedSource.autoCompressionProfile,
      auto_compression_strategy: resolvedAutoCompressionStrategy,
      original_file_name: originalFileName,
      original_file_extension: originalFileExtension,
      ...buildOwnershipMetadata(originalFileName)
    }
  });

  const resolvedOutput = writeBinaryFile(normalizedOutputPath, atlBuffer);
  const atlSize = atlBuffer.length;
  const info = inspectAtlBuffer(atlBuffer);
  const inputSize = inputFile.stats.size;

  return {
    outputPath: resolvedOutput,
    info,
    atlSize,
    summary: computeSummary(inputSize, atlSize, true),
    logs: buildEncodeLogs({
      inputPath: inputFile.resolvedPath,
      inputSize,
      requestedCompression,
      requestedTransform: resolvedExperimentalTransform,
      resolvedAutoCompressionStrategy,
      resolvedAutoCompressionProfile,
      detectedSource,
      allowLargeFiles,
      prepared,
      info,
      outputPath: resolvedOutput,
      atlSize
    })
  };
}

function resolvePreflightConfidence(sampledBytes, totalBytes, storageEncoding) {
  const ratio = totalBytes > 0 ? sampledBytes / totalBytes : 1;

  if (ratio >= 0.04 && sampledBytes >= 65536 && storageEncoding !== "pixel_rle") {
    return "High";
  }

  if (ratio >= 0.02 && sampledBytes >= 16384) {
    return "Medium";
  }

  return "Low";
}

function preflightEncodeFile({
  inputPath,
  compression,
  comboCompression,
  autoCompressionStrategy,
  experimentalTransform,
  inputMode,
  width,
  height,
  metadataPath,
  metadata,
  allowLargeFiles,
  sampleFraction,
  allowedCompressionCandidates,
  allowedTransformCandidates
}) {
  const inputFile = getReadableFileInfo("Input path", inputPath, { allowLargeFiles });
  const sampledBytes = readBinarySample(
    inputFile.resolvedPath,
    inputFile.stats.size,
    sampleFraction
  );
  const prepared = prepareEncodePayload(sampledBytes, inputMode);
  const originalFileName = path.basename(inputFile.resolvedPath);
  const originalFileExtension = path.extname(originalFileName);
  const detectedSource = detectSourceCompressionProfile(inputFile.resolvedPath, sampledBytes);
  const resolvedAutoCompressionStrategy =
    resolveAutoCompressionStrategy(autoCompressionStrategy);
  const resolvedAutoCompressionProfile =
    resolvedAutoCompressionStrategy === AUTO_COMPRESSION_STRATEGY_SMART
      ? detectedSource.autoCompressionProfile
      : resolvedAutoCompressionStrategy;
  const resolvedExperimentalTransform =
    experimentalTransform === undefined || experimentalTransform === null
      ? EXPERIMENTAL_TRANSFORM_NONE
      : normalizeExperimentalTransform(experimentalTransform);
  const requestedCombo = comboCompression || COMBO_NONE;
  const requestedCompression =
    compression === undefined ||
    compression === null ||
    String(compression).trim() === ""
      ? COMPRESSION_AUTO
      : compression;

  const estimate = estimateEncodingFromSample(prepared.payload, inputFile.stats.size, {
    compression: requestedCompression,
    comboCompression: requestedCombo,
    autoCompressionProfile: resolvedAutoCompressionProfile,
    experimentalTransform: resolvedExperimentalTransform,
    detectedFileKind: detectedSource.kind,
    compressionCandidatesOverride: allowedCompressionCandidates,
    transformCandidatesOverride: allowedTransformCandidates,
    width: normalizeOptionalInteger("width", width),
    height: normalizeOptionalInteger("height", height),
    metadata: {
      ...(metadata ?? loadMetadataFile(metadataPath)),
      ...prepared.metadata,
      detected_file_kind: detectedSource.kind,
      detected_auto_compression_profile:
        detectedSource.autoCompressionProfile,
      auto_compression_strategy: resolvedAutoCompressionStrategy,
      original_file_name: originalFileName,
      original_file_extension: originalFileExtension,
      ...buildOwnershipMetadata(originalFileName)
    }
  });

  const estimatedSize = estimate.estimate.estimatedFinalSize;
  const originalSize = inputFile.stats.size;
  const estimatedRatio = originalSize > 0 ? estimatedSize / originalSize : 0;
  const pipeline = [
    ...estimate.compressionChoice.experimentalTransformPipeline,
    estimate.compressionChoice.compressionVariant !== "none"
      ? estimate.compressionChoice.compressionVariant
      : null,
    estimate.bestStorageCandidate.pixelFormat,
    estimate.bestStorageCandidate.storageEncoding !== "interleaved"
      ? estimate.bestStorageCandidate.storageEncoding
      : null
  ].filter(Boolean);

  return {
    inputPath: inputFile.resolvedPath,
    originalSize,
    sampledBytes: prepared.payload.length,
    sampleFraction: clampPreflightSampleFraction(sampleFraction),
    estimatedSize,
    estimatedRatio,
    bestPipeline: pipeline,
    confidence: resolvePreflightConfidence(
      prepared.payload.length,
      originalSize,
      estimate.bestStorageCandidate.storageEncoding
    ),
    storageMode: estimate.bestStorageCandidate.storageMode,
    compression: estimate.compressionChoice.compressionVariant,
    transform: estimate.compressionChoice.experimentalTransform,
    overheadEstimate: {
      metadataBytes: estimate.estimate.estimatedMetadataLength,
      paddingBytes: estimate.estimate.estimatedPaddingSize
    },
    summary: [
      `Estimated size: ${formatBinarySize(estimatedSize)} (${estimatedSize.toLocaleString()} bytes)`,
      `Estimated ratio: ${(estimatedRatio * 100).toFixed(2)}% of original`,
      `Best pipeline: ${pipeline.join(" -> ") || "none"}`,
      `Confidence: ${resolvePreflightConfidence(
        prepared.payload.length,
        originalSize,
        estimate.bestStorageCandidate.storageEncoding
      )} (±5-10%)`
    ].join("\n")
  };
}

function decodeFile({ inputPath, outputPath, allowLargeFiles = false }) {
  const inputFile = getReadableFileInfo("Input path", inputPath, { allowLargeFiles });
  const parsed = parseAtlBuffer(readBinaryFile(inputFile.resolvedPath, "Input path", {
    allowLargeFiles: true
  }));
  const restoredPayload = restoreDecodedPayload(parsed.decodedPayload, parsed.metadata);
  const resolvedOutput = writeBinaryFile(
    buildDecodeOutputPath(inputFile.resolvedPath, outputPath, parsed.metadata),
    restoredPayload
  );
  const inputSize = inputFile.stats.size;
  const bytesWritten = restoredPayload.length;

  return {
    outputPath: resolvedOutput,
    bytesWritten,
    checksum: formatHex32(parsed.checksumStored),
    metadata: parsed.metadata,
    summary: computeSummary(inputSize, bytesWritten, false),
    logs: buildDecodeLogs({
      inputPath: inputFile.resolvedPath,
      inputSize,
      allowLargeFiles,
      parsed,
      restoredPayload,
      outputPath: resolvedOutput
    })
  };
}

function buildPreview(parsed, maxPreviewPixels = MAX_PREVIEW_PIXELS) {
  const width = parsed.metadata.width;
  const height = parsed.metadata.height;
  const pixelFormat = parsed.pixelFormat ?? parsed.metadata.pixel_format ?? "rgb";
  const storageMode = parsed.metadata.storage_mode ?? "color_rgb";

  if (storageMode === "raw_compressed" || storageMode === "raw_uncompressed") {
    return {
      omitted: true,
      canOverride: false,
      reason: `Preview unavailable: this ATL uses ${storageMode} storage instead of color-packed pixels.`
    };
  }

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return {
      omitted: true,
      canOverride: false,
      reason: "Preview unavailable: this ATL does not contain a valid pixel grid."
    };
  }

  if (parsed.pixelCount !== width * height || parsed.pixelData.length === 0) {
    return {
      omitted: true,
      canOverride: false,
      reason: "Preview unavailable: stored pixel data is incomplete for preview rendering."
    };
  }

  if (parsed.pixelCount > maxPreviewPixels) {
    return {
      omitted: true,
      canOverride: true,
      limit: maxPreviewPixels,
      reason: `Preview disabled for files over ${maxPreviewPixels.toLocaleString()} pixels.`
    };
  }

  const aspectRatio = Math.max(width / height, height / width);
  const shouldReflow = aspectRatio > 6;
  const displayWidth = shouldReflow ? Math.ceil(Math.sqrt(parsed.pixelCount)) : width;
  const displayHeight = shouldReflow ? Math.ceil(parsed.pixelCount / displayWidth) : height;
  const displayPixelCount = displayWidth * displayHeight;
  let previewPixels =
    pixelFormat === "rgba"
      ? (() => {
          const rgbaSource = parsed.pixelData;
          const rgbOutput = Buffer.alloc(Math.floor(rgbaSource.length / 4) * 3);
          for (let source = 0, target = 0; source + 3 < rgbaSource.length; source += 4, target += 3) {
            rgbOutput[target] = rgbaSource[source];
            rgbOutput[target + 1] = rgbaSource[source + 1];
            rgbOutput[target + 2] = rgbaSource[source + 2];
          }
          return rgbOutput;
        })()
      : parsed.pixelData;
  const displayPixels =
    displayPixelCount === parsed.pixelCount
      ? previewPixels
      : Buffer.concat([previewPixels, Buffer.alloc((displayPixelCount - parsed.pixelCount) * 3)]);

  return {
    width: displayWidth,
    height: displayHeight,
    sourceWidth: width,
    sourceHeight: height,
    reflowed: shouldReflow,
    pixelFormat: "rgb",
    pixelsBase64: displayPixels.toString("base64")
  };
}

function sampleBuffer(buffer, maxBytes = MAX_INSPECT_SAMPLE_BYTES) {
  const source = Buffer.from(buffer ?? []);
  return {
    totalBytes: source.length,
    sampledBytes: Math.min(source.length, maxBytes),
    truncated: source.length > maxBytes,
    base64: source.subarray(0, maxBytes).toString("base64")
  };
}

function extractPrintableStrings(buffer, minimumLength = 4, limit = 64) {
  const source = Buffer.from(buffer ?? []);
  const strings = [];
  let current = "";

  for (const byte of source) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }

    if (current.length >= minimumLength) {
      strings.push(current);
      if (strings.length >= limit) {
        return strings;
      }
    }
    current = "";
  }

  if (current.length >= minimumLength && strings.length < limit) {
    strings.push(current);
  }

  return strings;
}

function buildTopByteDistribution(buffer, limit = 8) {
  const source = Buffer.from(buffer ?? []);
  if (source.length === 0) {
    return [];
  }

  const counts = new Uint32Array(256);
  for (const byte of source) {
    counts[byte] += 1;
  }

  return Array.from({ length: 256 }, (_, byte) => ({
    byte,
    count: counts[byte],
    percent: Number(((counts[byte] / source.length) * 100).toFixed(2))
  }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

function analyzeRuns(buffer) {
  const source = Buffer.from(buffer ?? []);
  if (source.length === 0) {
    return { repeatingSequences: 0, longestRun: 0 };
  }

  let longestRun = 1;
  let repeatingSequences = 0;
  let currentRun = 1;

  for (let index = 1; index < source.length; index += 1) {
    if (source[index] === source[index - 1]) {
      currentRun += 1;
      if (currentRun === 2) {
        repeatingSequences += 1;
      }
      if (currentRun > longestRun) {
        longestRun = currentRun;
      }
      continue;
    }

    currentRun = 1;
  }

  return {
    repeatingSequences,
    longestRun
  };
}

function buildPipeline(metadata = {}) {
  const pipeline = [];
  const transformPipeline = Array.isArray(metadata.experimental_transform_pipeline)
    ? metadata.experimental_transform_pipeline
    : [];

  pipeline.push(...transformPipeline.filter(Boolean));

  const compressionVariant = metadata.compression_variant ?? metadata.compression;
  if (compressionVariant && compressionVariant !== "none") {
    pipeline.push(compressionVariant);
  }

  if (metadata.pixel_format) {
    pipeline.push(metadata.pixel_format);
  }

  if (metadata.storage_encoding && metadata.storage_encoding !== "interleaved") {
    pipeline.push(metadata.storage_encoding);
  }

  return pipeline.length > 0 ? pipeline : ["none"];
}

function buildInspector(parsed, fileSize) {
  const decodedSample = sampleBuffer(parsed.decodedPayload);
  const interpretedBuffer = Buffer.from(parsed.decodedPayload ?? []);
  const fileInfo = {
    fileName: parsed.metadata.original_file_name ?? "unknown",
    originalSize: parsed.metadata.original_size ?? interpretedBuffer.length,
    encodedSize: parsed.encodedSize,
    fileSize,
    compression: parsed.metadata.compression_variant ?? parsed.metadata.compression ?? "none",
    transform:
      parsed.metadata.combo_compression && parsed.metadata.combo_compression !== COMBO_NONE
        ? parsed.metadata.combo_compression
        : parsed.metadata.experimental_transform ?? "none",
    storageMode: parsed.metadata.storage_mode ?? "color_rgb",
    entropy: parsed.metadata.source_entropy ?? 0
  };

  return {
    fileInfo,
    encoding: {
      pipeline: buildPipeline(parsed.metadata),
      payloadSizeBeforePadding:
        parsed.metadata.payload_size_before_padding ?? parsed.encodedSize,
      paddingAdded: parsed.paddingSize,
      checksum: formatHex32(parsed.checksumStored),
      checksumValid: parsed.checksumStored === parsed.checksumComputed
    },
    sample: decodedSample,
    stats: {
      entropy: parsed.metadata.source_entropy ?? 0,
      topBytes: buildTopByteDistribution(interpretedBuffer),
      ...analyzeRuns(interpretedBuffer)
    },
    interpreted: {
      strings: extractPrintableStrings(interpretedBuffer),
      integers: Array.from(
        { length: Math.min(Math.floor(interpretedBuffer.length / 4), 16) },
        (_, index) => interpretedBuffer.readUInt32LE(index * 4)
      ),
      floats: Array.from(
        { length: Math.min(Math.floor(interpretedBuffer.length / 4), 16) },
        (_, index) => Number(interpretedBuffer.readFloatLE(index * 4).toFixed(4))
      ),
      ascii: interpretedBuffer
        .subarray(0, Math.min(interpretedBuffer.length, 256))
        .toString("latin1")
        .replace(/[^\x20-\x7e]/g, ".")
    }
  };
}

function inspectFile(inputPath, options = {}) {
  const inputFile = getReadableFileInfo("Input path", inputPath, {
    allowLargeFiles: options.allowLargeFiles === true
  });
  const parsed = parseAtlBuffer(readBinaryFile(inputFile.resolvedPath, "Input path", {
    allowLargeFiles: true
  }));
  const previewLimit =
    options.maxPreviewPixels === undefined ? MAX_PREVIEW_PIXELS : options.maxPreviewPixels;
  const info = {
    inputPath: inputFile.resolvedPath,
    magic: "ANTC",
    version: parsed.version,
    metadata_length: parsed.metadataLength,
    metadata: parsed.metadata,
    pixel_data_length: parsed.pixelDataLength,
    pixel_count: parsed.pixelCount,
    encoded_size: parsed.encodedSize,
    padding_size: parsed.paddingSize,
    checksum: formatHex32(parsed.checksumStored),
    preview_limit: previewLimit,
    inspector: buildInspector(parsed, inputFile.stats.size)
  };

  if (options.preview === false) {
    return info;
  }

  return {
    ...info,
    preview: buildPreview(parsed, previewLimit)
  };
}

module.exports = {
  MAX_IN_MEMORY_FILE_BYTES,
  MAX_PREVIEW_PIXELS,
  INPUT_MODE_AUTO,
  INPUT_MODE_RAW,
  INPUT_MODE_TEXT_HEX_BINARY,
  buildDecodeOutputPath,
  decodeFile,
  detectSourceCompressionProfile,
  ensureFileExtension,
  encodeFile,
  preflightEncodeFile,
  getStoredOriginalFileExtension,
  getStoredOriginalFileName,
  hexBinaryBytesToTextBytes,
  inspectFile,
  loadMetadataFile,
  looksLikeBinary,
  normalizeOptionalInteger,
  prepareEncodePayload,
  readBinaryFile,
  resolveAutoCompressionStrategy,
  resolveEncodeInputMode,
  resolvePath,
  resolveInputMode,
  restoreDecodedPayload,
  textBytesToHexBinaryBytes,
  writeBinaryFile
};
