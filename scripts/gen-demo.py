"""Generate the Editor Light demo clip and its transcript (public/editor-demo/).

Each word is spoken separately with espeak-ng and placed on the timeline by this script,
so every time in words.json is exact. Two speakers, each on their own background colour.
The first half has "um" as words in the transcript; in the second half the "um"s are
still spoken but left out of the transcript, the way AssemblyAI leaves them out, so they
show up as gaps. Also one repeated "the the" and two long pauses.

Run: python3 scripts/gen-demo.py   (needs espeak-ng and ffmpeg)
"""
import json, os, struct, subprocess, tempfile, wave

OUT = 'public/editor-demo'
RATE = 22050
VOICES = {'Host': 'en-us+m3', 'Guest': 'en-us+f3'}
COLOURS = {'Host': '0x2b1a5c', 'Guest': '0x5c3a1a'}
WORD_GAP = 0.07     # normal space between words
SENTENCE_GAP = 0.45

# (speaker, text). "{um}" is a filler kept in the transcript; "{um-}" is spoken but
# left out of the transcript; "[pause]" is a two-second silence.
SCRIPT = [
    ('Host', 'Welcome to the show. Today we have {um} a very special guest with us.'),
    ('Host', 'We are going to talk about the the meaning of a quiet mind.'),
    ('Guest', 'Thank you for having me. It is {um} a real pleasure to be here. [pause]'),
    ('Host', 'So tell us, how did you first {um} find this path?'),
    ('Guest', 'It started with a long walk by the sea. I sat down and just listened.'),
    ('Host', 'And what did you hear? [pause]'),
    ('Guest', 'Mostly the waves. Then I noticed {um-} my own breathing, and that changed everything.'),
    ('Host', 'That is beautiful. What would you say to someone {um-} just starting out?'),
    ('Guest', 'Start small. Sit for five minutes a day and {um-} be kind to yourself.'),
    ('Host', 'Thank you so much for joining us today.'),
]

def speak(word, voice, path):
    subprocess.run(['espeak-ng', '-v', voice, '-s', '165', '-w', path, word], check=True)
    with wave.open(path) as w:
        frames = w.readframes(w.getnframes())
    samples = list(struct.unpack('<%dh' % (len(frames) // 2), frames))
    loud = [i for i, s in enumerate(samples) if abs(s) > 600]
    return samples[loud[0]:loud[-1] + 1] if loud else samples

def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    audio, words, turns = [], [], []
    t = 0.0
    def silence(seconds):
        nonlocal t
        audio.extend([0] * int(seconds * RATE)); t += seconds
    for speaker, text in SCRIPT:
        turn_start = t
        for token in text.split():
            if token == '[pause]':
                silence(2.0); continue
            hidden = token == '{um-}'
            spoken = 'um' if token in ('{um}', '{um-}') else token
            samples = speak(spoken.strip('.,?!'), VOICES[speaker], os.path.join(tmp, 'w.wav'))
            start = t
            audio.extend(samples); t += len(samples) / RATE
            if not hidden:
                words.append({'text': spoken, 'start': round(start * 1000), 'end': round(t * 1000), 'speaker': speaker, 'clip': False})
            silence(SENTENCE_GAP if spoken[-1] in '.?!' else WORD_GAP)
        turns.append((speaker, turn_start, t))
    silence(0.5)
    turns[-1] = (turns[-1][0], turns[-1][1], t)

    wav = os.path.join(tmp, 'all.wav')
    with wave.open(wav, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(struct.pack('<%dh' % len(audio), *audio))

    # One coloured background per turn, joined to match the audio exactly.
    parts, labels = [], []
    for i, (speaker, a, b) in enumerate(turns):
        b = turns[i + 1][1] if i + 1 < len(turns) else t
        parts.append(f"color=c={COLOURS[speaker]}:s=1280x720:r=30:d={b - a:.3f}[c{i}]")
        labels.append(f'[c{i}]')
    graph = ';'.join(parts) + ';' + ''.join(labels) + f'concat=n={len(turns)}:v=1:a=0[v]'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-filter_complex', graph, '-i', wav,
                    '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-preset', 'veryfast',
                    '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest',
                    '-movflags', '+faststart', f'{OUT}/sample.mp4'], check=True)
    with open(f'{OUT}/words.json', 'w') as f:
        json.dump(words, f, indent=1)
    print(f'{t:.1f} s, {len(words)} words')

if __name__ == '__main__':
    main()
