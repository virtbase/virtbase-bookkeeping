import { de } from "@daypicker/react/locale";
import { CalendarDays, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { formatIsoDay } from "@/lib/format";

function toDate(day: string | null): Date | undefined {
  if (!day) {
    return undefined;
  }
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function toDay(date: Date | undefined): string | null {
  if (!date) {
    return null;
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function rangeLabel(from: string, to: string | null): string {
  if (!to || to === from) {
    return formatIsoDay(from);
  }
  return `${formatIsoDay(from)} – ${formatIsoDay(to)}`;
}

interface DateRangeFilterProps {
  title: string;
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}

export function DateRangeFilter({
  title,
  from,
  to,
  onChange,
}: DateRangeFilterProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="font-medium">
          {from ? <XCircle /> : <CalendarDays />}
          {title}
          {from && (
            <>
              <Separator
                orientation="vertical"
                className="mx-0.5 data-[orientation=vertical]:h-4"
              />
              <span className="font-normal tabular-nums">
                {rangeLabel(from, to)}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          autoFocus
          mode="range"
          locale={de}
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date()}
          defaultMonth={toDate(from)}
          selected={{ from: toDate(from), to: toDate(to) }}
          onSelect={(range) => onChange(toDay(range?.from), toDay(range?.to))}
        />
        <div className="flex justify-end border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!from}
            onClick={() => onChange(null, null)}
          >
            Filter löschen
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
