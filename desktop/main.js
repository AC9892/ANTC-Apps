const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { decodeFile, encodeFile, inspectFile } = require("../src/file-ops");

const WINDOW_OPTIONS = {
  width: 900,
  height: 820,
  minWidth: 820,
  minHeight: 680,
  backgroundColor: "#0e1518",
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
  window.loadFile(path.join(__dirname, "index.html"));

  if (process.env.ATL_SMOKE_TEST === "1") {
    window.webContents.once("did-finish-load", () => {
      console.log("ATL_SMOKE_TEST_OK");
      setTimeout(() => {
        app.quit();
      }, 250);
    });

    window.webContents.once("did-fail-load", (_, errorCode, errorDescription) => {
      console.error(`ATL_SMOKE_TEST_FAIL ${errorCode} ${errorDescription}`);
      app.exit(1);
    });
  }

  return window;
}

function ensureExtension(filePath, extension) {
  if (!filePath) {
    return filePath;
  }

  return /[.][^./\\]+$/.test(filePath) ? filePath : `${filePath}${extension}`;
}

function getWindow() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

async function openFileDialog(options) {
  const response = await dialog.showOpenDialog(getWindow(), {
    properties: ["openFile"],
    ...options
  });

  return response.canceled ? null : response.filePaths[0];
}

async function saveFileDialog(options) {
  const response = await dialog.showSaveDialog(getWindow(), options);
  return response.canceled ? null : response.filePath;
}

async function safeHandle(work) {
  try {
    return {
      ok: true,
      value: await work()
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

function registerIpc() {
  ipcMain.handle("dialog:pick-binary-input", () =>
    openFileDialog({
      title: "Select Source Binary File"
    })
  );

  ipcMain.handle("dialog:pick-atl-input", () =>
    openFileDialog({
      title: "Select ATL File",
      filters: [{ name: "ANTC ATL", extensions: ["atl"] }]
    })
  );

  ipcMain.handle("dialog:pick-metadata", () =>
    openFileDialog({
      title: "Select Metadata JSON",
      filters: [{ name: "JSON", extensions: ["json"] }]
    })
  );

  ipcMain.handle("dialog:pick-atl-output", (_, suggestedPath) =>
    saveFileDialog({
      title: "Save ATL File",
      defaultPath: suggestedPath,
      filters: [{ name: "ANTC ATL", extensions: ["atl"] }]
    })
  );

  ipcMain.handle("dialog:pick-binary-output", (_, suggestedPath) =>
    saveFileDialog({
      title: "Save Binary File",
      defaultPath: suggestedPath
    })
  );
  ipcMain.handle("image:save-preview", (_, payload) =>
    safeHandle(async () => {
      const outputPath = await saveFileDialog({
        title: `Save ${payload.format ?? "Preview"} Image`,
        defaultPath: payload.suggestedPath,
        filters: [
          {
            name: `${payload.format ?? "Image"} Image`,
            extensions: [String(payload.extension ?? ".png").replace(/^\./, "")]
          }
        ]
      });

      if (!outputPath) {
        return null;
      }

      const normalizedOutputPath = ensureExtension(outputPath, payload.extension ?? ".png");
      const base64Payload = String(payload.dataUrl).replace(/^data:[^;]+;base64,/, "");
      const imageBuffer = Buffer.from(base64Payload, "base64");
      await fs.writeFile(normalizedOutputPath, imageBuffer);

      return {
        outputPath: normalizedOutputPath,
        bytesWritten: imageBuffer.length
      };
    })
  );

  ipcMain.handle("atl:encode", (_, payload) => safeHandle(() => encodeFile(payload)));
  ipcMain.handle("atl:decode", (_, payload) => safeHandle(() => decodeFile(payload)));
  ipcMain.handle("atl:inspect", (_, payload) =>
    safeHandle(() =>
      inspectFile(payload.inputPath, {
        preview: payload.preview,
        maxPreviewPixels: payload.maxPreviewPixels
      })
    )
  );
  ipcMain.handle("shell:reveal", (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("settings:save", async (_, settings) => 
    safeHandle(async () => {
      const settingsPath = path.join(app.getPath("userData"), "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return settingsPath;
    })
  );

  ipcMain.handle("settings:load", () => 
    safeHandle(async () => {
      const settingsPath = path.join(app.getPath("userData"), "settings.json");
      if (!await fs.access(settingsPath).then(() => true).catch(() => false)) {
        return null;
      }
      const data = await fs.readFile(settingsPath, "utf8");
      return JSON.parse(data);
    })
  );

}

app.whenReady().then(() => {
  app.setName("ANTC Studio Legacy by Air Conditioner");
  app.setAppUserModelId("com.ac9892.antc.studio");
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
