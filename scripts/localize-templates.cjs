const fs = require('fs'), ts = require('typescript');
const files = ['App.tsx','Reader.tsx','Narration.tsx','ReaderServices.tsx','Dictionary.tsx','AlignedSentence.tsx'];
const keys = new Set(JSON.parse(fs.readFileSync('work-ui-strings.json','utf8')));
for (const file of files) {
  const path = `src/${file}`, source = fs.readFileSync(path,'utf8');
  const sf = ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), edits=[];
  function visit(n) {
    if (ts.isTemplateExpression(n)) {
      let p=n.parent;
      if (ts.isConditionalExpression(p) && (p.whenTrue===n || p.whenFalse===n)) p=p.parent;
      if (ts.isJsxExpression(p) && (!ts.isJsxAttribute(p.parent) || ['title','aria-label','placeholder'].includes(p.parent.name.getText(sf)))) {
        const spans=n.templateSpans;
        let key=n.head.text;
        spans.forEach((s,i)=>{key+=`{${i}}`+s.literal.text});
        if (/[\u3400-\u9fff]/.test(key) && key.length<=180 && !/[\r\n]/.test(key)) {
          keys.add(key);
          edits.push([n.getStart(sf),n.end,`trFormat(${JSON.stringify(key)}, ${spans.map(s=>s.expression.getText(sf)).join(', ')})`]);
        }
      }
    }
    ts.forEachChild(n,visit);
  }
  visit(sf);
  if (process.argv.includes('--apply') && edits.length) {
    let result=source;
    for(const [a,b,value] of edits.sort((x,y)=>y[0]-x[0])) result=result.slice(0,a)+value+result.slice(b);
    result='import { trFormat } from "./i18n";\n'+result;
    fs.writeFileSync(path,result);
  }
}
fs.writeFileSync('work-ui-strings.json',JSON.stringify([...keys].sort(),null,2));
console.log(`${keys.size} source phrases including dynamic labels`);
