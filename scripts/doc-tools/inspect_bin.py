import os, re

bin_path = os.path.expandvars(r"%USERPROFILE%\.gemini\antigravity\plugin_data\gdocs\bin\gdocs-986250228.exe")
with open(bin_path, 'rb') as f:
    data = f.read()

# search for "after" and "before"
matches = re.findall(rb'(--after[^\x00]+)', data)
for m in matches[:10]:
    print(m.decode('utf-8', errors='ignore'))
