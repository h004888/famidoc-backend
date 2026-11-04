import subprocess, json

res = subprocess.run('gdocs readonly structure 12gjLAFA9Wsh3eM5RUTtTH9ntjPVZef4_ --json', shell=True, capture_output=True, text=True, encoding='utf-8')
elements = json.loads(res.stdout)

for el in elements:
    if el.get('type') == 'HEADING' and 14000 <= el.get('start_index', 0) <= 16000:
        print(f"L{el.get('level')} '{el.get('text')}' start={el.get('start_index')} end={el.get('end_index')}")
