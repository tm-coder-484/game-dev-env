extends Node3D
## Demo world bootstrap: HUD, PBR material showcase, physics props, colliders
## for the Blender-generated rocks, and a headless screenshot mode.
##
## Screenshot mode (used by `make godot-shot`, CI and AI agents to *see* the game):
##   godot --path godot --audio-driver Dummy -- --screenshot=/tmp/shot.png --frames=120

# name, albedo, metallic, roughness, clearcoat, transparent
const SHOWCASE := [
	["Gold", Color(1.0, 0.77, 0.34), 1.0, 0.25, 0.0, false],
	["Copper", Color(0.95, 0.64, 0.54), 1.0, 0.4, 0.0, false],
	["Chrome", Color(0.9, 0.9, 0.9), 1.0, 0.05, 0.0, false],
	["Car paint", Color(0.55, 0.02, 0.03), 0.4, 0.35, 1.0, false],
	["Ceramic", Color(0.92, 0.92, 0.9), 0.0, 0.3, 0.8, false],
	["Rubber", Color(0.04, 0.04, 0.04), 0.0, 0.9, 0.0, false],
	["Glass", Color(0.85, 0.95, 1.0, 0.15), 0.0, 0.02, 0.0, true],
]

var _hud: Label
var _shot_path := ""
var _shot_frames := 120
var _shot_taken := false


func _ready() -> void:
	_parse_args()
	_add_rock_colliders($Rocks)
	_spawn_showcase(Vector3(-3, 0, -5))
	_spawn_crate_stack(Vector3(5, 0, -3))
	_build_hud()


func _parse_args() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--screenshot="):
			_shot_path = arg.get_slice("=", 1)
		elif arg.begins_with("--frames="):
			_shot_frames = arg.get_slice("=", 1).to_int()


func _process(_delta: float) -> void:
	_hud.text = "%d FPS  ·  %s (%s)\nClick: capture mouse · WASD · Space · Shift · F light · E talk" % [
		Engine.get_frames_per_second(),
		RenderingServer.get_current_rendering_method(),
		RenderingServer.get_current_rendering_driver_name(),
	]
	if _shot_path != "" and not _shot_taken and Engine.get_process_frames() >= _shot_frames:
		_shot_taken = true
		await RenderingServer.frame_post_draw
		var err := get_viewport().get_texture().get_image().save_png(_shot_path)
		print("screenshot -> %s (%s)" % [_shot_path, error_string(err)])
		get_tree().quit(0 if err == OK else 1)


## Every mesh under `root` gets a convex static collider (fine for boulders).
func _add_rock_colliders(root: Node) -> void:
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).create_convex_collision(true, true)


func _spawn_showcase(origin: Vector3) -> void:
	for i in SHOWCASE.size():
		var s: Array = SHOWCASE[i]
		var mat := StandardMaterial3D.new()
		mat.albedo_color = s[1]
		mat.metallic = s[2]
		mat.roughness = s[3]
		if s[4] > 0.0:
			mat.clearcoat_enabled = true
			mat.clearcoat = s[4]
			mat.clearcoat_roughness = 0.1
		if s[5]:
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			mat.refraction_enabled = true
			mat.refraction_scale = 0.05
		var mesh := SphereMesh.new()
		mesh.radius = 0.5
		mesh.height = 1.0
		mesh.material = mat
		var body := StaticBody3D.new()
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		var cs := CollisionShape3D.new()
		var shape := SphereShape3D.new()
		shape.radius = 0.5
		cs.shape = shape
		body.add_child(mi)
		body.add_child(cs)
		body.position = origin + Vector3(i * 1.8, 0.5, 0)
		add_child(body)
		var label := Label3D.new()
		label.text = s[0]
		label.font_size = 40
		label.outline_size = 10
		label.position = Vector3(0, 0.8, 0)
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		body.add_child(label)


func _spawn_crate_stack(origin: Vector3) -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.42, 0.28, 0.16)
	mat.roughness = 0.75
	var mesh := BoxMesh.new()
	mesh.size = Vector3.ONE * 0.8
	mesh.material = mat
	var shape := BoxShape3D.new()
	shape.size = mesh.size
	for layer in 4:
		for i in 4 - layer:
			var crate := RigidBody3D.new()
			crate.mass = 8.0
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			var cs := CollisionShape3D.new()
			cs.shape = shape
			crate.add_child(mi)
			crate.add_child(cs)
			crate.position = origin + Vector3((i + layer * 0.5) * 0.82, 0.4 + layer * 0.81, 0)
			add_child(crate)


func _build_hud() -> void:
	var layer := CanvasLayer.new()
	_hud = Label.new()
	_hud.position = Vector2(16, 12)
	_hud.add_theme_color_override("font_outline_color", Color.BLACK)
	_hud.add_theme_constant_override("outline_size", 6)
	layer.add_child(_hud)
	add_child(layer)
