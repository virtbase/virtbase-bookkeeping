const BASE_URL = "https://api.lexware.io/v1";
const REQUEST_GAP_MS = 550;

export interface Voucher {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  voucherStatus?: string;
  contactName?: string | null;
  totalAmount: number;
}

export interface InvoiceDetail {
  id: string;
  voucherNumber?: string;
  voucherDate: string;
  address?: { name?: string };
  lineItems?: { name?: string }[];
  totalPrice?: { totalGrossAmount?: number };
}

export interface InvoiceReader {
  listInvoices(from: string, to: string): Promise<Voucher[]>;
  retrieveInvoice(id: string): Promise<InvoiceDetail>;
}

interface VoucherPage {
  content: Voucher[];
  last: boolean;
}

export class LexwareClient implements InvoiceReader {
  private nextRequestAt = 0;

  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string): Promise<T> {
    const wait = this.nextRequestAt - Date.now();
    if (wait > 0) {
      await Bun.sleep(wait);
    }
    this.nextRequestAt = Date.now() + REQUEST_GAP_MS;
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Lexware: Fehler ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async listInvoices(from: string, to: string): Promise<Voucher[]> {
    const vouchers: Voucher[] = [];
    let page = 0;
    let last = false;
    while (!last) {
      const query = new URLSearchParams({
        voucherType: "invoice",
        voucherStatus: "any",
        voucherDateFrom: from,
        voucherDateTo: to,
        size: "250",
        page: String(page),
      });
      const result = await this.get<VoucherPage>(`/voucherlist?${query}`);
      vouchers.push(...result.content);
      last = result.last;
      page += 1;
    }
    return vouchers;
  }

  retrieveInvoice(id: string): Promise<InvoiceDetail> {
    return this.get<InvoiceDetail>(`/invoices/${id}`);
  }
}
