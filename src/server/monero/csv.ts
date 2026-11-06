export interface MoneroRow {
  txid: string;
  occurredAt: number;
  atomic: string;
  label: string;
  note: string;
}

const REQUIRED = ["blockHeight", "epoch", "direction", "atomicAmount", "txid"];

function parseLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (quoted) {
      if (character === '"' && line.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

export function parseMoneroCsv(text: string): MoneroRow[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const headerLine = lines.shift();
  if (!headerLine) {
    throw new Error("Die Monero-Datei ist leer.");
  }
  const header = parseLine(headerLine).map((column) => column.trim());
  const missing = REQUIRED.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `Das ist keine Monero-GUI-CSV. Es fehlen: ${missing.join(", ")}`,
    );
  }
  const position = (column: string) => header.indexOf(column);
  const rows: MoneroRow[] = [];
  for (const line of lines) {
    const fields = parseLine(line);
    const read = (column: string) => fields[position(column)]?.trim() ?? "";
    if (read("direction") !== "in" || read("blockHeight") === "0") {
      continue;
    }
    rows.push({
      txid: read("txid"),
      occurredAt: Number(read("epoch")),
      atomic: read("atomicAmount"),
      label: read("label"),
      note: read("description"),
    });
  }
  return rows;
}

export function withStableIds<T extends MoneroRow>(
  rows: T[],
): (T & { id: string })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `xmr:${row.txid}:${row.atomic}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...row, id: count === 0 ? base : `${base}:${count}` };
  });
}
