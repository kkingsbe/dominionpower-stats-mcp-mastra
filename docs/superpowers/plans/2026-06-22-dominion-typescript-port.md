# Dominion Energy TypeScript Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Python Home Assistant integration at `../homeassistant-dominionpower-integration` to a standalone TypeScript service that runs in Docker, exposes a local HTTP/JSON API, and uses Playwright for on-demand TFA authentication.

**Architecture:** Two-tier TypeScript project — a pure API client library (`src/dominion/`) that mirrors the Python `api.py`, plus a service tier (`src/server/` + `src/auth-browser/` + `src/index.ts`) that wires it to Fastify (HTTP) and Playwright (TFA).

**Tech Stack:** Node 20 LTS, TypeScript 5 strict, Fastify 4, native `fetch`, Playwright (`playwright-chromium`), Zod, pino, Vitest. Container base: `mcr.microsoft.com/playwright:v1.49.x-jammy`.

**Spec:** `docs/superpowers/specs/2026-06-22-dominion-typescript-port-design.md`

**Reference (Python source to port):** `../homeassistant-dominionpower-integration/custom_components/dominion_energy/`

---

## File Structure

Files created by this plan. Each file has one clear responsibility; files that change together live together.

```
package.json, tsconfig.json, .eslintrc.cjs, .prettierrc, vitest.config.ts
.gitignore, .dockerignore

src/
├── config.ts                              # Env var parsing (Zod)
├── index.ts                               # Entrypoint
│
├── dominion/                              # Pure API client library — no browser, no server
│   ├── const.ts                           # URLs, headers, sensor keys (verbatim from Python const.py)
│   ├── types.ts                           # DominionEnergyData interface, error classes
│   ├── session.ts                         # Load/save session JSON
│   ├── auth.ts                            # Refresh-token logic
│   ├── client.ts                          # DominionEnergyApi class — orchestrates endpoints + parsers
│   ├── endpoints/
│   │   ├── gigya.ts                       # Token refresh + finalize (User Management API)
│   │   ├── service.ts                     # Bill forecast, usage history, weather (Service API)
│   │   ├── usage.ts                       # Monthly electric + generation (Usage API)
│   │   ├── billing.ts                     # Current bill + history (Billing API)
│   │   └── account.ts                     # Meter info, bp number, business master
│   └── parsers/
│       ├── bill.ts                        # Current bill, bill history, bill forecast
│       ├── usage.ts                       # Daily/monthly usage + generation
│       ├── account.ts                     # Meter + customer flags
│       └── weather.ts                     # Weather data (temps + degree days)
│
├── server/                                # HTTP API + caching + lifecycle
│   ├── cache.ts                           # In-memory snapshot store
│   ├── poller.ts                          # 12h background poll loop
│   ├── routes.ts                          # Fastify routes
│   └── reauth.ts                          # Auth-failure handler → launches auth-browser
│
└── auth-browser/                          # Playwright-based login + TFA
    ├── login.ts                           # Headless Chrome login flow
    ├── tfa.ts                             # TFA flow via Gigya API
    └── ui/
        ├── login.html                     # Login form (username/password/account)
        └── tfa.html                       # 6-digit TFA code form

test/
├── dominion/
│   ├── parsers/{bill,usage,account,weather}.test.ts
│   ├── endpoints/{gigya,service,usage,billing,account}.test.ts
│   ├── session.test.ts
│   └── client.test.ts
├── server/{cache,poller,routes,reauth}.test.ts

Dockerfile, docker-compose.yml.example, README.md
```

---

## Phase 0 — Scaffolding

### Task 1: Initialize npm project, TypeScript, ESLint, Prettier, Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

Run: `npm init -y`
Then overwrite `package.json` with:

```json
{
  "name": "dominionpower-integration",
  "version": "0.1.0",
  "description": "Standalone TypeScript service for Dominion Energy data",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "pino": "^9.4.0",
    "playwright-chromium": "^1.49.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser": "^8.8.0",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "msw": "^2.4.0",
    "prettier": "^3.3.3",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: dependencies installed, no errors.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "test/**/*"]
}
```

- [ ] **Step 5: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/', '*.cjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

- [ ] **Step 6: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.local
data/
*.log
coverage/
.session_cache.json
```

- [ ] **Step 8: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
    coverage: { provider: 'v8' },
  },
});
```

- [ ] **Step 9: Verify TypeScript compiles an empty file**

Create `src/.gitkeep` (empty file). Then:
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript project (deps, tsconfig, lint, test)"
```

---

### Task 2: Create directory structure + placeholder entrypoint

**Files:**
- Create: `src/index.ts`, `src/config.ts`, empty `src/dominion/`, `src/server/`, `src/auth-browser/`, `test/` directories with `.gitkeep`

- [ ] **Step 1: Create directories**

Run: `mkdir -p src/dominion/endpoints src/dominion/parsers src/server src/auth-browser/ui test/dominion/parsers test/dominion/endpoints test/server`

- [ ] **Step 2: Create `src/index.ts` placeholder**

```ts
console.log('dominionpower-integration starting...');
```

- [ ] **Step 3: Verify dev runner works**

Run: `npm run dev`
Expected: prints "dominionpower-integration starting..." then keeps watching. Press Ctrl+C to stop.

- [ ] **Step 4: Add `.gitkeep` files to empty directories**

Run: `touch src/dominion/.gitkeep src/dominion/endpoints/.gitkeep src/dominion/parsers/.gitkeep src/server/.gitkeep src/auth-browser/.gitkeep src/auth-browser/ui/.gitkeep test/.gitkeep test/dominion/.gitkeep test/dominion/parsers/.gitkeep test/dominion/endpoints/.gitkeep test/server/.gitkeep`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: create source directory structure"
```

---

### Task 3: Create `.dockerignore` and placeholder `Dockerfile`

**Files:**
- Create: `.dockerignore`, `Dockerfile`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
.git
.github
test
coverage
.vscode
.idea
*.log
.env
.env.local
data
README.md
docs
```

- [ ] **Step 2: Create placeholder `Dockerfile`** (will be expanded in Phase 6)

```dockerfile
# Placeholder — full build in Phase 6, Task 18
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Commit**

```bash
git add .dockerignore Dockerfile
git commit -m "chore: add .dockerignore and placeholder Dockerfile"
```

---

## Phase 1 — `dominion/` Foundation (const, types, session)

These three modules are the foundation of the API client library. They have no dependencies on each other's domain logic and can be implemented in any order, but they're grouped here because they're small and unrelated to the network layer.

### Task 4: `src/dominion/const.ts` — URLs, headers, sensor keys

This file is a verbatim port of Python `const.py`. The sensor keys MUST match exactly — consumers depend on the string names.

**Files:**
- Create: `src/dominion/const.ts`
- Test: `test/dominion/const.test.ts`

- [ ] **Step 1: Write failing test for SENSOR_* key list**

Create `test/dominion/const.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
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
  ATTRIBUTION,
  SCAN_INTERVAL_SECONDS,
  ALL_SENSOR_KEYS,
} from '../../src/dominion/const.js';

describe('SENSOR_* constants', () => {
  it('all 36 sensor keys are unique strings', () => {
    expect(ALL_SENSOR_KEYS.length).toBe(36);
    expect(new Set(ALL_SENSOR_KEYS).size).toBe(36);
    for (const key of ALL_SENSOR_KEYS) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('each SENSOR_* export appears in ALL_SENSOR_KEYS', () => {
    const keys = [
      SENSOR_GRID_CONSUMPTION, SENSOR_GRID_RETURN, SENSOR_CURRENT_BILL,
      SENSOR_BILLING_PERIOD_START, SENSOR_BILLING_PERIOD_END, SENSOR_CURRENT_RATE,
      SENSOR_DAILY_COST, SENSOR_MONTHLY_USAGE, SENSOR_SOLAR_GENERATION,
      SENSOR_BILL_DUE_DATE, SENSOR_PREVIOUS_BALANCE, SENSOR_PAYMENT_RECEIVED,
      SENSOR_REMAINING_BALANCE, SENSOR_RATE_CATEGORY, SENSOR_TODAY_CONSUMPTION,
      SENSOR_TODAY_GENERATION, SENSOR_TODAY_NET_USAGE, SENSOR_TOTAL_AMOUNT_DUE,
      SENSOR_LAST_BILL_AMOUNT, SENSOR_LAST_BILL_USAGE, SENSOR_LAST_YEAR_BILL_AMOUNT,
      SENSOR_LAST_YEAR_USAGE, SENSOR_LAST_PAYMENT_DATE, SENSOR_LAST_PAYMENT_AMOUNT,
      SENSOR_NEXT_METER_READ_DATE, SENSOR_AUTO_PAY_ENABLED, SENSOR_IS_NET_METERING,
      SENSOR_IS_AMI_METER, SENSOR_DAILY_HIGH_TEMP, SENSOR_DAILY_LOW_TEMP,
      SENSOR_HEATING_DEGREE_DAYS, SENSOR_COOLING_DEGREE_DAYS, SENSOR_MONTHLY_AVG_TEMP,
      SENSOR_METER_NUMBER, SENSOR_METER_ID, SENSOR_METER_TYPE, SENSOR_ACCOUNT_NUMBER,
    ];
    for (const k of keys) {
      expect(ALL_SENSOR_KEYS).toContain(k);
    }
  });

  it('matches Python snake_case naming verbatim', () => {
    expect(SENSOR_GRID_CONSUMPTION).toBe('grid_consumption');
    expect(SENSOR_BILL_DUE_DATE).toBe('bill_due_date');
    expect(SENSOR_AUTO_PAY_ENABLED).toBe('auto_pay_enabled');
  });

  it('SCAN_INTERVAL_SECONDS is 12 hours', () => {
    expect(SCAN_INTERVAL_SECONDS).toBe(43200);
  });

  it('attribution string is present', () => {
    expect(ATTRIBUTION).toBe('Data provided by Dominion Energy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- const.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/dominion/const.ts`**

```ts
/**
 * Constants for the Dominion Energy integration.
 *
 * This file is a verbatim port of Python const.py. Sensor key strings MUST
 * stay identical to the Python values — consumers depend on these names.
 */

export const DOMAIN = 'dominion_energy';

// Configuration keys
export const CONF_ACCOUNT_NUMBER = 'account_number';

// API base URLs
export const LOGIN_URL = 'https://login.dominionenergy.com/CommonLogin';
export const API_BASE_URL = 'https://prodsvc-dominioncip.smartcmobile.com/Service/api/1';
export const ACCOUNT_MGMT_API_BASE_URL =
  'https://prodsvc-dominioncip.smartcmobile.com/AccountManagementapi/api/1';
export const USAGE_API_BASE_URL = 'https://prodsvc-dominioncip.smartcmobile.com/Usageapi/api/V1';
export const BILLING_API_BASE_URL =
  'https://prodsvc-dominioncip.smartcmobile.com/BillingAPI/api/1';

// Service API endpoints
export const BILL_FORECAST_ENDPOINT = '/bill/billForecast';
export const USAGE_HISTORY_ENDPOINT = '/usage/usageHistory';
export const USAGE_HISTORY_DETAIL_ENDPOINT = '/Usage/GetUsageHistoryDetail';
export const BILL_HISTORY_ENDPOINT = '/bill/billHistory';
export const USAGE_DATA_ENDPOINT = '/Usage/UsageData';
export const GET_BP_NUMBER_ENDPOINT = '/FromDb/GetBpNumber';
export const GET_BUSINESS_MASTER_ENDPOINT = '/BusinessMaster/GetBusinessMaster';

// Account Management API
export const METERS_ENDPOINT = '/Meters/Meter/accountNumber';

// Usage API
export const ELECTRIC_USAGE_ENDPOINT = '/Electric';
export const GENERATION_ENDPOINT = '/Generation';

// Billing API
export const BILL_CURRENT_ENDPOINT = '/bill/current';
export const BILL_HISTORY_BILLING_ENDPOINT = '/bill/history';

// Gigya auth
export const GIGYA_API_KEY = '4_6zEg-HY_0eqpgdSONYkJkQ';
export const GIGYA_AUTH_URL = 'https://auth.dominionenergy.com';
export const GIGYA_LOGIN_ENDPOINT = '/accounts.login';
export const GIGYA_GET_ACCOUNT_INFO_ENDPOINT = '/accounts.getAccountInfo';
export const GIGYA_TFA_GET_PROVIDERS_ENDPOINT = '/accounts.tfa.getProviders';
export const GIGYA_TFA_INIT_ENDPOINT = '/accounts.tfa.initTFA';
export const GIGYA_TFA_PHONE_GET_NUMBERS_ENDPOINT = '/accounts.tfa.phone.getRegisteredPhoneNumbers';
export const GIGYA_TFA_PHONE_SEND_CODE_ENDPOINT = '/accounts.tfa.phone.sendVerificationCode';
export const GIGYA_TFA_PHONE_COMPLETE_ENDPOINT = '/accounts.tfa.phone.completeVerification';
export const GIGYA_TFA_FINALIZE_ENDPOINT = '/accounts.tfa.finalizeTFA';
export const GIGYA_FINALIZE_REGISTRATION_ENDPOINT = '/accounts.finalizeRegistration';

export const GIGYA_ERROR_TFA_REQUIRED = 403101;

export const SUBMIT_LOGIN_URL = 'https://login.dominionenergy.com/SubmitLogin';

// Common headers for the Dominion API
export const ACTION_CODE = '4';
export const DEFAULT_HEADERS: Record<string, string> = {
  uid: '1',
  pt: '1',
  channel: 'WEB',
  Origin: 'https://myaccount.dominionenergy.com',
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export const GIGYA_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: 'https://login.dominionenergy.com',
  Referer: 'https://login.dominionenergy.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};

// Polling interval (seconds). Dominion updates data once daily.
export const SCAN_INTERVAL_SECONDS = 43200;

// Sensor keys (MUST match Python const.py verbatim)
export const SENSOR_GRID_CONSUMPTION = 'grid_consumption';
export const SENSOR_GRID_RETURN = 'grid_return';
export const SENSOR_CURRENT_BILL = 'current_bill';
export const SENSOR_BILLING_PERIOD_START = 'billing_period_start';
export const SENSOR_BILLING_PERIOD_END = 'billing_period_end';
export const SENSOR_CURRENT_RATE = 'current_rate';
export const SENSOR_DAILY_COST = 'daily_cost';
export const SENSOR_MONTHLY_USAGE = 'monthly_usage';

export const SENSOR_SOLAR_GENERATION = 'solar_generation';
export const SENSOR_BILL_DUE_DATE = 'bill_due_date';
export const SENSOR_PREVIOUS_BALANCE = 'previous_balance';
export const SENSOR_PAYMENT_RECEIVED = 'payment_received';
export const SENSOR_REMAINING_BALANCE = 'remaining_balance';
export const SENSOR_RATE_CATEGORY = 'rate_category';

export const SENSOR_TODAY_CONSUMPTION = 'today_consumption';
export const SENSOR_TODAY_GENERATION = 'today_generation';
export const SENSOR_TODAY_NET_USAGE = 'today_net_usage';

export const SENSOR_TOTAL_AMOUNT_DUE = 'total_amount_due';
export const SENSOR_LAST_BILL_AMOUNT = 'last_bill_amount';
export const SENSOR_LAST_BILL_USAGE = 'last_bill_usage';
export const SENSOR_LAST_YEAR_BILL_AMOUNT = 'last_year_bill_amount';
export const SENSOR_LAST_YEAR_USAGE = 'last_year_usage';

export const SENSOR_LAST_PAYMENT_DATE = 'last_payment_date';
export const SENSOR_LAST_PAYMENT_AMOUNT = 'last_payment_amount';

export const SENSOR_NEXT_METER_READ_DATE = 'next_meter_read_date';
export const SENSOR_AUTO_PAY_ENABLED = 'auto_pay_enabled';
export const SENSOR_IS_NET_METERING = 'is_net_metering';
export const SENSOR_IS_AMI_METER = 'is_ami_meter';

export const SENSOR_DAILY_HIGH_TEMP = 'daily_high_temp';
export const SENSOR_DAILY_LOW_TEMP = 'daily_low_temp';
export const SENSOR_HEATING_DEGREE_DAYS = 'heating_degree_days';
export const SENSOR_COOLING_DEGREE_DAYS = 'cooling_degree_days';
export const SENSOR_MONTHLY_AVG_TEMP = 'monthly_avg_temp';

export const SENSOR_METER_NUMBER = 'meter_number';
export const SENSOR_METER_ID = 'meter_id';
export const SENSOR_METER_TYPE = 'meter_type';
export const SENSOR_ACCOUNT_NUMBER = 'account_number_sensor';

export const ALL_SENSOR_KEYS = [
  SENSOR_GRID_CONSUMPTION, SENSOR_GRID_RETURN, SENSOR_CURRENT_BILL,
  SENSOR_BILLING_PERIOD_START, SENSOR_BILLING_PERIOD_END, SENSOR_CURRENT_RATE,
  SENSOR_DAILY_COST, SENSOR_MONTHLY_USAGE, SENSOR_SOLAR_GENERATION,
  SENSOR_BILL_DUE_DATE, SENSOR_PREVIOUS_BALANCE, SENSOR_PAYMENT_RECEIVED,
  SENSOR_REMAINING_BALANCE, SENSOR_RATE_CATEGORY, SENSOR_TODAY_CONSUMPTION,
  SENSOR_TODAY_GENERATION, SENSOR_TODAY_NET_USAGE, SENSOR_TOTAL_AMOUNT_DUE,
  SENSOR_LAST_BILL_AMOUNT, SENSOR_LAST_BILL_USAGE, SENSOR_LAST_YEAR_BILL_AMOUNT,
  SENSOR_LAST_YEAR_USAGE, SENSOR_LAST_PAYMENT_DATE, SENSOR_LAST_PAYMENT_AMOUNT,
  SENSOR_NEXT_METER_READ_DATE, SENSOR_AUTO_PAY_ENABLED, SENSOR_IS_NET_METERING,
  SENSOR_IS_AMI_METER, SENSOR_DAILY_HIGH_TEMP, SENSOR_DAILY_LOW_TEMP,
  SENSOR_HEATING_DEGREE_DAYS, SENSOR_COOLING_DEGREE_DAYS, SENSOR_MONTHLY_AVG_TEMP,
  SENSOR_METER_NUMBER, SENSOR_METER_ID, SENSOR_METER_TYPE, SENSOR_ACCOUNT_NUMBER,
] as const;

export type SensorKey = (typeof ALL_SENSOR_KEYS)[number];

export const ATTRIBUTION = 'Data provided by Dominion Energy';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- const.test`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/dominion/const.ts test/dominion/const.test.ts
git commit -m "feat(dominion): add const.ts (URLs, headers, sensor keys)"
```

---

### Task 5: `src/dominion/types.ts` — DominionEnergyData + error classes

Port of Python `DominionEnergyData` dataclass (api.py:73-153) and the two exception classes (api.py:156-161).

**Files:**
- Create: `src/dominion/types.ts`
- Test: `test/dominion/types.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/dominion/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DominionEnergyApiError,
  DominionEnergyAuthError,
  emptyDominionEnergyData,
  type DominionEnergyData,
} from '../../src/dominion/types.js';

describe('emptyDominionEnergyData', () => {
  it('returns an object with all fields null', () => {
    const data = emptyDominionEnergyData();
    const keys: (keyof DominionEnergyData)[] = [
      'grid_consumption', 'grid_return', 'monthly_usage', 'solar_generation',
      'monthly_generation', 'daily_consumption', 'daily_generation',
      'today_consumption', 'today_generation', 'today_net_usage',
      'yesterday_consumption', 'yesterday_generation', 'yesterday_net_usage',
      'hourly_consumption', 'hourly_generation',
      'current_bill', 'billing_period_start', 'billing_period_end',
      'bill_due_date', 'previous_balance', 'payment_received',
      'remaining_balance', 'total_amount_due', 'last_bill_amount',
      'last_bill_usage', 'last_year_bill_amount', 'last_year_usage',
      'last_payment_date', 'last_payment_amount', 'current_rate',
      'daily_cost', 'rate_category', 'daily_usage', 'daily_return',
      'bill_history', 'next_meter_read_date', 'auto_pay_enabled',
      'is_net_metering', 'is_ami_meter', 'daily_high_temp',
      'daily_low_temp', 'heating_degree_days', 'cooling_degree_days',
      'monthly_avg_temp', 'meter_number', 'meter_id', 'meter_type',
      'account_number',
    ];
    for (const k of keys) {
      expect(data[k]).toBeNull();
    }
  });

  it('returns a fresh object each call', () => {
    const a = emptyDominionEnergyData();
    const b = emptyDominionEnergyData();
    expect(a).not.toBe(b);
    expect(a.daily_usage).not.toBe(b.daily_usage);
  });
});

describe('errors', () => {
  it('DominionEnergyApiError is an Error', () => {
    const e = new DominionEnergyApiError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('boom');
    expect(e.name).toBe('DominionEnergyApiError');
  });

  it('DominionEnergyAuthError extends DominionEnergyApiError', () => {
    const e = new DominionEnergyAuthError('bad creds');
    expect(e).toBeInstanceOf(DominionEnergyApiError);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('bad creds');
    expect(e.name).toBe('DominionEnergyAuthError');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/dominion/types.ts`**

```ts
/**
 * Domain types and error classes.
 *
 * DominionEnergyData mirrors the Python api.py DominionEnergyData dataclass.
 * Use emptyDominionEnergyData() to construct an empty snapshot — all fields
 * default to null. Consumers must handle null values explicitly.
 */

export interface DominionEnergyData {
  // Energy (kWh)
  grid_consumption: number | null;
  grid_return: number | null;
  monthly_usage: number | null;

  // Solar (kWh)
  solar_generation: number | null;
  monthly_generation: Array<Record<string, unknown>> | null;

  // Daily data
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

  // Billing
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

  // Rate
  current_rate: number | null;
  daily_cost: number | null;
  rate_category: string | null;

  // Time-series (for statistics endpoints)
  daily_usage: Array<Record<string, unknown>> | null;
  daily_return: Array<Record<string, unknown>> | null;
  bill_history: Array<Record<string, unknown>> | null;

  // Account flags + dates
  next_meter_read_date: Date | null;
  auto_pay_enabled: boolean | null;
  is_net_metering: boolean | null;
  is_ami_meter: boolean | null;

  // Weather
  daily_high_temp: number | null;
  daily_low_temp: number | null;
  heating_degree_days: number | null;
  cooling_degree_days: number | null;
  monthly_avg_temp: number | null;

  // Meter info
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
  override readonly name = 'DominionEnergyApiError';
}

export class DominionEnergyAuthError extends DominionEnergyApiError {
  override readonly name = 'DominionEnergyAuthError';
}

/** Persisted session shape — matches Python get_session_data() output. */
export interface SessionData {
  token: string | null;
  refresh_token: string | null;
  token_expires: number; // unix seconds
  uuid: string | null;
  cookies: Record<string, string>;
  customer_number: string | null;
  contract: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- types.test`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/dominion/types.ts test/dominion/types.test.ts
git commit -m "feat(dominion): add types.ts (data model + errors + session shape)"
```

---

### Task 6: `src/dominion/session.ts` — Load/save session JSON

Port of Python `DominionEnergyApi.get_session_data()` and `restore_session_data()` (api.py:191-237), plus the disk persistence behavior from `coordinator.py:_save_session()` and `_restore_session()`.

**Files:**
- Create: `src/dominion/session.ts`
- Test: `test/dominion/session.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/dominion/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadSession,
  saveSession,
  type SessionStore,
} from '../../src/dominion/session.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dom-session-'));
  file = join(dir, 'session.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sampleSession = {
  token: 'Bearer abc',
  refresh_token: 'rt-xyz',
  token_expires: 1719000000,
  uuid: 'user-uuid-1',
  cookies: { gmid: 'gmid-1', ucid: 'ucid-1' },
  customer_number: '1234567',
  contract: 'CONTRACT-1',
};

describe('saveSession + loadSession', () => {
  it('round-trips a session through disk', async () => {
    const store: SessionStore = { ...sampleSession };
    await saveSession(file, store);
    expect(existsSync(file)).toBe(true);

    const loaded = await loadSession(file);
    expect(loaded).toEqual(sampleSession);
  });

  it('returns null when file does not exist', async () => {
    const loaded = await loadSession(file);
    expect(loaded).toBeNull();
  });

  it('returns null when file is corrupt JSON', async () => {
    writeFileSync(file, '{not valid json');
    const loaded = await loadSession(file);
    expect(loaded).toBeNull();
  });

  it('saveSession creates parent dir if missing', async () => {
    const nested = join(dir, 'a', 'b', 'session.json');
    await saveSession(nested, { ...sampleSession });
    expect(existsSync(nested)).toBe(true);
  });

  it('saveSession is a no-op when store is unchanged', async () => {
    writeFileSync(file, JSON.stringify(sampleSession));
    const before = readFileSync(file, 'utf8');
    // Re-write same data — file content must match exactly
    await saveSession(file, { ...sampleSession });
    const after = readFileSync(file, 'utf8');
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- session.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/dominion/session.ts`**

```ts
/**
 * Session persistence.
 *
 * Mirrors Python api.py's get_session_data() and restore_session_data(),
 * plus the "only write if changed" pattern from coordinator.py:_save_session().
 *
 * The store is the on-disk shape (SessionData from types.ts). The API client
 * (client.ts) holds a mutable in-memory copy and calls saveSession() after
 * successful getAllData() when the data has changed.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { SessionData } from './types.js';

export type SessionStore = SessionData;

export async function loadSession(filePath: string): Promise<SessionStore | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as SessionStore;
  } catch {
    return null;
  }
}

export async function saveSession(filePath: string, store: SessionStore): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- session.test`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/dominion/session.ts test/dominion/session.test.ts
git commit -m "feat(dominion): add session.ts (load/save JSON persistence)"
```

---

## Phase 2 — Network Layer (endpoints, auth, parsers, client)

These tasks build the HTTP communication layer. Tasks 7–9 can be implemented in any order because they have no mutual dependencies. Task 10 (`client.ts`) depends on all three.

At a high level, the module split mirrors the Python `api.py` structure:
- `endpoints/` — one file per Dominion API domain (Gigya auth, Service, Usage, Billing, AccountMgmt). Each file exports a single **stateless async function** that takes the HTTP helper and path parameters, returns the raw JSON response.
- `auth.ts` — refresh-token + full-auth orchestration (the Playwright-based full auth is deferred to `auth-browser/` — `auth.ts` only implements the refresh path and the redirect to auth-browser).
- `parsers/` — one file per logical domain. Each exports functions that take raw API JSON and return typed data. These are the JSON-to-DominionEnergyData field extractors.
- `client.ts` — `DominionEnergyApi` class that ties endpoints + parsers + auth together, exposes `getAllData()`.

### Task 7: `src/dominion/endpoints/gigya.ts` — Gigya token refresh + finalize

**Reference:** Python `api.py` methods:
- `_refresh_access_token()` (api.py:438) — POST to `/UsermanagementAPI/api/1/login/auth/refresh`
- `_dominion_login_auth()` (api.py:351) — POST to `/UsermanagementAPI/api/1/Login/auth`

**Files:**
- Create: `src/dominion/endpoints/gigya.ts`
- Test: `test/dominion/endpoints/gigya.test.ts` (mocked HTTP)

- [ ] **Step 1: Write failing test**

Create `test/dominion/endpoints/gigya.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  refreshAccessToken,
  dominionLoginAuth,
} from '../../../src/dominion/endpoints/gigya.js';
import type { SessionData } from '../../../src/dominion/types.js';

describe('refreshAccessToken', () => {
  it('returns updated token/expires on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-bearer-token',
          refresh_token: 'new-refresh-token',
          expires_in: 599,
        }),
    });
    const session: SessionData = {
      token: 'old-token',
      refresh_token: 'old-refresh',
      token_expires: 0,
      uuid: 'uuid-1',
      cookies: {},
      customer_number: null,
      contract: null,
    };
    const result = await refreshAccessToken(mockFetch as unknown as typeof fetch, session);
    expect(result.access_token).toBe('new-bearer-token');
    expect(result.refresh_token).toBe('new-refresh-token');
    expect(typeof result.expires_in).toBe('number');
  });

  it('throws DominionEnergyAuthError on 401', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    const session: SessionData = {
      token: 'old', refresh_token: 'old', token_expires: 0,
      uuid: 'uuid-1', cookies: {}, customer_number: null, contract: null,
    };
    await expect(
      refreshAccessToken(mockFetch as unknown as typeof fetch, session),
    ).rejects.toThrow('DominionEnergyAuthError');
  });
});

describe('dominionLoginAuth', () => {
  it('returns session data from id_token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          uuid: 'uuid-from-dominion',
          token: 'dom-token',
          refresh_token: 'dom-refresh',
        }),
    });
    const result = await dominionLoginAuth(
      mockFetch as unknown as typeof fetch,
      'id-token-value',
    );
    expect(result.uuid).toBe('uuid-from-dominion');
    expect(result.token).toBe('dom-token');
    expect(result.refresh_token).toBe('dom-refresh');
  });
});
```

Run: `npm test -- gigya.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/dominion/endpoints/gigya.ts`**

```ts
import type { SessionData } from '../types.js';
import { DominionEnergyAuthError, DominionEnergyApiError } from '../types.js';
import {
  GIGYA_AUTH_URL,
  GIGYA_LOGIN_ENDPOINT,
  GIGYA_HEADERS,
  API_BASE_URL,
} from '../const.js';

export interface TokenRefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * POST /UsermanagementAPI/api/1/login/auth/refresh
 * Uses the refresh_token + uuid to get a new access_token.
 */
export async function refreshAccessToken(
  fetchFn: typeof fetch,
  session: SessionData,
): Promise<TokenRefreshResult> {
  const url = `${API_BASE_URL}/login/auth/refresh`;
  const body = new URLSearchParams({
    refresh_token: session.refresh_token ?? '',
    uuid: session.uuid ?? '',
  });
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new DominionEnergyAuthError('Token refresh rejected (401)');
    }
    throw new DominionEnergyApiError(
      `Token refresh failed: ${res.status} ${res.statusText}`,
    );
  }
  return res.json() as Promise<TokenRefreshResult>;
}

export interface DominionLoginResult {
  uuid: string;
  token: string;
  refresh_token: string;
}

/**
 * POST /UsermanagementAPI/api/1/Login/auth
 * Exchanges a Gigya id_token for Dominion Energy tokens.
 */
export async function dominionLoginAuth(
  fetchFn: typeof fetch,
  idToken: string,
): Promise<DominionLoginResult> {
  const url = `${API_BASE_URL}/Login/auth`;
  const body = new URLSearchParams({
    id_token: idToken,
    hashalgo: 'SHA256',
  });
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://myaccount.dominionenergy.com',
    } as Record<string, string>,
    body: body.toString(),
  });
  if (!res.ok) {
    throw new DominionEnergyAuthError(
      `Dominion login auth failed: ${res.status}`,
    );
  }
  return res.json() as Promise<DominionLoginResult>;
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- gigya.test`
Expected: PASS — 4 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/dominion/endpoints/gigya.ts test/dominion/endpoints/gigya.test.ts
git commit -m "feat(dominion): add endpoints/gigya.ts (refresh + login auth)"
```

---

### Task 8: `src/dominion/auth.ts` — Refresh token + auth-gate

**Reference:** Python `api.py` methods:
- `_ensure_token_valid()` (api.py:493)
- `authenticate()` (api.py:279) — only the refresh path
- `is_authenticated()` (api.py:239)

The full TFA/Playwright auth lives in `auth-browser/` (Phase 4). This module provides:
1. `refreshAccessTokenIfNeeded()` — checks expiry, calls `refreshAccessToken()` if needed
2. `isAuthenticated()` — checks if session has valid tokens
3. A `doFullAuth` placeholder that throws `DominionEnergyAuthError` with a signal to launch the auth browser

**Files:**
- Create: `src/dominion/auth.ts`
- Test: `test/dominion/auth.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/dominion/auth.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  refreshAccessTokenIfNeeded,
  isAuthenticated,
} from '../../src/dominion/auth.js';
import type { SessionStore } from '../../src/dominion/session.js';

function makeStore(overrides?: Partial<SessionStore>): SessionStore {
  return {
    token: 'Bearer valid',
    refresh_token: 'rt-1',
    token_expires: Math.floor(Date.now() / 1000) + 3600,
    uuid: 'uuid-1',
    cookies: {},
    customer_number: null,
    contract: null,
    ...overrides,
  };
}

describe('isAuthenticated', () => {
  it('returns true when token + uuid present', () => {
    expect(isAuthenticated(makeStore())).toBe(true);
  });

  it('returns false when token is null', () => {
    expect(isAuthenticated(makeStore({ token: null }))).toBe(false);
  });

  it('returns false when uuid is null', () => {
    expect(isAuthenticated(makeStore({ uuid: null }))).toBe(false);
  });
});

describe('refreshAccessTokenIfNeeded', () => {
  it('does nothing if token is not expired', async () => {
    const fetchFn = vi.fn();
    const store = makeStore();
    await refreshAccessTokenIfNeeded(fetchFn as unknown as typeof fetch, store);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('calls refresh when token is expired', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-token',
          refresh_token: 'new-rt',
          expires_in: 599,
        }),
    });
    const store = makeStore({ token_expires: Math.floor(Date.now() / 1000) - 60 });
    await refreshAccessTokenIfNeeded(fetchFn as unknown as typeof fetch, store);
    expect(fetchFn).toHaveBeenCalled();
    expect(store.token).toBe('new-token');
    expect(store.refresh_token).toBe('new-rt');
  });

  it('throws DominionEnergyAuthError when refresh fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const store = makeStore({ token_expires: Math.floor(Date.now() / 1000) - 60 });
    await expect(
      refreshAccessTokenIfNeeded(fetchFn as unknown as typeof fetch, store),
    ).rejects.toThrow('DominionEnergyAuthError');
  });
});
```

Run: `npm test -- auth.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/dominion/auth.ts`**

```ts
import type { SessionStore } from './session.js';
import { DominionEnergyAuthError } from './types.js';
import { refreshAccessToken } from './endpoints/gigya.js';

/** True when the session has enough data to attempt API calls. */
export function isAuthenticated(store: SessionStore): boolean {
  return store.token !== null && store.uuid !== null;
}

/**
 * Refresh the access token if it's close to expiry (within 60s).
 * Mutates store in-place on success.
 */
export async function refreshAccessTokenIfNeeded(
  fetchFn: typeof fetch,
  store: SessionStore,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const refreshWindow = 60;
  if (!store.refresh_token || store.token_expires > now + refreshWindow) {
    return;
  }

  const result = await refreshAccessToken(fetchFn, {
    token: store.token,
    refresh_token: store.refresh_token,
    token_expires: store.token_expires,
    uuid: store.uuid,
    cookies: store.cookies,
    customer_number: store.customer_number,
    contract: store.contract,
  });

  store.token = result.access_token;
  store.refresh_token = result.refresh_token;
  store.token_expires = now + result.expires_in;
}

/**
 * Signal that full (browser-based) auth is needed.
 * Called by client.ts when refresh fails and no cached session exists.
 * The caller (server layer) should catch this and launch auth-browser.
 */
export class FullAuthRequiredError extends DominionEnergyAuthError {
  override readonly name = 'FullAuthRequiredError';
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- auth.test`
Expected: PASS — 5 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/dominion/auth.ts test/dominion/auth.test.ts
git commit -m "feat(dominion): add auth.ts (refresh token + auth check)"
```

---

### Task 9: `src/dominion/parsers/` — Response-to-model parsers

**Reference:** Python `api.py:` `get_all_data()` body lines 2136–2573, split by data domain. Each parser file matches a logical section of the monolithic `get_all_data()` method.

Each parser is a pure function — takes raw JSON (`unknown`), returns a partial `DominionEnergyData` update. The client.ts merges these partials into one snapshot.

We show one full parser file (`bill.ts`) here because the structure is identical across all four. The remaining three files (`usage.ts`, `account.ts`, `weather.ts`) follow the same pattern — their test fixtures are derived from the Python `test_api.py` response shapes.

**Reference line ranges (Python api.py):**
- Bill data: api.py:2136–2216 (forecast) + 2384–2472 (current bill) + 2474–2493 (bill history)
- Usage data: api.py:2219–2293 (meter + electric + gen) + 2295–2382 (daily usage)
- Account data: api.py:2219–2260 (meter info, customer flags)
- Weather data: api.py:2495–2573

**Files:**
- Create: `src/dominion/parsers/bill.ts`, `src/dominion/parsers/usage.ts`, `src/dominion/parsers/account.ts`, `src/dominion/parsers/weather.ts`
- Test: `test/dominion/parsers/bill.test.ts`, `test/dominion/parsers/usage.test.ts`, `test/dominion/parsers/account.test.ts`, `test/dominion/parsers/weather.test.ts`

#### Task 9a: `parsers/bill.ts` — Current bill, bill history, bill forecast

- [ ] **Step 1: Write failing test**

Create `test/dominion/parsers/bill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseBillForecast, parseCurrentBill, parseBillHistory } from '../../../src/dominion/parsers/bill.js';

describe('parseBillForecast', () => {
  it('extracts monthly usage and grid consumption from forecast data', () => {
    const forecast = {
      billForecastDetails: [{
        budgetAmount: '150.25',
        budgetStartDate: '/Date(1718600000000)/',
        budgetEndDate: '/Date(1721280000000)/',
        month1Consumption: '1200',
        month1GridConsumption: '800',
        month1GridReturn: '400',
        month2Consumption: null,
        month2GridConsumption: null,
        month2GridReturn: null,
        month3Consumption: null,
        month3GridConsumption: null,
        month3GridReturn: null,
        totalAmount: '150.25',
      }],
      lastBillAmount: '145.00',
      lastBillUsage: '1100',
      lastYearBillAmount: '140.00',
      lastYearUsage: '1050',
    };
    const result = parseBillForecast(forecast);
    expect(result.monthly_usage).toBe(1200);
    expect(result.grid_consumption).toBe(800);
    expect(result.grid_return).toBe(400);
    expect(result.current_bill).toBe(150.25);
    expect(result.last_bill_amount).toBe(145.0);
    expect(result.last_bill_usage).toBe(1100);
    expect(result.last_year_bill_amount).toBe(140.0);
    expect(result.last_year_usage).toBe(1050);
  });

  it('returns nulls for missing data', () => {
    const result = parseBillForecast({});
    expect(result.monthly_usage).toBeNull();
    expect(result.grid_consumption).toBeNull();
    expect(result.current_bill).toBeNull();
  });
});

describe('parseCurrentBill', () => {
  it('extracts amount due, dates, rate info from current bill', () => {
    const bill = {
      accountNumber: '123456789012',
      totalAmountDue: 150.25,
      previousBalance: 0,
      paymentReceived: 0,
      remainingBalance: 150.25,
      dueDate: '/Date(1722500000000)/',
      rateCategory: 'RESIDENTIAL',
      autoPayEnabled: true,
      nextMeterReadDate: '/Date(1723800000000)/',
      lastPaymentDate: '/Date(1719900000000)/',
      lastPaymentAmount: 145.0,
    };
    const result = parseCurrentBill(bill);
    expect(result.total_amount_due).toBe(150.25);
    expect(result.previous_balance).toBe(0);
    expect(result.payment_received).toBe(0);
    expect(result.remaining_balance).toBe(150.25);
    expect(result.bill_due_date).toBeInstanceOf(Date);
    expect(result.rate_category).toBe('RESIDENTIAL');
    expect(result.auto_pay_enabled).toBe(true);
    expect(result.next_meter_read_date).toBeInstanceOf(Date);
    expect(result.last_payment_date).toBeInstanceOf(Date);
    expect(result.last_payment_amount).toBe(145.0);
  });

  it('handles null bill data', () => {
    const result = parseCurrentBill(null);
    expect(result.total_amount_due).toBeNull();
    expect(result.bill_due_date).toBeNull();
  });
});

describe('parseBillHistory', () => {
  it('extracts bill history array', () => {
    const history = {
      billHistoryDetails: [
        { billMonth: '2024-01', totalAmount: 120.0 },
        { billMonth: '2024-02', totalAmount: 130.0 },
      ],
    };
    const result = parseBillHistory(history);
    expect(result.bill_history).toHaveLength(2);
    expect(result.bill_history![0]).toEqual({ billMonth: '2024-01', totalAmount: 120.0 });
  });

  it('returns null bill_history for empty data', () => {
    expect(parseBillHistory({}).bill_history).toBeNull();
    expect(parseBillHistory(null).bill_history).toBeNull();
  });
});
```

Run: `npm test -- parsers/bill.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/dominion/parsers/bill.ts`**

```ts
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

export function parseCurrentBill(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return {
      total_amount_due: null, previous_balance: null, payment_received: null,
      remaining_balance: null, bill_due_date: null, rate_category: null,
      auto_pay_enabled: null, next_meter_read_date: null,
      last_payment_date: null, last_payment_amount: null,
    };
  }

  return {
    total_amount_due: parseNumber((data as any).totalAmountDue),
    previous_balance: parseNumber((data as any).previousBalance),
    payment_received: parseNumber((data as any).paymentReceived),
    remaining_balance: parseNumber((data as any).remainingBalance),
    bill_due_date: parseDate((data as any).dueDate),
    rate_category: (data as any).rateCategory ?? null,
    auto_pay_enabled: (data as any).autoPayEnabled ?? null,
    next_meter_read_date: parseDate((data as any).nextMeterReadDate),
    last_payment_date: parseDate((data as any).lastPaymentDate),
    last_payment_amount: parseNumber((data as any).lastPaymentAmount),
  };
}

export function parseBillHistory(data: Record<string, unknown> | null | undefined): Partial<DominionEnergyData> {
  if (!data) {
    return { bill_history: null };
  }
  const details = (data as any).billHistoryDetails;
  return {
    bill_history: Array.isArray(details) && details.length > 0 ? details : null,
  };
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- parsers/bill.test`
Expected: PASS — 5 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/dominion/parsers/bill.ts test/dominion/parsers/bill.test.ts
git commit -m "feat(dominion): add parsers/bill.ts (forecast + current + history)"
```

#### Task 9b: `parsers/usage.ts` — Daily, hourly, solar, today/yesterday

Same pattern as `parsers/bill.ts`. Reference: Python api.py:2219–2382.

- [ ] **Step 1: Write failing test**

Create `test/dominion/parsers/usage.test.ts` with tests for:
- `parseElectricUsage()` — monthly consumption from `/Electric` response
- `parseGenerationData()` — `solar_generation`, `monthly_generation` from `/Generation` response
- `parseDailyUsage()` — `daily_consumption[]`, `daily_generation[]`, `today_*`, `yesterday_*` from `/Usage/UsageData?ActionCode=3`
- `parseHourlyUsage()` — `hourly_consumption[]`, `hourly_generation[]` from `/Usage/UsageData?ActionCode=4`

Use the test structure from `bill.test.ts` with response shapes from Python `test_api.py`.

Run: `npm test -- parsers/usage.test`
Expected: FAIL.

- [ ] **Step 2: Create `src/dominion/parsers/usage.ts`**

Four exported functions matching the test signatures. Use `parseNumber()` / `parseDate()` helpers (or inline). Key fields:

```ts
export function parseElectricUsage(data: unknown): Partial<DominionEnergyData> { ... }
export function parseGenerationData(data: unknown): Partial<DominionEnergyData> { ... }
export function parseDailyUsage(data: unknown): Partial<DominionEnergyData> { ... }
export function parseHourlyUsage(data: unknown): Partial<DominionEnergyData> { ... }
```

- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit**

```bash
git add src/dominion/parsers/usage.ts test/dominion/parsers/usage.test.ts
git commit -m "feat(dominion): add parsers/usage.ts (daily, hourly, solar, today/yesterday)"
```

#### Task 9c: `parsers/account.ts` — Meter info + customer flags

Reference: Python api.py:2219–2260.

- [ ] **Step 1: Write failing test**

Create `test/dominion/parsers/account.test.ts` with tests for:
- `parseMeterInfo()` — `meter_number`, `meter_id`, `meter_type`, `account_number`, `is_ami_meter`
- `parseBusinessMaster()` — `customer_number`, `contract`

- [ ] **Step 2: Create `src/dominion/parsers/account.ts`**

```ts
export function parseMeterInfo(data: unknown): Partial<DominionEnergyData> { ... }
export function parseBusinessMaster(data: unknown, bpNumber: string): Partial<DominionEnergyData> { ... }
```

- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit**

```bash
git add src/dominion/parsers/account.ts test/dominion/parsers/account.test.ts
git commit -m "feat(dominion): add parsers/account.ts (meter info + customer flags)"
```

#### Task 9d: `parsers/weather.ts` — Temperature + degree days

Reference: Python api.py:2495–2573.

- [ ] **Step 1: Write failing test**

Create `test/dominion/parsers/weather.test.ts` with tests for:
- `parseWeatherData()` — `daily_high_temp`, `daily_low_temp`, `heating_degree_days`, `cooling_degree_days`, `monthly_avg_temp`

- [ ] **Step 2: Create `src/dominion/parsers/weather.ts`**

```ts
export function parseWeatherData(data: unknown): Partial<DominionEnergyData> { ... }
```

- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit**

```bash
git add src/dominion/parsers/weather.ts test/dominion/parsers/weather.test.ts
git commit -m "feat(dominion): add parsers/weather.ts (temps + degree days)"
```

---

### Task 10: `src/dominion/client.ts` — DominionEnergyApi class

**Reference:** Python `DominionEnergyApi.get_all_data()` (api.py:2119) and all its sub-method calls (api.py:1387–2118).

This is the orchestrator. It:
1. Holds mutable `SessionStore` (injected, not owned)
2. Provides `ensureAuthenticated()` → calls `auth.ts:refreshAccessTokenIfNeeded()`, or throws `FullAuthRequiredError`
3. Provides `getAllData()` → calls each endpoint, runs each parser, merges results into one `DominionEnergyData`
4. Accepts `fetchFn` injection so tests can mock HTTP without touching the network

**Files:**
- Create: `src/dominion/client.ts`
- Test: `test/dominion/client.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/dominion/client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DominionEnergyApi } from '../../src/dominion/client.js';
import type { SessionStore } from '../../src/dominion/session.js';
import { emptyDominionEnergyData } from '../../src/dominion/types.js';

function makeStore(): SessionStore {
  return {
    token: 'Bearer valid', refresh_token: 'rt-1',
    token_expires: Math.floor(Date.now() / 1000) + 3600,
    uuid: 'uuid-1', cookies: {}, customer_number: '1234567', contract: 'C-1',
  };
}

describe('DominionEnergyApi', () => {
  it('getAllData returns merged DominionEnergyData', async () => {
    const fetchFn = vi.fn(/* mock each endpoint response */);
    const store = makeStore();
    const api = new DominionEnergyApi(fetchFn as unknown as typeof fetch, store);

    const data = await api.getAllData();
    expect(data).toBeTypeOf('object');
  });

  it('throws FullAuthRequiredError when not authenticated', async () => {
    const store = makeStore({ token: null, uuid: null });
    const api = new DominionEnergyApi(vi.fn() as unknown as typeof fetch, store);
    await expect(api.getAllData()).rejects.toThrow('FullAuthRequiredError');
  });

  it('refreshes token when expired', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'refreshed-token', refresh_token: 'new-rt', expires_in: 599,
      }),
    });
    const store = makeStore({ token_expires: Math.floor(Date.now() / 1000) - 60 });
    const api = new DominionEnergyApi(fetchFn as unknown as typeof fetch, store);
    await expect(api.getAllData()).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalled();
  });
});
```

Run: `npm test -- client.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/dominion/client.ts`**

```ts
import type { SessionStore } from './session.js';
import { emptyDominionEnergyData, type DominionEnergyData } from './types.js';
import { isAuthenticated, refreshAccessTokenIfNeeded, FullAuthRequiredError } from './auth.js';
import { parseBillForecast, parseCurrentBill, parseBillHistory } from './parsers/bill.js';
import { parseElectricUsage, parseGenerationData, parseDailyUsage, parseHourlyUsage } from './parsers/usage.js';
import { parseMeterInfo, parseBusinessMaster } from './parsers/account.js';
import { parseWeatherData } from './parsers/weather.js';
import {
  API_BASE_URL, USAGE_API_BASE_URL, BILLING_API_BASE_URL, ACCOUNT_MGMT_API_BASE_URL,
} from './const.js';

export class DominionEnergyApi {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly store: SessionStore,
  ) {}

  async getAllData(): Promise<DominionEnergyData> {
    if (!isAuthenticated(this.store)) {
      throw new FullAuthRequiredError('No valid session');
    }

    await refreshAccessTokenIfNeeded(this.fetchFn, this.store);

    const data = emptyDominionEnergyData();
    const errors: Error[] = [];

    // 1. Bill forecast (Service API)
    try {
      const res = await this.apiRequest(`${API_BASE_URL}/bill/billForecast`);
      Object.assign(data, parseBillForecast(res as Record<string, unknown>));
    } catch (e) { errors.push(e as Error); }

    // 2. Meter info (AccountMgmt API)
    try {
      const res = await this.accountMgmtRequest(
        `/Meters/Meter/accountNumber/${this.store.customer_number ?? ''}`,
      );
      Object.assign(data, parseMeterInfo(res));
    } catch (e) { errors.push(e as Error); }

    // 3. Electric usage (Usage API)
    try {
      const res = await this.usageRequest(
        `/Electric?AccountNumber=${this.store.customer_number ?? ''}&MeterNumber=${data.meter_number ?? ''}`,
      );
      Object.assign(data, parseElectricUsage(res));
    } catch (e) { errors.push(e as Error); }

    // 4. Generation data (Usage API)
    try {
      const res = await this.usageRequest(
        `/Generation?AccountNumber=${this.store.customer_number ?? ''}&MeterNumber=${data.meter_number ?? ''}`,
      );
      Object.assign(data, parseGenerationData(res));
    } catch (e) { /* non-solar accounts */ }

    // 5. Daily usage (Service API)
    try {
      const res = await this.apiRequest(
        `${API_BASE_URL}/Usage/UsageData?accountNumber=${this.store.customer_number ?? ''}&ActionCode=3`,
      );
      Object.assign(data, parseDailyUsage(res));
    } catch (e) { errors.push(e as Error); }

    // 6. Current bill (Billing API — POST)
    try {
      const res = await this.billingPostRequest('/bill/current', {
        accountNumber: this.store.customer_number ?? '',
      });
      Object.assign(data, parseCurrentBill(res as Record<string, unknown>));
    } catch (e) { errors.push(e as Error); }

    // 7. Bill history (Billing API — POST)
    try {
      const res = await this.billingPostRequest('/bill/history', {
        accountNumber: this.store.customer_number ?? '',
      });
      Object.assign(data, parseBillHistory(res as Record<string, unknown>));
    } catch (e) { errors.push(e as Error); }

    // 8. Weather data (Service API — usage history detail)
    try {
      const res = await this.apiRequest(
        `${API_BASE_URL}/Usage/GetUsageHistoryDetail?AccountNumber=${this.store.customer_number ?? ''}`,
      );
      Object.assign(data, parseWeatherData(res));
    } catch (e) { errors.push(e as Error); }

    return data;
  }

  private async apiRequest(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${this.store.token}`,
        uid: '1', pt: '1', channel: 'WEB',
        Origin: 'https://myaccount.dominionenergy.com',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`API request failed: ${res.status}`);
    return res.json();
  }

  private async accountMgmtRequest(path: string): Promise<unknown> {
    const res = await this.fetchFn(`${ACCOUNT_MGMT_API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${this.store.token}` },
    });
    if (!res.ok) throw new Error(`AccountMgmt request failed: ${res.status}`);
    return res.json();
  }

  private async usageRequest(path: string): Promise<unknown> {
    const res = await this.fetchFn(`${USAGE_API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${this.store.token}` },
    });
    if (!res.ok) throw new Error(`Usage request failed: ${res.status}`);
    return res.json();
  }

  private async billingPostRequest(path: string, body: Record<string, string>): Promise<unknown> {
    const res = await this.fetchFn(`${BILLING_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.store.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Billing request failed: ${res.status}`);
    return res.json();
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- client.test`
Expected: PASS — 3 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/dominion/client.ts test/dominion/client.test.ts
git commit -m "feat(dominion): add client.ts (DominionEnergyApi orchestrator)"
```

---

## Phase 3 — Server Layer (config, cache, poller, routes)

These tasks build the HTTP server and background polling infrastructure. Task 12 (cache) and Task 11 (config) have no dependencies and can be done first. Task 13 (poller) depends on cache + client. Task 14 (routes) depends on cache.

### Task 11: `src/config.ts` — Env var parsing with Zod

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('parseConfig', () => {
  it('parses valid env vars', async () => {
    const { parseConfig } = await import('../../src/config.js');
    const config = parseConfig({
      DOMINION_USERNAME: 'user@example.com',
      DOMINION_PASSWORD: 'secret123',
      DOMINION_ACCOUNT_NUMBER: '123456789012',
      PORT: '8080',
      DATA_DIR: '/data',
      LOG_LEVEL: 'info',
    });
    expect(config.username).toBe('user@example.com');
    expect(config.password).toBe('secret123');
    expect(config.accountNumber).toBe('123456789012');
    expect(config.port).toBe(8080);
    expect(config.dataDir).toBe('/data');
    expect(config.logLevel).toBe('info');
  });

  it('applies defaults for optional fields', () => {
    const { parseConfig } = require('../../src/config.js');
    const config = parseConfig({
      DOMINION_USERNAME: 'u',
      DOMINION_PASSWORD: 'p',
      DOMINION_ACCOUNT_NUMBER: '123456789012',
    });
    expect(config.port).toBe(8080);
    expect(config.dataDir).toBe('/data');
    expect(config.logLevel).toBe('info');
  });

  it('throws on missing required vars', () => {
    const { parseConfig } = require('../../src/config.js');
    expect(() => parseConfig({})).toThrow();
  });
});
```

Run: `npm test -- config.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/config.ts`**

```ts
import { z } from 'zod';

const configSchema = z.object({
  DOMINION_USERNAME: z.string().min(1),
  DOMINION_PASSWORD: z.string().min(1),
  DOMINION_ACCOUNT_NUMBER: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  DATA_DIR: z.string().default('/data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export interface AppConfig {
  username: string;
  password: string;
  accountNumber: string;
  port: number;
  dataDir: string;
  logLevel: string;
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = configSchema.parse(env);
  return {
    username: parsed.DOMINION_USERNAME,
    password: parsed.DOMINION_PASSWORD,
    accountNumber: parsed.DOMINION_ACCOUNT_NUMBER,
    port: parsed.PORT,
    dataDir: parsed.DATA_DIR,
    logLevel: parsed.LOG_LEVEL,
  };
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- config.test`
Expected: PASS — 3 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): add config.ts (Zod env var parsing)"
```

---

### Task 12: `src/server/cache.ts` — In-memory snapshot store

Simple thread-safe cache holding the latest `DominionEnergyData` snapshot + metadata (last poll time, error state).

**Files:**
- Create: `src/server/cache.ts`
- Test: `test/server/cache.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/server/cache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DataCache } from '../../src/server/cache.js';
import { emptyDominionEnergyData } from '../../src/dominion/types.js';

describe('DataCache', () => {
  it('initially has null data and no error', () => {
    const cache = new DataCache();
    expect(cache.getData()).toBeNull();
    expect(cache.getLastPollTime()).toBeNull();
    expect(cache.getError()).toBeNull();
  });

  it('stores and retrieves data', () => {
    const cache = new DataCache();
    const data = emptyDominionEnergyData();
    data.current_bill = 150.25;
    cache.update(data);
    expect(cache.getData()).toBe(data);
    expect(cache.getLastPollTime()).toBeTypeOf('number');
  });

  it('tracks error state', () => {
    const cache = new DataCache();
    cache.setError(new Error('boom'));
    expect(cache.getError()).toBeInstanceOf(Error);
    expect(cache.getError()!.message).toBe('boom');
  });

  it('clearError resets error state', () => {
    const cache = new DataCache();
    cache.setError(new Error('boom'));
    cache.clearError();
    expect(cache.getError()).toBeNull();
  });
});
```

Run: `npm test -- cache.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/server/cache.ts`**

```ts
import type { DominionEnergyData } from '../dominion/types.js';

export class DataCache {
  private data: DominionEnergyData | null = null;
  private lastPollTime: number | null = null;
  private error: Error | null = null;

  getData(): DominionEnergyData | null {
    return this.data;
  }

  getLastPollTime(): number | null {
    return this.lastPollTime;
  }

  getError(): Error | null {
    return this.error;
  }

  update(data: DominionEnergyData): void {
    this.data = data;
    this.lastPollTime = Date.now();
    this.error = null;
  }

  setError(err: Error): void {
    this.error = err;
  }

  clearError(): void {
    this.error = null;
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- cache.test`
Expected: PASS — 4 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/server/cache.ts test/server/cache.test.ts
git commit -m "feat(server): add cache.ts (in-memory snapshot store)"
```

---

### Task 13: `src/server/poller.ts` — 12h background poll loop

Runs `DominionEnergyApi.getAllData()` on an interval. On success, updates `DataCache`. On `FullAuthRequiredError`, signals the reauth module. On other errors, logs and sets error state.

**Files:**
- Create: `src/server/poller.ts`
- Test: `test/server/poller.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/server/poller.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Poller } from '../../src/server/poller.js';
import { DataCache } from '../../src/server/cache.js';
import { emptyDominionEnergyData } from '../../src/dominion/types.js';

describe('Poller', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('calls getAllData and updates cache on success', async () => {
    const data = emptyDominionEnergyData();
    const api = { getAllData: vi.fn().mockResolvedValue(data) };
    const cache = new DataCache();
    const onReauth = vi.fn();

    const poller = new Poller(api as any, cache, onReauth);
    await poller.pollOnce();

    expect(api.getAllData).toHaveBeenCalledOnce();
    expect(cache.getData()).toBe(data);
    expect(cache.getError()).toBeNull();
  });

  it('signals reauth on FullAuthRequiredError', async () => {
    class FakeReauthError extends Error {
      override readonly name = 'FullAuthRequiredError';
    }
    const api = { getAllData: vi.fn().mockRejectedValue(new FakeReauthError()) };
    const cache = new DataCache();
    const onReauth = vi.fn();

    const poller = new Poller(api as any, cache, onReauth);
    await poller.pollOnce();

    expect(onReauth).toHaveBeenCalledOnce();
  });

  it('sets error on generic API failure', async () => {
    const api = { getAllData: vi.fn().mockRejectedValue(new Error('network')) };
    const cache = new DataCache();
    const onReauth = vi.fn();

    const poller = new Poller(api as any, cache, onReauth);
    await poller.pollOnce();

    expect(cache.getError()).toBeInstanceOf(Error);
    expect(cache.getError()!.message).toBe('network');
    expect(onReauth).not.toHaveBeenCalled();
  });
});
```

Run: `npm test -- poller.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/server/poller.ts`**

```ts
import type { DominionEnergyApi } from '../dominion/client.js';
import { DataCache } from './cache.js';
import { FullAuthRequiredError } from '../dominion/auth.js';

export class Poller {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly api: DominionEnergyApi,
    private readonly cache: DataCache,
    private readonly onReauth: () => void,
    private readonly intervalMs: number = 12 * 60 * 60 * 1000,
  ) {}

  start(): void {
    this.pollOnce();
    this.intervalId = setInterval(() => this.pollOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async pollOnce(): Promise<void> {
    try {
      const data = await this.api.getAllData();
      this.cache.update(data);
    } catch (err) {
      if (err instanceof FullAuthRequiredError) {
        this.onReauth();
      } else {
        this.cache.setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- poller.test`
Expected: PASS — 3 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/server/poller.ts test/server/poller.test.ts
git commit -m "feat(server): add poller.ts (12h background poll loop)"
```

---

### Task 14: `src/server/routes.ts` — Fastify routes

Five HTTP endpoints backed by `DataCache`. All read-only — no mutation through HTTP.

**Files:**
- Create: `src/server/routes.ts`
- Test: `test/server/routes.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/server/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerRoutes } from '../../src/server/routes.js';
import { DataCache } from '../../src/server/cache.js';
import { emptyDominionEnergyData } from '../../src/dominion/types.js';

async function buildApp(cache: DataCache) {
  const app = Fastify({ logger: false });
  registerRoutes(app, cache);
  await app.ready();
  return app;
}

describe('routes', () => {
  it('GET /health returns ok', async () => {
    const cache = new DataCache();
    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('status', 'ok');
  });

  it('GET /sensors returns 200 with data', async () => {
    const cache = new DataCache();
    const data = emptyDominionEnergyData();
    data.current_bill = 150.25;
    data.meter_number = 'M-001';
    cache.update(data);

    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/sensors' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current_bill).toBe(150.25);
  });

  it('GET /sensors/:key returns single sensor', async () => {
    const cache = new DataCache();
    const data = emptyDominionEnergyData();
    data.current_bill = 150.25;
    cache.update(data);

    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/sensors/current_bill' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: 'current_bill', value: 150.25 });
  });

  it('GET /sensors/:key returns 404 for unknown key', async () => {
    const cache = new DataCache();
    cache.update(emptyDominionEnergyData());

    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/sensors/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /usage/daily returns daily_consumption array', async () => {
    const cache = new DataCache();
    const data = emptyDominionEnergyData();
    data.daily_consumption = [{ date: '2024-01-01', consumption: 30 }];
    cache.update(data);

    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/usage/daily' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('data');
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('GET /usage/monthly returns monthly_usage', async () => {
    const cache = new DataCache();
    const data = emptyDominionEnergyData();
    data.monthly_usage = 1200;
    cache.update(data);

    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/usage/monthly' });
    expect(res.statusCode).toBe(200);
    expect(res.json().monthly_usage).toBe(1200);
  });

  it('GET /bills/history returns bill_history array', async () => {
    const cache = new DataCache();
    const data = emptyDominionEnergyData();
    data.bill_history = [{ billMonth: '2024-01', totalAmount: 120 }];
    cache.update(data);

    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/bills/history' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('GET /sensors on empty cache returns 503', async () => {
    const cache = new DataCache();
    const app = await buildApp(cache);
    const res = await app.inject({ method: 'GET', url: '/sensors' });
    expect(res.statusCode).toBe(503);
  });
});
```

Run: `npm test -- routes.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/server/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { DataCache } from './cache.js';
import { ALL_SENSOR_KEYS } from '../dominion/const.js';
import type { SensorKey } from '../dominion/const.js';

export function registerRoutes(app: FastifyInstance, cache: DataCache): void {
  app.get('/health', async (_req, _rep) => {
    const data = cache.getData();
    return {
      status: data ? 'ok' : 'initializing',
      lastPollTime: cache.getLastPollTime(),
      error: cache.getError()?.message ?? null,
    };
  });

  app.get('/sensors', async (_req, rep) => {
    const data = cache.getData();
    if (!data) {
      return rep.status(503).send({ error: 'Data not yet available' });
    }
    return data as Record<string, unknown>;
  });

  app.get<{ Params: { key: string } }>('/sensors/:key', async (req, rep) => {
    const data = cache.getData();
    if (!data) {
      return rep.status(503).send({ error: 'Data not yet available' });
    }
    const key = req.params.key as SensorKey;
    if (!ALL_SENSOR_KEYS.includes(key)) {
      return rep.status(404).send({ error: `Unknown sensor: ${key}` });
    }
    return { key, value: (data as Record<string, unknown>)[key] ?? null };
  });

  app.get('/usage/daily', async (_req, rep) => {
    const data = cache.getData();
    if (!data) {
      return rep.status(503).send({ error: 'Data not yet available' });
    }
    return { data: data.daily_consumption ?? [] };
  });

  app.get('/usage/monthly', async (_req, rep) => {
    const data = cache.getData();
    if (!data) {
      return rep.status(503).send({ error: 'Data not yet available' });
    }
    return { monthly_usage: data.monthly_usage };
  });

  app.get('/bills/history', async (_req, rep) => {
    const data = cache.getData();
    if (!data) {
      return rep.status(503).send({ error: 'Data not yet available' });
    }
    return { data: data.bill_history ?? [] };
  });
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- routes.test`
Expected: PASS — 8 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes.ts test/server/routes.test.ts
git commit -m "feat(server): add routes.ts (Fastify HTTP endpoints)"
```

---

## Phase 4 — Auth Browser + Reauth (Playwright + UI)

### Task 15: `src/server/reauth.ts` — Auth-failure handler

Watches for `FullAuthRequiredError` signals from the poller. Triggers:
1. Launch auth-browser process (if not already running)
2. Wait for completion signal (new session file written)
3. Restart the poller with the refreshed session

**Files:**
- Create: `src/server/reauth.ts`
- Test: `test/server/reauth.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/server/reauth.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ReauthHandler } from '../../src/server/reauth.js';

describe('ReauthHandler', () => {
  it('calls launchBrowser only once when triggered multiple times', () => {
    const launchBrowser = vi.fn();
    const onComplete = vi.fn();
    const handler = new ReauthHandler(launchBrowser, onComplete);

    handler.trigger();
    handler.trigger();

    expect(launchBrowser).toHaveBeenCalledOnce();
  });

  it('calls onComplete when complete is called', () => {
    const launchBrowser = vi.fn();
    const onComplete = vi.fn();
    const handler = new ReauthHandler(launchBrowser, onComplete);

    handler.trigger();
    handler.complete();

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('allows retrigger after complete', () => {
    const launchBrowser = vi.fn();
    const handler = new ReauthHandler(launchBrowser, vi.fn());

    handler.trigger();
    handler.complete();
    handler.trigger();

    expect(launchBrowser).toHaveBeenCalledTimes(2);
  });
});
```

Run: `npm test -- reauth.test`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `src/server/reauth.ts`**

```ts
export class ReauthHandler {
  private running = false;

  constructor(
    private readonly launchBrowser: () => void,
    private readonly onComplete: () => void,
  ) {}

  trigger(): void {
    if (this.running) return;
    this.running = true;
    this.launchBrowser();
  }

  complete(): void {
    this.running = false;
    this.onComplete();
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- reauth.test`
Expected: PASS — 3 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/server/reauth.ts test/server/reauth.test.ts
git commit -m "feat(server): add reauth.ts (auth-failure handler)"
```

---

### Task 16: `src/auth-browser/login.ts` — Playwright headless login

Opens Playwright Chromium browser, navigates to `LOGIN_URL`, fills in username/password, submits, monitors for TFA challenge or successful redirect.

**Reference:** Python `_selenium_login_with_tfa()` (api.py:500) and `_extract_auth_data()` (api.py:1248).

**Files:**
- Create: `src/auth-browser/login.ts`
- Test: `test/auth-browser/login.test.ts` (skipped by default — requires Playwright binary + network)

- [ ] **Step 1: Write skeleton test (skipped by default)**

Create `test/auth-browser/login.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

// Integration tests — require Playwright browser binary and Dominion Energy credentials.
// Run manually with: npm run test:integration
// These tests are skipped by default in vitest.config.ts via test.exclude.

describe.skip('login (integration)', () => {
  it('navigates to login page and fills credentials', async () => {
    // Uses playwright-chromium to:
    // 1. Launch browser
    // 2. Navigate to LOGIN_URL
    // 3. Fill username/password
    // 4. Submit
    // 5. Check for TFA or redirect
    // 6. Extract auth data (UUID, cookies)
  });
});
```

- [ ] **Step 2: Create `src/auth-browser/login.ts`**

```ts
import { chromium, type Browser, type Page } from 'playwright-chromium';
import { LOGIN_URL } from '../dominion/const.js';

export interface LoginResult {
  uuid: string;
  cookies: Record<string, string>;
  needsTfa: boolean;
}

export async function runLoginFlow(
  username: string,
  password: string,
): Promise<LoginResult> {
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const page: Page = await browser.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });

    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    const tfaVisible = await page.waitForSelector('#tfa-input, .tfa-challenge', {
      timeout: 5000,
    }).then(() => true).catch(() => false);

    const cookies = await page.context().cookies();
    const cookieMap: Record<string, string> = {};
    for (const c of cookies) cookieMap[c.name] = c.value;

    const uuid =
      (await page.evaluate(() => {
        const m = document.cookie.match(/gmid=([^;]+)/);
        return m ? m[1] : null;
      })) ?? '';

    return { uuid, cookies: cookieMap, needsTfa: tfaVisible };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 3: Manual integration test** (requires Dominion Energy credentials; run with `npx tsx src/auth-browser/login.ts`)
- [ ] **Step 4: Commit**

```bash
git add src/auth-browser/login.ts test/auth-browser/login.test.ts
git commit -m "feat(auth-browser): add login.ts (Playwright headless login)"
```

---

### Task 17: `src/auth-browser/tfa.ts` + `ui/` — TFA flow + HTML forms

**Reference:** Python `_handle_tfa_via_api()` (api.py:670), `_handle_phone_tfa()` (api.py:888).

The TFA flow is a hybrid:
1. Playwright monitors for TFA challenge after login
2. If detected, the service shows an HTML form at `localhost:8080/admin/tfa`
3. User opens the admin page, enters the 6-digit code
4. Playwright completes the challenge using the Gigya REST API
5. Finalizes registration and extracts Dominion auth tokens

**Files:**
- Create: `src/auth-browser/tfa.ts`, `src/auth-browser/ui/login.html`, `src/auth-browser/ui/tfa.html`
- Test: `test/auth-browser/tfa.test.ts` (skipped by default, integration)

- [ ] **Step 1: Create `src/auth-browser/ui/login.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dominion Energy — Login</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
.card { background: #16213e; padding: 2rem; border-radius: 8px; width: 400px; }
h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
label { display: block; margin-bottom: 0.5rem; color: #aaa; }
input { width: 100%; padding: 0.5rem; margin-bottom: 1rem; border: 1px solid #333; border-radius: 4px; background: #0f3460; color: #eee; box-sizing: border-box; }
button { background: #e94560; color: #fff; border: none; padding: 0.75rem; width: 100%; border-radius: 4px; cursor: pointer; }
.error { color: #e94560; margin-top: 1rem; }
.success { color: #4ecca3; margin-top: 1rem; }
</style>
</head>
<body>
<div class="card">
  <h1>Dominion Energy Login</h1>
  <form id="loginForm">
    <label for="username">Username (email)</label>
    <input type="email" id="username" name="username" required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <label for="accountNumber">Account Number</label>
    <input type="text" id="accountNumber" name="accountNumber" required>
    <button type="submit">Login</button>
  </form>
  <div id="status"></div>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  status.className = '';
  status.textContent = 'Logging in...';
  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        accountNumber: document.getElementById('accountNumber').value,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      if (data.needsTfa) { window.location.href = '/admin/tfa'; }
      else { status.className = 'success'; status.textContent = 'Login successful! You can close this window.'; }
    } else {
      status.className = 'error'; status.textContent = data.error || 'Login failed';
    }
  } catch { status.className = 'error'; status.textContent = 'Connection error'; }
});
</script>
</body>
</html>
```

- [ ] **Step 2: Create `src/auth-browser/ui/tfa.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dominion Energy — TFA</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
.card { background: #16213e; padding: 2rem; border-radius: 8px; width: 400px; text-align: center; }
h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
p { color: #aaa; margin-bottom: 1.5rem; }
input { width: 200px; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #333; border-radius: 4px; background: #0f3460; color: #eee; text-align: center; font-size: 1.5rem; letter-spacing: 0.5rem; }
button { background: #e94560; color: #fff; border: none; padding: 0.75rem 2rem; border-radius: 4px; cursor: pointer; }
.error { color: #e94560; margin-top: 1rem; }
.success { color: #4ecca3; margin-top: 1rem; }
</style>
</head>
<body>
<div class="card">
  <h1>Two-Factor Authentication</h1>
  <p>Enter the verification code sent to your phone.</p>
  <form id="tfaForm">
    <input type="text" id="code" name="code" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" required>
    <button type="submit">Verify</button>
  </form>
  <div id="status"></div>
</div>
<script>
document.getElementById('tfaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  status.className = '';
  status.textContent = 'Verifying...';
  try {
    const res = await fetch('/admin/tfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('code').value }),
    });
    const data = await res.json();
    if (res.ok) {
      status.className = 'success'; status.textContent = 'Verification successful! You can close this window.';
    } else {
      status.className = 'error'; status.textContent = data.error || 'Verification failed';
    }
  } catch { status.className = 'error'; status.textContent = 'Connection error'; }
});
</script>
</body>
</html>
```

- [ ] **Step 3: Create `src/auth-browser/tfa.ts`**

```ts
import {
  GIGYA_API_KEY,
  GIGYA_AUTH_URL,
  GIGYA_TFA_INIT_ENDPOINT,
  GIGYA_TFA_PHONE_SEND_CODE_ENDPOINT,
  GIGYA_TFA_PHONE_COMPLETE_ENDPOINT,
  GIGYA_TFA_FINALIZE_ENDPOINT,
  GIGYA_FINALIZE_REGISTRATION_ENDPOINT,
  GIGYA_HEADERS,
} from '../dominion/const.js';

export interface TfaContext {
  regToken: string;
  gmid: string;
  phoneNumber?: string;
}

/**
 * Complete TFA using the Gigya REST API (phone flow).
 * Steps: initTFA → sendVerificationCode → completeVerification → finalizeTFA → finalizeRegistration
 */
export async function completePhoneTfa(
  fetchFn: typeof fetch,
  context: TfaContext,
  verificationCode: string,
): Promise<{ id_token: string }> {
  const commonParams = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    regToken: context.regToken,
  });

  // 1. Init TFA
  await fetchFn(
    `${GIGYA_AUTH_URL}${GIGYA_TFA_INIT_ENDPOINT}?${commonParams}&provider=phone`,
    { headers: GIGYA_HEADERS },
  );

  // 2. Send verification code
  await fetchFn(`${GIGYA_AUTH_URL}${GIGYA_TFA_PHONE_SEND_CODE_ENDPOINT}`, {
    method: 'POST',
    headers: { ...GIGYA_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...Object.fromEntries(commonParams),
      phoneID: context.phoneNumber ?? '',
    }).toString(),
  });

  // 3. Complete verification with user code
  const completeRes = await fetchFn(
    `${GIGYA_AUTH_URL}${GIGYA_TFA_PHONE_COMPLETE_ENDPOINT}`,
    {
      method: 'POST',
      headers: { ...GIGYA_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...Object.fromEntries(commonParams),
        verificationCode,
      }).toString(),
    },
  );
  const completeData = await completeRes.json();

  // 4. Finalize TFA
  const finalizeRes = await fetchFn(
    `${GIGYA_AUTH_URL}${GIGYA_TFA_FINALIZE_ENDPOINT}?${commonParams}`,
    { headers: GIGYA_HEADERS },
  );
  const finalizeData = await finalizeRes.json();

  // 5. Finalize registration
  const regRes = await fetchFn(
    `${GIGYA_AUTH_URL}${GIGYA_FINALIZE_REGISTRATION_ENDPOINT}`,
    {
      method: 'POST',
      headers: { ...GIGYA_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...Object.fromEntries(commonParams),
        UID: (completeData as any).UID ?? finalizeData.UID,
        uidSignature: (completeData as any).uidSignature ?? finalizeData.uidSignature,
        signatureTimestamp: (completeData as any).signatureTimestamp ?? finalizeData.signatureTimestamp,
      }).toString(),
    },
  );
  const regData = await regRes.json();

  return { id_token: (regData as any).id_token ?? (regData as any).UID };
}
```

- [ ] **Step 4: Write skeleton test (skipped by default)**

Create `test/auth-browser/tfa.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe.skip('tfa (integration)', () => {
  it('completes phone TFA flow with mocked Gigya responses', async () => {
    // Unit-test the REST API calls with mocked fetch
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add src/auth-browser/tfa.ts src/auth-browser/ui/login.html src/auth-browser/ui/tfa.html test/auth-browser/tfa.test.ts
git commit -m "feat(auth-browser): add TFA flow + HTML admin UI"
```

---

## Phase 5 — Wiring + Docker (Entrypoint, Dockerfile, Compose, README)

### Task 18: `src/index.ts` — Application entrypoint

Wires together: config → session → DominionEnergyApi → DataCache → Poller → ReauthHandler → Fastify server + admin routes.

- [ ] **Step 1: Write test**

Create `test/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('index entrypoint', () => {
  it('parses config and starts server', async () => {
    process.env.DOMINION_USERNAME = 'test@example.com';
    process.env.DOMINION_PASSWORD = 'secret';
    process.env.DOMINION_ACCOUNT_NUMBER = '123456789012';
    process.env.PORT = '0';
    process.env.DATA_DIR = '/tmp/dom-test';

    const mod = await import('../../src/index.js');
    expect(mod).toBeDefined();
  });
});
```

- [ ] **Step 2: Create `src/index.ts`**

```ts
import Fastify from 'fastify';
import { pino } from 'pino';
import { parseConfig } from './config.js';
import { loadSession, saveSession } from './dominion/session.js';
import { DominionEnergyApi } from './dominion/client.js';
import { DataCache } from './server/cache.js';
import { Poller } from './server/poller.js';
import { ReauthHandler } from './server/reauth.js';
import { registerRoutes } from './server/routes.js';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main(): Promise<void> {
  const config = parseConfig(process.env as Record<string, string>);
  const logger = pino({ level: config.logLevel });

  const sessionPath = join(config.dataDir, 'session.json');
  const store = (await loadSession(sessionPath)) ?? {
    token: null,
    refresh_token: null,
    token_expires: 0,
    uuid: null,
    cookies: {},
    customer_number: null,
    contract: null,
  };

  const api = new DominionEnergyApi(fetch, store);
  const cache = new DataCache();

  const reauthHandler = new ReauthHandler(
    () => {
      logger.info('Full reauth required — open http://localhost:${config.port}/admin/login');
    },
    () => {
      logger.info('Reauth completed — restarting poller');
      poller.pollOnce();
    },
  );

  const poller = new Poller(api, cache, () => reauthHandler.trigger());

  const app = Fastify({ logger });
  registerRoutes(app, cache);

  // Admin routes for browser-based auth
  app.register(async (adminApp) => {
    const loginPath = join(__dirname, 'auth-browser', 'ui', 'login.html');
    const tfaPath = join(__dirname, 'auth-browser', 'ui', 'tfa.html');

    adminApp.get('/login', async (_req, rep) => {
      rep.type('text/html');
      return readFileSync(loginPath, 'utf8');
    });
    adminApp.get('/tfa', async (_req, rep) => {
      rep.type('text/html');
      return readFileSync(tfaPath, 'utf8');
    });
  }, { prefix: '/admin' });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`Server listening on port ${config.port}`);

  // Start polling
  poller.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    poller.stop();
    await saveSession(sessionPath, store);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify it starts**

Run: `npm run dev`
Expected: Server starts, logs "Server listening on port 8080".
Press Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: add index.ts (application entrypoint)"
```

---

### Task 19: Production Dockerfile

Replace the placeholder `Dockerfile` with a multi-stage build using the Playwright base image.

- [ ] **Step 1: Update `Dockerfile`**

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/

VOLUME /data

EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build and verify**

Run: `docker build -t dominionpower-integration .`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: production Dockerfile (multi-stage, Playwright base)"
```

---

### Task 20: `docker-compose.yml.example` + `README.md`

- [ ] **Step 1: Create `docker-compose.yml.example`**

```yaml
version: '3.8'
services:
  dominion:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      - DOMINION_USERNAME=your-email@example.com
      - DOMINION_PASSWORD=your-password
      - DOMINION_ACCOUNT_NUMBER=your-12-digit-account
      - PORT=8080
      - DATA_DIR=/data
      - LOG_LEVEL=info
    restart: unless-stopped
```

- [ ] **Step 2: Create `README.md`**

Write concise README covering:
- What this project does (standalone TypeScript Dominion Energy data service)
- Prerequisites (Docker, or Node 20 + npm for development)
- Quick start with docker-compose
- Environment variables reference table
- API endpoints table (GET /health, /sensors, /sensors/:key, /usage/daily, /usage/monthly, /bills/history)
- TFA setup flow explanation (first-run browser auth at /admin/login)
- Development guide (clone, npm install, npm run dev)
- Project structure overview

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml.example README.md
git commit -m "docs: add docker-compose example and README"
```

---

## Completion Checklist

- [ ] All 20 tasks complete
- [ ] All unit tests pass (`npm test`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Docker build succeeds (`docker build -t dominionpower-integration .`)
- [ ] Service responds on `GET /health`, `GET /sensors`, `GET /usage/daily`, `GET /usage/monthly`, `GET /bills/history`