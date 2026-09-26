// Wind for trees and bushes (tree_bark / tree_leaves / tree_impostor). The whole tree leans and sways
// with height; branches and leaves flutter by vertex colour R (weight) with phase G, both from
// tools/blender/generate_trees.py.

global uniform vec2 wind_direction;
global uniform float wind_strength;

// `v` in model space; `origin` = the instance's world position (gives each tree its own rhythm).
vec3 tree_wind(vec3 v, vec4 col, vec3 origin, mat4 model, float t) {
	vec2 wd = normalize(wind_direction + vec2(1e-4));
	// Wind direction in model space (instances are rotated and scaled around Y).
	vec3 wl = normalize((inverse(mat3(model)) * vec3(wd.x, 0.0, wd.y)) * vec3(1.0, 0.0, 1.0) + vec3(1e-4));
	float phase = dot(origin.xz, vec2(0.071, 0.113));
	float gust = sin(t * 0.55 + phase * 0.5) * 0.5 + 0.5;
	float strength = wind_strength * (0.35 + 0.65 * gust * gust);
	float h = max(v.y, 0.0);
	float lean = h * h * 0.0011 * strength;
	float sway = sin(t * 1.25 + phase) * h * h * 0.0005 * (0.3 + strength);
	v += wl * (lean + sway);
	float w = col.r;
	float flutter = sin(t * (1.9 + col.g * 1.4) + col.g * 6.2831 + phase) * 0.09 + sin(t * 4.7 + col.g * 23.0) * 0.035;
	v += (wl + vec3(0.0, 0.35, 0.0)) * w * flutter * (0.35 + strength);
	return v;
}

float tree_hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
