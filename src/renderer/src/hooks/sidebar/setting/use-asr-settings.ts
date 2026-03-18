import React, { useRef, useState, useEffect } from 'react';
import { createListCollection } from '@chakra-ui/react';
import { useVAD, VADSettings } from '@/context/vad-context';

export const useASRSettings = () => {
  const {
    settings,
    updateSettings,
    autoStopMic,
    setAutoStopMic,
    autoStartMicOn,
    setAutoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStartMicOnConvEnd,
    audioInputDevices,
    selectedMicId,
    setSelectedMicId,
    refreshAudioInputDevices,
    ensureMicrophonePermission,
  } = useVAD();

  const localSettingsRef = useRef<VADSettings>(settings);
  const originalSettingsRef = useRef(settings);
  const originalAutoStopMicRef = useRef(autoStopMic);
  const originalAutoStartMicOnRef = useRef(autoStartMicOn);
  const originalAutoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const originalSelectedMicIdRef = useRef(selectedMicId);
  const [localVoiceInterruption, setLocalVoiceInterruption] = useState(autoStopMic);
  const [localAutoStartMic, setLocalAutoStartMic] = useState(autoStartMicOn);
  const [localAutoStartMicOnConvEnd, setLocalAutoStartMicOnConvEnd] = useState(autoStartMicOnConvEnd);
  const [localSelectedMicId, setLocalSelectedMicId] = useState(selectedMicId);
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  useEffect(() => {
    setLocalVoiceInterruption(autoStopMic);
    setLocalAutoStartMic(autoStartMicOn);
    setLocalAutoStartMicOnConvEnd(autoStartMicOnConvEnd);
    setLocalSelectedMicId(selectedMicId);
    originalSelectedMicIdRef.current = selectedMicId;
  }, [autoStopMic, autoStartMicOn, autoStartMicOnConvEnd, selectedMicId]);

  const microphoneCollection = createListCollection({
    items: audioInputDevices.map((device) => ({
      label: device.label,
      value: device.deviceId,
    })),
  });

  const handleInputChange = (key: keyof VADSettings, value: number | string): void => {
    if (value === '' || value === '-') {
      localSettingsRef.current = { ...localSettingsRef.current, [key]: value };
    } else {
      const parsed = Number(value);
      // eslint-disable-next-line no-restricted-globals
      if (!isNaN(parsed)) {
        localSettingsRef.current = { ...localSettingsRef.current, [key]: parsed };
      }
    }
    forceUpdate();
  };

  const handleVoiceInterruptionChange = (value: boolean) => {
    setLocalVoiceInterruption(value);
    setAutoStopMic(value);
  };

  const handleAutoStartMicChange = (value: boolean) => {
    setLocalAutoStartMic(value);
    setAutoStartMicOn(value);
  };

  const handleAutoStartMicOnConvEndChange = (value: boolean) => {
    setLocalAutoStartMicOnConvEnd(value);
    setAutoStartMicOnConvEnd(value);
  };

  const handleSave = (): void => {
    updateSettings(localSettingsRef.current);
    void setSelectedMicId(localSelectedMicId);
    originalSettingsRef.current = localSettingsRef.current;
    originalAutoStopMicRef.current = localVoiceInterruption;
    originalAutoStartMicOnRef.current = localAutoStartMic;
    originalAutoStartMicOnConvEndRef.current = localAutoStartMicOnConvEnd;
    originalSelectedMicIdRef.current = localSelectedMicId;
  };

  const handleCancel = (): void => {
    localSettingsRef.current = originalSettingsRef.current;
    setLocalVoiceInterruption(originalAutoStopMicRef.current);
    setLocalAutoStartMic(originalAutoStartMicOnRef.current);
    setAutoStopMic(originalAutoStopMicRef.current);
    setAutoStartMicOn(originalAutoStartMicOnRef.current);
    setLocalAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    setAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    setLocalSelectedMicId(originalSelectedMicIdRef.current);
    forceUpdate();
  };

  return {
    localSettings: localSettingsRef.current,
    autoStopMic: localVoiceInterruption,
    autoStartMicOn: localAutoStartMic,
    autoStartMicOnConvEnd: localAutoStartMicOnConvEnd,
    selectedMicId: localSelectedMicId ? [localSelectedMicId] : [],
    setSelectedMicId: (value: string[]) => setLocalSelectedMicId(value[0] ?? ''),
    microphoneCollection,
    refreshAudioInputDevices,
    ensureMicrophonePermission,
    setAutoStopMic: handleVoiceInterruptionChange,
    setAutoStartMicOn: handleAutoStartMicChange,
    setAutoStartMicOnConvEnd: handleAutoStartMicOnConvEndChange,
    handleInputChange,
    handleSave,
    handleCancel,
  };
};
