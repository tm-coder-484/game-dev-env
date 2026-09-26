class_name Arrow
extends Node3D
## A flying arrow: ballistic flight with continuous ray checks, damages enemies, sticks into the world.

var velocity := Vector3.ZERO
var damage := 30.0
var shooter: Node3D
var _stuck := false
var _life := 0.0


func launch(pos: Vector3, vel: Vector3, dmg: float, from: Node3D) -> void:
	global_position = pos
	velocity = vel
	damage = dmg
	shooter = from
	add_child(ItemModels.arrow_model())
	_orient()


func _orient() -> void:
	if velocity.length() > 0.1:
		look_at(global_position + velocity, Vector3.UP if absf(velocity.normalized().y) < 0.99 else Vector3.FORWARD)


func _physics_process(delta: float) -> void:
	_life += delta
	if _stuck:
		if _life > 40.0:
			queue_free()
		return
	if _life > 12.0:
		queue_free()
		return
	velocity.y -= 9.8 * delta
	var next := global_position + velocity * delta
	var ex: Array[RID] = []
	if shooter is CollisionObject3D:
		ex.append((shooter as CollisionObject3D).get_rid())
	var q := PhysicsRayQueryParameters3D.create(global_position, next, 1 | 4, ex)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		global_position = next
		_orient()
		return
	var target: Object = hit.collider
	if target and target.has_method("take_damage") and target.is_in_group("enemy"):
		var speed_factor := clampf(velocity.length() / 55.0, 0.4, 1.15)
		target.take_damage(damage * speed_factor, velocity.normalized(), shooter)
		if shooter and shooter.has_signal("hit_landed"):
			shooter.hit_landed.emit(target.get("dead") == true)
		Sfx.at("hit_flesh", hit.position)
		queue_free()
		return
	global_position = hit.position - velocity.normalized() * 0.25
	_stuck = true
	Sfx.at("arrow_thunk", hit.position)
