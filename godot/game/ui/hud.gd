class_name HUD
extends CanvasLayer
## The in-game overlay plus the crafting, map, pause and death screens (built in code, styled by
## UITheme). Bars and slots reuse the swappable HUD kit in res://assets/ui/hud/ (tools/openrouter).

const HOTBAR_W := 8 * 64 + 7 * 6
const HOTBAR_Y := -84.0

var player: Player
var root: Control
var craft: CraftMenu
var map: MapScreen
var pause: PauseMenu
var death: DeathScreen

var _rows := {} # stat -> StatRow
var _stamina: ProgressBar
var _stamina_alpha := 0.0
var _last_health := 100.0
var _slots: Array[Dictionary] = []
var _prompt: Label
var _clock: Label
var _status: Label
var _item_name: Label
var _item_name_t := 0.0
var _notes: VBoxContainer
var _fx: ColorRect
var _fx_mat: ShaderMaterial
var _damage := 0.0
var _compass: Control
var _cross: Control
var _hit_marker := 0.0
var _hurt_dirs: Array = [] # [angle, time]
var _selected := -1


func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	root = Control.new()
	root.theme = UITheme.get_theme()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_build_fx()
	_build_bars()
	_build_hotbar()
	_build_center()
	_build_top()
	_build_notes()
	craft = CraftMenu.new()
	root.add_child(craft)
	map = MapScreen.new()
	root.add_child(map)
	pause = PauseMenu.new()
	root.add_child(pause)
	death = DeathScreen.new()
	root.add_child(death)
	Game.notified.connect(_on_notify)
	_set_overlay(false)


func attach(p: Player) -> void:
	player = p
	_set_overlay(true)
	player.inventory.changed.connect(_refresh_hotbar)
	player.hurt.connect(_on_hurt)
	player.died.connect(func() -> void: death.open_for(player))
	player.hit_landed.connect(func(_killed: bool) -> void: _hit_marker = 1.0)
	craft.player = p
	map.player = p
	_refresh_hotbar()


# ------------------------------------------------------------- build ----

func _build_fx() -> void:
	_fx = ColorRect.new()
	_fx.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fx.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fx_mat = ShaderMaterial.new()
	_fx_mat.shader = preload("res://game/ui/screen_fx.gdshader")
	var n := NoiseTexture2D.new()
	n.seamless = true
	n.noise = FastNoiseLite.new()
	n.noise.frequency = 0.02
	_fx_mat.set_shader_parameter("noise", n)
	_fx.material = _fx_mat
	root.add_child(_fx)


## Minecraft-style rows above the hotbar: hearts and flames on the left, shanks and droplets on the
## right (draining toward the centre), and a slim stamina bar that only shows while it's in use.
func _build_bars() -> void:
	var hud_dir := "res://game/ui/hud/"
	var rows := [
		# stat, icon, right side?, row (0 = nearest the hotbar)
		["health", "heart", false, 0],
		["warmth", "flame", false, 1],
		["hunger", "shank", true, 0],
		["thirst", "droplet", true, 1],
	]
	for r: Array in rows:
		var row := StatRow.new()
		var path: String = hud_dir + r[1] + ".png"
		row.icon = load(path) if ResourceLoader.exists(path) else Items.icon("berries")
		row.fill_from_right = r[2]
		row.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
		var w := row.get_combined_minimum_size().x
		var x := HOTBAR_W / 2.0 - w if r[2] else -HOTBAR_W / 2.0
		row.position = Vector2(x, HOTBAR_Y - 14.0 - 28.0 * (r[3] + 1))
		row.size = row.get_combined_minimum_size()
		root.add_child(row)
		_rows[r[0]] = row
	_stamina = ProgressBar.new()
	_stamina.show_percentage = false
	_stamina.max_value = 100.0
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.55)
	bg.set_corner_radius_all(3)
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color(1.0, 0.78, 0.3)
	fill.set_corner_radius_all(3)
	_stamina.add_theme_stylebox_override("background", bg)
	_stamina.add_theme_stylebox_override("fill", fill)
	_stamina.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_stamina.position = Vector2(-HOTBAR_W / 2.0, HOTBAR_Y - 10.0)
	_stamina.size = Vector2(HOTBAR_W, 6)
	_stamina.custom_minimum_size = Vector2(HOTBAR_W, 6)
	_stamina.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_stamina)


func _build_hotbar() -> void:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 6)
	bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	bar.position = Vector2(-(8 * 64 + 7 * 6) / 2.0, -84)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bar)
	for i in Inventory.HOTBAR_SIZE:
		var slot := TextureRect.new()
		slot.custom_minimum_size = Vector2(64, 64)
		slot.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		slot.texture = load("res://assets/ui/hud/slot.png")
		slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var icon := TextureRect.new()
		icon.set_anchors_preset(Control.PRESET_FULL_RECT)
		icon.offset_left = 8
		icon.offset_top = 8
		icon.offset_right = -8
		icon.offset_bottom = -8
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		slot.add_child(icon)
		var count := UITheme.label("", 15)
		count.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
		count.position = Vector2(-30, -22)
		count.size = Vector2(26, 20)
		count.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		slot.add_child(count)
		var key := UITheme.label(str(i + 1), 12, UITheme.DIM)
		key.position = Vector2(6, 3)
		slot.add_child(key)
		bar.add_child(slot)
		_slots.append({"slot": slot, "icon": icon, "count": count})
	_item_name = UITheme.label("", 20, UITheme.TEXT, UITheme.bold_font)
	_item_name.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_item_name.position = Vector2(-200, HOTBAR_Y - 14.0 - 28.0 * 2 - 34.0)
	_item_name.size = Vector2(400, 28)
	_item_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_item_name)


func _build_center() -> void:
	_cross = Control.new()
	_cross.set_anchors_preset(Control.PRESET_CENTER)
	_cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_cross.draw.connect(_draw_cross)
	root.add_child(_cross)
	_prompt = UITheme.label("", 19, Color(1.0, 0.95, 0.85), UITheme.bold_font)
	var pill := StyleBoxFlat.new()
	pill.bg_color = Color(0.04, 0.045, 0.05, 0.62)
	pill.set_corner_radius_all(14)
	pill.content_margin_left = 14
	pill.content_margin_right = 14
	pill.content_margin_top = 3
	pill.content_margin_bottom = 4
	_prompt.add_theme_stylebox_override("normal", pill)
	_prompt.set_anchors_preset(Control.PRESET_CENTER)
	_prompt.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_prompt.position = Vector2(0, 40)
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_prompt)


func _build_top() -> void:
	_compass = Control.new()
	_compass.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_compass.position = Vector2(-270, 14)
	_compass.size = Vector2(540, 40)
	_compass.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_compass.draw.connect(_draw_compass)
	root.add_child(_compass)
	_clock = UITheme.label("", 18, UITheme.TEXT)
	_clock.position = Vector2(22, 16)
	root.add_child(_clock)
	_status = UITheme.label("", 22, UITheme.BAD, UITheme.bold_font)
	var pill := StyleBoxFlat.new()
	pill.bg_color = Color(0.04, 0.045, 0.05, 0.62)
	pill.set_corner_radius_all(12)
	pill.content_margin_left = 12
	pill.content_margin_right = 12
	pill.content_margin_top = 2
	pill.content_margin_bottom = 3
	_status.add_theme_stylebox_override("normal", pill)
	_status.position = Vector2(18, 44)
	root.add_child(_status)


func _build_notes() -> void:
	_notes = VBoxContainer.new()
	_notes.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	_notes.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_notes.position = Vector2(-380, -150)
	_notes.size = Vector2(360, 300)
	_notes.alignment = BoxContainer.ALIGNMENT_END
	_notes.add_theme_constant_override("separation", 4)
	_notes.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_notes)


## Everything except the menus, hidden on the title screen.
func _set_overlay(on: bool) -> void:
	for c in root.get_children():
		if not c is GameScreen:
			(c as CanvasItem).visible = on


# ------------------------------------------------------------ update ----

func _process(delta: float) -> void:
	if player == null:
		return
	(_rows.health as StatRow).set_value(player.health, player.health > _last_health + 0.001)
	_last_health = player.health
	(_rows.hunger as StatRow).set_value(player.hunger)
	(_rows.thirst as StatRow).set_value(player.thirst)
	(_rows.warmth as StatRow).set_value(player.warmth)
	_stamina.value = lerpf(_stamina.value, player.stamina, minf(1.0, delta * 12.0))
	_stamina_alpha = move_toward(_stamina_alpha, 1.0 if player.stamina < player.max_stamina - 0.5 else 0.0, delta * (4.0 if player.stamina < player.max_stamina - 0.5 else 1.2))
	_stamina.modulate.a = _stamina_alpha
	(_stamina.get_theme_stylebox("fill") as StyleBoxFlat).bg_color = Color(0.9, 0.35, 0.25) if player.stamina < 20.0 else Color(1.0, 0.78, 0.3)
	var paused := get_tree().paused
	var menus := craft.visible or map.visible or pause.visible or death.visible
	_prompt.text = "" if menus else player.prompt
	_prompt.visible = _prompt.text != ""
	_prompt.reset_size()
	_prompt.position.x = -_prompt.size.x * 0.5
	_clock.text = DayNight.main.clock_text() if DayNight.main else ""
	_status.text = player.status
	_status.visible = player.status != ""
	_status.reset_size()
	var urgent := player.status in ["Freezing", "Starving", "Dehydrated"]
	_status.modulate.a = 0.75 + 0.25 * sin(Time.get_ticks_msec() * 0.008) if urgent else 1.0
	_status.add_theme_color_override("font_color", Color(0.65, 0.88, 1.0) if player.status in ["Cold", "Freezing"] else Color(1.0, 0.55, 0.45))
	_item_name_t -= delta
	_item_name.modulate.a = clampf(_item_name_t, 0.0, 1.0)
	_damage = move_toward(_damage, 0.0, delta * 1.4)
	_hit_marker = move_toward(_hit_marker, 0.0, delta * 4.0)
	_fx_mat.set_shader_parameter("damage", _damage)
	_fx_mat.set_shader_parameter("low_health", clampf((35.0 - player.health) / 35.0, 0.0, 1.0) * 0.6 if not player.dead else 0.8)
	_fx_mat.set_shader_parameter("cold", clampf((25.0 - player.warmth) / 25.0, 0.0, 1.0))
	var cam := player.camera.global_position
	var water: Dictionary = Game.water_at(cam.x, cam.z)
	_fx_mat.set_shader_parameter("underwater", 1.0 if cam.y < water.height - 0.05 else 0.0)
	for h: Array in _hurt_dirs:
		h[1] -= delta
	_hurt_dirs = _hurt_dirs.filter(func(h: Array) -> bool: return h[1] > 0.0)
	_cross.queue_redraw()
	_compass.queue_redraw()
	if not paused:
		for n: Control in _notes.get_children():
			var t: float = n.get_meta("t") - delta
			n.set_meta("t", t)
			n.modulate.a = clampf(t, 0.0, 1.0)
			if t <= 0.0:
				n.queue_free()


func _refresh_hotbar() -> void:
	var inv := player.inventory
	for i in _slots.size():
		var id := inv.hotbar[i]
		var s := _slots[i]
		(s.slot as TextureRect).texture = load("res://assets/ui/hud/slot_selected.png" if i == inv.selected else "res://assets/ui/hud/slot.png")
		(s.icon as TextureRect).texture = Items.icon(id) if id != "" else null
		var c := inv.count(id) if id != "" else 0
		var text := str(c) if c > 1 else ""
		if id == "bow":
			text = str(inv.count("arrow"))
		(s.count as Label).text = text
	if inv.selected != _selected:
		_selected = inv.selected
		var id := inv.held()
		_item_name.text = Items.item_name(id) if id != "" else "Fists"
		_item_name_t = 2.0


func _on_notify(text: String, icon: Texture2D) -> void:
	var wrap := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.045, 0.05, 0.6)
	sb.set_corner_radius_all(8)
	sb.content_margin_left = 12
	sb.content_margin_right = 10
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	sb.border_width_left = 3
	sb.border_color = UITheme.BRASS if icon else Color(0.6, 0.75, 0.9)
	wrap.add_theme_stylebox_override("panel", sb)
	wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wrap.size_flags_horizontal = Control.SIZE_SHRINK_END
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wrap.add_child(row)
	var l := UITheme.label(text, 18)
	if text.length() > 34:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size = Vector2(320, 0)
	row.add_child(l)
	if icon:
		var tr := TextureRect.new()
		tr.texture = icon
		tr.custom_minimum_size = Vector2(34, 34)
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		row.add_child(tr)
	wrap.set_meta("t", 3.5 if icon else 7.0)
	_notes.add_child(wrap)
	while _notes.get_child_count() > 7:
		_notes.get_child(0).free()


func _on_hurt(amount: float, from: Vector3) -> void:
	_damage = clampf(_damage + amount / 25.0, 0.0, 1.0)
	var to := from - player.global_position
	var fwd := -player.global_basis.z
	var ang := atan2(to.x * fwd.z - to.z * fwd.x, -(to.x * fwd.x + to.z * fwd.z))
	_hurt_dirs.append([ang, 1.2])


# -------------------------------------------------------------- draw ----

func _draw_cross() -> void:
	var c := Vector2.ZERO
	var col := Color(1, 1, 1, 0.85)
	if player and not player.dead:
		if player.bow_draw >= 0.0:
			var r := lerpf(26.0, 6.0, player.bow_draw)
			_cross.draw_arc(c, r, 0, TAU, 40, Color(1, 1, 1, 0.5 + player.bow_draw * 0.5), 1.5, true)
		_cross.draw_circle(c, 2.2, col)
		if _hit_marker > 0.0:
			var a := Color(1, 0.9, 0.8, _hit_marker)
			for d: Vector2 in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
				_cross.draw_line(d * 6.0, d * 13.0, a, 2.0, true)
	for h: Array in _hurt_dirs:
		var a: float = h[0]
		var alpha: float = minf(1.0, h[1])
		var r := 150.0
		_cross.draw_arc(c, r, a - PI / 2 - 0.25, a - PI / 2 + 0.25, 16, Color(0.9, 0.1, 0.05, alpha * 0.8), 7.0, true)


func _heading(v: Vector3) -> float:
	return rad_to_deg(atan2(v.x, -v.z))


func _draw_compass() -> void:
	if player == null:
		return
	var w := _compass.size.x
	var cx := w * 0.5
	var fwd := -player.global_basis.z
	var yaw := _heading(fwd)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0.05, 0.06, 0.07, 0.45)
	bg.set_corner_radius_all(4)
	_compass.draw_style_box(bg, Rect2(Vector2.ZERO, _compass.size))
	var font := UITheme.bold_font
	var marks := {0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW"}
	for deg in range(0, 360, 15):
		var rel := wrapf(deg - yaw, -180.0, 180.0)
		if absf(rel) > 90.0:
			continue
		var x := cx + rel / 90.0 * cx
		var fade := 1.0 - absf(rel) / 90.0
		if marks.has(deg):
			var txt: String = marks[deg]
			var fs := 20 if txt.length() == 1 else 15
			var col := Color(1.0, 0.85, 0.55, fade) if txt == "N" else Color(0.95, 0.92, 0.85, fade)
			_compass.draw_string(font, Vector2(x - (6 if txt.length() == 1 else 10), 27), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
		else:
			_compass.draw_line(Vector2(x, 8), Vector2(x, 16), Color(1, 1, 1, 0.5 * fade), 1.0)
	# Markers: your campfire and the lake.
	var markers := []
	if player.respawn_point != Vector3.INF:
		markers.append([player.respawn_point, Color(1.0, 0.55, 0.2), "Camp"])
	if Terrain.main:
		var lake: Dictionary = Terrain.main.info.lake
		markers.append([Vector3(lake.x, 0, lake.z), Color(0.4, 0.75, 1.0), "Lake"])
	for m: Array in markers:
		var p: Vector3 = m[0]
		var to := p - player.global_position
		var rel := wrapf(_heading(to) - yaw, -180.0, 180.0)
		if absf(rel) > 90.0:
			continue
		var x := cx + rel / 90.0 * cx
		_compass.draw_circle(Vector2(x, 34), 4.0, m[1])
		var dist := "%s %dm" % [m[2], int(Vector2(to.x, to.z).length())]
		_compass.draw_string(font, Vector2(x - 30, 54), dist, HORIZONTAL_ALIGNMENT_CENTER, 60, 13, Color(m[1], 0.9))
	_compass.draw_line(Vector2(cx, 0), Vector2(cx, 6), Color(1, 0.85, 0.55), 2.0)


# ------------------------------------------------------------ menus ----

func _unhandled_input(event: InputEvent) -> void:
	if player == null:
		return
	if death.visible:
		return
	if event.is_action_pressed("pause"):
		if craft.visible:
			craft.close()
		elif map.visible:
			map.close()
		else:
			pause.toggle()
		get_viewport().set_input_as_handled()
	elif pause.visible:
		return
	elif event.is_action_pressed("inventory"):
		map.close()
		craft.toggle()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("map"):
		craft.close()
		map.toggle()
		get_viewport().set_input_as_handled()
