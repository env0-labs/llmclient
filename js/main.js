import { loadServers, saveServers, normaliseUrl } from "./storage.js";
import { fetchModels, streamChat } from "./api.js";
import { $, renderMarkdown, setBusy } from "./ui.js";

const els = {
  base: $("base"),
  serverSelect: $("serverSelect"),
  model: $("model"),
  temp: $("temp"),
  max: $("max"),
  stop: $("stop"),
  send: $("send"),
  clear: $("clear"),
  retry: $("retry"),
  clearHistory: $("clearHistory"),
  prompt: $("prompt"),
  toggleSystemPrompt: $("toggleSystemPrompt"),
  systemPrompt: $("systemPrompt"),
  systemPromptRow: $("systemPromptRow"),
  out: $("out"),
  viz: $("viz"),
  statusBar: $("statusBar"),
  openSettings: $("openSettings"),
  closeSettings: $("closeSettings"),
  settingsModal: $("settingsModal"),
  settingsServerSelect: $("settingsServerSelect"),
  settingsServerNick: $("settingsServerNick"),
  settingsServerUrl: $("settingsServerUrl"),
  settingsServerSave: $("settingsServerSave"),
  settingsServerRemove: $("settingsServerRemove"),
  glowRange: $("glowRange"),
  scanlineRange: $("scanlineRange")
};

let abortController = null;
let servers = loadServers();
let conversation = [];
let lastPrompt = "";
const GLOW_BASE = [0.35, 0.18, 0.10];
const SCANLINE_DEFAULT = 0.09;
let glowIntensity = 1;
let scanlineOpacity = SCANLINE_DEFAULT;
const CONVO_KEY_PREFIX = "ewan_llm_convo_";
const SYS_KEY_PREFIX = "ewan_llm_sys_";
let streamStats = { start: 0, chunks: 0, chars: 0, done: true };
let systemPromptVisible = false;
let vizData = new Array(60).fill(0);
let vizCtx = null;
let vizDpr = 1;
let vizAnimating = false;
let currentAssistantMsg = null;
let streamStopped = false;
let aTokenCount = 0;
let vizLeftEnergy = 0;

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
      els.serverSelect,
      els.base
    ],
    enableOnBusy: [els.stop]
  });
}

function convoKey(url) {
  const u = normaliseUrl(url || els.base?.value || "");
  return `${CONVO_KEY_PREFIX}${u || "default"}`;
}

function sysKey(url) {
  const u = normaliseUrl(url || els.base?.value || "");
  return `${SYS_KEY_PREFIX}${u || "default"}`;
}

function saveConversation() {
  const key = convoKey();
  localStorage.setItem(key, JSON.stringify({ conversation, lastPrompt }));
}

function loadConversation() {
  const key = convoKey();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      conversation = [];
      lastPrompt = "";
      return;
    }
    const data = JSON.parse(raw);
    conversation = Array.isArray(data.conversation) ? data.conversation : [];
    lastPrompt = typeof data.lastPrompt === "string" ? data.lastPrompt : "";
  } catch {
    conversation = [];
    lastPrompt = "";
  }
}

function saveSystemPrompt() {
  const key = sysKey();
  localStorage.setItem(key, JSON.stringify({ system: els.systemPrompt?.value || "" }));
}

function loadSystemPrompt() {
  const key = sysKey();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.system === "string" && els.systemPrompt) {
      els.systemPrompt.value = data.system;
      systemPromptVisible = false;
      updateSystemPromptVisibility();
    }
  } catch { /* noop */ }
}

function setActiveServer(url, { loadModels = true } = {}) {
  const normalized = normaliseUrl(url);
  if (!normalized) return;

  if (els.base) els.base.value = normalized;
  if (els.serverSelect) els.serverSelect.value = normalized;
  if (els.settingsServerSelect) els.settingsServerSelect.value = normalized;

  loadConversation();
  renderConversation();
  loadSystemPrompt();
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

function updateStatus(text) {
  if (els.statusBar) {
    els.statusBar.textContent = text || "(idle)";
  }
}

function updateStatusFromStats(done = false) {
  const elapsed = streamStats.start ? ((performance.now() - streamStats.start) / 1000).toFixed(2) : "0.00";
  const label = done ? "Done" : "Streaming";
  const msg = `${label} • ${streamStats.chunks} chunks • ${streamStats.chars} chars • ${elapsed}s`;
  updateStatus(msg);
}

function updateSystemPromptVisibility(force) {
  const row = els.systemPromptRow || document.getElementById("systemPromptRow");
  if (!row) return;
  if (typeof force === "boolean") {
    systemPromptVisible = force;
  }
  row.classList.toggle("hidden", !systemPromptVisible);
}

function resizeViz() {
  if (!els.viz) return;
  vizDpr = window.devicePixelRatio || 1;
  const rect = els.viz.getBoundingClientRect();
  els.viz.width = rect.width * vizDpr;
  els.viz.height = rect.height * vizDpr;
  vizCtx = els.viz.getContext("2d");
  if (vizCtx) vizCtx.setTransform(vizDpr, 0, 0, vizDpr, 0, 0);
}

function drawViz() {
  if (!vizCtx || !els.viz) return;
  const width = els.viz.width / vizDpr;
  const height = els.viz.height / vizDpr;

  // decay (slower)
  vizData = vizData.map(v => v * 0.97);
   vizLeftEnergy *= 0.97;
   vizData[0] = Math.max(vizData[0], vizLeftEnergy);

  vizCtx.clearRect(0, 0, width, height);

  // background grid
  vizCtx.strokeStyle = "rgba(0,255,140,0.12)";
  vizCtx.lineWidth = 1;
  vizCtx.beginPath();
  for (let x = 0; x < width; x += 18) {
    vizCtx.moveTo(x, 0);
    vizCtx.lineTo(x, height);
  }
  for (let y = 0; y < height; y += 16) {
    vizCtx.moveTo(0, y);
    vizCtx.lineTo(width, y);
  }
  vizCtx.stroke();

  const step = width / (vizData.length - 1);
  const baseLine = height * 0.78;

  // glow layer
  vizCtx.beginPath();
  vizCtx.moveTo(0, baseLine - vizData[0] * height * 0.5);
  for (let i = 1; i < vizData.length; i++) {
    const x = i * step;
    const y = baseLine - vizData[i] * height * 0.5;
    vizCtx.lineTo(x, y);
  }
  vizCtx.strokeStyle = "rgba(0,255,140,0.55)";
  vizCtx.lineWidth = 3;
  vizCtx.shadowColor = "rgba(0,255,140,0.35)";
  vizCtx.shadowBlur = 12;
  vizCtx.stroke();

  // crisp line
  vizCtx.beginPath();
  vizCtx.moveTo(0, baseLine - vizData[0] * height * 0.5);
  for (let i = 1; i < vizData.length; i++) {
    const x = i * step;
    const y = baseLine - vizData[i] * height * 0.5;
    vizCtx.lineTo(x, y);
  }
  vizCtx.strokeStyle = "rgba(0,255,140,0.9)";
  vizCtx.lineWidth = 1.8;
  vizCtx.shadowBlur = 0;
  vizCtx.stroke();

  // phosphor dots
  vizCtx.fillStyle = "rgba(0,255,140,0.65)";
  for (let i = 0; i < vizData.length; i += 3) {
    const x = i * step;
    const y = baseLine - vizData[i] * height * 0.5;
    vizCtx.fillRect(x - 1, y - 1, 2.2, 2.2);
  }

  requestAnimationFrame(drawViz);
}

function bumpViz(token) {
  if (!vizData.length) return;
  const trimmed = (token || "").trim();
  const isA = trimmed.toLowerCase().startsWith("a");

  if (isA) {
    aTokenCount += 1;
    vizLeftEnergy = Math.min(1.5, vizLeftEnergy + Math.min(token.length, 10) / 10 + 0.2);
  }

  const energy = Math.min(1.5, 0.35 + Math.min(token.length, 10) / 10 + Math.random() * 0.6);
  vizData.push(energy);
  vizData.shift();
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
    updateStatus(statusText || "(idle)");
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
  if (statusText) updateStatus(statusText);
}

async function handleLoadModels() {
  renderConversation("_Status: Loading models..._");
  const base = (els.base?.value || "").replace(/\/+$/, "");
  if (!base) {
    renderConversation("_Status: No server selected._");
    updateStatus("No server selected");
    return;
  }
  try {
    const data = await fetchModels(base);
    populateModels(data);
    renderConversation("_Status: Models loaded._");
    updateStatus("Models loaded");
  } catch (e) {
    renderConversation(`_Status: ${String(e)}_`);
    updateStatus(`Error: ${String(e)}`);
  }
}

async function handleSend() {
  const base = (els.base.value || "").replace(/\/+$/, "");
  const prompt = (els.prompt.value || "").trim();
  if (!prompt) return;

  saveSystemPrompt();

  toggleBusy(true);
  abortController = new AbortController();
  streamStats = { start: performance.now(), chunks: 0, chars: 0, done: false };
  streamStopped = false;
  aTokenCount = 0;
  vizLeftEnergy = 0;

  const userMsg = { role: "user", content: prompt };
  const assistantMsg = { role: "assistant", content: "" };
  currentAssistantMsg = assistantMsg;
  conversation.push(userMsg, assistantMsg);
  if (els.prompt) els.prompt.value = "";
  renderConversation();
  lastPrompt = prompt;
  saveConversation();
  updateStatusFromStats();

  const systemMsg = (els.systemPrompt?.value || "").trim();
  const messages = [];
  if (systemMsg) messages.push({ role: "system", content: systemMsg });
  messages.push(...conversation.slice(0, -1));

  try {
    await streamChat({
      base,
      messages, // exclude the in-progress assistant message
      model: els.model.value,
      temperature: Number(els.temp.value),
      maxTokens: Number(els.max.value),
      signal: abortController.signal,
      onDelta: (delta) => {
        assistantMsg.content += delta;
        streamStats.chunks += 1;
        streamStats.chars += delta.length;
        renderConversation();
        saveConversation();
        updateStatusFromStats();
        bumpViz(delta);
      },
      onDone: () => {
        renderConversation();
        saveConversation();
        streamStats.done = true;
        updateStatusFromStats(true);
      }
    });
  } catch (e) {
    if (e.name === "AbortError") {
      assistantMsg.content = assistantMsg.content ? `${assistantMsg.content}\n\n[stopped]` : "[stopped]";
      renderConversation();
      saveConversation();
      updateStatus("Stopped");
    } else {
      assistantMsg.content = `Error: ${String(e)}`;
      renderConversation();
      saveConversation();
      updateStatus(`Error: ${String(e)}`);
    }
  } finally {
    toggleBusy(false);
    abortController = null;
    streamStats.done = true;
    currentAssistantMsg = null;
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

  els.send?.addEventListener("click", () => handleSend());
  els.stop?.addEventListener("click", () => {
    streamStopped = true;
    if (abortController) abortController.abort();
    updateStatus("Stopping...");
  });

  els.clear?.addEventListener("click", () => {
    if (els.prompt) els.prompt.value = "";
    conversation = [];
    lastPrompt = "";
    saveConversation();
    renderConversation("(cleared)");
  });

  els.retry?.addEventListener("click", () => {
    if (!lastPrompt) return;
    if (els.prompt) els.prompt.value = lastPrompt;
    handleSend();
  });

  els.clearHistory?.addEventListener("click", () => {
    conversation = [];
    lastPrompt = "";
    saveConversation();
    renderConversation("(history cleared)");
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

  els.systemPrompt?.addEventListener("input", () => {
    saveSystemPrompt();
    updateSystemPromptVisibility();
  });

  els.toggleSystemPrompt?.addEventListener("click", () => {
    systemPromptVisible = !systemPromptVisible;
    updateSystemPromptVisibility();
  });
}

function init() {
  populateServerSelect();
  applyGlow(glowIntensity);
  applyScanlines(scanlineOpacity);
  if (els.glowRange) els.glowRange.value = glowIntensity;
  if (els.scanlineRange) els.scanlineRange.value = scanlineOpacity;
  updateSystemPromptVisibility();
  wireEvents();
  setActiveServer(els.serverSelect?.value || servers[0]?.url, { loadModels: true });
  loadConversation();
  renderConversation();
  loadSystemPrompt();
  updateSystemPromptVisibility();
  resizeViz();
  if (!vizAnimating) {
    vizAnimating = true;
    requestAnimationFrame(drawViz);
  }
  window.addEventListener("resize", resizeViz);
}

init();
