const TRANSLITERATION: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

export function accountKey(name: string): string {
  return name.trim().toLocaleLowerCase("de-DE");
}

export function accountSlug(name: string): string {
  const slug = accountKey(name)
    .replace(/[äöüß]/g, (letter) => TRANSLITERATION[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "konto";
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
