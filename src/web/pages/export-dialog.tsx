import { groupByAccount } from "@shared/accounts.ts";
import { formatSignedEuro } from "@shared/money.ts";
import type { BatchDto, TransactionDto } from "@shared/types.ts";
import { CircleCheck, FolderOpen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Private } from "@/components/private";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { countLabel, rowLabel } from "@/lib/format";

interface ExportDialogProps {
  open: boolean;
  rows: TransactionDto[];
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<BatchDto[]>;
  onUndo: (batches: BatchDto[]) => Promise<void>;
  onImported: () => Promise<void>;
}

function ExportResult({
  batches,
  onUndo,
  onImported,
  onClose,
}: {
  batches: BatchDto[];
  onUndo: (batches: BatchDto[]) => Promise<void>;
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const [imported, setImported] = useState<number[]>([]);

  const reveal = (id: number) =>
    api.revealExport(id).catch((error: Error) => toast.error(error.message));

  const markImported = async (id: number) => {
    try {
      await api.markImported(id);
      setImported([...imported, id]);
      await onImported();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {countLabel(batches.length, "Datei", "Dateien")} gespeichert
        </DialogTitle>
        <DialogDescription>
          Importiere die CSV in Lexware und bestätige es hier.
        </DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-3 text-sm">
        {batches.map((batch) => (
          <li
            key={batch.id}
            className="flex flex-col gap-2 rounded-md border p-3"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{batch.account}</span>
              <span className="text-muted-foreground">
                {rowLabel(batch.rowCount)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              <span
                className="min-w-0 truncate font-mono"
                title={batch.filePath}
              >
                {batch.fileName}
              </span>
              <CopyButton
                value={batch.filePath}
                label="Dateipfad kopieren"
                sensitive={false}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reveal(batch.id)}
              >
                <FolderOpen />
                Im Ordner zeigen
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={imported.includes(batch.id)}
                onClick={() => void markImported(batch.id)}
              >
                <CircleCheck />
                {imported.includes(batch.id)
                  ? "Importiert"
                  : "In Lexware importiert"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button
          variant="outline"
          disabled={imported.length > 0}
          onClick={() => void onUndo(batches).then(onClose)}
        >
          Rückgängig
        </Button>
        <Button onClick={onClose}>Fertig</Button>
      </DialogFooter>
    </>
  );
}

function net(rows: TransactionDto[]): number {
  return rows.reduce((total, row) => total + row.amountCents, 0);
}

export function ExportDialog({
  open,
  rows,
  onOpenChange,
  onConfirm,
  onUndo,
  onImported,
}: ExportDialogProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchDto[] | null>(null);
  const groups = groupByAccount(rows);
  const title =
    groups.length > 1
      ? `${countLabel(groups.length, "Datei", "Dateien")} exportieren`
      : `${rowLabel(rows.length)} exportieren`;

  const confirm = async () => {
    setBusy(true);
    try {
      setResult(await onConfirm());
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const change = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setResult(null);
    }
  };

  if (open && result) {
    return (
      <Dialog open onOpenChange={change}>
        <DialogContent className="sm:max-w-md">
          <ExportResult
            batches={result}
            onUndo={onUndo}
            onImported={onImported}
            onClose={() => change(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Keine dieser Zeilen wurde bereits exportiert.
          </DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-3 text-sm">
          {groups.map((group) => (
            <div
              key={group.account}
              className="flex items-baseline justify-between gap-4"
            >
              <dt>
                <span className="font-medium">{group.account}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {rowLabel(group.rows.length)}
                </span>
              </dt>
              <dd className="font-mono text-[13px]">
                <Private>{formatSignedEuro(net(group.rows))}</Private>
              </dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>
            Abbrechen
          </Button>
          <Button disabled={busy} onClick={() => void confirm()}>
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
