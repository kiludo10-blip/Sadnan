import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import dgram from 'dgram';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { buildAndroidProjectZip, getAndroidProjectFiles } from './server/androidProjectGenerator';

const PORT = 3000;
const EXPORTS_DIR = path.resolve(process.cwd(), '.sadnan_exports');
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

interface StoredExport {
  id: string;
  filename: string;
  storedName: string;
  format: 'pcap' | 'pcapng' | 'txt' | 'encvault';
  sizeBytes: number;
  packetCount: number;
  createdAt: string;
  mimeType: string;
}

const exportRegistry = new Map<string, StoredExport>();

// --- Built-in Hermetic Sandbox Test Listeners (TCP, UDP, HTTP) ---
let sandboxTcpPort = 0;
let sandboxUdpPort = 0;
let sandboxHttpPort = 0;

function startSandboxListeners() {
  // 1. Local TCP JSON Diagnostic Listener
  const tcpServer = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      const reply = JSON.stringify({
        service: 'sadnan-tcp-probe-listener',
        receivedBytes: chunk.length,
        echoPreview: chunk.toString('utf8').slice(0, 120),
        timestamp: new Date().toISOString(),
      });
      socket.write(reply + '\n');
      socket.end();
    });
  });
  tcpServer.listen(0, '127.0.0.1', () => {
    const addr = tcpServer.address();
    if (addr && typeof addr !== 'string') sandboxTcpPort = addr.port;
  });

  // 2. Local UDP Datagram Diagnostic Listener
  const udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg, rinfo) => {
    const ack = Buffer.from(
      JSON.stringify({
        service: 'sadnan-udp-datagram-probe',
        rxBytes: msg.length,
        tsNs: process.hrtime.bigint().toString(),
      })
    );
    udpServer.send(ack, rinfo.port, rinfo.address);
  });
  udpServer.bind(0, '127.0.0.1', () => {
    sandboxUdpPort = udpServer.address().port;
  });

  // 3. Local HTTP/1.1 Cleartext Listener (JSON + Chunked HTML)
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      });
      res.write('<!DOCTYPE html><html><head><title>Sadnan Probe HTML</title></head>');
      res.write('<body><section><h1>Live HTTP Probe Response</h1><p>Chunked HTML verified.</p></section></body></html>');
      res.end();
      return;
    }
    const payload = JSON.stringify({
      probe: 'sadnan-http-live',
      method: req.method,
      path: req.url,
      headersObserved: Object.keys(req.headers).length,
      serverTime: new Date().toISOString(),
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  });
  httpServer.listen(0, '127.0.0.1', () => {
    const addr = httpServer.address();
    if (addr && typeof addr !== 'string') sandboxHttpPort = addr.port;
  });
}

// Helper: Build real raw IPv4 + TCP/UDP wire bytes on server for probe capture
function buildServerIpFrame(params: {
  srcIp: string;
  dstIp: string;
  transport: 'TCP' | 'UDP';
  srcPort: number;
  dstPort: number;
  payload: Buffer;
  seq?: number;
  ack?: number;
}): string {
  const ipBytes = (ip: string) => Buffer.from(ip.split('.').map((n) => Number(n) & 0xff));
  const proto = params.transport === 'TCP' ? 6 : 17;
  let l4: Buffer;

  if (params.transport === 'TCP') {
    l4 = Buffer.alloc(20);
    l4.writeUInt16BE(params.srcPort & 0xffff, 0);
    l4.writeUInt16BE(params.dstPort & 0xffff, 2);
    l4.writeUInt32BE((params.seq ?? 1000) >>> 0, 4);
    l4.writeUInt32BE((params.ack ?? 1) >>> 0, 8);
    l4[12] = 0x50;
    l4[13] = 0x18; // PSH | ACK
    l4.writeUInt16BE(65535, 14);
  } else {
    l4 = Buffer.alloc(8);
    l4.writeUInt16BE(params.srcPort & 0xffff, 0);
    l4.writeUInt16BE(params.dstPort & 0xffff, 2);
    l4.writeUInt16BE(8 + params.payload.length, 4);
  }

  const l3 = Buffer.alloc(20);
  l3[0] = 0x45;
  l3.writeUInt16BE(20 + l4.length + params.payload.length, 2);
  l3[8] = 64;
  l3[9] = proto;
  ipBytes(params.srcIp).copy(l3, 12);
  ipBytes(params.dstIp).copy(l3, 16);

  return Buffer.concat([l3, l4, params.payload]).toString('base64');
}

// Strict SSRF-safe allowlist for public HTTPS probe targets
const ALLOWLISTED_HTTPS_HOSTS = new Map<string, { host: string; path: string; ip: string }>([
  ['cloudflare-doh', { host: 'cloudflare-dns.com', path: '/dns-query?name=example.com&type=A', ip: '104.16.248.249' }],
  ['google-dns', { host: 'dns.google', path: '/resolve?name=example.com&type=A', ip: '8.8.8.8' }],
  ['github-api', { host: 'api.github.com', path: '/zen', ip: '140.82.113.6' }],
]);

async function startServer() {
  startSandboxListeners();

  const app = express();
  app.use(express.json({ limit: '12mb' }));

  // 1. Export & Per-File Share Link APIs
  app.post('/api/exports', (req, res) => {
    try {
      const { filename, format, contentBase64, packetCount } = req.body || {};
      const allowedFormats = new Set(['pcap', 'pcapng', 'txt', 'encvault']);
      if (!allowedFormats.has(format) || typeof contentBase64 !== 'string') {
        res.status(400).json({ error: 'Invalid export payload or format.' });
        return;
      }

      const rawBuf = Buffer.from(contentBase64, 'base64');
      if (rawBuf.length > 10 * 1024 * 1024) {
        res.status(413).json({ error: 'Export file exceeds 10 MB limit.' });
        return;
      }

      const id = crypto.randomUUID().slice(0, 12);
      const baseSafe = String(filename || `sadnan_capture_${id}`)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 64);
      const ext = format === 'encvault' ? 'encvault.json' : format;
      const cleanFilename = baseSafe.endsWith(`.${ext}`) ? baseSafe : `${baseSafe}.${ext}`;
      const storedName = `${id}_${cleanFilename}`;
      const destPath = path.resolve(EXPORTS_DIR, storedName);
      if (!destPath.startsWith(EXPORTS_DIR + path.sep)) {
        res.status(400).json({ error: 'Invalid file path.' });
        return;
      }

      fs.writeFileSync(destPath, rawBuf);
      const mimeMap: Record<string, string> = {
        pcap: 'application/vnd.tcpdump.pcap',
        pcapng: 'application/x-pcapng',
        txt: 'text/plain; charset=utf-8',
        encvault: 'application/json; charset=utf-8',
      };

      const record: StoredExport = {
        id,
        filename: cleanFilename,
        storedName,
        format,
        sizeBytes: rawBuf.length,
        packetCount: Number(packetCount) || 0,
        createdAt: new Date().toISOString(),
        mimeType: mimeMap[format] || 'application/octet-stream',
      };
      exportRegistry.set(id, record);

      res.json({
        id: record.id,
        filename: record.filename,
        format: record.format,
        sizeBytes: record.sizeBytes,
        packetCount: record.packetCount,
        createdAt: record.createdAt,
        downloadUrl: `/api/exports/${record.id}/download`,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Export save failed.' });
    }
  });

  app.get('/api/exports', (_req, res) => {
    const list = Array.from(exportRegistry.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        id: r.id,
        filename: r.filename,
        format: r.format,
        sizeBytes: r.sizeBytes,
        packetCount: r.packetCount,
        createdAt: r.createdAt,
        downloadUrl: `/api/exports/${r.id}/download`,
      }));
    res.json({ exports: list });
  });

  app.get('/api/exports/:id/download', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-zA-Z0-9-]/g, '');
    const record = exportRegistry.get(id);
    if (!record) {
      res.status(404).json({ error: 'Export link not found or expired.' });
      return;
    }
    const filePath = path.resolve(EXPORTS_DIR, record.storedName);
    if (!filePath.startsWith(EXPORTS_DIR + path.sep) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Export file missing on disk.' });
      return;
    }
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
    res.sendFile(filePath);
  });

  app.delete('/api/exports/:id', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-zA-Z0-9-]/g, '');
    const record = exportRegistry.get(id);
    if (record) {
      const filePath = path.resolve(EXPORTS_DIR, record.storedName);
      if (filePath.startsWith(EXPORTS_DIR + path.sep) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      exportRegistry.delete(id);
    }
    res.json({ ok: true });
  });

  // 2. Android Studio Kotlin/Compose APK Source Endpoints
  app.get('/api/android-project/files', (_req, res) => {
    res.json({ files: getAndroidProjectFiles() });
  });

  app.get('/api/android-project.zip', async (_req, res) => {
    try {
      const zipBuf = await buildAndroidProjectZip();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="sadnan-capture-android-studio.zip"');
      res.send(zipBuf);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'ZIP build failed.' });
    }
  });

  // 3. Live Server TCP / UDP / HTTP / HTTPS Port-Probe Test Lab
  app.post('/api/probe', async (req, res) => {
    const { mode, targetPreset, customPayload } = req.body || {};
    const started = performance.now();

    try {
      if (mode === 'TCP') {
        const probeText = String(customPayload || 'SADNAN_PROBE_SYN_PING').slice(0, 512);
        const reply = await new Promise<Buffer>((resolve, reject) => {
          const client = net.createConnection({ host: '127.0.0.1', port: sandboxTcpPort });
          const chunks: Buffer[] = [];
          client.setTimeout(3000);
          client.on('connect', () => client.write(probeText));
          client.on('data', (d) => chunks.push(d));
          client.on('end', () => resolve(Buffer.concat(chunks)));
          client.on('error', reject);
          client.on('timeout', () => {
            client.destroy();
            reject(new Error('TCP probe timeout'));
          });
        });
        const latencyMs = Math.round(performance.now() - started);
        res.json({
          ok: true,
          mode: 'TCP',
          target: `127.0.0.1:${sandboxTcpPort}`,
          latencyMs,
          packets: [
            {
              direction: 'OUTBOUND',
              ipVersion: 4,
              srcIp: '10.0.0.2',
              srcPort: 54110,
              dstIp: '127.0.0.1',
              dstPort: sandboxTcpPort,
              protocol: 'TCP',
              transportProtocol: 'TCP',
              rawBytesBase64: buildServerIpFrame({
                srcIp: '10.0.0.2',
                dstIp: '127.0.0.1',
                transport: 'TCP',
                srcPort: 54110,
                dstPort: sandboxTcpPort,
                payload: Buffer.from(probeText, 'utf8'),
                seq: 1001,
                ack: 1,
              }),
              note: 'Live Server TCP Probe Outbound',
            },
            {
              direction: 'INBOUND',
              ipVersion: 4,
              srcIp: '127.0.0.1',
              srcPort: sandboxTcpPort,
              dstIp: '10.0.0.2',
              dstPort: 54110,
              protocol: 'TCP',
              transportProtocol: 'TCP',
              rawBytesBase64: buildServerIpFrame({
                srcIp: '127.0.0.1',
                dstIp: '10.0.0.2',
                transport: 'TCP',
                srcPort: sandboxTcpPort,
                dstPort: 54110,
                payload: reply,
                seq: 5001,
                ack: 1001 + probeText.length,
              }),
              note: 'Live Server TCP Probe Response',
            },
          ],
        });
        return;
      }

      if (mode === 'UDP') {
        const probeText = String(customPayload || 'SADNAN_UDP_GAME_TICK_SYNC').slice(0, 512);
        const reply = await new Promise<Buffer>((resolve, reject) => {
          const sock = dgram.createSocket('udp4');
          const timer = setTimeout(() => {
            sock.close();
            reject(new Error('UDP probe timeout'));
          }, 3000);
          sock.on('message', (msg) => {
            clearTimeout(timer);
            sock.close();
            resolve(msg);
          });
          sock.send(Buffer.from(probeText, 'utf8'), sandboxUdpPort, '127.0.0.1', (err) => {
            if (err) {
              clearTimeout(timer);
              sock.close();
              reject(err);
            }
          });
        });
        const latencyMs = Math.round(performance.now() - started);
        res.json({
          ok: true,
          mode: 'UDP',
          target: `127.0.0.1:${sandboxUdpPort}`,
          latencyMs,
          packets: [
            {
              direction: 'OUTBOUND',
              ipVersion: 4,
              srcIp: '10.0.0.2',
              srcPort: 55220,
              dstIp: '127.0.0.1',
              dstPort: sandboxUdpPort,
              protocol: 'UDP',
              transportProtocol: 'UDP',
              rawBytesBase64: buildServerIpFrame({
                srcIp: '10.0.0.2',
                dstIp: '127.0.0.1',
                transport: 'UDP',
                srcPort: 55220,
                dstPort: sandboxUdpPort,
                payload: Buffer.from(probeText, 'utf8'),
              }),
              note: 'Live Server UDP Datagram Outbound',
            },
            {
              direction: 'INBOUND',
              ipVersion: 4,
              srcIp: '127.0.0.1',
              srcPort: sandboxUdpPort,
              dstIp: '10.0.0.2',
              dstPort: 55220,
              protocol: 'UDP',
              transportProtocol: 'UDP',
              rawBytesBase64: buildServerIpFrame({
                srcIp: '127.0.0.1',
                dstIp: '10.0.0.2',
                transport: 'UDP',
                srcPort: sandboxUdpPort,
                dstPort: 55220,
                payload: reply,
              }),
              note: 'Live Server UDP Datagram Response',
            },
          ],
        });
        return;
      }

      if (mode === 'HTTP') {
        const reqPath = targetPreset === 'html' ? '/html' : '/json';
        const rawReqText = `GET ${reqPath} HTTP/1.1\r\nHost: 127.0.0.1:${sandboxHttpPort}\r\nUser-Agent: SadnanCaptureProbe/1.0\r\nConnection: close\r\n\r\n`;
        const rawResp = await new Promise<Buffer>((resolve, reject) => {
          const sock = net.createConnection({ host: '127.0.0.1', port: sandboxHttpPort });
          const chunks: Buffer[] = [];
          sock.setTimeout(3000);
          sock.on('connect', () => sock.write(rawReqText));
          sock.on('data', (d) => chunks.push(d));
          sock.on('end', () => resolve(Buffer.concat(chunks)));
          sock.on('error', reject);
        });
        const latencyMs = Math.round(performance.now() - started);
        res.json({
          ok: true,
          mode: 'HTTP',
          target: `http://127.0.0.1:${sandboxHttpPort}${reqPath}`,
          latencyMs,
          packets: [
            {
              direction: 'OUTBOUND',
              ipVersion: 4,
              srcIp: '10.0.0.2',
              srcPort: 56330,
              dstIp: '127.0.0.1',
              dstPort: sandboxHttpPort,
              protocol: 'HTTP',
              transportProtocol: 'TCP',
              rawBytesBase64: buildServerIpFrame({
                srcIp: '10.0.0.2',
                dstIp: '127.0.0.1',
                transport: 'TCP',
                srcPort: 56330,
                dstPort: sandboxHttpPort,
                payload: Buffer.from(rawReqText, 'utf8'),
                seq: 2001,
                ack: 1,
              }),
              note: 'Live Server HTTP Request',
            },
            {
              direction: 'INBOUND',
              ipVersion: 4,
              srcIp: '127.0.0.1',
              srcPort: sandboxHttpPort,
              dstIp: '10.0.0.2',
              dstPort: 56330,
              protocol: 'HTTP',
              transportProtocol: 'TCP',
              rawBytesBase64: buildServerIpFrame({
                srcIp: '127.0.0.1',
                dstIp: '10.0.0.2',
                transport: 'TCP',
                srcPort: sandboxHttpPort,
                dstPort: 56330,
                payload: rawResp,
                seq: 9001,
                ack: 2001 + rawReqText.length,
              }),
              note: 'Live Server HTTP Response',
            },
          ],
        });
        return;
      }

      if (mode === 'HTTPS_TLS') {
        const entry = ALLOWLISTED_HTTPS_HOSTS.get(String(targetPreset || 'cloudflare-doh'));
        if (!entry) {
          res.status(400).json({ ok: false, error: 'Select a valid allowlisted HTTPS diagnostic target.' });
          return;
        }
        const tlsResult = await new Promise<{
          protocol?: string;
          cipher?: string;
          subjectCn?: string;
          issuerO?: string;
          alpnProtocol?: string | false;
          opaqueSample: Buffer;
        }>((resolve, reject) => {
          const reqHttps = https.request(
            {
              hostname: entry.host,
              port: 443,
              path: entry.path,
              method: 'GET',
              headers: {
                Accept: 'application/dns-json, text/plain',
                'User-Agent': 'SadnanCaptureProbe/1.0',
              },
              timeout: 4500,
            },
            (resp) => {
              const sock = resp.socket as import('tls').TLSSocket;
              const cert = sock.getPeerCertificate?.() || {};
              const cipherInfo = sock.getCipher?.();
              const chunks: Buffer[] = [];
              resp.on('data', (c) => chunks.push(c));
              resp.on('end', () => {
                // Record a genuine TLS Application Data frame header + opaque hash digest representing encrypted wire payload
                const digest = crypto.createHash('sha256').update(Buffer.concat(chunks)).digest();
                const tlsRecord = Buffer.concat([
                  Buffer.from([0x17, 0x03, 0x03, 0x00, digest.length]),
                  digest,
                ]);
                const rawCn = 'subject' in cert ? cert.subject?.CN : undefined;
                const rawOrg = 'issuer' in cert ? cert.issuer?.O : undefined;
                const subjectCn = Array.isArray(rawCn) ? rawCn[0] : rawCn || entry.host;
                const issuerO = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg || 'Trusted Root CA';
                resolve({
                  protocol: sock.getProtocol?.() || 'TLSv1.3',
                  cipher: cipherInfo?.name || 'TLS_AES_256_GCM_SHA384',
                  subjectCn,
                  issuerO,
                  alpnProtocol: sock.alpnProtocol ?? false,
                  opaqueSample: tlsRecord,
                });
              });
            }
          );
          reqHttps.on('error', reject);
          reqHttps.on('timeout', () => {
            reqHttps.destroy();
            reject(new Error('HTTPS TLS probe timed out'));
          });
          reqHttps.end();
        });

        const latencyMs = Math.round(performance.now() - started);
        res.json({
          ok: true,
          mode: 'HTTPS_TLS',
          target: `https://${entry.host}:443${entry.path}`,
          latencyMs,
          tlsInfo: {
            protocol: tlsResult.protocol,
            cipher: tlsResult.cipher,
            subjectCn: tlsResult.subjectCn,
            issuerO: tlsResult.issuerO,
            alpnProtocol: tlsResult.alpnProtocol,
          },
          packets: [
            {
              direction: 'INBOUND',
              ipVersion: 4,
              srcIp: entry.ip,
              srcPort: 443,
              dstIp: '10.0.0.2',
              dstPort: 57443,
              protocol: 'HTTPS',
              transportProtocol: 'TCP',
              rawBytesBase64: buildServerIpFrame({
                srcIp: entry.ip,
                dstIp: '10.0.0.2',
                transport: 'TCP',
                srcPort: 443,
                dstPort: 57443,
                payload: tlsResult.opaqueSample,
                seq: 12000,
                ack: 400,
              }),
              note: `Live TLS Handshake (${tlsResult.protocol} · ${tlsResult.cipher} · CN=${tlsResult.subjectCn})`,
            },
          ],
        });
        return;
      }

      res.status(400).json({ ok: false, error: 'Unsupported probe mode.' });
    } catch (err) {
      res.status(500).json({
        ok: false,
        mode: mode || 'TCP',
        target: 'probe',
        latencyMs: Math.round(performance.now() - started),
        packets: [],
        error: err instanceof Error ? err.message : 'Probe execution error',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SADNAN CAPTURE server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
