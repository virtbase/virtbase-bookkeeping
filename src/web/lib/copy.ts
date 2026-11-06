import { useCallback, useEffect, useRef, useState } from "react";

const FEEDBACK_MS = 1500;

export type CopyState = "idle" | "copied" | "failed";

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function useCopy() {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (value: string) => {
    clearTimeout(timer.current);
    setState((await copyText(value)) ? "copied" : "failed");
    timer.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
  }, []);

  return { state, copy };
}
