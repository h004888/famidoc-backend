import subprocess, json

res = subprocess.run('gdocs readonly dump-body 12gjLAFA9Wsh3eM5RUTtTH9ntjPVZef4_ --json', shell=True, capture_output=True, text=True, encoding='utf-8')
body = json.loads(res.stdout)
elements = body.get('content', [])

for idx, el in enumerate(elements):
    start = el.get('startIndex', 0)
    end = el.get('endIndex', 0)
    if 14905 <= start <= 15470:
        if 'paragraph' in el:
            txt = ''.join(r.get('textRun', {}).get('content', '') for r in el['paragraph'].get('elements', []))
            print(f"El {idx} [P] {start}-{end}: {repr(txt[:60])}")
        elif 'table' in el:
            rows = len(el['table'].get('tableRows', []))
            print(f"El {idx} [Table] {start}-{end}: {rows} rows")
