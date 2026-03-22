import { ElectronAPI } from '@electron-toolkit/preload';

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setIgnoreMouseEvents: (ignore: boolean) => void
      toggleForceIgnoreMouse: () => void
      toggleDevTools: () => void
      onForceIgnoreMouseChanged: (callback: (isForced: boolean) => void) => void
      onModeChanged: (callback: (mode: 'pet' | 'window') => void) => void
      showContextMenu: (x: number, y: number) => void
      onMicToggle: (callback: () => void) => void
      onInterrupt: (callback: () => void) => void
      updateComponentHover: (componentId: string, isHovering: boolean) => void
      startPetWindowDrag: (screenX: number, screenY: number) => void
      movePetWindowDrag: (screenX: number, screenY: number) => void
      endPetWindowDrag: () => void
      setPetInputFocus: (focused: boolean) => void
      sendPetOverlayText: (payload: { text: string; timestamp?: number } | string) => void
      sendPetOverlayMicToggle: () => void
      sendPetOverlayInterrupt: () => void
      sendPetOverlayState: (state: { aiState: string; lastAIMessage: string; micOn: boolean }) => void
      onPetOverlayState: (callback: (state: { aiState: string; lastAIMessage: string; micOn: boolean }) => void) => () => void
      onPetOverlaySendText: (callback: (payload: { text: string; timestamp?: number } | string) => void) => () => void
      onPetOverlayMicToggle: (callback: () => void) => () => void
      onPetOverlayInterrupt: (callback: () => void) => () => void
      setPetOverlayPreferredHeight: (height: number) => void
      onToggleInputSubtitle: (callback: () => void) => void
      onToggleScrollToResize: (callback: () => void) => void
      onSwitchCharacter: (callback: (filename: string) => void) => void
      setMode: (mode: 'window' | 'pet') => void
      getConfigFiles: () => Promise<any>
      updateConfigFiles: (files: any[]) => void
    }
  }
}

interface IpcRenderer {
  on(channel: 'mode-changed', func: (_event: any, mode: 'pet' | 'window') => void): void;
  send(channel: string, ...args: any[]): void;
}
