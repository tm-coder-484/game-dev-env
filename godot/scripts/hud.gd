extends CanvasLayer
## Player HUD: health/stamina bars, crosshair, 5-slot hotbar (1-5 / mouse wheel / LB-RB).
## Every image comes from res://assets/ui/. Regenerate the whole kit with an
## image model:  node tools/openrouter/assets.mjs ui-kit [--model <any>] [--ref mockup.png]

const ITEMS := ["sword", "pickaxe", "torch", "potion", "map"]
const SLOT_SIZE := 72.0

@export var slot_texture: Texture2D = preload("res://assets/ui/hud/slot.png")
@export var slot_selected_texture: Texture2D = preload("res://assets/ui/hud/slot_selected.png")

@onready var health_bar: TextureProgressBar = %Health
@onready var stamina_bar: TextureProgressBar = %Stamina
@onready var hotbar: HBoxContainer = %Hotbar
@onready var item_name: Label = %ItemName

var selected := 0
var _slots: Array[TextureRect] = []
var _name_timer := 0.0


func _ready() -> void:
	for item in ITEMS:
		var slot := TextureRect.new()
		slot.custom_minimum_size = Vector2(SLOT_SIZE, SLOT_SIZE)
		slot.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var icon := TextureRect.new()
		icon.texture = load("res://assets/ui/icons/%s.png" % item)
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		icon.offset_left = 10
		icon.offset_top = 10
		icon.offset_right = -10
		icon.offset_bottom = -10
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		slot.add_child(icon)
		hotbar.add_child(slot)
		_slots.append(slot)
	select(0)


func _unhandled_input(event: InputEvent) -> void:
	for i in ITEMS.size():
		if event.is_action_pressed("hotbar_%d" % (i + 1)):
			select(i)
	if event.is_action_pressed("hotbar_next"):
		select((selected + 1) % ITEMS.size())
	elif event.is_action_pressed("hotbar_prev"):
		select((selected - 1 + ITEMS.size()) % ITEMS.size())


func select(index: int) -> void:
	selected = index
	for i in _slots.size():
		_slots[i].texture = slot_selected_texture if i == index else slot_texture
	item_name.text = ITEMS[index].capitalize()
	item_name.modulate.a = 1.0
	_name_timer = 1.5


func _process(delta: float) -> void:
	var player := get_tree().get_first_node_in_group("player")
	if player:
		health_bar.max_value = player.max_health
		health_bar.value = player.health
		stamina_bar.max_value = player.max_stamina
		stamina_bar.value = player.stamina
	_name_timer -= delta
	if _name_timer < 0.5:
		item_name.modulate.a = clampf(_name_timer / 0.5, 0.0, 1.0)
