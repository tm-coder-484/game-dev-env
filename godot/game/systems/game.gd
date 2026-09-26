extends Node
## Autoload "Game": notifications, water queries, save/load and settings shared by the whole game.

signal notified(text: String, icon: Texture2D)
signal settings_changed

const SAVE_PATH := "user://hollowvale_save.json"
const SETTINGS_PATH := "user://hollowvale_settings.cfg"

var save_path := SAVE_PATH
var player: Node3D ## the Player, once the world is running
var ui_open := false ## a menu has the mouse (crafting, map, pause); the player ignores game input
var settings := {
	"quality": 2, # 0 low .. 3 ultra
	"mouse_sensitivity": 1.0,
	"fov": 75.0,
	"volume": 0.8,
	"invert_y": false,
}


func _ready() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(SETTINGS_PATH) == OK:
		for k: String in settings:
			settings[k] = cfg.get_value("settings", k, settings[k])
	# The Web build (Compatibility renderer) defaults to the cheapest preset.
	if not cfg.has_section("settings") and RenderingServer.get_current_rendering_method() == "gl_compatibility":
		settings.quality = 0
	AudioServer.set_bus_volume_db(0, linear_to_db(settings.volume))


## Quit cleanly: stop every sound first (playing streams at exit are reported as leaks).
func quit(code := 0) -> void:
	for p in get_tree().root.find_children("*", "AudioStreamPlayer", true, false):
		(p as AudioStreamPlayer).stop()
	for p in get_tree().root.find_children("*", "AudioStreamPlayer3D", true, false):
		(p as AudioStreamPlayer3D).stop()
	await get_tree().process_frame
	await get_tree().process_frame
	get_tree().quit(code)


func _exit_tree() -> void:
	# Static caches would otherwise be reported as leaks at exit.
	ItemModels._mats.clear()
	ItemModels._dot = null
	Sfx._cache.clear()
	UITheme._theme = null


func save_settings() -> void:
	var cfg := ConfigFile.new()
	for k: String in settings:
		cfg.set_value("settings", k, settings[k])
	cfg.save(SETTINGS_PATH)
	AudioServer.set_bus_volume_db(0, linear_to_db(settings.volume))
	settings_changed.emit()


func notify(text: String, item_id := "") -> void:
	notified.emit(text, Items.icon(item_id) if item_id != "" else null)


# -------------------------------------------------------------- water ----

## Height of the water surface at (x, z), or -INF where there's no water. `fresh` tells lake from sea.
func water_at(x: float, z: float) -> Dictionary:
	var t := Terrain.main
	if t == null:
		return {"height": -INF, "fresh": false}
	var ground := t.height_at(x, z)
	var lake: Dictionary = t.info.lake
	if Vector2(x - lake.x, (z - lake.z) * 1.35).length() < lake.radius * 1.25 and ground < lake.level:
		return {"height": float(lake.level), "fresh": true}
	if ground < t.sea_level or not t.in_bounds(x, z):
		return {"height": t.sea_level, "fresh": false}
	return {"height": -INF, "fresh": false}


# --------------------------------------------------------------- save ----

func has_save() -> bool:
	return FileAccess.file_exists(save_path)


func save_game() -> void:
	if player == null or not player.has_method("save_state"):
		return
	var data := {"version": 1, "player": player.save_state()}
	if DayNight.main:
		data["time"] = {"hour": DayNight.main.time_of_day, "day": DayNight.main.day}
	if Foliage.main:
		data["foliage"] = Foliage.main.save_state()
	var campfires := []
	for c in get_tree().get_nodes_in_group("campfire"):
		campfires.append([c.global_position.x, c.global_position.y, c.global_position.z, c.fuel])
	data["campfires"] = campfires
	var f := FileAccess.open(save_path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))


func load_game() -> Dictionary:
	if not has_save():
		return {}
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(save_path))
	return d if d is Dictionary else {}


func delete_save() -> void:
	if has_save():
		DirAccess.remove_absolute(save_path)
