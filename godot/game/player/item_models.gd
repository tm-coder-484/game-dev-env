class_name ItemModels
## Procedural models for held items (grip at the origin, item pointing up +Y) and the arrow projectile.
## Built from primitives with the island's bark texture, a noise-based stone material and plain PBR
## materials, so no extra art files are needed.

static var _mats := {}


static func mat(kind: String) -> StandardMaterial3D:
	if _mats.has(kind):
		return _mats[kind]
	var m := StandardMaterial3D.new()
	match kind:
		"wood":
			m.albedo_texture = load("res://game/world/textures/trees/bark_pine_diff.jpg")
			m.normal_enabled = true
			m.normal_texture = load("res://game/world/textures/trees/bark_pine_nor_gl.jpg")
			m.uv1_scale = Vector3(0.25, 1.2, 1)
			m.albedo_color = Color(1.1, 0.95, 0.8)
			m.roughness = 0.85
		"shaft":
			m.albedo_color = Color(0.55, 0.4, 0.25)
			m.roughness = 0.7
		"stone":
			var n := NoiseTexture2D.new()
			n.noise = FastNoiseLite.new()
			n.noise.frequency = 0.05
			n.color_ramp = Gradient.new()
			n.color_ramp.set_color(0, Color(0.25, 0.25, 0.26))
			n.color_ramp.set_color(1, Color(0.56, 0.55, 0.52))
			m.albedo_texture = n
			var nn := NoiseTexture2D.new()
			nn.noise = n.noise
			nn.as_normal_map = true
			nn.bump_strength = 6.0
			m.normal_enabled = true
			m.normal_texture = nn
			m.roughness = 0.75
		"fiber":
			m.albedo_color = Color(0.6, 0.53, 0.3)
			m.roughness = 0.95
		"bone":
			m.albedo_color = Color(0.86, 0.83, 0.74)
			m.roughness = 0.5
			m.emission_enabled = true
			m.emission = Color(1.0, 0.35, 0.1)
			m.emission_energy_multiplier = 0.15
		"leather":
			m.albedo_color = Color(0.36, 0.22, 0.12)
			m.roughness = 0.6
		"raw":
			m.albedo_color = Color(0.58, 0.12, 0.1)
			m.roughness = 0.35
		"cooked":
			m.albedo_color = Color(0.33, 0.16, 0.07)
			m.roughness = 0.6
		"berry":
			m.albedo_color = Color(0.55, 0.02, 0.06)
			m.roughness = 0.15
			m.clearcoat_enabled = true
		"cloth":
			m.albedo_color = Color(0.85, 0.82, 0.74)
			m.roughness = 0.95
		"char":
			m.albedo_color = Color(0.08, 0.06, 0.05)
			m.roughness = 0.9
			m.emission_enabled = true
			m.emission = Color(1.0, 0.3, 0.05)
			m.emission_energy_multiplier = 0.6
		"feather":
			m.albedo_color = Color(0.9, 0.9, 0.88)
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
		"string":
			m.albedo_color = Color(0.8, 0.75, 0.6)
	_mats[kind] = m
	return m


static func _part(root: Node3D, mesh: Mesh, material: String, xf := Transform3D()) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat(material)
	mi.transform = xf
	root.add_child(mi)
	return mi


static func _cyl(r: float, h: float, r2 := -1.0, sides := 8) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = r if r2 < 0 else r2
	c.bottom_radius = r
	c.height = h
	c.radial_segments = sides
	c.rings = 1
	return c


static func _box(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


static func _prism(size: Vector3) -> PrismMesh:
	var p := PrismMesh.new()
	p.size = size
	return p


static func _sphere(r: float, h := -1.0) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0 if h < 0 else h
	s.radial_segments = 12
	s.rings = 6
	return s


static func _torus(r_in: float, r_out: float) -> TorusMesh:
	var t := TorusMesh.new()
	t.inner_radius = r_in
	t.outer_radius = r_out
	t.rings = 12
	t.ring_segments = 6
	return t


## A tube through `pts` (for the bow's limbs).
static func tube(pts: PackedVector3Array, radii: PackedFloat32Array, sides := 6) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := []
	for i in pts.size():
		var t := (pts[mini(i + 1, pts.size() - 1)] - pts[maxi(i - 1, 0)]).normalized()
		var n := t.cross(Vector3(0, 0, 1)).normalized()
		if n.length() < 0.5:
			n = t.cross(Vector3(1, 0, 0)).normalized()
		var b := t.cross(n)
		var ring := []
		for s in sides:
			var a := TAU * s / sides
			var d := n * cos(a) + b * sin(a)
			ring.append([pts[i] + d * radii[i], d])
		rings.append(ring)
	for i in pts.size() - 1:
		for s in sides:
			var s2 := (s + 1) % sides
			for v in [rings[i][s], rings[i + 1][s], rings[i + 1][s2], rings[i][s], rings[i + 1][s2], rings[i][s2]]:
				st.set_normal(v[1])
				st.set_uv(Vector2(float(s) / sides, float(i) / pts.size()))
				st.add_vertex(v[0])
	return st.commit()


## The model for a held item, or null for empty hands.
static func build(id: String) -> Node3D:
	var root := Node3D.new()
	root.name = id
	match id:
		"stone_axe":
			_part(root, _cyl(0.02, 0.62, 0.017), "wood", Transform3D(Basis(), Vector3(0, 0.2, 0)))
			_part(root, _prism(Vector3(0.1, 0.17, 0.05)), "stone", Transform3D(Basis(Vector3.BACK, -PI / 2), Vector3(0.07, 0.45, 0)))
			_part(root, _torus(0.019, 0.034), "fiber", Transform3D(Basis(), Vector3(0, 0.45, 0)))
		"pickaxe":
			_part(root, _cyl(0.02, 0.62, 0.017), "wood", Transform3D(Basis(), Vector3(0, 0.2, 0)))
			_part(root, _prism(Vector3(0.05, 0.17, 0.045)), "stone", Transform3D(Basis(Vector3.BACK, -PI / 2), Vector3(0.1, 0.47, 0)))
			_part(root, _prism(Vector3(0.05, 0.14, 0.045)), "stone", Transform3D(Basis(Vector3.BACK, PI / 2), Vector3(-0.09, 0.47, 0)))
			_part(root, _torus(0.019, 0.034), "fiber", Transform3D(Basis(), Vector3(0, 0.47, 0)))
		"spear", "bone_spear":
			_part(root, _cyl(0.017, 1.75, 0.014), "wood", Transform3D(Basis(), Vector3(0, 0.25, 0)))
			var tip := "bone" if id == "bone_spear" else "stone"
			_part(root, _prism(Vector3(0.055, 0.2, 0.025)), tip, Transform3D(Basis(), Vector3(0, 1.21, 0)))
			_part(root, _torus(0.015, 0.03), "fiber", Transform3D(Basis(), Vector3(0, 1.1, 0)))
		"bow":
			var pts := PackedVector3Array()
			var radii := PackedFloat32Array()
			var r := 0.75
			for i in 17:
				var a := deg_to_rad(lerpf(-48.0, 48.0, i / 16.0))
				pts.append(Vector3(r * cos(a) - r, r * sin(a), 0))
				radii.append(lerpf(0.02, 0.009, absf(i - 8) / 8.0))
			_part(root, tube(pts, radii), "wood")
			var top := pts[16]
			var bottom := pts[0]
			var string := _cyl(0.0025, top.distance_to(bottom), -1, 4)
			var si := _part(root, string, "string", Transform3D(Basis(), (top + bottom) * 0.5))
			si.name = "String"
			_part(root, _cyl(0.024, 0.13), "leather")
		"arrow":
			root.add_child(arrow_model())
		"torch":
			_part(root, _cyl(0.022, 0.5, 0.02), "wood", Transform3D(Basis(), Vector3(0, 0.1, 0)))
			_part(root, _cyl(0.035, 0.12, 0.04), "char", Transform3D(Basis(), Vector3(0, 0.38, 0)))
			var fire := fire_particles(0.6)
			fire.position = Vector3(0, 0.45, 0)
			root.add_child(fire)
			var light := OmniLight3D.new()
			light.name = "Light"
			light.light_color = Color(1.0, 0.62, 0.3)
			light.light_energy = 1.8
			light.omni_range = 11.0
			light.omni_attenuation = 1.4
			light.shadow_enabled = true
			light.position = Vector3(0, 0.55, 0.1)
			root.add_child(light)
		"berries":
			for i in 7:
				var a := i * 2.4
				_part(root, _sphere(0.011), "berry", Transform3D(Basis(), Vector3(cos(a) * 0.016 * (i % 3), 0.01 + (i % 2) * 0.013, sin(a) * 0.016 * (i % 3))))
		"raw_meat", "cooked_meat":
			_part(root, _sphere(0.085, 0.09), "raw" if id == "raw_meat" else "cooked", Transform3D(Basis().scaled(Vector3(1.3, 1, 0.9)), Vector3(0, 0.05, 0)))
			_part(root, _cyl(0.012, 0.16), "bone", Transform3D(Basis(Vector3.BACK, PI / 2), Vector3(0.13, 0.05, 0)))
		"bandage":
			_part(root, _cyl(0.045, 0.09), "cloth", Transform3D(Basis(Vector3.BACK, PI / 2), Vector3(0, 0.05, 0)))
		"waterskin", "waterskin_empty":
			_part(root, _sphere(0.1, 0.16 if id == "waterskin" else 0.09), "leather", Transform3D(Basis(), Vector3(0, 0.08, 0)))
			_part(root, _cyl(0.02, 0.07), "leather", Transform3D(Basis(), Vector3(0, 0.19, 0)))
		"campfire":
			root.add_child(campfire_model(false))
			root.scale = Vector3.ONE * 0.18
		_:
			return null
	return root


static func arrow_model() -> Node3D:
	var root := Node3D.new()
	# Points along -Z (forward) so it can be aimed with look_at.
	_part(root, _cyl(0.006, 0.72), "shaft", Transform3D(Basis(Vector3.RIGHT, -PI / 2), Vector3(0, 0, 0)))
	_part(root, _prism(Vector3(0.022, 0.06, 0.008)), "stone", Transform3D(Basis(Vector3.RIGHT, -PI / 2), Vector3(0, 0, -0.39)))
	for i in 3:
		var q := QuadMesh.new()
		q.size = Vector2(0.012, 0.09)
		_part(root, q, "feather", Transform3D(Basis(Vector3.BACK, i * TAU / 3).rotated(Vector3.RIGHT, -PI / 2) * Basis(Vector3.UP, PI / 2), Vector3(0, 0, 0.3)))
	return root


static func campfire_model(lit: bool) -> Node3D:
	var root := Node3D.new()
	for i in 9:
		var a := TAU * i / 9
		_part(root, _sphere(0.13, 0.16), "stone", Transform3D(Basis(Vector3.UP, a), Vector3(cos(a) * 0.55, 0.05, sin(a) * 0.55)))
	for i in 5:
		var a := TAU * i / 5 + 0.3
		var log := _part(root, _cyl(0.06, 0.8, 0.05), "wood", Transform3D(Basis(Vector3(sin(a), 0, -cos(a)), 1.1), Vector3(cos(a) * 0.18, 0.2, sin(a) * 0.18)))
		log.name = "Log%d" % i
	_part(root, _cyl(0.3, 0.03, 0.34), "char", Transform3D(Basis(), Vector3(0, 0.01, 0)))
	if lit:
		var fire := fire_particles(1.6)
		fire.name = "Fire"
		fire.position = Vector3(0, 0.15, 0)
		root.add_child(fire)
	return root


## Flames + embers + smoke as GPU particles.
static func fire_particles(size: float) -> Node3D:
	var root := Node3D.new()
	root.name = "FireFX"
	var flames := GPUParticles3D.new()
	flames.amount = int(24 * size)
	flames.lifetime = 0.7
	flames.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 12.0
	pm.initial_velocity_min = 0.5 * size
	pm.initial_velocity_max = 1.2 * size
	pm.gravity = Vector3(0, 1.2, 0)
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.08 * size
	pm.scale_min = 0.6
	pm.scale_max = 1.2
	var curve := CurveTexture.new()
	curve.curve = Curve.new()
	curve.curve.add_point(Vector2(0, 0.4))
	curve.curve.add_point(Vector2(0.3, 1.0))
	curve.curve.add_point(Vector2(1, 0))
	pm.scale_curve = curve
	var grad := GradientTexture1D.new()
	grad.gradient = Gradient.new()
	grad.gradient.set_color(0, Color(1.0, 0.85, 0.4, 1.0))
	grad.gradient.set_color(1, Color(1.0, 0.2, 0.02, 0.0))
	grad.gradient.add_point(0.4, Color(1.0, 0.45, 0.08, 0.9))
	pm.color_ramp = grad
	flames.process_material = pm
	var quad := QuadMesh.new()
	quad.size = Vector2(0.22, 0.3) * size
	var fm := StandardMaterial3D.new()
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	fm.vertex_color_use_as_albedo = true
	fm.albedo_texture = _soft_dot()
	fm.emission_enabled = true
	fm.emission = Color(1.0, 0.5, 0.15)
	fm.emission_energy_multiplier = 2.5
	quad.material = fm
	flames.draw_pass_1 = quad
	root.add_child(flames)

	var smoke := GPUParticles3D.new()
	smoke.amount = int(10 * size)
	smoke.lifetime = 3.0
	smoke.local_coords = false
	var sp := ParticleProcessMaterial.new()
	sp.direction = Vector3.UP
	sp.spread = 15.0
	sp.initial_velocity_min = 0.4
	sp.initial_velocity_max = 0.9
	sp.gravity = Vector3(0.25, 0.3, 0)
	sp.scale_min = 1.0
	sp.scale_max = 2.5
	var sg := GradientTexture1D.new()
	sg.gradient = Gradient.new()
	sg.gradient.set_color(0, Color(0.3, 0.3, 0.3, 0.0))
	sg.gradient.add_point(0.2, Color(0.35, 0.34, 0.33, 0.25))
	sg.gradient.set_color(1, Color(0.5, 0.5, 0.5, 0.0))
	sp.color_ramp = sg
	smoke.process_material = sp
	var sq := QuadMesh.new()
	sq.size = Vector2(0.5, 0.5) * size
	var sm := StandardMaterial3D.new()
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	sm.vertex_color_use_as_albedo = true
	sm.albedo_texture = _soft_dot()
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sq.material = sm
	smoke.draw_pass_1 = sq
	smoke.position = Vector3(0, 0.3 * size, 0)
	root.add_child(smoke)
	return root


static var _dot: Texture2D


static func _soft_dot() -> Texture2D:
	if _dot == null:
		var g := GradientTexture2D.new()
		g.fill = GradientTexture2D.FILL_RADIAL
		g.fill_from = Vector2(0.5, 0.5)
		g.fill_to = Vector2(0.5, 0.0)
		g.gradient = Gradient.new()
		g.gradient.set_color(0, Color(1, 1, 1, 1))
		g.gradient.set_color(1, Color(1, 1, 1, 0))
		g.width = 64
		g.height = 64
		_dot = g
	return _dot
