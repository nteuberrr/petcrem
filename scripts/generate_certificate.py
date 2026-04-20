from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
import sys, json, os

BG_COLOR     = HexColor('#FBEFF0')
BORDER_COLOR = HexColor('#D4A84E')
NAVY         = HexColor('#1F3864')
BLACK        = HexColor('#000000')
W, H = A4

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'public', 'certificates')

def build_certificate(output_path: str, data: dict):
    c = canvas.Canvas(output_path, pagesize=A4)

    # Fondo
    c.setFillColor(BG_COLOR)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Borde dorado
    c.setStrokeColor(BORDER_COLOR)
    c.setLineWidth(1.5)
    c.rect(15, 15, W - 30, H - 30, fill=0, stroke=1)

    # Logo principal centrado
    logo_path = os.path.join(ASSETS, 'alma_animal_logo.png')
    logo_w, logo_h = 198, 248
    c.drawImage(logo_path, (W - logo_w) / 2, H - 304.72,
                width=logo_w, height=logo_h, mask='auto')

    # Título
    c.setFont('Helvetica-Bold', 22)
    c.setFillColor(NAVY)
    c.drawCentredString(W / 2, H - 345, 'CERTIFICADO DE CREMACI\xd3N')

    # Campos con etiqueta, valor y subrayado
    fields = [
        ('Nombre:',               data.get('nombre_mascota', ''),  385.9, 148.0),
        ('Especie:',              data.get('especie', ''),          421.4, 148.0),
        ('Fecha de cremaci\xf3n:', data.get('fecha_cremacion', ''), 456.8, 214.0),
        ('Tutor:',                data.get('nombre_tutor', ''),    492.2, 133.0),
        ('C\xf3digo:',            data.get('codigo', ''),           527.6, 143.0),
    ]

    for label, value, y_top, ul_x in fields:
        y = H - y_top - 12
        c.setFont('Helvetica', 12)
        c.setFillColor(NAVY)
        c.drawString(85, y, label)
        c.setFillColor(BLACK)
        c.drawString(85 + c.stringWidth(label, 'Helvetica', 12) + 8, y, value)
        c.setStrokeColor(BLACK)
        c.setLineWidth(0.5)
        c.line(ul_x, y - 3, 510, y - 3)

    # Texto del cuerpo
    c.setFont('Helvetica', 12)
    c.setFillColor(NAVY)
    c.drawCentredString(W / 2, H - 574.4 - 12,
        'La presente certifica que la mascota fue recibida y cremada en nuestras instalaciones')
    c.drawCentredString(W / 2, H - 590.4 - 12,
        'bajo un proceso respetuoso y profesional.')

    # Sello circular inferior derecho
    sello_path = os.path.join(ASSETS, 'alma_animal_sello.png')
    c.drawImage(sello_path, 432.87, H - 798.54,
                width=130, height=130, mask='auto')

    # Footer
    c.setFont('Helvetica', 10)
    c.setFillColor(NAVY)
    c.drawCentredString(W / 2 - 30, H - 714.9 - 10, 'Alma Animal')
    c.drawCentredString(W / 2 - 30, H - 728.9 - 10, 'Huellas que no se borran')

    c.save()

if __name__ == '__main__':
    # Reads JSON from a temp file path (argv[1]) to avoid shell quoting issues
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)
    build_certificate(sys.argv[2], data)
