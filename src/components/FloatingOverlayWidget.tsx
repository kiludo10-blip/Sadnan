import React, { useMemo, useRef, useState } from 'react';
import { GripHorizontal, Square, X } from 'lucide-react';
import { CapturedPacket, ProtocolType } from '../types/capture';

interface Props {
  visible: boolean;
  isCapturing: boolean;
  packets: CapturedPacket[];
  droppedPackets: number;
  onStopCapture: () => void;
  onCloseOverlay: () => void;
  onSelectPacket: (pkt: CapturedPacket) => void;
}

type OverlayProto = 'ALL' | 'HTTPS' | 'UDP' | 'TCP' | 'DNS' | 'TLS' | 'QUIC';
const OVERLAY_PROTOS: OverlayProto[] = ['ALL', 'HTTPS', 'UDP', 'TCP', 'DNS', 'TLS', 'QUIC'];

function formatCompactBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function protoColorClass(proto: ProtocolType): string {
  if (proto === 'UDP' || proto === 'HTTP' || proto === 'DNS') return 'text-[#66BB6A]';
  if (proto === 'HTTPS' || proto === 'TLS' || proto === 'QUIC') return 'text-[#FFA726]';
  return 'text-[#26A69A]';
}

export const FloatingOverlayWidget: React.FC<Props> = ({
  visible,
  isCapturing,
  packets,
  droppedPackets,
  onStopCapture,
  onCloseOverlay,
  onSelectPacket,
}) => {
  const [filterProto, setFilterProto] = useState<OverlayProto>('ALL');
  const [pos, setPos] = useState({ x: 24, y: 120 });
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    origX: 24,
    origY: 120,
  });

  const totalBytes = useMemo(() => packets.reduce((acc, p) => acc + p.totalLength, 0), [packets]);
  const feed = useMemo(() => {
    const list =
      filterProto === 'ALL'
        ? packets
        : packets.filter((p) => p.protocol === filterProto);
    return list.slice(-14).reverse();
  }, [packets, filterProto]);

  if (!visible) return null;

  return (
    <div
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      className="fixed top-0 left-0 z-50 w-[340px] max-w-[92vw] rounded-xl bg-[#1C2026]/95 backdrop-blur-md border border-[#2F3742] shadow-2xl select-none"
      role="dialog"
      aria-label="Floating capture overlay"
    >
      {/* Drag Handle Header */}
      <div
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = {
            dragging: true,
            startX: e.clientX,
            startY: e.clientY,
            origX: pos.x,
            origY: pos.y,
          };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.dragging) return;
          setPos({
            x: Math.max(8, Math.min(window.innerWidth - 350, dragRef.current.origX + (e.clientX - dragRef.current.startX))),
            y: Math.max(8, Math.min(window.innerHeight - 220, dragRef.current.origY + (e.clientY - dragRef.current.startY))),
          });
        }}
        onPointerUp={() => {
          dragRef.current.dragging = false;
        }}
        className="flex items-center justify-between px-3 py-2.5 border-b border-[#2A303A] cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="w-4 h-4 text-[#78909C] shrink-0" />
          <span className="text-xs font-semibold text-[#ECEFF1] truncate">Floating Overlay</span>
          <span className="text-[11px] font-mono text-[#26A69A] whitespace-nowrap">
            {isCapturing ? 'CAPTURING' : 'PAUSED'}
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseOverlay}
          className="p-1 text-[#90A4AE] hover:text-white rounded transition-colors"
          aria-label="Close floating overlay"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Live Metrics Bar */}
      <div className="px-3 py-2 bg-[#16191E] border-b border-[#262C35] flex items-center justify-between text-xs font-mono tabular-nums text-[#B0BEC5]">
        <span>Pkts: <strong className="text-white">{packets.length}</strong></span>
        <span>Bytes: <strong className="text-[#26A69A]">{formatCompactBytes(totalBytes)}</strong></span>
        <span>Drops: <strong className={droppedPackets > 0 ? 'text-[#EF5350]' : 'text-[#ECEFF1]'}>{droppedPackets}</strong></span>
      </div>

      {/* Inline Protocol Filter Buttons */}
      <div className="px-2.5 py-2 flex items-center gap-1 overflow-x-auto border-b border-[#262C35]">
        {OVERLAY_PROTOS.map((proto) => (
          <button
            key={proto}
            type="button"
            onClick={() => setFilterProto(proto)}
            className={`px-2 py-1 text-[11px] font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
              filterProto === proto
                ? 'bg-[#00897B] text-white font-semibold'
                : 'bg-[#121518] text-[#90A4AE] hover:text-white'
            }`}
          >
            {proto}
          </button>
        ))}
      </div>

      {/* Live Scrolling Packet Feed */}
      <div className="max-h-48 overflow-y-auto divide-y divide-[#232830]">
        {feed.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[#78909C]">
            No {filterProto === 'ALL' ? '' : `${filterProto} `}packets captured yet.
          </div>
        ) : (
          feed.map((pkt) => (
            <button
              key={pkt.id}
              type="button"
              onClick={() => onSelectPacket(pkt)}
              className="w-full text-left px-3 py-1.5 hover:bg-[#232932] transition-colors flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  <span className={`font-semibold ${pkt.blocked ? 'text-[#EF5350]' : protoColorClass(pkt.protocol)}`}>
                    {pkt.protocol}
                  </span>
                  <span className="text-[#78909C]">·</span>
                  <span className="text-[#CFD8DC] truncate">
                    {pkt.tls?.sni || pkt.dns?.queryName || `${pkt.dstIp}:${pkt.dstPort}`}
                  </span>
                </div>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[#90A4AE] shrink-0">
                {pkt.totalLength} B
              </span>
            </button>
          ))
        )}
      </div>

      {/* Stop Capture Footer */}
      <div className="p-2.5 border-t border-[#2A303A] flex items-center justify-between gap-2">
        <span className="text-[11px] text-[#78909C]">Drag header to reposition</span>
        <button
          type="button"
          onClick={onStopCapture}
          disabled={!isCapturing}
          className="px-3 py-1.5 rounded-lg bg-[#EF5350] hover:bg-[#E53935] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Square className="w-3 h-3 fill-current" />
          Stop Capture
        </button>
      </div>
    </div>
  );
};
