import * as z from "zod";
import { parseEuroInput } from "./money.ts";
import type { PurposeKey } from "./purpose.ts";
import {
  PURPOSE_DEFINITIONS,
  PURPOSE_KEYS,
  unknownPlaceholders,
} from "./purpose.ts";

z.config({ jitless: true });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth(): string {
  return today().slice(0, 7);
}

const berlinMinute = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const baselineDate = z
  .string()
  .regex(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/,
    "Bitte Datum und Uhrzeit wählen.",
  )
  .refine(
    (value) => value <= berlinMinute.format(new Date()).replace(" ", "T"),
    "Der Zeitpunkt liegt in der Zukunft.",
  );

const closedMonth = z
  .string()
  .regex(/^(\d{4}-\d{2})?$/, "Bitte einen gültigen Monat wählen.")
  .refine(
    (value) => value < currentMonth(),
    "Dieser Monat ist noch nicht abgeschlossen.",
  );

function purposeTemplate(key: PurposeKey) {
  const { placeholders } = PURPOSE_DEFINITIONS[key];
  return z
    .string()
    .trim()
    .min(1, "Der Verwendungszweck darf nicht leer sein.")
    .superRefine((value, context) => {
      const unknown = unknownPlaceholders(value, placeholders);
      if (unknown.length > 0) {
        context.addIssue({
          code: "custom",
          message: `Unbekannter Platzhalter: ${unknown
            .map((name) => `{${name}}`)
            .join(", ")}`,
        });
      }
    });
}

const purposeTemplates = z.object(
  Object.fromEntries(
    PURPOSE_KEYS.map((key) => [key, purposeTemplate(key)]),
  ) as Record<PurposeKey, ReturnType<typeof purposeTemplate>>,
);

const companyName = z.string().trim().min(1, "Bitte einen Namen eingeben.");
const accountName = z
  .string()
  .trim()
  .min(1, "Bitte ein Konto angeben.")
  .max(40, "Bitte höchstens 40 Zeichen verwenden.");

const moneroNode = z
  .string()
  .trim()
  .regex(
    /^https?:\/\/[a-zA-Z0-9.-]+:\d{1,5}$/,
    "Zum Beispiel https://node.example.org:18089",
  );

export const settingsSchema = z.object({
  exportDir: z
    .string()
    .trim()
    .min(1, "Bitte einen Ordner angeben.")
    .regex(/^\//, "Bitte einen absoluten Pfad angeben, beginnend mit /."),
  backupDir: z
    .string()
    .trim()
    .regex(/^(\/.*)?$/, "Bitte einen absoluten Pfad angeben, beginnend mit /."),
  dateFormat: z.enum(["iso", "de"]),
  decimalFormat: z.enum(["dot", "comma"]),
  baselineDate,
  feesClosedThrough: closedMonth,
  rateSource: z.enum(["auto", "coingecko", "manual"]),
  stripeName: companyName,
  paypalName: companyName,
  accounts: z.object({
    stripe: accountName,
    fees: accountName,
    monero: accountName,
  }),
  moneroNodes: z.array(moneroNode).min(1, "Mindestens ein Node ist nötig."),
  purposeTemplates,
});

export const moneroWalletSchema = z.object({
  address: z
    .string()
    .trim()
    .regex(
      /^4[1-9A-HJ-NP-Za-km-z]{94}$/,
      "Bitte die primäre Adresse eintragen, sie beginnt mit 4 und hat 95 Zeichen.",
    ),
  viewKey: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, "Der View-Key hat 64 Hexadezimalzeichen."),
  restoreHeight: z
    .string()
    .trim()
    .regex(/^\d+$/, "Bitte eine Blockhöhe eingeben, zum Beispiel 3650000."),
});

export type MoneroWalletForm = z.infer<typeof moneroWalletSchema>;

export const stripeKeySchema = z.object({
  value: z
    .string()
    .trim()
    .regex(
      /^(rk|sk)_(live|test)_[A-Za-z0-9]+$/,
      "Der Schlüssel muss mit rk_live_ oder sk_live_ beginnen.",
    ),
});

export const lexwareKeySchema = z.object({
  value: z
    .string()
    .trim()
    .regex(/^\S{20,}$/, "Das sieht nicht nach einem Lexware-Schlüssel aus."),
});

const requiredName = z.string().trim().min(1, "Bitte einen Namen eingeben.");

const positiveEuro = z.string().refine((value) => {
  const cents = parseEuroInput(value);
  return cents !== null && cents > 0;
}, "Bitte einen Betrag wie 7,99 eingeben.");

export const nameFormSchema = z.object({ name: requiredName });

export const moneroFormSchema = z.object({
  name: requiredName,
  product: z.string().trim().min(1, "Bitte ein Produkt eingeben."),
  booked: positiveEuro,
  rate: positiveEuro,
});

export const preferencesSchema = z
  .object({
    theme: z.enum(["light", "dark"]).nullable(),
    privacy: z.boolean(),
    tourPending: z.boolean(),
    singleKeyShortcuts: z.boolean(),
  })
  .partial();

export const setupSchema = settingsSchema
  .extend({ nothingBooked: z.boolean() })
  .superRefine((value, context) => {
    if (value.nothingBooked) {
      return;
    }
    if (!value.baselineDate) {
      context.addIssue({
        code: "custom",
        path: ["baselineDate"],
        message: "Bitte den letzten gebuchten Zeitpunkt wählen.",
      });
    }
    if (!value.feesClosedThrough) {
      context.addIssue({
        code: "custom",
        path: ["feesClosedThrough"],
        message: "Bitte den letzten gebuchten Monat wählen.",
      });
    }
  });

export type SetupForm = z.infer<typeof setupSchema>;
export type MoneroForm = z.infer<typeof moneroFormSchema>;
export type SecretForm = z.infer<typeof stripeKeySchema>;
