export function accountKey(name: string): string {
  return name.trim().toLocaleLowerCase("de-DE");
}

export interface AccountGroup<T> {
  account: string;
  rows: T[];
}

export function groupByAccount<T extends { account: string }>(
  rows: T[],
): AccountGroup<T>[] {
  const groups = new Map<string, AccountGroup<T>>();
  for (const row of rows) {
    const key = accountKey(row.account);
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(key, { account: row.account.trim(), rows: [row] });
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "de-DE"))
    .map(([, group]) => group);
}
