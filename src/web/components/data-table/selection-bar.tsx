import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface SelectionBarProps {
  count: number;
  onClear: () => void;
  children: ReactNode;
}

export function SelectionBar({ count, onClear, children }: SelectionBarProps) {
  if (count === 0) {
    return null;
  }
  return (
    <div className="-translate-x-1/2 slide-in-from-bottom-4 fixed bottom-4 left-1/2 z-30 flex w-max max-w-[calc(100vw-2rem)] animate-in flex-wrap items-center justify-center gap-2 rounded-lg border bg-card p-1.5 shadow-lg duration-200">
      <span className="flex h-8 items-center gap-1 rounded-md border border-dashed pr-1 pl-2.5">
        {count} ausgewählt
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Auswahl aufheben"
          onClick={onClear}
        >
          <X />
        </Button>
      </span>
      {children}
    </div>
  );
}
