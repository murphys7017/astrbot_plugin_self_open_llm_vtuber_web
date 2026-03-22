import * as LAppDefine from '../../../WebSDK/src/lappdefine';

export interface SharedAudioSource {
  audioBuffer: ArrayBuffer
  playbackUrl: string
  release: () => void
}

export interface AudioPlaybackRuntimeDeps {
  audioManager: {
    setCurrentAudio: (audio: HTMLAudioElement, model: any, onStop?: () => void) => void
    clearCurrentAudio: (audio: HTMLAudioElement) => void
    isCurrentAudio: (audio: HTMLAudioElement) => boolean
  }
  sendMessage: (message: object) => void
  updateSubtitle: (text: string) => void
  resetModelExpression: () => void
  setExpression: (expression: string | number, lappAdapter: any, reason: string) => boolean
  setExpressionWithRetry: (
    expression: string | number,
    lappAdapter: any,
    reason: string,
    retryCount?: number,
    retryDelay?: number
  ) => Promise<boolean>
  getAiState: () => string
}

export interface ExpressionDecisionPayload {
  semantic_expression?: string
  base_expression?: string
  reason?: string
}

const semanticExpressionFallbacks: Record<string, string[]> = {
  neutral: ['Neutral'],
  calm: ['Neutral'],
  happy: ['Happy', 'Blush', 'Neutral'],
  joy: ['Happy', 'Blush', 'Neutral'],
  cheerful: ['Happy', 'Blush', 'Neutral'],
  angry: ['Angry', 'Murderous', 'Neutral'],
  mad: ['Angry', 'Murderous', 'Neutral'],
  surprised: ['Surprised', 'Exclamation', 'Question'],
  surprise: ['Surprised', 'Exclamation', 'Question'],
  confused: ['Confused', 'Question', 'Neutral'],
  curious: ['Question', 'Confused', 'Neutral'],
  question: ['Question', 'Confused', 'Neutral'],
  thinking: ['Loading', 'Question', 'Confused', 'Neutral'],
  loading: ['Loading', 'Question', 'Neutral'],
  embarrassed: ['Embarrassed', 'Blush', 'Neutral'],
  blush: ['Blush', 'Embarrassed', 'Neutral'],
  shy: ['Embarrassed', 'Blush', 'Neutral'],
  tired: ['Tired', 'ExtremelyTired', 'Neutral'],
  exhausted: ['ExtremelyTired', 'Tired', 'Neutral'],
  sleepy: ['ExtremelyTired', 'Tired', 'Neutral'],
  messy: ['Messy', 'Neutral'],
  murderous: ['Murderous', 'Angry', 'Neutral'],
  excited: ['Exclamation', 'Happy', 'Surprised'],
};

export const normalizeExpressionValue = (value?: string | number | null) => {
  if (typeof value === 'number') {
    return String(value);
  }

  return value?.replace(/\\/g, '/').trim().toLowerCase() ?? '';
};

export const findMappedExpression = (
  emotionMap: Record<string, string> | undefined,
  key?: string,
): string | number | null => {
  const normalized = normalizeExpressionValue(key);
  if (!normalized || !emotionMap) {
    return null;
  }

  const exactEntry = Object.entries(emotionMap).find(
    ([mapKey]) => normalizeExpressionValue(mapKey) === normalized,
  );

  return exactEntry?.[1] ?? null;
};

export const findModelExpressionMatch = (
  candidate: string | number | null | undefined,
  lappAdapter: any,
): string | number | null => {
  if (candidate === null || candidate === undefined) {
    return null;
  }

  const model = lappAdapter?.getModel?.();
  const modelSetting = model?._modelSetting;
  const expressionCount = modelSetting?.getExpressionCount?.() ?? lappAdapter?.getExpressionCount?.() ?? 0;

  if (typeof candidate === 'number') {
    return candidate >= 0 && candidate < expressionCount ? candidate : null;
  }

  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate) {
    return null;
  }

  if (/^\d+$/.test(trimmedCandidate)) {
    const expressionIndex = Number(trimmedCandidate);
    return expressionIndex >= 0 && expressionIndex < expressionCount ? expressionIndex : null;
  }

  const normalizedCandidate = normalizeExpressionValue(trimmedCandidate);
  if (!normalizedCandidate || expressionCount <= 0) {
    return null;
  }

  for (let i = 0; i < expressionCount; i += 1) {
    const expressionName = modelSetting?.getExpressionName?.(i) ?? lappAdapter?.getExpressionName?.(i);
    const expressionFile = modelSetting?.getExpressionFileName?.(i);

    if (
      typeof expressionName === 'string'
      && normalizeExpressionValue(expressionName) === normalizedCandidate
    ) {
      return expressionName;
    }

    if (typeof expressionFile === 'string') {
      const normalizedFile = normalizeExpressionValue(expressionFile);
      const normalizedFileName = normalizedFile.split('/').pop() ?? normalizedFile;

      if (
        normalizedFile === normalizedCandidate
        || normalizedFileName === normalizedCandidate
      ) {
        return expressionName ?? trimmedCandidate;
      }
    }
  }

  return null;
};

export const findSemanticFallbackExpression = (
  key: string | null | undefined,
  lappAdapter: any,
  emotionMap: Record<string, string> | undefined,
): string | number | null => {
  const normalizedKey = normalizeExpressionValue(key);
  if (!normalizedKey) {
    return null;
  }

  const fallbackCandidates = semanticExpressionFallbacks[normalizedKey] ?? [];
  for (const fallbackCandidate of fallbackCandidates) {
    const mappedExpression = findMappedExpression(emotionMap, fallbackCandidate);
    if (mappedExpression !== null) {
      return mappedExpression;
    }

    const modelExpression = findModelExpressionMatch(fallbackCandidate, lappAdapter);
    if (modelExpression !== null) {
      return modelExpression;
    }
  }

  return null;
};

export const resolvePlaybackExpression = ({
  emotionMap,
  expressions,
  expressionDecision,
  lappAdapter,
  preferMotion = false,
}: {
  emotionMap: Record<string, string> | undefined
  expressions?: string[] | number[] | null
  expressionDecision?: ExpressionDecisionPayload | null
  lappAdapter?: any
  preferMotion?: boolean
}): string | number | null => {
  const baseExpression = expressionDecision?.base_expression?.trim();
  const semanticExpression = expressionDecision?.semantic_expression?.trim();

  const mappedBase = findMappedExpression(emotionMap, baseExpression);
  if (mappedBase !== null) {
    return mappedBase;
  }

  const directBase = findModelExpressionMatch(baseExpression, lappAdapter);
  if (directBase !== null) {
    return directBase;
  }

  const mappedSemantic = findMappedExpression(emotionMap, semanticExpression);
  if (mappedSemantic !== null) {
    return mappedSemantic;
  }

  const directSemantic = findModelExpressionMatch(semanticExpression, lappAdapter);
  if (directSemantic !== null) {
    return directSemantic;
  }

  for (const expression of expressions ?? []) {
    if (typeof expression === 'string') {
      const mappedExpression = findMappedExpression(emotionMap, expression);
      if (mappedExpression !== null) {
        return mappedExpression;
      }
    }

    const directExpression = findModelExpressionMatch(expression, lappAdapter);
    if (directExpression !== null) {
      return directExpression;
    }
  }

  if (preferMotion) {
    return null;
  }

  return findSemanticFallbackExpression(baseExpression, lappAdapter, emotionMap)
    ?? findSemanticFallbackExpression(semanticExpression, lappAdapter, emotionMap);
};

export const resolvePlaybackMotion = (model: any, motions?: string[] | null) => {
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
};

export const playResolvedMotion = (
  model: any,
  motion: {
    groupName: string
    motionIndex: number
  } | null,
  priority: number = LAppDefine?.PriorityNormal ?? 3,
) => {
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
};

export const resolveAudioMimeType = (audioUrl: string, contentType?: string | null) => {
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType;
  }

  const extension = audioUrl.split('?')[0]?.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'opus':
      return 'audio/opus';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'wav':
    default:
      return 'audio/wav';
  }
};

export const prepareSharedAudioSource = async (audioUrl: string): Promise<SharedAudioSource> => {
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const playbackBlob = new Blob([audioBuffer], {
    type: resolveAudioMimeType(audioUrl, response.headers.get('content-type')),
  });
  const playbackUrl = URL.createObjectURL(playbackBlob);

  return {
    audioBuffer,
    playbackUrl,
    release: () => URL.revokeObjectURL(playbackUrl),
  };
};

export const preloadLipSyncAudio = async (
  model: any,
  audio: HTMLAudioElement,
  audioUrl: string,
  audioBuffer?: ArrayBuffer,
) => {
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

  const loaded = audioBuffer
    ? await wavFileHandler.loadWavBuffer(audioBuffer, audioUrl)
    : await wavFileHandler.loadWavFile(audioUrl);
  if (!loaded) {
    throw new Error('Failed to preload lip sync audio data');
  }
};

export const runAudioPlaybackLifecycle = async ({
  audioUrl,
  model,
  lappAdapter,
  displayText,
  forwarded,
  expressionValue,
  resolvedMotion,
  deps,
}: {
  audioUrl: string
  model: any
  lappAdapter: any
  displayText?: { text: string } | null
  forwarded?: boolean
  expressionValue: string | number | null
  resolvedMotion: { groupName: string; motionIndex: number } | null
  deps: AudioPlaybackRuntimeDeps
}): Promise<void> => new Promise<void>((resolve) => {
  const setupPlayback = async () => {
    let sharedAudioSource: SharedAudioSource | null = null;

    try {
      if (!model._wavFileHandler) {
        console.warn('Model does not have _wavFileHandler for lip sync');
      }

      sharedAudioSource = await prepareSharedAudioSource(audioUrl);

      if (!resolvedMotion && LAppDefine && LAppDefine.PriorityNormal) {
        model.startRandomMotion(
          "Talk",
          LAppDefine.PriorityNormal,
        );
      } else if (!resolvedMotion) {
        console.warn("LAppDefine.PriorityNormal not found - cannot start talk motion");
      }

      const audio = new Audio(sharedAudioSource.playbackUrl);
      audio.preload = 'auto';
      const lipSyncReadyPromise = preloadLipSyncAudio(
        model,
        audio,
        audioUrl,
        sharedAudioSource.audioBuffer,
      )
        .then(() => true)
        .catch((error) => {
          console.error('Failed to preload lip sync audio:', error);
          return false;
        });

      console.log('[AudioTaskTiming] loaded_audio_source', {
        at: performance.now(),
        audioUrl,
        playbackUrl: sharedAudioSource.playbackUrl,
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
        deps.updateSubtitle('');
        deps.resetModelExpression();
      };

      const isActiveAudio = () => deps.audioManager.isCurrentAudio(audio);

      const detachAudioListeners = () => {
        audio.removeEventListener('playing', handlePlaybackStart);
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
      };

      const cleanup = () => {
        detachAudioListeners();
        deps.audioManager.clearCurrentAudio(audio);
        sharedAudioSource?.release();
        sharedAudioSource = null;
        if (!isFinished) {
          isFinished = true;
          resolve();
        }
      };

      deps.audioManager.setCurrentAudio(audio, model, cleanup);

      function handlePlaybackStart() {
        if (playbackStarted || !isActiveAudio()) {
          return;
        }

        playbackStarted = true;

        console.log('[AudioTaskTiming] playback_started', {
          at: performance.now(),
          audioUrl,
          currentTime: audio.currentTime,
        });

        if (displayText) {
          console.log('[AudioTaskTiming] subtitle_shown', {
            at: performance.now(),
            audioUrl,
            text: displayText.text,
          });
          deps.updateSubtitle(displayText.text);
        }

        if (displayText && !forwarded) {
          deps.sendMessage({
            type: "audio-play-start",
            display_text: displayText,
            forwarded: true,
          });
        }

        if (expressionValue !== null && lappAdapter) {
          const applied = deps.setExpression(
            expressionValue,
            lappAdapter,
            `Set expression to: ${expressionValue}`,
          );

          if (!applied) {
            void deps.setExpressionWithRetry(
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

        if (model._wavFileHandler) {
          model._wavFileHandler._syncAudioElement = audio;
        }
      }

      const requestPlayback = () => {
        if (playRequested) {
          return;
        }
        playRequested = true;

        if (deps.getAiState() === 'interrupted' || !isActiveAudio()) {
          console.warn('Audio playback cancelled due to interruption or audio was stopped');
          cleanup();
          return;
        }

        audio.play().catch((err) => {
          if (!isActiveAudio()) {
            cleanup();
            return;
          }

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

        console.log('[AudioTaskTiming] playback_ended', {
          at: performance.now(),
          audioUrl,
          currentTime: audio.currentTime,
        });

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
    } catch (error) {
      sharedAudioSource?.release();
      console.error('Audio playback setup error:', error);
      resolve();
    }
  };

  void setupPlayback();
});
