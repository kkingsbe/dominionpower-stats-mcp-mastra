import type { DominionEnergyData } from '../types.js';

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /\/Date\((\d+)\)\//.exec(value);
  if (match) return new Date(Number(match[1]));
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(n) ? null : n;
}

export function parseBillForecast(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return {
      monthly_usage: null, grid_consumption: null, grid_return: null,
      current_bill: null, last_bill_amount: null, last_bill_usage: null,
      last_year_bill_amount: null, last_year_usage: null,
      billing_period_start: null, billing_period_end: null,
      current_rate: null, daily_cost: null,
    };
  }
  const details = (data as any).billForecastDetails?.[0];
  const result: Partial<DominionEnergyData> = {};
  if (details) {
    result.monthly_usage = parseNumber(details.month1Consumption);
    result.grid_consumption = parseNumber(details.month1GridConsumption);
    result.grid_return = parseNumber(details.month1GridReturn);
    result.current_bill = parseNumber(details.totalAmount) ?? parseNumber(details.budgetAmount);
    result.billing_period_start = parseDate(details.budgetStartDate);
    result.billing_period_end = parseDate(details.budgetEndDate);
  } else {
    result.monthly_usage = null;
    result.grid_consumption = null;
    result.grid_return = null;
    result.current_bill = null;
    result.billing_period_start = null;
    result.billing_period_end = null;
  }
  result.last_bill_amount = parseNumber((data as any).lastBillAmount);
  result.last_bill_usage = parseNumber((data as any).lastBillUsage);
  result.last_year_bill_amount = parseNumber((data as any).lastYearBillAmount);
  result.last_year_usage = parseNumber((data as any).lastYearUsage);
  return result;
}

export function parseCurrentBill(data: unknown): Partial<DominionEnergyData> {
  if (!data) {
    return {
      total_amount_due: null, previous_balance: null, payment_received: null,
      remaining_balance: null, bill_due_date: null, rate_category: null,
      auto_pay_enabled: null, next_meter_read_date: null,
      last_payment_date: null, last_payment_amount: null,
    };
  }
  const arr = Array.isArray(data) ? data : [data];
  const d = (arr[0] ?? {}) as Record<string, string | number | null | undefined>;
  return {
    total_amount_due: parseNumber(d.totalAmountDue),
    previous_balance: parseNumber(d.previousBalance),
    payment_received: parseNumber(d.paymentReceived),
    remaining_balance: parseNumber(d.remainingBalance),
    bill_due_date: parseDate(d.billDueDate as string | null | undefined),
    rate_category: (d.rateCategory as string | null | undefined) ?? null,
    auto_pay_enabled: (d.autoPayEnabled as boolean | null | undefined) ?? null,
    next_meter_read_date: null,
    last_payment_date: parseDate(d.paymentReceivedDate as string | null | undefined),
    last_payment_amount: parseNumber(d.paymentReceived),
  };
}

export function parseBillHistory(data: unknown): Partial<DominionEnergyData> {
  if (!data) {
    return { bill_history: null };
  }
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) return { bill_history: null };
  return {
    bill_history: arr as Array<Record<string, unknown>>,
  };
}
