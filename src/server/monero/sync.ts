import type { MoneroStatusDto } from "../../shared/types.ts";
import { audit } from "../audit.ts";
import type { Db } from "../db/client.ts";
import {
  readMoneroMarks,
  readSettings,
  writeMoneroMarks,
} from "../settings.ts";
import { providerFor, type RateProvider } from "./rates.ts";
import { importMoneroRows } from "./service.ts";
import type { WalletBackend, WalletKeys } from "./wallet.ts";

export class MoneroSync {
  private running = false;
  private lastError: string | null = null;
  private lastAdded = 0;

  constructor(
    private readonly db: Db,
    private readonly backend: WalletBackend,
    private readonly defaultExportDir: string,
    private readonly rates: (
      source: "auto" | "coingecko" | "manual",
    ) => RateProvider = providerFor,
  ) {}

  status(): MoneroStatusDto {
    const { address, restoreHeight, lastSyncAt } = readMoneroMarks(this.db);
    return {
      configured: address !== null,
      address,
      restoreHeight,
      running: this.running,
      lastSyncAt,
      lastError: this.lastError,
      lastAdded: this.lastAdded,
    };
  }

  clearResult(): void {
    this.lastError = null;
    this.lastAdded = 0;
  }

  async setup(keys: WalletKeys): Promise<void> {
    const settings = readSettings(this.db, this.defaultExportDir);
    await this.backend.create(keys, settings.moneroNodes);
    writeMoneroMarks(this.db, {
      address: keys.address,
      restoreHeight: keys.restoreHeight,
      lastSyncAt: null,
    });
    audit(this.db, "monero.wallet", { restoreHeight: keys.restoreHeight });
  }

  remove(): void {
    this.backend.remove();
    writeMoneroMarks(this.db, {
      address: null,
      restoreHeight: null,
      lastSyncAt: null,
    });
    audit(this.db, "monero.wallet.remove", {});
  }

  start(): boolean {
    const marks = readMoneroMarks(this.db);
    if (this.running || marks.address === null) {
      return false;
    }
    this.running = true;
    this.lastError = null;
    this.lastAdded = 0;
    void this.run().finally(() => {
      this.running = false;
    });
    return true;
  }

  private async run(): Promise<void> {
    const settings = readSettings(this.db, this.defaultExportDir);
    try {
      const rows = await this.backend.fetchIncoming(settings.moneroNodes);
      const now = Math.floor(Date.now() / 1000);
      const result = await importMoneroRows(
        this.db,
        rows,
        this.rates(settings.rateSource),
        now,
      );
      this.lastAdded = result.added;
      writeMoneroMarks(this.db, {
        ...readMoneroMarks(this.db),
        lastSyncAt: now,
      });
    } catch (error) {
      this.lastError = (error as Error).message;
    }
  }
}
