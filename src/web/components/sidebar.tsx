import { formatEuro } from "@shared/money.ts";
import type { SummaryDto } from "@shared/types.ts";
import {
  Archive,
  ChartNoAxesColumn,
  CircleArrowUp,
  Cog,
  Eye,
  EyeOff,
  List,
  Moon,
  ScrollText,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { VirtbaseIcon } from "@/components/icons";
import { Private } from "@/components/private";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePrivacy } from "@/lib/preferences";
import type { Route } from "@/lib/use-route";
import { cn } from "@/lib/utils";
import { version } from "../../../package.json";

const ITEMS: { route: Route; label: string; icon: typeof List }[] = [
  { route: "transaktionen", label: "Transaktionen", icon: List },
  { route: "statistiken", label: "Statistiken", icon: ChartNoAxesColumn },
  { route: "exporte", label: "Exporte", icon: Archive },
  { route: "audit-log", label: "Audit-Log", icon: ScrollText },
  { route: "einstellungen", label: "Einstellungen", icon: Cog },
];

interface SidebarProps {
  route: Route;
  summary: SummaryDto | null;
  dark: boolean;
  onToggleTheme: () => void;
}

export function Sidebar({ route, summary, dark, onToggleTheme }: SidebarProps) {
  const privacy = usePrivacy();
  return (
    <nav
      aria-label="Hauptnavigation"
      className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-sidebar px-3 py-4 max-md:w-full max-md:border-r-0 max-md:border-b"
    >
      <div className="flex items-center gap-2.5 px-2 py-1">
        <VirtbaseIcon className="size-8 shrink-0" />
        <div>
          <div className="font-semibold text-sm">Virtbase</div>
          <div className="text-[13px] text-muted-foreground leading-4">
            Bookkeeping
          </div>
        </div>
      </div>
      <div className="border-b px-2 pb-3">
        <div className="text-muted-foreground text-xs leading-4">
          Stripe-Guthaben
        </div>
        <div className="font-medium text-xl tabular-nums leading-7">
          {summary?.balanceCents == null ? (
            "—"
          ) : (
            <Private>{formatEuro(summary.balanceCents)}</Private>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {ITEMS.map(({ route: target, label, icon: Icon }) => (
          <a
            key={target}
            href={`#/${target}`}
            data-tour={`nav-${target}`}
            aria-current={route === target ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted data-tour-active:bg-muted data-tour-active:font-medium data-tour-active:text-foreground",
              route === target
                ? "bg-muted font-medium"
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="flex-1">{label}</span>
            {target === "transaktionen" && summary ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                {summary.openCount}
              </span>
            ) : null}
          </a>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-2">
        {summary?.update && (
          <a
            href={summary.update.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md bg-status-blue px-2 py-1.5 text-status-blue-foreground text-xs"
          >
            <CircleArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
            Version {summary.update.version} verfügbar
          </a>
        )}
        {summary?.backupFailed && (
          <a
            href="#/einstellungen"
            className="flex items-center gap-2 rounded-md bg-status-amber px-2 py-1.5 text-status-amber-foreground text-xs"
          >
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            Sicherung fehlgeschlagen
          </a>
        )}
        <div className="flex items-center justify-between pr-1 pl-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            v{version}
          </span>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-tour="privacy"
                  className="data-tour-active:bg-muted"
                  aria-label="Privatmodus"
                  aria-pressed={privacy.enabled}
                  onClick={privacy.toggle}
                >
                  {privacy.enabled ? <EyeOff /> : <Eye />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Privatmodus {privacy.enabled ? "aus" : "ein"} (Alt+P)
              </TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Farbschema wechseln"
              onClick={onToggleTheme}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
