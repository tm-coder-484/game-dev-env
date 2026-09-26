class_name Foliage
extends Node3D
## Trees and bushes: scattered from the baked forest mask, drawn as per-cell MultiMeshes up close and
## as impostor cards (captured from the real meshes at startup) in the distance. Trunks collide
## through PhysicsServer3D shapes (no nodes per tree). The player chops trees and picks berries
## through hit_instance() / damage() / pick().

signal felled(id: int, position: Vector3)

static var main: Foliage

const TREES_GLB := preload("res://game/world/models/trees.glb")
const ATLAS := preload("res://game/world/textures/trees/branch_atlas.webp")
const CELL := 128.0
const SPRUCE := 0
const PINE := 1
const BIRCH := 2
const DEAD := 3
const BRAMBLE := 4
# Per species: mesh names, trunk radius (0 = walk through), hit points, respawn minutes.
const SPECIES := [
	{"name": "spruce", "meshes": ["spruce_0", "spruce_1", "spruce_2"], "radius": 0.34, "hp": 6.0, "respawn": 20.0},
	{"name": "pine", "meshes": ["pine_0", "pine_1"], "radius": 0.4, "hp": 7.0, "respawn": 20.0},
	{"name": "birch", "meshes": ["birch_0", "birch_1"], "radius": 0.24, "hp": 4.0, "respawn": 15.0},
	{"name": "dead", "meshes": ["dead_0", "dead_1"], "radius": 0.3, "hp": 3.0, "respawn": 25.0},
	{"name": "bramble", "meshes": ["bramble_0", "bramble_1"], "radius": 0.0, "hp": 1.0, "respawn": 6.0},
]

@export var tree_spacing := 5.0
@export var near_distance := 140.0 ## real meshes up to here, impostors beyond
@export var seed := 1234

# Per instance (parallel arrays).
var species := PackedByteArray()
var variant := PackedInt32Array() # index into _meshes
var xforms: Array[Transform3D] = []
var cell_of := PackedInt32Array()
var mm_index := PackedInt32Array()
var imp_index := PackedInt32Array()
var hp := PackedFloat32Array()
var state := PackedByteArray() # 0 standing, 1 felled / picked
var respawn_at := PackedFloat32Array()

var _meshes: Array[Mesh] = []
var _mesh_species := PackedInt32Array()
var _mesh_height := PackedFloat32Array()
var _mesh_width := PackedFloat32Array()
var _cells := {} # cell id -> {"mm": {variant: MultiMesh}, "body": RID, "shapes": PackedInt32Array}
var _body_cell := {} # body RID id -> cell id
var _impostor_mm: MultiMesh
var _impostor_mat: ShaderMaterial
var _shapes := {} # radius bucket -> shape RID
var _time := 0.0
var _bushes := PackedInt32Array()


func _enter_tree() -> void:
	main = self


func _ready() -> void:
	_load_meshes()
	_scatter()
	_build()
	_capture_impostors()


# ------------------------------------------------------------- setup ----

func _load_meshes() -> void:
	var scene := TREES_GLB.instantiate()
	var bark_pine := _bark_material("pine")
	var bark_birch := _bark_material("birch")
	var leaves := ShaderMaterial.new()
	leaves.shader = preload("res://game/world/shaders/tree_leaves.gdshader")
	leaves.set_shader_parameter("atlas", ATLAS)
	leaves.set_shader_parameter("atlas_size", Vector2(ATLAS.get_width(), ATLAS.get_height()))
	var leaves_bush := leaves.duplicate() as ShaderMaterial
	leaves_bush.set_shader_parameter("use_custom", true)
	for s in SPECIES.size():
		for mesh_name: String in SPECIES[s].meshes:
			var mi := scene.find_child(mesh_name, true, false) as MeshInstance3D
			var mesh := mi.mesh.duplicate() as ArrayMesh
			for i in mesh.get_surface_count():
				var mname := mesh.surface_get_material(i).resource_name if mesh.surface_get_material(i) else ""
				if mname.begins_with("bark"):
					mesh.surface_set_material(i, bark_birch if s == BIRCH else bark_pine)
				else:
					mesh.surface_set_material(i, leaves_bush if s == BRAMBLE else leaves)
			_meshes.append(mesh)
			_mesh_species.append(s)
			var aabb := mesh.get_aabb()
			_mesh_height.append(aabb.end.y)
			_mesh_width.append(maxf(aabb.size.x, aabb.size.z))
	scene.free()


func _bark_material(kind: String) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = preload("res://game/world/shaders/tree_bark.gdshader")
	var dir := "res://game/world/textures/trees/bark_%s_" % kind
	m.set_shader_parameter("albedo_tex", load(dir + "diff.jpg"))
	m.set_shader_parameter("normal_tex", load(dir + "nor_gl.jpg"))
	m.set_shader_parameter("arm_tex", load(dir + "arm.jpg"))
	m.set_shader_parameter("uv_scale", Vector2(1.0, 1.0) if kind == "pine" else Vector2(1.0, 0.8))
	m.set_shader_parameter("fade_start", near_distance - 12.0)
	m.set_shader_parameter("fade_end", near_distance)
	return m


func _scatter() -> void:
	var t := Terrain.main
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var masks := t.mask_image.get_data()
	var mw := t.mask_image.get_width()
	var spawn := t.spawn_point()
	var half := t.size * 0.5 - 8.0
	var by_species := [0, 0, 0, 0, 0]
	# Trees on a jittered grid, bushes on a sparser one.
	for pass_i in 2:
		var step := tree_spacing if pass_i == 0 else 11.0
		var n := int(t.size / step)
		for gz in n:
			for gx in n:
				var x := -half + (gx + rng.randf()) * step
				var z := -half + (gz + rng.randf()) * step
				var px := clampi(int((x + t.size * 0.5) / t.cell + 0.5), 0, mw - 1)
				var pz := clampi(int((z + t.size * 0.5) / t.cell + 0.5), 0, mw - 1)
				var o := (pz * mw + px) * 4
				var forest := masks[o + 2] / 255.0
				var macro := masks[o + 3] / 255.0
				var r := rng.randf()
				var sp := -1
				if pass_i == 0:
					if r > forest * 0.8 + 0.01:
						continue
					sp = SPRUCE
					var edge := forest < 0.45
					if macro > 0.64 or rng.randf() < 0.18:
						sp = PINE
					if edge and rng.randf() < 0.55:
						sp = BIRCH
					if _blight(x, z) > rng.randf() * 1.4 or rng.randf() < 0.025:
						sp = DEAD
				else:
					# Bramble likes forest edges and clearings.
					var edge_amt := 1.0 - absf(forest - 0.35) / 0.35
					if r > clampf(edge_amt, 0.0, 1.0) * 0.3 + 0.01:
						continue
					sp = BRAMBLE
				var h := t.height_at(x, z)
				if h < 3.2 or t.is_lake(x, z) or Vector2(x - spawn.x, z - spawn.z).length() < 24.0:
					continue
				if h > float(t.info.tree_line) + rng.randf_range(-15.0, 10.0):
					continue
				var nrm := t.normal_at(x, z)
				if nrm.y < 0.8:
					continue
				_add_instance(sp, rng, Vector3(x, h, z))
				by_species[sp] += 1
	print("foliage: %d spruce, %d pine, %d birch, %d dead, %d bramble" % by_species)


## 0..1: a blighted valley in the north-west where the forest is dead (and the Hollows gather).
func _blight(x: float, z: float) -> float:
	return clampf(1.0 - Vector2(x + 480.0, z + 170.0).length() / 260.0, 0.0, 1.0)


func _add_instance(sp: int, rng: RandomNumberGenerator, pos: Vector3) -> void:
	var first := 0
	for i in _mesh_species.size():
		if _mesh_species[i] == sp:
			first = i
			break
	var count: int = SPECIES[sp].meshes.size()
	var v := first + rng.randi() % count
	var s := rng.randf_range(0.8, 1.2)
	var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.92, 1.08), s))
	species.append(sp)
	variant.append(v)
	xforms.append(Transform3D(basis, pos))
	var cx := int(floor((pos.x + Terrain.main.size * 0.5) / CELL))
	var cz := int(floor((pos.z + Terrain.main.size * 0.5) / CELL))
	cell_of.append(cz * 1000 + cx)
	mm_index.append(-1)
	imp_index.append(-1)
	hp.append(SPECIES[sp].hp)
	state.append(0)
	respawn_at.append(0.0)
	if sp == BRAMBLE:
		_bushes.append(species.size() - 1)


func _build() -> void:
	# Group instances per cell and mesh.
	var groups := {} # cell -> {variant: PackedInt32Array of instance ids}
	for i in species.size():
		var c := cell_of[i]
		if not groups.has(c):
			groups[c] = {}
		var g: Dictionary = groups[c]
		if not g.has(variant[i]):
			g[variant[i]] = PackedInt32Array()
		g[variant[i]].append(i)
	var space := get_world_3d().space
	for c: int in groups:
		var cell := {"mm": {}, "body": RID(), "shapes": PackedInt32Array()}
		var center := Vector3(((c % 1000) + 0.5) * CELL - Terrain.main.size * 0.5, 0.0, ((c / 1000) + 0.5) * CELL - Terrain.main.size * 0.5)
		var body := PhysicsServer3D.body_create()
		PhysicsServer3D.body_set_mode(body, PhysicsServer3D.BODY_MODE_STATIC)
		PhysicsServer3D.body_set_space(body, space)
		PhysicsServer3D.body_set_collision_layer(body, 1)
		PhysicsServer3D.body_set_collision_mask(body, 1)
		PhysicsServer3D.body_attach_object_instance_id(body, get_instance_id())
		cell.body = body
		_body_cell[body.get_id()] = c
		for v: int in groups[c]:
			var ids: PackedInt32Array = groups[c][v]
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = _meshes[v]
			mm.instance_count = ids.size()
			for k in ids.size():
				var id := ids[k]
				mm.set_instance_transform(k, xforms[id])
				mm.set_instance_custom_data(k, Color(0, 0, 0, 0))
				mm_index[id] = k
				var sp := species[id]
				var radius: float = SPECIES[sp].radius
				if radius > 0.0:
					var sc := xforms[id].basis.get_scale().x
					var shape := _cylinder(radius * sc)
					var st := Transform3D(Basis(), xforms[id].origin + Vector3(0, 3.5, 0))
					PhysicsServer3D.body_add_shape(body, shape, st)
					cell.shapes.append(id)
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.position = Vector3.ZERO
			mmi.visibility_range_end = near_distance + CELL * 0.75
			mmi.name = "c%d_%d" % [c, v]
			add_child(mmi)
			cell.mm[v] = mm
		_cells[c] = cell


func _cylinder(radius: float) -> RID:
	var bucket := snappedf(radius, 0.05)
	if not _shapes.has(bucket):
		var shape := PhysicsServer3D.cylinder_shape_create()
		PhysicsServer3D.shape_set_data(shape, {"radius": bucket, "height": 7.0})
		_shapes[bucket] = shape
	return _shapes[bucket]


## Renders a side view of every mesh into an atlas, then fills the impostor MultiMesh.
func _capture_impostors() -> void:
	var cells := _meshes.size()
	var cw := 256
	var ch := 512
	var atlas := Image.create_empty(cw * cells, ch, false, Image.FORMAT_RGBA8)
	if DisplayServer.get_name() != "headless":
		# One small viewport per mesh, all rendered in the same frame (flat white ambient light and no
		# sun, so the capture is close to the plain albedo in any renderer).
		var env := Environment.new()
		env.background_mode = Environment.BG_CLEAR_COLOR
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color.WHITE
		env.ambient_light_energy = 1.0
		env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
		var vps: Array[SubViewport] = []
		for i in cells:
			var vp := SubViewport.new()
			vp.size = Vector2i(cw, ch)
			vp.transparent_bg = true
			vp.own_world_3d = true
			vp.render_target_update_mode = SubViewport.UPDATE_ONCE
			var we := WorldEnvironment.new()
			we.environment = env
			vp.add_child(we)
			var aabb := _meshes[i].get_aabb()
			var cam := Camera3D.new()
			cam.projection = Camera3D.PROJECTION_ORTHOGONAL
			cam.size = maxf(aabb.end.y, maxf(aabb.size.x, aabb.size.z) * 2.0) # vertical extent; cells are 1:2
			cam.position = Vector3(0, cam.size * 0.5, 60.0)
			cam.far = 200.0
			vp.add_child(cam)
			var mi := MeshInstance3D.new()
			mi.mesh = _meshes[i]
			vp.add_child(mi)
			add_child(vp)
			vps.append(vp)
			_mesh_height[i] = cam.size
			_mesh_width[i] = cam.size * 0.5
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		for i in cells:
			var img := vps[i].get_texture().get_image()
			img.convert(Image.FORMAT_RGBA8)
			atlas.blit_rect(img, Rect2i(0, 0, cw, ch), Vector2i(i * cw, 0))
			vps[i].queue_free()
	atlas.fix_alpha_edges()
	atlas.generate_mipmaps()
	_impostor_mat = ShaderMaterial.new()
	_impostor_mat.shader = preload("res://game/world/shaders/tree_impostor.gdshader")
	_impostor_mat.set_shader_parameter("atlas", ImageTexture.create_from_image(atlas))
	_impostor_mat.set_shader_parameter("cells", float(cells))
	_impostor_mat.set_shader_parameter("fade_start", near_distance - 12.0)
	_impostor_mat.set_shader_parameter("fade_end", near_distance)

	var ids := PackedInt32Array()
	for i in species.size():
		if species[i] != BRAMBLE:
			ids.append(i)
	_impostor_mm = MultiMesh.new()
	_impostor_mm.transform_format = MultiMesh.TRANSFORM_3D
	_impostor_mm.use_custom_data = true
	_impostor_mm.mesh = _cross_mesh()
	_impostor_mm.instance_count = ids.size()
	for k in ids.size():
		var id := ids[k]
		_impostor_mm.set_instance_transform(k, _impostor_xform(id))
		_impostor_mm.set_instance_custom_data(k, Color(variant[id], 0, 0, 0))
		imp_index[id] = k
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Impostors"
	mmi.multimesh = _impostor_mm
	mmi.material_override = _impostor_mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)


func _impostor_xform(id: int) -> Transform3D:
	var v := variant[id]
	var xf := xforms[id]
	var s := xf.basis.get_scale()
	return Transform3D(Basis(Vector3.UP, xf.basis.get_euler().y).scaled(Vector3(_mesh_width[v] * s.x, _mesh_height[v] * s.y, _mesh_width[v] * s.x)), xf.origin)


static func _cross_mesh() -> ArrayMesh:
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for q in 2:
		var d := Vector3(1, 0, 0) if q == 0 else Vector3(0, 0, 1)
		var b := verts.size()
		verts.append_array([-d * 0.5, d * 0.5, d * 0.5 + Vector3.UP, -d * 0.5 + Vector3.UP])
		uvs.append_array([Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)])
		idx.append_array([b, b + 1, b + 2, b, b + 2, b + 3])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = idx
	var normals := PackedVector3Array()
	normals.resize(8)
	normals.fill(Vector3.UP)
	arrays[Mesh.ARRAY_NORMAL] = normals
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


# ----------------------------------------------------------- gameplay ----

## The instance a physics hit refers to, or -1.
func hit_instance(collider_rid: RID, shape_index: int) -> int:
	var c: Variant = _body_cell.get(collider_rid.get_id())
	if c == null:
		return -1
	var shapes: PackedInt32Array = _cells[c].shapes
	return shapes[shape_index] if shape_index >= 0 and shape_index < shapes.size() else -1


## Nearest standing bush within `radius` (bushes have no collider to ray-cast against).
func nearest_bush(pos: Vector3, radius: float) -> int:
	var best := -1
	var best_d := radius * radius
	for i in _bushes:
		if state[i] != 0:
			continue
		var d := xforms[i].origin.distance_squared_to(pos)
		if d < best_d:
			best_d = d
			best = i
	return best


func species_name(id: int) -> String:
	return SPECIES[species[id]].name


## Chop damage; returns true when the tree comes down.
func damage(id: int, amount: float) -> bool:
	if id < 0 or state[id] != 0:
		return false
	hp[id] -= amount
	if hp[id] > 0.0:
		_shake(id)
		return false
	_fell(id)
	return true


func pick(id: int) -> bool:
	if id < 0 or state[id] != 0 or species[id] != BRAMBLE:
		return false
	state[id] = 1
	respawn_at[id] = _time + SPECIES[BRAMBLE].respawn * 60.0
	_cells[cell_of[id]].mm[variant[id]].set_instance_custom_data(mm_index[id], Color(1, 0, 0, 0))
	return true


func _set_visible(id: int, on: bool) -> void:
	var mm: MultiMesh = _cells[cell_of[id]].mm[variant[id]]
	mm.set_instance_transform(mm_index[id], xforms[id] if on else Transform3D(Basis().scaled(Vector3.ZERO), xforms[id].origin))
	if imp_index[id] >= 0 and _impostor_mm:
		_impostor_mm.set_instance_transform(imp_index[id], _impostor_xform(id) if on else Transform3D(Basis().scaled(Vector3.ZERO), xforms[id].origin))
	var cell: Dictionary = _cells[cell_of[id]]
	var k: int = cell.shapes.find(id)
	if k >= 0:
		PhysicsServer3D.body_set_shape_disabled(cell.body, k, not on)


func _shake(id: int) -> void:
	var mm: MultiMesh = _cells[cell_of[id]].mm[variant[id]]
	var xf := xforms[id]
	var tw := create_tween()
	var k := mm_index[id]
	tw.tween_method(func(a: float) -> void:
		mm.set_instance_transform(k, Transform3D(xf.basis.rotated(Vector3(1, 0, 0.4).normalized(), sin(a * 18.0) * 0.012 * (1.0 - a)), xf.origin)), 0.0, 1.0, 0.45)


func _fell(id: int) -> void:
	state[id] = 1
	respawn_at[id] = _time + float(SPECIES[species[id]].respawn) * 60.0
	_set_visible(id, false)
	# A falling copy that topples away from the player and sinks into the ground.
	var mi := MeshInstance3D.new()
	mi.mesh = _meshes[variant[id]]
	var xf := xforms[id]
	add_child(mi)
	mi.global_transform = xf
	var player := get_tree().get_first_node_in_group("player") as Node3D
	var away := Vector3(1, 0, 0)
	if player:
		away = (xf.origin - player.global_position) * Vector3(1, 0, 1)
		away = away.normalized() if away.length() > 0.01 else Vector3(1, 0, 0)
	var axis := Vector3.UP.cross(away).normalized()
	var tw := create_tween()
	tw.tween_method(func(a: float) -> void:
		mi.global_transform = Transform3D(Basis(axis, a * a * 1.45) * xf.basis, xf.origin), 0.0, 1.0, 2.2).set_trans(Tween.TRANS_QUAD)
	tw.tween_interval(1.5)
	tw.tween_property(mi, "position:y", xf.origin.y - 2.5, 3.0)
	tw.tween_callback(mi.queue_free)
	felled.emit(id, xf.origin)


func _process(delta: float) -> void:
	_time += delta
	# Regrowth: check a slice of instances each frame.
	if species.is_empty():
		return
	var n := mini(200, species.size())
	var start := int(_time * 60.0) * n % species.size()
	for k in n:
		var i := (start + k) % species.size()
		if state[i] != 0 and _time > respawn_at[i]:
			state[i] = 0
			hp[i] = SPECIES[species[i]].hp
			if species[i] == BRAMBLE:
				_cells[cell_of[i]].mm[variant[i]].set_instance_custom_data(mm_index[i], Color(0, 0, 0, 0))
			else:
				_set_visible(i, true)


func _exit_tree() -> void:
	for c: int in _cells:
		PhysicsServer3D.free_rid(_cells[c].body)
	for s: RID in _shapes.values():
		PhysicsServer3D.free_rid(s)
	if main == self:
		main = null


# --------------------------------------------------------------- save ----

func save_state() -> Dictionary:
	var down := {}
	for i in species.size():
		if state[i] != 0:
			down[i] = respawn_at[i] - _time
	return {"down": down}


func load_state(d: Dictionary) -> void:
	for key in d.get("down", {}):
		var i := int(key)
		if i < 0 or i >= species.size():
			continue
		if species[i] == BRAMBLE:
			pick(i)
		else:
			state[i] = 1
			_set_visible(i, false)
		respawn_at[i] = _time + float(d.down[key])
