import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import * as z from "zod";
import {
  lexwareKeySchema,
  moneroWalletSchema,
  preferencesSchema,
  settingsSchema,
  setupSchema,
  stripeKeySchema,
} from "../shared/schemas.ts";
import type {
  AuditExportDto,
  FolderChoiceDto,
  InvoiceLookupDto,
  SettingsDto,
  SummaryDto,
  TestResultDto,
} from "../shared/types.ts";
import { assetType, readAsset } from "./assets.ts";
import { audit } from "./audit.ts";
import { assertBackupFolder, BackupService } from "./backup.ts";
import type { Db } from "./db/client.ts";
import { transactions } from "./db/schema.ts";
import { renderAuditCsv } from "./export/csv.ts";
import {
  createExport,
  ExportError,
  FormError,
  markImported,
  regenerateExport,
  voidExport,
} from "./export/service.ts";
import { openFeeMonths } from "./fees.ts";
import { chooseFolder as openFolderDialog } from "./folder-dialog.ts";
import type { InvoiceReader } from "./lexware/client.ts";
import { LexwareClient } from "./lexware/client.ts";
import { findInvoices } from "./lexware/matching.ts";
import { providerFor } from "./monero/rates.ts";
import { importMoneroCsv } from "./monero/service.ts";
import { MoneroSync } from "./monero/sync.ts";
import type { WalletBackend } from "./monero/wallet.ts";
import { MoneroWallet } from "./monero/wallet.ts";
import type { Paths } from "./paths.ts";
import { openCommand } from "./platform.ts";
import type { Presence } from "./presence.ts";
import {
  baselineEnd,
  listAudit,
  listExports,
  listStatRows,
  listTransactions,
  statusOf,
} from "./queries.ts";
import { resetEverything, resetExports } from "./reset.ts";
import { restoreBackup } from "./restore.ts";
import type { SecretStore } from "./secrets.ts";
import type { SessionState } from "./security.ts";
import { guard, securityHeaders } from "./security.ts";
import {
  isSetupComplete,
  markSetupComplete,
  readPreferences,
  readSettings,
  readSyncMarks,
  wasRestored,
  writePreferences,
  writeSettings,
} from "./settings.ts";
import type { BalanceReader } from "./stripe/client.ts";
import { StripeClient } from "./stripe/client.ts";
import { refreshFeeRows, syncStripe } from "./stripe/sync.ts";
import { localDay } from "./time.ts";
import { availableUpdate } from "./updates.ts";

export interface AppDependencies {
  presence?: Presence;
  backups?: BackupService;
  db: Db;
  paths: Paths;
  secrets: SecretStore;
  session: SessionState;
  stripeFactory?: (key: string) => BalanceReader;
  lexwareFactory?: (key: string) => InvoiceReader;
  reveal?: (path: string) => void;
  chooseFolder?: (start: string) => Promise<string | null>;
  moneroBackend?: WalletBackend;
}

const folderSchema = z.object({ current: z.string() });
const statisticsExportSchema = z.object({ rows: z.number().int().min(0) });
const auditExportSchema = z.object({
  ids: z.array(z.number().int()).min(1),
});
const ignoreSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  ignored: z.boolean(),
});
const exportSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });
const editSchema = z.object({
  name: z.string().trim().min(1).optional(),
  product: z.string().trim().min(1).optional(),
  amountCents: z.number().int().positive().optional(),
  rate: z.number().positive().optional(),
  invoiceId: z.string().nullable().optional(),
});

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function keyType(key: string | undefined): SummaryDto["stripeKeyType"] {
  if (!key) {
    return null;
  }
  return key.startsWith("rk_") ? "restricted" : "secret";
}

export function createApp(dependencies: AppDependencies): Hono {
  const { db, paths, secrets, session, presence } = dependencies;
  const settings = () => readSettings(db, paths.defaultExportDir);
  const stripe = (key: string) =>
    dependencies.stripeFactory?.(key) ?? new StripeClient(key);
  const lexware = (key: string) =>
    dependencies.lexwareFactory?.(key) ?? new LexwareClient(key);
  const reveal =
    dependencies.reveal ??
    ((path: string) => {
      Bun.spawn(openCommand(dirname(path)), {
        stdout: "ignore",
        stderr: "ignore",
      });
    });

  const moneroSync = new MoneroSync(
    db,
    dependencies.moneroBackend ?? new MoneroWallet(paths, secrets),
    paths.defaultExportDir,
  );

  const backups =
    dependencies.backups ?? new BackupService(db, paths, settings, now);

  const app = new Hono();
  app.use(securityHeaders(session));
  app.use(guard(session));
  app.use("/api/*", async (context, next) => {
    if (context.req.path === "/api/presence") {
      return next();
    }
    const done = presence?.begin();
    try {
      await next();
    } finally {
      done?.();
    }
  });

  app.onError((error, context) => {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return context.json(
        {
          error: issue?.message ?? "Ungültige Eingabe.",
          field: issue?.path.join("."),
        },
        400,
      );
    }
    if (error instanceof ExportError) {
      const field = error instanceof FormError ? error.field : undefined;
      return context.json({ error: error.message, field }, 400);
    }
    console.error(error.message);
    return context.json({ error: error.message }, 502);
  });

  app.get("/api/summary", (context) => {
    const marks = readSyncMarks(db);
    const stored = secrets.read();
    const rows = listTransactions(db, settings(), now());
    const summary: SummaryDto = {
      balanceCents: marks.balanceCents,
      lastSyncAt: marks.lastSyncAt,
      openCount: rows.filter(
        (row) => row.status === "ready" || row.status === "review",
      ).length,
      stripeConfigured: Boolean(stored.stripeKey),
      stripeKeyType: keyType(stored.stripeKey),
      lexwareConfigured: Boolean(stored.lexwareKey),
      moneroConfigured: moneroSync.status().configured,
      backupFailed: backups.error !== null,
      setupRequired: !isSetupComplete(db),
      update: availableUpdate(db),
      openFeeMonths: openFeeMonths(rows),
    };
    return context.json(summary);
  });

  app.get("/api/transactions", (context) =>
    context.json(listTransactions(db, settings(), now())),
  );

  app.post("/api/sync", async (context) => {
    const key = secrets.read().stripeKey;
    if (!key) {
      throw new ExportError("Kein Stripe-Schlüssel hinterlegt.");
    }
    return context.json(await syncStripe(db, stripe(key), settings(), now()));
  });

  app.post("/api/monero/import", async (context) => {
    const text = await context.req.text();
    const current = settings();
    const result = await importMoneroCsv(
      db,
      text,
      providerFor(current.rateSource),
      now(),
    ).catch((error: Error) => {
      throw new ExportError(error.message);
    });
    return context.json(result);
  });

  app.get("/api/transactions/:id/invoices", async (context) => {
    const key = secrets.read().lexwareKey;
    const lookup: InvoiceLookupDto = key
      ? {
          configured: true,
          matches: await findInvoices(
            db,
            lexware(key),
            context.req.param("id"),
            now(),
          ),
        }
      : { configured: false, matches: [] };
    return context.json(lookup);
  });

  app.patch("/api/transactions/:id", async (context) => {
    const id = context.req.param("id");
    const edit = editSchema.parse(await context.req.json());
    const row = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();
    if (!row) {
      throw new ExportError("Zeile nicht gefunden.");
    }
    const current = listTransactions(db, settings(), now()).find(
      (entry) => entry.id === id,
    );
    if (
      statusOf(row, current?.batchId ?? null, baselineEnd(settings())) ===
      "exported"
    ) {
      throw new ExportError("Exportierte Zeilen sind gesperrt.");
    }

    const name = edit.name ?? row.name;
    if (row.source !== "monero") {
      if (!name) {
        throw new ExportError("Name fehlt.");
      }
      db.update(transactions)
        .set({ name, needsReview: false, reviewReason: null })
        .where(eq(transactions.id, id))
        .run();
      audit(db, "transaction.edit", { id });
      return context.json({ ok: true });
    }

    const product = edit.product ?? row.product;
    const rate = edit.rate ?? row.xmrRate;
    const amountCents = edit.amountCents ?? row.amountCents;
    if (!name || !product || !rate || !row.xmrAtomic || amountCents <= 0) {
      throw new ExportError("Name, Produkt, Kurs und Betrag sind nötig.");
    }
    const manualRate = edit.rate !== undefined && edit.rate !== row.xmrRate;
    db.update(transactions)
      .set({
        name,
        product,
        amountCents,
        xmrRate: rate,
        needsReview: false,
        reviewReason: null,
        invoiceId: edit.invoiceId ?? row.invoiceId,
        ...(manualRate
          ? {
              rateSource: "Manuell",
              rateWindow: null,
              marketValueCents: Math.round(
                (Number(row.xmrAtomic) / 1e12) * rate * 100,
              ),
            }
          : {}),
      })
      .where(eq(transactions.id, id))
      .run();
    audit(db, "transaction.edit", { id });
    return context.json({ ok: true });
  });

  app.post("/api/transactions/ignore", async (context) => {
    const { ids, ignored } = ignoreSchema.parse(await context.req.json());
    const rows = listTransactions(db, settings(), now()).filter((row) =>
      ids.includes(row.id),
    );
    if (rows.some((row) => row.status === "exported")) {
      throw new ExportError(
        "Exportierte Zeilen können nicht ausgeblendet werden.",
      );
    }
    db.update(transactions)
      .set({ ignored })
      .where(inArray(transactions.id, ids))
      .run();
    audit(db, ignored ? "transaction.ignore" : "transaction.restore", { ids });
    return context.json({ ok: true });
  });

  app.get("/api/monero/status", (context) => context.json(moneroSync.status()));

  app.post("/api/monero/sync", (context) => {
    moneroSync.start();
    return context.json(moneroSync.status());
  });

  app.put("/api/monero/wallet", async (context) => {
    const form = moneroWalletSchema.parse(await context.req.json());
    await moneroSync
      .setup({
        address: form.address,
        viewKey: form.viewKey,
        restoreHeight: Number(form.restoreHeight),
      })
      .catch((error: Error) => {
        throw new ExportError(error.message);
      });
    return context.json(moneroSync.status());
  });

  app.delete("/api/monero/wallet", (context) => {
    moneroSync.remove();
    return context.json(moneroSync.status());
  });

  app.get(
    "/api/presence",
    upgradeWebSocket(() => {
      let leave: (() => void) | undefined;
      return {
        onOpen: () => {
          leave = presence?.connect();
        },
        onClose: () => leave?.(),
      };
    }),
  );

  app.get("/api/statistics", (context) => {
    const current = settings();
    return context.json({
      rows: listStatRows(db, current),
      today: localDay(now()),
    });
  });

  app.post("/api/statistics/export", async (context) => {
    const { rows } = statisticsExportSchema.parse(await context.req.json());
    audit(db, "statistics.export", { rows });
    return context.json({ ok: true });
  });

  app.get("/api/audit", (context) => context.json(listAudit(db)));

  app.post("/api/audit/export", async (context) => {
    const { ids } = auditExportSchema.parse(await context.req.json());
    const wanted = new Set(ids);
    const events = listAudit(db).filter((event) => wanted.has(event.id));
    const result: AuditExportDto = {
      fileName: `audit-log_${localDay(now())}.csv`,
      content: renderAuditCsv(events),
    };
    audit(db, "audit.export", { rows: events.length });
    return context.json(result);
  });

  app.post("/api/reset/exports", (context) => {
    resetExports(db, paths, moneroSync);
    return context.json({ ok: true });
  });

  app.post("/api/reset/all", (context) => {
    resetEverything(db, paths, secrets, moneroSync);
    return context.json({ ok: true });
  });

  app.get("/api/exports", (context) =>
    context.json(listExports(db, settings())),
  );

  app.post("/api/exports", async (context) => {
    const { ids } = exportSchema.parse(await context.req.json());
    return context.json(createExport(db, ids, settings(), now()));
  });

  app.post("/api/exports/:id/regenerate", (context) =>
    context.json(
      regenerateExport(db, Number(context.req.param("id")), settings()),
    ),
  );

  app.post("/api/exports/:id/void", (context) => {
    voidExport(db, Number(context.req.param("id")));
    return context.json({ ok: true });
  });

  app.post("/api/exports/:id/imported", (context) => {
    markImported(db, Number(context.req.param("id")));
    return context.json({ ok: true });
  });

  app.post("/api/exports/:id/reveal", (context) => {
    const batch = listExports(db, settings()).batches.find(
      (entry) => entry.id === Number(context.req.param("id")),
    );
    if (!batch) {
      throw new ExportError("Export nicht gefunden.");
    }
    reveal(batch.filePath);
    return context.json({ ok: true });
  });

  app.get("/api/settings", (context) => context.json(settings()));

  app.get("/api/backups", (context) => context.json(backups.status()));

  app.post("/api/backups", (context) => context.json(backups.create()));

  app.post("/api/system/folder", async (context) => {
    const { current } = folderSchema.parse(await context.req.json());
    const choose = dependencies.chooseFolder ?? openFolderDialog;
    const result: FolderChoiceDto = { path: await choose(current) };
    return context.json(result);
  });

  const applySettings = (input: SettingsDto): SettingsDto => {
    const next =
      input.backupDir === backups.status().defaultDirectory
        ? { ...input, backupDir: "" }
        : input;
    try {
      mkdirSync(next.exportDir, { recursive: true });
    } catch {
      throw new FormError(
        "exportDir",
        "Dieser Ordner kann nicht angelegt werden.",
      );
    }
    try {
      if (next.backupDir) {
        assertBackupFolder(next.backupDir);
      }
    } catch {
      throw new FormError(
        "backupDir",
        "Dieser Ordner ist nicht erreichbar oder nicht beschreibbar.",
      );
    }
    const backupDirChanged = next.backupDir !== settings().backupDir;
    writeSettings(db, next);
    refreshFeeRows(db, next, now());
    audit(db, "settings", {});
    if (backupDirChanged) {
      backups.runIfDue();
    }
    return next;
  };

  app.put("/api/settings", async (context) => {
    const next = settingsSchema.parse(await context.req.json());
    return context.json(applySettings(next));
  });

  app.post("/api/setup/complete", async (context) => {
    const { nothingBooked, ...next } = setupSchema.parse(
      await context.req.json(),
    );
    if (!secrets.read().stripeKey) {
      throw new ExportError("Bitte zuerst den Stripe-Schlüssel speichern.");
    }
    applySettings(
      nothingBooked
        ? { ...next, baselineDate: "", feesClosedThrough: "" }
        : next,
    );
    const tourPending = !wasRestored(db);
    markSetupComplete(db, now());
    writePreferences(db, { ...readPreferences(db), tourPending });
    audit(db, "setup.complete", {});
    return context.json({ tourPending });
  });

  app.post("/api/setup/restore", async (context) => {
    const file = new Uint8Array(await context.req.arrayBuffer());
    return context.json(restoreBackup(db, paths, file, now()));
  });

  app.get("/api/preferences", (context) => context.json(readPreferences(db)));

  app.put("/api/preferences", async (context) => {
    const next = {
      ...readPreferences(db),
      ...preferencesSchema.parse(await context.req.json()),
    };
    writePreferences(db, next);
    return context.json(next);
  });

  app.put("/api/secrets/stripe", async (context) => {
    const { value } = stripeKeySchema.parse(await context.req.json());
    await stripe(value)
      .retrieveBalanceCents()
      .catch((error: Error) => {
        throw new FormError("value", error.message);
      });
    secrets.update({ stripeKey: value });
    return context.json({ ok: true });
  });

  app.put("/api/secrets/lexware", async (context) => {
    const { value } = lexwareKeySchema.parse(await context.req.json());
    const today = new Date().toISOString().slice(0, 10);
    await lexware(value)
      .listInvoices(today, today)
      .catch((error: Error) => {
        throw new FormError("value", error.message);
      });
    secrets.update({ lexwareKey: value });
    return context.json({ ok: true });
  });

  app.post("/api/secrets/stripe/test", async (context) => {
    const key = secrets.read().stripeKey;
    if (!key) {
      throw new ExportError("Kein Stripe-Schlüssel hinterlegt.");
    }
    await stripe(key).retrieveBalanceCents();
    const result: TestResultDto = {
      ok: true,
      message:
        keyType(key) === "restricted"
          ? "Verbunden"
          : "Verbunden, aber mit Vollzugriff",
    };
    return context.json(result);
  });

  app.post("/api/secrets/lexware/test", async (context) => {
    const key = secrets.read().lexwareKey;
    if (!key) {
      throw new ExportError("Kein Lexware-Schlüssel hinterlegt.");
    }
    const today = new Date().toISOString().slice(0, 10);
    await lexware(key).listInvoices(today, today);
    const result: TestResultDto = { ok: true, message: "Verbunden" };
    return context.json(result);
  });

  app.get("*", async (context) => {
    const pathname = new URL(context.req.url).pathname;
    const asset = await readAsset(pathname);
    if (!asset) {
      return context.text("Nicht gefunden.", 404);
    }
    return new Response(asset, {
      headers: { "Content-Type": assetType(pathname) },
    });
  });

  return app;
}
