import { loadServers, saveServers, normaliseUrl } from "./storage.js";
import { fetchModels, streamChat } from "./api.js";
import { $, renderMarkdown, setBusy } from "./ui.js";

const els = {
  base: $("base"),
  serverSelect: $("serverSelect"),
  load: $("load"),
  model: $("model"),
  temp: $("temp"),
  max: $("max"),
  stop: $("stop"),
  send: $("send"),
  clear: $("clear"),
  prompt: $("prompt"),
  out: $("out"),
  openSettings: $("openSettings"),
  closeSettings: $("closeSettings"),
  settingsModal: $("settingsModal"),
  settingsServerSelect: $("settingsServerSelect"),
  settingsServerNick: $("settingsServerNick"),
  settingsServerUrl: $("settingsServerUrl"),
  settingsServerSave: $("settingsServerSave"),
  settingsServerRemove: $("settingsServerRemove"),
  settingsServerLoad: $("settingsServerLoad"),
  glowRange: $("glowRange"),
  scanlineRange: $("scanlineRange")
};

let abortController = null;
let servers = loadServers();
let conversation = [];
const GLOW_BASE = [0.35, 0.18, 0.10];
const SCANLINE_DEFAULT = 0.35;
let glowIntensity = 1;
let scanlineOpacity = SCANLINE_DEFAULT;

function populateServerSelect(selectedUrl) {
  const selects = [els.serverSelect, els.settingsServerSelect].filter(Boolean);
  if (!selects.length) return;

  const urlToSelect = normaliseUrl(selectedUrl || els.base?.value) || servers[0]?.url || "";

  selects.forEach((sel) => {
    sel.innerHTML = "";
    servers.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.url;          // internal value
      opt.textContent = s.nick;   // human display
      sel.appendChild(opt);
    });
    const match = [...sel.options].find(o => o.value === urlToSelect);
    if (match) sel.value = urlToSelect;
    else if (servers[0]) sel.value = servers[0].url;
  });

  if (els.base) {
    els.base.value = urlToSelect || els.base.value;
  }
}

function populateModels(models) {
  if (!els.model) return;
  els.model.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.id;
    els.model.appendChild(opt);
  }
}

function toggleBusy(busy) {
  setBusy(busy, {
    disableOnBusy: [
      els.send,
      els.load,
      els.serverSelect,
      els.base
    ],
    enableOnBusy: [els.stop]
  });
}

function setActiveServer(url, { loadModels = true } = {}) {
  const normalized = normaliseUrl(url);
  if (!normalized) return;

  if (els.base) els.base.value = normalized;
  if (els.serverSelect) els.serverSelect.value = normalized;
  if (els.settingsServerSelect) els.settingsServerSelect.value = normalized;

  if (loadModels) handleLoadModels();
}

function applyGlow(intensity) {
  glowIntensity = intensity;
  const root = document.documentElement;
  root.style.setProperty("--glow-intensity", intensity.toString());
  root.style.setProperty("--glow-1", (GLOW_BASE[0] * intensity).toFixed(3));
  root.style.setProperty("--glow-2", (GLOW_BASE[1] * intensity).toFixed(3));
  root.style.setProperty("--glow-3", (GLOW_BASE[2] * intensity).toFixed(3));
}

function applyScanlines(opacity) {
  scanlineOpacity = opacity;
  const root = document.documentElement;
  root.style.setProperty("--scanline-opacity", opacity.toFixed(3));
}

function conversationToMarkdown() {
  if (!conversation.length) return "(nothing yet)";

  return conversation
    .map((msg) => {
      const label = msg.role === "assistant" ? "Assistant" : "User";
      const body = msg.content || "";
      return { label, body, role: msg.role };
    });
}

function renderConversation(statusText = "") {
  if (!els.out) return;

  if (!conversation.length) {
    renderMarkdown(els.out, statusText || "(nothing yet)");
    return;
  }

  const statusHtml = statusText
    ? (window.marked ? marked.parse(statusText) : statusText)
    : "";

  const convoHtml = conversationToMarkdown()
    .map(({ label, body, role }) => {
      const bodyHtml = window.marked ? marked.parse(body) : body;
      const cls = role === "assistant" ? "assistant" : "user";
      return `<div class="msg ${cls}">
        <div class="msg-label">${label}</div>
        <div class="msg-body">${bodyHtml}</div>
      </div>`;
    })
    .join('<hr class="msg-separator" />');

  els.out.innerHTML = `${convoHtml}${statusHtml ? `<div class="status-line">${statusHtml}</div>` : ""}`;
  els.out.scrollTop = els.out.scrollHeight;
}

async function handleLoadModels() {
  renderConversation("_Status: Loading models..._");
  const base = (els.base?.value || "").replace(/\/+$/, "");
  if (!base) {
    renderConversation("_Status: No server selected._");
    return;
  }
  try {
    const data = await fetchModels(base);
    populateModels(data);
    renderConversation("_Status: Models loaded._");
  } catch (e) {
    renderConversation(`_Status: ${String(e)}_`);
  }
}

async function handleSend() {
  const base = (els.base.value || "").replace(/\/+$/, "");
  const prompt = (els.prompt.value || "").trim();
  if (!prompt) return;

  toggleBusy(true);
  abortController = new AbortController();

  const userMsg = { role: "user", content: prompt };
  const assistantMsg = { role: "assistant", content: "" };
  conversation.push(userMsg, assistantMsg);
  if (els.prompt) els.prompt.value = "";
  renderConversation();

  try {
    await streamChat({
      base,
      messages: conversation.slice(0, -1), // exclude the in-progress assistant message
      model: els.model.value,
      temperature: Number(els.temp.value),
      maxTokens: Number(els.max.value),
      signal: abortController.signal,
      onDelta: (delta) => {
        assistantMsg.content += delta;
        renderConversation();
      },
      onDone: () => {
        renderConversation();
      }
    });
  } catch (e) {
    assistantMsg.content = `Error: ${String(e)}`;
    renderConversation();
  } finally {
    toggleBusy(false);
    abortController = null;
  }
}

function wireEvents() {
  els.serverSelect?.addEventListener("change", () => {
    setActiveServer(els.serverSelect.value, { loadModels: true });
  });

  els.settingsServerSelect?.addEventListener("change", () => {
    setActiveServer(els.settingsServerSelect.value, { loadModels: true });
  });

  // Kept for safety, even though base is hidden
  els.base?.addEventListener("change", () => {
    const u = normaliseUrl(els.base.value);
    els.base.value = u;
    const match = servers.find(s => s.url === u);
    if (match) populateServerSelect(u);
  });

  els.settingsServerSave?.addEventListener("click", () => {
    const nick = (els.settingsServerNick.value || "").trim() || "server";
    const url = normaliseUrl(els.settingsServerUrl.value);
    if (!url) return;

    const existingIdx = servers.findIndex(s => s.url === url);
    if (existingIdx >= 0) {
      servers[existingIdx].nick = nick;
    } else {
      servers.push({ nick, url });
    }

    saveServers(servers);
    populateServerSelect(url);
    setActiveServer(url, { loadModels: true });
  });

  els.settingsServerRemove?.addEventListener("click", () => {
    const selected = els.settingsServerSelect?.value || els.serverSelect?.value;
    if (!selected || servers.length <= 1) return;

    servers = servers.filter(s => s.url !== selected);
    saveServers(servers);
    populateServerSelect();
    setActiveServer(servers[0]?.url, { loadModels: true });
  });

  els.settingsServerLoad?.addEventListener("click", () => handleLoadModels());

  els.load?.addEventListener("click", () => handleLoadModels());
  els.send?.addEventListener("click", () => handleSend());
  els.stop?.addEventListener("click", () => abortController?.abort());

  els.clear?.addEventListener("click", () => {
    if (els.prompt) els.prompt.value = "";
    conversation = [];
    renderConversation("(cleared)");
  });

  els.prompt?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.send.click();
    }
  });

  els.openSettings?.addEventListener("click", () => {
    els.settingsModal?.classList.remove("hidden");
  });

  els.closeSettings?.addEventListener("click", () => {
    els.settingsModal?.classList.add("hidden");
  });

  els.glowRange?.addEventListener("input", () => {
    applyGlow(Number(els.glowRange.value));
  });

  els.scanlineRange?.addEventListener("input", () => {
    applyScanlines(Number(els.scanlineRange.value));
  });
}

function init() {
  populateServerSelect();
  applyGlow(glowIntensity);
  applyScanlines(scanlineOpacity);
  if (els.glowRange) els.glowRange.value = glowIntensity;
  if (els.scanlineRange) els.scanlineRange.value = scanlineOpacity;
  wireEvents();
  setActiveServer(els.serverSelect?.value || servers[0]?.url, { loadModels: true });
}

init();
