import { CapturedPacket, FirewallRule, FriendlyAppId, KeylogEntry } from '../types/capture';
import { analyzeRawResponseBody } from './bodyBeautifier';
import { dissectRawIpPacket } from './dissector';

/**
 * Encodes captured packets into standard libpcap nanosecond format (.pcap)
 * Magic: 0xa1b23c4d, LinkType: 101 (LINKTYPE_RAW — Raw IPv4/IPv6 without Ethernet header)
 */
export function encodePcapBinary(packets: CapturedPacket[]): Uint8Array {
  let totalBytes = 24;
  for (const p of packets) {
    totalBytes += 16 + p.rawBytes.length;
  }
  const buf = new Uint8Array(totalBytes);
  const dv = new DataView(buf.buffer);

  // Global Header (24 bytes, little-endian)
  dv.setUint32(0, 0xa1b23c4d, true); // Nanosecond-resolution PCAP magic
  dv.setUint16(4, 2, true); // Version major
  dv.setUint16(6, 4, true); // Version minor
  dv.setInt32(8, 0, true); // Thiszone
  dv.setUint32(12, 0, true); // Sigfigs
  dv.setUint32(16, 65535, true); // Snaplen
  dv.setUint32(20, 101, true); // LINKTYPE_RAW (Raw IP)

  let offset = 24;
  for (const pkt of packets) {
    const nsBig = BigInt(pkt.timestampNs);
    const sec = Number(nsBig / 1_000_000_000n);
    const nsec = Number(nsBig % 1_000_000_000n);

    dv.setUint32(offset, sec >>> 0, true);
    dv.setUint32(offset + 4, nsec >>> 0, true);
    dv.setUint32(offset + 8, pkt.rawBytes.length, true);
    dv.setUint32(offset + 12, pkt.totalLength, true);
    buf.set(pkt.rawBytes, offset + 16);
    offset += 16 + pkt.rawBytes.length;
  }

  return buf;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * Encodes captured packets into standard PCAPNG (.pcapng) format:
 * Section Header Block (SHB) + Interface Description Block (IDB) + Enhanced Packet Blocks (EPB)
 */
export function encodePcapngBinary(packets: CapturedPacket[]): Uint8Array {
  const shbLen = 28;
  const idbLen = 20;
  let totalLen = shbLen + idbLen;

  const epbLengths = packets.map((p) => 32 + pad4(p.rawBytes.length));
  for (const len of epbLengths) totalLen += len;

  const buf = new Uint8Array(totalLen);
  const dv = new DataView(buf.buffer);

  // 1. Section Header Block (0x0A0D0D0A)
  dv.setUint32(0, 0x0a0d0d0a, true);
  dv.setUint32(4, shbLen, true);
  dv.setUint32(8, 0x1a2b3c4d, true); // Byte-order magic
  dv.setUint16(12, 1, true); // Major 1
  dv.setUint16(14, 0, true); // Minor 0
  dv.setBigInt64(16, -1n, true); // Section length unspecified
  dv.setUint32(24, shbLen, true);

  // 2. Interface Description Block (0x00000001)
  let offset = shbLen;
  dv.setUint32(offset, 0x00000001, true);
  dv.setUint32(offset + 4, idbLen, true);
  dv.setUint16(offset + 8, 101, true); // LINKTYPE_RAW
  dv.setUint16(offset + 10, 0, true); // Reserved
  dv.setUint32(offset + 12, 65535, true); // SnapLen
  dv.setUint32(offset + 16, idbLen, true);
  offset += idbLen;

  // 3. Enhanced Packet Blocks (0x00000006)
  for (let i = 0; i < packets.length; i++) {
    const pkt = packets[i];
    const blockLen = epbLengths[i];
    const usBig = BigInt(pkt.timestampNs) / 1000n;
    const tsHigh = Number((usBig >> 32n) & 0xffffffffn);
    const tsLow = Number(usBig & 0xffffffffn);

    dv.setUint32(offset, 0x00000006, true);
    dv.setUint32(offset + 4, blockLen, true);
    dv.setUint32(offset + 8, 0, true); // Interface ID 0
    dv.setUint32(offset + 12, tsHigh >>> 0, true);
    dv.setUint32(offset + 16, tsLow >>> 0, true);
    dv.setUint32(offset + 20, pkt.rawBytes.length, true);
    dv.setUint32(offset + 24, pkt.totalLength, true);
    buf.set(pkt.rawBytes, offset + 28);
    dv.setUint32(offset + blockLen - 4, blockLen, true);
    offset += blockLen;
  }

  return buf;
}

export function encodeRawBodiesText(packets: CapturedPacket[]): string {
  const sections: string[] = [
    'SADNAN CAPTURE — Raw Body & Payload Export',
    `Generated: ${new Date().toISOString()}`,
    `Packets: ${packets.length}`,
    '='.repeat(72),
    '',
  ];

  for (const pkt of packets) {
    const body = analyzeRawResponseBody(pkt);
    sections.push(
      `[#${pkt.sequence}] ${pkt.protocol} ${pkt.direction} | ${pkt.srcIp}:${pkt.srcPort} -> ${pkt.dstIp}:${pkt.dstPort} | ${pkt.timestampNs}ns | ${pkt.totalLength}B`
    );
    sections.push(`App: ${pkt.appName} | ASN: ${pkt.enrichment.asn} (${pkt.enrichment.countryCode})`);
    if (body.mode === 'encrypted') {
      sections.push('[ENCRYPTED CIPHERTEXT — NOT DECRYPTED]');
      sections.push(`Base64: ${body.ciphertextBase64 || ''}`);
    } else if (body.mode === 'empty') {
      sections.push('[NO PAYLOAD BODY]');
    } else {
      sections.push(`Content-Type: ${body.detectedContentType}`);
      sections.push(body.formattedText);
    }
    sections.push('-'.repeat(72));
  }

  return sections.join('\n');
}

/**
 * Parses uploaded real .pcap or .pcapng files into CapturedPacket[]
 */
export function parsePcapOrPcapngFile(
  bytes: Uint8Array,
  opts: {
    startSeq: number;
    appId: FriendlyAppId;
    appName: string;
    keylogEntries: KeylogEntry[];
    firewallRules: FirewallRule[];
  }
): CapturedPacket[] {
  if (bytes.length < 24) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magicLE = dv.getUint32(0, true);
  const magicBE = dv.getUint32(0, false);

  const packets: CapturedPacket[] = [];
  let seq = opts.startSeq;

  // PCAPNG Section Header Block (0x0A0D0D0A)
  if (magicLE === 0x0a0d0d0a) {
    let offset = 0;
    let linkType = 101;
    while (offset + 12 <= bytes.length) {
      const blockType = dv.getUint32(offset, true);
      const blockLen = dv.getUint32(offset + 4, true);
      if (blockLen < 12 || offset + blockLen > bytes.length) break;

      if (blockType === 0x00000001 && offset + 12 <= bytes.length) {
        linkType = dv.getUint16(offset + 8, true);
      } else if (blockType === 0x00000006 && blockLen >= 32) {
        const tsHigh = dv.getUint32(offset + 12, true);
        const tsLow = dv.getUint32(offset + 16, true);
        const capLen = dv.getUint32(offset + 20, true);
        let frame = bytes.subarray(offset + 28, Math.min(offset + 28 + capLen, offset + blockLen - 4));
        if (linkType === 1 && frame.length > 14) {
          // Strip 14-byte Ethernet header if LINKTYPE_ETHERNET
          frame = frame.subarray(14);
        }
        const us = (BigInt(tsHigh) << 32n) | BigInt(tsLow);
        const ns = (us * 1000n).toString();
        const ms = Number(us / 1000n);
        const parsed = dissectRawIpPacket(frame, {
          sequence: seq++,
          timestampNs: ns,
          timestampMs: ms > 0 ? ms : Date.now(),
          appId: opts.appId,
          appName: opts.appName,
          direction: 'OUTBOUND',
          keylogEntries: opts.keylogEntries,
          firewallRules: opts.firewallRules,
          sourceOrigin: 'PCAP_IMPORT',
        });
        if (parsed) packets.push(parsed);
      }
      offset += blockLen;
    }
    return packets;
  }

  // Classic PCAP (microsecond or nanosecond)
  const isLE = magicLE === 0xa1b2c3d4 || magicLE === 0xa1b23c4d;
  const isBE = magicBE === 0xa1b2c3d4 || magicBE === 0xa1b23c4d;
  if (!isLE && !isBE) return [];

  const le = isLE;
  const isNano = (le ? magicLE : magicBE) === 0xa1b23c4d;
  const linkType = dv.getUint32(20, le);

  let offset = 24;
  while (offset + 16 <= bytes.length) {
    const tsSec = dv.getUint32(offset, le);
    const tsSub = dv.getUint32(offset + 4, le);
    const inclLen = dv.getUint32(offset + 8, le);
    offset += 16;
    if (offset + inclLen > bytes.length) break;

    let frame = bytes.subarray(offset, offset + inclLen);
    if (linkType === 1 && frame.length > 14) {
      frame = frame.subarray(14);
    }
    const ns = isNano
      ? (BigInt(tsSec) * 1_000_000_000n + BigInt(tsSub)).toString()
      : (BigInt(tsSec) * 1_000_000_000n + BigInt(tsSub) * 1_000n).toString();
    const ms = tsSec * 1000 + Math.floor(tsSub / (isNano ? 1_000_000 : 1_000));

    const parsed = dissectRawIpPacket(frame, {
      sequence: seq++,
      timestampNs: ns,
      timestampMs: ms > 0 ? ms : Date.now(),
      appId: opts.appId,
      appName: opts.appName,
      direction: 'OUTBOUND',
      keylogEntries: opts.keylogEntries,
      firewallRules: opts.firewallRules,
      sourceOrigin: 'PCAP_IMPORT',
    });
    if (parsed) packets.push(parsed);
    offset += inclLen;
  }

  return packets;
}
