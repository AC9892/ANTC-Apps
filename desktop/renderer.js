const SESSION_DEFAULTS = {
  previewLimit: 262144,
  defaultInputMode: "auto",
  defaultCompression: "auto",
  advancedAutoStrategy: "smart",
  advancedTransform: "none",
  comboCompression: "combo-none",
  allowLargeFiles: false,
  showOperationLogs: false
};

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
      state.settings = { ...SESSION_DEFAULTS, ...saved };
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
  settings: { ...SESSION_DEFAULTS }
};

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
  encodeResult: document.querySelector("#encode-result"),
  encodeLog: document.querySelector("#encode-log"),
  encodeReveal: document.querySelector("#encode-reveal"),
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
  settingsDefaultInputMode: document.querySelector("#settings-default-input-mode"),
  settingsDefaultCompression: document.querySelector("#settings-default-compression"),
  settingsPreviewLimit: document.querySelector("#settings-preview-limit"),
  settingsAllowLargeFiles: document.querySelector("#settings-allow-large-files"),
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
  elements.settingsDefaultInputMode.value = state.settings.defaultInputMode;
  elements.settingsDefaultCompression.value = state.settings.defaultCompression;
  elements.settingsPreviewLimit.value = String(state.settings.previewLimit);
  elements.settingsAllowLargeFiles.checked = state.settings.allowLargeFiles;
  elements.settingsShowOperationLogs.checked = state.settings.showOperationLogs;
}

function applySettingsToEncodeForm() {
  elements.encodeInputMode.value = state.settings.defaultInputMode;
  elements.encodeCompression.value = state.settings.defaultCompression;
  elements.advancedAutoStrategy.value = state.settings.advancedAutoStrategy;
  elements.advancedTransform.value = state.settings.advancedTransform;
  if (elements.comboCompression) elements.comboCompression.value = state.settings.comboCompression;
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
  setStatus("Encoding source file into ANTC pixels...", "busy");

  try {
    const result = await withFreezeOverlay(
      "Application is frozen while encode runs. Large files can pause the window until the write finishes.",
      () =>
        window.atlDesktop.encode({
          inputPath: elements.encodeInputPath.value.trim(),
          outputPath: elements.encodeOutputPath.value.trim(),
          compression: elements.encodeCompression.value,
          comboCompression: elements.comboCompression ? elements.comboCompression.value : 'combo-none',
          autoCompressionStrategy: elements.advancedAutoStrategy.value,
          experimentalTransform: elements.advancedTransform.value,
          inputMode: elements.encodeInputMode.value,
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
    const atlSizeDelta = result.info.pixel_data_length + result.info.metadata_length + 11 - sourceSize;
    const atlSizePercent = sourceSize === 0 ? 0 : (atlSizeDelta / sourceSize) * 100;
    renderResult(elements.encodeResult, [
      result.summary,
      `Output: ${result.outputPath}`,
      `Pixels: ${result.info.pixel_count.toLocaleString()}`,
      `Checksum: ${result.info.checksum}`,
      `Compression: ${result.info.metadata.compression} / ${compressionVariant} (requested: ${requestedCompression})`,
      `Detected file kind: ${result.info.metadata.detected_file_kind ?? "unknown"}`,
      `Auto strategy: ${result.info.metadata.auto_compression_strategy ?? "smart"} / used profile: ${result.info.metadata.auto_compression_profile ?? "n/a"} / detected: ${result.info.metadata.detected_auto_compression_profile ?? "n/a"}`,
      `Experimental transform: ${result.info.metadata.experimental_transform ?? "none"} (requested: ${requestedTransform})`,
      `Input mode: ${result.info.metadata.input_mode}`,
      `Payload bytes: ${result.info.encoded_size.toLocaleString()} from ${sourceSize.toLocaleString()}`,
      `ATL size change: ${formatSignedBytesDelta(atlSizeDelta)} (${atlSizePercent.toFixed(2)}%)`,
      `Source size: ${sourceSize.toLocaleString()}`
    ]);
    syncOperationLogCards();
    setStatus(
      `Encoded ${result.info.pixel_count.toLocaleString()} pixels to ${result.outputPath}.`,
      "success"
    );
  } catch (error) {
    state.lastEncodeLogs = [`Error: ${error.message}`];
    renderResult(elements.encodeResult, [`Error: ${error.message}`]);
    syncOperationLogCards();
    setStatus(error.message, "error");
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.encodeSubmit, false, "Encoding...");
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
    defaultInputMode: elements.settingsDefaultInputMode.value,
    defaultCompression: elements.settingsDefaultCompression.value,
    advancedAutoStrategy: elements.advancedAutoStrategy.value,
    advancedTransform: elements.advancedTransform.value,
    allowLargeFiles: elements.settingsAllowLargeFiles.checked,
    showOperationLogs: elements.settingsShowOperationLogs.checked
  };

  await saveSettings();
  applySettingsToEncodeForm();
  syncOperationLogCards();
  renderResult(elements.settingsResult, [
    `Preview limit: ${state.settings.previewLimit.toLocaleString()} pixels`,
    `Default input handling: ${state.settings.defaultInputMode}`,
    `Default compression: ${state.settings.defaultCompression}`,
    `Advanced auto strategy: ${state.settings.advancedAutoStrategy}`,
    `Experimental transform: ${state.settings.advancedTransform}`,
    `Large-file override: ${state.settings.allowLargeFiles ? "enabled" : "disabled"}`,
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
  });

  document.querySelector("#encode-output-browse").addEventListener("click", chooseEncodeOutput);
  document.querySelector("#encode-metadata-browse").addEventListener("click", chooseMetadataInput);

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
  elements.encodeInputPath.addEventListener("blur", syncEncodeOutputSuggestion);
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
  elements.inspectExportSize.addEventListener("change", hideInspectExportInfo);
  elements.inspectExportQuality.addEventListener("change", hideInspectExportInfo);

  elements.encodeSubmit.addEventListener("click", runEncode);
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
  activateTab("encode");
}

initialize();
