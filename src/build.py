import pathlib
d = pathlib.Path(__file__).parent
html = (d / 'index.src.html').read_text()
for tag, f in [('/*CSS*/', 'style.css'), ('/*DSP*/', 'dsp.js'), ('/*LESSONS*/', 'lessons.js'), ('/*APP*/', 'app.js')]:
    html = html.replace(tag, (d / f).read_text())
(d / 'dist').mkdir(exist_ok=True)
(d / 'dist' / 'index.html').write_text(html)
print('built', len(html))
