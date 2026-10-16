#!/usr/bin/env python3
"""Render the dated, public-safe Markdown assessment to PDF.

Run from any directory after installing requirements-report.txt.
This renderer does not read application data or environment credentials.
"""
from pathlib import Path
import re
from html import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether,
)

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "security-review-2026-10-16.md"
OUTPUT = SOURCE.with_suffix(".pdf")
NAVY = colors.HexColor("#142C45")
TEAL = colors.HexColor("#087F83")
GREY = colors.HexColor("#526170")
LIGHT = colors.HexColor("#E9F2F4")
WIDTH, HEIGHT = A4
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="BodyReview", fontName="Helvetica", fontSize=9,
                          leading=13.1, textColor=NAVY, spaceAfter=7,
                          splitLongWords=True, alignment=TA_LEFT))
styles.add(ParagraphStyle(name="SectionReview", parent=styles["BodyReview"],
                          fontName="Helvetica-Bold", fontSize=16, leading=20,
                          spaceBefore=17, spaceAfter=12, keepWithNext=True))
styles.add(ParagraphStyle(name="FindingReview", parent=styles["BodyReview"],
                          fontName="Helvetica-Bold", fontSize=11, leading=15,
                          textColor=TEAL, spaceBefore=15, spaceAfter=8, keepWithNext=True))
styles.add(ParagraphStyle(name="BulletReview", parent=styles["BodyReview"],
                          leftIndent=10, firstLineIndent=-7, spaceAfter=6))
styles.add(ParagraphStyle(name="CoverTitle", fontName="Helvetica-Bold", fontSize=36,
                          leading=42, textColor=NAVY, spaceAfter=22))
styles.add(ParagraphStyle(name="CoverSub", parent=styles["BodyReview"], fontSize=17,
                          leading=23, textColor=TEAL, spaceAfter=18))
styles.add(ParagraphStyle(name="SmallReview", parent=styles["BodyReview"], fontSize=8,
                          leading=11, textColor=GREY))


def inline(text):
    text = escape(text)
    text = re.sub(r"`([^`]+)`", r'<font name="Courier" size="8">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    return text


class ReviewDoc(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name in ("SectionReview", "FindingReview"):
            title = flowable.getPlainText()
            key = f"heading-{self.seq.nextf('heading')}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key,
                                      level=0 if flowable.style.name == "SectionReview" else 1,
                                      closed=False)


def chrome(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(TEAL)
    canvas.setLineWidth(2)
    canvas.line(19*mm, HEIGHT-15*mm, WIDTH-19*mm, HEIGHT-15*mm)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(NAVY)
    canvas.drawString(19*mm, HEIGHT-12*mm, "BRAINYKIDS  /  SECURITY REVIEW")
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(GREY)
    canvas.drawString(19*mm, 12*mm, "16 OCT 2026  |  Baseline 9452412  |  Findings remain open")
    canvas.drawRightString(WIDTH-19*mm, 12*mm, f"{doc.page}")
    canvas.restoreState()


def render():
    doc = ReviewDoc(str(OUTPUT), pagesize=A4, leftMargin=19*mm, rightMargin=19*mm,
                    topMargin=24*mm, bottomMargin=22*mm,
                    title="BrainyKids Security Implementation Review | 16 October 2026",
                    author="BrainyKids repository security review",
                    subject="Evidence-based security gaps, reasons, impact and implementation acceptance criteria")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id="Review", frames=frame, onPage=chrome))
    story = [Spacer(1, 26*mm),
             Paragraph("BrainyKids", styles["CoverTitle"]),
             Paragraph("Security implementation<br/>review &amp; action plan", styles["CoverSub"]),
             Paragraph("16 October 2026  /  Source and evidence review", styles["BodyReview"]),
             Spacer(1, 10*mm)]
    stats = Table([[Paragraph("<b>24</b><br/>implementation actions", styles["BodyReview"]),
                    Paragraph("<b>12</b><br/>pre-launch P0 gates", styles["BodyReview"]),
                    Paragraph("<b>10</b><br/>isolated evidence probes", styles["BodyReview"])]],
                  colWidths=[doc.width/3]*3)
    stats.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), LIGHT),
                               ("BOX", (0,0), (-1,-1), .5, TEAL),
                               ("VALIGN", (0,0), (-1,-1), "TOP"),
                               ("TOPPADDING", (0,0), (-1,-1), 12),
                               ("BOTTOMPADDING", (0,0), (-1,-1), 6)]))
    story.extend([stats, Spacer(1, 12*mm),
                  Paragraph("<b>Launch decision</b><br/>Close the P0 trust-boundary, privacy and business-integrity gaps before public multi-family production use.", styles["BodyReview"]),
                  Spacer(1, 5*mm),
                  Paragraph("Prepared against commit <b>9452412</b> using the supplied five-check security guide, repository source, the existing behavioural report and local validation.", styles["BodyReview"]),
                  Paragraph("Documentation-only assessment. No application fixes or production penetration tests are represented as completed. No real credentials or child identifiers are reproduced here.", styles["SmallReview"]),
                  Spacer(1, 8*mm),
                  Paragraph("Reading guide: scope and report comparison; five-check scorecard; data-flow map; 24 prioritized findings with evidence, reason, impact, fix and acceptance criteria; validation and release gates. PDF bookmarks provide section and finding navigation.", styles["SmallReview"]),
                  PageBreak()])
    finding = []

    def flush_finding():
        if finding:
            story.append(KeepTogether(finding.copy()))
            finding.clear()

    paragraphs = re.split(r"\n\s*\n", SOURCE.read_text(encoding="utf-8").strip())
    for block in paragraphs:
        if block.startswith("# "):
            continue
        if block.startswith("## "):
            flush_finding()
            title = block[3:].strip()
            if title.startswith(("5.", "6.", "7.", "8.")):
                story.append(PageBreak())
            story.append(Paragraph(inline(title), styles["SectionReview"]))
        elif block.startswith("### "):
            flush_finding()
            finding.append(Paragraph(inline(block[4:].strip()), styles["FindingReview"]))
        elif block.startswith("- "):
            for line in block.splitlines():
                if line.startswith("- "):
                    story.append(Paragraph("&#8226; " + inline(line[2:]), styles["BulletReview"]))
                else:
                    raise ValueError(f"Unexpected list continuation: {line}")
        else:
            target = finding if finding else story
            target.append(Paragraph(inline(" ".join(block.splitlines())), styles["BodyReview"]))
    flush_finding()
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    render()
