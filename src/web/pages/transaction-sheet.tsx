import { zodResolver } from "@hookform/resolvers/zod";
import {
  atomicToXmr,
  formatEuro,
  formatSignedEuro,
  parseEuroInput,
  plainAmount,
} from "@shared/money.ts";
import {
  type MoneroForm,
  moneroFormSchema,
  nameFormSchema,
} from "@shared/schemas.ts";
import type { InvoiceLookupDto, TransactionDto } from "@shared/types.ts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { showFormError } from "@/lib/form-error";
import { formatDay, formatIsoDay, formatStamp } from "@/lib/format";
import { usePrivacy } from "@/lib/preferences";
import { cn } from "@/lib/utils";

interface TransactionSheetProps {
  row: TransactionDto | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onToggleIgnored: (row: TransactionDto) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  reviewLeft: number;
}

const KEPT_END = 8;

function germanNumber(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

interface Fact {
  label: string;
  value: string;
  copy?: string;
  id?: boolean;
}

function submitOnCtrlEnter(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.requestSubmit();
  }
}

function amountFact(label: string, text: string, cents: number): Fact {
  return {
    label,
    value: text,
    copy: plainAmount(cents),
  };
}

function feeFact(label: string, cents: number): Fact {
  const text = cents === 0 ? formatEuro(0) : `−${formatEuro(cents)}`;
  return amountFact(label, text, -cents);
}

function facts(row: TransactionDto): Fact[] {
  if (row.source === "monero") {
    const received = row.xmrAtomic ? atomicToXmr(row.xmrAtomic) : null;
    const transaction = row.id.split(":")[1] ?? row.id;
    return [
      {
        label: "Erhalten",
        value: received ? `${received} XMR` : "—",
        copy: received ?? undefined,
      },
      {
        label: "Kurs",
        value: row.xmrRate
          ? `${formatEuro(Math.round(row.xmrRate * 100))} (${row.rateSource})`
          : "—",
      },
      row.marketValueCents === null
        ? { label: "Marktwert", value: "—" }
        : amountFact(
            "Marktwert",
            formatEuro(row.marketValueCents),
            row.marketValueCents,
          ),
      ...(row.walletLabel
        ? [{ label: "Wallet-Label", value: row.walletLabel }]
        : []),
      { label: "Transaktion", value: transaction, copy: transaction, id: true },
    ];
  }
  if (row.source === "fees") {
    return [
      amountFact("Betrag", formatSignedEuro(row.amountCents), row.amountCents),
      { label: "Berechnet aus", value: row.method ?? "—" },
      { label: "Stripe-Feld", value: row.kind },
    ];
  }
  const net = row.amountCents - row.stripeFeeCents - row.passthroughFeeCents;
  const valueDay = formatDay(row.valueAt);
  return [
    { label: "Zahlungsart", value: row.method ?? "—" },
    amountFact("Brutto", formatSignedEuro(row.amountCents), row.amountCents),
    feeFact("Stripe-Gebühr", row.stripeFeeCents),
    feeFact("PayPal-Gebühr", row.passthroughFeeCents),
    amountFact("Netto", formatSignedEuro(net), net),
    { label: "Wertstellung", value: valueDay, copy: valueDay },
    { label: "Stripe-ID", value: row.id, copy: row.id, id: true },
  ];
}

function MiddleTruncated({ value }: { value: string }) {
  return (
    <span title={value} className="flex min-w-0">
      <span className="min-w-0 truncate">{value.slice(0, -KEPT_END)}</span>
      <span className="shrink-0">{value.slice(-KEPT_END)}</span>
    </span>
  );
}

function Facts({ row }: { row: TransactionDto }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t pt-3">
      {facts(row).map(({ label, value, copy, id }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="flex items-start justify-end gap-1 text-right tabular-nums">
            {id ? (
              <MiddleTruncated value={value} />
            ) : (
              <span className="wrap-anywhere min-w-0">{value}</span>
            )}
            <CopyButton
              value={copy ?? value}
              label={`${label} kopieren`}
              sensitive={false}
              className="-my-0.5"
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function NameForm({
  row,
  onSaved,
}: {
  row: TransactionDto;
  onSaved: () => Promise<void>;
}) {
  const form = useForm({
    resolver: zodResolver(nameFormSchema),
    defaultValues: { name: row.name ?? "" },
    mode: "onTouched",
  });

  const save = form.handleSubmit(async ({ name }) => {
    try {
      await api.editTransaction(row.id, { name });
      await onSaved();
    } catch (error) {
      showFormError(error, form.setError, ["name"]);
    }
  });

  return (
    <form
      onSubmit={save}
      onKeyDown={submitOnCtrlEnter}
      noValidate
      className="flex flex-1 flex-col gap-4"
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="sheet-name">Name</FieldLabel>
            <Input
              {...field}
              id="sheet-name"
              placeholder="Kundenname"
              aria-invalid={fieldState.invalid}
            />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      <Facts row={row} />
      <Button
        type="submit"
        className="mt-auto"
        disabled={form.formState.isSubmitting}
      >
        Übernehmen
      </Button>
    </form>
  );
}

function MoneroEditForm({
  row,
  onSaved,
}: {
  row: TransactionDto;
  onSaved: () => Promise<void>;
}) {
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [lookup, setLookup] = useState<InvoiceLookupDto | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const form = useForm<MoneroForm>({
    resolver: zodResolver(moneroFormSchema),
    defaultValues: {
      name: row.name ?? "",
      product: row.product ?? "",
      booked: row.amountCents ? germanNumber(row.amountCents / 100) : "",
      rate: row.xmrRate ? germanNumber(row.xmrRate) : "",
    },
    mode: "onTouched",
  });

  useEffect(() => {
    let active = true;
    api
      .invoices(row.id)
      .then((result) => {
        if (active) {
          setLookup(result);
        }
      })
      .catch((error: Error) => {
        if (active) {
          setLookupError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [row.id]);

  const save = form.handleSubmit(async (value) => {
    const rateCents = parseEuroInput(value.rate) ?? 0;
    const sameRate =
      row.xmrRate !== null && rateCents === Math.round(row.xmrRate * 100);
    try {
      await api.editTransaction(row.id, {
        name: value.name,
        product: value.product,
        amountCents: parseEuroInput(value.booked) ?? 0,
        invoiceId,
        ...(sameRate ? {} : { rate: rateCents / 100 }),
      });
      await onSaved();
    } catch (error) {
      showFormError(error, form.setError, ["name", "product"]);
    }
  });

  const pick = (match: InvoiceLookupDto["matches"][number]) => {
    setInvoiceId(match.id);
    const options = { shouldValidate: true };
    form.setValue("name", match.customer, options);
    form.setValue(
      "product",
      match.product ?? form.getValues("product"),
      options,
    );
    form.setValue("booked", germanNumber(match.amountCents / 100), options);
  };

  return (
    <form
      onSubmit={save}
      onKeyDown={submitOnCtrlEnter}
      noValidate
      className="flex flex-1 flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <div className="font-medium">Passende Rechnungen in Lexware</div>
        {lookupError && <FieldError>{lookupError}</FieldError>}
        {!lookup && !lookupError && (
          <p className="text-muted-foreground">Suche läuft...</p>
        )}
        {lookup && !lookup.configured && (
          <a className="underline" href="#/einstellungen">
            Lexware-Schlüssel hinterlegen
          </a>
        )}
        {lookup?.configured && lookup.matches.length === 0 && (
          <p className="text-muted-foreground">
            Keine passende Rechnung gefunden.
          </p>
        )}
        {lookup?.matches.map((match) => (
          <button
            key={match.id}
            type="button"
            aria-pressed={invoiceId === match.id}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left hover:bg-muted",
              invoiceId === match.id && "border-foreground",
            )}
            onClick={() => pick(match)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {match.customer || "Ohne Namen"}
              </span>
              <span className="block text-[13px] text-muted-foreground">
                {match.number}, {formatIsoDay(match.date)}
              </span>
            </span>
            <span className="font-mono text-[13px]">
              {formatEuro(match.amountCents)}
            </span>
          </button>
        ))}
      </div>

      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="sheet-name">Name</FieldLabel>
              <Input
                {...field}
                id="sheet-name"
                placeholder="Kundenname"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="product"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="sheet-product">Produkt</FieldLabel>
              <Input
                {...field}
                id="sheet-product"
                placeholder="EPYC-02"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <div className="grid grid-cols-2 items-start gap-3">
          <Controller
            control={form.control}
            name="booked"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="sheet-booked">Gebucht, EUR</FieldLabel>
                <Input
                  {...field}
                  id="sheet-booked"
                  inputMode="decimal"
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="rate"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="sheet-rate">Kurs, EUR</FieldLabel>
                <Input
                  {...field}
                  id="sheet-rate"
                  inputMode="decimal"
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>
      </FieldGroup>

      <Facts row={row} />
      <Button
        type="submit"
        className="mt-auto"
        disabled={form.formState.isSubmitting}
      >
        Übernehmen
      </Button>
    </form>
  );
}

export function TransactionSheet({
  row,
  onClose,
  onSaved,
  onToggleIgnored,
  onPrevious,
  onNext,
  reviewLeft,
}: TransactionSheetProps) {
  const editable = row?.status === "review";
  const isMonero = row?.source === "monero";
  const privacy = usePrivacy();
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const hidden = privacy.enabled && row !== null && revealedId !== row.id;

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        className="gap-4 overflow-y-auto p-5 sm:max-w-md"
        onKeyDown={(event) => {
          if (event.altKey && event.key === "ArrowUp") {
            event.preventDefault();
            onPrevious?.();
          }
          if (event.altKey && event.key === "ArrowDown") {
            event.preventDefault();
            onNext?.();
          }
        }}
      >
        <div className="flex items-center gap-1 pr-7">
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Vorherige Zeile"
            disabled={!onPrevious}
            onClick={onPrevious}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Nächste Zeile"
            disabled={!onNext}
            onClick={onNext}
          >
            <ChevronDown />
          </Button>
          {reviewLeft > 0 && (
            <span className="ml-2 text-muted-foreground text-xs">
              Noch {reviewLeft} zu prüfen
            </span>
          )}
        </div>
        {row && hidden && (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Details verborgen</SheetTitle>
              <SheetDescription>
                Der Privatmodus ist aktiv. Name und Beträge dieser Zeile sind
                ausgeblendet.
              </SheetDescription>
            </SheetHeader>
            <Button variant="outline" onClick={() => setRevealedId(row.id)}>
              Diese Zeile anzeigen
            </Button>
          </>
        )}
        {row && !hidden && (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>
                {row.name ??
                  (isMonero ? "Monero-Zahlung" : "Zahlung ohne Namen")}
              </SheetTitle>
              <SheetDescription>
                {formatStamp(row.occurredAt)}
                {row.reviewReason && editable ? `, ${row.reviewReason}` : ""}
              </SheetDescription>
            </SheetHeader>
            {editable && isMonero && (
              <MoneroEditForm key={row.id} row={row} onSaved={onSaved} />
            )}
            {editable && !isMonero && (
              <NameForm key={row.id} row={row} onSaved={onSaved} />
            )}
            {!editable && <Facts row={row} />}
            {row.status !== "exported" && (
              <Button
                variant="outline"
                className={editable ? undefined : "mt-auto"}
                onClick={() => onToggleIgnored(row)}
              >
                {row.status === "ignored" ? "Einblenden" : "Ausblenden"}
              </Button>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
