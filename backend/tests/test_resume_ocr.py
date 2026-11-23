"""A PDF that is only a picture of a résumé (backend/candidates/parse.py; decided 2026-11-17, Q108): pdfplumber finds
no text, so RapidOCR reads the first pages; its boxes come back as lines in reading order; a PDF with text never
reaches OCR; an OCR failure or too little text is the same 422 as before. The engine is faked except in the last test,
which draws made-up text into an image PDF and reads it for real (skipped where RapidOCR isn't installed)."""
import io

import pytest
from fastapi import HTTPException

from backend.candidates import parse as parser
from backend.tests.test_resume_parse import _pdf

LINES = ["Senior Java Developer", "Austin, TX | candidate@example.test", "Experience: Example Payments Inc., 2021 - Present",
         "Skills: Java, Spring Boot, Kafka, AWS, PostgreSQL"]


def _box(left, top, words, height=20):
    return [[left, top], [left + 100, top], [left + 100, top + height], [left, top + height]], words, 0.9


@pytest.fixture
def engine(monkeypatch):
    """A fake RapidOCR: answers `engine.boxes` for each page it is shown and counts the pages."""
    class Fake:
        boxes = [_box(300, 52, "Senior Java Developer"), _box(10, 50, "Candidate Name"), _box(10, 100, LINES[2]),
                 _box(10, 150, LINES[3])]
        pages = 0

        def __call__(self, image):
            assert image.mode == "RGB"
            self.pages += 1
            return self.boxes, [0.1]
    fake = Fake()
    monkeypatch.setattr(parser, "_ocr_engine", fake)
    return fake


def _picture_pdf(pages=1, lines=LINES) -> bytes:
    """An image-only PDF: the lines drawn into a picture, no text layer."""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.load_default(size=36)
    images = []
    for _ in range(pages):
        image = Image.new("RGB", (1700, 2200), "white")
        draw = ImageDraw.Draw(image)
        for i, line in enumerate(lines):
            draw.text((120, 150 + i * 90), line, fill="black", font=font)
        images.append(image)
    out = io.BytesIO()
    images[0].save(out, format="PDF", save_all=True, append_images=images[1:], resolution=200)
    return out.getvalue()


def test_boxes_become_lines_top_to_bottom_left_to_right():
    boxes = [_box(300, 52, "B"), _box(10, 50, "A"), _box(10, 100, "C"), _box(10, 1, "  "), _box(200, 103, "D")]
    assert parser.ocr_lines(boxes) == ["A B", "C D"]
    assert parser.ocr_lines(None) == []


def test_a_picture_pdf_is_read_by_ocr_first_pages_only(engine):
    text = parser.extract_text("pdf", _picture_pdf(pages=parser.OCR_MOST_PAGES + 2))
    assert text.startswith("Candidate Name Senior Java Developer\n" + LINES[2])
    assert engine.pages == parser.OCR_MOST_PAGES


def test_a_pdf_with_text_never_reaches_ocr(engine):
    parser.extract_text("pdf", _pdf("\n".join(LINES)))
    assert engine.pages == 0


def test_an_ocr_failure_or_too_little_text_is_refused_as_before(engine, monkeypatch, caplog):
    engine.boxes = [_box(10, 10, "Name")]
    with pytest.raises(HTTPException, match="no readable text, even read as an image"):
        parser.extract_text("pdf", _picture_pdf())

    def broken(image):
        raise RuntimeError("model missing")
    monkeypatch.setattr(parser, "_ocr_engine", broken)
    with pytest.raises(HTTPException, match="no readable text"):
        parser.extract_text("pdf", _picture_pdf())
    assert "Résumé OCR failed RuntimeError" in caplog.text
    assert "Java" not in caplog.text                                          # never the résumé's text


def test_the_real_engine_reads_a_picture_pdf(monkeypatch):
    pytest.importorskip("rapidocr_onnxruntime")
    monkeypatch.setattr(parser, "_ocr_engine", None)
    text = parser.extract_text("pdf", _picture_pdf())
    for word in ("Java", "Spring", "Kafka", "Austin"):
        assert word in text
