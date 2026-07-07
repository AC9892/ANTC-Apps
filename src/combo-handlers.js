{ COMPRESSION_VARIANTS, TRANSFORM_HANDLERS } = require('./antc');

function stubCompress(payload) {
  console.warn('Stub compression used - install deps for full support');
  return Buffer.from(payload);
}

const COMBO_COMPRESSION_VARIANTS = {
  'gzip+delta': {
    compress: (p) => COMPRESSION_VARIANTS['gzip-max'].compress(TRANSFORM_HANDLERS.delta.transform(p)),
    decompress: (p) => TRANSFORM_HANDLERS.delta.restore(COMPRESSION_VARIANTS.gzip.decompress(p)),
    pipeline: ['delta', 'gzip']
  },
  'brotli+delta': {
    compress: (p) => COMPRESSION_VARIANTS['brotli-max'].compress(TRANSFORM_HANDLERS.delta.transform(p)),
    decompress: (p) => TRANSFORM_HANDLERS.delta.restore(COMPRESSION_VARIANTS.brotli.decompress(p)),
    pipeline: ['delta', 'brotli']
  },
  'zlib+rle': {
    compress: (p) => COMPRESSION_VARIANTS['zlib-max'].compress(TRANSFORM_HANDLERS.rle.transform(p)),
    decompress: (p) => TRANSFORM_HANDLERS.rle.restore(COMPRESSION_VARIANTS.zlib.decompress(p)),
    pipeline: ['rle', 'zlib']
  },
  // New algos - stubs
  'zstd': {
    compress: stubCompress,
    decompress: stubCompress,
    pipeline: ['zstd']
  },
  'lz4': {
    compress: stubCompress,
    decompress: stubCompress,
    pipeline: ['lz4']
  },
  'lzma': {
    compress: stubCompress,
    decompress: stubCompress,
    pipeline: ['lzma']
  },
  'zstd+delta': {
    compress: (p) => stubCompress(TRANSFORM_HANDLERS.delta.transform(p)),
    decompress: (p) => TRANSFORM_HANDLERS.delta.restore(stubCompress(p)),
    pipeline: ['delta', 'zstd']
  },
  'lzma+bcj+delta': {
    compress: (p) => stubCompress(TRANSFORM_HANDLERS.delta.transform(p)), // bcj stubbed in main
    decompress: (p) => TRANSFORM_HANDLERS.delta.restore(stubCompress(p)),
    pipeline: ['delta', 'bcj', 'lzma']
  }
  // Add more combos...
};

module.exports = { COMBO_COMPRESSION_VARIANTS };

