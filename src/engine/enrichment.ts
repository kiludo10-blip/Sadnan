import {
  EnrichmentInfo,
  FirewallRule,
  FriendlyAppId,
  FriendlyAppOption,
  ProtocolType,
  ThreatAlert,
} from '../types/capture';

/**
 * Friendly app selector metadata.
 * Notice: No raw package-name strings ("com.package.name") are displayed in the UI selector.
 */
export const FRIENDLY_APP_OPTIONS: FriendlyAppOption[] = [
  {
    id: 'all',
    displayName: 'All Isolated Apps',
    category: 'System',
    description: 'Capture across all user-selected VPN-allowed applications',
    accentHex: '#26A69A',
  },
  {
    id: 'free_fire',
    displayName: 'Free Fire',
    category: 'Game',
    description: 'Battle Royale match lobby, UDP tick sync, and telemetry',
    accentHex: '#FFA726',
  },
  {
    id: 'free_fire_max',
    displayName: 'Free Fire MAX',
    category: 'Game',
    description: 'HD match servers, voice/squad UDP channels, and CDN fetches',
    accentHex: '#FF7043',
  },
  {
    id: 'chrome',
    displayName: 'Google Chrome',
    category: 'Browser',
    description: 'HTTP/1.1, TLS 1.3 HTTPS, HTTP/3 QUIC, and DoH/DNS lookups',
    accentHex: '#66BB6A',
  },
  {
    id: 'whatsapp',
    displayName: 'WhatsApp',
    category: 'Messaging',
    description: 'Encrypted Noise/TLS messaging sockets and STUN/UDP media',
    accentHex: '#26A69A',
  },
];

const SERVICE_PORT_MAP: Record<number, string> = {
  20: 'FTP-DATA',
  21: 'FTP (Cleartext)',
  22: 'SSH',
  23: 'Telnet (Insecure)',
  53: 'DNS',
  67: 'DHCP',
  80: 'HTTP',
  123: 'NTP',
  443: 'HTTPS / QUIC',
  445: 'SMB',
  853: 'DNS-over-TLS',
  1935: 'RTMP',
  3478: 'STUN / TURN',
  4444: 'Debug / Shell Port',
  5222: 'XMPP / Messaging',
  5228: 'FCM / Push',
  5555: 'ADB TCP (Debug)',
  6667: 'IRC (Unencrypted)',
  8080: 'HTTP-Alt',
  8443: 'HTTPS-Alt',
  10001: 'Game Match UDP',
  10012: 'Game Lobby Sync',
  30100: 'Game Voice Channel',
};

interface PrefixEntry {
  prefix: string;
  countryCode: string;
  countryName: string;
  asn: string;
  org: string;
}

const OFFLINE_PREFIXES: PrefixEntry[] = [
  { prefix: '8.8.', countryCode: 'US', countryName: 'United States', asn: 'AS15169', org: 'Google LLC' },
  { prefix: '142.250.', countryCode: 'US', countryName: 'United States', asn: 'AS15169', org: 'Google LLC' },
  { prefix: '172.217.', countryCode: 'US', countryName: 'United States', asn: 'AS15169', org: 'Google LLC' },
  { prefix: '1.1.1.', countryCode: 'AU', countryName: 'Australia / Anycast', asn: 'AS13335', org: 'Cloudflare, Inc.' },
  { prefix: '104.16.', countryCode: 'US', countryName: 'United States', asn: 'AS13335', org: 'Cloudflare CDN' },
  { prefix: '104.18.', countryCode: 'US', countryName: 'United States', asn: 'AS13335', org: 'Cloudflare CDN' },
  { prefix: '157.240.', countryCode: 'US', countryName: 'United States', asn: 'AS32934', org: 'Meta Platforms, Inc.' },
  { prefix: '31.13.', countryCode: 'IE', countryName: 'Ireland', asn: 'AS32934', org: 'Meta Platforms, Inc.' },
  { prefix: '43.229.', countryCode: 'SG', countryName: 'Singapore', asn: 'AS58905', org: 'Garena / Sea Edge SG' },
  { prefix: '202.81.', countryCode: 'SG', countryName: 'Singapore', asn: 'AS58905', org: 'Garena Online Game Cluster' },
  { prefix: '103.21.', countryCode: 'SG', countryName: 'Singapore', asn: 'AS13335', org: 'APAC Edge Relay' },
  { prefix: '52.77.', countryCode: 'SG', countryName: 'Singapore', asn: 'AS16509', org: 'Amazon AWS ap-southeast-1' },
  { prefix: '3.1.', countryCode: 'SG', countryName: 'Singapore', asn: 'AS16509', org: 'Amazon AWS ap-southeast-1' },
  { prefix: '2606:4700:', countryCode: 'US', countryName: 'Anycast IPv6', asn: 'AS13335', org: 'Cloudflare IPv6 Edge' },
  { prefix: '2001:4860:', countryCode: 'US', countryName: 'Anycast IPv6', asn: 'AS15169', org: 'Google IPv6 Backbone' },
  { prefix: '2a03:2880:', countryCode: 'IE', countryName: 'Ireland IPv6', asn: 'AS32934', org: 'Meta IPv6 Edge' },
  { prefix: '127.', countryCode: 'LO', countryName: 'Local Loopback', asn: 'LOCAL', org: 'Probe Lab Sandbox' },
  { prefix: '::1', countryCode: 'LO', countryName: 'Local Loopback', asn: 'LOCAL', org: 'Probe Lab Sandbox' },
  { prefix: '10.', countryCode: 'PR', countryName: 'Private TUN', asn: 'RFC1918', org: 'SadnanVpnInterface' },
  { prefix: 'fd00:', countryCode: 'PR', countryName: 'Private TUN v6', asn: 'RFC4193', org: 'SadnanVpnInterface6' },
  { prefix: '192.168.', countryCode: 'PR', countryName: 'Local LAN', asn: 'RFC1918', org: 'Private Subnet' },
];

export function lookupEnrichment(ip: string, port: number): EnrichmentInfo {
  const service = SERVICE_PORT_MAP[port] || (port > 1024 ? 'Ephemeral / Custom' : `Port ${port}`);
  for (const entry of OFFLINE_PREFIXES) {
    if (ip.startsWith(entry.prefix) || ip === entry.prefix) {
      return {
        countryCode: entry.countryCode,
        countryName: entry.countryName,
        asn: entry.asn,
        org: entry.org,
        service,
      };
    }
  }
  return {
    countryCode: 'GL',
    countryName: 'Global Unicast',
    asn: 'AS-UNMAPPED',
    org: 'External Autonomous System',
    service,
  };
}

const TRACKER_DOMAINS = [
  'app-measurement.com',
  'graph.facebook.com',
  'doubleclick.net',
  'adjust.com',
  'appsflyer.com',
  'crashlytics.com',
  'analytics.google.com',
  'ads.pubmatic.com',
  'telemetry.',
  'metrics.',
];

const SUSPICIOUS_PORTS = new Set([21, 23, 4444, 5555, 6667, 31337]);

export function evaluateFirewall(
  rules: FirewallRule[],
  params: {
    appId: FriendlyAppId;
    appName: string;
    srcIp: string;
    dstIp: string;
    srcPort: number;
    dstPort: number;
    domain?: string;
  }
): FirewallRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const val = rule.value.trim().toLowerCase();
    if (!val) continue;

    if (rule.type === 'APP') {
      if (params.appId.toLowerCase() === val || params.appName.toLowerCase() === val) {
        return rule;
      }
    } else if (rule.type === 'IP') {
      if (
        params.dstIp.toLowerCase() === val ||
        params.srcIp.toLowerCase() === val ||
        (val.endsWith('.') && (params.dstIp.startsWith(val) || params.srcIp.startsWith(val)))
      ) {
        return rule;
      }
    } else if (rule.type === 'PORT') {
      const targetPort = Number(val);
      if (!Number.isNaN(targetPort) && (params.dstPort === targetPort || params.srcPort === targetPort)) {
        return rule;
      }
    } else if (rule.type === 'DOMAIN' && params.domain) {
      const d = params.domain.toLowerCase();
      if (d === val || d.endsWith(`.${val}`) || d.includes(val)) {
        return rule;
      }
    }
  }
  return null;
}

export function detectThreatAlerts(params: {
  packetId: string;
  timestampNs: string;
  dstPort: number;
  srcPort: number;
  protocol: ProtocolType;
  domain?: string;
  blockedRule?: FirewallRule | null;
  asciiSnippet?: string;
}): ThreatAlert[] {
  const alerts: ThreatAlert[] = [];

  if (params.blockedRule) {
    alerts.push({
      id: `al-fw-${params.packetId}`,
      severity: 'HIGH',
      category: 'FIREWALL_BLOCK',
      title: `Firewall Blocked (${params.blockedRule.type}: ${params.blockedRule.value})`,
      detail: `Local policy rule "${params.blockedRule.label}" intercepted matching packet.`,
      timestampNs: params.timestampNs,
      packetId: params.packetId,
    });
  }

  if (params.domain) {
    const lower = params.domain.toLowerCase();
    const matched = TRACKER_DOMAINS.find((t) => lower.includes(t));
    if (matched) {
      alerts.push({
        id: `al-trk-${params.packetId}`,
        severity: 'MEDIUM',
        category: 'TRACKER',
        title: `Tracker / Telemetry Domain: ${params.domain}`,
        detail: `Matched offline tracker indicator "${matched}" in SNI/DNS host.`,
        timestampNs: params.timestampNs,
        packetId: params.packetId,
      });
    }
  }

  if (SUSPICIOUS_PORTS.has(params.dstPort) || SUSPICIOUS_PORTS.has(params.srcPort)) {
    const flaggedPort = SUSPICIOUS_PORTS.has(params.dstPort) ? params.dstPort : params.srcPort;
    alerts.push({
      id: `al-prt-${params.packetId}`,
      severity: 'HIGH',
      category: 'SUSPICIOUS_PORT',
      title: `Suspicious / Unencrypted Port ${flaggedPort}`,
      detail: `Traffic observed on flagged port ${flaggedPort} (${SERVICE_PORT_MAP[flaggedPort] || 'High-risk service'}).`,
      timestampNs: params.timestampNs,
      packetId: params.packetId,
    });
  }

  if (
    params.protocol === 'HTTP' &&
    params.asciiSnippet &&
    /(authorization:\s*basic|password=|token=|api_key=)/i.test(params.asciiSnippet)
  ) {
    alerts.push({
      id: `al-clr-${params.packetId}`,
      severity: 'HIGH',
      category: 'CLEARTEXT_CREDENTIAL',
      title: 'Cleartext Secret / Token in HTTP',
      detail: 'Detected credential or token header transmitted over unencrypted HTTP.',
      timestampNs: params.timestampNs,
      packetId: params.packetId,
    });
  }

  return alerts;
}
