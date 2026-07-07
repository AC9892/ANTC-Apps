const zlib = require("node:zlib");

const MAGIC = Buffer.from("ANTC", "ascii");
const VERSION = 0x01;
const HEADER_SIZE = 7;
const FOOTER_SIZE = 4;
const SUPPORTED_COLOR_DEPTH = "RGB";
const COMPRESSION_NONE = "none";
const COMPRESSION_AUTO = "auto";
const COMPRESSION_BROTLI_MAX = "brotli-max";
const COMPRESSION_ZLIB_FAST = "zlib-fast";
const COMPRESSION_ZLIB_MAX = "zlib-max";
const COMPRESSION_GZIP_FAST = "gzip-fast";
const COMPRESSION_GZIP_MAX = "gzip-max";
const COMPRESSION_BROTLI_FAST = "brotli-fast";
const AUTO_COMPRESSION_PROFILE_SPEED = "speed";
const AUTO_COMPRESSION_PROFILE_BALANCED = "balanced";
const AUTO_COMPRESSION_PROFILE_MAX = "max";
const AUTO_COMPRESSION_PROFILE_EXHAUSTIVE = "exhaustive";
const EXPERIMENTAL_TRANSFORM_NONE = "none";
const EXPERIMENTAL_TRANSFORM_AUTO = "auto";
const EXPERIMENTAL_TRANSFORM_DELTA = "delta";
const EXPERIMENTAL_TRANSFORM_RLE = "rle";
const EXPERIMENTAL_TRANSFORM_DELTA_RLE = "delta-rle";

const COMPRESSION_HANDLERS = {
  none: {
    compress: (payload) => Buffer.from(payload),
    decompress: (payload) => Buffer.from(payload)
  },
  zlib: {
    compress: (payload) => zlib.deflateSync(payload, { level: 9 }),
    decompress: (payload) => zlib.inflateSync(payload)
  },
  gzip: {
    compress: (payload) => zlib.gzipSync(payload, { level: 9 }),
    decompress: (payload) => zlib.gunzipSync(payload)
  },
  brotli: {
    compress: (payload) =>
      zlib.brotliCompressSync(payload, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5
        }
      }),
    decompress: (payload) => zlib.brotliDecompressSync(payload)
  }
};

function deltaEncode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const output = Buffer.allocUnsafe(source.length);
  output[0] = source[0];

  for (let index = 1; index < source.length; index += 1) {
    output[index] = (source[index] - source[index - 1] + 256) & 0xff;
  }

  return output;
}

function deltaDecode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const output = Buffer.allocUnsafe(source.length);
  output[0] = source[0];

  for (let index = 1; index < source.length; index += 1) {
    output[index] = (output[index - 1] + source[index]) & 0xff;
  }

  return output;
}

function rleEncode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const chunks = [];
  let index = 0;

  while (index < source.length) {
    let runLength = 1;

    while (
      index + runLength < source.length &&
      source[index + runLength] === source[index] &&
      runLength < 128
    ) {
      runLength += 1;
    }

    if (runLength >= 3) {
      chunks.push(Buffer.from([257 - runLength, source[index]]));
      index += runLength;
      continue;
    }

    const literalStart = index;
    let literalLength = 0;

    while (index < source.length && literalLength < 128) {
      runLength = 1;

      while (
        index + runLength < source.length &&
        source[index + runLength] === source[index] &&
        runLength < 128
      ) {
        runLength += 1;
      }

      if (runLength >= 3) {
        break;
      }

      index += 1;
      literalLength += 1;
    }

    chunks.push(Buffer.from([literalLength - 1]));
    chunks.push(source.subarray(literalStart, literalStart + literalLength));
  }

  return Buffer.concat(chunks);
}

function rleDecode(payload) {
  const source = Buffer.from(payload);
  const chunks = [];
  let index = 0;

  while (index < source.length) {
    const header = source[index];
    index += 1;

    if (header <= 127) {
      const literalLength = header + 1;

      if (index + literalLength > source.length) {
        throw new Error("RLE literal block exceeds payload length.");
      }

      chunks.push(source.subarray(index, index + literalLength));
      index += literalLength;
      continue;
    }

    if (header === 128) {
      continue;
    }

    const repeatLength = 257 - header;

    if (index >= source.length) {
      throw new Error("RLE repeated block is missing its byte value.");
    }

    chunks.push(Buffer.alloc(repeatLength, source[index]));
    index += 1;
  }

  return Buffer.concat(chunks);
}

const TRANSFORM_HANDLERS = {
  none: {
    transform: (payload) => Buffer.from(payload),
    restore: (payload) => Buffer.from(payload),
    pipeline: []
  },
  delta: {
    transform: deltaEncode,
    restore: deltaDecode,
    pipeline: ["delta"]
  },
  rle: {
    transform: rleEncode,
    restore: rleDecode,
    pipeline: ["rle"]
  },
  "delta-rle": {
    transform: (payload) => rleEncode(deltaEncode(payload)),
    restore: (payload) => deltaDecode(rleDecode(payload)),
    pipeline: ["delta", "rle"]
  }
};

const COMPRESSION_VARIANTS = {
  none: {
    method: "none",
    variant: "none",
    compress: (payload) => Buffer.from(payload)
  },
  zlib: {
    method: "zlib",
    variant: "zlib",
    compress: (payload) => COMPRESSION_HANDLERS.zlib.compress(payload)
  },
  "zlib-fast": {
    method: "zlib",
    variant: "zlib-fast",
    compress: (payload) => zlib.deflateSync(payload, { level: 1 })
  },
  "zlib-max": {
    method: "zlib",
    variant: "zlib-max",
    compress: (payload) => zlib.deflateSync(payload, { level: 9 })
  },
  gzip: {
    method: "gzip",
    variant: "gzip",
    compress: (payload) => COMPRESSION_HANDLERS.gzip.compress(payload)
  },
  "gzip-fast": {
    method: "gzip",
    variant: "gzip-fast",
    compress: (payload) => zlib.gzipSync(payload, { level: 1 })
  },
  "gzip-max": {
    method: "gzip",
    variant: "gzip-max",
    compress: (payload) => zlib.gzipSync(payload, { level: 9 })
  },
  brotli: {
    method: "brotli",
    variant: "brotli",
    compress: (payload) => COMPRESSION_HANDLERS.brotli.compress(payload)
  },
  "brotli-fast": {
    method: "brotli",
    variant: "brotli-fast",
    compress: (payload) =>
      zlib.brotliCompressSync(payload, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 3
        }
      })
  },
  "brotli-max": {
    method: "brotli",
    variant: "brotli-max",
    compress: (payload) =>
      zlib.brotliCompressSync(payload, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11
        }
      })
  }
};

const AUTO_COMPRESSION_PROFILES = {
  speed: ["none", "zlib-fast", "gzip-fast", "brotli-fast"],
  balanced: ["none", "zlib", "gzip", "brotli"],
  max: ["none", "zlib-max", "gzip-max", "brotli", "brotli-max"],
  exhaustive: [
    "none",
    "zlib-fast",
    "zlib",
    "zlib-max",
    "gzip-fast",
    "gzip",
    "gzip-max",
    "brotli-fast",
    "brotli",
    "brotli-max"
  ]
};

const AUTO_TRANSFORM_PROFILES = {
  speed: ["none", "delta"],
  balanced: ["none", "delta", "rle"],
  max: ["none", "delta", "rle", "delta-rle"],
  exhaustive: ["none", "delta", "rle", "delta-rle"]
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function isWholeNumber(value) {
  return Number.isInteger(value) && value >= 0;
}

function assertWholeNumber(name, value) {
  if (!isWholeNumber(value)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

function normalizeRequestedCompression(value = COMPRESSION_NONE) {
  const normalized = String(value ?? COMPRESSION_NONE).trim().toLowerCase();

  if (normalized === "" || normalized === COMPRESSION_AUTO) {
    return COMPRESSION_AUTO;
  }

  if (normalized === COMPRESSION_NONE) {
    return COMPRESSION_NONE;
  }

  if (normalized === "zlib" || normalized === "deflate") {
    return "zlib";
  }

  if (normalized === COMPRESSION_ZLIB_FAST || normalized === "deflate-fast") {
    return COMPRESSION_ZLIB_FAST;
  }

  if (normalized === COMPRESSION_ZLIB_MAX || normalized === "deflate-max") {
    return COMPRESSION_ZLIB_MAX;
  }

  if (normalized === "gzip") {
    return "gzip";
  }

  if (normalized === COMPRESSION_GZIP_FAST) {
    return COMPRESSION_GZIP_FAST;
  }

  if (normalized === COMPRESSION_GZIP_MAX) {
    return COMPRESSION_GZIP_MAX;
  }

  if (normalized === "brotli" || normalized === "br") {
    return "brotli";
  }

  if (normalized === COMPRESSION_BROTLI_FAST) {
    return COMPRESSION_BROTLI_FAST;
  }

  if (normalized === COMPRESSION_BROTLI_MAX || normalized === "brotli-max") {
    return COMPRESSION_BROTLI_MAX;
  }

  throw new Error(`Unsupported compression "${value}".`);
}

function normalizeStoredCompression(value = COMPRESSION_NONE) {
  const normalized = String(value ?? COMPRESSION_NONE).trim().toLowerCase();

  if (normalized === "" || normalized === COMPRESSION_NONE) {
    return COMPRESSION_NONE;
  }

  if (normalized === "zlib" || normalized === "deflate") {
    return "zlib";
  }

  if (
    normalized === COMPRESSION_ZLIB_FAST ||
    normalized === COMPRESSION_ZLIB_MAX
  ) {
    return "zlib";
  }

  if (normalized === "gzip" || normalized === COMPRESSION_GZIP_FAST || normalized === COMPRESSION_GZIP_MAX) {
    return "gzip";
  }

  if (
    normalized === "brotli" ||
    normalized === "br" ||
    normalized === COMPRESSION_BROTLI_FAST ||
    normalized === COMPRESSION_BROTLI_MAX
  ) {
    return "brotli";
  }

  if (normalized === COMPRESSION_AUTO) {
    throw new Error('Stored ATL metadata cannot use "auto" compression.');
  }

  throw new Error(`Unsupported compression "${value}".`);
}

function compressPayload(payload, compression) {
  const variant = COMPRESSION_VARIANTS[compression];

  if (variant) {
    return variant.compress(payload);
  }

  const handler = COMPRESSION_HANDLERS[compression];

  if (!handler) {
    throw new Error(`Unsupported compression "${compression}".`);
  }

  return handler.compress(payload);
}

function decompressPayload(payload, compression) {
  const handler = COMPRESSION_HANDLERS[compression];

  if (!handler) {
    throw new Error(`Unsupported compression "${compression}".`);
  }

  return handler.decompress(payload);
}

function transformPayload(payload, transform) {
  const handler = TRANSFORM_HANDLERS[transform];

  if (!handler) {
    throw new Error(`Unsupported experimental transform "${transform}".`);
  }

  return handler.transform(payload);
}

function restoreTransformedPayload(payload, transform) {
  const handler = TRANSFORM_HANDLERS[transform];

  if (!handler) {
    throw new Error(`Unsupported experimental transform "${transform}".`);
  }

  return handler.restore(payload);
}

function normalizeAutoCompressionProfile(value = AUTO_COMPRESSION_PROFILE_BALANCED) {
  const normalized = String(value ?? AUTO_COMPRESSION_PROFILE_BALANCED).trim().toLowerCase();

  if (normalized === "" || normalized === AUTO_COMPRESSION_PROFILE_BALANCED) {
    return AUTO_COMPRESSION_PROFILE_BALANCED;
  }

  if (normalized === AUTO_COMPRESSION_PROFILE_SPEED) {
    return AUTO_COMPRESSION_PROFILE_SPEED;
  }

  if (normalized === AUTO_COMPRESSION_PROFILE_MAX) {
    return AUTO_COMPRESSION_PROFILE_MAX;
  }

  if (normalized === AUTO_COMPRESSION_PROFILE_EXHAUSTIVE) {
    return AUTO_COMPRESSION_PROFILE_EXHAUSTIVE;
  }

  throw new Error(`Unsupported auto compression profile "${value}".`);
}

function normalizeExperimentalTransform(value = EXPERIMENTAL_TRANSFORM_NONE) {
  const normalized = String(value ?? EXPERIMENTAL_TRANSFORM_NONE).trim().toLowerCase();

  if (normalized === "" || normalized === EXPERIMENTAL_TRANSFORM_NONE) {
    return EXPERIMENTAL_TRANSFORM_NONE;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_AUTO) {
    return EXPERIMENTAL_TRANSFORM_AUTO;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_DELTA) {
    return EXPERIMENTAL_TRANSFORM_DELTA;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_RLE) {
    return EXPERIMENTAL_TRANSFORM_RLE;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_DELTA_RLE || normalized === "delta+rle") {
    return EXPERIMENTAL_TRANSFORM_DELTA_RLE;
  }

  throw new Error(`Unsupported experimental transform "${value}".`);
}

function chooseCompression(payload, requestedCompression, options = {}) {
  const autoCompressionProfile = normalizeAutoCompressionProfile(options.autoCompressionProfile);
  const requestedExperimentalTransform = normalizeExperimentalTransform(
    options.experimentalTransform
  );
  const compressionCandidates =
    requestedCompression === COMPRESSION_AUTO
      ? AUTO_COMPRESSION_PROFILES[autoCompressionProfile]
      : [requestedCompression];
  const transformCandidates =
    requestedExperimentalTransform === EXPERIMENTAL_TRANSFORM_AUTO
      ? AUTO_TRANSFORM_PROFILES[autoCompressionProfile]
      : [requestedExperimentalTransform];
  let best;

  for (const transform of transformCandidates) {
    const transformedPayload = transformPayload(payload, transform);

    for (const compression of compressionCandidates) {
      const variant = COMPRESSION_VARIANTS[compression];
      const encodedPayload = compressPayload(transformedPayload, compression);
      const candidate = {
        requestedCompression,
        actualCompression: variant?.method ?? compression,
        compressionVariant: variant?.variant ?? compression,
        autoCompressionProfile,
        requestedExperimentalTransform,
        experimentalTransform: transform,
        experimentalTransformPipeline: TRANSFORM_HANDLERS[transform].pipeline,
        transformedSize: transformedPayload.length,
        encodedPayload
      };

      if (!best || candidate.encodedPayload.length < best.encodedPayload.length) {
        best = candidate;
      }
    }
  }

  return best;
}

function resolveDimensions(width, height, pixelCount) {
  const hasWidth = width !== undefined;
  const hasHeight = height !== undefined;

  if (pixelCount === 0) {
    if (!hasWidth && !hasHeight) {
      return { width: 0, height: 0 };
    }

    if (width === 0 && (height === 0 || !hasHeight)) {
      return { width: 0, height: 0 };
    }

    if (height === 0 && !hasWidth) {
      return { width: 0, height: 0 };
    }

    throw new Error("Empty payloads require width/height of 0 or no dimensions.");
  }

  if (!hasWidth && !hasHeight) {
    const width = Math.ceil(Math.sqrt(pixelCount));
    return { width, height: Math.ceil(pixelCount / width) };
  }

  if (hasWidth) {
    assertWholeNumber("width", width);
    if (width === 0) {
      throw new Error("width must be greater than 0 when pixel data is present.");
    }
  }

  if (hasHeight) {
    assertWholeNumber("height", height);
    if (height === 0) {
      throw new Error("height must be greater than 0 when pixel data is present.");
    }
  }

  if (hasWidth && hasHeight) {
    if (width * height < pixelCount) {
      throw new Error(
        `width * height must be at least pixel count (${pixelCount}), received ${width} * ${height}.`
      );
    }

    return { width, height };
  }

  if (hasWidth) {
    return { width, height: Math.ceil(pixelCount / width) };
  }

  return { width: Math.ceil(pixelCount / height), height };
}

function encodeAtlBuffer(rawInput, options = {}) {
  const rawData = Buffer.isBuffer(rawInput) ? Buffer.from(rawInput) : Buffer.from(rawInput ?? []);
  const requestedCompression = normalizeRequestedCompression(options.compression);
  const compressionChoice = chooseCompression(rawData, requestedCompression, {
    autoCompressionProfile: options.autoCompressionProfile,
    experimentalTransform: options.experimentalTransform
  });
  const compression = compressionChoice.actualCompression;
  const encodedPayload = compressionChoice.encodedPayload;
  const dataPixelCount = Math.ceil(encodedPayload.length / 3);
  const { width, height } = resolveDimensions(options.width, options.height, dataPixelCount);
  const paddedPixelLength = width * height * 3;
  const paddingSize = paddedPixelLength - encodedPayload.length;
  const pixelData =
    paddingSize === 0
      ? encodedPayload
      : Buffer.concat([encodedPayload, Buffer.alloc(paddingSize)], paddedPixelLength);
  const metadata = {
    ...(options.metadata ?? {}),
    width,
    height,
    data_pixels: dataPixelCount,
    grid_pixels: width * height,
    color_depth: SUPPORTED_COLOR_DEPTH,
    original_size: rawData.length,
    encoded_size: encodedPayload.length,
    transformed_size: compressionChoice.transformedSize,
    compression_requested: requestedCompression,
    compression_variant: compressionChoice.compressionVariant,
    auto_compression_profile: compressionChoice.autoCompressionProfile,
    experimental_transform_requested: compressionChoice.requestedExperimentalTransform,
    experimental_transform: compressionChoice.experimentalTransform,
    experimental_transform_pipeline: compressionChoice.experimentalTransformPipeline,
    compression
  };

  if (paddingSize > 0) {
    metadata.padding = paddingSize;
  }

  const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf8");

  if (metadataBytes.length > 0xffff) {
    throw new Error("Metadata block exceeds uint16 storage capacity.");
  }

  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, 4);
  header.writeUInt16BE(metadataBytes.length, 5);

  const body = Buffer.concat([header, metadataBytes, pixelData]);
  const footer = Buffer.alloc(FOOTER_SIZE);
  footer.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([body, footer]);
}

function parseMetadata(metadataBytes) {
  let parsed;

  try {
    parsed = JSON.parse(metadataBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Metadata block is not valid JSON: ${error.message}`);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Metadata block must decode to a JSON object.");
  }

  if (!("original_size" in parsed)) {
    throw new Error('Metadata must include "original_size".');
  }

  assertWholeNumber("metadata.original_size", parsed.original_size);

  if ("encoded_size" in parsed) {
    assertWholeNumber("metadata.encoded_size", parsed.encoded_size);
  }

  if ("transformed_size" in parsed) {
    assertWholeNumber("metadata.transformed_size", parsed.transformed_size);
  }

  if ("width" in parsed) {
    assertWholeNumber("metadata.width", parsed.width);
  }

  if ("height" in parsed) {
    assertWholeNumber("metadata.height", parsed.height);
  }

  if ("color_depth" in parsed && parsed.color_depth !== SUPPORTED_COLOR_DEPTH) {
    throw new Error(
      `Unsupported color_depth "${parsed.color_depth}". Version 1 supports RGB pixels only.`
    );
  }

  return parsed;
}

function validatePixelGeometry(metadata, pixelDataLength) {
  if (pixelDataLength % 3 !== 0) {
    throw new Error("Pixel data length must be divisible by 3 for RGB storage.");
  }

  if ("width" in metadata && "height" in metadata) {
    const expectedLength = metadata.width * metadata.height * 3;

    if (expectedLength !== pixelDataLength) {
      throw new Error(
        `Pixel data length ${pixelDataLength} does not match width/height geometry ${metadata.width}x${metadata.height}.`
      );
    }
  }
}

function resolveEncodedSize(metadata, compression, pixelDataLength) {
  if ("encoded_size" in metadata) {
    if (metadata.encoded_size > pixelDataLength) {
      throw new Error("metadata.encoded_size exceeds pixel data length.");
    }

    return metadata.encoded_size;
  }

  if (compression === "none") {
    if (metadata.original_size > pixelDataLength) {
      throw new Error("metadata.original_size exceeds pixel data length.");
    }

    return metadata.original_size;
  }

  throw new Error(
    'Compressed ATL files must include "encoded_size" metadata so RGB padding can be trimmed safely.'
  );
}

function assertZeroPadding(paddingBytes) {
  for (const byte of paddingBytes) {
    if (byte !== 0x00) {
      throw new Error("Pixel padding bytes must be 0x00.");
    }
  }
}

function parseAtlBuffer(fileBuffer) {
  const input = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer ?? []);

  if (input.length < HEADER_SIZE + FOOTER_SIZE) {
    throw new Error("ATL file is too small to contain a valid header and checksum.");
  }

  if (!input.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Invalid magic header. Expected ASCII "ANTC".');
  }

  const version = input.readUInt8(4);

  if (version !== VERSION) {
    throw new Error(`Unsupported ANTC version ${version}.`);
  }

  const metadataLength = input.readUInt16BE(5);
  const metadataStart = HEADER_SIZE;
  const metadataEnd = metadataStart + metadataLength;
  const checksumOffset = input.length - FOOTER_SIZE;

  if (metadataEnd > checksumOffset) {
    throw new Error("Metadata block extends beyond the checksum footer.");
  }

  const checksumStored = input.readUInt32BE(checksumOffset);
  const content = input.subarray(0, checksumOffset);
  const checksumComputed = crc32(content);

  if (checksumStored !== checksumComputed) {
    throw new Error(
      `CRC32 mismatch. Stored ${formatHex32(checksumStored)}, computed ${formatHex32(checksumComputed)}.`
    );
  }

  const metadataBytes = input.subarray(metadataStart, metadataEnd);
  const metadata = parseMetadata(metadataBytes);
  const pixelData = input.subarray(metadataEnd, checksumOffset);
  const compression = normalizeStoredCompression(metadata.compression);
  validatePixelGeometry(metadata, pixelData.length);

  const encodedSize = resolveEncodedSize(metadata, compression, pixelData.length);
  const encodedPayload = pixelData.subarray(0, encodedSize);
  const paddingBytes = pixelData.subarray(encodedSize);
  assertZeroPadding(paddingBytes);

  const transformedPayload = decompressPayload(encodedPayload, compression);
  const transform = normalizeExperimentalTransform(metadata.experimental_transform);

  if (
    metadata.transformed_size !== undefined &&
    transformedPayload.length !== metadata.transformed_size
  ) {
    throw new Error(
      `Transformed payload length ${transformedPayload.length} does not match metadata.transformed_size ${metadata.transformed_size}.`
    );
  }

  const decodedPayload = restoreTransformedPayload(transformedPayload, transform);

  if (decodedPayload.length !== metadata.original_size) {
    throw new Error(
      `Decoded payload length ${decodedPayload.length} does not match metadata.original_size ${metadata.original_size}.`
    );
  }

  return {
    version,
    metadataLength,
    metadata,
    metadataBytes,
    pixelData: Buffer.from(pixelData),
    pixelDataLength: pixelData.length,
    pixelCount: pixelData.length / 3,
    encodedSize,
    paddingSize: paddingBytes.length,
    checksumStored,
    checksumComputed,
    transformedPayload,
    decodedPayload
  };
}

function formatHex32(value) {
  return `0x${value.toString(16).padStart(8, "0")}`;
}

function inspectAtlBuffer(fileBuffer) {
  const parsed = parseAtlBuffer(fileBuffer);

  return {
    magic: MAGIC.toString("ascii"),
    version: parsed.version,
    metadata_length: parsed.metadataLength,
    metadata: parsed.metadata,
    pixel_data_length: parsed.pixelDataLength,
    pixel_count: parsed.pixelCount,
    encoded_size: parsed.encodedSize,
    padding_size: parsed.paddingSize,
    checksum: formatHex32(parsed.checksumStored)
  };
}

module.exports = {
  AUTO_COMPRESSION_PROFILE_EXHAUSTIVE,
  AUTO_COMPRESSION_PROFILE_SPEED,
  AUTO_COMPRESSION_PROFILE_BALANCED,
  AUTO_COMPRESSION_PROFILE_MAX,
  COMPRESSION_AUTO,
  COMPRESSION_HANDLERS,
  COMPRESSION_BROTLI_FAST,
  COMPRESSION_BROTLI_MAX,
  COMPRESSION_GZIP_FAST,
  COMPRESSION_GZIP_MAX,
  COMPRESSION_NONE,
  COMPRESSION_ZLIB_FAST,
  COMPRESSION_ZLIB_MAX,
  EXPERIMENTAL_TRANSFORM_AUTO,
  EXPERIMENTAL_TRANSFORM_DELTA,
  EXPERIMENTAL_TRANSFORM_DELTA_RLE,
  EXPERIMENTAL_TRANSFORM_NONE,
  EXPERIMENTAL_TRANSFORM_RLE,
  MAGIC,
  TRANSFORM_HANDLERS,
  VERSION,
  chooseCompression,
  crc32,
  encodeAtlBuffer,
  parseAtlBuffer,
  inspectAtlBuffer,
  formatHex32,
  normalizeAutoCompressionProfile,
  normalizeExperimentalTransform,
  normalizeRequestedCompression,
  normalizeStoredCompression
};
