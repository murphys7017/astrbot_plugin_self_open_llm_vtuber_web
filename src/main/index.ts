/* eslint-disable no-shadow */
import {
  app,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  WebContents,
  session,
  Session,
} from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { WindowManager } from "./window-manager";
import { MenuManager } from "./menu-manager";

let windowManager: WindowManager;
let menuManager: MenuManager;
let isQuitting = false;

function isTrustedMediaOrigin(webContents: WebContents | null, requestingOrigin?: string): boolean {
  const candidateOrigin = requestingOrigin || webContents?.getURL() || "";

  if (!candidateOrigin) return false;

  try {
    const parsedUrl = new URL(candidateOrigin);
    if (parsedUrl.protocol === "file:") {
      return true;
    }

    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
    }
  } catch (_error) {
    return candidateOrigin.startsWith("file://");
  }

  return false;
}

function configureSessionPermissions(targetSession: Session): void {
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === "media") {
      return isTrustedMediaOrigin(webContents, requestingOrigin);
    }

    return false;
  });

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === "media") {
      callback(isTrustedMediaOrigin(webContents, details.requestingOrigin));
      return;
    }

    callback(false);
  });
}

function setupIPC(): void {
  ipcMain.handle("get-platform", () => process.platform);

  ipcMain.on("toggle-devtools", () => {
    windowManager.toggleDevTools();
  });

  ipcMain.on("set-ignore-mouse-events", (_event, ignore: boolean) => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.setIgnoreMouseEvents(ignore);
    }
  });

  ipcMain.on("get-current-mode", (event) => {
    event.returnValue = windowManager.getCurrentMode();
  });

  ipcMain.on("pre-mode-changed", (_event, newMode) => {
    if (newMode === 'window' || newMode === 'pet') {
      menuManager.setMode(newMode);
    }
  });

  ipcMain.on("window-minimize", () => {
    windowManager.getWindow()?.minimize();
  });

  ipcMain.on("window-maximize", () => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.maximizeWindow();
    }
  });

  ipcMain.on("window-close", () => {
    const window = windowManager.getWindow();
    if (window) {
      if (process.platform === "darwin") {
        window.hide();
      } else {
        window.close();
      }
    }
  });

  ipcMain.on(
    "update-component-hover",
    (_event, componentId: string, isHovering: boolean) => {
      windowManager.updateComponentHover(componentId, isHovering);
    },
  );

  ipcMain.handle('get-screen-capture', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0].id;
  });
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.electron");

  configureSessionPermissions(session.defaultSession);
  app.on("session-created", (createdSession) => {
    configureSessionPermissions(createdSession);
  });

  windowManager = new WindowManager();
  menuManager = new MenuManager(
    (mode) => windowManager.setWindowMode(mode),
    () => windowManager.toggleDevTools(),
  );

  const window = windowManager.createWindow({
    titleBarOverlay: {
      color: "#111111",
      symbolColor: "#FFFFFF",
      height: 30,
    },
  });
  menuManager.createTray();

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
    return false;
  });
  const devToolsShortcuts = process.platform === "darwin"
    ? ["F12", "Command+Alt+I"]
    : ["F12", "Control+Shift+I"];

  devToolsShortcuts.forEach((shortcut) => {
    globalShortcut.register(shortcut, () => {
      windowManager.toggleDevTools();
    });
  });

  setupIPC();

  app.on("activate", () => {
    const window = windowManager.getWindow();
    if (window) {
      window.show();
    }
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  menuManager.destroy();
  globalShortcut.unregisterAll();
});
