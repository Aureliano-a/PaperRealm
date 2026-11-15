import { invoke, isTauri } from '@tauri-apps/api/core';
import { get } from './db';
import pdfjs from './pdfEngine';
import type { SourceParts } from './binarySource';

// Read PDF ranges from SQLite/IndexedDB without expanding a whole base64 document.
export async function pdfSource(id:string,onError:(e:unknown)=>void){
  const desktop=isTauri();
  let legacy:string|undefined;
  const info:SourceParts|{legacyLength:number}=desktop ? await invoke('db_source_info',{id}) : await (async()=>{const value=await get<string|SourceParts>('source:'+id);if(typeof value==='string'){legacy=value;return {legacyLength:value.length};}if(!value)throw Error('本地文件副本丢失');return value;})();
  const old='legacyLength'in info;
  let length=old?Math.floor(info.legacyLength/4)*3:info.length;
  if(old){const tail=desktop?await invoke<string>('db_source_part',{id,start:Math.max(0,info.legacyLength-4),length:4}):legacy!.slice(-4);length-=tail.endsWith('==')?2:tail.endsWith('=')?1:0;}
  if(!Number.isSafeInteger(length)||length<=0)throw Error('PDF 副本长度无效');
  const cache=new Map<number,Promise<Uint8Array>>();let stopped=false;
  const chunk=384*1024;
  function block(index:number){let promise=cache.get(index);if(promise)return promise;promise=(async()=>{
    let encoded:string;
    if(old){const start=index*chunk/3*4,chars=Math.ceil(Math.min(chunk,length-index*chunk)/3)*4;encoded=desktop?await invoke<string>('db_source_part',{id,start,length:chars}):legacy!.slice(start,start+chars);}
    else{const value=await get<string>(`source-part:${id}:${index}`);if(typeof value!=='string')throw Error('PDF 文件分块缺失');encoded=value;}
    const raw=atob(encoded),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;
  })();cache.set(index,promise);if(cache.size>6)cache.delete(cache.keys().next().value!);return promise;}
  class RangeSource extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin:number,end:number){void(async()=>{try{const output=new Uint8Array(end-begin);for(let at=begin;at<end;){if(stopped)return;const index=Math.floor(at/chunk),bytes=await block(index),offset=at-index*chunk,count=Math.min(end-at,bytes.length-offset);if(count<=0)throw Error('PDF 文件分块损坏');output.set(bytes.subarray(offset,offset+count),at-begin);at+=count;}if(!stopped)this.onDataRange(begin,output);}catch(e){if(!stopped)onError(e);}})();}
    abort(){stopped=true;cache.clear();}
  }
  return {range:new RangeSource(length,new Uint8Array(0),true),length,rangeChunkSize:chunk,disableAutoFetch:true,disableStream:true};
}
