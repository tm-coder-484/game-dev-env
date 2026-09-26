class_name PlayerAudio
extends Node
## The player's own sounds (non-positional): swings, hits, footsteps per surface, eating, hurt...

var _players: Array[AudioStreamPlayer] = []
var _next := 0


func _ready() -> void:
	for i in 8:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)


func play(sound: String, volume_db := 0.0, pitch_jitter := 0.08) -> void:
	var s := Sfx.stream(sound)
	if s == null:
		return
	var p := _players[_next]
	_next = (_next + 1) % _players.size()
	p.stream = s
	p.volume_db = volume_db
	p.pitch_scale = randf_range(1.0 - pitch_jitter, 1.0 + pitch_jitter)
	p.play()


func footstep(surface: String) -> void:
	play("step_" + surface, -8.0, 0.12)
