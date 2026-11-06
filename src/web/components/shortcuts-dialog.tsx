import { KeyHint } from "@/components/shortcut-hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FOCUSED_SHORTCUTS,
  isSingleKey,
  SHORTCUTS,
  type ShortcutId,
  useShortcutsEnabled,
} from "@/lib/shortcuts";

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enabled = useShortcutsEnabled();
  const available = (Object.keys(SHORTCUTS) as ShortcutId[])
    .filter((id) => enabled || !isSingleKey(id))
    .map((id) => SHORTCUTS[id]);
  const all = [...available, ...FOCUSED_SHORTCUTS];
  const groups = [...new Set(all.map((entry) => entry.group))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tastenkürzel</DialogTitle>
          <DialogDescription>
            {enabled
              ? "Kürzel aus einzelnen Tasten lassen sich in den Einstellungen abschalten."
              : "Kürzel aus einzelnen Tasten sind in den Einstellungen abgeschaltet."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group} className="flex flex-col gap-1.5">
              <h3 className="font-medium text-muted-foreground text-xs">
                {group}
              </h3>
              <dl className="flex flex-col gap-1.5 text-sm">
                {all
                  .filter((entry) => entry.group === group)
                  .map((entry) => (
                    <div
                      key={entry.label}
                      className="flex items-center justify-between gap-4"
                    >
                      <dt>{entry.label}</dt>
                      <dd>
                        <KeyHint keys={entry.keys} />
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
