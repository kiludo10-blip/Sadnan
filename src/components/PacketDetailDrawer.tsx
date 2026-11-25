import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lock,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  analyzeRawResponseBody,
  decodeUtf8Preview,
  JsonTreeNode,
} from '../engine/bodyBeautifier';
import { CapturedPacket } from '../types/capture';

interface Props {
  packet: CapturedPacket | null;
  onClose: () => void;
}

type DetailTab = 'raw_response_body' | 'raw_payload' | 'hex_ascii';
type JsonViewMode = 'tree' | 'code' | 'raw';

const JsonTreeItem: React.FC<{ node: JsonTreeNode; depth?: number }> = ({ node, depth = 0 }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = (node.type === 'object' || node.type === 'array') && (node.children?.length ?? 0) > 0;

  const renderScalar = () => {
    if (node.type === 'string') return <span className="text-[#66BB6A]">"{String(node.value)}"</span>;
    if (node.type === 'number') return <span className="text-[#FFA726]">{String(node.value)}</span>;
    if (node.type === 'boolean') return <span className="text-[#26A69A]">{String(node.value)}</span>;
    return <span className="text-[#90A4AE] italic">null</span>;
  };

  return (
    <div className="font-mono text-xs leading-relaxed">
      <div
        className={`flex items-start gap-1.5 py-0.5 px-1.5 rounded hover:bg-[#232933] ${
          hasChildren ? 'cursor-pointer' : ''
        }`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={() => hasChildren && setExpanded((prev) => !prev)}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#78909C] mt-0.5 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#78909C] mt-0.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="text-[#80CBC4] shrink-0">{node.key}:</span>
        {hasChildren ? (
          <span className="text-[#90A4AE]">
            {node.type === 'array' ? `Array [${node.itemCount} items]` : `Object {${node.itemCount} keys}`}
          </span>
        ) : (
          <span className="break-all">{renderScalar()}</span>
        )}
      </div>
      {hasChildren && expanded && node.children?.map((child, idx) => (
        <JsonTreeItem key={`${child.key}-${idx}`} node={child} depth={depth + 1} />
      ))}
    </div>
  );
};

function renderHtmlHighlightedLine(line: string): React.ReactNode {
  const parts = line.split(/(<\/?[a-zA-Z0-9-]+|\/?>|="[^"]*")/g);
  return parts.map((part, idx) => {
    if (part.startsWith('<')) return <span key={idx} className="text-[#26A69A]">{part}</span>;
    if (part === '>' || part === '/>') return <span key={idx} className="text-[#26A69A]">{part}</span>;
    if (part.startsWith('="')) return <span key={idx} className="text-[#66BB6A]">{part}</span>;
    return <span key={idx} className="text-[#ECEFF1]">{part}</span>;
  });
}

function formatHexAsciiRows(bytes: Uint8Array, limit = 2048): Array<{ offset: string; hex: string; ascii: string }> {
  const max = Math.min(bytes.length, limit);
  const rows: Array<{ offset: string; hex: string; ascii: string }> = [];
  for (let i = 0; i < max; i += 16) {
    const slice = bytes.subarray(i, Math.min(i + 16, max));
    const hexParts: string[] = [];
    let ascii = '';
    for (let j = 0; j < 16; j++) {
      if (j < slice.length) {
        const b = slice[j];
        hexParts.push(b.toString(16).padStart(2, '0'));
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
      } else {
        hexParts.push('  ');
      }
    }
    rows.push({
      offset: i.toString(16).padStart(4, '0'),
      hex: `${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}`,
      ascii,
    });
  }
  return rows;
}

export const PacketDetailDrawer: React.FC<Props> = ({ packet, onClose }) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('raw_response_body');
  const [jsonView, setJsonView] = useState<JsonViewMode>('tree');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const beautified = useMemo(() => (packet ? analyzeRawResponseBody(packet) : null), [packet]);
  const rawPayloadPreview = useMemo(
    () => (packet ? decodeUtf8Preview(packet.rawBytes.subarray(packet.payloadOffset)) : ''),
    [packet]
  );
  const hexRows = useMemo(() => (packet ? formatHexAsciiRows(packet.rawBytes) : []), [packet]);

  if (!packet || !beautified) return null;

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // clipboard fallback ignored in non-HTTPS contexts
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[2px]" role="dialog" aria-label="Packet detail drawer">
      <div className="w-full max-w-2xl h-full bg-[#121518] border-l border-[#282F38] flex flex-col shadow-2xl">
        {/* Top Bar */}
        <div className="px-4 py-3 bg-[#1C2026] border-b border-[#282F38] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="font-mono text-[#26A69A]">#{packet.sequence}</span>
              <span>·</span>
              <span
                className={
                  packet.blocked
                    ? 'text-[#EF5350]'
                    : packet.protocol === 'HTTPS' || packet.protocol === 'TLS' || packet.protocol === 'QUIC'
                      ? 'text-[#FFA726]'
                      : 'text-[#66BB6A]'
                }
              >
                {packet.protocol}
              </span>
              <span>·</span>
              <span className="truncate">{packet.appName}</span>
            </div>
            <p className="text-xs font-mono tabular-nums text-[#90A4AE] truncate mt-0.5">
              {packet.srcIp}:{packet.srcPort} → {packet.dstIp}:{packet.dstPort} · {packet.direction} · IPv{packet.ipVersion}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#90A4AE] hover:text-white hover:bg-[#262C35] transition-colors shrink-0"
            aria-label="Close packet detail drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wire Telemetry Summary Strip */}
        <div className="px-4 py-2.5 bg-[#181C22] border-b border-[#262C35] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-[#78909C]">Timestamp (ns)</div>
            <div className="font-mono tabular-nums text-[#ECEFF1] truncate" title={packet.timestampNs}>
              {packet.timestampNs}
            </div>
          </div>
          <div>
            <div className="text-[#78909C]">Frame / Payload</div>
            <div className="font-mono tabular-nums text-[#ECEFF1]">
              {packet.totalLength} B / {packet.payloadLength} B
            </div>
          </div>
          <div>
            <div className="text-[#78909C]">Offline Geo / ASN</div>
            <div className="font-mono text-[#ECEFF1] truncate">
              {packet.enrichment.countryCode} · {packet.enrichment.asn}
            </div>
          </div>
          <div>
            <div className="text-[#78909C]">Service / Origin</div>
            <div className="font-mono text-[#ECEFF1] truncate">
              {packet.enrichment.service}
            </div>
          </div>
        </div>

        {/* Threat Alerts Banner if present */}
        {packet.alerts.length > 0 && (
          <div className="px-4 py-2 bg-[#2B1719] border-b border-[#EF5350]/35 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-[#EF5350] mt-0.5 shrink-0" />
            <div className="text-xs text-[#FFCDD2] space-y-0.5">
              {packet.alerts.map((al) => (
                <div key={al.id}>
                  <strong className="text-[#EF5350]">{al.title}</strong> — {al.detail}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Drawer Tabs */}
        <div className="px-4 bg-[#1C2026] border-b border-[#282F38] flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: 'raw_response_body', label: 'Raw Response Body' },
              { id: 'raw_payload', label: 'Raw Body / Payload' },
              { id: 'hex_ascii', label: 'Hex + ASCII' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-[#26A69A] text-[#26A69A]'
                  : 'border-transparent text-[#90A4AE] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'raw_response_body' && (
            <div className="space-y-3">
              {/* Content-Type & Decoder Metadata Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#242A33] text-xs">
                <div className="flex flex-wrap items-center gap-2 text-[#B0BEC5]">
                  <span>Detected: <strong className="text-white font-mono">{beautified.detectedContentType}</strong></span>
                  {beautified.strippedHttpHeaders && (
                    <>
                      <span>·</span>
                      <span className="text-[#26A69A]">HTTP headers stripped</span>
                    </>
                  )}
                  {beautified.wasChunkedDecoded && (
                    <>
                      <span>·</span>
                      <span className="text-[#66BB6A]">Chunked transfer decoded</span>
                    </>
                  )}
                  {beautified.jsonPrefix && (
                    <>
                      <span>·</span>
                      <span className="text-[#FFA726] font-mono">Prefix stripped: {beautified.jsonPrefix}</span>
                    </>
                  )}
                </div>
                {beautified.mode !== 'empty' && (
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        'body',
                        beautified.mode === 'encrypted'
                          ? beautified.ciphertextBase64 || ''
                          : beautified.formattedText
                      )
                    }
                    className="px-2.5 py-1 rounded bg-[#1C2026] hover:bg-[#262C35] border border-[#2F3742] text-xs text-[#ECEFF1] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedKey === 'body' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#66BB6A]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Body
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Encrypted Wire Breakdown + Non-Decryption Notice */}
              {beautified.mode === 'encrypted' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-[#261E14] border border-[#FFA726]/35 flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-[#FFA726] mt-0.5 shrink-0" />
                    <div className="text-xs text-[#FFE0B2] space-y-1">
                      <div className="font-semibold text-[#FFA726]">
                        Encrypted Ciphertext Preserved — Not Decrypted
                      </div>
                      <p>
                        SADNAN CAPTURE enforces strict cryptographic honesty: encrypted TLS / HTTPS / QUIC payloads are never labeled as decrypted without valid session decryption keys.
                      </p>
                    </div>
                  </div>

                  {/* Observable Unencrypted Handshake / QUIC Metadata */}
                  <div className="p-3 rounded-lg bg-[#181C22] border border-[#282F38] space-y-2">
                    <div className="text-xs font-semibold text-[#ECEFF1]">Observable Unencrypted Wire Metadata</div>
                    {packet.tls && (
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div><span className="text-[#78909C]">Record:</span> {packet.tls.recordType} ({packet.tls.recordVersion})</div>
                        {packet.tls.handshakeType && <div><span className="text-[#78909C]">Handshake:</span> {packet.tls.handshakeType}</div>}
                        {packet.tls.sni && <div><span className="text-[#78909C]">SNI:</span> <span className="text-[#FFA726]">{packet.tls.sni}</span></div>}
                        {packet.tls.alpn && <div><span className="text-[#78909C]">ALPN:</span> {packet.tls.alpn.join(', ')}</div>}
                        {packet.tls.cipherCount !== undefined && <div><span className="text-[#78909C]">Ciphers:</span> {packet.tls.cipherCount} offered</div>}
                        {packet.tls.certificateCn && <div><span className="text-[#78909C]">Cert CN:</span> {packet.tls.certificateCn}</div>}
                        {packet.tls.clientRandom && (
                          <div className="col-span-2 break-all">
                            <span className="text-[#78909C]">Client Random:</span> {packet.tls.clientRandom}
                          </div>
                        )}
                        {packet.tls.matchedKeylogSecret && (
                          <div className="col-span-2 break-all text-[#66BB6A]">
                            SSLKEYLOGFILE Matched Secret: {packet.tls.matchedKeylogSecret}
                          </div>
                        )}
                      </div>
                    )}
                    {packet.quic && (
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div><span className="text-[#78909C]">Header:</span> {packet.quic.headerForm} ({packet.quic.packetType})</div>
                        <div><span className="text-[#78909C]">Version:</span> {packet.quic.version}</div>
                        <div className="col-span-2 break-all"><span className="text-[#78909C]">DCID:</span> {packet.quic.dcid}</div>
                        <div className="col-span-2 break-all"><span className="text-[#78909C]">SCID:</span> {packet.quic.scid}</div>
                      </div>
                    )}
                  </div>

                  {/* Preserved Base64 & Hex Ciphertext */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#B0BEC5]">Preserved Base64 Ciphertext</div>
                    <pre className="p-3 rounded-lg bg-[#181C22] border border-[#282F38] text-xs font-mono text-[#CFD8DC] break-all whitespace-pre-wrap">
                      {beautified.ciphertextBase64}
                    </pre>
                    <div className="text-xs font-semibold text-[#B0BEC5]">Preserved Hex Ciphertext</div>
                    <pre className="p-3 rounded-lg bg-[#181C22] border border-[#282F38] text-xs font-mono text-[#90A4AE] whitespace-pre-wrap">
                      {beautified.ciphertextHex}
                    </pre>
                  </div>
                </div>
              )}

              {/* JSON / NDJSON / Prefixed JSON */}
              {beautified.mode === 'json' && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-[#1C2026] w-fit border border-[#282F38]">
                    {(
                      [
                        { id: 'tree', label: 'Tree View' },
                        { id: 'code', label: 'Code Block' },
                        { id: 'raw', label: 'Raw' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setJsonView(m.id)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          jsonView === m.id
                            ? 'bg-[#00897B] text-white'
                            : 'text-[#90A4AE] hover:text-white'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {jsonView === 'tree' && beautified.jsonTree && (
                    <div className="p-2.5 rounded-lg bg-[#181C22] border border-[#282F38] overflow-x-auto">
                      <JsonTreeItem node={beautified.jsonTree} />
                    </div>
                  )}

                  {jsonView === 'code' && (
                    <div className="rounded-lg bg-[#181C22] border border-[#282F38] overflow-x-auto p-3 font-mono text-xs">
                      {beautified.formattedText.split('\n').map((line, i) => (
                        <div key={i} className="flex gap-3 leading-relaxed">
                          <span className="w-8 text-right text-[#546E7A] select-none tabular-nums shrink-0">{i + 1}</span>
                          <span className="text-[#ECEFF1] whitespace-pre">{line}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {jsonView === 'raw' && (
                    <pre className="p-3 rounded-lg bg-[#181C22] border border-[#282F38] font-mono text-xs text-[#CFD8DC] whitespace-pre-wrap break-all">
                      {beautified.rawBodyText}
                    </pre>
                  )}
                </div>
              )}

              {/* HTML Beautifier with Line Numbers */}
              {beautified.mode === 'html' && (
                <div className="rounded-lg bg-[#181C22] border border-[#282F38] overflow-x-auto p-3 font-mono text-xs">
                  {beautified.formattedText.split('\n').map((line, i) => (
                    <div key={i} className="flex gap-3 leading-relaxed">
                      <span className="w-8 text-right text-[#546E7A] select-none tabular-nums shrink-0">{i + 1}</span>
                      <span className="whitespace-pre">{renderHtmlHighlightedLine(line)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Plaintext with Line Numbers */}
              {beautified.mode === 'plaintext' && (
                <div className="rounded-lg bg-[#181C22] border border-[#282F38] overflow-x-auto p-3 font-mono text-xs">
                  {beautified.formattedText.split('\n').map((line, i) => (
                    <div key={i} className="flex gap-3 leading-relaxed">
                      <span className="w-8 text-right text-[#546E7A] select-none tabular-nums shrink-0">{i + 1}</span>
                      <span className="text-[#ECEFF1] whitespace-pre-wrap break-all">{line}</span>
                    </div>
                  ))}
                </div>
              )}

              {beautified.mode === 'empty' && (
                <div className="p-6 rounded-lg bg-[#181C22] border border-[#282F38] text-center text-xs text-[#90A4AE]">
                  No response body bytes present in this frame ({beautified.detectedContentType}).
                </div>
              )}
            </div>
          )}

          {activeTab === 'raw_payload' && (
            <div className="space-y-3">
              {/* L4 / L7 Structured Breakdown */}
              <div className="p-3 rounded-lg bg-[#181C22] border border-[#282F38] space-y-2 text-xs font-mono">
                <div className="font-sans font-semibold text-[#ECEFF1]">Transport & Dissector Metadata</div>
                {packet.tcp && (
                  <div className="grid grid-cols-2 gap-2 text-[#B0BEC5]">
                    <div>Seq: <span className="text-white">{packet.tcp.seq}</span></div>
                    <div>Ack: <span className="text-white">{packet.tcp.ack}</span></div>
                    <div>Flags: <span className="text-[#26A69A]">{packet.tcp.flagString}</span></div>
                    <div>Window: <span className="text-white">{packet.tcp.windowSize}</span></div>
                  </div>
                )}
                {packet.udp && (
                  <div className="grid grid-cols-2 gap-2 text-[#B0BEC5]">
                    <div>UDP Length: <span className="text-white">{packet.udp.length} B</span></div>
                    <div>Checksum: <span className="text-white">{packet.udp.checksum}</span></div>
                  </div>
                )}
                {packet.dns && (
                  <div className="space-y-1 text-[#B0BEC5]">
                    <div>DNS {packet.dns.isResponse ? 'Response' : 'Query'}: <span className="text-[#66BB6A]">{packet.dns.queryName}</span> ({packet.dns.queryType})</div>
                    <div>RCODE: <span className="text-white">{packet.dns.rcode}</span> {packet.dns.answers.length > 0 && `· Answers: ${packet.dns.answers.join(', ')}`}</div>
                  </div>
                )}
                {packet.http && (
                  <div className="space-y-1 text-[#B0BEC5]">
                    <div className="text-[#66BB6A]">
                      {packet.http.isRequest
                        ? `${packet.http.method} ${packet.http.path} ${packet.http.version}`
                        : `${packet.http.version} ${packet.http.statusCode} ${packet.http.statusText}`}
                    </div>
                    {Object.entries(packet.http.headers).map(([k, v]) => (
                      <div key={k} className="truncate"><span className="text-[#78909C]">{k}:</span> {v}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#B0BEC5]">UTF-8 Payload Preview ({packet.payloadLength} B)</span>
                <button
                  type="button"
                  onClick={() => copyText('payload', rawPayloadPreview)}
                  className="px-2.5 py-1 rounded bg-[#1C2026] hover:bg-[#262C35] border border-[#2F3742] text-xs text-[#ECEFF1] flex items-center gap-1.5"
                >
                  {copiedKey === 'payload' ? <Check className="w-3.5 h-3.5 text-[#66BB6A]" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy Payload
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-[#181C22] border border-[#282F38] font-mono text-xs text-[#CFD8DC] whitespace-pre-wrap break-all">
                {rawPayloadPreview || '(0 payload bytes — L3/L4 control frame)'}
              </pre>
            </div>
          )}

          {activeTab === 'hex_ascii' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[#90A4AE]">
                <span>Complete Raw IPv{packet.ipVersion} Frame ({packet.rawBytes.length} bytes)</span>
                <span>Offset · Hex · ASCII</span>
              </div>
              <div className="rounded-lg bg-[#181C22] border border-[#282F38] p-3 overflow-x-auto font-mono text-xs space-y-0.5">
                {hexRows.map((row) => (
                  <div key={row.offset} className="flex items-center gap-4 whitespace-pre">
                    <span className="text-[#546E7A] tabular-nums">{row.offset}</span>
                    <span className="text-[#80CBC4]">{row.hex}</span>
                    <span className="text-[#CFD8DC] border-l border-[#2D3540] pl-3">{row.ascii}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
