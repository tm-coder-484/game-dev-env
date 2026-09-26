class_name EnemySpawner
extends Node
## Keeps the island populated around the player: wolf packs in the forests (more at night), and
## Hollows after dark (many more in the Blight), rising with each day survived. Despawns what's far
## away, never spawns in sight or inside a campfire's light.

@export var wolf_packs_day := 1
@export var wolf_packs_night := 2
@export var hollows_base := 3
@export var grace_seconds := 75.0 ## no wolves right after waking up on the beach

var _t := 0.0
var _alive := 0.0


func _process(delta: float) -> void:
	var p := Game.player as Player
	if p == null or p.dead or Terrain.main == null:
		return
	_alive += delta
	_t -= delta
	if _t > 0.0:
		return
	_t = 2.0
	var night := DayNight.main != null and DayNight.main.is_night
	var day := DayNight.main.day if DayNight.main else 1
	var wolves := 0
	var hollows := 0
	for e: Node3D in get_tree().get_nodes_in_group("enemy"):
		if e.get("dead"):
			continue
		if e.global_position.distance_to(p.global_position) > 230.0:
			e.queue_free()
			continue
		if e is Wolf:
			wolves += 1
		elif e is Hollow:
			hollows += 1
	if _alive > grace_seconds and wolves < (wolf_packs_night if night else wolf_packs_day) * 3:
		_spawn_pack(p)
	if night:
		var blight := Foliage.main._blight(p.global_position.x, p.global_position.z) if Foliage.main else 0.0
		var cap := mini(hollows_base + (day - 1) + int(blight * 4.0), 9)
		if hollows < cap:
			_spawn(Hollow.new(), p, 45.0, 90.0, false)


func _spawn_pack(p: Player) -> void:
	var pos := _find_spot(p, 80.0, 130.0, true)
	if pos == Vector3.INF:
		return
	var n := randi_range(2, 3)
	for i in n:
		var w := Wolf.new()
		get_tree().current_scene.add_child(w)
		var o := Vector3(randf_range(-4, 4), 0, randf_range(-4, 4))
		w.global_position = Vector3(pos.x + o.x, Terrain.main.height_at(pos.x + o.x, pos.z + o.z) + 0.3, pos.z + o.z)


func _spawn(e: Enemy, p: Player, r0: float, r1: float, forest: bool) -> void:
	var pos := _find_spot(p, r0, r1, forest)
	if pos == Vector3.INF:
		e.free()
		return
	get_tree().current_scene.add_child(e)
	e.global_position = pos + Vector3(0, 0.3, 0)


## A random dry, walkable spot at r0..r1 metres from the player, out of view and away from fires.
func _find_spot(p: Player, r0: float, r1: float, forest: bool) -> Vector3:
	var t := Terrain.main
	var view := -p.camera.global_basis.z
	for i in 20:
		var a := randf() * TAU
		var r := randf_range(r0, r1)
		var x := p.global_position.x + cos(a) * r
		var z := p.global_position.z + sin(a) * r
		if not t.in_bounds(x, z, 30.0):
			continue
		var h := t.height_at(x, z)
		if h < 2.0 or Game.water_at(x, z).height > h - 0.2 or t.normal_at(x, z).y < 0.8:
			continue
		if forest and t.mask_at(x, z).b < 0.35:
			continue
		var to := Vector3(x, h, z) - p.global_position
		if to.normalized().dot(view) > 0.5 and r < 110.0:
			continue # don't pop into view
		var near_fire := false
		for c in get_tree().get_nodes_in_group("campfire"):
			if c.global_position.distance_to(Vector3(x, h, z)) < 30.0:
				near_fire = true
		if near_fire:
			continue
		return Vector3(x, h, z)
	return Vector3.INF
