class_name Inventory
extends RefCounted
## Item counts plus an 8-slot hotbar. Anything you hold or use (tools, weapons, food, the torch, the
## campfire...) goes into the first free hotbar slot when you first get it.

signal changed

const HOTBAR_SIZE := 8

var counts := {}
var hotbar: Array[String] = []
var selected := 0


func _init() -> void:
	hotbar.resize(HOTBAR_SIZE)
	hotbar.fill("")


func count(id: String) -> int:
	return counts.get(id, 0)


func add(id: String, n := 1) -> void:
	if n <= 0:
		return
	counts[id] = count(id) + n
	if Items.is_holdable(id) and not hotbar.has(id):
		var free := hotbar.find("")
		if free >= 0:
			hotbar[free] = id
	changed.emit()


func remove(id: String, n := 1) -> bool:
	if count(id) < n:
		return false
	counts[id] = count(id) - n
	if counts[id] <= 0:
		counts.erase(id)
		var slot := hotbar.find(id)
		if slot >= 0:
			hotbar[slot] = ""
	changed.emit()
	return true


func has_all(needs: Dictionary) -> bool:
	for id: String in needs:
		if count(id) < needs[id]:
			return false
	return true


func craft(recipe: Dictionary) -> bool:
	if not has_all(recipe.needs):
		return false
	for id: String in recipe.needs:
		counts[id] = count(id) - recipe.needs[id]
		if counts[id] <= 0:
			counts.erase(id)
	add(recipe.id, recipe.count)
	return true


## The item in the selected hotbar slot ("" = empty hands).
func held() -> String:
	var id := hotbar[selected]
	return id if count(id) > 0 else ""


func select(i: int) -> void:
	selected = wrapi(i, 0, HOTBAR_SIZE)
	changed.emit()


func to_dict() -> Dictionary:
	return {"counts": counts.duplicate(), "hotbar": Array(hotbar), "selected": selected}


func from_dict(d: Dictionary) -> void:
	counts = {}
	for k: String in d.get("counts", {}):
		counts[k] = int(d.counts[k])
	var hb: Array = d.get("hotbar", [])
	for i in HOTBAR_SIZE:
		hotbar[i] = hb[i] if i < hb.size() else ""
	selected = int(d.get("selected", 0))
	changed.emit()
