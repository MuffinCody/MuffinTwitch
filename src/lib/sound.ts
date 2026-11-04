/** Kurzer "Ding"-Ton bei Erwähnungen, per WebAudio erzeugt (keine Audiodatei nötig). */
let ctx: AudioContext | null = null;
let last = 0;

export function playMentionSound(volume: number) {
  const now = Date.now();
  if (now - last < 1500) return; // nicht bei jeder Nachricht in Folge
  last = now;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.6), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    for (const [freq, start] of [[880, 0], [1320, 0.09]] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(gain);
      o.start(t + start);
      o.stop(t + 0.5);
    }
  } catch {
    /* Audio nicht verfügbar */
  }
}
