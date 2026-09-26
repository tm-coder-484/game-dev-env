class_name DayNight
extends Node
## Time of day: moves the sun and moon, colours the light, sky, fog and exposure, drifts the clouds
## with the wind, and tells the game when night falls (the Hollows come out at night).

signal night_started
signal day_started

static var main: DayNight

@export_range(0.0, 24.0) var time_of_day := 8.5
@export var day_minutes := 24.0 ## real minutes per in-game day
@export var paused := false
@export var sun: DirectionalLight3D
@export var moon: DirectionalLight3D
@export var world_environment: WorldEnvironment
@export var axis_tilt := 28.0 ## degrees the sun's arc leans toward the south

var day := 1
var is_night := false
var sun_direction := Vector3.UP ## toward the sun
var daylight := 1.0 ## 0 at night .. 1 in full day, for gameplay and audio
var cloud_coverage := 0.45:
	set(v):
		cloud_coverage = v
		_sky_param("cloud_coverage", v)
var storm := 0.0 ## 0..1, set by the weather
## Wind for grass, trees, water and clouds (pushed to the global shader uniforms of the same names).
var wind_direction := Vector2(0.9, 0.44):
	set(v):
		wind_direction = v.normalized()
		RenderingServer.global_shader_parameter_set("wind_direction", wind_direction)
var wind_strength := 0.6:
	set(v):
		wind_strength = v
		RenderingServer.global_shader_parameter_set("wind_strength", v)

var _env: Environment
var _sky: ShaderMaterial
var _cloud_offset := Vector2.ZERO


func _enter_tree() -> void:
	main = self
	add_to_group("day_night")


func _ready() -> void:
	_env = world_environment.environment
	_sky = _env.sky.sky_material as ShaderMaterial
	_sky_param("use_subpasses", RenderingServer.get_current_rendering_method() != "gl_compatibility")
	if sun:
		sun.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	if moon:
		moon.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	is_night = _sun_dir(time_of_day).y < -0.04
	_apply(0.0)


func _process(delta: float) -> void:
	if not paused:
		time_of_day += delta * 24.0 / (day_minutes * 60.0)
		if time_of_day >= 24.0:
			time_of_day -= 24.0
			day += 1
	_apply(delta)


## Unit vector toward the sun for an hour of the day (sunrise ~6:00 in the east, sunset ~18:00 west).
func _sun_dir(hour: float) -> Vector3:
	var a := (hour / 24.0 - 0.25) * TAU
	var d := Vector3(cos(a), sin(a), 0.0)
	return d.rotated(Vector3.RIGHT, deg_to_rad(axis_tilt)).normalized()


func _apply(delta: float) -> void:
	sun_direction = _sun_dir(time_of_day)
	var moon_dir := _sun_dir(fmod(time_of_day + 12.0, 24.0)).rotated(Vector3.UP, 0.35)
	var e := sun_direction.y
	var clear := 1.0 - storm * 0.75

	# Sun: warm and low at dawn/dusk, off below the horizon.
	var sun_amount := smoothstep(-0.03, 0.14, e)
	daylight = smoothstep(-0.12, 0.2, e)
	if sun:
		sun.visible = sun_amount > 0.001
		if sun.visible:
			sun.global_basis = Basis.looking_at(-sun_direction, Vector3.UP if absf(e) < 0.99 else Vector3.FORWARD)
		var warm := smoothstep(0.0, 0.4, e)
		sun.light_color = Color(1.0, 0.52, 0.28).lerp(Color(1.0, 0.95, 0.88), warm)
		sun.light_energy = sun_amount * lerpf(1.6, 2.6, warm) * clear
		sun.shadow_enabled = sun.visible
	# Moon: dim and blue, casts shadows only when the sun is down.
	if moon:
		var moon_amount := smoothstep(-0.05, 0.15, moon_dir.y) * (1.0 - daylight)
		moon.visible = moon_amount > 0.001
		if moon.visible:
			moon.global_basis = Basis.looking_at(-moon_dir, Vector3.UP)
		moon.light_color = Color(0.62, 0.72, 1.0)
		moon.light_energy = moon_amount * 0.22 * clear
		moon.shadow_enabled = moon.visible and not (sun and sun.visible)

	# Sky, fog and exposure.
	var night := 1.0 - smoothstep(-0.2, -0.02, e)
	_sky_param("sun_direction", sun_direction)
	_sky_param("moon_direction", moon_dir)
	_sky_param("night", night)
	_sky_param("star_rotation", time_of_day / 24.0 * TAU)
	_sky_param("cloud_darkness", storm)
	_cloud_offset += wind_direction * delta * (0.004 + wind_strength * 0.006)
	_sky_param("cloud_offset", _cloud_offset)

	var dawn := exp(-pow((e - 0.02) / 0.12, 2.0)) # peaks at sunrise/sunset
	var day_fog := Color(0.62, 0.72, 0.84)
	var dusk_fog := Color(0.9, 0.58, 0.42)
	var night_fog := Color(0.035, 0.045, 0.08)
	var fog := night_fog.lerp(day_fog, daylight).lerp(dusk_fog, dawn * 0.65)
	fog = fog.lerp(Color(0.42, 0.45, 0.5) * maxf(daylight, 0.1), storm * 0.7)
	_env.fog_light_color = fog
	_env.fog_density = lerpf(0.00045, 0.0012, dawn * 0.6 + storm * 0.8)
	_env.volumetric_fog_albedo = fog.lerp(Color.WHITE, 0.5)
	_env.volumetric_fog_density = lerpf(0.0025, 0.009, dawn * 0.7 + storm * 0.5)
	_env.ambient_light_energy = lerpf(5.0, 1.0, daylight)
	RenderingServer.global_shader_parameter_set("sky_light", lerpf(0.05, 1.0, daylight) * clear)
	_env.tonemap_exposure = lerpf(1.7, 1.0, daylight)

	var was_night := is_night
	is_night = e < -0.04
	if is_night and not was_night:
		night_started.emit()
	elif was_night and not is_night:
		day_started.emit()


func _sky_param(key: String, value: Variant) -> void:
	if _sky:
		_sky.set_shader_parameter(key, value)


## "Day 3, 21:40"
func clock_text() -> String:
	var h := int(time_of_day)
	var m := int((time_of_day - h) * 60.0)
	return "Day %d, %02d:%02d" % [day, h, m]
