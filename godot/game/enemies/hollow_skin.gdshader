// The Hollows: charred, bark-like husks with embers glowing through their cracks. `burn` dissolves
// them into cinders (death, or caught by the sunrise).
shader_type spatial;

uniform sampler2D bark : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D bark_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D noise : filter_linear_mipmap, repeat_enable;
uniform float glow = 1.0;
uniform float burn = 0.0;
uniform float hurt = 0.0;
uniform float phase = 0.0;

void fragment() {
	vec2 uv = UV * 4.0;
	vec3 b = texture(bark, uv).rgb;
	float n = texture(noise, UV * 2.2 + vec2(TIME * 0.01, 0.0)).r;
	// Thin veins where the noise crosses a level: the cracks.
	float vein = 1.0 - smoothstep(0.0, 0.035, abs(n - 0.55));
	float pulse = 0.75 + 0.25 * sin(TIME * 2.6 + phase + n * 9.0);
	if (n < burn * 1.1 - 0.05) {
		discard;
	}
	float edge = 1.0 - smoothstep(0.0, 0.08, n - (burn * 1.1 - 0.05));
	ALBEDO = mix(b * vec3(0.16, 0.14, 0.13), vec3(0.5, 0.06, 0.02), hurt * 0.5);
	NORMAL_MAP = texture(bark_normal, uv).rgb;
	NORMAL_MAP_DEPTH = 1.6;
	ROUGHNESS = 0.9;
	EMISSION = vec3(1.0, 0.33, 0.06) * (vein * glow * pulse * 3.5 + edge * step(0.001, burn) * 8.0);
}
