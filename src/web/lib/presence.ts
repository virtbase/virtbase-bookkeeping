import { useEffect } from "react";

const RETRY_MS = 3000;

export function usePresence(): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      socket = new WebSocket(`ws://${window.location.host}/api/presence`);
      socket.onclose = () => {
        if (!stopped) {
          retry = setTimeout(connect, RETRY_MS);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
}
