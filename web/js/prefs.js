// Per-device preferences. localStorage can be unavailable (private browsing, blocked
// site data), so every access is guarded and falls back to the default.
export function readPref(name, fallback) {
  try {
    const raw = localStorage.getItem(`lrc.${name}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writePref(name, value) {
  try {
    localStorage.setItem(`lrc.${name}`, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice still applies for this page load.
  }
}
