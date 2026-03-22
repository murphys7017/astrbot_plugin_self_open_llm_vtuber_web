import { useEffect, useMemo, useCallback } from 'react';
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
  const { messages, appendHumanMessage } = useChatHistory();
  const {
    startMic, stopMic, autoStartMicOn, autoStopMic, micOn,
  } = useVAD();
  const { captureAllMedia } = useMediaCapture();

  const lastAIMessage = useMemo(
    () => messages
      .filter((msg) => msg.role === 'ai')
      .slice(-1)
      .map((msg) => msg.content)[0] || '',
    [messages],
  );

  const handleOverlaySendText = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;

    if (aiState === 'thinking-speaking') {
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
  }, [aiState, interrupt, captureAllMedia, appendHumanMessage, sendMessage, autoStopMic, stopMic]);

  const handleOverlayInterrupt = useCallback(() => {
    interrupt();
    if (autoStartMicOn) {
      startMic();
    }
  }, [interrupt, autoStartMicOn, startMic]);

  const handleOverlayMicToggle = useCallback(async () => {
    if (micOn) {
      stopMic();
      if (aiState === 'listening') {
        setAiState('idle');
      }
      return;
    }

    try {
      await startMic();
    } catch (error) {
      console.error('[PetOverlay] Failed to start microphone:', error);
    }
  }, [aiState, micOn, setAiState, startMic, stopMic]);

  useEffect(() => {
    if (!isElectron || isOverlay) return;

    const cleanups: Array<() => void> = [];
    const offSendText = window.api?.onPetOverlaySendText?.((text) => {
      void handleOverlaySendText(text);
    });
    if (typeof offSendText === 'function') cleanups.push(offSendText);

    const offMicToggle = window.api?.onPetOverlayMicToggle?.(() => {
      void handleOverlayMicToggle();
    });
    if (typeof offMicToggle === 'function') cleanups.push(offMicToggle);

    const offInterrupt = window.api?.onPetOverlayInterrupt?.(() => {
      handleOverlayInterrupt();
    });
    if (typeof offInterrupt === 'function') cleanups.push(offInterrupt);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [isElectron, isOverlay, handleOverlayMicToggle, handleOverlaySendText, handleOverlayInterrupt]);

  useEffect(() => {
    if (!isElectron || isOverlay) return;

    window.api?.sendPetOverlayState?.({
      aiState,
      lastAIMessage,
      micOn,
    });
  }, [aiState, lastAIMessage, micOn, isElectron, isOverlay]);
}
