import { useVAD } from '@/context/vad-context';
import { useAiState } from '@/context/ai-state-context';

export function useMicToggle() {
  const { startMic, stopMic, micOn, ensureMicrophonePermission } = useVAD();
  const { aiState, setAiState } = useAiState();

  const handleMicToggle = async (): Promise<void> => {
    if (micOn) {
      stopMic();
      if (aiState === 'listening') {
        setAiState('idle');
      }
    } else {
      const granted = await ensureMicrophonePermission();
      if (!granted) return;
      await startMic();
    }
  };

  return {
    handleMicToggle,
    micOn,
  };
}
