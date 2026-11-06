import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { ShortcutId } from "@/lib/shortcuts";
import { isSingleKey, SHORTCUTS, useShortcutsEnabled } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export function KeyHint({
  keys,
  className,
}: {
  keys: string[];
  className?: string;
}) {
  return (
    <KbdGroup className={className}>
      {keys.map((key) => (
        <Kbd key={key} className="border bg-transparent text-[11px]">
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

export function ShortcutHint({
  id,
  className,
}: {
  id: ShortcutId;
  className?: string;
}) {
  const enabled = useShortcutsEnabled();
  if (!enabled && isSingleKey(id)) {
    return null;
  }
  return (
    <KeyHint
      keys={SHORTCUTS[id].keys}
      className={cn("pointer-events-none", className)}
    />
  );
}
