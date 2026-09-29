// Turns the raw error from a job or route into what went wrong and what to do about it, for
// the Studio's error boxes (components/studio/ErrorNote.tsx) and the failure emails
// (agent/src/podcast/*). Most failures that are not bugs are an account out of money, a key
// that stopped working, or a service being busy; each names the account and the fix.

export interface ErrorHelp {
    problem: string;        // one line, shown in bold
    fix: string;            // what to do
    outOfMoney: boolean;    // retrying will not help until someone pays
}

type Service = { name: string; test: RegExp; billing: string; key: string; usedFor: string };

const SERVICES: Service[] = [
    {
        name: 'OpenAI', test: /openai|incorrect api key provided|no credits remaining|insufficient_quota|gpt-image|dall-e/i,
        billing: 'platform.openai.com → Settings → Billing', key: 'OPENAI_API_KEY', usedFor: 'b-roll images and the AI thumbnail background',
    },
    {
        name: 'Anthropic (Claude)', test: /anthropic|claude|x-api-key|credit balance is too low|overloaded_error/i,
        billing: 'console.anthropic.com → Settings → Billing', key: 'ANTHROPIC_API_KEY', usedFor: 'show notes, thumbnail texts and shorts titles',
    },
    {
        name: 'Descript', test: /descript/i,
        billing: 'Descript → Settings → Plans & billing', key: 'DESCRIPT_API_TOKEN', usedFor: 'the Descript project and the final cut',
    },
    {
        name: 'AssemblyAI', test: /assemblyai|assembly ai/i,
        billing: 'assemblyai.com/dashboard → Billing', key: 'ASSEMBLYAI_API_KEY', usedFor: 'transcripts',
    },
    {
        name: 'YouTube', test: /youtube|invalid_grant|quotaExceeded|uploadLimitExceeded/i,
        billing: 'console.cloud.google.com → APIs & Services → YouTube Data API → Quotas', key: 'YOUTUBE_REFRESH_TOKEN', usedFor: 'uploads and shorts',
    },
    {
        name: 'Resend', test: /resend/i,
        billing: 'resend.com → Settings → Billing', key: 'RESEND_API_KEY', usedFor: 'emails',
    },
];

const OUT_OF_MONEY = /no credits remaining|insufficient_quota|exceeded your current quota|billing_hard_limit|billing hard limit|credit balance is too low|out of media minutes or ai credits|insufficient (funds|balance|credits)|payment required|\b402\b|account balance/i;
const BAD_KEY = /\b401\b|\b403\b.*(key|token)|incorrect api key|invalid[ _-]?(api[ _-]?)?key|invalid x-api-key|authentication_error|unauthorized|invalid_grant|token has been expired or revoked/i;
const QUOTA = /quotaExceeded|uploadLimitExceeded|daily limit|quota.*exceeded/i;
const BUSY = /\b429\b|rate.?limit|too many requests|overloaded|\b529\b|\b503\b|service unavailable/i;

const which = (message: string) => SERVICES.find(s => s.test.test(message));

export function explainError(message: string | null | undefined): ErrorHelp | null {
    if (!message) return null;
    const s = which(message);
    const name = s?.name ?? 'A service the pipeline uses';
    if (OUT_OF_MONEY.test(message)) {
        return {
            problem: `${name} is out of credits`,
            fix: s
                ? `Add credits at ${s.billing} (it pays for ${s.usedFor}), then press the button again.`
                : 'Check the billing page of the service named in the details, add credits, then press the button again.',
            outOfMoney: true,
        };
    }
    if (s?.name === 'YouTube' && QUOTA.test(message)) {
        return {
            problem: "YouTube's daily upload allowance is used up",
            fix: 'It resets at midnight Pacific time; press the button again tomorrow.',
            outOfMoney: false,
        };
    }
    if (BAD_KEY.test(message)) {
        return {
            problem: `${name} did not accept our key`,
            fix: s
                ? `The ${s.key} secret (GitHub → Settings → Secrets and variables → Actions) is wrong, expired or revoked. Make a new one in ${s.name} and update the secret.`
                : 'A key or token was refused. Check the secrets in GitHub → Settings → Secrets and variables → Actions.',
            outOfMoney: false,
        };
    }
    if (BUSY.test(message)) {
        return {
            problem: `${name} is busy or limiting requests`,
            fix: 'Wait a few minutes and press the button again.',
            outOfMoney: false,
        };
    }
    return null;
}

// The same, as lines for an email: what happened and the fix, then the raw error.
export function describeError(message: string) {
    const help = explainError(message);
    return help ? `${help.problem.toUpperCase()}.\n${help.fix}\n\nError: ${message}` : `Error: ${message}`;
}
