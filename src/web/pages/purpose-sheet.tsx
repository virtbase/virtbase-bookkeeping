import type { PurposeKey } from "@shared/purpose.ts";
import {
  PLACEHOLDER_DESCRIPTIONS,
  PURPOSE_DEFINITIONS,
  renderTemplate,
} from "@shared/purpose.ts";
import type { SettingsDto } from "@shared/types.ts";
import type { Control } from "react-hook-form";
import { useWatch } from "react-hook-form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

function PurposeDetails({
  purposeKey,
  control,
}: {
  purposeKey: PurposeKey;
  control: Control<SettingsDto>;
}) {
  const definition = PURPOSE_DEFINITIONS[purposeKey];
  const template = useWatch({
    control,
    name: `purposeTemplates.${purposeKey}`,
  });

  return (
    <>
      <SheetHeader className="p-0">
        <SheetTitle>Platzhalter für {definition.label}</SheetTitle>
        <SheetDescription>
          Platzhalter werden beim Export durch die Werte der Zeile ersetzt.
        </SheetDescription>
      </SheetHeader>

      <dl className="flex flex-col gap-3 border-t pt-4">
        {definition.placeholders.map((name) => (
          <div key={name} className="flex flex-col gap-0.5">
            <dt className="font-mono text-[13px]">{`{${name}}`}</dt>
            <dd className="text-muted-foreground">
              {PLACEHOLDER_DESCRIPTIONS[name]}
            </dd>
          </div>
        ))}
      </dl>

      <dl className="flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium">Standard</dt>
          <dd className="wrap-anywhere font-mono text-[13px] text-muted-foreground">
            {definition.template}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium">Beispiel</dt>
          <dd className="wrap-anywhere text-muted-foreground">
            {renderTemplate(template, definition.sample)}
          </dd>
        </div>
      </dl>
    </>
  );
}

interface PurposeSheetProps {
  purposeKey: PurposeKey | null;
  control: Control<SettingsDto>;
  onClose: () => void;
}

export function PurposeSheet({
  purposeKey,
  control,
  onClose,
}: PurposeSheetProps) {
  return (
    <Sheet
      open={purposeKey !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent className="gap-4 overflow-y-auto p-5 sm:max-w-md">
        {purposeKey && (
          <PurposeDetails purposeKey={purposeKey} control={control} />
        )}
      </SheetContent>
    </Sheet>
  );
}
