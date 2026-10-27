export function telephonyConfigured() {
  return [
    'TELEPHONY_PROVIDER',
    'TELEPHONY_API_URL',
    'TELEPHONY_API_KEY',
    'TELEPHONY_CALLER_ID',
    'TELEPHONY_WEBHOOK_SECRET',
  ].every((key) => !!process.env[key]?.trim());
}
