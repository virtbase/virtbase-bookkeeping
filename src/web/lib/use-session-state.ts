import { useEffect, useState } from "react";

const PREFIX = "bookkeeping.";
const EVENT = "bookkeeping:session-state";

interface SessionChange {
  key: string;
  value: unknown;
}

export function readSessionState<T>(key: string, fallback: T): T {
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
  } catch {}
  window.dispatchEvent(
    new CustomEvent<SessionChange>(EVENT, { detail: { key, value } }),
  );
}

export function useSessionState<T>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState(() => readSessionState(key, initial));

  useEffect(() => {
    const listener = (event: Event) => {
      const change = (event as CustomEvent<SessionChange>).detail;
      if (change.key === key) {
        setValue(change.value as T);
      }
    };
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, [key]);

  return [value, (next: T) => writeSessionState(key, next)];
}
