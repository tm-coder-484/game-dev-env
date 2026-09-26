class_name MapScreen
extends GameScreen
## [M] The island map (baked by tools/world/build_world.py) with you, your campfires and the lake.

var player: Player
var _map: TextureRect
var _overlay: Control
var _panel: PanelContainer


func _init() -> void:
	super()
	GameScreen.dim_background(self, 0.7)
	_panel = GameScreen.centered_panel(self, Vector2(740, 780))
	var v := VBoxContainer.new()
	_panel.add_child(v)
	v.add_child(UITheme.title("Hollowvale", 30))
	_map = TextureRect.new()
	_map.texture = load("res://game/world/data/map.png")
	_map.custom_minimum_size = Vector2(700, 700)
	_map.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_map.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	v.add_child(_map)
	_overlay = Control.new()
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.draw.connect(_draw_overlay)
	_map.add_child(_overlay)
	var legend := UITheme.label("You   ●  Campfire   ✦ The blight (dead woods)    [M] close", 15, UITheme.DIM)
	legend.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(legend)


func _on_open() -> void:
	# Fit the map to the window (the panel adds ~80 px of title and legend).
	var side := clampf(get_viewport_rect().size.y - 130.0, 360.0, 700.0)
	_map.custom_minimum_size = Vector2(side, side)
	_panel.custom_minimum_size = Vector2(side + 40.0, side + 80.0)
	_panel.size = _panel.custom_minimum_size
	_panel.position = -_panel.size * 0.5


func _process(_delta: float) -> void:
	if visible:
		_overlay.queue_redraw()


func _to_map(p: Vector3) -> Vector2:
	var s := Terrain.main.size
	return Vector2((p.x + s * 0.5) / s, (p.z + s * 0.5) / s) * _overlay.size


func _draw_overlay() -> void:
	if player == null or Terrain.main == null:
		return
	var font := UITheme.bold_font
	var lake: Dictionary = Terrain.main.info.lake
	_overlay.draw_string(font, _to_map(Vector3(lake.x - 30, 0, lake.z)), "Mirror Lake", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(0.9, 0.95, 1.0, 0.9))
	var blight := _to_map(Vector3(-480, 0, -170))
	_overlay.draw_string(font, blight + Vector2(-50, 4), "✦ The Blight", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(1.0, 0.55, 0.4, 0.9))
	var spawn := Terrain.main.spawn_point()
	_overlay.draw_string(font, _to_map(spawn) + Vector2(-44, 22), "Driftwood Beach", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(1, 1, 0.9, 0.85))
	for c in get_tree().get_nodes_in_group("campfire"):
		var m := _to_map(c.global_position)
		_overlay.draw_circle(m, 5.0, Color(1.0, 0.5, 0.15))
		_overlay.draw_arc(m, 7.0, 0, TAU, 16, Color(0, 0, 0, 0.6), 1.5)
	var p := _to_map(player.global_position)
	var f := -player.global_basis.z
	var dir := Vector2(f.x, f.z).normalized()
	var side := Vector2(-dir.y, dir.x)
	var tri := PackedVector2Array([p + dir * 12.0, p - dir * 7.0 + side * 7.0, p - dir * 7.0 - side * 7.0])
	_overlay.draw_colored_polygon(tri, Color(1.0, 0.92, 0.6))
	_overlay.draw_polyline(PackedVector2Array([tri[0], tri[1], tri[2], tri[0]]), Color(0, 0, 0, 0.8), 1.5)
