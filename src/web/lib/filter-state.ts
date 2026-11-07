import type { PaginationState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useSessionState } from "@/lib/use-session-state";

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((value, index) => value === b[index])
    );
  }
  if (typeof a === "string" && typeof b === "string") {
    return a.trim() === b.trim();
  }
  return a === b;
}

export function matchesDefaults<T extends object>(
  filter: T,
  defaults: T,
): boolean {
  return (Object.keys(defaults) as (keyof T)[]).every(
    (key) => key === "to" || same(filter[key], defaults[key]),
  );
}

export function useStoredFilter<T extends object>(
  key: string,
  defaults: T,
  pageSize: number,
) {
  const [stored, replace] = useSessionState<Partial<T>>(key, defaults);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setPagination({ ...pagination, pageIndex: 0 });
  }
  const filter = useMemo(
    () => ({ ...defaults, ...stored }),
    [defaults, stored],
  );
  return {
    filter,
    filtered: !matchesDefaults(filter, defaults),
    update: (change: Partial<T>) => replace({ ...filter, ...change }),
    replace,
    pagination,
    setPagination,
  };
}
