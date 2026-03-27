import { useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { useAiState } from '@/context/ai-state-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMediaCapture } from '@/hooks/utils/use-media-capture';
import { markFrontendRequestStart } from '@/utils/timing-debug';

const isPetOverlayWindow = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).get('petOverlay') === '1';
  } catch (_error) {
    return false;
  }
};

export function usePetOverlayBridge() {
  const isElectron = window.api !== undefined;
  const isOverlay = isPetOverlayWindow();
  const { sendMessage } = useWebSocket();
  const { aiState, setAiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { lastAIMessage, appendHumanMessage } = useChatHistory();
  const {
    startMic, stopMic, autoStartMicOn, autoStopMic, micOn,
  } = useVAD();
  const { captureAllMedia } = useMediaCapture();
  const sendInFlightRef = useRef(false);

  // 【P0 修复】使用 useRef 隔离高频状态
  const stateRef = useRef({
    aiState,
    micOn,
  });

  useEffect(() => {
    stateRef.current = { aiState, micOn };
  }, [aiState, micOn]);

  // 【P0 修复】使用 ref 保存最新的状态，用于防抖发送
  const overlayStateRef = useRef({
    aiState,
    lastAIMessage,
    micOn,
  });

  // 【P0 修复】防抖定时器 ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 【P0 修复】上一次发送的状态，避免发送相同数据
  const lastSentStateRef = useRef<string | null>(null);

  // 同步最新状态到 ref
  useEffect(() => {
    overlayStateRef.current = { aiState, lastAIMessage, micOn };
  }, [aiState, lastAIMessage, micOn]);

  // 【P0 修复】防抖发送函数
  const sendOverlayStateDebounced = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (!isElectron || isOverlay) return;

      const currentState = overlayStateRef.current;
      const stateString = JSON.stringify(currentState);

      // 【P0 修复】只在状态真正变化时发送
      if (stateString === lastSentStateRef.current) {
        return;
      }

      lastSentStateRef.current = stateString;
      window.api?.sendPetOverlayState?.(currentState);
    }, 50); // 50ms 防抖，减少 IPC 频率
  }, [isElectron, isOverlay]);

  const handleOverlaySendText = useCallback(async (payload: { text?: string; timestamp?: number } | string) => {
    const rawText = typeof payload === 'string' ? payload : payload?.text ?? '';
    const text = rawText.trim();
    if (!text || sendInFlightRef.current) return;
    sendInFlightRef.current = true;

    try {
      if (stateRef.current.aiState === 'thinking-speaking') {
        interrupt();
      }

      const images = await captureAllMedia();
      appendHumanMessage(text);
      markFrontendRequestStart('text', {
        textLength: text.length,
        imageCount: Array.isArray(images) ? images.length : 0,
      });
      sendMessage({
        type: 'text-input',
        text,
        images,
      });

      if (autoStopMic) {
        stopMic();
      }
    } finally {
      sendInFlightRef.current = false;
    }
  }, [interrupt, captureAllMedia, appendHumanMessage, sendMessage, autoStopMic, stopMic]);

  const handleOverlayInterrupt = useCallback(() => {
    interrupt();
    if (autoStartMicOn) {
      startMic();
    }
  }, [interrupt, autoStartMicOn, startMic]);

  const handleOverlayMicToggle = useCallback(async () => {
    if (stateRef.current.micOn) {
      stopMic();
      if (stateRef.current.aiState === 'listening') {
        setAiState('idle');
      }
      return;
    }

    try {
      await startMic();
    } catch (error) {
      console.error('[PetOverlay] Failed to start microphone:', error);
    }
  }, [setAiState, startMic, stopMic]);

  // 【P0 修复】稳定的事件处理器（依赖不变）
  const stableHandleOverlaySendText = useCallback((payload: { text?: string; timestamp?: number } | string) => {
    void handleOverlaySendText(payload);
  }, [handleOverlaySendText]);

  const stableHandleOverlayMicToggle = useCallback(() => {
    void handleOverlayMicToggle();
  }, [handleOverlayMicToggle]);

  const stableHandleOverlayInterrupt = useCallback(() => {
    handleOverlayInterrupt();
  }, [handleOverlayInterrupt]);

  useEffect(() => {
    if (!isElectron || isOverlay) return;

    const cleanups: Array<() => void> = [];
    const offSendText = window.api?.onPetOverlaySendText?.(stableHandleOverlaySendText);
    if (typeof offSendText === 'function') cleanups.push(offSendText);

    const offMicToggle = window.api?.onPetOverlayMicToggle?.(stableHandleOverlayMicToggle);
    if (typeof offMicToggle === 'function') cleanups.push(offMicToggle);

    const offInterrupt = window.api?.onPetOverlayInterrupt?.(stableHandleOverlayInterrupt);
    if (typeof offInterrupt === 'function') cleanups.push(offInterrupt);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [isElectron, isOverlay, stableHandleOverlayMicToggle, stableHandleOverlaySendText, stableHandleOverlayInterrupt]);

  // 【P0 修复】使用防抖发送 pet overlay 状态
  useEffect(() => {
    if (!isElectron || isOverlay) return;
    sendOverlayStateDebounced();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [aiState, lastAIMessage, micOn, isElectron, isOverlay, sendOverlayStateDebounced]);
}
