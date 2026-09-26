class_name GrassField
extends Node3D
## Tall grass around the camera: two rings of instanced clumps (dense near ring that casts shadows,
## sparser far ring of bigger clumps). The rings follow the camera in whole grid steps; grass.gdshader
## places, sizes and animates every clump from its world cell, so nothing pops or swims.
## Art: godot/game/world/textures/grass/grass_atlas.webp, generated with
##   node tools/openrouter/assets.mjs foliage "<5 prompts>" --cell 1024x1536 --out ...grass_atlas.webp

const ATLAS := preload("res://game/world/textures/grass/grass_atlas.webp")

## 0 = low (Web), 1 = medium, 2 = high, 3 = ultra.
@export_range(0, 3) var quality := 2:
	set(v):
		quality = v
		if is_inside_tree():
			_rebuild()

# Per quality: near spacing, near radius, far spacing, far radius, clump size (sparser = bigger clumps).
const PRESETS := [
	[0.8, 22.0, 1.8, 50.0, 1.45],
	[0.6, 30.0, 1.4, 70.0, 1.15],
	[0.45, 36.0, 1.05, 95.0, 1.0],
	[0.38, 44.0, 0.9, 120.0, 0.95],
]

var _rings: Array[MultiMeshInstance3D] = []
var _spacings: Array[float] = []
var _materials: Array[ShaderMaterial] = []
var _noise: NoiseTexture2D


func _ready() -> void:
	_noise = NoiseTexture2D.new()
	_noise.width = 256
	_noise.height = 256
	_noise.seamless = true
	_noise.generate_mipmaps = true
	var fn := FastNoiseLite.new()
	fn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	fn.frequency = 0.012
	fn.fractal_octaves = 3
	_noise.noise = fn
	_rebuild()


func _rebuild() -> void:
	for r in _rings:
		r.queue_free()
	_rings.clear()
	_spacings.clear()
	_materials.clear()
	var p: Array = PRESETS[quality]
	var near_r: float = p[1]
	var far_r: float = p[3]
	_add_ring(p[0], 0.0, near_r, 5, p[4], Vector4(0.0, 0.0, near_r - 6.0, near_r), true)
	_add_ring(p[2], near_r - 7.0, far_r, 2, 1.2 * p[4], Vector4(near_r - 7.0, near_r - 1.0, far_r - 18.0, far_r), false)


func _add_ring(spacing: float, r0: float, r1: float, rows: int, size_scale: float, fade: Vector4, shadows: bool) -> void:
	var offsets := PackedVector3Array()
	var n := int(ceil(r1 / spacing))
	for z in range(-n, n + 1):
		for x in range(-n, n + 1):
			var d := Vector2(x, z).length() * spacing
			if d <= r1 + spacing and d >= r0 - spacing:
				offsets.append(Vector3(x * spacing, 0.0, z * spacing))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = _clump_mesh(rows)
	mm.instance_count = offsets.size()
	for i in offsets.size():
		mm.set_instance_transform(i, Transform3D(Basis(), offsets[i]))

	var mat := ShaderMaterial.new()
	mat.shader = preload("res://game/world/shaders/grass.gdshader")
	var tm := Terrain.main.material
	for key in ["height_map", "normal_map", "mask_map", "world_size", "resolution", "sea_level", "snow_line", "lake"]:
		mat.set_shader_parameter(key, tm.get_shader_parameter(key))
	mat.set_shader_parameter("atlas", ATLAS)
	mat.set_shader_parameter("atlas_size", Vector2(ATLAS.get_width(), ATLAS.get_height()))
	mat.set_shader_parameter("wind_noise", _noise)
	mat.set_shader_parameter("spacing", spacing)
	mat.set_shader_parameter("fade", fade)
	mat.set_shader_parameter("size_scale", size_scale)
	mat.set_shader_parameter("variety", 1.0 if shadows else 0.45)

	var mmi := MultiMeshInstance3D.new()
	mmi.name = "GrassRing%d" % _rings.size()
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-r1 - 2.0, -60.0, -r1 - 2.0), Vector3(r1 * 2 + 4.0, 460.0, r1 * 2 + 4.0))
	add_child(mmi)
	_rings.append(mmi)
	_spacings.append(spacing)
	_materials.append(mat)
	print("grass ring: %d clumps, spacing %.2f m, %.0f-%.0f m" % [offsets.size(), spacing, r0, r1])


## Three crossed cards, `rows` segments tall so they can bend smoothly. Unit size: y 0..1, x/z -0.5..0.5.
static func _clump_mesh(rows: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for card in 3:
		var a := card * PI / 3.0 + 0.2
		var dir := Vector3(cos(a), 0.0, sin(a))
		var start := verts.size()
		for r in rows + 1:
			var y := float(r) / rows
			for side in 2:
				verts.append(dir * (side - 0.5) + Vector3.UP * y)
				uvs.append(Vector2(side, 1.0 - y))
		for r in rows:
			var i := start + r * 2
			idx.append_array([i, i + 1, i + 3, i, i + 3, i + 2])
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	normals.fill(Vector3.UP)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _process(_delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var c := cam.global_position
	for i in _rings.size():
		var s := _spacings[i]
		_rings[i].global_position = Vector3(roundf(c.x / s) * s, 0.0, roundf(c.z / s) * s)
		_materials[i].set_shader_parameter("center", c)
	var player := get_tree().get_first_node_in_group("player") as Node3D
	RenderingServer.global_shader_parameter_set("player_position", player.global_position if player else Vector3(0, -1000, 0))
