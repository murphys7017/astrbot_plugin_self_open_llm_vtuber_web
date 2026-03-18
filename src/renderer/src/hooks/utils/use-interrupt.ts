import { useAiState } from '@/context/ai-state-context';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { audioManager } from '@/utils/audio-manager';
import { useSubtitle } from '@/context/subtitle-context';
import { useLive2DConfig } from '@/context/live2d-config-context';
import { useLive2DExpression } from '@/hooks/canvas/use-live2d-expression';
import { useCallback } from 'react';

export const useInterrupt = () => {
  const { aiState, setAiState } = useAiState();
  const { sendMessage } = useWebSocket();
  const { fullResponse, clearResponse } = useChatHistory();
  // const { currentModel } = useLive2DModel();
  const { subtitleText, setSubtitleText } = useSubtitle();
  const { modelInfo } = useLive2DConfig();
  const { resetExpression } = useLive2DExpression();

  const interrupt = useCallback((sendSignal = true) => {
    if (aiState !== 'thinking-speaking') return;
    console.log('Interrupting conversation chain');

    audioManager.stopCurrentAudioAndLipSync();

    const lappAdapter = (window as any).getLAppAdapter?.();
    if (lappAdapter) {
      resetExpression(lappAdapter, modelInfo);
    }

    audioTaskQueue.clearQueue();

    setAiState('interrupted');

    if (sendSignal) {
      sendMessage({
        type: 'interrupt-signal',
        text: fullResponse,
      });
    }

    clearResponse();

    if (subtitleText === 'Thinking...') {
      setSubtitleText('');
    }
    console.log('Interrupted!');
  }, [
    aiState,
    clearResponse,
    fullResponse,
    modelInfo,
    resetExpression,
    sendMessage,
    setAiState,
    setSubtitleText,
    subtitleText,
  ]);

  return { interrupt };
};
