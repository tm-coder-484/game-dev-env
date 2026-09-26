// Tree trunks and branches: tileable PBR bark, wind sway, bleached grey for dead wood (COLOR.a = 0).
shader_type spatial;

#include "res://game/world/shaders/tree_wind.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D arm_tex : filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0);
uniform vec3 dead_tint : source_color = vec3(0.62, 0.6, 0.58);
uniform vec2 uv_scale = vec2(1.0, 1.0);
uniform float fade_start = 0.0; // metres: dither in (impostor hand-over)
uniform float fade_end = 0.0;   // metres: dither out; 0 = never

varying float v_alive;

void vertex() {
	VERTEX = tree_wind(VERTEX, COLOR, MODEL_MATRIX[3].xyz, MODEL_MATRIX, TIME);
	v_alive = COLOR.a;
}

void fragment() {
	if (fade_end > 0.0) {
		float d = length(VERTEX);
		float noise = fract(sin(dot(FRAGCOORD.xy, vec2(12.9898, 78.233))) * 43758.5453);
		if (smoothstep(fade_start, fade_end, d) > noise) {
			discard;
		}
	}
	vec2 uv = UV * uv_scale;
	vec3 a = texture(albedo_tex, uv).rgb * tint;
	float lum = dot(a, vec3(0.3, 0.55, 0.15));
	ALBEDO = mix(vec3(lum) * dead_tint * 1.3, a, v_alive);
	NORMAL_MAP = texture(normal_tex, uv).rgb;
	vec3 arm = texture(arm_tex, uv).rgb;
	AO = arm.r;
	ROUGHNESS = mix(0.95, arm.g, v_alive);
}
