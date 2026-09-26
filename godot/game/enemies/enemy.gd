class_name Enemy
extends CharacterBody3D
## Shared enemy behaviour: perception (sight, hearing, line of sight), a small state machine
## (wander -> alert -> chase -> wind-up/strike -> recover, plus hurt and flee), steering around trees,
## rocks and deep water, knockback, death and a harvestable corpse. Subclasses build the model and
## animate its skeleton procedurally (wolf.gd, hollow.gd).

signal killed(enemy: Enemy)

enum State { WANDER, ALERT, CHASE, WINDUP, STRIKE, RECOVER, HURT, FLEE, DEAD }

@export var display_name := "Creature"
@export var max_health := 60.0
@export var damage := 12.0
@export var walk_speed := 1.6
@export var run_speed := 7.0
@export var turn_rate := 6.0
@export var attack_range := 1.7
@export var windup_time := 0.45
@export var strike_time := 0.25
@export var recover_time := 0.9
@export var lunge_speed := 7.0
@export var sight_range := 38.0
@export var hear_range := 20.0
@export var flee_below := 0.0 ## health fraction that makes it run
@export var hit_height := 0.7
@export var hit_radius := 0.45
@export var loot := {}

var health := 60.0
var state := State.WANDER
var dead := false
var target: Player
var move_speed := 0.0 ## current ground speed, for animation
var home := Vector3.ZERO

var _state_t := 0.0
var _wander_to := Vector3.ZERO
var _strike_done := false
var _knock := Vector3.ZERO
var _hurt_flash := 0.0
var _lost_t := 0.0
var _think_t := 0.0
var _harvested := false
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")


func _ready() -> void:
	add_to_group("enemy")
	collision_layer = 4
	collision_mask = 1 | 2 | 4
	floor_max_angle = deg_to_rad(50)
	floor_snap_length = 0.5
	health = max_health
	home = global_position
	_wander_to = global_position
	_build()


# ------------------------------------------------------------- hooks ----

func _build() -> void:
	pass


func _animate(_delta: float) -> void:
	pass


func _on_state(_s: State) -> void:
	pass


## Extra reasons to keep away from the player (Hollows fear fire).
func _afraid() -> bool:
	return false


# --------------------------------------------------------------- AI ----

func set_state(s: State) -> void:
	if state == s:
		return
	state = s
	_state_t = 0.0
	_strike_done = false
	_on_state(s)


func _physics_process(delta: float) -> void:
	_state_t += delta
	_hurt_flash = move_toward(_hurt_flash, 0.0, delta * 3.0)
	if dead:
		velocity.x = move_toward(velocity.x, 0.0, 8.0 * delta)
		velocity.z = move_toward(velocity.z, 0.0, 8.0 * delta)
		velocity.y -= _gravity * delta
		move_and_slide()
		move_speed = 0.0
		_animate(delta)
		return
	var p := Game.player as Player
	target = p if p and not p.dead and not Game.get_meta("freeze_ai", false) else null
	var desired := Vector3.ZERO
	var speed := 0.0
	var face := Vector3.ZERO
	var to := (target.global_position - global_position) if target else Vector3.ZERO
	var dist := Vector2(to.x, to.z).length()

	match state:
		State.WANDER:
			speed = walk_speed
			if global_position.distance_to(_wander_to) < 1.5 or _state_t > 12.0:
				_pick_wander()
				_state_t = 0.0
			desired = _wander_to - global_position
			if _state_t < 2.0 and fmod(_state_t, 12.0) < 2.0:
				speed = 0.0 # pause and sniff before moving on
			if target and _perceives(to, dist):
				set_state(State.ALERT)
		State.ALERT:
			face = to
			if _state_t > 0.7:
				set_state(State.CHASE)
		State.CHASE:
			if target == null:
				set_state(State.WANDER)
			elif _afraid():
				set_state(State.FLEE)
			else:
				desired = to
				speed = run_speed
				face = to
				if dist < attack_range and absf(to.y) < 2.0:
					set_state(State.WINDUP)
				_lost_t = _lost_t + delta if dist > sight_range * 1.6 else 0.0
				if _lost_t > 6.0:
					set_state(State.WANDER)
		State.WINDUP:
			face = to
			speed = 0.0
			if _state_t > windup_time:
				set_state(State.STRIKE)
		State.STRIKE:
			face = to
			if _state_t < strike_time:
				velocity.x = -global_basis.z.x * lunge_speed
				velocity.z = -global_basis.z.z * lunge_speed
			if not _strike_done and _state_t > strike_time * 0.6:
				_strike_done = true
				_try_hit()
			if _state_t > strike_time:
				set_state(State.RECOVER)
		State.RECOVER:
			face = to
			desired = -to # back off a little
			speed = walk_speed
			if _state_t > recover_time:
				set_state(State.CHASE if target else State.WANDER)
		State.HURT:
			if _state_t > 0.3:
				set_state(State.FLEE if health < max_health * flee_below else State.CHASE)
		State.FLEE:
			desired = -to if target else Vector3.ZERO
			speed = run_speed
			if _state_t > 6.0 and not _afraid():
				set_state(State.WANDER if health < max_health * flee_below else State.CHASE)

	if Game.get_meta("freeze_ai", false):
		speed = 0.0
	_move(delta, desired, speed, face)
	_animate(delta)


func _perceives(to: Vector3, dist: float) -> bool:
	if dist < 5.0:
		return true
	if target.sprinting and dist < hear_range:
		return true
	if dist > sight_range:
		return false
	var fwd := -global_basis.z
	if Vector3(to.x, 0, to.z).normalized().dot(fwd) < -0.2 and dist > 12.0:
		return false
	var eye := global_position + Vector3(0, hit_height + 0.35, 0)
	var q := PhysicsRayQueryParameters3D.create(eye, target.camera.global_position, 1, [get_rid()])
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _pick_wander() -> void:
	for i in 8:
		var p := home + Vector3(randf_range(-30, 30), 0, randf_range(-30, 30))
		if Game.water_at(p.x, p.z).height < Terrain.main.height_at(p.x, p.z) and Terrain.main.normal_at(p.x, p.z).y > 0.8:
			_wander_to = Vector3(p.x, Terrain.main.height_at(p.x, p.z), p.z)
			return


## Steer toward `desired` at `speed`, around obstacles and away from deep water.
func _move(delta: float, desired: Vector3, speed: float, face: Vector3) -> void:
	desired.y = 0.0
	var dir := desired.normalized() if desired.length() > 0.1 else Vector3.ZERO
	if dir != Vector3.ZERO and speed > 0.0:
		dir = _avoid(dir)
	# Keep a little space between pack members.
	for e: Node3D in get_tree().get_nodes_in_group("enemy"):
		if e != self and not e.get("dead"):
			var d := global_position - e.global_position
			d.y = 0.0
			if d.length() < 1.6 and d.length() > 0.01:
				dir += d.normalized() * (1.6 - d.length()) * 0.8
	if state != State.STRIKE:
		var tv := dir.normalized() * speed if dir != Vector3.ZERO else Vector3.ZERO
		velocity.x = move_toward(velocity.x, tv.x, 22.0 * delta)
		velocity.z = move_toward(velocity.z, tv.z, 22.0 * delta)
	velocity += _knock
	_knock = _knock.move_toward(Vector3.ZERO, 30.0 * delta)
	if not is_on_floor():
		velocity.y -= _gravity * delta
	move_and_slide()
	velocity -= _knock
	var look := face if face.length() > 0.1 else Vector3(velocity.x, 0, velocity.z)
	look.y = 0.0
	if look.length() > 0.2:
		var yaw := atan2(-look.x, -look.z)
		rotation.y = lerp_angle(rotation.y, yaw, minf(1.0, turn_rate * delta))
	move_speed = Vector2(velocity.x, velocity.z).length()


func _avoid(dir: Vector3) -> Vector3:
	var space := get_world_3d().direct_space_state
	var from := global_position + Vector3(0, 0.6, 0)
	for ang in [0.0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]:
		var d := dir.rotated(Vector3.UP, ang)
		var ahead := global_position + d * 2.0
		var w: Dictionary = Game.water_at(ahead.x, ahead.z)
		if w.height > Terrain.main.height_at(ahead.x, ahead.z) + 0.7:
			continue
		var q := PhysicsRayQueryParameters3D.create(from, from + d * 2.2, 1, [get_rid()])
		var hit := space.intersect_ray(q)
		if hit.is_empty() or (hit.collider and hit.collider.is_in_group("terrain") and hit.normal.y > 0.6):
			return d
	return dir


func _try_hit() -> void:
	if target == null:
		return
	var to := target.global_position - global_position
	if to.length() < attack_range + 0.9 and Vector3(to.x, 0, to.z).normalized().dot(-global_basis.z) > 0.4:
		target.take_damage(damage * randf_range(0.85, 1.15), global_position + Vector3(0, 1, 0), self)


# ----------------------------------------------------------- damage ----

func take_damage(amount: float, dir: Vector3, attacker: Node3D = null) -> void:
	if dead:
		return
	health -= amount
	_hurt_flash = 1.0
	_knock = Vector3(dir.x, 0.0, dir.z).normalized() * clampf(amount / 6.0, 1.0, 5.0)
	if health <= 0.0:
		die(attacker)
		return
	if attacker is Player:
		target = attacker
	set_state(State.HURT)
	_alert_pack()


func _alert_pack() -> void:
	for e: Node3D in get_tree().get_nodes_in_group("enemy"):
		if e != self and e.get_script() == get_script() and e.global_position.distance_to(global_position) < 30.0:
			var en := e as Enemy
			if en.state == State.WANDER:
				en.set_state(State.ALERT)


func die(killer: Node3D = null) -> void:
	if dead:
		return
	dead = true
	state = State.DEAD
	collision_layer = 16 # a corpse: no longer blocks, can be interacted with
	collision_mask = 1
	if killer is Player:
		(killer as Player).kills += 1
	killed.emit(self)
	_on_state(State.DEAD)
	get_tree().create_timer(150.0).timeout.connect(queue_free)


func interact_prompt(_p: Player) -> String:
	if not dead or _harvested or loot.is_empty():
		return ""
	return "[E] Harvest the %s" % display_name.to_lower()


func interact(p: Player) -> void:
	if not dead or _harvested:
		return
	_harvested = true
	for id: String in loot:
		p.inventory.add(id, loot[id])
		Game.notify("+%d %s" % [loot[id], Items.item_name(id)], id)
	Sfx.at("harvest", global_position)
	var tw := create_tween()
	tw.tween_property(self, "scale", Vector3.ONE * 0.01, 0.6)
	tw.tween_callback(queue_free)
