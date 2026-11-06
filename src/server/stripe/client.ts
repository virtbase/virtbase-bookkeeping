import type { BalanceTransaction } from "./mapping.ts";

const BASE_URL = "https://api.stripe.com/v1";
const API_VERSION = "2024-11-20.acacia";

export interface BalanceReader {
  listBalanceTransactions(createdFrom: number): Promise<BalanceTransaction[]>;
  retrieveBalanceCents(): Promise<number>;
}

interface ListResponse {
  data: BalanceTransaction[];
  has_more: boolean;
}

interface BalanceResponse {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export class StripeClient implements BalanceReader {
  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string, query: [string, string][]): Promise<T> {
    const url = new URL(`${BASE_URL}/${path}`);
    for (const [key, value] of query) {
      url.searchParams.append(key, value);
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Stripe-Version": API_VERSION,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(
        `Stripe: ${body?.error?.message ?? `Fehler ${response.status}`}`,
      );
    }
    return (await response.json()) as T;
  }

  async listBalanceTransactions(
    createdFrom: number,
  ): Promise<BalanceTransaction[]> {
    const rows: BalanceTransaction[] = [];
    let cursor: string | undefined;
    do {
      const query: [string, string][] = [
        ["limit", "100"],
        ["created[gte]", String(createdFrom)],
        ["expand[]", "data.source"],
        ["expand[]", "data.source.customer"],
        ["expand[]", "data.source.charge"],
      ];
      if (cursor) {
        query.push(["starting_after", cursor]);
      }
      const page = await this.get<ListResponse>("balance_transactions", query);
      rows.push(...page.data);
      cursor = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (cursor);
    return rows;
  }

  async retrieveBalanceCents(): Promise<number> {
    const balance = await this.get<BalanceResponse>("balance", []);
    return [...balance.available, ...balance.pending]
      .filter((entry) => entry.currency === "eur")
      .reduce((sum, entry) => sum + entry.amount, 0);
  }
}
