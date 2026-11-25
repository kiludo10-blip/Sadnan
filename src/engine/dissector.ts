import {
  CapturedPacket,
  DnsMeta,
  FirewallRule,
  FriendlyAppId,
  HttpMeta,
  KeylogEntry,
  ProtocolType,
  QuicMeta,
  TcpMeta,
  TlsMeta,
  TrafficDirection,
  UdpMeta,
} from '../types/capture';
import { detectThreatAlerts, evaluateFirewall, lookupEnrichment } from './enrichment';

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const textEncoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array, maxLen = bytes.length): string {
  const limit = Math.min(bytes.length, maxLen);
  let out = '';
  for (let i = 0; i < limit; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function parseSslKeylogFile(content: string): KeylogEntry[] {
  const entries: KeylogEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 3 && /^[0-9a-fA-F]{64}$/.test(parts[1]) && /^[0-9a-fA-F]{32,}$/.test(parts[2])) {
      entries.push({
        label: parts[0],
        clientRandom: parts[1].toLowerCase(),
        secretHex: parts[2].toLowerCase(),
      });
    }
  }
  return entries;
}

function formatIpv4(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

function formatIpv6(bytes: Uint8Array, offset: number): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[offset + i] << 8) | bytes[offset + i + 1]).toString(16));
  }
  return groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
}

function parseIpv4Bytes(ip: string): Uint8Array {
  const parts = ip.split('.').map((n) => Number(n) & 0xff);
  if (parts.length !== 4) return new Uint8Array([10, 0, 0, 2]);
  return new Uint8Array(parts);
}

function parseIpv6Bytes(ip: string): Uint8Array {
  const out = new Uint8Array(16);
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = Math.max(0, 8 - left.length - right.length);
  const full = [...left, ...Array(missing).fill('0'), ...right].slice(0, 8);
  for (let i = 0; i < full.length; i++) {
    const val = parseInt(full[i] || '0', 16) || 0;
    out[i * 2] = (val >> 8) & 0xff;
    out[i * 2 + 1] = val & 0xff;
  }
  return out;
}

function parseDnsName(bytes: Uint8Array, offset: number): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let ptr = offset;
  let jumped = false;
  let endOffset = offset;
  let guard = 0;
  while (ptr < bytes.length && guard++ < 64) {
    const len = bytes[ptr];
    if (len === 0) {
      if (!jumped) endOffset = ptr + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0 && ptr + 1 < bytes.length) {
      if (!jumped) endOffset = ptr + 2;
      const target = ((len & 0x3f) << 8) | bytes[ptr + 1];
      ptr = target;
      jumped = true;
      continue;
    }
    ptr += 1;
    if (ptr + len > bytes.length) break;
    labels.push(textDecoder.decode(bytes.subarray(ptr, ptr + len)));
    ptr += len;
    if (!jumped) endOffset = ptr;
  }
  return { name: labels.join('.') || '.', nextOffset: endOffset };
}

function parseDnsPayload(payload: Uint8Array): DnsMeta | undefined {
  if (payload.length < 12) return undefined;
  const txId = ((payload[0] << 8) | payload[1]).toString(16).padStart(4, '0');
  const flags = (payload[2] << 8) | payload[3];
  const isResponse = (flags & 0x8000) !== 0;
  const rcodeNum = flags & 0x0f;
  const rcodeNames: Record<number, string> = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 5: 'REFUSED' };
  const qdCount = (payload[4] << 8) | payload[5];
  const anCount = (payload[6] << 8) | payload[7];

  let offset = 12;
  let queryName = 'unknown';
  let queryType = 'A';
  if (qdCount > 0 && offset < payload.length) {
    const parsed = parseDnsName(payload, offset);
    queryName = parsed.name;
    offset = parsed.nextOffset;
    if (offset + 4 <= payload.length) {
      const qtype = (payload[offset] << 8) | payload[offset + 1];
      const qtypes: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 15: 'MX', 16: 'TXT', 28: 'AAAA', 65: 'HTTPS' };
      queryType = qtypes[qtype] || `TYPE${qtype}`;
      offset += 4;
    }
  }

  const answers: string[] = [];
  for (let i = 0; i < Math.min(anCount, 6) && offset + 12 <= payload.length; i++) {
    const ansName = parseDnsName(payload, offset);
    offset = ansName.nextOffset;
    if (offset + 10 > payload.length) break;
    const atype = (payload[offset] << 8) | payload[offset + 1];
    const rdlen = (payload[offset + 8] << 8) | payload[offset + 9];
    offset += 10;
    if (offset + rdlen > payload.length) break;
    if (atype === 1 && rdlen === 4) {
      answers.push(`${formatIpv4(payload, offset)}`);
    } else if (atype === 28 && rdlen === 16) {
      answers.push(`${formatIpv6(payload, offset)}`);
    } else if (atype === 5) {
      answers.push(`CNAME ${parseDnsName(payload, offset).name}`);
    } else {
      answers.push(`${rdlen}B RDATA`);
    }
    offset += rdlen;
  }

  return {
    transactionId: `0x${txId}`,
    isResponse,
    queryName,
    queryType,
    rcode: rcodeNames[rcodeNum] || `RCODE_${rcodeNum}`,
    answers,
  };
}

function parseHttpPayload(payload: Uint8Array): HttpMeta | undefined {
  if (payload.length < 12) return undefined;
  const preview = textDecoder.decode(payload.subarray(0, Math.min(payload.length, 4096)));
  const isReq = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+\s+HTTP\/\d\.\d\r?\n/.test(preview);
  const isRes = /^HTTP\/\d\.\d\s+\d{3}/.test(preview);
  if (!isReq && !isRes) return undefined;

  const headerEndCrlf = preview.indexOf('\r\n\r\n');
  const headerEndLf = preview.indexOf('\n\n');
  const sepIdx = headerEndCrlf !== -1 ? headerEndCrlf : headerEndLf;
  const sepLen = headerEndCrlf !== -1 ? 4 : 2;
  const headerBlock = sepIdx !== -1 ? preview.slice(0, sepIdx) : preview;
  const lines = headerBlock.split(/\r?\n/);
  const startLine = lines[0] || '';
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon > 0) {
      headers[lines[i].slice(0, colon).trim().toLowerCase()] = lines[i].slice(colon + 1).trim();
    }
  }
  const bodyOffset = sepIdx !== -1 ? textEncoder.encode(preview.slice(0, sepIdx + sepLen)).length : payload.length;
  const isChunked = (headers['transfer-encoding'] || '').toLowerCase().includes('chunked');

  if (isReq) {
    const [method, path, version] = startLine.split(' ');
    return { isRequest: true, method, path, version: version || 'HTTP/1.1', headers, bodyOffset, isChunked };
  }
  const parts = startLine.split(' ');
  const version = parts[0] || 'HTTP/1.1';
  const statusCode = parseInt(parts[1] || '200', 10);
  const statusText = parts.slice(2).join(' ');
  return { isRequest: false, statusCode, statusText, version, headers, bodyOffset, isChunked };
}

function parseTlsPayload(payload: Uint8Array, keylogEntries: KeylogEntry[]): TlsMeta | undefined {
  if (payload.length < 5) return undefined;
  const contentType = payload[0];
  if (contentType < 20 || contentType > 23) return undefined;
  const verMajor = payload[1];
  const verMinor = payload[2];
  if (verMajor !== 3 || verMinor > 4) return undefined;

  const recTypes: Record<number, string> = {
    20: 'ChangeCipherSpec',
    21: 'Alert',
    22: 'Handshake',
    23: 'Application Data',
  };
  const verMap: Record<number, string> = {
    0: 'SSL 3.0',
    1: 'TLS 1.0',
    2: 'TLS 1.1',
    3: 'TLS 1.2',
    4: 'TLS 1.3',
  };
  const recordType = recTypes[contentType] || `Type(${contentType})`;
  const recordVersion = verMap[verMinor] || `TLS 1.${verMinor}`;

  if (contentType === 23) {
    return {
      recordType,
      recordVersion,
      isEncryptedPayload: true,
    };
  }

  if (contentType !== 22 || payload.length < 9) {
    return {
      recordType,
      recordVersion,
      isEncryptedPayload: false,
    };
  }

  const hsType = payload[5];
  const hsNames: Record<number, string> = {
    1: 'ClientHello',
    2: 'ServerHello',
    11: 'Certificate',
    16: 'ClientKeyExchange',
  };
  const handshakeType = hsNames[hsType] || `Handshake(${hsType})`;

  let clientRandom: string | undefined;
  let sni: string | undefined;
  let alpn: string[] | undefined;
  let cipherCount: number | undefined;
  let certificateCn: string | undefined;
  let certificateOrg: string | undefined;

  if ((hsType === 1 || hsType === 2) && payload.length >= 43) {
    // Bytes 9..10: client/server version, Bytes 11..42: 32-byte Random
    clientRandom = bytesToHex(payload.subarray(11, 43));
    let ptr = 43;
    if (ptr < payload.length) {
      const sessLen = payload[ptr];
      ptr += 1 + sessLen;
    }
    if (hsType === 1 && ptr + 2 <= payload.length) {
      const cipherLen = (payload[ptr] << 8) | payload[ptr + 1];
      cipherCount = Math.floor(cipherLen / 2);
      ptr += 2 + cipherLen;
      if (ptr < payload.length) {
        const compLen = payload[ptr];
        ptr += 1 + compLen;
      }
      if (ptr + 2 <= payload.length) {
        const extTotalLen = (payload[ptr] << 8) | payload[ptr + 1];
        ptr += 2;
        const extEnd = Math.min(payload.length, ptr + extTotalLen);
        while (ptr + 4 <= extEnd) {
          const extType = (payload[ptr] << 8) | payload[ptr + 1];
          const extLen = (payload[ptr + 2] << 8) | payload[ptr + 3];
          ptr += 4;
          if (ptr + extLen > extEnd) break;
          if (extType === 0x0000 && extLen >= 5) {
            const nameLen = (payload[ptr + 3] << 8) | payload[ptr + 4];
            if (ptr + 5 + nameLen <= extEnd) {
              sni = textDecoder.decode(payload.subarray(ptr + 5, ptr + 5 + nameLen));
            }
          } else if (extType === 0x0010 && extLen >= 3) {
            const listLen = (payload[ptr] << 8) | payload[ptr + 1];
            let ap = ptr + 2;
            const aEnd = Math.min(ptr + 2 + listLen, ptr + extLen);
            const protos: string[] = [];
            while (ap < aEnd) {
              const pLen = payload[ap];
              ap += 1;
              if (ap + pLen <= aEnd) {
                protos.push(textDecoder.decode(payload.subarray(ap, ap + pLen)));
              }
              ap += pLen;
            }
            if (protos.length > 0) alpn = protos;
          }
          ptr += extLen;
        }
      }
    }
  } else if (hsType === 11) {
    // Parse observable CN= and O= strings if present in plaintext DER/X.509 chunk
    const ascii = textDecoder.decode(payload.subarray(5));
    const cnMatch = ascii.match(/CN=([A-Za-z0-9.*_-]+)/);
    const oMatch = ascii.match(/O=([A-Za-z0-9 .,_&-]+)/);
    if (cnMatch) certificateCn = cnMatch[1];
    if (oMatch) certificateOrg = oMatch[1];
  }

  const matchedKey = clientRandom
    ? keylogEntries.find((k) => k.clientRandom === clientRandom)
    : undefined;

  return {
    recordType,
    recordVersion,
    handshakeType,
    sni,
    alpn,
    cipherCount,
    clientRandom,
    certificateCn,
    certificateOrg,
    matchedKeylogSecret: matchedKey?.secretHex,
    isEncryptedPayload: false,
  };
}

function parseQuicPayload(payload: Uint8Array, dstPort: number, srcPort: number): QuicMeta | undefined {
  if (payload.length < 16) return undefined;
  const first = payload[0];
  const isLongHeader = (first & 0x80) !== 0;
  // QUIC Long Header (RFC 9000): fixed bit 0x40 usually set, version bytes 1..4
  if (isLongHeader && (first & 0x40) !== 0) {
    const versionNum =
      ((payload[1] << 24) >>> 0) + (payload[2] << 16) + (payload[3] << 8) + payload[4];
    const typeBits = (first & 0x30) >> 4;
    const typeNames = ['Initial', '0-RTT', 'Handshake', 'Retry'];
    const dcidLen = payload[5];
    if (6 + dcidLen < payload.length) {
      const dcid = bytesToHex(payload.subarray(6, 6 + dcidLen));
      const scidLenIdx = 6 + dcidLen;
      const scidLen = payload[scidLenIdx];
      const scid =
        scidLenIdx + 1 + scidLen <= payload.length
          ? bytesToHex(payload.subarray(scidLenIdx + 1, scidLenIdx + 1 + scidLen))
          : '';
      const versionHex = `0x${versionNum.toString(16).padStart(8, '0')}`;
      return {
        headerForm: 'Long',
        packetType: typeNames[typeBits] || 'Initial',
        version: versionNum === 1 ? 'QUIC v1 (0x00000001)' : versionHex,
        dcid: dcid || '(empty)',
        scid: scid || '(empty)',
        isEncryptedPayload: true,
      };
    }
  }
  if ((dstPort === 443 || srcPort === 443) && (first & 0x40) !== 0 && !isLongHeader) {
    return {
      headerForm: 'Short',
      packetType: '1-RTT Protected',
      version: 'QUIC v1',
      dcid: bytesToHex(payload.subarray(1, Math.min(9, payload.length))),
      scid: '-',
      isEncryptedPayload: true,
    };
  }
  return undefined;
}

export interface DissectOptions {
  sequence: number;
  timestampNs?: string;
  timestampMs?: number;
  appId: FriendlyAppId;
  appName: string;
  direction: TrafficDirection;
  keylogEntries?: KeylogEntry[];
  firewallRules?: FirewallRule[];
  sourceOrigin: 'LOCAL_SANDBOX' | 'SERVER_PROBE' | 'PCAP_IMPORT';
  forceProtocolHint?: ProtocolType;
}

export function dissectRawIpPacket(rawBytes: Uint8Array, opts: DissectOptions): CapturedPacket | null {
  if (rawBytes.length < 20) return null;
  const version = (rawBytes[0] >> 4) & 0x0f;
  if (version !== 4 && version !== 6) return null;

  let srcIp = '';
  let dstIp = '';
  let nextProto = 0;
  let l4Offset = 0;

  if (version === 4) {
    const ihl = (rawBytes[0] & 0x0f) * 4;
    if (ihl < 20 || rawBytes.length < ihl) return null;
    nextProto = rawBytes[9];
    srcIp = formatIpv4(rawBytes, 12);
    dstIp = formatIpv4(rawBytes, 16);
    l4Offset = ihl;
  } else {
    if (rawBytes.length < 40) return null;
    nextProto = rawBytes[6];
    srcIp = formatIpv6(rawBytes, 8);
    dstIp = formatIpv6(rawBytes, 24);
    l4Offset = 40;
  }

  let transportProtocol: 'TCP' | 'UDP' | 'ICMP' | 'ICMPv6' = 'TCP';
  let protocol: ProtocolType = 'TCP';
  let srcPort = 0;
  let dstPort = 0;
  let payloadOffset = l4Offset;
  let tcp: TcpMeta | undefined;
  let udp: UdpMeta | undefined;

  if (nextProto === 6 && rawBytes.length >= l4Offset + 20) {
    transportProtocol = 'TCP';
    protocol = 'TCP';
    srcPort = (rawBytes[l4Offset] << 8) | rawBytes[l4Offset + 1];
    dstPort = (rawBytes[l4Offset + 2] << 8) | rawBytes[l4Offset + 3];
    const seq =
      ((rawBytes[l4Offset + 4] << 24) >>> 0) +
      (rawBytes[l4Offset + 5] << 16) +
      (rawBytes[l4Offset + 6] << 8) +
      rawBytes[l4Offset + 7];
    const ack =
      ((rawBytes[l4Offset + 8] << 24) >>> 0) +
      (rawBytes[l4Offset + 9] << 16) +
      (rawBytes[l4Offset + 10] << 8) +
      rawBytes[l4Offset + 11];
    const dataOffset = ((rawBytes[l4Offset + 12] >> 4) & 0x0f) * 4;
    const flagByte = rawBytes[l4Offset + 13];
    const windowSize = (rawBytes[l4Offset + 14] << 8) | rawBytes[l4Offset + 15];
    const flags = {
      FIN: (flagByte & 0x01) !== 0,
      SYN: (flagByte & 0x02) !== 0,
      RST: (flagByte & 0x04) !== 0,
      PSH: (flagByte & 0x08) !== 0,
      ACK: (flagByte & 0x10) !== 0,
      URG: (flagByte & 0x20) !== 0,
    };
    const activeFlags = Object.entries(flags)
      .filter(([, v]) => v)
      .map(([k]) => k);
    tcp = {
      seq,
      ack,
      windowSize,
      flags,
      flagString: activeFlags.join(' ') || 'NONE',
    };
    payloadOffset = Math.min(rawBytes.length, l4Offset + Math.max(20, dataOffset));
  } else if (nextProto === 17 && rawBytes.length >= l4Offset + 8) {
    transportProtocol = 'UDP';
    protocol = 'UDP';
    srcPort = (rawBytes[l4Offset] << 8) | rawBytes[l4Offset + 1];
    dstPort = (rawBytes[l4Offset + 2] << 8) | rawBytes[l4Offset + 3];
    const udpLen = (rawBytes[l4Offset + 4] << 8) | rawBytes[l4Offset + 5];
    const csum = ((rawBytes[l4Offset + 6] << 8) | rawBytes[l4Offset + 7]).toString(16).padStart(4, '0');
    udp = { length: udpLen, checksum: `0x${csum}` };
    payloadOffset = l4Offset + 8;
  } else if (nextProto === 1) {
    transportProtocol = 'ICMP';
    protocol = 'ICMP';
    payloadOffset = Math.min(rawBytes.length, l4Offset + 8);
  } else if (nextProto === 58) {
    transportProtocol = 'ICMPv6';
    protocol = 'ICMPv6';
    payloadOffset = Math.min(rawBytes.length, l4Offset + 8);
  }

  const payload = rawBytes.subarray(payloadOffset);
  let dns: DnsMeta | undefined;
  let http: HttpMeta | undefined;
  let tls: TlsMeta | undefined;
  let quic: QuicMeta | undefined;

  const keylogs = opts.keylogEntries || [];

  if (transportProtocol === 'UDP') {
    if ((srcPort === 53 || dstPort === 53) && payload.length >= 12) {
      dns = parseDnsPayload(payload);
      if (dns) protocol = 'DNS';
    } else if (payload.length >= 16) {
      quic = parseQuicPayload(payload, dstPort, srcPort);
      if (quic) protocol = 'QUIC';
    }
  } else if (transportProtocol === 'TCP' && payload.length > 0) {
    http = parseHttpPayload(payload);
    if (http) {
      protocol = 'HTTP';
    } else {
      tls = parseTlsPayload(payload, keylogs);
      if (tls) {
        protocol = srcPort === 443 || dstPort === 443 || srcPort === 8443 || dstPort === 8443 ? 'HTTPS' : 'TLS';
      }
    }
  }

  if (opts.forceProtocolHint && protocol === 'TCP' && (srcPort === 443 || dstPort === 443)) {
    protocol = opts.forceProtocolHint;
  }

  const remoteIp = opts.direction === 'OUTBOUND' ? dstIp : srcIp;
  const remotePort = opts.direction === 'OUTBOUND' ? dstPort : srcPort;
  const enrichment = lookupEnrichment(remoteIp, remotePort);

  const domain = dns?.queryName || tls?.sni || http?.headers['host'];
  const blockedRule = opts.firewallRules
    ? evaluateFirewall(opts.firewallRules, {
        appId: opts.appId,
        appName: opts.appName,
        srcIp,
        dstIp,
        srcPort,
        dstPort,
        domain,
      })
    : null;

  const timestampMs = opts.timestampMs ?? Date.now();
  const timestampNs =
    opts.timestampNs ?? `${BigInt(timestampMs) * 1_000_000n + BigInt(opts.sequence % 1000) * 1_000n}`;
  const packetId = `pkt-${opts.sequence}-${timestampMs.toString(36)}`;

  const asciiSnippet = payload.length > 0 ? textDecoder.decode(payload.subarray(0, 256)) : '';
  const alerts = detectThreatAlerts({
    packetId,
    timestampNs,
    dstPort,
    srcPort,
    protocol,
    domain,
    blockedRule,
    asciiSnippet,
  });

  let summary = `${protocol} ${srcIp}:${srcPort} -> ${dstIp}:${dstPort}`;
  if (dns) {
    summary = `DNS ${dns.isResponse ? 'Response' : 'Query'} ${dns.queryName} (${dns.queryType}) ${dns.answers.join(', ')}`;
  } else if (http) {
    summary = http.isRequest
      ? `${http.method} ${http.path} (${http.headers['host'] || dstIp})`
      : `${http.version} ${http.statusCode} ${http.statusText}`;
  } else if (tls) {
    summary = `TLS ${tls.recordVersion} ${tls.handshakeType || tls.recordType}${tls.sni ? ` · SNI ${tls.sni}` : ''}${tls.matchedKeylogSecret ? ' · Keylog Matched' : ''}`;
  } else if (quic) {
    summary = `QUIC ${quic.packetType} ${quic.version} DCID=${quic.dcid.slice(0, 12)}`;
  } else if (tcp) {
    summary = `TCP [${tcp.flagString}] Seq=${tcp.seq} Ack=${tcp.ack} Len=${payload.length}`;
  } else if (udp) {
    summary = `UDP Datagram Len=${payload.length} (${enrichment.service})`;
  } else if (transportProtocol === 'ICMP' || transportProtocol === 'ICMPv6') {
    const icmpType = rawBytes[l4Offset];
    summary = `${transportProtocol} Type=${icmpType} Code=${rawBytes[l4Offset + 1] ?? 0} Len=${payload.length}`;
  }

  return {
    id: packetId,
    sequence: opts.sequence,
    timestampNs,
    timestampMs,
    appId: opts.appId,
    appName: opts.appName,
    ipVersion: version as 4 | 6,
    srcIp,
    srcPort,
    dstIp,
    dstPort,
    protocol,
    transportProtocol,
    direction: opts.direction,
    totalLength: rawBytes.length,
    payloadLength: payload.length,
    payloadOffset,
    rawBytes,
    blocked: Boolean(blockedRule),
    blockReason: blockedRule ? `${blockedRule.type}: ${blockedRule.value}` : undefined,
    alerts,
    enrichment,
    sourceOrigin: opts.sourceOrigin,
    tcp,
    udp,
    dns,
    http,
    tls,
    quic,
    summary,
  };
}

/**
 * Builds real binary IPv4 / IPv6 + TCP / UDP / ICMP packets for live Server Probe wrapping
 * and deterministic verification streams so exports open cleanly in Wireshark / tcpdump.
 */
export function buildBinaryIpFrame(params: {
  ipVersion: 4 | 6;
  srcIp: string;
  dstIp: string;
  transport: 'TCP' | 'UDP' | 'ICMP' | 'ICMPv6';
  srcPort?: number;
  dstPort?: number;
  seq?: number;
  ack?: number;
  tcpFlags?: number; // e.g., 0x18 = PSH|ACK, 0x02 = SYN
  payload: Uint8Array;
}): Uint8Array {
  const { ipVersion, srcIp, dstIp, transport, payload } = params;
  const protoNum = transport === 'TCP' ? 6 : transport === 'UDP' ? 17 : transport === 'ICMP' ? 1 : 58;

  let l4Header: Uint8Array;
  if (transport === 'TCP') {
    l4Header = new Uint8Array(20);
    const dv = new DataView(l4Header.buffer);
    dv.setUint16(0, params.srcPort ?? 51422);
    dv.setUint16(2, params.dstPort ?? 443);
    dv.setUint32(4, params.seq ?? 1000);
    dv.setUint32(8, params.ack ?? 1);
    l4Header[12] = 0x50; // data offset = 5 (20 bytes)
    l4Header[13] = params.tcpFlags ?? 0x18; // PSH + ACK
    dv.setUint16(14, 65535);
  } else if (transport === 'UDP') {
    l4Header = new Uint8Array(8);
    const dv = new DataView(l4Header.buffer);
    dv.setUint16(0, params.srcPort ?? 51422);
    dv.setUint16(2, params.dstPort ?? 443);
    dv.setUint16(4, 8 + payload.length);
    dv.setUint16(6, 0x1a2b);
  } else {
    l4Header = new Uint8Array(8);
    l4Header[0] = ipVersion === 6 ? 128 : 8; // Echo Request
    l4Header[1] = 0;
  }

  const l3Len = ipVersion === 4 ? 20 : 40;
  const frame = new Uint8Array(l3Len + l4Header.length + payload.length);

  if (ipVersion === 4) {
    const dv = new DataView(frame.buffer);
    frame[0] = 0x45; // v4, IHL=5
    dv.setUint16(2, frame.length);
    dv.setUint16(4, Math.floor(Math.random() * 65535));
    dv.setUint16(6, 0x4000); // DF
    frame[8] = 64; // TTL
    frame[9] = protoNum;
    frame.set(parseIpv4Bytes(srcIp), 12);
    frame.set(parseIpv4Bytes(dstIp), 16);
  } else {
    const dv = new DataView(frame.buffer);
    frame[0] = 0x60; // v6
    dv.setUint16(4, l4Header.length + payload.length);
    frame[6] = protoNum;
    frame[7] = 64; // Hop limit
    frame.set(parseIpv6Bytes(srcIp), 8);
    frame.set(parseIpv6Bytes(dstIp), 24);
  }

  frame.set(l4Header, l3Len);
  frame.set(payload, l3Len + l4Header.length);
  return frame;
}
