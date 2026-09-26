class_name CraftMenu
extends GameScreen
## [Tab] Crafting on the left, everything you carry on the right.

var player: Player
var _recipes: VBoxContainer
var _grid: GridContainer
var _info: Label


func _init() -> void:
	super()
	GameScreen.dim_background(self, 0.45)
	var panel := GameScreen.centered_panel(self, Vector2(980, 600))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	panel.add_child(v)
	var head := HBoxContainer.new()
	head.add_child(UITheme.title("Crafting", 30))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(spacer)
	head.add_child(UITheme.title("Pack", 30))
	v.add_child(head)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 16)
	h.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(h)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(560, 0)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	h.add_child(scroll)
	_recipes = VBoxContainer.new()
	_recipes.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_recipes.add_theme_constant_override("separation", 6)
	scroll.add_child(_recipes)
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(right)
	_grid = GridContainer.new()
	_grid.columns = 5
	_grid.add_theme_constant_override("h_separation", 6)
	_grid.add_theme_constant_override("v_separation", 6)
	right.add_child(_grid)
	_info = UITheme.label("", 16, UITheme.DIM)
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_info.custom_minimum_size = Vector2(360, 0)
	right.add_child(_info)
	var tip := UITheme.label("[E] on tall grass for fiber, on pebbles for stone, on dry branches for sticks. " +
		"Click a recipe to craft it. [Tab] closes.", 15, UITheme.DIM)
	tip.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(tip)


func _on_open() -> void:
	_refresh()
	if not player.inventory.changed.is_connected(_refresh):
		player.inventory.changed.connect(_refresh)


func _refresh() -> void:
	if not visible:
		return
	for c in _recipes.get_children():
		c.queue_free()
	for c in _grid.get_children():
		c.queue_free()
	var inv := player.inventory
	for r: Dictionary in Items.RECIPES:
		var can := inv.has_all(r.needs)
		var b := Button.new()
		b.custom_minimum_size = Vector2(0, 58)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.icon = Items.icon(r.id)
		b.expand_icon = false
		b.add_theme_constant_override("icon_max_width", 44)
		var parts := []
		for id: String in r.needs:
			parts.append("%d/%d %s" % [mini(inv.count(id), r.needs[id]), r.needs[id], Items.item_name(id)])
		b.text = "%s%s\n%s" % [Items.item_name(r.id), " x%d" % r.count if r.count > 1 else "", "   ".join(parts)]
		b.add_theme_font_size_override("font_size", 16)
		b.modulate = Color.WHITE if can else Color(0.75, 0.68, 0.62)
		b.tooltip_text = Items.info(r.id).desc
		b.pressed.connect(_craft.bind(r))
		b.mouse_entered.connect(func() -> void: _info.text = "%s: %s" % [Items.item_name(r.id), Items.info(r.id).desc])
		_recipes.add_child(b)
	var ids := inv.counts.keys()
	ids.sort()
	for id: String in ids:
		var tile := PanelContainer.new()
		tile.custom_minimum_size = Vector2(64, 64)
		tile.tooltip_text = "%s\n%s" % [Items.item_name(id), Items.info(id).desc]
		var icon := TextureRect.new()
		icon.texture = Items.icon(id)
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.custom_minimum_size = Vector2(48, 48)
		tile.add_child(icon)
		var n := UITheme.label(str(inv.count(id)), 15)
		n.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		n.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
		tile.add_child(n)
		_grid.add_child(tile)
	if ids.is_empty():
		_info.text = "Your pack is empty. Look around the beach for sticks and stones."


func _craft(r: Dictionary) -> void:
	if player.inventory.craft(r):
		Game.notify("Crafted %s%s" % [Items.item_name(r.id), " x%d" % r.count if r.count > 1 else ""], r.id)
		player.sfx.play("craft")
	else:
		var missing := []
		for id: String in r.needs:
			var need: int = r.needs[id] - player.inventory.count(id)
			if need > 0:
				missing.append("%d %s" % [need, Items.item_name(id)])
		_info.text = "Still need: " + ", ".join(missing)
