const ROSTER_CHANGED_EVENT = 'fpa:roster-changed';

/**
 * Fired after an admin mutates users/dept_access (add user, role change,
 * access change) so already-open tabs pick it up without a full page
 * reload — the Dev Sign-In roster and the active session's own role/access
 * both listen. This is a same-tab, same-browser-session tool, so a DOM
 * CustomEvent is enough; no server push or cross-tab channel needed.
 */
export function emitRosterChanged(): void {
  window.dispatchEvent(new Event(ROSTER_CHANGED_EVENT));
}

export function onRosterChanged(handler: () => void): () => void {
  window.addEventListener(ROSTER_CHANGED_EVENT, handler);
  return () => window.removeEventListener(ROSTER_CHANGED_EVENT, handler);
}
