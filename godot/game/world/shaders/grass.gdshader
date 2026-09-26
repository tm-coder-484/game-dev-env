// Tall grass: camera-following rings of clumps (see grass.gd). Each instance sits on a fixed world grid
// cell, so its jitter, size, variant and rotation come from a hash of that cell and stay put as the
// rings move. Clumps are three crossed cards textured from an AI-generated atlas
// (tools/openrouter/assets.mjs foliage). Wind sends rolling waves across the fields and the grass
// parts around the player.
shader_type spatial;
render_mode world_vertex_coords, cull_disabled;

#include "res://game/world/shaders/terrain_common.gdshaderinc"

// Atlas cells, left to right: 0 lush, 1 seed heads, 2 wildflowers, 3 dry, 4 reeds.
uniform sampler2D atlas : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform vec2 atlas_size = vec2(5120.0, 1536.0);
uniform sampler2D wind_noise : filter_linear_mipmap, repeat_enable;
uniform float spacing = 0.6;          // grid spacing of this ring, metres
uniform vec4 fade = vec4(0.0, 0.0, 34.0, 42.0); // fade in from x..y, out from z..w (metres from camera)
uniform float size_scale = 1.0;
uniform float density = 1.0;
uniform float variety = 1.0;          // chance scale for the non-lush variants (lower in the far ring)
uniform vec3 center;                  // camera position, for distance fade
uniform vec3 base_tint : source_color = vec3(1.0);

global uniform vec2 wind_direction;
global uniform float wind_strength;
global uniform vec3 player_position;

const float CELLS = 5.0;
// Height (m) and width/height ratio per variant.
const float VARIANT_HEIGHT[5] = float[5](1.05, 1.2, 0.95, 1.1, 1.7);
const float VARIANT_WIDTH[5] = float[5](0.8, 0.75, 0.8, 0.8, 0.6);

varying float v_k;       // 0 at the root, 1 at the tip
varying float v_sheen;   // how bent this clump is right now
varying vec3 v_tint;
varying vec3 v_normal;   // world space; set explicitly so back faces aren't lit as if facing down

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.xx + p3.yz) * p3.zy);
}

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	vec3 local = VERTEX - origin; // unit clump: y in 0..1, x/z in -0.5..0.5
	vec2 cell = floor(origin.xz / spacing + 0.5);
	vec2 jit = hash22(cell);
	float r1 = hash12(cell + 17.31);
	float r2 = hash12(cell * 1.73 + 3.7);
	float r3 = hash12(cell * 0.37 - 11.1);
	vec2 base = (cell + (jit - 0.5) * 0.95) * spacing;

	float ground = terrain_height(base);
	vec3 n = terrain_normal(base, 0.0);
	vec4 m = textureLod(mask_map, world_uv(base), 0.0);
	float slope = 1.0 - n.y;

	// Where grass grows: gentle, not beach, not alpine, thinner in forests and on gravel.
	float grow = (1.0 - smoothstep(0.2, 0.32, slope));
	grow *= smoothstep(2.2, 4.0, ground - sea_level);
	grow *= 1.0 - smoothstep(snow_line - 70.0, snow_line - 25.0, ground);
	grow *= 1.0 - smoothstep(0.35, 0.85, m.b) * 0.8;
	grow *= 1.0 - smoothstep(0.3, 0.75, m.g) * 0.7;
	// Meadow patches: some areas chest-high, some ankle-high.
	float field = textureLod(wind_noise, base * 0.0021 + 0.37, 0.0).r;
	float tall = mix(0.6, 1.2, smoothstep(0.3, 0.7, field));

	// Variant: reeds along the lake shore, otherwise mostly lush grass; drier up high.
	float ld = lake_distance(base);
	bool shore = ld < lake.w * 1.35 && ground < lake.z + 1.0 && ground > lake.z - 0.7;
	float dry = smoothstep(110.0, 190.0, ground) * 0.4 + (m.a - 0.5) * 0.4;
	int variant = 0;
	if (shore) {
		variant = 4;
		grow = 1.0 - smoothstep(0.25, 0.4, slope);
		tall = 1.0;
	} else if (r2 < (0.05 + max(dry, 0.0) * 0.3) * variety) {
		variant = 3;
	} else if (r2 < 0.14 * variety) {
		variant = 1;
	} else if (r2 < 0.2 * variety && field > 0.5) {
		variant = 2;
	}
	if (ground < lake.z - 0.7 && ld < lake.w * 1.3) {
		grow = 0.0; // under the lake
	}

	float dist = length(base - center.xz);
	float f = smoothstep(fade.x, fade.y, dist) * (1.0 - smoothstep(fade.z, fade.w, dist));
	float alive = step(r1, grow * density) * f;

	float h = VARIANT_HEIGHT[variant] * mix(0.75, 1.3, r3) * tall * size_scale * sqrt(f);
	float w = h * VARIANT_WIDTH[variant] * mix(0.85, 1.25, r1);
	float ang = r2 * 6.2831;
	float ca = cos(ang);
	float sa = sin(ang);
	vec3 p = vec3((local.x * ca - local.z * sa) * w, local.y * h, (local.x * sa + local.z * ca) * w);

	// Wind: big rolling waves plus gusts that drift across the island, and a per-clump flutter.
	float k = local.y;
	vec2 wd = normalize(wind_direction + vec2(1e-4));
	float t = TIME;
	float wave = sin(dot(base, wd) * 0.11 - t * 1.7 + field * 3.0) * 0.5 + 0.5;
	float gust = textureLod(wind_noise, base * 0.006 - wd * t * 0.035, 0.0).r;
	float bend = wind_strength * (0.25 + 1.1 * gust * gust) * (0.35 + 0.65 * wave);
	float flutter = (sin(t * 4.1 + r1 * 40.0 + base.x * 0.6) * 0.5 + sin(t * 6.7 + r3 * 23.0) * 0.3) * 0.06 * (0.3 + wind_strength);
	vec2 push = (wd * bend + vec2(flutter, flutter * 0.6)) * k * k * h;
	// Part around the player.
	vec2 away = base - player_position.xz;
	float pd = length(away);
	float pf = (1.0 - smoothstep(0.2, 1.3, pd)) * step(abs(player_position.y - ground), 2.2);
	push += (away / max(pd, 0.001)) * pf * 1.1 * k * h;
	float pl = length(push);
	if (pl > h * 0.9) {
		push *= h * 0.9 / pl;
		pl = h * 0.9;
	}
	p.xz += push;
	p.y -= pl * pl / max(h, 0.01) * 0.45 * k; // keep blades roughly their length as they bend

	VERTEX = alive > 0.0 ? vec3(base.x, ground - 0.12, base.y) + p : origin;
	// Soft, volume-like normals: mostly up, a little outwards from the clump's centre.
	vec3 outward = vec3(p.x, 0.0, p.z);
	NORMAL = normalize(vec3(0.0, 1.0, 0.0) + normalize(outward + vec3(1e-4)) * 0.45 * k);
	v_normal = NORMAL;
	UV = vec2((float(variant) + mix(0.003, 0.997, UV.x)) / CELLS, UV.y);
	v_k = k;
	v_sheen = clamp(bend * gust * 1.2, 0.0, 1.0);
	// Per-clump colour variation, and a touch of the ground's variation so fields aren't uniform.
	v_tint = base_tint * mix(vec3(0.88, 0.92, 0.85), vec3(1.08, 1.05, 0.92), r3) * (0.9 + (m.a - 0.5) * 0.35);
}

void fragment() {
	vec4 c = texture(atlas, UV);
	// Keep coverage in the distance: mipmaps average alpha down, so boost it per mip level.
	vec2 px = UV * atlas_size;
	float lod = 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px))));
	float a = c.a * (1.0 + max(lod, 0.0) * 0.28);
	ALPHA = a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ALPHA_ANTIALIASING_EDGE = 0.25;
	ALPHA_TEXTURE_COORDINATE = px;

	vec3 col = c.rgb * v_tint;
	// Self-shadowing toward the root of the clump.
	col *= mix(0.6, 1.0, smoothstep(0.0, 0.6, v_k));
	// Wind sheen: bent grass shows the pale undersides of its blades.
	col = mix(col, col * 1.25 + vec3(0.03, 0.035, 0.015), v_sheen * 0.55 * v_k);
	ALBEDO = col;
	NORMAL = normalize((VIEW_MATRIX * vec4(v_normal, 0.0)).xyz);
	ROUGHNESS = 0.62;
	SPECULAR = 0.3;
	BACKLIGHT = col * 0.55;
	AO = mix(0.55, 1.0, v_k);
	AO_LIGHT_AFFECT = 0.25;
}
