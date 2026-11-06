import { useEffect, useRef } from "react";

export type PageAction = { type: "sync" } | { type: "open"; id: string };
type Listener = (action: PageAction) => void;

const listeners = new Set<Listener>();
let pending: PageAction | null = null;

export function requestPageAction(action: PageAction): void {
  if (listeners.size === 0) {
    pending = action;
    return;
  }
  for (const listener of listeners) {
    listener(action);
  }
}

export function usePageActions(handler: Listener): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    const listener: Listener = (action) => latest.current(action);
    listeners.add(listener);
    if (pending) {
      listener(pending);
      pending = null;
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
