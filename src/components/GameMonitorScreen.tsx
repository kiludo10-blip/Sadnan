import React, { useMemo, useState } from 'react';
import { Gamepad2, Lock } from 'lucide-react';
import { CapturedPacket, ConnectionFlow } from '../types/capture';
import { AppIconBadge } from './AppIconBadge';

interface Props {
  packets: CapturedPacket[];
  flows: ConnectionFlow[];
  onSelectPacket: (pkt: CapturedPacket) => void;
}

export const GameMonitorScreen: React.FC<Props> = ({ packets, flows, onSelectPacket }) => {
  const [gameFilter, setGameFilter] = useState<'all_games' | 'free_fire' | 'free_fire_max'>('all_games');

  const gamePackets = useMemo(() => {
    return packets.filter((p) => {
      const isGame = p.appId === 'free_fire' || p.appId === 'free_fire_max';
      if (!isGame) return false;
      if (gameFilter !== 'all_games' && p.appId !== gameFilter) return false;
      return true;
    });
  }, [packets, gameFilter]);

  const gameFlows = useMemo(() => {
    return flows.filter((f) => {
      const isGame = f.appId === 'free_fire' || f.appId === 'free_fire_max';
      if (!isGame) return false;
      if (gameFilter !== 'all_games' && f.appId !== gameFilter) return false;
      return true;
    });
  }, [flows, gameFilter]);

  const stats = useMemo(() => {
    let tcpCount = 0;
    let udpCount = 0;
    let dnsCount = 0;
    let encryptedCount = 0;
    let upBytes = 0;
    let downBytes = 0;
    for (const p of gamePackets) {
      if (p.transportProtocol === 'TCP') tcpCount += 1;
      if (p.transportProtocol === 'UDP') udpCount += 1;
      if (p.protocol === 'DNS') dnsCount += 1;
      if (p.tls?.isEncryptedPayload || p.quic?.isEncryptedPayload) encryptedCount += 1;
      if (p.direction === 'OUTBOUND') upBytes += p.totalLength;
      else downBytes += p.totalLength;
    }
    return { tcpCount, udpCount, dnsCount, encryptedCount, upBytes, downBytes };
  }, [gamePackets]);

  return (
    <div className="space-y-4">
      {/* Header & Game App Switcher */}
      <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#2A1D12] border border-[#FFA726]/30 flex items-center justify-center">
            <Gamepad2 className="w-5 h-5 text-[#FFA726]" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Game Traffic Monitor</h2>
            <p className="text-xs text-[#90A4AE]">
              Real-time TCP connections, UDP match datagrams, DNS lookups, and encrypted payload indicators
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#121518] border border-[#282F38]">
          {(
            [
              { id: 'all_games', label: 'All Games' },
              { id: 'free_fire', label: 'Free Fire' },
              { id: 'free_fire_max', label: 'Free Fire MAX' },
            ] as const
          ).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGameFilter(g.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                gameFilter === g.id ? 'bg-[#00897B] text-white' : 'text-[#90A4AE] hover:text-white'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quantitative Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-[#1C2026] border border-[#282F38]">
          <div className="text-xs text-[#90A4AE]">TCP / UDP Frames</div>
          <div className="text-lg font-mono font-bold tabular-nums text-white mt-1">
            <span className="text-[#26A69A]">{stats.tcpCount}</span> /{' '}
            <span className="text-[#66BB6A]">{stats.udpCount}</span>
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#1C2026] border border-[#282F38]">
          <div className="text-xs text-[#90A4AE]">Upload / Download</div>
          <div className="text-lg font-mono font-bold tabular-nums text-white mt-1">
            {stats.upBytes}B / {stats.downBytes}B
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#1C2026] border border-[#282F38]">
          <div className="text-xs text-[#90A4AE]">DNS Queries</div>
          <div className="text-lg font-mono font-bold tabular-nums text-[#66BB6A] mt-1">
            {stats.dnsCount}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#1C2026] border border-[#282F38]">
          <div className="text-xs text-[#90A4AE]">Encrypted Payloads</div>
          <div className="text-lg font-mono font-bold tabular-nums text-[#FFA726] mt-1 flex items-center gap-1.5">
            <Lock className="w-4 h-4" />
            {stats.encryptedCount}
          </div>
        </div>
      </div>

      {gamePackets.length === 0 ? (
        <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-white">No Game Traffic Observed Yet</div>
          <p className="text-xs text-[#90A4AE] max-w-md mx-auto">
            Select Free Fire or Free Fire MAX (or All Isolated Apps) on the Status screen and start capture to inspect game TCP/UDP flows and DNS lookups.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Active Game Flows */}
          <div className="lg:col-span-5 rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#282F38] flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Active Game Socket Flows ({gameFlows.length})</span>
              <span className="text-[11px] font-mono text-[#78909C]">Duration · Up/Down</span>
            </div>
            <div className="divide-y divide-[#232932] max-h-[420px] overflow-y-auto">
              {gameFlows.map((flow) => {
                const pkt = packets.find((p) => p.id === flow.packetIds[flow.packetIds.length - 1]);
                return (
                  <button
                    key={flow.flowKey}
                    type="button"
                    onClick={() => pkt && onSelectPacket(pkt)}
                    className="w-full text-left px-4 py-3 bg-[#181C22] hover:bg-[#20262F] transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AppIconBadge appId={flow.appId} size={30} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                          <span className="font-mono text-[#66BB6A]">{flow.protocol}</span>
                          <span>{flow.sniOrDomain || `${flow.remoteIp}:${flow.remotePort}`}</span>
                          {flow.hasEncryptedTraffic && <Lock className="w-3 h-3 text-[#FFA726] shrink-0" />}
                        </div>
                        <div className="text-[11px] font-mono text-[#90A4AE]">
                          {flow.enrichment.countryCode} · {flow.enrichment.asn} · {flow.packetCount} pkts
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums text-[11px] shrink-0">
                      <div className="text-[#ECEFF1]">{flow.uploadBytes}↑ / {flow.downloadBytes}↓</div>
                      <div className="text-[#78909C]">{flow.durationMs} ms</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Game Packet & Datagram Timeline */}
          <div className="lg:col-span-7 rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#282F38] flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Game Packets, UDP Datagrams & DNS Queries</span>
              <span className="text-[11px] font-mono text-[#78909C]">Cryptographically Honest</span>
            </div>
            <div className="divide-y divide-[#232932] max-h-[420px] overflow-y-auto">
              {gamePackets.slice().reverse().slice(0, 120).map((pkt) => (
                <button
                  key={pkt.id}
                  type="button"
                  onClick={() => onSelectPacket(pkt)}
                  className="w-full text-left px-4 py-2.5 bg-[#181C22] hover:bg-[#20262F] transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span
                        className={
                          pkt.protocol === 'UDP' || pkt.protocol === 'DNS'
                            ? 'text-[#66BB6A] font-semibold'
                            : pkt.protocol === 'HTTPS' || pkt.protocol === 'TLS'
                              ? 'text-[#FFA726] font-semibold'
                              : 'text-[#26A69A] font-semibold'
                        }
                      >
                        {pkt.protocol}
                      </span>
                      <span className="text-[#78909C]">·</span>
                      <span className="text-[#CFD8DC]">{pkt.direction}</span>
                      <span className="text-[#78909C]">·</span>
                      <span className="text-white truncate">
                        {pkt.dns?.queryName || pkt.tls?.sni || `${pkt.dstIp}:${pkt.dstPort}`}
                      </span>
                      {(pkt.tls?.isEncryptedPayload || pkt.quic?.isEncryptedPayload) && (
                        <Lock className="w-3 h-3 text-[#FFA726] shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#78909C] mt-0.5 truncate">
                      {pkt.timestampNs}ns · {pkt.srcIp}:{pkt.srcPort} → {pkt.dstIp}:{pkt.dstPort}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-xs text-white shrink-0">
                    <div>{pkt.totalLength} B</div>
                    <div className="text-[11px] text-[#78909C]">{pkt.payloadLength}B pay</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
