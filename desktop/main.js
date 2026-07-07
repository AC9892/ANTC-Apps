const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { inspectBinary } = require("../src/inspect");

const APP_ICON_PATH = path.join(__dirname, "..", "..", "App", "Icon", "Antc.ico");

const WINDOW_OPTIONS = {
  width: 500,
  height: 420,
  minWidth: 500,
  minHeight: 420,
  maxWidth: 500,
  maxHeight: 420,
  resizable: false,
  maximizable: false,
  icon: APP_ICON_PATH,
  backgroundColor: "#202020",
  autoHideMenuBar: true,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
};

function createWindow() {
  const window = new BrowserWindow(WINDOW_OPTIONS);
  window.setIcon(APP_ICON_PATH);
  window.loadFile(path.join(__dirname, "index.html"));

  if (process.env.ATL_SMOKE_TEST === "1") {
    window.webContents.once("did-finish-load", () => {
      console.log("BINARY_INSPECT_SMOKE_TEST_OK");
      setTimeout(() => app.quit(), 250);
    });
  }

  return window;
}

function getWindow() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

async function safeHandle(work) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function registerIpc() {
  ipcMain.handle("dialog:pick-binary-input", async () => {
    const response = await dialog.showOpenDialog(getWindow(), {
      title: "Select Executable or Binary File",
      properties: ["openFile"],
      filters: [
        { name: "Executable and Binary Files", extensions: ["exe", "dll", "sys", "bin", "elf", "o", "so", "dylib", "app"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    return response.canceled ? null : response.filePaths[0];
  });

  ipcMain.handle("binary:inspect", (_, payload) =>
    safeHandle(() => inspectBinary(payload.inputPath, payload))
  );

  ipcMain.handle("dialog:pick-output-dir", async () => {
    const response = await dialog.showOpenDialog(getWindow(), {
      title: "Select Output Directory",
      properties: ["openDirectory"]
    });
    return response.canceled ? null : response.filePaths[0];
  });

  ipcMain.handle("dialog:pick-decompile-input", async () => {
    const response = await dialog.showOpenDialog(getWindow(), {
      title: "Select File to Decompile",
      properties: ["openFile"],
      filters: [
        { name: "Executable and Binary Files", extensions: ["exe", "dll", "sys", "bin", "elf", "o", "so", "dylib", "app"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    return response.canceled ? null : response.filePaths[0];
  });

  ipcMain.handle("dialog:pick-decompile-dir", async () => {
    const response = await dialog.showOpenDialog(getWindow(), {
      title: "Select Directory to Decompile",
      properties: ["openDirectory"]
    });
    return response.canceled ? null : response.filePaths[0];
  });

  ipcMain.handle("decompiler:decompile", (_, payload) =>
    safeHandle(() => {
      const { decompileBinary } = require("../src/inspect");
      if (payload.mode === "batch") {
        return decompileBinary(payload.inputPath, payload.outputDir, { batch: true });
      }
      return decompileBinary(payload.inputPath, payload.outputDir);
    })
  );

  ipcMain.handle("decompiler:save-results", (_, payload) =>
    safeHandle(() => {
      const { saveDecompileResults } = require("../src/inspect");
      return saveDecompileResults(payload.results, payload.outputDir);
    })
  );
}

app.whenReady().then(() => {
  app.setName("Binary Inspect by Air Conditioner");
  app.setAppUserModelId("com.ac9892.binaryinspect");
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
