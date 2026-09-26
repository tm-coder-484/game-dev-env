class_name GameScreen
extends Control
## Base for full-screen overlays: frees the mouse and pauses game input while open.

var pauses_game := false


func _init() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	visible = false
	process_mode = Node.PROCESS_MODE_ALWAYS
	mouse_filter = Control.MOUSE_FILTER_STOP


func open() -> void:
	visible = true
	Game.ui_open = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if pauses_game:
		get_tree().paused = true
	_on_open()


func close() -> void:
	if not visible:
		return
	visible = false
	if pauses_game:
		get_tree().paused = false
	# Only give the mouse back to the game if no other overlay is still up.
	var others := get_parent().get_children().filter(func(c: Node) -> bool: return c is GameScreen and c != self and c.visible)
	if others.is_empty():
		Game.ui_open = false
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func toggle() -> void:
	if visible:
		close()
	else:
		open()


func _on_open() -> void:
	pass


static func dim_background(parent: Control, alpha := 0.55) -> void:
	var bg := ColorRect.new()
	bg.color = Color(0, 0, 0, alpha)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	parent.add_child(bg)


static func centered_panel(parent: Control, size: Vector2) -> PanelContainer:
	var p := PanelContainer.new()
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.custom_minimum_size = size
	p.position = -size * 0.5
	p.size = size
	parent.add_child(p)
	return p
