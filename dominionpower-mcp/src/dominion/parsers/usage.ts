import type { DominionEnergyData } from '../types.js';

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(n) ? null : n;
}

export function parseElectricUsage(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return { monthly_usage: null };
  }
  const d = data as any;
  const details = d.electricUsages ?? d.electricUsageDetails;
  if (Array.isArray(details) && details.length > 0) {
    return { monthly_usage: parseNumber(details[0].consumption) };
  }
  return { monthly_usage: null };
}

export function parseGenerationData(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return { solar_generation: null, monthly_generation: null };
  }
  const details = (data as any).generationDetails;
  if (Array.isArray(details) && details.length > 0) {
    return {
      solar_generation: parseNumber(details[0].generation),
      monthly_generation: details,
    };
  }
  return { solar_generation: null, monthly_generation: null };
}

export function parseDailyUsage(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return {
      daily_consumption: null, daily_generation: null,
      today_consumption: null, today_generation: null, today_net_usage: null,
      yesterday_consumption: null, yesterday_generation: null, yesterday_net_usage: null,
    };
  }
  const d = data as any;
  const usages = d.electricUsages as Array<Record<string, unknown>> | undefined;
  const dailyConsumption = Array.isArray(usages) && usages.length > 0 ? usages : null;
  const today = dailyConsumption?.[dailyConsumption!.length - 1] ?? null;
  const yesterday = dailyConsumption?.[dailyConsumption!.length - 2] ?? null;
  return {
    daily_consumption: dailyConsumption,
    daily_generation: null,
    today_consumption: parseNumber(today?.consumption as string | number | null | undefined),
    today_generation: null,
    today_net_usage: null,
    yesterday_consumption: parseNumber(yesterday?.consumption as string | number | null | undefined),
    yesterday_generation: null,
    yesterday_net_usage: null,
  };
}

export function parseHourlyUsage(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return { hourly_consumption: null, hourly_generation: null };
  }
  const d = data as any;
  return {
    hourly_consumption: Array.isArray(d.hourlyConsumption) ? d.hourlyConsumption : null,
    hourly_generation: Array.isArray(d.hourlyGeneration) ? d.hourlyGeneration : null,
  };
}
