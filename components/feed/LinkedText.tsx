// Plain text with its web links made clickable. Nothing else is interpreted, so members
// cannot inject markup.

const LINK = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;

export default function LinkedText({ text, className = "" }: { text: string; className?: string }) {
    const parts = text.split(LINK);
    return (
        <p className={`whitespace-pre-wrap break-words ${className}`}>
            {parts.map((part, i) => i % 2
                ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-gold-600 dark:text-gold-400 underline break-all">{part}</a>
                : part)}
        </p>
    );
}
