// Accumulates raw PCM chunks streamed from the glasses mic (audioEvent.audioPcm)
// while recording, then hands back a single base64 blob to send to the bridge.

export class Recorder {
  private chunks: Uint8Array[] = [];
  private active = false;

  start(): void {
    this.chunks = [];
    this.active = true;
  }

  get isActive(): boolean {
    return this.active;
  }

  // Feed one PCM chunk (signed 16-bit LE mono) from an audioEvent.
  push(pcm: Uint8Array): void {
    if (this.active) this.chunks.push(pcm);
  }

  get byteLength(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0);
  }

  // Stop and return the captured audio as base64, or null if nothing captured.
  stop(): string | null {
    this.active = false;
    if (this.chunks.length === 0) return null;
    const total = this.byteLength;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    return toBase64(merged);
  }
}

// Chunked base64 encode that avoids call-stack limits on large buffers.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
