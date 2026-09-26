class_name Sfx
## Sound effects by name. Plays a random variant of res://game/audio/<name>.wav / <name>_2.wav ...
## (see tools/audio/make_sfx.py). Missing sounds are silently skipped.

static var _cache := {}


static func variants(sound: String) -> Array:
	if _cache.has(sound):
		return _cache[sound]
	var found := []
	for i in range(1, 9):
		var base := "res://game/audio/%s%s" % [sound, "" if i == 1 else "_%d" % i]
		for ext in [".wav", ".ogg"]:
			if ResourceLoader.exists(base + ext):
				found.append(load(base + ext))
				break
	_cache[sound] = found
	return found


static func stream(sound: String) -> AudioStream:
	var v := variants(sound)
	return v.pick_random() if not v.is_empty() else null


## A one-shot 3D sound at a world position.
static func at(sound: String, pos: Vector3, volume_db := 0.0, pitch_jitter := 0.08) -> void:
	var s := stream(sound)
	var tree := Engine.get_main_loop() as SceneTree
	if s == null or tree == null or tree.current_scene == null:
		return
	var p := AudioStreamPlayer3D.new()
	p.stream = s
	p.volume_db = volume_db
	p.pitch_scale = randf_range(1.0 - pitch_jitter, 1.0 + pitch_jitter)
	p.unit_size = 6.0
	p.max_distance = 80.0
	p.attenuation_filter_cutoff_hz = 6000.0
	tree.current_scene.add_child(p)
	p.global_position = pos
	p.finished.connect(p.queue_free)
	p.play()


## A looping 3D sound attached to `parent` (campfires, rivers...).
static func loop(sound: String, parent: Node3D, volume_db := 0.0) -> AudioStreamPlayer3D:
	var s := stream(sound)
	if s == null:
		return null
	var p := AudioStreamPlayer3D.new()
	p.stream = s
	p.volume_db = volume_db
	p.unit_size = 5.0
	p.max_distance = 40.0
	p.autoplay = true
	parent.add_child(p)
	return p
