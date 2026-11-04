import re

def parse_prisma(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    models = []
    lines = content.splitlines()
    
    in_model = False
    current_model = None
    brace_depth = 0
    
    for line in lines:
        stripped = line.strip()
        if not in_model:
            match = re.match(r'^model\s+(\w+)\s*\{', stripped)
            if match:
                in_model = True
                current_model = {
                    'name': match.group(1),
                    'table_name': '',
                    'lines': []
                }
                brace_depth = 1
                models.append(current_model)
        else:
            # count braces
            for char in stripped:
                if char == '{':
                    brace_depth += 1
                elif char == '}':
                    brace_depth -= 1
            
            if brace_depth == 0:
                in_model = False
                if not current_model['table_name']:
                    current_model['table_name'] = current_model['name'].lower()
                current_model = None
            else:
                map_match = re.search(r'@@map\("([^"]+)"\)', stripped)
                if map_match:
                    current_model['table_name'] = map_match.group(1)
                elif stripped and not stripped.startswith('//'):
                    current_model['lines'].append(stripped)

    return models

if __name__ == '__main__':
    models = parse_prisma('prisma/schema.prisma')
    print(f"Total models: {len(models)}")
    for idx, m in enumerate(models, 1):
        print(f"3.{idx} {m['table_name']} ({m['name']}) - {len(m['lines'])} lines")
