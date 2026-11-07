import { bucketEnd, shiftMonth } from "@shared/periods.ts";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { RangeCalendar } from "@/components/data-table/date-range-filter";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatIsoRange, formatMonth } from "@/lib/format";
import type { RangePreset, TransactionFilter } from "@/lib/transaction-filter";
import { RANGE_LABELS } from "@/lib/transaction-filter";
import { cn } from "@/lib/utils";

const MONTH_COUNT = 24;

type PeriodValue = Pick<TransactionFilter, "range" | "from" | "to">;

function monthEnd(month: string): string {
  return bucketEnd(`${month}-01`, "month");
}

function wholeMonth(from: string, to: string | null): string | null {
  const month = from.slice(0, 7);
  return from === `${month}-01` && to === monthEnd(month) ? month : null;
}

function periodLabel({ range, from, to }: PeriodValue): string {
  if (range) {
    return RANGE_LABELS[range];
  }
  if (!from) {
    return RANGE_LABELS.all;
  }
  const month = wholeMonth(from, to);
  if (month) {
    return formatMonth(month);
  }
  return formatIsoRange(from, to);
}

interface PeriodFilterProps {
  value: PeriodValue;
  today: string;
  onChange: (value: PeriodValue) => void;
}

export function PeriodFilter({ value, today, onChange }: PeriodFilterProps) {
  const [open, setOpen] = useState(false);
  const months = Array.from({ length: MONTH_COUNT }, (_, index) =>
    shiftMonth(today, -index).slice(0, 7),
  );
  const selectedMonth =
    value.range === null && value.from
      ? wholeMonth(value.from, value.to)
      : null;

  const choose = (next: PeriodValue) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarDays />
          {periodLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex w-auto flex-col p-0 sm:flex-row"
        align="start"
      >
        <div className="flex flex-col gap-0.5 border-b p-2 sm:w-48 sm:border-r sm:border-b-0">
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((preset) => (
            <Button
              key={preset}
              variant="ghost"
              size="sm"
              aria-pressed={value.range === preset}
              className={cn(
                "justify-start font-normal",
                value.range === preset && "bg-muted font-medium",
              )}
              onClick={() => choose({ range: preset, from: null, to: null })}
            >
              {RANGE_LABELS[preset]}
            </Button>
          ))}
          <Select
            value={selectedMonth ?? ""}
            onValueChange={(month) =>
              choose({ range: null, from: `${month}-01`, to: monthEnd(month) })
            }
          >
            <SelectTrigger
              size="sm"
              className="mt-1.5 w-full"
              aria-label="Monat wählen"
            >
              <SelectValue placeholder="Monat wählen" />
            </SelectTrigger>
            <SelectContent>
              {months.map((month) => (
                <SelectItem key={month} value={month}>
                  {formatMonth(month)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <RangeCalendar
          from={value.range === null ? value.from : null}
          to={value.range === null ? value.to : null}
          defaultMonth={value.range === null ? value.from : today}
          onChange={(from, to) =>
            onChange({ range: from ? null : "all", from, to })
          }
        />
      </PopoverContent>
    </Popover>
  );
}
