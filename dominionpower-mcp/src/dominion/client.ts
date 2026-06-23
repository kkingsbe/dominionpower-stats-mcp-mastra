import type { SessionStore } from './session.js';
import { emptyDominionEnergyData, type DominionEnergyData } from './types.js';
import { isAuthenticated, refreshAccessTokenIfNeeded, FullAuthRequiredError } from './auth.js';
import { parseBillForecast, parseCurrentBill, parseBillHistory } from './parsers/bill.js';
import { parseElectricUsage, parseGenerationData, parseDailyUsage } from './parsers/usage.js';
import { parseMeterInfo } from './parsers/account.js';
import { parseWeatherData } from './parsers/weather.js';
import {
  API_BASE_URL, USAGE_API_BASE_URL, BILLING_API_BASE_URL, ACCOUNT_MGMT_API_BASE_URL,
} from './const.js';

export class DominionEnergyApi {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly store: SessionStore,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async getAllData(): Promise<DominionEnergyData> {
    if (!isAuthenticated(this.store)) {
      throw new FullAuthRequiredError('No valid session');
    }

    await refreshAccessTokenIfNeeded(this.fetchFn, this.store, this.log);

    const data = emptyDominionEnergyData();
    const errors: Error[] = [];

    try {
      const res = await this.apiRequest(`${API_BASE_URL}/bill/billForecast`);
      Object.assign(data, parseBillForecast(res as Record<string, unknown>));
    } catch (e) { this.log(`billForecast failed: ${(e as Error).message}`); errors.push(e as Error); }

    try {
      const res = await this.accountMgmtRequest(
        `/Meters/Meter/accountNumber/${this.store.customer_number ?? ''}`,
      );
      Object.assign(data, parseMeterInfo(res as Record<string, unknown>));
    } catch (e) { this.log(`meterInfo failed: ${(e as Error).message}`); errors.push(e as Error); }

    const today = new Date();
    const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const threeYearsAgo = new Date(today); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
    const fmtDateMMDD = (d: Date) => `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;

    const meterNum = data.meter_number?.padStart(18, '0') ?? '';

    try {
      const res = await this.usageRequest(
        `/Electric?AccountNumber=${this.store.customer_number ?? ''}&MeterNumber=${meterNum}` +
        `&From=${fmtDate(thirtyDaysAgo)}&To=${fmtDate(today)}&Uom=kWh&Periodicity=MO`,
      );
      Object.assign(data, parseElectricUsage(res as Record<string, unknown>));
    } catch (e) { this.log(`electricUsage failed: ${(e as Error).message}`); errors.push(e as Error); }

    try {
      const res = await this.usageRequest(
        `/Generation?AccountNumber=${this.store.customer_number ?? ''}&MeterNumber=${meterNum}` +
        `&From=${fmtDate(thirtyDaysAgo)}&To=${fmtDate(today)}&Uom=ALT&Periodicity=MO`,
      );
      Object.assign(data, parseGenerationData(res as Record<string, unknown>));
    } catch { /* non-solar accounts */ }

    try {
      const res = await this.apiRequest(
        `${API_BASE_URL}/Usage/UsageData?accountNumber=${this.store.customer_number ?? ''}&ActionCode=3` +
        `&StartDate=${fmtDate(thirtyDaysAgo)}&EndDate=${fmtDate(today)}`,
      );
      Object.assign(data, parseDailyUsage(res as Record<string, unknown>));
    } catch (e) { this.log(`dailyUsage failed: ${(e as Error).message}`); errors.push(e as Error); }

    try {
      const res = await this.billingPostRequest('/bill/current', {
        accountNumbers: [this.store.customer_number ?? ''],
        extension: {},
      });
      Object.assign(data, parseCurrentBill(res));
    } catch (e) { this.log(`currentBill failed: ${(e as Error).message}`); errors.push(e as Error); }

    try {
      const res = await this.billingPostRequest('/bill/history', {
        accountNumbers: [this.store.customer_number ?? ''],
        startDate: fmtDate(threeYearsAgo),
        endDate: fmtDate(today),
        extension: {},
      });
      Object.assign(data, parseBillHistory(res));
    } catch (e) { this.log(`billHistory failed: ${(e as Error).message}`); errors.push(e as Error); }

    try {
      const res = await this.apiRequest(
        `${API_BASE_URL}/Usage/GetUsageHistoryDetail?AccountNumber=${this.store.customer_number ?? ''}` +
        `&StartDate=${fmtDateMMDD(thirtyDaysAgo)}&EndDate=${fmtDateMMDD(today)}&ActionCode=3&Contract=`,
      );
      Object.assign(data, parseWeatherData(res as Record<string, unknown>));
    } catch (e) { this.log(`weatherData failed: ${(e as Error).message}`); errors.push(e as Error); }

    this.log(`getAllData complete: ${errors.length} errors`);
    return data;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      uid: '1', pt: '1', channel: 'WEB',
      Origin: 'https://myaccount.dominionenergy.com',
      Referer: 'https://myaccount.dominionenergy.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    if (this.store.token) {
      headers.Authorization = `Bearer ${this.store.token}`;
    }
    if (this.store.customer_number) {
      headers.accountnumber = `*****${this.store.customer_number.slice(-7)}`;
      headers.customernumber = `*****${this.store.customer_number.slice(-5)}`;
    }
    const cookieEntries = Object.entries(this.store.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieEntries) {
      headers.Cookie = cookieEntries;
    }
    return headers;
  }

  private unwrapResponse(raw: unknown): unknown {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.Result && typeof obj.Result === 'object') {
        return obj.Result;
      }
      if (obj.data && typeof obj.data === 'object') {
        return obj.data;
      }
      if (obj.data && Array.isArray(obj.data)) {
        return obj.data;
      }
    }
    if (Array.isArray(raw)) {
      return raw;
    }
    return raw;
  }

  private async apiRequest(urlStr: string): Promise<unknown> {
    const url = new URL(urlStr);
    if (this.store.customer_number && !url.searchParams.has('accountNumber') && !url.searchParams.has('AccountNumber')) {
      url.searchParams.set('accountNumber', this.store.customer_number);
    }
    const headers = { ...this.buildHeaders(), Accept: 'application/json' };
    const res = await this.fetchFn(url.toString(), { headers, redirect: 'follow' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API request to ${url.toString()} failed: ${res.status} ${body.slice(0, 500)}`);
    }
    const raw = await res.json();
    return this.unwrapResponse(raw);
  }

  private async accountMgmtRequest(path: string): Promise<unknown> {
    const url = `${ACCOUNT_MGMT_API_BASE_URL}${path}`;
    const res = await this.fetchFn(url, { headers: this.buildHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AccountMgmt request failed: ${res.status} ${body.slice(0, 500)}`);
    }
    return this.unwrapResponse(await res.json());
  }

  private async usageRequest(path: string): Promise<unknown> {
    const parsed = new URL(`${USAGE_API_BASE_URL}${path}`);
    if (this.store.customer_number && !parsed.searchParams.has('AccountNumber') && !parsed.searchParams.has('accountNumber')) {
      parsed.searchParams.set('AccountNumber', this.store.customer_number);
    }
    const url = parsed.toString();
    const res = await this.fetchFn(url, { headers: this.buildHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Usage request failed: ${res.status} ${body.slice(0, 500)}`);
    }
    return this.unwrapResponse(await res.json());
  }

  private async billingPostRequest(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${BILLING_API_BASE_URL}${path}`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { ...this.buildHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Billing request failed: ${res.status} ${body.slice(0, 500)}`);
    }
    return this.unwrapResponse(await res.json());
  }
}
