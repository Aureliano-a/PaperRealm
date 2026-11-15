import { tr } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { joinedTranslation, translateAligned, type AlignedPair } from "./translationAlignment";
import type { Book } from "./types";

export function useNarration(book: Book, go: (offset: number) => void) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [voice, setVoice] = useState(""),
    [rate, setRate] = useState(1);
  const [status, setStatus] = useState<"stopped" | "playing" | "paused">(
      "stopped",
    ),
    [error, setError] = useState("");
  const generation = useRef(0),
    goRef = useRef(go),
    bookRef = useRef(book),
    voiceRef = useRef(voice),
    rateRef = useRef(rate);
  goRef.current = go;
  bookRef.current = book;
  voiceRef.current = voice;
  rateRef.current = rate;
  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setError("此设备不支持语音朗读。");
      return;
    }
    const synth = window.speechSynthesis;
    const update = () =>
      setVoices(
        synth
          .getVoices()
          .filter((v) => v.localService)
          .sort(
            (a, b) =>
              Number(b.lang.toLowerCase().startsWith("zh")) -
              Number(a.lang.toLowerCase().startsWith("zh")),
          ),
      );
    update();
    synth.addEventListener("voiceschanged", update);
    return () => {
      generation.current++;
      synth.cancel();
      synth.removeEventListener("voiceschanged", update);
    };
  }, []);
  function stop() {
    generation.current++;
    window.speechSynthesis?.cancel();
    setStatus("stopped");
  }
  function start() {
    if (!("speechSynthesis" in window)) {
      setError("此设备不支持语音朗读。");
      return;
    }
    const available = window.speechSynthesis
      .getVoices()
      .filter((v) => v.localService);
    if (!available.length) {
      setError("没有可用的本地语音，请在 Windows 设置中安装语音包后重启应用。");
      return;
    }
    stop();
    setError("");
    setStatus("playing");
    const gen = generation.current;
    const run = (offset: number) => {
      if (gen !== generation.current) return;
      const text = bookRef.current.text;
      if (offset >= text.length) {
        setStatus("stopped");
        return;
      }
      let end = Math.min(text.length, offset + 450);
      if (end < text.length) {
        const split = Math.max(
          text.lastIndexOf("。", end),
          text.lastIndexOf("！", end),
          text.lastIndexOf("？", end),
          text.lastIndexOf("\n", end),
        );
        if (split > offset + 120) end = split + 1;
        if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      }
      const u = new SpeechSynthesisUtterance(text.slice(offset, end));
      u.voice =
        available.find((v) => v.voiceURI === voiceRef.current) ||
        available.find((v) => v.lang.toLowerCase().startsWith("zh")) ||
        available[0];
      u.lang = u.voice.lang;
      u.rate = rateRef.current;
      u.onstart = () => {
        if (gen === generation.current) goRef.current(offset);
      };
      u.onend = () => {
        if (gen === generation.current) run(end);
      };
      u.onerror = (e) => {
        if (
          gen === generation.current &&
          e.error !== "canceled" &&
          e.error !== "interrupted"
        ) {
          setStatus("stopped");
          setError("朗读失败，请尝试其他本地语音。");
        }
      };
      window.speechSynthesis.speak(u);
    };
    run(bookRef.current.offset);
  }
  function pause() {
    if (status === "playing") {
      window.speechSynthesis.pause();
      setStatus("paused");
    } else if (status === "paused") {
      window.speechSynthesis.resume();
      setStatus("playing");
    }
  }
  return {
    voices,
    voice,
    setVoice,
    rate,
    setRate,
    status,
    error,
    start,
    stop,
    pause,
  };
}

type Narration = ReturnType<typeof useNarration>;
export function VoicePanel({ narration }: { narration: Narration }) {
  const n = narration;
  return (
    <div className="service-panel">
      <p>{"" + tr("从当前阅读位置开始朗读，自动继续后文。退出阅读时停止。") + ""}</p>
      <label>
        {"" + tr("本地语音") + " "}<select
          aria-label={tr("朗读声音")}
          value={n.voice}
          onChange={(e) => n.setVoice(e.target.value)}
        >
          <option value="">{"" + tr("自动选择中文语音") + ""}</option>
          {n.voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} · {v.lang}
            </option>
          ))}
        </select>
      </label>
      <label>
        {"" + tr("朗读速度") + " "}<b>{n.rate.toFixed(1)}×</b>
        <input
          aria-label={tr("朗读速度")}
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={n.rate}
          onChange={(e) => n.setRate(Number(e.target.value))}
        />
      </label>
      <div className="service-actions">
        <button className="service-primary" onClick={n.start}>
          {"" + tr("从当前位置朗读") + " "}</button>
        <button disabled={n.status === "stopped"} onClick={n.pause}>
          {n.status === "paused" ? tr("继续") : tr("暂停")}
        </button>
        <button disabled={n.status === "stopped"} onClick={n.stop}>
          {"" + tr("停止") + " "}</button>
      </div>
      <p role="status">
        {n.error ||
          (n.status === "playing"
            ? tr("正在朗读")
            : n.status === "paused"
              ? tr("已暂停")
              : n.voices.length
                ? tr("就绪 · 使用系统本地语音")
                : tr("正在查找本地语音…"))}
      </p>
    </div>
  );
}

export function TranslationPanel({
  initial,
  wholePage,
  apiKey,
  setApiKey,
  settings,
  onApply,
  onClear,
  onStartAuto,
}: {
  initial: string;
  wholePage: string;
  apiKey: string;
  setApiKey: (s: string) => void;
  settings: { base: string; target: string; auto: boolean };
  onApply: (s: string, settings: { base: string; target: string; auto: boolean }, fullPage: boolean, aligned?: AlignedPair[]) => void;
  onClear: () => void;
  onStartAuto: (settings: { base: string; target: string; auto: boolean }) => void;
}) {
  const [base, setBase] = useState(settings.base),
    [target, setTarget] = useState(settings.target),
    [auto, setAuto] = useState(settings.auto);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function translate() {
    if (!apiKey.trim()) {
      setError("请填写 DeepSeek API 密钥。");
      return;
    }
    const text = auto ? wholePage : initial;
    if (!text.trim() || Array.from(text).length > 6000) {
      setError("请输入 1 至 6000 个字符。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!isTauri()) throw Error("请在桌面程序中使用在线翻译。");
      const fullPage = auto || initial === wholePage;
      const aligned = fullPage ? await translateAligned(base, apiKey, target, text) : undefined;
      const value = aligned ? joinedTranslation(aligned) : await invoke<string>("translate_text", {
        baseUrl: base,
        apiKey,
        model: "DeepSeek-V4.1-Flash-1017",
        target,
        text,
      });
      onApply(value, { base, target, auto }, auto, aligned);
    } catch (e) {
      setError(String(e).replaceAll(apiKey, "[密钥]"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="service-panel">
      <p>{"" + tr("译文直接显示在正文。开启自动翻译后，翻页时会发送新页面文字，可能产生 API 费用。") + ""}</p>
      <label>
        {"" + tr("API 地址") + " "}<input
          aria-label={tr("API 地址")}
          value={base}
          onChange={(e) => setBase(e.target.value)}
        />
      </label>
      <label>
        {"" + tr("API 密钥") + " "}<input
          aria-label={tr("API 密钥")}
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={tr("输入你的 DeepSeek 密钥")}
        />
      </label>
      <small>{"" + tr("密钥只在当前阅读窗口保留，不写入书库或备份。") + ""}</small>
      <label>{"" + tr("翻译模型") + " "}<b>DeepSeek-V4.1-Flash-1017</b></label>
      <small>{"" + tr("请求模型名称为 DeepSeek-V4.1-Flash-1017，服务接口需要支持此标识。") + ""}</small>
      <label>
        {"" + tr("目标语言") + " "}<select
          aria-label={tr("目标语言")}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {[
            "简体中文",
            "繁体中文",
            "英文",
            "日文",
            "韩文",
            "法文",
            "德文",
            "西班牙文",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="translation-auto-choice"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />{"" + tr("翻页时自动翻译") + ""}</label>
      <p>{"" + tr("待翻译：") + ""}{Array.from(auto ? wholePage : initial).length} {" " + tr("字") + ""}{auto && initial !== wholePage ? tr(" · 自动模式翻译当前整页") : ""}</p>
      <button
        className="service-primary"
        disabled={busy}
        onClick={() => void translate()}
      >
        {busy ? tr("正在翻译…") : tr("翻译并显示在正文")}
      </button>
      <button disabled={busy} onClick={() => { if (!apiKey.trim()) { setError("请填写 DeepSeek API 密钥。"); return; } onStartAuto({ base, target, auto: true }); }}>{"" + tr("直接开启翻页自动翻译") + ""}</button>
      {error && (
        <p role="alert" className="service-error">
          {error}
        </p>
      )}
      <button onClick={onClear}>{"" + tr("清除本书当前语言的译文与手动修正") + ""}</button>
    </div>
  );
}
