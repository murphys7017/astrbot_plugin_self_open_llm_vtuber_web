/* eslint-disable no-shadow */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { memo, useRef, useEffect } from "react";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useIpcHandlers } from "@/hooks/utils/use-ipc-handlers";
import { useLive2DModel } from "@/hooks/canvas/use-live2d-model";
import { useLive2DResize } from "@/hooks/canvas/use-live2d-resize";
import { useAiState, AiStateEnum } from "@/context/ai-state-context";
import { useLive2DExpression } from "@/hooks/canvas/use-live2d-expression";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import { useMode } from "@/context/mode-context";
import { setLimitedFrameRate } from "../../../WebSDK/src/lappdefine";

interface Live2DProps {
  showSidebar?: boolean;
}

export const Live2D = memo(
  ({ showSidebar }: Live2DProps): JSX.Element => {
    const ACTIVE_RENDER_FPS = 60;
    const IDLE_RENDER_FPS = 30;
    const BACKGROUND_RENDER_FPS = 12;

    const { forceIgnoreMouse } = useForceIgnoreMouse();
    const { modelInfo } = useLive2DConfig();
    const { mode } = useMode();
    const internalContainerRef = useRef<HTMLDivElement>(null);
    const { aiState } = useAiState();
    const { resetExpression } = useLive2DExpression();
    const isPet = mode === 'pet';

    // Get canvasRef from useLive2DResize
    const { canvasRef } = useLive2DResize({
      containerRef: internalContainerRef,
      modelInfo,
      showSidebar,
    });

    // Pass canvasRef to useLive2DModel
    const { isDragging, handlers } = useLive2DModel({
      modelInfo,
      canvasRef,
    });

    // Setup hooks
    useIpcHandlers();

    useEffect(() => {
      const applyAdaptiveFrameRate = () => {
        const isBackgrounded = document.hidden || !document.hasFocus();
        const nextFrameRate = isBackgrounded
          ? BACKGROUND_RENDER_FPS
          : (isDragging || aiState === AiStateEnum.THINKING_SPEAKING)
            ? ACTIVE_RENDER_FPS
            : IDLE_RENDER_FPS;

        setLimitedFrameRate(nextFrameRate);
      };

      applyAdaptiveFrameRate();
      document.addEventListener('visibilitychange', applyAdaptiveFrameRate);
      window.addEventListener('focus', applyAdaptiveFrameRate);
      window.addEventListener('blur', applyAdaptiveFrameRate);

      return () => {
        document.removeEventListener('visibilitychange', applyAdaptiveFrameRate);
        window.removeEventListener('focus', applyAdaptiveFrameRate);
        window.removeEventListener('blur', applyAdaptiveFrameRate);
        setLimitedFrameRate(ACTIVE_RENDER_FPS);
      };
    }, [aiState, isDragging]);

    // Reset expression to default when AI state becomes idle
    useEffect(() => {
      if (aiState !== AiStateEnum.IDLE) {
        return undefined;
      }

      let cancelled = false;
      let timerId: number | null = null;

      const tryResetExpression = () => {
        if (cancelled) {
          return;
        }

        if (modelInfo?.defaultEmotion === undefined) {
          return;
        }

        const lappAdapter = (window as any).getLAppAdapter?.();
        const model = lappAdapter?.getModel?.();
        const expressionCount = model?._modelSetting?.getExpressionCount?.() ?? 0;
        const loadedExpressionCount = lappAdapter?.getExpressionCount?.() ?? 0;
        const isReady = Boolean(
          lappAdapter
          && model
          && model._modelSetting
          && (expressionCount === 0 || loadedExpressionCount >= expressionCount),
        );

        if (!isReady) {
          timerId = window.setTimeout(tryResetExpression, 100);
          return;
        }

        resetExpression(lappAdapter, modelInfo);
      };

      tryResetExpression();

      return () => {
        cancelled = true;
        if (timerId !== null) {
          window.clearTimeout(timerId);
        }
      };
    }, [aiState, modelInfo, resetExpression]);

    const handlePointerDown = (e: React.PointerEvent) => {
      handlers.onMouseDown(e);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
      if (!isPet) {
        return;
      }

      e.preventDefault();
      window.api?.showContextMenu?.();
    };

    return (
      <div
        ref={internalContainerRef} // Ref for useLive2DResize if it observes this element
        id="live2d-internal-wrapper"
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto",
          overflow: "hidden",
          position: "relative",
          cursor: isDragging ? "grabbing" : "default",
        }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        {...handlers}
      >
        <canvas
          id="canvas"
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto",
            display: "block",
            cursor: isDragging ? "grabbing" : "default",
          }}
        />
      </div>
    );
  },
);

Live2D.displayName = "Live2D";
