import { de } from "@daypicker/react/locale";
import { CalendarDays } from "lucide-react";
import { FilterTrigger } from "@/components/data-table/filter-trigger";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateOfDay, dayOfDate, formatIsoRange } from "@/lib/format";

interface RangeCalendarProps {
  from: string | null;
  to: string | null;
  defaultMonth: string | null;
  autoFocus?: boolean;
  onChange: (from: string | null, to: string | null) => void;
}

export function RangeCalendar({
  from,
  to,
  defaultMonth,
  autoFocus,
  onChange,
}: RangeCalendarProps) {
  return (
    <Calendar
      autoFocus={autoFocus}
      mode="range"
      locale={de}
      captionLayout="dropdown"
      startMonth={new Date(2020, 0)}
      endMonth={new Date()}
      defaultMonth={dateOfDay(defaultMonth)}
      selected={{ from: dateOfDay(from), to: dateOfDay(to) }}
      onSelect={(range) =>
        onChange(
          range?.from ? dayOfDate(range.from) : null,
          range?.to ? dayOfDate(range.to) : null,
        )
      }
    />
  );
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
        <FilterTrigger
          title={title}
          icon={CalendarDays}
          active={from !== null}
          summary={
            from && (
              <span className="font-normal tabular-nums">
                {formatIsoRange(from, to)}
              </span>
            )
          }
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <RangeCalendar
          autoFocus
          from={from}
          to={to}
          defaultMonth={from}
          onChange={onChange}
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
