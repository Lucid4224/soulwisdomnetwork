import { explainError } from '../../../lib/serviceErrors';

// Bad input, rejected requests, the cost cap: retrying will not help, so stop and alert.
export class PermanentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PermanentError';
    }
}

function isTransient(error: unknown): boolean {
    if (error instanceof PermanentError) return false;
    // An account out of credits answers 429 too, but waiting will not help.
    if (explainError((error as Error)?.message)?.outOfMoney) return false;
    const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
    const status = Number(e?.status ?? e?.response?.status ?? e?.code);
    if (status === 429 || status === 408 || (status >= 500 && status < 600)) return true;
    const code = String(e?.code ?? '');
    return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE', 'UNAVAILABLE', 'DEADLINE_EXCEEDED']
        .includes(code);
}

// Retries network errors and 429/5xx with increasing delays (2s, 4s, 8s, 16s).
export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
    for (let i = 1; ; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i >= attempts || !isTransient(error)) throw error;
            const delay = 2000 * 2 ** (i - 1);
            console.warn(`  ⚠️ ${label} failed (attempt ${i}), retrying in ${delay / 1000}s:`, (error as Error).message);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}
