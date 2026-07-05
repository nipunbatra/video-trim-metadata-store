import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export interface TrimOptions {
  blob: Blob;
  inputName: string; // original filename, used to pick container
  startSec: number;
  endSec: number;
  precise: boolean; // false: stream copy (keyframe snap); true: re-encode
  onProgress?: (ratio: number) => void; // 0..1, only meaningful for precise
  onLog?: (line: string) => void;
}

export interface TrimResult {
  blob: Blob;
  outputName: string;
  mimeType: string;
}

/** HH:MM:SS.mmm — same format the existing video-toolkit scripts use. */
export function toTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : 'mp4';
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

/**
 * Trim in the browser with ffmpeg.wasm (single-threaded core — no
 * SharedArrayBuffer / COOP-COEP needed, so it runs on GitHub Pages).
 *
 * Fast path matches video-toolkit: stream copy with -avoid_negative_ts.
 * Precise path matches its fallback: libx264 ultrafast crf 17 + aac 128k.
 * A fresh FFmpeg instance is created per job and terminated afterwards so
 * WASM memory is fully released between trims.
 */
export async function trimVideo(opts: TrimOptions): Promise<TrimResult> {
  const ffmpeg = new FFmpeg();
  if (opts.onLog) {
    ffmpeg.on('log', ({ message }) => opts.onLog!(message));
  }
  if (opts.onProgress) {
    ffmpeg.on('progress', ({ progress }) => {
      opts.onProgress!(Math.max(0, Math.min(1, progress)));
    });
  }

  const base = new URL('ffmpeg/', document.baseURI).href;
  await ffmpeg.load({
    coreURL: `${base}ffmpeg-core.js`,
    wasmURL: `${base}ffmpeg-core.wasm`,
  });

  const inExt = ext(opts.inputName);
  // Stream copy must keep the container; re-encode always yields mp4.
  const outExt = opts.precise ? 'mp4' : inExt;
  const inPath = `input.${inExt}`;
  const outPath = `output.${outExt}`;
  const duration = opts.endSec - opts.startSec;

  let mounted = false;
  try {
    // WORKERFS reads the File lazily instead of copying it into the WASM
    // heap — the input file no longer counts against the ~2 GB limit.
    const file = new File([opts.blob], inPath, { type: opts.blob.type });
    await ffmpeg.createDir('/work');
    await ffmpeg.mount('WORKERFS' as any, { files: [file] } as any, '/work');
    mounted = true;
  } catch {
    await ffmpeg.writeFile(inPath, await fetchFile(opts.blob));
  }
  const input = mounted ? `/work/${inPath}` : inPath;

  const args = opts.precise
    ? [
        '-ss', toTimestamp(opts.startSec),
        '-i', input,
        '-t', toTimestamp(duration),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outPath,
      ]
    : [
        '-ss', toTimestamp(opts.startSec),
        '-i', input,
        '-t', toTimestamp(duration),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        ...(outExt === 'mp4' || outExt === 'm4v' || outExt === 'mov'
          ? ['-movflags', '+faststart']
          : []),
        outPath,
      ];

  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = (await ffmpeg.readFile(outPath)) as Uint8Array;
    const mime = MIME[outExt] ?? 'video/mp4';
    const stem = opts.inputName.replace(/\.[^.]+$/, '');
    return {
      blob: new Blob([data.slice().buffer as ArrayBuffer], { type: mime }),
      outputName: `${stem}-trimmed.${outExt}`,
      mimeType: mime,
    };
  } finally {
    ffmpeg.terminate(); // frees the whole WASM heap
  }
}
