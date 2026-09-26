class_name Player
extends CharacterBody3D
## The survivor. First-person movement (walk, sprint, jump, swim), survival stats (health, stamina,
## hunger, thirst, warmth), gathering, crafting materials, melee and bow combat, campfire placement.
## Keyboard/mouse: WASD, mouse, Space, Shift, LMB use/attack, RMB block/aim, E interact, 1-8 or wheel
## for the hotbar, Tab crafting, M map, Esc menu. Gamepads work too (see project.godot actions).

signal died
signal hurt(amount: float, from: Vector3)
signal hit_landed(killed: bool)

const INTERACT_RANGE := 3.2
const HUNGER_RATE := 100.0 / (26.0 * 60.0) ## empty after 26 minutes
const THIRST_RATE := 100.0 / (17.0 * 60.0)
const ENEMY_MASK := 4 ## physics layer 3
const WORLD_MASK := 1

@export var walk_speed := 4.3
@export var sprint_speed := 7.4
@export var swim_speed := 2.4
@export var jump_velocity := 4.7
@export var acceleration := 12.0
@export var air_control := 0.3
@export var stick_sensitivity := 3.0
@export var safe_fall_speed := 9.5

var max_health := 100.0
var health := 100.0
var max_stamina := 100.0
var stamina := 100.0
var hunger := 100.0
var thirst := 100.0
var warmth := 100.0
var inventory := Inventory.new()
var dead := false
var swimming := false
var blocking := false
var sprinting := false
var respawn_point := Vector3.INF
var prompt := "" ## what [E]/[LMB] would do right now (read by the HUD)
var status := "" ## the most urgent survival warning (read by the HUD)
var bow_draw := -1.0 ## 0..1 while drawing, -1 otherwise
var near_fire := false
var kills := 0

var _target := {}
var _attack_cd := 0.0
var _heal_left := 0.0
var _trauma := 0.0
var _fall_speed := 0.0
var _bob_time := 0.0
var _regen_delay := 0.0
var _exhausted := false
var _since_hurt := 99.0
var _interact_cd := 0.0
var _ghost: Node3D
var _ghost_ok := false
var _head_height := 1.65
var _land_dip := 0.0
var _step_time := 0.0
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var viewmodel: Viewmodel = $Head/Camera3D/Viewmodel
@onready var sfx: PlayerAudio = $Audio


func _ready() -> void:
	add_to_group("player")
	Game.player = self
	collision_layer = 2
	collision_mask = WORLD_MASK | ENEMY_MASK
	_head_height = head.position.y
	camera.fov = Game.settings.fov
	Game.settings_changed.connect(func() -> void: camera.fov = Game.settings.fov)
	inventory.changed.connect(_on_inventory_changed)
	_on_inventory_changed()


# --------------------------------------------------------------- input ----

func _unhandled_input(event: InputEvent) -> void:
	if dead or Game.ui_open:
		return
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s: float = 0.0024 * Game.settings.mouse_sensitivity
		var d: Vector2 = event.screen_relative * s
		if Game.settings.invert_y:
			d.y = -d.y
		_look(d)
		viewmodel.add_sway(event.screen_relative)
	elif event.is_action_pressed("attack"):
		_primary(true)
	elif event.is_action_released("attack"):
		_primary(false)
	elif event.is_action_pressed("aim"):
		_secondary(true)
	elif event.is_action_released("aim"):
		_secondary(false)
	elif event.is_action_pressed("interact"):
		_interact()
	elif event.is_action_pressed("hotbar_next"):
		inventory.select(inventory.selected + 1)
	elif event.is_action_pressed("hotbar_prev"):
		inventory.select(inventory.selected - 1)
	else:
		for i in Inventory.HOTBAR_SIZE:
			if event.is_action_pressed("hotbar_%d" % (i + 1)):
				inventory.select(i)


func _look(d: Vector2) -> void:
	rotate_y(-d.x)
	head.rotation.x = clampf(head.rotation.x - d.y, deg_to_rad(-88), deg_to_rad(88))


# ------------------------------------------------------------ movement ----

func _physics_process(delta: float) -> void:
	if dead:
		velocity.y -= _gravity * delta
		velocity.x = move_toward(velocity.x, 0, 10 * delta)
		velocity.z = move_toward(velocity.z, 0, 10 * delta)
		move_and_slide()
		return
	var stick := Input.get_vector("look_left", "look_right", "look_up", "look_down")
	if stick != Vector2.ZERO and not Game.ui_open:
		_look(stick * stick_sensitivity * delta)
	var input := Vector2.ZERO if Game.ui_open else Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var water: Dictionary = Game.water_at(global_position.x, global_position.z)
	var depth: float = water.height - global_position.y
	swimming = depth > 1.3
	if swimming:
		_swim(delta, input, water.height)
	else:
		_walk(delta, input)
	var was_air := not is_on_floor()
	_fall_speed = maxf(_fall_speed, -velocity.y) if was_air else 0.0
	move_and_slide()
	if was_air and is_on_floor():
		_land_dip = clampf(_fall_speed * 0.012, 0.0, 0.12)
		if _fall_speed > safe_fall_speed and not swimming:
			take_damage((_fall_speed - safe_fall_speed) * 7.0, global_position + Vector3.DOWN)
		elif _fall_speed > 3.0:
			sfx.play("land")
	# Stay on the island.
	var half := Terrain.main.size * 0.5 - 12.0 if Terrain.main else 1e9
	global_position.x = clampf(global_position.x, -half, half)
	global_position.z = clampf(global_position.z, -half, half)

	_survival(delta)
	_update_target()
	_update_bow(delta)
	_update_ghost()
	_attack_cd -= delta
	_interact_cd -= delta
	_camera_fx(delta)
	RenderingServer.global_shader_parameter_set("player_position", global_position)


func _walk(delta: float, input: Vector2) -> void:
	if not is_on_floor():
		velocity.y -= _gravity * delta
	elif Input.is_action_just_pressed("jump") and not Game.ui_open and stamina > 5.0:
		velocity.y = jump_velocity
		stamina -= 4.0
		sfx.play("jump")
	var dir := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
	sprinting = _update_stamina(delta, Input.is_action_pressed("sprint") and input.y < 0.1 and input != Vector2.ZERO)
	var speed := sprint_speed if sprinting else walk_speed
	if blocking or bow_draw >= 0.0:
		speed *= 0.55
	if warmth < 15.0:
		speed *= 0.85
	var accel := acceleration * (1.0 if is_on_floor() else air_control)
	velocity.x = move_toward(velocity.x, dir.x * speed, accel * speed * delta)
	velocity.z = move_toward(velocity.z, dir.z * speed, accel * speed * delta)
	# Footsteps.
	var hv := Vector2(velocity.x, velocity.z).length()
	if is_on_floor() and hv > 1.0:
		_step_time += delta * hv
		if _step_time > 2.1:
			_step_time = 0.0
			sfx.footstep(_surface())


func _swim(delta: float, input: Vector2, surface: float) -> void:
	var look := -camera.global_basis.z
	var dir := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
	sprinting = _update_stamina(delta, Input.is_action_pressed("sprint") and input != Vector2.ZERO)
	var speed := swim_speed * (1.6 if sprinting else 1.0)
	velocity.x = move_toward(velocity.x, dir.x * speed, 4.0 * delta)
	velocity.z = move_toward(velocity.z, dir.z * speed, 4.0 * delta)
	# Float with the head just above the surface; Space swims up, looking down and moving dives a little.
	var target_y := surface - 1.45
	if input.y < -0.1 and look.y < -0.5:
		target_y -= 1.5
	var vy := (target_y - global_position.y) * 2.5
	if Input.is_action_pressed("jump"):
		vy = maxf(vy, 1.2)
	velocity.y = move_toward(velocity.y, clampf(vy, -2.0, 2.0), 8.0 * delta)
	if Vector2(velocity.x, velocity.z).length() > 0.5:
		_step_time += delta
		if _step_time > 0.9:
			_step_time = 0.0
			sfx.play("swim")


func _update_stamina(delta: float, wants: bool) -> bool:
	var ok := wants and not _exhausted and (is_on_floor() or swimming)
	if ok:
		stamina = maxf(0.0, stamina - (18.0 if not swimming else 10.0) * delta)
		_regen_delay = 0.9
		_exhausted = stamina <= 0.0
	elif _regen_delay > 0.0:
		_regen_delay -= delta
	else:
		var regen := 17.0 * (0.5 if hunger < 15.0 or thirst < 15.0 else 1.0) * (0.6 if warmth < 20.0 else 1.0)
		stamina = minf(max_stamina, stamina + regen * delta)
		if _exhausted and stamina > max_stamina * 0.3:
			_exhausted = false
	return ok


## What kind of ground we're walking on, for footstep sounds.
func _surface() -> String:
	var t := Terrain.main
	if t == null:
		return "grass"
	var p := global_position
	if Game.water_at(p.x, p.z).height > p.y - 0.2:
		return "water"
	if p.y < 2.5:
		return "sand"
	var m := t.mask_at(p.x, p.z)
	if t.normal_at(p.x, p.z).y < 0.75:
		return "rock"
	return "leaves" if m.b > 0.5 else "grass"


# ------------------------------------------------------------ survival ----

func _survival(delta: float) -> void:
	var exertion := 1.6 if sprinting else 1.0
	hunger = maxf(0.0, hunger - HUNGER_RATE * exertion * delta)
	thirst = maxf(0.0, thirst - THIRST_RATE * exertion * delta)

	# Warmth: day is mild, night is cold; worse up high, in water or in storms; fire and torches warm.
	var daylight := DayNight.main.daylight if DayNight.main else 1.0
	var target := lerpf(14.0, 88.0, daylight)
	target -= clampf((global_position.y - 110.0) / 3.0, 0.0, 35.0)
	if DayNight.main:
		target -= DayNight.main.storm * 15.0
	if swimming or Game.water_at(global_position.x, global_position.z).height > global_position.y + 0.5:
		target = minf(target, 10.0)
	near_fire = false
	for c in get_tree().get_nodes_in_group("campfire"):
		if c.global_position.distance_to(global_position) < c.warm_radius and c.lit:
			near_fire = true
	if near_fire:
		target = 100.0
	elif inventory.held() == "torch":
		target += 28.0
	var rate := 3.5 if target > warmth else 0.55
	warmth = move_toward(warmth, clampf(target, 0.0, 100.0), rate * delta)

	var drain := 0.0
	status = ""
	if thirst <= 0.0:
		drain += 0.55
		status = "Dehydrated"
	if hunger <= 0.0:
		drain += 0.45
		status = "Starving"
	if warmth < 12.0:
		drain += 0.5
		status = "Freezing"
	elif warmth < 25.0 and status == "":
		status = "Cold"
	if status == "":
		if thirst < 18.0:
			status = "Thirsty"
		elif hunger < 18.0:
			status = "Hungry"
	_since_hurt += delta
	if drain > 0.0:
		health -= drain * delta
	elif hunger > 45.0 and thirst > 45.0 and warmth > 30.0 and _since_hurt > 6.0:
		health = minf(max_health, health + 0.4 * delta)
	if _heal_left > 0.0:
		var h := minf(_heal_left, 9.0 * delta)
		_heal_left -= h
		health = minf(max_health, health + h)
	if health <= 0.0:
		die()


func take_damage(amount: float, from: Vector3, attacker: Node3D = null) -> void:
	if dead or amount <= 0.0:
		return
	if blocking and attacker:
		var to := (from - global_position) * Vector3(1, 0, 1)
		if to.normalized().dot(-global_basis.z) > 0.3 and stamina > 5.0:
			stamina = maxf(0.0, stamina - amount * 0.9)
			amount *= 0.25
			viewmodel.block_hit()
			sfx.play("block")
	health -= amount
	_since_hurt = 0.0
	_trauma = minf(1.0, _trauma + amount / 30.0)
	sfx.play("hurt")
	hurt.emit(amount, from)
	if health <= 0.0:
		die()


func die() -> void:
	if dead:
		return
	dead = true
	health = 0.0
	bow_draw = -1.0
	viewmodel.visible = false
	sfx.play("death")
	var tw := create_tween()
	tw.tween_property(head, "position:y", 0.35, 1.2).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(head, "rotation:z", 1.2, 1.0)
	died.emit()


## Back to the last campfire (or the camp), weakened, having lost some of what you carried.
func respawn() -> void:
	var lost := 0
	for id: String in inventory.counts.keys():
		if Items.kind(id) == Items.Kind.RESOURCE or Items.kind(id) == Items.Kind.FOOD:
			var n := inventory.count(id) / 2
			if n > 0:
				inventory.remove(id, n)
				lost += n
	dead = false
	health = 60.0
	stamina = max_stamina
	hunger = maxf(hunger, 50.0)
	thirst = maxf(thirst, 50.0)
	warmth = maxf(warmth, 60.0)
	_heal_left = 0.0
	head.position.y = _head_height
	head.rotation = Vector3.ZERO
	viewmodel.visible = true
	var p := respawn_point if respawn_point != Vector3.INF else Terrain.main.spawn_point()
	global_position = p + Vector3(1.5, 0.3, 1.5)
	velocity = Vector3.ZERO
	if lost > 0:
		Game.notify("You lost %d items where you fell." % lost)


# ------------------------------------------------------------ targeting ----

func _ray(length: float, mask: int) -> Dictionary:
	var from := camera.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - camera.global_basis.z * length, mask, [get_rid()])
	return get_world_3d().direct_space_state.intersect_ray(q)


## Works out what E would do and sets `prompt`.
func _update_target() -> void:
	_target = {}
	prompt = ""
	if Game.ui_open:
		return
	var hit := _ray(INTERACT_RANGE, WORLD_MASK | ENEMY_MASK | 16)
	var from := camera.global_position
	var look_point: Vector3 = hit.position if hit else from - camera.global_basis.z * INTERACT_RANGE
	var collider: Object = hit.get("collider")
	if collider and collider.has_method("interact_prompt"):
		var text: String = collider.interact_prompt(self)
		if text != "":
			_target = {"type": "node", "node": collider}
			prompt = text
			return
	if Props.main:
		var p := Props.main.nearest_pickup(look_point, 1.2)
		if p >= 0 and Props.main.xforms[p].origin.distance_to(global_position) < 3.4:
			_target = {"type": "pickup", "id": p}
			prompt = "[E] Pick up " + ("stone" if Props.main.kind[p] == Props.Kind.PEBBLE else "sticks")
			return
	if Foliage.main:
		var b := Foliage.main.nearest_bush(look_point, 1.5)
		if b >= 0 and Foliage.main.xforms[b].origin.distance_to(global_position) < 3.4:
			_target = {"type": "bush", "id": b}
			prompt = "[E] Pick berries"
			return
	if collider == Foliage.main and Foliage.main:
		var id := Foliage.main.hit_instance(hit.rid, hit.shape)
		if id >= 0:
			var chop: float = _held_info().get("chop", 0.0)
			prompt = "Tree: [LMB] chop" if chop >= 1.0 else ("Tree: slow going without an axe" if chop > 0.0 else "Tree: craft a stone axe to chop")
			return
	if collider == Props.main and Props.main:
		var id := Props.main.hit_instance(hit.rid, hit.shape)
		if Props.main.is_mineable(id):
			var mine: float = _held_info().get("mine", 0.0)
			prompt = "Rock: [LMB] mine stone" if mine >= 1.0 else "Rock: craft a pickaxe to mine"
			return
	var water := _water_target()
	if not water.is_empty():
		_target = water
		if water.fresh:
			prompt = "[E] Fill waterskin" if inventory.count("waterskin_empty") > 0 else "[E] Drink"
		else:
			prompt = "Sea water: too salty to drink"
		return
	if hit and collider and collider.is_in_group("terrain") and _grassy(hit.position):
		_target = {"type": "fiber"}
		prompt = "[E] Gather plant fiber"


func _water_target() -> Dictionary:
	var from := camera.global_position
	var dir := -camera.global_basis.z
	var here: Dictionary = Game.water_at(global_position.x, global_position.z)
	if here.height > global_position.y - 0.05:
		return {"type": "water", "fresh": here.fresh}
	if dir.y > -0.2:
		return {}
	for s in 12:
		var p := from + dir * (s + 1) * 0.3
		var w: Dictionary = Game.water_at(p.x, p.z)
		if w.height > -INF and p.y <= w.height + 0.05:
			return {"type": "water", "fresh": w.fresh}
	return {}


func _grassy(p: Vector3) -> bool:
	var t := Terrain.main
	var n := t.normal_at(p.x, p.z)
	var m := t.mask_at(p.x, p.z)
	return n.y > 0.8 and p.y > 3.0 and p.y < float(t.info.snow_line) - 60.0 and m.b < 0.75 and m.g < 0.6


# ------------------------------------------------------------ actions ----

func _held_info() -> Dictionary:
	var id := inventory.held()
	return Items.FISTS if id == "" else Items.info(id)


func _primary(pressed: bool) -> void:
	var id := inventory.held()
	var kind := Items.kind(id) if id != "" else Items.Kind.WEAPON
	if not pressed:
		if kind == Items.Kind.RANGED and bow_draw >= 0.0:
			_release_bow()
		return
	match kind:
		Items.Kind.RANGED:
			if inventory.count("arrow") > 0:
				bow_draw = 0.0
				sfx.play("draw")
			else:
				Game.notify("No arrows. Craft some from sticks, stone and fiber.", "arrow")
		Items.Kind.FOOD, Items.Kind.MEDICINE, Items.Kind.DRINK:
			_consume(id)
		Items.Kind.PLACEABLE:
			_place()
		_:
			_swing()


func _secondary(pressed: bool) -> void:
	var kind := Items.kind(inventory.held()) if inventory.held() != "" else Items.Kind.WEAPON
	if kind == Items.Kind.RANGED:
		viewmodel.aiming = pressed
		return
	blocking = pressed and kind in [Items.Kind.WEAPON, Items.Kind.TOOL, Items.Kind.LIGHT]
	viewmodel.blocking = blocking


func _swing() -> void:
	var info := _held_info()
	if _attack_cd > 0.0 or blocking:
		return
	if stamina < info.stamina * 0.5:
		sfx.play("tired")
		return
	stamina = maxf(0.0, stamina - info.stamina)
	_regen_delay = 0.7
	_attack_cd = info.rate
	viewmodel.swing(info.rate)
	sfx.play("swing")
	get_tree().create_timer(info.rate * 0.35).timeout.connect(_resolve_hit.bind(info))


func _resolve_hit(info: Dictionary) -> void:
	if dead:
		return
	var from := camera.global_position
	var fwd := -camera.global_basis.z
	var reach: float = info.reach
	# Enemies: nearest one inside the swing arc with a clear line to it.
	var best: Node3D = null
	var best_d := reach + 0.6
	for e: Node3D in get_tree().get_nodes_in_group("enemy"):
		if not e.has_method("take_damage") or e.get("dead"):
			continue
		var hh: float = e.get("hit_height") if e.get("hit_height") != null else 0.7
		var hr: float = e.get("hit_radius") if e.get("hit_radius") != null else 0.5
		var c: Vector3 = e.global_position + Vector3(0, hh, 0)
		var to := c - from
		var d := to.length() - hr
		if d < best_d and to.normalized().dot(fwd) > 0.72:
			var q := PhysicsRayQueryParameters3D.create(from, c, WORLD_MASK, [get_rid()])
			if get_world_3d().direct_space_state.intersect_ray(q).is_empty():
				best = e
				best_d = d
	if best:
		var dmg: float = info.damage * randf_range(0.9, 1.1)
		if inventory.held() == "torch":
			dmg *= 2.5 if best.is_in_group("hollow") else 1.0
		best.take_damage(dmg, fwd, self)
		hit_landed.emit(best.get("dead") == true)
		viewmodel.hit()
		_trauma = minf(1.0, _trauma + 0.15)
		sfx.play("hit_flesh")
		return
	var hit := _ray(reach, WORLD_MASK)
	if hit.is_empty():
		return
	var collider: Object = hit.collider
	if collider == Foliage.main:
		var id := Foliage.main.hit_instance(hit.rid, hit.shape)
		var chop: float = info.get("chop", 0.0)
		sfx.play("chop" if chop > 0.0 else "thud")
		viewmodel.hit()
		_chips(hit.position, hit.normal, Color(0.55, 0.42, 0.28))
		if chop <= 0.0:
			Game.notify("Your fists won't cut it. Craft a stone axe [Tab].")
		elif Foliage.main.damage(id, chop):
			var wood := randi_range(3, 5) if Foliage.main.species_name(id) != "birch" else randi_range(2, 4)
			_gain("wood", wood)
			_gain("stick", randi_range(1, 2))
			sfx.play("tree_fall")
	elif collider == Props.main:
		var id := Props.main.hit_instance(hit.rid, hit.shape)
		var mine: float = info.get("mine", 0.0)
		sfx.play("mine")
		viewmodel.hit()
		_chips(hit.position, hit.normal, Color(0.5, 0.5, 0.5))
		if mine >= 1.0 or (mine > 0.0 and randf() < mine):
			var got := Props.main.mine(id)
			if got > 0:
				_gain("stone", got)
			else:
				Game.notify("This rock is mined out for now.")
		elif mine <= 0.0 and Props.main.is_mineable(id):
			Game.notify("You need a pickaxe to break rock.")
	else:
		sfx.play("thud")


func _update_bow(delta: float) -> void:
	if bow_draw < 0.0:
		viewmodel.draw_amount = 0.0
		return
	if inventory.held() != "bow" or inventory.count("arrow") <= 0:
		bow_draw = -1.0
		return
	bow_draw = minf(1.0, bow_draw + delta / 0.8)
	if bow_draw >= 1.0:
		stamina = maxf(0.0, stamina - 4.0 * delta)
		_regen_delay = 0.5
	viewmodel.draw_amount = bow_draw


func _release_bow() -> void:
	var draw := bow_draw
	bow_draw = -1.0
	if draw < 0.2 or not inventory.remove("arrow"):
		return
	var arrow := Arrow.new()
	get_tree().current_scene.add_child(arrow)
	var dir := -camera.global_basis.z
	# Aim spread when the bow isn't fully drawn or you're out of breath.
	var spread := (1.0 - draw) * 0.03 + (0.02 if stamina < 10.0 else 0.0)
	dir = (dir + Vector3(randf_range(-spread, spread), randf_range(-spread, spread), randf_range(-spread, spread))).normalized()
	arrow.launch(camera.global_position + dir * 0.6, dir * lerpf(20.0, 64.0, draw), Items.info("bow").damage * lerpf(0.35, 1.0, draw), self)
	sfx.play("bow")
	viewmodel.hit()


func _consume(id: String) -> void:
	if _attack_cd > 0.0:
		return
	var info := Items.info(id)
	_attack_cd = 0.9
	viewmodel.consume()
	match info.kind:
		Items.Kind.FOOD:
			hunger = minf(100.0, hunger + info.get("hunger", 0.0))
			thirst = minf(100.0, thirst + info.get("thirst", 0.0))
			var h: float = info.get("health", 0.0)
			if h < 0.0:
				take_damage(-h, global_position)
				Game.notify("That didn't sit well. Cook meat at a campfire.")
			else:
				health = minf(max_health, health + h)
			sfx.play("eat")
		Items.Kind.MEDICINE:
			_heal_left += info.get("heal", 0.0)
			sfx.play("bandage")
		Items.Kind.DRINK:
			thirst = minf(100.0, thirst + info.get("thirst", 0.0))
			sfx.play("drink")
			inventory.add("waterskin_empty")
	inventory.remove(id)


func _update_ghost() -> void:
	var want := inventory.held() == "campfire" and not Game.ui_open
	if not want:
		if _ghost:
			_ghost.queue_free()
			_ghost = null
		return
	if _ghost == null:
		_ghost = ItemModels.campfire_model(false)
		for mi in _ghost.find_children("*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).transparency = 0.5
		get_tree().current_scene.add_child(_ghost)
	var hit := _ray(5.0, WORLD_MASK)
	var p: Vector3 = hit.position if hit else global_position - global_basis.z * 2.5
	var t := Terrain.main
	p.y = t.height_at(p.x, p.z) if not hit or hit.collider == null or hit.collider.is_in_group("terrain") else p.y
	_ghost.global_position = p
	_ghost_ok = t.normal_at(p.x, p.z).y > 0.8 and Game.water_at(p.x, p.z).height < p.y - 0.1 and p.distance_to(global_position) > 1.0
	_ghost.visible = true
	for mi in _ghost.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).transparency = 0.45 if _ghost_ok else 0.85


func _place() -> void:
	if _ghost == null or not _ghost_ok:
		Game.notify("Can't build a fire there.")
		return
	var fire := Campfire.new()
	get_tree().current_scene.add_child(fire)
	fire.global_position = _ghost.global_position
	inventory.remove("campfire")
	respawn_point = fire.global_position
	Game.notify("Campfire lit. You'll wake up here if you die.", "campfire")
	sfx.play("fire_start")
	Game.save_game()


func _interact() -> void:
	if _interact_cd > 0.0 or _target.is_empty():
		return
	_interact_cd = 0.3
	match _target.type:
		"pickup":
			var got := Props.main.take(_target.id)
			if not got.is_empty():
				_gain(got.item, got.count)
				sfx.play("pickup")
		"bush":
			if Foliage.main.pick(_target.id):
				_gain("berries", randi_range(3, 5))
				if randf() < 0.5:
					_gain("fiber", 1)
				sfx.play("bush")
		"fiber":
			_interact_cd = 0.55
			viewmodel.consume()
			_gain("fiber", randi_range(1, 2))
			sfx.play("grass")
		"water":
			if not _target.fresh:
				Game.notify("The sea is too salty to drink. Find the lake.")
			elif inventory.count("waterskin_empty") > 0:
				inventory.remove("waterskin_empty")
				inventory.add("waterskin")
				Game.notify("Waterskin filled.", "waterskin")
				sfx.play("drink")
			else:
				thirst = minf(100.0, thirst + 20.0)
				sfx.play("drink")
		"node":
			var node: Object = _target.node
			if is_instance_valid(node):
				node.interact(self)


func _gain(id: String, n: int) -> void:
	inventory.add(id, n)
	Game.notify("+%d %s" % [n, Items.item_name(id)], id)


func _chips(pos: Vector3, normal: Vector3, color: Color) -> void:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = true
	p.amount = 10
	p.lifetime = 0.6
	p.explosiveness = 1.0
	p.direction = normal
	p.spread = 45.0
	p.initial_velocity_min = 1.5
	p.initial_velocity_max = 3.5
	p.gravity = Vector3(0, -9.8, 0)
	p.scale_amount_min = 0.5
	var m := BoxMesh.new()
	m.size = Vector3.ONE * 0.03
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	m.material = mat
	p.mesh = m
	get_tree().current_scene.add_child(p)
	p.global_position = pos + normal * 0.05
	get_tree().create_timer(1.0).timeout.connect(p.queue_free)


func _on_inventory_changed() -> void:
	var id := inventory.held()
	if viewmodel.item_id != id:
		viewmodel.set_item(id)
		bow_draw = -1.0
		blocking = false
		viewmodel.blocking = false


# ------------------------------------------------------------- camera ----

func _camera_fx(delta: float) -> void:
	var hv := Vector2(velocity.x, velocity.z).length()
	if is_on_floor() and hv > 0.5:
		_bob_time += delta * hv * 1.5
	else:
		_bob_time = lerpf(_bob_time, roundf(_bob_time / PI) * PI, delta * 6.0)
	_land_dip = move_toward(_land_dip, 0.0, delta * 0.4)
	head.position.y = _head_height + sin(_bob_time * 2.0) * 0.035 - _land_dip - (0.25 if swimming else 0.0)
	_trauma = maxf(0.0, _trauma - delta * 1.6)
	var shake := _trauma * _trauma
	var t := Time.get_ticks_msec() * 0.001
	camera.h_offset = sin(t * 37.0) * shake * 0.05
	camera.v_offset = sin(t * 41.0 + 1.3) * shake * 0.05
	camera.rotation.z = sin(t * 23.0) * shake * 0.05
	var fov: float = Game.settings.fov + (6.0 if sprinting and hv > 5.0 else 0.0)
	if viewmodel.aiming and inventory.held() == "bow":
		fov -= 18.0 * maxf(bow_draw, 0.4)
	camera.fov = lerpf(camera.fov, fov, delta * 6.0)
	viewmodel.move_amount = clampf(hv / sprint_speed, 0.0, 1.0) if is_on_floor() else 0.0


# --------------------------------------------------------------- save ----

func save_state() -> Dictionary:
	return {
		"pos": [global_position.x, global_position.y, global_position.z], "yaw": rotation.y, "pitch": head.rotation.x,
		"health": health, "stamina": stamina, "hunger": hunger, "thirst": thirst, "warmth": warmth,
		"inventory": inventory.to_dict(), "kills": kills,
		"respawn": [respawn_point.x, respawn_point.y, respawn_point.z] if respawn_point != Vector3.INF else [],
	}


func load_state(d: Dictionary) -> void:
	var p: Array = d.get("pos", [])
	if p.size() == 3:
		global_position = Vector3(p[0], p[1] + 0.2, p[2])
	rotation.y = d.get("yaw", 0.0)
	head.rotation.x = d.get("pitch", 0.0)
	health = d.get("health", max_health)
	stamina = d.get("stamina", max_stamina)
	hunger = d.get("hunger", 100.0)
	thirst = d.get("thirst", 100.0)
	warmth = d.get("warmth", 100.0)
	kills = d.get("kills", 0)
	inventory.from_dict(d.get("inventory", {}))
	var r: Array = d.get("respawn", [])
	respawn_point = Vector3(r[0], r[1], r[2]) if r.size() == 3 else Vector3.INF
