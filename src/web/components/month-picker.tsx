import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

const LONG_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function monthValue(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function label(value: string): string {
  const [year = "", month = "1"] = value.split("-");
  return `${LONG_MONTHS[Number(month) - 1]} ${year}`;
}

interface MonthPickerProps {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export function MonthPicker({
  id,
  value,
  invalid,
  onChange,
  onBlur,
}: MonthPickerProps) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = monthValue(currentYear, now.getMonth());
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(
    value ? Number(value.slice(0, 4)) : currentYear,
  );

  const close = () => {
    setOpen(false);
    onBlur();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          onBlur();
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          aria-invalid={invalid}
          className={cn(
            "w-full justify-start font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarDays />
          {value ? label(value) : "Monat wählen"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Vorheriges Jahr"
              onClick={() => setYear(year - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="font-medium text-sm tabular-nums">{year}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Nächstes Jahr"
              disabled={year >= currentYear}
              onClick={() => setYear(year + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((name, index) => {
              const option = monthValue(year, index);
              return (
                <Button
                  key={name}
                  variant={option === value ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={option === value}
                  aria-label={`${LONG_MONTHS[index]} ${year}`}
                  disabled={option >= currentMonth}
                  className="font-normal"
                  onClick={() => {
                    onChange(option);
                    close();
                  }}
                >
                  {name}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!value}
            onClick={() => {
              onChange("");
              close();
            }}
          >
            Zurücksetzen
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
