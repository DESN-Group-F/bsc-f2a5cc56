from pathlib import Path
import argparse
import hashlib
import json
import re
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate,
    Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output/pdf'
NAVY = colors.HexColor('#29485C')
TEAL = colors.HexColor('#116E73')
PALE = colors.HexColor('#EFF5F5')
GREY = colors.HexColor('#52616A')
RULE = colors.HexColor('#D5DFE3')
WIDTH = 501

pdfmetrics.registerFont(TTFont('YaHei', 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('YaHeiBold', 'C:/Windows/Fonts/msyhbd.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('YaHei', normal='YaHei', bold='YaHeiBold', italic='YaHei', boldItalic='YaHeiBold')
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='ArialBold', italic='Arial', boldItalic='ArialBold')


def normalise(text):
    return re.sub('[\u2010-\u2015\u2212]', '-', str(text))


def make_styles(language, detailed=False):
    zh = language == 'zh'
    regular, bold = ('YaHei', 'YaHeiBold') if zh else ('Arial', 'ArialBold')
    wrap = 'CJK' if zh else None
    base = dict(fontName=regular, textColor=colors.HexColor('#17252E'), wordWrap=wrap)
    fs, lead = (11.1, 17.8) if zh else ((10.4, 14.3) if detailed else (10.8, 15.0))
    tablefs, tablelead = (10.1, 15.7) if zh else ((9.45, 12.7) if detailed else (10.1, 13.8))
    return {
        'title': ParagraphStyle('Title', fontName=bold, fontSize=23 if zh else 22,
                                leading=31 if zh else 27, textColor=colors.black,
                                spaceAfter=15, keepWithNext=True, wordWrap=wrap),
        'kicker': ParagraphStyle('Kicker', **base, fontSize=9.5, leading=14, spaceAfter=13),
        'lead': ParagraphStyle('Lead', **base, fontSize=13, leading=20 if zh else 18.5, spaceAfter=14),
        'p': ParagraphStyle('Body', **base, fontSize=fs, leading=lead, spaceAfter=9),
        'note': ParagraphStyle('Note', **base, fontSize=8.7 if detailed else 9.1,
                              leading=12.2 if detailed else 13.3, spaceAfter=9),
        'h': ParagraphStyle('Subhead', fontName=bold, fontSize=12.1, leading=17.0,
                           spaceBefore=9, spaceAfter=6, keepWithNext=True, wordWrap=wrap,
                           textColor=colors.black),
        'cell': ParagraphStyle('Cell', **base, fontSize=tablefs, leading=tablelead),
        'center': ParagraphStyle('CenterCell', **base, fontSize=tablefs, leading=tablelead, alignment=TA_CENTER),
        'th': ParagraphStyle('HeaderCell', fontName=bold, fontSize=tablefs, leading=tablelead,
                            textColor=colors.white, wordWrap=wrap),
        'callout': ParagraphStyle('Callout', **base, fontSize=fs, leading=lead),
        'metric': ParagraphStyle('Metric', fontName=bold, fontSize=23, leading=29, textColor=TEAL),
        'metric_label': ParagraphStyle('MetricLabel', **base, fontSize=10, leading=14),
        'step_head': ParagraphStyle('StepHeading', fontName=bold, fontSize=10.5, leading=15, textColor=TEAL, wordWrap=wrap),
        'step_body': ParagraphStyle('StepBody', **base, fontSize=9.6, leading=13.5),
    }


def paragraph(text, style):
    return Paragraph(escape(normalise(text)).replace('\n', '<br/>'), style)


class ProcessFlow(Flowable):
    def __init__(self, steps, styles):
        super().__init__()
        self.steps, self.styles = steps, styles
        self.width = WIDTH
        self.gap = 11
        self.card_width = (WIDTH - self.gap * (len(steps)-1)) / len(steps)
        self.paragraphs = []
        required = []
        for head, body in steps:
            hp = paragraph(head, styles['step_head'])
            bp = paragraph(body, styles['step_body'])
            _, hh = hp.wrap(self.card_width-16, 999)
            _, bh = bp.wrap(self.card_width-16, 999)
            self.paragraphs.append((hp, hh, bp, bh))
            required.append(hh+bh+22)
        self.height = max(required)

    def draw(self):
        c = self.canv
        for i, (hp, hh, bp, bh) in enumerate(self.paragraphs):
            x = i*(self.card_width+self.gap)
            c.setFillColor(PALE)
            c.setStrokeColor(RULE)
            c.roundRect(x, 0, self.card_width, self.height, 5, fill=1, stroke=1)
            hp.drawOn(c, x+8, self.height-10-hh)
            bp.drawOn(c, x+8, self.height-14-hh-bh)
            if i < len(self.paragraphs)-1:
                mid = self.height/2
                left = x+self.card_width+2
                right = left+self.gap-4
                c.setStrokeColor(TEAL)
                c.setLineWidth(0.9)
                c.line(left, mid, right, mid)
                c.line(right-3, mid+2.7, right, mid)
                c.line(right-3, mid-2.7, right, mid)


class BriefingDoc(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == 'Title':
            key = f'section_{len(self.entries)+1}'
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.getPlainText(), key, 0)
            self.entries.append([flowable.getPlainText(), self.page])


def make_document(content_path):
    data = json.loads(content_path.read_text(encoding='utf-8-sig'))
    lang = data['language']
    detailed = content_path.stem == 'full_en'
    styles = make_styles(lang, detailed)
    filename = data.get('filename', 'BSC_Data_Status_Coverage_EN_20260921.pdf')
    pdf = OUT / filename
    font = 'YaHei' if lang == 'zh' else 'Arial'

    def chrome(c, doc):
        w, ht = A4
        c.saveState()
        c.setFont(font, 8)
        c.setFillColor(GREY)
        c.drawString(47, ht-28, normalise(data['short_title']))
        c.drawRightString(w-47, ht-28, '截至2026年9月21日' if lang == 'zh' else 'As of 21 September 2026')
        c.setStrokeColor(RULE)
        c.line(47, 41, w-47, 41)
        c.drawString(47, 27, '项目目的 / 现有资料 / 覆盖范围' if lang == 'zh' else 'Purpose / Current material / Coverage')
        c.drawRightString(w-47, 27, str(doc.page))
        c.restoreState()

    doc = BriefingDoc(str(pdf), pagesize=A4, leftMargin=47, rightMargin=47,
                      topMargin=53, bottomMargin=51, title=data['title'],
                      author='BSC project', subject='Data status, coverage and project briefing')
    doc.entries = []
    story = []
    text_pages = []
    for idx, page in enumerate(data['pages']):
        if idx:
            story.append(PageBreak())
        story.append(paragraph(page['title'], styles['title']))
        lines = [page['title']]
        for block in page['blocks']:
            kind = block['type']
            if kind == 'table':
                assert sum(block['widths']) == WIDTH
                cells = [[paragraph(x, styles['th']) for x in block['headers']]]
                cells += [[paragraph(x, styles['center' if i in block.get('center', []) else 'cell'])
                           for i, x in enumerate(row)] for row in block['rows']]
                tb = Table(cells, colWidths=block['widths'], repeatRows=1, hAlign='LEFT')
                tb.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,0),NAVY),
                    ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white, colors.HexColor('#F3F6F7')]),
                    ('GRID',(0,0),(-1,-1),0.4,RULE),
                    ('VALIGN',(0,0),(-1,-1),'TOP'),
                    ('LEFTPADDING',(0,0),(-1,-1),8), ('RIGHTPADDING',(0,0),(-1,-1),8),
                    ('TOPPADDING',(0,0),(-1,-1),6 if detailed else 7),
                    ('BOTTOMPADDING',(0,0),(-1,-1),6 if detailed else 7),
                ]))
                story.extend([tb, Spacer(1, 11)])
                lines.extend([' | '.join(block['headers'])]+[' | '.join(x) for x in block['rows']])
            elif kind == 'flow':
                story.extend([ProcessFlow(block['steps'], styles), Spacer(1, 13)])
                lines.extend(' - '.join(x) for x in block['steps'])
            elif kind == 'metrics':
                cells = [[paragraph(x, styles['metric']), paragraph(y, styles['metric_label'])]
                         for x, y in block['items']]
                tb = Table([cells], colWidths=[WIDTH/len(cells)]*len(cells), hAlign='LEFT')
                tb.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,-1),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),
                    ('TOPPADDING',(0,0),(-1,-1),11),('BOTTOMPADDING',(0,0),(-1,-1),11),
                    ('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),10),
                    ('LINEAFTER',(0,0),(-2,-1),0.5,RULE),
                ]))
                story.extend([tb, Spacer(1, 13)])
                lines.extend(' | '.join(x) for x in block['items'])
            elif kind == 'callout':
                tb = Table([[paragraph(block['text'], styles['callout'])]], colWidths=[WIDTH], hAlign='LEFT')
                tb.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,-1),PALE),('LINEBEFORE',(0,0),(-1,-1),3,TEAL),
                    ('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),
                    ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
                ]))
                story.extend([tb, Spacer(1, 12)])
                lines.append(block['text'])
            else:
                story.append(paragraph(block['text'], styles[kind]))
                lines.append(block['text'])
        text_pages.append('\n\n'.join(lines))
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    (ROOT / f'{content_path.stem}_content.md').write_text(normalise('\n\n---\n\n'.join(text_pages)), encoding='utf-8')
    return {
        'content': str(content_path), 'pdf': str(pdf), 'bytes': pdf.stat().st_size,
        'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
        'content_sha256': hashlib.sha256(content_path.read_bytes()).hexdigest(),
        'expected_sections': len(data['pages']), 'section_pages': doc.entries,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('names', nargs='*', default=['full_en', 'team_zh', 'team_en'])
    args = parser.parse_args()
    result = [make_document(ROOT / 'content' / f'{name}.json') for name in args.names]
    (ROOT / 'BUILD_RESULTS.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
