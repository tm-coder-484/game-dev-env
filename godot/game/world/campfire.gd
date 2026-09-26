class_name Campfire
extends StaticBody3D
## A placed campfire: light, warmth, cooking and a safe zone the Hollows won't enter. Burns fuel;
## add wood with [E] to keep it going.

const MAX_FUEL := 900.0

var lit := true
var fuel := 600.0
var warm_radius := 6.5
var safe_radius := 11.0

var _light: OmniLight3D
var _fire: Node3D
var _time := 0.0
var _audio: AudioStreamPlayer3D


func _ready() -> void:
	add_to_group("campfire")
	collision_layer = 1 | 16
	var cs := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = 0.7
	shape.height = 0.5
	cs.shape = shape
	cs.position.y = 0.25
	add_child(cs)
	var model := ItemModels.campfire_model(true)
	add_child(model)
	_fire = model.find_child("Fire", true, false)
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.58, 0.28)
	_light.light_energy = 3.0
	_light.omni_range = 16.0
	_light.omni_attenuation = 1.3
	_light.shadow_enabled = true
	_light.position = Vector3(0, 0.9, 0)
	add_child(_light)
	_audio = Sfx.loop("fire", self)


func interact_prompt(player: Player) -> String:
	if not lit:
		return "[E] Relight with wood" if player.inventory.count("wood") > 0 else "Burnt out: needs wood"
	if player.inventory.count("raw_meat") > 0:
		return "[E] Cook raw meat"
	if fuel < MAX_FUEL - 200.0 and player.inventory.count("wood") > 0:
		return "[E] Add wood (%d%% fuel)" % int(fuel / MAX_FUEL * 100.0)
	return "Campfire (%d%% fuel)" % int(fuel / MAX_FUEL * 100.0)


func interact(player: Player) -> void:
	if lit and player.inventory.count("raw_meat") > 0:
		player.inventory.remove("raw_meat")
		player.inventory.add("cooked_meat")
		Game.notify("+1 Cooked Meat", "cooked_meat")
		Sfx.at("sizzle", global_position)
	elif player.inventory.count("wood") > 0 and fuel < MAX_FUEL - 200.0:
		player.inventory.remove("wood")
		fuel = minf(MAX_FUEL, fuel + 300.0)
		_set_lit(true)
		Sfx.at("fire_start", global_position)


func _set_lit(on: bool) -> void:
	lit = on
	_light.visible = on
	if _fire:
		_fire.visible = on
		for p in _fire.find_children("*", "GPUParticles3D", true, false):
			(p as GPUParticles3D).emitting = on
	if _audio:
		_audio.playing = on


func _process(delta: float) -> void:
	_time += delta
	if not lit:
		return
	fuel -= delta
	if fuel <= 0.0:
		fuel = 0.0
		_set_lit(false)
		return
	var strength := clampf(fuel / 120.0, 0.35, 1.0)
	_light.light_energy = (2.8 + sin(_time * 11.0) * 0.25 + sin(_time * 23.0 + 1.3) * 0.18) * strength
	_light.position.x = sin(_time * 7.0) * 0.04
