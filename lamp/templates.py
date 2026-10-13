"""Print-at-100% PDF: general arrangement, cut list, 1:1 layer templates,
side-profile template and the arm bending former.

    python templates.py      # -> out/strata_lamp_templates.pdf
"""
import json
import math
import os
import sys

from reportlab.lib.colors import Color, black, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from params import DEFAULT as p  # noqa: E402

OUT = os.path.join(HERE, "out")
NAMES = {"W": "WALNUT", "P": "YELLOW PINE"}
WOOD = {"W": Color(0.45, 0.30, 0.20), "P": Color(0.93, 0.80, 0.58)}
GREY = Color(0.55, 0.55, 0.55)
LIGHT = Color(0.88, 0.88, 0.88)
WASTE = Color(0.93, 0.93, 0.93)
ACCENT = Color(0.80, 0.15, 0.10)


# ------------------------------------------------------------------ helpers --
class Sheet:
    """Canvas wrapper that draws in model millimetres at a given scale/origin."""

    def __init__(self, c, ox, oy, scale=1.0):
        self.c, self.ox, self.oy, self.s = c, ox, oy, scale

    def P(self, x, y):
        return (self.ox + x * self.s) * mm, (self.oy + y * self.s) * mm

    def line(self, x0, y0, x1, y1):
        self.c.line(*self.P(x0, y0), *self.P(x1, y1))

    def poly(self, pts, close=False, fill=None, stroke=True):
        path = self.c.beginPath()
        path.moveTo(*self.P(*pts[0]))
        for q in pts[1:]:
            path.lineTo(*self.P(*q))
        if close:
            path.close()
        if fill is not None:
            self.c.setFillColor(fill)
        self.c.drawPath(path, stroke=1 if stroke else 0, fill=1 if fill is not None else 0)

    def rect(self, x, y, w, h, fill=None, r=0.0):
        X, Y = self.P(x, y)
        if fill is not None:
            self.c.setFillColor(fill)
        if r > 0:
            self.c.roundRect(X, Y, w * self.s * mm, h * self.s * mm, r * self.s * mm,
                             stroke=1, fill=1 if fill is not None else 0)
        else:
            self.c.rect(X, Y, w * self.s * mm, h * self.s * mm, stroke=1, fill=1 if fill is not None else 0)

    def circle(self, x, y, r, fill=None):
        if fill is not None:
            self.c.setFillColor(fill)
        self.c.circle(*self.P(x, y), r * self.s * mm, stroke=1, fill=1 if fill is not None else 0)

    def text(self, x, y, s, size=7, anchor="l", color=black, bold=False):
        self.c.setFillColor(color)
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        X, Y = self.P(x, y)
        {"l": self.c.drawString, "c": self.c.drawCentredString, "r": self.c.drawRightString}[anchor](X, Y, s)

    def dim(self, x0, y0, x1, y1, off, label, size=6.5):
        """Aligned dimension with extension lines, offset perpendicular by `off` (model mm)."""
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        a0 = (x0 + nx * off, y0 + ny * off)
        a1 = (x1 + nx * off, y1 + ny * off)
        c = self.c
        c.saveState()
        c.setLineWidth(0.25)
        c.setStrokeColor(GREY)
        self.line(x0, y0, a0[0] + nx * 1.5 / self.s * (1 if off > 0 else -1), a0[1] + ny * 1.5 / self.s * (1 if off > 0 else -1))
        self.line(x1, y1, a1[0] + nx * 1.5 / self.s * (1 if off > 0 else -1), a1[1] + ny * 1.5 / self.s * (1 if off > 0 else -1))
        c.setStrokeColor(black)
        self.line(*a0, *a1)
        for (px, py), sgn in ((a0, 1), (a1, -1)):  # arrowheads
            ux, uy = dx / L * sgn, dy / L * sgn
            h = 1.6 / self.s
            self.poly([(px, py), (px + ux * h * 1.6 + nx * h * 0.5, py + uy * h * 1.6 + ny * h * 0.5),
                       (px + ux * h * 1.6 - nx * h * 0.5, py + uy * h * 1.6 - ny * h * 0.5)], close=True, fill=black)
        mx, my = (a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2
        ang = math.degrees(math.atan2(dy, dx))
        if ang > 90 or ang <= -90:
            ang -= 180
        X, Y = self.P(mx, my)
        c.translate(X, Y)
        c.rotate(ang)
        c.setFont("Helvetica", size)
        tw = c.stringWidth(label, "Helvetica", size)
        c.setFillColor(white)
        c.rect(-tw / 2 - 1, -size * 0.35, tw + 2, size * 1.05, stroke=0, fill=1)
        c.setFillColor(black)
        c.drawCentredString(0, -size * 0.3 + 0.5, label)
        c.restoreState()


def dashed(c, on=True, pattern=(3, 2)):
    c.setDash(list(pattern), 0) if on else c.setDash()


def header(c, title, sub, page_w, page_h, scale_bar=True):
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(black)
    c.drawString(12 * mm, page_h - 14 * mm, title)
    c.setFont("Helvetica", 8)
    c.drawString(12 * mm, page_h - 19 * mm, sub)
    if scale_bar:
        x, y = page_w - 12 * mm - 100 * mm, 16 * mm
        c.setLineWidth(0.6)
        c.rect(x, y, 100 * mm, 3 * mm, stroke=1, fill=0)
        for k in range(10):
            if k % 2 == 0:
                c.setFillColor(black)
                c.rect(x + k * 10 * mm, y, 10 * mm, 3 * mm, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(ACCENT)
        c.drawString(x, y + 4.5 * mm, "PRINT AT 100% / ACTUAL SIZE - this bar must measure exactly 100 mm")
        c.setFillColor(black)


def footer(c, page_w, n):
    c.setFont("Helvetica", 6.5)
    c.setFillColor(GREY)
    c.drawString(12 * mm, 7 * mm, "Strata lamp - generated by lamp/templates.py from lamp/params.py. All dimensions mm.")
    c.drawRightString(page_w - 12 * mm, 7 * mm, f"Sheet {n}")
    c.setFillColor(black)


def hatch(s, x0, y0, x1, y1, step=2.5):
    c = s.c
    c.saveState()
    path = c.beginPath()
    path.rect(*s.P(x0, y0), (x1 - x0) * s.s * mm, (y1 - y0) * s.s * mm)
    c.clipPath(path, stroke=0, fill=0)
    c.setLineWidth(0.25)
    c.setStrokeColor(GREY)
    w, h = x1 - x0, y1 - y0
    k = -h
    while k < w:
        s.line(x0 + k, y0, x0 + k + h, y1)
        k += step
    c.restoreState()


# ------------------------------------------------------------------ layers --
def layer_template(c, i, ox, oy):
    s = Sheet(c, ox, oy, 1.0)
    L, W, t = p.board_l, p.board_w, p.board_t
    zb, zt = i * t, (i + 1) * t
    sp = p.layers[i]
    c.setLineWidth(0.3)
    # full board outline (thin) and the finished outline (heavy)
    c.setStrokeColor(GREY)
    dashed(c, True, (1, 1.5))
    s.rect(0, 0, L, W)
    dashed(c, False)
    inset = p.bottom_inset if i == 0 else 0.0
    if i >= 2:  # region the cove removes
        xa, xb = p.x_at_z(zb), p.x_at_z(zt)
        c.setStrokeColor(LIGHT)
        s.rect(0, 0, xa, W, fill=WASTE)
        c.setStrokeColor(GREY)
        dashed(c, True)
        s.line(xa, 0, xa, W)
        s.line(xb, 0, xb, W)
        dashed(c, False)
        s.text(xa / 2, W / 2 + 3, "WASTE", 9, "c", GREY, True)
        s.text(xa / 2, W / 2 - 3, "removed by the cove", 6.5, "c", GREY)
        s.text(xa / 2, W / 2 - 8, "after glue-up", 6.5, "c", GREY)
        s.text((xa + xb) / 2, 3, "cove", 6, "c", GREY)
    c.setStrokeColor(black)
    c.setLineWidth(1.0)
    s.rect(inset, inset, L - 2 * inset, W - 2 * inset, r=p.corner_r - inset)
    c.setLineWidth(0.3)
    # centreline
    c.setStrokeColor(GREY)
    dashed(c, True, (6, 1.5, 1, 1.5))
    s.line(-4, p.mid_y, L + 4, p.mid_y)
    dashed(c, False)
    c.setStrokeColor(black)
    cuts = []
    if i == 0:
        x0, x1, w = p.cavity
        cuts.append((x0, p.mid_y - w / 2, x1, p.mid_y + w / 2, f"POCKET {x1 - x0:.0f} x {w:.0f}"))
        nw = p.cable_d + 2
        cuts.append((x1, p.mid_y - nw / 2, L - inset, p.mid_y + nw / 2, ""))
    if i >= 2:
        sx, sy = p.arm_slot
        cuts.append((p.arm_x - sx / 2, p.mid_y - sy / 2, p.arm_x + sx / 2, p.mid_y + sy / 2, f"ARM {sx:.1f} x {sy:.1f}"))
        rx, ry = p.rem_slot
        in_waste = p.rem_x + rx / 2 < p.x_at_z(zb)
        cuts.append((p.rem_x - rx / 2, p.mid_y - ry / 2, p.rem_x + rx / 2, p.mid_y + ry / 2,
                     f"REMOTE {rx:.1f} x {ry:.1f}" + (" (for the glue-up stick)" if in_waste else "")))
    c.setLineWidth(0.8)
    for x0, y0, x1, y1, label in cuts:
        s.rect(x0, y0, x1 - x0, y1 - y0, fill=white)
        hatch(s, x0, y0, x1, y1)
        s.rect(x0, y0, x1 - x0, y1 - y0)
        if label:
            s.text((x0 + x1) / 2, y1 + 2, label, 6.5, "c", ACCENT, True)
    c.setLineWidth(0.3)
    if i == 0:
        x0, x1, w = p.cavity
        s.text((x0 + x1) / 2, p.mid_y - 2, "controller", 6.5, "c", GREY)
        s.text(L - inset + 2, p.mid_y + 4, "cable", 6, "l", GREY)
        s.dim(0, p.mid_y - w / 2, x0, p.mid_y - w / 2, -(p.mid_y - w / 2) - 6, f"{x0:.0f}")
        s.text(L / 2, inset + 4, f"Trim {p.bottom_inset:.0f} mm off every edge (shadow gap)", 6.5, "c", ACCENT, True)
    if i == 1:
        c.setLineWidth(0.8)
        s.circle(p.arm_x, p.mid_y, p.wire_hole_d / 2, fill=white)
        c.setLineWidth(0.3)
        s.line(p.arm_x - 9, p.mid_y, p.arm_x + 9, p.mid_y)
        s.line(p.arm_x, p.mid_y - 9, p.arm_x, p.mid_y + 9)
        s.text(p.arm_x, p.mid_y + p.wire_hole_d / 2 + 2, f"DRILL {p.wire_hole_d:.0f} THRU", 6.5, "c", ACCENT, True)
        s.dim(0, 0, p.arm_x, 0, -6, f"{p.arm_x:.0f}")
    if i >= 2:
        s.dim(0, 0, p.arm_x, 0, -6, f"{p.arm_x:.0f} to arm slot centre")
        if any("REMOTE" in cc[4] for cc in cuts):
            s.dim(0, W, p.rem_x, W, 6, f"{p.rem_x:.0f} to remote slot centre")
    s.text(-3, W / 2, "FRONT", 7, "r", black, True)
    s.text(L + 3, W - 4, "BACK", 7, "l", black, True)
    c.setFillColor(WOOD[sp])
    c.setStrokeColor(black)
    c.rect(*s.P(0, W + 17), 5 * mm, 5 * mm, stroke=1, fill=1)
    s.text(7, W + 18, f"L{i + 1}  -  {NAMES[sp]}  -  {t:.0f} mm  -  layer {i + 1} of {p.n} (counting up from the desk)",
           9, "l", black, True)
    s.text(7, W + 13.5, "Stick on the TOP face. Cut windows BEFORE gluing (drill inside the corners, coping/scroll saw, file to the line).",
           6.5, "l", GREY)


def side_template(c, ox, oy):
    s = Sheet(c, ox, oy, 1.0)
    L, H, t = p.board_l, p.height, p.board_t
    # layer bands
    for i in range(p.n):
        c.setStrokeColor(GREY)
        c.setLineWidth(0.25)
        s.line(0, i * t, L, i * t)
        s.text(L + 2, i * t + t / 2 - 1.5, f"L{i + 1} {NAMES[p.layers[i]].split()[-1].lower()}", 6)
    # profile: the heavy cut line
    pts = [(p.bottom_inset, 0), (L - p.bottom_inset, 0), (L - p.bottom_inset, t), (L, t), (L, H)]
    x = p.flat_top_from_x
    pts.append((x, H))
    n = 60
    for k in range(1, n + 1):
        xx = p.flat_top_from_x - (p.flat_top_from_x - p.cove_cx) * k / n
        pts.append((xx, p.top_z(xx)))
    pts += [(0, p.low_z), (0, t), (p.bottom_inset, t), (p.bottom_inset, 0)]
    c.setStrokeColor(black)
    c.setLineWidth(1.0)
    s.poly(pts, close=True)
    # waste above the cove
    waste = [(0, p.low_z)] + [(xx, p.top_z(xx)) for xx in
                              [p.cove_cx + (p.flat_top_from_x - p.cove_cx) * k / n for k in range(n + 1)]]
    waste += [(p.flat_top_from_x, H), (0, H)]
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.3)
    s.poly(waste, close=True, fill=WASTE)
    s.text(22, 46, "WASTE - bandsaw 1 mm outside the line,", 7, "l", GREY, True)
    s.text(22, 41, "then sand to it (spindle/drum sander)", 7, "l", GREY, True)
    c.setStrokeColor(black)
    c.setLineWidth(1.0)
    s.poly(pts, close=True)
    # hidden slots / pocket
    c.setLineWidth(0.4)
    dashed(c, True)
    sx, _ = p.arm_slot
    s.rect(p.arm_x - sx / 2, p.low_z, sx, H - p.low_z)
    rx, _ = p.rem_slot
    s.poly([(p.rem_x - rx / 2, p.top_z(p.rem_x - rx / 2)), (p.rem_x - rx / 2, p.low_z),
            (p.rem_x + rx / 2, p.low_z), (p.rem_x + rx / 2, p.top_z(p.rem_x + rx / 2))])
    x0, x1, _ = p.cavity
    s.rect(x0, 0, x1 - x0, t)
    s.line(p.arm_x - p.wire_hole_d / 2, t, p.arm_x - p.wire_hole_d / 2, p.low_z)
    s.line(p.arm_x + p.wire_hole_d / 2, t, p.arm_x + p.wire_hole_d / 2, p.low_z)
    dashed(c, False)
    s.text(p.arm_x, H + 2, "arm", 6.5, "c")
    s.text(p.rem_x - 2, H - 8, "remote", 6.5, "c")
    s.dim(0, H, p.flat_top_from_x, H, 8, f"{p.flat_top_from_x:.0f}")
    s.dim(0, 0, L, 0, -8, f"{L:.0f}")
    s.dim(0, 0, 0, H, 12, f"{H:.0f}")
    s.dim(0, 0, 0, p.low_z, 4, f"{p.low_z:.0f}")
    cx, cz = p.cove_cx, p.cove_cz
    c.setLineWidth(0.25)
    c.setStrokeColor(GREY)
    s.text(6, p.low_z + 8, f"cove R{p.sweep_r:.0f}: centre {cx:.1f} from the front,", 6, "l", GREY)
    s.text(6, p.low_z + 4, f"{cz:.0f} up from the bottom (tangent to the L2 top)", 6, "l", GREY)
    s.text(0, -16, "<  FRONT", 7, "l", black, True)
    s.text(0, H + 14, "SIDE PROFILE - stick on either side of the glued block, bottom edge flush with the desk face", 9, "l", black, True)


# ------------------------------------------------------------------ pages --
def page_ga(c, rep):
    pw, ph = landscape(A4)
    c.setPageSize((pw, ph))
    header(c, "STRATA LAMP - general arrangement", f"Five {p.board_l:.0f} x {p.board_w:.0f} x {p.board_t:.0f} boards laminated "
           f"{'-'.join(p.layers)} (W walnut, P yellow pine), bendable aluminium LED channel, RF remote dock.",
           pw, ph)
    # side elevation 1:4
    sc = 0.25
    s = Sheet(c, 40, 30, sc)
    c.setLineWidth(0.6)
    c.setStrokeColor(black)
    t = p.board_t
    for i in range(p.n):
        zb, zt = i * t, (i + 1) * t
        ins = p.bottom_inset if i == 0 else 0
        x_front = ins if zb < p.low_z else p.x_at_z(zb)
        pts = [(x_front, zb), (p.board_l - ins, zb), (p.board_l - ins, zt)]
        if zt > p.low_z and i >= 2:
            pts.append((p.x_at_z(zt) if zt < p.height else p.flat_top_from_x, zt))
            n = 20
            xa, xb = p.x_at_z(zb), (p.x_at_z(zt) if zt < p.height else p.flat_top_from_x)
            pts += [(xb - (xb - xa) * k / n, p.top_z(xb - (xb - xa) * k / n)) for k in range(1, n + 1)]
        else:
            pts.append((ins, zt))
        s.poly(pts, close=True, fill=WOOD[p.layers[i]])
    # arm: both edges of the channel
    path = p.arm_path(2.0)
    edges = ([], [])
    for k in range(len(path)):
        a, b = path[max(0, k - 1)], path[min(len(path) - 1, k + 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, tz)
        nx, nz = -tz / l, tx / l
        for j, sg in enumerate((1, -1)):
            edges[j].append((path[k][0] + nx * sg * p.ch_d / 2, path[k][1] + nz * sg * p.ch_d / 2))
    c.setLineWidth(0.6)
    s.poly(edges[0] + edges[1][::-1], close=True, fill=Color(0.82, 0.83, 0.85))
    rx = p.rem_t
    s.rect(p.rem_x - rx / 2, p.low_z, rx, p.rem_l, fill=Color(0.97, 0.97, 0.96))
    s.line(-130, -p.foot_h, 230, -p.foot_h)
    top = p.arm_top_z + p.arm_r + p.ch_d / 2
    tip = p.arm_tip
    s.dim(p.board_l, -p.foot_h, p.board_l, top, -150, f"{rep['overall_height_mm']}")
    s.dim(p.arm_x, p.height, p.arm_x, p.arm_top_z, -45, f"straight {p.arm_rise:.0f}")
    cx, cz = p.arm_center
    c.setLineWidth(0.3)
    c.setStrokeColor(GREY)
    dashed(c, True)
    s.line(cx, cz, p.arm_x, cz)
    b = math.radians(p.arm_bend_deg)
    s.line(cx, cz, cx + p.arm_r * math.cos(b), cz + p.arm_r * math.sin(b))
    dashed(c, False)
    s.text(cx + 15, cz + 6, f"R{p.arm_r:.0f}", 7)
    s.text(cx - 30, cz - 16, f"{p.arm_bend_deg:.0f} deg", 7)
    s.text(tip[0] - 8, tip[1] - 20, f"tail {p.arm_tail:.0f}", 7, "r")
    c.setStrokeColor(black)
    s.dim(tip[0], -p.foot_h, 0, -p.foot_h, -36, f"{-tip[0]:.0f} overhang")
    s.dim(0, -p.foot_h, p.board_l, -p.foot_h, -36, f"{p.board_l:.0f}")
    s.text(-120, top + 40, "SIDE ELEVATION  1:4", 9, "l", black, True)

    # plan of the base 1:2
    s2 = Sheet(c, 150, 128, 0.5)
    c.setLineWidth(0.6)
    c.saveState()
    clip = c.beginPath()
    clip.roundRect(*s2.P(0, 0), p.board_l * 0.5 * mm, p.board_w * 0.5 * mm, p.corner_r * 0.5 * mm)
    c.clipPath(clip, stroke=0, fill=0)
    c.setLineWidth(0.3)
    bounds = [0.0] + [p.x_at_z(k * p.board_t) for k in range(2, p.n)] + [p.board_l]
    for k in range(len(bounds) - 1):  # top view: L2 deck, then each layer where the cove exposes it
        s2.rect(bounds[k], 0, bounds[k + 1] - bounds[k], p.board_w, fill=WOOD[p.layers[k + 1]])
    c.restoreState()
    c.setLineWidth(0.6)
    s2.rect(0, 0, p.board_l, p.board_w, r=p.corner_r)
    sx, sy = p.arm_slot
    s2.rect(p.arm_x - sx / 2, p.mid_y - sy / 2, sx, sy, fill=black)
    rx, ry = p.rem_slot
    s2.rect(p.rem_x - rx / 2, p.mid_y - ry / 2, rx, ry, fill=Color(0.25, 0.2, 0.15))
    s2.dim(0, 0, p.board_l, 0, -10, f"{p.board_l:.0f}")
    s2.dim(p.board_l, 0, p.board_l, p.board_w, -10, f"{p.board_w:.0f}")
    s2.text(0, p.board_w + 8, "PLAN OF BASE  1:2   (front on the left)", 9, "l", black, True)

    # cut list + facts
    c.setFont("Helvetica-Bold", 9)
    c.drawString(150 * mm, 112 * mm, "CUT LIST / OPERATIONS")
    rows = [("Layer", "Timber", "Before glue-up")]
    ops = {0: f"trim {p.bottom_inset:.0f} all round; controller pocket + cable notch",
           1: f"drill {p.wire_hole_d:.0f} hole under the arm",
           2: "arm + remote windows", 3: "arm + remote windows",
           4: "arm + remote windows (remote one is waste; it guides the glue-up stick)"}
    for i in range(p.n):
        rows.append((f"L{i + 1}", NAMES[p.layers[i]].title(), ops.get(i, "arm slot window")))
    y = 106
    for k, r in enumerate(rows):
        c.setFont("Helvetica-Bold" if k == 0 else "Helvetica", 7.5)
        c.drawString(150 * mm, y * mm, r[0])
        c.drawString(163 * mm, y * mm, r[1])
        c.drawString(190 * mm, y * mm, r[2])
        y -= 4.6
    facts = [
        f"Channel: {rep['channel_length_mm']} mm total ({rep['embedded_mm']} in the base, {rep['lit_length_mm']} lit). "
        f"Bend {p.bend_start:.0f}-{p.bend_end:.0f} mm from the lead end on the R{p.former_r:.1f} former (sheet 5).",
        f"Slots: arm {p.arm_slot[0]:.1f} x {p.arm_slot[1]:.1f} x {p.height - p.low_z:.0f} deep; "
        f"remote {p.rem_slot[0]:.1f} x {p.rem_slot[1]:.1f}.",
        f"Mass approx.: base {rep['base_g']} g, arm {rep['arm_g']} g, total {rep['total_g']} g. Centre of mass "
        f"{rep['lamp_cg_x_mm'] - rep['front_tip_edge_x_mm']:.0f} mm behind the front feet's front edge.",
        f"Stability: tips forward only past {rep['tip_forward_deg']} deg, backward past {rep['tip_back_deg']} deg.",
        "Glue: PVA, clamp 1 h, cure overnight. Finish: sand 120-180-240, hardwax/Danish oil.",
    ]
    y -= 3
    c.setFont("Helvetica", 7.2)
    for f in facts:
        c.drawString(150 * mm, y * mm, f)
        y -= 4.4
    footer(c, pw, 1)


def page_layers(c, idx, n):
    pw, ph = A4
    c.setPageSize((pw, ph))
    header(c, "STRATA LAMP - 1:1 layer templates", "Cut out along the dotted board outline, stick on with glue stick, front edge left.", pw, ph)
    ys = [158, 30]
    for k, i in enumerate(idx):
        layer_template(c, i, 18, ys[k])
    footer(c, pw, n)


def page_last_layer(c, n):
    pw, ph = A4
    c.setPageSize((pw, ph))
    header(c, "STRATA LAMP - 1:1 top layer + side profile", "Side profile goes on after glue-up; it is the bandsaw line for the cove.", pw, ph)
    layer_template(c, p.n - 1, 18, 158)
    side_template(c, 14, 58)
    footer(c, pw, n)


def page_former(c, n):
    pw, ph = landscape(A4)
    c.setPageSize((pw, ph))
    rf = p.former_target_r
    cut = p.former_r
    header(c, "STRATA LAMP - 1:1 bending former",
           f"Cut from 18 mm MDF/ply on the SOLID line (R{cut:.1f}), screw to a scrap board, bend the channel round it "
           f"with the LED (open) side against the former.", pw, ph)
    cx, cy = pw / mm / 2, 42
    s = Sheet(c, cx, cy, 1.0)
    c.setLineWidth(1.2)
    pts = [(cut * math.cos(math.radians(a)), cut * math.sin(math.radians(a))) for a in range(0, 181)]
    s.poly(pts + [(-cut, -8), (cut, -8)], close=True, fill=Color(0.96, 0.94, 0.9))
    c.setLineWidth(0.4)
    dashed(c, True)
    pts = [(rf * math.cos(math.radians(a)), rf * math.sin(math.radians(a))) for a in range(0, 181)]
    s.poly(pts)
    dashed(c, False)
    s.line(-6, 0, 6, 0)
    s.line(0, -6, 0, 6)
    b = math.radians(p.arm_bend_deg)
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.0)
    s.line(cut * math.cos(b) * 0.9, cut * math.sin(b) * 0.9, (rf + 8) * math.cos(b), (rf + 8) * math.sin(b))
    s.line(cut * 0.9, 0, rf + 8, 0)
    c.setStrokeColor(black)
    s.text(cut * 0.88, 5, "START of bend", 8, "r", ACCENT, True)
    s.text(cut * 0.88, 1, f"{p.bend_start:.0f} mm from the lead (bottom) end", 7, "r", ACCENT)
    ex, ey = cut * 0.86 * math.cos(b), cut * 0.86 * math.sin(b)
    s.text(ex + 2, ey + 2, f"END of bend ({p.arm_bend_deg:.0f} deg)", 8, "l", ACCENT, True)
    s.text(ex + 2, ey - 2.5, f"{p.bend_end:.0f} mm from the lead end, then {p.arm_tail:.0f} mm tail", 7, "l", ACCENT)
    s.text(0, 30, f"Dashed: R{rf:.1f} = where the channel face should settle after springback", 7.5, "c", GREY)
    s.text(0, 24, "If it opens up more than the dashed line, push it a little past and let go again.", 7.5, "c", GREY)
    s.text(0, 15, "Optional: a few layers of thick card taped inside the channel stop the walls kinking.", 7.5, "c", GREY)
    footer(c, pw, n)


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "report.json")) as f:
        rep = json.load(f)
    path = os.path.join(OUT, "strata_lamp_templates.pdf")
    c = Canvas(path, pagesize=A4)
    c.setTitle("Strata lamp templates")
    page_ga(c, rep)
    c.showPage()
    page_layers(c, [0, 1], 2)
    c.showPage()
    page_layers(c, [2, 3], 3)
    c.showPage()
    page_last_layer(c, 4)
    c.showPage()
    page_former(c, 5)
    c.showPage()
    c.save()
    print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()
