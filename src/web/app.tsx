import type { SummaryDto } from "@shared/types.ts";
import { useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { Sidebar } from "@/components/sidebar";
import { Tour } from "@/components/tour";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { PreferencesProvider, usePreferences } from "@/lib/preferences";
import { usePresence } from "@/lib/presence";
import { useRoute } from "@/lib/use-route";
import { AuditLogPage } from "@/pages/audit-log";
import { ExportsPage } from "@/pages/exports";
import { SettingsPage } from "@/pages/settings";
import { SetupWizard } from "@/pages/setup-wizard";
import { StatisticsPage } from "@/pages/statistics";
import { TransactionsPage } from "@/pages/transactions";

function Shell() {
  const route = useRoute();
  const { dark, toggleTheme, preferences, update } = usePreferences();
  const [summary, setSummary] = useState<SummaryDto | null>(null);
  usePresence();

  const refreshSummary = useCallback(async () => {
    setSummary(await api.summary());
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  const toaster = (
    <Toaster theme={dark ? "dark" : "light"} position="bottom-right" />
  );

  if (summary?.setupRequired) {
    return (
      <TooltipProvider>
        <div className="flex min-h-screen bg-background text-foreground text-sm md:h-screen">
          <SetupWizard summary={summary} onChanged={refreshSummary} />
          {toaster}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-background text-foreground text-sm max-md:flex-col md:h-screen md:overflow-hidden">
        <Sidebar
          route={route}
          summary={summary}
          dark={dark}
          onToggleTheme={toggleTheme}
        />
        <main
          key={route}
          className="relative flex min-w-0 flex-1 flex-col gap-3 px-6 pt-4 pb-22 md:overflow-y-auto"
        >
          {route === "transaktionen" && (
            <TransactionsPage summary={summary} onChanged={refreshSummary} />
          )}
          {route === "statistiken" && <StatisticsPage />}
          {route === "exporte" && <ExportsPage onChanged={refreshSummary} />}
          {route === "audit-log" && <AuditLogPage />}
          {route === "einstellungen" && (
            <SettingsPage summary={summary} onChanged={refreshSummary} />
          )}
        </main>
        {summary && preferences.tourPending && route === "transaktionen" && (
          <Tour onClose={() => update({ tourPending: false })} />
        )}
        {toaster}
      </div>
    </TooltipProvider>
  );
}

export function App() {
  return (
    <PreferencesProvider>
      <Shell />
    </PreferencesProvider>
  );
}
