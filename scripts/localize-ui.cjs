// Extract static UI strings and wrap JSX labels without touching book data or event handlers.
const fs = require('fs');
const ts = require('typescript');
const files = process.argv.includes('--pdf-only') ? ['PdfReader.tsx','PdfPage.tsx'] : ['App.tsx', 'Reader.tsx', 'Narration.tsx', 'ReaderServices.tsx', 'Dictionary.tsx', 'AlignedSentence.tsx', 'FontOptions.tsx', 'types.ts', 'reading.ts', 'local-readest-fonts.ts'];
const keys = new Set();
const han = /[\u3400-\u9fff]/;
const attrs = new Set(['title', 'detail', 'desc', 'placeholder', 'aria-label']);
function normalized(s) { return s.replace(/\s*\r?\n\s*/g, ' ').trim(); }
for (const file of files) {
  const path = `src/${file}`, source = fs.readFileSync(path, 'utf8');
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const changes = [];
  function visit(n) {
    if (ts.isStringLiteral(n) && han.test(n.text) && n.text.length <= 140 && !/[\r\n]/.test(n.text)) keys.add(n.text);
    if (ts.isJsxText(n)) {
      const value = normalized(n.text);
      if (han.test(value)) {
        keys.add(value);
        const prefix = /^ /.test(n.text) ? ' ' : '', suffix = / $/.test(n.text) ? ' ' : '';
        changes.push([n.getStart(sf), n.end, `{${JSON.stringify(prefix)} + tr(${JSON.stringify(value)}) + ${JSON.stringify(suffix)}}`]);
      }
    } else if (ts.isJsxAttribute(n) && attrs.has(n.name.getText(sf)) && n.initializer && ts.isStringLiteral(n.initializer) && han.test(n.initializer.text)) {
      const value = n.initializer.text; keys.add(value);
      changes.push([n.initializer.getStart(sf), n.initializer.end, `{tr(${JSON.stringify(value)})}`]);
    } else if (ts.isStringLiteral(n) && han.test(n.text) && n.parent && ts.isConditionalExpression(n.parent) && (n.parent.whenTrue === n || n.parent.whenFalse === n)) {
      let p = n.parent;
      while (p && !ts.isJsxExpression(p) && !ts.isJsxAttribute(p) && !ts.isSourceFile(p)) p = p.parent;
      if (p && ts.isJsxExpression(p) && !ts.isJsxAttribute(p.parent)) changes.push([n.getStart(sf), n.end, `tr(${JSON.stringify(n.text)})`]);
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  if (process.argv.includes('--apply') && file.endsWith('.tsx') && file !== 'FontOptions.tsx') {
    let result = source;
    for (const [start, end, replacement] of changes.sort((a,b) => b[0]-a[0])) result = result.slice(0,start)+replacement+result.slice(end);
    if (changes.length) result = `import { tr } from "./i18n";\n` + result;
    fs.writeFileSync(path,result);
  }
}
fs.writeFileSync('work-ui-strings.json', JSON.stringify([...keys].sort(), null, 2));
console.log(`${keys.size} source phrases collected`);
