import type { TransactionDto } from "@shared/types.ts";

export function selectedVisibleRows(
  visible: TransactionDto[],
  selection: Record<string, boolean>,
): TransactionDto[] {
  return visible.filter(
    (row) => row.status === "ready" && selection[row.id] === true,
  );
}
