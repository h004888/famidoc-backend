import os, sys
import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

sys.path.insert(0, os.path.dirname(__file__))
from parse_schema import parse_prisma
from generate_data_dict import parse_fields_and_relations, extract_column_details

def style_table(table):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    # Set borders and header shading
    for i, row in enumerate(table.rows):
        trPr = row._tr.get_or_add_trPr()
        trPr.append(parse_xml(r'<w:cantSplit %s/>' % nsdecls('w')))
        
        is_header = (i == 0)
        if is_header:
            trPr.append(parse_xml(r'<w:tblHeader %s/>' % nsdecls('w')))
            
        for cell in row.cells:
            tcPr = cell._tc.get_or_add_tcPr()
            if is_header:
                shd = parse_xml(r'<w:shd %s w:fill="FCE4D6" w:val="clear"/>' % nsdecls('w'))
                tcPr.append(shd)
            # cell margins (padding)
            tcMar = parse_xml(r'<w:tcMar %s><w:top w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar>' % nsdecls('w'))
            tcPr.append(tcMar)
            
            # format paragraphs inside cell
            for p in cell.paragraphs:
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing = 1.15
                for run in p.runs:
                    run.font.name = 'Arial'
                    run.font.size = Pt(9)
                    if is_header:
                        run.font.bold = True
                        run.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)
                    else:
                        run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

    # Table borders
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        r'<w:tblBorders %s>'
        r'  <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        r'  <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
        r'  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        r'  <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        r'  <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        r'  <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        r'</w:tblBorders>' % nsdecls('w')
    )
    tblPr.append(borders)

def get_elem_text(elem):
    return "".join(t.text for t in elem.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t') if t.text)

def update_docx():
    src_path = 'Report-4_Software_Design_Specification_v1.0.docx'
    doc = docx.Document(src_path)
    
    body = doc._body._body
    
    start_idx = None
    end_idx = None

    for i, child in enumerate(body):
        t = get_elem_text(child).strip()
        if child.tag.endswith('p') and t == '3. Database Design':
            # Paragraph i+1 contains the Conceptual ERD diagram image
            # Elements to remove start right after the image
            start_idx = i + 2
        if child.tag.endswith('p') and t.startswith('II. Detailed Code Design'):
            if body[i-1].tag.endswith('bookmarkStart'):
                end_idx = i - 1
            else:
                end_idx = i
            break
            
    print(f"start_idx: {start_idx}, end_idx: {end_idx}")
    assert start_idx is not None and end_idx is not None, "Could not find start/end markers in docx"
    
    end_elem = body[end_idx]
    to_remove = [body[k] for k in range(start_idx, end_idx)]
    print(f"Elements to remove: {len(to_remove)}")
    
    # Load schema
    models = parse_prisma('prisma/schema.prisma')
    table_name_map = {m['name']: m['table_name'] for m in models}
    
    print(f"Inserting {len(models)} tables before end_elem...")
    for idx, m in enumerate(models, 1):
        table_name = m['table_name']
        columns, relations, indexes = parse_fields_and_relations(m['lines'])
        
        # 1. Heading 3
        p_head = doc.add_paragraph(f"3.{idx} {table_name}", style='Heading 3')
        p_head.paragraph_format.space_before = Pt(14)
        p_head.paragraph_format.space_after = Pt(4)
        p_head.paragraph_format.keep_with_next = True
        
        # Move p_head before end_elem
        body.remove(p_head._p)
        end_elem.addprevious(p_head._p)
        
        # 2. Table
        table = doc.add_table(rows=1, cols=4)
        # Headers
        hdr_cells = table.rows[0].cells
        hdr_cells[0].text = "Column"
        hdr_cells[1].text = "Type"
        hdr_cells[2].text = "Constraints"
        hdr_cells[3].text = "Notes"
        
        # Column widths: 1.4 in, 1.2 in, 2.2 in, 2.4 in (total = 7.2 in)
        col_widths = [Inches(1.4), Inches(1.2), Inches(2.2), Inches(2.4)]
        
        for col in columns:
            detail = extract_column_details(col, m['lines'], table_name_map, table_name)
            row_cells = table.add_row().cells
            row_cells[0].text = detail["column"]
            row_cells[1].text = detail["type"]
            row_cells[2].text = detail["constraints"]
            row_cells[3].text = detail["notes"]
            
        for row in table.rows:
            for c_idx, width in enumerate(col_widths):
                row.cells[c_idx].width = width
                
        style_table(table)
        
        # Move table before end_elem
        body.remove(table._tbl)
        end_elem.addprevious(table._tbl)
        
        # Spacing paragraph after table
        p_space = doc.add_paragraph()
        p_space.paragraph_format.space_before = Pt(0)
        p_space.paragraph_format.space_after = Pt(6)
        body.remove(p_space._p)
        end_elem.addprevious(p_space._p)

    # Now remove the old sample elements!
    for elem in to_remove:
        body.remove(elem)
        
    out_path = 'Report-4_Software_Design_Specification_v1.0.docx'
    doc.save(out_path)
    print(f"Successfully updated and saved to {out_path}!")

if __name__ == '__main__':
    update_docx()
