import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as z from "zod";

const secretsSchema = z.object({
  stripeKey: z.string().optional(),
  lexwareKey: z.string().optional(),
  moneroWalletPassword: z.string().optional(),
});

export type Secrets = z.infer<typeof secretsSchema>;

export class SecretStore {
  constructor(private readonly path: string) {}

  read(): Secrets {
    if (!existsSync(this.path)) {
      return {};
    }
    return secretsSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }

  update(change: Secrets): void {
    const next = { ...this.read(), ...change };
    writeFileSync(this.path, JSON.stringify(next), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
