class_name SettingsPanel
## Settings controls shared by the pause menu and the title screen.


static func build(on_back: Callable) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	var s := Game.settings

	var q := OptionButton.new()
	for name in ["Low (Web / laptops)", "Medium", "High", "Ultra"]:
		q.add_item(name)
	q.selected = int(s.quality)
	q.item_selected.connect(func(i: int) -> void:
		s.quality = i
		Game.save_settings())
	_row(v, "Graphics", q)

	_row(v, "Mouse sensitivity", _slider(0.2, 3.0, s.mouse_sensitivity, func(x: float) -> void:
		s.mouse_sensitivity = x
		Game.save_settings()))
	_row(v, "Field of view", _slider(60.0, 100.0, s.fov, func(x: float) -> void:
		s.fov = x
		Game.save_settings()))
	_row(v, "Volume", _slider(0.0, 1.0, s.volume, func(x: float) -> void:
		s.volume = x
		Game.save_settings()))
	var inv := CheckBox.new()
	inv.button_pressed = s.invert_y
	inv.toggled.connect(func(on: bool) -> void:
		s.invert_y = on
		Game.save_settings())
	_row(v, "Invert mouse Y", inv)

	var back := Button.new()
	back.text = "Back"
	back.custom_minimum_size = Vector2(0, 44)
	back.pressed.connect(on_back)
	v.add_child(back)
	return v


static func _slider(lo: float, hi: float, value: float, on_change: Callable) -> HSlider:
	var sl := HSlider.new()
	sl.min_value = lo
	sl.max_value = hi
	sl.step = (hi - lo) / 100.0
	sl.value = value
	sl.custom_minimum_size = Vector2(200, 24)
	sl.value_changed.connect(on_change)
	return sl


static func _row(parent: Control, text: String, control: Control) -> void:
	var h := HBoxContainer.new()
	var l := UITheme.label(text, 17)
	l.custom_minimum_size = Vector2(170, 0)
	h.add_child(l)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(control)
	parent.add_child(h)
