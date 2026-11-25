import React from 'react';
import { FriendlyAppId } from '../types/capture';

interface Props {
  appId: FriendlyAppId;
  size?: number;
}

export const AppIconBadge: React.FC<Props> = ({ appId, size = 36 }) => {
  const boxStyle = { width: size, height: size };

  if (appId === 'free_fire') {
    return (
      <div
        style={boxStyle}
        className="rounded-xl bg-[#2A1D12] border border-[#FFA726]/30 flex items-center justify-center shrink-0"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#FFA726]" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M12 2c1.5 3.5 4.5 5 4.5 9a4.5 4.5 0 1 1-9 0c0-2 1-3.8 2-5 .5 1.8 1.8 2.4 2.5 2.4 0-2.5-.5-4.4 0-6.4Z" />
          <path d="M12 18v3" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  if (appId === 'free_fire_max') {
    return (
      <div
        style={boxStyle}
        className="rounded-xl bg-[#2C1814] border border-[#FF7043]/35 flex items-center justify-center shrink-0"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#FF7043]" fill="none" stroke="currentColor" strokeWidth="1.9">
          <polygon points="12 2 15 8.5 22 9.5 17 14.5 18.2 21.5 12 18 5.8 21.5 7 14.5 2 9.5 9 8.5 12 2" />
        </svg>
      </div>
    );
  }

  if (appId === 'chrome') {
    return (
      <div
        style={boxStyle}
        className="rounded-xl bg-[#15241D] border border-[#66BB6A]/30 flex items-center justify-center shrink-0"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#66BB6A]" fill="none" stroke="currentColor" strokeWidth="1.9">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 8.5h8.2M8.9 13.7 4.8 6.6M15.1 13.7l-4.1 7.1" />
        </svg>
      </div>
    );
  }

  if (appId === 'whatsapp') {
    return (
      <div
        style={boxStyle}
        className="rounded-xl bg-[#122624] border border-[#26A69A]/35 flex items-center justify-center shrink-0"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#26A69A]" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 20.5l1.5-5.2A8.5 8.5 0 1 1 21 11.5Z" />
          <path d="M9.5 9.5c.3 1.8 2.2 3.7 4 4l1.2-1.1 1.8.8v1.5c0 .4-.4.8-.9.8-3.6-.3-6.8-3.5-7.1-7.1 0-.5.4-.9.8-.9H11l.8 1.8-1.3 1.2Z" />
        </svg>
      </div>
    );
  }

  // All Isolated Apps
  return (
    <div
      style={boxStyle}
      className="rounded-xl bg-[#132428] border border-[#00897B]/40 flex items-center justify-center shrink-0"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#26A69A]" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M12 3 4 7v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V7l-8-4Z" />
        <path d="M9 12h6M12 9v6" strokeLinecap="round" />
      </svg>
    </div>
  );
};
