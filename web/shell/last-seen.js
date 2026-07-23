// Per-device "have I looked at this yet" bookkeeping. Backs a few small
// pieces of UX: landing on the Morning Brief right after sign-in only
// when there's actually something new there (rather than wherever the
// URL hash happened to be left from the last visit -- see shell.js and
// module-registry.js's preferredInitialId), and unseen-activity dots on
// the Log and ToDo nav buttons (see those modules' getBadgeCount).
// localStorage only, deliberately: this is a "did I already look" marker
// for one browser, not data worth syncing across devices through
// Supabase.

const BRIEF_KEY = "tor-dash:last-seen-brief";
const LOG_KEY = "tor-dash:last-seen-log";
const TODO_KEY = "tor-dash:last-seen-todo";

export function getLastSeenBrief() {
  return localStorage.getItem(BRIEF_KEY);
}

export function setLastSeenBrief(iso) {
  if (iso) localStorage.setItem(BRIEF_KEY, iso);
}

export function getLastSeenLog() {
  return localStorage.getItem(LOG_KEY);
}

export function setLastSeenLog(iso) {
  if (iso) localStorage.setItem(LOG_KEY, iso);
}

export function getLastSeenTodo() {
  return localStorage.getItem(TODO_KEY);
}

export function setLastSeenTodo(iso) {
  if (iso) localStorage.setItem(TODO_KEY, iso);
}
