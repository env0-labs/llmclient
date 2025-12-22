# Ewan’s LLM Client

A lightweight, browser-based web client for interacting with **local LLM servers** (e.g. LM Studio) using an OpenAI-compatible API.

This project exists to explore:

- local vs cloud LLM workflows  
- small and large model behaviour  
- streaming output  
- model personality differences  
- narrative and game-adjacent ideas  

Right now, it’s intentionally simple.

---

## What This Is

- A **pure HTML / CSS / JavaScript** web app  
- No backend  
- No framework  
- No build step  
- Runs entirely in the browser  
- Talks directly to a local LLM server over HTTP  

Designed for experimentation, not production deployment.

---

## Features (Current)

- Connects to OpenAI-compatible endpoints (tested with **LM Studio**)  
- Server selection via **nicknames** (IP/URL hidden from UI)  
- Servers stored in `localStorage`  
- Model discovery via `/v1/models`  
- Streaming chat completions  
- Adjustable temperature and max tokens  
- Markdown rendering  
- CRT-inspired terminal aesthetic  
- Abort/stop streaming mid-response  

---

## Requirements

- A local LLM server exposing an OpenAI-style API  
  Example: **LM Studio** with:
  - Server enabled  
  - CORS headers enabled  
  - Bound to `0.0.0.0` or your LAN IP if accessing remotely  

- A modern browser (Chrome, Firefox, Edge)

---

## Running the Client

Because of streaming and fetch behaviour, **do not use `file://`**.

Serve it over HTTP instead.

### Option 1: Python (simple)

```
python3 -m http.server 8080
```

Then open:

```
http://localhost:8080
```

### Option 2: VS Code Live Server

- Install the **Live Server** extension  
- Right-click `index.html` → **Open with Live Server**

---

## Server Configuration

- Servers are identified by **nickname only** in the UI  
- URLs are stored internally and in `localStorage`  
- Default server (if nothing stored):

```
Nickname: bitfuser
URL: http://192.168.1.129:1234
```

You can add and remove servers from the UI.  
Nothing is persisted beyond your browser.

---

## Known Limitations (By Design)

- No authentication  
- No HTTPS support (intentionally local-only)  
- No conversation history (single prompt per request)  
- No prompt templating or system messages  
- No safeguards against hallucination or nonsense  
- No advanced error recovery  

This is an exploration tool, not a guardrail.

---

## Why This Exists

Partly technical curiosity.  
Partly interest in how **trust**, **authority**, and **tone** emerge from models.  
Partly groundwork for future narrative or terminal-based projects.

Local models behave *differently* from cloud models.  
Small models behave *very* differently from large ones.  

This client exists to make that visible.

---

## Status

**Early / exploratory**

Expect:

- breaking changes  
- refactors  
- experiments that get removed  
- features added, then deleted  

Stability is not a goal yet.

---

## License

Unlicensed for now.  
Use, fork, break, experiment.
