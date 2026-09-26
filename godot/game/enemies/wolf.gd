class_name Wolf
extends Enemy
## Grey wolves: hunt in small packs through the forests, day and night. A lunging bite with a clear
## crouch before it; they give up and flee when badly hurt. Drop meat and a hide.

const MODEL := preload("res://game/enemies/models/wolf.glb")
const SHELLS := 7

var _visual: Node3D
var _rig: ProcRig
var _phase := 0.0
var _time := 0.0
var _fur: Array[ShaderMaterial] = []
var _death_t := 0.0
var _growl_t := 0.0


func _init() -> void:
	display_name = "Wolf"
	max_health = 55.0
	damage = 11.0
	walk_speed = 1.7
	run_speed = 7.6
	attack_range = 1.9
	windup_time = 0.42
	strike_time = 0.28
	recover_time = 0.8
	lunge_speed = 8.5
	sight_range = 40.0
	hear_range = 24.0
	flee_below = 0.25
	hit_height = 0.6
	hit_radius = 0.5
	loot = {"raw_meat": 2, "hide": 1}


func _build() -> void:
	var cs := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.32
	shape.height = 0.95
	cs.shape = shape
	cs.position.y = 0.5
	add_child(cs)
	_visual = MODEL.instantiate()
	_visual.scale = Vector3.ONE * randf_range(0.82, 0.95)
	add_child(_visual)
	var skel := _visual.find_children("*", "Skeleton3D", true, false)[0] as Skeleton3D
	_rig = ProcRig.new(skel)
	var body := _visual.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
	var strands := NoiseTexture2D.new()
	strands.width = 256
	strands.height = 256
	strands.seamless = true
	strands.generate_mipmaps = true
	var n := FastNoiseLite.new()
	n.noise_type = FastNoiseLite.TYPE_CELLULAR
	n.frequency = 0.12
	n.cellular_return_type = FastNoiseLite.RETURN_CELL_VALUE
	strands.noise = n
	var tint := randf_range(0.85, 1.15)
	for i in SHELLS + 1:
		var m := ShaderMaterial.new()
		m.shader = preload("res://game/enemies/wolf_fur.gdshader")
		m.set_shader_parameter("strands", strands)
		m.set_shader_parameter("shell", float(i) / SHELLS)
		m.set_shader_parameter("back_color", Color(0.2, 0.18, 0.16) * tint)
		m.set_shader_parameter("side_color", Color(0.42, 0.38, 0.33) * tint)
		_fur.append(m)
		var mi := body if i == 0 else body.duplicate() as MeshInstance3D
		if i > 0:
			body.get_parent().add_child(mi)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mi.visibility_range_end = 40.0
		mi.material_override = m
	# Eyeshine.
	var eye_mat := StandardMaterial3D.new()
	eye_mat.albedo_color = Color(0.1, 0.08, 0.02)
	eye_mat.emission_enabled = true
	eye_mat.emission = Color(1.0, 0.8, 0.3)
	eye_mat.emission_energy_multiplier = 1.5
	var att := BoneAttachment3D.new()
	att.bone_name = "head"
	skel.add_child(att)
	var head := _rig.rest_origin("head")
	for sx in [-1.0, 1.0]:
		var eye := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.018
		sm.height = 0.036
		eye.mesh = sm
		eye.material_override = eye_mat
		att.add_child(eye)
		eye.global_position = skel.global_transform * (head + Vector3(0.055 * sx, 0.075, -0.14))


func _on_state(s: State) -> void:
	match s:
		State.ALERT:
			Sfx.at("wolf_growl", global_position)
		State.WINDUP:
			Sfx.at("wolf_snarl", global_position)
		State.HURT:
			Sfx.at("wolf_yelp", global_position)
		State.DEAD:
			Sfx.at("wolf_yelp", global_position, 2.0)


func _physics_process(delta: float) -> void:
	super(delta)
	_growl_t -= delta
	if not dead and state == State.CHASE and _growl_t < 0.0:
		_growl_t = randf_range(3.0, 7.0)
		Sfx.at("wolf_growl", global_position, -4.0)


func _animate(delta: float) -> void:
	_time += delta
	for m in _fur:
		m.set_shader_parameter("hurt", _hurt_flash)
	if dead:
		_death_t += delta
		var k := minf(1.0, _death_t / 0.55)
		_visual.rotation.z = lerpf(0.0, PI * 0.5, k * k)
		_visual.position.y = lerpf(0.0, 0.28, k)
		_rig.rot("neck", Vector3.RIGHT, -0.3 * k)
		for leg in ["fl_upper_l", "fl_upper_r", "hl_upper_l", "hl_upper_r"]:
			_rig.rot(leg, Vector3.RIGHT, 0.35 * k)
		_rig.apply()
		return
	var sp := move_speed
	var run := clampf((sp - 2.5) / 4.5, 0.0, 1.0)
	var amp := clampf(sp / 1.2, 0.0, 1.0)
	if sp > 0.15:
		_phase += delta * sp / lerpf(1.15, 2.6, run)
	var walk_off := {"hl_l": 0.0, "fl_l": 0.25, "hl_r": 0.5, "fl_r": 0.75}
	var run_off := {"fl_l": 0.0, "fl_r": 0.12, "hl_l": 0.5, "hl_r": 0.62}
	for leg: String in walk_off:
		var off: float = run_off[leg] if run > 0.5 else walk_off[leg]
		var t := TAU * (_phase + off)
		var swing := sin(t) * amp
		var lift := maxf(0.0, cos(t)) * amp
		var side := leg.substr(3)
		if leg.begins_with("fl"):
			_rig.rot("fl_upper_" + side, Vector3.RIGHT, swing * lerpf(0.35, 0.8, run))
			_rig.rot("fl_lower_" + side, Vector3.RIGHT, -lift * lerpf(0.5, 1.2, run))
			_rig.rot("fl_foot_" + side, Vector3.RIGHT, -lift * 0.6)
		else:
			_rig.rot("hl_upper_" + side, Vector3.RIGHT, swing * lerpf(0.3, 0.75, run))
			_rig.rot("hl_lower_" + side, Vector3.RIGHT, lift * lerpf(0.4, 0.9, run))
			_rig.rot("hl_foot_" + side, Vector3.RIGHT, -lift * 0.5)
	# Body: bob with each step, flex the spine in a gallop, breathe when still.
	_rig.offset("hips", Vector3(0, absf(sin(TAU * _phase * 2.0)) * 0.025 * amp + sin(TAU * _phase) * 0.04 * run, 0))
	_rig.rot("spine", Vector3.RIGHT, sin(TAU * _phase) * 0.12 * run + sin(_time * 2.2) * 0.015)
	# Head: look at the prey, lower it to run, ears up when alert.
	var alert := state in [State.ALERT, State.CHASE, State.WINDUP, State.STRIKE, State.RECOVER]
	if target and alert:
		var to := target.global_position - global_position
		var yaw := wrapf(atan2(-to.x, -to.z) - rotation.y, -PI, PI)
		yaw = clampf(yaw, -0.7, 0.7)
		_rig.rot("neck", Vector3.UP, yaw * 0.5)
		_rig.rot("head", Vector3.UP, yaw * 0.5)
	else:
		_rig.rot("head", Vector3.UP, sin(_time * 0.6) * 0.3)
	_rig.rot("neck", Vector3.RIGHT, -0.28 * run + sin(TAU * _phase * 2.0) * 0.04 * amp)
	_rig.rot("ear_l", Vector3.RIGHT, 0.0 if alert else -0.3)
	_rig.rot("ear_r", Vector3.RIGHT, 0.0 if alert else -0.3)
	# Tail: wags idly, streams out when running, raised when threatening.
	_rig.rot("tail1", Vector3.UP, sin(_time * (2.0 + run * 4.0)) * lerpf(0.25, 0.08, run))
	_rig.rot("tail1", Vector3.RIGHT, 0.25 * run + (0.35 if state == State.WINDUP else 0.0) - 0.15)
	_rig.rot("tail2", Vector3.RIGHT, -0.1)
	# Attack poses.
	match state:
		State.WINDUP:
			var k := minf(1.0, _state_t / windup_time)
			_rig.offset("hips", Vector3(0, -0.07 * k, 0))
			_rig.offset("spine", Vector3(0, -0.05 * k, 0))
			_rig.rot("neck", Vector3.RIGHT, -0.4 * k)
			_rig.rot("head", Vector3.RIGHT, 0.25 * k)
			_rig.rot("hl_upper_l", Vector3.RIGHT, 0.35 * k)
			_rig.rot("hl_upper_r", Vector3.RIGHT, 0.35 * k)
		State.STRIKE:
			var k := sin(minf(1.0, _state_t / strike_time) * PI)
			_rig.rot("neck", Vector3.RIGHT, 0.3 * k)
			_rig.rot("fl_upper_l", Vector3.RIGHT, 0.8 * k)
			_rig.rot("fl_upper_r", Vector3.RIGHT, 0.7 * k)
			_rig.rot("hl_upper_l", Vector3.RIGHT, -0.6 * k)
			_rig.rot("hl_upper_r", Vector3.RIGHT, -0.6 * k)
			_rig.offset("hips", Vector3(0, 0.1 * k, 0))
		State.HURT:
			_rig.rot("spine", Vector3.BACK, sin(_state_t * 30.0) * 0.08)
	_rig.apply()
