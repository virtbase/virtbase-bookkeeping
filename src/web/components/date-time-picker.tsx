import { de } from "@daypicker/react/locale";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateOfDay, dayOfDate, formatIsoDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const DEFAULT_TIME = "23:59";

export function parseTime(text: string): string | null {
  const match = /^([01]\d|2[0-3]):?([0-5]\d)$/.exec(text.trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

interface DateTimePickerProps {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export function DateTimePicker({
  id,
  value,
  invalid,
  onChange,
  onBlur,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [day = "", time = DEFAULT_TIME] = value ? value.split("T") : [];
  const selected = dateOfDay(day);
  const today = new Date();
  const timeId = `${id}-time`;

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
          {value ? `${formatIsoDay(day)}, ${time} Uhr` : "Zeitpunkt wählen"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={de}
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={today}
          disabled={{ after: today }}
          selected={selected}
          defaultMonth={selected ?? today}
          onSelect={(date) => {
            if (date) {
              onChange(`${dayOfDate(date)}T${time}`);
            }
          }}
        />
        <div className="flex items-center gap-3 border-t p-3">
          <Label htmlFor={timeId} className="font-normal">
            Uhrzeit
          </Label>
          <Input
            id={timeId}
            inputMode="numeric"
            placeholder={DEFAULT_TIME}
            maxLength={5}
            value={draft ?? time}
            disabled={!day}
            aria-invalid={draft !== null}
            className="ml-auto h-8 w-20 text-center tabular-nums"
            onBlur={() => setDraft(null)}
            onChange={(event) => {
              const text = event.target.value;
              const parsed = parseTime(text);
              if (parsed) {
                onChange(`${day}T${parsed}`);
                setDraft(null);
              } else {
                setDraft(text);
              }
            }}
          />
        </div>
        <div className="flex justify-between gap-2 border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!value}
            onClick={() => {
              onChange("");
              setOpen(false);
              onBlur();
            }}
          >
            Zurücksetzen
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              onBlur();
            }}
          >
            Fertig
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
