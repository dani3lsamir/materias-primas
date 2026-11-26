"""Stage only public assets for GitHub Pages and build a single-file offline version."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil


ROOT = Path(__file__).resolve().parent
PUBLIC_ASSETS = ('.nojekyll', 'index.html', 'style.css', 'app.js', 'theme.js', 'favicon.svg', 'market.json', 'demo.json')


def asset(name):
    return (ROOT / name).read_text(encoding='utf-8')


def csp_hash(content):
    digest = hashlib.sha256(content.encode('utf-8')).digest()
    return "'sha256-" + base64.b64encode(digest).decode('ascii') + "'"


def replace_once(content, marker, replacement):
    if content.count(marker) != 1:
        raise ValueError(f'Expected one build marker: {marker}')
    return content.replace(marker, replacement)


def offline_html():
    html = asset('index.html')
    styles, theme, app = (asset(name) for name in ('style.css', 'theme.js', 'app.js'))
    if '</script' in (theme + app).lower() or '</style' in styles.lower():
        raise ValueError('Inline asset contains an HTML closing tag')
    policy = ("default-src 'none'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'; "
              f"script-src {csp_hash(theme)} {csp_hash(app)}; style-src {csp_hash(styles)}")
    html, replacements = re.subn(r'(<meta http-equiv="Content-Security-Policy" content=")[^"]+("\s*>)',
                                 lambda match: match[1] + policy + match[2], html)
    if replacements != 1:
        raise ValueError('Expected one Content-Security-Policy declaration')
    html = replace_once(html, '<link rel="stylesheet" href="style.css">', f'<style>{styles}</style>')
    html = replace_once(html, '<script src="theme.js"></script>', f'<script>{theme}</script>')
    html = replace_once(html, '<script src="app.js" type="module"></script>', '')
    html = replace_once(html, '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
                        '<link rel="icon" href="data:image/svg+xml;base64,' +
                        base64.b64encode((ROOT / 'favicon.svg').read_bytes()).decode('ascii') + '">')

    embedded = []
    for name in ('market', 'demo'):
        payload = json.dumps(json.loads(asset(f'{name}.json')), ensure_ascii=False, separators=(',', ':'))
        safe_payload = payload.replace('<', '\\u003c')
        embedded.append(f'<script type="application/json" id="{name}-data">{safe_payload}</script>')
    html = replace_once(html, '</body>', '\n'.join([*embedded, f'<script type="module">{app}</script>', '</body>']))
    return html


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / '_site')
    args = parser.parse_args()
    out = args.out.resolve()
    if out == ROOT or ROOT not in out.parents:
        raise ValueError('Build into a subdirectory of the checkout')
    out.mkdir(parents=True, exist_ok=True)
    generated = {*PUBLIC_ASSETS, 'offline.html'}
    if extras := {path.name for path in out.iterdir()} - generated:
        raise ValueError(f'Unexpected deployment files: {sorted(extras)}')
    offline = offline_html()
    for name in PUBLIC_ASSETS:
        shutil.copyfile(ROOT / name, out / name)
    (out / 'offline.html').write_text(offline, encoding='utf-8', newline='\n')
    print(f'Built {len(generated)} public files in {out}')


if __name__ == '__main__':
    main()
