import { useEffect, useCallback } from "react";
import { useInterrupt } from "@/hooks/utils/use-interrupt";
import { useMicToggle } from "./use-mic-toggle";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import { useMode } from "@/context/mode-context";

export function useIpcHandlers() {
  const { handleMicToggle } = useMicToggle();
  const { interrupt } = useInterrupt();
  const { modelInfo, setModelInfo } = useLive2DConfig();
  const { setForceIgnoreMouse } = useForceIgnoreMouse();
  const { mode } = useMode();
  const isPet = mode === 'pet';

  const micToggleHandler = useCallback(() => {
    handleMicToggle();
  }, [handleMicToggle]);

  const interruptHandler = useCallback(() => {
    interrupt();
  }, [interrupt]);

  const scrollToResizeHandler = useCallback(() => {
    if (modelInfo) {
      setModelInfo({
        ...modelInfo,
        scrollToResize: !modelInfo.scrollToResize,
      });
    }
  }, [modelInfo, setModelInfo]);

  // Handler for force ignore mouse state changes from main process
  const forceIgnoreMouseChangedHandler = useCallback(
    (_event: Electron.IpcRendererEvent, isForced: boolean) => {
      console.log("Force ignore mouse changed:", isForced);
      setForceIgnoreMouse(isForced);
    },
    [setForceIgnoreMouse],
  );

  // Handle toggle force ignore mouse from menu
  const toggleForceIgnoreMouseHandler = useCallback(() => {
    (window.api as any).toggleForceIgnoreMouse();
  }, []);

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    if (!isPet) return;

    window.electron.ipcRenderer.removeListener("mic-toggle", micToggleHandler);
    window.electron.ipcRenderer.removeListener("interrupt", interruptHandler);
    window.electron.ipcRenderer.removeListener(
      "toggle-scroll-to-resize",
      scrollToResizeHandler,
    );
    window.electron.ipcRenderer.removeListener(
      "toggle-force-ignore-mouse",
      toggleForceIgnoreMouseHandler,
    );
    window.electron.ipcRenderer.removeListener(
      "force-ignore-mouse-changed",
      forceIgnoreMouseChangedHandler,
    );

    window.electron.ipcRenderer.on("mic-toggle", micToggleHandler);
    window.electron.ipcRenderer.on("interrupt", interruptHandler);
    window.electron.ipcRenderer.on(
      "toggle-scroll-to-resize",
      scrollToResizeHandler,
    );
    window.electron.ipcRenderer.on(
      "toggle-force-ignore-mouse",
      toggleForceIgnoreMouseHandler,
    );
    window.electron.ipcRenderer.on(
      "force-ignore-mouse-changed",
      forceIgnoreMouseChangedHandler,
    );

    return () => {
      window.electron?.ipcRenderer.removeListener("mic-toggle", micToggleHandler);
      window.electron?.ipcRenderer.removeListener("interrupt", interruptHandler);
      window.electron?.ipcRenderer.removeListener(
        "toggle-scroll-to-resize",
        scrollToResizeHandler,
      );
      window.electron?.ipcRenderer.removeListener(
        "toggle-force-ignore-mouse",
        toggleForceIgnoreMouseHandler,
      );
      window.electron?.ipcRenderer.removeListener(
        "force-ignore-mouse-changed",
        forceIgnoreMouseChangedHandler,
      );
    };
  }, [
    micToggleHandler,
    interruptHandler,
    scrollToResizeHandler,
    toggleForceIgnoreMouseHandler,
    forceIgnoreMouseChangedHandler,
    isPet,
  ]);
}
