import {
  DEFAULT_FILE_NAME_TEMPLATE,
  FILE_NAME_DESCRIPTIONS,
  FILE_NAME_PLACEHOLDERS,
  FILE_NAME_SAMPLE,
  renderFileName,
} from "@shared/file-name.ts";
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

export type PlaceholderTopic = PurposeKey | "fileName";

interface TopicDefinition {
  label: string;
  description: string;
  template: string;
  placeholders: string[];
  descriptions: Record<string, string>;
  example: (template: string) => string;
}

function topicDefinition(topic: PlaceholderTopic): TopicDefinition {
  if (topic === "fileName") {
    return {
      label: "Dateiname",
      description:
        "Platzhalter werden beim Export durch die Werte der Datei ersetzt. Die Endung .csv kommt automatisch dazu.",
      template: DEFAULT_FILE_NAME_TEMPLATE,
      placeholders: FILE_NAME_PLACEHOLDERS,
      descriptions: FILE_NAME_DESCRIPTIONS,
      example: (template) => renderFileName(template, FILE_NAME_SAMPLE),
    };
  }
  const definition = PURPOSE_DEFINITIONS[topic];
  return {
    label: definition.label,
    description:
      "Platzhalter werden beim Export durch die Werte der Zeile ersetzt.",
    template: definition.template,
    placeholders: definition.placeholders,
    descriptions: PLACEHOLDER_DESCRIPTIONS,
    example: (template) => renderTemplate(template, definition.sample),
  };
}

function PlaceholderDetails({
  topic,
  control,
}: {
  topic: PlaceholderTopic;
  control: Control<SettingsDto>;
}) {
  const definition = topicDefinition(topic);
  const template = useWatch({
    control,
    name:
      topic === "fileName" ? "fileNameTemplate" : `purposeTemplates.${topic}`,
  });

  return (
    <>
      <SheetHeader className="p-0">
        <SheetTitle>Platzhalter für {definition.label}</SheetTitle>
        <SheetDescription>{definition.description}</SheetDescription>
      </SheetHeader>

      <dl className="flex flex-col gap-3 border-t pt-4">
        {definition.placeholders.map((name) => (
          <div key={name} className="flex flex-col gap-0.5">
            <dt className="font-mono text-[13px]">{`{${name}}`}</dt>
            <dd className="text-muted-foreground">
              {definition.descriptions[name]}
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
            {definition.example(template)}
          </dd>
        </div>
      </dl>
    </>
  );
}

interface PurposeSheetProps {
  topic: PlaceholderTopic | null;
  control: Control<SettingsDto>;
  onClose: () => void;
}

export function PurposeSheet({ topic, control, onClose }: PurposeSheetProps) {
  return (
    <Sheet
      open={topic !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent className="gap-4 overflow-y-auto p-5 sm:max-w-md">
        {topic && <PlaceholderDetails topic={topic} control={control} />}
      </SheetContent>
    </Sheet>
  );
}
