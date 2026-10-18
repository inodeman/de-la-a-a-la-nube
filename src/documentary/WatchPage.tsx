import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { CHANNEL, UP_NEXT, chapters } from "./chapters";
import { narrationCues } from "./cues";
import { StageCanvas } from "./StageCanvas";

type CueFile = {
  lines?: Array<{ chapter: number; t: number; text: string }>;
};

type Timeline = {
  chapters: Array<(typeof chapters)[number] & { start: number; end: number }>;
  lines: Array<{ chapter: number; t: number; text: string }>;
};

const SAVE_KEY = "a-la-nube-t";

function fmt(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

function buildTimeline(duration: number, cues: CueFile | null): Timeline {
  if (cues?.lines && cues.lines.length > 0) {
    const lines = [...cues.lines].sort((a, b) => a.t - b.t);
    const laid = chapters.map((chapter, index) => {
      const own = lines.filter((line) => line.chapter === index);
      const start = own[0]?.t ?? 0;
      const next = lines.find((line) => line.chapter === index + 1);
      const end = next?.t ?? duration;
      return { ...chapter, start, end: Math.max(start + 0.2, end) };
    });
    return { chapters: laid, lines };
  }
  const weights = chapters.map((chapter) => chapter.lines.join(" ").length || 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = 0;
  const lines: Timeline["lines"] = [];
  const laid = chapters.map((chapter, index) => {
    const start = cursor;
    const span = (duration * weights[index]) / total;
    chapter.lines.forEach((text, lineIndex) => {
      lines.push({ chapter: index, t: start + (span * lineIndex) / chapter.lines.length, text });
    });
    cursor += span;
    return { ...chapter, start, end: cursor };
  });
  return { chapters: laid, lines };
}

export function WatchPage() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const worldRef = useRef("road");
  const localRef = useRef(0);
  const playingRef = useRef(false);
  const missingRef = useRef(true);
  const durationRef = useRef(900);
  const layoutRef = useRef<Timeline>(buildTimeline(900, null));
  const droneRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(900);
  const [index, setIndex] = useState(0);
  const [ended, setEnded] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [dip, setDip] = useState(false);
  const cues = narrationCues;
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const speechRef = useRef({ last: -1, speaking: false, anchor: 0, est: 2, from: 0, to: 1 });
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const mutedRef = useRef(false);
  const speakAtRef = useRef<(index: number) => void>(() => undefined);
  const dipped = useRef(false);

  const timeline = useMemo(() => buildTimeline(duration, cues), [duration, cues]);

  useEffect(() => {
    layoutRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    const saved = Number(localStorage.getItem(SAVE_KEY) || 0);
    if (saved > 12 && saved < 860) setResumeAt(saved);
  }, []);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("export")) return;
    document.documentElement.classList.add("exporting");
    setResumeAt(null);
    const timer = window.setTimeout(() => playFrom(0), 600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const mark = () => {
      const next = audio.duration;
      if (Number.isFinite(next) && next > 1) {
        missingRef.current = false;
        setDuration(next);
      }
    };
    if (audio.readyState >= 1) mark();
    audio.addEventListener("loadedmetadata", mark);
    const fail = () => {
      missingRef.current = true;
    };
    audio.addEventListener("error", fail);
    return () => {
      audio.removeEventListener("loadedmetadata", mark);
      audio.removeEventListener("error", fail);
    };
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setNoVoice(true);
      return;
    }
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceRef.current =
        voices.find((voice) => voice.lang.toLowerCase() === "es-mx") ??
        voices.find((voice) => voice.lang.toLowerCase().startsWith("es")) ??
        null;
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    setNoVoice(false);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let savedAcc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const audio = audioRef.current;
      let next = timeRef.current;
      if (playingRef.current) {
        if (audio && !missingRef.current && audio.ended) {
          next = durationRef.current || audio.duration || next;
        } else if (audio && !missingRef.current && !audio.paused) {
          next = audio.currentTime;
        } else if (missingRef.current) {
          next += dt;
        }
        const limit = durationRef.current || 900;
        if (next >= limit - 0.05) {
          next = limit;
          playingRef.current = false;
          setPlaying(false);
          setEnded(true);
          localStorage.removeItem(SAVE_KEY);
          if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        } else if (missingRef.current && !mutedRef.current && "speechSynthesis" in window) {
          const lines = layoutRef.current.lines;
          let spoken = 0;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].t <= next + 0.03) spoken = i;
          }
          if (spoken !== speechRef.current.last) {
            speechRef.current.last = spoken;
            speakAtRef.current(spoken);
          }
        }
      }
      timeRef.current = next;
      const laid = layoutRef.current.chapters;
      let chapterIndex = 0;
      for (let i = 0; i < laid.length; i++) {
        if (next >= laid[i].start) chapterIndex = i;
      }
      const chapter = laid[chapterIndex] ?? laid[0];
      worldRef.current = chapter?.world ?? "road";
      const span = Math.max(0.001, (chapter?.end ?? 1) - (chapter?.start ?? 0));
      localRef.current = Math.min(1, Math.max(0, (next - (chapter?.start ?? 0)) / span));
      acc += dt;
      savedAcc += dt;
      if (acc > 0.25) {
        acc = 0;
        setTime(next);
        setIndex(chapterIndex);
      }
      if (savedAcc > 5 && playingRef.current) {
        savedAcc = 0;
        localStorage.setItem(SAVE_KEY, String(Math.floor(next)));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!dipped.current) {
      dipped.current = true;
      return;
    }
    setDip(true);
    const timeout = window.setTimeout(() => setDip(false), 420);
    const node = railRef.current?.querySelector<HTMLButtonElement>(`[data-i="${index}"]`);
    node?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    return () => window.clearTimeout(timeout);
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      }
      if (event.code === "ArrowRight") seek(timeRef.current + 10);
      if (event.code === "ArrowLeft") seek(timeRef.current - 10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function lineIndexAt(t: number) {
    const lines = layoutRef.current.lines;
    let indexAt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= t + 0.03) indexAt = i;
    }
    return indexAt;
  }

  function speakAt(indexAt: number) {
    if (!("speechSynthesis" in window) || mutedRef.current || !playingRef.current) return;
    const line = layoutRef.current.lines[indexAt];
    if (!line) return;
    const utterance = new SpeechSynthesisUtterance(line.text);
    utterance.lang = "es-MX";
    utterance.rate = 0.94;
    utterance.pitch = 0.96;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
  speakAtRef.current = speakAt;

  function ensureDrone() {
    if (document.documentElement.classList.contains("exporting")) return;
    if (droneRef.current || muted) return;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.02;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    filter.connect(gain).connect(ctx.destination);
    [73.4, 110, 146.8].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? "triangle" : "sine";
      osc.frequency.value = freq;
      const voice = ctx.createGain();
      voice.gain.value = i === 0 ? 0.55 : 0.18;
      osc.connect(voice).connect(filter);
      osc.start();
    });
    void ctx.resume();
    droneRef.current = { ctx, gain };
  }

  function playFrom(at?: number) {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 1) missingRef.current = false;
    setEnded(false);
    if (typeof at === "number") {
      timeRef.current = at;
      if (audio && !missingRef.current) audio.currentTime = at;
      setTime(at);
    }
    const startVoice = () => {
      playingRef.current = true;
      setPlaying(true);
      ensureDrone();
      speechRef.current.last = -1;
    };
    if (audio && !missingRef.current) {
      const start = () => {
        playingRef.current = true;
        setPlaying(true);
        ensureDrone();
      };
      if (document.documentElement.classList.contains("exporting")) audio.muted = true;
      void audio.play().then(start).catch(() => {
        audio.muted = true;
        void audio.play().then(start).catch(() => {
          missingRef.current = true;
          startVoice();
        });
      });
      return;
    }
    startVoice();
  }

  function pause() {
    playingRef.current = false;
    setPlaying(false);
    audioRef.current?.pause();
    speechRef.current.speaking = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function toggle() {
    if (playingRef.current) pause();
    else playFrom();
  }

  function seek(next: number) {
    const limit = durationRef.current || 900;
    const clamped = Math.min(limit, Math.max(0, next));
    timeRef.current = clamped;
    if (audioRef.current && !missingRef.current) audioRef.current.currentTime = clamped;
    setTime(clamped);
    setEnded(false);
    speechRef.current.last = -1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function replay() {
    localStorage.removeItem(SAVE_KEY);
    playFrom(0);
  }

  function setLevel(next: number) {
    setVolume(next);
    const silent = next === 0;
    setMuted(silent);
    mutedRef.current = silent;
    if (audioRef.current) audioRef.current.volume = next;
    if (droneRef.current) droneRef.current.gain.gain.value = silent ? 0 : 0.02;
    if (silent && "speechSynthesis" in window) {
      speechRef.current.speaking = false;
      window.speechSynthesis.cancel();
    } else if (playingRef.current && missingRef.current) {
      speakAtRef.current(lineIndexAt(timeRef.current));
    }
  }

  function toggleMute() {
    setLevel(muted || volume === 0 ? (volume || 1) : 0);
  }

  async function fullscreen() {
    const node = playerRef.current;
    if (!node) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await node.requestFullscreen().catch(() => undefined);
  }

  const chapter = timeline.chapters[index] ?? timeline.chapters[0];
  let cue: Timeline["lines"][number] | undefined;
  for (const line of timeline.lines) {
    if (line.t <= time + 0.05) cue = line;
    else break;
  }

  return (
    <main className="min-h-dvh bg-void text-cream">
      <audio
        ref={audioRef}
        src="/narracion.mp3"
        preload="auto"
        playsInline
        className="hidden"
        onLoadedMetadata={(event) => {
          const next = event.currentTarget.duration;
          if (Number.isFinite(next) && next > 1) {
            missingRef.current = false;
            setDuration(next);
          }
        }}
        onError={() => {
          missingRef.current = true;
        }}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-16 pt-4 sm:px-6">
        <header className="export-hide flex items-center justify-between gap-3">
          <p className="font-display text-xl tracking-tight">InodeAi</p>
          <a
            href={CHANNEL.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-full bg-copper px-4 text-sm font-semibold text-void"
          >
            Seguir
          </a>
        </header>

        <section
          ref={playerRef}
          className="export-stage relative aspect-video w-full overflow-hidden rounded-xl bg-ink shadow-2xl"
          aria-label="Reproductor del documental"
        >
          <StageCanvas worldRef={worldRef} localRef={localRef} />
          <div className="vignette pointer-events-none absolute inset-0" />
          <div className={`dip pointer-events-none absolute inset-0 bg-void transition-opacity duration-300 ${dip ? "opacity-80" : "opacity-0"}`} />

          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="rounded-full bg-void/70 px-3 py-1 text-xs tracking-wide text-cream">
                {chapter?.kicker} · {chapter?.year}
              </p>
              <p className="font-display text-2xl text-cream sm:text-4xl">{chapter?.title}</p>
            </div>
            <div className="flex flex-col gap-2">
              {cue && !ended ? (
                <p className="mx-auto max-w-xl rounded-lg bg-void/75 px-3 py-2 text-center text-sm leading-snug text-cream sm:text-base">
                  {cue.text}
                </p>
              ) : (
                <span />
              )}
              <div className="export-controls pointer-events-auto flex flex-col gap-1">
                <label className="sr-only" htmlFor="doc-seek">
                  Posición del documental
                </label>
                <input
                  id="doc-seek"
                  className="scrub"
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={Math.min(time, duration)}
                  onChange={(event) => seek(Number(event.target.value))}
                  suppressHydrationWarning
                />
                <div className="flex items-center gap-2 text-cream">
                  <button type="button" className="grid h-11 w-11 place-items-center rounded-full bg-cream text-void" onClick={toggle} aria-label={playing ? "Pausar" : "Reproducir"}>
                    {playing ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <span className="min-w-24 text-sm text-cream">
                    {fmt(time)} / {fmt(duration)}
                  </span>
                  <button type="button" className="grid h-11 w-11 place-items-center" onClick={toggleMute} aria-label={muted ? "Activar sonido" : "Silenciar"}>
                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    className="scrub hidden w-24 sm:block"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    aria-label="Volumen"
                    onChange={(event) => setLevel(Number(event.target.value))}
                    suppressHydrationWarning
                  />
                  <span className="ml-auto" />
                  <button type="button" className="grid h-11 w-11 place-items-center" onClick={() => void fullscreen()} aria-label="Pantalla completa">
                    <Maximize size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {!playing && !ended ? (
            <button
              type="button"
              onClick={() => playFrom()}
              className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-copper text-void"
              aria-label="Reproducir documental"
            >
              <Play size={28} />
            </button>
          ) : null}

          {ended ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-void/80 px-6 text-center">
              <p className="font-display text-3xl text-cream sm:text-5xl">Sigue a InodeAi</p>
              <p className="max-w-md text-sm text-muted sm:text-base">
                Quince minutos para ver el mecanismo. El siguiente documental ya está en el canal.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <a href={CHANNEL.href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-full bg-copper px-5 font-semibold text-void">
                  Seguir el canal
                </a>
                <button type="button" onClick={replay} className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-cream">
                  <RotateCcw size={16} />
                  Ver de nuevo
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {resumeAt !== null && time < 1 && !playing ? (
          <button
            type="button"
            onClick={() => {
              const at = resumeAt;
              setResumeAt(null);
              playFrom(at);
            }}
            className="export-hide self-start rounded-full border border-line px-4 py-2 text-sm text-cream"
          >
            Continuar en {fmt(resumeAt)}
          </button>
        ) : null}

        <div className="export-hide">
          <h1 className="font-display text-3xl leading-tight text-cream sm:text-5xl">De la A a la nube</h1>
          <p className="mt-2 text-sm text-muted sm:text-base">
            La historia de Amazon en animación 3D · formato YouTube · {fmt(duration)} · documental independiente
          </p>
        </div>

        <div className="export-hide flex items-center gap-3 rounded-xl bg-panel p-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-copper font-display text-lg text-void">I</div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-cream">{CHANNEL.name}</p>
            <p className="truncate text-sm text-muted">{CHANNEL.tagline}</p>
          </div>
          <a href={CHANNEL.href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-full bg-cream px-4 text-sm font-semibold text-void">
            Seguir
          </a>
        </div>

        <div ref={railRef} className="export-hide flex gap-2 overflow-x-auto pb-1">
          {timeline.chapters.map((item, itemIndex) => {
            const active = itemIndex === index;
            return (
              <button
                key={item.id}
                type="button"
                data-i={itemIndex}
                onClick={() => {
                  seek(item.start);
                  if (!playingRef.current) playFrom(item.start);
                }}
                className={`min-w-40 shrink-0 rounded-xl border px-3 py-3 text-left ${active ? "border-copper bg-ink" : "border-line bg-panel"}`}
              >
                <p className="text-xs text-copper">
                  {fmt(item.start)} · {item.year}
                </p>
                <p className="mt-1 font-display text-lg leading-tight text-cream">{item.title}</p>
              </button>
            );
          })}
        </div>

        <article className="export-hide rounded-xl border border-line bg-ink p-4 sm:p-5">
          <h2 className="font-display text-2xl text-cream">De un garaje a la infraestructura del siglo</h2>
          <p className="mt-3 text-sm leading-relaxed text-cream sm:text-base">
            Bellevue, mil novecientos noventa y cuatro. Una laptop en el asiento del copiloto, una campana que hubo que callar, una carta pidiendo paciencia y una quiebra anunciada que no llegó. Después: Prime, la nube, Kindle, un teléfono muerto al lado de una voz viva, la pandemia, el relevo de Bezos a Jassy, y una tercera máquina hecha de anuncios e inteligencia artificial.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Pulsa play. El escenario 3D cambia con cada capítulo y la narración recorre treinta años en un cuarto de hora. Si un tramo te detiene, salta desde la cinta de capítulos. Al final, el canal sigue abierto.
          </p>
          {noVoice ? (
            <p className="mt-3 text-sm text-copper">Este navegador no tiene voz. El documental sigue, con los textos en pantalla.</p>
          ) : null}
          <p className="mt-4 text-xs text-muted">Documental independiente de InodeAi. No está afiliado a Amazon.</p>
        </article>

        <section className="export-hide">
          <h2 className="font-display text-2xl text-cream">Sigue en InodeAi</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {UP_NEXT.map((item) => (
              <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-panel p-4">
                <p className="text-xs text-glacier">{item.kicker}</p>
                <p className="mt-2 font-display text-xl text-cream">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.note}</p>
              </a>
            ))}
          </div>
        </section>
      </div>

      <p className="sr-only" aria-live="polite">
        {chapter?.kicker}. {chapter?.title}
      </p>
    </main>
  );
}
