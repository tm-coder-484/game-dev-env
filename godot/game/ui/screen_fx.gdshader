// Full-screen HUD effects: red damage flash, pulsing low-health edges, frost when freezing,
// murky tint underwater.
shader_type canvas_item;

uniform float damage = 0.0;
uniform float low_health = 0.0;
uniform float cold = 0.0;
uniform float underwater = 0.0;
uniform sampler2D noise : repeat_enable, filter_linear;

void fragment() {
	vec2 uv = UV - 0.5;
	float r = length(uv * vec2(1.5, 1.0));
	float edge = smoothstep(0.42, 0.95, r);
	float n = texture(noise, UV * 3.0).r;
	vec3 col = vec3(0.0);
	float a = 0.0;
	float red = damage + low_health * (0.55 + 0.45 * sin(TIME * 3.5));
	col += vec3(0.55, 0.02, 0.0) * step(0.001, red);
	a += edge * red * 0.85;
	float frost = smoothstep(0.35, 1.0, r + n * 0.35) * cold;
	col = mix(col, vec3(0.8, 0.9, 1.0), clamp(frost * 1.5, 0.0, 1.0));
	a = max(a, frost * 0.7);
	col = mix(col, vec3(0.03, 0.2, 0.24), underwater);
	a = max(a, underwater * (0.45 + edge * 0.4));
	COLOR = vec4(col, clamp(a, 0.0, 1.0));
}
