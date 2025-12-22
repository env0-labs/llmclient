import { loadServers, saveServers, normaliseUrl } from "./storage.js";
import { fetchModels, streamChat } from "./api.js";
import { $, renderMarkdown, setBusy } from "./ui.js";

const els = {
  base: $("base"),
  serverSelect: $("serverSelect"),
  serverAddToggle: $("serverAddToggle"),
  serverRemove: $("serverRemove"),
  serverAddPanel: $("serverAddPanel"),
  serverNick: $("serverNick"),
  serverUrl: $("serverUrl"),
  serverSave: $("serverSave"),
  serverCancel: $("serverCancel"),
  load: $("load"),
  model: $("model"),
  temp: $("temp"),
  max: $("max"),
  stop: $("stop"),
  send: $("send"),
  clear: $("clear"),
  prompt: $("prompt"),
  out: $("out")
};

let abortController = null;
let servers = loadServers();

function populateServerSelect(selectedUrl) {
  const sel = els.serverSelect;
  if (!sel) return;
  sel.innerHTML = "";

  // IMPORTANT: nickname only (no IP/URL in UI)
  servers.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.url;          // internal value
    opt.textContent = s.nick;   // human display
    sel.appendChild(opt);
  });

  const urlToSelect = selectedUrl || normaliseUrl(els.base.value) || servers[0]?.url;
  const match = [...sel.options].find(o => o.value === urlToSelect);

  if (match) sel.value = urlToSelect;
  else if (servers[0]) sel.value = servers[0].url;

  els.base.value = sel.value || els.base.value;
}

function openAddPanel(open) {
  if (!els.serverAddPanel) return;
  els.serverAddPanel.classList.toggle("hidden", !open);
  if (open) {
    els.serverNick.value = "";
    els.serverUrl.value = "";
    els.serverNick.focus();
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
      els.serverAddToggle,
      els.serverRemove,
      els.base,
      els.serverNick,
      els.serverUrl,
      els.serverSave,
      els.serverCancel
    ],
    enableOnBusy: [els.stop]
  });
}

async function handleLoadModels() {
  renderMarkdown(els.out, "Loading models...");
  const base = (els.base.value || "").replace(/\/+$/, "");
  try {
    const data = await fetchModels(base);
    populateModels(data);
    renderMarkdown(els.out, "Models loaded.");
  } catch (e) {
    renderMarkdown(els.out, String(e));
  }
}

async function handleSend() {
  const base = (els.base.value || "").replace(/\/+$/, "");
  const prompt = (els.prompt.value || "").trim();
  if (!prompt) return;

  toggleBusy(true);
  abortController = new AbortController();

  let fullText = "";
  renderMarkdown(els.out, "");

  try {
    await streamChat({
      base,
      prompt,
      model: els.model.value,
      temperature: Number(els.temp.value),
      maxTokens: Number(els.max.value),
      signal: abortController.signal,
      onDelta: (delta) => {
        fullText += delta;
        renderMarkdown(els.out, fullText);
        els.out.scrollTop = els.out.scrollHeight;
      },
      onDone: () => {
        renderMarkdown(els.out, fullText);
        els.out.scrollTop = els.out.scrollHeight;
      }
    });
  } catch (e) {
    renderMarkdown(els.out, String(e));
  } finally {
    toggleBusy(false);
    abortController = null;
  }
}

function wireEvents() {
  els.serverSelect?.addEventListener("change", () => {
    els.base.value = els.serverSelect.value;
  });

  // Kept for safety, even though base is hidden
  els.base?.addEventListener("change", () => {
    const u = normaliseUrl(els.base.value);
    els.base.value = u;
    const match = servers.find(s => s.url === u);
    if (match) populateServerSelect(u);
  });

  els.serverAddToggle?.addEventListener("click", () => {
    const isOpen = !els.serverAddPanel.classList.contains("hidden");
    openAddPanel(!isOpen);
  });

  els.serverCancel?.addEventListener("click", () => openAddPanel(false));

  els.serverSave?.addEventListener("click", () => {
    const nick = (els.serverNick.value || "").trim() || "server";
    const url = normaliseUrl(els.serverUrl.value);
    if (!url) return;

    const existingIdx = servers.findIndex(s => s.url === url);
    if (existingIdx >= 0) {
      servers[existingIdx].nick = nick;
    } else {
      servers.push({ nick, url });
    }

    saveServers(servers);
    populateServerSelect(url);
    openAddPanel(false);
  });

  els.serverRemove?.addEventListener("click", () => {
    const selected = els.serverSelect.value;
    if (!selected) return;
    if (servers.length <= 1) return;

    servers = servers.filter(s => s.url !== selected);
    saveServers(servers);
    populateServerSelect();
  });

  els.load?.addEventListener("click", () => handleLoadModels());
  els.send?.addEventListener("click", () => handleSend());
  els.stop?.addEventListener("click", () => abortController?.abort());

  els.clear?.addEventListener("click", () => {
    if (els.prompt) els.prompt.value = "";
    renderMarkdown(els.out, "(cleared)");
  });

  els.prompt?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.send.click();
    }
  });
}

function init() {
  populateServerSelect();
  wireEvents();
}

init();
