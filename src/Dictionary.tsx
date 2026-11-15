import { tr } from "./i18n";
import { useEffect, useState } from "react";
import { get, put } from "./db";
type Entry = { word: string; meaning: string };
export function Dictionary({ initial }: { initial: string }) {
  const [query, setQuery] = useState(initial), [entries, setEntries] = useState<Entry[]>([]), [message, setMessage] = useState("");
  const [builtIn, setBuiltIn] = useState<Record<string, string>>({});
  useEffect(() => { void get<Entry[]>("offline-dictionary").then(v => setEntries(v || [])).catch(() => setMessage("读取词典失败。")); }, []);
  useEffect(() => { let active = true; void fetch("/dictionary/ecdict-common.json").then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => { if (active) setBuiltIn(data); }).catch(() => { if (active) setMessage("读取内置词典失败，仍可导入词典。"); }); return () => { active = false; }; }, []);
  async function importDictionary(file: File) {
    try {
      if (file.size > 10 * 1024 * 1024) throw Error("词典文件不能超过 10 MB");
      const text = await file.text(); let next: Entry[];
      if (/\.json$/i.test(file.name)) {
        const v: unknown = JSON.parse(text);
        if (Array.isArray(v)) next = v.map(item => ({ word: String(item.word || "").trim(), meaning: String(item.meaning || "").trim() }));
        else if (v && typeof v === "object") next = Object.entries(v).map(([word, meaning]) => ({ word: word.trim(), meaning: String(meaning).trim() }));
        else throw Error("JSON 需要词条对象或 word/meaning 数组");
      } else next = text.split(/\r?\n/).map(line => { const tab = line.indexOf("\t"); return tab < 0 ? {word:"", meaning:""} : {word:line.slice(0,tab).trim(), meaning:line.slice(tab+1).trim()}; });
      next = next.filter(e => e.word && e.meaning);
      if (!next.length) throw Error("没有有效词条，请使用词语和释义以制表符分隔的 TSV 文件");
      if (next.length > 100000) throw Error("词典最多支持 10 万条词目");
      await put("offline-dictionary", next); setEntries(next); setMessage(`已导入 ${next.length} 条词目。`);
    } catch (e) { setMessage("导入失败：" + String(e)); }
  }
  const key = query.trim().toLocaleLowerCase();
  const results = key ? entries.filter(e => e.word.toLocaleLowerCase() === key).slice(0,20) : [];
  const builtInMeaning = Object.hasOwn(builtIn, key) ? builtIn[key] : undefined;
  return <div className="service-panel"><p>{"" + tr("内置常用英汉词典，可离线查询；也支持导入 TSV 或 JSON 词典。") + ""}</p><input aria-label={tr("查询词语")} value={query} onChange={e => setQuery(e.target.value)} placeholder={tr("输入词语")}/><label>{"" + tr("导入词典") + ""}<input type="file" accept=".tsv,.txt,.json" onChange={e => { const file=e.target.files?.[0]; if(file) void importDictionary(file); e.target.value=""; }}/></label><p>{message || `自定义词典 ${entries.length} 条 · 内置英汉 ${Object.keys(builtIn).length} 条。`}</p>{results.map((e,i)=><div className="dictionary-entry" key={i}><b>{e.word}</b><p>{e.meaning}</p></div>)}{builtInMeaning && <div className="dictionary-entry"><b>{query.trim()}</b><p>{builtInMeaning}</p><small>{"" + tr("ECDICT · 常用英汉词条") + ""}</small></div>}{key && !results.length && !builtInMeaning && <p>{"" + tr("没有找到该词条。") + ""}</p>}</div>;
}
