import { zodResolver } from "@hookform/resolvers/zod";
import { type SetupForm, setupSchema } from "@shared/schemas.ts";
import type {
  RestoreResultDto,
  SettingsDto,
  SummaryDto,
} from "@shared/types.ts";
import { DatabaseBackup, FolderOpen, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Controller,
  type FieldPath,
  type UseFormReturn,
  useForm,
  useWatch,
} from "react-hook-form";
import { toast } from "sonner";
import { DateTimePicker } from "@/components/date-time-picker";
import { VirtbaseIcon } from "@/components/icons";
import { MonthPicker } from "@/components/month-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ApiError, api } from "@/lib/api";
import { showFormError } from "@/lib/form-error";
import { countLabel } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { MoneroWalletSection } from "@/pages/monero-settings";
import { SecretField } from "@/pages/settings";

const STEPS = [1, 2, 3, 4];
const STEP_COUNT = STEPS.length;
const CHOICE_CLASS =
  "flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60";
const FORM_FIELDS: FieldPath<SetupForm>[] = [
  "baselineDate",
  "feesClosedThrough",
  "exportDir",
  "backupDir",
  "accounts.stripe",
  "accounts.fees",
  "accounts.monero",
];
const STEP_FIELDS: Record<number, FieldPath<SetupForm>[]> = {
  2: ["baselineDate", "feesClosedThrough"],
  3: ["exportDir", "accounts.stripe", "accounts.fees", "accounts.monero"],
  4: ["backupDir"],
};
const ACCOUNTS = [
  { key: "stripe", label: "Stripe" },
  { key: "fees", label: "Gebühren" },
  { key: "monero", label: "Monero" },
] as const;

type Form = UseFormReturn<SetupForm>;

function StepHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-semibold text-xl">{title}</h1>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

function FolderInput({
  form,
  name,
  id,
  label,
}: {
  form: Form;
  name: "exportDir" | "backupDir";
  id: string;
  label: string;
}) {
  const [picking, setPicking] = useState(false);

  const pick = async () => {
    setPicking(true);
    try {
      const { path } = await api.chooseFolder(form.getValues(name));
      if (path) {
        form.setValue(name, path, { shouldValidate: true });
      }
    } catch (error) {
      form.setError(name, { message: (error as Error).message });
    } finally {
      setPicking(false);
    }
  };

  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              {...field}
              id={id}
              aria-invalid={fieldState.invalid}
              className="font-mono text-[13px]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={`${label} auswählen`}
                disabled={picking}
                onClick={() => void pick()}
              >
                <FolderOpen />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function StartStep({ form }: { form: Form }) {
  const nothingBooked = useWatch({
    control: form.control,
    name: "nothingBooked",
  });
  return (
    <>
      <StepHeading title="Was ist schon in Lexware?">
        Stripe liefert die letzten 24 Monate. Alles bis zu diesem Punkt gilt als
        erledigt, so wird nichts doppelt gebucht.
      </StepHeading>
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="nothingBooked"
          render={({ field }) => (
            <label
              htmlFor="nothing-booked"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="nothing-booked"
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked === true);
                  form.clearErrors(["baselineDate", "feesClosedThrough"]);
                }}
              />
              Es ist noch nichts in Lexware gebucht
            </label>
          )}
        />
        {!nothingBooked && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="baselineDate"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="setup-baseline">
                    Bereits in Lexware bis
                  </FieldLabel>
                  <DateTimePicker
                    id="setup-baseline"
                    value={field.value}
                    invalid={fieldState.invalid}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="feesClosedThrough"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="setup-fees">
                    Gebühren gebucht bis
                  </FieldLabel>
                  <MonthPicker
                    id="setup-fees"
                    value={field.value}
                    invalid={fieldState.invalid}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>
        )}
      </FieldGroup>
    </>
  );
}

function ExportStep({ form }: { form: Form }) {
  return (
    <>
      <StepHeading title="Wohin gehen die Exporte?">
        Jedes Konto bekommt eine eigene CSV-Datei. Gleiche Namen landen in einer
        Datei. Prüfe, ob die Namen zu deinen Konten in Lexware passen.
      </StepHeading>
      <FieldGroup className="gap-4">
        <FolderInput
          form={form}
          name="exportDir"
          id="setup-export-dir"
          label="Exportordner"
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {ACCOUNTS.map(({ key, label }) => (
            <Controller
              key={key}
              control={form.control}
              name={`accounts.${key}`}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`setup-account-${key}`}>
                    {label}
                  </FieldLabel>
                  <Input
                    {...field}
                    id={`setup-account-${key}`}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ))}
        </div>
      </FieldGroup>
    </>
  );
}

function OptionalStep({
  form,
  summary,
  onChanged,
}: {
  form: Form;
  summary: SummaryDto;
  onChanged: () => Promise<void>;
}) {
  return (
    <>
      <StepHeading title="Optional">
        Das kannst du auch später in den Einstellungen nachholen.
      </StepHeading>
      <SecretField
        name="lexware"
        label="Lexware-API-Schlüssel"
        placeholder="Aus app.lexware.de/addons/public-api"
        configured={summary.lexwareConfigured}
        helpTitle="Hilfe zum Lexware-Schlüssel"
        hint="Nur zum Lesen von Rechnungen, um Monero-Zahlungen zuzuordnen."
        keysUrl="https://app.lexware.de/addons/public-api"
        keysLabel="Schlüssel bei Lexware erstellen"
        onSaved={onChanged}
      />
      <MoneroWalletSection onChanged={onChanged} />
      <FolderInput
        form={form}
        name="backupDir"
        id="setup-backup-dir"
        label="Sicherungsordner"
      />
    </>
  );
}

function StartChoice({
  onNew,
  onRestore,
}: {
  onNew: () => void;
  onRestore: (file: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRestore(file);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
    if (input.current) {
      input.current.value = "";
    }
  };

  return (
    <>
      <StepHeading title="Willkommen">
        Richte die App neu ein oder mache mit einer vorhandenen Sicherung
        weiter.
      </StepHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          className={CHOICE_CLASS}
          onClick={onNew}
        >
          <Sparkles
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="font-medium text-sm">Neu einrichten</span>
          <span className="text-muted-foreground text-xs">
            Ich nutze die App zum ersten Mal.
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          className={CHOICE_CLASS}
          onClick={() => input.current?.click()}
        >
          <DatabaseBackup
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="font-medium text-sm">
            {busy
              ? "Sicherung wird geladen..."
              : "Aus Sicherung wiederherstellen"}
          </span>
          <span className="text-muted-foreground text-xs">
            Ich habe eine .sqlite-Datei aus dem Sicherungsordner.
          </span>
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".sqlite,.bak"
        aria-label="Sicherungsdatei auswählen"
        className="hidden"
        onChange={(event) => void restore(event.target.files?.[0])}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </>
  );
}

interface SetupWizardProps {
  summary: SummaryDto;
  onChanged: () => Promise<void>;
}

interface WizardState {
  settings: SettingsDto;
  backupDir: string;
  restored: RestoreResultDto | null;
  run: number;
}

export function SetupWizard({ summary, onChanged }: SetupWizardProps) {
  const { reload } = usePreferences();
  const [state, setState] = useState<WizardState | null>(null);

  useEffect(() => {
    void Promise.all([api.settings(), api.backups()]).then(
      ([settings, { directory }]) =>
        setState({ settings, backupDir: directory, restored: null, run: 0 }),
    );
  }, []);

  const restore = async (file: File) => {
    const restored = await api.restoreBackup(file);
    const [settings, { directory }] = await Promise.all([
      api.settings(),
      api.backups(),
    ]);
    await Promise.all([reload(), onChanged()]);
    setState((current) => ({
      settings,
      backupDir: directory,
      restored,
      run: (current?.run ?? 0) + 1,
    }));
  };

  return state ? (
    <Wizard
      key={state.run}
      settings={state.settings}
      backupDir={state.backupDir}
      restored={state.restored}
      summary={summary}
      onChanged={onChanged}
      onRestore={restore}
    />
  ) : null;
}

function stepOf(field: string | undefined): number | undefined {
  const match = Object.entries(STEP_FIELDS).find(([, fields]) =>
    fields.some((name) => name === field),
  );
  return match ? Number(match[0]) : undefined;
}

function Wizard({
  settings,
  backupDir,
  restored,
  summary,
  onChanged,
  onRestore,
}: SetupWizardProps & {
  settings: SettingsDto;
  backupDir: string;
  restored: RestoreResultDto | null;
  onRestore: (file: File) => Promise<void>;
}) {
  const { update } = usePreferences();
  const [step, setStep] = useState(restored ? 1 : 0);
  const form = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      ...settings,
      backupDir,
      nothingBooked:
        restored !== null &&
        !settings.baselineDate &&
        !settings.feesClosedThrough,
    },
  });

  const next = async () => {
    const fields = STEP_FIELDS[step];
    if (!fields || (await form.trigger(fields))) {
      setStep(step + 1);
    }
  };

  const finish = form.handleSubmit(async (values) => {
    let tourPending = false;
    try {
      ({ tourPending } = await api.completeSetup(values));
    } catch (error) {
      setStep(
        stepOf(error instanceof ApiError ? error.field : undefined) ?? step,
      );
      showFormError(error, form.setError, FORM_FIELDS);
      return;
    }
    try {
      await api.sync();
    } catch (error) {
      toast.error((error as Error).message);
    }
    window.location.hash = "#/transaktionen";
    update({ tourPending });
    await onChanged();
  });

  return (
    <div className="flex w-full justify-center overflow-y-auto px-6 py-10">
      <div className="flex w-full max-w-160 flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <VirtbaseIcon className="size-8 shrink-0" />
          <div>
            <div className="font-semibold text-sm">Virtbase Bookkeeping</div>
            <div className="text-[13px] text-muted-foreground leading-4">
              {step === 0
                ? "Einrichtung"
                : `Einrichtung, Schritt ${step} von ${STEP_COUNT}`}
            </div>
          </div>
        </div>
        {step > 0 && (
          <div aria-hidden="true" className="flex gap-1.5">
            {STEPS.map((value) => (
              <div
                key={value}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  value <= step ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
        )}
        {restored && step > 0 && (
          <p className="rounded-md border bg-muted/40 p-3 text-sm">
            Sicherung geladen:{" "}
            {countLabel(restored.transactions, "Transaktion", "Transaktionen")},{" "}
            {countLabel(restored.exports, "Export", "Exporte")}. Prüfe die
            Angaben. API-Schlüssel und Monero-Wallet sind nicht Teil der
            Sicherung, trage sie bitte neu ein.
          </p>
        )}

        {step === 0 && (
          <StartChoice onNew={() => setStep(1)} onRestore={onRestore} />
        )}
        {step === 1 && (
          <>
            <StepHeading title="Stripe verbinden">
              Ein eingeschränkter Schlüssel mit Lesezugriff genügt: Balance,
              Balance Transactions, Charges, Customers, Disputes, Payouts und
              Refunds. Er bleibt auf diesem Computer.
            </StepHeading>
            <SecretField
              name="stripe"
              label="Eingeschränkter API-Schlüssel"
              placeholder="rk_live_..."
              configured={summary.stripeConfigured}
              helpTitle="Hilfe zum Stripe-Schlüssel"
              hint="Leserechte für Balance, Balance Transactions, Charges, Customers, Disputes, Payouts und Refunds genügen."
              keysUrl="https://dashboard.stripe.com/apikeys"
              keysLabel="Schlüssel im Stripe-Dashboard erstellen"
              onSaved={onChanged}
            />
          </>
        )}
        {step === 2 && <StartStep form={form} />}
        {step === 3 && <ExportStep form={form} />}
        {step === 4 && (
          <OptionalStep form={form} summary={summary} onChanged={onChanged} />
        )}

        {step > 0 && (
          <div className="flex justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={form.formState.isSubmitting}
              onClick={() => setStep(step - 1)}
            >
              Zurück
            </Button>
            {step < STEP_COUNT ? (
              <Button
                type="button"
                disabled={step === 1 && !summary.stripeConfigured}
                onClick={() => void next()}
              >
                Weiter
              </Button>
            ) : (
              <Button
                type="button"
                disabled={form.formState.isSubmitting}
                onClick={() => void finish()}
              >
                {form.formState.isSubmitting
                  ? "Erster Abruf läuft..."
                  : "Einrichtung abschließen"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
