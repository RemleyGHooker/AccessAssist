"""Export the report Markdown to reviewable PDF and Word files.

Optional authoring dependencies: reportlab, markdown, python-docx, svglib; pdftoppm for Word diagrams.
"""
from pathlib import Path
import html
import subprocess
import xml.etree.ElementTree as ET
import markdown
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT
from svglib.svglib import svg2rlg
from docx import Document
from docx.shared import Inches, Pt
from docx.oxml import OxmlElement

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs' / 'PHASE4_REPORT.md'
OUT = ROOT / 'docs'
html_doc = markdown.markdown(SOURCE.read_text(), extensions=['tables', 'fenced_code'])
tree = ET.fromstring('<root>' + html_doc + '</root>')
font_dir = Path('/usr/share/fonts/truetype/dejavu')
for name, file in [('Body', 'DejaVuSans.ttf'), ('Body-Bold', 'DejaVuSans-Bold.ttf'), ('Mono', 'DejaVuSansMono.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(font_dir/file)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body', boldItalic='Body-Bold')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='ReportBody', fontName='Body', fontSize=9, leading=13, spaceAfter=7, alignment=TA_LEFT))
styles.add(ParagraphStyle(name='ReportCell', fontName='Body', fontSize=7.3, leading=10, spaceAfter=0, wordWrap='CJK'))
styles.add(ParagraphStyle(name='ReportCode', fontName='Mono', fontSize=7.5, leading=11, leftIndent=10, spaceAfter=8, wordWrap='CJK'))
for number, size in [(1, 21), (2, 15), (3, 11.5)]:
    styles.add(ParagraphStyle(name='ReportH'+str(number), fontName='Body-Bold', fontSize=size, leading=size+4, spaceBefore=12, spaceAfter=8, keepWithNext=True, textColor=colors.HexColor('#17324d')))

def inline(element):
    out = html.escape(element.text or '')
    for child in element:
        content = inline(child)
        if child.tag == 'strong': content = '<b>'+content+'</b>'
        elif child.tag == 'em': content = '<i>'+content+'</i>'
        elif child.tag == 'code': content = '<font name="Mono">'+content+'</font>'
        elif child.tag == 'br': content = '<br/>'
        elif child.tag == 'a' and child.get('href', '').startswith('http'):
            content = '<link href="'+html.escape(child.get('href'), quote=True)+'" color="#145a86">'+content+'</link>'
        out += content + html.escape(child.tail or '')
    return out

def plain(element):
    return ''.join(element.itertext()).strip()

story = []
word = Document()
word.core_properties.title = 'AccessAssist Phase 4 Report - Team 19'
word.core_properties.author = 'Team 19 / Xiyue Chen'
section = word.sections[0]
section.top_margin = section.bottom_margin = Inches(.65)
section.left_margin = section.right_margin = Inches(.65)
normal = word.styles['Normal']
normal.font.name = 'Calibri'
normal.font.size = Pt(10)

def add_image(element):
    source = SOURCE.parent / element.attrib['src']
    drawing = svg2rlg(str(source))
    factor = min(490/drawing.width, 560/drawing.height)
    drawing.scale(factor, factor)
    drawing.width *= factor
    drawing.height *= factor
    story.extend([Spacer(1, 7), drawing, Spacer(1, 7)])
    png = source.with_suffix('.png')
    if not png.exists():
        subprocess.run(['pdftoppm', '-singlefile', '-scale-to', '1800', '-png', str(source.with_suffix('.pdf')), str(source.with_suffix(''))], check=True)
    picture = word.add_picture(str(png), width=Inches(6.8))
    picture._inline.docPr.set('descr', element.get('alt', ''))
    word.add_paragraph(element.get('alt', ''), style='Caption')

for element in tree:
    tag = element.tag
    if tag in ['h1', 'h2', 'h3']:
        level = int(tag[1])
        story.append(Paragraph(inline(element), styles['ReportH'+str(level)]))
        word.add_heading(plain(element), level=level-1 if level == 1 else level-1)
    elif tag == 'p':
        images = list(element.iter('img'))
        if images:
            for img in images: add_image(img)
        else:
            story.append(Paragraph(inline(element), styles['ReportBody']))
            word.add_paragraph(plain(element))
    elif tag in ['ul', 'ol']:
        for index, item in enumerate(element, 1):
            prefix = '• ' if tag == 'ul' else str(index)+'. '
            story.append(Paragraph(prefix+inline(item), styles['ReportBody']))
            word.add_paragraph(plain(item), style='List Bullet' if tag == 'ul' else 'List Number')
    elif tag == 'pre':
        code = plain(element)
        story.append(Paragraph(html.escape(code).replace('\n', '<br/>'), styles['ReportCode']))
        p = word.add_paragraph()
        run = p.add_run(code)
        run.font.name = 'Consolas'
        run.font.size = Pt(8)
    elif tag == 'table':
        rows = [list(row) for row in element.findall('.//tr')]
        count = len(rows[0])
        headings = [plain(cell) for cell in rows[0]]
        if count == 3: widths = [150, 100, 250]
        elif count == 4: widths = [42, 62, 218, 178]
        elif headings[0] == 'AC': widths = [37, 67, 211, 85, 100]
        elif headings[0] == 'ID': widths = [48, 222, 46, 124, 60]
        else: widths = [83, 65, 102, 125, 125]
        cells = [[Paragraph(('<b>'+inline(c)+'</b>') if n == 0 else inline(c), styles['ReportCell']) for c in row] for n, row in enumerate(rows)]
        table = LongTable(cells, colWidths=widths, repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#eaf3fb')),
            ('GRID', (0,0), (-1,-1), .4, colors.HexColor('#aab8c4')),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ]))
        story.extend([table, Spacer(1, 10)])
        wt = word.add_table(rows=1, cols=count)
        wt.style = 'Table Grid'
        wt.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
        for i, text in enumerate(headings): wt.rows[0].cells[i].text = text
        for row in rows[1:]:
            cells_word = wt.add_row().cells
            for i, cell in enumerate(row): cells_word[i].text = plain(cell)
        for row in wt.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    for run in p.runs: run.font.size = Pt(8)

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Body', 7)
    canvas.setFillColor(colors.HexColor('#526375'))
    canvas.drawString(54, 30, 'AccessAssist | Phase 4 | Team 19 | Local implementation; release evidence pending')
    canvas.drawRightString(558, 30, str(doc.page))
    canvas.restoreState()

pdf = SimpleDocTemplate(str(OUT/'PHASE4_REPORT.pdf'), pagesize=(612,792), rightMargin=56, leftMargin=56, topMargin=44, bottomMargin=48, title='AccessAssist Phase 4 Report - Team 19', author='Team 19 / Xiyue Chen')
pdf.build(story, onFirstPage=footer, onLaterPages=footer)
word.save(OUT/'PHASE4_REPORT.docx')
print(OUT/'PHASE4_REPORT.pdf')
print(OUT/'PHASE4_REPORT.docx')
