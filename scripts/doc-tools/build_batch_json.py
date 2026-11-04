import json
import os
import re

from parse_schema import parse_prisma
from generate_data_dict import parse_fields_and_relations, extract_column_details

def build_all_table_ops():
    models = parse_prisma('prisma/schema.prisma')
    table_name_map = {m['name']: m['table_name'] for m in models}
    
    ops = []
    
    for idx, m in enumerate(models, 1):
        table_name = m['table_name']
        columns, relations, indexes = parse_fields_and_relations(m['lines'])
        
        # Table heading for 3.2 to 3.30 (3.1 heading is already present in doc)
        if idx > 1:
            ops.append({
                "op": "heading",
                "text": f"3.{idx} {table_name}",
                "level": "3"
            })
            
        # Table data
        headers = ["Column", "Type", "Constraints", "Notes"]
        table_data = [headers]
        
        for col in columns:
            detail = extract_column_details(col, m['lines'], table_name_map, table_name)
            table_data.append([
                detail["column"],
                detail["type"],
                detail["constraints"],
                detail["notes"]
            ])
            
        ops.append({
            "op": "insert-table",
            "table_data": table_data,
            "table_header_bold": True,
            "table_header_bg_color": "#E8EEF5",
            "table_border_color": "#CBD5E1",
            "table_font_size": 9.5
        })
        
    return ops

if __name__ == '__main__':
    ops = build_all_table_ops()
    print(f"Total operations generated: {len(ops)}")
    with open("full_tables_batch.json", "w", encoding="utf-8") as f:
        json.dump(ops, f, indent=2, ensure_ascii=False)
    print("Saved to full_tables_batch.json")
