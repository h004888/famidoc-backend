import subprocess, json

cmd = 'gdocs readonly dump-body 12gjLAFA9Wsh3eM5RUTtTH9ntjPVZef4_ --json'
res = subprocess.run(cmd, shell=True, capture_output=True, text=True, encoding='utf-8')
body = json.loads(res.stdout)
elements = body.get('content', [])

for idx, el in enumerate(elements):
    if 'paragraph' in el:
        p = el['paragraph']
        text = ''.join(r.get('textRun', {}).get('content', '') for r in p.get('elements', []))
        if any(keyword in text for keyword in ['3. Database Design', '3.1', 'table_name', 'II. Detailed Code Design']):
            print(f"Element {idx} [Paragraph]: start={el.get('startIndex')}, end={el.get('endIndex')}, text={repr(text[:80])}")
    elif 'table' in el:
        start = el.get('startIndex', 0)
        if 40 <= idx <= 55:
            print(f"Element {idx} [Table]: start={start}, end={el.get('endIndex')}, rows={len(el['table'].get('tableRows', []))}")
