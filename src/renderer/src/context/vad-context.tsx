/* eslint-disable no-use-before-define */
import {
  createContext, useContext, useRef, useCallback, useEffect, useReducer, useMemo, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MicVAD } from '@ricky0123/vad-web';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { audioTaskQueue } from '@/utils/task-queue';
import { useSendAudio } from '@/hooks/utils/use-send-audio';
import { SubtitleContext } from './subtitle-context';
import { AiStateContext, AiState } from './ai-state-context';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { toaster } from '@/components/ui/toaster';

/**
 * VAD settings configuration interface
 * @interface VADSettings
 */
export interface VADSettings {
  /** Threshold for positive speech detection (0-100) */
  positiveSpeechThreshold: number;

  /** Threshold for negative speech detection (0-100) */
  negativeSpeechThreshold: number;

  /** Number of frames for speech redemption */
  redemptionFrames: number;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

const DEFAULT_MIC_ID = '__default__';
const MIC_PERMISSION_TIMEOUT_MS = 8000;

/**
 * VAD context state interface
 * @interface VADState
 */
interface VADState {
  /** Auto stop mic feature state */
  autoStopMic: boolean;

  /** Microphone active state */
  micOn: boolean;

  /** Set microphone state */
  setMicOn: (value: boolean) => void;

  /** Set Auto stop mic state */
  setAutoStopMic: (value: boolean) => void;

  /** Start microphone and VAD */
  startMic: () => Promise<void>;

  /** Stop microphone and VAD */
  stopMic: () => void;

  /** Previous speech probability value */
  previousTriggeredProbability: number;

  /** Set previous speech probability */
  setPreviousTriggeredProbability: (value: number) => void;

  /** VAD settings configuration */
  settings: VADSettings;

  /** Update VAD settings */
  updateSettings: (newSettings: VADSettings) => void;

  /** Auto start microphone when AI starts speaking */
  autoStartMicOn: boolean;

  /** Set auto start microphone state */
  setAutoStartMicOn: (value: boolean) => void;

  /** Auto start microphone when conversation ends */
  autoStartMicOnConvEnd: boolean;

  /** Set auto start microphone when conversation ends state */
  setAutoStartMicOnConvEnd: (value: boolean) => void;

  /** Available microphone devices */
  audioInputDevices: AudioInputDevice[];

  /** Currently selected microphone device id */
  selectedMicId: string;

  /** Set microphone device id */
  setSelectedMicId: (deviceId: string) => Promise<void>;

  /** Refresh microphone devices */
  refreshAudioInputDevices: () => Promise<void>;

  /** Request microphone permission and refresh devices */
  ensureMicrophonePermission: () => Promise<boolean>;
}

/**
 * Default values and constants
 */
const DEFAULT_VAD_SETTINGS: VADSettings = {
  positiveSpeechThreshold: 50,
  negativeSpeechThreshold: 35,
  redemptionFrames: 35,
};

const DEFAULT_VAD_STATE = {
  micOn: false,
  autoStopMic: false,
  autoStartMicOn: false,
  autoStartMicOnConvEnd: false,
  selectedMicId: '',
};

/**
 * Create the VAD context
 */
export const VADContext = createContext<VADState | null>(null);

/**
 * VAD Provider Component
 * Manages voice activity detection and microphone state
 *
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function VADProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  // Refs for VAD instance and state
  const vadRef = useRef<MicVAD | null>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);
  const previousTriggeredProbabilityRef = useRef(0);
  const previousAiStateRef = useRef<AiState>('idle');

  // Persistent state management
  const [micOn, setMicOn] = useLocalStorage('micOn', DEFAULT_VAD_STATE.micOn);
  const autoStopMicRef = useRef(true);
  const [autoStopMic, setAutoStopMicState] = useLocalStorage(
    'autoStopMic',
    DEFAULT_VAD_STATE.autoStopMic,
  );
  const [settings, setSettings] = useLocalStorage<VADSettings>(
    'vadSettings',
    DEFAULT_VAD_SETTINGS,
  );
  const [selectedMicId, setSelectedMicIdState] = useLocalStorage(
    'selectedMicId',
    DEFAULT_VAD_STATE.selectedMicId,
  );
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [autoStartMicOn, setAutoStartMicOnState] = useLocalStorage(
    'autoStartMicOn',
    DEFAULT_VAD_STATE.autoStartMicOn,
  );
  const autoStartMicRef = useRef(false);
  const [autoStartMicOnConvEnd, setAutoStartMicOnConvEndState] = useLocalStorage(
    'autoStartMicOnConvEnd',
    DEFAULT_VAD_STATE.autoStartMicOnConvEnd,
  );
  const autoStartMicOnConvEndRef = useRef(false);

  // Force update mechanism for ref updates
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // External hooks and contexts
  const { interrupt } = useInterrupt();
  const { sendAudioPartition } = useSendAudio();
  const { setSubtitleText } = useContext(SubtitleContext)!;
  const { aiState, setAiState } = useContext(AiStateContext)!;

  // Refs for callback stability
  const interruptRef = useRef(interrupt);
  const sendAudioPartitionRef = useRef(sendAudioPartition);
  const aiStateRef = useRef<AiState>(aiState);
  const setSubtitleTextRef = useRef(setSubtitleText);
  const setAiStateRef = useRef(setAiState);

  const isProcessingRef = useRef(false);

  const refreshAudioInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const enumerateMicrophones = async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
          }));
      };

      const microphones = await enumerateMicrophones();

      const normalizedMicrophones = microphones.map((device, index) => ({
        deviceId: device.deviceId || (index === 0 ? DEFAULT_MIC_ID : ''),
        label: device.label || (index === 0 ? 'Default microphone' : `Microphone ${index + 1}`),
      }));

      const visibleMicrophones = normalizedMicrophones.filter((device) => Boolean(device.deviceId));
      setAudioInputDevices(visibleMicrophones);

      if (visibleMicrophones.length === 0) {
        if (selectedMicId) {
          setSelectedMicIdState('');
        }
        return;
      }

      if (!selectedMicId || !visibleMicrophones.some((device) => device.deviceId === selectedMicId)) {
        setSelectedMicIdState(visibleMicrophones[0].deviceId);
      }
    } catch (error) {
      console.error('Failed to enumerate audio input devices:', error);
    }
  }, [selectedMicId, setSelectedMicIdState]);

  const ensureMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return false;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Microphone permission request timed out'));
        }, MIC_PERMISSION_TIMEOUT_MS);
      });

      const probeStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        timeoutPromise,
      ]);
      probeStream.getTracks().forEach((track) => track.stop());
      await refreshAudioInputDevices();
      return true;
    } catch (error) {
      console.warn('Microphone permission request failed:', error);
      toaster.create({
        title: `${t('error.failedStartVAD')}: ${error}`,
        type: 'error',
        duration: 3000,
      });
      return false;
    }
  }, [refreshAudioInputDevices, t]);

  // Update refs when dependencies change
  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);

  useEffect(() => {
    interruptRef.current = interrupt;
  }, [interrupt]);

  useEffect(() => {
    sendAudioPartitionRef.current = sendAudioPartition;
  }, [sendAudioPartition]);

  useEffect(() => {
    setSubtitleTextRef.current = setSubtitleText;
  }, [setSubtitleText]);

  useEffect(() => {
    setAiStateRef.current = setAiState;
  }, [setAiState]);

  useEffect(() => {
    autoStopMicRef.current = autoStopMic;
  }, []);

  useEffect(() => {
    autoStartMicRef.current = autoStartMicOn;
  }, []);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, []);

  useEffect(() => {
    void refreshAudioInputDevices();

    if (!navigator.mediaDevices?.addEventListener) return undefined;

    const handleDeviceChange = () => {
      void refreshAudioInputDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshAudioInputDevices]);

  /**
   * Update previous triggered probability and force re-render
   */
  const setPreviousTriggeredProbability = useCallback((value: number) => {
    previousTriggeredProbabilityRef.current = value;
    forceUpdate();
  }, []);

  /**
   * Handle speech start event (initial detection)
   */
  const handleSpeechStart = useCallback(() => {
    console.log('Speech started - saving current state');
    // Save current AI state but DON'T change to listening yet
    previousAiStateRef.current = aiStateRef.current;
    isProcessingRef.current = true;
    // Don't change state here - wait for onSpeechRealStart
  }, []);

  /**
   * Handle real speech start event (confirmed speech)
   */
  const handleSpeechRealStart = useCallback(() => {
    console.log('Real speech confirmed - checking if need to interrupt');
    // Check if we need to interrupt based on the PREVIOUS state (before speech started)
    if (previousAiStateRef.current === 'thinking-speaking') {
      console.log('Interrupting AI speech due to user speaking');
      interruptRef.current();
    }
    // Now change to listening state
    setAiStateRef.current('listening');
  }, []);

  /**
   * Handle frame processing event
   */
  const handleFrameProcessed = useCallback((probs: { isSpeech: number }) => {
    if (probs.isSpeech > previousTriggeredProbabilityRef.current) {
      setPreviousTriggeredProbability(probs.isSpeech);
    }
  }, []);

  /**
   * Handle speech end event
   */
  const handleSpeechEnd = useCallback((audio: Float32Array) => {
    if (!isProcessingRef.current) return;
    console.log('Speech ended');
    audioTaskQueue.clearQueue();

    if (autoStopMicRef.current) {
      stopMic();
    } else {
      console.log('Auto stop mic is OFF, keeping mic active');
    }

    setPreviousTriggeredProbability(0);
    sendAudioPartitionRef.current(audio);
    isProcessingRef.current = false;
    setAiStateRef.current("thinking-speaking");
  }, []);

  /**
   * Handle VAD misfire event
   */
  const handleVADMisfire = useCallback(() => {
    if (!isProcessingRef.current) return;
    console.log('VAD misfire detected');
    setPreviousTriggeredProbability(0);
    isProcessingRef.current = false;

    // Restore previous AI state and show helpful misfire message
    setAiStateRef.current(previousAiStateRef.current);
    setSubtitleTextRef.current(t('error.vadMisfire'));
  }, [t]);

  /**
   * Update VAD settings and restart if active
   */
  const updateSettings = useCallback((newSettings: VADSettings) => {
    setSettings(newSettings);
    if (vadRef.current) {
      stopMic();
      setTimeout(() => {
        startMic();
      }, 100);
    }
  }, []);

  /**
   * Initialize new VAD instance
   */
  const initVAD = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: selectedMicId && selectedMicId !== DEFAULT_MIC_ID
        ? {
          deviceId: { exact: selectedMicId },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
        : {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
    });

    currentStreamRef.current = stream;

    const newVAD = await MicVAD.new({
      model: "v5",
      stream,
      preSpeechPadFrames: 20,
      positiveSpeechThreshold: settings.positiveSpeechThreshold / 100,
      negativeSpeechThreshold: settings.negativeSpeechThreshold / 100,
      redemptionFrames: settings.redemptionFrames,
      baseAssetPath: './libs/',
      onnxWASMBasePath: './libs/',
      onSpeechStart: handleSpeechStart,
      onSpeechRealStart: handleSpeechRealStart,
      onFrameProcessed: handleFrameProcessed,
      onSpeechEnd: handleSpeechEnd,
      onVADMisfire: handleVADMisfire,
    });

    vadRef.current = newVAD;
    newVAD.start();
    await refreshAudioInputDevices();
  }, [
    handleFrameProcessed,
    handleSpeechEnd,
    handleSpeechRealStart,
    handleSpeechStart,
    handleVADMisfire,
    refreshAudioInputDevices,
    selectedMicId,
    settings.negativeSpeechThreshold,
    settings.positiveSpeechThreshold,
    settings.redemptionFrames,
  ]);

  /**
   * Start microphone and VAD processing
   */
  const startMic = useCallback(async () => {
    try {
      if (!vadRef.current) {
        console.log('Initializing VAD');
        await initVAD();
      } else {
        console.log('Starting VAD');
        vadRef.current.start();
      }
      setMicOn(true);
    } catch (error) {
      console.error('Failed to start VAD:', error);
      toaster.create({
        title: `${t('error.failedStartVAD')}: ${error}`,
        type: 'error',
        duration: 2000,
      });
    }
  }, [initVAD, t]);

  /**
   * Stop microphone and VAD processing
   */
  const stopMic = useCallback(() => {
    console.log('Stopping VAD');
    if (vadRef.current) {
      vadRef.current.pause();
      vadRef.current.destroy();
      vadRef.current = null;
      console.log('VAD stopped and destroyed successfully');
      setPreviousTriggeredProbability(0);
    } else {
      console.log('VAD instance not found');
    }
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach((track) => track.stop());
      currentStreamRef.current = null;
    }
    setMicOn(false);
    isProcessingRef.current = false;
  }, []);

  /**
   * Set Auto stop mic state
   */
  const setAutoStopMic = useCallback((value: boolean) => {
    autoStopMicRef.current = value;
    setAutoStopMicState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOn = useCallback((value: boolean) => {
    autoStartMicRef.current = value;
    setAutoStartMicOnState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOnConvEnd = useCallback((value: boolean) => {
    autoStartMicOnConvEndRef.current = value;
    setAutoStartMicOnConvEndState(value);
    forceUpdate();
  }, []);

  const setSelectedMicId = useCallback(async (deviceId: string) => {
    if (deviceId === selectedMicId) return;

    setSelectedMicIdState(deviceId);

    if (micOn) {
      stopMic();
      setTimeout(() => {
        void startMic();
      }, 100);
    }
  }, [micOn, selectedMicId, setSelectedMicIdState, startMic, stopMic]);

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      autoStopMic: autoStopMicRef.current,
      micOn,
      setMicOn,
      setAutoStopMic,
      startMic,
      stopMic,
      previousTriggeredProbability: previousTriggeredProbabilityRef.current,
      setPreviousTriggeredProbability,
      settings,
      updateSettings,
      autoStartMicOn: autoStartMicRef.current,
      setAutoStartMicOn,
      autoStartMicOnConvEnd: autoStartMicOnConvEndRef.current,
      setAutoStartMicOnConvEnd,
      audioInputDevices,
      selectedMicId,
      setSelectedMicId,
      refreshAudioInputDevices,
      ensureMicrophonePermission,
    }),
    [
      audioInputDevices,
      ensureMicrophonePermission,
      micOn,
      refreshAudioInputDevices,
      selectedMicId,
      setSelectedMicId,
      startMic,
      stopMic,
      settings,
      updateSettings,
    ],
  );

  return (
    <VADContext.Provider value={contextValue}>
      {children}
    </VADContext.Provider>
  );
}

/**
 * Custom hook to use the VAD context
 * @throws {Error} If used outside of VADProvider
 */
export function useVAD() {
  const context = useContext(VADContext);

  if (!context) {
    throw new Error('useVAD must be used within a VADProvider');
  }

  return context;
}
