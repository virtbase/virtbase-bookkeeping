import { TriangleAlert } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Section } from "@/components/settings-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { openPage } from "@/lib/navigate";

interface DangerAction {
  id: "exports" | "all";
  title: string;
  summary: string;
  button: string;
  warning: string;
}

const BACKUP_NOTE =
  "Vorher wird automatisch eine Sicherung im Datenordner angelegt. Exportierte CSV-Dateien bleiben erhalten.";

const ACTIONS: DangerAction[] = [
  {
    id: "exports",
    title: "Exporte zurücksetzen",
    summary:
      "Löscht Exporte, ausgeblendete Zeilen und Zuordnungen. Einstellungen und Schlüssel bleiben.",
    button: "Exporte zurücksetzen",
    warning:
      "Alle Exporte, ausgeblendeten Zeilen und Monero-Zuordnungen werden gelöscht, Transaktionen werden neu geladen. Bereits in Lexware importierte Zeilen erscheinen wieder als bereit und könnten doppelt gebucht werden. Prüfe danach „Bereits in Lexware bis“.",
  },
  {
    id: "all",
    title: "Datenbank zurücksetzen",
    summary: "Löscht alles: Einstellungen, Schlüssel, Wallet und Daten.",
    button: "Datenbank zurücksetzen",
    warning:
      "Alle Einstellungen, API-Schlüssel, das View-only-Wallet, alle Transaktionen und Exporte werden gelöscht. Die App startet danach wie bei der ersten Einrichtung.",
  },
];

export function DangerZone({ onChanged }: { onChanged: () => Promise<void> }) {
  const [active, setActive] = useState<DangerAction | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!active) {
      return;
    }
    setBusy(true);
    try {
      await api.reset(active.id);
      if (active.id === "all") {
        window.location.reload();
        return;
      }
      setActive(null);
      await onChanged();
      openPage("transaktionen");
      toast("Exporte zurückgesetzt.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Gefährliche Aktionen" icon={TriangleAlert}>
      <Card className="border-dashed bg-transparent py-5 shadow-none">
        <CardContent className="flex flex-col gap-5 px-5">
          {ACTIONS.map((action, index) => (
            <Fragment key={action.id}>
              {index > 0 && <Separator />}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="font-medium">{action.title}</div>
                  <p className="text-muted-foreground">{action.summary}</p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="w-fit shrink-0"
                  onClick={() => setActive(action)}
                >
                  {action.button}
                </Button>
              </div>
            </Fragment>
          ))}
        </CardContent>
      </Card>

      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{active?.title}?</DialogTitle>
            <DialogDescription>{active?.warning}</DialogDescription>
            <DialogDescription>{BACKUP_NOTE}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setActive(null)}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {active?.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
