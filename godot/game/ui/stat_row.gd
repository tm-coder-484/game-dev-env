class_name StatRow
extends Control
## A row of ten icons for one survival stat, read at a glance like Minecraft's hearts and shanks:
## each icon is 10% and drains in half steps, over a dark silhouette of the empty icon. The row
## shivers when the stat is critical, flashes when it drops sharply (damage), and a wave runs along
## it while the stat regenerates.

@export var icon: Texture2D:
	set(v):
		icon = v
		_empty = _silhouette(v) if v else null
		queue_redraw()
@export var count := 10
@export var icon_size := 24.0
@export var spacing := 1.5
@export var fill_from_right := false ## hunger/thirst drain toward the centre, like Minecraft's shanks
@export var critical := 0.2 ## fraction below which the row shivers

var max_value := 100.0
var _value := 100.0
var _shown := 100.0
var _flash := 0.0
var _wave := -1.0
var _jitter: PackedFloat32Array
var _jitter_t := 0.0
var _empty: Texture2D


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_jitter.resize(10)


func _get_minimum_size() -> Vector2:
	return Vector2(count * (icon_size + spacing), icon_size + 4.0)


func set_value(v: float, regenerating := false) -> void:
	if v < _value - 1.5:
		_flash = 1.0
	if regenerating and _wave < 0.0 and v < max_value - 0.5:
		_wave = 0.0
	_value = v


func _process(delta: float) -> void:
	_shown = move_toward(_shown, _value, maxf(absf(_value - _shown) * 6.0, 4.0) * delta)
	_flash = move_toward(_flash, 0.0, delta * 2.5)
	if _wave >= 0.0:
		_wave += delta * 12.0
		if _wave > count + 3:
			_wave = -1.0
	_jitter_t -= delta
	if _jitter_t <= 0.0:
		_jitter_t = 0.08
		var shiver := _value / max_value < critical
		for i in count:
			_jitter[i] = randf_range(-2.0, 2.0) if shiver else 0.0
	queue_redraw()


func _draw() -> void:
	if icon == null:
		return
	var halves := int(round(_shown / max_value * count * 2.0))
	var src := Vector2(icon.get_width(), icon.get_height())
	var blink := _flash > 0.0 and fmod(_flash * 6.0, 1.0) > 0.5
	for i in count:
		var slot := count - 1 - i if fill_from_right else i
		var x := slot * (icon_size + spacing)
		var y := 2.0 + _jitter[i]
		if _wave >= 0.0 and absf(_wave - i) < 1.0:
			y -= 3.0 * (1.0 - absf(_wave - i))
		var r := Rect2(Vector2(x, y), Vector2(icon_size, icon_size))
		draw_texture_rect(_empty, r, false, Color(1, 1, 1, 0.9) if not blink else Color(1.6, 1.6, 1.6, 1.0))
		var units := clampi(halves - i * 2, 0, 2)
		if units == 2:
			draw_texture_rect(icon, r, false)
		elif units == 1:
			# Half an icon: the half nearest the row's start.
			var half := Rect2(Vector2(src.x * 0.5, 0) if fill_from_right else Vector2.ZERO, Vector2(src.x * 0.5, src.y))
			var dest := Rect2(r.position + Vector2(icon_size * 0.5 if fill_from_right else 0.0, 0), Vector2(icon_size * 0.5, icon_size))
			draw_texture_rect_region(icon, dest, half)


## The "empty" icon: a dark, slightly translucent silhouette of the full one.
static func _silhouette(tex: Texture2D) -> Texture2D:
	var img := tex.get_image()
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	for y in img.get_height():
		for x in img.get_width():
			var c := img.get_pixel(x, y)
			var l := c.get_luminance()
			img.set_pixel(x, y, Color(0.16 + l * 0.14, 0.15 + l * 0.13, 0.14 + l * 0.12, c.a * 0.78))
	return ImageTexture.create_from_image(img)
