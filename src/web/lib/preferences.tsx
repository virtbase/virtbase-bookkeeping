import type { PreferencesDto } from "@shared/types.ts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api";

export const MASK = "••••";

interface PreferencesValue {
  preferences: PreferencesDto;
  update: (patch: Partial<PreferencesDto>) => void;
  reload: () => Promise<void>;
  dark: boolean;
  toggleTheme: () => void;
  togglePrivacy: () => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<PreferencesDto | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", systemDark());
    void api.preferences().then(setPreferences);
  }, []);

  const update = useCallback((patch: Partial<PreferencesDto>) => {
    setPreferences((current) => current && { ...current, ...patch });
    void api.savePreferences(patch);
  }, []);

  const reload = useCallback(async () => {
    setPreferences(await api.preferences());
  }, []);

  const dark = preferences?.theme ? preferences.theme === "dark" : systemDark();
  const privacy = preferences?.privacy ?? false;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const togglePrivacy = useCallback(() => {
    update({ privacy: !privacy });
  }, [privacy, update]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        togglePrivacy();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePrivacy]);

  const value = useMemo(
    () =>
      preferences && {
        preferences,
        update,
        reload,
        dark,
        toggleTheme: () => update({ theme: dark ? "light" : "dark" }),
        togglePrivacy,
      },
    [preferences, update, reload, dark, togglePrivacy],
  );

  return value ? (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  ) : null;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error("usePreferences needs a PreferencesProvider");
  }
  return value;
}

export function usePrivacy() {
  const { preferences, togglePrivacy } = usePreferences();
  const enabled = preferences.privacy;
  const mask = useCallback(
    (text: string) => (enabled ? MASK : text),
    [enabled],
  );
  return { enabled, toggle: togglePrivacy, mask };
}
