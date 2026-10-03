// Per-device preferences. localStorage can be unavailable (private browsing, blocked
// site data), so every access is guarded. An in-memory copy keeps the choice working
// for this page load even when nothing can be persisted.
const memory = new Map();

export function readPref(name, fallback) {
  if (memory.has(name)) return memory.get(name);
  try {
    const raw = localStorage.getItem(`lrc.${name}`);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    memory.set(name, value);
    return value;
  } catch {
    return fallback;
  }
}

export function writePref(name, value) {
  memory.set(name, value);
  try {
    localStorage.setItem(`lrc.${name}`, JSON.stringify(value));
  } catch {
    // Storage unavailable: the in-memory copy still applies for this page load.
  }
}
