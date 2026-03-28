import * as LAppDefine from '../../../WebSDK/src/lappdefine';

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
  getAiState: () => string
}

export interface ExpressionDecisionPayload {
  semantic_expression?: string
  base_expression?: string
  reason?: string
  motion_id?: string
  requested_motion_id?: string
  motion_source?: string
}

type MotionAssetMap = Record<string, string | string[]>;

type EmotionMap = Record<string, string | number>;

export const normalizeExpressionValue = (value?: string | number | null) => {
  if (typeof value === 'number') {
    return String(value);
  }

  return value?.replace(/\\/g, '/').trim().toLowerCase() ?? '';
};

export const findMappedExpression = (
  emotionMap: EmotionMap | undefined,
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

export const resolvePlaybackExpression = ({
  emotionMap,
  expressions,
  expressionDecision,
  lappAdapter,
}: {
  emotionMap: EmotionMap | undefined
  expressions?: string[] | number[] | null
  expressionDecision?: ExpressionDecisionPayload | null
  lappAdapter?: any
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

  return null;
};

export const normalizeMotionPath = (value?: string) => {
  if (typeof value !== 'string') {
    return '';
  }

  let normalized = value
    .replace(/\\/g, '/')
    .split('?')[0]
    .replace(/^\.?\//, '')
    .trim();

  if (!normalized) {
    return '';
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the raw value if it's not URI-encoded.
  }

  return normalized.toLowerCase();
};

const normalizeMotionAssets = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const dedupeMotionCandidates = (candidates: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeMotionPath(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(candidate.trim());
  }

  return result;
};

const findMappedMotionAssets = (
  motionMap: MotionAssetMap | undefined,
  key?: string,
) => {
  const normalizedKey = normalizeExpressionValue(key);
  if (!normalizedKey || !motionMap) {
    return [];
  }

  for (const [mapKey, mapValue] of Object.entries(motionMap)) {
    if (normalizeExpressionValue(mapKey) === normalizedKey) {
      return normalizeMotionAssets(mapValue);
    }
  }

  return [];
};

export const getDirectMotionCandidates = (motions?: string[] | null) => {
  return dedupeMotionCandidates(normalizeMotionAssets(motions));
};

export const getExpressionDecisionMotionCandidates = (
  expressionDecision?: ExpressionDecisionPayload | null,
  motionMap?: MotionAssetMap,
) => {
  const decisionCandidates = [
    expressionDecision?.motion_id,
    expressionDecision?.requested_motion_id,
    expressionDecision?.base_expression,
    expressionDecision?.semantic_expression,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  if (!decisionCandidates.length) {
    return [];
  }

  const resolvedCandidates: string[] = [];
  for (const decisionCandidate of decisionCandidates) {
    const mappedAssets = findMappedMotionAssets(motionMap, decisionCandidate);
    if (mappedAssets.length > 0) {
      resolvedCandidates.push(...mappedAssets);
    }
    resolvedCandidates.push(decisionCandidate);
  }

  return dedupeMotionCandidates(resolvedCandidates);
};

export const resolvePlaybackMotion = (model: any, motionCandidates?: string[] | null) => {
  const candidates = getDirectMotionCandidates(motionCandidates);
  const modelSetting = model?._modelSetting;
  const motionGroupCount = modelSetting?.getMotionGroupCount?.() ?? 0;
  if (!candidates.length || motionGroupCount <= 0) {
    return null;
  }

  for (const motionCandidate of candidates) {
    const candidatePath = normalizeMotionPath(motionCandidate);
    if (!candidatePath) {
      continue;
    }

    const candidateFileName = candidatePath.split('/').pop() ?? candidatePath;
    const candidateFileStem = candidateFileName.replace(/\.motion3\.json$/i, '');

    for (let groupIndex = 0; groupIndex < motionGroupCount; groupIndex += 1) {
      const groupName = modelSetting.getMotionGroupName(groupIndex);
      if (typeof groupName !== 'string') {
        continue;
      }

      const normalizedGroupName = normalizeExpressionValue(groupName);
      if (
        normalizedGroupName
        && (
          normalizedGroupName === candidatePath
          || normalizedGroupName === candidateFileName
          || normalizedGroupName === candidateFileStem
        )
      ) {
        return {
          groupName,
          motionIndex: 0,
        };
      }

      const groupMotionCount = modelSetting.getMotionCount(groupName);
      for (let motionIndex = 0; motionIndex < groupMotionCount; motionIndex += 1) {
        const motionFile = modelSetting.getMotionFileName(groupName, motionIndex);
        if (!motionFile) {
          continue;
        }

        const normalizedMotionFile = normalizeMotionPath(motionFile);
        const motionFileName = normalizedMotionFile.split('/').pop() ?? normalizedMotionFile;
        const motionFileStem = motionFileName.replace(/\.motion3\.json$/i, '');

        if (
          normalizedMotionFile === candidatePath
          || motionFileName === candidateFileName
          || motionFileStem === candidateFileStem
        ) {
          return {
            groupName,
            motionIndex,
          };
        }
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
    throw new Error('Cannot play a null motion.');
  }

  model.startMotion(motion.groupName, motion.motionIndex, priority);
  return true;
};

export const preloadLipSyncAudio = async (
  model: any,
  audio: HTMLAudioElement,
  audioUrl: string,
  arrayBuffer?: ArrayBuffer,
) => {
  const wavFileHandler = model?._wavFileHandler;
  if (!wavFileHandler) {
    throw new Error('Model does not expose _wavFileHandler; lip sync cannot be initialized.');
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

  let loaded: boolean;
  if (arrayBuffer) {
    loaded = await wavFileHandler.loadWavBuffer(arrayBuffer, audioUrl);
  } else {
    loaded = await wavFileHandler.loadWavFile(audioUrl);
  }
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
}): Promise<void> => new Promise<void>((resolve, reject) => {
  const setupPlayback = async () => {
    try {
      if (!model._wavFileHandler) {
        throw new Error('Model does not have _wavFileHandler for lip sync.');
      }

      console.log('[AudioTaskTiming] loaded_audio_source', {
        at: performance.now(),
        audioUrl,
      });

      // 只加载一次音频：fetch 一次，同时给 HTMLAudioElement 和 wavFileHandler 使用
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio ${audioUrl}: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      // 创建 Blob URL 给 HTMLAudioElement 使用
      const blob = new Blob([arrayBuffer]);
      const blobUrl = URL.createObjectURL(blob);

      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = blobUrl;

      // 预加载口型同步数据（使用已获取的 arrayBuffer，避免第二次网络请求）
      const lipSyncReadyPromise = preloadLipSyncAudio(model, audio, audioUrl, arrayBuffer);

      let isFinished = false;
      let playbackStarted = false;
      let playbackVisualsCleared = false;
      let playRequested = false;

      // 统一启动音频、字幕、动画的函数
      const startAllSync = () => {
        if (playbackStarted || !isActiveAudio()) {
          return;
        }

        playbackStarted = true;

        console.log('[AudioTaskTiming] playback_started', {
          at: performance.now(),
          audioUrl,
          currentTime: audio.currentTime,
        });

        // 立即显示字幕
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

        // 立即设置表情
        if (expressionValue !== null && lappAdapter) {
          deps.setExpression(
            expressionValue,
            lappAdapter,
            `Set expression to: ${expressionValue}`,
          );
        }

        // 立即播放动作
        if (resolvedMotion) {
          playResolvedMotion(model, resolvedMotion);
        }

        if (model._wavFileHandler) {
          model._wavFileHandler._syncAudioElement = audio;
        }
      };

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
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
      };

      const cleanup = () => {
        detachAudioListeners();
        deps.audioManager.clearCurrentAudio(audio);
        URL.revokeObjectURL(blobUrl); // 清理 Blob URL
        if (!isFinished) {
          isFinished = true;
          resolve();
        }
      };

      const fail = (error: unknown) => {
        detachAudioListeners();
        deps.audioManager.clearCurrentAudio(audio);
        URL.revokeObjectURL(blobUrl); // 清理 Blob URL
        if (!isFinished) {
          isFinished = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      deps.audioManager.setCurrentAudio(audio, model, cleanup);

      const requestPlayback = () => {
        if (playRequested) {
          return;
        }
        playRequested = true;

        if (deps.getAiState() === 'interrupted' || !isActiveAudio()) {
          cleanup();
          return;
        }

        void lipSyncReadyPromise.catch((error) => {
          if (isActiveAudio()) {
            fail(error);
          }
        });

        // 音频、字幕、动画同时开始
        startAllSync();

        audio.play().catch((err) => {
          if (!isActiveAudio()) {
            cleanup();
            return;
          }

          fail(err);
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

        clearPlaybackVisuals();
        fail(error);
      }

      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('error', handleError);

      audio.load();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  void setupPlayback();
});
