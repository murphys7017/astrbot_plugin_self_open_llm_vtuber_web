/* eslint-disable func-names */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { audioManager } from '@/utils/audio-manager';
import { toaster } from '@/components/ui/toaster';
import { useWebSocket } from '@/context/websocket-context';
import { DisplayText } from '@/services/websocket-service';
import { useLive2DExpression } from '@/hooks/canvas/use-live2d-expression';
import { useLive2DConfig } from '@/context/live2d-config-context';
import * as LAppDefine from '../../../WebSDK/src/lappdefine';
import {
  AudioPlaybackRuntimeDeps,
  ExpressionDecisionPayload,
  findMappedExpression as findMappedExpressionHelper,
  findModelExpressionMatch as findModelExpressionMatchHelper,
  playResolvedMotion as playResolvedMotionHelper,
  resolvePlaybackExpression as resolvePlaybackExpressionHelper,
  resolvePlaybackMotion as resolvePlaybackMotionHelper,
  runAudioPlaybackLifecycle,
} from './audio-task-helpers';

interface AudioTaskOptions {
  audioUrl: string
  displayText?: DisplayText | null
  expressions?: string[] | number[] | null
  motions?: string[] | null
  expressionDecision?: ExpressionDecisionPayload | null
  forwarded?: boolean
}

/**
 * Custom hook for handling audio playback tasks with Live2D lip sync
 */
export const useAudioTask = () => {
  const { t } = useTranslation();
  const { aiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setSubtitleText } = useSubtitle();
  const { appendResponse, appendAIMessage, fullResponse } = useChatHistory();
  const { sendMessage } = useWebSocket();
  const { modelInfo } = useLive2DConfig();
  const { setExpression, setExpressionWithRetry, resetExpression } = useLive2DExpression();
  const expressionOnlyHoldMs = 900;

  // State refs to avoid stale closures
  const stateRef = useRef({
    aiState,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
    fullResponse,
  });

  // Note: currentAudioRef and currentModelRef are now managed by the global audioManager

  stateRef.current = {
    aiState,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
    fullResponse,
  };

  /**
   * Stop current audio playback and lip sync (delegates to global audioManager)
   */
  const resetModelExpression = useCallback(() => {
    const lappAdapter = (window as any).getLAppAdapter?.();
    if (!lappAdapter) {
      console.warn('[AudioTask] LAppAdapter not found for expression reset');
      return;
    }

    resetExpression(lappAdapter, modelInfo);
  }, [modelInfo, resetExpression]);

  const stopCurrentAudioAndLipSync = useCallback(() => {
    audioManager.stopCurrentAudioAndLipSync();
    resetModelExpression();
    setSubtitleText('');
  }, [resetModelExpression, setSubtitleText]);

  const findMappedExpression = useCallback((key?: string): string | number | null => {
    return findMappedExpressionHelper(modelInfo?.emotionMap, key);
  }, [modelInfo?.emotionMap]);

  const findModelExpressionMatch = useCallback((
    candidate: string | number | null | undefined,
    lappAdapter: any,
  ): string | number | null => {
    return findModelExpressionMatchHelper(candidate, lappAdapter);
  }, []);

  const resolvePlaybackExpression = useCallback((
    expressions?: string[] | number[] | null,
    expressionDecision?: ExpressionDecisionPayload | null,
    lappAdapter?: any,
    options?: {
      preferMotion?: boolean
    },
  ): string | number | null => {
    return resolvePlaybackExpressionHelper({
      emotionMap: modelInfo?.emotionMap,
      expressions,
      expressionDecision,
      lappAdapter,
      preferMotion: options?.preferMotion ?? false,
    });
  }, [
    modelInfo?.emotionMap,
  ]);

  const resolvePlaybackMotion = useCallback((model: any, motions?: string[] | null) => {
    return resolvePlaybackMotionHelper(model, motions);
  }, []);

  const playResolvedMotion = useCallback((model: any, motion: {
    groupName: string
    motionIndex: number
  } | null, priority: number = LAppDefine?.PriorityNormal ?? 3) => {
    return playResolvedMotionHelper(model, motion, priority);
  }, []);

  /**
   * Handle audio playback with Live2D lip sync
   */
  const handleAudioPlayback = async (options: AudioTaskOptions): Promise<void> => {
    const {
      aiState: currentAiState,
      setSubtitleText: updateSubtitle,
      appendResponse: appendText,
      appendAIMessage: appendAI,
      fullResponse: currentFullResponse,
    } = stateRef.current;

    // Skip if already interrupted
    if (currentAiState === 'interrupted') {
      console.warn('Audio playback blocked by interruption state.');
      return;
    }

    const {
      audioUrl,
      displayText,
      expressions,
      motions,
      expressionDecision,
      forwarded,
    } = options;

    console.log('[AudioTaskTiming] received_audio_url', {
      at: performance.now(),
      audioUrl,
      displayText: displayText?.text ?? null,
    });

    const lappAdapter = (window as any).getLAppAdapter?.();
    const resolvedStandaloneMotion = resolvePlaybackMotion(
      lappAdapter?.getModel?.(),
      motions,
    );
    const expressionValue = resolvePlaybackExpression(
      expressions,
      expressionDecision,
      lappAdapter,
      { preferMotion: Boolean(resolvedStandaloneMotion) },
    );

    // Update display text
    if (displayText) {
      const shouldAppendToHistory = !currentFullResponse.endsWith(displayText.text);
      if (shouldAppendToHistory) {
        appendText(displayText.text);
        appendAI(displayText.text, displayText.name, displayText.avatar);
      }
    }

    try {
      if (!lappAdapter) {
        console.warn('[AudioTask] LAppAdapter not found for expression handling');
      } else if (!audioUrl && expressionValue !== null) {
        try {
          if (resolvedStandaloneMotion) {
            playResolvedMotion(lappAdapter?.getModel?.(), resolvedStandaloneMotion);
          }

          const applied = await setExpressionWithRetry(
            expressionValue,
            lappAdapter,
            `Set expression to: ${expressionValue}`,
          );

          if (applied) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, expressionOnlyHoldMs);
            });

            if (stateRef.current.aiState !== 'interrupted') {
              resetModelExpression();
            }
          }
        } catch (err) {
          console.error('[AudioTask] Failed to set expression:', err);
        }
      } else if (!audioUrl && resolvedStandaloneMotion) {
        playResolvedMotion(lappAdapter.getModel?.(), resolvedStandaloneMotion);
      }

      // Process audio if available
      if (audioUrl) {
        const live2dManager = (window as any).getLive2DManager?.();
        if (!live2dManager) {
          console.error('Live2D manager not found');
          return;
        }

        const model = live2dManager.getModel(0);
        if (!model) {
          console.error('Live2D model not found at index 0');
          return;
        }

        const resolvedMotion = resolvePlaybackMotion(model, motions);
        const playbackDeps: AudioPlaybackRuntimeDeps = {
          audioManager,
          sendMessage,
          updateSubtitle,
          resetModelExpression,
          setExpression,
          setExpressionWithRetry,
          getAiState: () => stateRef.current.aiState,
        };

        await runAudioPlaybackLifecycle({
          audioUrl,
          model,
          lappAdapter,
          displayText,
          forwarded,
          expressionValue,
          resolvedMotion,
          deps: playbackDeps,
        });
      }
    } catch (error) {
      console.error('Audio playback setup error:', error);
      toaster.create({
        title: `${t('error.audioPlayback')}: ${error}`,
        type: "error",
        duration: 2000,
      });
    }
  };

  // Handle backend synthesis completion
  useEffect(() => {
    let isMounted = true;

    const handleComplete = async () => {
      await audioTaskQueue.waitForCompletion();
      if (isMounted && backendSynthComplete) {
        sendMessage({ type: "frontend-playback-complete" });
        setBackendSynthComplete(false);
      }
    };

    handleComplete();

    return () => {
      isMounted = false;
    };
  }, [backendSynthComplete, sendMessage, setBackendSynthComplete]);

  /**
   * Add a new audio task to the queue
   */
  const addAudioTask = async (options: AudioTaskOptions) => {
    const { aiState: currentState } = stateRef.current;

    if (currentState === 'interrupted') {
      return;
    }

    audioTaskQueue.addTask(() => handleAudioPlayback(options));
  };

  return {
    addAudioTask,
    appendResponse,
    stopCurrentAudioAndLipSync,
  };
};
