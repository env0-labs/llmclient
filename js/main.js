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
let conversation = [];

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
  const base = (els.base.value || "").replace(/\/+$/, "");
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
    conversation = [];
    renderConversation("(cleared)");
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
