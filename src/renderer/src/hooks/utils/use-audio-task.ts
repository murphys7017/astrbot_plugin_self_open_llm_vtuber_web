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

interface AudioTaskOptions {
  audioUrl: string
  volumes: number[]
  sliceLength: number
  displayText?: DisplayText | null
  expressions?: string[] | number[] | null
  expressionDecision?: {
    semantic_expression?: string
    base_expression?: string
    reason?: string
  } | null
  speaker_uid?: string
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

  const resolvePlaybackExpression = useCallback((
    expressions?: string[] | number[] | null,
    expressionDecision?: {
      semantic_expression?: string
      base_expression?: string
      reason?: string
    } | null,
  ): string | number | null => {
    const emotionMap = modelInfo?.emotionMap ?? {};

    const normalizeKey = (value?: string) => value?.trim().toLowerCase() ?? '';

    const findMappedExpression = (key?: string): string | number | null => {
      const normalized = normalizeKey(key);
      if (!normalized) {
        return null;
      }

      const exactEntry = Object.entries(emotionMap).find(
        ([mapKey]) => normalizeKey(mapKey) === normalized,
      );

      return exactEntry?.[1] ?? null;
    };

    const baseExpression = expressionDecision?.base_expression?.trim();

    const mappedBase = findMappedExpression(baseExpression);
    if (mappedBase !== null) {
      console.log('[AudioTask] Using base expression mapping:', baseExpression, '->', mappedBase);
      return mappedBase;
    }

    if (baseExpression) {
      console.log('[AudioTask] Falling back to base expression name:', baseExpression);
      return baseExpression;
    }

    return expressions?.[0] ?? null;
  }, [modelInfo?.emotionMap]);

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
      expressionDecision,
      forwarded,
    } = options;

    console.log('[AudioTask] Received expressions:', expressions);
    console.log('[AudioTask] Received expression decision:', expressionDecision);
    const expressionValue = resolvePlaybackExpression(expressions, expressionDecision);
    const lappAdapter = (window as any).getLAppAdapter?.();

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
        console.log('[AudioTask] Applying expression without audio:', expressionValue);
        try {
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
      } else if (expressionValue === null) {
        console.log('[AudioTask] No expressions provided');
      }

      // Process audio if available
      if (audioUrl) {
        await new Promise<void>((resolve) => {
          // Get Live2D manager and model
          const live2dManager = (window as any).getLive2DManager?.();
          if (!live2dManager) {
            console.error('Live2D manager not found');
            resolve();
            return;
          }

          const model = live2dManager.getModel(0);
          if (!model) {
            console.error('Live2D model not found at index 0');
            resolve();
            return;
          }
          console.log('Found model for audio playback');

          if (!model._wavFileHandler) {
            console.warn('Model does not have _wavFileHandler for lip sync');
          } else {
            console.log('Model has _wavFileHandler available');
          }

          // Start talk motion
          if (LAppDefine && LAppDefine.PriorityNormal) {
            console.log("Starting random 'Talk' motion");
            model.startRandomMotion(
              "Talk",
              LAppDefine.PriorityNormal,
            );
          } else {
            console.warn("LAppDefine.PriorityNormal not found - cannot start talk motion");
          }

          // Setup audio element
          const audio = new Audio(audioUrl);

          let isFinished = false;
          let playbackStarted = false;

          const cleanup = () => {
            audioManager.clearCurrentAudio(audio);
            if (!isFinished) {
              isFinished = true;
              resolve();
            }
          };

          // Register with global audio manager IMMEDIATELY after creating audio
          audioManager.setCurrentAudio(audio, model, cleanup);

          // Enhance lip sync sensitivity
          const lipSyncScale = 2.0;

          const handlePlaybackStart = () => {
            if (playbackStarted) {
              return;
            }

            playbackStarted = true;
            console.log('Audio playback started, syncing expression and lip sync');

            if (displayText) {
              updateSubtitle(displayText.text);
            }

            if (displayText && !forwarded) {
              sendMessage({
                type: "audio-play-start",
                display_text: displayText,
                forwarded: true,
              });
            }

            if (expressionValue !== null && lappAdapter) {
              console.log('[AudioTask] Applying expression at playback start:', expressionValue);
              const applied = setExpression(
                expressionValue,
                lappAdapter,
                `Set expression to: ${expressionValue}`,
              );

              if (!applied) {
                void setExpressionWithRetry(
                  expressionValue,
                  lappAdapter,
                  `Set expression to: ${expressionValue}`,
                  6,
                  50,
                ).catch((err) => {
                  console.error('[AudioTask] Failed to set expression during playback:', err);
                });
              }
            }

            // Setup lip sync when audio actually starts to keep both timelines aligned.
            if (model._wavFileHandler) {
              if (!model._wavFileHandler._initialized) {
                console.log('Applying enhanced lip sync');
                model._wavFileHandler._initialized = true;

                const originalUpdate = model._wavFileHandler.update.bind(model._wavFileHandler);
                model._wavFileHandler.update = function (deltaTimeSeconds: number) {
                  const result = originalUpdate(deltaTimeSeconds);
                  // @ts-ignore
                  this._lastRms = Math.min(2.0, this._lastRms * lipSyncScale);
                  return result;
                };
              }

              if (audioManager.hasCurrentAudio()) {
                model._wavFileHandler.start(audioUrl);
              } else {
                console.warn('WavFileHandler start skipped - audio was stopped');
              }
            }
          };

          audio.addEventListener('play', handlePlaybackStart);

          audio.addEventListener('canplaythrough', () => {
            // Check for interruption before playback
            if (stateRef.current.aiState === 'interrupted' || !audioManager.hasCurrentAudio()) {
              console.warn('Audio playback cancelled due to interruption or audio was stopped');
              cleanup();
              return;
            }

            console.log('Starting audio playback with lip sync');
            audio.play().catch((err) => {
              console.error("Audio play error:", err);
              cleanup();
            });
          });

          audio.addEventListener('ended', () => {
            console.log("Audio playback completed");
            cleanup();
          });

          audio.addEventListener('error', (error) => {
            console.error("Audio playback error:", error);
            cleanup();
          });

          audio.load();
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
        stopCurrentAudioAndLipSync();
        setSubtitleText('');
        sendMessage({ type: "frontend-playback-complete" });
        setBackendSynthComplete(false);
      }
    };

    handleComplete();

    return () => {
      isMounted = false;
    };
  }, [backendSynthComplete, sendMessage, setBackendSynthComplete, stopCurrentAudioAndLipSync]);

  /**
   * Add a new audio task to the queue
   */
  const addAudioTask = async (options: AudioTaskOptions) => {
    const { aiState: currentState } = stateRef.current;

    if (currentState === 'interrupted') {
      console.log('Skipping audio task due to interrupted state');
      return;
    }

    console.log(`Adding audio task ${options.displayText?.text} to queue`);
    audioTaskQueue.addTask(() => handleAudioPlayback(options));
  };

  return {
    addAudioTask,
    appendResponse,
    stopCurrentAudioAndLipSync,
  };
};
