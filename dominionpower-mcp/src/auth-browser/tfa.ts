import {
  GIGYA_API_KEY,
  GIGYA_AUTH_URL,
  GIGYA_TFA_INIT_ENDPOINT,
  GIGYA_TFA_PHONE_GET_NUMBERS_ENDPOINT,
  GIGYA_TFA_PHONE_SEND_CODE_ENDPOINT,
  GIGYA_TFA_PHONE_COMPLETE_ENDPOINT,
  GIGYA_TFA_FINALIZE_ENDPOINT,
  GIGYA_FINALIZE_REGISTRATION_ENDPOINT,
  GIGYA_HEADERS,
} from '../dominion/const.js';
import { DominionEnergyAuthError } from '../dominion/types.js';

export interface TfaContext {
  regToken: string;
  gmid: string;
  phoneId?: string;
  gigyaAssertion?: string;
  phvToken?: string;
}

function headersWithCookie(gmid: string): Record<string, string> {
  return {
    ...GIGYA_HEADERS,
    ...(gmid ? { Cookie: `gmid=${gmid}` } : {}),
  };
}

async function tfaGetRegisteredPhones(
  fetchFn: typeof fetch,
  commonParams: URLSearchParams,
  gmid: string,
  assertion?: string,
): Promise<Array<{ id: string; phone: string }>> {
  const url = assertion
    ? `${GIGYA_AUTH_URL}${GIGYA_TFA_PHONE_GET_NUMBERS_ENDPOINT}?${commonParams}&gigyaAssertion=${encodeURIComponent(assertion)}`
    : `${GIGYA_AUTH_URL}${GIGYA_TFA_PHONE_GET_NUMBERS_ENDPOINT}?${commonParams}`;
  const res = await fetchFn(url, { headers: headersWithCookie(gmid) });
  const data = (await res.json()) as Record<string, unknown>;
  if (data.errorCode !== 0) {
    throw new DominionEnergyAuthError(`Failed to get phones: ${(data.errorDetails as string) ?? data.errorMessage as string}`);
  }
  return (data.phones as Array<{ id: string; phone: string }>) ?? [];
}

export async function initiateTfa(
  fetchFn: typeof fetch,
  context: TfaContext,
): Promise<void> {
  const commonParams = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    regToken: context.regToken,
  });

  const initHeaders = headersWithCookie(context.gmid);
  const initRes = await fetchFn(
    `${GIGYA_AUTH_URL}${GIGYA_TFA_INIT_ENDPOINT}?${commonParams}&provider=gigyaPhone&mode=verify`,
    { headers: initHeaders },
  );
  const initData = (await initRes.json()) as Record<string, unknown>;
  if (initData.errorCode !== 0 && initData.errorCode !== 200101) {
    // 200101 = already initialized
    throw new DominionEnergyAuthError(
      `TFA init failed: ${(initData.errorDetails as string) ?? initData.errorMessage as string}`,
    );
  }
  context.gigyaAssertion = (initData as any).gigyaAssertion as string;

  const phones = await tfaGetRegisteredPhones(fetchFn, commonParams, context.gmid, context.gigyaAssertion);
  const phone = phones[0];
  if (!phone) {
    throw new DominionEnergyAuthError('No registered phone numbers found');
  }
  context.phoneId = phone.id;

  const assertion = context.gigyaAssertion;
  const sendUrl = assertion
    ? `${GIGYA_AUTH_URL}${GIGYA_TFA_PHONE_SEND_CODE_ENDPOINT}?${commonParams}&gigyaAssertion=${encodeURIComponent(assertion)}`
    : `${GIGYA_AUTH_URL}${GIGYA_TFA_PHONE_SEND_CODE_ENDPOINT}?${commonParams}`;
  const sendBody = new URLSearchParams({
    phoneID: phone.id,
    method: 'sms',
  });
  const sendRes = await fetchFn(sendUrl, {
    method: 'POST',
    headers: { ...headersWithCookie(context.gmid), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: sendBody.toString(),
  });
  const sendData = (await sendRes.json()) as Record<string, unknown>;
  if (sendData.errorCode !== 0) {
    throw new DominionEnergyAuthError(
      `Failed to send code: ${(sendData.errorDetails as string) ?? sendData.errorMessage as string}`,
    );
  }
  const phvToken = (sendData as any).phvToken as string | undefined;
  const phoneAssertion = (sendData as any).gigyaAssertion as string | undefined;
  if (phvToken) context.phvToken = phvToken;
  if (phoneAssertion) (context as any).phoneAssertion = phoneAssertion;
}

function gigyaApiParams(extra?: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    sdk: 'js_next',
    sdkBuild: '18148',
    format: 'json',
    pageURL: 'https://login.dominionenergy.com/CommonLogin?SelectedAppName=Electric',
    ...extra,
  });
  return params;
}

export async function completePhoneTfa(
  fetchFn: typeof fetch,
  context: TfaContext,
  verificationCode: string,
): Promise<{ id_token: string }> {
  const cookieHeaders = headersWithCookie(context.gmid);
  const gigyaAssertion = context.gigyaAssertion ?? '';
  const phoneAssertion = (context as any).phoneAssertion as string | undefined;
  const activeAssertion = phoneAssertion ?? gigyaAssertion;

  const completeExtra: Record<string, string> = {
    regToken: context.regToken,
    gigyaAssertion: activeAssertion,
    code: verificationCode,
  };
  if (context.phvToken) completeExtra.phvToken = context.phvToken;
  const completeUrl = `${GIGYA_AUTH_URL}${GIGYA_TFA_PHONE_COMPLETE_ENDPOINT}?${gigyaApiParams(completeExtra)}`;
  const completeRes = await fetchFn(completeUrl, { headers: cookieHeaders });
  const completeData = (await completeRes.json()) as Record<string, unknown>;
  if ((completeData as any).errorCode !== 0) {
    throw new DominionEnergyAuthError(
      `TFA complete failed: ${(completeData as any).errorDetails ?? (completeData as any).errorMessage as string}`,
    );
  }
  const providerAssertion = (completeData as any).providerAssertion as string;
  if (!providerAssertion) {
    throw new DominionEnergyAuthError('No providerAssertion in TFA complete response');
  }

  const finalizeUrl = `${GIGYA_AUTH_URL}${GIGYA_TFA_FINALIZE_ENDPOINT}?${gigyaApiParams({
    regToken: context.regToken,
    gigyaAssertion,
    providerAssertion,
    tempDevice: 'false',
  })}`;
  const finalizeRes = await fetchFn(finalizeUrl, { headers: cookieHeaders });
  const finalizeData = (await finalizeRes.json()) as Record<string, unknown>;
  if ((finalizeData as any).errorCode !== 0) {
    throw new DominionEnergyAuthError(
      `TFA finalize failed: ${(finalizeData as any).errorDetails ?? (finalizeData as any).errorMessage as string}`,
    );
  }

  const regUrl = `${GIGYA_AUTH_URL}${GIGYA_FINALIZE_REGISTRATION_ENDPOINT}?${gigyaApiParams({
    regToken: context.regToken,
    include: 'profile,data,emails,subscriptions,preferences,id_token,groups,loginIDs,',
    includeUserInfo: 'true',
  })}`;
  const regRes = await fetchFn(regUrl, { headers: cookieHeaders });
  const regData = (await regRes.json()) as Record<string, unknown>;
  if ((regData as any).errorCode !== 0) {
    throw new DominionEnergyAuthError(
      `TFA registration finalize failed: ${(regData as any).errorDetails ?? (regData as any).errorMessage as string}`,
    );
  }

  const idToken = (regData as any).id_token as string;
  if (!idToken) {
    throw new DominionEnergyAuthError('No id_token in finalizeRegistration response');
  }
  return { id_token: idToken };
}
