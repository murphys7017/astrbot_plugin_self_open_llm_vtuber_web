import { useEffect, useCallback, useRef } from "react";
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

  // 【P0 修复】使用 ref 保存最新状态，避免 handler 引用变化
  const stateRef = useRef({
    handleMicToggle,
    interrupt,
    modelInfo,
    setModelInfo,
    setForceIgnoreMouse,
  });

  // 同步最新状态到 ref（不触发任何重新渲染）
  useEffect(() => {
    stateRef.current = {
      handleMicToggle,
      interrupt,
      modelInfo,
      setModelInfo,
      setForceIgnoreMouse,
    };
  }, [handleMicToggle, interrupt, modelInfo, setModelInfo, setForceIgnoreMouse]);

  // 【P0 修复】创建稳定的 handler（引用永远不变）
  const stableMicToggleHandler = useCallback(() => {
    stateRef.current.handleMicToggle();
  }, []);

  const stableInterruptHandler = useCallback(() => {
    stateRef.current.interrupt();
  }, []);

  const stableScrollToResizeHandler = useCallback(() => {
    const { modelInfo: currentModelInfo, setModelInfo: currentSetModelInfo } = stateRef.current;
    if (currentModelInfo) {
      currentSetModelInfo({
        ...currentModelInfo,
        scrollToResize: !currentModelInfo.scrollToResize,
      });
    }
  }, []);

  const stableForceIgnoreMouseChangedHandler = useCallback(
    (_event: Electron.IpcRendererEvent, isForced: boolean) => {
      console.log("Force ignore mouse changed:", isForced);
      stateRef.current.setForceIgnoreMouse(isForced);
    },
    [],
  );

  const stableToggleForceIgnoreMouseHandler = useCallback(() => {
    (window.api as any).toggleForceIgnoreMouse();
  }, []);

  // 【P0 修复】只在 isPet 变化时注册/注销监听器
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    if (!isPet) return;

    const ipc = window.electron.ipcRenderer;

    ipc.on("mic-toggle", stableMicToggleHandler);
    ipc.on("interrupt", stableInterruptHandler);
    ipc.on("toggle-scroll-to-resize", stableScrollToResizeHandler);
    ipc.on("toggle-force-ignore-mouse", stableToggleForceIgnoreMouseHandler);
    ipc.on("force-ignore-mouse-changed", stableForceIgnoreMouseChangedHandler);

    return () => {
      ipc.removeListener("mic-toggle", stableMicToggleHandler);
      ipc.removeListener("interrupt", stableInterruptHandler);
      ipc.removeListener("toggle-scroll-to-resize", stableScrollToResizeHandler);
      ipc.removeListener("toggle-force-ignore-mouse", stableToggleForceIgnoreMouseHandler);
      ipc.removeListener("force-ignore-mouse-changed", stableForceIgnoreMouseChangedHandler);
    };
  }, [
    isPet,
    stableMicToggleHandler,
    stableInterruptHandler,
    stableScrollToResizeHandler,
    stableToggleForceIgnoreMouseHandler,
    stableForceIgnoreMouseChangedHandler,
  ]);
}
