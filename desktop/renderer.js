const elements = {
  inspectInputPath: document.querySelector("#inspect-input-path"),
  inspectSubmit: document.querySelector("#inspect-submit"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  summaryCard: document.querySelector("#summary-card"),
  summaryFormat: document.querySelector("#summary-format"),
  summaryArch: document.querySelector("#summary-arch"),
  summaryEntropy: document.querySelector("#summary-entropy"),
  resultCard: document.querySelector("#result-card"),
  hashesOutput: document.querySelector("#hashes-output"),
  detailsOutput: document.querySelector("#details-output"),
  stringsOutput: document.querySelector("#strings-output")
};

function activateTab(tabName) {
  for (const button of elements.tabButtons) {
    button.classList.toggle("is-active", button.dataset.tabTarget === tabName);
  }

  for (const panel of elements.tabPanels) {
    panel.classList.toggle("is-active", panel.dataset.tabPanel === tabName);
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "<")
    .replaceAll(">", ">");
}

function renderLines(element, lines) {
  element.innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  element.classList.remove("hidden");
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

async function browseInput() {
  const filePath = await window.binaryInspect.pickBinaryInput();
  if (filePath) {
    elements.inspectInputPath.value = filePath;
  }
}

async function runInspect() {
  elements.inspectSubmit.disabled = true;

  try {
    const result = await window.binaryInspect.inspect({
      inputPath: elements.inspectInputPath.value.trim()
    });

    elements.summaryFormat.textContent = result.format;
    elements.summaryArch.textContent = result.architecture;
    elements.summaryEntropy.textContent = String(result.entropy);
    elements.summaryCard.classList.remove("hidden");

    renderLines(elements.resultCard, [
      `File: ${result.fileName}`,
      `Path: ${result.inputPath}`,
      `Size: ${result.size.toLocaleString()} bytes`,
      `Format: ${result.format}`,
      `Architecture: ${result.architecture}`
    ]);

    elements.hashesOutput.textContent = prettyJson(result.hashes);
    elements.detailsOutput.textContent = prettyJson(result.details);
    elements.stringsOutput.textContent = result.strings.length > 0 ? result.strings.join("\n") : "No printable strings found.";
    activateTab("inspect");
  } catch (error) {
    renderLines(elements.resultCard, [`Error: ${error.message}`]);
    elements.summaryCard.classList.add("hidden");
    elements.hashesOutput.textContent = "Inspection failed.";
    elements.detailsOutput.textContent = "Inspection failed.";
    elements.stringsOutput.textContent = "Inspection failed.";
  } finally {
    elements.inspectSubmit.disabled = false;
  }
}

document.querySelector("#inspect-input-browse").addEventListener("click", browseInput);
elements.inspectSubmit.addEventListener("click", runInspect);

for (const button of elements.tabButtons) {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget);
  });
}

// ─── Decompiler tab logic ────────────────────────────────────────────────────
const decompileElements = {
  inputPath: document.querySelector("#decompile-input-path"),
  outputPath: document.querySelector("#decompile-output-path"),
  submit: document.querySelector("#decompile-submit"),
  save: document.querySelector("#decompile-save"),
  resultCard: document.querySelector("#decompile-result-card"),
  importsOutput: document.querySelector("#decompile-imports-output"),
  resourcesOutput: document.querySelector("#decompile-resources-output"),
  stringsOutput: document.querySelector("#decompile-strings-output"),
  structOutput: document.querySelector("#decompile-struct-output")
};

let lastDecompileResult = null;

async function browseDecompileInput() {
  const filePath = await window.binaryInspect.pickDecompileInput();
  if (filePath) {
    decompileElements.inputPath.value = filePath;
  }
}

async function browseDecompileDir() {
  const dirPath = await window.binaryInspect.pickDecompileDir();
  if (dirPath) {
    decompileElements.inputPath.value = dirPath;
  }
}

async function browseOutputDir() {
  const dirPath = await window.binaryInspect.pickOutputDir();
  if (dirPath) {
    decompileElements.outputPath.value = dirPath;
  }
}

async function runDecompile() {
  decompileElements.submit.disabled = true;
  decompileElements.save.disabled = true;
  lastDecompileResult = null;

  try {
    const inputPath = decompileElements.inputPath.value.trim();
    const outputDir = decompileElements.outputPath.value.trim() || null;

    const stats = await window.binaryInspect.decompile({
      inputPath,
      outputDir,
      mode: "single"
    });

    lastDecompileResult = stats;

    renderLines(decompileElements.resultCard, [
      `File: ${stats.fileName}`,
      `Path: ${stats.inputPath}`,
      `Size: ${stats.size.toLocaleString()} bytes`,
      `Format: ${stats.format}`,
      `Architecture: ${stats.architecture}`
    ]);

    decompileElements.importsOutput.textContent = prettyJson(stats.importsExports);
    decompileElements.resourcesOutput.textContent = prettyJson(stats.resources);
    decompileElements.stringsOutput.textContent = stats.deepStrings.length > 0 ? stats.deepStrings.join("\n") : "No categorized strings found.";
    decompileElements.structOutput.textContent = prettyJson(stats.structuralReport);

    decompileElements.save.disabled = false;
    activateTab("placeholder");
  } catch (error) {
    renderLines(decompileElements.resultCard, [`Error: ${error.message}`]);
    decompileElements.importsOutput.textContent = "Decompilation failed.";
    decompileElements.resourcesOutput.textContent = "Decompilation failed.";
    decompileElements.stringsOutput.textContent = "Decompilation failed.";
    decompileElements.structOutput.textContent = "Decompilation failed.";
  } finally {
    decompileElements.submit.disabled = false;
  }
}

async function saveDecompileResults() {
  if (!lastDecompileResult) return;
  try {
    const outputDir = decompileElements.outputPath.value.trim() || null;
    await window.binaryInspect.saveDecompileResults({
      results: lastDecompileResult,
      outputDir
    });
    renderLines(decompileElements.resultCard, [
      `File: ${lastDecompileResult.fileName}`,
      `Path: ${lastDecompileResult.inputPath}`,
      "Results saved successfully."
    ]);
  } catch (error) {
    renderLines(decompileElements.resultCard, [`Save error: ${error.message}`]);
  }
}

document.querySelector("#decompile-input-browse").addEventListener("click", browseDecompileInput);
document.querySelector("#decompile-dir-browse").addEventListener("click", browseDecompileDir);
document.querySelector("#decompile-output-browse").addEventListener("click", browseOutputDir);
decompileElements.submit.addEventListener("click", runDecompile);
decompileElements.save.addEventListener("click", saveDecompileResults);
