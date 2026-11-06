import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

const STOPS = [
  {
    target: "toolbar",
    title: "Transaktionen",
    text: "Hier suchst und filterst du. Wähle Zeilen in der Tabelle aus, dann erscheint unten der CSV-Export für Lexware.",
  },
  {
    target: "sync",
    title: "Aktualisieren",
    text: "Holt neue Stripe- und Monero-Zahlungen. Zeilen mit dem Status Prüfen brauchen noch einen Namen.",
  },
  {
    target: "nav-exporte",
    title: "Exporte",
    text: "Jeder Export landet hier. Du kannst ihn stornieren, dann sind seine Zeilen wieder frei.",
  },
  {
    target: "nav-statistiken",
    title: "Statistiken",
    text: "Umsätze, Gebühren und eine Prognose für beliebige Zeiträume.",
  },
  {
    target: "privacy",
    title: "Privatmodus",
    text: "Verbirgt Beträge und Namen, zum Beispiel beim Teilen des Bildschirms. Ein Klick auf einen Wert zeigt ihn kurz an.",
  },
];
const SPOTLIGHT_PADDING = 6;
const BACKDROP = "rgb(0 0 0 / 0.7)";
const ACTIVE_ATTRIBUTE = "data-tour-active";

function find(target: string | undefined): Element | null {
  return target ? document.querySelector(`[data-tour="${target}"]`) : null;
}

export function Tour({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [element, setElement] = useState<Element | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const stop = STOPS[index];
  const last = index === STOPS.length - 1;

  useEffect(() => {
    let frame = 0;
    const track = () => {
      const next = find(stop?.target);
      setElement(next);
      const box = next?.getBoundingClientRect() ?? null;
      setRect((current) =>
        current?.x === box?.x &&
        current?.y === box?.y &&
        current?.width === box?.width &&
        current?.height === box?.height
          ? current
          : box,
      );
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [stop?.target]);

  useEffect(() => {
    element?.setAttribute(ACTIVE_ATTRIBUTE, "");
    return () => element?.removeAttribute(ACTIVE_ATTRIBUTE);
  }, [element]);

  if (!stop || !element || !rect) {
    return null;
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-40 rounded-md transition-all duration-200"
        style={{
          top: rect.top - SPOTLIGHT_PADDING,
          left: rect.left - SPOTLIGHT_PADDING,
          width: rect.width + SPOTLIGHT_PADDING * 2,
          height: rect.height + SPOTLIGHT_PADDING * 2,
          boxShadow: `0 0 0 2px var(--foreground), 0 0 0 9999px ${BACKDROP}`,
        }}
      />
      <Popover open modal>
        <PopoverAnchor virtualRef={{ current: element }} />
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={12}
          collisionPadding={16}
          aria-label={stop.title}
          className="flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-3"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={onClose}
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-medium text-sm">{stop.title}</h2>
            <p className="text-muted-foreground text-sm">{stop.text}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums">
              {index + 1} von {STOPS.length}
            </span>
            <div className="flex gap-2">
              {!last && (
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Überspringen
                </Button>
              )}
              {index > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIndex(index - 1)}
                >
                  Zurück
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => (last ? onClose() : setIndex(index + 1))}
              >
                {last ? "Fertig" : "Weiter"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
