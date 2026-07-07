const { contextBridge, ipcRenderer } = require("electron");

async function invokeHandled(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);

  if (response && response.ok === false) {
    throw new Error(response.error);
  }

  return response && Object.prototype.hasOwnProperty.call(response, "value") ? response.value : response;
}

contextBridge.exposeInMainWorld("atlDesktop", {
  pickBinaryInput: () => ipcRenderer.invoke("dialog:pick-binary-input"),
  pickAtlInput: () => ipcRenderer.invoke("dialog:pick-atl-input"),
  pickMetadataFile: () => ipcRenderer.invoke("dialog:pick-metadata"),
  pickAtlOutput: (suggestedPath) => ipcRenderer.invoke("dialog:pick-atl-output", suggestedPath),
  pickBinaryOutput: (suggestedPath) =>
    ipcRenderer.invoke("dialog:pick-binary-output", suggestedPath),
  encode: (payload) => invokeHandled("atl:encode", payload),
  preflight: (payload) => invokeHandled("atl:preflight", payload),
  decode: (payload) => invokeHandled("atl:decode", payload),
  inspect: (payload) => invokeHandled("atl:inspect", payload),
  savePreviewImage: (payload) => invokeHandled("image:save-preview", payload),
  revealInFolder: (filePath) => ipcRenderer.invoke("shell:reveal", filePath),
  settings: {
    save: (settings) => invokeHandled("settings:save", settings),
    load: () => invokeHandled("settings:load", {})
  }
});
