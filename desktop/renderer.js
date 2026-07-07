const SESSION_DEFAULTS = {
  previewLimit: 262144,
  defaultInputMode: "auto",
  defaultCompression: "auto",
  advancedAutoStrategy: "smart",
  advancedTransform: "none",
  comboCompression: "combo-none",
  allowLargeFiles: false,
  allowAllEncoders: false,
  allowUnrestrictedEstimate: false,
  showOperationLogs: false
};

const TEXT_LIKE_ENCODER_EXTENSIONS = new Set([
  ".txt", ".log", ".md", ".markdown", ".svg",
  ".json", ".jsonl", ".yaml", ".yml", ".xml", ".toml", ".ini", ".cfg", ".conf",
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py", ".rs", ".c", ".cc", ".cpp",
  ".h", ".hpp", ".java", ".cs", ".go", ".php", ".rb", ".html", ".htm", ".css"
]);
const CSV_ENCODER_EXTENSIONS = new Set([".csv", ".tsv"]);
const RAW_IMAGE_ENCODER_EXTENSIONS = new Set([".bmp", ".tga", ".ppm", ".pgm"]);
const DOCUMENT_ENCODER_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx", ".odt"]);
const WORLD_DATA_ENCODER_SUFFIXES = [
  ".mca",
  ".dat_old",
  ".dat_mcr",
  ".nbt",
  ".nbt.gz",
  ".mcstructure",
  ".map",
  ".sav",
  ".save",
  ".bin",
  ".lvl",
  ".world",
  ".chunk",
  ".region",
  ".db"
];
const COMPRESSED_MEDIA_ENCODER_EXTENSIONS = new Set([
  ".zip", ".rar", ".7z", ".gz", ".bz2", ".xz", ".png", ".jpg", ".jpeg", ".gif",
  ".webp", ".avif", ".mp3", ".aac", ".ogg", ".flac", ".mp4", ".mkv", ".webm", ".mov", ".avi"
]);
const EXECUTABLE_ENCODER_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm", ".msi", ".sys"
]);

async function saveSettings() {
  try {
    const result = await window.atlDesktop.settings.save(state.settings);
    console.log("Settings saved to:", result);
    return result;
  } catch (error) {
    console.error("Failed to save settings:", error);
    throw error;
  }
}

async function loadSettings() {
  try {
    const saved = await window.atlDesktop.settings.load();
    if (saved) {
      state.settings = {
        ...SESSION_DEFAULTS,
        ...saved,
        advancedTransform: "none"
      };
    } else {
      state.settings = { ...SESSION_DEFAULTS };
    }
  } catch (error) {
    console.warn("Failed to load settings, using defaults:", error);
    state.settings = { ...SESSION_DEFAULTS };
  }
}


const state = {
  lastEncodedOutput: null,
  lastDecodedOutput: null,
  lastEncodeLogs: [],
  lastDecodeLogs: [],
  allowLargePreview: false,
  lastInspection: null,
  settings: { ...SESSION_DEFAULTS },
  encodeStartedAt: 0,
  encodeRecommendations: null
};

function normalizeUiInputMode(value) {
  return value === "raw" ? "raw" : "auto";
}

function normalizeUiCompression(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return [
    "raw-binary",
    "auto",
    "brotli-max",
    "brotli",
    "gzip",
    "zlib",
    "none"
  ].includes(normalized)
    ? normalized
    : "auto";
}

function normalizeUiComboCompression(value) {
  return [
    "combo-none",
    "delta+rle",
    "brotli+delta",
    "zlib+rle",
    "byte-shuffle+zlib",
    "xor-delta+brotli",
    "delta+bitpack+zlib",
    "predictor-left+brotli"
  ].includes(value)
    ? value
    : "combo-none";
}

function normalizeUiAdvancedTransform(value) {
  return [
    "none",
    "auto",
    "bwt",
    "mtf",
    "bitplane",
    "bitpack",
    "byte-shuffle",
    "delta",
    "xor-delta",
    "predictor-left",
    "predictor-paeth",
    "rle"
  ].includes(value)
    ? value
    : "none";
}

function getFileExtension(filePath) {
  const normalized = String(filePath ?? "").trim().toLowerCase();
  const lastSeparator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  const fileName = lastSeparator >= 0 ? normalized.slice(lastSeparator + 1) : normalized;
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(lastDot) : "";
}

function getFileNameLower(filePath) {
  const normalized = String(filePath ?? "").trim().toLowerCase();
  const lastSeparator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return lastSeparator >= 0 ? normalized.slice(lastSeparator + 1) : normalized;
}

function hasKnownSuffix(filePath, suffixes) {
  const fileName = getFileNameLower(filePath);
  return suffixes.some((suffix) => fileName.endsWith(suffix));
}

function buildEncodeRecommendationProfile(filePath) {
  const extension = getFileExtension(filePath);

  if (!extension && !hasKnownSuffix(filePath, WORLD_DATA_ENCODER_SUFFIXES)) {
    return null;
  }

  if (TEXT_LIKE_ENCODER_EXTENSIONS.has(extension)) {
    return {
      name: "text-like",
      compression: new Set(["auto", "brotli-max", "brotli", "gzip", "zlib", "none"]),
      transforms: new Set(["none", "auto", "bwt", "mtf", "byte-shuffle", "delta", "xor-delta", "rle"]),
      combos: new Set(["combo-none", "delta+rle", "brotli+delta", "zlib+rle", "byte-shuffle+zlib", "xor-delta+brotli"])
    };
  }

  if (CSV_ENCODER_EXTENSIONS.has(extension)) {
    return {
      name: "table-data",
      compression: new Set(["auto", "brotli", "zlib", "gzip", "none"]),
      transforms: new Set(["none", "auto", "delta", "xor-delta", "bitplane", "bitpack", "byte-shuffle", "rle"]),
      combos: new Set(["combo-none", "delta+rle", "zlib+rle", "delta+bitpack+zlib", "byte-shuffle+zlib"])
    };
  }

  if (RAW_IMAGE_ENCODER_EXTENSIONS.has(extension)) {
    return {
      name: "raw-image",
      compression: new Set(["auto", "brotli", "zlib", "gzip", "none"]),
      transforms: new Set(["none", "auto", "delta", "bitplane", "byte-shuffle", "predictor-left", "predictor-paeth", "rle"]),
      combos: new Set(["combo-none", "delta+rle", "brotli+delta", "zlib+rle", "byte-shuffle+zlib", "predictor-left+brotli"])
    };
  }

  if (DOCUMENT_ENCODER_EXTENSIONS.has(extension)) {
    return {
      name: "document",
      compression: new Set(["raw-binary", "auto", "brotli", "zlib", "gzip", "none"]),
      transforms: new Set(["none", "auto"]),
      combos: new Set(["combo-none"])
    };
  }

  if (hasKnownSuffix(filePath, WORLD_DATA_ENCODER_SUFFIXES)) {
    return {
      name: "world-save-data",
      compression: new Set(["raw-binary", "auto", "brotli-max", "brotli", "zlib", "gzip", "none"]),
      transforms: new Set(["none", "auto", "delta", "xor-delta", "bitplane", "bitpack", "byte-shuffle", "rle"]),
      combos: new Set(["combo-none", "delta+rle", "brotli+delta", "zlib+rle", "byte-shuffle+zlib", "xor-delta+brotli", "delta+bitpack+zlib"])
    };
  }

  if (COMPRESSED_MEDIA_ENCODER_EXTENSIONS.has(extension)) {
    return {
      name: "compressed-media",
      compression: new Set(["raw-binary", "auto", "none", "zlib"]),
      transforms: new Set(["none"]),
      combos: new Set(["combo-none"])
    };
  }

  if (EXECUTABLE_ENCODER_EXTENSIONS.has(extension)) {
    return {
      name: "executable-binary",
      compression: new Set(["raw-binary", "auto", "brotli", "zlib", "none"]),
      transforms: new Set(["none", "auto", "delta", "xor-delta", "bitplane", "bitpack", "byte-shuffle"]),
      combos: new Set(["combo-none", "brotli+delta", "byte-shuffle+zlib", "xor-delta+brotli", "delta+bitpack+zlib"])
    };
  }

  return {
    name: "generic-binary",
    compression: new Set(["raw-binary", "auto", "brotli", "zlib", "gzip", "none"]),
    transforms: new Set(["none", "auto", "delta", "xor-delta", "rle", "bitplane", "bitpack", "byte-shuffle", "predictor-left"]),
    combos: new Set(["combo-none", "delta+rle", "brotli+delta", "zlib+rle", "byte-shuffle+zlib", "xor-delta+brotli", "delta+bitpack+zlib", "predictor-left+brotli"])
  };
}

function ensureEnabledSelectValue(select, fallbackValue) {
  if (!select) {
    return;
  }

  const selectedOption = select.selectedOptions[0];
  if (selectedOption && !selectedOption.disabled) {
    return;
  }

  const nextOption = Array.from(select.options).find((option) => !option.disabled);
  select.value = nextOption ? nextOption.value : fallbackValue;
}

function normalizeAdvancedEncodeSettings() {
  const migratedCombo = normalizeUiComboCompression(state.settings.comboCompression);
  const currentTransform = String(state.settings.advancedTransform ?? "none");

  if (migratedCombo === "combo-none" && currentTransform === "delta-rle") {
    state.settings.comboCompression = "delta+rle";
    state.settings.advancedTransform = "none";
    return;
  }

  state.settings.comboCompression = migratedCombo;
  state.settings.advancedTransform = normalizeUiAdvancedTransform(currentTransform);
}

function configureComboOptions() {
  if (!elements.comboCompression) {
    return;
  }

  const supportedOptions = new Map([
    ["combo-none", "none"],
    ["delta+rle", "delta + rle (selected compression)"],
    ["brotli+delta", "brotli + delta"],
    ["zlib+rle", "zlib + rle"],
    ["byte-shuffle+zlib", "byte-shuffle + zlib"],
    ["xor-delta+brotli", "xor-delta + brotli"],
    ["delta+bitpack+zlib", "delta + bitpack + zlib"],
    ["predictor-left+brotli", "predictor-left + brotli"]
  ]);

  for (const option of Array.from(elements.comboCompression.options)) {
    if (!supportedOptions.has(option.value)) {
      option.remove();
      continue;
    }

    option.textContent = supportedOptions.get(option.value);
  }
}

function getUiTransformComponents(transform) {
  const normalized = String(transform ?? "none");

  if (normalized === "none") {
    return [];
  }

  if (normalized === "auto" || normalized === "delta-rle") {
    return ["delta", "rle"];
  }

  return [normalized];
}

function getUiComboComponents(comboCompression) {
  const normalized = normalizeUiComboCompression(comboCompression);

  if (normalized === "combo-none") {
    return [];
  }

  if (normalized === "delta+rle") {
    return ["delta", "rle"];
  }

  if (normalized === "brotli+delta") {
    return ["delta"];
  }

  if (normalized === "zlib+rle") {
    return ["rle"];
  }

  if (normalized === "byte-shuffle+zlib") {
    return ["byte-shuffle"];
  }

  if (normalized === "xor-delta+brotli") {
    return ["xor-delta"];
  }

  if (normalized === "delta+bitpack+zlib") {
    return ["bitpack"];
  }

  if (normalized === "predictor-left+brotli") {
    return ["predictor-left"];
  }

  return [];
}

function syncComboEncodingConflicts() {
  if (!elements.comboCompression || !elements.advancedTransform) {
    return;
  }

  const transformComponents = getUiTransformComponents(elements.advancedTransform.value);
  const allowedCombos = state.encodeRecommendations?.combos ?? null;

  for (const option of Array.from(elements.comboCompression.options)) {
    const blockedByProfile = allowedCombos ? !allowedCombos.has(option.value) : false;
    const overlap = getUiComboComponents(option.value).some((component) =>
      transformComponents.includes(component)
    );
    option.disabled = blockedByProfile || overlap;
  }

  ensureEnabledSelectValue(elements.comboCompression, "combo-none");
}

function applyEncodeRecommendations() {
  state.encodeRecommendations =
    state.settings.allowAllEncoders === true
      ? null
      : buildEncodeRecommendationProfile(elements.encodeInputPath?.value);

  const allowedCompression = state.encodeRecommendations?.compression ?? null;
  const inputModeIsRaw = normalizeUiInputMode(elements.encodeInputMode?.value) === "raw";
  const selectedCompression = normalizeUiCompression(elements.encodeCompression?.value);
  const forceRawMode = selectedCompression === "raw-binary";
  const allowedTransforms = forceRawMode
    ? new Set(["none"])
    : state.encodeRecommendations?.transforms ?? null;

  if (elements.encodeCompression) {
    for (const option of Array.from(elements.encodeCompression.options)) {
      const blockedByProfile = allowedCompression ? !allowedCompression.has(option.value) : false;
      const blockedByInputMode = inputModeIsRaw && option.value === "raw-binary";
      option.disabled = blockedByProfile || blockedByInputMode;
    }
    ensureEnabledSelectValue(elements.encodeCompression, "auto");
  }

  if (elements.advancedTransform) {
    for (const option of Array.from(elements.advancedTransform.options)) {
      option.disabled = allowedTransforms ? !allowedTransforms.has(option.value) : false;
    }
    ensureEnabledSelectValue(elements.advancedTransform, "none");
  }

  syncComboEncodingConflicts();
}

const elements = {
  statusBar: document.querySelector("#status-bar"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  encodeInputPath: document.querySelector("#encode-input-path"),
  encodeOutputPath: document.querySelector("#encode-output-path"),
  encodeMetadataPath: document.querySelector("#encode-metadata-path"),
  encodeInputMode: document.querySelector("#encode-input-mode"),
  encodeCompression: document.querySelector("#encode-compression"),
  encodeWidth: document.querySelector("#encode-width"),
  encodeHeight: document.querySelector("#encode-height"),
  encodeSubmit: document.querySelector("#encode-submit"),
  encodePreflight: document.querySelector("#encode-preflight"),
  encodeResult: document.querySelector("#encode-result"),
  encodeLog: document.querySelector("#encode-log"),
  encodeReveal: document.querySelector("#encode-reveal"),
  encodeCancel: document.querySelector("#encode-cancel"),
  encodeAdvancedToggle: document.querySelector("#encode-advanced-toggle"),
  encodeHelp: document.querySelector("#encode-help"),
  advancedEncodePanel: document.querySelector("#advanced-encode-panel"),
  encodeStatusAction: document.querySelector("#encode-status-action"),
  encodeStatusElapsed: document.querySelector("#encode-status-elapsed"),
  encodeStatusRemaining: document.querySelector("#encode-status-remaining"),
  encodeStatusRatio: document.querySelector("#encode-status-ratio"),
  encodeStatusPercent: document.querySelector("#encode-status-percent"),
  encodeProgressPrimary: document.querySelector("#encode-progress-primary"),
  encodeProgressSecondary: document.querySelector("#encode-progress-secondary"),
  decodeInputPath: document.querySelector("#decode-input-path"),
  decodeOutputPath: document.querySelector("#decode-output-path"),
  decodeSubmit: document.querySelector("#decode-submit"),
  decodeResult: document.querySelector("#decode-result"),
  decodeLog: document.querySelector("#decode-log"),
  decodeReveal: document.querySelector("#decode-reveal"),
  inspectInputPath: document.querySelector("#inspect-input-path"),
  inspectSubmit: document.querySelector("#inspect-submit"),
  inspectExportImage: document.querySelector("#inspect-export-image"),
  inspectExportFormat: document.querySelector("#inspect-export-format"),
  inspectExportSize: document.querySelector("#inspect-export-size"),
  inspectExportQuality: document.querySelector("#inspect-export-quality"),
  inspectEmpty: document.querySelector("#inspect-empty"),
  inspectResults: document.querySelector("#inspect-results"),
  inspectChecksum: document.querySelector("#inspect-checksum"),
  inspectPixels: document.querySelector("#inspect-pixels"),
  inspectEncodedSize: document.querySelector("#inspect-encoded-size"),
  inspectMetadata: document.querySelector("#inspect-metadata"),
  inspectGeometry: document.querySelector("#inspect-geometry"),
  inspectFileInfo: document.querySelector("#inspect-file-info"),
  inspectEncodingInfo: document.querySelector("#inspect-encoding-info"),
  inspectSampleNote: document.querySelector("#inspect-sample-note"),
  inspectHexView: document.querySelector("#inspect-hex-view"),
  inspectAsciiView: document.querySelector("#inspect-ascii-view"),
  inspectIntegerView: document.querySelector("#inspect-integer-view"),
  inspectFloatView: document.querySelector("#inspect-float-view"),
  inspectStringsView: document.querySelector("#inspect-strings-view"),
  inspectStatsView: document.querySelector("#inspect-stats-view"),
  inspectSubtabs: Array.from(document.querySelectorAll(".inspect-subtab")),
  inspectViewPanels: Array.from(document.querySelectorAll(".inspect-view-panel")),
  previewOverridePanel: document.querySelector("#preview-override-panel"),
  previewOverrideToggle: document.querySelector("#preview-override-toggle"),
  previewOverrideText: document.querySelector("#preview-override-text"),
  previewCanvas: document.querySelector("#preview-canvas"),
  previewMessage: document.querySelector("#preview-message"),
  inspectExportInfo: document.querySelector("#inspect-export-info"),
  inspectExportFormatValue: document.querySelector("#inspect-export-format-value"),
  inspectExportDimensions: document.querySelector("#inspect-export-dimensions"),
  inspectExportBytes: document.querySelector("#inspect-export-bytes"),
  advancedAutoStrategy: document.querySelector("#advanced-auto-strategy"),
  advancedTransform: document.querySelector("#advanced-transform"),
  comboCompression: document.querySelector("#combo-compression"),
  settingsDefaultInputMode: document.querySelector("#settings-default-input-mode"),
  settingsDefaultCompression: document.querySelector("#settings-default-compression"),
  settingsPreviewLimit: document.querySelector("#settings-preview-limit"),
  settingsAllowLargeFiles: document.querySelector("#settings-allow-large-files"),
  settingsAllowAllEncoders: document.querySelector("#settings-allow-all-encoders"),
  settingsAllowUnrestrictedEstimate: document.querySelector("#settings-allow-unrestricted-estimate"),
  settingsShowOperationLogs: document.querySelector("#settings-show-operation-logs"),
  settingsApply: document.querySelector("#settings-apply"),
  settingsReset: document.querySelector("#settings-reset"),
  settingsResult: document.querySelector("#settings-result"),
  freezeOverlay: document.querySelector("#freeze-overlay"),
  freezeOverlayDetail: document.querySelector("#freeze-overlay-detail")
};

function activateTab(tabName) {
  for (const button of elements.tabButtons) {
    button.classList.toggle("is-active", button.dataset.tabTarget === tabName);
  }

  for (const panel of elements.tabPanels) {
    panel.classList.toggle("is-active", panel.dataset.tabPanel === tabName);
  }
}

function setStatus(message, tone = "idle") {
  elements.statusBar.textContent = message;
  elements.statusBar.className = `status-bar ${tone}`;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function setFreezeOverlay(visible, detail) {
  elements.freezeOverlay.classList.toggle("hidden", !visible);
  elements.freezeOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
  elements.freezeOverlayDetail.textContent =
    detail ?? "Large file processing is running. Wait for the operation to finish.";
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

async function withFreezeOverlay(detail, work) {
  setFreezeOverlay(true, detail);
  await waitForNextPaint();

  try {
    return await work();
  } finally {
    setFreezeOverlay(false);
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceExtension(filePath, extension) {
  if (!filePath) {
    return "";
  }

  if (!/[.][^./\\]+$/.test(filePath)) {
    return `${filePath}${extension}`;
  }

  return filePath.replace(/[.][^./\\]+$/, extension);
}

function getExportFormatConfig(format) {
  const normalized = String(format).trim().toLowerCase();

  if (normalized === "png") {
    return {
      label: "PNG",
      extension: ".png",
      mimeType: "image/png",
      qualitySupported: false
    };
  }

  if (normalized === "jpeg" || normalized === "jpg") {
    return {
      label: "JPEG",
      extension: ".jpg",
      mimeType: "image/jpeg",
      qualitySupported: true
    };
  }

  return {
    label: "WEBP",
    extension: ".webp",
    mimeType: "image/webp",
    qualitySupported: true
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;

  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSignedBytesDelta(bytes) {
  const absolute = Math.abs(bytes);
  const direction = bytes < 0 ? "-" : "+";
  return `${direction}${formatBytes(absolute)} (${direction}${absolute.toLocaleString()} bytes)`;
}

function shortenMiddle(text, maxLength = 32) {
  const value = String(text ?? "");
  if (value.length <= maxLength) {
    return value;
  }

  const head = Math.max(8, Math.floor((maxLength - 1) / 2));
  const tail = Math.max(8, maxLength - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function getDataUrlByteLength(dataUrl) {
  const match = /^data:[^;]+;base64,(.*)$/.exec(String(dataUrl));

  if (!match) {
    return 0;
  }

  const base64 = match[1];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function getPathDirectory(filePath) {
  const separatorIndex = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return separatorIndex >= 0 ? filePath.slice(0, separatorIndex + 1) : "";
}

function joinPath(directory, fileName) {
  if (!directory) {
    return fileName;
  }

  if (directory.endsWith("\\") || directory.endsWith("/")) {
    return `${directory}${fileName}`;
  }

  return `${directory}\\${fileName}`;
}

function fillIfEmpty(input, value) {
  if (!input.value.trim()) {
    input.value = value;
  }
}

function renderResult(element, lines) {
  element.innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  element.classList.remove("hidden");
}

function hideResult(element) {
  element.innerHTML = "";
  element.classList.add("hidden");
}

function setEncodeProgress(primaryPercent, secondaryPercent) {
  elements.encodeProgressPrimary.style.width = `${Math.max(0, Math.min(100, primaryPercent))}%`;
  elements.encodeProgressSecondary.style.width = `${Math.max(0, Math.min(100, secondaryPercent))}%`;
}

function setEncodeStatusFields({
  action = "Idle",
  elapsed = "0.0s",
  remaining = "-",
  ratio = "-",
  percent = "0%"
} = {}) {
  elements.encodeStatusAction.textContent = action;
  elements.encodeStatusElapsed.textContent = elapsed;
  elements.encodeStatusRemaining.textContent = remaining;
  elements.encodeStatusRatio.textContent = ratio;
  elements.encodeStatusPercent.textContent = percent;
}

function syncOperationLogCards() {
  if (state.lastEncodeLogs.length > 0) {
    renderResult(elements.encodeLog, ["Encode Log", ...state.lastEncodeLogs]);
    if (!state.settings.showOperationLogs) {
      hideResult(elements.encodeLog);
    }
  } else {
    hideResult(elements.encodeLog);
  }

  if (state.lastDecodeLogs.length > 0) {
    renderResult(elements.decodeLog, ["Decode Log", ...state.lastDecodeLogs]);
    if (!state.settings.showOperationLogs) {
      hideResult(elements.decodeLog);
    }
  } else {
    hideResult(elements.decodeLog);
  }
}

function hideInspectExportInfo() {
  elements.inspectExportInfo.classList.add("hidden");
  elements.inspectExportFormatValue.textContent = "-";
  elements.inspectExportDimensions.textContent = "-";
  elements.inspectExportBytes.textContent = "-";
}

function formatHexRows(buffer, rowBytes = 16) {
  const rows = [];
  const headerBytes = Array.from({ length: rowBytes }, (_, index) =>
    index.toString(16).padStart(2, "0").toUpperCase()
  );
  rows.push(`OFFSET  ${headerBytes.slice(0, 8).join(" ")}  ${headerBytes.slice(8).join(" ")}  ASCII`);
  rows.push("");

  for (let offset = 0; offset < buffer.length; offset += rowBytes) {
    const chunk = buffer.subarray(offset, offset + rowBytes);
    const byteStrings = Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0").toUpperCase());
    const left = byteStrings.slice(0, 8).join(" ");
    const right = byteStrings.slice(8).join(" ");
    const hex = `${left.padEnd(8 * 3 - 1)}  ${right.padEnd(8 * 3 - 1)}`;
    const ascii = Array.from(chunk, (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".")).join("");
    rows.push(`${offset.toString(16).padStart(6, "0").toUpperCase()}  ${hex}  ${ascii}`);
  }

  return rows.join("\n");
}

function renderKeyValueGrid(element, entries) {
  element.innerHTML = entries
    .map(([label, value]) => {
      const normalized = typeof value === "object" && value !== null
        ? value
        : { text: value, title: value };
      return `<div title="${escapeHtml(normalized.title ?? normalized.text ?? "")}">${escapeHtml(label)}: <strong>${escapeHtml(normalized.text ?? "")}</strong></div>`;
    })
    .join("");
}

function renderInspectDetails(info) {
  const inspector = info.inspector;
  if (!inspector) {
    return;
  }

  renderKeyValueGrid(elements.inspectFileInfo, [
    ["File", { text: shortenMiddle(inspector.fileInfo.fileName, 28), title: inspector.fileInfo.fileName }],
    ["Original Size", `${formatBytes(inspector.fileInfo.originalSize)} (${inspector.fileInfo.originalSize.toLocaleString()} bytes)`],
    ["Encoded Size", `${formatBytes(inspector.fileInfo.encodedSize)} (${inspector.fileInfo.encodedSize.toLocaleString()} bytes)`],
    ["Size Diff", formatSignedBytesDelta(inspector.fileInfo.encodedSize - inspector.fileInfo.originalSize)],
    ["Compression", inspector.fileInfo.compression],
    ["Transform", inspector.fileInfo.transform],
    ["Storage Mode", inspector.fileInfo.storageMode],
    ["Entropy", `${Number(inspector.fileInfo.entropy ?? 0).toFixed(2)} / 8.00`]
  ]);

  renderKeyValueGrid(elements.inspectEncodingInfo, [
    ["Pipeline", inspector.encoding.pipeline.join(" -> ")],
    ["Payload Size", `${inspector.encoding.payloadSizeBeforePadding.toLocaleString()} bytes`],
    ["Padding Added", `${inspector.encoding.paddingAdded.toLocaleString()} bytes`],
    ["Checksum", inspector.encoding.checksumValid ? `${inspector.encoding.checksum} (OK)` : `${inspector.encoding.checksum} (BAD)`]
  ]);

  const sampleBuffer = decodeBase64ToBytes(inspector.sample.base64);
  elements.inspectSampleNote.textContent = inspector.sample.truncated
    ? `Showing first ${inspector.sample.sampledBytes.toLocaleString()} of ${inspector.sample.totalBytes.toLocaleString()} decoded bytes.`
    : `Showing ${inspector.sample.totalBytes.toLocaleString()} decoded bytes.`;
  elements.inspectHexView.textContent = formatHexRows(sampleBuffer);
  elements.inspectAsciiView.textContent = inspector.interpreted.ascii || "(no printable ASCII in sample)";
  elements.inspectIntegerView.textContent =
    inspector.interpreted.integers.length > 0 ? inspector.interpreted.integers.join("\n") : "(no 32-bit integers)";
  elements.inspectFloatView.textContent =
    inspector.interpreted.floats.length > 0 ? inspector.interpreted.floats.join("\n") : "(no 32-bit floats)";
  elements.inspectStringsView.textContent =
    inspector.interpreted.strings.length > 0 ? inspector.interpreted.strings.map((value) => `"${value}"`).join("\n") : "(no printable strings)";
  elements.inspectStatsView.textContent = [
    `Entropy: ${Number(inspector.stats.entropy ?? 0).toFixed(2)} / 8.00`,
    `Repeating sequences: ${inspector.stats.repeatingSequences ?? 0}`,
    `Longest run: ${inspector.stats.longestRun ?? 0} bytes`,
    "",
    "Top byte distribution:",
    ...inspector.stats.topBytes.map(
      (entry) => `0x${entry.byte.toString(16).padStart(2, "0").toUpperCase()}: ${entry.count.toLocaleString()} (${entry.percent.toFixed(2)}%)`
    )
  ].join("\n");
}

function activateInspectView(viewName) {
  for (const button of elements.inspectSubtabs) {
    button.classList.toggle("is-active", button.dataset.inspectView === viewName);
  }

  for (const panel of elements.inspectViewPanels) {
    panel.classList.toggle("is-active", panel.id === `inspect-view-${viewName}`);
  }
}

function showInspectExportInfo(formatLabel, width, height, bytesWritten) {
  elements.inspectExportFormatValue.textContent = formatLabel;
  elements.inspectExportDimensions.textContent = `${width} x ${height}`;
  elements.inspectExportBytes.textContent = `${formatBytes(bytesWritten)} (${bytesWritten.toLocaleString()} bytes)`;
  elements.inspectExportInfo.classList.remove("hidden");
  elements.inspectExportInfo.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function updateInspectExportQualityState() {
  const formatConfig = getExportFormatConfig(elements.inspectExportFormat.value);
  elements.inspectExportQuality.disabled = !formatConfig.qualitySupported;
}

function loadSettingsIntoPanel() {
  normalizeAdvancedEncodeSettings();
  state.settings.defaultInputMode = normalizeUiInputMode(state.settings.defaultInputMode);
  state.settings.defaultCompression = normalizeUiCompression(state.settings.defaultCompression);
  elements.settingsDefaultInputMode.value = state.settings.defaultInputMode;
  elements.settingsDefaultCompression.value = state.settings.defaultCompression;
  elements.settingsPreviewLimit.value = String(state.settings.previewLimit);
  elements.settingsAllowLargeFiles.checked = state.settings.allowLargeFiles;
  elements.settingsAllowAllEncoders.checked = state.settings.allowAllEncoders;
  elements.settingsAllowUnrestrictedEstimate.checked = state.settings.allowUnrestrictedEstimate;
  elements.settingsShowOperationLogs.checked = state.settings.showOperationLogs;
}

function applySettingsToEncodeForm() {
  normalizeAdvancedEncodeSettings();
  state.settings.defaultInputMode = normalizeUiInputMode(state.settings.defaultInputMode);
  state.settings.defaultCompression = normalizeUiCompression(state.settings.defaultCompression);
  elements.encodeInputMode.value = state.settings.defaultInputMode;
  elements.encodeCompression.value = state.settings.defaultCompression;
  elements.advancedAutoStrategy.value = state.settings.advancedAutoStrategy;
  elements.advancedTransform.value = state.settings.advancedTransform;
  if (elements.comboCompression) elements.comboCompression.value = state.settings.comboCompression;
  applyEncodeRecommendations();
}

function syncEncodeOutputSuggestion() {
  fillIfEmpty(
    elements.encodeOutputPath,
    replaceExtension(elements.encodeInputPath.value.trim(), ".atl")
  );
}

function decodeBase64ToBytes(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8ClampedArray(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function buildDisplayPixels(rgbPixels) {
  if (rgbPixels.length === 0) {
    return { pixels: rgbPixels, boosted: false };
  }

  let min = 255;
  let max = 0;

  for (const value of rgbPixels) {
    if (value < min) {
      min = value;
    }

    if (value > max) {
      max = value;
    }
  }

  const range = max - min;

  if (range >= 96) {
    return { pixels: rgbPixels, boosted: false };
  }

  if (range === 0) {
    return {
      pixels: Uint8ClampedArray.from(rgbPixels, () => 128),
      boosted: true
    };
  }

  return {
    pixels: Uint8ClampedArray.from(
      rgbPixels,
      (value) => Math.round(((value - min) * 255) / range)
    ),
    boosted: true
  };
}

function clearPreview(message = "No preview available for this file.") {
  const canvas = elements.previewCanvas;
  const context = canvas.getContext("2d");
  canvas.width = 1;
  canvas.height = 1;
  canvas.style.opacity = "0";
  context.clearRect(0, 0, 1, 1);
  elements.previewMessage.textContent = message;
}

function hidePreviewOverride() {
  elements.previewOverridePanel.classList.add("hidden");
  elements.previewOverrideText.textContent = "";
}

function syncPreviewOverride(fileIsOverLimit) {
  if (!fileIsOverLimit) {
    state.allowLargePreview = false;
    elements.previewOverrideToggle.checked = false;
    hidePreviewOverride();
    return;
  }

  elements.previewOverridePanel.classList.remove("hidden");
  elements.previewOverrideToggle.checked = state.allowLargePreview;
  elements.previewOverrideText.textContent = state.allowLargePreview
    ? "Large preview override is enabled for this inspection."
    : `Preview is disabled by default for files over ${state.settings.previewLimit.toLocaleString()} pixels.`;
}

function resetPreviewOverride() {
  state.allowLargePreview = false;
  elements.previewOverrideToggle.checked = false;
  hidePreviewOverride();
}

function renderPreviewToCanvas(canvas, preview, pixelCount) {
  const context = canvas.getContext("2d");
  const pixels = decodeBase64ToBytes(preview.pixelsBase64);
  const displayPixels = buildDisplayPixels(pixels);
  const rgba = new Uint8ClampedArray(preview.width * preview.height * 4);

  for (let source = 0, target = 0; source < displayPixels.pixels.length; source += 3, target += 4) {
    rgba[target] = displayPixels.pixels[source];
    rgba[target + 1] = displayPixels.pixels[source + 1];
    rgba[target + 2] = displayPixels.pixels[source + 2];
    rgba[target + 3] = 255;
  }

  canvas.width = preview.width;
  canvas.height = preview.height;
  context.putImageData(new ImageData(rgba, preview.width, preview.height), 0, 0);

  return {
    width: preview.width,
    height: preview.height,
    boosted: displayPixels.boosted,
    baseMessage: preview.reflowed
      ? `${preview.width} x ${preview.height} box preview reflowed from stored ${preview.sourceWidth} x ${preview.sourceHeight}.`
      : `${preview.width} x ${preview.height} pixels rendered from ${pixelCount.toLocaleString()} RGB entries.`
  };
}

function resolveExportDimensions(width, height, sizeMode) {
  const normalized = String(sizeMode).trim().toLowerCase();

  if (normalized === "visible") {
    const rect = elements.previewCanvas.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    };
  }

  if (normalized === "native") {
    return { width, height };
  }

  const maxDimension = Number.parseInt(normalized, 10);

  if (!Number.isInteger(maxDimension) || maxDimension <= 0) {
    return { width, height };
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function createExportCanvas(sourceCanvas, sizeMode) {
  const target = resolveExportDimensions(sourceCanvas.width, sourceCanvas.height, sizeMode);

  if (target.width === sourceCanvas.width && target.height === sourceCanvas.height) {
    return {
      canvas: sourceCanvas,
      width: sourceCanvas.width,
      height: sourceCanvas.height
    };
  }

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = target.width;
  scaledCanvas.height = target.height;
  const context = scaledCanvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, target.width, target.height);

  return {
    canvas: scaledCanvas,
    width: target.width,
    height: target.height
  };
}

function drawPreview(preview, pixelCount) {
  if (!preview || preview.omitted) {
    clearPreview(preview?.reason ?? "No preview available for this file.");
    return;
  }

  const renderedPreview = renderPreviewToCanvas(elements.previewCanvas, preview, pixelCount);
  elements.previewCanvas.style.opacity = "1";
  elements.previewMessage.textContent = renderedPreview.boosted
    ? `${renderedPreview.baseMessage} Contrast boost enabled.`
    : renderedPreview.baseMessage;
}

async function chooseBinaryInput(target) {
  const filePath = await window.atlDesktop.pickBinaryInput();

  if (filePath) {
    target.value = filePath;
  }
}

async function chooseAtlInput(target) {
  const filePath = await window.atlDesktop.pickAtlInput();

  if (filePath) {
    target.value = filePath;
  }
}

async function chooseMetadataInput() {
  const filePath = await window.atlDesktop.pickMetadataFile();

  if (filePath) {
    elements.encodeMetadataPath.value = filePath;
  }
}

async function chooseEncodeOutput() {
  const suggestion =
    replaceExtension(elements.encodeInputPath.value.trim(), ".atl") || "output.atl";
  const filePath = await window.atlDesktop.pickAtlOutput(suggestion);

  if (filePath) {
    elements.encodeOutputPath.value = filePath;
  }
}

async function getDecodeOutputSuggestion() {
  const inputPath = elements.decodeInputPath.value.trim();

  if (!inputPath) {
    return "decoded.bin";
  }

  try {
    const info = await window.atlDesktop.inspect({
      inputPath,
      preview: false,
      allowLargeFiles: state.settings.allowLargeFiles
    });

    if (info.metadata.original_file_name) {
      return joinPath(getPathDirectory(inputPath), info.metadata.original_file_name);
    }
  } catch {
    return replaceExtension(inputPath, ".bin");
  }

  return replaceExtension(inputPath, ".bin");
}

async function syncDecodeOutputSuggestion(force = false) {
  if (!force && elements.decodeOutputPath.value.trim()) {
    return;
  }

  elements.decodeOutputPath.value = await getDecodeOutputSuggestion();
}

async function chooseDecodeOutput() {
  const suggestion = (await getDecodeOutputSuggestion()) || "decoded.bin";
  const filePath = await window.atlDesktop.pickBinaryOutput(suggestion);

  if (filePath) {
    elements.decodeOutputPath.value = filePath;
  }
}

async function runEncode() {
  setBusy(elements.encodeSubmit, true, "Encoding...");
  state.encodeStartedAt = Date.now();
  setEncodeStatusFields({
    action: "Encoding source file",
    elapsed: "0.0s",
    remaining: "Estimating...",
    ratio: "-",
    percent: "5%"
  });
  setEncodeProgress(8, 0);
  setStatus("Encoding source file into ANTC pixels...", "busy");

  try {
    const selectedCompression = normalizeUiCompression(elements.encodeCompression.value);
    const encodeInputMode =
      selectedCompression === "raw-binary"
        ? "raw"
        : normalizeUiInputMode(elements.encodeInputMode.value);
    const encodeCompression = selectedCompression === "raw-binary" ? "none" : selectedCompression;
    const result = await withFreezeOverlay(
      "Application is frozen while encode runs. Large files can pause the window until the write finishes.",
      () =>
        window.atlDesktop.encode({
          inputPath: elements.encodeInputPath.value.trim(),
          outputPath: elements.encodeOutputPath.value.trim(),
          compression: encodeCompression,
          comboCompression: elements.comboCompression ? elements.comboCompression.value : 'combo-none',
          autoCompressionStrategy: elements.advancedAutoStrategy.value,
          experimentalTransform: elements.advancedTransform.value,
          inputMode: encodeInputMode,
          width: elements.encodeWidth.value.trim(),
          height: elements.encodeHeight.value.trim(),
          metadataPath: elements.encodeMetadataPath.value.trim(),
          allowLargeFiles: state.settings.allowLargeFiles
        })
    );

    state.lastEncodedOutput = result.outputPath;
    state.lastEncodeLogs = Array.isArray(result.logs) ? result.logs : [];
    elements.encodeReveal.disabled = false;
    const requestedCompression =
      result.info.metadata.compression_requested ?? result.info.metadata.compression;
    const compressionVariant =
      result.info.metadata.compression_variant ?? result.info.metadata.compression;
    const requestedTransform =
      result.info.metadata.experimental_transform_requested ??
      result.info.metadata.experimental_transform ??
      "none";
    const sourceSize = result.info.metadata.source_size ?? result.info.metadata.original_size;
    const elapsedSeconds = ((Date.now() - state.encodeStartedAt) / 1000).toFixed(1);
    const atlSizeDelta = result.atlSize - sourceSize;
    const atlSizePercent = sourceSize === 0 ? 0 : (atlSizeDelta / sourceSize) * 100;
    const ratioValue = sourceSize > 0 ? `${(sourceSize / Math.max(result.atlSize, 1)).toFixed(2)}x` : "-";
    renderResult(elements.encodeResult, [
      result.summary,
      `Output: ${result.outputPath}`,
      `Pixels: ${result.info.pixel_count.toLocaleString()}`,
      `Checksum: ${result.info.checksum}`,
      `Storage mode: ${result.info.metadata.storage_mode ?? "color_rgb"} / ${result.info.metadata.storage_encoding ?? "interleaved"}`,
      selectedCompression === "raw-binary"
        ? "Compression: raw binary to ATL"
        : `Compression: ${result.info.metadata.compression} / ${compressionVariant} (requested: ${requestedCompression})`,
      `Combo encode: ${result.info.metadata.combo_compression ?? "combo-none"} (requested: ${result.info.metadata.combo_compression_requested ?? "combo-none"})`,
      `Detected file kind: ${result.info.metadata.detected_file_kind ?? "unknown"}`,
      `Auto strategy: ${result.info.metadata.auto_compression_strategy ?? "smart"} / used profile: ${result.info.metadata.auto_compression_profile ?? "n/a"} / detected: ${result.info.metadata.detected_auto_compression_profile ?? "n/a"}`,
      `Solo encoding: ${result.info.metadata.experimental_transform ?? "none"} (requested: ${requestedTransform})`,
      `Input mode: ${result.info.metadata.input_mode}`,
      `Payload bytes: ${result.info.encoded_size.toLocaleString()} from ${sourceSize.toLocaleString()}`,
      `ATL size change: ${formatSignedBytesDelta(atlSizeDelta)} (${atlSizePercent.toFixed(2)}%)`,
      `Source size: ${sourceSize.toLocaleString()}`
    ]);
    setEncodeStatusFields({
      action: "Completed",
      elapsed: `${elapsedSeconds}s`,
      remaining: "0.0s",
      ratio: ratioValue,
      percent: "100%"
    });
    setEncodeProgress(100, 100);
    syncOperationLogCards();
    setStatus(
      `Encoded ${result.info.pixel_count.toLocaleString()} pixels to ${result.outputPath}.`,
      "success"
    );
  } catch (error) {
    state.lastEncodeLogs = [`Error: ${error.message}`];
    renderResult(elements.encodeResult, [`Error: ${error.message}`]);
    setEncodeStatusFields({
      action: "Failed",
      elapsed: `${((Date.now() - state.encodeStartedAt) / 1000).toFixed(1)}s`,
      remaining: "-",
      ratio: "-",
      percent: "0%"
    });
    setEncodeProgress(0, 0);
    syncOperationLogCards();
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.encodeSubmit, false, "Encoding...");
  }
}

async function runEncodePreflight() {
  setBusy(elements.encodePreflight, true, "Estimating...");
  setStatus("Sampling input file and estimating the best ATL pipeline...", "busy");

  try {
    const selectedCompression = normalizeUiCompression(elements.encodeCompression.value);
    const encodeInputMode =
      selectedCompression === "raw-binary"
        ? "raw"
        : normalizeUiInputMode(elements.encodeInputMode.value);
    const encodeCompression = selectedCompression === "raw-binary" ? "none" : selectedCompression;

    const useRestrictedEstimate = state.settings.allowUnrestrictedEstimate !== true;
    const allowedCompressionCandidates =
      useRestrictedEstimate && state.encodeRecommendations?.compression
        ? Array.from(state.encodeRecommendations.compression).filter((value) => value !== "raw-binary")
        : undefined;
    const allowedTransformCandidates =
      useRestrictedEstimate && state.encodeRecommendations?.transforms
        ? Array.from(state.encodeRecommendations.transforms)
        : undefined;

    const result = await window.atlDesktop.preflight({
      inputPath: elements.encodeInputPath.value.trim(),
      compression: encodeCompression,
      comboCompression: elements.comboCompression ? elements.comboCompression.value : "combo-none",
      autoCompressionStrategy: elements.advancedAutoStrategy.value,
      experimentalTransform: elements.advancedTransform.value,
      inputMode: encodeInputMode,
      allowedCompressionCandidates,
      allowedTransformCandidates,
      width: elements.encodeWidth.value.trim(),
      height: elements.encodeHeight.value.trim(),
      metadataPath: elements.encodeMetadataPath.value.trim()
    });

    renderResult(elements.encodeResult, [
      "Preflight Estimate",
      `Original Size: ${formatBytes(result.originalSize)} (${result.originalSize.toLocaleString()} bytes)`,
      `Sampled: ${formatBytes(result.sampledBytes)} (${result.sampledBytes.toLocaleString()} bytes, ${(result.sampleFraction * 100).toFixed(1)}%)`,
      `Estimated Size: ${formatBytes(result.estimatedSize)} (${result.estimatedSize.toLocaleString()} bytes)`,
      `Estimated Ratio: ${(result.estimatedRatio * 100).toFixed(2)}%`,
      `Best Method: ${result.bestPipeline.join(" + ") || "none"}`,
      `Confidence: ${result.confidence} (±5-10%)`,
      `Overhead Estimate: metadata ${result.overheadEstimate.metadataBytes.toLocaleString()} bytes, padding ${result.overheadEstimate.paddingBytes.toLocaleString()} bytes`
    ]);
    setStatus("Preflight estimate ready.", "success");
  } catch (error) {
    renderResult(elements.encodeResult, [`Error: ${error.message}`]);
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.encodePreflight, false, "Estimating...");
  }
}

async function runDecode() {
  setBusy(elements.decodeSubmit, true, "Decoding...");
  setStatus("Validating ATL file and restoring the original file...", "busy");

  try {
    const result = await withFreezeOverlay(
      "Application is frozen while decode runs. Large files can pause the window until the restore finishes.",
      () =>
        window.atlDesktop.decode({
          inputPath: elements.decodeInputPath.value.trim(),
          outputPath: elements.decodeOutputPath.value.trim(),
          allowLargeFiles: state.settings.allowLargeFiles
        })
    );

    state.lastDecodedOutput = result.outputPath;
    state.lastDecodeLogs = Array.isArray(result.logs) ? result.logs : [];
    elements.decodeReveal.disabled = false;
    renderResult(elements.decodeResult, [
      result.summary,
      `Output: ${result.outputPath}`,
      `Bytes written: ${result.bytesWritten.toLocaleString()}`,
      `Checksum: ${result.checksum}`,
      `Compression: ${result.metadata.compression ?? "none"}`,
      `Original file: ${result.metadata.original_file_name ?? "unknown"}`
    ]);
    syncOperationLogCards();
    setStatus(`Decoded ${result.bytesWritten.toLocaleString()} bytes to ${result.outputPath}.`, "success");
  } catch (error) {
    state.lastDecodeLogs = [`Error: ${error.message}`];
    renderResult(elements.decodeResult, [`Error: ${error.message}`]);
    syncOperationLogCards();
    setStatus(error.message, "error");
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.decodeSubmit, false, "Decoding...");
  }
}

async function runInspect() {
  setBusy(elements.inspectSubmit, true, "Inspecting...");
  setStatus("Reading ATL header, metadata, payload, and checksum...", "busy");
  hideInspectExportInfo();

  try {
    const info = await withFreezeOverlay(
      "Application is frozen while inspect runs. Large ATL files can pause the window until the read finishes.",
      () =>
        window.atlDesktop.inspect({
          inputPath: elements.inspectInputPath.value.trim(),
          maxPreviewPixels: state.allowLargePreview
            ? Number.MAX_SAFE_INTEGER
            : state.settings.previewLimit,
          allowLargeFiles: state.settings.allowLargeFiles
        })
    );
    const fileIsOverLimit = info.pixel_count > state.settings.previewLimit;

    state.lastInspection = info;
    elements.inspectEmpty.classList.add("hidden");
    elements.inspectResults.classList.remove("hidden");
    elements.inspectExportImage.disabled = false;
    elements.inspectChecksum.textContent = info.checksum;
    elements.inspectPixels.textContent = info.pixel_count.toLocaleString();
    elements.inspectEncodedSize.textContent = info.encoded_size.toLocaleString();
    elements.inspectGeometry.textContent = `${info.metadata.width} x ${info.metadata.height} | ${info.pixel_data_length.toLocaleString()} bytes`;
    elements.inspectMetadata.textContent = JSON.stringify(info.metadata, null, 2);
    renderInspectDetails(info);
    syncPreviewOverride(fileIsOverLimit);
    drawPreview(info.preview, info.pixel_count);
    setStatus(`Inspected ${info.inputPath}.`, "success");
  } catch (error) {
    state.lastInspection = null;
    elements.inspectEmpty.classList.remove("hidden");
    elements.inspectResults.classList.add("hidden");
    setStatus(error.message, "error");
    elements.inspectExportImage.disabled = true;
    resetPreviewOverride();
    hideInspectExportInfo();
    clearPreview();
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.inspectSubmit, false, "Inspecting...");
  }
}

async function runExportInspectImage() {
  setBusy(elements.inspectExportImage, true, "Saving Image...");
  setStatus("Preparing an export image from the current inspection preview...", "busy");

  try {
    if (!state.lastInspection?.inputPath) {
      throw new Error("Inspect a file before saving a PNG preview.");
    }

    let exportInfo = state.lastInspection;

    if (!exportInfo.preview || exportInfo.preview.omitted) {
      exportInfo = await withFreezeOverlay(
        "Application is frozen while the full preview is prepared for export.",
        () =>
          window.atlDesktop.inspect({
            inputPath: exportInfo.inputPath,
            maxPreviewPixels: Number.MAX_SAFE_INTEGER,
            allowLargeFiles: state.settings.allowLargeFiles
          })
      );
    }

    if (!exportInfo.preview || exportInfo.preview.omitted) {
      throw new Error("Preview data is not available for PNG export.");
    }

    const exportCanvas = document.createElement("canvas");
    renderPreviewToCanvas(exportCanvas, exportInfo.preview, exportInfo.pixel_count);
    const formatConfig = getExportFormatConfig(elements.inspectExportFormat.value);
    const preparedExport = createExportCanvas(exportCanvas, elements.inspectExportSize.value);
    const quality = formatConfig.qualitySupported
      ? Number.parseFloat(elements.inspectExportQuality.value)
      : undefined;
    const dataUrl = preparedExport.canvas.toDataURL(formatConfig.mimeType, quality);
    const estimatedBytes = getDataUrlByteLength(dataUrl);
    showInspectExportInfo(
      formatConfig.label,
      preparedExport.width,
      preparedExport.height,
      estimatedBytes
    );

    const result = await withFreezeOverlay(
      "Application is frozen while the preview image is written to disk.",
      () =>
        window.atlDesktop.savePreviewImage({
          suggestedPath: replaceExtension(exportInfo.inputPath, formatConfig.extension),
          dataUrl,
          format: formatConfig.label,
          extension: formatConfig.extension
        })
    );

    if (!result) {
      setStatus("Image export canceled.", "idle");
      return;
    }

    showInspectExportInfo(
      formatConfig.label,
      preparedExport.width,
      preparedExport.height,
      result.bytesWritten
    );
    setStatus(`Saved ${formatConfig.label} preview to ${result.outputPath}.`, "success");
  } catch (error) {
    hideInspectExportInfo();
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.inspectExportImage, false, "Saving Image...");
  }
}

async function applySettings() {
  const previewLimit = Number.parseInt(elements.settingsPreviewLimit.value.trim(), 10);

  if (!Number.isInteger(previewLimit) || previewLimit < 1) {
    renderResult(elements.settingsResult, ["Error: Preview limit must be a positive integer."]);
    setStatus("Preview limit must be a positive integer.", "error");
    return;
  }

  state.settings = {
    previewLimit,
    defaultInputMode: normalizeUiInputMode(elements.settingsDefaultInputMode.value),
    defaultCompression: normalizeUiCompression(elements.settingsDefaultCompression.value),
    advancedAutoStrategy: elements.advancedAutoStrategy.value,
    advancedTransform: elements.advancedTransform.value,
    comboCompression: elements.comboCompression
      ? normalizeUiComboCompression(elements.comboCompression.value)
      : "combo-none",
    allowLargeFiles: elements.settingsAllowLargeFiles.checked,
    allowAllEncoders: elements.settingsAllowAllEncoders.checked,
    allowUnrestrictedEstimate: elements.settingsAllowUnrestrictedEstimate.checked,
    showOperationLogs: elements.settingsShowOperationLogs.checked
  };

  await saveSettings();
  applySettingsToEncodeForm();
  syncOperationLogCards();
  renderResult(elements.settingsResult, [
    `Preview limit: ${state.settings.previewLimit.toLocaleString()} pixels`,
    `Default input handling: ${state.settings.defaultInputMode}`,
    `Default compression: ${state.settings.defaultCompression === "raw-binary" ? "raw binary to ATL" : state.settings.defaultCompression}`,
    `Advanced auto strategy: ${state.settings.advancedAutoStrategy}`,
    `Solo encoding: ${state.settings.advancedTransform}`,
    `Combo encode: ${state.settings.comboCompression}`,
    `Large-file override: ${state.settings.allowLargeFiles ? "enabled" : "disabled"}`,
    `All encoders regardless of extension: ${state.settings.allowAllEncoders ? "enabled" : "disabled"}`,
    `Estimate ignores extension limits: ${state.settings.allowUnrestrictedEstimate ? "enabled" : "disabled"}`,
    `Encode/decode logs: ${state.settings.showOperationLogs ? "enabled" : "disabled"}`,
    "Settings saved persistently."
  ]);
  setStatus("Settings updated and saved.", "success");

  if (elements.inspectInputPath.value.trim()) {
    resetPreviewOverride();
    await runInspect();
  }
}

async function resetSettings() {
  state.settings = { ...SESSION_DEFAULTS };
  await saveSettings();
  loadSettingsIntoPanel();
  applySettingsToEncodeForm();
  resetPreviewOverride();
  syncOperationLogCards();
  hideResult(elements.settingsResult);
  setStatus("Settings reset to defaults and saved.", "success");

  if (elements.inspectInputPath.value.trim()) {
    await runInspect();
  }
}

function registerTabs() {
  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tabTarget);
    });
  }
}

function registerButtons() {
  for (const button of document.querySelectorAll("button")) {
    button.dataset.label = button.textContent;
  }

  document.querySelector("#encode-input-browse").addEventListener("click", async () => {
    await chooseBinaryInput(elements.encodeInputPath);
    syncEncodeOutputSuggestion();
    applyEncodeRecommendations();
  });

  document.querySelector("#encode-output-browse").addEventListener("click", chooseEncodeOutput);
  document.querySelector("#encode-metadata-browse").addEventListener("click", chooseMetadataInput);
  elements.encodeAdvancedToggle.addEventListener("click", () => {
    elements.advancedEncodePanel.open = !elements.advancedEncodePanel.open;
  });
  elements.encodeCancel.addEventListener("click", () => {
    if (elements.encodeSubmit.disabled) {
      setStatus("Cancel is unavailable while the synchronous encode job is running.", "warn");
      return;
    }

    setEncodeStatusFields();
    setEncodeProgress(0, 0);
    hideResult(elements.encodeResult);
    setStatus("Encode state cleared.", "idle");
  });
  elements.encodeHelp.addEventListener("click", () => {
    renderResult(elements.encodeResult, [
      "Help",
      "1. Choose an input file and output ATL path.",
      "2. Leave compression on auto unless you need a specific mode, or choose Raw binary to ATL for an uncompressed raw write.",
      "3. Open Advanced for transform, combo, and auto-strategy controls.",
      "4. Inspect can preview color-packed ATL files; raw storage ATL files may have no preview."
    ]);
    setStatus("Encode help shown.", "idle");
  });

  document.querySelector("#decode-input-browse").addEventListener("click", async () => {
    elements.decodeOutputPath.value = "";
    await chooseAtlInput(elements.decodeInputPath);
    await syncDecodeOutputSuggestion(true);
  });

  document.querySelector("#decode-output-browse").addEventListener("click", chooseDecodeOutput);
  document.querySelector("#inspect-input-browse").addEventListener("click", async () => {
    resetPreviewOverride();
    state.lastInspection = null;
    elements.inspectExportImage.disabled = true;
    hideInspectExportInfo();
    await chooseAtlInput(elements.inspectInputPath);
  });

  elements.encodeInputPath.addEventListener("change", syncEncodeOutputSuggestion);
  elements.encodeInputPath.addEventListener("change", applyEncodeRecommendations);
  elements.encodeInputPath.addEventListener("blur", syncEncodeOutputSuggestion);
  elements.encodeInputPath.addEventListener("blur", applyEncodeRecommendations);
  if (elements.encodeInputMode) {
    elements.encodeInputMode.addEventListener("change", applyEncodeRecommendations);
  }
  elements.decodeInputPath.addEventListener("change", () => {
    elements.decodeOutputPath.value = "";
    void syncDecodeOutputSuggestion(true);
  });
  elements.decodeInputPath.addEventListener("blur", () => {
    if (elements.decodeInputPath.value.trim()) {
      elements.decodeOutputPath.value = "";
      void syncDecodeOutputSuggestion(true);
    }
  });

  elements.inspectInputPath.addEventListener("change", resetPreviewOverride);
  elements.inspectInputPath.addEventListener("change", () => {
    state.lastInspection = null;
    elements.inspectExportImage.disabled = true;
    hideInspectExportInfo();
  });
  elements.inspectInputPath.addEventListener("blur", () => {
    resetPreviewOverride();

    if (elements.inspectInputPath.value.trim() !== state.lastInspection?.inputPath) {
      state.lastInspection = null;
      elements.inspectExportImage.disabled = true;
      hideInspectExportInfo();
    }
  });
  elements.previewOverrideToggle.addEventListener("change", async () => {
    state.allowLargePreview = elements.previewOverrideToggle.checked;

    if (elements.inspectInputPath.value.trim()) {
      await runInspect();
    }
  });
  elements.inspectExportFormat.addEventListener("change", () => {
    updateInspectExportQualityState();
    hideInspectExportInfo();
  });
  if (elements.advancedTransform) {
    elements.advancedTransform.addEventListener("change", syncComboEncodingConflicts);
  }
  if (elements.encodeCompression) {
    elements.encodeCompression.addEventListener("change", applyEncodeRecommendations);
  }
  for (const button of elements.inspectSubtabs) {
    button.addEventListener("click", () => activateInspectView(button.dataset.inspectView));
  }
  elements.inspectExportSize.addEventListener("change", hideInspectExportInfo);
  elements.inspectExportQuality.addEventListener("change", hideInspectExportInfo);

  elements.encodeSubmit.addEventListener("click", runEncode);
  elements.encodePreflight.addEventListener("click", runEncodePreflight);
  elements.decodeSubmit.addEventListener("click", runDecode);
  elements.inspectSubmit.addEventListener("click", runInspect);
  elements.inspectExportImage.addEventListener("click", runExportInspectImage);
  elements.settingsApply.addEventListener("click", applySettings);
  elements.settingsReset.addEventListener("click", resetSettings);

  elements.encodeReveal.addEventListener("click", () => {
    if (state.lastEncodedOutput) {
      window.atlDesktop.revealInFolder(state.lastEncodedOutput);
    }
  });

  elements.decodeReveal.addEventListener("click", () => {
    if (state.lastDecodedOutput) {
      window.atlDesktop.revealInFolder(state.lastDecodedOutput);
    }
  });
}

async function initialize() {
  await loadSettings();
  configureComboOptions();
  loadSettingsIntoPanel();
  applySettingsToEncodeForm();
  registerTabs();
  registerButtons();
  setFreezeOverlay(false);
  syncOperationLogCards();
  resetPreviewOverride();
  hideInspectExportInfo();
  updateInspectExportQualityState();
  elements.inspectExportImage.disabled = true;
  hideResult(elements.settingsResult);
  clearPreview();
  setEncodeStatusFields();
  setEncodeProgress(0, 0);
  applyEncodeRecommendations();
  activateInspectView("color");
  activateTab("encode");
}

initialize();
