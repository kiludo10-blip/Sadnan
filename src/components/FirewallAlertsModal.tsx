import React, { useState } from 'react';
import { Plus, Shield, ShieldAlert, Trash2 } from 'lucide-react';
import { FirewallRule, FirewallRuleType, ThreatAlert } from '../types/capture';

interface Props {
  rules: FirewallRule[];
  alerts: ThreatAlert[];
  onAddRule: (type: FirewallRuleType, value: string, label: string) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
}

export const FirewallAlertsView: React.FC<Props> = ({
  rules,
  alerts,
  onAddRule,
  onToggleRule,
  onDeleteRule,
}) => {
  const [ruleType, setRuleType] = useState<FirewallRuleType>('DOMAIN');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleLabel, setRuleLabel] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = ruleValue.trim();
    if (!val) return;
    onAddRule(ruleType, val, ruleLabel.trim() || `Block ${ruleType} ${val}`);
    setRuleValue('');
    setRuleLabel('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Local Firewall Rules */}
      <div className="lg:col-span-6 space-y-4">
        <div className="rounded-xl bg-[#1C2026] border border-[#282F38] p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-[#EF5350]" />
            <div>
              <h2 className="text-sm font-semibold text-white">Local VPN Firewall Rules</h2>
              <p className="text-xs text-[#90A4AE]">
                Block traffic locally by App, IP, Port, or Domain without root
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as FirewallRuleType)}
              className="sm:col-span-3 h-9 px-2.5 rounded-lg bg-[#121518] border border-[#282F38] text-xs text-white"
              aria-label="Firewall rule type"
            >
              <option value="DOMAIN">Domain</option>
              <option value="IP">IP / Prefix</option>
              <option value="PORT">Port</option>
              <option value="APP">App Name</option>
            </select>
            <input
              type="text"
              value={ruleValue}
              onChange={(e) => setRuleValue(e.target.value)}
              placeholder={
                ruleType === 'DOMAIN'
                  ? 'e.g. app-measurement.com'
                  : ruleType === 'IP'
                    ? 'e.g. 142.250.'
                    : ruleType === 'PORT'
                      ? 'e.g. 23'
                      : 'e.g. Free Fire'
              }
              className="sm:col-span-5 h-9 px-3 rounded-lg bg-[#121518] border border-[#282F38] text-xs font-mono text-white placeholder-[#546E7A]"
            />
            <input
              type="text"
              value={ruleLabel}
              onChange={(e) => setRuleLabel(e.target.value)}
              placeholder="Label (optional)"
              className="sm:col-span-4 h-9 px-3 rounded-lg bg-[#121518] border border-[#282F38] text-xs text-white placeholder-[#546E7A]"
            />
            <button
              type="submit"
              className="sm:col-span-12 h-9 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Firewall Block Rule
            </button>
          </form>

          <div className="divide-y divide-[#252B34] rounded-lg border border-[#282F38] overflow-hidden">
            {rules.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#90A4AE] bg-[#181C22]">
                No local firewall rules configured.
              </div>
            ) : (
              rules.map((r) => (
                <div
                  key={r.id}
                  className="px-3.5 py-2.5 bg-[#181C22] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{r.label}</div>
                    <div className="text-[11px] font-mono text-[#90A4AE]">
                      {r.type}: <span className="text-[#CFD8DC]">{r.value}</span> · Hits:{' '}
                      <span className="text-[#EF5350] tabular-nums">{r.hitCount}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleRule(r.id)}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                        r.enabled
                          ? 'bg-[#EF5350]/20 text-[#EF5350] border border-[#EF5350]/40'
                          : 'bg-[#262C35] text-[#90A4AE]'
                      }`}
                    >
                      {r.enabled ? 'Blocking' : 'Disabled'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteRule(r.id)}
                      className="p-1.5 text-[#78909C] hover:text-[#EF5350] rounded transition-colors"
                      aria-label={`Delete rule ${r.label}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Threat & Tracker Alerts */}
      <div className="lg:col-span-6">
        <div className="rounded-xl bg-[#1C2026] border border-[#282F38] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#282F38] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#FFA726]" />
              <span className="text-sm font-semibold text-white">Threat & Telemetry Alerts</span>
            </div>
            <span className="text-xs font-mono tabular-nums text-[#90A4AE]">{alerts.length} detected</span>
          </div>

          <div className="divide-y divide-[#232932] max-h-[480px] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#90A4AE] bg-[#181C22]">
                No tracker domains, suspicious ports, cleartext credentials, or firewall blocks detected in current capture.
              </div>
            ) : (
              alerts.slice(0, 100).map((al) => (
                <div key={al.id} className="px-4 py-3 bg-[#181C22] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        al.severity === 'HIGH' ? 'text-[#EF5350]' : 'text-[#FFA726]'
                      }`}
                    >
                      {al.title}
                    </span>
                    <span className="text-[11px] font-mono text-[#78909C]">{al.category}</span>
                  </div>
                  <p className="text-xs text-[#B0BEC5]">{al.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
