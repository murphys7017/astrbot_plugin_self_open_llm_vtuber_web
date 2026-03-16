import { useDisclosure } from '@chakra-ui/react';
import { useMode } from '@/context/mode-context';

export const useSidebar = () => {
  const disclosure = useDisclosure();
  const { setMode, mode, isElectron } = useMode();

  return {
    settingsOpen: disclosure.open,
    onSettingsOpen: disclosure.onOpen,
    onSettingsClose: disclosure.onClose,
    setMode,
    currentMode: mode,
    isElectron,
  };
};
