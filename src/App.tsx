import { useRef, useState, useEffect, useCallback } from "react";

const NOTES: Record<string, number> = {
  c: 261.63,
  "c#": 277.18,
  d: 293.66,
  "d#": 311.13,
  e: 329.63,
  f: 349.23,
  "f#": 369.99,
  g: 392.0,
  "g#": 415.3,
  a: 440.0,
  "a#": 466.16,
  b: 493.88,
};

type Waveform = "sine" | "square" | "sawtooth" | "triangle" | "noise";
const WAVEFORMS: Waveform[] = [
  "sine",
  "square",
  "sawtooth",
  "triangle",
  "noise",
];

const DEFAULT_TUNE = "cdefgab+c";
const DEFAULT_BPM = 666;
const RAMP = 0.0005;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ramp = (node: GainNode, ctx: AudioContext, value: number) =>
  node.gain.setTargetAtTime(value, ctx.currentTime, RAMP);

interface Audio {
  ctx: AudioContext;
  osc: OscillatorNode;
  oscGain: GainNode;
  noiseGain: GainNode;
  gain: GainNode;
  dest: MediaStreamAudioDestinationNode;
}

function setupAudio(): Audio {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  const noise = ctx.createBufferSource();
  const noiseGain = ctx.createGain();
  const gain = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buffer;
  noise.loop = true;

  osc.connect(oscGain).connect(gain);
  noise.connect(noiseGain).connect(gain);
  gain.connect(ctx.destination);
  gain.connect(dest);

  oscGain.gain.value = 1;
  noiseGain.gain.value = 0;
  gain.gain.value = 0;

  osc.start();
  noise.start();

  return { ctx, osc, oscGain, noiseGain, gain, dest };
}

function setWaveform(a: Audio, wave: Waveform) {
  if (wave === "noise") {
    ramp(a.oscGain, a.ctx, 0);
    ramp(a.noiseGain, a.ctx, 1);
  } else {
    a.osc.type = wave;
    ramp(a.oscGain, a.ctx, 1);
    ramp(a.noiseGain, a.ctx, 0);
  }
}

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const tuneRef = useRef<HTMLTextAreaElement>(null);
  const bpmRef = useRef<HTMLInputElement>(null);
  const waveRef = useRef<HTMLSelectElement>(null);
  const audioRef = useRef<Audio | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const playIdRef = useRef(0);

  useEffect(() => {
    const a = setupAudio();
    audioRef.current = a;
    return () => {
      a.ctx.close();
    };
  }, []);

  const stop = useCallback(() => {
    playIdRef.current++;
    const a = audioRef.current;
    if (a) ramp(a.gain, a.ctx, 0);
    setIsPlaying(false);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const play = useCallback(async () => {
    const a = audioRef.current;
    const tune = tuneRef.current?.value;
    if (!a || !tune) return;

    const bpm = Number(bpmRef.current?.value ?? DEFAULT_BPM);
    const wave = (waveRef.current?.value as Waveform) || "sine";
    const playId = ++playIdRef.current;
    const current = () => playIdRef.current === playId;

    if (a.ctx.state === "suspended") await a.ctx.resume();
    setWaveform(a, wave);
    ramp(a.gain, a.ctx, 1);
    setIsPlaying(true);

    let speed = 60000 / Math.max(bpm || 0, 1);
    let octave = 1;

    for (let i = 0; i < tune.length && current(); i++) {
      const c = tune[i];
      if ("01234".includes(c)) setWaveform(a, WAVEFORMS[Number(c)]);
      else if (c === "+") octave *= 2;
      else if (c === "-") octave /= 2;
      else if (c === ">") speed /= 2;
      else if (c === "<") speed *= 2;
      else if (c === ".") {
        ramp(a.gain, a.ctx, 0);
        await sleep(speed);
        if (current()) ramp(a.gain, a.ctx, 1);
      } else if (c === ",") {
        await sleep(speed);
      } else {
        const sharp = tune[i + 1] === "#";
        const freq = NOTES[sharp ? c + "#" : c];
        if (freq) {
          a.osc.frequency.setTargetAtTime(
            freq * octave,
            a.ctx.currentTime,
            RAMP,
          );
          await sleep(speed);
        }
        if (sharp) i++;
      }
    }

    if (current()) stop();
  }, [stop]);

  const toggle = () => (isPlaying ? stop() : play());

  const record = useCallback(async () => {
    const a = audioRef.current;
    if (isRecording || isPlaying || !a || typeof MediaRecorder === "undefined")
      return;

    const recorder = new MediaRecorder(a.dest.stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) =>
      e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm";
      const ext = type.split("/")[1]?.split(";")[0] || "webm";
      const url = URL.createObjectURL(new Blob(chunksRef.current, { type }));
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: `tune.${ext}`,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setIsRecording(false);
    };

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    await play();
  }, [isRecording, isPlaying, play]);

  return (
    <div className="grid place-items-center h-screen w-screen">
      <div className="bg-white border-4 text-xl">
        <div className="bg-black px-2 text-white">Beep</div>
        <div className="flex justify-between m-2">
          <div className="border-2 w-50 p-2 h-64">
            <textarea
              className="border-2 px-2"
              spellCheck={false}
              ref={tuneRef}
              rows={4}
              cols={13}
              defaultValue={DEFAULT_TUNE}
            />
            <br />
            Wave:
            <select className="border-2 mb-1" ref={waveRef} defaultValue="sine">
              {WAVEFORMS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <br />
            BPM:
            <input
              ref={bpmRef}
              min={1}
              defaultValue={DEFAULT_BPM}
              type="number"
              style={{ width: "3em" }}
              className="border-2 mb-5"
            />
            <br />
            <button
              className="bg-black text-white pl-2 pr-2"
              onClick={toggle}
              disabled={isRecording}
            >
              {isPlaying ? "stop" : "start"}
            </button>
            <button
              className="bg-black text-white pl-2 pr-2 ml-2 disabled:opacity-50"
              onClick={record}
              disabled={isPlaying || isRecording}
            >
              {isRecording ? "wait..." : "record"}
            </button>
          </div>
          <div className="p-2 ml-2 border-2 w-50 h-64 overflow-auto">
            Instructions:
            <br />
            <pre className="mt-2 text-xs whitespace-pre-wrap">
              {"Notes: c d e f g a b, add # for sharp\n\n" +
                "+ / - : octave up / down\n" +
                "> / < : speed up / down\n" +
                "0-4   : change waveform\n" +
                ",     : repeat note\n" +
                ".     : rest\n\n" +
                'Click "record" to save as a file.\n'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
