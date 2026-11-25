import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, Filter, Lock, Search, ShieldAlert, X } from 'lucide-react';
import { CapturedPacket, ConnectionFlow, ProtocolType, TrafficDirection } from '../types/capture';
import { AppIconBadge } from './AppIconBadge';

interface Props {
  packets: CapturedPacket[];
  flows: ConnectionFlow[];
  onSelectPacket: (pkt: CapturedPacket) => void;
  onStartCapture?: () => void;
}

type InspectorView = 'flows' | 'packets' | 'tcp' | 'udp';
type ProtoFilter =
  | 'ALL'
  | ProtocolType
  | 'IPv4'
  | 'IPv6'
  | 'ICMP/v6';

interface GroupedHostFlow {
  hostKey: string;
  displayHost: string;
  remoteIps: string[];
  remotePorts: number[];
  protocols: ProtocolType[];
  ipVersions: Array<4 | 6>;
  flows: ConnectionFlow[];
  packetCount: number;
  uploadBytes: number;
  downloadBytes: number;
  firstSeenMs: number;
  lastSeenMs: number;
  durationMs: number;
  blocked: boolean;
  hasEncryptedTraffic: boolean;
}

const PROTO_FILTERS: ProtoFilter[] = [
  'ALL',
  'TCP',
  'UDP',
  'HTTP',
  'HTTPS',
  'DNS',
  'TLS',
  'QUIC',
  'IPv4',
  'IPv6',
  'ICMP/v6',
];

const TCP_FLAG_FILTERS = ['SYN', 'ACK', 'FIN', 'RST', 'PSH', 'URG'] as const;

function protoColor(proto: ProtocolType, blocked: boolean): string {
  if (blocked) return 'text-[#EF5350]';
  if (proto === 'UDP' || proto === 'HTTP' || proto === 'DNS') return 'text-[#66BB6A]';
  if (proto === 'HTTPS' || proto === 'TLS' || proto === 'QUIC') return 'text-[#FFA726]';
  return 'text-[#26A69A]';
}

export const ConnectionsScreen: React.FC<Props> = ({
  packets,
  flows,
  onSelectPacket,
  onStartCapture,
}) => {
  const [view, setView] = useState<InspectorView>('flows');
  const [protoFilter, setProtoFilter] = useState<ProtoFilter>('ALL');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | TrafficDirection>('ALL');
  const [portFilter, setPortFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [tcpFlagFilter, setTcpFlagFilter] = useState<string>('ALL');
  const [groupByDomain, setGroupByDomain] = useState(false);
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({});

  const filteredPackets = useMemo(() => {
    const portNum = portFilter.trim() ? Number(portFilter.trim()) : null;
    const q = searchText.trim().toLowerCase();

    return packets
      .filter((p) => {
        if (view === 'tcp' && p.transportProtocol !== 'TCP') return false;
        if (view === 'udp' && p.transportProtocol !== 'UDP') return false;

        if (protoFilter === 'IPv4' && p.ipVersion !== 4) return false;
        else if (protoFilter === 'IPv6' && p.ipVersion !== 6) return false;
        else if (protoFilter === 'ICMP/v6' && p.protocol !== 'ICMP' && p.protocol !== 'ICMPv6') return false;
        else if (
          protoFilter !== 'ALL' &&
          protoFilter !== 'IPv4' &&
          protoFilter !== 'IPv6' &&
          protoFilter !== 'ICMP/v6' &&
          p.protocol !== protoFilter
        ) {
          return false;
        }

        if (directionFilter !== 'ALL' && p.direction !== directionFilter) return false;

        if (portNum !== null && !Number.isNaN(portNum)) {
          if (p.srcPort !== portNum && p.dstPort !== portNum) return false;
        }

        if (view === 'tcp' && tcpFlagFilter !== 'ALL') {
          if (!p.tcp?.flags[tcpFlagFilter as keyof typeof p.tcp.flags]) return false;
        }

        if (q) {
          const hay = [
            p.srcIp,
            p.dstIp,
            String(p.srcPort),
            String(p.dstPort),
            p.protocol,
            p.appName,
            p.summary,
            p.tls?.sni || '',
            p.dns?.queryName || '',
            p.enrichment.asn,
            p.enrichment.countryName,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice()
      .reverse();
  }, [packets, view, protoFilter, directionFilter, portFilter, searchText, tcpFlagFilter]);

  const filteredFlows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const portNum = portFilter.trim() ? Number(portFilter.trim()) : null;
    return flows
      .filter((f) => {
        if (protoFilter === 'IPv4' && f.ipVersion !== 4) return false;
        else if (protoFilter === 'IPv6' && f.ipVersion !== 6) return false;
        else if (
          protoFilter !== 'ALL' &&
          protoFilter !== 'IPv4' &&
          protoFilter !== 'IPv6' &&
          protoFilter !== 'ICMP/v6' &&
          f.protocol !== protoFilter
        ) {
          return false;
        }
        if (portNum !== null && !Number.isNaN(portNum) && f.remotePort !== portNum && f.localPort !== portNum) {
          return false;
        }
        if (q) {
          const hay = [
            f.localIp,
            f.remoteIp,
            `${f.remoteIp}:${f.remotePort}`,
            String(f.remotePort),
            f.appName,
            f.sniOrDomain || '',
            f.enrichment.asn,
            f.enrichment.org,
            f.enrichment.service,
            f.enrichment.countryName,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice()
      .reverse();
  }, [flows, protoFilter, portFilter, searchText]);

  const groupedHostFlows = useMemo<GroupedHostFlow[]>(() => {
    if (!groupByDomain) return [];
    const groups = new Map<string, GroupedHostFlow>();
    for (const flow of filteredFlows) {
      const displayHost = flow.sniOrDomain || flow.remoteIp;
      const hostKey = displayHost.toLowerCase();
      const existing = groups.get(hostKey);
      if (!existing) {
        groups.set(hostKey, {
          hostKey,
          displayHost,
          remoteIps: [flow.remoteIp],
          remotePorts: [flow.remotePort],
          protocols: [flow.protocol],
          ipVersions: [flow.ipVersion],
          flows: [flow],
          packetCount: flow.packetCount,
          uploadBytes: flow.uploadBytes,
          downloadBytes: flow.downloadBytes,
          firstSeenMs: flow.firstSeenMs,
          lastSeenMs: flow.lastSeenMs,
          durationMs: flow.durationMs,
          blocked: flow.blocked,
          hasEncryptedTraffic: flow.hasEncryptedTraffic,
        });
      } else {
        existing.flows.push(flow);
        if (!existing.remoteIps.includes(flow.remoteIp)) existing.remoteIps.push(flow.remoteIp);
        if (!existing.remotePorts.includes(flow.remotePort)) existing.remotePorts.push(flow.remotePort);
        if (!existing.protocols.includes(flow.protocol)) existing.protocols.push(flow.protocol);
        if (!existing.ipVersions.includes(flow.ipVersion)) existing.ipVersions.push(flow.ipVersion);
        existing.packetCount += flow.packetCount;
        existing.uploadBytes += flow.uploadBytes;
        existing.downloadBytes += flow.downloadBytes;
        existing.firstSeenMs = Math.min(existing.firstSeenMs, flow.firstSeenMs);
        existing.lastSeenMs = Math.max(existing.lastSeenMs, flow.lastSeenMs);
        existing.durationMs = Math.max(0, existing.lastSeenMs - existing.firstSeenMs);
        if (flow.blocked) existing.blocked = true;
        if (flow.hasEncryptedTraffic) existing.hasEncryptedTraffic = true;
      }
    }
    return Array.from(groups.values());
  }, [filteredFlows, groupByDomain]);

  const toggleHostExpanded = (hostKey: string) => {
    setExpandedHosts((prev) => ({ ...prev, [hostKey]: !prev[hostKey] }));
  };

  return (
    <div className="space-y-4">
      {/* Sub-Inspector Segmented Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#1C2026] border border-[#282F38] overflow-x-auto">
          {(
            [
              {
                id: 'flows',
                label: `Connections (${groupByDomain ? groupedHostFlows.length : filteredFlows.length})`,
              },
              { id: 'packets', label: `Packet Stream (${packets.length})` },
              { id: 'tcp', label: 'TCP Inspector' },
              { id: 'udp', label: 'UDP Inspector' },
            ] as { id: InspectorView; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                view === tab.id
                  ? 'bg-[#00897B] text-white'
                  : 'text-[#90A4AE] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Direction + Port + Search */}
        <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value as 'ALL' | TrafficDirection)}
            className="h-9 px-2.5 rounded-lg bg-[#1C2026] border border-[#282F38] text-xs text-[#ECEFF1] focus:outline-none focus:border-[#26A69A]"
            aria-label="Filter by traffic direction"
          >
            <option value="ALL">All Directions</option>
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>

          <input
            type="text"
            value={portFilter}
            onChange={(e) => setPortFilter(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Port..."
            className="h-9 w-24 px-2.5 rounded-lg bg-[#1C2026] border border-[#282F38] text-xs font-mono text-[#ECEFF1] placeholder-[#546E7A] focus:outline-none focus:border-[#26A69A]"
            aria-label="Filter by port number"
          />

          <div className="relative flex-1 min-w-[210px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#78909C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search host, domain, or IP..."
              className="h-9 w-full pl-8 pr-8 rounded-lg bg-[#1C2026] border border-[#282F38] text-xs text-[#ECEFF1] placeholder-[#546E7A] focus:outline-none focus:border-[#26A69A]"
              aria-label="Filter connections by destination host, domain, or IP address"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText('')}
                className="p-1 text-[#78909C] hover:text-white absolute right-1.5 top-1/2 -translate-y-1/2 rounded"
                aria-label="Clear search filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Universal Protocol Filter Row + Group by Domain/SNI Checkbox */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <Filter className="w-3.5 h-3.5 text-[#78909C] shrink-0 mr-1" />
          {PROTO_FILTERS.map((proto) => (
            <button
              key={proto}
              type="button"
              onClick={() => setProtoFilter(proto)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                protoFilter === proto
                  ? 'bg-[#26A69A] text-[#0B1413] font-bold'
                  : 'bg-[#1C2026] text-[#90A4AE] hover:text-white border border-[#282F38]'
              }`}
            >
              {proto}
            </button>
          ))}
        </div>

        {view === 'flows' && (
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1C2026] border border-[#282F38] hover:border-[#374151] cursor-pointer select-none text-xs text-[#ECEFF1] whitespace-nowrap shrink-0">
            <input
              type="checkbox"
              checked={groupByDomain}
              onChange={(e) => setGroupByDomain(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#00897B] rounded cursor-pointer"
            />
            <span>Group by Domain/SNI</span>
          </label>
        )}
      </div>

      {/* TCP Flag Sub-Filter when in TCP Inspector */}
      {view === 'tcp' && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1C2026] border border-[#282F38]">
          <span className="text-xs text-[#90A4AE] mr-2">TCP Flags:</span>
          <button
            type="button"
            onClick={() => setTcpFlagFilter('ALL')}
            className={`px-2 py-0.5 rounded text-xs font-mono ${
              tcpFlagFilter === 'ALL' ? 'bg-[#00897B] text-white' : 'bg-[#121518] text-[#90A4AE]'
            }`}
          >
            ALL
          </button>
          {TCP_FLAG_FILTERS.map((fl) => (
            <button
              key={fl}
              type="button"
              onClick={() => setTcpFlagFilter(fl)}
              className={`px-2 py-0.5 rounded text-xs font-mono ${
                tcpFlagFilter === fl ? 'bg-[#00897B] text-white' : 'bg-[#121518] text-[#90A4AE]'
              }`}
            >
              {fl}
            </button>
          ))}
        </div>
      )}

      {/* Empty State */}
      {packets.length === 0 ? (
        <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-10 text-center space-y-3">
          <div className="text-sm font-semibold text-white">No Packets Captured Yet</div>
          <p className="text-xs text-[#90A4AE] max-w-md mx-auto">
            Start capture from the Status ring, run a live socket probe in the Probe Test Lab, or import a binary .pcap / .pcapng file.
          </p>
          {onStartCapture && (
            <button
              type="button"
              onClick={onStartCapture}
              className="px-4 py-2 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold transition-colors"
            >
              Start Capture
            </button>
          )}
        </div>
      ) : view === 'flows' ? (
        /* Flow Connections Table (Ungrouped or Grouped by Domain/SNI) */
        <div className="rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#282F38] text-[11px] text-[#90A4AE] bg-[#161A20]">
                  <th className="py-2.5 px-3 font-medium">App</th>
                  <th className="py-2.5 px-3 font-medium">Proto</th>
                  <th className="py-2.5 px-3 font-medium">Endpoint / SNI</th>
                  <th className="py-2.5 px-3 font-medium">Country / ASN</th>
                  <th className="py-2.5 px-3 font-medium text-right">Pkts</th>
                  <th className="py-2.5 px-3 font-medium text-right">Up / Down</th>
                  <th className="py-2.5 px-3 font-medium text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232932] text-xs">
                {groupByDomain
                  ? groupedHostFlows.map((group) => {
                      const primaryFlow = group.flows[0];
                      const isExpanded = Boolean(expandedHosts[group.hostKey]);
                      const uniqueApps = Array.from(new Set(group.flows.map((f) => f.appName)));
                      const latestPkt = packets.find(
                        (p) => p.id === primaryFlow.packetIds[primaryFlow.packetIds.length - 1]
                      );
                      const hasMultiple = group.flows.length > 1;

                      return (
                        <React.Fragment key={group.hostKey}>
                          <tr
                            onClick={() => {
                              if (hasMultiple) toggleHostExpanded(group.hostKey);
                              else if (latestPkt) onSelectPacket(latestPkt);
                            }}
                            className="bg-[#181C22] hover:bg-[#20262F] cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                {hasMultiple ? (
                                  isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-[#26A69A] shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-[#78909C] shrink-0" />
                                  )
                                ) : (
                                  <span className="w-3.5 shrink-0" />
                                )}
                                <AppIconBadge appId={primaryFlow.appId} size={26} />
                                <span className="text-white font-medium whitespace-nowrap">
                                  {uniqueApps.length > 1
                                    ? `${primaryFlow.appName} +${uniqueApps.length - 1}`
                                    : primaryFlow.appName}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold whitespace-nowrap">
                              <span className={protoColor(primaryFlow.protocol, group.blocked)}>
                                {group.protocols.join(' / ')}
                              </span>
                              <span className="text-[#78909C] font-normal">
                                {' '}
                                · {group.ipVersions.map((v) => `v${v}`).join('/')}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              <div className="flex items-center gap-1.5 text-[#ECEFF1]">
                                <span>{group.displayHost}</span>
                                {group.hasEncryptedTraffic && (
                                  <Lock className="w-3 h-3 text-[#FFA726] shrink-0" aria-label="Encrypted traffic" />
                                )}
                                {hasMultiple && (
                                  <span className="text-[11px] font-sans text-[#26A69A]">
                                    · {group.flows.length} flows
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#78909C] truncate max-w-[260px]">
                                {group.remoteIps.join(', ')} : {group.remotePorts.join(', ')}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-[#B0BEC5] font-mono">
                              {primaryFlow.enrichment.countryCode} · {primaryFlow.enrichment.asn}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white">
                              {group.packetCount}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <span className="text-[#FFA726]">{group.uploadBytes}B</span>{' '}
                              <span className="text-[#78909C]">/</span>{' '}
                              <span className="text-[#66BB6A]">{group.downloadBytes}B</span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#90A4AE]">
                              <div className="inline-flex items-center gap-2">
                                <span>{group.durationMs} ms</span>
                                {hasMultiple && latestPkt && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectPacket(latestPkt);
                                    }}
                                    className="p-1 rounded hover:bg-[#2B333E] text-[#90A4AE] hover:text-white"
                                    title="Inspect latest packet"
                                    aria-label={`Inspect latest packet for ${group.displayHost}`}
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {hasMultiple &&
                            isExpanded &&
                            group.flows.map((subFlow) => {
                              const subPkt = packets.find(
                                (p) => p.id === subFlow.packetIds[subFlow.packetIds.length - 1]
                              );
                              return (
                                <tr
                                  key={subFlow.flowKey}
                                  onClick={() => subPkt && onSelectPacket(subPkt)}
                                  className="bg-[#14171C] hover:bg-[#1E242C] cursor-pointer transition-colors"
                                >
                                  <td className="py-2 px-3 pl-10 text-[#90A4AE] whitespace-nowrap">
                                    {subFlow.appName}
                                  </td>
                                  <td
                                    className={`py-2 px-3 font-mono font-semibold ${protoColor(
                                      subFlow.protocol,
                                      subFlow.blocked
                                    )}`}
                                  >
                                    {subFlow.protocol} · v{subFlow.ipVersion}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-[#B0BEC5]">
                                    {subFlow.remoteIp}:{subFlow.remotePort}{' '}
                                    <span className="text-[#78909C]">(local :{subFlow.localPort})</span>
                                  </td>
                                  <td className="py-2 px-3 font-mono text-[#78909C]">
                                    {subFlow.latestFlags ? `[${subFlow.latestFlags}]` : subFlow.enrichment.service}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums text-[#CFD8DC]">
                                    {subFlow.packetCount}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                                    <span className="text-[#FFA726]">{subFlow.uploadBytes}B</span>{' '}
                                    <span className="text-[#78909C]">/</span>{' '}
                                    <span className="text-[#66BB6A]">{subFlow.downloadBytes}B</span>
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums text-[#78909C]">
                                    {subFlow.durationMs} ms
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })
                  : filteredFlows.map((flow) => {
                      const latestPkt = packets.find(
                        (p) => p.id === flow.packetIds[flow.packetIds.length - 1]
                      );
                      return (
                        <tr
                          key={flow.flowKey}
                          onClick={() => latestPkt && onSelectPacket(latestPkt)}
                          className="bg-[#181C22] hover:bg-[#20262F] cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <AppIconBadge appId={flow.appId} size={26} />
                              <span className="text-white font-medium whitespace-nowrap">{flow.appName}</span>
                            </div>
                          </td>
                          <td className={`py-2.5 px-3 font-mono font-semibold ${protoColor(flow.protocol, flow.blocked)}`}>
                            {flow.protocol} · v{flow.ipVersion}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            <div className="text-[#ECEFF1]">
                              {flow.sniOrDomain || flow.remoteIp}:{flow.remotePort}
                            </div>
                            {flow.sniOrDomain && (
                              <div className="text-[11px] text-[#78909C]">{flow.remoteIp}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-[#B0BEC5] font-mono">
                            {flow.enrichment.countryCode} · {flow.enrichment.asn}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white">
                            {flow.packetCount}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            <span className="text-[#FFA726]">{flow.uploadBytes}B</span>{' '}
                            <span className="text-[#78909C]">/</span>{' '}
                            <span className="text-[#66BB6A]">{flow.downloadBytes}B</span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#90A4AE]">
                            {flow.durationMs} ms
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
            {(groupByDomain ? groupedHostFlows.length === 0 : filteredFlows.length === 0) && (
              <div className="p-8 text-center space-y-2 bg-[#181C22]">
                <div className="text-xs text-[#B0BEC5]">
                  No connections match the active filters{searchText ? ` ("${searchText}")` : ''}.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchText('');
                    setPortFilter('');
                    setProtoFilter('ALL');
                    setDirectionFilter('ALL');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#1C2026] hover:bg-[#232933] border border-[#2F3742] text-xs text-[#26A69A] font-medium"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Packet Stream / TCP Inspector / UDP Inspector */
        <div className="rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#282F38] text-[11px] text-[#90A4AE] bg-[#161A20]">
                  <th className="py-2.5 px-3 font-medium">#</th>
                  <th className="py-2.5 px-3 font-medium">App / Dir</th>
                  <th className="py-2.5 px-3 font-medium">Proto</th>
                  <th className="py-2.5 px-3 font-medium">Source → Destination</th>
                  {view === 'tcp' && <th className="py-2.5 px-3 font-medium">Seq / Ack / Flags</th>}
                  {view === 'udp' && <th className="py-2.5 px-3 font-medium">UDP Payload / Service</th>}
                  {view === 'packets' && <th className="py-2.5 px-3 font-medium">Dissection Summary</th>}
                  <th className="py-2.5 px-3 font-medium text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232932] text-xs">
                {filteredPackets.slice(0, 250).map((pkt) => (
                  <tr
                    key={pkt.id}
                    onClick={() => onSelectPacket(pkt)}
                    className="bg-[#181C22] hover:bg-[#212730] cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#78909C] whitespace-nowrap">
                      {pkt.sequence}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <AppIconBadge appId={pkt.appId} size={24} />
                        <div>
                          <div className="text-[#ECEFF1] font-medium leading-tight">{pkt.appName}</div>
                          <div className="text-[11px] font-mono text-[#78909C]">{pkt.direction}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${protoColor(pkt.protocol, pkt.blocked)}`}>
                          {pkt.protocol}
                        </span>
                        {(pkt.tls?.isEncryptedPayload || pkt.quic?.isEncryptedPayload) && (
                          <Lock className="w-3 h-3 text-[#FFA726]" aria-label="Encrypted payload" />
                        )}
                        {pkt.alerts.length > 0 && (
                          <ShieldAlert className="w-3.5 h-3.5 text-[#EF5350]" aria-label="Alert flagged" />
                        )}
                      </div>
                      <div className="text-[11px] text-[#78909C]">IPv{pkt.ipVersion} · {pkt.enrichment.countryCode}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#CFD8DC]">
                      <div className="truncate max-w-[260px]">
                        {pkt.srcIp}:{pkt.srcPort} → {pkt.dstIp}:{pkt.dstPort}
                      </div>
                      <div className="text-[11px] text-[#78909C]">
                        {pkt.enrichment.asn} · {pkt.enrichment.org}
                      </div>
                    </td>
                    {view === 'tcp' && (
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#B0BEC5]">
                        <div>Seq={pkt.tcp?.seq ?? '-'} Ack={pkt.tcp?.ack ?? '-'}</div>
                        <div className="text-[11px] text-[#26A69A]">[{pkt.tcp?.flagString || 'NONE'}]</div>
                      </td>
                    )}
                    {view === 'udp' && (
                      <td className="py-2.5 px-3 font-mono text-[#B0BEC5]">
                        <div>Len={pkt.payloadLength} B · {pkt.enrichment.service}</div>
                        <div className="text-[11px] text-[#78909C] truncate max-w-[240px]">{pkt.summary}</div>
                      </td>
                    )}
                    {view === 'packets' && (
                      <td className="py-2.5 px-3 text-[#B0BEC5] max-w-[300px] truncate">
                        {pkt.blocked ? (
                          <span className="text-[#EF5350] font-semibold">BLOCKED ({pkt.blockReason})</span>
                        ) : (
                          pkt.summary
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white whitespace-nowrap">
                      <div>{pkt.totalLength} B</div>
                      <div className="text-[11px] text-[#78909C]">{pkt.payloadLength}B pay</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
