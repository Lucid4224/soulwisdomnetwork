import { describeError, explainError } from '../../../lib/serviceErrors';
import type { Config } from './config';

export { describeError };

// A failure email's subject, led by the cause when it is a known one ("OpenAI is out of
// credits"), so it stands out in the inbox.
export function failureSubject(subject: string, message: string) {
    const help = explainError(message);
    return help ? `${help.outOfMoney ? '💳' : '⚠️'} ${help.problem}: ${subject}` : `⚠️ ${subject}`;
}

export interface Failure {
    episode: string;
    stage: string;
    message: string;
    fileId: string;
}

// Emails a summary of permanent failures through Resend. Without a key it only logs:
// the workflow run still fails, so GitHub's own failure email is the fallback.
export async function sendFailureAlert(config: Config, failures: Failure[]) {
    if (failures.length === 0) return;

    const lines = failures.map(f =>
        `• ${f.episode}\n  Stage: ${f.stage}\n  ${describeError(f.message).replace(/\n/g, '\n  ')}\n  Retry: run "Podcast Ingest" with retry_file_id = ${f.fileId}`,
    );
    const text = [
        `${failures.length} podcast episode(s) stopped and need attention.`,
        '',
        ...lines,
        '',
        config.runUrl ? `Run log: ${config.runUrl}` : '',
    ].join('\n');

    await sendEmail(config, failureSubject(`Podcast pipeline: ${failures.length} episode(s) failed`, failures[0].message), text);
}

export interface Attachment {
    filename: string;
    content: string;      // plain text; base64-encoded on the way out
}

// Sends through Resend. Returns false when email is not configured. Run logs are public (the
// repository is), so they get the subject only: never the address or the body.
export async function sendEmail(config: Pick<Config, 'alert'>, subject: string, text: string, attachments: Attachment[] = []) {
    const { resendApiKey, to, from } = config.alert;
    if (!resendApiKey || !to) {
        console.warn(`⚠️ RESEND_API_KEY or ALERT_EMAIL not set; not emailing "${subject}".`);
        return false;
    }

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from,
            to: [to],
            subject,
            text,
            attachments: attachments.map(a => ({
                filename: a.filename,
                content: Buffer.from(a.content, 'utf-8').toString('base64'),
            })),
        }),
    });
    if (!res.ok) {
        console.error(`❌ Email "${subject}" failed: ${res.status} ${await res.text()}`);
        return false;
    }
    console.log(`📧 Emailed "${subject}"`);
    return true;
}
