extends CharacterBody3D
## First-person controller.
## Keyboard/mouse: WASD move, mouse look (click to capture), Space jump,
## Shift sprint, F flashlight, Esc release mouse.
## Gamepad: left stick move, right stick look, A jump, L3 sprint, Y flashlight.
## Sprinting drains stamina; hard landings cost health (both shown on the HUD).

@export var walk_speed := 4.5
@export var sprint_speed := 8.0
@export var jump_velocity := 4.8
@export var acceleration := 14.0
@export var air_control := 0.35
@export var mouse_sensitivity := 0.0025
@export var stick_sensitivity := 3.0
@export var push_force := 1.5
@export var head_bob_amount := 0.04
@export var max_health := 100.0
@export var max_stamina := 100.0
@export var stamina_drain := 22.0 ## per second while sprinting
@export var stamina_regen := 16.0 ## per second, after a short pause
@export var safe_fall_speed := 9.0 ## landing faster than this hurts

var health := max_health
var stamina := max_stamina

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var flashlight: SpotLight3D = $Head/Camera3D/Flashlight

var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")
var _bob_time := 0.0
var _head_height := 0.0
var _regen_delay := 0.0
var _exhausted := false
var _fall_speed := 0.0


func _ready() -> void:
	add_to_group("player")
	_head_height = head.position.y


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event.is_action_pressed("release_mouse"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event.is_action_pressed("flashlight"):
		flashlight.visible = not flashlight.visible
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_look(event.screen_relative * mouse_sensitivity)


func _look(delta: Vector2) -> void:
	rotate_y(-delta.x)
	head.rotation.x = clampf(head.rotation.x - delta.y, deg_to_rad(-89), deg_to_rad(89))


func _physics_process(delta: float) -> void:
	var stick := Input.get_vector("look_left", "look_right", "look_up", "look_down")
	if stick != Vector2.ZERO:
		_look(stick * stick_sensitivity * delta)

	if not is_on_floor():
		velocity.y -= _gravity * delta
	elif Input.is_action_just_pressed("jump"):
		velocity.y = jump_velocity

	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var dir := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
	var sprinting := _update_stamina(delta, Input.is_action_pressed("sprint") and input != Vector2.ZERO)
	var speed := sprint_speed if sprinting else walk_speed
	var accel := acceleration * (1.0 if is_on_floor() else air_control)
	velocity.x = move_toward(velocity.x, dir.x * speed, accel * speed * delta)
	velocity.z = move_toward(velocity.z, dir.z * speed, accel * speed * delta)

	var was_airborne := not is_on_floor()
	_fall_speed = maxf(_fall_speed, -velocity.y) if was_airborne else 0.0
	move_and_slide()
	if was_airborne and is_on_floor() and _fall_speed > safe_fall_speed:
		health = maxf(0.0, health - (_fall_speed - safe_fall_speed) * 8.0)
	_push_rigid_bodies()
	_head_bob(delta)


## Returns whether the player may sprint this frame.
func _update_stamina(delta: float, wants_sprint: bool) -> bool:
	var sprinting := wants_sprint and not _exhausted and is_on_floor()
	if sprinting:
		stamina = maxf(0.0, stamina - stamina_drain * delta)
		_regen_delay = 0.8
		_exhausted = stamina <= 0.0
	elif _regen_delay > 0.0:
		_regen_delay -= delta
	else:
		stamina = minf(max_stamina, stamina + stamina_regen * delta)
		if _exhausted and stamina > max_stamina * 0.25:
			_exhausted = false
	return sprinting


func _push_rigid_bodies() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var body := c.get_collider() as RigidBody3D
		if body:
			body.apply_central_impulse(-c.get_normal() * push_force)


func _head_bob(delta: float) -> void:
	var horizontal := Vector2(velocity.x, velocity.z).length()
	if is_on_floor() and horizontal > 0.5:
		_bob_time += delta * horizontal * 1.6
	else:
		_bob_time = lerpf(_bob_time, roundf(_bob_time / PI) * PI, delta * 8.0)
	head.position.y = _head_height + sin(_bob_time * 2.0) * head_bob_amount
