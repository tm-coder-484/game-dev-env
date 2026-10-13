"""Strata lamp: every dimension in one place (millimetres).

Edit the MEASURE-ME values to match your parts, then rerun the build script
(make_lamp.bat on Windows, `make lamp` on Linux/macOS). Everything else
(STEP files, print templates, renders, masses) is derived from this file.

Axes: x runs front (0) to back (180), y across the width (0..92), z up from the
desk. The lamp arm bends in the x-z plane and leans forward over the base.
"""
from dataclasses import dataclass, field
import math


@dataclass
class P:
    # --- Timber: the board from Yellow.ipt / Lamp.ipt (18.0 x 9.2 x 1.2 cm) ---
    board_l: float = 180.0
    board_w: float = 92.0
    board_t: float = 12.0
    # Bottom layer first. W = walnut, P = yellow pine. Any 5 boards work;
    # alternating species gives the striped "strata" look.
    layers: tuple = ("W", "P", "W", "P", "W")
    corner_r: float = 14.0          # plan-view corner radius
    bottom_inset: float = 5.0       # bottom layer is trimmed this much all round (shadow gap)

    # --- Sweep: concave cove cut into the top three layers (side profile) ---
    sweep_r: float = 100.0          # radius of the cove
    flat_top_from_x: float = 125.0  # the full-height flat top starts here

    # --- Aluminium LED channel (MEASURE-ME) ---
    # Bendable profiles are 17-19 mm wide x 5.7-7 mm deep (Penn Elcom LEDAL36,
    # Linearlux 1907, Superlighting C-channel). Sized for the largest; a smaller
    # channel just gets a thicker epoxy line.
    ch_w: float = 18.9              # outside width (across the LEDs)
    ch_d: float = 7.0               # outside depth (back to diffuser face)
    ch_wall: float = 1.1
    ch_clear: float = 0.3           # clearance each side in the base slot
    ch_kg_per_m: float = 0.20       # with diffuser + strip (weigh an offcut to check)
    arm_x: float = 154.0            # arm slot centre (from front)
    arm_rise: float = 360.0         # straight vertical length above the base top
    arm_r: float = 120.0            # bend radius to the channel centreline (bendable profiles: R100 min)
    arm_bend_deg: float = 160.0     # how far the arm curls over
    arm_tail: float = 50.0          # straight tail after the bend

    # --- RF remote (MEASURE-ME) ---
    rem_l: float = 86.0             # 17-key mini RF remote: 86 x 40 x 7 (85 x 40 x 6 on some)
    rem_w: float = 40.0
    rem_t: float = 7.0
    rem_clear: float = 0.75         # each side
    rem_x: float = 105.0            # slot centre (from front)

    # --- Inline USB controller (MEASURE-ME) ---
    ctl_l: float = 50.0             # not published anywhere; fits up to 50 x 22 x 11
    ctl_w: float = 22.0
    ctl_h: float = 10.0
    cable_d: float = 5.0
    cav_x0: float = 108.0           # cavity in the bottom layer starts here
    wire_hole_d: float = 12.0       # hole in layer 2 under the arm, for the LED lead

    # --- Feet ---
    foot_d: float = 15.0
    foot_h: float = 3.0

    # --- Densities, g/cm^3 ---
    rho: dict = field(default_factory=lambda: {"W": 0.64, "P": 0.55, "Al": 2.70, "PC": 1.20})

    # ---------------------------------------------------------------- derived
    @property
    def n(self) -> int:
        return len(self.layers)

    @property
    def height(self) -> float:
        return self.n * self.board_t

    @property
    def low_z(self) -> float:
        """Height of the low front deck: the top of layer 2."""
        return 2 * self.board_t

    @property
    def cove_rise(self) -> float:
        return self.height - self.low_z

    @property
    def cove_cx(self) -> float:
        """x of the cove circle's centre; the cove leaves the low deck tangentially here."""
        r, h = self.sweep_r, self.cove_rise
        return self.flat_top_from_x - math.sqrt(r * r - (r - h) ** 2)

    @property
    def cove_cz(self) -> float:
        return self.low_z + self.sweep_r

    def top_z(self, x: float) -> float:
        """Top surface height of the base at x (side profile)."""
        if x <= self.cove_cx:
            return self.low_z
        if x >= self.flat_top_from_x:
            return self.height
        dx = x - self.cove_cx
        return self.cove_cz - math.sqrt(self.sweep_r ** 2 - dx * dx)

    def x_at_z(self, z: float) -> float:
        """Inverse of top_z on the cove (where each glue line meets the curve)."""
        dz = self.cove_cz - z
        return self.cove_cx + math.sqrt(self.sweep_r ** 2 - dz * dz)

    @property
    def mid_y(self) -> float:
        return self.board_w / 2

    @property
    def arm_slot(self) -> tuple:
        """(size_x, size_y) of the arm slot. The LED face points to -x (forward)."""
        return (self.ch_d + 2 * self.ch_clear, self.ch_w + 2 * self.ch_clear)

    @property
    def rem_slot(self) -> tuple:
        return (self.rem_t + 2 * self.rem_clear, self.rem_w + 2 * self.rem_clear)

    @property
    def cavity(self) -> tuple:
        """(x0, x1, width) of the controller pocket in the bottom layer."""
        w = self.ctl_w + 6
        x1 = self.board_l - self.bottom_inset - 7
        return (self.cav_x0, x1, w)

    @property
    def arm_top_z(self) -> float:
        return self.height + self.arm_rise

    @property
    def arm_center(self) -> tuple:
        """(x, z) of the bend centre."""
        return (self.arm_x - self.arm_r, self.arm_top_z)

    def arm_path(self, step: float = 2.0):
        """Centreline points from the bottom of the slot to the tip, with arc length."""
        pts = []
        z0 = self.low_z
        n = max(2, int((self.arm_top_z - z0) / step))
        for i in range(n):
            z = z0 + (self.arm_top_z - z0) * i / n
            pts.append((self.arm_x, z))
        cx, cz = self.arm_center
        b = math.radians(self.arm_bend_deg)
        n = max(2, int(self.arm_r * b / step))
        for i in range(n):
            t = b * i / n
            pts.append((cx + self.arm_r * math.cos(t), cz + self.arm_r * math.sin(t)))
        ex, ez = cx + self.arm_r * math.cos(b), cz + self.arm_r * math.sin(b)
        tx, tz = -math.sin(b), math.cos(b)
        n = max(2, int(self.arm_tail / step))
        for i in range(n + 1):
            s = self.arm_tail * i / n
            pts.append((ex + tx * s, ez + tz * s))
        return pts

    @property
    def arm_tip(self) -> tuple:
        return self.arm_path()[-1]

    @property
    def channel_length(self) -> float:
        return (self.arm_top_z - self.low_z) + self.arm_r * math.radians(self.arm_bend_deg) + self.arm_tail

    @property
    def lit_length(self) -> float:
        """Visible channel above the base (where the LED strip goes)."""
        return self.channel_length - (self.height - self.low_z)


DEFAULT = P()
