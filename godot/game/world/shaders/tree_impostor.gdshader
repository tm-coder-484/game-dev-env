// Distant trees: two crossed cards showing a side view of the tree, captured at startup by
// foliage.gd from the real meshes. INSTANCE_CUSTOM.r = atlas cell. Dithers in where the meshes
// dither out, so the hand-over is invisible.
shader_type spatial;
render_mode cull_disabled;

#include "res://game/world/shaders/tree_wind.gdshaderinc"

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform float cells = 11.0;
uniform float fade_start = 130.0;
uniform float fade_end = 140.0;

varying float v_cell;
varying vec3 v_normal;

void vertex() {
	v_cell = INSTANCE_CUSTOM.r;
	vec3 origin = MODEL_MATRIX[3].xyz;
	vec4 col = vec4(0.0, 0.0, 1.0, 1.0);
	VERTEX = tree_wind(VERTEX * vec3(1.0, 1.0, 1.0), col, origin, MODEL_MATRIX, TIME);
	v_normal = normalize(vec3(0.0, 0.6, 0.0) + normalize(mat3(MODEL_MATRIX) * vec3(VERTEX.x, 0.0, VERTEX.z) + vec3(1e-4)));
	UV = vec2((v_cell + mix(0.002, 0.998, UV.x)) / cells, UV.y);
}

void fragment() {
	float d = length(VERTEX);
	float noise = fract(sin(dot(FRAGCOORD.xy, vec2(12.9898, 78.233))) * 43758.5453);
	if (smoothstep(fade_start, fade_end, d) < noise) {
		discard;
	}
	vec4 c = texture(atlas, UV);
	ALPHA = c.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ALBEDO = c.rgb;
	NORMAL = normalize((VIEW_MATRIX * vec4(v_normal, 0.0)).xyz);
	ROUGHNESS = 0.8;
	SPECULAR = 0.3;
	BACKLIGHT = c.rgb * 0.4;
}
