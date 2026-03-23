type PendingRequestType = 'voice' | 'text' | null;

type TimingDebugState = {
  pendingRequestType: PendingRequestType
  requestStartAt: number | null
  sttLogged: boolean
  responseLogged: boolean
};

declare global {
  interface Window {
    __desktopVtuberTimingDebug__?: TimingDebugState
  }
}

const getTimingDebugState = (): TimingDebugState => {
  if (!window.__desktopVtuberTimingDebug__) {
    window.__desktopVtuberTimingDebug__ = {
      pendingRequestType: null,
      requestStartAt: null,
      sttLogged: false,
      responseLogged: false,
    };
  }
  return window.__desktopVtuberTimingDebug__;
};

export const getPendingFrontendRequestType = (): PendingRequestType => {
  return getTimingDebugState().pendingRequestType;
};

export const markFrontendRequestStart = (
  type: Exclude<PendingRequestType, null>,
  detail?: Record<string, unknown>,
) => {
  const state = getTimingDebugState();
  state.pendingRequestType = type;
  state.requestStartAt = performance.now();
  state.sttLogged = false;
  state.responseLogged = false;

  console.log('[AudioTaskTiming] request_sent', {
    at: state.requestStartAt,
    requestType: type,
    ...detail,
  });
};

export const markFrontendTranscriptionReceived = (text: string) => {
  const state = getTimingDebugState();
  if (state.pendingRequestType !== 'voice' || state.requestStartAt == null || state.sttLogged) {
    return;
  }

  const now = performance.now();
  state.sttLogged = true;
  console.log('[AudioTaskTiming] transcription_received', {
    at: now,
    requestType: state.pendingRequestType,
    elapsedMs: now - state.requestStartAt,
    text,
  });
};

export const markFrontendFirstResponse = (
  responseType: string,
  detail?: Record<string, unknown>,
) => {
  const state = getTimingDebugState();
  if (state.requestStartAt == null || state.responseLogged) {
    return;
  }

  const now = performance.now();
  state.responseLogged = true;
  console.log('[AudioTaskTiming] first_response_received', {
    at: now,
    requestType: state.pendingRequestType,
    responseType,
    elapsedMs: now - state.requestStartAt,
    ...detail,
  });
};
