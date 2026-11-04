import docx

doc = docx.Document('Report-4_Software_Design_Specification_v1.0.docx')

print(f"Total paragraphs: {len(doc.paragraphs)}")
print(f"Total tables: {len(doc.tables)}")

for i, p in enumerate(doc.paragraphs):
    if '3. Database Design' in p.text or '3.1' in p.text or 'II. Detailed Code Design' in p.text:
        print(f"P {i}: style='{p.style.name}', text='{p.text}'")

for i, t in enumerate(doc.tables):
    # check first cell text
    if len(t.rows) > 0 and len(t.rows[0].cells) > 0:
        first_cell = t.rows[0].cells[0].text.strip()
        if 'Column' in first_cell:
            print(f"Table {i}: rows={len(t.rows)}, cols={len(t.columns)}, header='{first_cell}'")
