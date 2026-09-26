extends Node
## Headless gameplay self-test: drives the real player code through the survival loop and prints
## PASS/FAIL per check, exiting non-zero on any failure.
##   godot --headless --path godot -- --selftest        (or: make selftest)

var player: Player
var _results: Array = []


func run(p: Player) -> void:
	player = p
	Engine.time_scale = 1.0
	await _frames(90)
	await _check("player stands on the ground", _t_ground)
	await _check("rendered terrain matches its collision", _t_collision)
	await _check("pick up stones and sticks with [E]", _t_pickup)
	await _check("gather plant fiber from tall grass", _t_fiber)
	await _check("craft a stone axe", _t_craft)
	await _check("chop down a tree for wood", _t_chop)
	await _check("mine stone with a pickaxe", _t_mine)
	await _check("kill a wolf with a spear and harvest it", _t_kill_wolf)
	await _check("wolves bite", _t_wolf_bites)
	await _check("place a campfire and cook meat", _t_campfire)
	await _check("a campfire keeps you warm at night", _t_warmth)
	await _check("drink from the lake", _t_drink)
	await _check("hunger and thirst drain; starving hurts", _t_starve)
	await _check("Hollows come out at night and burn at dawn", _t_hollows)
	await _check("shoot a Hollow with the bow", _t_bow)
	await _check("die and wake at the campfire", _t_respawn)
	await _check("save and load", _t_save)
	var failed := _results.filter(func(r: Array) -> bool: return not r[1])
	print("\nSELFTEST: %d/%d passed" % [_results.size() - failed.size(), _results.size()])
	Engine.time_scale = 1.0
	Game.quit(0 if failed.is_empty() else 1)


func _check(name: String, fn: Callable) -> void:
	var ok: bool = await fn.call()
	_results.append([name, ok])
	print(("PASS  " if ok else "FAIL  ") + name)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _seconds(s: float, scale := 4.0) -> void:
	Engine.time_scale = scale
	await get_tree().create_timer(s).timeout
	Engine.time_scale = 1.0


func _put(pos: Vector3) -> void:
	var t := Terrain.main
	player.global_position = Vector3(pos.x, t.height_at(pos.x, pos.z) + 0.15, pos.z)
	player.velocity = Vector3.ZERO
	await _frames(20)


func _aim(target: Vector3) -> void:
	var to := target - player.camera.global_position
	player.rotation.y = atan2(-to.x, -to.z)
	player.head.rotation.x = atan2(to.y, Vector2(to.x, to.z).length())
	await _frames(3)


func _stand_facing(target: Vector3, dist: float, height := 1.2) -> void:
	var here := player.global_position
	var away := Vector3(here.x - target.x, 0, here.z - target.z)
	away = away.normalized() if away.length() > 0.1 else Vector3.BACK
	await _put(target + away * dist)
	await _aim(target + Vector3(0, height, 0))


func _swing_until(done: Callable, max_swings := 14) -> bool:
	for i in max_swings:
		player.stamina = player.max_stamina
		player._attack_cd = 0.0
		player._swing()
		await get_tree().create_timer(0.7).timeout
		if done.call():
			return true
	return false


# ------------------------------------------------------------- tests ----

func _t_ground() -> bool:
	var g := Terrain.main.height_at(player.global_position.x, player.global_position.z)
	return player.is_on_floor() and absf(player.global_position.y - g) < 0.35


func _t_collision() -> bool:
	var space := player.get_world_3d().direct_space_state
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var worst := 0.0
	var n := 0
	while n < 40:
		var x := rng.randf_range(-700, 700)
		var z := rng.randf_range(-700, 700)
		var q := PhysicsRayQueryParameters3D.create(Vector3(x, 600, z), Vector3(x, -100, z), 1)
		var hit := space.intersect_ray(q)
		if hit.is_empty() or not hit.collider.is_in_group("terrain"):
			continue
		worst = maxf(worst, absf(hit.position.y - Terrain.main.height_at(x, z)))
		n += 1
	print("      max render/collision height difference: %.3f m" % worst)
	return worst < 0.05


func _t_pickup() -> bool:
	var before := player.inventory.count("stone") + player.inventory.count("stick")
	var id := Props.main.nearest_pickup(player.global_position, 200.0)
	if id < 0:
		return false
	await _stand_facing(Props.main.xforms[id].origin, 1.6, 0.0)
	player._interact()
	await _frames(2)
	return player.inventory.count("stone") + player.inventory.count("stick") > before


func _t_fiber() -> bool:
	var t := Terrain.main
	var start := t.spawn_point() + Vector3(0, 0, -160)
	for i in 60:
		var p := start + Vector3(randf_range(-40, 40), 0, randf_range(-40, 40))
		if player._grassy(Vector3(p.x, t.height_at(p.x, p.z), p.z)) and t.normal_at(p.x, p.z).y > 0.9:
			await _put(p)
			await _aim(player.global_position + (-player.global_basis.z) * 1.6)
			break
	var before := player.inventory.count("fiber")
	player._interact_cd = 0.0
	player._interact()
	if player.inventory.count("fiber") <= before:
		print("      prompt was: '%s'" % player.prompt)
	return player.inventory.count("fiber") > before


func _t_craft() -> bool:
	player.inventory.add("stick", 6)
	player.inventory.add("stone", 6)
	player.inventory.add("fiber", 8)
	var ok := player.inventory.craft(Items.RECIPES[0])
	player.inventory.select(player.inventory.hotbar.find("stone_axe"))
	await _frames(2)
	return ok and player.inventory.held() == "stone_axe"


func _t_chop() -> bool:
	var f := Foliage.main
	var best := -1
	var best_d := INF
	for i in f.species.size():
		if f.species[i] in [Foliage.SPRUCE, Foliage.BIRCH, Foliage.PINE] and f.state[i] == 0:
			var d := f.xforms[i].origin.distance_to(player.global_position)
			if d < best_d:
				best_d = d
				best = i
	if best < 0:
		return false
	await _stand_facing(f.xforms[best].origin, 1.5, 1.3)
	var before := player.inventory.count("wood")
	var felled := await _swing_until(func() -> bool: return f.state[best] != 0)
	return felled and player.inventory.count("wood") > before


func _t_mine() -> bool:
	player.inventory.add("stick", 2)
	player.inventory.add("stone", 3)
	player.inventory.add("fiber", 3)
	player.inventory.craft(Items.RECIPES[1])
	player.inventory.select(player.inventory.hotbar.find("pickaxe"))
	var p := Props.main
	var t := Terrain.main
	var best := -1
	var best_d := INF
	for i in p.kind.size():
		if p.kind[i] == Props.Kind.ROCK and p.is_mineable(i):
			var top := p.xforms[i].origin.y + p._meshes[p.mesh_of[i]].get_aabb().end.y * p.xforms[i].basis.get_scale().y
			var ground := t.height_at(p.xforms[i].origin.x, p.xforms[i].origin.z)
			var d := p.xforms[i].origin.distance_to(player.global_position)
			if top - ground > 0.8 and d < best_d:
				best_d = d
				best = i
	if best < 0:
		return false
	var o := p.xforms[best].origin
	var s := p.xforms[best].basis.get_scale().x
	var aabb := p._meshes[p.mesh_of[best]].get_aabb()
	# Its collider must be there: a ray from above lands on the rock, not the ground.
	var down := player.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(o + Vector3(0, 20, 0), o - Vector3(0, 5, 0), 1))
	if down.is_empty() or down.collider != p:
		print("      no rock collider under the ray at %s (hit %s)" % [o, down.get("collider")])
		return false
	var mid := (o.y + aabb.end.y * s + t.height_at(o.x, o.z)) * 0.5 - o.y
	await _stand_facing(o, 1.2 + maxf(aabb.size.x, aabb.size.z) * s * 0.5, mid)
	var before := player.inventory.count("stone")
	var ok: bool = await _swing_until(func() -> bool: return player.inventory.count("stone") > before, 6)
	if not ok:
		print("      rock %d at %s scale %.2f, player at %s, prompt '%s'" % [best, p.xforms[best].origin, s, player.global_position, player.prompt])
	return ok


func _spawn(e: Enemy, dist: float) -> Enemy:
	var fwd := -player.global_basis.z
	var p := player.global_position + Vector3(fwd.x, 0, fwd.z).normalized() * dist
	get_tree().current_scene.add_child(e)
	e.global_position = Vector3(p.x, Terrain.main.height_at(p.x, p.z) + 0.1, p.z)
	return e


func _t_kill_wolf() -> bool:
	await _put(Terrain.main.spawn_point() + Vector3(8, 0, -20))
	player.inventory.add("spear")
	player.inventory.select(player.inventory.hotbar.find("spear"))
	Game.set_meta("freeze_ai", true)
	var w := _spawn(Wolf.new(), 2.2)
	await _frames(10)
	await _aim(w.global_position + Vector3(0, 0.6, 0))
	var dead := await _swing_until(func() -> bool:
		if is_instance_valid(w) and not w.dead:
			player.global_position = w.global_position + (player.global_position - w.global_position).normalized() * 2.2
		return is_instance_valid(w) and w.dead, 12)
	Game.set_meta("freeze_ai", false)
	if not dead:
		return false
	var meat := player.inventory.count("raw_meat")
	w.interact(player)
	return player.inventory.count("raw_meat") >= meat + 2 and player.inventory.count("hide") >= 1


func _t_wolf_bites() -> bool:
	player.health = 100.0
	var w := _spawn(Wolf.new(), 6.0)
	await _seconds(6.0)
	var bitten := player.health < 100.0
	if is_instance_valid(w):
		w.queue_free()
	player.health = 100.0
	return bitten


func _t_campfire() -> bool:
	player.inventory.add("campfire")
	player.inventory.select(player.inventory.hotbar.find("campfire"))
	await _aim(player.global_position + (-player.global_basis.z) * 2.5 + Vector3(0, 0.0, 0))
	await _frames(3)
	player._place()
	await _frames(3)
	var fires := get_tree().get_nodes_in_group("campfire")
	if fires.is_empty():
		return false
	var fire: Node3D = fires[0]
	var before := player.inventory.count("cooked_meat")
	fire.interact(player)
	return player.inventory.count("cooked_meat") == before + 1 and player.respawn_point != Vector3.INF


func _t_warmth() -> bool:
	DayNight.main.time_of_day = 23.0
	player.warmth = 30.0
	await _seconds(3.0)
	return player.near_fire and player.warmth > 30.0


func _t_drink() -> bool:
	var lake: Dictionary = Terrain.main.info.lake
	var t := Terrain.main
	# Walk out from the lake centre until the ground rises just above the water.
	for s in range(0, 400, 2):
		var p := Vector3(lake.x, 0, lake.z + s)
		if t.height_at(p.x, p.z) > lake.level + 0.3:
			await _put(p)
			await _aim(Vector3(lake.x, lake.level, lake.z + s - 3.0))
			break
	player.thirst = 40.0
	await _frames(3)
	player._interact_cd = 0.0
	player._interact()
	return player.thirst > 50.0


func _t_starve() -> bool:
	player.hunger = 50.0
	player.thirst = 50.0
	await _seconds(4.0)
	var drains := player.hunger < 50.0 and player.thirst < 50.0
	player.hunger = 0.0
	player.thirst = 0.0
	var h := player.health
	await _seconds(3.0)
	var hurts := player.health < h
	player.hunger = 100.0
	player.thirst = 100.0
	return drains and hurts


func _t_hollows() -> bool:
	await _put(Terrain.main.spawn_point() + Vector3(-60, 0, -120))
	DayNight.main.time_of_day = 23.5
	var spawner := get_tree().current_scene.get_node("Spawner") as EnemySpawner
	spawner._alive = 1000.0
	var found := false
	for i in 12:
		await _seconds(1.0)
		if not get_tree().get_nodes_in_group("hollow").is_empty():
			found = true
			break
	DayNight.main.time_of_day = 9.0
	await _seconds(2.0)
	var alive := get_tree().get_nodes_in_group("hollow").filter(func(h: Node) -> bool: return not h.dead)
	return found and alive.is_empty()


func _t_bow() -> bool:
	DayNight.main.time_of_day = 22.0
	player.inventory.add("bow")
	player.inventory.add("arrow", 10)
	player.inventory.select(player.inventory.hotbar.find("bow"))
	await _frames(5) # let the night register before a Hollow appears
	Game.set_meta("freeze_ai", true)
	var h := _spawn(Hollow.new(), 9.0) as Hollow
	await _frames(10)
	var arrows := player.inventory.count("arrow")
	for i in 8:
		if h.dead:
			break
		await _aim(h.global_position + Vector3(0, 1.3, 0))
		player._primary(true)
		await _seconds(1.0, 1.0)
		await _aim(h.global_position + Vector3(0, 1.3, 0))
		player._primary(false)
		await _seconds(1.0, 1.0)
	Game.set_meta("freeze_ai", false)
	return h.dead and player.inventory.count("arrow") < arrows


func _t_respawn() -> bool:
	player.take_damage(500.0, player.global_position)
	await _frames(5)
	var died := player.dead
	player.respawn()
	await _frames(20)
	return died and not player.dead and player.global_position.distance_to(player.respawn_point) < 5.0


func _t_save() -> bool:
	Game.save_game()
	var d := Game.load_game()
	var inv: Dictionary = d.get("player", {}).get("inventory", {}).get("counts", {})
	return Game.has_save() and int(inv.get("cooked_meat", 0)) == player.inventory.count("cooked_meat") and d.has("campfires")
