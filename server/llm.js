// OpenRouter: one key for the chat model (LLM_MODEL) and the embedding model (EMBED_MODEL).
const API = 'https://openrouter.ai/api/v1';

async function post(path, body, signal) {
  const send = () => fetch(API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  let res = await send();
  // One short wait covers a brief rate-limit burst during a tool-call round.
  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    res = await send();
  }
  if (!res.ok) throw new Error(`OpenRouter ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

// Lines starting with ":" are OpenRouter keep-alive comments and are skipped.
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

// Streams one assistant message. Text deltas go to onText as they arrive.
export async function streamChat({ messages, tools, signal, onText }) {
  const res = await post('/chat/completions', {
    model: process.env.LLM_MODEL,
    messages,
    tools,
    tool_choice: 'auto',
    stream: true,
    temperature: 0.4,
    max_tokens: 400,
  }, signal);

  let content = '';
  const toolCalls = [];
  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') break;
    const chunk = JSON.parse(data);
    // After the 200 is sent, a provider failure arrives as an `error` chunk instead of an HTTP status.
    if (chunk.error) throw new Error(`OpenRouter stream: ${chunk.error.message}`);
    const delta = chunk.choices?.[0]?.delta ?? {};
    if (delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const call = toolCalls[part.index ?? toolCalls.length] ??= { id: part.id, type: 'function', function: { name: '', arguments: '' } };
      call.id = part.id ?? call.id;
      call.function.name += part.function?.name ?? '';
      call.function.arguments += part.function?.arguments ?? '';
    }
  }
  return { content, toolCalls: toolCalls.filter(Boolean) };
}

export async function chatJson(messages) {
  const res = await post('/chat/completions', {
    model: process.env.LLM_MODEL,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 800,
  });
  return JSON.parse((await res.json()).choices[0].message.content);
}

export async function embed(texts) {
  const res = await post('/embeddings', { model: process.env.EMBED_MODEL, input: texts });
  const { data } = await res.json();
  return data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
