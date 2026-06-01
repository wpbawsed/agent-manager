import { api } from "./auth";
import { API_BASE_URL } from "./config";

export interface PlaygroundMessage {
  role: "user" | "assistant";
  content: string;
}

export async function* runPlayground(
  agentId: string,
  message: string,
  history: PlaygroundMessage[],
): AsyncGenerator<string> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE_URL}/playground/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ agent_id: agentId, message, history }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) yield parsed.text;
        } catch {
          // skip malformed lines
        }
      }
    }
  }
}
