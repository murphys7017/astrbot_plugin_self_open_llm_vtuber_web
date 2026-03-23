import {
  createContext, useContext, useEffect, useState, useMemo,
} from 'react';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';

/**
 * Model emotion mapping interface
 * @interface EmotionMap
 */
interface EmotionMap {
  [key: string]: number | string;
}

interface MotionMap {
  [key: string]: string | string[];
}

export interface MotionCatalogMap {
  [key: string]: string;
}

/**
 * Motion weight mapping interface
 * @interface MotionWeightMap
 */
export interface MotionWeightMap {
  [key: string]: number;
}

/**
 * Tap motion mapping interface
 * @interface TapMotionMap
 */
export interface TapMotionMap {
  [key: string]: MotionWeightMap;
}

/**
 * Live2D model information interface
 * @interface ModelInfo
 */
export interface ModelInfo {
  /** Model name */
  name?: string;

  /** Model description */
  description?: string;

  /** Model URL */
  url: string;

  /** Scale factor */
  kScale: number;

  /** Initial X position shift */
  initialXshift: number;

  /** Initial Y position shift */
  initialYshift: number;

  /** Idle motion group name */
  idleMotionGroupName?: string;

  /** Default emotion */
  defaultEmotion?: number | string;

  /** Emotion mapping configuration */
  emotionMap: EmotionMap;

  /** Motion mapping configuration */
  motionMap?: MotionMap;

  /** Enable pointer interactivity */
  pointerInteractive?: boolean;

  /** Tap motion mapping configuration */
  tapMotions?: TapMotionMap;

  /** Enable scroll to resize */
  scrollToResize?: boolean;

  /** Initial scale */
  initialScale?: number;
}

/**
 * Live2D configuration context state interface
 * @interface Live2DConfigState
 */
interface Live2DConfigState {
  modelInfo?: ModelInfo;
  motionCatalogMap: MotionCatalogMap;
  setModelInfo: (info: ModelInfo | undefined) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

/**
 * Default values and constants
 */
const DEFAULT_CONFIG = {
  modelInfo: {
    scrollToResize: true,
  } as ModelInfo | undefined,
  motionCatalogMap: {} as MotionCatalogMap,
  isLoading: false,
};

const parseMotionCatalogPayload = (payload: unknown): MotionCatalogMap => {
  const entries = Array.isArray((payload as { motions?: unknown })?.motions)
    ? (payload as { motions: unknown[] }).motions
    : payload;
  const result: MotionCatalogMap = {};

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const motionIdRaw = (entry as { motion_id?: unknown; id?: unknown; key?: unknown }).motion_id
        ?? (entry as { id?: unknown }).id
        ?? (entry as { key?: unknown }).key;
      const motionFileRaw = (entry as { file?: unknown }).file;
      const motionId = typeof motionIdRaw === 'string' ? motionIdRaw.trim().toLowerCase() : '';
      const motionFile = typeof motionFileRaw === 'string' ? motionFileRaw.trim() : '';

      if (motionId && motionFile) {
        result[motionId] = motionFile;
      }
    }
    return result;
  }

  if (!entries || typeof entries !== 'object') {
    return result;
  }

  for (const [rawKey, rawValue] of Object.entries(entries)) {
    const motionId = rawKey.trim().toLowerCase();
    if (!motionId) {
      continue;
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
      result[motionId] = rawValue.trim();
      continue;
    }

    const motionFile = typeof (rawValue as { file?: unknown })?.file === 'string'
      ? (rawValue as { file: string }).file.trim()
      : '';
    if (motionFile) {
      result[motionId] = motionFile;
    }
  }

  return result;
};

const buildMotionCatalogUrls = (modelUrl?: string) => {
  if (!modelUrl) {
    return [];
  }

  const trimmedUrl = modelUrl.trim();
  const lastSlashIndex = trimmedUrl.lastIndexOf('/');
  if (lastSlashIndex < 0) {
    return [];
  }

  const modelBaseUrl = trimmedUrl.slice(0, lastSlashIndex + 1);
  return [
    `${modelBaseUrl}motion_catalog.json`,
    `${modelBaseUrl}motion-catalog.json`,
  ];
};

/**
 * Create the Live2D configuration context
 */
export const Live2DConfigContext = createContext<Live2DConfigState | null>(null);

/**
 * Live2D Configuration Provider Component
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function Live2DConfigProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(DEFAULT_CONFIG.isLoading);
  const [motionCatalogMap, setMotionCatalogMap] = useState<MotionCatalogMap>(
    DEFAULT_CONFIG.motionCatalogMap,
  );

  const [modelInfo, setModelInfoState] = useLocalStorage<ModelInfo | undefined>(
    "modelInfo",
    DEFAULT_CONFIG.modelInfo,
    {
      filter: (value) => (value ? { ...value, url: "" } : value),
    },
  );

  // const [modelInfo, setModelInfoState] = useState<ModelInfo | undefined>(DEFAULT_CONFIG.modelInfo);

  const setModelInfo = (info: ModelInfo | undefined) => {
    if (!info?.url) {
      setModelInfoState(undefined);
      setMotionCatalogMap({});
      return;
    }

    const finalScale = Number(info.kScale || 0.5) * 2;

    setModelInfoState({
      ...info,
      kScale: finalScale,
      pointerInteractive:
        "pointerInteractive" in info
          ? info.pointerInteractive
          : (modelInfo?.pointerInteractive ?? true),
      scrollToResize:
        "scrollToResize" in info
          ? info.scrollToResize
          : (modelInfo?.scrollToResize ?? true),
    });
  };

  useEffect(() => {
    const candidateUrls = buildMotionCatalogUrls(modelInfo?.url);
    if (!candidateUrls.length) {
      setMotionCatalogMap({});
      return undefined;
    }

    const abortController = new AbortController();
    let isDisposed = false;

    const loadMotionCatalog = async () => {
      for (const candidateUrl of candidateUrls) {
        try {
          const response = await fetch(candidateUrl, {
            signal: abortController.signal,
          });
          if (!response.ok) {
            continue;
          }

          const payload = await response.json();
          if (isDisposed) {
            return;
          }

          setMotionCatalogMap(parseMotionCatalogPayload(payload));
          return;
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            return;
          }
        }
      }

      if (!isDisposed) {
        setMotionCatalogMap({});
      }
    };

    void loadMotionCatalog();

    return () => {
      isDisposed = true;
      abortController.abort();
    };
  }, [modelInfo?.url]);

  const contextValue = useMemo(
    () => ({
      modelInfo,
      motionCatalogMap,
      setModelInfo,
      isLoading,
      setIsLoading,
    }),
    [isLoading, modelInfo, motionCatalogMap, setIsLoading],
  );

  return (
    <Live2DConfigContext.Provider value={contextValue}>
      {children}
    </Live2DConfigContext.Provider>
  );
}

/**
 * Custom hook to use the Live2D configuration context
 * @throws {Error} If used outside of Live2DConfigProvider
 */
export function useLive2DConfig() {
  const context = useContext(Live2DConfigContext);

  if (!context) {
    throw new Error('useLive2DConfig must be used within a Live2DConfigProvider');
  }

  return context;
}

// Export the provider as default
export default Live2DConfigProvider;
