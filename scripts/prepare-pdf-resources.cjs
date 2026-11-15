const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
for(const folder of ['cmaps','standard_fonts']){
  fs.cpSync(path.join(root,'node_modules/pdfjs-dist',folder),path.join(root,'public/pdf-resources',folder),{recursive:true});
}
// Pinned PDF.js 4.10.38: expose parsed signature dictionaries, never parse PDF syntax with regex.
const upstream=fs.readFileSync(path.join(root,'node_modules/pdfjs-dist/build/pdf.worker.mjs'),'utf8');
const signatureStart=upstream.indexOf('class SignatureWidgetAnnotation extends WidgetAnnotation {');
const signatureEnd=upstream.indexOf('class TextAnnotation extends MarkupAnnotation {',signatureStart);
if(signatureStart<0||signatureEnd<0)throw Error('PDF.js signature adapter requires review after dependency upgrade');
const replacement=`// PaperRealm addition: signature metadata for native verification; Apache-2.0.
class SignatureWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    this.data.fieldValue=null;
    this.data.hasOwnCanvas=this.data.noRotate;
    this.data.noHTML=!this.data.hasOwnCanvas;
    this.paperrealmSignature=null;
    try {
      const value=getInheritableProperty({dict:params.dict,key:"V"});
      if(value instanceof Dict){
        const contents=value.get("Contents"),sub=value.get("SubFilter");
        const text=k=>{const v=value.get(k);return typeof v==="string"?stringToPDFString(v):"";};
        this.paperrealmSignature={present:true,ranges:value.getArray("ByteRange"),subfilter:sub instanceof Name?sub.name:"",cms:typeof contents==="string"&&contents.length<=1048576?btoa(contents):null,name:text("Name"),reason:text("Reason"),location:text("Location"),date:text("M")};
      }
    }catch{this.paperrealmSignature={present:true,error:"SIG_METADATA"};}
  }
  getFieldObject(){return {id:this.data.id,name:this.data.fieldName,value:null,page:this.data.pageIndex,type:"signature",signature:this.paperrealmSignature};}
}
`;
let worker=upstream.slice(0,signatureStart)+replacement+upstream.slice(signatureEnd);
const highlightAnchor='highlight.set("Subtype", Name.get("Highlight"));';
if(worker.split(highlightAnchor).length!==2)throw Error('PDF.js highlight adapter requires review after dependency upgrade');
worker=worker.replace(highlightAnchor,highlightAnchor+'\n    // PaperRealm modification: preserve Unicode note contents in exported highlights.\n    if (typeof annotation.contents === "string") highlight.set("Contents", stringToAsciiOrUTF16BE(annotation.contents));');
fs.writeFileSync(path.join(root,'public/pdf-resources/pdf.worker.mjs'),worker);
let sandbox=fs.readFileSync(path.join(root,'node_modules/pdfjs-dist/build/pdf.sandbox.mjs'),'utf8');
const boundary=sandbox.indexOf('const code = [');
if(boundary<0||(sandbox.slice(0,boundary).match(/2147483648/g)||[]).length!==2)throw Error('PDF.js sandbox memory adapter needs review');
sandbox=sandbox.slice(0,boundary).replaceAll('2147483648','67108864')+sandbox.slice(boundary);
fs.writeFileSync(path.join(root,'public/pdf-resources/pdf.sandbox.mjs'),'// PaperRealm modification: capped host-side WASM heap growth at 64 MiB. Original PDF.js 4.10.38, Apache-2.0; QuickJS MIT notice is bundled in licenses/quickjs-LICENSE.txt.\n'+sandbox);
fs.copyFileSync(path.join(root,'src/pdfScripting.worker.mjs'),path.join(root,'public/pdf-resources/paperrealm.scripting.worker.mjs'));
