"""Strata lamp CAD: builds the five board layers, the bent LED arm and props,
then writes STEP (opens in Inventor/Fusion/Onshape), STL and a mass/stability report.

    python strata_lamp.py            # -> out/step/*.step, out/strata_lamp.stl, out/stl/ (for render.py), out/report.json

Needs `pip install build123d`. Dimensions come from params.py.
"""
import json
import math
import os
import sys

from build123d import (Axis, Box, BuildLine, BuildSketch, CenterArc, Color, Compound, Cylinder,
                       Line, Plane, Pos, Rectangle, RectangleRounded, Unit, export_step, export_stl,
                       extrude, fillet, make_face, revolve)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from params import DEFAULT as p  # noqa: E402

OUT = os.path.join(HERE, "out")
STAMP = "2026-10-13T00:00:00"  # fixed, so rebuilding unchanged parts gives identical STEP files
SPECIES = {"W": ("walnut", Color(0.33, 0.20, 0.12)), "P": ("pine", Color(0.90, 0.72, 0.45))}


def cove_cutter():
    """Solid that removes everything above the cove (side profile extruded across the width)."""
    end = math.degrees(math.atan2(p.height - p.cove_cz, p.flat_top_from_x - p.cove_cx)) % 360
    top = p.height + 5
    with BuildSketch(Plane.XZ) as sk:
        with BuildLine():
            arc = CenterArc((p.cove_cx, p.cove_cz), p.sweep_r, 270, end - 270)
            Line(arc @ 1, (p.flat_top_from_x, top))
            Line((p.flat_top_from_x, top), (-10, top))
            Line((-10, top), (-10, p.low_z))
            Line((-10, p.low_z), arc @ 0)
        make_face()
    return extrude(sk.sketch, amount=p.board_w + 20, both=True)


def layer(i: int):
    t, z0 = p.board_t, i * p.board_t
    inset = p.bottom_inset if i == 0 else 0.0
    plan = RectangleRounded(p.board_l - 2 * inset, p.board_w - 2 * inset, p.corner_r - inset)
    s = Pos(p.board_l / 2, p.board_w / 2, z0) * extrude(plan, t)
    zc = z0 + t / 2
    if i == 0:  # controller pocket + cable notch to the back edge
        x0, x1, w = p.cavity
        s -= Pos((x0 + x1) / 2, p.mid_y, zc) * Box(x1 - x0, w, t + 2)
        s -= Pos((x1 + p.board_l) / 2, p.mid_y, zc) * Box(p.board_l - x1 + 2, p.cable_d + 2, t + 2)
    if i == 1:  # hole for the LED lead under the arm
        s -= Pos(p.arm_x, p.mid_y, zc) * Cylinder(p.wire_hole_d / 2, t + 2)
    if i >= 2:  # arm slot, remote slot, cove
        sx, sy = p.arm_slot
        s -= Pos(p.arm_x, p.mid_y, zc) * Box(sx, sy, t + 2)
        rx, ry = p.rem_slot
        s -= Pos(p.rem_x, p.mid_y, zc) * Box(rx, ry, t + 2)
        s -= cove_cutter()
    if i == p.n - 1:  # soften the top edges of the flat top
        try:
            top_edges = s.edges().group_by(Axis.Z)[-1]
            s = fillet(top_edges, 1.5)
        except Exception as e:  # cosmetic only
            print("  (top fillet skipped:", e, ")")
    s.label = f"L{i + 1}_{SPECIES[p.layers[i]][0]}"
    s.color = SPECIES[p.layers[i]][1]
    return s


def along_arm(face, z_start: float):
    """Sweep a cross-section (drawn in XY at the origin, path heading +z) along the arm."""
    axis = Axis((p.arm_center[0], p.mid_y, p.arm_top_z), (0, -1, 0))
    straight = Pos(p.arm_x, p.mid_y, z_start) * extrude(face, p.arm_top_z - z_start)
    top_face = Pos(p.arm_x, p.mid_y, p.arm_top_z) * face
    arc = revolve(top_face, axis, p.arm_bend_deg)
    tail = (Pos(p.arm_x, p.mid_y, p.arm_top_z) * extrude(face, p.arm_tail)).rotate(axis, p.arm_bend_deg)
    return straight + arc + tail


def channel_section():
    """U-channel: closed back at +x, open (LED) face toward -x, i.e. inside the bend."""
    outer = Rectangle(p.ch_d, p.ch_w)
    inner = Pos(-p.ch_wall / 2 - 0.5, 0) * Rectangle(p.ch_d - p.ch_wall + 1, p.ch_w - 2 * p.ch_wall)
    return outer - inner


def arm_parts():
    chan = along_arm(channel_section(), p.low_z)
    chan.label, chan.color = "aluminium_channel", Color(0.78, 0.79, 0.80)
    diff_w = p.ch_w - 2 * p.ch_wall - 0.2
    diffuser = along_arm(Pos(-p.ch_d / 2 + 0.9, 0) * Rectangle(1.2, diff_w), p.height + 0.5)
    diffuser.label, diffuser.color = "diffuser_led", Color(0.95, 0.97, 1.0)
    return chan, diffuser


def remote_parts():
    """17-key RF remote standing in its slot, buttons facing the front."""
    body = Pos(p.rem_x, p.mid_y, p.low_z + p.rem_l / 2) * Box(p.rem_t, p.rem_w, p.rem_l)
    try:
        body = fillet(body.edges().filter_by(Axis.X), 3.0)
    except Exception:
        pass
    body.label, body.color = "remote_body", Color(0.94, 0.94, 0.93)
    face_x = p.rem_x - p.rem_t / 2
    top = p.low_z + p.rem_l

    def key(col, row, d=7.0):
        y = p.mid_y + (col - 1) * 11.0
        z = top - 12 - row * 9.0
        return Pos(face_x - 0.4, y, z) * Cylinder(d / 2, 1.2, rotation=(0, 90, 0))

    grey = [key(c, r) for r in range(1, 5) for c in range(3)]
    colours = [("red", (0.85, 0.12, 0.10)), ("green", (0.10, 0.70, 0.20)), ("blue", (0.10, 0.25, 0.85)),
               ("yellow", (0.95, 0.80, 0.10)), ("cyan", (0.10, 0.75, 0.85)), ("purple", (0.60, 0.15, 0.75))]
    parts = [body]
    g = Compound(children=grey)
    g.label, g.color = "remote_keys", Color(0.35, 0.35, 0.37)
    parts.append(g)
    for k, (name, rgb) in enumerate(colours):
        b = key(k % 3, 5 + k // 3, 7.5)
        b.label, b.color = f"remote_key_{name}", Color(*rgb)
        parts.append(b)
    power = Pos(face_x - 0.4, p.mid_y - 11, top - 10) * Cylinder(3.5, 1.2, rotation=(0, 90, 0))
    power.label, power.color = "remote_key_power", Color(0.85, 0.12, 0.10)
    parts.append(power)
    return parts


def controller():
    x0, x1, _ = p.cavity
    c = Pos((x0 + x1) / 2, p.mid_y, p.ctl_h / 2 + 0.5) * Box(p.ctl_l, p.ctl_w, p.ctl_h)
    c.label, c.color = "usb_controller", Color(0.08, 0.08, 0.09)
    return c


def feet():
    fs = []
    m = p.bottom_inset + 13
    for x in (m, p.board_l - m):
        for y in (m, p.board_w - m):
            fs.append(Pos(x, y, -p.foot_h / 2) * Cylinder(p.foot_d / 2, p.foot_h))
    f = Compound(children=fs)
    f.label, f.color = "cork_feet", Color(0.55, 0.42, 0.30)
    return f, m


def report(layers, chan, rem_body, foot_margin):
    rows, mass, mx, mz = [], 0.0, 0.0, 0.0
    for i, s in enumerate(layers):
        g = s.volume / 1000 * p.rho[p.layers[i]]
        c = s.center()
        rows.append({"layer": f"L{i + 1}", "species": SPECIES[p.layers[i]][0], "grams": round(g, 1),
                     "cut_away_pct": round(100 * (1 - s.volume / (p.board_l * p.board_w * p.board_t)), 1)})
        mass += g
        mx += g * c.X
        mz += g * c.Z
    base_g = mass
    # arm: uniform line mass along the centreline above the slot bottom
    pts = p.arm_path(1.0)
    seg = [(math.dist(a, b), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(pts, pts[1:])]
    length = sum(s[0] for s in seg)
    arm_g = length / 1000 * p.ch_kg_per_m * 1000
    ax = sum(s[0] * s[1] for s in seg) / length
    az = sum(s[0] * s[2] for s in seg) / length
    rem_g = 25.0
    mass += arm_g + rem_g
    mx += arm_g * ax + rem_g * p.rem_x
    mz += arm_g * az + rem_g * (p.low_z + p.rem_l / 2)
    cgx, cgz = mx / mass, mz / mass + p.foot_h
    front_edge = foot_margin - p.foot_d / 2
    back_edge = p.board_l - front_edge
    tip_fwd = math.degrees(math.atan2(cgx - front_edge, cgz))
    tip_back = math.degrees(math.atan2(back_edge - cgx, cgz))
    # sideways push at the arm tip that would just lift the back feet
    tip_x, tip_z = p.arm_tip
    push_n = mass / 1000 * 9.81 * (cgx - front_edge) / (tip_z + p.foot_h)
    r = {
        "board": [p.board_l, p.board_w, p.board_t], "layers": rows,
        "base_g": round(base_g), "arm_g": round(arm_g), "remote_g": rem_g, "total_g": round(mass),
        "overall_height_mm": round(p.arm_top_z + p.arm_r + p.ch_w * 0 + p.ch_d / 2 + p.foot_h),
        "arm_tip_overhang_mm": round(-tip_x), "channel_length_mm": round(p.channel_length),
        "lit_length_mm": round(p.lit_length), "embedded_mm": round(p.height - p.low_z),
        "arm_cg_x_mm": round(ax, 1), "lamp_cg_x_mm": round(cgx, 1), "lamp_cg_z_mm": round(cgz, 1),
        "front_tip_edge_x_mm": front_edge, "tip_forward_deg": round(tip_fwd, 1),
        "tip_back_deg": round(tip_back, 1), "push_at_tip_to_tip_forward_N": round(push_n, 2),
        "former_cut_radius_mm": round(p.former_r, 1),
        "bend_start_mm_from_lead_end": round(p.bend_start), "bend_end_mm_from_lead_end": round(p.bend_end),
        "cove_meets_glue_lines_x": {f"z{int(z)}": round(p.x_at_z(z), 1) for z in (36, 48, 60)},
        "cove_tangent_x": round(p.cove_cx, 1),
    }
    return r


def main():
    os.makedirs(os.path.join(OUT, "step"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "stl"), exist_ok=True)
    print("Building layers ...")
    layers = [layer(i) for i in range(p.n)]
    print("Building arm ...")
    chan, diffuser = arm_parts()
    rem = remote_parts()
    ctl = controller()
    ft, foot_margin = feet()

    for s in layers:
        export_step(s, os.path.join(OUT, "step", f"{s.label}.step"), unit=Unit.MM, timestamp=STAMP)
    export_step(chan, os.path.join(OUT, "step", "arm_channel.step"), unit=Unit.MM, timestamp=STAMP)
    base = Compound(children=layers)
    base.label = "base"
    asm = Compound(children=[base, chan, diffuser, Compound(children=rem, label="remote"), ctl, ft])
    asm.label = "strata_lamp"
    export_step(asm, os.path.join(OUT, "step", "strata_lamp_assembly.step"), unit=Unit.MM, timestamp=STAMP)

    stl = {s.label: s for s in layers}
    stl.update({"channel": chan, "diffuser": diffuser, "controller": ctl, "feet": ft})
    for part in rem:
        stl[part.label] = part
    for name, s in stl.items():
        export_stl(s, os.path.join(OUT, "stl", f"{name}.stl"), tolerance=0.02, angular_tolerance=0.08)

    # one-piece model for quick previews (GitHub shows .stl files in 3D)
    export_stl(Compound(layers + [chan, rem[0], ft]), os.path.join(OUT, "strata_lamp.stl"),
               tolerance=0.05, angular_tolerance=0.15)

    r = report(layers, chan, rem[0], foot_margin)
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(r, f, indent=2)
    bb = asm.bounding_box(optimal=True)
    print(f"Assembly bbox x {bb.min.X:.1f}..{bb.max.X:.1f}  y {bb.min.Y:.1f}..{bb.max.Y:.1f}  "
          f"z {bb.min.Z:.1f}..{bb.max.Z:.1f}")
    print(json.dumps(r, indent=2))
    print("Wrote", os.path.relpath(OUT))


if __name__ == "__main__":
    main()
