// Shared by terrain.gdshader and grass.gdshader: the baked island data and how to sample it.
// terrain.gd fills these uniforms (grass.gd copies them from the terrain material).

uniform sampler2D height_map : filter_nearest, repeat_disable;
uniform sampler2D normal_map : filter_linear_mipmap, repeat_disable;
uniform sampler2D mask_map : filter_linear_mipmap, repeat_disable;
uniform float world_size = 2048.0;
uniform float resolution = 1025.0;
uniform float sea_level = 0.0;
uniform float snow_line = 215.0;
uniform vec4 lake = vec4(170.0, 190.0, 20.9, 144.0); // x, z, water level, radius

vec2 world_uv(vec2 xz) {
	float cell = world_size / (resolution - 1.0);
	return ((xz + world_size * 0.5) / cell + 0.5) / resolution;
}

// Same triangulation as the Jolt HeightMapShape3D, so the rendered ground matches collision.
float terrain_height(vec2 xz) {
	float cell = world_size / (resolution - 1.0);
	vec2 p = clamp((xz + world_size * 0.5) / cell, vec2(0.0), vec2(resolution - 1.001));
	ivec2 i = ivec2(floor(p));
	vec2 f = p - vec2(i);
	float h00 = texelFetch(height_map, i, 0).r;
	float h10 = texelFetch(height_map, i + ivec2(1, 0), 0).r;
	float h01 = texelFetch(height_map, i + ivec2(0, 1), 0).r;
	float h11 = texelFetch(height_map, i + ivec2(1, 1), 0).r;
	// Jolt splits each quad along the (1,0)-(0,1) diagonal.
	if (f.x + f.y <= 1.0) {
		return h00 + (h10 - h00) * f.x + (h01 - h00) * f.y;
	}
	return h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y);
}

// World-space normal, stored as (x, z, y).
vec3 terrain_normal(vec2 xz, float lod) {
	return normalize(textureLod(normal_map, world_uv(xz), lod).rbg * 2.0 - 1.0);
}

// Elliptical distance to the lake centre, in metres (matches build_world.py's lake shape roughly).
float lake_distance(vec2 xz) {
	return length((xz - lake.xy) * vec2(1.0, 1.35));
}
