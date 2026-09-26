extends Node
## Headless screenshots for CI and AI agents (make godot-shot). User args after `--`:
##   --screenshot=/abs/out.png   save the frame and quit
##   --frames=N                  wait N frames first (default 120)
##   --cam=x,z,height,yaw,pitch  debug camera: height above ground in metres, angles in degrees
##   --time=H                    time of day, 0-24
##   --shots=a.png@x,z,h,yaw,pitch;b.png@...   several viewpoints in one run
##   --timing                    print how long each frame took (performance checks)
##   --preview                   cheaper shadows/AA for fast looks on CPU renderers (llvmpipe/lavapipe)

var path := ""
var frames := 120
var _cam: Camera3D
var _queue: Array = []
var _next_at := 0
var _timing := false
var _last_ms := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for arg in OS.get_cmdline_user_args():
		var v := arg.get_slice("=", 1)
		if arg.begins_with("--screenshot="):
			path = v
		elif arg.begins_with("--frames="):
			frames = v.to_int()
		elif arg.begins_with("--cam="):
			_place(v)
		elif arg.begins_with("--time="):
			var sky := get_tree().get_first_node_in_group("day_night")
			if sky:
				sky.set("time_of_day", v.to_float())
		elif arg == "--timing":
			_timing = true
		elif arg == "--preview":
			RenderingServer.directional_shadow_atlas_set_size(2048, true)
			get_viewport().msaa_3d = Viewport.MSAA_DISABLED
			get_viewport().anisotropic_filtering_level = Viewport.ANISOTROPY_DISABLED
		elif arg.begins_with("--shots="):
			for s in v.split(";"):
				_queue.append(s)
	if not _queue.is_empty():
		_next_shot()


func _next_shot() -> void:
	var s: String = _queue.pop_front()
	path = s.get_slice("@", 0)
	_place(s.get_slice("@", 1))
	_next_at = Engine.get_process_frames() + frames


func _place(spec: String) -> void:
	var p := spec.split_floats(",")
	if _cam == null:
		_cam = Camera3D.new()
		_cam.far = 6000.0
		_cam.fov = 70.0
		get_parent().add_child.call_deferred(_cam)
		await get_tree().process_frame
	var ground := Terrain.main.height_at(p[0], p[1]) if Terrain.main else 0.0
	_cam.global_position = Vector3(p[0], maxf(ground, 0.0) + p[2], p[1])
	_cam.rotation_degrees = Vector3(p[4] if p.size() > 4 else -10.0, p[3] if p.size() > 3 else 0.0, 0.0)
	_cam.make_current()


func _process(_delta: float) -> void:
	if _timing:
		var now := Time.get_ticks_msec()
		print("frame %d: %d ms" % [Engine.get_process_frames(), now - _last_ms])
		_last_ms = now
	if path == "":
		return
	var ready_frame := _next_at if _next_at > 0 else frames
	if Engine.get_process_frames() < ready_frame:
		return
	var out := path
	path = ""
	await RenderingServer.frame_post_draw
	var err := get_viewport().get_texture().get_image().save_png(out)
	print("screenshot -> %s (%s)" % [out, error_string(err)])
	if not _queue.is_empty():
		_next_shot()
	else:
		Game.quit(0 if err == OK else 1)
