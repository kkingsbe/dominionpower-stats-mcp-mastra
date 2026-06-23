import type { DominionEnergyData } from '../types.js';

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(n) ? null : n;
}

export function parseWeatherData(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return {
      daily_high_temp: null, daily_low_temp: null,
      heating_degree_days: null, cooling_degree_days: null,
      monthly_avg_temp: null,
    };
  }
  const d = data as any;
  const dailyWeather = d.zDailyWeather?.results as Array<Record<string, unknown>> | undefined;
  const dailyTemps = d.zAveTemperature?.results as Array<Record<string, unknown>> | undefined;
  return {
    daily_high_temp: parseNumber(dailyWeather?.[0]?.highTemp ?? d.dailyHighTemp),
    daily_low_temp: parseNumber(dailyWeather?.[0]?.lowTemp ?? d.dailyLowTemp),
    heating_degree_days: parseNumber(dailyWeather?.[0]?.heatingDegreeDays ?? d.heatingDegreeDays),
    cooling_degree_days: parseNumber(dailyWeather?.[0]?.coolingDegreeDays ?? d.coolingDegreeDays),
    monthly_avg_temp: parseNumber(dailyTemps?.[0]?.averageTemp ?? d.monthlyAvgTemp),
  };
}
