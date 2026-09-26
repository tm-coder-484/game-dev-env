class_name Terrain
extends Node3D
## The island ground: loads the baked world data (tools/world/build_world.py), draws it as CDLOD
## patches in one MultiMesh (displaced on the GPU by terrain.gdshader) and adds a matching
## HeightMapShape3D. Everything else asks this node for heights, slopes and masks.

const DATA_DIR := "res://game/world/data/"

static var main: Terrain

@export var grid := 16 ## quads per patch edge
@export var leaf_size := 32.0 ## metres, finest patch (grid spacing = leaf_size / grid = 2 m)
@export var lod_ratio := 4.0 ## a patch stays at its LOD out to lod_ratio * its size
@export var root_size := 4096.0 ## quadtree root, covers the island plus surrounding sea floor

var info: Dictionary
var size := 2048.0
var res := 1025
var cell := 2.0
var sea_level := 0.0
var heights: PackedFloat32Array
var mask_image: Image
var material: ShaderMaterial

var _mm: MultiMesh
var _levels := 0
var _ranges: PackedFloat32Array
var _buffer := PackedFloat32Array()
var _count := 0
var _last := Vector2(INF, INF)


func _enter_tree() -> void:
	main = self
	if heights.is_empty():
		_load_data()


func _exit_tree() -> void:
	if main == self:
		main = null


func _load_data() -> void:
	info = JSON.parse_string(FileAccess.get_file_as_string(DATA_DIR + "world.json"))
	size = info.size
	res = int(info.resolution)
	cell = size / (res - 1)
	sea_level = info.sea_level
	var bytes := FileAccess.get_file_as_bytes(DATA_DIR + "height.f32")
	heights = bytes.to_float32_array()
	var height_tex := ImageTexture.create_from_image(Image.create_from_data(res, res, false, Image.FORMAT_RF, bytes))
	var mask_tex: Texture2D = load(DATA_DIR + "masks.png")
	mask_image = mask_tex.get_image()
	if mask_image.is_compressed():
		mask_image.decompress()

	material = ShaderMaterial.new()
	material.shader = load("res://game/world/shaders/terrain.gdshader")
	material.set_shader_parameter("height_map", height_tex)
	material.set_shader_parameter("normal_map", load(DATA_DIR + "normal.png"))
	material.set_shader_parameter("mask_map", mask_tex)
	material.set_shader_parameter("albedo_layers", load("res://game/world/textures/terrain_albedo.webp"))
	material.set_shader_parameter("normal_layers", load("res://game/world/textures/terrain_normal.webp"))
	material.set_shader_parameter("world_size", size)
	material.set_shader_parameter("resolution", float(res))
	material.set_shader_parameter("sea_level", sea_level)
	material.set_shader_parameter("snow_line", float(info.snow_line))
	var lake: Dictionary = info.lake
	material.set_shader_parameter("lake", Vector4(lake.x, lake.z, lake.level, lake.radius))


func _ready() -> void:
	_build_collision()
	_build_patches()


func _build_collision() -> void:
	var shape := HeightMapShape3D.new()
	shape.map_width = res
	shape.map_depth = res
	shape.map_data = heights
	var body := StaticBody3D.new()
	body.name = "TerrainBody"
	body.collision_layer = 1
	body.add_to_group("terrain")
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.scale = Vector3(cell, 1.0, cell)
	body.add_child(cs)
	add_child(body)


func _build_patches() -> void:
	_levels = int(round(log(root_size / leaf_size) / log(2.0))) + 1
	_ranges.resize(_levels)
	for i in _levels:
		_ranges[i] = lod_ratio * leaf_size * pow(2.0, i)
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.use_custom_data = true
	_mm.mesh = _grid_mesh(grid)
	_mm.instance_count = 2048
	_mm.visible_instance_count = 0
	_buffer.resize(_mm.instance_count * 16)
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Patches"
	mmi.multimesh = _mm
	mmi.material_override = material
	var lo: float = info.height_min - 60.0
	var hi: float = info.height_max + 20.0
	mmi.custom_aabb = AABB(Vector3(-root_size, lo, -root_size), Vector3(root_size * 2, hi - lo, root_size * 2))
	add_child(mmi)


## A unit grid (0..1 in x/z) with a skirt, triangulated like Jolt's heightfield (diagonal 00-11).
static func _grid_mesh(n: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var idx := PackedInt32Array()
	for z in n + 1:
		for x in n + 1:
			verts.append(Vector3(float(x) / n, 0.0, float(z) / n))
	for z in n:
		for x in n:
			var a := z * (n + 1) + x
			var b := a + 1
			var c := a + n + 1
			var d := c + 1
			idx.append_array([a, b, d, a, d, c])
	# Skirt: every edge vertex again at y = -1 (the shader drops it below the surface).
	var edge: Array[int] = []
	for x in n + 1:
		edge.append(x)
	for z in range(1, n + 1):
		edge.append(z * (n + 1) + n)
	for x in range(n - 1, -1, -1):
		edge.append(n * (n + 1) + x)
	for z in range(n - 1, 0, -1):
		edge.append(z * (n + 1))
	var base := verts.size()
	for e in edge:
		var p := verts[e]
		verts.append(Vector3(p.x, -1.0, p.z))
	for i in edge.size():
		var e0 := edge[i]
		var e1 := edge[(i + 1) % edge.size()]
		var s0 := base + i
		var s1 := base + (i + 1) % edge.size()
		idx.append_array([e0, e1, s1, e0, s1, s0, e0, s1, e1, e0, s0, s1])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_INDEX] = idx
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	normals.fill(Vector3.UP)
	arrays[Mesh.ARRAY_NORMAL] = normals
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _process(_delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var p := cam.global_position
	var c := Vector2(p.x, p.z)
	material.set_shader_parameter("lod_camera", p)
	if c.distance_squared_to(_last) < 0.25:
		return
	_last = c
	_count = 0
	_select(-root_size * 0.5, -root_size * 0.5, root_size, _levels - 1, c)
	_mm.buffer = _buffer
	_mm.visible_instance_count = _count
	# The shader morphs against the same point the patches were chosen for.
	material.set_shader_parameter("lod_camera", Vector3(c.x, p.y, c.y))


func _dist(c: Vector2, x: float, z: float, s: float) -> float:
	var dx := maxf(maxf(x - c.x, 0.0), c.x - (x + s))
	var dz := maxf(maxf(z - c.y, 0.0), c.y - (z + s))
	return sqrt(dx * dx + dz * dz)


func _select(x: float, z: float, s: float, lod: int, c: Vector2) -> bool:
	if _dist(c, x, z, s) > _ranges[lod]:
		return false
	if lod == 0 or _dist(c, x, z, s) > _ranges[lod - 1]:
		_add(x, z, s, lod)
		return true
	var h := s * 0.5
	for i in 4:
		var cx := x + (i % 2) * h
		var cz := z + (i / 2) * h
		if not _select(cx, cz, h, lod - 1, c):
			_add(cx, cz, h, lod - 1) # beyond the child's range: fully morphed, looks like this LOD
	return true


func _add(x: float, z: float, s: float, lod: int) -> void:
	if _count * 16 >= _buffer.size():
		return
	var prev := _ranges[lod - 1] if lod > 0 else 0.0
	var o := _count * 16
	_buffer[o + 0] = s
	_buffer[o + 1] = 0.0
	_buffer[o + 2] = 0.0
	_buffer[o + 3] = x
	_buffer[o + 4] = 0.0
	_buffer[o + 5] = 1.0
	_buffer[o + 6] = 0.0
	_buffer[o + 7] = 0.0
	_buffer[o + 8] = 0.0
	_buffer[o + 9] = 0.0
	_buffer[o + 10] = s
	_buffer[o + 11] = z
	_buffer[o + 12] = s / grid
	_buffer[o + 13] = lerpf(prev, _ranges[lod], 0.7)
	_buffer[o + 14] = _ranges[lod]
	_buffer[o + 15] = float(lod)
	_count += 1


# ------------------------------------------------------------ queries ----

## Ground height in metres (matches the rendered mesh and the collision shape).
func height_at(x: float, z: float) -> float:
	var px := clampf((x + size * 0.5) / cell, 0.0, res - 1.001)
	var pz := clampf((z + size * 0.5) / cell, 0.0, res - 1.001)
	var ix := int(px)
	var iz := int(pz)
	var fx := px - ix
	var fz := pz - iz
	var i := iz * res + ix
	var h00 := heights[i]
	var h11 := heights[i + res + 1]
	if fx >= fz:
		var h10 := heights[i + 1]
		return h00 + (h10 - h00) * fx + (h11 - h10) * fz
	var h01 := heights[i + res]
	return h00 + (h01 - h00) * fz + (h11 - h01) * fx


func normal_at(x: float, z: float) -> Vector3:
	var e := cell
	var dx := height_at(x + e, z) - height_at(x - e, z)
	var dz := height_at(x, z + e) - height_at(x, z - e)
	return Vector3(-dx, 2.0 * e, -dz).normalized()


## Baked masks at a point: r = stream flow, g = sediment, b = forest density, a = variation.
func mask_at(x: float, z: float) -> Color:
	var px := clampi(int((x + size * 0.5) / cell + 0.5), 0, res - 1)
	var pz := clampi(int((z + size * 0.5) / cell + 0.5), 0, res - 1)
	return mask_image.get_pixel(px, pz)


func in_bounds(x: float, z: float, margin := 0.0) -> bool:
	var h := size * 0.5 - margin
	return absf(x) < h and absf(z) < h


func is_lake(x: float, z: float) -> bool:
	var lake: Dictionary = info.lake
	return Vector2((x - lake.x), (z - lake.z) * 1.35).length() < lake.radius * 1.1 and height_at(x, z) < lake.level


func lake_level() -> float:
	return info.lake.level


func spawn_point() -> Vector3:
	var s: Dictionary = info.spawn
	return Vector3(s.x, height_at(s.x, s.z), s.z)
