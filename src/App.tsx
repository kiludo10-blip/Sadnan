import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  Database,
  Gamepad2,
  Lock,
  Menu,
  PictureInPicture2,
  Play,
  RotateCcw,
  Share2,
  Shield,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { ConnectionsScreen } from './components/ConnectionsScreen';
import { FirewallAlertsView } from './components/FirewallAlertsModal';
import { FloatingOverlayWidget } from './components/FloatingOverlayWidget';
import { GameMonitorScreen } from './components/GameMonitorScreen';
import { PacketDetailDrawer } from './components/PacketDetailDrawer';
import {
  AndroidApkSourceView,
  EncryptedVaultView,
  ProbeTestLabView,
  ShareExportsView,
} from './components/ShareVaultProbeViews';
import { StatusScreen } from './components/StatusScreen';
import { dissectRawIpPacket, parseSslKeylogFile } from './engine/dissector';
import { FRIENDLY_APP_OPTIONS } from './engine/enrichment';
import { parsePcapOrPcapngFile } from './engine/pcap';
import { PacketRingBuffer } from './engine/ringBuffer';
import { generateSandboxPacketBatch } from './engine/trafficGenerator';
import {
  b64ToU8,
  clearVaultStorage,
  createSaltBase64,
  decryptPacketChunk,
  deriveAesGcmKey,
  EncVaultFile,
  encryptPacketChunk,
  getSessionChunks,
  listVaultSessions,
  saveEncryptedChunk,
  saveVaultSessionMeta,
  VaultSessionMeta,
} from './engine/vault';
import {
  CaptureError,
  CapturedPacket,
  ConnectionFlow,
  DumpMode,
  ExportRecord,
  FirewallRule,
  FirewallRuleType,
  FriendlyAppId,
  KeylogEntry,
  ProbeResultPacket,
  ThreatAlert,
} from './types/capture';

type WorkspaceSection =
  | 'workbench'
  | 'game_monitor'
  | 'firewall'
  | 'vault'
  | 'share'
  | 'probe_lab'
  | 'android_apk';

type PrimaryTab = 'STATUS' | 'CONNECTIONS';

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSection>('workbench');
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('STATUS');
  const [overlayVisible, setOverlayVisible] = useState(false);

  const [isCapturing, setIsCapturing] = useState(false);
  const [selectedApp, setSelectedApp] = useState<FriendlyAppId>('all');
  const [dumpMode, setDumpMode] = useState<DumpMode>('PCAPNG');
  const [bufferCapacity, setBufferCapacity] = useState(5000);

  const ringRef = useRef<PacketRingBuffer>(new PacketRingBuffer(5000));
  const seqRef = useRef<number>(1);
  const tickRef = useRef<number>(0);

  const [packets, setPackets] = useState<CapturedPacket[]>([]);
  const [droppedPackets, setDroppedPackets] = useState(0);
  const [errors, setErrors] = useState<CaptureError[]>([]);
  const [packetsPerSec, setPacketsPerSec] = useState(0);
  const [selectedPacket, setSelectedPacket] = useState<CapturedPacket | null>(null);

  const [keylogEntries, setKeylogEntries] = useState<KeylogEntry[]>([]);
  const [firewallRules, setFirewallRules] = useState<FirewallRule[]>([
    {
      id: 'fw-default-1',
      type: 'PORT',
      value: '23',
      label: 'Block Insecure Telnet',
      enabled: true,
      hitCount: 0,
      createdAtMs: Date.now(),
    },
  ]);

  // Encrypted Vault State
  const [vaultPassphrase, setVaultPassphrase] = useState('sadnan-local-vault');
  const [vaultEnabled, setVaultEnabled] = useState(true);
  const [vaultChunkCount, setVaultChunkCount] = useState(0);
  const [vaultSessions, setVaultSessions] = useState<VaultSessionMeta[]>([]);
  const [recoverableSession, setRecoverableSession] = useState<VaultSessionMeta | null>(null);
  const [vaultMessage, setVaultMessage] = useState<string | null>(null);
  const activeVaultRef = useRef<{
    sessionId: string;
    saltBase64: string;
    key: CryptoKey | null;
    chunkIdx: number;
    pending: CapturedPacket[];
    totalEncrypted: number;
  } | null>(null);

  // Server Exports State
  const [exportsList, setExportsList] = useState<ExportRecord[]>([]);

  const syncFromRing = useCallback(() => {
    setPackets([...ringRef.current.getAll()]);
    setDroppedPackets(ringRef.current.getDroppedCount());
    setErrors([...ringRef.current.getErrors()]);
  }, []);

  const refreshExports = useCallback(async () => {
    try {
      const res = await fetch('/api/exports');
      if (res.ok) {
        const d = await res.json();
        setExportsList(d.exports || []);
      }
    } catch {
      // ignore offline transient fetch error
    }
  }, []);

  const refreshVaultSessions = useCallback(async () => {
    try {
      const list = await listVaultSessions();
      setVaultSessions(list);
      const incomplete = list.find((s) => s.status === 'ACTIVE' && s.totalPackets > 0);
      setRecoverableSession(incomplete || null);
    } catch {
      // IndexedDB unavailable
    }
  }, []);

  useEffect(() => {
    refreshExports();
    refreshVaultSessions();
  }, [refreshExports, refreshVaultSessions]);

  // Flush incremental AES-256-GCM vault chunks
  const enqueueVaultChunk = useCallback(
    async (newPackets: CapturedPacket[]) => {
      if (!vaultEnabled || !vaultPassphrase.trim() || newPackets.length === 0) return;
      try {
        if (!activeVaultRef.current) {
          const saltBase64 = createSaltBase64();
          const key = await deriveAesGcmKey(vaultPassphrase, b64ToU8(saltBase64));
          const sessionId = `vault_${Date.now().toString(36)}`;
          activeVaultRef.current = {
            sessionId,
            saltBase64,
            key,
            chunkIdx: 0,
            pending: [],
            totalEncrypted: 0,
          };
        }
        const ctx = activeVaultRef.current;
        if (!ctx.key) return;
        ctx.pending.push(...newPackets);
        if (ctx.pending.length >= 4) {
          const batch = ctx.pending.splice(0, ctx.pending.length);
          const chunk = await encryptPacketChunk(batch, ctx.key, ctx.sessionId, ctx.chunkIdx++);
          await saveEncryptedChunk(chunk);
          ctx.totalEncrypted += batch.length;
          await saveVaultSessionMeta({
            sessionId: ctx.sessionId,
            saltBase64: ctx.saltBase64,
            status: 'ACTIVE',
            startedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            totalPackets: ctx.totalEncrypted,
            appId: selectedApp,
          });
          setVaultChunkCount(ctx.chunkIdx);
          refreshVaultSessions();
        }
      } catch (err) {
        ringRef.current.recordError(
          'VAULT_ENCRYPT_ERR',
          err instanceof Error ? err.message : 'Vault encryption error'
        );
      }
    },
    [vaultEnabled, vaultPassphrase, selectedApp, refreshVaultSessions]
  );

  const pushPacketsIntoPipeline = useCallback(
    (incoming: CapturedPacket[]) => {
      if (incoming.length === 0) return;
      // Update firewall hit counts
      const blockedReasons = incoming.filter((p) => p.blocked && p.blockReason).map((p) => p.blockReason);
      if (blockedReasons.length > 0) {
        setFirewallRules((prev) =>
          prev.map((r) => {
            const key = `${r.type}: ${r.value}`;
            const hits = blockedReasons.filter((b) => b === key).length;
            return hits > 0 ? { ...r, hitCount: r.hitCount + hits } : r;
          })
        );
      }
      ringRef.current.pushBatch(incoming);
      syncFromRing();
      enqueueVaultChunk(incoming);
    },
    [syncFromRing, enqueueVaultChunk]
  );

  // Capture Loop
  useEffect(() => {
    if (!isCapturing) {
      setPacketsPerSec(0);
      return;
    }

    let secCount = 0;
    const ppsTimer = setInterval(() => {
      setPacketsPerSec(secCount);
      secCount = 0;
    }, 1000);

    const streamTimer = setInterval(() => {
      const batch = generateSandboxPacketBatch({
        selectedApp,
        startSeq: seqRef.current,
        tick: tickRef.current++,
        keylogEntries,
        firewallRules,
      });
      seqRef.current += batch.length;
      secCount += batch.length;
      pushPacketsIntoPipeline(batch);
    }, 550);

    return () => {
      clearInterval(streamTimer);
      clearInterval(ppsTimer);
    };
  }, [isCapturing, selectedApp, keylogEntries, firewallRules, pushPacketsIntoPipeline]);

  const toggleCapture = async () => {
    if (isCapturing) {
      setIsCapturing(false);
      // Mark active vault session cleanly closed
      if (activeVaultRef.current) {
        const ctx = activeVaultRef.current;
        if (ctx.pending.length > 0 && ctx.key) {
          const chunk = await encryptPacketChunk(ctx.pending, ctx.key, ctx.sessionId, ctx.chunkIdx++);
          await saveEncryptedChunk(chunk);
          ctx.totalEncrypted += ctx.pending.length;
          ctx.pending = [];
        }
        await saveVaultSessionMeta({
          sessionId: ctx.sessionId,
          saltBase64: ctx.saltBase64,
          status: 'CLOSED_CLEAN',
          startedAtMs: Date.now(),
          updatedAtMs: Date.now(),
          totalPackets: ctx.totalEncrypted,
          appId: selectedApp,
        });
        activeVaultRef.current = null;
        refreshVaultSessions();
      }
    } else {
      setIsCapturing(true);
    }
  };

  // Derived Flows & Alerts
  const flows = useMemo<ConnectionFlow[]>(() => {
    const map = new Map<string, ConnectionFlow>();
    for (const pkt of packets) {
      const isOut = pkt.direction === 'OUTBOUND';
      const localIp = isOut ? pkt.srcIp : pkt.dstIp;
      const localPort = isOut ? pkt.srcPort : pkt.dstPort;
      const remoteIp = isOut ? pkt.dstIp : pkt.srcIp;
      const remotePort = isOut ? pkt.dstPort : pkt.srcPort;
      const key = `${pkt.appId}|${pkt.transportProtocol}|${remoteIp}|${remotePort}|${localPort}`;
      const domain = pkt.tls?.sni || pkt.dns?.queryName || pkt.http?.headers['host'];

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          flowKey: key,
          appId: pkt.appId,
          appName: pkt.appName,
          ipVersion: pkt.ipVersion,
          localIp,
          localPort,
          remoteIp,
          remotePort,
          protocol: pkt.protocol,
          transportProtocol: pkt.transportProtocol,
          packetCount: 1,
          uploadBytes: isOut ? pkt.totalLength : 0,
          downloadBytes: isOut ? 0 : pkt.totalLength,
          firstSeenMs: pkt.timestampMs,
          lastSeenMs: pkt.timestampMs,
          durationMs: 0,
          sniOrDomain: domain,
          enrichment: pkt.enrichment,
          blocked: pkt.blocked,
          hasEncryptedTraffic: Boolean(pkt.tls?.isEncryptedPayload || pkt.quic?.isEncryptedPayload),
          latestFlags: pkt.tcp?.flagString,
          packetIds: [pkt.id],
        });
      } else {
        existing.packetCount += 1;
        if (isOut) existing.uploadBytes += pkt.totalLength;
        else existing.downloadBytes += pkt.totalLength;
        existing.lastSeenMs = Math.max(existing.lastSeenMs, pkt.timestampMs);
        existing.durationMs = Math.max(0, existing.lastSeenMs - existing.firstSeenMs);
        if (!existing.sniOrDomain && domain) existing.sniOrDomain = domain;
        if (pkt.blocked) existing.blocked = true;
        if (pkt.tls?.isEncryptedPayload || pkt.quic?.isEncryptedPayload) existing.hasEncryptedTraffic = true;
        if (pkt.tcp?.flagString) existing.latestFlags = pkt.tcp.flagString;
        existing.packetIds.push(pkt.id);
      }
    }
    return Array.from(map.values());
  }, [packets]);

  const allAlerts = useMemo<ThreatAlert[]>(() => {
    const out: ThreatAlert[] = [];
    for (let i = packets.length - 1; i >= 0; i--) {
      out.push(...packets[i].alerts);
    }
    return out;
  }, [packets]);

  const handleImportPcapFile = async (file: File) => {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const appObj = FRIENDLY_APP_OPTIONS.find((a) => a.id === selectedApp) || FRIENDLY_APP_OPTIONS[0];
      const parsed = parsePcapOrPcapngFile(buf, {
        startSeq: seqRef.current,
        appId: appObj.id,
        appName: appObj.displayName,
        keylogEntries,
        firewallRules,
      });
      if (parsed.length === 0) {
        ringRef.current.recordError('PCAP_IMPORT_EMPTY', `No IPv4/IPv6 packets found in ${file.name}`);
        syncFromRing();
        return;
      }
      seqRef.current += parsed.length;
      pushPacketsIntoPipeline(parsed);
      setPrimaryTab('CONNECTIONS');
    } catch (err) {
      ringRef.current.recordError(
        'PCAP_IMPORT_ERR',
        err instanceof Error ? err.message : 'Failed to parse capture file'
      );
      syncFromRing();
    }
  };

  const handleIngestProbePackets = (probePackets: ProbeResultPacket[]) => {
    const appObj = FRIENDLY_APP_OPTIONS.find((a) => a.id === selectedApp) || FRIENDLY_APP_OPTIONS[0];
    const dissected: CapturedPacket[] = [];
    for (const pp of probePackets) {
      const rawBytes = b64ToU8(pp.rawBytesBase64);
      const pkt = dissectRawIpPacket(rawBytes, {
        sequence: seqRef.current++,
        appId: appObj.id,
        appName: appObj.displayName,
        direction: pp.direction,
        keylogEntries,
        firewallRules,
        sourceOrigin: 'SERVER_PROBE',
        forceProtocolHint: pp.protocol,
      });
      if (pkt) dissected.push(pkt);
    }
    pushPacketsIntoPipeline(dissected);
  };

  const handleRecoverSession = async (sessionId: string) => {
    try {
      const meta = vaultSessions.find((s) => s.sessionId === sessionId);
      if (!meta) return;
      const chunks = await getSessionChunks(sessionId);
      const key = await deriveAesGcmKey(vaultPassphrase, b64ToU8(meta.saltBase64));
      const restored: CapturedPacket[] = [];
      for (const ch of chunks) {
        const pkts = await decryptPacketChunk(ch, key, keylogEntries, firewallRules);
        restored.push(...pkts);
      }
      seqRef.current = Math.max(seqRef.current, restored.length + 1);
      ringRef.current.pushBatch(restored);
      syncFromRing();
      setRecoverableSession(null);
      setVaultMessage(`Recovered ${restored.length} packets from encrypted session ${sessionId}.`);
      setWorkspace('workbench');
      setPrimaryTab('CONNECTIONS');
    } catch {
      setVaultMessage('Decryption failed: check your vault passphrase.');
    }
  };

  const handleExportEncVaultFile = async () => {
    if (packets.length === 0) {
      setVaultMessage('Capture packets first before exporting .encvault.json.');
      return;
    }
    const saltBase64 = createSaltBase64();
    const key = await deriveAesGcmKey(vaultPassphrase || 'sadnan-local-vault', b64ToU8(saltBase64));
    const chunk = await encryptPacketChunk(packets, key, `export_${Date.now().toString(36)}`, 0);
    const vaultFile: EncVaultFile = {
      format: 'sadnan-capture-aes256gcm-v1',
      exportedAt: new Date().toISOString(),
      kdf: 'PBKDF2-SHA256',
      iterations: 120000,
      saltBase64,
      chunks: [chunk],
    };
    const blob = new Blob([JSON.stringify(vaultFile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sadnan_capture_${Date.now()}.encvault.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setVaultMessage('Exported passphrase-protected .encvault.json archive.');
  };

  const handleImportEncVaultFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as EncVaultFile;
      if (parsed.format !== 'sadnan-capture-aes256gcm-v1') {
        setVaultMessage('Unsupported vault file format.');
        return;
      }
      const key = await deriveAesGcmKey(vaultPassphrase, b64ToU8(parsed.saltBase64));
      const restored: CapturedPacket[] = [];
      for (const ch of parsed.chunks) {
        const pkts = await decryptPacketChunk(ch, key, keylogEntries, firewallRules);
        restored.push(...pkts);
      }
      ringRef.current.pushBatch(restored);
      syncFromRing();
      setVaultMessage(`Decrypted ${restored.length} packets from ${file.name}.`);
    } catch {
      setVaultMessage('Failed to decrypt .encvault.json — verify passphrase.');
    }
  };

  const drawerItems: Array<{ id: WorkspaceSection; label: string; icon: React.ReactNode }> = [
    { id: 'workbench', label: 'Status & Connections', icon: <Database className="w-4 h-4" /> },
    { id: 'game_monitor', label: 'Game Traffic Monitor', icon: <Gamepad2 className="w-4 h-4" /> },
    { id: 'firewall', label: 'Firewall & Threat Alerts', icon: <Shield className="w-4 h-4" /> },
    { id: 'vault', label: 'Encrypted Vault & Recovery', icon: <Lock className="w-4 h-4" /> },
    { id: 'share', label: 'Export & Share Links', icon: <Share2 className="w-4 h-4" /> },
    { id: 'probe_lab', label: 'Live Server Probe Lab', icon: <Terminal className="w-4 h-4" /> },
    { id: 'android_apk', label: 'Android Studio APK Source', icon: <Code2 className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#121518] text-[#ECEFF1] flex flex-col">
      {/* Android Material Top Toolbar */}
      <header className="sticky top-0 z-30 bg-[#1C2026] border-b border-[#282F38]">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="p-2 -ml-2 rounded-lg text-[#CFD8DC] hover:text-white hover:bg-[#262C35] transition-colors"
              aria-label="Open navigation drawer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              SADNAN CAPTURE
            </h1>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setOverlayVisible((v) => !v)}
              title="Toggle Floating Overlay"
              className={`px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                overlayVisible
                  ? 'bg-[#00897B]/25 text-[#26A69A] border border-[#26A69A]/40'
                  : 'text-[#CFD8DC] hover:text-white hover:bg-[#262C35]'
              }`}
              aria-label="Toggle floating overlay"
            >
              <PictureInPicture2 className="w-4 h-4" />
              <span className="hidden sm:inline">Overlay</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkspace('share')}
              title="Share & Export"
              className="px-2.5 py-2 rounded-lg text-xs font-medium text-[#CFD8DC] hover:text-white hover:bg-[#262C35] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              aria-label="Open share and export view"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Share</span>
            </button>

            <button
              type="button"
              onClick={() => {
                ringRef.current.clear();
                syncFromRing();
              }}
              title="Clear Capture Buffer"
              className="p-2 rounded-lg text-[#90A4AE] hover:text-[#EF5350] hover:bg-[#262C35] transition-colors shrink-0"
              aria-label="Clear captured packets"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={toggleCapture}
              className={`ml-1 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                isCapturing
                  ? 'bg-[#EF5350] hover:bg-[#E53935] text-white'
                  : 'bg-[#00897B] hover:bg-[#00796B] text-white'
              }`}
            >
              {isCapturing ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Start
                </>
              )}
            </button>
          </div>
        </div>

        {/* Exact PCAPdroid Primary Material Tabs: STATUS | CONNECTIONS */}
        <div className="max-w-5xl mx-auto grid grid-cols-2 border-t border-[#242A33]">
          {(['STATUS', 'CONNECTIONS'] as PrimaryTab[]).map((tab) => {
            const active = workspace === 'workbench' && primaryTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setWorkspace('workbench');
                  setPrimaryTab(tab);
                }}
                className={`py-3 text-xs font-bold tracking-wider border-b-2 transition-colors text-center whitespace-nowrap ${
                  active
                    ? 'border-[#26A69A] text-[#26A69A]'
                    : 'border-transparent text-[#90A4AE] hover:text-white'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </header>

      {/* Incomplete / Crash Session Recovery Banner */}
      {recoverableSession && (
        <div className="bg-[#231D14] border-b border-[#FFA726]/35">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[#FFE0B2]">
              <RotateCcw className="w-4 h-4 text-[#FFA726] shrink-0" />
              <span>
                Detected incomplete AES-256-GCM capture session{' '}
                <strong className="font-mono text-white">{recoverableSession.sessionId}</strong> (
                {recoverableSession.totalPackets} encrypted packets).
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleRecoverSession(recoverableSession.sessionId)}
                className="px-3 py-1 rounded bg-[#FFA726] text-[#121518] font-semibold hover:bg-[#FFB74D]"
              >
                Recover Session
              </button>
              <button
                type="button"
                onClick={() => setRecoverableSession(null)}
                className="px-2 py-1 text-[#90A4AE] hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Canvas */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5">
        {workspace === 'workbench' && primaryTab === 'STATUS' && (
          <StatusScreen
            isCapturing={isCapturing}
            onToggleCapture={toggleCapture}
            selectedApp={selectedApp}
            onSelectApp={setSelectedApp}
            dumpMode={dumpMode}
            onChangeDumpMode={setDumpMode}
            packets={packets}
            packetsPerSec={packetsPerSec}
            droppedPackets={droppedPackets}
            bufferCapacity={bufferCapacity}
            onChangeBufferCapacity={(cap) => {
              setBufferCapacity(cap);
              ringRef.current.setCapacity(cap);
              syncFromRing();
            }}
            errors={errors}
            keylogEntries={keylogEntries}
            onLoadKeylog={(txt) => setKeylogEntries(parseSslKeylogFile(txt))}
            onImportPcapFile={handleImportPcapFile}
            vaultEnabled={vaultEnabled}
            vaultChunkCount={vaultChunkCount}
            firewallRuleCount={firewallRules.filter((r) => r.enabled).length}
            alertCount={allAlerts.length}
            onOpenFirewall={() => setWorkspace('firewall')}
            onOpenVaultPanel={() => setWorkspace('vault')}
          />
        )}

        {workspace === 'workbench' && primaryTab === 'CONNECTIONS' && (
          <ConnectionsScreen
            packets={packets}
            flows={flows}
            onSelectPacket={setSelectedPacket}
            onStartCapture={() => setIsCapturing(true)}
          />
        )}

        {workspace === 'game_monitor' && (
          <GameMonitorScreen
            packets={packets}
            flows={flows}
            onSelectPacket={setSelectedPacket}
          />
        )}

        {workspace === 'firewall' && (
          <FirewallAlertsView
            rules={firewallRules}
            alerts={allAlerts}
            onAddRule={(type: FirewallRuleType, value: string, label: string) => {
              setFirewallRules((prev) => [
                {
                  id: `fw-${Date.now().toString(36)}`,
                  type,
                  value,
                  label,
                  enabled: true,
                  hitCount: 0,
                  createdAtMs: Date.now(),
                },
                ...prev,
              ]);
            }}
            onToggleRule={(id) =>
              setFirewallRules((prev) =>
                prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
              )
            }
            onDeleteRule={(id) =>
              setFirewallRules((prev) => prev.filter((r) => r.id !== id))
            }
          />
        )}

        {workspace === 'vault' && (
          <EncryptedVaultView
            passphrase={vaultPassphrase}
            onChangePassphrase={setVaultPassphrase}
            vaultEnabled={vaultEnabled}
            onToggleVault={setVaultEnabled}
            vaultChunkCount={vaultChunkCount}
            sessions={vaultSessions}
            onRecoverSession={handleRecoverSession}
            onClearVault={async () => {
              await clearVaultStorage();
              setVaultChunkCount(0);
              setRecoverableSession(null);
              refreshVaultSessions();
              setVaultMessage('Local IndexedDB vault cleared.');
            }}
            onImportEncVaultFile={handleImportEncVaultFile}
            onExportEncVaultFile={handleExportEncVaultFile}
            vaultMessage={vaultMessage}
          />
        )}

        {workspace === 'share' && (
          <ShareExportsView
            packets={packets}
            exportsList={exportsList}
            onRefreshExports={refreshExports}
            onExportEncVault={handleExportEncVaultFile}
          />
        )}

        {workspace === 'probe_lab' && (
          <ProbeTestLabView onIngestProbePackets={handleIngestProbePackets} />
        )}

        {workspace === 'android_apk' && <AndroidApkSourceView />}
      </main>

      {/* Android Material Slide-Out Navigation Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-[2px]" role="dialog" aria-label="Navigation drawer">
          <aside className="w-72 max-w-[85vw] h-full bg-[#1C2026] border-r border-[#282F38] flex flex-col">
            <div className="p-4 border-b border-[#282F38] flex items-center justify-between">
              <div>
                <div className="font-display text-base font-bold text-white">SADNAN CAPTURE</div>
                <div className="text-xs text-[#26A69A]">Non-Root VpnService Dissector</div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 text-[#90A4AE] hover:text-white rounded-lg"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
              {drawerItems.map((item) => {
                const active = workspace === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setWorkspace(item.id);
                      setDrawerOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-3 transition-colors ${
                      active
                        ? 'bg-[#00897B]/20 text-[#26A69A]'
                        : 'text-[#CFD8DC] hover:bg-[#242A33] hover:text-white'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-[#282F38] text-[11px] text-[#78909C] space-y-1">
              <div>100% Free & Open-Source · No Subscriptions</div>
              <div>Local Capture · Zero Cloud Telemetry</div>
            </div>
          </aside>
          <div className="flex-1" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      {/* Draggable Mini Floating Overlay */}
      <FloatingOverlayWidget
        visible={overlayVisible}
        isCapturing={isCapturing}
        packets={packets}
        droppedPackets={droppedPackets}
        onStopCapture={() => isCapturing && toggleCapture()}
        onCloseOverlay={() => setOverlayVisible(false)}
        onSelectPacket={(pkt) => setSelectedPacket(pkt)}
      />

      {/* Packet Detail Drawer (with Raw Response Body + Auto Content-Type Beautifier) */}
      <PacketDetailDrawer
        packet={selectedPacket}
        onClose={() => setSelectedPacket(null)}
      />
    </div>
  );
}
