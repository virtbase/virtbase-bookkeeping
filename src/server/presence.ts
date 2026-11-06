export interface Presence {
  connect(): () => void;
  begin(): () => void;
}

interface PresenceOptions {
  graceMs: number;
  onIdle: () => void;
}

export function createPresence({ graceMs, onIdle }: PresenceOptions): Presence {
  let clients = 0;
  let busy = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const update = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (clients === 0 && busy === 0) {
      timer = setTimeout(onIdle, graceMs);
      timer.unref();
    }
  };

  const hold = (change: (delta: number) => void) => {
    change(1);
    update();
    let released = false;
    return () => {
      if (!released) {
        released = true;
        change(-1);
        update();
      }
    };
  };

  update();
  return {
    connect: () =>
      hold((delta) => {
        clients += delta;
      }),
    begin: () =>
      hold((delta) => {
        busy += delta;
      }),
  };
}
