// Text-only protocol adapters, based on CLIProxyAPI's MIT Antigravity/Devin executors.
import { Fault } from "./core";
import { boundedText } from "./chatgpt";
const utf8 = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
function varint(n: number) {
  const out = [];
  do {
    out.push((n % 128) | (n >= 128 ? 128 : 0));
    n = Math.floor(n / 128);
  } while (n);
  return new Uint8Array(out);
}
const numberField = (id: number, n: number) =>
  concat(varint(id * 8), varint(n));
const bytesField = (id: number, value: string | Uint8Array) => {
  const b = typeof value === "string" ? utf8.encode(value) : value;
  return concat(varint(id * 8 + 2), varint(b.length), b);
};
async function fingerprint(seed: string) {
  let result = "";
  for (let i = 0; result.length < 732; i++) {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      utf8.encode(`${seed}-${i}`),
    );
    result += Array.from(new Uint8Array(hash), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
  }
  return result.slice(0, 732);
}
export async function devinRequest(
  token: string,
  id: string,
  model: string,
  system: string,
  prompt: string,
) {
  const metadata = concat(
    bytesField(1, "devin-cli"),
    bytesField(2, "3000.10.21"),
    bytesField(3, token),
    bytesField(4, "en"),
    bytesField(5, "browser"),
    bytesField(7, "3000.10.21"),
    bytesField(12, "chisel"),
    bytesField(28, "chisel"),
    bytesField(31, await fingerprint(id)),
  );
  const session = crypto.randomUUID();
  const body = concat(
    bytesField(1, metadata),
    bytesField(2, system),
    bytesField(
      3,
      concat(
        bytesField(1, crypto.randomUUID()),
        numberField(2, 1),
        bytesField(3, prompt),
      ),
    ),
    numberField(7, 5),
    bytesField(
      8,
      concat(
        numberField(1, 1),
        numberField(2, 16000),
        numberField(3, 400),
        numberField(7, 40),
      ),
    ),
    bytesField(
      15,
      concat(bytesField(1, session), numberField(3, 4), numberField(4, 14)),
    ),
    bytesField(16, session),
    numberField(20, 1),
    bytesField(21, model),
  );
  const framed = new Uint8Array(body.length + 5);
  new DataView(framed.buffer).setUint32(1, body.length);
  framed.set(body, 5);
  return framed;
}
export function devinText(payload: Uint8Array) {
  let offset = 0,
    text = "";
  function read() {
    let n = 0,
      power = 1;
    for (let i = 0; i < 10; i++) {
      if (offset >= payload.length) throw new Error("Truncated protobuf.");
      const b = payload[offset++];
      n += (b & 127) * power;
      if (!(b & 128)) {
        if (!Number.isSafeInteger(n))
          throw new Error("Oversized protobuf integer.");
        return n;
      }
      power *= 128;
    }
    throw new Error("Invalid protobuf integer.");
  }
  while (offset < payload.length) {
    const tag = read(),
      id = Math.floor(tag / 8),
      wire = tag % 8;
    if (wire === 0) read();
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const size = read();
      if (size > payload.length - offset)
        throw new Error("Truncated protobuf field.");
      if (id === 3)
        text += decode.decode(payload.subarray(offset, offset + size));
      offset += size;
    } else throw new Error("Unsupported protobuf wire type.");
    if (offset > payload.length) throw new Error("Truncated protobuf.");
  }
  return text;
}
async function readBytes(response: Response, limit = 2000000) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Response too large.");
      chunks.push(value);
    }
    return concat(...chunks);
  } finally {
    void reader.cancel().catch(() => {});
  }
}
export async function decodeDevin(response: Response) {
  const bytes = await readBytes(response);
  let decodedBytes = 0;
  let offset = 0,
    text = "",
    ended = false;
  while (offset < bytes.length) {
    if (ended || bytes.length - offset < 5)
      throw new Error("Invalid Connect stream.");
    const flags = bytes[offset],
      size = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset + 1,
        4,
      ).getUint32(0);
    offset += 5;
    if (size > bytes.length - offset || flags > 3)
      throw new Error("Invalid Connect frame.");
    let frame = bytes.subarray(offset, offset + size);
    offset += size;
    if (flags & 1) {
      const blob = new Blob([new Uint8Array(frame)]);
      frame = await readBytes(
        new Response(
          blob.stream().pipeThrough(new DecompressionStream("gzip")),
        ),
      );
    }
    decodedBytes += frame.length;
    if (decodedBytes > 2000000) throw new Error("Decoded stream too large.");
    if (flags & 2) {
      const trailer = JSON.parse(decode.decode(frame));
      if (trailer.error)
        throw new Fault("invalid_response", "Devin returned a terminal error.");
      ended = true;
    } else {
      text += devinText(frame);
      if (text.length > 250000) throw new Error("Output too large.");
    }
  }
  if (!ended) throw new Error("Incomplete Connect stream.");
  return JSON.parse(text);
}
export async function nativeInference(
  provider: "devin" | "antigravity",
  token: string,
  id: string,
  model: string,
  system: string,
  prompt: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  if (provider === "devin") {
    const response = await fetcher(
      "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage",
      {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Basic ${token}-${token}`,
          "Content-Type": "application/connect+proto",
          "Connect-Protocol-Version": "1",
        },
        body: new Uint8Array(
          await devinRequest(token, id, model, system, prompt),
        ),
      },
    );
    if (!response.ok)
      throw new Fault(
        "network_error",
        `Devin returned HTTP ${response.status}.`,
      );
    return decodeDevin(response);
  }
  const base = "https://cloudcode-pa.googleapis.com",
    headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  const load = await fetcher(base + "/v1internal:loadCodeAssist", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal,
    headers,
    body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
  });
  if (!load.ok)
    throw new Fault(
      "authentication_failed",
      `Antigravity account lookup returned HTTP ${load.status}.`,
    );
  const account = JSON.parse(await boundedText(load));
  const project =
    typeof account.cloudaicompanionProject === "string"
      ? account.cloudaicompanionProject
      : account.cloudaicompanionProject?.id;
  if (typeof project !== "string" || !project)
    throw new Fault(
      "configuration_required",
      "Complete Antigravity account onboarding with Google before using this connection.",
    );
  const response = await fetcher(base + "/v1internal:generateContent", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal,
    headers,
    body: JSON.stringify({
      project,
      model,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: crypto.randomUUID(),
      request: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 16000 },
      },
    }),
  });
  if (!response.ok)
    throw new Fault(
      "network_error",
      `Antigravity returned HTTP ${response.status}.`,
    );
  const value = JSON.parse(await boundedText(response));
  const candidate = (value.response ?? value).candidates?.[0];
  if (!candidate || candidate.finishReason !== "STOP")
    throw new Fault(
      "invalid_response",
      "Antigravity did not finish the response.",
    );
  return JSON.parse(
    candidate.content.parts
      .filter((p: any) => !p.thought && typeof p.text === "string")
      .map((p: any) => p.text)
      .join(""),
  );
}
