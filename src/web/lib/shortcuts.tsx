import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef } from "react";
import { usePreferences } from "@/lib/preferences";

export interface Shortcut {
  press: string;
  keys: string[];
  label: string;
  group: string;
}

export const SHORTCUTS = {
  palette: {
    press: "ctrl+k",
    keys: ["Ctrl", "K"],
    label: "Suche und Befehle",
    group: "Allgemein",
  },
  search: {
    press: "/",
    keys: ["/"],
    label: "Suche auf dieser Seite",
    group: "Allgemein",
  },
  help: {
    press: "?",
    keys: ["?"],
    label: "Alle Tastenkürzel",
    group: "Allgemein",
  },
  privacy: {
    press: "alt+p",
    keys: ["Alt", "P"],
    label: "Privatmodus",
    group: "Allgemein",
  },
  sync: {
    press: "r",
    keys: ["R"],
    label: "Aktualisieren",
    group: "Allgemein",
  },
  save: {
    press: "ctrl+s",
    keys: ["Ctrl", "S"],
    label: "Einstellungen speichern",
    group: "Allgemein",
  },
  "go-transaktionen": {
    press: "g t",
    keys: ["G", "T"],
    label: "Transaktionen",
    group: "Navigation",
  },
  "go-statistiken": {
    press: "g s",
    keys: ["G", "S"],
    label: "Statistiken",
    group: "Navigation",
  },
  "go-exporte": {
    press: "g e",
    keys: ["G", "E"],
    label: "Exporte",
    group: "Navigation",
  },
  "go-audit-log": {
    press: "g a",
    keys: ["G", "A"],
    label: "Audit-Log",
    group: "Navigation",
  },
  "go-einstellungen": {
    press: "g ,",
    keys: ["G", ","],
    label: "Einstellungen",
    group: "Navigation",
  },
} satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

export const FOCUSED_SHORTCUTS: Pick<Shortcut, "keys" | "label" | "group">[] = [
  { keys: ["J", "K"], label: "Zeile wechseln", group: "Tabelle" },
  { keys: ["X"], label: "Zeile auswählen", group: "Tabelle" },
  { keys: ["Enter"], label: "Details öffnen", group: "Tabelle" },
  {
    keys: ["Alt", "↑", "↓"],
    label: "Vorherige oder nächste Zeile",
    group: "Details",
  },
  { keys: ["Ctrl", "Enter"], label: "Eingabe übernehmen", group: "Details" },
];

const SEQUENCE_TIMEOUT_MS = 1000;
const ENTRIES = Object.entries(SHORTCUTS) as [ShortcutId, Shortcut][];
const handlers = new Map<ShortcutId, () => void>();

const EnabledContext = createContext(true);

export function isSingleKey(id: ShortcutId): boolean {
  return !SHORTCUTS[id].press.includes("+");
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function matchesCombo(press: string, event: KeyboardEvent): boolean {
  const [modifier, key] = press.split("+");
  const held =
    modifier === "ctrl" ? event.ctrlKey || event.metaKey : event.altKey;
  return held && event.key.toLowerCase() === key;
}

export function runShortcut(id: ShortcutId): void {
  handlers.get(id)?.();
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences();
  const enabled = preferences.singleKeyShortcuts;

  useEffect(() => {
    let started: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onKey = (event: KeyboardEvent) => {
      for (const [id, { press }] of ENTRIES) {
        if (press.includes("+") && matchesCombo(press, event)) {
          if (handlers.has(id)) {
            event.preventDefault();
            runShortcut(id);
          }
          return;
        }
      }
      if (
        !enabled ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTyping(event.target) ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        started = null;
        return;
      }
      const key = event.key.toLowerCase();
      const press = started ? `${started} ${key}` : key;
      started = null;
      clearTimeout(timer);
      const match = ENTRIES.find(([, entry]) => entry.press === press);
      if (match) {
        if (handlers.has(match[0])) {
          event.preventDefault();
          runShortcut(match[0]);
        }
        return;
      }
      if (ENTRIES.some(([, entry]) => entry.press.startsWith(`${press} `))) {
        started = press;
        timer = setTimeout(() => {
          started = null;
        }, SEQUENCE_TIMEOUT_MS);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [enabled]);

  return (
    <EnabledContext.Provider value={enabled}>
      {children}
    </EnabledContext.Provider>
  );
}

export function useShortcutsEnabled(): boolean {
  return useContext(EnabledContext);
}

export function useShortcut(id: ShortcutId, handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    const run = () => latest.current();
    handlers.set(id, run);
    return () => {
      if (handlers.get(id) === run) {
        handlers.delete(id);
      }
    };
  }, [id]);
}
