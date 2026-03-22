import {
  BrowserWindow, screen, shell, ipcMain,
} from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';

const isMac = process.platform === 'darwin';

export class WindowManager {
  private static readonly PET_WINDOW_WIDTH = 540;

  private static readonly PET_WINDOW_HEIGHT = 820;

  private static readonly PET_WINDOW_MARGIN = 24;

  private static readonly PET_OVERLAY_WIDTH = 440;

  private static readonly PET_OVERLAY_HEIGHT = 210;

  private static readonly PET_OVERLAY_MIN_HEIGHT = 120;

  private static readonly PET_OVERLAY_GAP = 18;

  private window: BrowserWindow | null = null;

  private windowedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  private hoveringComponents: Set<string> = new Set();

  private currentMode: 'window' | 'pet' = 'window';

  // Track if mouse events are forcibly ignored
  private forceIgnoreMouse = false;

  private petInputFocused = false;

  private petBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  private petOverlayWindow: BrowserWindow | null = null;

  private petOverlayBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  private petDragState: {
    startCursorX: number;
    startCursorY: number;
    startWindowX: number;
    startWindowY: number;
  } | null = null;

  private shouldRestorePetFocusAfterDevTools = false;

  constructor() {
    ipcMain.on('renderer-ready-for-mode-change', (_event, newMode) => {
      if (newMode === 'pet') {
        setTimeout(() => {
          this.continueSetWindowModePet();
        }, 500);
      } else {
        setTimeout(() => {
          this.continueSetWindowModeWindow();
        }, 500);
      }
    });

    ipcMain.on('mode-change-rendered', () => {
      this.window?.setOpacity(1);
    });

    ipcMain.on('window-unfullscreen', () => {
      const window = this.getWindow();
      if (window && window.isFullScreen()) {
        window.setFullScreen(false);
      }
    });

    // Handle toggle force ignore mouse events from renderer
    ipcMain.on('toggle-force-ignore-mouse', () => {
      this.toggleForceIgnoreMouse();
    });

    ipcMain.on('pet-input-focus-changed', (_event, focused: boolean) => {
      this.setPetInputFocused(focused);
    });

    ipcMain.on('pet-window-drag-start', (_event, screenX: number, screenY: number) => {
      this.startPetWindowDrag(screenX, screenY);
    });

    ipcMain.on('pet-window-drag-move', (_event, screenX: number, screenY: number) => {
      this.updatePetWindowDrag(screenX, screenY);
    });

    ipcMain.on('pet-window-drag-end', () => {
      this.endPetWindowDrag();
    });

    ipcMain.on('pet-overlay-action-send-text', (_event, payload: { text?: string; timestamp?: number } | string) => {
      this.window?.webContents.send('pet-overlay-send-text', payload);
    });

    ipcMain.on('pet-overlay-action-mic-toggle', () => {
      this.window?.webContents.send('pet-overlay-mic-toggle');
    });

    ipcMain.on('pet-overlay-action-interrupt', () => {
      this.window?.webContents.send('pet-overlay-interrupt');
    });

    ipcMain.on('pet-overlay-state-update', (_event, state) => {
      this.petOverlayWindow?.webContents.send('pet-overlay-state-update', state);
    });

    ipcMain.on('pet-overlay-preferred-height', (_event, preferredHeight: number) => {
      this.updatePetOverlayHeight(preferredHeight);
    });
  }

  createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    this.window = new BrowserWindow({
      width: 900,
      height: 670,
      show: false,
      transparent: true,
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      frame: false,
      icon: process.platform === 'win32'
        ? join(__dirname, '../../resources/icon.ico')
        : join(__dirname, '../../resources/icon.png'),
      ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: true,
      },
      hasShadow: false,
      paintWhenInitiallyHidden: true,
      ...options,
    });

    this.setupWindowEvents();
    this.loadContent();

    this.window.on('enter-full-screen', () => {
      this.window?.webContents.send('window-fullscreen-change', true);
    });

    this.window.on('leave-full-screen', () => {
      this.window?.webContents.send('window-fullscreen-change', false);
    });

    this.window.on('closed', () => {
      this.destroyPetOverlayWindow();
      this.window = null;
    });

    return this.window;
  }

  private setupWindowEvents(): void {
    if (!this.window) return;

    this.window.on('ready-to-show', () => {
      this.window?.show();
      this.window?.webContents.send(
        'window-maximized-change',
        this.window.isMaximized(),
      );
    });

    this.window.on('maximize', () => {
      this.window?.webContents.send('window-maximized-change', true);
    });

    this.window.on('unmaximize', () => {
      this.window?.webContents.send('window-maximized-change', false);
    });

    this.window.on('resize', () => {
      const window = this.getWindow();
      if (window) {
        const bounds = window.getBounds();
        const { width, height } = screen.getPrimaryDisplay().workArea;
        const isMaximized = bounds.width >= width && bounds.height >= height;
        window.webContents.send('window-maximized-change', isMaximized);
      }
    });

    this.window.on('hide', () => {
      this.petOverlayWindow?.hide();
    });

    this.window.on('show', () => {
      if (this.currentMode === 'pet') {
        this.petOverlayWindow?.show();
      }
    });

    this.window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    this.window.webContents.on('devtools-opened', () => {
      if (this.shouldRestorePetFocusAfterDevTools && this.window) {
        this.window.setFocusable(false);
        this.shouldRestorePetFocusAfterDevTools = false;
      }
    });

    this.window.webContents.on('devtools-closed', () => {
      if (this.currentMode === 'pet') {
        this.window?.setFocusable(false);
      }
      this.shouldRestorePetFocusAfterDevTools = false;
    });
  }

  private loadContent(): void {
    if (!this.window) return;

    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this.window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      this.window.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  setWindowMode(mode: 'window' | 'pet'): void {
    if (!this.window) return;

    this.currentMode = mode;
    this.window.setOpacity(0);

    if (mode === 'window') {
      this.setWindowModeWindow();
    } else {
      this.setWindowModePet();
    }
  }

  private setWindowModeWindow(): void {
    if (!this.window) return;

    this.petDragState = null;
    this.petInputFocused = false;
    this.hoveringComponents.clear();
    this.window.setAlwaysOnTop(false);
    this.window.setIgnoreMouseEvents(false);
    this.window.setSkipTaskbar(false);
    this.window.setResizable(true);
    this.window.setFocusable(true);
    this.window.setAlwaysOnTop(false);

    this.window.setBackgroundColor('#ffffff');
    this.window.webContents.send('pre-mode-changed', 'window');
  }

  private continueSetWindowModeWindow(): void {
    if (!this.window) return;
    if (this.windowedBounds) {
      this.window.setBounds(this.windowedBounds);
    } else {
      this.window.setSize(900, 670);
      this.window.center();
    }

    if (isMac) {
      this.window.setWindowButtonVisibility(true);
      this.window.setVisibleOnAllWorkspaces(false, {
        visibleOnFullScreen: false,
      });
    }

    this.window?.setIgnoreMouseEvents(false, { forward: true });
    this.window.setFocusable(true);
    this.destroyPetOverlayWindow();

    this.window.webContents.send('mode-changed', 'window');
  }

  private setWindowModePet(): void {
    if (!this.window) return;

    this.windowedBounds = this.window.getBounds();
    this.petDragState = null;
    this.petInputFocused = false;
    this.hoveringComponents.clear();

    if (this.window.isFullScreen()) {
      this.window.setFullScreen(false);
    }

    this.window.setBackgroundColor('#00000000');

    this.window.setAlwaysOnTop(true, 'screen-saver');

    this.window.webContents.send('pre-mode-changed', 'pet');
  }

  private continueSetWindowModePet(): void {
    if (!this.window) return;
    const targetBounds = this.petBounds ?? this.getDefaultPetBounds();
    this.window.setBounds(targetBounds);
    this.petBounds = targetBounds;

    if (isMac) this.window.setWindowButtonVisibility(false);
    this.window.setResizable(false);
    this.window.setSkipTaskbar(true);
    this.window.setFocusable(false);

    if (isMac) {
      this.window.setIgnoreMouseEvents(true);
      this.window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
    } else {
      this.window.setIgnoreMouseEvents(true, { forward: true });
    }

    this.ensurePetOverlayWindow();

    this.window.webContents.send('mode-changed', 'pet');
  }

  private getDefaultPetBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = display.workArea;
    const petWidth = Math.min(WindowManager.PET_WINDOW_WIDTH, width);
    const petHeight = Math.min(WindowManager.PET_WINDOW_HEIGHT, height);

    return {
      x: x + width - petWidth - WindowManager.PET_WINDOW_MARGIN,
      y: y + height - petHeight - WindowManager.PET_WINDOW_MARGIN,
      width: petWidth,
      height: petHeight,
    };
  }

  private getDefaultPetOverlayBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (this.petOverlayBounds) {
      return this.petOverlayBounds;
    }

    const modelBounds = this.petBounds ?? this.window?.getBounds() ?? this.getDefaultPetBounds();
    const display = screen.getDisplayMatching(modelBounds);
    const workArea = display.workArea;
    const width = Math.min(WindowManager.PET_OVERLAY_WIDTH, workArea.width);
    const height = Math.min(WindowManager.PET_OVERLAY_HEIGHT, workArea.height);

    let x = modelBounds.x + modelBounds.width + WindowManager.PET_OVERLAY_GAP;
    let y = modelBounds.y + modelBounds.height - height;

    if (x + width > workArea.x + workArea.width) {
      x = modelBounds.x - width - WindowManager.PET_OVERLAY_GAP;
    }

    const minX = workArea.x;
    const maxX = workArea.x + workArea.width - width;
    const minY = workArea.y;
    const maxY = workArea.y + workArea.height - height;

    x = Math.min(Math.max(x, minX), maxX);
    y = Math.min(Math.max(y, minY), maxY);

    return { x, y, width, height };
  }

  private ensurePetOverlayWindow(): void {
    if (this.petOverlayWindow && !this.petOverlayWindow.isDestroyed()) {
      return;
    }

    this.petOverlayWindow = new BrowserWindow({
      ...this.getDefaultPetOverlayBounds(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: true,
      },
    });

    this.petOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
    this.petOverlayWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    this.petOverlayWindow.on('closed', () => {
      this.petOverlayWindow = null;
    });

    this.petOverlayWindow.on('move', () => {
      if (!this.petOverlayWindow || this.petOverlayWindow.isDestroyed()) return;
      this.petOverlayBounds = this.petOverlayWindow.getBounds();
    });

    this.petOverlayWindow.on('ready-to-show', () => {
      if (!this.petOverlayBounds && this.petOverlayWindow) {
        this.petOverlayBounds = this.petOverlayWindow.getBounds();
      }
      this.petOverlayWindow?.show();
    });

    this.loadOverlayContent();
  }

  private loadOverlayContent(): void {
    if (!this.petOverlayWindow) return;

    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL);
      url.searchParams.set('petOverlay', '1');
      this.petOverlayWindow.loadURL(url.toString());
    } else {
      this.petOverlayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        search: 'petOverlay=1',
      });
    }
  }

  private destroyPetOverlayWindow(): void {
    if (!this.petOverlayWindow) return;
    if (this.petOverlayWindow.isDestroyed()) {
      this.petOverlayWindow = null;
      return;
    }

    this.petOverlayWindow.close();
    this.petOverlayWindow = null;
  }

  private updatePetOverlayHeight(preferredHeight: number): void {
    if (!this.petOverlayWindow || this.petOverlayWindow.isDestroyed()) return;

    const nextHeight = Math.max(
      WindowManager.PET_OVERLAY_MIN_HEIGHT,
      Math.min(WindowManager.PET_OVERLAY_HEIGHT, Math.round(preferredHeight)),
    );

    const bounds = this.petOverlayWindow.getBounds();
    if (Math.abs(bounds.height - nextHeight) < 3) return;

    const nextBounds = {
      ...bounds,
      height: nextHeight,
    };

    this.petOverlayWindow.setBounds(nextBounds);
    this.petOverlayBounds = nextBounds;
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    if (!this.window) return;

    if (isMac) {
      this.window.setIgnoreMouseEvents(ignore);
      // this.window.setIgnoreMouseEvents(ignore, { forward: true });
    } else {
      this.window.setIgnoreMouseEvents(ignore, { forward: true });
    }
  }

  maximizeWindow(): void {
    if (!this.window) return;

    if (this.isWindowMaximized()) {
      if (this.windowedBounds) {
        this.window.setBounds(this.windowedBounds);
        this.windowedBounds = null;
        this.window.webContents.send('window-maximized-change', false);
      }
    } else {
      this.windowedBounds = this.window.getBounds();
      const { width, height } = screen.getPrimaryDisplay().workArea;
      this.window.setBounds({
        x: 0, y: 0, width, height,
      });
      this.window.webContents.send('window-maximized-change', true);
    }
  }

  isWindowMaximized(): boolean {
    if (!this.window) return false;
    const bounds = this.window.getBounds();
    const { width, height } = screen.getPrimaryDisplay().workArea;
    return bounds.width >= width && bounds.height >= height;
  }

  updateComponentHover(componentId: string, isHovering: boolean): void {
    if (!this.window || this.currentMode === 'window') return;

    // If force ignore is enabled, don't change the mouse ignore state
    if (this.forceIgnoreMouse) return;

    if (isHovering) {
      this.hoveringComponents.add(componentId);
    } else {
      this.hoveringComponents.delete(componentId);
    }

    this.applyPetMouseState();
  }

  private applyPetMouseState(): void {
    if (!this.window || this.currentMode !== 'pet') return;

    if (this.forceIgnoreMouse) {
      if (isMac) {
        this.window.setIgnoreMouseEvents(true);
      } else {
        this.window.setIgnoreMouseEvents(true, { forward: true });
      }
      this.endPetWindowDrag();
      if (!this.window.webContents.isDevToolsOpened()) {
        this.window.setFocusable(false);
      }
      return;
    }

    const shouldIgnore = this.hoveringComponents.size === 0 && !this.petInputFocused;
    const shouldBeFocusable = this.petInputFocused || this.hoveringComponents.has('input-subtitle');
    if (isMac) {
      this.window.setIgnoreMouseEvents(shouldIgnore);
    } else {
      this.window.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    }

    if (shouldIgnore || !shouldBeFocusable) {
      this.endPetWindowDrag();
      if (!this.window.webContents.isDevToolsOpened()) {
        this.window.setFocusable(false);
      }
    } else {
      this.window.setFocusable(true);
    }
  }

  private setPetInputFocused(focused: boolean): void {
    this.petInputFocused = focused;
    if (!this.window || this.currentMode !== 'pet') return;

    this.applyPetMouseState();
    if (focused && !this.window.isFocused()) {
      this.window.focus();
    }
  }

  // Toggle force ignore mouse events
  toggleForceIgnoreMouse(): void {
    this.forceIgnoreMouse = !this.forceIgnoreMouse;
    this.applyPetMouseState();

    // Notify renderer about the change
    this.window?.webContents.send('force-ignore-mouse-changed', this.forceIgnoreMouse);
  }

  // Get current force ignore state
  isForceIgnoreMouse(): boolean {
    return this.forceIgnoreMouse;
  }

  private startPetWindowDrag(screenX: number, screenY: number): void {
    if (!this.window || this.currentMode !== 'pet' || this.forceIgnoreMouse) return;

    const bounds = this.window.getBounds();
    this.petDragState = {
      startCursorX: screenX,
      startCursorY: screenY,
      startWindowX: bounds.x,
      startWindowY: bounds.y,
    };
  }

  private updatePetWindowDrag(screenX: number, screenY: number): void {
    if (!this.window || !this.petDragState || this.currentMode !== 'pet') return;

    const deltaX = Math.round(screenX - this.petDragState.startCursorX);
    const deltaY = Math.round(screenY - this.petDragState.startCursorY);
    const newX = this.petDragState.startWindowX + deltaX;
    const newY = this.petDragState.startWindowY + deltaY;

    this.window.setPosition(newX, newY);
    const { width, height } = this.window.getBounds();
    this.petBounds = {
      x: newX,
      y: newY,
      width,
      height,
    };
  }

  private endPetWindowDrag(): void {
    if (!this.window) {
      this.petDragState = null;
      return;
    }

    if (this.currentMode === 'pet') {
      this.petBounds = this.window.getBounds();
    }
    this.petDragState = null;
  }

  toggleDevTools(): void {
    if (!this.window) return;

    if (this.window.isMinimized()) {
      this.window.restore();
    }

    this.window.show();

    if (this.window.webContents.isDevToolsOpened()) {
      this.window.webContents.closeDevTools();
      if (this.currentMode === 'pet') {
        this.window.setFocusable(false);
      }
      return;
    }

    if (this.currentMode === 'pet' && !this.window.isFocusable()) {
      this.window.setFocusable(true);
      this.shouldRestorePetFocusAfterDevTools = true;
    }

    this.window.webContents.openDevTools({ mode: 'detach', activate: true });
  }

  // Get current mode
  getCurrentMode(): 'window' | 'pet' {
    return this.currentMode;
  }
}
