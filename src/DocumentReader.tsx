import { readBinarySource } from "./binarySource";
import { useEffect, useRef, useState } from 'react';
import type { Book } from './types';
import { useStore } from './store';
import { saveFile } from './export';
import './document-reader.css';

export default function DocumentReader({ book, onBack }: { book: Book; onBack: () => void }) {
  const mount = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), pdfContainer = useRef<HTMLDivElement>(null), pdfTextLayer = useRef<HTMLDivElement>(null), pdfPageBox = useRef<HTMLDivElement>(null);
  const epubRef = useRef<any>(null), pdfRef = useRef<any>(null);
  const epubBookRef = useRef<any>(null), searchGeneration = useRef(0);
  const patch = useStore(s => s.patch);
  const [error,setError] = useState(''), [ready,setReady] = useState(false), [page,setPage] = useState(Math.max(1, Number(book.documentLocation) || 1));
  const [total,setTotal] = useState(0), [scale,setScale] = useState(Math.max(.1, Math.min(3, book.documentScale || 1))), [rotation,setRotation] = useState(book.documentRotation || 0), [toc,setToc] = useState<{label:string;href:string}[]>([]), [showToc,setShowToc] = useState(false);
  const [fitMode,setFitMode] = useState<'manual'|'width'|'page'>(book.documentFit || 'manual');
  const [query,setQuery] = useState(''), [searching,setSearching] = useState(false), [results,setResults] = useState<{page:number;text:string}[]>([]), [notice,setNotice] = useState('');
  const [epubResults,setEpubResults] = useState<{cfi:string;excerpt:string}[]>([]), [showEpubSearch,setShowEpubSearch] = useState(false);
  const [fontSize,setFontSize] = useState(book.documentFontSize || 100), [brightness,setBrightness] = useState(book.readingPrefs?.readerBrightness ?? 100);
  const [showBookmarks,setShowBookmarks] = useState(false);
  const [selection,setSelection] = useState<{location:string;text:string}|null>(null), [showNotes,setShowNotes] = useState(false);
  const [noteDraft,setNoteDraft] = useState(''), [editingNote,setEditingNote] = useState('');
  const [pdfOutline,setPdfOutline] = useState<{label:string;destination:any}[]>([]), [showOutline,setShowOutline] = useState(false);
  const [extracted,setExtracted] = useState(''), [showText,setShowText] = useState(false);
  useEffect(() => {
    let cancelled = false, epub: any, pdf: any;
    void (async () => {
      try {
        const data = await readBinarySource(book.id);
        if (book.format === 'epub') {
          const { default: ePub } = await import('epubjs');
          epub = ePub(data.buffer as ArrayBuffer); await epub.ready;
          epubBookRef.current = epub;
          if (cancelled || !mount.current) { epub.destroy(); return; }
          const rendition = epub.renderTo(mount.current, { width:'100%', height:'100%', allowScriptedContent:false, allowPopups:false });
          epubRef.current = rendition;
          rendition.themes.fontSize(`${book.documentFontSize || 100}%`);
          const nav = await epub.loaded.navigation;
          setToc(nav.toc.map((item: {label:string; href:string}) => ({ label:item.label, href:item.href })));
          rendition.on('relocated', (location: any) => { const cfi = location?.start?.cfi; if (cfi) void patch(book.id, { documentLocation:cfi }); });
          rendition.on('selected', (cfi:string, contents:any) => { const text=contents.window?.getSelection()?.toString().trim(); if (text) setSelection({location:cfi,text}); });
          await rendition.display(book.documentLocation || undefined);
        } else {
          const { default: pdfjs } = await import('./pdfEngine');
          pdf = await pdfjs.getDocument({ data }).promise;
          if (cancelled) { await pdf.destroy(); return; }
          pdfRef.current = pdf; setTotal(pdf.numPages); setPage(Math.min(pdf.numPages, Math.max(1, Number(book.documentLocation) || 1)));
          const outline = await pdf.getOutline();
          const flat: {label:string;destination:any}[] = [];
          const walk = (items:any[], depth:number) => { for (const item of items) { if (item.dest) flat.push({label:'　'.repeat(depth)+(item.title || '未命名'),destination:item.dest}); if (item.items) walk(item.items,depth+1); } };
          walk(outline || [],0); if (!cancelled) setPdfOutline(flat);
        }
        if (!cancelled) setReady(true);
      } catch (e) { if (!cancelled) setError('无法打开文件：' + String(e)); }
    })();
    return () => { cancelled = true; searchGeneration.current++; window.speechSynthesis?.cancel(); epubBookRef.current = null; epubRef.current = null; pdfRef.current = null; if (epub) epub.destroy(); if (pdf) void pdf.destroy(); };
  }, [book.id]);
  useEffect(() => {
    if (!ready || !pdfRef.current || !canvas.current) return;
    let active = true, render: any, textLayer: any;
    void (async () => { try {
      const pdfPage = await pdfRef.current.getPage(page); if (!active || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale:scale * (window.devicePixelRatio || 1), rotation: (pdfPage.rotate + rotation) % 360 });
      const node = canvas.current; node.width = viewport.width; node.height = viewport.height;
      node.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
      render = pdfPage.render({ canvasContext:node.getContext('2d')!, viewport }); await render.promise;
      const box = pdfPageBox.current, layer = pdfTextLayer.current;
      if (active && box && layer) {
        const view = pdfPage.getViewport({scale,rotation:(pdfPage.rotate+rotation)%360});
        box.style.width = `${view.width}px`; box.style.height = `${view.height}px`;
        box.style.setProperty('--scale-factor', String(scale));
        layer.replaceChildren();
        const { default: pdfjs } = await import('./pdfEngine');
        if (!active) return;
        textLayer = new pdfjs.TextLayer({textContentSource:pdfPage.streamTextContent(),container:layer,viewport:view});
        await textLayer.render();
      }
      if (active) void patch(book.id, { documentLocation:String(page) });
    } catch (e) { if (active && (e as Error).name !== 'RenderingCancelledException') setError('页面渲染失败：' + String(e)); } })();
    return () => { active = false; render?.cancel(); textLayer?.cancel(); };
  }, [ready,page,scale,rotation,book.id]);
  const turn = (dir:number) => { if (book.format === 'epub') void (dir > 0 ? epubRef.current?.next() : epubRef.current?.prev()); else setPage(p => Math.max(1, Math.min(total,p+dir))); };
  async function searchPdf() {
    if (!query.trim() || !pdfRef.current || searching) return;
    const pdf = pdfRef.current, matches: {page:number;text:string}[] = []; let foundText = false;
    setSearching(true); setResults([]); setNotice('正在搜索…');
    try {
      for (let i=1; i<=pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        const text = content.items.map((item: any) => item.str || '').join(' ');
        if (text.trim()) foundText = true;
        const at = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
        if (at >= 0) matches.push({page:i,text:text.slice(Math.max(0,at-35),at+query.length+55)});
        if (matches.length >= 100) break;
      }
      setResults(matches); setNotice(!foundText ? '此文件没有可提取的文字，扫描件需要 OCR。' : matches.length ? `找到 ${matches.length} 个页面` : '没有找到结果');
    } catch (e) { setNotice('搜索失败：' + String(e)); } finally { setSearching(false); }
  }
  async function searchEpub() {
    const epub=epubBookRef.current, term=query.trim(); if (!epub || !term || searching) return;
    const generation=++searchGeneration.current, found:{cfi:string;excerpt:string}[]=[];
    setSearching(true); setEpubResults([]); setNotice('正在搜索…');
    try {
      for (const section of epub.spine.spineItems) {
        if (searchGeneration.current !== generation) return;
        const wasLoaded=!!section.contents;
        try { await section.load(epub.load.bind(epub)); found.push(...section.find(term).slice(0,100-found.length)); }
        finally { if (!wasLoaded) section.unload(); }
        if (found.length >= 100) break;
      }
      if (searchGeneration.current === generation) { setEpubResults(found); setNotice(found.length ? `找到 ${found.length}${found.length === 100 ? '（最多显示 100 条）' : ''} 条结果` : '没有找到结果'); }
    } catch(e) { if (searchGeneration.current === generation) setNotice('搜索失败：'+String(e)); }
    finally { if (searchGeneration.current === generation) setSearching(false); }
  }
  function changeFont(next:number) { const size=Math.max(70,Math.min(200,next)); setFontSize(size); epubRef.current?.themes.fontSize(`${size}%`); void patch(book.id,{documentFontSize:size}); }
  function changeScale(next:number) { const value=Math.max(.1,Math.min(3,Math.round(next*100)/100)); setFitMode('manual'); setScale(value); void patch(book.id,{documentScale:value,documentFit:'manual'}); }
  function fitPdf(mode:'width'|'page') { setFitMode(mode); void patch(book.id,{documentFit:mode}); }
  useEffect(() => {
    if (!ready || fitMode === 'manual' || !pdfContainer.current || !pdfRef.current) return;
    const container=pdfContainer.current; let disposed=false, generation=0;
    const update=async () => { const current=++generation; try { const pdfPage=await pdfRef.current?.getPage(page); if (!pdfPage || disposed || current!==generation) return; const viewport=pdfPage.getViewport({scale:1,rotation:(pdfPage.rotate+rotation)%360}); const width=Math.max(1,container.clientWidth-40)/viewport.width, height=Math.max(1,container.clientHeight-40)/viewport.height; const value=Math.max(.1,Math.min(3,Math.floor((fitMode==='width'?width:Math.min(width,height))*100)/100)); setScale(value); } catch(e) { if (!disposed) setError('无法调整页面大小：'+String(e)); } };
    const observer=new ResizeObserver(()=>void update()); observer.observe(container); void update();
    return () => { disposed=true; generation++; observer.disconnect(); };
  },[ready,fitMode,page,rotation,book.id]);
  function rotatePdf() { const value=(rotation+90)%360; setRotation(value); void patch(book.id,{documentRotation:value}); }
  function toggleBookmark() {
    const location = book.format === 'pdf' ? String(page) : book.documentLocation;
    if (!location) { setNotice('当前位置尚未准备好'); return; }
    const existing = book.documentBookmarks || [];
    const bookmarks = existing.some(b=>b.location===location) ? existing.filter(b=>b.location!==location) : [...existing,{location,label:book.format === 'pdf' ? `第 ${page} 页` : `书签 ${existing.length+1}`}];
    void patch(book.id,{documentBookmarks:bookmarks});
  }
  function openBookmark(location:string) { if (book.format === 'pdf') setPage(Math.max(1,Math.min(total,Number(location)||1))); else void epubRef.current?.display(location); setShowBookmarks(false); }
  async function openOutline(destination:any) { try { const pdf=pdfRef.current; const dest=typeof destination==='string' ? await pdf.getDestination(destination) : destination; if (!dest) throw Error('目录位置不存在'); const index=typeof dest[0]==='number' ? dest[0] : await pdf.getPageIndex(dest[0]); setPage(index+1); setShowOutline(false); } catch(e) { setError('无法跳转目录：'+String(e)); } }
  async function saveSelection() { if (!selection) return; const note={id:crypto.randomUUID(),location:selection.location,text:selection.text,note:noteDraft}; if (!(await patch(book.id,current=>({documentNotes:[...(current.documentNotes || []),note]})))) { setNotice('保存失败，请检查磁盘空间后重试。'); return; } setNoteDraft(''); setSelection(null); setShowNotes(true); }
  async function updateNote() { if (!(await patch(book.id,current=>({documentNotes:(current.documentNotes || []).map(item=>item.id===editingNote ? {...item,note:noteDraft} : item)})))) { setNotice('保存失败，请检查磁盘空间后重试。'); return; } setEditingNote(''); setNoteDraft(''); }
  async function exportNotes() { try { const notes=useStore.getState().books.find(b=>b.id===book.id)?.documentNotes || []; const text='# '+book.title+'\n\n'+notes.map(item=>`## ${book.format==='pdf' ? '第 '+item.location+' 页' : '书内位置：'+item.location}\n\n${item.text}\n\n批注：${item.note || '无'}\n`).join('\n'); await saveFile(book.title.replace(/[\\/:*?"<>|]/g,'_')+'-摘录.md',text); } catch(e) { setError('导出失败：'+String(e)); } }
  async function getCurrentText() {
    if (book.format === 'pdf') {
      const p = await pdfRef.current?.getPage(page); if (!p) throw Error('页面尚未准备好');
      const content = await p.getTextContent();
      return content.items.map((item: any) => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trim();
    }
    const contents = epubRef.current?.getContents() || [];
    return contents.map((c: any) => c.document?.body?.innerText || c.document?.body?.textContent || '').join('\n').trim();
  }
  async function showCurrentText(readAloud = false) {
    try {
      const text = await getCurrentText();
      if (!text) { setError('当前页面没有可提取的文字；扫描版 PDF 需要 OCR。'); return; }
      setError(''); setExtracted(text); setShowText(true);
      if (readAloud) { if (!window.speechSynthesis) throw Error('设备不支持语音朗读'); window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 5000))); }
    } catch (e) { setError('读取文字失败：' + String(e)); }
  }
  useEffect(() => { const handle = (e:KeyboardEvent) => { if ((e.target as HTMLElement).matches('input,select,textarea')) return; if (e.key === 'ArrowLeft') turn(-1); if (e.key === 'ArrowRight') turn(1); }; window.addEventListener('keydown',handle); return () => window.removeEventListener('keydown',handle); });
  return <div className="document-reader"><header><button onClick={onBack}>返回书库</button><strong>{book.title}</strong><button disabled={!ready} onClick={toggleBookmark}>添加／移除书签</button><button onClick={()=>setShowBookmarks(v=>!v)}>书签列表</button>{book.format === 'epub' && <><button onClick={() => setShowToc(v=>!v)}>目录</button><button onClick={() => changeFont(fontSize-10)}>字号−</button><span>{fontSize}%</span><button onClick={() => changeFont(fontSize+10)}>字号+</button></>}{book.format === 'pdf' && <><button onClick={() => setShowToc(v=>!v)}>搜索</button><button onClick={() => changeScale(scale-.1)}>缩小</button><span>{Math.round(scale*100)}%</span><button onClick={() => changeScale(scale+.1)}>放大</button></>}<label>亮度 <input type="range" min="30" max="100" value={brightness} onChange={e=>{const value=Number(e.target.value);setBrightness(value);void patch(book.id,{readingPrefs:{...book.readingPrefs,readerBrightness:value}});}} /></label></header>
    {showBookmarks && <nav className="document-bookmarks">{book.documentBookmarks?.length ? book.documentBookmarks.map(item=><button key={item.location} onClick={()=>openBookmark(item.location)}>{item.label}</button>) : <span>暂无书签</span>}</nav>}
    {selection && <div className="document-bookmarks"><p>{selection.text}</p><textarea aria-label="批注内容" placeholder="添加批注（可留空）" value={noteDraft} onChange={e=>setNoteDraft(e.target.value)}/><button onClick={()=>void saveSelection()}>保存摘录与批注</button><button onClick={()=>{setSelection(null);setNoteDraft('');}}>取消</button></div>}
    {editingNote && <aside className="document-bookmarks"><textarea aria-label="修改批注" value={noteDraft} onChange={e=>setNoteDraft(e.target.value)}/><button onClick={()=>void updateNote()}>保存修改</button><button onClick={()=>{setEditingNote('');setNoteDraft('');}}>取消修改</button></aside>}
    {showNotes && !editingNote && <nav className="document-bookmarks"><button onClick={()=>setShowNotes(false)}>关闭摘录</button><button disabled={!book.documentNotes?.length} onClick={()=>void exportNotes()}>导出摘录 Markdown</button>{book.documentNotes?.length ? book.documentNotes.map(item=><div key={item.id}><button onClick={()=>{if(book.format==='pdf') setPage(Math.max(1,Math.min(total,Number(item.location)||1))); else void epubRef.current?.display(item.location);setShowNotes(false);}}>{book.format==='pdf' && `第 ${item.location} 页 · `}{item.text} {item.note && `· ${item.note}`}</button><button onClick={()=>{setNoteDraft(item.note);setEditingNote(item.id);}}>编辑批注</button><button onClick={()=>void patch(book.id,{documentNotes:(book.documentNotes || []).filter(n=>n.id!==item.id)})}>删除</button></div>) : <span>暂无摘录</span>}</nav>}
    {showOutline && <nav className="document-bookmarks"><button onClick={()=>setShowOutline(false)}>关闭目录</button>{pdfOutline.length ? pdfOutline.map((item,i)=><button key={i} onClick={()=>void openOutline(item.destination)}>{item.label}</button>) : <span>此 PDF 没有目录</span>}</nav>}
    {showEpubSearch && <nav className="document-bookmarks"><button onClick={()=>{searchGeneration.current++;setSearching(false);setShowEpubSearch(false);}}>关闭搜索</button><input value={query} placeholder="搜索全书" onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void searchEpub();}}/><button disabled={searching} onClick={()=>void searchEpub()}>{searching?'搜索中…':'搜索全书'}</button><p>{notice}</p>{epubResults.map((r,i)=><button key={i} onClick={()=>{void epubRef.current?.display(r.cfi);setShowEpubSearch(false);}}>{r.excerpt}</button>)}</nav>}
    {showText && <aside className="document-bookmarks"><button onClick={()=>setShowText(false)}>关闭文字面板</button>{book.format==='pdf' && <p>在下方文字中选择内容，可保存摘录和批注。</p>}<p onMouseUp={()=>{if(book.format!=='pdf') return; const selected=window.getSelection()?.toString().trim(); if(selected){setSelection({location:String(page),text:selected});setShowText(false);}}} style={{whiteSpace:'pre-wrap',maxWidth:400,userSelect:'text'}}>{extracted}</p></aside>}
    {error && <div role="alert" className="document-error">{error}</div>}
    {!ready && !error && <div className="document-error">正在打开书籍…</div>}
    {book.format === 'epub' ? <div className="document-epub-layout">{showToc && <nav className="document-toc">{toc.length ? toc.map((item,i)=><button key={i} onClick={() => { void epubRef.current?.display(item.href); setShowToc(false); }}>{item.label}</button>) : '没有目录'}</nav>}<div className="document-epub" style={{filter:`brightness(${brightness}%)`}} ref={mount}/></div> : <div className="document-epub-layout">{showToc && <nav className="document-toc"><input value={query} placeholder="搜索 PDF 文字" onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void searchPdf();}}/><button disabled={searching} onClick={()=>void searchPdf()}>{searching?'搜索中…':'搜索全文'}</button><p>{notice}</p>{results.map(r=><button key={r.page} onClick={()=>{setPage(r.page);setShowToc(false);}}>第 {r.page} 页：{r.text}</button>)}</nav>}<div ref={pdfContainer} className="document-pdf" style={{filter:`brightness(${brightness}%)`}}><div className="pdf-page-box" ref={pdfPageBox}><canvas ref={canvas}/><div ref={pdfTextLayer} className="pdf-text-layer" onMouseUp={()=>{const text=window.getSelection()?.toString().trim();if(text)setSelection({location:String(page),text});}} /></div></div></div>}
    <footer>{book.format === 'epub' && <><button onClick={()=>setShowNotes(v=>!v)}>摘录</button><button onClick={()=>setShowEpubSearch(v=>!v)}>搜索全书</button></>}{book.format === 'pdf' && <><button onClick={()=>setShowOutline(v=>!v)}>PDF 目录</button><button onClick={()=>setShowNotes(v=>!v)}>摘录</button></>}<button disabled={!ready} onClick={() => turn(-1)}>上一页</button>{book.format === 'pdf' && <><label>第 <input type="number" min={1} max={total || 1} value={page} onChange={e=>setPage(Math.max(1,Math.min(total,Number(e.target.value)||1)))}/> / {total} 页</label><button onClick={()=>changeScale(scale-.1)}>缩小并保存</button><button onClick={()=>changeScale(scale+.1)}>放大并保存</button><button disabled={!ready} onClick={()=>void fitPdf("width")}>适应宽度</button><button disabled={!ready} onClick={()=>void fitPdf("page")}>适应页面</button><button onClick={rotatePdf}>旋转页面</button></>}<button disabled={!ready} onClick={() => turn(1)}>下一页</button><button disabled={!ready} onClick={()=>void showCurrentText()}>提取当前文字</button><button disabled={!ready} onClick={()=>void showCurrentText(true)}>朗读当前文字</button><button onClick={()=>window.speechSynthesis?.cancel()}>停止朗读</button></footer>
  </div>;
}
