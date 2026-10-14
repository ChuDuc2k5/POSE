export const dispatcherEvery = 10000, reconcileEvery = 60000;
export const callConcurrency = () => Math.min(2, Math.max(1, Math.floor(Number(process.env.TELEPHONY_MAX_CONCURRENCY) || 2)));
