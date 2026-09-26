class_name TitleMenu
extends GameScreen
## The title screen, drawn over a live flyover of the island.

signal start(continue_save: bool)

var _main: VBoxContainer
var _settings: VBoxContainer


func _init() -> void:
	super()
	var grad := TextureRect.new()
	var g := GradientTexture2D.new()
	g.gradient = Gradient.new()
	g.gradient.set_color(0, Color(0, 0, 0, 0.75))
	g.gradient.set_color(1, Color(0, 0, 0, 0.0))
	g.fill_to = Vector2(1, 0)
	grad.texture = g
	grad.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	grad.custom_minimum_size = Vector2(760, 0)
	grad.size = Vector2(760, 1080)
	grad.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	grad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(grad)
	var v := VBoxContainer.new()
	v.position = Vector2(90, 130)
	v.custom_minimum_size = Vector2(430, 0)
	v.add_theme_constant_override("separation", 12)
	add_child(v)
	var t := UITheme.title("Hollowvale", 76)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	v.add_child(t)
	var tag := UITheme.label("Survive the island. Keep the fire burning.\nThe Hollows walk when the sun goes down.", 20, Color(0.85, 0.82, 0.76))
	v.add_child(tag)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 30)
	v.add_child(gap)
	_main = VBoxContainer.new()
	_main.add_theme_constant_override("separation", 10)
	v.add_child(_main)
	if Game.has_save():
		_button("Continue", func() -> void: start.emit(true))
	_button("New game", func() -> void: start.emit(false))
	_button("Settings", func() -> void:
		_main.visible = false
		_settings.visible = true)
	if OS.get_name() != "Web":
		_button("Quit", func() -> void: get_tree().quit())
	_settings = SettingsPanel.build(func() -> void:
		_settings.visible = false
		_main.visible = true)
	_settings.visible = false
	v.add_child(_settings)
	var help := UITheme.label(
		"WASD move · Mouse look · Shift sprint · Space jump/swim up\n" +
		"LMB use / attack / chop · RMB block / aim · E interact · 1-8 / wheel items\n" +
		"Tab crafting · M map · Esc menu", 16, UITheme.DIM)
	help.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	help.position = Vector2(90, -110)
	add_child(help)


func _button(text: String, cb: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(320, 52)
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.add_theme_font_size_override("font_size", 22)
	b.pressed.connect(cb)
	_main.add_child(b)
