import { CapturedPacket, FirewallRule, FriendlyAppId, KeylogEntry } from '../types/capture';
import { buildBinaryIpFrame, dissectRawIpPacket, hexToBytes } from './dissector';
import { FRIENDLY_APP_OPTIONS } from './enrichment';

const encoder = new TextEncoder();

export const SAMPLE_CLIENT_RANDOM =
  '4a8f19c2e7b03d55812c9f44019a7e2b6c88d104f9a372e110bc4598da72ef01';

export const SAMPLE_SSLKEYLOG_CONTENT = `# SADNAN CAPTURE Test SSLKEYLOGFILE (ClientHello Match Verification)
CLIENT_RANDOM ${SAMPLE_CLIENT_RANDOM} 9b8e7d6c5a4f3e2d1c0b9a8f7e6d5c4b3a291807162534435261708f9e0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a697887`;

function buildDnsQueryPacket(domain: string, qtype = 1): Uint8Array {
  const labels = domain.split('.');
  const nameBytes: number[] = [];
  for (const label of labels) {
    nameBytes.push(label.length);
    for (let i = 0; i < label.length; i++) nameBytes.push(label.charCodeAt(i));
  }
  nameBytes.push(0);
  const buf = new Uint8Array(12 + nameBytes.length + 4);
  buf[0] = 0x7b;
  buf[1] = 0x22;
  buf[2] = 0x01; // Standard query
  buf[5] = 0x01; // 1 question
  buf.set(nameBytes, 12);
  const qOff = 12 + nameBytes.length;
  buf[qOff + 1] = qtype;
  buf[qOff + 3] = 1; // IN
  return buf;
}

function buildDnsResponsePacket(domain: string, ipv4: string): Uint8Array {
  const q = buildDnsQueryPacket(domain, 1);
  const ipParts = ipv4.split('.').map((n) => Number(n) & 0xff);
  const ans = new Uint8Array(q.length + 16);
  ans.set(q, 0);
  ans[2] = 0x81;
  ans[3] = 0x80; // Response, NOERROR
  ans[7] = 0x01; // 1 answer
  const o = q.length;
  ans[o] = 0xc0;
  ans[o + 1] = 0x0c; // Pointer to name
  ans[o + 3] = 1; // A
  ans[o + 5] = 1; // IN
  ans[o + 9] = 60; // TTL 60s
  ans[o + 11] = 4; // RDLEN 4
  ans.set(ipParts, o + 12);
  return ans;
}

function buildTlsClientHello(sni: string, alpnList: string[], clientRandomHex: string): Uint8Array {
  const sniBytes = encoder.encode(sni);
  // SNI extension (0x0000)
  const sniExt = new Uint8Array(9 + sniBytes.length);
  const sniDv = new DataView(sniExt.buffer);
  sniDv.setUint16(0, 0x0000);
  sniDv.setUint16(2, 5 + sniBytes.length);
  sniDv.setUint16(4, 3 + sniBytes.length);
  sniExt[6] = 0x00;
  sniDv.setUint16(7, sniBytes.length);
  sniExt.set(sniBytes, 9);

  // ALPN extension (0x0010)
  const alpnItems: number[] = [];
  for (const proto of alpnList) {
    const b = encoder.encode(proto);
    alpnItems.push(b.length, ...b);
  }
  const alpnExt = new Uint8Array(6 + alpnItems.length);
  const alpnDv = new DataView(alpnExt.buffer);
  alpnDv.setUint16(0, 0x0010);
  alpnDv.setUint16(2, 2 + alpnItems.length);
  alpnDv.setUint16(4, alpnItems.length);
  alpnExt.set(alpnItems, 6);

  const extTotalLen = sniExt.length + alpnExt.length;
  const ciphers = new Uint8Array([0x13, 0x01, 0x13, 0x02, 0x13, 0x03, 0xc0, 0x2f]); // 4 ciphers
  const hsBodyLen = 2 + 32 + 1 + 2 + ciphers.length + 2 + 2 + extTotalLen;
  const recordLen = 4 + hsBodyLen;
  const rec = new Uint8Array(5 + recordLen);
  const dv = new DataView(rec.buffer);

  rec[0] = 22; // Handshake
  rec[1] = 3;
  rec[2] = 1; // TLS 1.0 record compat
  dv.setUint16(3, recordLen);
  rec[5] = 1; // ClientHello
  rec[6] = 0;
  dv.setUint16(7, hsBodyLen);
  rec[9] = 3;
  rec[10] = 3; // TLS 1.2 legacy version
  rec.set(hexToBytes(clientRandomHex).subarray(0, 32), 11);
  let p = 43;
  rec[p++] = 0; // Session ID len 0
  dv.setUint16(p, ciphers.length);
  p += 2;
  rec.set(ciphers, p);
  p += ciphers.length;
  rec[p++] = 1; // compression len
  rec[p++] = 0; // null
  dv.setUint16(p, extTotalLen);
  p += 2;
  rec.set(sniExt, p);
  p += sniExt.length;
  rec.set(alpnExt, p);
  return rec;
}

function buildTlsAppData(byteLen = 96): Uint8Array {
  const rec = new Uint8Array(5 + byteLen);
  const dv = new DataView(rec.buffer);
  rec[0] = 23; // Application Data
  rec[1] = 3;
  rec[2] = 3; // TLS 1.2/1.3 wire record
  dv.setUint16(3, byteLen);
  for (let i = 5; i < rec.length; i++) {
    rec[i] = (i * 73 + 19) & 0xff; // Deterministic opaque ciphertext bytes
  }
  return rec;
}

function buildQuicInitial(dcidHex: string, scidHex: string): Uint8Array {
  const dcid = hexToBytes(dcidHex);
  const scid = hexToBytes(scidHex);
  const pad = new Uint8Array(72);
  for (let i = 0; i < pad.length; i++) pad[i] = (i * 41 + 7) & 0xff;
  const pkt = new Uint8Array(7 + dcid.length + scid.length + pad.length);
  pkt[0] = 0xc3; // Long Header + Fixed bit + Initial
  pkt[1] = 0x00;
  pkt[2] = 0x00;
  pkt[3] = 0x00;
  pkt[4] = 0x01; // QUIC v1
  pkt[5] = dcid.length;
  pkt.set(dcid, 6);
  pkt[6 + dcid.length] = scid.length;
  pkt.set(scid, 7 + dcid.length);
  pkt.set(pad, 7 + dcid.length + scid.length);
  return pkt;
}

function buildHttpChunkedHtml(): Uint8Array {
  const html = `<!DOCTYPE html><html><head><title>Sadnan Capture Endpoint</title></head><body><main class="panel"><h1>Live Verification</h1><p>Chunked HTML response beautifier check</p></main></body></html>`;
  const part1 = html.slice(0, 74);
  const part2 = html.slice(74);
  const chunked =
    `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nTransfer-Encoding: chunked\r\nServer: SadnanTestEdge\r\n\r\n` +
    `${part1.length.toString(16)}\r\n${part1}\r\n` +
    `${part2.length.toString(16)}\r\n${part2}\r\n0\r\n\r\n`;
  return encoder.encode(chunked);
}

function buildHttpPrefixedJson(): Uint8Array {
  const payload = `)]}',\n${JSON.stringify({
    status: 'ok',
    region: 'ap-southeast-1',
    endpoints: [
      { host: 'match-sg.ff.garena.com', port: 10001, transport: 'UDP' },
      { host: 'lobby-sg.ff.garena.com', port: 10012, transport: 'TCP' },
    ],
    telemetry: { tickRateHz: 30, encryption: 'TLS 1.3 + UDP Session' },
  })}`;
  return encoder.encode(
    `HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${payload.length}\r\n\r\n${payload}`
  );
}

function buildHttpNdjson(): Uint8Array {
  const lines = [
    JSON.stringify({ event: 'match_ping', rttMs: 24, region: 'SG' }),
    JSON.stringify({ event: 'squad_sync', peers: 4, codec: 'opus' }),
    JSON.stringify({ event: 'cdn_manifest', assets: 12, status: 'ready' }),
  ].join('\n');
  return encoder.encode(
    `HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: ${lines.length}\r\n\r\n${lines}`
  );
}

export function generateSandboxPacketBatch(params: {
  selectedApp: FriendlyAppId;
  startSeq: number;
  tick: number;
  keylogEntries: KeylogEntry[];
  firewallRules: FirewallRule[];
}): CapturedPacket[] {
  const { selectedApp, startSeq, tick, keylogEntries, firewallRules } = params;
  const resolveApp = (preferred: FriendlyAppId): { id: FriendlyAppId; name: string } => {
    const id = selectedApp === 'all' ? preferred : selectedApp;
    const found = FRIENDLY_APP_OPTIONS.find((a) => a.id === id) || FRIENDLY_APP_OPTIONS[0];
    return { id: found.id, name: found.displayName };
  };

  const candidates: Array<() => CapturedPacket | null> = [
    // 0: DNS Query + Response (Free Fire / Game or Chrome)
    () => {
      const app = resolveApp('free_fire');
      const domain =
        app.id === 'chrome'
          ? 'api.github.com'
          : app.id === 'whatsapp'
            ? 'g.whatsapp.net'
            : 'lobby-sg.ff.garena.com';
      const frame = buildBinaryIpFrame({
        ipVersion: 4,
        srcIp: '10.0.0.2',
        dstIp: '8.8.8.8',
        transport: 'UDP',
        srcPort: 53000 + (tick % 400),
        dstPort: 53,
        payload: buildDnsQueryPacket(domain, 1),
      });
      return dissectRawIpPacket(frame, {
        sequence: startSeq,
        appId: app.id,
        appName: app.name,
        direction: 'OUTBOUND',
        keylogEntries,
        firewallRules,
        sourceOrigin: 'LOCAL_SANDBOX',
      });
    },
    // 1: DNS Response
    () => {
      const app = resolveApp('free_fire');
      const domain =
        app.id === 'chrome'
          ? 'api.github.com'
          : app.id === 'whatsapp'
            ? 'g.whatsapp.net'
            : 'lobby-sg.ff.garena.com';
      const targetIp =
        app.id === 'chrome' ? '140.82.113.6' : app.id === 'whatsapp' ? '157.240.22.60' : '43.229.104.18';
      const frame = buildBinaryIpFrame({
        ipVersion: 4,
        srcIp: '8.8.8.8',
        dstIp: '10.0.0.2',
        transport: 'UDP',
        srcPort: 53,
        dstPort: 53000 + (tick % 400),
        payload: buildDnsResponsePacket(domain, targetIp),
      });
      return dissectRawIpPacket(frame, {
        sequence: startSeq,
        appId: app.id,
        appName: app.name,
        direction: 'INBOUND',
        keylogEntries,
        firewallRules,
        sourceOrigin: 'LOCAL_SANDBOX',
      });
    },
    // 2: TLS ClientHello with SNI & ALPN & matching/test ClientRandom
    () => {
      const app = resolveApp(selectedApp === 'all' ? 'chrome' : selectedApp);
      const sni =
        app.id === 'free_fire' || app.id === 'free_fire_max'
          ? 'login.ff.garena.com'
          : app.id === 'whatsapp'
            ? 'e1.whatsapp.net'
            : 'cdn.cloudflare.net';
      const dstIp =
        app.id === 'free_fire' || app.id === 'free_fire_max'
          ? '202.81.114.22'
          : app.id === 'whatsapp'
            ? '157.240.22.60'
            : '104.16.132.229';
      const frame = buildBinaryIpFrame({
        ipVersion: 4,
        srcIp: '10.0.0.2',
        dstIp,
        transport: 'TCP',
        srcPort: 44100 + (tick % 200),
        dstPort: 443,
        seq: 1000 + tick * 64,
        ack: 1,
        tcpFlags: 0x18,
        payload: buildTlsClientHello(sni, ['h2', 'http/1.1'], SAMPLE_CLIENT_RANDOM),
      });
      return dissectRawIpPacket(frame, {
        sequence: startSeq,
        appId: app.id,
        appName: app.name,
        direction: 'OUTBOUND',
        keylogEntries,
        firewallRules,
        sourceOrigin: 'LOCAL_SANDBOX',
      });
    },
    // 3: Encrypted TLS Application Data (Strict Cryptographic Honesty check)
    () => {
      const app = resolveApp(selectedApp === 'all' ? 'chrome' : selectedApp);
      const srcIp =
        app.id === 'free_fire' || app.id === 'free_fire_max'
          ? '202.81.114.22'
          : app.id === 'whatsapp'
            ? '157.240.22.60'
            : '104.16.132.229';
      const frame = buildBinaryIpFrame({
        ipVersion: 4,
        srcIp,
        dstIp: '10.0.0.2',
        transport: 'TCP',
        srcPort: 443,
        dstPort: 44100 + (tick % 200),
        seq: 8400 + tick * 96,
        ack: 1200 + tick * 64,
        tcpFlags: 0x18,
        payload: buildTlsAppData(112),
      });
      return dissectRawIpPacket(frame, {
        sequence: startSeq,
        appId: app.id,
        appName: app.name,
        direction: 'INBOUND',
        keylogEntries,
        firewallRules,
        sourceOrigin: 'LOCAL_SANDBOX',
      });
    },
    // 4: Game UDP Datagram (Free Fire / Free Fire MAX) or QUIC IPv6 (Chrome)
    () => {
      const app = resolveApp(selectedApp === 'all' ? 'free_fire_max' : selectedApp);
      if (app.id === 'chrome') {
        const frame = buildBinaryIpFrame({
          ipVersion: 6,
          srcIp: 'fd00:10::2',
          dstIp: '2606:4700:4700::1111',
          transport: 'UDP',
          srcPort: 56200 + (tick % 100),
          dstPort: 443,
          payload: buildQuicInitial('8394c8f03e515708', 'a1b2c3d4e5f60718'),
        });
        return dissectRawIpPacket(frame, {
          sequence: startSeq,
          appId: app.id,
          appName: app.name,
          direction: 'OUTBOUND',
          keylogEntries,
          firewallRules,
          sourceOrigin: 'LOCAL_SANDBOX',
        });
      }
      const gamePayload = new Uint8Array(48);
      gamePayload[0] = 0x53; // 'S'
      gamePayload[1] = 0x47; // 'G'
      gamePayload[2] = tick & 0xff;
      for (let i = 3; i < gamePayload.length; i++) gamePayload[i] = (i * 19 + tick) & 0xff;
      const frame = buildBinaryIpFrame({
        ipVersion: 4,
        srcIp: '10.0.0.2',
        dstIp: '43.229.104.88',
        transport: 'UDP',
        srcPort: 38210 + (tick % 20),
        dstPort: 10001,
        payload: gamePayload,
      });
      return dissectRawIpPacket(frame, {
        sequence: startSeq,
        appId: app.id,
        appName: app.name,
        direction: 'OUTBOUND',
        keylogEntries,
        firewallRules,
        sourceOrigin: 'LOCAL_SANDBOX',
      });
    },
    // 5: HTTP Prefixed JSON / Chunked HTML / NDJSON (for Raw Response Body Beautifier verification)
    () => {
      const app = resolveApp(selectedApp === 'all' ? 'chrome' : selectedApp);
      const mod = tick % 3;
      const bodyPayload =
        mod === 0 ? buildHttpPrefixedJson() : mod === 1 ? buildHttpChunkedHtml() : buildHttpNdjson();
      const frame = buildBinaryIpFrame({
        ipVersion: 4,
        srcIp: '104.18.21.44',
        dstIp: '10.0.0.2',
        transport: 'TCP',
        srcPort: 80,
        dstPort: 49200 + (tick % 50),
        seq: 4000 + tick * 128,
        ack: 300,
        tcpFlags: 0x18,
        payload: bodyPayload,
      });
      return dissectRawIpPacket(frame, {
        sequence: startSeq,
        appId: app.id,
        appName: app.name,
        direction: 'INBOUND',
        keylogEntries,
        firewallRules,
        sourceOrigin: 'LOCAL_SANDBOX',
      });
    },
    // 6: Tracker / ICMPv6 / TCP SYN handshake variety
    () => {
      const app = resolveApp(selectedApp === 'all' ? 'free_fire' : selectedApp);
      if (tick % 2 === 0) {
        const frame = buildBinaryIpFrame({
          ipVersion: 6,
          srcIp: 'fd00:10::2',
          dstIp: '2001:4860:4860::8888',
          transport: 'ICMPv6',
          payload: encoder.encode('sadnan-ping-v6'),
        });
        return dissectRawIpPacket(frame, {
          sequence: startSeq,
          appId: app.id,
          appName: app.name,
          direction: 'OUTBOUND',
          keylogEntries,
          firewallRules,
          sourceOrigin: 'LOCAL_SANDBOX',
        });
      }
      // Tracker SNI check to demonstrate Threat Alert engine
      const frame = buildBinaryIpFrame({
        ipVersion: 4,
        srcIp: '10.0.0.2',
        dstIp: '142.250.190.46',
        transport: 'TCP',
        srcPort: 51100 + (tick % 100),
        dstPort: 443,
        seq: 512,
        ack: 0,
        tcpFlags: 0x02, // SYN
        payload: buildTlsClientHello('app-measurement.com', ['h2'], SAMPLE_CLIENT_RANDOM),
      });
      return dissectRawIpPacket(frame, {
        sequence: startSeq,
        appId: app.id,
        appName: app.name,
        direction: 'OUTBOUND',
        keylogEntries,
        firewallRules,
        sourceOrigin: 'LOCAL_SANDBOX',
      });
    },
  ];

  const picked = candidates[tick % candidates.length]();
  return picked ? [picked] : [];
}
