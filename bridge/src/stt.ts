// Speech-to-text via the local openai-whisper CLI. Fully offline, no API cost.
// Input: raw PCM16 mono. Output: transcribed text.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pcm16ToWav } from './audio.ts';
import type { WhisperConfig } from './config.ts';
import { log } from './log.ts';

export async function transcribe(
  pcm: Buffer,
  sampleRate: number,
  cfg: WhisperConfig,
): Promise<string> {
  if (pcm.length === 0) throw new Error('empty audio');

  const dir = await mkdtemp(join(tmpdir(), 'even-stt-'));
  const wavPath = join(dir, 'clip.wav');
  const txtPath = join(dir, 'clip.txt');

  try {
    await writeFile(wavPath, pcm16ToWav(pcm, sampleRate));

    const args = [
      wavPath,
      '--model',
      cfg.model,
      '--output_format',
      'txt',
      '--output_dir',
      dir,
      '--fp16',
      'False',
      '--verbose',
      'False',
      // Reduce hallucinations on silent/unclear audio (e.g. the infamous
      // "ご視聴ありがとうございました"): don't carry context across windows and
      // be stricter about treating low-confidence segments as no-speech.
      '--condition_on_previous_text',
      'False',
      '--no_speech_threshold',
      '0.6',
      '--logprob_threshold',
      '-1.0',
      '--compression_ratio_threshold',
      '2.4',
    ];
    if (cfg.language) args.push('--language', cfg.language);
    if (cfg.initialPrompt) args.push('--initial_prompt', cfg.initialPrompt);

    await runWhisper(cfg.bin, args);

    const text = await readFile(txtPath, 'utf8');
    return stripHallucinations(text.trim());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Phrases Whisper commonly hallucinates from silence/noise (mostly from its
// YouTube-subtitle training data). If the whole transcript is just one of these,
// treat it as empty so we don't fire a bogus command.
const HALLUCINATIONS = [
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございます',
  'ありがとうございました',
  'チャンネル登録お願いします',
  'おわり',
  'Thank you for watching',
  'Thanks for watching',
  'you',
];

function stripHallucinations(text: string): string {
  const normalized = text.replace(/[。、.\s]/g, '');
  for (const h of HALLUCINATIONS) {
    if (normalized === h.replace(/[。、.\s]/g, '')) return '';
  }
  return text;
}

function runWhisper(bin: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    log.debug('whisper', bin, args.join(' '));
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            `whisper binary "${bin}" not found. Install with: pip install -U openai-whisper`,
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`whisper exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
