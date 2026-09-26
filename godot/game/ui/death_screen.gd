class_name DeathScreen
extends GameScreen
## "You died": how long you lasted, and a way back.

var _player: Player
var _stats: Label


func _init() -> void:
	super()
	var bg := ColorRect.new()
	bg.color = Color(0.08, 0.0, 0.0, 0.6)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.position = Vector2(-260, -140)
	v.custom_minimum_size = Vector2(520, 280)
	v.add_theme_constant_override("separation", 18)
	add_child(v)
	var t := UITheme.title("You died", 64)
	t.add_theme_color_override("font_color", Color(0.85, 0.2, 0.15))
	v.add_child(t)
	_stats = UITheme.label("", 20)
	_stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_stats)
	var b := Button.new()
	b.text = "Wake up"
	b.custom_minimum_size = Vector2(0, 52)
	b.pressed.connect(_respawn)
	v.add_child(b)


func open_for(p: Player) -> void:
	_player = p
	var day := DayNight.main.day if DayNight.main else 1
	_stats.text = "Day %d  ·  %d Hollows and wolves slain\nYou'll wake at your last campfire and lose half of what you carried." % [day, p.kills]
	modulate.a = 0.0
	open()
	create_tween().tween_property(self, "modulate:a", 1.0, 1.5).set_delay(0.8)


func _respawn() -> void:
	close()
	_player.respawn()
