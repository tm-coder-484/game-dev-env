extends Node3D
## Hollowvale's main scene. Opens on the title menu over a slow flyover of the island, then spawns the
## player in place (new game at the southern beach, or from the save), applies graphics settings and
## autosaves. User args: --play (skip the title), --continue (load the save), --selftest; for testing,
## --stats=health,hunger,thirst,warmth, --give=stone_axe,arrow:10, --hour=H and --spawn=wolf:2,hollow:1.

const PLAYER := preload("res://game/player/player.tscn")

@export var autosave_seconds := 120.0
@export var start_hour := 8.0

var player: Player
var hud: HUD
var _autosave := 0.0
var _flyover: Camera3D
var _fly_t := 0.0
var _title: TitleMenu
var _from_menu := false

@onready var grass: GrassField = $Grass
@onready var sun: DirectionalLight3D = $Sun
@onready var env: Environment = $WorldEnvironment.environment


func _ready() -> void:
	apply_quality()
	Game.settings_changed.connect(apply_quality)
	hud = HUD.new()
	add_child(hud)
	var args := OS.get_cmdline_user_args()
	# Web builds take the same switches from the URL: index.html?play, ?continue
	if OS.has_feature("web"):
		var q := str(JavaScriptBridge.eval("window.location.search", true))
		for key in ["play", "continue", "freeze"]:
			if key in q:
				args.append("--" + key)
	var shot := false
	for a in args:
		shot = shot or a.begins_with("--cam=") or a.begins_with("--shots=")
	if "--selftest" in args:
		Game.save_path = "user://selftest_save.json"
		start_game(false)
		var test: Node = load("res://game/debug/selftest.gd").new()
		add_child(test)
		test.run(player)
	elif "--play" in args or "--continue" in args:
		start_game("--continue" in args)
	elif not shot:
		_show_title()


func _show_title() -> void:
	DayNight.main.time_of_day = 17.6
	_flyover = Camera3D.new()
	_flyover.far = 6000.0
	_flyover.fov = 62.0
	add_child(_flyover)
	_flyover.make_current()
	_title = TitleMenu.new()
	hud.root.add_child(_title)
	_title.open()
	_title.start.connect(func(cont: bool) -> void:
		_from_menu = true
		start_game(cont))


func start_game(continue_save: bool) -> void:
	if _title:
		_title.close()
		_title.queue_free()
		_title = null
	if _flyover:
		_flyover.queue_free()
		_flyover = null
	player = PLAYER.instantiate()
	add_child(player)
	var spawn := Terrain.main.spawn_point()
	player.global_position = spawn + Vector3(0, 0.5, 0)
	player.rotation.y = 0.0 # face north, up the beach toward the island
	DayNight.main.time_of_day = start_hour
	DayNight.main.day = 1
	var save: Dictionary = Game.load_game() if continue_save else {}
	if not save.is_empty():
		player.load_state(save.get("player", {}))
		var t: Dictionary = save.get("time", {})
		DayNight.main.time_of_day = t.get("hour", start_hour)
		DayNight.main.day = int(t.get("day", 1))
		if Foliage.main:
			Foliage.main.load_state(save.get("foliage", {}))
		for c: Array in save.get("campfires", []):
			var fire := Campfire.new()
			add_child(fire)
			fire.global_position = Vector3(c[0], c[1], c[2])
			fire.fuel = c[3]
		Game.notify("Welcome back. Day %d." % DayNight.main.day)
	else:
		Game.delete_save()
		player.inventory.add("berries", 3)
		player.inventory.select(Inventory.HOTBAR_SIZE - 1) # start empty-handed
		Game.notify("You wash up on the island's southern shore.")
		Game.notify("Gather sticks, stones and plant fiber with [E], then craft with [Tab].")
		Game.notify("Night brings cold, and the Hollows. Build a fire before dark.")
	for a in OS.get_cmdline_user_args():
		var v := a.get_slice("=", 1)
		if a.begins_with("--stats="):
			var st := v.split_floats(",")
			player.health = st[0]
			player.hunger = st[1]
			player.thirst = st[2]
			player.warmth = st[3]
		elif a.begins_with("--give="):
			for item in v.split(","):
				player.inventory.add(item.get_slice(":", 0), int(item.get_slice(":", 1)) if ":" in item else 1)
		elif a.begins_with("--hour="):
			DayNight.main.time_of_day = v.to_float()
	hud.attach(player)
	Game.ui_open = false
	# Browsers only allow pointer lock from a click: auto-started web games capture on the first click.
	if not OS.has_feature("web") or _from_menu:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	for a in OS.get_cmdline_user_args():
		if a == "--freeze":
			Game.set_meta("freeze_ai", true)
		if a.begins_with("--spawn="):
			_debug_spawn(a.get_slice("=", 1))
		if a == "--ui=craft":
			hud.craft.open()
		elif a == "--ui=map":
			hud.map.open()
	get_tree().call_group("game_started", "on_game_started", player)


## Test helper: "wolf:2,hollow:1" places enemies 7-14 m in front of the player, facing them.
func _debug_spawn(spec: String) -> void:
	var fwd := -player.global_basis.z
	var i := 0
	for part in spec.split(","):
		var kind := part.get_slice(":", 0)
		var n := int(part.get_slice(":", 1)) if ":" in part else 1
		for k in n:
			var e: Enemy = Wolf.new() if kind == "wolf" else Hollow.new()
			add_child(e)
			var p := player.global_position + fwd.rotated(Vector3.UP, (i - 1.0) * 0.35) * (7.0 + i * 2.0)
			e.global_position = Vector3(p.x, Terrain.main.height_at(p.x, p.z) + 0.2, p.z)
			e.look_at(Vector3(player.global_position.x, e.global_position.y, player.global_position.z))
			i += 1


func _process(delta: float) -> void:
	if _flyover:
		_fly_t += delta
		var spawn := Terrain.main.spawn_point()
		var p := spawn + Vector3(sin(_fly_t * 0.05) * 60.0, 0.0, -_fly_t * 2.2)
		var ground := maxf(Terrain.main.height_at(p.x, p.z), 0.0)
		_flyover.global_position = Vector3(p.x, ground + 14.0 + sin(_fly_t * 0.2) * 3.0, p.z)
		_flyover.rotation = Vector3(deg_to_rad(-6.0), sin(_fly_t * 0.07) * 0.35 + 0.15, 0.0)
		DayNight.main.time_of_day = 17.6 + fmod(_fly_t / 300.0, 0.6)
	_autosave += delta
	if _autosave > autosave_seconds and player and not player.dead:
		_autosave = 0.0
		Game.save_game()


## 0 low (Web, laptops) .. 3 ultra.
func apply_quality() -> void:
	var q := int(Game.settings.quality)
	grass.quality = q
	env.ssao_enabled = q >= 2
	env.volumetric_fog_enabled = q >= 1
	env.glow_enabled = true
	sun.directional_shadow_max_distance = [110.0, 170.0, 260.0, 340.0][q]
	RenderingServer.directional_shadow_atlas_set_size([2048, 4096, 8192, 8192][q], true)
	get_viewport().msaa_3d = [Viewport.MSAA_DISABLED, Viewport.MSAA_2X, Viewport.MSAA_2X, Viewport.MSAA_4X][q]
	var forward_plus := RenderingServer.get_current_rendering_method() == "forward_plus"
	get_viewport().scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR if q == 0 and forward_plus else Viewport.SCALING_3D_MODE_BILINEAR
	get_viewport().scaling_3d_scale = 0.8 if q == 0 and forward_plus else 1.0
	if Terrain.main:
		Terrain.main.lod_ratio = [3.0, 3.5, 4.0, 5.0][q]
