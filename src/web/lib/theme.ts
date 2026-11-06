import { useCallback, useEffect, useState } from "react";

const KEY = "theme";

function initial(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      return stored === "dark";
    }
  } catch {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const [dark, setDark] = useState(initial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(KEY, dark ? "dark" : "light");
    } catch {
      return;
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((value) => !value), []);
  return { dark, toggle };
}
