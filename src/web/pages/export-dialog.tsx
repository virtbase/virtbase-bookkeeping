import { groupByAccount } from "@shared/accounts.ts";
import { formatSignedEuro } from "@shared/money.ts";
import type { TransactionDto } from "@shared/types.ts";
import { useState } from "react";
import { toast } from "sonner";
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
import { countLabel, rowLabel } from "@/lib/format";

interface ExportDialogProps {
  open: boolean;
  rows: TransactionDto[];
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

function net(rows: TransactionDto[]): number {
  return rows.reduce((total, row) => total + row.amountCents, 0);
}

export function ExportDialog({
  open,
  rows,
  onOpenChange,
  onConfirm,
}: ExportDialogProps) {
  const [busy, setBusy] = useState(false);
  const groups = groupByAccount(rows);
  const title =
    groups.length > 1
      ? `${countLabel(groups.length, "Datei", "Dateien")} exportieren`
      : `${rowLabel(rows.length)} exportieren`;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
