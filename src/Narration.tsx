import { tr } from "./i18n";
import { useEffect, useRef, useState } from "react";
import type { Book } from "./types";

function sentenceEnd(text: string, start: number) {
  let end = Math.min(text.length, start + 400);
  const match = /[。！？!?\n]/.exec(text.slice(start, end));
  if (match) end = start + match.index + 1;
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return Math.max(start + 1, end);
}
export function useNarration(book: Book, go: (offset: number) => void, remember: (value: Partial<Book>) => void) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoiceState] = useState(book.narrationVoice || "");
  const [rate, setRateState] = useState(book.narrationRate || 1);
  const [status, setStatus] = useState<"stopped" | "playing" | "paused">("stopped");
  const [error, setError] = useState("");
  const [range, setRange] = useState<{start: number; end: number} | null>(null);
  const [timer, setTimer] = useState("off");
  const token = useRef(0), bookRef = useRef(book), goRef = useRef(go), voiceRef = useRef(voice), rateRef = useRef(rate), timerRef = useRef(timer);
  const currentOffset = useRef(book.offset), deadline = useRef(0), chapterEnd = useRef(Infinity);
  bookRef.current = book; goRef.current = go; voiceRef.current = voice; rateRef.current = rate; timerRef.current = timer;
  useEffect(() => {
    if (!("speechSynthesis" in window)) { setError("此设备不支持语音朗读。"); return; }
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices().filter(v => v.localService).sort((a,b) => Number(b.lang.toLowerCase().startsWith("zh")) - Number(a.lang.toLowerCase().startsWith("zh"))));
    update(); synth.addEventListener("voiceschanged", update);
    return () => { token.current++; synth.cancel(); synth.removeEventListener("voiceschanged", update); };
  }, []);
  useEffect(() => {
    if (status === "stopped" || !deadline.current) return;
    const id = window.setTimeout(() => stop(), Math.max(0, deadline.current - Date.now()));
    return () => window.clearTimeout(id);
  }, [status, timer]);
  function stop() { token.current++; window.speechSynthesis?.cancel(); setStatus("stopped"); setRange(null); }
  function startAt(start: number) {
    if (!("speechSynthesis" in window)) { setError("此设备不支持语音朗读。"); return; }
    const available = window.speechSynthesis.getVoices().filter(v => v.localService);
    if (!available.length) { setError("没有本地声音，请在 Windows 设置中安装语音包。"); return; }
    stop(); setError(""); setStatus("playing"); const gen = token.current;
    deadline.current = /^\d+$/.test(timerRef.current) ? Date.now() + Number(timerRef.current) * 60000 : 0;
    chapterEnd.current = bookRef.current.chapters.find(c => c.offset > start)?.offset ?? Infinity;
    const run = (offset: number) => {
      if (gen !== token.current) return;
      const text = bookRef.current.text;
      while (offset < text.length && /\s/.test(text[offset])) offset++;
      if (offset >= text.length || (deadline.current && Date.now() >= deadline.current) || (timerRef.current === "chapter" && offset >= chapterEnd.current)) { stop(); return; }
      const end = sentenceEnd(text, offset); currentOffset.current = offset;
      const utterance = new SpeechSynthesisUtterance(text.slice(offset, end));
      utterance.voice = available.find(v => v.voiceURI === voiceRef.current) || available.find(v => v.lang.toLowerCase().startsWith("zh")) || available[0];
      utterance.lang = utterance.voice.lang; utterance.rate = rateRef.current;
      utterance.onstart = () => { if (gen === token.current) { setRange({start: offset, end}); goRef.current(offset); } };
      utterance.onend = () => { if (gen === token.current) run(end); };
      utterance.onerror = e => { if (gen === token.current && e.error !== "canceled" && e.error !== "interrupted") { stop(); setError("朗读失败，请尝试其他本地语音。"); } };
      window.speechSynthesis.speak(utterance);
    };
    run(start);
  }
  function start() { startAt(bookRef.current.offset); }
  function skip(dir: number) {
    const text = bookRef.current.text, start = currentOffset.current;
    if (dir > 0) startAt(sentenceEnd(text, start));
    else { const prior = text.slice(0, Math.max(0, start - 1)); const found = Math.max(prior.lastIndexOf("。"), prior.lastIndexOf("！"), prior.lastIndexOf("？"), prior.lastIndexOf("\n"), prior.lastIndexOf("!"), prior.lastIndexOf("?")); startAt(found + 1); }
  }
  function pause() { if (status === "playing") { window.speechSynthesis.pause(); setStatus("paused"); } else if (status === "paused") { window.speechSynthesis.resume(); setStatus("playing"); } }
  function setVoice(v: string) { setVoiceState(v); remember({ narrationVoice: v }); }
  function setRate(v: number) { setRateState(v); remember({ narrationRate: v }); }
  function updateTimer(v: string) { deadline.current = /^\d+$/.test(v) ? Date.now() + Number(v) * 60000 : 0; if (v === "chapter") chapterEnd.current = bookRef.current.chapters.find(c => c.offset > currentOffset.current)?.offset ?? Infinity; setTimer(v); }
  return { voices, voice, setVoice, rate, setRate, status, error, range, timer, setTimer: updateTimer, start, stop, pause, skip };
}
export function VoicePanel({ narration: n }: { narration: ReturnType<typeof useNarration> }) {
  return <div className="service-panel"><p>{"" + tr("跟随当前句子朗读，并自动翻页。定时结束后会停止。") + ""}</p>
    <label>{"" + tr("本地语音") + ""}<select aria-label={tr("朗读声音")} value={n.voice} onChange={e => n.setVoice(e.target.value)}><option value="">{"" + tr("自动选择中文语音") + ""}</option>{n.voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select></label>
    <label>{"" + tr("朗读速度") + " "}{n.rate.toFixed(1)}×<input aria-label={tr("朗读速度")} type="range" min="0.5" max="2" step="0.1" value={n.rate} onChange={e => n.setRate(Number(e.target.value))}/></label>
    <label>{"" + tr("定时关闭") + ""}<select value={n.timer} onChange={e => n.setTimer(e.target.value)}><option value="off">{"" + tr("不定时") + ""}</option><option value="15">{"" + tr("15 分钟") + ""}</option><option value="30">{"" + tr("30 分钟") + ""}</option><option value="60">{"" + tr("60 分钟") + ""}</option><option value="chapter">{"" + tr("当前章节结束") + ""}</option></select></label>
    <div className="service-actions"><button className="service-primary" onClick={n.start}>{"" + tr("开始朗读") + ""}</button><button disabled={n.status === "stopped"} onClick={n.pause}>{n.status === "paused" ? tr("继续") : tr("暂停")}</button><button disabled={n.status === "stopped"} onClick={n.stop}>{"" + tr("停止") + ""}</button><button onClick={() => n.skip(-1)}>{"" + tr("上一句") + ""}</button><button onClick={() => n.skip(1)}>{"" + tr("下一句") + ""}</button></div>
    <p role="status">{n.error || (n.status === "playing" ? tr("正在朗读") : n.status === "paused" ? tr("已暂停") : n.voices.length ? tr("就绪 · 本地语音") : tr("正在查找本地语音…"))}</p>
  </div>;
}
