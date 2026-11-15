from pathlib import Path
import json, shutil, sys, tomllib
root=Path(__file__).resolve().parents[1]
out=root/'licenses'/'third-party';out.mkdir(parents=True,exist_ok=True)
records=[]
def collect(path,name,version,license,ecosystem):
    dest=out/(ecosystem+'-'+name.replace('/','_').replace('@','')+'-'+version)
    files=[p for p in path.iterdir() if p.is_file() and (p.name.upper().startswith(('LICENSE','LICENCE','COPYING','COPYRIGHT','NOTICE','OFL')))]
    if files:
        dest.mkdir(exist_ok=True)
        for p in files:shutil.copy2(p,dest/p.name)
    records.append({'name':name,'version':version,'license':license,'ecosystem':ecosystem,'licenseFiles':[str((dest/p.name).relative_to(root/'licenses')) for p in files]})
for pkg in (root/'node_modules/.pnpm').glob('*/node_modules/*/package.json'):
    d=json.loads(pkg.read_text('utf-8'));collect(pkg.parent,d['name'],d.get('version','unknown'),d.get('license','See package source'),'npm')
for pkg in (root/'node_modules/.pnpm').glob('*/node_modules/@*/*/package.json'):
    d=json.loads(pkg.read_text('utf-8'));collect(pkg.parent,d['name'],d.get('version','unknown'),d.get('license','See package source'),'npm')
if len(sys.argv)>1:
    registry=Path(sys.argv[1])/'registry/src'
    lock=tomllib.loads((root/'src-tauri/Cargo.lock').read_text())
    for item in lock['package']:
        if 'source' not in item:continue
        for path in registry.glob('*/'+item['name']+'-'+item['version']):
            d=tomllib.loads((path/'Cargo.toml').read_text('utf-8'))['package'];collect(path,item['name'],item['version'],d.get('license','See source'),'cargo')
(root/'licenses/DEPENDENCIES.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),'utf-8')
print(len(records),'dependency notices collected')
