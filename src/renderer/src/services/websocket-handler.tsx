/* eslint-disable no-sparse-arrays */
/* eslint-disable react-hooks/exhaustive-deps */
// eslint-disable-next-line object-curly-newline
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { wsService } from '@/services/websocket-service';
import {
  WebSocketContext, defaultWsUrl, defaultBaseUrl,
} from '@/context/websocket-context';
import { useLive2DConfig } from '@/context/live2d-config-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useAudioTask } from '@/hooks/utils/use-audio-task';
import { useBgUrl } from '@/context/bgurl-context';
import { useConfig } from '@/context/character-config-context';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useAiState } from "@/context/ai-state-context";
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useBrowser } from '@/context/browser-context';
import {
  createControlMessageHandler,
  createWebSocketMessageHandler,
} from './websocket-message-router';

function WebSocketHandler({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [wsState, setWsState] = useState<string>('CLOSED');
  const [wsUrl, setWsUrl] = useLocalStorage<string>('wsUrl', defaultWsUrl);
  const [baseUrl, setBaseUrl] = useLocalStorage<string>('baseUrl', defaultBaseUrl);
  const { aiState, setAiState, setBackendSynthComplete } = useAiState();
  const { setModelInfo } = useLive2DConfig();
  const { setSubtitleText } = useSubtitle();
  const {
    clearResponse,
    setForceNewMessage,
    appendHumanMessage,
    appendOrUpdateToolCallMessage,
    currentHistoryUid,
    setCurrentHistoryUid,
    setMessages,
    setHistoryList,
  } = useChatHistory();
  const { addAudioTask, stopCurrentAudioAndLipSync } = useAudioTask();
  const bgUrlContext = useBgUrl();
  const { setConfName, setConfUid, setConfigFiles } = useConfig();
  const { startMic, stopMic, autoStartMicOnConvEnd } = useVAD();
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const { interrupt } = useInterrupt();
  const { setBrowserViewData } = useBrowser();

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  const handleControlMessage = useCallback(createControlMessageHandler({
    startMic,
    stopMic,
    stopCurrentAudioAndLipSync,
    setAiState,
    clearResponse,
    autoStartMicOnConvEndRef,
  }), [clearResponse, setAiState, startMic, stopCurrentAudioAndLipSync, stopMic]);

  const handleWebSocketMessage = useCallback(createWebSocketMessageHandler({
    aiState,
    baseUrl,
    currentHistoryUid,
    t,
    interrupt,
    handleControlMessage,
    addAudioTask,
    appendHumanMessage,
    appendOrUpdateToolCallMessage,
    setAiState,
    setBackendSynthComplete,
    setModelInfo,
    setConfName,
    setConfUid,
    setConfigFiles,
    setCurrentHistoryUid,
    setHistoryList,
    setMessages,
    setSubtitleText,
    setForceNewMessage,
    setBrowserViewData,
    setBackgroundFiles: bgUrlContext?.setBackgroundFiles,
    sendMessage: wsService.sendMessage.bind(wsService),
  }), [aiState, addAudioTask, appendHumanMessage, appendOrUpdateToolCallMessage, baseUrl, bgUrlContext, currentHistoryUid, handleControlMessage, interrupt, setAiState, setBackendSynthComplete, setBrowserViewData, setConfName, setConfUid, setConfigFiles, setCurrentHistoryUid, setForceNewMessage, setHistoryList, setMessages, setModelInfo, setSubtitleText, t]);

  useEffect(() => {
    wsService.connect(wsUrl);
  }, [wsUrl]);

  useEffect(() => {
    const stateSubscription = wsService.onStateChange(setWsState);
    const messageSubscription = wsService.onMessage(handleWebSocketMessage);
    return () => {
      stateSubscription.unsubscribe();
      messageSubscription.unsubscribe();
    };
  }, [wsUrl, handleWebSocketMessage]);

  const webSocketContextValue = useMemo(() => ({
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState,
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl,
    baseUrl,
    setBaseUrl,
  }), [wsState, wsUrl, baseUrl]);

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;
