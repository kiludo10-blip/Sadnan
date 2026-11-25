import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Database,
  FileCode2,
  FileUp,
  KeyRound,
  Lock,
  Play,
  Shield,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { FRIENDLY_APP_OPTIONS } from '../engine/enrichment';
import { SAMPLE_SSLKEYLOG_CONTENT } from '../engine/trafficGenerator';
import {
  CaptureError,
  CapturedPacket,
  DumpMode,
  FriendlyAppId,
  KeylogEntry,
} from '../types/capture';
import { AppIconBadge } from './AppIconBadge';

interface Props {
  isCapturing: boolean;
  onToggleCapture: () => void;
  selectedApp: FriendlyAppId;
  onSelectApp: (id: FriendlyAppId) => void;
  dumpMode: DumpMode;
  onChangeDumpMode: (m: DumpMode) => void;
  packets: CapturedPacket[];
  packetsPerSec: number;
  droppedPackets: number;
  bufferCapacity: number;
  onChangeBufferCapacity: (cap: number) => void;
  errors: CaptureError[];
  keylogEntries: KeylogEntry[];
  onLoadKeylog: (text: string) => void;
  onImportPcapFile: (file: File) => void;
  vaultEnabled: boolean;
  vaultChunkCount: number;
  firewallRuleCount: number;
  alertCount: number;
  onOpenFirewall: () => void;
  onOpenVaultPanel: () => void;
}

type StatusModal = 'apps' | 'dump' | 'keylog' | 'buffer' | null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const StatusScreen: React.FC<Props> = ({
  isCapturing,
  onToggleCapture,
  selectedApp,
  onSelectApp,
  dumpMode,
  onChangeDumpMode,
  packets,
  packetsPerSec,
  droppedPackets,
  bufferCapacity,
  onChangeBufferCapacity,
  errors,
  keylogEntries,
  onLoadKeylog,
  onImportPcapFile,
  vaultEnabled,
  vaultChunkCount,
  firewallRuleCount,
  alertCount,
  onOpenFirewall,
  onOpenVaultPanel,
}) => {
  const [activeModal, setActiveModal] = useState<StatusModal>(null);
  const [keylogText, setKeylogText] = useState('');
  const keylogFileRef = useRef<HTMLInputElement>(null);
  const pcapFileRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    let upload = 0;
    let download = 0;
    let matchedTls = 0;
    for (const p of packets) {
      if (p.direction === 'OUTBOUND') upload += p.totalLength;
      else download += p.totalLength;
      if (p.tls?.matchedKeylogSecret) matchedTls += 1;
    }
    return { total: upload + download, upload, download, matchedTls };
  }, [packets]);

  const currentApp =
    FRIENDLY_APP_OPTIONS.find((a) => a.id === selectedApp) || FRIENDLY_APP_OPTIONS[0];

  const dumpLabel =
    dumpMode === 'PCAPNG'
      ? 'PCAPNG file'
      : dumpMode === 'PCAP'
        ? 'PCAP file'
        : 'Raw Body text';

  const fillPct = Math.min(100, Math.round((packets.length / Math.max(1, bufferCapacity)) * 100));
  const ringCircumference = 2 * Math.PI * 84;
  const ringOffset = ringCircumference - (fillPct / 100) * ringCircumference;

  return (
    <div className="max-w-xl mx-auto">
      {/* Exact PCAPdroid Hero Ring Zone */}
      <div className="pt-4 pb-6 flex flex-col items-center">
        <button
          type="button"
          onClick={onToggleCapture}
          className="relative w-48 h-48 rounded-full flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#26A69A] group"
          aria-label={isCapturing ? 'Stop packet capture' : 'Start packet capture'}
        >
          <svg className="w-48 h-48 -rotate-90" viewBox="0 0 200 200">
            <circle
              cx="100"
              cy="100"
              r="84"
              fill="#181C22"
              stroke={isCapturing ? '#1D3331' : '#262C35'}
              strokeWidth="6"
            />
            <circle
              cx="100"
              cy="100"
              r="84"
              fill="none"
              stroke={isCapturing ? '#26A69A' : '#00897B'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={ringCircumference}
              strokeDashoffset={isCapturing ? ringOffset : ringCircumference * 0.12}
              className="transition-all duration-300"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {isCapturing ? (
              <Square className="w-7 h-7 text-[#EF5350] fill-current mb-1.5 group-hover:scale-105 transition-transform" />
            ) : (
              <Play className="w-7 h-7 text-[#26A69A] fill-current ml-0.5 mb-1.5 group-hover:scale-105 transition-transform" />
            )}
            <span className="font-display text-lg font-bold tracking-wide text-white">
              {isCapturing ? 'CAPTURING' : 'READY'}
            </span>
            <span className="text-xs font-mono tabular-nums text-[#90A4AE] mt-0.5">
              {formatBytes(stats.total)}
            </span>
          </div>
        </button>

        {/* Clean Unboxed PCAPdroid Telemetry Row */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs font-mono tabular-nums text-[#B0BEC5]">
          <span className="flex items-center gap-1">
            <ArrowUp className="w-3.5 h-3.5 text-[#FFA726]" />
            {formatBytes(stats.upload)}
          </span>
          <span className="flex items-center gap-1">
            <ArrowDown className="w-3.5 h-3.5 text-[#66BB6A]" />
            {formatBytes(stats.download)}
          </span>
          <span>{packets.length} pkts</span>
          {isCapturing && <span className="text-[#26A69A]">{packetsPerSec} pkt/s</span>}
          {droppedPackets > 0 && <span className="text-[#EF5350]">{droppedPackets} drops</span>}
        </div>
      </div>

      {/* Exact PCAPdroid Material Settings List Rows */}
      <div className="rounded-xl bg-[#181C22] border border-[#242A33] divide-y divide-[#232932] overflow-hidden">
        {/* Row 1: Traffic Dump */}
        <button
          type="button"
          onClick={() => setActiveModal('dump')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#1F242C] transition-colors text-left"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <FileCode2 className="w-5 h-5 text-[#26A69A] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">Traffic dump</div>
              <div className="text-xs text-[#90A4AE] truncate">{dumpLabel}</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#546E7A] shrink-0" />
        </button>

        {/* Row 2: Target Apps (Friendly Names & Icons only) */}
        <button
          type="button"
          onClick={() => setActiveModal('apps')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#1F242C] transition-colors text-left"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <AppIconBadge appId={currentApp.id} size={28} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">Target apps</div>
              <div className="text-xs text-[#90A4AE] truncate">{currentApp.displayName}</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#546E7A] shrink-0" />
        </button>

        {/* Row 3: TLS Keylog (SSLKEYLOGFILE) */}
        <button
          type="button"
          onClick={() => setActiveModal('keylog')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#1F242C] transition-colors text-left"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <KeyRound className="w-5 h-5 text-[#FFA726] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">TLS keylog</div>
              <div className="text-xs text-[#90A4AE] truncate tabular-nums">
                {keylogEntries.length === 0
                  ? 'No SSLKEYLOGFILE loaded'
                  : `${keylogEntries.length} keylog entries · ${stats.matchedTls} ClientHello matched`}
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#546E7A] shrink-0" />
        </button>

        {/* Row 4: Firewall & Malware Alerts */}
        <button
          type="button"
          onClick={onOpenFirewall}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#1F242C] transition-colors text-left"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <Shield className="w-5 h-5 text-[#EF5350] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">Firewall & alerts</div>
              <div className="text-xs text-[#90A4AE] truncate tabular-nums">
                {firewallRuleCount} active rules · {alertCount} alert{alertCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#546E7A] shrink-0" />
        </button>

        {/* Row 5: Ring Buffer & AES-256-GCM Vault */}
        <button
          type="button"
          onClick={() => setActiveModal('buffer')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#1F242C] transition-colors text-left"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <Database className="w-5 h-5 text-[#66BB6A] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">Capture buffer & encryption</div>
              <div className="text-xs text-[#90A4AE] truncate tabular-nums">
                {bufferCapacity.toLocaleString()} pkt ring ·{' '}
                {vaultEnabled ? `AES-256-GCM (${vaultChunkCount} chunks)` : 'Vault paused'}
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#546E7A] shrink-0" />
        </button>
      </div>

      {/* Hidden file inputs for PCAP import & Keylog upload */}
      <input
        ref={pcapFileRef}
        type="file"
        accept=".pcap,.pcapng,.cap"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportPcapFile(file);
          e.target.value = '';
          setActiveModal(null);
        }}
      />
      <input
        ref={keylogFileRef}
        type="file"
        accept=".log,.txt"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            const txt = await file.text();
            setKeylogText(txt);
            onLoadKeylog(txt);
          }
          e.target.value = '';
        }}
      />

      {/* Clean Material Modal Sheets */}
      {activeModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-[2px] p-0 sm:p-4"
          role="dialog"
          aria-label="Capture configuration sheet"
        >
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl bg-[#1C2026] border border-[#2C333E] overflow-hidden shadow-2xl">
            <div className="px-4 py-3 border-b border-[#282F38] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                {activeModal === 'apps' && 'Target Apps'}
                {activeModal === 'dump' && 'Traffic Dump'}
                {activeModal === 'keylog' && 'TLS Keylog (SSLKEYLOGFILE)'}
                {activeModal === 'buffer' && 'Capture Buffer & Encryption'}
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="p-1.5 text-[#90A4AE] hover:text-white rounded-lg"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeModal === 'apps' && (
              <div>
                <div className="divide-y divide-[#252B34]">
                  {FRIENDLY_APP_OPTIONS.map((app) => {
                    const active = selectedApp === app.id;
                    return (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => {
                          onSelectApp(app.id);
                          setActiveModal(null);
                        }}
                        className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors ${
                          active ? 'bg-[#00897B]/15' : 'bg-[#181C22] hover:bg-[#20262E]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <AppIconBadge appId={app.id} size={34} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate">{app.displayName}</div>
                            <div className="text-xs text-[#90A4AE] truncate">{app.description}</div>
                          </div>
                        </div>
                        {active && <Check className="w-4 h-4 text-[#26A69A] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                <div className="px-4 py-3 bg-[#15181D] border-t border-[#252B34] text-[11px] text-[#90A4AE]">
                  Uses Android <code className="text-[#CFD8DC]">VpnService.Builder.addAllowedApplication()</code>. System DNS or OS sockets may still carry platform attribution.
                </div>
              </div>
            )}

            {activeModal === 'dump' && (
              <div className="p-4 space-y-3">
                <div className="space-y-2">
                  {(
                    [
                      { id: 'PCAPNG', title: 'PCAPNG', desc: 'Enhanced blocks + interface metadata' },
                      { id: 'PCAP', title: 'PCAP', desc: 'Classic nanosecond libpcap binary' },
                      { id: 'RAW_BODY', title: 'Raw Body', desc: 'Decoded HTTP & payload text' },
                    ] as { id: DumpMode; title: string; desc: string }[]
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        onChangeDumpMode(mode.id);
                        setActiveModal(null);
                      }}
                      className={`w-full px-3.5 py-2.5 rounded-lg border flex items-center justify-between text-left ${
                        dumpMode === mode.id
                          ? 'bg-[#00897B]/20 border-[#26A69A] text-white'
                          : 'bg-[#181C22] border-[#282F38] text-[#B0BEC5]'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-mono font-bold">{mode.title}</div>
                        <div className="text-[11px] text-[#90A4AE]">{mode.desc}</div>
                      </div>
                      {dumpMode === mode.id && <Check className="w-4 h-4 text-[#26A69A]" />}
                    </button>
                  ))}
                </div>

                <div className="pt-2 border-t border-[#282F38]">
                  <button
                    type="button"
                    onClick={() => pcapFileRef.current?.click()}
                    className="w-full py-2.5 rounded-lg bg-[#121518] hover:bg-[#232933] border border-[#2F3742] text-xs font-medium text-white flex items-center justify-center gap-2"
                  >
                    <FileUp className="w-4 h-4 text-[#26A69A]" />
                    Import Existing .pcap / .pcapng File
                  </button>
                </div>
              </div>
            )}

            {activeModal === 'keylog' && (
              <div className="p-4 space-y-3">
                <p className="text-xs text-[#90A4AE]">
                  Import <code className="text-[#ECEFF1]">CLIENT_RANDOM</code> entries to match ClientHello handshakes without fabricating decryption.
                </p>
                <textarea
                  value={keylogText}
                  onChange={(e) => setKeylogText(e.target.value)}
                  placeholder="CLIENT_RANDOM <64-hex> <96-hex>"
                  rows={4}
                  className="w-full rounded-lg bg-[#121518] border border-[#282F38] p-2.5 text-xs font-mono text-white placeholder-[#546E7A]"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setKeylogText(SAMPLE_SSLKEYLOG_CONTENT);
                        onLoadKeylog(SAMPLE_SSLKEYLOG_CONTENT);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-[#121518] border border-[#2F3742] text-xs text-[#FFA726]"
                    >
                      Load Sample
                    </button>
                    <button
                      type="button"
                      onClick={() => keylogFileRef.current?.click()}
                      className="px-2.5 py-1.5 rounded-lg bg-[#121518] border border-[#2F3742] text-xs text-white flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onLoadKeylog(keylogText);
                      setActiveModal(null);
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-xs font-semibold text-white"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}

            {activeModal === 'buffer' && (
              <div className="p-4 space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#B0BEC5]">Ring Buffer Capacity</span>
                    <span className="font-mono tabular-nums text-white">{bufferCapacity.toLocaleString()} packets</span>
                  </div>
                  <input
                    type="range"
                    min={500}
                    max={25000}
                    step={500}
                    value={bufferCapacity}
                    onChange={(e) => onChangeBufferCapacity(Number(e.target.value))}
                    className="w-full accent-[#00897B]"
                  />
                  <div className="flex justify-between text-[11px] font-mono text-[#78909C]">
                    <span>500</span>
                    <span>Occupancy: {fillPct}%</span>
                    <span>25,000</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#121518] border border-[#282F38] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-[#B0BEC5]">
                    <Lock className="w-4 h-4 text-[#66BB6A]" />
                    <span>AES-256-GCM Local Vault</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModal(null);
                      onOpenVaultPanel();
                    }}
                    className="text-[#26A69A] font-semibold hover:underline"
                  >
                    Open Vault
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs text-[#B0BEC5] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#FFA726]" />
                    Capture Error Log ({errors.length})
                  </div>
                  <div className="max-h-28 overflow-y-auto rounded-lg bg-[#121518] border border-[#282F38] p-2.5 text-[11px] font-mono space-y-1">
                    {errors.length === 0 ? (
                      <div className="text-[#78909C]">No buffer drops or capture warnings.</div>
                    ) : (
                      errors.map((err) => (
                        <div key={err.id} className="text-[#FFE0B2]">
                          [{new Date(err.timestampMs).toLocaleTimeString()}] {err.code}: {err.message}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
