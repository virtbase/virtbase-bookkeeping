import { zodResolver } from "@hookform/resolvers/zod";
import type { PurposeKey } from "@shared/purpose.ts";
import { PURPOSE_DEFINITIONS, PURPOSE_KEYS } from "@shared/purpose.ts";
import type { SecretForm } from "@shared/schemas.ts";
import {
  lexwareKeySchema,
  settingsSchema,
  stripeKeySchema,
} from "@shared/schemas.ts";
import type {
  BackupStatusDto,
  DateFormat,
  DecimalFormat,
  RateSource,
  SettingsDto,
  Source,
  SummaryDto,
} from "@shared/types.ts";
import {
  Braces,
  ChevronDown,
  CircleQuestionMark,
  DatabaseBackup,
  ExternalLink,
  FileSpreadsheet,
  Flag,
  FolderOpen,
  GraduationCap,
  RotateCcw,
  Server,
  TextCursorInput,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Control, FieldPath, UseFormSetValue } from "react-hook-form";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { DateTimePicker } from "@/components/date-time-picker";
import { HelpSheet } from "@/components/help-sheet";
import { LexwareIcon, MoneroIcon, StripeIcon } from "@/components/icons";
import { LabelWithHelp } from "@/components/label-with-help";
import { MonthPicker } from "@/components/month-picker";
import { Section } from "@/components/settings-section";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApiError, api } from "@/lib/api";
import { showFormError } from "@/lib/form-error";
import { countLabel, formatBytes, formatStamp } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { runShortcut, useShortcut } from "@/lib/shortcuts";
import { DangerZone } from "@/pages/danger-zone";
import { MoneroWalletSection, NodeList } from "@/pages/monero-settings";
import { PurposeSheet } from "@/pages/purpose-sheet";

const SECRET_MASK = "••••••••••••••••";

function Choice<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([option, label]) => (
          <SelectItem key={option} value={option}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SecretField({
  name,
  label,
  placeholder,
  configured,
  helpTitle,
  hint,
  keysUrl,
  keysLabel,
  onSaved,
}: {
  name: "stripe" | "lexware";
  label: string;
  placeholder: string;
  configured: boolean;
  helpTitle: string;
  hint: string;
  keysUrl: string;
  keysLabel: string;
  onSaved: () => Promise<void>;
}) {
  const [testing, setTesting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const form = useForm<SecretForm>({
    resolver: zodResolver(
      name === "stripe" ? stripeKeySchema : lexwareKeySchema,
    ),
    defaultValues: { value: "" },
  });

  const save = form.handleSubmit(async ({ value }) => {
    try {
      await api.saveSecret(name, value);
      form.reset();
      await onSaved();
      toast("Schlüssel geprüft und gespeichert.");
    } catch (error) {
      showFormError(error, form.setError, ["value"]);
    }
  });

  const test = async () => {
    setTesting(true);
    form.clearErrors();
    try {
      toast((await api.testSecret(name)).message);
    } catch (error) {
      form.setError("value", { message: (error as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <form onSubmit={save} noValidate className="flex flex-col gap-3">
        <Controller
          control={form.control}
          name="value"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`secret-${name}`}>{label}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  {...field}
                  id={`secret-${name}`}
                  type="password"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                  className="font-mono text-[13px]"
                  placeholder={configured ? SECRET_MASK : placeholder}
                />
                <InputGroupAddon align="inline-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InputGroupButton
                        size="icon-xs"
                        aria-label={helpTitle}
                        onClick={() => setHelpOpen(true)}
                      >
                        <CircleQuestionMark />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>{helpTitle}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={keysUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={keysLabel}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-xs",
                        })}
                      >
                        <ExternalLink />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>{keysLabel}</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={form.formState.isSubmitting || testing}
          >
            Speichern
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={form.formState.isSubmitting || testing || !configured}
            onClick={() => void test()}
          >
            Verbindung testen
          </Button>
        </div>
      </form>
      <HelpSheet
        open={helpOpen}
        title={helpTitle}
        description={hint}
        onOpenChange={setHelpOpen}
      />
    </>
  );
}

function PurposeField({
  purposeKey,
  control,
  setValue,
  onShowPlaceholders,
}: {
  purposeKey: PurposeKey;
  control: Control<SettingsDto>;
  setValue: UseFormSetValue<SettingsDto>;
  onShowPlaceholders: (key: PurposeKey) => void;
}) {
  const definition = PURPOSE_DEFINITIONS[purposeKey];
  const id = `purpose-${purposeKey}`;
  return (
    <Controller
      control={control}
      name={`purposeTemplates.${purposeKey}`}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{definition.label}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              {...field}
              id={id}
              aria-invalid={fieldState.invalid}
              className="font-mono text-[13px]"
            />
            <InputGroupAddon align="inline-end">
              {field.value !== definition.template && (
                <InputGroupButton
                  size="icon-xs"
                  aria-label={`${definition.label} auf Standard zurücksetzen`}
                  onClick={() =>
                    setValue(field.name, definition.template, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <RotateCcw />
                </InputGroupButton>
              )}
              <InputGroupButton
                size="icon-xs"
                aria-label={`Platzhalter für ${definition.label} anzeigen`}
                onClick={() => onShowPlaceholders(purposeKey)}
              >
                <Braces />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

const ACCOUNT_FIELDS: { source: Source; label: string }[] = [
  { source: "stripe", label: "Stripe" },
  { source: "fees", label: "Gebühren" },
  { source: "monero", label: "Monero" },
];

const FORM_FIELDS: FieldPath<SettingsDto>[] = [
  "exportDir",
  "backupDir",
  "baselineDate",
  "feesClosedThrough",
  "stripeName",
  "paypalName",
  "accounts.stripe",
  "accounts.fees",
  "accounts.monero",
  "moneroNodes",
  ...PURPOSE_KEYS.map((key) => `purposeTemplates.${key}` as const),
];

function BackupPanel({
  status,
  onChange,
  onChanged,
}: {
  status: BackupStatusDto | null;
  onChange: (status: BackupStatusDto) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const backUp = async () => {
    setBusy(true);
    try {
      onChange(await api.createBackup());
      toast("Sicherung erstellt.");
    } catch (error) {
      toast.error((error as Error).message);
      onChange(await api.backups());
    } finally {
      setBusy(false);
      await onChanged();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">
          {status?.lastAt
            ? `Letzte Sicherung ${formatStamp(status.lastAt)}`
            : "Noch keine Sicherung"}
        </span>
        {status && status.count > 0 && (
          <span className="text-muted-foreground text-xs">
            {countLabel(status.count, "Sicherung", "Sicherungen")},{" "}
            {formatBytes(status.sizeBytes)}
          </span>
        )}
        {status?.error && (
          <span role="alert" className="text-destructive text-xs">
            {status.error}
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void backUp()}
      >
        <DatabaseBackup />
        Jetzt sichern
      </Button>
    </div>
  );
}

function GeneralForm({
  initial,
  onChanged,
}: {
  initial: SettingsDto;
  onChanged: () => Promise<void>;
}) {
  const { update, preferences } = usePreferences();
  const [picking, setPicking] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [placeholderKey, setPlaceholderKey] = useState<PurposeKey | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatusDto | null>(
    null,
  );
  const form = useForm<SettingsDto>({
    resolver: zodResolver(settingsSchema),
    defaultValues: initial,
    mode: "onTouched",
  });

  const save = form.handleSubmit(
    async (value) => {
      try {
        form.reset(await api.saveSettings(value));
        await onChanged();
        toast("Einstellungen gespeichert.");
      } catch (error) {
        const field = error instanceof ApiError ? error.field : undefined;
        if (field?.startsWith("purpose") || field?.startsWith("moneroNodes")) {
          setAdvancedOpen(true);
        }
        showFormError(error, form.setError, FORM_FIELDS);
      }
    },
    (errors) => {
      if (errors.purposeTemplates || errors.moneroNodes) {
        setAdvancedOpen(true);
      }
    },
  );

  useShortcut("save", () => void save());

  const savedCount = form.formState.submitCount;
  useEffect(() => {
    void savedCount;
    void api.backups().then(setBackupStatus);
  }, [savedCount]);

  const pickFolder = async (name: "exportDir" | "backupDir") => {
    setPicking(true);
    try {
      const { path } = await api.chooseFolder(form.getValues(name));
      if (path) {
        form.setValue(name, path, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } catch (error) {
      form.setError(name, { message: (error as Error).message });
    } finally {
      setPicking(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      <Section title="Startpunkt" icon={Flag}>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="baselineDate"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <LabelWithHelp
                  htmlFor="baseline"
                  help="Zeilen bis einschließlich dieser Minute gelten als exportiert."
                >
                  Bereits in Lexware bis
                </LabelWithHelp>
                <DateTimePicker
                  id="baseline"
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
                <LabelWithHelp
                  htmlFor="closed"
                  help="Letzter Monat mit Gebührenzeilen."
                >
                  Gebühren gebucht bis
                </LabelWithHelp>
                <MonthPicker
                  id="closed"
                  value={field.value}
                  invalid={fieldState.invalid}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </Section>

      <Section title="CSV-Export" icon={FileSpreadsheet}>
        <FieldGroup className="gap-4">
          <Controller
            control={form.control}
            name="exportDir"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="export-dir">Exportordner</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    {...field}
                    id="export-dir"
                    aria-invalid={fieldState.invalid}
                    className="font-mono text-[13px]"
                  />
                  <InputGroupAddon align="inline-end">
                    <CopyButton
                      value={field.value}
                      label="Exportordner kopieren"
                      sensitive={false}
                    />
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Ordner auswählen"
                      disabled={picking}
                      onClick={() => void pickFolder("exportDir")}
                    >
                      <FolderOpen />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="stripeName"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <LabelWithHelp
                  htmlFor="stripe-name"
                  help="Steht bei Auszahlungen und Stripe-Gebühren im Feld Auftraggeber / Empfänger."
                >
                  Name für Stripe
                </LabelWithHelp>
                <Input
                  {...field}
                  id="stripe-name"
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="paypalName"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <LabelWithHelp
                  htmlFor="paypal-name"
                  help="Steht bei den PayPal-Gebühren im Feld Auftraggeber / Empfänger."
                >
                  Name für PayPal
                </LabelWithHelp>
                <Input
                  {...field}
                  id="paypal-name"
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <div className="flex flex-col gap-3">
            <LabelWithHelp
              htmlFor="account-stripe"
              help="Jedes Konto bekommt beim Export eine eigene Datei. Gleicher Name bedeutet gleiche Datei."
            >
              Lexware-Konten
            </LabelWithHelp>
            <div className="grid items-start gap-3 sm:grid-cols-3">
              {ACCOUNT_FIELDS.map(({ source, label }) => (
                <Controller
                  key={source}
                  control={form.control}
                  name={`accounts.${source}`}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid} className="gap-2">
                      <FieldLabel
                        htmlFor={`account-${source}`}
                        className="font-normal text-muted-foreground"
                      >
                        {label}
                      </FieldLabel>
                      <Input
                        {...field}
                        id={`account-${source}`}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="dateFormat"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="date-format">Datumsformat</FieldLabel>
                  <Choice<DateFormat>
                    id="date-format"
                    value={field.value}
                    options={[
                      ["iso", "2026-11-05 15:29:26"],
                      ["de", "05.11.2026"],
                    ]}
                    onChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="decimalFormat"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="decimal-format">
                    Dezimalzeichen
                  </FieldLabel>
                  <Choice<DecimalFormat>
                    id="decimal-format"
                    value={field.value}
                    options={[
                      ["dot", "Punkt (53.9)"],
                      ["comma", "Komma (53,90)"],
                    ]}
                    onChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
        </FieldGroup>
      </Section>

      <Section title="Monero-Kurs" icon={MoneroIcon}>
        <Controller
          control={form.control}
          name="rateSource"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="rate-source">XMR/EUR-Kurs</FieldLabel>
              <Choice<RateSource>
                id="rate-source"
                value={field.value}
                options={[
                  ["auto", "Kraken, sonst CoinGecko"],
                  ["coingecko", "Nur CoinGecko"],
                  ["manual", "Manuell eingeben"],
                ]}
                onChange={field.onChange}
              />
            </Field>
          )}
        />
      </Section>

      <Section title="Sicherungen" icon={DatabaseBackup}>
        <Controller
          control={form.control}
          name="backupDir"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <LabelWithHelp
                htmlFor="backup-dir"
                help="Ein Ordner auf einer anderen Festplatte oder einem NAS schützt auch vor einem Festplattenausfall. API-Schlüssel und Monero-Wallet werden nicht gesichert."
              >
                Sicherungsordner
              </LabelWithHelp>
              <InputGroup>
                <InputGroupInput
                  {...field}
                  id="backup-dir"
                  aria-invalid={fieldState.invalid}
                  placeholder={backupStatus?.defaultDirectory}
                  className="font-mono text-[13px]"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Sicherungsordner auswählen"
                    disabled={picking}
                    onClick={() => void pickFolder("backupDir")}
                  >
                    <FolderOpen />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <BackupPanel
          status={backupStatus}
          onChange={setBackupStatus}
          onChanged={onChanged}
        />
      </Section>

      <Section title="Hilfe" icon={GraduationCap}>
        <label
          htmlFor="single-keys"
          className="flex items-center gap-2 text-sm"
        >
          <Checkbox
            id="single-keys"
            checked={preferences.singleKeyShortcuts}
            onCheckedChange={(checked) =>
              update({ singleKeyShortcuts: checked === true })
            }
          />
          Tastenkürzel aus einzelnen Tasten verwenden
        </label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => runShortcut("help")}
          >
            Tastenkürzel anzeigen
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              update({ tourPending: true });
              window.location.hash = "#/transaktionen";
            }}
          >
            Einführung starten
          </Button>
        </div>
      </Section>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="group flex w-fit items-center gap-1.5 rounded-sm text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-data-[state=open]:rotate-180"
          />
          Erweiterte Optionen {advancedOpen ? "ausblenden" : "anzeigen"}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-6 pt-6">
            <Section title="Monero-Nodes" icon={Server}>
              <Controller
                control={form.control}
                name="moneroNodes"
                render={({ field, fieldState }) => (
                  <NodeList
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error}
                  />
                )}
              />
            </Section>
            <Section title="Verwendungszweck" icon={TextCursorInput}>
              <FieldGroup className="gap-4">
                {PURPOSE_KEYS.map((key) => (
                  <PurposeField
                    key={key}
                    purposeKey={key}
                    control={form.control}
                    setValue={form.setValue}
                    onShowPlaceholders={setPlaceholderKey}
                  />
                ))}
              </FieldGroup>
            </Section>
            <DangerZone onChanged={onChanged} />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Speichern
        </Button>
      </div>

      <PurposeSheet
        purposeKey={placeholderKey}
        control={form.control}
        onClose={() => setPlaceholderKey(null)}
      />
    </form>
  );
}

interface SettingsPageProps {
  summary: SummaryDto | null;
  onChanged: () => Promise<void>;
}

export function SettingsPage({ summary, onChanged }: SettingsPageProps) {
  const [initial, setInitial] = useState<SettingsDto | null>(null);

  useEffect(() => {
    void api.settings().then(setInitial);
  }, []);

  return (
    <div className="flex max-w-160 flex-col gap-6 py-2">
      <Section
        title="Stripe"
        icon={StripeIcon}
        badge={
          summary?.stripeKeyType === "secret" ? (
            <StatusBadge tone="amber">Vollzugriff</StatusBadge>
          ) : summary?.stripeKeyType === "restricted" ? (
            <StatusBadge tone="blue">Nur Lesezugriff</StatusBadge>
          ) : null
        }
      >
        <SecretField
          name="stripe"
          label="Eingeschränkter API-Schlüssel"
          placeholder="rk_live_..."
          configured={summary?.stripeConfigured ?? false}
          helpTitle="Hilfe zum Stripe-Schlüssel"
          hint="Leserechte für Balance, Balance Transactions, Charges, Customers, Disputes, Payouts und Refunds genügen."
          keysUrl="https://dashboard.stripe.com/apikeys"
          keysLabel="Schlüssel im Stripe-Dashboard erstellen"
          onSaved={onChanged}
        />
      </Section>

      <Section
        title="Lexware"
        icon={LexwareIcon}
        badge={
          summary?.lexwareConfigured ? (
            <StatusBadge tone="blue">Hinterlegt</StatusBadge>
          ) : null
        }
      >
        <SecretField
          name="lexware"
          label="API-Schlüssel"
          placeholder="Aus app.lexware.de/addons/public-api"
          configured={summary?.lexwareConfigured ?? false}
          helpTitle="Hilfe zum Lexware-Schlüssel"
          hint="Nur zum Lesen von Rechnungen, um Monero-Zahlungen zuzuordnen."
          keysUrl="https://app.lexware.de/addons/public-api"
          keysLabel="Schlüssel bei Lexware erstellen"
          onSaved={onChanged}
        />
      </Section>

      <MoneroWalletSection onChanged={onChanged} />

      {initial && <GeneralForm initial={initial} onChanged={onChanged} />}
    </div>
  );
}
