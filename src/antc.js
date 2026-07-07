const zlib = require("node:zlib");

const MAGIC = Buffer.from("ANTC", "ascii");
const VERSION = 0x02;
const LEGACY_VERSION = 0x01;
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
const COMBO_NONE = "combo-none";
const COMBO_DELTA_RLE = "delta+rle";
const COMBO_BROTLI_DELTA = "brotli+delta";
const COMBO_ZLIB_RLE = "zlib+rle";
const COMBO_BYTE_SHUFFLE_ZLIB = "byte-shuffle+zlib";
const COMBO_XOR_DELTA_BROTLI = "xor-delta+brotli";
const COMBO_DELTA_BITPACK_ZLIB = "delta+bitpack+zlib";
const COMBO_PREDICTOR_LEFT_BROTLI = "predictor-left+brotli";
const EXPERIMENTAL_TRANSFORM_NONE = "none";
const EXPERIMENTAL_TRANSFORM_AUTO = "auto";
const EXPERIMENTAL_TRANSFORM_DELTA = "delta";
const EXPERIMENTAL_TRANSFORM_XOR_DELTA = "xor-delta";
const EXPERIMENTAL_TRANSFORM_RLE = "rle";
const EXPERIMENTAL_TRANSFORM_DELTA_RLE = "delta-rle";
const EXPERIMENTAL_TRANSFORM_DELTA_BITPACK = "delta-bitpack";
const EXPERIMENTAL_TRANSFORM_BWT = "bwt";
const EXPERIMENTAL_TRANSFORM_MTF = "mtf";
const EXPERIMENTAL_TRANSFORM_BITPLANE = "bitplane";
const EXPERIMENTAL_TRANSFORM_BYTE_SHUFFLE = "byte-shuffle";
const EXPERIMENTAL_TRANSFORM_BITPACK = "bitpack";
const EXPERIMENTAL_TRANSFORM_PREDICTOR_LEFT = "predictor-left";
const EXPERIMENTAL_TRANSFORM_PREDICTOR_PAETH = "predictor-paeth";
const MAX_BWT_SOURCE_BYTES = 16 * 1024;
const METADATA_MODE_BINARY = "binary";
const METADATA_MODE_JSON = "json";
const STORAGE_MODE_COLOR_RGB = "color_rgb";
const STORAGE_MODE_COLOR_RGBA = "color_rgba";
const STORAGE_MODE_RAW_COMPRESSED = "raw_compressed";
const STORAGE_MODE_RAW_UNCOMPRESSED = "raw_uncompressed";
const STORAGE_ENCODING_INTERLEAVED = "interleaved";
const STORAGE_ENCODING_CHANNEL_SPLIT = "channel_split";
const STORAGE_ENCODING_PIXEL_RLE = "pixel_rle";

const METADATA_SHORT_KEYS = {
  input_mode: "im",
  source_size: "ss",
  source_format: "sf",
  preprocessing: "pp",
  preprocessing_pipeline: "ppp",
  original_file_name: "ofn",
  original_file_extension: "ofx",
  width: "w",
  height: "h",
  data_pixels: "dp",
  grid_pixels: "gp",
  color_depth: "cd",
  original_size: "os",
  encoded_size: "es",
  transformed_size: "ts",
  compression_requested: "cr",
  compression_variant: "cv",
  auto_compression_profile: "ap",
  combo_compression_requested: "ccr",
  combo_compression: "cc",
  experimental_transform_requested: "tr",
  experimental_transform: "tu",
  experimental_transform_pipeline: "tp",
  compression: "cu",
  padding: "pd",
  detected_file_kind: "dfk",
  detected_auto_compression_profile: "dacp",
  auto_compression_strategy: "acs",
  pixel_format: "pf",
  storage_mode: "sm",
  storage_encoding: "se",
  payload_size_before_padding: "ps",
  source_entropy: "en",
  metadata_mode: "mm"
};

const METADATA_LONG_KEYS = Object.fromEntries(
  Object.entries(METADATA_SHORT_KEYS).map(([longKey, shortKey]) => [shortKey, longKey])
);

const METADATA_FIELD_IDS = Object.freeze({
  im: 1,
  ss: 2,
  sf: 3,
  pp: 4,
  ppp: 5,
  ofn: 6,
  ofx: 7,
  w: 8,
  h: 9,
  dp: 10,
  gp: 11,
  cd: 12,
  os: 13,
  es: 14,
  ts: 15,
  cr: 16,
  cv: 17,
  ap: 18,
  ccr: 19,
  cc: 20,
  tr: 21,
  tu: 22,
  tp: 23,
  cu: 24,
  pd: 25,
  dfk: 26,
  dacp: 27,
  acs: 28,
  pf: 29,
  sm: 30,
  se: 31,
  ps: 32,
  en: 33,
  mm: 34,
  custom: 255
});

const METADATA_ID_TO_KEY = Object.fromEntries(
  Object.entries(METADATA_FIELD_IDS).map(([key, value]) => [value, key])
);

const METADATA_BINARY_MAGIC = Buffer.from("MB", "ascii");
const METADATA_JSON_MAGIC = Buffer.from("MJ", "ascii");

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

function xorDeltaEncode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const output = Buffer.allocUnsafe(source.length);
  output[0] = source[0];

  for (let index = 1; index < source.length; index += 1) {
    output[index] = source[index] ^ source[index - 1];
  }

  return output;
}

function xorDeltaDecode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const output = Buffer.allocUnsafe(source.length);
  output[0] = source[0];

  for (let index = 1; index < source.length; index += 1) {
    output[index] = output[index - 1] ^ source[index];
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

function bwtEncode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  if (source.length > MAX_BWT_SOURCE_BYTES) {
    throw new Error(
      `Burrows-Wheeler Transform currently supports payloads up to ${MAX_BWT_SOURCE_BYTES} bytes. Use MTF, Bitplane, Delta, or RLE for larger files.`
    );
  }

  const doubled = Buffer.concat([source, source]);
  const rotations = Array.from({ length: source.length }, (_, index) => index);
  rotations.sort((left, right) =>
    Buffer.compare(
      doubled.subarray(left, left + source.length),
      doubled.subarray(right, right + source.length)
    )
  );

  const output = Buffer.allocUnsafe(source.length + 4);
  let primaryIndex = -1;

  for (let index = 0; index < rotations.length; index += 1) {
    const rotationStart = rotations[index];

    if (rotationStart === 0) {
      primaryIndex = index;
    }

    output[index + 4] = doubled[rotationStart + source.length - 1];
  }

  if (primaryIndex < 0) {
    throw new Error("BWT primary index could not be resolved.");
  }

  output.writeUInt32BE(primaryIndex >>> 0, 0);
  return output;
}

function bwtDecode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  if (source.length < 4) {
    throw new Error("BWT payload is missing its primary index header.");
  }

  const primaryIndex = source.readUInt32BE(0);
  const lastColumn = source.subarray(4);
  const length = lastColumn.length;

  if (length === 0) {
    return Buffer.alloc(0);
  }

  if (primaryIndex >= length) {
    throw new Error("BWT primary index exceeds the transformed payload length.");
  }

  const counts = new Uint32Array(256);
  const ranks = new Uint32Array(length);

  for (let index = 0; index < length; index += 1) {
    const byte = lastColumn[index];
    ranks[index] = counts[byte];
    counts[byte] += 1;
  }

  const starts = new Uint32Array(256);
  let total = 0;

  for (let byte = 0; byte < 256; byte += 1) {
    starts[byte] = total;
    total += counts[byte];
  }

  const output = Buffer.allocUnsafe(length);
  let row = primaryIndex;

  for (let index = length - 1; index >= 0; index -= 1) {
    const byte = lastColumn[row];
    output[index] = byte;
    row = starts[byte] + ranks[row];
  }

  return output;
}

function mtfEncode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const table = new Uint8Array(256);

  for (let index = 0; index < table.length; index += 1) {
    table[index] = index;
  }

  const output = Buffer.allocUnsafe(source.length);

  for (let position = 0; position < source.length; position += 1) {
    const byte = source[position];
    let index = 0;

    while (table[index] !== byte) {
      index += 1;
    }

    output[position] = index;

    while (index > 0) {
      table[index] = table[index - 1];
      index -= 1;
    }

    table[0] = byte;
  }

  return output;
}

function mtfDecode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const table = new Uint8Array(256);

  for (let index = 0; index < table.length; index += 1) {
    table[index] = index;
  }

  const output = Buffer.allocUnsafe(source.length);

  for (let position = 0; position < source.length; position += 1) {
    let index = source[position];
    const byte = table[index];
    output[position] = byte;

    while (index > 0) {
      table[index] = table[index - 1];
      index -= 1;
    }

    table[0] = byte;
  }

  return output;
}

function bitplaneEncode(payload) {
  const source = Buffer.from(payload);
  const output = Buffer.alloc(source.length);
  let bitIndex = 0;

  for (let plane = 7; plane >= 0; plane -= 1) {
    for (let index = 0; index < source.length; index += 1) {
      const bit = (source[index] >> plane) & 1;

      if (bit === 1) {
        output[bitIndex >> 3] |= 1 << (7 - (bitIndex & 7));
      }

      bitIndex += 1;
    }
  }

  return output;
}

function bitplaneDecode(payload) {
  const source = Buffer.from(payload);
  const output = Buffer.alloc(source.length);
  let bitIndex = 0;

  for (let plane = 7; plane >= 0; plane -= 1) {
    for (let index = 0; index < output.length; index += 1) {
      const bit = (source[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
      output[index] |= bit << plane;
      bitIndex += 1;
    }
  }

  return output;
}

function chooseByteShuffleStride(source) {
  let bestStride = 1;
  let bestEntropy = Number.POSITIVE_INFINITY;

  for (const stride of [2, 4, 8]) {
    if (source.length < stride * 2) {
      continue;
    }

    const shuffled = Buffer.alloc(source.length);
    let targetIndex = 0;

    for (let lane = 0; lane < stride; lane += 1) {
      for (let index = lane; index < source.length; index += stride) {
        shuffled[targetIndex] = source[index];
        targetIndex += 1;
      }
    }

    const entropy = computeEntropy(shuffled);
    if (entropy < bestEntropy) {
      bestEntropy = entropy;
      bestStride = stride;
    }
  }

  return bestStride;
}

function byteShuffleEncode(payload) {
  const source = Buffer.from(payload);
  const stride = chooseByteShuffleStride(source);
  const output = Buffer.allocUnsafe(source.length + 1);
  output[0] = stride;

  if (stride === 1 || source.length === 0) {
    source.copy(output, 1);
    return output;
  }

  let targetIndex = 1;
  for (let lane = 0; lane < stride; lane += 1) {
    for (let index = lane; index < source.length; index += stride) {
      output[targetIndex] = source[index];
      targetIndex += 1;
    }
  }

  return output;
}

function byteShuffleDecode(payload) {
  const source = Buffer.from(payload);

  if (source.length === 0) {
    return source;
  }

  const stride = source[0];
  const body = source.subarray(1);

  if (![1, 2, 4, 8].includes(stride)) {
    throw new Error("Byte-shuffle payload contains an unsupported stride header.");
  }

  if (stride === 1 || body.length === 0) {
    return Buffer.from(body);
  }

  const output = Buffer.alloc(body.length);
  let sourceIndex = 0;

  for (let lane = 0; lane < stride; lane += 1) {
    for (let targetIndex = lane; targetIndex < output.length; targetIndex += stride) {
      if (sourceIndex >= body.length) {
        throw new Error("Byte-shuffle payload ended unexpectedly.");
      }

      output[targetIndex] = body[sourceIndex];
      sourceIndex += 1;
    }
  }

  return output;
}

function bitpackEncode(payload) {
  const source = Buffer.from(payload);
  const outputHeader = Buffer.allocUnsafe(5);

  if (source.length === 0) {
    outputHeader[0] = 0;
    outputHeader.writeUInt32BE(0, 1);
    return outputHeader;
  }

  let maxValue = 0;
  for (const byte of source) {
    if (byte > maxValue) {
      maxValue = byte;
    }
  }

  const bitWidth = maxValue === 0 ? 0 : Math.ceil(Math.log2(maxValue + 1));
  outputHeader[0] = bitWidth;
  outputHeader.writeUInt32BE(source.length >>> 0, 1);

  if (bitWidth >= 8) {
    return Buffer.concat([outputHeader, source]);
  }

  const packedByteLength = Math.ceil((source.length * bitWidth) / 8);
  const packed = Buffer.alloc(packedByteLength);
  let bitIndex = 0;

  for (const value of source) {
    for (let shift = bitWidth - 1; shift >= 0; shift -= 1) {
      const bit = (value >> shift) & 1;
      if (bit === 1) {
        packed[bitIndex >> 3] |= 1 << (7 - (bitIndex & 7));
      }
      bitIndex += 1;
    }
  }

  return Buffer.concat([outputHeader, packed]);
}

function bitpackDecode(payload) {
  const source = Buffer.from(payload);

  if (source.length < 5) {
    throw new Error("Bitpack payload is missing its header.");
  }

  const bitWidth = source[0];
  const outputLength = source.readUInt32BE(1);
  const packed = source.subarray(5);

  if (bitWidth > 8) {
    throw new Error("Bitpack payload contains an unsupported bit width.");
  }

  if (bitWidth === 0) {
    return Buffer.alloc(outputLength);
  }

  if (bitWidth === 8) {
    if (packed.length !== outputLength) {
      throw new Error("Bitpack raw payload length does not match its header.");
    }
    return Buffer.from(packed);
  }

  const requiredBits = outputLength * bitWidth;
  if (packed.length * 8 < requiredBits) {
    throw new Error("Bitpack payload ended before all values could be restored.");
  }

  const output = Buffer.alloc(outputLength);
  let bitIndex = 0;

  for (let index = 0; index < outputLength; index += 1) {
    let value = 0;

    for (let bit = 0; bit < bitWidth; bit += 1) {
      value <<= 1;
      value |= (packed[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
      bitIndex += 1;
    }

    output[index] = value;
  }

  return output;
}

function predictorLeftEncode(payload) {
  return deltaEncode(payload);
}

function predictorLeftDecode(payload) {
  return deltaDecode(payload);
}

function predictorPaethEncode(payload) {
  return deltaEncode(payload);
}

function predictorPaethDecode(payload) {
  return deltaDecode(payload);
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
  "xor-delta": {
    transform: xorDeltaEncode,
    restore: xorDeltaDecode,
    pipeline: ["xor-delta"]
  },
  rle: {
    transform: rleEncode,
    restore: rleDecode,
    pipeline: ["rle"]
  },
  bwt: {
    transform: bwtEncode,
    restore: bwtDecode,
    pipeline: ["bwt"]
  },
  mtf: {
    transform: mtfEncode,
    restore: mtfDecode,
    pipeline: ["mtf"]
  },
  bitplane: {
    transform: bitplaneEncode,
    restore: bitplaneDecode,
    pipeline: ["bitplane"]
  },
  "byte-shuffle": {
    transform: byteShuffleEncode,
    restore: byteShuffleDecode,
    pipeline: ["byte-shuffle"]
  },
  bitpack: {
    transform: bitpackEncode,
    restore: bitpackDecode,
    pipeline: ["bitpack"]
  },
  "predictor-left": {
    transform: predictorLeftEncode,
    restore: predictorLeftDecode,
    pipeline: ["predictor-left"]
  },
  "predictor-paeth": {
    transform: predictorPaethEncode,
    restore: predictorPaethDecode,
    pipeline: ["predictor-paeth"]
  },
  "delta-rle": {
    transform: (payload) => rleEncode(deltaEncode(payload)),
    restore: (payload) => deltaDecode(rleDecode(payload)),
    pipeline: ["delta", "rle"]
  },
  "delta-bitpack": {
    transform: (payload) => bitpackEncode(deltaEncode(payload)),
    restore: (payload) => deltaDecode(bitpackDecode(payload)),
    pipeline: ["delta", "bitpack"]
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
  speed: ["none", "delta", "xor-delta"],
  balanced: ["none", "delta", "xor-delta", "rle", "byte-shuffle"],
  max: ["none", "delta", "xor-delta", "rle", "delta-rle", "byte-shuffle", "bitpack"],
  exhaustive: [
    "none",
    "delta",
    "xor-delta",
    "rle",
    "delta-rle",
    "mtf",
    "bitplane",
    "byte-shuffle",
    "bitpack",
    "predictor-left",
    "predictor-paeth"
  ]
};

const COMBO_PRESETS = {
  [COMBO_NONE]: {
    compression: null,
    experimentalTransform: null
  },
  [COMBO_DELTA_RLE]: {
    compression: null,
    experimentalTransform: EXPERIMENTAL_TRANSFORM_DELTA_RLE
  },
  [COMBO_BROTLI_DELTA]: {
    compression: "brotli",
    experimentalTransform: EXPERIMENTAL_TRANSFORM_DELTA
  },
  [COMBO_ZLIB_RLE]: {
    compression: "zlib",
    experimentalTransform: EXPERIMENTAL_TRANSFORM_RLE
  },
  [COMBO_BYTE_SHUFFLE_ZLIB]: {
    compression: "zlib",
    experimentalTransform: EXPERIMENTAL_TRANSFORM_BYTE_SHUFFLE
  },
  [COMBO_XOR_DELTA_BROTLI]: {
    compression: "brotli",
    experimentalTransform: EXPERIMENTAL_TRANSFORM_XOR_DELTA
  },
  [COMBO_DELTA_BITPACK_ZLIB]: {
    compression: "zlib",
    experimentalTransform: EXPERIMENTAL_TRANSFORM_DELTA_BITPACK
  },
  [COMBO_PREDICTOR_LEFT_BROTLI]: {
    compression: "brotli",
    experimentalTransform: EXPERIMENTAL_TRANSFORM_PREDICTOR_LEFT
  }
};

const COMBO_TRANSFORM_COMPONENTS = {
  [COMBO_NONE]: [],
  [COMBO_DELTA_RLE]: ["delta", "rle"],
  [COMBO_BROTLI_DELTA]: ["delta"],
  [COMBO_ZLIB_RLE]: ["rle"],
  [COMBO_BYTE_SHUFFLE_ZLIB]: ["byte-shuffle"],
  [COMBO_XOR_DELTA_BROTLI]: ["xor-delta"],
  [COMBO_DELTA_BITPACK_ZLIB]: ["delta", "bitpack"],
  [COMBO_PREDICTOR_LEFT_BROTLI]: ["predictor-left"]
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

function computeEntropy(buffer) {
  if (!buffer || buffer.length === 0) {
    return 0;
  }

  const counts = new Uint32Array(256);

  for (const byte of buffer) {
    counts[byte] += 1;
  }

  let value = 0;

  for (const count of counts) {
    if (count === 0) {
      continue;
    }

    const probability = count / buffer.length;
    value -= probability * Math.log2(probability);
  }

  return Number(value.toFixed(4));
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

  if (normalized === COMPRESSION_ZLIB_FAST || normalized === COMPRESSION_ZLIB_MAX) {
    return "zlib";
  }

  if (
    normalized === "gzip" ||
    normalized === COMPRESSION_GZIP_FAST ||
    normalized === COMPRESSION_GZIP_MAX
  ) {
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

  if (normalized === EXPERIMENTAL_TRANSFORM_XOR_DELTA) {
    return EXPERIMENTAL_TRANSFORM_XOR_DELTA;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_RLE) {
    return EXPERIMENTAL_TRANSFORM_RLE;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_DELTA_RLE || normalized === "delta+rle") {
    return EXPERIMENTAL_TRANSFORM_DELTA_RLE;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_DELTA_BITPACK || normalized === "delta+bitpack") {
    return EXPERIMENTAL_TRANSFORM_DELTA_BITPACK;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_BWT) {
    return EXPERIMENTAL_TRANSFORM_BWT;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_MTF) {
    return EXPERIMENTAL_TRANSFORM_MTF;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_BITPLANE) {
    return EXPERIMENTAL_TRANSFORM_BITPLANE;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_BYTE_SHUFFLE) {
    return EXPERIMENTAL_TRANSFORM_BYTE_SHUFFLE;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_BITPACK) {
    return EXPERIMENTAL_TRANSFORM_BITPACK;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_PREDICTOR_LEFT) {
    return EXPERIMENTAL_TRANSFORM_PREDICTOR_LEFT;
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_PREDICTOR_PAETH) {
    return EXPERIMENTAL_TRANSFORM_PREDICTOR_PAETH;
  }

  throw new Error(`Unsupported experimental transform "${value}".`);
}

function normalizeComboCompression(value = COMBO_NONE) {
  const normalized = String(value ?? COMBO_NONE).trim().toLowerCase();

  if (normalized === "" || normalized === COMBO_NONE || normalized === "none") {
    return COMBO_NONE;
  }

  if (normalized === COMBO_DELTA_RLE || normalized === "combo-delta-rle") {
    return COMBO_DELTA_RLE;
  }

  if (normalized === COMBO_BROTLI_DELTA) {
    return COMBO_BROTLI_DELTA;
  }

  if (normalized === COMBO_ZLIB_RLE) {
    return COMBO_ZLIB_RLE;
  }

  if (normalized === COMBO_BYTE_SHUFFLE_ZLIB) {
    return COMBO_BYTE_SHUFFLE_ZLIB;
  }

  if (normalized === COMBO_XOR_DELTA_BROTLI) {
    return COMBO_XOR_DELTA_BROTLI;
  }

  if (normalized === COMBO_DELTA_BITPACK_ZLIB) {
    return COMBO_DELTA_BITPACK_ZLIB;
  }

  if (normalized === COMBO_PREDICTOR_LEFT_BROTLI) {
    return COMBO_PREDICTOR_LEFT_BROTLI;
  }

  throw new Error(`Unsupported combo encoding "${value}".`);
}

function normalizeMetadataMode(value = METADATA_MODE_BINARY) {
  const normalized = String(value ?? METADATA_MODE_BINARY).trim().toLowerCase();

  if (normalized === "" || normalized === METADATA_MODE_BINARY) {
    return METADATA_MODE_BINARY;
  }

  if (normalized === METADATA_MODE_JSON || normalized === "debug") {
    return METADATA_MODE_JSON;
  }

  throw new Error(`Unsupported metadata mode "${value}".`);
}

function getTransformComponents(transform) {
  const normalized = normalizeExperimentalTransform(transform);

  if (normalized === EXPERIMENTAL_TRANSFORM_NONE) {
    return [];
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_AUTO || normalized === EXPERIMENTAL_TRANSFORM_DELTA_RLE) {
    return ["delta", "rle"];
  }

  if (normalized === EXPERIMENTAL_TRANSFORM_DELTA_BITPACK) {
    return ["delta", "bitpack"];
  }

  return [normalized];
}

function assertNoComboTransformOverlap(comboCompression, requestedExperimentalTransform) {
  const comboComponents = COMBO_TRANSFORM_COMPONENTS[comboCompression] ?? [];

  if (comboComponents.length === 0) {
    return;
  }

  const transformComponents = getTransformComponents(requestedExperimentalTransform);
  const overlappingComponents = comboComponents.filter((component) =>
    transformComponents.includes(component)
  );

  if (overlappingComponents.length === 0) {
    return;
  }

  throw new Error(
    `Combo encoding "${comboCompression}" overlaps with Solo Encoding "${requestedExperimentalTransform}". Choose only one path for ${overlappingComponents.join(" + ")}.`
  );
}

function resolveComboEncoding(comboCompression, requestedCompression, requestedExperimentalTransform) {
  const normalizedCombo = normalizeComboCompression(comboCompression);
  const preset = COMBO_PRESETS[normalizedCombo];

  if (!preset) {
    throw new Error(`Unsupported combo encoding "${comboCompression}".`);
  }

  assertNoComboTransformOverlap(normalizedCombo, requestedExperimentalTransform);

  if (normalizedCombo === COMBO_NONE) {
    return {
      comboCompressionRequested: COMBO_NONE,
      comboCompressionApplied: COMBO_NONE,
      requestedCompression,
      requestedExperimentalTransform
    };
  }

  return {
    comboCompressionRequested: normalizedCombo,
    comboCompressionApplied: normalizedCombo,
    requestedCompression: preset.compression ?? requestedCompression,
    requestedExperimentalTransform: preset.experimentalTransform ?? requestedExperimentalTransform
  };
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

function selectEntropyAwareCandidates(payload, options = {}) {
  const autoCompressionProfile = normalizeAutoCompressionProfile(options.autoCompressionProfile);
  const requestedCompression = normalizeRequestedCompression(options.requestedCompression);
  const requestedExperimentalTransform = normalizeExperimentalTransform(
    options.experimentalTransform
  );
  const detectedFileKind = String(options.detectedFileKind ?? "");
  const sourceEntropy = options.sourceEntropy ?? computeEntropy(payload);
  const highEntropy =
    sourceEntropy >= 7.65 ||
    detectedFileKind === "already-compressed-media-or-archive" ||
    detectedFileKind === "executable-or-library";

  let compressionCandidates =
    requestedCompression === COMPRESSION_AUTO
      ? highEntropy
        ? ["none", "zlib", "brotli"]
        : AUTO_COMPRESSION_PROFILES[autoCompressionProfile]
      : [requestedCompression];

  let transformCandidates =
    requestedExperimentalTransform === EXPERIMENTAL_TRANSFORM_AUTO
      ? highEntropy
        ? ["none"]
        : AUTO_TRANSFORM_PROFILES[autoCompressionProfile]
      : [requestedExperimentalTransform];

  if (Array.isArray(options.compressionCandidatesOverride) && options.compressionCandidatesOverride.length > 0) {
    const allowed = new Set(
      options.compressionCandidatesOverride.map((value) => normalizeRequestedCompression(value))
    );
    compressionCandidates = compressionCandidates.filter((candidate) => allowed.has(candidate));
    if (compressionCandidates.length === 0) {
      compressionCandidates = [requestedCompression === COMPRESSION_AUTO ? COMPRESSION_NONE : requestedCompression];
    }
  }

  if (Array.isArray(options.transformCandidatesOverride) && options.transformCandidatesOverride.length > 0) {
    const allowed = new Set(
      options.transformCandidatesOverride.map((value) => normalizeExperimentalTransform(value))
    );
    transformCandidates = transformCandidates.filter((candidate) => allowed.has(candidate));
    if (transformCandidates.length === 0) {
      transformCandidates = [requestedExperimentalTransform === EXPERIMENTAL_TRANSFORM_AUTO ? EXPERIMENTAL_TRANSFORM_NONE : requestedExperimentalTransform];
    }
  }

  return {
    sourceEntropy,
    compressionCandidates,
    transformCandidates
  };
}

function chooseCompression(payload, requestedCompression, options = {}) {
  const autoCompressionProfile = normalizeAutoCompressionProfile(options.autoCompressionProfile);
  const requestedExperimentalTransform = normalizeExperimentalTransform(
    options.experimentalTransform
  );
  const { sourceEntropy, compressionCandidates, transformCandidates } = selectEntropyAwareCandidates(
    payload,
    {
      autoCompressionProfile,
      requestedCompression,
      experimentalTransform: requestedExperimentalTransform,
      detectedFileKind: options.detectedFileKind,
      sourceEntropy: options.sourceEntropy,
      compressionCandidatesOverride: options.compressionCandidatesOverride,
      transformCandidatesOverride: options.transformCandidatesOverride
    }
  );
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
        encodedPayload,
        sourceEntropy
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
    const autoWidth = Math.ceil(Math.sqrt(pixelCount));
    return { width: autoWidth, height: Math.ceil(pixelCount / autoWidth) };
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

function channelSplitEncode(packedPixels, pixelSize) {
  if (pixelSize <= 0) {
    return Buffer.alloc(0);
  }

  const pixelCount = Math.ceil(packedPixels.length / pixelSize);
  const output = Buffer.alloc(pixelCount * pixelSize);
  let targetIndex = 0;

  for (let channel = 0; channel < pixelSize; channel += 1) {
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      output[targetIndex] = packedPixels[pixelIndex * pixelSize + channel] ?? 0;
      targetIndex += 1;
    }
  }

  return output;
}

function channelSplitDecode(splitPixels, pixelSize) {
  if (pixelSize <= 0) {
    return Buffer.alloc(0);
  }

  const pixelCount = Math.floor(splitPixels.length / pixelSize);
  const output = Buffer.alloc(pixelCount * pixelSize);
  let sourceIndex = 0;

  for (let channel = 0; channel < pixelSize; channel += 1) {
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      output[pixelIndex * pixelSize + channel] = splitPixels[sourceIndex];
      sourceIndex += 1;
    }
  }

  return output;
}

function pixelRleEncode(packedPixels, pixelSize) {
  if (pixelSize <= 0 || packedPixels.length === 0) {
    return Buffer.alloc(0);
  }

  const chunks = [];
  const pixelCount = Math.floor(packedPixels.length / pixelSize);
  let index = 0;

  while (index < pixelCount) {
    let runLength = 1;

    while (
      index + runLength < pixelCount &&
      runLength < 255 &&
      packedPixels.subarray(index * pixelSize, index * pixelSize + pixelSize).equals(
        packedPixels.subarray((index + runLength) * pixelSize, (index + runLength) * pixelSize + pixelSize)
      )
    ) {
      runLength += 1;
    }

    chunks.push(Buffer.from([runLength]));
    chunks.push(packedPixels.subarray(index * pixelSize, index * pixelSize + pixelSize));
    index += runLength;
  }

  return Buffer.concat(chunks);
}

function pixelRleDecode(encodedPixels, pixelSize, expectedPackedLength) {
  const chunks = [];
  let index = 0;

  while (index < encodedPixels.length) {
    const runLength = encodedPixels[index];
    index += 1;

    if (runLength === 0 || index + pixelSize > encodedPixels.length) {
      throw new Error("Pixel RLE stream is truncated.");
    }

    const pixel = encodedPixels.subarray(index, index + pixelSize);
    index += pixelSize;

    for (let runIndex = 0; runIndex < runLength; runIndex += 1) {
      chunks.push(pixel);
    }
  }

  const output = Buffer.concat(chunks);

  if (expectedPackedLength !== undefined && output.length !== expectedPackedLength) {
    throw new Error("Pixel RLE output length does not match the expected packed length.");
  }

  return output;
}

function minifyMetadataObject(metadata) {
  const output = {};

  for (const [key, value] of Object.entries(metadata)) {
    output[METADATA_SHORT_KEYS[key] ?? key] = value;
  }

  return output;
}

function expandMetadataAliases(metadata) {
  const output = {};

  for (const [key, value] of Object.entries(metadata)) {
    output[METADATA_LONG_KEYS[key] ?? key] = value;
  }

  return output;
}

function encodeBinaryMetadataValue(value) {
  if (value === null || value === undefined) {
    return { type: 0, payload: Buffer.alloc(0) };
  }

  if (typeof value === "boolean") {
    return { type: 1, payload: Buffer.from([value ? 1 : 0]) };
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    const payload = Buffer.alloc(8);
    payload.writeBigUInt64BE(BigInt(value), 0);
    return { type: 2, payload };
  }

  if (typeof value === "number") {
    const payload = Buffer.alloc(8);
    payload.writeDoubleBE(value, 0);
    return { type: 3, payload };
  }

  if (typeof value === "string") {
    return { type: 4, payload: Buffer.from(value, "utf8") };
  }

  return { type: 5, payload: Buffer.from(JSON.stringify(value), "utf8") };
}

function decodeBinaryMetadataValue(type, payload) {
  if (type === 0) {
    return null;
  }

  if (type === 1) {
    return payload[0] === 1;
  }

  if (type === 2) {
    return Number(payload.readBigUInt64BE(0));
  }

  if (type === 3) {
    return payload.readDoubleBE(0);
  }

  if (type === 4) {
    return payload.toString("utf8");
  }

  if (type === 5) {
    return JSON.parse(payload.toString("utf8"));
  }

  throw new Error(`Unsupported binary metadata field type ${type}.`);
}

function serializeMetadataBinary(metadata) {
  const minified = minifyMetadataObject(metadata);
  const knownEntries = [];
  const customEntries = {};

  for (const [key, value] of Object.entries(minified)) {
    if (Object.prototype.hasOwnProperty.call(METADATA_FIELD_IDS, key)) {
      knownEntries.push([key, value]);
    } else {
      customEntries[key] = value;
    }
  }

  if (Object.keys(customEntries).length > 0) {
    knownEntries.push(["custom", customEntries]);
  }

  const chunks = [METADATA_BINARY_MAGIC];
  const countBuffer = Buffer.alloc(2);
  countBuffer.writeUInt16BE(knownEntries.length, 0);
  chunks.push(countBuffer);

  for (const [key, value] of knownEntries) {
    const fieldId = METADATA_FIELD_IDS[key];
    const { type, payload } = encodeBinaryMetadataValue(value);
    const header = Buffer.alloc(4);
    header.writeUInt8(fieldId, 0);
    header.writeUInt8(type, 1);
    header.writeUInt16BE(payload.length, 2);
    chunks.push(header, payload);
  }

  return Buffer.concat(chunks);
}

function parseMetadataBinary(metadataBytes) {
  let offset = METADATA_BINARY_MAGIC.length;

  if (metadataBytes.length < offset + 2) {
    throw new Error("Binary metadata block is truncated.");
  }

  const entryCount = metadataBytes.readUInt16BE(offset);
  offset += 2;
  const output = {};

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (offset + 4 > metadataBytes.length) {
      throw new Error("Binary metadata entry header is truncated.");
    }

    const fieldId = metadataBytes.readUInt8(offset);
    const type = metadataBytes.readUInt8(offset + 1);
    const length = metadataBytes.readUInt16BE(offset + 2);
    offset += 4;

    if (offset + length > metadataBytes.length) {
      throw new Error("Binary metadata entry value is truncated.");
    }

    const payload = metadataBytes.subarray(offset, offset + length);
    offset += length;
    const key = METADATA_ID_TO_KEY[fieldId];

    if (!key) {
      continue;
    }

    const decodedValue = decodeBinaryMetadataValue(type, payload);

    if (key === "custom") {
      Object.assign(output, decodedValue ?? {});
      continue;
    }

    output[key] = decodedValue;
  }

  return expandMetadataAliases(output);
}

function serializeMetadata(metadata, metadataMode = METADATA_MODE_BINARY) {
  if (metadataMode === METADATA_MODE_JSON) {
    const minified = minifyMetadataObject(metadata);
    return Buffer.concat([METADATA_JSON_MAGIC, Buffer.from(JSON.stringify(minified), "utf8")]);
  }

  return serializeMetadataBinary(metadata);
}

function parseMetadata(metadataBytes) {
  if (metadataBytes.subarray(0, METADATA_BINARY_MAGIC.length).equals(METADATA_BINARY_MAGIC)) {
    return parseMetadataBinary(metadataBytes);
  }

  if (metadataBytes.subarray(0, METADATA_JSON_MAGIC.length).equals(METADATA_JSON_MAGIC)) {
    const parsed = JSON.parse(metadataBytes.subarray(METADATA_JSON_MAGIC.length).toString("utf8"));
    return expandMetadataAliases(parsed);
  }

  const parsed = JSON.parse(metadataBytes.toString("utf8"));
  return expandMetadataAliases(parsed);
}

function validateParsedMetadata(metadata) {
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    throw new Error("Metadata block must decode to an object.");
  }

  if (!("original_size" in metadata)) {
    throw new Error('Metadata must include "original_size".');
  }

  assertWholeNumber("metadata.original_size", metadata.original_size);

  for (const numericKey of [
    "encoded_size",
    "transformed_size",
    "width",
    "height",
    "data_pixels",
    "grid_pixels",
    "padding",
    "payload_size_before_padding"
  ]) {
    if (numericKey in metadata && metadata[numericKey] !== null) {
      assertWholeNumber(`metadata.${numericKey}`, metadata[numericKey]);
    }
  }

  if ("color_depth" in metadata && metadata.color_depth !== SUPPORTED_COLOR_DEPTH) {
    throw new Error(
      `Unsupported color_depth "${metadata.color_depth}". Version 1/2 support RGB preview metadata only.`
    );
  }

  return metadata;
}

function buildStorageCandidates(payload, rawData, options = {}) {
  const metadataMode = normalizeMetadataMode(options.metadataMode);
  const requestedWidth = options.width;
  const requestedHeight = options.height;
  const baseMetadata = options.baseMetadata ?? {};
  const candidates = [];

  function pushRawCandidate(storageMode, sourcePayload) {
    const metadata = {
      ...baseMetadata,
      width: 0,
      height: 0,
      data_pixels: 0,
      grid_pixels: 0,
      color_depth: SUPPORTED_COLOR_DEPTH,
      padding: 0,
      pixel_format: null,
      storage_mode: storageMode,
      storage_encoding: STORAGE_ENCODING_INTERLEAVED,
      payload_size_before_padding: sourcePayload.length,
      metadata_mode: metadataMode
    };
    candidates.push({
      storageMode,
      storageEncoding: STORAGE_ENCODING_INTERLEAVED,
      pixelFormat: null,
      width: 0,
      height: 0,
      dataPixels: 0,
      gridPixels: 0,
      paddingSize: 0,
      storedBytes: Buffer.from(sourcePayload),
      payloadBytes: Buffer.from(sourcePayload),
      metadata,
      finalSize: 0
    });
  }

  function pushColorCandidate(storageMode, pixelFormat, storageEncoding, sourcePayload) {
    const pixelSize = pixelFormat === "rgba" ? 4 : 3;
    const dataPixelCount = Math.ceil(sourcePayload.length / pixelSize);
    const { width, height } = resolveDimensions(requestedWidth, requestedHeight, dataPixelCount);
    const packedLength = width * height * pixelSize;
    const paddingSize = packedLength - sourcePayload.length;
    const paddedBytes =
      paddingSize === 0
        ? Buffer.from(sourcePayload)
        : Buffer.concat([Buffer.from(sourcePayload), Buffer.alloc(paddingSize)], packedLength);
    let storedBytes = paddedBytes;

    if (storageEncoding === STORAGE_ENCODING_CHANNEL_SPLIT) {
      storedBytes = channelSplitEncode(paddedBytes, pixelSize);
    } else if (storageEncoding === STORAGE_ENCODING_PIXEL_RLE) {
      storedBytes = pixelRleEncode(paddedBytes, pixelSize);
    }

    const metadata = {
      ...baseMetadata,
      width,
      height,
      data_pixels: dataPixelCount,
      grid_pixels: width * height,
      color_depth: SUPPORTED_COLOR_DEPTH,
      padding: paddingSize,
      pixel_format: pixelFormat,
      storage_mode: storageMode,
      storage_encoding: storageEncoding,
      payload_size_before_padding: sourcePayload.length,
      metadata_mode: metadataMode
    };

    candidates.push({
      storageMode,
      storageEncoding,
      pixelFormat,
      width,
      height,
      dataPixels: dataPixelCount,
      gridPixels: width * height,
      paddingSize,
      storedBytes,
      payloadBytes: Buffer.from(sourcePayload),
      metadata,
      finalSize: 0
    });
  }

  pushRawCandidate(STORAGE_MODE_RAW_COMPRESSED, payload);
  pushRawCandidate(STORAGE_MODE_RAW_UNCOMPRESSED, rawData);

  for (const pixelFormat of ["rgb", "rgba"]) {
    const storageMode = pixelFormat === "rgba" ? STORAGE_MODE_COLOR_RGBA : STORAGE_MODE_COLOR_RGB;
    pushColorCandidate(storageMode, pixelFormat, STORAGE_ENCODING_INTERLEAVED, payload);
    pushColorCandidate(storageMode, pixelFormat, STORAGE_ENCODING_CHANNEL_SPLIT, payload);
    pushColorCandidate(storageMode, pixelFormat, STORAGE_ENCODING_PIXEL_RLE, payload);
  }

  return candidates.map((candidate) => {
    const metadataBytes = serializeMetadata(candidate.metadata, metadataMode);
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC.copy(header, 0);
    header.writeUInt8(VERSION, 4);
    header.writeUInt16BE(metadataBytes.length, 5);
    const body = Buffer.concat([header, metadataBytes, candidate.storedBytes]);
    const footer = Buffer.alloc(FOOTER_SIZE);
    footer.writeUInt32BE(crc32(body), 0);
    const finalBuffer = Buffer.concat([body, footer]);

    return {
      ...candidate,
      metadataBytes,
      finalBuffer,
      finalSize: finalBuffer.length
    };
  });
}

function chooseBestStorageCandidate(payload, rawData, options = {}) {
  const candidates = buildStorageCandidates(payload, rawData, options);
  let best = candidates[0];

  for (const candidate of candidates.slice(1)) {
    if (candidate.finalSize < best.finalSize) {
      best = candidate;
    }
  }

  return best;
}

function buildAtlBuffer(buffer, metadata, version = VERSION, metadataMode = METADATA_MODE_BINARY) {
  const metadataBytes = serializeMetadata(metadata, metadataMode);

  if (metadataBytes.length > 0xffff) {
    throw new Error("Metadata block exceeds uint16 storage capacity.");
  }

  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt8(version, 4);
  header.writeUInt16BE(metadataBytes.length, 5);

  const body = Buffer.concat([header, metadataBytes, buffer]);
  const footer = Buffer.alloc(FOOTER_SIZE);
  footer.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([body, footer]);
}

function parseLegacyAtlBuffer(input) {
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
  const metadata = validateParsedMetadata(parseMetadata(metadataBytes));
  const pixelData = input.subarray(metadataEnd, checksumOffset);
  const compression = normalizeStoredCompression(metadata.compression);

  if (pixelData.length % 3 !== 0) {
    throw new Error("Pixel data length must be divisible by 3 for RGB storage.");
  }

  if ("width" in metadata && "height" in metadata) {
    const expectedLength = metadata.width * metadata.height * 3;

    if (expectedLength !== pixelData.length) {
      throw new Error(
        `Pixel data length ${pixelData.length} does not match width/height geometry ${metadata.width}x${metadata.height}.`
      );
    }
  }

  const encodedSize = "encoded_size" in metadata ? metadata.encoded_size : metadata.original_size;
  const encodedPayload = pixelData.subarray(0, encodedSize);
  const paddingBytes = pixelData.subarray(encodedSize);

  for (const byte of paddingBytes) {
    if (byte !== 0x00) {
      throw new Error("Pixel padding bytes must be 0x00.");
    }
  }

  const transformedPayload = decompressPayload(encodedPayload, compression);
  const transform = normalizeExperimentalTransform(metadata.experimental_transform);
  const decodedPayload = restoreTransformedPayload(transformedPayload, transform);

  if (decodedPayload.length !== metadata.original_size) {
    throw new Error(
      `Decoded payload length ${decodedPayload.length} does not match metadata.original_size ${metadata.original_size}.`
    );
  }

  return {
    version: LEGACY_VERSION,
    metadataLength,
    metadata,
    metadataBytes,
    storedBytes: Buffer.from(pixelData),
    pixelData: Buffer.from(pixelData),
    pixelDataLength: pixelData.length,
    pixelCount: pixelData.length / 3,
    encodedSize,
    paddingSize: paddingBytes.length,
    checksumStored,
    checksumComputed,
    transformedPayload,
    decodedPayload,
    payloadBytes: Buffer.from(encodedPayload),
    storageMode: STORAGE_MODE_COLOR_RGB,
    storageEncoding: STORAGE_ENCODING_INTERLEAVED,
    pixelFormat: "rgb"
  };
}

function decodeStoragePayload(metadata, storedBytes) {
  const storageMode = metadata.storage_mode ?? STORAGE_MODE_COLOR_RGB;
  const storageEncoding = metadata.storage_encoding ?? STORAGE_ENCODING_INTERLEAVED;
  const pixelFormat = metadata.pixel_format ?? "rgb";
  const payloadSizeBeforePadding =
    metadata.payload_size_before_padding ??
    metadata.encoded_size ??
    metadata.original_size;

  if (storageMode === STORAGE_MODE_RAW_COMPRESSED || storageMode === STORAGE_MODE_RAW_UNCOMPRESSED) {
    return {
      payloadBytes: storedBytes.subarray(0, payloadSizeBeforePadding),
      pixelBytes: null,
      pixelCount: 0,
      paddingSize: 0,
      pixelFormat: null,
      storageMode,
      storageEncoding
    };
  }

  const pixelSize = pixelFormat === "rgba" ? 4 : 3;
  const packedLength = metadata.width * metadata.height * pixelSize;
  let packedPixels;

  if (storageEncoding === STORAGE_ENCODING_INTERLEAVED) {
    if (storedBytes.length !== packedLength) {
      throw new Error("Packed pixel payload length does not match width/height geometry.");
    }
    packedPixels = Buffer.from(storedBytes);
  } else if (storageEncoding === STORAGE_ENCODING_CHANNEL_SPLIT) {
    if (storedBytes.length !== packedLength) {
      throw new Error("Channel-split payload length does not match width/height geometry.");
    }
    packedPixels = channelSplitDecode(storedBytes, pixelSize);
  } else if (storageEncoding === STORAGE_ENCODING_PIXEL_RLE) {
    packedPixels = pixelRleDecode(storedBytes, pixelSize, packedLength);
  } else {
    throw new Error(`Unsupported storage encoding "${storageEncoding}".`);
  }

  return {
    payloadBytes: packedPixels.subarray(0, payloadSizeBeforePadding),
    pixelBytes: packedPixels,
    pixelCount: metadata.width * metadata.height,
    paddingSize: packedLength - payloadSizeBeforePadding,
    pixelFormat,
    storageMode,
    storageEncoding
  };
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

  if (version === LEGACY_VERSION) {
    return parseLegacyAtlBuffer(input);
  }

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
  const metadata = validateParsedMetadata(parseMetadata(metadataBytes));
  const storedBytes = input.subarray(metadataEnd, checksumOffset);
  const storageDecoded = decodeStoragePayload(metadata, storedBytes);
  const payloadBytes = storageDecoded.payloadBytes;
  let decodedPayload;
  let transformedPayload;

  if (storageDecoded.storageMode === STORAGE_MODE_RAW_UNCOMPRESSED) {
    transformedPayload = Buffer.from(payloadBytes);
    decodedPayload = Buffer.from(payloadBytes);
  } else {
    const compression = normalizeStoredCompression(metadata.compression);
    transformedPayload = decompressPayload(payloadBytes, compression);
    const transform = normalizeExperimentalTransform(metadata.experimental_transform);
    decodedPayload = restoreTransformedPayload(transformedPayload, transform);
  }

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
    storedBytes: Buffer.from(storedBytes),
    pixelData: storageDecoded.pixelBytes ? Buffer.from(storageDecoded.pixelBytes) : Buffer.alloc(0),
    pixelDataLength: storageDecoded.pixelBytes ? storageDecoded.pixelBytes.length : 0,
    pixelCount: storageDecoded.pixelCount,
    encodedSize: payloadBytes.length,
    paddingSize: storageDecoded.paddingSize,
    checksumStored,
    checksumComputed,
    transformedPayload,
    decodedPayload,
    payloadBytes: Buffer.from(payloadBytes),
    storageMode: storageDecoded.storageMode,
    storageEncoding: storageDecoded.storageEncoding,
    pixelFormat: storageDecoded.pixelFormat
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

function planEncoding(rawInput, options = {}) {
  const rawData = Buffer.isBuffer(rawInput) ? Buffer.from(rawInput) : Buffer.from(rawInput ?? []);
  const requestedCompression = normalizeRequestedCompression(options.compression);
  const requestedExperimentalTransform = normalizeExperimentalTransform(
    options.experimentalTransform
  );
  const comboEncoding = resolveComboEncoding(
    options.comboCompression,
    requestedCompression,
    requestedExperimentalTransform
  );
  const metadataMode = normalizeMetadataMode(options.metadataMode);
  const compressionChoice = chooseCompression(rawData, comboEncoding.requestedCompression, {
    autoCompressionProfile: options.autoCompressionProfile,
    experimentalTransform: comboEncoding.requestedExperimentalTransform,
    detectedFileKind: options.detectedFileKind,
    sourceEntropy: options.sourceEntropy
  });

  const baseMetadata = {
    ...(options.metadata ?? {}),
    color_depth: SUPPORTED_COLOR_DEPTH,
    original_size: rawData.length,
    encoded_size: compressionChoice.encodedPayload.length,
    transformed_size: compressionChoice.transformedSize,
    compression_requested: requestedCompression,
    compression_variant: compressionChoice.compressionVariant,
    auto_compression_profile: compressionChoice.autoCompressionProfile,
    combo_compression_requested: comboEncoding.comboCompressionRequested,
    combo_compression: comboEncoding.comboCompressionApplied,
    experimental_transform_requested: compressionChoice.requestedExperimentalTransform,
    experimental_transform: compressionChoice.experimentalTransform,
    experimental_transform_pipeline: compressionChoice.experimentalTransformPipeline,
    compression: compressionChoice.actualCompression,
    source_entropy: compressionChoice.sourceEntropy,
    metadata_mode: metadataMode
  };

  const bestStorageCandidate = chooseBestStorageCandidate(
    compressionChoice.encodedPayload,
    rawData,
    {
      width: options.width,
      height: options.height,
      metadataMode,
      baseMetadata
    }
  );

  return {
    rawData,
    requestedCompression,
    requestedExperimentalTransform,
    comboEncoding,
    metadataMode,
    compressionChoice,
    baseMetadata,
    bestStorageCandidate
  };
}

function estimateCandidateSizeFromSample(samplePlan, fullInputSize, options = {}) {
  const sampleInputSize = samplePlan.rawData.length;
  const sampleCandidate = samplePlan.bestStorageCandidate;
  const scale = sampleInputSize > 0 ? fullInputSize / sampleInputSize : 1;
  const estimatedEncodedPayloadLength = Math.max(
    0,
    Math.round(samplePlan.compressionChoice.encodedPayload.length * scale)
  );
  const estimatedTransformedSize = Math.max(
    0,
    Math.round(samplePlan.compressionChoice.transformedSize * scale)
  );
  const storageMode = sampleCandidate.storageMode;
  const storageEncoding = sampleCandidate.storageEncoding;
  const pixelFormat = sampleCandidate.pixelFormat;
  const metadataMode = samplePlan.metadataMode;
  let width = 0;
  let height = 0;
  let dataPixels = 0;
  let gridPixels = 0;
  let paddingSize = 0;
  let storedLength = 0;

  if (storageMode === STORAGE_MODE_RAW_COMPRESSED) {
    storedLength = estimatedEncodedPayloadLength;
  } else if (storageMode === STORAGE_MODE_RAW_UNCOMPRESSED) {
    storedLength = fullInputSize;
  } else {
    const pixelSize = pixelFormat === "rgba" ? 4 : 3;
    dataPixels = Math.ceil(estimatedEncodedPayloadLength / pixelSize);
    const resolved = resolveDimensions(options.width, options.height, dataPixels);
    width = resolved.width;
    height = resolved.height;
    gridPixels = width * height;
    const packedLength = gridPixels * pixelSize;
    paddingSize = packedLength - estimatedEncodedPayloadLength;

    if (storageEncoding === STORAGE_ENCODING_PIXEL_RLE) {
      const samplePixelSize = pixelFormat === "rgba" ? 4 : 3;
      const samplePackedLength = sampleCandidate.gridPixels * samplePixelSize;
      const storageRatio =
        samplePackedLength > 0 ? sampleCandidate.storedBytes.length / samplePackedLength : 1;
      storedLength = Math.max(estimatedEncodedPayloadLength, Math.round(packedLength * storageRatio));
    } else {
      storedLength = packedLength;
    }
  }

  const estimatedMetadata = {
    ...samplePlan.baseMetadata,
    original_size: fullInputSize,
    encoded_size: estimatedEncodedPayloadLength,
    transformed_size: estimatedTransformedSize,
    width,
    height,
    data_pixels: dataPixels,
    grid_pixels: gridPixels,
    padding: paddingSize,
    pixel_format: pixelFormat ?? null,
    storage_mode: storageMode,
    storage_encoding: storageEncoding,
    payload_size_before_padding:
      storageMode === STORAGE_MODE_RAW_UNCOMPRESSED ? fullInputSize : estimatedEncodedPayloadLength,
    metadata_mode: metadataMode
  };
  const metadataBytes = serializeMetadata(estimatedMetadata, metadataMode);
  const estimatedFinalSize = HEADER_SIZE + metadataBytes.length + storedLength + FOOTER_SIZE;

  return {
    estimatedFinalSize,
    estimatedMetadataLength: metadataBytes.length,
    estimatedStoredLength: storedLength,
    estimatedPaddingSize: paddingSize,
    estimatedEncodedPayloadLength,
    estimatedTransformedSize,
    estimatedMetadata
  };
}

function estimateEncodingFromSample(rawInput, fullInputSize, options = {}) {
  const samplePlan = planEncoding(rawInput, options);
  const estimate = estimateCandidateSizeFromSample(samplePlan, fullInputSize, options);

  return {
    ...samplePlan,
    estimate
  };
}

function encodeAtlBuffer(rawInput, options = {}) {
  const plan = planEncoding(rawInput, options);
  return plan.bestStorageCandidate.finalBuffer;
}

module.exports = {
  AUTO_COMPRESSION_PROFILE_EXHAUSTIVE,
  AUTO_COMPRESSION_PROFILE_SPEED,
  AUTO_COMPRESSION_PROFILE_BALANCED,
  AUTO_COMPRESSION_PROFILE_MAX,
  COMBO_BROTLI_DELTA,
  COMBO_BYTE_SHUFFLE_ZLIB,
  COMBO_DELTA_BITPACK_ZLIB,
  COMBO_DELTA_RLE,
  COMBO_NONE,
  COMBO_PREDICTOR_LEFT_BROTLI,
  COMBO_XOR_DELTA_BROTLI,
  COMBO_ZLIB_RLE,
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
  EXPERIMENTAL_TRANSFORM_BITPACK,
  EXPERIMENTAL_TRANSFORM_BITPLANE,
  EXPERIMENTAL_TRANSFORM_BYTE_SHUFFLE,
  EXPERIMENTAL_TRANSFORM_DELTA,
  EXPERIMENTAL_TRANSFORM_DELTA_BITPACK,
  EXPERIMENTAL_TRANSFORM_DELTA_RLE,
  EXPERIMENTAL_TRANSFORM_BWT,
  EXPERIMENTAL_TRANSFORM_MTF,
  EXPERIMENTAL_TRANSFORM_NONE,
  EXPERIMENTAL_TRANSFORM_PREDICTOR_LEFT,
  EXPERIMENTAL_TRANSFORM_PREDICTOR_PAETH,
  EXPERIMENTAL_TRANSFORM_RLE,
  EXPERIMENTAL_TRANSFORM_XOR_DELTA,
  MAGIC,
  TRANSFORM_HANDLERS,
  VERSION,
  LEGACY_VERSION,
  STORAGE_MODE_COLOR_RGB,
  STORAGE_MODE_COLOR_RGBA,
  STORAGE_MODE_RAW_COMPRESSED,
  STORAGE_MODE_RAW_UNCOMPRESSED,
  STORAGE_ENCODING_INTERLEAVED,
  STORAGE_ENCODING_CHANNEL_SPLIT,
  STORAGE_ENCODING_PIXEL_RLE,
  METADATA_MODE_BINARY,
  METADATA_MODE_JSON,
  chooseCompression,
  computeEntropy,
  crc32,
  encodeAtlBuffer,
  estimateEncodingFromSample,
  parseAtlBuffer,
  inspectAtlBuffer,
  formatHex32,
  normalizeComboCompression,
  normalizeAutoCompressionProfile,
  normalizeExperimentalTransform,
  normalizeRequestedCompression,
  normalizeStoredCompression,
  normalizeMetadataMode
};
