import { createContext, useContext } from "react";

/**
 * Whether the match page is the top tab on screen. App keeps the match page
 * mounted while 「战绩」 / settings show (parked with display:none, see
 * App.tsx), so a report component that acts on its own — a window-level
 * shortcut, a playback loop — asks this before it does: hidden, it must not
 * take the other page's key presses or keep playing (codex review of the
 * parked page, 2026-11-14 #3). Default true: outside App (tests, the dev test
 * bed) a report is always the page on screen.
 */
export const MatchPageActiveContext = createContext(true);

export function useMatchPageActive(): boolean {
  return useContext(MatchPageActiveContext);
}
