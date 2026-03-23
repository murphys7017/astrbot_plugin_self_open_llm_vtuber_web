import { useRef, useState } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { useAiState } from '@/context/ai-state-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMediaCapture } from '@/hooks/utils/use-media-capture';
import { markFrontendRequestStart } from '@/utils/timing-debug';

export function useTextInput() {
  const [inputText, setInputText] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const sendInFlightRef = useRef(false);
  const wsContext = useWebSocket();
  const { aiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { appendHumanMessage } = useChatHistory();
  const { stopMic, autoStopMic } = useVAD();
  const { captureAllMedia } = useMediaCapture();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
  };

  const handleSend = async () => {
    const trimmedText = inputText.trim();
    if (!trimmedText || !wsContext || sendInFlightRef.current) return;
    sendInFlightRef.current = true;

    try {
      if (aiState === 'thinking-speaking') {
        interrupt();
      }

      const images = await captureAllMedia();

      appendHumanMessage(trimmedText);
      markFrontendRequestStart('text', {
        textLength: trimmedText.length,
        imageCount: Array.isArray(images) ? images.length : 0,
      });
      wsContext.sendMessage({
        type: 'text-input',
        text: trimmedText,
        images,
      });

      if (autoStopMic) stopMic();
      setInputText('');
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing || (e.nativeEvent as any)?.isComposing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCompositionStart = () => setIsComposing(true);
  const handleCompositionEnd = () => setIsComposing(false);

  return {
    inputText,
    setInputText: handleInputChange,
    handleSend,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
  };
}
