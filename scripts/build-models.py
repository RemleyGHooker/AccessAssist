"""Render the reviewed Phase 4 models as standalone vector artifacts (requires reportlab)."""
from pathlib import Path
from reportlab.graphics.shapes import Drawing, Rect, String, PolyLine, Polygon
from reportlab.graphics import renderSVG, renderPDF
from reportlab.lib.colors import HexColor, white

OUT = Path(__file__).resolve().parents[1] / 'docs' / 'models'
OUT.mkdir(parents=True, exist_ok=True)
INK = HexColor('#17324d')
BLUE = HexColor('#eaf3fb')
EDGE = HexColor('#48718e')

def label(d, x, y, text, size=11, color=INK):
    d.add(String(x, y, text, fontName='Helvetica', fontSize=size, fillColor=color, textAnchor='middle'))

def box(d, x, y, w, h, lines, fill=BLUE):
    d.add(Rect(x, y, w, h, rx=7, ry=7, fillColor=fill, strokeColor=EDGE, strokeWidth=1.2))
    for i, line in enumerate(lines):
        label(d, x+w/2, y+h/2+(len(lines)-1)*7-i*14-3, line)

def arrow(d, points, text=None, at=None, dashed=False):
    d.add(PolyLine([n for p in points for n in p], strokeColor=EDGE, strokeWidth=1.3, strokeDashArray=[5, 3] if dashed else None))
    (x0, y0), (x1, y1) = points[-2:]
    dx, dy = x1-x0, y1-y0
    length = (dx*dx+dy*dy)**.5
    ux, uy = dx/length, dy/length
    px, py = -uy, ux
    d.add(Polygon([x1,y1,x1-8*ux+3*px,y1-8*uy+3*py,x1-8*ux-3*px,y1-8*uy-3*py], fillColor=EDGE, strokeColor=EDGE))
    if text and at: label(d, at[0], at[1], text, 10)

def save(d, name):
    renderSVG.drawToFile(d, str(OUT/f'{name}.svg'))
    renderPDF.drawToFile(d, str(OUT/f'{name}.pdf'))

d = Drawing(900, 750)
label(d, 450, 720, 'AccessAssist Phase 4 - Request workflow and states', 19)
label(d, 450, 699, 'Implemented local source 0.4.0; release verification is pending', 11)
box(d, 275, 625, 350, 50, ['Received: POST /system/analyze'])
box(d, 275, 535, 350, 55, ['Validate size, file/settings, MIME, signature'])
box(d, 275, 430, 350, 65, ['Analyzing: bounded worker', 'Parse format; detect and map findings', 'Terminate worker after its result'])
box(d, 45, 430, 185, 65, ['Invalid / unreadable', '400 / 413 / 415 / 422'], HexColor('#fff1e7'))
box(d, 685, 430, 175, 65, ['Processing unavailable', '503; no partial results'], HexColor('#fff1e7'))
box(d, 275, 330, 350, 55, ['Remediation mode: deterministic or Groq'])
box(d, 45, 220, 220, 65, ['Optional Groq request', 'Generic rule templates only', 'Validate complete JSON'])
box(d, 350, 220, 275, 65, ['Assemble report', 'Findings or scoped no-violations'])
box(d, 275, 110, 350, 55, ['Clear original upload buffer'])
box(d, 275, 25, 350, 50, ['Respond with JSON; log metadata'])
arrow(d, [(450,625),(450,590)])
arrow(d, [(450,535),(450,495)], 'valid', (480,511))
arrow(d, [(275,560),(137,560),(137,495)], 'invalid', (180,571))
arrow(d, [(275,465),(230,465)])
arrow(d, [(625,465),(685,465)], 'limit/fault', (655,505))
arrow(d, [(450,430),(450,385)])
arrow(d, [(350,330),(155,330),(155,285)], 'Groq configured', (193,341), True)
arrow(d, [(490,330),(490,285)], 'deterministic', (556,307))
arrow(d, [(265,252),(350,252)], 'valid', (307,264))
arrow(d, [(155,220),(155,185),(772,185),(772,430)], 'provider failure', (746,203))
arrow(d, [(490,220),(490,165)])
arrow(d, [(45,462),(20,462),(20,137),(275,137)])
arrow(d, [(772,430),(822,430),(822,137),(625,137)])
arrow(d, [(450,110),(450,75)])
save(d, 'workflow')

d = Drawing(1000, 770)
label(d, 500, 740, 'AccessAssist Phase 4 - Components and data flow', 19)
label(d, 500, 719, 'Local implementation; Cloud Run remains the release target. Dashed arrow = optional provider call.', 11)
box(d, 340, 645, 320, 48, ['Upload page / API client'])
box(d, 340, 555, 320, 55, ['app.js', 'Routing, version and request logging'])
box(d, 700, 555, 250, 55, ['stdout', 'Metadata only; no upload content'])
box(d, 340, 455, 320, 55, ['system.js', 'Intake and common endpoints'])
box(d, 35, 455, 240, 55, ['tester.js', 'In-memory sessions / reports'])
box(d, 700, 455, 250, 55, ['System test session Map', 'In-memory; resets on restart'])
box(d, 340, 350, 320, 60, ['analyzer.js', 'Worker capacity/deadline; report assembly'])
box(d, 35, 350, 240, 60, ['cases.js + fixtures.js', 'Shared CLI / deployed test suite'])
box(d, 35, 235, 240, 65, ['contract.js + openapi.yaml', 'Validate target JSON responses'])
box(d, 35, 115, 240, 65, ['Configured target system', 'HTTP requests; synthetic fixtures'])
box(d, 340, 245, 320, 55, ['analysis-worker.js', 'One short-lived worker per document'])
box(d, 320, 130, 105, 65, ['HTML', 'jsdom'])
box(d, 440, 130, 105, 65, ['PDF', 'pdf-lib'])
box(d, 560, 130, 105, 65, ['DOCX', 'ZIP + XML'])
box(d, 710, 350, 240, 60, ['remediation.js', 'Deterministic instructions', 'Optional validated AI wording'])
box(d, 710, 235, 240, 65, ['Groq API', 'Generic rule templates only', 'No live credential tested yet'])
arrow(d, [(500,645),(500,610)], 'file + level', (570,626))
arrow(d, [(660,582),(700,582)])
arrow(d, [(500,555),(500,510)])
arrow(d, [(340,580),(155,580),(155,510)], '/tester', (212,590))
arrow(d, [(660,482),(700,482)])
arrow(d, [(500,455),(500,410)])
arrow(d, [(155,455),(155,410)])
arrow(d, [(155,350),(155,300)])
arrow(d, [(35,380),(15,380),(15,148),(35,148)])
arrow(d, [(500,350),(500,300)])
arrow(d, [(660,380),(710,380)])
arrow(d, [(830,350),(830,300)], 'when configured', (905,321), True)
arrow(d, [(500,245),(500,220),(372,220),(372,195)])
arrow(d, [(500,220),(492,220),(492,195)])
arrow(d, [(500,220),(612,220),(612,195)])
label(d, 625, 74, 'Findings return to analyzer.js; original uploads are cleared after processing.', 12)
label(d, 625, 52, 'No persistent document database, browser extension or file-repair component.', 11)
save(d, 'architecture')
print(OUT)
