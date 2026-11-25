import { CapturedPacket } from '../types/capture';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

export function decodeUtf8Preview(bytes: Uint8Array, maxBytes = 65536): string {
  const slice = bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes;
  return utf8Decoder.decode(slice);
}

export function decodeChunkedBody(rawBody: string): { decoded: string; wasChunked: boolean } {
  // Parse Transfer-Encoding: chunked (<hex-size>[;ext]\r\n<chunk>\r\n...0\r\n\r\n)
  const chunks: string[] = [];
  let cursor = 0;
  let validChunks = 0;

  while (cursor < rawBody.length) {
    const lineEnd = rawBody.indexOf('\r\n', cursor);
    const lfEnd = rawBody.indexOf('\n', cursor);
    const endIdx = lineEnd !== -1 ? lineEnd : lfEnd;
    const eolLen = lineEnd !== -1 ? 2 : 1;
    if (endIdx === -1) break;

    const sizeLine = rawBody.slice(cursor, endIdx).split(';')[0].trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeLine)) {
      return { decoded: rawBody, wasChunked: false };
    }
    const chunkSize = parseInt(sizeLine, 16);
    cursor = endIdx + eolLen;
    if (chunkSize === 0) {
      validChunks += 1;
      break;
    }
    const chunkData = rawBody.slice(cursor, cursor + chunkSize);
    chunks.push(chunkData);
    validChunks += 1;
    cursor += chunkSize;
    if (rawBody.slice(cursor, cursor + 2) === '\r\n') cursor += 2;
    else if (rawBody[cursor] === '\n') cursor += 1;
  }

  if (validChunks > 0 && chunks.length > 0) {
    return { decoded: chunks.join(''), wasChunked: true };
  }
  return { decoded: rawBody, wasChunked: false };
}

export interface JsonTreeNode {
  key: string;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  value?: string | number | boolean | null;
  children?: JsonTreeNode[];
  itemCount?: number;
}

export function buildJsonTree(key: string, val: unknown): JsonTreeNode {
  if (val === null) {
    return { key, type: 'null', value: null };
  }
  if (Array.isArray(val)) {
    return {
      key,
      type: 'array',
      itemCount: val.length,
      children: val.map((item, idx) => buildJsonTree(`[${idx}]`, item)),
    };
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    return {
      key,
      type: 'object',
      itemCount: entries.length,
      children: entries.map(([k, v]) => buildJsonTree(k, v)),
    };
  }
  if (typeof val === 'number') return { key, type: 'number', value: val };
  if (typeof val === 'boolean') return { key, type: 'boolean', value: val };
  return { key, type: 'string', value: String(val) };
}

export function tryParseJsonVariants(text: string): {
  kind: 'json' | 'ndjson' | 'prefixed-json' | null;
  prefix?: string;
  parsed?: unknown;
  prettyText?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) return { kind: null };

  // 1. Standard JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return { kind: 'json', parsed, prettyText: JSON.stringify(parsed, null, 2) };
    } catch {
      // fall through to NDJSON check
    }
  }

  // 2. Prefixed JSON (anti-XSSI prefixes like )]}', while(1);, for(;;);)
  const xssiPrefixes = [")]}',", ")]}'", 'while(1);', 'for(;;);'];
  for (const pfx of xssiPrefixes) {
    if (trimmed.startsWith(pfx)) {
      const rest = trimmed.slice(pfx.length).trim();
      try {
        const parsed = JSON.parse(rest);
        return {
          kind: 'prefixed-json',
          prefix: pfx,
          parsed,
          prettyText: JSON.stringify(parsed, null, 2),
        };
      } catch {
        // continue
      }
    }
  }

  // 3. NDJSON (newline-delimited JSON objects/arrays)
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => l.startsWith('{') || l.startsWith('['))) {
    try {
      const items = lines.map((l) => JSON.parse(l));
      return {
        kind: 'ndjson',
        parsed: items,
        prettyText: JSON.stringify(items, null, 2),
      };
    } catch {
      // not valid NDJSON
    }
  }

  return { kind: null };
}

const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function beautifyHtml(html: string): string {
  const tokens = html
    .replace(/>\s+</g, '><')
    .replace(/</g, '\n<')
    .replace(/>/g, '>\n')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  const lines: string[] = [];
  let indent = 0;

  for (const tok of tokens) {
    if (tok.startsWith('</')) {
      indent = Math.max(0, indent - 1);
      lines.push(`${'  '.repeat(indent)}${tok}`);
    } else if (tok.startsWith('<!') || tok.startsWith('<?')) {
      lines.push(`${'  '.repeat(indent)}${tok}`);
    } else if (tok.startsWith('<')) {
      const tagMatch = tok.match(/^<([a-zA-Z0-9-]+)/);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
      const selfClosing = tok.endsWith('/>') || VOID_HTML_TAGS.has(tagName);
      lines.push(`${'  '.repeat(indent)}${tok}`);
      if (!selfClosing) indent += 1;
    } else {
      lines.push(`${'  '.repeat(indent)}${tok}`);
    }
  }
  return lines.join('\n');
}

export interface BeautifiedBodyResult {
  mode: 'encrypted' | 'json' | 'html' | 'plaintext' | 'empty';
  jsonSubtype?: 'json' | 'ndjson' | 'prefixed-json';
  jsonPrefix?: string;
  jsonTree?: JsonTreeNode;
  formattedText: string;
  rawBodyText: string;
  wasChunkedDecoded: boolean;
  strippedHttpHeaders: boolean;
  detectedContentType: string;
  ciphertextBase64?: string;
  ciphertextHex?: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const limit = Math.min(bytes.length, 16384);
  for (let i = 0; i < limit; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function analyzeRawResponseBody(packet: CapturedPacket): BeautifiedBodyResult {
  const payload = packet.rawBytes.subarray(packet.payloadOffset);

  if (payload.length === 0) {
    return {
      mode: 'empty',
      formattedText: '',
      rawBodyText: '',
      wasChunkedDecoded: false,
      strippedHttpHeaders: false,
      detectedContentType: 'Empty (0 bytes)',
    };
  }

  // Strict Cryptographic Honesty: never label encrypted HTTPS/TLS/QUIC ciphertext as decrypted
  if (
    packet.protocol === 'HTTPS' ||
    packet.protocol === 'TLS' ||
    packet.protocol === 'QUIC' ||
    packet.tls?.isEncryptedPayload ||
    packet.quic?.isEncryptedPayload
  ) {
    let hex = '';
    const slice = payload.subarray(0, Math.min(payload.length, 512));
    for (let i = 0; i < slice.length; i++) {
      hex += slice[i].toString(16).padStart(2, '0') + (i % 16 === 15 ? '\n' : ' ');
    }
    return {
      mode: 'encrypted',
      formattedText: hex.trim(),
      rawBodyText: decodeUtf8Preview(payload, 2048),
      wasChunkedDecoded: false,
      strippedHttpHeaders: false,
      detectedContentType: packet.quic ? 'QUIC Protected Frame' : 'TLS Wire Record / Ciphertext',
      ciphertextBase64: bytesToBase64(payload),
      ciphertextHex: hex.trim(),
    };
  }

  let bodySlice = payload;
  let strippedHttpHeaders = false;
  let wasChunkedDecoded = false;
  let headerContentType = '';

  if (packet.http) {
    strippedHttpHeaders = true;
    headerContentType = packet.http.headers['content-type'] || '';
    if (packet.http.bodyOffset < payload.length) {
      bodySlice = payload.subarray(packet.http.bodyOffset);
    } else {
      bodySlice = new Uint8Array(0);
    }
  }

  if (bodySlice.length === 0) {
    return {
      mode: 'empty',
      formattedText: '',
      rawBodyText: '',
      wasChunkedDecoded: false,
      strippedHttpHeaders,
      detectedContentType: headerContentType || 'HTTP Headers Only (No Body)',
    };
  }

  let rawBodyText = decodeUtf8Preview(bodySlice);
  if (packet.http?.isChunked) {
    const chunkRes = decodeChunkedBody(rawBodyText);
    rawBodyText = chunkRes.decoded;
    wasChunkedDecoded = chunkRes.wasChunked;
  }

  // Check JSON (standard, NDJSON, prefixed JSON)
  const jsonTry = tryParseJsonVariants(rawBodyText);
  if (jsonTry.kind && jsonTry.prettyText) {
    return {
      mode: 'json',
      jsonSubtype: jsonTry.kind,
      jsonPrefix: jsonTry.prefix,
      jsonTree: buildJsonTree(jsonTry.kind === 'ndjson' ? 'ndjson_records' : 'root', jsonTry.parsed),
      formattedText: jsonTry.prettyText,
      rawBodyText,
      wasChunkedDecoded,
      strippedHttpHeaders,
      detectedContentType:
        jsonTry.kind === 'ndjson'
          ? 'application/x-ndjson'
          : jsonTry.kind === 'prefixed-json'
            ? 'application/json (Prefixed)'
            : headerContentType || 'application/json',
    };
  }

  // Check HTML (full document or fragments)
  const trimmed = rawBodyText.trim();
  const looksHtml =
    headerContentType.toLowerCase().includes('text/html') ||
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<(html|head|body|div|section|article|main|table|ul|p|h[1-6]|script|style|span)\b/i.test(trimmed);

  if (looksHtml) {
    return {
      mode: 'html',
      formattedText: beautifyHtml(rawBodyText),
      rawBodyText,
      wasChunkedDecoded,
      strippedHttpHeaders,
      detectedContentType: headerContentType || 'text/html',
    };
  }

  return {
    mode: 'plaintext',
    formattedText: rawBodyText,
    rawBodyText,
    wasChunkedDecoded,
    strippedHttpHeaders,
    detectedContentType: headerContentType || 'text/plain; charset=utf-8',
  };
}
