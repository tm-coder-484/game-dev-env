class_name Viewmodel
extends Node3D
## The held item in first person: rest pose per item type, walk bob, mouse sway, and procedural
## animations (chop/thrust swings, bow draw with a nocked arrow, block, eat/use, raise on switch).

var item_id := ""
var model: Node3D
var move_amount := 0.0
var draw_amount := 0.0
var aiming := false
var blocking := false

var _pose := "item"
var _swing := -1.0
var _swing_len := 0.5
var _consume := -1.0
var _hit := 0.0
var _block_hit := 0.0
var _sway := Vector2.ZERO
var _time := 0.0
var _raise := 1.0
var _nocked: Node3D
var _block := 0.0
var _light: OmniLight3D

# position, rotation (degrees) per pose
const POSES := {
	"tool": [Vector3(0.34, -0.43, -0.52), Vector3(-16, -14, 20)],
	"torch": [Vector3(0.34, -0.42, -0.55), Vector3(-6, -10, 10)],
	"spear": [Vector3(0.28, -0.34, -0.1), Vector3(-84, 0, -4)],
	"bow": [Vector3(-0.03, -0.1, -0.5), Vector3(0, 90, 6)],
	"item": [Vector3(0.42, -0.37, -0.6), Vector3(-10, -25, 0)],
	"campfire": [Vector3(0.18, -0.36, -0.6), Vector3(-10, 0, 0)],
}


func set_item(id: String) -> void:
	item_id = id
	if model:
		model.queue_free()
		model = null
	_nocked = null
	_light = null
	_swing = -1.0
	_consume = -1.0
	model = ItemModels.build(id) if id != "" else null
	if model:
		add_child(model)
		_light = model.find_child("Light", true, false) as OmniLight3D
		for gi in model.find_children("*", "GeometryInstance3D", true, false):
			(gi as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	match Items.kind(id) if id != "" else -1:
		Items.Kind.TOOL, Items.Kind.WEAPON:
			_pose = "spear" if id.ends_with("spear") else "tool"
		Items.Kind.LIGHT:
			_pose = "torch"
		Items.Kind.RANGED:
			_pose = "bow"
			_nocked = ItemModels.arrow_model()
			model.add_child(_nocked)
		Items.Kind.PLACEABLE:
			_pose = "campfire"
		_:
			_pose = "item"
	_raise = 0.0


func swing(duration: float) -> void:
	_swing = 0.0
	_swing_len = maxf(duration, 0.2)


func consume() -> void:
	_consume = 0.0


func hit() -> void:
	_hit = 1.0


func block_hit() -> void:
	_block_hit = 1.0


func add_sway(mouse_delta: Vector2) -> void:
	_sway += mouse_delta * 0.00045
	_sway = _sway.limit_length(0.08)


## Piecewise-linear keyframes [[t, value], ...] sampled at t.
static func _keys(keys: Array, t: float) -> float:
	for i in keys.size() - 1:
		if t <= keys[i + 1][0]:
			var a: Array = keys[i]
			var b: Array = keys[i + 1]
			var f: float = (t - a[0]) / maxf(b[0] - a[0], 1e-4)
			f = f * f * (3.0 - 2.0 * f)
			return lerpf(a[1], b[1], f)
	return keys[-1][1]


func _process(delta: float) -> void:
	_time += delta
	_raise = move_toward(_raise, 1.0, delta * 4.0)
	_hit = move_toward(_hit, 0.0, delta * 5.0)
	_block_hit = move_toward(_block_hit, 0.0, delta * 4.0)
	_block = move_toward(_block, 1.0 if blocking else 0.0, delta * 8.0)
	_sway = _sway.lerp(Vector2.ZERO, delta * 7.0)
	if not model:
		return
	var rest: Array = POSES[_pose]
	var pos: Vector3 = rest[0]
	var rot: Vector3 = rest[1]

	# Walk bob and a slow breathing idle.
	var bob := sin(_time * 9.0) * move_amount
	pos += Vector3(cos(_time * 4.5) * 0.012 * move_amount, absf(bob) * 0.025 + sin(_time * 1.6) * 0.004, 0.0)
	# Sway: lag behind the mouse.
	rot += Vector3(_sway.y * 60.0, _sway.x * 60.0, _sway.x * 25.0)
	pos += Vector3(-_sway.x * 0.3, _sway.y * 0.3, 0.0)

	if _swing >= 0.0:
		_swing += delta / _swing_len
		var t := minf(_swing, 1.0)
		if _pose == "spear":
			pos.z += _keys([[0.0, 0.0], [0.25, 0.14], [0.45, -0.6], [1.0, 0.0]], t)
			pos.x += _keys([[0.0, 0.0], [0.45, -0.12], [1.0, 0.0]], t)
		else:
			rot.x += _keys([[0.0, 0.0], [0.28, 42.0], [0.5, -78.0], [1.0, 0.0]], t)
			rot.y += _keys([[0.0, 0.0], [0.28, -12.0], [0.5, 28.0], [1.0, 0.0]], t)
			pos += Vector3(_keys([[0.0, 0.0], [0.5, -0.16], [1.0, 0.0]], t), _keys([[0.0, 0.0], [0.28, 0.1], [0.5, -0.1], [1.0, 0.0]], t), 0.0)
		if _swing >= 1.0:
			_swing = -1.0
	if _consume >= 0.0:
		_consume += delta / 0.8
		var t := minf(_consume, 1.0)
		var k := _keys([[0.0, 0.0], [0.35, 1.0], [0.7, 1.0], [1.0, 0.0]], t)
		pos = pos.lerp(Vector3(0.0, -0.16, -0.28), k)
		rot = rot.lerp(Vector3(20, 0, 0), k)
		if _consume >= 1.0:
			_consume = -1.0
	if _pose == "bow":
		var d := draw_amount
		pos = pos.lerp(Vector3(0.0, -0.06, -0.42), maxf(d, 0.6 if aiming else 0.0))
		rot.z = lerpf(rot.z, 0.0, d)
		if _nocked:
			_nocked.visible = d > 0.0
			# Bow model: grip at +X (away from you), string at x = -0.25. The arrow points +X, nock on the string.
			_nocked.transform = Transform3D(Basis(Vector3.UP, -PI / 2), Vector3(0.11 - d * 0.3, 0.0, 0.0))
	# Block: turn the weapon across the body.
	rot = rot.lerp(Vector3(-10, -40, 75), _block * 0.85)
	pos = pos.lerp(Vector3(0.06, -0.3, -0.45), _block * 0.7)
	rot.x += _block_hit * 12.0
	rot.x += _hit * 8.0
	pos.z += _hit * 0.04
	# Lowered while switching items.
	pos.y -= (1.0 - _raise) * 0.45
	transform = Transform3D(Basis.from_euler(Vector3(deg_to_rad(rot.x), deg_to_rad(rot.y), deg_to_rad(rot.z))), pos)
	if _light:
		_light.light_energy = 1.7 + sin(_time * 13.0) * 0.12 + sin(_time * 29.0) * 0.08
