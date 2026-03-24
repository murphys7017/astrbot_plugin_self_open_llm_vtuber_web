import { toaster } from '@/components/ui/toaster';
import { HistoryInfo } from '@/context/websocket-context';
import { MessageEvent } from '@/services/websocket-service';
import { audioTaskQueue } from '@/utils/task-queue';
import {
  getPendingFrontendRequestType,
  markFrontendFirstResponse,
  markFrontendTranscriptionReceived,
} from '@/utils/timing-debug';

const inlineAnimTagPattern = /<@anim\s*\{[\s\S]*?\}>\s*/gi;
const legacyExpressionTagPattern = /<~[^~]*~>\s*/gi;

export const sanitizeDisplayTextValue = (text: string) => {
  return text
    .replace(inlineAnimTagPattern, '')
    .replace(legacyExpressionTagPattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const sanitizeDisplayTextPayload = <T extends { text: string } | null | undefined>(
  payload: T,
): T => {
  if (!payload || typeof payload.text !== 'string') {
    return payload;
  }

  const sanitizedText = sanitizeDisplayTextValue(payload.text);
  if (sanitizedText === payload.text) {
    return payload;
  }

  return {
    ...payload,
    text: sanitizedText,
  };
};

export const normalizeModelInfo = (modelInfo: any, baseUrl: string) => {
  if (!modelInfo) {
    return modelInfo;
  }

  const url = typeof modelInfo.url === 'string' ? modelInfo.url : '';
  if (!url || url.startsWith('http')) {
    return modelInfo;
  }

  return {
    ...modelInfo,
    url: `${baseUrl}${url}`,
  };
};

export const resolvePreferredHistoryUid = (
  histories: HistoryInfo[],
  currentHistoryUid: string | null,
) => {
  if (!histories.length) {
    return null;
  }

  return currentHistoryUid && histories.some((history) => history.uid === currentHistoryUid)
    ? currentHistoryUid
    : histories[0].uid;
};

type ControlHandlerDeps = {
  startMic: () => void;
  stopMic: () => void;
  stopCurrentAudioAndLipSync: () => void;
  setAiState: (value: any) => void;
  clearResponse: () => void;
  autoStartMicOnConvEndRef: { current: boolean };
};

export const createControlMessageHandler = ({
  startMic,
  stopMic,
  stopCurrentAudioAndLipSync,
  setAiState,
  clearResponse,
  autoStartMicOnConvEndRef,
}: ControlHandlerDeps) => {
  return (controlText: string) => {
    switch (controlText) {
      case 'start-mic':
        startMic();
        break;
      case 'stop-mic':
        stopMic();
        break;
      case 'conversation-chain-start':
        stopCurrentAudioAndLipSync();
        audioTaskQueue.clearQueue();
        setAiState('thinking-speaking');
        clearResponse();
        break;
      case 'conversation-chain-end':
        audioTaskQueue.addTask(() => new Promise<void>((resolve) => {
          setAiState((currentState: any) => {
            if (currentState === 'thinking-speaking') {
              if (autoStartMicOnConvEndRef.current) {
                startMic();
              }
              return 'idle';
            }
            return currentState;
          });
          resolve();
        }));
        break;
      case 'interrupt':
        stopCurrentAudioAndLipSync();
        audioTaskQueue.clearQueue();
        setAiState('interrupted');
        clearResponse();
        break;
      default:
        console.warn('Unknown control command:', controlText);
    }
  };
};

type RouterDeps = {
  aiState: string;
  baseUrl: string;
  currentHistoryUid: string | null;
  t: (key: string) => string;
  interrupt: (sendSignal?: boolean) => void;
  handleControlMessage: (controlText: string) => void;
  addAudioTask: (task: {
    audioUrl: string;
    displayText?: any;
    expressions?: any;
    motions?: any;
    expressionDecision?: any;
    forwarded?: boolean;
  }) => void;
  appendHumanMessage: (text: string) => void;
  appendOrUpdateToolCallMessage: (message: any) => void;
  setAiState: (value: any) => void;
  setBackendSynthComplete: (value: boolean) => void;
  setModelInfo: (value: any) => void;
  setConfName: (value: string) => void;
  setConfUid: (value: string) => void;
  setCurrentHistoryUid: (value: string | null) => void;
  setHistoryList: (value: any) => void;
  setMessages: (value: any) => void;
  setSubtitleText: (value: string) => void;
  setForceNewMessage: (value: boolean) => void;
  setBrowserViewData: (value: any) => void;
  setBackgroundFiles?: (files: any) => void;
  sendMessage: (message: object) => void;
};

export const createWebSocketMessageHandler = ({
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
  setBackgroundFiles,
  sendMessage,
}: RouterDeps) => {
  return (message: MessageEvent) => {
    switch (message.type) {
      case 'control':
        if (message.text) {
          handleControlMessage(message.text);
        }
        break;
      case 'set-model-and-conf':
        setAiState('loading');
        if (message.conf_name) {
          setConfName(message.conf_name);
        }
        if (message.conf_uid) {
          setConfUid(message.conf_uid);
        }
        setModelInfo(normalizeModelInfo(message.model_info, baseUrl));
        setAiState('idle');
        break;
      case 'full-text':
        break;
      case 'background-files':
        if (message.files && setBackgroundFiles) {
          setBackgroundFiles(message.files);
        }
        break;
      case 'audio':
        markFrontendFirstResponse('audio', {
          hasAudioUrl: Boolean(message.audio_url),
        });
        if (aiState !== 'interrupted' && aiState !== 'listening') {
          const sanitizedDisplayText = sanitizeDisplayTextPayload(message.display_text || null);
          const normalizedDisplayText = sanitizedDisplayText?.text
            ? sanitizedDisplayText
            : null;
          addAudioTask({
            audioUrl: message.audio_url || '',
            displayText: normalizedDisplayText,
            expressions: message.actions?.expressions || null,
            motions: message.actions?.motions || null,
            expressionDecision: message.actions?.expression_decision || null,
            forwarded: message.forwarded || false,
          });
        }
        break;
      case 'history-data':
        if (message.messages) {
          setMessages(message.messages);
        }
        toaster.create({
          title: t('notification.historyLoaded'),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'new-history-created':
        setAiState('idle');
        if (message.history_uid && !currentHistoryUid) {
          setSubtitleText(t('notification.newConversation'));
          setCurrentHistoryUid(message.history_uid);
          setMessages([]);
          const newHistory: HistoryInfo = {
            uid: message.history_uid,
            latest_message: null,
            timestamp: new Date().toISOString(),
          };
          setHistoryList((prev: HistoryInfo[]) => [newHistory, ...prev]);
          toaster.create({
            title: t('notification.newChatHistory'),
            type: 'success',
            duration: 2000,
          });
        }
        break;
      case 'history-deleted':
        toaster.create({
          title: message.success
            ? t('notification.historyDeleteSuccess')
            : t('notification.historyDeleteFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'history-list':
        if (message.histories) {
          setHistoryList(message.histories);
          const preferredHistoryUid = resolvePreferredHistoryUid(
            message.histories,
            currentHistoryUid,
          );
          if (preferredHistoryUid) {
            setCurrentHistoryUid(preferredHistoryUid);
            sendMessage({
              type: 'fetch-and-set-history',
              history_uid: preferredHistoryUid,
            });
          } else {
            setCurrentHistoryUid(null);
            setMessages([]);
          }
        }
        break;
      case 'user-input-transcription':
        if (message.text && getPendingFrontendRequestType() === 'voice') {
          markFrontendTranscriptionReceived(message.text);
          appendHumanMessage(message.text);
        }
        break;
      case 'error':
        markFrontendFirstResponse('error');
        toaster.create({
          title: message.message,
          type: 'error',
          duration: 2000,
        });
        break;
      case 'backend-synth-complete':
        setBackendSynthComplete(true);
        break;
      case 'heartbeat-ack':
      case 'group-update':
        break;
      case 'conversation-chain-end':
        markFrontendFirstResponse('conversation-chain-end');
        if (!audioTaskQueue.hasTask()) {
          setAiState((currentState: any) => {
            if (currentState === 'thinking-speaking') {
              return 'idle';
            }
            return currentState;
          });
        }
        break;
      case 'force-new-message':
        markFrontendFirstResponse('force-new-message');
        setForceNewMessage(true);
        break;
      case 'interrupt-signal':
        interrupt(false);
        break;
      case 'tool_call_status':
        if (message.tool_id && message.tool_name && message.status) {
          if (message.browser_view) {
            setBrowserViewData(message.browser_view);
          }

          appendOrUpdateToolCallMessage({
            id: message.tool_id,
            type: 'tool_call_status',
            role: 'ai',
            tool_id: message.tool_id,
            tool_name: message.tool_name,
            name: message.name,
            status: message.status as ('running' | 'completed' | 'error'),
            content: message.content || '',
            timestamp: message.timestamp || new Date().toISOString(),
          });
        } else {
          console.warn('Received incomplete tool_call_status message:', message);
        }
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  };
};
