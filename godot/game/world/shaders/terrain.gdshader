// Island terrain: CDLOD geometry (one MultiMesh of grid patches, see terrain.gd) displaced by a float
// heightmap, textured with 7 height-blended PBR layers chosen from slope, altitude and baked masks.
// Works in Forward+ and Compatibility (Web).
shader_type spatial;
render_mode world_vertex_coords;

#include "res://game/world/shaders/terrain_common.gdshaderinc"

uniform sampler2DArray albedo_layers : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray normal_layers : filter_linear_mipmap_anisotropic, repeat_enable;

uniform vec3 lod_camera;
uniform vec3 grass_tint : source_color = vec3(0.42, 0.58, 0.26);
uniform vec3 forest_tint : source_color = vec3(0.9, 0.86, 0.8);
// Past the grass rings (grass.gd), meadows fade to the tall grass's average colour so fields carry on.
uniform vec3 far_grass_color : source_color = vec3(0.26, 0.37, 0.11);
uniform vec2 far_grass_fade = vec2(60.0, 130.0);
uniform float wetness = 0.0; // rain
uniform bool triplanar_rock = true;

// Layers: 0 grass, 1 forest floor, 2 rock, 3 sand, 4 gravel, 5 snow, 6 mud. Metres per texture repeat.
const float SCALE[7] = float[7](3.5, 4.0, 9.0, 5.0, 4.0, 6.0, 3.5);

varying vec3 v_pos;

void vertex() {
	vec3 wp = VERTEX;
	float skirt = step(wp.y, -0.5); // skirt vertices are authored at y = -1
	float g = INSTANCE_CUSTOM.x;    // grid spacing of this patch
	float d = length(wp.xz - lod_camera.xz);
	float k = clamp((d - INSTANCE_CUSTOM.y) / max(INSTANCE_CUSTOM.z - INSTANCE_CUSTOM.y, 0.001), 0.0, 1.0);
	// CDLOD morph: slide odd vertices onto the next coarser grid as the patch nears its range limit.
	wp.xz -= (fract(wp.xz / (2.0 * g) + 0.25) - 0.25) * 2.0 * g * k;
	wp.y = terrain_height(wp.xz) - skirt * g * 2.0;
	VERTEX = wp;
	v_pos = wp;
	NORMAL = normalize(textureLod(normal_map, world_uv(wp.xz), 0.0).rbg * 2.0 - 1.0);
}

vec3 unpack_normal(vec2 rg) {
	vec2 xy = rg * 2.0 - 1.0;
	return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

void fragment() {
	vec3 wp = v_pos;
	vec2 uv = world_uv(wp.xz);
	vec3 n = normalize(texture(normal_map, uv).rbg * 2.0 - 1.0);
	vec4 m = texture(mask_map, uv);
	float slope = 1.0 - n.y;
	float macro = m.a - 0.5;
	float dist = length(wp - CAMERA_POSITION_WORLD);

	// ---- layer weights (painted in order, each covering the ones before) ----
	float W[7] = float[7](1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
	float t[7];
	t[1] = smoothstep(0.12, 0.65, m.b);
	t[4] = max(smoothstep(0.14, 0.32, slope) * smoothstep(60.0, 150.0, wp.y), smoothstep(0.25, 0.8, m.g) * 0.7);
	t[6] = smoothstep(0.3, 0.8, m.r) * smoothstep(160.0, 60.0, wp.y);
	float ld = lake_distance(wp.xz);
	float shore = smoothstep(lake.z + 1.8, lake.z + 0.3, wp.y) * (1.0 - smoothstep(lake.w * 1.2, lake.w * 1.45, ld));
	t[3] = max(smoothstep(2.8, 1.0, wp.y - sea_level + macro * 3.0), shore * 0.85);
	t[2] = smoothstep(0.27, 0.42, slope + macro * 0.12);
	t[5] = smoothstep(snow_line - 12.0, snow_line + 20.0, wp.y + macro * 60.0) * (1.0 - smoothstep(0.42, 0.62, slope));
	int order[6] = int[6](1, 4, 6, 3, 2, 5);
	for (int o = 0; o < 6; o++) {
		int li = order[o];
		float tt = t[li];
		for (int j = 0; j < 7; j++) {
			W[j] *= 1.0 - tt;
		}
		W[li] += tt;
	}

	// ---- sample layers (only those present), height-blend, accumulate ----
	float far_mix = mix(0.25, 0.6, smoothstep(20.0, 260.0, dist));
	vec4 alb[7];
	vec4 nrm[7];
	float best = 0.0;
	float v[7];
	vec3 tw = pow(abs(n), vec3(4.0));
	tw /= tw.x + tw.y + tw.z;
	for (int i = 0; i < 7; i++) {
		v[i] = 0.0;
		if (W[i] < 0.004) {
			continue;
		}
		float s = SCALE[i];
		if (i == 2 && triplanar_rock) {
			// Rock: triplanar with whiteout normal blending (normals kept in world space here).
			vec2 ux = vec2(wp.z, -wp.y) / s;
			vec2 uy = wp.xz / s;
			vec2 uz = vec2(wp.x, -wp.y) / s;
			vec4 ax = texture(albedo_layers, vec3(ux, 2.0));
			vec4 ay = texture(albedo_layers, vec3(uy, 2.0));
			vec4 az = texture(albedo_layers, vec3(uz, 2.0));
			vec4 nx = texture(normal_layers, vec3(ux, 2.0));
			vec4 ny = texture(normal_layers, vec3(uy, 2.0));
			vec4 nz = texture(normal_layers, vec3(uz, 2.0));
			alb[i] = ax * tw.x + ay * tw.y + az * tw.z;
			vec3 tx = unpack_normal(nx.rg);
			vec3 ty = unpack_normal(ny.rg);
			vec3 tz = unpack_normal(nz.rg);
			vec3 wx = vec3(abs(tx.z) * n.x, tx.y + n.y, tx.x + n.z);
			vec3 wy = vec3(ty.x + n.x, abs(ty.z) * n.y, -ty.y + n.z);
			vec3 wz = vec3(tz.x + n.x, tz.y + n.y, abs(tz.z) * n.z);
			vec3 wn = normalize(wx * tw.x + wy * tw.y + wz * tw.z);
			nrm[i] = vec4(wn, 0.0);
			vec4 rest = nx * tw.x + ny * tw.y + nz * tw.z;
			nrm[i].w = rest.b; // roughness
			alb[i].rgb *= mix(1.0, rest.a, 0.6);
		} else {
			vec2 u1 = wp.xz / s;
			vec2 u2 = vec2(wp.x * 0.8 - wp.z * 0.6, wp.x * 0.6 + wp.z * 0.8) / (s * 3.7) + 0.37;
			vec4 a1 = texture(albedo_layers, vec3(u1, float(i)));
			vec4 a2 = texture(albedo_layers, vec3(u2, float(i)));
			vec4 n1 = texture(normal_layers, vec3(u1, float(i)));
			vec4 n2 = texture(normal_layers, vec3(u2, float(i)));
			alb[i] = mix(a1, a2, far_mix);
			vec4 nn = mix(n1, n2, far_mix);
			vec3 tn = unpack_normal(nn.rg);
			nrm[i] = vec4(normalize(vec3(tn.x + n.x, abs(tn.z) * n.y, -tn.y + n.z)), nn.b);
			alb[i].rgb *= mix(1.0, nn.a, 0.6);
		}
		v[i] = W[i] + alb[i].a * 0.6;
		best = max(best, v[i]);
	}
	vec3 albedo = vec3(0.0);
	vec3 wn = vec3(0.0);
	float rough = 0.0;
	float total = 0.0;
	for (int i = 0; i < 7; i++) {
		if (v[i] <= 0.0) {
			continue;
		}
		float w = max(v[i] - best + 0.22, 0.0);
		albedo += alb[i].rgb * w;
		wn += nrm[i].xyz * w;
		rough += nrm[i].w * w;
		total += w;
	}
	albedo /= total;
	rough /= total;
	wn = normalize(wn);

	// Tints and large-scale variation so distant terrain doesn't read as one flat colour.
	albedo *= mix(vec3(1.0), grass_tint, clamp(W[0], 0.0, 1.0));
	albedo *= mix(vec3(1.0), forest_tint, clamp(W[1], 0.0, 1.0));
	albedo *= 1.0 + macro * 0.35;
	// Same growth rule as grass.gdshader, so the far colour appears exactly where grass would be.
	float grow = (1.0 - smoothstep(0.2, 0.32, slope)) * smoothstep(2.2, 4.0, wp.y - sea_level)
			* (1.0 - smoothstep(snow_line - 70.0, snow_line - 25.0, wp.y))
			* (1.0 - smoothstep(0.35, 0.85, m.b) * 0.8) * (1.0 - smoothstep(0.3, 0.75, m.g) * 0.7);
	float far_grass = grow * smoothstep(far_grass_fade.x, far_grass_fade.y, dist);
	albedo = mix(albedo, far_grass_color * (1.0 + macro * 0.9) * mix(0.8, 1.1, alb[0].a), far_grass * 0.85);
	// Wet shores and rain darken and polish the ground.
	float wet = max(smoothstep(1.4, 0.1, wp.y - sea_level), smoothstep(lake.z + 0.9, lake.z + 0.1, wp.y) * step(ld, lake.w * 1.5));
	wet = max(wet, wetness * (1.0 - W[5]));
	albedo *= mix(1.0, 0.62, wet);
	rough = mix(rough, 0.18, wet * 0.85);

	ALBEDO = albedo;
	ROUGHNESS = clamp(rough, 0.05, 1.0);
	SPECULAR = 0.4;
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
}
