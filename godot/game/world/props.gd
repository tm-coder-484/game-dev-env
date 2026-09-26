class_name Props
extends Node3D
## Rocks, boulders, logs, stumps, ferns and pickups (pebbles, stick piles), scattered from the world
## masks. Drawn as per-cell MultiMeshes with visibility ranges; solid ones collide through
## PhysicsServer3D convex shapes. The player picks up pebbles/sticks and mines rocks via this API.

static var main: Props

const PROPS_GLB := preload("res://game/world/models/props.glb")
const CELL := 128.0

enum Kind { ROCK, BOULDER, PEBBLE, STICKS, FERN, LOG, STUMP }
# name prefix in props.glb, draw distance, solid, scale range
const KINDS := {
	Kind.ROCK: {"prefix": "mossrock_", "range": 420.0, "solid": true, "scale": Vector2(0.45, 1.5)},
	Kind.BOULDER: {"prefix": "boulder_", "range": 700.0, "solid": true, "scale": Vector2(1.2, 3.2)},
	Kind.PEBBLE: {"prefix": "pebble_", "range": 60.0, "solid": false, "scale": Vector2(2.4, 3.2)},
	Kind.STICKS: {"prefix": "sticks_", "range": 60.0, "solid": false, "scale": Vector2(0.9, 1.2)},
	Kind.FERN: {"prefix": "fern_", "range": 70.0, "solid": false, "scale": Vector2(1.0, 1.8)},
	Kind.LOG: {"prefix": "log_", "range": 200.0, "solid": true, "scale": Vector2(1.0, 1.5)},
	Kind.STUMP: {"prefix": "stump_", "range": 200.0, "solid": true, "scale": Vector2(0.7, 1.1)},
}

@export var seed := 99

var kind := PackedByteArray()
var mesh_of := PackedInt32Array()
var xforms: Array[Transform3D] = []
var taken := PackedByteArray()
var respawn_at := PackedFloat32Array()
var ore := PackedInt32Array() ## stone left in a rock before it's mined out (for a while)

var _meshes: Array[Mesh] = []
var _mesh_kind := PackedInt32Array()
var _shapes: Array[RID] = []
var _cells := {} # cell -> {"mm": {mesh: MultiMesh}, "idx": {id: k}, "body": RID, "shape_ids": PackedInt32Array}
var _body_cell := {}
var _pickups := PackedInt32Array()
var _depleted: Array[int] = []
var _time := 0.0


func _enter_tree() -> void:
	main = self


func _ready() -> void:
	var scene := PROPS_GLB.instantiate()
	for k: int in KINDS:
		var i := 0
		while true:
			var mi := scene.find_child("%s%d" % [KINDS[k].prefix, i], true, false) as MeshInstance3D
			if mi == null:
				break
			_meshes.append(mi.mesh)
			_mesh_kind.append(k)
			_shapes.append(_convex(mi.mesh) if KINDS[k].solid else RID())
			i += 1
	scene.free()
	_scatter()
	_build()


func _convex(mesh: Mesh) -> RID:
	var shape := PhysicsServer3D.convex_polygon_shape_create()
	var cs := mesh.create_convex_shape(true, true) as ConvexPolygonShape3D
	PhysicsServer3D.shape_set_data(shape, cs.points)
	return shape


func _meshes_of(k: int) -> PackedInt32Array:
	var out := PackedInt32Array()
	for i in _mesh_kind.size():
		if _mesh_kind[i] == k:
			out.append(i)
	return out


func _scatter() -> void:
	var t := Terrain.main
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var masks := t.mask_image.get_data()
	var mw := t.mask_image.get_width()
	var spawn := t.spawn_point()
	var half := t.size * 0.5 - 8.0
	var counts := {}
	var step := 7.0
	var n := int(t.size / step)
	for gz in n:
		for gx in n:
			var x := -half + (gx + rng.randf()) * step
			var z := -half + (gz + rng.randf()) * step
			var px := clampi(int((x + t.size * 0.5) / t.cell + 0.5), 0, mw - 1)
			var pz := clampi(int((z + t.size * 0.5) / t.cell + 0.5), 0, mw - 1)
			var o := (pz * mw + px) * 4
			var forest := masks[o + 2] / 255.0
			var sediment := masks[o + 1] / 255.0
			var h := t.height_at(x, z)
			if h < 0.6 or t.is_lake(x, z):
				continue
			var ny := t.normal_at(x, z).y
			var near_spawn := Vector2(x - spawn.x, z - spawn.z).length() < 70.0
			# Probability bands, stacked: each kind gets its own slice of [0, 1).
			var bands := [
				[Kind.BOULDER, (0.09 + sediment * 0.2) if ny < 0.82 else 0.0],
				[Kind.ROCK, 0.018 + forest * 0.03 + sediment * 0.05],
				[Kind.FERN, (0.06 + forest * 0.3) if forest > 0.3 else 0.0],
				[Kind.LOG if rng.randf() < 0.5 else Kind.STUMP, (0.012 + forest * 0.03) if forest > 0.4 else 0.0],
				[Kind.PEBBLE if rng.randf() < 0.55 else Kind.STICKS, (0.12 if near_spawn else 0.018) + forest * 0.02],
			]
			var r := rng.randf()
			var k := -1
			var acc := 0.0
			for band: Array in bands:
				acc += band[1]
				if r < acc:
					k = band[0]
					break
			if k < 0 or ny < 0.6 and k != Kind.BOULDER:
				continue
			if Vector2(x - spawn.x, z - spawn.z).length() < 10.0 and KINDS[k].solid:
				continue
			_add(k, rng, x, z, h, t.normal_at(x, z))
			counts[k] = counts.get(k, 0) + 1
	print("props: ", counts)


func _add(k: int, rng: RandomNumberGenerator, x: float, z: float, h: float, nrm: Vector3) -> void:
	var options := _meshes_of(k)
	var m := options[rng.randi() % options.size()]
	var sr: Vector2 = KINDS[k].scale
	var s := rng.randf_range(sr.x, sr.y)
	if k == Kind.ROCK and rng.randf() < 0.08:
		s *= 2.4 # the odd landmark boulder
	var up := Vector3.UP.lerp(nrm, 0.6 if k != Kind.FERN else 0.3).normalized()
	var basis := Basis(Vector3.UP, rng.randf() * TAU)
	if k == Kind.LOG:
		basis = Basis(Vector3.UP, rng.randf() * TAU) # logs lie along their length already
	basis = Basis(Quaternion(Vector3.UP, up)) * basis
	var sink: float = {Kind.ROCK: 0.25, Kind.BOULDER: 0.3, Kind.PEBBLE: 0.01, Kind.STICKS: 0.02, Kind.FERN: 0.03, Kind.LOG: 0.06, Kind.STUMP: 0.12}[k]
	kind.append(k)
	mesh_of.append(m)
	xforms.append(Transform3D(basis.scaled(Vector3(s, s, s)), Vector3(x, h - sink * s, z)))
	taken.append(0)
	respawn_at.append(0.0)
	ore.append(int(3 + s * 3) if k == Kind.ROCK or k == Kind.BOULDER else 0)
	if k == Kind.PEBBLE or k == Kind.STICKS:
		_pickups.append(kind.size() - 1)


func _build() -> void:
	var space := get_world_3d().space
	for i in kind.size():
		var c := _cell_id(xforms[i].origin)
		if not _cells.has(c):
			var body := PhysicsServer3D.body_create()
			PhysicsServer3D.body_set_mode(body, PhysicsServer3D.BODY_MODE_STATIC)
			PhysicsServer3D.body_set_space(body, space)
			PhysicsServer3D.body_attach_object_instance_id(body, get_instance_id())
			_cells[c] = {"mm": {}, "ids": {}, "body": body, "shape_ids": PackedInt32Array()}
			_body_cell[body.get_id()] = c
		var cell: Dictionary = _cells[c]
		if not cell.ids.has(mesh_of[i]):
			cell.ids[mesh_of[i]] = PackedInt32Array()
		cell.ids[mesh_of[i]].append(i)
		if _shapes[mesh_of[i]].is_valid():
			PhysicsServer3D.body_add_shape(cell.body, _shapes[mesh_of[i]], xforms[i])
			cell.shape_ids.append(i)
	for c: int in _cells:
		var cell: Dictionary = _cells[c]
		cell["slot"] = {}
		for m: int in cell.ids:
			var ids: PackedInt32Array = cell.ids[m]
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = _meshes[m]
			mm.instance_count = ids.size()
			for k in ids.size():
				mm.set_instance_transform(k, xforms[ids[k]])
				cell.slot[ids[k]] = k
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.visibility_range_end = KINDS[_mesh_kind[m]].range + CELL * 0.7
			mmi.visibility_range_end_margin = 10.0
			if _mesh_kind[m] == Kind.FERN or _mesh_kind[m] == Kind.PEBBLE or _mesh_kind[m] == Kind.STICKS:
				mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mmi)
			cell.mm[m] = mm


func _cell_id(p: Vector3) -> int:
	var half := Terrain.main.size * 0.5
	return int(floor((p.z + half) / CELL)) * 1000 + int(floor((p.x + half) / CELL))


# ----------------------------------------------------------- gameplay ----

## Nearest pickup (pebble or sticks) within `radius`, or -1.
func nearest_pickup(pos: Vector3, radius: float) -> int:
	var best := -1
	var best_d := radius * radius
	for i in _pickups:
		if taken[i]:
			continue
		var d := xforms[i].origin.distance_squared_to(pos)
		if d < best_d:
			best_d = d
			best = i
	return best


## The prop a physics hit refers to, or -1.
func hit_instance(collider_rid: RID, shape_index: int) -> int:
	var c: Variant = _body_cell.get(collider_rid.get_id())
	if c == null:
		return -1
	var ids: PackedInt32Array = _cells[c].shape_ids
	return ids[shape_index] if shape_index >= 0 and shape_index < ids.size() else -1


func is_mineable(id: int) -> bool:
	return id >= 0 and (kind[id] == Kind.ROCK or kind[id] == Kind.BOULDER) and ore[id] > 0


## Take a pickup: returns {"item": name, "count": n} or {}.
func take(id: int) -> Dictionary:
	if id < 0 or taken[id]:
		return {}
	taken[id] = 1
	respawn_at[id] = _time + 480.0
	_set_visible(id, false)
	return {"item": "stone", "count": 1} if kind[id] == Kind.PEBBLE else {"item": "stick", "count": 2}


## One swing at a rock: returns stones gained (0 when it's mined out for now).
func mine(id: int) -> int:
	if not is_mineable(id):
		return 0
	ore[id] -= 1
	if ore[id] <= 0:
		respawn_at[id] = _time + 900.0
		_depleted.append(id)
	return 1


func _set_visible(id: int, on: bool) -> void:
	var cell: Dictionary = _cells[_cell_id(xforms[id].origin)]
	var mm: MultiMesh = cell.mm[mesh_of[id]]
	mm.set_instance_transform(cell.slot[id], xforms[id] if on else Transform3D(Basis().scaled(Vector3.ZERO), xforms[id].origin))


func _process(delta: float) -> void:
	_time += delta
	if Engine.get_process_frames() % 30 != 0:
		return
	for i in _pickups:
		if taken[i] and _time > respawn_at[i]:
			taken[i] = 0
			_set_visible(i, true)
	for i in _depleted.duplicate():
		if _time > respawn_at[i]:
			ore[i] = 4
			_depleted.erase(i)


func _exit_tree() -> void:
	for c: int in _cells:
		PhysicsServer3D.free_rid(_cells[c].body)
	for s in _shapes:
		if s.is_valid():
			PhysicsServer3D.free_rid(s)
	if main == self:
		main = null
