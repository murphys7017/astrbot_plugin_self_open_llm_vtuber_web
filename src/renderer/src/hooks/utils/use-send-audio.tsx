import { useCallback } from "react";
import { useWebSocket } from "@/context/websocket-context";
import { markFrontendRequestStart } from '@/utils/timing-debug';

const AUDIO_STREAM_SAMPLE_RATE = 16000;
const AUDIO_STREAM_CHANNELS = 1;
const AUDIO_STREAM_CHUNK_SAMPLES = 8192;

const createAudioStreamId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `audio-stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const encodePcm16ChunkBase64 = (chunk: Float32Array) => {
  const pcm16 = new Int16Array(chunk.length);
  for (let i = 0; i < chunk.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, chunk[i]));
    pcm16[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }

  const pcmBytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < pcmBytes.length; i += 1) {
    binary += String.fromCharCode(pcmBytes[i]);
  }
  return btoa(binary);
};

export function useSendAudio() {
  const { sendMessage } = useWebSocket();

  const startAudioStream = useCallback(() => {
    const streamId = createAudioStreamId();

    markFrontendRequestStart('voice', {
      imageCount: 0,
      streamId,
    });

    sendMessage({
      type: "audio-stream-start",
      stream_id: streamId,
      sample_rate: AUDIO_STREAM_SAMPLE_RATE,
      channels: AUDIO_STREAM_CHANNELS,
      encoding: "pcm16le",
    });

    return {
      streamId,
      nextSeq: 0,
      totalSamples: 0,
    };
  }, [sendMessage]);

  const sendAudioStreamFrame = useCallback((
    streamState: {
      streamId: string
      nextSeq: number
      totalSamples: number
    } | null,
    frame: Float32Array,
  ) => {
    if (!streamState || frame.length === 0) {
      return streamState;
    }

    let nextState = streamState;
    for (
      let index = 0;
      index < frame.length;
      index += AUDIO_STREAM_CHUNK_SAMPLES
    ) {
      const endIndex = Math.min(index + AUDIO_STREAM_CHUNK_SAMPLES, frame.length);
      const chunk = frame.slice(index, endIndex);
      sendMessage({
        type: "audio-stream-chunk",
        stream_id: nextState.streamId,
        seq: nextState.nextSeq,
        encoding: "pcm16le",
        audio_base64: encodePcm16ChunkBase64(chunk),
      });
      nextState = {
        ...nextState,
        nextSeq: nextState.nextSeq + 1,
        totalSamples: nextState.totalSamples + chunk.length,
      };
    }

    return nextState;
  }, [sendMessage]);

  const finishAudioStream = useCallback(async (
    streamState: {
      streamId: string
      nextSeq: number
      totalSamples: number
    } | null,
  ) => {
    if (!streamState) {
      return;
    }

    sendMessage({
      type: "audio-stream-end",
      stream_id: streamState.streamId,
      total_samples: streamState.totalSamples,
    });
  }, [sendMessage]);

  const interruptAudioStream = useCallback((streamState: {
    streamId: string
    nextSeq: number
    totalSamples: number
  } | null) => {
    if (!streamState) {
      return;
    }

    sendMessage({
      type: "audio-stream-interrupt",
      stream_id: streamState.streamId,
    });
  }, [sendMessage]);

  return {
    startAudioStream,
    sendAudioStreamFrame,
    finishAudioStream,
    interruptAudioStream,
  };
}
