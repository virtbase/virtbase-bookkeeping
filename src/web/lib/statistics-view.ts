import type { Granularity, GroupBy } from "@shared/statistics.ts";
import { shiftDay, shiftMonth } from "@shared/statistics.ts";
import type { Source } from "@shared/types.ts";

export type Preset = "30" | "90" | "12m" | "year";

export interface StatisticsView {
  preset: Preset | null;
  from: string;
  to: string;
  granularity: Granularity;
  groupBy: GroupBy;
  sources: Source[];
  customers: string[];
  products: string[];
}

export const DEFAULT_STATISTICS_VIEW: StatisticsView = {
  preset: "12m",
  from: "",
  to: "",
  granularity: "month",
  groupBy: "source",
  sources: [],
  customers: [],
  products: [],
};

export function presetStart(preset: Preset, today: string): string {
  if (preset === "30") {
    return shiftDay(today, -29);
  }
  if (preset === "90") {
    return shiftDay(today, -89);
  }
  return preset === "12m"
    ? shiftMonth(today, -11)
    : `${today.slice(0, 4)}-01-01`;
}

export function withPreset(
  view: StatisticsView,
  today: string,
): StatisticsView {
  if (view.preset !== null || !view.from || !view.to) {
    const preset = view.preset ?? "12m";
    return { ...view, preset, from: presetStart(preset, today), to: today };
  }
  return view;
}
