// Leaf and needle cards (branch_atlas.webp, AI-generated): alpha-tested with coverage kept at a
// distance, translucent, soft canopy normals (baked by generate_trees.py) and canopy darkening from
// COLOR.b. INSTANCE_CUSTOM.r = 1 hides the berries on picked bramble bushes.
shader_type spatial;
render_mode cull_disabled;

#include "res://game/world/shaders/tree_wind.gdshaderinc"

uniform sampler2D atlas : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform vec2 atlas_size = vec2(4096.0, 1536.0);
uniform vec3 tint : source_color = vec3(1.0);
uniform float hue_variation = 0.12;
uniform float fade_start = 0.0;
uniform float fade_end = 0.0;
uniform bool use_custom = false;

varying vec3 v_normal;
varying float v_light;
varying vec3 v_tint;
varying float v_picked;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	VERTEX = tree_wind(VERTEX, COLOR, origin, MODEL_MATRIX, TIME);
	v_normal = normalize(mat3(MODEL_MATRIX) * NORMAL);
	v_light = COLOR.b;
	float h = tree_hash(origin.xz);
	v_tint = tint * mix(vec3(1.0 - hue_variation, 1.0, 1.0 - hue_variation * 1.5), vec3(1.0 + hue_variation * 0.6, 1.0, 0.9), h);
	v_picked = use_custom ? INSTANCE_CUSTOM.r : 0.0;
}

void fragment() {
	if (fade_end > 0.0) {
		float d = length(VERTEX);
		float noise = fract(sin(dot(FRAGCOORD.xy, vec2(12.9898, 78.233))) * 43758.5453);
		if (smoothstep(fade_start, fade_end, d) > noise) {
			discard;
		}
	}
	vec4 c = texture(atlas, UV);
	if (v_picked > 0.5 && c.r > c.g * 1.7 && c.r > 0.25) {
		c.a = 0.0; // berries picked
	}
	vec2 px = UV * atlas_size;
	float lod = 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px))));
	ALPHA = c.a * (1.0 + max(lod, 0.0) * 0.3);
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ALPHA_ANTIALIASING_EDGE = 0.25;
	ALPHA_TEXTURE_COORDINATE = px;
	vec3 col = c.rgb * v_tint * mix(0.32, 1.0, v_light);
	ALBEDO = col;
	NORMAL = normalize((VIEW_MATRIX * vec4(v_normal, 0.0)).xyz);
	ROUGHNESS = 0.72;
	SPECULAR = 0.35;
	BACKLIGHT = col * 0.6;
	AO = mix(0.4, 1.0, v_light);
	AO_LIGHT_AFFECT = 0.3;
}
