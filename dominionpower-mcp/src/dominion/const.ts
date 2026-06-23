export const DOMAIN = "dominion_energy";

export const CONF_ACCOUNT_NUMBER = "account_number";

export const LOGIN_URL = "https://login.dominionenergy.com/CommonLogin";
export const API_BASE_URL = "https://prodsvc-dominioncip.smartcmobile.com/Service/api/1";
export const AUTH_API_BASE_URL = "https://prodsvc-dominioncip.smartcmobile.com/UsermanagementAPI/api/1";
export const ACCOUNT_MGMT_API_BASE_URL = "https://prodsvc-dominioncip.smartcmobile.com/AccountManagementapi/api/1";
export const USAGE_API_BASE_URL = "https://prodsvc-dominioncip.smartcmobile.com/Usageapi/api/V1";
export const BILLING_API_BASE_URL = "https://prodsvc-dominioncip.smartcmobile.com/BillingAPI/api/1";

export const BILL_FORECAST_ENDPOINT = "/bill/billForecast";
export const USAGE_HISTORY_ENDPOINT = "/usage/usageHistory";
export const USAGE_HISTORY_DETAIL_ENDPOINT = "/Usage/GetUsageHistoryDetail";
export const BILL_HISTORY_ENDPOINT = "/bill/billHistory";
export const USAGE_DATA_ENDPOINT = "/Usage/UsageData";
export const GET_BP_NUMBER_ENDPOINT = "/FromDb/GetBpNumber";
export const GET_BUSINESS_MASTER_ENDPOINT = "/BusinessMaster/GetBusinessMaster";

export const METERS_ENDPOINT = "/Meters/Meter/accountNumber";

export const ELECTRIC_USAGE_ENDPOINT = "/Electric";
export const GENERATION_ENDPOINT = "/Generation";

export const BILL_CURRENT_ENDPOINT = "/bill/current";
export const BILL_HISTORY_BILLING_ENDPOINT = "/bill/history";

export const GIGYA_API_KEY = "4_6zEg-HY_0eqpgdSONYkJkQ";
export const GIGYA_AUTH_URL = "https://auth.dominionenergy.com";
export const GIGYA_LOGIN_ENDPOINT = "/accounts.login";
export const GIGYA_GET_ACCOUNT_INFO_ENDPOINT = "/accounts.getAccountInfo";
export const GIGYA_TFA_GET_PROVIDERS_ENDPOINT = "/accounts.tfa.getProviders";
export const GIGYA_TFA_INIT_ENDPOINT = "/accounts.tfa.initTFA";
export const GIGYA_TFA_PHONE_GET_NUMBERS_ENDPOINT = "/accounts.tfa.phone.getRegisteredPhoneNumbers";
export const GIGYA_TFA_PHONE_SEND_CODE_ENDPOINT = "/accounts.tfa.phone.sendVerificationCode";
export const GIGYA_TFA_PHONE_COMPLETE_ENDPOINT = "/accounts.tfa.phone.completeVerification";
export const GIGYA_TFA_FINALIZE_ENDPOINT = "/accounts.tfa.finalizeTFA";
export const GIGYA_FINALIZE_REGISTRATION_ENDPOINT = "/accounts.finalizeRegistration";

export const GIGYA_ERROR_TFA_REQUIRED = 403101;

export const SUBMIT_LOGIN_URL = "https://login.dominionenergy.com/SubmitLogin";

export const ACTION_CODE = "4";
export const DEFAULT_HEADERS = {
  uid: "1",
  pt: "1",
  channel: "WEB",
  Origin: "https://myaccount.dominionenergy.com",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const;

export const GIGYA_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/x-www-form-urlencoded",
  Origin: "https://login.dominionenergy.com",
  Referer: "https://login.dominionenergy.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
} as const;

export const SCAN_INTERVAL_SECONDS = 43200;

export const SENSOR_GRID_CONSUMPTION = "grid_consumption";
export const SENSOR_GRID_RETURN = "grid_return";
export const SENSOR_CURRENT_BILL = "current_bill";
export const SENSOR_BILLING_PERIOD_START = "billing_period_start";
export const SENSOR_BILLING_PERIOD_END = "billing_period_end";
export const SENSOR_CURRENT_RATE = "current_rate";
export const SENSOR_DAILY_COST = "daily_cost";
export const SENSOR_MONTHLY_USAGE = "monthly_usage";
export const SENSOR_SOLAR_GENERATION = "solar_generation";
export const SENSOR_BILL_DUE_DATE = "bill_due_date";
export const SENSOR_PREVIOUS_BALANCE = "previous_balance";
export const SENSOR_PAYMENT_RECEIVED = "payment_received";
export const SENSOR_REMAINING_BALANCE = "remaining_balance";
export const SENSOR_RATE_CATEGORY = "rate_category";
export const SENSOR_TODAY_CONSUMPTION = "today_consumption";
export const SENSOR_TODAY_GENERATION = "today_generation";
export const SENSOR_TODAY_NET_USAGE = "today_net_usage";
export const SENSOR_TOTAL_AMOUNT_DUE = "total_amount_due";
export const SENSOR_LAST_BILL_AMOUNT = "last_bill_amount";
export const SENSOR_LAST_BILL_USAGE = "last_bill_usage";
export const SENSOR_LAST_YEAR_BILL_AMOUNT = "last_year_bill_amount";
export const SENSOR_LAST_YEAR_USAGE = "last_year_usage";
export const SENSOR_LAST_PAYMENT_DATE = "last_payment_date";
export const SENSOR_LAST_PAYMENT_AMOUNT = "last_payment_amount";
export const SENSOR_NEXT_METER_READ_DATE = "next_meter_read_date";
export const SENSOR_AUTO_PAY_ENABLED = "auto_pay_enabled";
export const SENSOR_IS_NET_METERING = "is_net_metering";
export const SENSOR_IS_AMI_METER = "is_ami_meter";
export const SENSOR_DAILY_HIGH_TEMP = "daily_high_temp";
export const SENSOR_DAILY_LOW_TEMP = "daily_low_temp";
export const SENSOR_HEATING_DEGREE_DAYS = "heating_degree_days";
export const SENSOR_COOLING_DEGREE_DAYS = "cooling_degree_days";
export const SENSOR_MONTHLY_AVG_TEMP = "monthly_avg_temp";
export const SENSOR_METER_NUMBER = "meter_number";
export const SENSOR_METER_ID = "meter_id";
export const SENSOR_METER_TYPE = "meter_type";
export const SENSOR_ACCOUNT_NUMBER = "account_number_sensor";

export const ALL_SENSOR_KEYS = [
  SENSOR_GRID_CONSUMPTION,
  SENSOR_GRID_RETURN,
  SENSOR_CURRENT_BILL,
  SENSOR_BILLING_PERIOD_START,
  SENSOR_BILLING_PERIOD_END,
  SENSOR_CURRENT_RATE,
  SENSOR_DAILY_COST,
  SENSOR_MONTHLY_USAGE,
  SENSOR_SOLAR_GENERATION,
  SENSOR_BILL_DUE_DATE,
  SENSOR_PREVIOUS_BALANCE,
  SENSOR_PAYMENT_RECEIVED,
  SENSOR_REMAINING_BALANCE,
  SENSOR_RATE_CATEGORY,
  SENSOR_TODAY_CONSUMPTION,
  SENSOR_TODAY_GENERATION,
  SENSOR_TODAY_NET_USAGE,
  SENSOR_TOTAL_AMOUNT_DUE,
  SENSOR_LAST_BILL_AMOUNT,
  SENSOR_LAST_BILL_USAGE,
  SENSOR_LAST_YEAR_BILL_AMOUNT,
  SENSOR_LAST_YEAR_USAGE,
  SENSOR_LAST_PAYMENT_DATE,
  SENSOR_LAST_PAYMENT_AMOUNT,
  SENSOR_NEXT_METER_READ_DATE,
  SENSOR_AUTO_PAY_ENABLED,
  SENSOR_IS_NET_METERING,
  SENSOR_IS_AMI_METER,
  SENSOR_DAILY_HIGH_TEMP,
  SENSOR_DAILY_LOW_TEMP,
  SENSOR_HEATING_DEGREE_DAYS,
  SENSOR_COOLING_DEGREE_DAYS,
  SENSOR_MONTHLY_AVG_TEMP,
  SENSOR_METER_NUMBER,
  SENSOR_METER_ID,
  SENSOR_METER_TYPE,
  SENSOR_ACCOUNT_NUMBER,
] as const;

export type SensorKey = (typeof ALL_SENSOR_KEYS)[number];

export const ATTRIBUTION = "Data provided by Dominion Energy";
