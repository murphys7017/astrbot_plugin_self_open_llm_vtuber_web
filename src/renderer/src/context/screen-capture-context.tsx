import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toaster } from "@/components/ui/toaster";

interface ScreenCaptureContextType {
  stream: MediaStream | null;
  isStreaming: boolean;
  error: string;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
}

const ScreenCaptureContext = createContext<ScreenCaptureContextType | undefined>(undefined);

export function ScreenCaptureProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  const resetCaptureState = useCallback((nextError = '') => {
    streamRef.current = null;
    setStream(null);
    setIsStreaming(false);
    setError(nextError);
  }, []);

  const stopCapture = useCallback(() => {
    const activeStream = streamRef.current;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
    }
    resetCaptureState();
    console.info('[ScreenCapture] stopped screen capture stream');
  }, [resetCaptureState]);

  const startCapture = async () => {
    try {
      let mediaStream: MediaStream;

      if (streamRef.current) {
        stopCapture();
      }

      if (window.electron) {
        const sourceId = await window.electron.ipcRenderer.invoke('get-screen-capture');

        const displayMediaOptions: DisplayMediaStreamOptions = {
          video: {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
              minWidth: 1280,
              maxWidth: 1280,
              minHeight: 720,
              maxHeight: 720,
            },
          },
          audio: false,
        };

        mediaStream = await navigator.mediaDevices.getUserMedia(displayMediaOptions);
        console.info('[ScreenCapture] obtained desktop source for screen capture', {
          sourceId,
        });
      } else {
        const displayMediaOptions: DisplayMediaStreamOptions = {
          video: true,
          audio: false,
        };
        mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      }

      mediaStream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (streamRef.current !== mediaStream) {
            return;
          }
          console.info('[ScreenCapture] screen capture track ended', {
            label: track.label,
            readyState: track.readyState,
          });
          resetCaptureState();
        });
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsStreaming(true);
      setError('');
      console.info('[ScreenCapture] screen capture stream started', {
        videoTrackCount: mediaStream.getVideoTracks().length,
      });
    } catch (err) {
      setError(t('error.failedStartScreenCapture'));
      toaster.create({
        title: `${t('error.failedStartScreenCapture')}: ${err}`,
        type: 'error',
        duration: 2000,
      });
      console.error(err);
    }
  };

  return (
    <ScreenCaptureContext.Provider
      // eslint-disable-next-line react/jsx-no-constructed-context-values
      value={{
        stream,
        isStreaming,
        error,
        startCapture,
        stopCapture,
      }}
    >
      {children}
    </ScreenCaptureContext.Provider>
  );
}

export const useScreenCaptureContext = () => {
  const context = useContext(ScreenCaptureContext);
  if (context === undefined) {
    throw new Error('useScreenCaptureContext must be used within a ScreenCaptureProvider');
  }
  return context;
};
