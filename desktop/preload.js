const { contextBridge, ipcRenderer } = require("electron");

async function invokeHandled(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);

  if (response && response.ok === false) {
    throw new Error(response.error);
  }

  return response && Object.prototype.hasOwnProperty.call(response, "value")
    ? response.value
    : response;
}

contextBridge.exposeInMainWorld("binaryInspect", {
  pickBinaryInput: () => ipcRenderer.invoke("dialog:pick-binary-input"),
  inspect: (payload) => invokeHandled("binary:inspect", payload),
  pickOutputDir: () => ipcRenderer.invoke("dialog:pick-output-dir"),
  pickDecompileInput: () => ipcRenderer.invoke("dialog:pick-decompile-input"),
  pickDecompileDir: () => ipcRenderer.invoke("dialog:pick-decompile-dir"),
  decompile: (payload) => invokeHandled("decompiler:decompile", payload),
  saveDecompileResults: (payload) => invokeHandled("decompiler:save-results", payload)
});
