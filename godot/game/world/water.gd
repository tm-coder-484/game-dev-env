class_name Water
extends Node3D
## The sea around the island (a 2 m grid that follows the camera, fading into flat rings out to the
## horizon) and the freshwater lake. Both use water.gdshader; the lake is calmer and greener.

@export var near_half_size := 240.0 ## metres of detailed swell around the camera
@export var grid_spacing := 2.0

var ocean: MeshInstance3D
var lake: MeshInstance3D
var _ocean_mat: ShaderMaterial


func _ready() -> void:
	var t := Terrain.main
	_ocean_mat = _material(0.18, 1.0, 1.0)
	ocean = MeshInstance3D.new()
	ocean.name = "Ocean"
	ocean.mesh = _ocean_mesh()
	ocean.material_override = _ocean_mat
	ocean.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ocean.custom_aabb = AABB(Vector3(-20000, -5, -20000), Vector3(40000, 10, 40000))
	ocean.position.y = t.sea_level
	add_child(ocean)

	var info: Dictionary = t.info.lake
	var lake_mat := _material(0.32, 0.12, 0.45)
	lake_mat.set_shader_parameter("shallow_color", Color(0.2, 0.36, 0.28))
	lake_mat.set_shader_parameter("deep_color", Color(0.03, 0.08, 0.07))
	lake_mat.set_shader_parameter("foam_amount", 0.35)
	var plane := PlaneMesh.new()
	var r: float = info.radius * 1.5
	plane.size = Vector2(r * 2, r * 2 / 1.35 + 40.0)
	plane.subdivide_width = int(plane.size.x / 3.0)
	plane.subdivide_depth = int(plane.size.y / 3.0)
	lake = MeshInstance3D.new()
	lake.name = "Lake"
	lake.mesh = plane
	lake.material_override = lake_mat
	lake.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	lake.position = Vector3(info.x, info.level, info.z)
	add_child(lake)


func _material(absorption: float, wave_height: float, detail_scale: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = preload("res://game/world/shaders/water.gdshader")
	m.set_shader_parameter("normal_a", _noise_normal(0.018, 7.0, 11))
	m.set_shader_parameter("normal_b", _noise_normal(0.01, 5.0, 23))
	var foam := NoiseTexture2D.new()
	foam.seamless = true
	foam.generate_mipmaps = true
	var fn := FastNoiseLite.new()
	fn.frequency = 0.03
	fn.fractal_octaves = 3
	foam.noise = fn
	m.set_shader_parameter("foam_noise", foam)
	m.set_shader_parameter("absorption", absorption)
	m.set_shader_parameter("wave_height", wave_height)
	m.set_shader_parameter("detail_scale", detail_scale)
	m.set_shader_parameter("swell_fade", near_half_size)
	# The Compatibility renderer's depth texture isn't reliable everywhere; shade by distance instead.
	m.set_shader_parameter("use_depth", RenderingServer.get_current_rendering_method() != "gl_compatibility")
	return m


static func _noise_normal(freq: float, strength: float, seed: int) -> NoiseTexture2D:
	var tex := NoiseTexture2D.new()
	tex.width = 512
	tex.height = 512
	tex.seamless = true
	tex.as_normal_map = true
	tex.bump_strength = strength
	tex.generate_mipmaps = true
	var n := FastNoiseLite.new()
	n.seed = seed
	n.frequency = freq
	n.fractal_octaves = 4
	tex.noise = n
	return tex


## Fine grid in the middle, then flat square rings that double in size out to ~16 km.
func _ocean_mesh() -> ArrayMesh:
	var verts := PackedVector3Array()
	var idx := PackedInt32Array()
	var n := int(near_half_size / grid_spacing)
	var row := 2 * n + 1
	for z in range(-n, n + 1):
		for x in range(-n, n + 1):
			verts.append(Vector3(x * grid_spacing, 0.0, z * grid_spacing))
	for z in 2 * n:
		for x in 2 * n:
			var i := z * row + x
			idx.append_array([i, i + 1, i + row + 1, i, i + row + 1, i + row])
	var inner := near_half_size
	var step := grid_spacing * 8.0
	while inner < 16000.0:
		var outer := inner * 2.0
		var cells := int(ceil(outer * 2.0 / step))
		var s := outer * 2.0 / cells
		for z in cells:
			for x in cells:
				var x0 := -outer + x * s
				var z0 := -outer + z * s
				if x0 >= -inner - 0.01 and x0 + s <= inner + 0.01 and z0 >= -inner - 0.01 and z0 + s <= inner + 0.01:
					continue
				var i := verts.size()
				verts.append_array([Vector3(x0, 0, z0), Vector3(x0 + s, 0, z0), Vector3(x0 + s, 0, z0 + s), Vector3(x0, 0, z0 + s)])
				idx.append_array([i, i + 1, i + 2, i, i + 2, i + 3])
		inner = outer
		step *= 2.0
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	normals.fill(Vector3.UP)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _process(_delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam:
		var p := cam.global_position
		ocean.global_position = Vector3(snappedf(p.x, grid_spacing * 8.0), ocean.global_position.y, snappedf(p.z, grid_spacing * 8.0))
