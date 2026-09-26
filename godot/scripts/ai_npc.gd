extends Node3D
## An NPC whose lines are written live by an LLM through OpenRouter.
##
## The game never holds your API key: it POSTs to tools/openrouter/server.mjs
## (`make ai-server`), which adds OPENROUTER_API_KEY server-side. That keeps
## the key out of shipped builds, including Web exports anyone can inspect.

@export var server_url := "http://127.0.0.1:8787/chat"
@export_multiline var persona := "You are Mara, a weathered ranger who watches over this valley. \
Answer in one or two short sentences, in character, with concrete details about the valley. \
Never mention being an AI."
@export var talk_distance := 3.0

var _label: Label3D
var _http: HTTPRequest
var _busy := false
var _history: Array[Dictionary] = []


func _ready() -> void:
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.3
	capsule.height = 1.75
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.22, 0.33, 0.27)
	mat.roughness = 0.85
	capsule.material = mat
	var body := MeshInstance3D.new()
	body.mesh = capsule
	body.position.y = 0.875
	add_child(body)

	var shape := CapsuleShape3D.new()
	shape.radius = 0.3
	shape.height = 1.75
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.position.y = 0.875
	var sb := StaticBody3D.new()
	sb.add_child(cs)
	add_child(sb)

	_label = Label3D.new()
	_label.position.y = 2.25
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_label.width = 700
	_label.font_size = 26
	_label.outline_size = 8
	_label.text = "Mara  [E] talk"
	add_child(_label)

	_http = HTTPRequest.new()
	_http.timeout = 45
	add_child(_http)
	_http.request_completed.connect(_on_reply)


func _process(_delta: float) -> void:
	var player := get_tree().get_first_node_in_group("player") as Node3D
	var near := player != null and player.global_position.distance_to(global_position) < talk_distance
	if near and not _busy and Input.is_action_just_pressed("interact"):
		_talk()


func _talk() -> void:
	_busy = true
	_label.text = "…"
	var line := "(A traveller walks up and greets you.)" if _history.is_empty() \
		else "(The traveller asks you to tell them more.)"
	_history.append({"role": "user", "content": line})
	var messages: Array = [{"role": "system", "content": persona}]
	messages.append_array(_history.slice(-8))
	var err := _http.request(server_url, ["Content-Type: application/json"],
		HTTPClient.METHOD_POST, JSON.stringify({"messages": messages, "max_tokens": 150}))
	if err != OK:
		_fail(error_string(err))


func _on_reply(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_fail("HTTP %d / result %d" % [code, result])
		return
	var data: Variant = JSON.parse_string(body.get_string_from_utf8())
	var reply: String = data.get("reply", "…") if data is Dictionary else "…"
	_history.append({"role": "assistant", "content": reply})
	_label.text = reply
	_busy = false


func _fail(why: String) -> void:
	_busy = false
	_history.pop_back()
	_label.text = "[AI offline: %s]\nRun `make ai-server` with OPENROUTER_API_KEY set." % why
