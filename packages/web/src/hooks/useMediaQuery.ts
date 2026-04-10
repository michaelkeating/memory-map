import { useEffect, useState } from "react";

/**
 * React hook that subscribes to a CSS media query and returns whether
 * it currently matches.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** Convenience: true on screens narrower than 1024px */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
