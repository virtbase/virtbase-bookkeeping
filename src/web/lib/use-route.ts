import { useEffect, useState } from "react";

export type Route =
  | "transaktionen"
  | "statistiken"
  | "exporte"
  | "audit-log"
  | "einstellungen";

function current(): Route {
  const hash = window.location.hash.replace("#/", "");
  return hash === "statistiken" ||
    hash === "exporte" ||
    hash === "audit-log" ||
    hash === "einstellungen"
    ? hash
    : "transaktionen";
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);

  useEffect(() => {
    const update = () => setRoute(current());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return route;
}
