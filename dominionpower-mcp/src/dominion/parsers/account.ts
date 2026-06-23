import type { DominionEnergyData } from '../types.js';

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(n) ? null : n;
}

export function parseMeterInfo(data: unknown): Partial<DominionEnergyData> {
  if (!data) {
    return {
      meter_number: null, meter_id: null, meter_type: null,
      account_number: null, is_ami_meter: null,
    };
  }
  // API returns an array of meter objects
  const arr = Array.isArray(data) ? data : [data];
  const d = (arr[0] ?? {}) as Record<string, unknown>;
  return {
    meter_number: (d.meterNumber as string | null | undefined) ?? null,
    meter_id: parseNumber(d.meterId as string | number | null | undefined),
    meter_type: (d.meterType as string | null | undefined) ?? null,
    account_number: (d.accountNumber as string | null | undefined) ?? null,
    is_ami_meter: (d.isAmiMeter as boolean | null | undefined) ?? null,
  };
}

export function parseBusinessMaster(
  data: Record<string, unknown> | null | undefined,
  _bpNumber?: string,
): Partial<DominionEnergyData> {
  if (!data) {
    return { is_net_metering: null };
  }
  const d = data as any;
  return {
    is_net_metering: d.isNetMetering ?? null,
  };
}
