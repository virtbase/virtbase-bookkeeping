import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "blue" | "amber" | "neutral";

const TONES: Record<Tone, string> = {
  blue: "bg-status-blue text-status-blue-foreground",
  amber: "bg-status-amber text-status-amber-foreground",
  neutral: "bg-muted text-muted-foreground",
};

export function StatusBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 font-medium text-xs leading-5",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
