interface Window {
  api?: {
    setIgnoreMouseEvents: (ignore: boolean) => void
    showContextMenu?: () => void
    onModeChanged: (callback: (mode: string) => void) => void
    updateComponentHover?: (componentId: string, isHovering: boolean) => void
    toggleForceIgnoreMouse?: () => void
    startPetWindowDrag?: (screenX: number, screenY: number) => void
    movePetWindowDrag?: (screenX: number, screenY: number) => void
    endPetWindowDrag?: () => void
    setPetInputFocus?: (focused: boolean) => void
    sendPetOverlayText?: (text: string) => void
    sendPetOverlayMicToggle?: () => void
    sendPetOverlayInterrupt?: () => void
    sendPetOverlayState?: (state: { aiState: string; lastAIMessage: string; micOn: boolean }) => void
    onPetOverlayState?: (
      callback: (state: { aiState: string; lastAIMessage: string; micOn: boolean }) => void
    ) => (() => void) | void
    onPetOverlaySendText?: (callback: (text: string) => void) => (() => void) | void
    onPetOverlayMicToggle?: (callback: () => void) => (() => void) | void
    onPetOverlayInterrupt?: (callback: () => void) => (() => void) | void
    setPetOverlayPreferredHeight?: (height: number) => void
  }
}
