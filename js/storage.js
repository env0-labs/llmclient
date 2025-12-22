export const LS_KEY = "ewan_llm_servers_v1";

export const DEFAULT_SERVERS = [
  { nick: "bitfuser", url: "http://192.168.1.129:1234" }
];

export function normaliseUrl(u) {
  const trimmed = (u || "").trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

export function loadServers() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [...DEFAULT_SERVERS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_SERVERS];

    return parsed
      .filter(s => s && typeof s.nick === "string" && typeof s.url === "string")
      .map(s => ({ nick: s.nick.trim() || "server", url: normaliseUrl(s.url) }))
      .filter(s => s.url);
  } catch {
    return [...DEFAULT_SERVERS];
  }
}

export function saveServers(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}
