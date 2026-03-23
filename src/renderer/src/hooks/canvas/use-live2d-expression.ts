import { useCallback } from 'react';
import { ModelInfo } from '@/context/live2d-config-context';

/**
 * Custom hook for handling Live2D model expressions
 */
export const useLive2DExpression = () => {
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
      throw new Error(
        `[setExpression] Expression assets are still loading: `
        + `${loadedExpressionNames.length}/${modelExpressionCount}`,
      );
    }

    if (typeof expressionValue === 'number') {
      if (expressionValue < 0 || expressionValue >= modelExpressionCount) {
        throw new Error(
          `[setExpression] Expression index ${expressionValue} is out of range `
          + `for ${modelExpressionCount} expressions.`,
        );
      }
      const expressionName = lappAdapter.getExpressionName(expressionValue);
      if (!expressionName) {
        throw new Error(`[setExpression] Failed to resolve expression name for index ${expressionValue}.`);
      }
      return expressionName;
    }

    if (typeof expressionValue !== 'string') {
      throw new Error(`[setExpression] Unsupported expression value type: ${typeof expressionValue}`);
    }

    const trimmedValue = expressionValue.trim();
    if (!trimmedValue) {
      throw new Error('[setExpression] Empty expression value received');
    }

    const resolvedFromFile = resolveExpressionNameFromFile(trimmedValue, lappAdapter);
    if (resolvedFromFile) {
      return resolvedFromFile;
    }

    if (/^\d+$/.test(trimmedValue)) {
      const expressionIndex = Number(trimmedValue);
      if (expressionIndex < 0 || expressionIndex >= modelExpressionCount) {
        throw new Error(
          `[setExpression] Expression index ${expressionIndex} is out of range `
          + `for ${modelExpressionCount} expressions.`,
        );
      }
      const expressionName = lappAdapter.getExpressionName(expressionIndex);
      if (!expressionName) {
        throw new Error(`[setExpression] Failed to resolve expression name for index ${expressionIndex}.`);
      }
      return expressionName;
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

    throw new Error(
      `[setExpression] Failed to resolve expression "${trimmedValue}". `
      + `Available expressions: ${loadedExpressionNames.join(', ')}`,
    );
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
    const expressionName = resolveExpressionName(expressionValue, lappAdapter);
    lappAdapter.setExpression(expressionName);

    if (logMessage) {
      console.log(logMessage);
    }

    return true;
  }, [resolveExpressionName]);

  /**
   * Reset expression to default
   * @param lappAdapter - LAppAdapter instance
   * @param modelInfo - Current model information
   */
  const resetExpression = useCallback((
    lappAdapter: any,
    modelInfo?: ModelInfo,
  ) => {
    if (!lappAdapter) {
      throw new Error('Cannot reset expression without a Live2D adapter.');
    }

    const model = lappAdapter.getModel();
    if (!model || !model._modelSetting) {
      throw new Error('Cannot reset expression before the Live2D model is ready.');
    }

    model._expressionManager?.stopAllMotions?.();

    if (modelInfo?.defaultEmotion === undefined) {
      return;
    }

    setExpression(
      modelInfo.defaultEmotion,
      lappAdapter,
      `Reset expression to default: ${modelInfo.defaultEmotion}`,
    );
  }, [setExpression]);

  return {
    setExpression,
    resetExpression,
  };
};
