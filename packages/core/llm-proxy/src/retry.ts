export interface RetryConfig {
  attempts: number;
  minDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}

export function getRetryConfig(config?: Partial<RetryConfig>): RetryConfig {
  return {
    attempts: config?.attempts ?? 2,
    minDelayMs: config?.minDelayMs ?? 500,
    maxDelayMs: config?.maxDelayMs ?? 5000,
    jitter: config?.jitter ?? 0.1,
  };
}

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  config: RetryConfig,
  shouldRetry: (error: unknown) => boolean
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= config.attempts) {
        break;
      }
      const backoff = Math.min(config.minDelayMs * Math.pow(2, attempt - 1), config.maxDelayMs);
      const jitter = backoff * config.jitter * Math.random();
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
    }
  }
  throw lastError;
}
