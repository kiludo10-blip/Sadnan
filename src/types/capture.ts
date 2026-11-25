export type ProtocolType =
  | 'TCP'
  | 'UDP'
  | 'HTTP'
  | 'HTTPS'
  | 'DNS'
  | 'TLS'
  | 'QUIC'
  | 'ICMP'
  | 'ICMPv6';

export type TrafficDirection = 'OUTBOUND' | 'INBOUND';

export type DumpMode = 'PCAPNG' | 'PCAP' | 'RAW_BODY';

export type FriendlyAppId =
  | 'all'
  | 'free_fire'
  | 'free_fire_max'
  | 'chrome'
  | 'whatsapp';

export interface FriendlyAppOption {
  id: FriendlyAppId;
  displayName: string;
  category: 'System' | 'Game' | 'Browser' | 'Messaging';
  description: string;
  accentHex: string;
}

export interface TcpMeta {
  seq: number;
  ack: number;
  windowSize: number;
  flags: {
    SYN: boolean;
    ACK: boolean;
    FIN: boolean;
    RST: boolean;
    PSH: boolean;
    URG: boolean;
  };
  flagString: string;
}

export interface UdpMeta {
  length: number;
  checksum: string;
}

export interface DnsMeta {
  transactionId: string;
  isResponse: boolean;
  queryName: string;
  queryType: string;
  rcode: string;
  answers: string[];
}

export interface HttpMeta {
  isRequest: boolean;
  method?: string;
  path?: string;
  statusCode?: number;
  statusText?: string;
  version: string;
  headers: Record<string, string>;
  bodyOffset: number;
  isChunked: boolean;
}

export interface TlsMeta {
  recordType: string;
  recordVersion: string;
  handshakeType?: string;
  sni?: string;
  alpn?: string[];
  cipherCount?: number;
  clientRandom?: string;
  certificateCn?: string;
  certificateOrg?: string;
  matchedKeylogSecret?: string;
  isEncryptedPayload: boolean;
}

export interface QuicMeta {
  headerForm: 'Long' | 'Short';
  packetType: string;
  version: string;
  dcid: string;
  scid: string;
  isEncryptedPayload: boolean;
}

export interface EnrichmentInfo {
  countryCode: string;
  countryName: string;
  asn: string;
  org: string;
  service: string;
}

export interface ThreatAlert {
  id: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'TRACKER' | 'SUSPICIOUS_PORT' | 'CLEARTEXT_CREDENTIAL' | 'FIREWALL_BLOCK';
  title: string;
  detail: string;
  timestampNs: string;
  packetId: string;
}

export interface CapturedPacket {
  id: string;
  sequence: number;
  timestampNs: string;
  timestampMs: number;
  appId: FriendlyAppId;
  appName: string;
  ipVersion: 4 | 6;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  protocol: ProtocolType;
  transportProtocol: 'TCP' | 'UDP' | 'ICMP' | 'ICMPv6';
  direction: TrafficDirection;
  totalLength: number;
  payloadLength: number;
  payloadOffset: number;
  rawBytes: Uint8Array;
  blocked: boolean;
  blockReason?: string;
  alerts: ThreatAlert[];
  enrichment: EnrichmentInfo;
  sourceOrigin: 'LOCAL_SANDBOX' | 'SERVER_PROBE' | 'PCAP_IMPORT';
  tcp?: TcpMeta;
  udp?: UdpMeta;
  dns?: DnsMeta;
  http?: HttpMeta;
  tls?: TlsMeta;
  quic?: QuicMeta;
  summary: string;
}

export interface ConnectionFlow {
  flowKey: string;
  appId: FriendlyAppId;
  appName: string;
  ipVersion: 4 | 6;
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  protocol: ProtocolType;
  transportProtocol: 'TCP' | 'UDP' | 'ICMP' | 'ICMPv6';
  packetCount: number;
  uploadBytes: number;
  downloadBytes: number;
  firstSeenMs: number;
  lastSeenMs: number;
  durationMs: number;
  sniOrDomain?: string;
  enrichment: EnrichmentInfo;
  blocked: boolean;
  hasEncryptedTraffic: boolean;
  latestFlags?: string;
  packetIds: string[];
}

export type FirewallRuleType = 'APP' | 'IP' | 'PORT' | 'DOMAIN';

export interface FirewallRule {
  id: string;
  type: FirewallRuleType;
  value: string;
  label: string;
  enabled: boolean;
  hitCount: number;
  createdAtMs: number;
}

export interface KeylogEntry {
  label: string;
  clientRandom: string;
  secretHex: string;
}

export interface CaptureError {
  id: string;
  timestampMs: number;
  code: string;
  message: string;
}

export interface ExportRecord {
  id: string;
  filename: string;
  format: 'pcap' | 'pcapng' | 'txt' | 'encvault';
  sizeBytes: number;
  packetCount: number;
  createdAt: string;
  downloadUrl: string;
}

export interface ProbeResultPacket {
  direction: TrafficDirection;
  ipVersion: 4 | 6;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  protocol: ProtocolType;
  transportProtocol: 'TCP' | 'UDP' | 'ICMP' | 'ICMPv6';
  rawBytesBase64: string;
  note: string;
}

export interface ProbeResponse {
  ok: boolean;
  mode: 'TCP' | 'UDP' | 'HTTP' | 'HTTPS_TLS';
  target: string;
  latencyMs: number;
  tlsInfo?: {
    protocol?: string;
    cipher?: string;
    subjectCn?: string;
    issuerO?: string;
    alpnProtocol?: string | false;
  };
  packets: ProbeResultPacket[];
  error?: string;
}
