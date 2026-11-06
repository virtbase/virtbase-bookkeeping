import { Check, Copy, X } from "lucide-react";
import { useCopy } from "@/lib/copy";
import { usePrivacy } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const ANNOUNCEMENTS = {
  idle: "",
  copied: "Kopiert",
  failed: "Kopieren nicht möglich",
};

interface CopyButtonProps {
  value: string;
  label: string;
  sensitive?: boolean;
  className?: string;
}

export function CopyButton({
  value,
  label,
  sensitive = true,
  className,
}: CopyButtonProps) {
  const { enabled } = usePrivacy();
  const { state, copy } = useCopy();

  if (sensitive && enabled) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={state === "failed" ? ANNOUNCEMENTS.failed : label}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        state !== "idle" && "opacity-100",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        void copy(value);
      }}
    >
      <span aria-live="polite" className="sr-only">
        {ANNOUNCEMENTS[state]}
      </span>
      {state === "idle" && <Copy className="size-3.5" aria-hidden="true" />}
      {state === "copied" && (
        <Check
          className="zoom-in-50 fade-in size-3.5 animate-in text-foreground duration-150 motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {state === "failed" && (
        <X
          className="fade-in size-3.5 animate-in text-destructive duration-150 motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </button>
  );
}
