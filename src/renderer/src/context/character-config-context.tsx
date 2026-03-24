import {
  createContext, useContext, useState, useMemo,
} from 'react';

/**
 * Character configuration context state interface
 * @interface CharacterConfigState
 */
interface CharacterConfigState {
  confName: string;
  confUid: string;
  setConfName: (name: string) => void;
  setConfUid: (uid: string) => void;
}

/**
 * Default values and constants
 */
const DEFAULT_CONFIG = {
  confName: '',
  confUid: '',
};

/**
 * Create the character configuration context
 */
export const ConfigContext = createContext<CharacterConfigState | null>(null);

/**
 * Character Configuration Provider Component
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function CharacterConfigProvider({ children }: { children: React.ReactNode }) {
  const [confName, setConfName] = useState<string>(DEFAULT_CONFIG.confName);
  const [confUid, setConfUid] = useState<string>(DEFAULT_CONFIG.confUid);

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      confName,
      confUid,
      setConfName,
      setConfUid,
    }),
    [confName, confUid],
  );

  return (
    <ConfigContext.Provider value={contextValue}>
      {children}
    </ConfigContext.Provider>
  );
}

/**
 * Custom hook to use the character configuration context
 * @throws {Error} If used outside of CharacterConfigProvider
 */
export function useConfig() {
  const context = useContext(ConfigContext);

  if (!context) {
    throw new Error('useConfig must be used within a CharacterConfigProvider');
  }

  return context;
}
