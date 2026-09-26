class_name Hollow
extends Enemy
## The Hollows: burnt husks that walk at night. Slow until they see you, then a lurching run and an
## overhead double-claw slam. They won't step into a campfire's light, most shy away from a torch,
## and the sunrise burns them to cinders. Drop Hollow bone.

const MODEL := preload("res://game/enemies/models/hollow.glb")

var bold := false ## ignores torches
var _visual: Node3D
var _rig: ProcRig
var _mat: ShaderMaterial
var _light: OmniLight3D
var _embers: GPUParticles3D
var _phase := 0.0
var _time := 0.0
var _burn := 0.0
var _burning := false
var _death_t := 0.0
var _moan_t := 0.0
var _twitch := Vector3.ZERO
var _twitch_t := 0.0
var _time_alive := 0.0


func _init() -> void:
	display_name = "Hollow"
	max_health = 90.0
	damage = 17.0
	walk_speed = 1.2
	run_speed = 5.4
	attack_range = 2.1
	windup_time = 0.7
	strike_time = 0.32
	recover_time = 1.1
	lunge_speed = 3.5
	sight_range = 45.0
	hear_range = 26.0
	hit_height = 1.35
	hit_radius = 0.4
	loot = {"bone": 2}


func _build() -> void:
	add_to_group("hollow")
	bold = randf() < 0.3
	var cs := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.3
	shape.height = 1.95
	cs.shape = shape
	cs.position.y = 0.98
	add_child(cs)
	_visual = MODEL.instantiate()
	_visual.scale = Vector3.ONE * randf_range(0.92, 1.08)
	add_child(_visual)
	var skel := _visual.find_children("*", "Skeleton3D", true, false)[0] as Skeleton3D
	_rig = ProcRig.new(skel)
	_mat = ShaderMaterial.new()
	_mat.shader = preload("res://game/enemies/hollow_skin.gdshader")
	_mat.set_shader_parameter("bark", load("res://game/world/textures/trees/bark_pine_diff.jpg"))
	_mat.set_shader_parameter("bark_normal", load("res://game/world/textures/trees/bark_pine_nor_gl.jpg"))
	var noise := NoiseTexture2D.new()
	noise.seamless = true
	noise.generate_mipmaps = true
	noise.noise = FastNoiseLite.new()
	noise.noise.frequency = 0.02
	noise.noise.fractal_octaves = 4
	_mat.set_shader_parameter("noise", noise)
	_mat.set_shader_parameter("phase", randf() * TAU)
	for mi in _visual.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).material_override = _mat
	# Ember eyes and a faint glow.
	var eye_mat := StandardMaterial3D.new()
	eye_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	eye_mat.albedo_color = Color(1.0, 0.55, 0.15)
	eye_mat.emission_enabled = true
	eye_mat.emission = Color(1.0, 0.45, 0.1)
	eye_mat.emission_energy_multiplier = 6.0
	var att := BoneAttachment3D.new()
	att.bone_name = "head"
	skel.add_child(att)
	var head := _rig.rest_origin("head")
	for sx in [-1.0, 1.0]:
		var eye := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.016
		sm.height = 0.024
		eye.mesh = sm
		eye.material_override = eye_mat
		att.add_child(eye)
		eye.global_position = skel.global_transform * (head + Vector3(0.042 * sx, 0.13, -0.085))
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.42, 0.12)
	_light.light_energy = 0.9
	_light.omni_range = 3.5
	_light.position = Vector3(0, 1.5, -0.2)
	add_child(_light)
	var fx := ItemModels.fire_particles(0.35)
	_embers = fx.get_child(0) as GPUParticles3D
	fx.remove_child(_embers)
	fx.free()
	_embers.amount = 6
	_embers.position = Vector3(0, 1.4, 0)
	add_child(_embers)


func _afraid() -> bool:
	for c in get_tree().get_nodes_in_group("campfire"):
		if c.lit and c.global_position.distance_to(global_position) < c.safe_radius:
			return true
	if target and not bold and target.inventory.held() == "torch":
		return target.global_position.distance_to(global_position) < 5.0
	return false


func _on_state(s: State) -> void:
	match s:
		State.ALERT:
			Sfx.at("hollow_shriek", global_position, 2.0)
		State.WINDUP:
			Sfx.at("hollow_attack", global_position)
		State.HURT:
			Sfx.at("hollow_hurt", global_position)
		State.DEAD:
			Sfx.at("hollow_death", global_position, 2.0)
			_burning = true
			get_tree().create_timer(4.0).timeout.connect(queue_free)


func _physics_process(delta: float) -> void:
	# The sun burns them.
	_time_alive += delta
	if not dead and _time_alive > 1.0 and DayNight.main and DayNight.main.daylight > 0.3:
		loot = {}
		die()
	super(delta)
	_moan_t -= delta
	if not dead and _moan_t < 0.0:
		_moan_t = randf_range(6.0, 14.0)
		Sfx.at("hollow_moan", global_position, -2.0)


func _animate(delta: float) -> void:
	_time += delta
	_mat.set_shader_parameter("hurt", _hurt_flash)
	_mat.set_shader_parameter("glow", 1.0 + _hurt_flash * 2.0 + (0.8 if state == State.WINDUP else 0.0))
	_light.light_energy = 0.9 + sin(_time * 7.0) * 0.15 + _hurt_flash
	if _burning:
		_burn = minf(1.0, _burn + delta * 0.45)
		_mat.set_shader_parameter("burn", _burn)
		_light.light_energy = 2.5 * (1.0 - _burn)
		_embers.amount_ratio = 1.0
	if dead:
		_death_t += delta
		var k := minf(1.0, _death_t / 0.8)
		_rig.offset("pelvis", Vector3(0, -0.45 * k, 0))
		_rig.rot("thigh_l", Vector3.RIGHT, 1.3 * k)
		_rig.rot("thigh_r", Vector3.RIGHT, 1.2 * k)
		_rig.rot("shin_l", Vector3.RIGHT, -1.7 * k)
		_rig.rot("shin_r", Vector3.RIGHT, -1.6 * k)
		_rig.rot("spine", Vector3.RIGHT, -0.5 * k)
		_rig.rot("neck", Vector3.RIGHT, -0.6 * k)
		_rig.rot("upperarm_l", Vector3.BACK, 0.3 * k)
		_rig.rot("upperarm_r", Vector3.BACK, -0.3 * k)
		_rig.apply()
		return
	var sp := move_speed
	var run := clampf((sp - 1.8) / 3.0, 0.0, 1.0)
	var amp := clampf(sp / 1.0, 0.0, 1.0)
	if sp > 0.1:
		_phase += delta * sp / lerpf(0.95, 1.7, run)
	var t := TAU * _phase
	for side in ["l", "r"]:
		var o := 0.0 if side == "l" else PI
		var swing := sin(t + o) * amp
		var lift := maxf(0.0, cos(t + o)) * amp
		_rig.rot("thigh_" + side, Vector3.RIGHT, swing * lerpf(0.4, 0.7, run))
		_rig.rot("shin_" + side, Vector3.RIGHT, -lift * lerpf(0.6, 1.2, run))
		_rig.rot("foot_" + side, Vector3.RIGHT, lift * 0.3)
		# Arms hang forward, reaching; swing against the legs with a lag.
		var reach := lerpf(0.35, 0.9, run)
		_rig.rot("upperarm_" + side, Vector3.RIGHT, reach - sin(t + o - 0.4) * 0.25 * amp)
		_rig.rot("forearm_" + side, Vector3.RIGHT, 0.35 + sin(t + o - 0.8) * 0.15 * amp)
	# Hunched, bobbing, twitching.
	_rig.offset("pelvis", Vector3(0, -absf(sin(t)) * 0.05 * amp, 0))
	_rig.rot("spine", Vector3.RIGHT, -0.25 - 0.2 * run)
	_rig.rot("chest", Vector3.RIGHT, -0.15)
	_rig.rot("neck", Vector3.RIGHT, 0.35 + 0.15 * run)
	_rig.rot("spine", Vector3.BACK, sin(t) * 0.06 * amp)
	_twitch_t -= delta
	if _twitch_t < 0.0:
		_twitch_t = randf_range(0.4, 2.5)
		_twitch = Vector3(randf_range(-0.25, 0.25), randf_range(-0.4, 0.4), randf_range(-0.35, 0.35))
	_rig.rot("head", Vector3.BACK, _twitch.z)
	_rig.rot("head", Vector3.UP, _twitch.y)
	_rig.rot("jaw", Vector3.RIGHT, -0.15 - absf(sin(_time * 1.3)) * 0.15)
	match state:
		State.WINDUP:
			var k := minf(1.0, _state_t / windup_time)
			k = k * k * (3.0 - 2.0 * k)
			_rig.rot("upperarm_l", Vector3.RIGHT, 2.1 * k)
			_rig.rot("upperarm_r", Vector3.RIGHT, 2.1 * k)
			_rig.rot("forearm_l", Vector3.RIGHT, 0.6 * k)
			_rig.rot("forearm_r", Vector3.RIGHT, 0.6 * k)
			_rig.rot("spine", Vector3.RIGHT, 0.35 * k)
			_rig.rot("jaw", Vector3.RIGHT, -0.5 * k)
		State.STRIKE:
			var k := minf(1.0, _state_t / strike_time)
			_rig.rot("upperarm_l", Vector3.RIGHT, lerpf(2.1, -0.2, k))
			_rig.rot("upperarm_r", Vector3.RIGHT, lerpf(2.1, -0.2, k))
			_rig.rot("spine", Vector3.RIGHT, lerpf(0.35, -0.55, k))
			_rig.rot("jaw", Vector3.RIGHT, -0.5)
		State.HURT:
			_rig.rot("spine", Vector3.RIGHT, 0.3 * sin(minf(1.0, _state_t / 0.3) * PI))
		State.FLEE:
			_rig.rot("upperarm_l", Vector3.RIGHT, 1.2)
			_rig.rot("upperarm_r", Vector3.RIGHT, 1.2)
			_rig.rot("forearm_l", Vector3.RIGHT, 1.4)
			_rig.rot("forearm_r", Vector3.RIGHT, 1.4)
	_rig.apply()
