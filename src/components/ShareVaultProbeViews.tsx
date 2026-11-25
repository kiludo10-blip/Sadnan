import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  FileArchive,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Share2,
  Terminal,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { encodePcapBinary, encodePcapngBinary, encodeRawBodiesText } from '../engine/pcap';
import { VaultSessionMeta } from '../engine/vault';
import {
  CapturedPacket,
  ExportRecord,
  ProbeResponse,
  ProbeResultPacket,
} from '../types/capture';

function u8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function triggerLocalDownload(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================================
 * 1. SHARE LINKS & EXPORT VIEW
 * ==========================================================================*/
export const ShareExportsView: React.FC<{
  packets: CapturedPacket[];
  exportsList: ExportRecord[];
  onRefreshExports: () => void;
  onExportEncVault: () => void;
}> = ({ packets, exportsList, onRefreshExports, onExportEncVault }) => {
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const createServerShareExport = async (format: 'pcap' | 'pcapng' | 'txt') => {
    if (packets.length === 0) {
      setStatusMsg('Capture or import packets first before exporting.');
      return;
    }
    setBusyFormat(format);
    setStatusMsg(null);
    try {
      let rawBytes: Uint8Array;
      if (format === 'pcap') rawBytes = encodePcapBinary(packets);
      else if (format === 'pcapng') rawBytes = encodePcapngBinary(packets);
      else rawBytes = new TextEncoder().encode(encodeRawBodiesText(packets));

      const filename = `sadnan_capture_${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`;
      const res = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          format,
          contentBase64: u8ToBase64(rawBytes),
          packetCount: packets.length,
        }),
      });
      if (!res.ok) throw new Error('Failed to create server share link');
      setStatusMsg(`Generated per-file download link for ${filename}`);
      onRefreshExports();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusyFormat(null);
    }
  };

  const downloadDirectly = (format: 'pcap' | 'pcapng' | 'txt') => {
    if (packets.length === 0) {
      setStatusMsg('No packets available to download.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (format === 'pcap') {
      triggerLocalDownload(`sadnan_${stamp}.pcap`, encodePcapBinary(packets), 'application/vnd.tcpdump.pcap');
    } else if (format === 'pcapng') {
      triggerLocalDownload(`sadnan_${stamp}.pcapng`, encodePcapngBinary(packets), 'application/x-pcapng');
    } else {
      triggerLocalDownload(
        `sadnan_bodies_${stamp}.txt`,
        new TextEncoder().encode(encodeRawBodiesText(packets)),
        'text/plain;charset=utf-8'
      );
    }
  };

  const copyLink = async (rec: ExportRecord) => {
    const fullUrl = `${window.location.origin}${rec.downloadUrl}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(rec.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setStatusMsg(fullUrl);
    }
  };

  const deleteExport = async (id: string) => {
    await fetch(`/api/exports/${id}`, { method: 'DELETE' });
    onRefreshExports();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">Export & Per-File Share Links</h2>
            <p className="text-xs text-[#90A4AE]">
              Generate binary .pcap, .pcapng, raw body .txt, or AES-256-GCM .encvault.json files with direct download links
            </p>
          </div>
          <span className="text-xs font-mono text-[#26A69A] tabular-nums">{packets.length} packets ready</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(
            [
              { fmt: 'pcapng', title: 'PCAPNG (.pcapng)', sub: 'Wireshark enhanced blocks' },
              { fmt: 'pcap', title: 'PCAP (.pcap)', sub: 'Nanosecond libpcap binary' },
              { fmt: 'txt', title: 'Raw Bodies (.txt)', sub: 'Decoded HTTP & payload log' },
            ] as const
          ).map((item) => (
            <div key={item.fmt} className="p-3.5 rounded-lg bg-[#181C22] border border-[#282F38] space-y-2.5">
              <div>
                <div className="text-xs font-semibold text-white">{item.title}</div>
                <div className="text-[11px] text-[#90A4AE]">{item.sub}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadDirectly(item.fmt)}
                  className="flex-1 px-2.5 py-1.5 rounded bg-[#121518] hover:bg-[#232933] border border-[#2F3742] text-xs text-white flex items-center justify-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save
                </button>
                <button
                  type="button"
                  disabled={busyFormat === item.fmt}
                  onClick={() => createServerShareExport(item.fmt)}
                  className="flex-1 px-2.5 py-1.5 rounded bg-[#00897B] hover:bg-[#00796B] text-xs font-semibold text-white flex items-center justify-center gap-1"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  {busyFormat === item.fmt ? 'Saving...' : 'Share Link'}
                </button>
              </div>
            </div>
          ))}

          <div className="p-3.5 rounded-lg bg-[#181C22] border border-[#282F38] space-y-2.5">
            <div>
              <div className="text-xs font-semibold text-white">Encrypted Vault (.encvault.json)</div>
              <div className="text-[11px] text-[#90A4AE]">Passphrase AES-256-GCM bundle</div>
            </div>
            <button
              type="button"
              onClick={onExportEncVault}
              className="w-full px-2.5 py-1.5 rounded bg-[#121518] hover:bg-[#232933] border border-[#2F3742] text-xs text-[#66BB6A] flex items-center justify-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              Export Encrypted Vault
            </button>
          </div>
        </div>

        {statusMsg && (
          <div className="px-3 py-2 rounded-lg bg-[#122624] border border-[#26A69A]/40 text-xs text-[#80CBC4]">
            {statusMsg}
          </div>
        )}
      </div>

      {/* Saved Share Links Table */}
      <div className="rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#282F38] flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Published Per-File Share Links</span>
          <button
            type="button"
            onClick={onRefreshExports}
            className="text-xs text-[#26A69A] hover:underline flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {exportsList.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#90A4AE] bg-[#181C22]">
            No published share links yet. Click "Share Link" on any format above to generate a direct download endpoint.
          </div>
        ) : (
          <div className="divide-y divide-[#232932]">
            {exportsList.map((rec) => {
              const fullUrl = `${window.location.origin}${rec.downloadUrl}`;
              const shareText = encodeURIComponent(`SADNAN CAPTURE export (${rec.filename}): ${fullUrl}`);
              return (
                <div key={rec.id} className="px-4 py-3 bg-[#181C22] flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-semibold text-white truncate">{rec.filename}</div>
                    <div className="text-[11px] font-mono text-[#90A4AE] tabular-nums">
                      {rec.format.toUpperCase()} · {rec.sizeBytes} bytes · {rec.packetCount} pkts · {rec.downloadUrl}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => copyLink(rec)}
                      className="px-2.5 py-1.5 rounded bg-[#121518] hover:bg-[#232933] border border-[#2F3742] text-xs text-white flex items-center gap-1"
                    >
                      {copiedId === rec.id ? <Check className="w-3.5 h-3.5 text-[#66BB6A]" /> : <Copy className="w-3.5 h-3.5" />}
                      Copy URL
                    </button>
                    <a
                      href={rec.downloadUrl}
                      download={rec.filename}
                      className="px-2.5 py-1.5 rounded bg-[#00897B] hover:bg-[#00796B] text-xs font-semibold text-white flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(fullUrl)}&text=${shareText}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1.5 rounded bg-[#121518] border border-[#2F3742] text-[11px] text-[#90A4AE] hover:text-white"
                    >
                      Telegram
                    </a>
                    <a
                      href={`https://wa.me/?text=${shareText}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1.5 rounded bg-[#121518] border border-[#2F3742] text-[11px] text-[#66BB6A] hover:text-white"
                    >
                      WhatsApp
                    </a>
                    <button
                      type="button"
                      onClick={() => deleteExport(rec.id)}
                      className="p-1.5 text-[#78909C] hover:text-[#EF5350]"
                      aria-label={`Delete export ${rec.filename}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 2. ENCRYPTED LOCAL VAULT & CRASH SESSION RECOVERY VIEW
 * ==========================================================================*/
export const EncryptedVaultView: React.FC<{
  passphrase: string;
  onChangePassphrase: (p: string) => void;
  vaultEnabled: boolean;
  onToggleVault: (enabled: boolean) => void;
  vaultChunkCount: number;
  sessions: VaultSessionMeta[];
  onRecoverSession: (sessionId: string) => Promise<void>;
  onClearVault: () => Promise<void>;
  onImportEncVaultFile: (file: File) => Promise<void>;
  onExportEncVaultFile: () => Promise<void>;
  vaultMessage: string | null;
}> = ({
  passphrase,
  onChangePassphrase,
  vaultEnabled,
  onToggleVault,
  vaultChunkCount,
  sessions,
  onRecoverSession,
  onClearVault,
  onImportEncVaultFile,
  onExportEncVaultFile,
  vaultMessage,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-[#66BB6A]" />
            <div>
              <h2 className="text-base font-semibold text-white">Local AES-256-GCM Encrypted Vault & Crash Recovery</h2>
              <p className="text-xs text-[#90A4AE]">
                WebCrypto PBKDF2-SHA256 + AES-256-GCM incremental chunk encryption stored in IndexedDB (Android Keystore equivalent in Kotlin)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onToggleVault(!vaultEnabled)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              vaultEnabled
                ? 'bg-[#66BB6A]/20 text-[#66BB6A] border border-[#66BB6A]/40'
                : 'bg-[#121518] text-[#B0BEC5] border border-[#2F3742]'
            }`}
          >
            {vaultEnabled ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            {vaultEnabled ? 'Auto-Encryption Enabled' : 'Enable Auto-Encryption'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-6 space-y-1">
            <label className="text-xs text-[#B0BEC5] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#FFA726]" />
              Vault Passphrase (used locally for PBKDF2 key derivation)
            </label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => onChangePassphrase(e.target.value)}
              placeholder="Enter local encryption passphrase..."
              className="w-full h-9 px-3 rounded-lg bg-[#121518] border border-[#282F38] text-xs font-mono text-white"
            />
          </div>

          <div className="md:col-span-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onExportEncVaultFile}
              className="px-3 h-9 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export .encvault.json
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.encvault.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await onImportEncVaultFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 h-9 rounded-lg bg-[#121518] hover:bg-[#232933] border border-[#2F3742] text-xs text-white flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              Import .encvault.json
            </button>
            <button
              type="button"
              onClick={onClearVault}
              className="px-3 h-9 rounded-lg bg-[#121518] hover:bg-[#2A1719] border border-[#EF5350]/40 text-xs text-[#EF5350]"
            >
              Wipe Local Vault
            </button>
          </div>
        </div>

        <div className="text-xs font-mono text-[#90A4AE]">
          Active session encrypted chunks written: <strong className="text-white">{vaultChunkCount}</strong>
        </div>

        {vaultMessage && (
          <div className="px-3 py-2 rounded-lg bg-[#122624] border border-[#26A69A]/40 text-xs text-[#80CBC4]">
            {vaultMessage}
          </div>
        )}
      </div>

      {/* Stored / Incomplete Sessions List */}
      <div className="rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#282F38] text-sm font-semibold text-white">
          IndexedDB Encrypted Capture Sessions & Recovery ({sessions.length})
        </div>
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#90A4AE] bg-[#181C22]">
            No encrypted capture sessions stored in IndexedDB yet.
          </div>
        ) : (
          <div className="divide-y divide-[#232932]">
            {sessions.map((sess) => (
              <div key={sess.sessionId} className="px-4 py-3 bg-[#181C22] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono font-semibold text-white">
                    {sess.sessionId}{' '}
                    <span className={sess.status === 'ACTIVE' ? 'text-[#FFA726]' : 'text-[#66BB6A]'}>
                      · {sess.status === 'ACTIVE' ? 'INCOMPLETE / RECOVERABLE' : 'CLOSED CLEAN'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#90A4AE] tabular-nums">
                    Updated: {new Date(sess.updatedAtMs).toLocaleString()} · {sess.totalPackets} encrypted packets
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRecoverSession(sess.sessionId)}
                  className="px-3 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Decrypt & Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. LIVE SERVER TCP / UDP / HTTP / HTTPS PORT-PROBE TEST LAB
 * ==========================================================================*/
export const ProbeTestLabView: React.FC<{
  onIngestProbePackets: (packets: ProbeResultPacket[], modeLabel: string) => void;
}> = ({ onIngestProbePackets }) => {
  const [mode, setMode] = useState<'TCP' | 'UDP' | 'HTTP' | 'HTTPS_TLS'>('HTTP');
  const [targetPreset, setTargetPreset] = useState('json');
  const [customPayload, setCustomPayload] = useState('SADNAN_PROBE_HELLO');
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<ProbeResponse | null>(null);

  const runProbe = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, targetPreset, customPayload }),
      });
      const data = (await res.json()) as ProbeResponse;
      setLastResult(data);
      if (data.ok && data.packets.length > 0) {
        onIngestProbePackets(data.packets, `${data.mode} (${data.target})`);
      }
    } catch (err) {
      setLastResult({
        ok: false,
        mode,
        target: 'probe',
        latencyMs: 0,
        packets: [],
        error: err instanceof Error ? err.message : 'Probe request failed',
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-[#26A69A]" />
          <div>
            <h2 className="text-base font-semibold text-white">Live Server TCP / UDP / HTTP / HTTPS Probe Test Lab</h2>
            <p className="text-xs text-[#90A4AE]">
              Executes real Node.js sockets against built-in sandbox listeners and allowlisted diagnostic HTTPS endpoints, injecting live wire frames into the dissector
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-3 space-y-1">
            <label className="text-xs text-[#90A4AE]">Probe Protocol</label>
            <select
              value={mode}
              onChange={(e) => {
                const next = e.target.value as 'TCP' | 'UDP' | 'HTTP' | 'HTTPS_TLS';
                setMode(next);
                if (next === 'HTTP') setTargetPreset('json');
                if (next === 'HTTPS_TLS') setTargetPreset('cloudflare-doh');
              }}
              className="w-full h-9 px-2.5 rounded-lg bg-[#121518] border border-[#282F38] text-xs text-white"
            >
              <option value="HTTP">Live HTTP/1.1 (Sandbox)</option>
              <option value="TCP">Live TCP Socket (Sandbox)</option>
              <option value="UDP">Live UDP Datagram (Sandbox)</option>
              <option value="HTTPS_TLS">Live HTTPS / TLS Handshake</option>
            </select>
          </div>

          {mode === 'HTTP' && (
            <div className="md:col-span-6 space-y-1">
              <label className="text-xs text-[#90A4AE]">HTTP Endpoint Mode</label>
              <select
                value={targetPreset}
                onChange={(e) => setTargetPreset(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg bg-[#121518] border border-[#282F38] text-xs text-white"
              >
                <option value="json">GET /json (JSON Response Body)</option>
                <option value="html">GET /html (Transfer-Encoding: chunked HTML)</option>
              </select>
            </div>
          )}

          {mode === 'HTTPS_TLS' && (
            <div className="md:col-span-6 space-y-1">
              <label className="text-xs text-[#90A4AE]">Allowlisted TLS Diagnostic Endpoint</label>
              <select
                value={targetPreset}
                onChange={(e) => setTargetPreset(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg bg-[#121518] border border-[#282F38] text-xs text-white"
              >
                <option value="cloudflare-doh">cloudflare-dns.com:443 (DoH TLS 1.3)</option>
                <option value="google-dns">dns.google:443 (Google DNS TLS)</option>
                <option value="github-api">api.github.com:443 (GitHub TLS)</option>
              </select>
            </div>
          )}

          {(mode === 'TCP' || mode === 'UDP') && (
            <div className="md:col-span-6 space-y-1">
              <label className="text-xs text-[#90A4AE]">Outbound Socket Payload</label>
              <input
                type="text"
                value={customPayload}
                onChange={(e) => setCustomPayload(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-[#121518] border border-[#282F38] text-xs font-mono text-white"
              />
            </div>
          )}

          <div className="md:col-span-3 flex items-end">
            <button
              type="button"
              disabled={running}
              onClick={runProbe}
              className="w-full h-9 rounded-lg bg-[#00897B] hover:bg-[#00796B] disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {running ? 'Probing...' : 'Execute Live Probe'}
            </button>
          </div>
        </div>

        {lastResult && (
          <div className="p-3.5 rounded-lg bg-[#181C22] border border-[#282F38] space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className={lastResult.ok ? 'text-[#66BB6A] font-semibold' : 'text-[#EF5350] font-semibold'}>
                {lastResult.ok ? 'PROBE SUCCEEDED' : 'PROBE FAILED'} · {lastResult.mode} → {lastResult.target}
              </span>
              <span className="text-[#90A4AE] tabular-nums">{lastResult.latencyMs} ms</span>
            </div>
            {lastResult.tlsInfo && (
              <div className="text-[#FFA726]">
                TLS: {lastResult.tlsInfo.protocol} · Cipher: {lastResult.tlsInfo.cipher} · CN={lastResult.tlsInfo.subjectCn} · Issuer={lastResult.tlsInfo.issuerO}
              </div>
            )}
            {lastResult.error ? (
              <div className="text-[#EF5350]">{lastResult.error}</div>
            ) : (
              <div className="text-[#B0BEC5]">
                Injected {lastResult.packets.length} live wire packet(s) into Connections & Packet Stream. Open Connections to inspect Raw Response Body.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 4. ANDROID STUDIO KOTLIN / COMPOSE APK SOURCE VIEW
 * ==========================================================================*/
interface AndroidFileItem {
  path: string;
  content: string;
  description: string;
}

export const AndroidApkSourceView: React.FC = () => {
  const [files, setFiles] = useState<AndroidFileItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/android-project/files')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.files || []) as AndroidFileItem[];
        setFiles(list);
        if (list.length > 0) setSelectedPath(list[0].path);
      })
      .finally(() => setLoading(false));
  }, []);

  const currentFile = files.find((f) => f.path === selectedPath) || files[0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileArchive className="w-5 h-5 text-[#26A69A]" />
          <div>
            <h2 className="text-base font-semibold text-white">Android Studio Kotlin / Jetpack Compose APK Source (com.sadnan.capture)</h2>
            <p className="text-xs text-[#90A4AE]">
              100% free, open-source non-root VpnService + FloatingOverlayService + Keystore AES-256-GCM + FileProvider Gradle project
            </p>
          </div>
        </div>

        <a
          href="/api/android-project.zip"
          download="sadnan-capture-android-studio.zip"
          className="px-4 py-2 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          Download Android Studio ZIP
        </a>
      </div>

      {loading ? (
        <div className="p-8 rounded-xl bg-[#1C2026] border border-[#282F38] text-center text-xs text-[#90A4AE]">
          Loading Android Studio project tree...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-[#282F38] text-xs font-semibold text-white">
              Project Files ({files.length})
            </div>
            <div className="divide-y divide-[#232932] max-h-[540px] overflow-y-auto">
              {files.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={`w-full text-left px-3.5 py-2.5 transition-colors ${
                    f.path === currentFile?.path
                      ? 'bg-[#00897B]/20 text-white'
                      : 'bg-[#181C22] hover:bg-[#20262F] text-[#B0BEC5]'
                  }`}
                >
                  <div className="text-xs font-mono truncate">{f.path}</div>
                  <div className="text-[11px] text-[#78909C] truncate mt-0.5">{f.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-8 rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-[#282F38] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Code2 className="w-4 h-4 text-[#26A69A] shrink-0" />
                <span className="text-xs font-mono text-white truncate">{currentFile?.path}</span>
              </div>
              <span className="text-[11px] text-[#90A4AE] shrink-0">Kotlin / Gradle</span>
            </div>
            <pre className="p-4 bg-[#121518] text-xs font-mono text-[#CFD8DC] overflow-auto max-h-[540px] leading-relaxed">
              {currentFile?.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
