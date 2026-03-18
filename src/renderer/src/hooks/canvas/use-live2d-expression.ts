import { useCallback } from 'react';
import { ModelInfo } from '@/context/live2d-config-context';

/**
 * Custom hook for handling Live2D model expressions
 */
export const useLive2DExpression = () => {
  const sleep = (ms: number) => new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

  const getLoadedExpressionNames = useCallback((lappAdapter: any): string[] => {
    const count = lappAdapter?.getExpressionCount?.() ?? 0;
    const names: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const name = lappAdapter.getExpressionName(i);
      if (typeof name === 'string' && name) {
        names.push(name);
      }
    }

    return names;
  }, []);

  const normalizeExpressionPath = useCallback((value: string): string => {
    return value.replace(/\\/g, '/').trim().toLowerCase();
  }, []);

  const resolveExpressionNameFromFile = useCallback((
    expressionValue: string,
    lappAdapter: any,
  ): string | null => {
    const model = lappAdapter?.getModel?.();
    const modelSetting = model?._modelSetting;
    const expressionCount = modelSetting?.getExpressionCount?.() ?? 0;
    const normalizedValue = normalizeExpressionPath(expressionValue);

    if (!normalizedValue || expressionCount <= 0) {
      return null;
    }

    for (let i = 0; i < expressionCount; i += 1) {
      const expressionFile = modelSetting.getExpressionFileName?.(i);
      const expressionName = modelSetting.getExpressionName?.(i);
      if (!expressionFile || !expressionName) {
        continue;
      }

      const normalizedFile = normalizeExpressionPath(expressionFile);
      const fileNameOnly = normalizedFile.split('/').pop() ?? normalizedFile;

      if (normalizedFile === normalizedValue || fileNameOnly === normalizedValue) {
        console.log(
          '[setExpression] Resolved expression file to name:',
          expressionValue,
          '->',
          expressionName,
        );
        return expressionName;
      }
    }

    return null;
  }, [normalizeExpressionPath]);

  const resolveExpressionName = useCallback((
    expressionValue: string | number,
    lappAdapter: any,
  ): string | null => {
    const model = lappAdapter?.getModel?.();
    const modelExpressionCount = model?._modelSetting?.getExpressionCount?.() ?? 0;
    const loadedExpressionNames = getLoadedExpressionNames(lappAdapter);

    if (modelExpressionCount > 0 && loadedExpressionNames.length < modelExpressionCount) {
      console.log(
        '[setExpression] Expression assets are still loading:',
        `${loadedExpressionNames.length}/${modelExpressionCount}`,
      );
      return null;
    }

    if (typeof expressionValue === 'number') {
      console.log('[setExpression] Setting expression by index:', expressionValue);
      const expressionName = lappAdapter.getExpressionName(expressionValue);
      console.log('[setExpression] Retrieved expression name:', expressionName);
      return expressionName || null;
    }

    if (typeof expressionValue !== 'string') {
      console.error('[setExpression] Unsupported expression value type:', typeof expressionValue);
      return null;
    }

    const trimmedValue = expressionValue.trim();
    if (!trimmedValue) {
      console.error('[setExpression] Empty expression value received');
      return null;
    }

    const resolvedFromFile = resolveExpressionNameFromFile(trimmedValue, lappAdapter);
    if (resolvedFromFile) {
      return resolvedFromFile;
    }

    if (/^\d+$/.test(trimmedValue)) {
      const expressionIndex = Number(trimmedValue);
      console.log('[setExpression] Normalizing numeric string to index:', expressionIndex);
      const expressionName = lappAdapter.getExpressionName(expressionIndex);
      console.log('[setExpression] Retrieved expression name from numeric string:', expressionName);
      return expressionName || null;
    }

    const exactMatch = loadedExpressionNames.find((name) => name === trimmedValue);
    if (exactMatch) {
      return exactMatch;
    }

    const caseInsensitiveMatch = loadedExpressionNames.find(
      (name) => name.toLowerCase() === trimmedValue.toLowerCase(),
    );
    if (caseInsensitiveMatch) {
      console.log(
        '[setExpression] Matched expression name case-insensitively:',
        trimmedValue,
        '->',
        caseInsensitiveMatch,
      );
      return caseInsensitiveMatch;
    }

    console.error(
      '[setExpression] Failed to resolve expression name:',
      trimmedValue,
      'Available expressions:',
      loadedExpressionNames,
    );
    return null;
  }, [getLoadedExpressionNames, resolveExpressionNameFromFile]);

  /**
   * Set expression for Live2D model
   * @param expressionValue - Expression name (string) or index (number)
   * @param lappAdapter - LAppAdapter instance
   * @param logMessage - Optional message to log on success
   */
  const setExpression = useCallback((
    expressionValue: string | number,
    lappAdapter: any,
    logMessage?: string,
  ): boolean => {
    try {
      console.log('[setExpression] Input value:', expressionValue, 'Type:', typeof expressionValue);

      const expressionName = resolveExpressionName(expressionValue, lappAdapter);
      if (!expressionName) {
        return false;
      }

      console.log('[setExpression] Calling setExpression with name:', expressionName);
      lappAdapter.setExpression(expressionName);

      if (logMessage) {
        console.log(logMessage);
      }

      return true;
    } catch (error) {
      console.error('[setExpression] Failed to set expression:', error);
      return false;
    }
  }, [resolveExpressionName]);

  const setExpressionWithRetry = useCallback(async (
    expressionValue: string | number,
    lappAdapter: any,
    logMessage?: string,
    maxAttempts: number = 10,
    retryDelayMs: number = 200,
  ): Promise<boolean> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const success = setExpression(expressionValue, lappAdapter, logMessage);
      if (success) {
        if (attempt > 1) {
          console.log(`[setExpression] Expression applied after retry ${attempt}/${maxAttempts}`);
        }
        return true;
      }

      if (attempt < maxAttempts) {
        console.log(
          `[setExpression] Retry scheduled for expression ${String(expressionValue)} ` +
          `(${attempt}/${maxAttempts})`,
        );
        await sleep(retryDelayMs);
      }
    }

    console.error(
      `[setExpression] Exhausted retries for expression ${String(expressionValue)} ` +
      `after ${maxAttempts} attempts`,
    );
    return false;
  }, [setExpression]);

  /**
   * Reset expression to default
   * @param lappAdapter - LAppAdapter instance
   * @param modelInfo - Current model information
   */
  const resetExpression = useCallback((
    lappAdapter: any,
    modelInfo?: ModelInfo,
  ) => {
    if (!lappAdapter) return;

    try {
      // Check if model is loaded and has expressions
      const model = lappAdapter.getModel();
      if (!model || !model._modelSetting) {
        console.log('Model or model settings not loaded yet, skipping expression reset');
        return;
      }

      // If model has a default emotion defined, use it
      if (modelInfo?.defaultEmotion !== undefined) {
        void setExpressionWithRetry(
          modelInfo.defaultEmotion,
          lappAdapter,
          `Reset expression to default: ${modelInfo.defaultEmotion}`,
        );
      } else {
        // Check if model has any expressions before trying to get the first one
        const expressionCount = lappAdapter.getExpressionCount();
        if (expressionCount > 0) {
          const defaultExpressionName = lappAdapter.getExpressionName(0);
          if (defaultExpressionName) {
            void setExpressionWithRetry(
              defaultExpressionName,
              lappAdapter,
            );
          }
        }
      }
    } catch (error) {
      console.log('Failed to reset expression:', error);
    }
  }, [setExpressionWithRetry]);

  return {
    setExpression,
    setExpressionWithRetry,
    resetExpression,
  };
};
