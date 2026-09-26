class_name Ambience
extends Node
## Background sound: wind (stronger up the mountains), surf near the coast, birds by day, crickets at
## night, and the odd distant wolf howl after dark. Volumes follow the player and the time of day.

var _players := {}
var _howl_t := 30.0


func _ready() -> void:
	for key in ["wind", "surf", "birds", "crickets"]:
		var p := AudioStreamPlayer.new()
		p.stream = Sfx.looping("amb_" + key)
		p.volume_db = -80.0
		add_child(p)
		if p.stream:
			p.play(randf() * 5.0)
		_players[key] = p


func _process(delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null or Terrain.main == null:
		return
	var pos := cam.global_position
	var daylight := DayNight.main.daylight if DayNight.main else 1.0
	var storm := DayNight.main.storm if DayNight.main else 0.0
	var wind := DayNight.main.wind_strength if DayNight.main else 0.5
	# How much sea is around: sample a ring of points.
	var sea := 0.0
	for i in 8:
		var a := TAU * i / 8.0
		for r in [30.0, 70.0]:
			var w: Dictionary = Game.water_at(pos.x + cos(a) * r, pos.z + sin(a) * r)
			if w.height > -INF and not w.fresh:
				sea += 1.0 / 16.0
	var altitude := clampf((pos.y - 60.0) / 150.0, 0.0, 1.0)
	_fade("wind", lerpf(-20.0, -5.0, maxf(altitude, wind * 0.6 + storm * 0.4)), delta)
	_fade("surf", lerpf(-45.0, -6.0, sqrt(sea)), delta)
	_fade("birds", lerpf(-60.0, -13.0, daylight * (1.0 - storm) * (1.0 - altitude * 0.7)), delta)
	_fade("crickets", lerpf(-60.0, -12.0, (1.0 - daylight) * (1.0 - altitude)), delta)
	# A howl somewhere out in the dark.
	_howl_t -= delta
	if _howl_t <= 0.0:
		_howl_t = randf_range(45.0, 110.0)
		if daylight < 0.2:
			var a := randf() * TAU
			Sfx.at("wolf_howl", pos + Vector3(cos(a), 0.2, sin(a)) * 60.0, 4.0, 0.12)


func _fade(key: String, target_db: float, delta: float) -> void:
	var p: AudioStreamPlayer = _players[key]
	p.volume_db = move_toward(p.volume_db, target_db, 20.0 * delta)
