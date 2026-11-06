import { zodResolver } from "@hookform/resolvers/zod";
import { type MoneroWalletForm, moneroWalletSchema } from "@shared/schemas.ts";
import type { MoneroStatusDto } from "@shared/types.ts";
import { CircleQuestionMark, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Controller,
  type FieldError as HookError,
  useForm,
} from "react-hook-form";
import { toast } from "sonner";
import { HelpSheet } from "@/components/help-sheet";
import { MoneroIcon } from "@/components/icons";
import { LabelWithHelp } from "@/components/label-with-help";
import { Section } from "@/components/settings-section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { api } from "@/lib/api";
import { formatStamp } from "@/lib/format";

interface NodeListProps {
  value: string[];
  error: HookError | undefined;
  onChange: (value: string[]) => void;
  onBlur: () => void;
}

function nodeError(
  error: HookError | undefined,
  index: number,
): HookError | undefined {
  return (error as unknown as (HookError | undefined)[] | undefined)?.[index];
}

export function NodeList({ value, error, onChange, onBlur }: NodeListProps) {
  const nextId = useRef(value.length);
  const [ids, setIds] = useState(() => value.map((_, index) => index));

  const remove = (index: number) => {
    setIds(ids.filter((_, position) => position !== index));
    onChange(value.filter((_, position) => position !== index));
  };

  const add = () => {
    setIds([...ids, nextId.current]);
    nextId.current += 1;
    onChange([...value, ""]);
  };

  return (
    <FieldGroup className="gap-3">
      <Field data-invalid={Boolean(error?.message)}>
        <LabelWithHelp
          htmlFor="monero-node-0"
          help="Der erste erreichbare Node wird genutzt, die übrigen dienen als Ersatz. Nodes sehen deine IP-Adresse, aber nie deine Schlüssel."
        >
          Nodes
        </LabelWithHelp>
        {value.map((node, index) => {
          const rowError = nodeError(error, index);
          return (
            <div key={ids[index]} className="flex flex-col gap-2">
              <InputGroup>
                <InputGroupInput
                  id={`monero-node-${index}`}
                  aria-label={`Node ${index + 1}`}
                  aria-invalid={Boolean(rowError)}
                  className="font-mono text-[13px]"
                  value={node}
                  onBlur={onBlur}
                  onChange={(event) =>
                    onChange(
                      value.map((entry, position) =>
                        position === index ? event.target.value : entry,
                      ),
                    )
                  }
                />
                {value.length > 1 && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={`Node ${index + 1} entfernen`}
                      onClick={() => remove(index)}
                    >
                      <Trash2 />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <FieldError errors={[rowError]} />
            </div>
          );
        })}
        <FieldError errors={[error]} />
      </Field>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus />
          Node hinzufügen
        </Button>
      </div>
    </FieldGroup>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-10)}`;
}

function WalletForm({
  onSaved,
}: {
  onSaved: (status: MoneroStatusDto) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const form = useForm<MoneroWalletForm>({
    resolver: zodResolver(moneroWalletSchema),
    defaultValues: { address: "", viewKey: "", restoreHeight: "" },
    mode: "onTouched",
  });

  const save = form.handleSubmit(async (value) => {
    try {
      onSaved(await api.setupMonero(value));
      form.reset();
      toast("Wallet eingerichtet.");
    } catch (error) {
      toast.error((error as Error).message);
    }
  });

  return (
    <>
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        <FieldGroup className="gap-4">
          <Controller
            control={form.control}
            name="address"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="monero-address">
                  Primäre Adresse
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    {...field}
                    id="monero-address"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                    className="font-mono text-[13px]"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Hilfe zum Monero-Wallet"
                      onClick={() => setHelpOpen(true)}
                    >
                      <CircleQuestionMark />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="viewKey"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="monero-view-key">
                  Geheimer View-Key
                </FieldLabel>
                <Input
                  {...field}
                  id="monero-view-key"
                  type="password"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                  className="font-mono text-[13px]"
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="restoreHeight"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <LabelWithHelp
                  htmlFor="monero-height"
                  help="Block, ab dem gesucht wird. Je näher an deiner ersten Zahlung, desto schneller die erste Synchronisierung."
                >
                  Wiederherstellungshöhe
                </LabelWithHelp>
                <Input
                  {...field}
                  id="monero-height"
                  inputMode="numeric"
                  aria-invalid={fieldState.invalid}
                  className="font-mono text-[13px]"
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
        <div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? "Wird eingerichtet..."
              : "Wallet einrichten"}
          </Button>
        </div>
      </form>
      <HelpSheet
        open={helpOpen}
        title="Hilfe zum Monero-Wallet"
        description="Die App legt ein View-only-Wallet an. Damit sieht sie eingehende Zahlungen, kann aber nie Geld ausgeben. Seed und Spend-Key werden nicht gebraucht."
        onOpenChange={setHelpOpen}
      >
        <ol className="flex list-decimal flex-col gap-2 border-t pt-4 pl-5 text-muted-foreground">
          <li>Öffne in Monero GUI Einstellungen, dann Seed & Schlüssel.</li>
          <li>
            Kopiere die primäre Adresse und den geheimen View-Key, nicht den
            Spend-Key.
          </li>
          <li>
            Die Wiederherstellungshöhe findest du unter Einstellungen, Info.
          </li>
        </ol>
      </HelpSheet>
    </>
  );
}

export function MoneroWalletSection({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const [status, setStatus] = useState<MoneroStatusDto | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void api.moneroStatus().then(setStatus);
  }, []);

  const update = async (next: MoneroStatusDto) => {
    setStatus(next);
    await onChanged();
  };

  return (
    <Section
      title="Monero-Wallet"
      icon={MoneroIcon}
      badge={
        status?.configured ? (
          <StatusBadge tone="blue">View-only</StatusBadge>
        ) : null
      }
    >
      {status?.configured ? (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Adresse</dt>
            <dd className="text-right font-mono text-[13px]">
              {shortAddress(status.address ?? "")}
            </dd>
            <dt className="text-muted-foreground">Letzte Synchronisierung</dt>
            <dd className="text-right tabular-nums">
              {status.lastSyncAt ? formatStamp(status.lastSyncAt) : "—"}
            </dd>
          </dl>
          {status.lastError && <FieldError>{status.lastError}</FieldError>}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(true)}
            >
              Wallet entfernen
            </Button>
          </div>
        </>
      ) : (
        <WalletForm onSaved={(next) => void update(next)} />
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Wallet entfernen?</DialogTitle>
            <DialogDescription>
              Das View-only-Wallet wird gelöscht. Dein echtes Wallet und bereits
              importierte Zahlungen bleiben unverändert.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                void api.removeMonero().then(update);
              }}
            >
              Wallet entfernen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
