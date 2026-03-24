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
  const { setConfName, setConfUid } = useConfig();
  const { startMic, stopMic, autoStartMicOnConvEnd } = useVAD();
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const { interrupt } = useInterrupt();
  const { setBrowserViewData } = useBrowser();
  const sendMessage = useCallback((message: object) => {
    wsService.sendMessage(message);
  }, []);

  const handleControlMessage = useCallback(createControlMessageHandler({
    startMic,
    stopMic,
    stopCurrentAudioAndLipSync,
    setAiState,
    clearResponse,
    autoStartMicOnConvEndRef,
  }), [clearResponse, setAiState, startMic, stopCurrentAudioAndLipSync, stopMic]);

  // 【P0 修复】分离高频动态状态到 ref，避免重新创建 handleWebSocketMessage
  const dynamicStateRef = useRef({
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
    setCurrentHistoryUid,
    setHistoryList,
    setMessages,
    setSubtitleText,
    setForceNewMessage,
    setBrowserViewData,
    setBackgroundFiles: bgUrlContext?.setBackgroundFiles,
    sendMessage,
  });

  // 同步动态状态到 ref（但不触发 useCallback 重建）
  useEffect(() => {
    dynamicStateRef.current = {
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
      setCurrentHistoryUid,
      setHistoryList,
      setMessages,
      setSubtitleText,
      setForceNewMessage,
      setBrowserViewData,
      setBackgroundFiles: bgUrlContext?.setBackgroundFiles,
      sendMessage,
    };
  }, [
    aiState, baseUrl, currentHistoryUid, t, interrupt, addAudioTask,
    handleControlMessage,
    appendHumanMessage, appendOrUpdateToolCallMessage, setAiState,
    setBackendSynthComplete, setModelInfo, setConfName, setConfUid,
    setCurrentHistoryUid, setHistoryList, setMessages,
    setSubtitleText, setForceNewMessage, setBrowserViewData, bgUrlContext, sendMessage,
  ]);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  // 【P0 修复】创建稳定的 handleWebSocketMessage：仅依赖于真正稳定的参数
  const handleWebSocketMessage = useCallback((messageData: any) => {
    const state = dynamicStateRef.current;
    // 使用闭包中的 createWebSocketMessageHandler，但通过 ref 访问最新状态
    return createWebSocketMessageHandler(state)(messageData);
  }, []); // 不依赖任何外部值！

  useEffect(() => {
    wsService.connect(wsUrl);
  }, [wsUrl]);

  // 【P0 修复】分离订阅以消除泄漏
  useEffect(() => {
    const stateSubscription = wsService.onStateChange(setWsState);
    return () => {
      stateSubscription.unsubscribe();
    };
  }, [wsUrl]);

  useEffect(() => {
    const messageSubscription = wsService.onMessage(handleWebSocketMessage);
    return () => {
      messageSubscription.unsubscribe();
    };
  }, [handleWebSocketMessage]);

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
