/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react/require-default-props */
import { Stack, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';
import { useASRSettings } from '@/hooks/sidebar/setting/use-asr-settings';
import { SwitchField, NumberField, SelectField } from './common';
import { Button } from '@/components/ui/button';

interface ASRProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

const UI_TIMEOUT_MS = 10000;

function ASR({ onSave, onCancel }: ASRProps): JSX.Element {
  const { t } = useTranslation();
  const {
    localSettings,
    autoStopMic,
    autoStartMicOn,
    autoStartMicOnConvEnd,
    selectedMicId,
    setSelectedMicId,
    microphoneCollection,
    refreshAudioInputDevices,
    ensureMicrophonePermission,
    setAutoStopMic,
    setAutoStartMicOn,
    setAutoStartMicOnConvEnd,
    handleInputChange,
    handleSave,
    handleCancel,
  } = useASRSettings();
  const [requestingMicPermission, setRequestingMicPermission] = useState(false);

  const withUiTimeout = async (task: () => Promise<void | boolean>) => {
    await Promise.race([
      task(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Microphone request timed out in UI')), UI_TIMEOUT_MS);
      }),
    ]);
  };

  const handleRequestMicrophoneAccess = async () => {
    setRequestingMicPermission(true);
    try {
      await withUiTimeout(async () => {
        await ensureMicrophonePermission();
        await refreshAudioInputDevices();
      });
    } finally {
      setRequestingMicPermission(false);
    }
  };

  const handleRefreshDevices = async () => {
    setRequestingMicPermission(true);
    try {
      await withUiTimeout(async () => {
        await refreshAudioInputDevices();
      });
    } finally {
      setRequestingMicPermission(false);
    }
  };

  useEffect(() => {
    if (!onSave || !onCancel) return;

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);

    return (): void => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [onSave, onCancel, handleSave, handleCancel]);

  return (
    <Stack {...settingStyles.common.container}>
      <SelectField
        label={t('settings.asr.microphone')}
        value={selectedMicId}
        onChange={setSelectedMicId}
        collection={microphoneCollection}
        placeholder={t('settings.asr.selectMicrophone')}
      />

      {microphoneCollection.items.length === 0 && (
        <Stack gap={2}>
          <Text fontSize="sm" color="whiteAlpha.700">
            {t('settings.asr.microphonePermissionHelp')}
          </Text>
          <Stack direction="row" gap={2}>
            <Button
              size="sm"
              variant="outline"
              loading={requestingMicPermission}
              onClick={handleRequestMicrophoneAccess}
            >
              {t('settings.asr.requestMicrophonePermission')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={requestingMicPermission}
              onClick={handleRefreshDevices}
            >
              {t('settings.asr.refreshMicrophones')}
            </Button>
          </Stack>
        </Stack>
      )}

      <SwitchField
        label={t('settings.asr.autoStopMic')}
        checked={autoStopMic}
        onChange={setAutoStopMic}
      />

      <SwitchField
        label={t('settings.asr.autoStartMicOnConvEnd')}
        checked={autoStartMicOnConvEnd}
        onChange={setAutoStartMicOnConvEnd}
      />

      <SwitchField
        label={t('settings.asr.autoStartMicOn')}
        checked={autoStartMicOn}
        onChange={setAutoStartMicOn}
      />

      <NumberField
        label={t('settings.asr.positiveSpeechThreshold')}
        help={t('settings.asr.positiveSpeechThresholdDesc')}
        value={localSettings.positiveSpeechThreshold}
        onChange={(value) => handleInputChange('positiveSpeechThreshold', value)}
        min={1}
        max={100}
      />

      <NumberField
        label={t('settings.asr.negativeSpeechThreshold')}
        help={t('settings.asr.negativeSpeechThresholdDesc')}
        value={localSettings.negativeSpeechThreshold}
        onChange={(value) => handleInputChange('negativeSpeechThreshold', value)}
        min={0}
        max={100}
      />

      <NumberField
        label={t('settings.asr.redemptionFrames')}
        help={t('settings.asr.redemptionFramesDesc')}
        value={localSettings.redemptionFrames}
        onChange={(value) => handleInputChange('redemptionFrames', value)}
        min={1}
        max={100}
      />
    </Stack>
  );
}

export default ASR;
