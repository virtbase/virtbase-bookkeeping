import { useCallback, useState } from "react";

const PREFIX = "bookkeeping.";

function read<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(PREFIX + key);
    return stored === null ? fallback : (JSON.parse(stored) as T);
  } catch {
    return fallback;
  }
}

export function writeSessionState(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function useSessionState<T>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState(() => read(key, initial));

  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeSessionState(key, next);
    },
    [key],
  );

  return [value, update];
}
