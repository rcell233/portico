"""Import the actual square icon contour from Apple's Illustrator production template.
Usage: uv run --with pymupdf python scripts/import-icon-outline.py '/path/App Icon Template.ai'
The template is downloaded separately and is not redistributed in this repository.
"""
import hashlib
from pathlib import Path
import sys
import pymupdf

source = Path(sys.argv[1])
page = pymupdf.open(source)[0]
# Apple's mask is a compound path: the icon contour plus an enclosing rectangle.
masks = [d for d in page.get_drawings() if sum(i[0] == 'c' for i in d['items']) == 40 and any(i[0] == 're' for i in d['items'])]
assert len(masks) == 1, 'Template structure changed; inspect it before importing'
items = [i for i in masks[0]['items'] if i[0] != 're']
assert len(items) == 44
# Uniform scale/translation only. Preserve all original Bezier control points.
def point(p):
    return f'{50 + p.x * 412 / 1024:.6f} {50 + p.y * 412 / 1024:.6f}'
commands = ['M' + point(items[0][1])]
for item in items:
    commands.append(('C' if item[0] == 'c' else 'L') + ' '.join(point(p) for p in item[2:]))
commands.append('Z')
path = ' '.join(commands)
icon = Path(__file__).resolve().parent.parent / 'resources/icon.svg'
svg = icon.read_text()
start = svg.index('  <!-- Actual Apple production-template contour;' if 'Actual Apple production-template contour;' in svg else '  <!-- Icon artwork:')
end = svg.index('  <g transform=', start)
svg = svg[:start] + '  <!-- Actual Apple production-template contour; see docs/icon-source.md. -->\n' + f'  <path id="apple-icon-contour" d="{path}" fill="url(#a)"/>\n' + svg[end:]
icon.write_text(svg)
print('Imported 40 cubic segments and 4 lines without curve fitting.')
print('Template SHA-256:', hashlib.sha256(source.read_bytes()).hexdigest())
