from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
target=root.parent/'PaperRealm-1.0.0-source.zip'
excluded={'node_modules','dist','target','test-results','playwright-report','.git'}
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=6,strict_timestamps=False) as z:
    for p in root.rglob('*'):
        rel=p.relative_to(root)
        if p.is_file() and not any(part in excluded for part in rel.parts) and not p.name.endswith('.tsbuildinfo'):
            z.write(p,Path('PaperRealm')/rel)
print(target, target.stat().st_size)
