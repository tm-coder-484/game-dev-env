class_name Items
## Every item and recipe in Hollowvale. Icons live in res://game/ui/icons/<id>.png
## (generated with `node tools/openrouter/assets.mjs icon ...`, see README).

enum Kind { RESOURCE, TOOL, WEAPON, RANGED, FOOD, MEDICINE, PLACEABLE, AMMO, LIGHT, DRINK }

const DATA := {
	"stick": {"name": "Stick", "kind": Kind.RESOURCE, "desc": "Straight and dry. The start of everything."},
	"stone": {"name": "Stone", "kind": Kind.RESOURCE, "desc": "A fist-sized stone with a good edge."},
	"fiber": {"name": "Plant Fiber", "kind": Kind.RESOURCE, "desc": "Twisted grass. Ties things together."},
	"wood": {"name": "Wood", "kind": Kind.RESOURCE, "desc": "Split logs for building and burning."},
	"hide": {"name": "Wolf Hide", "kind": Kind.RESOURCE, "desc": "Thick fur. Warm, and it holds water."},
	"bone": {"name": "Hollow Bone", "kind": Kind.RESOURCE, "desc": "Still faintly warm. Makes a vicious point."},
	"berries": {"name": "Berries", "kind": Kind.FOOD, "hunger": 9.0, "thirst": 4.0, "desc": "Sweet brambleberries."},
	"raw_meat": {"name": "Raw Meat", "kind": Kind.FOOD, "hunger": 12.0, "health": -8.0, "desc": "Cook it first if you can."},
	"cooked_meat": {"name": "Cooked Meat", "kind": Kind.FOOD, "hunger": 38.0, "health": 6.0, "desc": "Hot, smoky and filling."},
	"bandage": {"name": "Bandage", "kind": Kind.MEDICINE, "heal": 35.0, "desc": "Stops the bleeding. Heals over a few seconds."},
	"waterskin": {"name": "Waterskin", "kind": Kind.DRINK, "thirst": 30.0, "desc": "Full of lake water. Fill it again at the lake."},
	"waterskin_empty": {"name": "Empty Waterskin", "kind": Kind.RESOURCE, "desc": "Fill it at the lake with [E]."},
	"stone_axe": {"name": "Stone Axe", "kind": Kind.TOOL, "damage": 16.0, "chop": 1.6, "mine": 0.4, "reach": 2.4, "stamina": 7.0, "rate": 0.62,
		"desc": "Fells trees. A decent weapon in a pinch."},
	"pickaxe": {"name": "Stone Pickaxe", "kind": Kind.TOOL, "damage": 13.0, "chop": 0.4, "mine": 1.6, "reach": 2.4, "stamina": 7.0, "rate": 0.66,
		"desc": "Breaks stone out of rocks."},
	"spear": {"name": "Spear", "kind": Kind.WEAPON, "damage": 28.0, "chop": 0.1, "mine": 0.0, "reach": 3.3, "stamina": 9.0, "rate": 0.72,
		"desc": "Long reach. Keep wolves at a distance."},
	"bone_spear": {"name": "Bone Spear", "kind": Kind.WEAPON, "damage": 46.0, "chop": 0.1, "mine": 0.0, "reach": 3.4, "stamina": 9.0, "rate": 0.68,
		"desc": "Tipped with Hollow bone. It bites deep."},
	"bow": {"name": "Hunting Bow", "kind": Kind.RANGED, "damage": 40.0, "desc": "Hold to draw, release to shoot. Needs arrows."},
	"arrow": {"name": "Arrow", "kind": Kind.AMMO, "desc": "Stone-tipped."},
	"torch": {"name": "Torch", "kind": Kind.LIGHT, "damage": 8.0, "reach": 2.2, "stamina": 5.0, "rate": 0.6,
		"desc": "Light and warmth. Hollows hate fire."},
	"campfire": {"name": "Campfire", "kind": Kind.PLACEABLE, "desc": "Warmth, light and cooking. Hollows won't come close."},
}

## Fists: what the player uses with an empty hand.
const FISTS := {"name": "Fists", "kind": Kind.WEAPON, "damage": 6.0, "chop": 0.0, "mine": 0.0, "reach": 1.9, "stamina": 4.0, "rate": 0.45}

const RECIPES := [
	{"id": "stone_axe", "count": 1, "needs": {"stick": 2, "stone": 2, "fiber": 3}},
	{"id": "pickaxe", "count": 1, "needs": {"stick": 2, "stone": 3, "fiber": 3}},
	{"id": "spear", "count": 1, "needs": {"stick": 3, "stone": 1, "fiber": 2}},
	{"id": "torch", "count": 1, "needs": {"stick": 1, "fiber": 2}},
	{"id": "bandage", "count": 1, "needs": {"fiber": 4}},
	{"id": "campfire", "count": 1, "needs": {"wood": 4, "stone": 4}},
	{"id": "bow", "count": 1, "needs": {"wood": 2, "fiber": 6}},
	{"id": "arrow", "count": 5, "needs": {"stick": 2, "stone": 1, "fiber": 1}},
	{"id": "waterskin_empty", "count": 1, "needs": {"hide": 2, "fiber": 3}},
	{"id": "bone_spear", "count": 1, "needs": {"stick": 3, "bone": 2, "fiber": 2}},
]


static func info(id: String) -> Dictionary:
	return DATA.get(id, FISTS)


static func item_name(id: String) -> String:
	return info(id).name


static func kind(id: String) -> int:
	return info(id).kind


## Things that go in the hotbar (everything you hold or use rather than just carry).
static func is_holdable(id: String) -> bool:
	return kind(id) != Kind.RESOURCE and kind(id) != Kind.AMMO


static func icon(id: String) -> Texture2D:
	var path := "res://game/ui/icons/%s.png" % id
	return load(path) if ResourceLoader.exists(path) else null
