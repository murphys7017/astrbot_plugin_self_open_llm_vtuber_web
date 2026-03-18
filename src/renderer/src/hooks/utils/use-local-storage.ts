import { useState } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: {
    filter?: (value: T) => T
  },
) {
  const readStoredValue = (): T => {
    try {
      const item = window.localStorage.getItem(key);

      if (item === null || item === 'undefined') {
        if (item === 'undefined') {
          window.localStorage.removeItem(key);
        }
        return initialValue;
      }

      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      window.localStorage.removeItem(key);
      return initialValue;
    }
  };

  const [storedValue, setStoredValue] = useState<T>(() => {
    return readStoredValue();
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      const filteredValue = options?.filter ? options.filter(valueToStore) : valueToStore;
      setStoredValue(valueToStore);

      if (filteredValue === undefined) {
        window.localStorage.removeItem(key);
        return;
      }

      window.localStorage.setItem(key, JSON.stringify(filteredValue));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue] as const;
}
