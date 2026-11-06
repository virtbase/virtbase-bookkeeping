import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { MASK, usePrivacy } from "@/lib/preferences";

const REVEAL_MS = 10000;

export function Private({ children }: { children: ReactNode }) {
  const { enabled } = usePrivacy();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) {
      return;
    }
    const timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  if (!enabled) {
    return <>{children}</>;
  }
  return (
    <button
      type="button"
      aria-label={revealed ? "Wert wieder verbergen" : "Wert anzeigen"}
      className="cursor-pointer rounded-sm text-inherit focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={(event) => {
        event.stopPropagation();
        setRevealed(!revealed);
      }}
    >
      {revealed ? (
        children
      ) : (
        <span className="text-muted-foreground tracking-wider">{MASK}</span>
      )}
    </button>
  );
}
