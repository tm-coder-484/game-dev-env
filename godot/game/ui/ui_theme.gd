class_name UITheme
## One Theme for every Hollowvale screen: dark translucent panels, thin brass trim, Barlow for text
## and Cinzel for titles (both SIL Open Font License, see game/ui/fonts).

const BRASS := Color(0.78, 0.62, 0.38)
const TEXT := Color(0.93, 0.9, 0.84)
const DIM := Color(0.62, 0.6, 0.56)
const BAD := Color(0.9, 0.35, 0.3)
const GOOD := Color(0.55, 0.85, 0.5)

static var _theme: Theme
static var title_font: Font = preload("res://game/ui/fonts/Cinzel.ttf")
static var body_font: Font = preload("res://game/ui/fonts/Barlow-Medium.ttf")
static var bold_font: Font = preload("res://game/ui/fonts/Barlow-SemiBold.ttf")


static func panel(alpha := 0.82, border := 0.55) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.055, 0.06, 0.065, alpha)
	sb.border_color = Color(BRASS, border)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(6)
	sb.set_content_margin_all(12)
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_size = 8
	return sb


static func get_theme() -> Theme:
	if _theme:
		return _theme
	var t := Theme.new()
	t.default_font = body_font
	t.default_font_size = 18
	t.set_color("font_color", "Label", TEXT)
	t.set_color("font_outline_color", "Label", Color(0, 0, 0, 0.85))
	t.set_constant("outline_size", "Label", 4)
	t.set_stylebox("panel", "PanelContainer", panel())
	t.set_stylebox("panel", "Panel", panel())
	var b := panel(0.75, 0.35)
	b.set_content_margin_all(8)
	b.content_margin_left = 16
	b.content_margin_right = 16
	var bh := b.duplicate() as StyleBoxFlat
	bh.bg_color = Color(0.16, 0.13, 0.09, 0.9)
	bh.border_color = BRASS
	var bp := bh.duplicate() as StyleBoxFlat
	bp.bg_color = Color(0.3, 0.22, 0.12, 0.95)
	var bd := b.duplicate() as StyleBoxFlat
	bd.bg_color = Color(0.05, 0.05, 0.05, 0.5)
	bd.border_color = Color(0.4, 0.4, 0.4, 0.25)
	t.set_stylebox("normal", "Button", b)
	t.set_stylebox("hover", "Button", bh)
	t.set_stylebox("pressed", "Button", bp)
	t.set_stylebox("focus", "Button", bh)
	t.set_stylebox("disabled", "Button", bd)
	t.set_color("font_color", "Button", TEXT)
	t.set_color("font_hover_color", "Button", Color(1.0, 0.92, 0.75))
	t.set_color("font_disabled_color", "Button", Color(0.5, 0.5, 0.5))
	t.set_font("font", "Button", bold_font)
	t.set_font_size("font_size", "Button", 19)
	t.set_stylebox("panel", "TooltipPanel", panel(0.95))
	var sl := StyleBoxFlat.new()
	sl.bg_color = Color(0.2, 0.2, 0.2, 0.8)
	sl.set_content_margin_all(3)
	sl.set_corner_radius_all(3)
	t.set_stylebox("slider", "HSlider", sl)
	var grab := StyleBoxFlat.new()
	grab.bg_color = BRASS
	grab.set_corner_radius_all(3)
	t.set_stylebox("grabber_area", "HSlider", grab)
	t.set_stylebox("grabber_area_highlight", "HSlider", grab)
	_theme = t
	return t


static func label(text: String, size := 18, color := TEXT, font: Font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if font:
		l.add_theme_font_override("font", font)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


static func title(text: String, size := 44) -> Label:
	var l := label(text, size, Color(0.95, 0.88, 0.72), title_font)
	l.add_theme_constant_override("outline_size", 8)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return l
