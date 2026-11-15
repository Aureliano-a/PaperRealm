"""Generate offline UI dictionaries from fixed application strings, never user books."""
import concurrent.futures, json, time, urllib.parse, urllib.request
from pathlib import Path

keys = json.loads(Path('work-ui-strings.json').read_text(encoding='utf-8'))
languages = {'en':'en', 'ja':'ja', 'de':'de', 'fr':'fr', 'es':'es', 'pt-BR':'pt', 'ru':'ru', 'ar':'ar'}
def fetch(parts, lang):
    query = urllib.parse.urlencode({'client':'gtx','sl':'zh-CN','tl':lang,'dt':'t','q':'\n'.join(parts)})
    for attempt in range(4):
        try:
            req = urllib.request.Request('https://translate.googleapis.com/translate_a/single?' + query, headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = json.load(response)
            text = ''.join(item[0] or '' for item in payload[0])
            lines = text.split('\n')
            if len(lines) == len(parts): return lines
            if len(parts) == 1: return [text.strip()]
            midpoint = len(parts)//2
            return fetch(parts[:midpoint],lang) + fetch(parts[midpoint:],lang)
        except Exception:
            if attempt == 3: raise
            time.sleep(1.5 * (attempt+1))

chunks = []
chunk=[]; size=0
for key in keys:
    if chunk and (len(chunk)>=18 or size+len(key)>350): chunks.append(chunk); chunk=[]; size=0
    chunk.append(key); size+=len(key)
if chunk: chunks.append(chunk)
result = {language:{} for language in languages}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    pending = {pool.submit(fetch, chunk, target):(language,chunk) for language,target in languages.items() for chunk in chunks}
    for i,future in enumerate(concurrent.futures.as_completed(pending),1):
        language,chunk=pending[future]
        result[language].update(zip(chunk,future.result()))
        if i % 25 == 0: print(f'{i}/{len(pending)} translation batches',flush=True)
Path('src/ui-translations.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print('Offline UI dictionaries written.', flush=True)
