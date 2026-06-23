export interface DominionEnergyData {
  grid_consumption: number | null;
  grid_return: number | null;
  monthly_usage: number | null;
  solar_generation: number | null;
  monthly_generation: Array<Record<string, unknown>> | null;
  daily_consumption: Array<Record<string, unknown>> | null;
  daily_generation: Array<Record<string, unknown>> | null;
  today_consumption: number | null;
  today_generation: number | null;
  today_net_usage: number | null;
  yesterday_consumption: number | null;
  yesterday_generation: number | null;
  yesterday_net_usage: number | null;
  hourly_consumption: Array<Record<string, unknown>> | null;
  hourly_generation: Array<Record<string, unknown>> | null;
  current_bill: number | null;
  billing_period_start: Date | null;
  billing_period_end: Date | null;
  bill_due_date: Date | null;
  previous_balance: number | null;
  payment_received: number | null;
  remaining_balance: number | null;
  total_amount_due: number | null;
  last_bill_amount: number | null;
  last_bill_usage: number | null;
  last_year_bill_amount: number | null;
  last_year_usage: number | null;
  last_payment_date: Date | null;
  last_payment_amount: number | null;
  current_rate: number | null;
  daily_cost: number | null;
  rate_category: string | null;
  daily_usage: Array<Record<string, unknown>> | null;
  daily_return: Array<Record<string, unknown>> | null;
  bill_history: Array<Record<string, unknown>> | null;
  next_meter_read_date: Date | null;
  auto_pay_enabled: boolean | null;
  is_net_metering: boolean | null;
  is_ami_meter: boolean | null;
  daily_high_temp: number | null;
  daily_low_temp: number | null;
  heating_degree_days: number | null;
  cooling_degree_days: number | null;
  monthly_avg_temp: number | null;
  meter_number: string | null;
  meter_id: number | null;
  meter_type: string | null;
  account_number: string | null;
}

export function emptyDominionEnergyData(): DominionEnergyData {
  return {
    grid_consumption: null,
    grid_return: null,
    monthly_usage: null,
    solar_generation: null,
    monthly_generation: null,
    daily_consumption: null,
    daily_generation: null,
    today_consumption: null,
    today_generation: null,
    today_net_usage: null,
    yesterday_consumption: null,
    yesterday_generation: null,
    yesterday_net_usage: null,
    hourly_consumption: null,
    hourly_generation: null,
    current_bill: null,
    billing_period_start: null,
    billing_period_end: null,
    bill_due_date: null,
    previous_balance: null,
    payment_received: null,
    remaining_balance: null,
    total_amount_due: null,
    last_bill_amount: null,
    last_bill_usage: null,
    last_year_bill_amount: null,
    last_year_usage: null,
    last_payment_date: null,
    last_payment_amount: null,
    current_rate: null,
    daily_cost: null,
    rate_category: null,
    daily_usage: null,
    daily_return: null,
    bill_history: null,
    next_meter_read_date: null,
    auto_pay_enabled: null,
    is_net_metering: null,
    is_ami_meter: null,
    daily_high_temp: null,
    daily_low_temp: null,
    heating_degree_days: null,
    cooling_degree_days: null,
    monthly_avg_temp: null,
    meter_number: null,
    meter_id: null,
    meter_type: null,
    account_number: null,
  };
}

export class DominionEnergyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DominionEnergyApiError';
  }
}

export class DominionEnergyAuthError extends DominionEnergyApiError {
  constructor(message: string) {
    super(message);
    this.name = 'DominionEnergyAuthError';
  }
}

export interface SessionData {
  token: string | null;
  refresh_token: string | null;
  token_expires: number;
  uuid: string | null;
  cookies: Record<string, string>;
  customer_number: string | null;
  contract: string | null;
}
