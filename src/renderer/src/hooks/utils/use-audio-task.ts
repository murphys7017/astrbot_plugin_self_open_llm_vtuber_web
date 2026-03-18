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
  displayText?: DisplayText | null
  expressions?: string[] | number[] | null
  motions?: string[] | null
  expressionDecision?: {
    semantic_expression?: string
    base_expression?: string
    reason?: string
  } | null
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
      return mappedBase;
    }

    if (baseExpression) {
      return baseExpression;
    }

    return expressions?.[0] ?? null;
  }, [modelInfo?.emotionMap]);

  const resolvePlaybackMotion = useCallback((model: any, motions?: string[] | null) => {
    const motionCandidate = motions?.[0]?.trim();
    const motionGroups = model?._modelSetting?._json?.FileReferences?.Motions;
    if (!motionCandidate || !motionGroups) {
      return null;
    }

    const normalizeMotionPath = (value?: string) => value
      ?.replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .trim()
      .toLowerCase() ?? '';

    const candidatePath = normalizeMotionPath(motionCandidate);
    const candidateFileName = candidatePath.split('/').pop() ?? candidatePath;

    for (const [groupName, groupMotions] of Object.entries(motionGroups)) {
      if (!Array.isArray(groupMotions)) {
        continue;
      }

      for (const [index, motion] of groupMotions.entries()) {
        const motionFile = typeof motion?.File === 'string' ? motion.File : '';
        if (!motionFile) {
          continue;
        }

        const normalizedMotionFile = normalizeMotionPath(motionFile);
        const motionFileName = normalizedMotionFile.split('/').pop() ?? normalizedMotionFile;

        if (
          normalizedMotionFile === candidatePath
          || motionFileName === candidateFileName
        ) {
          return {
            groupName,
            motionIndex: index,
          };
        }
      }
    }

    return null;
  }, []);

  const playResolvedMotion = useCallback((model: any, motion: {
    groupName: string
    motionIndex: number
  } | null, priority: number = LAppDefine?.PriorityNormal ?? 3) => {
    if (!motion) {
      return false;
    }

    try {
      model.startMotion(motion.groupName, motion.motionIndex, priority);
      return true;
    } catch (error) {
      console.error('[AudioTask] Failed to play motion:', error);
      return false;
    }
  }, []);

  const preloadLipSyncAudio = useCallback(async (model: any, audio: HTMLAudioElement, audioUrl: string) => {
    const wavFileHandler = model?._wavFileHandler;
    if (!wavFileHandler) {
      return;
    }

    wavFileHandler.releasePcmData?.();
    wavFileHandler._sampleOffset = 0;
    wavFileHandler._userTimeSeconds = 0.0;
    wavFileHandler._lastRms = 0.0;
    wavFileHandler._syncAudioElement = audio;

    if (!wavFileHandler._syncUpdatePatched) {
      wavFileHandler._syncUpdatePatched = true;
      const originalUpdate = wavFileHandler.update.bind(wavFileHandler);

      wavFileHandler.update = function updateWithAudioClock(deltaTimeSeconds: number) {
        const syncedAudio = this._syncAudioElement as HTMLAudioElement | null | undefined;
        if (!syncedAudio) {
          return originalUpdate(deltaTimeSeconds);
        }

        if (
          this._pcmData == null ||
          this._sampleOffset >= this._wavFileInfo._samplesPerChannel
        ) {
          this._lastRms = 0.0;
          return false;
        }

        const syncedTimeSeconds = Math.max(0, syncedAudio.currentTime || 0);
        let goalOffset = Math.floor(
          syncedTimeSeconds * this._wavFileInfo._samplingRate,
        );
        if (goalOffset > this._wavFileInfo._samplesPerChannel) {
          goalOffset = this._wavFileInfo._samplesPerChannel;
        }

        if (goalOffset <= this._sampleOffset) {
          this._userTimeSeconds = syncedTimeSeconds;
          if (syncedAudio.paused || syncedAudio.ended) {
            this._lastRms = 0.0;
          }
          return false;
        }

        let rms = 0.0;
        for (
          let channelCount = 0;
          channelCount < this._wavFileInfo._numberOfChannels;
          channelCount++
        ) {
          for (
            let sampleCount = this._sampleOffset;
            sampleCount < goalOffset;
            sampleCount++
          ) {
            const pcm = this._pcmData[channelCount][sampleCount];
            rms += pcm * pcm;
          }
        }

        const sampleWindow = goalOffset - this._sampleOffset;
        rms = Math.sqrt(
          rms / (this._wavFileInfo._numberOfChannels * sampleWindow),
        );

        this._lastRms = Math.min(2.0, rms * 2.0);
        this._sampleOffset = goalOffset;
        this._userTimeSeconds = syncedTimeSeconds;
        return true;
      };
    }

    const loaded = await wavFileHandler.loadWavFile(audioUrl);
    if (!loaded) {
      throw new Error('Failed to preload lip sync audio data');
    }
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

    const expressionValue = resolvePlaybackExpression(expressions, expressionDecision);
    const lappAdapter = (window as any).getLAppAdapter?.();
    const resolvedStandaloneMotion = resolvePlaybackMotion(
      lappAdapter?.getModel?.(),
      motions,
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

          const resolvedMotion = resolvePlaybackMotion(model, motions);

          if (!model._wavFileHandler) {
            console.warn('Model does not have _wavFileHandler for lip sync');
          }

          // Start talk motion
          if (!resolvedMotion && LAppDefine && LAppDefine.PriorityNormal) {
            model.startRandomMotion(
              "Talk",
              LAppDefine.PriorityNormal,
            );
          } else {
            console.warn("LAppDefine.PriorityNormal not found - cannot start talk motion");
          }

          // Setup audio element
          const audio = new Audio(audioUrl);
          audio.preload = 'auto';
          const lipSyncReadyPromise = preloadLipSyncAudio(model, audio, audioUrl)
            .then(() => true)
            .catch((error) => {
              console.error('Failed to preload lip sync audio:', error);
              return false;
            });

          let isFinished = false;
          let playbackStarted = false;
          let playbackVisualsCleared = false;
          let playRequested = false;

          const clearPlaybackVisuals = () => {
            if (playbackVisualsCleared) {
              return;
            }

            playbackVisualsCleared = true;
            updateSubtitle('');
            resetModelExpression();
          };

          const isActiveAudio = () => audioManager.isCurrentAudio(audio);

          const detachAudioListeners = () => {
            audio.removeEventListener('playing', handlePlaybackStart);
            audio.removeEventListener('canplay', handleCanPlay);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
          };

          const cleanup = () => {
            detachAudioListeners();
            audioManager.clearCurrentAudio(audio);
            if (!isFinished) {
              isFinished = true;
              resolve();
            }
          };

          // Register with global audio manager IMMEDIATELY after creating audio
          audioManager.setCurrentAudio(audio, model, cleanup);

          function handlePlaybackStart() {
            if (playbackStarted || !isActiveAudio()) {
              return;
            }

            playbackStarted = true;

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

            if (resolvedMotion) {
              playResolvedMotion(model, resolvedMotion);
            }

            // Setup lip sync when audio actually starts to keep both timelines aligned.
            if (model._wavFileHandler) {
              model._wavFileHandler._syncAudioElement = audio;
            }
          }

          const requestPlayback = () => {
            if (playRequested) {
              return;
            }
            playRequested = true;

            if (stateRef.current.aiState === 'interrupted' || !isActiveAudio()) {
              console.warn('Audio playback cancelled due to interruption or audio was stopped');
              cleanup();
              return;
            }

            audio.play().catch((err) => {
              if (!isActiveAudio()) {
                cleanup();
                return;
              }

              // Playback may be requested before the browser has buffered enough data.
              // Allow a later `canplay` event to retry without delaying the fast path.
              if (audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
                playRequested = false;
                return;
              }

              console.error("Audio play error:", err);
              cleanup();
            });

            void lipSyncReadyPromise.then((loaded) => {
              if (!loaded || !isActiveAudio()) {
                return;
              }

              if (model._wavFileHandler) {
                model._wavFileHandler._syncAudioElement = audio;
              }
            });
          };

          function handleCanPlay() {
            requestPlayback();
          }

          function handleEnded() {
            if (!isActiveAudio()) {
              cleanup();
              return;
            }

            clearPlaybackVisuals();
            cleanup();
          }

          function handleError(error: Event) {
            if (!isActiveAudio()) {
              cleanup();
              return;
            }

            console.error("Audio playback error:", error);
            clearPlaybackVisuals();
            cleanup();
          }

          audio.addEventListener('playing', handlePlaybackStart);
          audio.addEventListener('canplay', handleCanPlay);
          audio.addEventListener('ended', handleEnded);
          audio.addEventListener('error', handleError);

          audio.load();
          requestPlayback();
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
