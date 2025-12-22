const trimBase = (base) => (base || "").replace(/\/+$/, "");

export async function fetchModels(base) {
  const cleanBase = trimBase(base);
  const res = await fetch(`${cleanBase}/v1/models`);
  if (!res.ok) throw new Error(`Models failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data?.data || [];
}

export async function streamChat({ base, prompt, model, temperature, maxTokens, onDelta, onDone, signal }) {
  const cleanBase = trimBase(base);

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: maxTokens,
    stream: true
  };

  const res = await fetch(`${cleanBase}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Request failed: ${res.status} ${errText}`);
  }
  if (!res.body) throw new Error("No response body (streaming not supported by this browser/endpoint).");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") {
          onDone?.();
          return;
        }

        let evt;
        try { evt = JSON.parse(dataStr); } catch { continue; }

        const delta = evt?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) {
          onDelta?.(delta);
        }
      }
    }
  }

  onDone?.();
}
