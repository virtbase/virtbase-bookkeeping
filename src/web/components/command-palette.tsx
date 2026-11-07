import { formatSignedEuro } from "@shared/money.ts";
import type { ExportsDto, TransactionDto } from "@shared/types.ts";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CalendarCheck,
  CalendarX,
  ChartNoAxesColumn,
  CircleAlert,
  CircleCheck,
  Cog,
  DatabaseBackup,
  Eye,
  FileClock,
  GraduationCap,
  Keyboard,
  List,
  Moon,
  RefreshCw,
  RotateCcw,
  ScrollText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShortcutHint } from "@/components/shortcut-hint";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { batchSearchText } from "@/lib/export-filter";
import { formatStamp } from "@/lib/format";
import { openPage, showExports, showTransactions } from "@/lib/navigate";
import { requestPageAction } from "@/lib/page-actions";
import { usePreferences, usePrivacy } from "@/lib/preferences";
import type { ShortcutId } from "@/lib/shortcuts";
import { runShortcut, useShortcut } from "@/lib/shortcuts";
import {
  contextFilter,
  missingDaysFilter,
  OPEN_FEES_FILTER,
  searchText,
} from "@/lib/transaction-filter";

const RESULT_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

interface Entry {
  label: string;
  icon: LucideIcon;
  shortcut?: ShortcutId;
  run: () => void;
}

function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

export function CommandPalette() {
  const { update, toggleTheme, togglePrivacy } = usePreferences();
  const { mask } = usePrivacy();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [exports, setExports] = useState<ExportsDto | null>(null);

  useShortcut("palette", () => setOpen(!open));

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    void api.transactions().then(setRows);
    void api.exports().then(setExports);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const batches = exports?.batches ?? [];
  const missingDays = exports?.missingDays ?? [];
  const views: Entry[] = [
    {
      label: "Ansicht: Zu prüfen",
      icon: CircleAlert,
      run: () => showTransactions({ statuses: ["review"] }),
    },
    {
      label: "Ansicht: Bereit zum Export",
      icon: CircleCheck,
      run: () => showTransactions({ statuses: ["ready"] }),
    },
    {
      label: "Ansicht: Monatsabschluss",
      icon: CalendarCheck,
      run: () => showTransactions(OPEN_FEES_FILTER),
    },
    {
      label: "Ansicht: Erstattungen und Anpassungen",
      icon: RotateCcw,
      run: () =>
        showTransactions(contextFilter({ kinds: ["refund", "adjustment"] })),
    },
    ...(missingDays.length > 0
      ? [
          {
            label: "Ansicht: Tage ohne Export",
            icon: CalendarX,
            run: () => showTransactions(missingDaysFilter(missingDays)),
          },
        ]
      : []),
    {
      label: "Ansicht: Lexware ausstehend",
      icon: FileClock,
      run: () => showExports({ statuses: ["pending"] }),
    },
  ];
  const pages: Entry[] = [
    {
      label: "Transaktionen",
      icon: List,
      shortcut: "go-transaktionen",
      run: () => openPage("transaktionen"),
    },
    {
      label: "Statistiken",
      icon: ChartNoAxesColumn,
      shortcut: "go-statistiken",
      run: () => openPage("statistiken"),
    },
    {
      label: "Exporte",
      icon: Archive,
      shortcut: "go-exporte",
      run: () => openPage("exporte"),
    },
    {
      label: "Audit-Log",
      icon: ScrollText,
      shortcut: "go-audit-log",
      run: () => openPage("audit-log"),
    },
    {
      label: "Einstellungen",
      icon: Cog,
      shortcut: "go-einstellungen",
      run: () => openPage("einstellungen"),
    },
  ];
  const actions: Entry[] = [
    {
      label: "Aktualisieren",
      icon: RefreshCw,
      shortcut: "sync",
      run: () => {
        openPage("transaktionen");
        requestPageAction({ type: "sync" });
      },
    },
    {
      label: "Privatmodus umschalten",
      icon: Eye,
      shortcut: "privacy",
      run: togglePrivacy,
    },
    { label: "Farbschema wechseln", icon: Moon, run: toggleTheme },
    {
      label: "Jetzt sichern",
      icon: DatabaseBackup,
      run: () => {
        api
          .createBackup()
          .then(() => toast("Sicherung erstellt."))
          .catch((error: Error) => toast.error(error.message));
      },
    },
    {
      label: "Tastenkürzel anzeigen",
      icon: Keyboard,
      shortcut: "help",
      run: () => runShortcut("help"),
    },
    {
      label: "Einführung starten",
      icon: GraduationCap,
      run: () => {
        openPage("transaktionen");
        update({ tourPending: true });
      },
    },
  ];

  const filterEntries = (entries: Entry[]) =>
    entries.filter((entry) => matches(entry.label, needle));
  const foundRows =
    needle.length < MIN_QUERY_LENGTH
      ? []
      : rows
          .filter((row) => searchText(row).includes(needle))
          .slice(0, RESULT_LIMIT);
  const foundBatches =
    needle.length < MIN_QUERY_LENGTH
      ? []
      : batches
          .filter((batch) => batchSearchText(batch).includes(needle))
          .slice(0, RESULT_LIMIT);

  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };

  const renderEntries = (heading: string, entries: Entry[]) =>
    entries.length > 0 && (
      <CommandGroup heading={heading}>
        {entries.map(({ label, icon: Icon, shortcut, run }) => (
          <CommandItem key={label} onSelect={() => choose(run)}>
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            {label}
            {shortcut && <ShortcutHint id={shortcut} className="ml-auto" />}
          </CommandItem>
        ))}
      </CommandGroup>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Suche und Befehle</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Seiten, Aktionen, Kunden, Beträge suchen..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Keine Treffer.</CommandEmpty>
            {foundRows.length > 0 && (
              <CommandGroup heading="Transaktionen">
                {foundRows.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    onSelect={() =>
                      choose(() => {
                        openPage("transaktionen");
                        requestPageAction({ type: "open", id: row.id });
                      })
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {row.name ? mask(row.name) : "Name fehlt"}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatStamp(row.occurredAt).slice(0, 10)}
                    </span>
                    <span className="w-24 text-right font-mono text-xs">
                      {mask(formatSignedEuro(row.amountCents))}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {foundBatches.length > 0 && (
              <CommandGroup heading="Exporte">
                {foundBatches.map((batch) => (
                  <CommandItem
                    key={batch.id}
                    value={`export-${batch.id}`}
                    onSelect={() =>
                      choose(() => showExports({ batchId: batch.id }))
                    }
                  >
                    <Archive
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate">
                      #{batch.id} {batch.account}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {renderEntries("Ansichten", filterEntries(views))}
            {renderEntries("Seiten", filterEntries(pages))}
            {renderEntries("Aktionen", filterEntries(actions))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
