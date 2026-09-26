// Ocean and lake water: Gerstner swell near the camera, two scrolling detail normal maps, depth-based
// colour and refraction, sky/SSR reflections through the standard specular, and foam where the water
// is shallow (shorelines) or the swell peaks. Works in Forward+ and Compatibility.
shader_type spatial;
render_mode world_vertex_coords, cull_back, specular_schlick_ggx, depth_draw_always;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;
uniform sampler2D normal_a : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D normal_b : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D foam_noise : filter_linear_mipmap, repeat_enable;

uniform vec3 shallow_color : source_color = vec3(0.16, 0.42, 0.42);
uniform vec3 deep_color : source_color = vec3(0.02, 0.09, 0.14);
uniform float absorption = 0.18;        // per metre of water
uniform float wave_height = 1.0;        // scales the swell (lakes use less)
uniform float detail_scale = 1.0;
uniform float refraction = 0.035;
uniform float foam_amount = 1.0;
uniform float swell_fade = 240.0;       // metres from camera where the swell flattens out
uniform bool use_depth = true;          // off where the renderer has no depth texture

global uniform vec2 wind_direction;
global uniform float wind_strength;
global uniform float sky_light; // 1 at noon, ~0.05 at night (set by day_night.gd)

varying vec3 v_world;
varying float v_crest;

vec3 gerstner(vec2 dir, float steep, float wavelength, vec2 p, float t, inout vec3 tangent, inout vec3 binormal) {
	float k = 6.2831853 / wavelength;
	float c = sqrt(9.8 / k);
	vec2 d = normalize(dir);
	float f = k * (dot(d, p) - c * t);
	float a = steep / k;
	float s = sin(f);
	float co = cos(f);
	tangent += vec3(-d.x * d.x * steep * s, d.x * steep * co, -d.x * d.y * steep * s);
	binormal += vec3(-d.x * d.y * steep * s, d.y * steep * co, -d.y * d.y * steep * s);
	return vec3(d.x * a * co, a * s, d.y * a * co);
}

void vertex() {
	vec3 wp = VERTEX;
	float dist = length(wp.xz - CAMERA_POSITION_WORLD.xz);
	float amp = wave_height * (0.5 + wind_strength) * (1.0 - smoothstep(swell_fade * 0.4, swell_fade, dist));
	vec3 tangent = vec3(1.0, 0.0, 0.0);
	vec3 binormal = vec3(0.0, 0.0, 1.0);
	vec2 wd = normalize(wind_direction + vec2(1e-4));
	vec2 wp2 = vec2(-wd.y, wd.x);
	vec3 disp = vec3(0.0);
	float t = TIME;
	disp += gerstner(wd, 0.13 * amp, 58.0, wp.xz, t, tangent, binormal);
	disp += gerstner(normalize(wd + wp2 * 0.6), 0.1 * amp, 31.0, wp.xz, t, tangent, binormal);
	disp += gerstner(normalize(wd - wp2 * 0.5), 0.09 * amp, 17.0, wp.xz, t, tangent, binormal);
	disp += gerstner(normalize(wd + wp2 * 1.4), 0.07 * amp, 8.5, wp.xz, t, tangent, binormal);
	wp += disp;
	VERTEX = wp;
	v_world = wp;
	v_crest = disp.y;
	NORMAL = normalize(cross(binormal, tangent));
}

void fragment() {
	vec2 wd = normalize(wind_direction + vec2(1e-4));
	float t = TIME;
	float speed = 0.5 + wind_strength;
	vec2 uv1 = v_world.xz / (9.0 * detail_scale) + wd * t * 0.03 * speed;
	vec2 uv2 = v_world.xz / (23.0 * detail_scale) - vec2(-wd.y, wd.x) * t * 0.018 * speed;
	vec3 n1 = texture(normal_a, uv1).rgb * 2.0 - 1.0;
	vec3 n2 = texture(normal_b, uv2).rgb * 2.0 - 1.0;
	vec3 geo = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vec3 detail = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
	float dist = length(v_world - CAMERA_POSITION_WORLD);
	float detail_amt = mix(0.45, 0.12, smoothstep(30.0, 600.0, dist)) * (0.5 + wind_strength * 0.8);
	vec3 wn = normalize(geo + vec3(detail.x, 0.0, -detail.y) * detail_amt);
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);

	// Water thickness along the view ray, from the depth buffer.
	float thickness = 40.0;
	if (use_depth) {
		float depth = texture(depth_tex, SCREEN_UV).r;
		vec4 ndc = vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
		vec4 scene_view = INV_PROJECTION_MATRIX * ndc;
		scene_view.xyz /= scene_view.w;
		thickness = max(0.0, -scene_view.z + VERTEX.z);
	}
	vec2 ruv = SCREEN_UV + wn.xz * refraction * clamp(thickness * 0.3, 0.0, 1.0);
	vec3 refr = texture(screen_tex, ruv).rgb;
	float absorb = 1.0 - exp(-thickness * absorption);
	vec3 water = mix(refr * mix(vec3(1.0), shallow_color * 2.2, 0.6), deep_color * sky_light, absorb);
	// Light scattering through the swell crests.
	water += shallow_color * clamp(v_crest * 0.6, 0.0, 1.0) * 0.2 * sky_light;

	// Foam: shorelines (with a lapping band) and crests.
	float fnoise = texture(foam_noise, v_world.xz * 0.12 + wd * t * 0.05).r;
	float shore = 1.0 - smoothstep(0.0, 0.7, thickness);
	float lap = smoothstep(0.7, 1.0, sin(thickness * 4.0 - t * 1.6) * 0.5 + 0.5) * (1.0 - smoothstep(0.3, 1.8, thickness));
	float crest = smoothstep(0.9, 1.6, v_crest) * wind_strength;
	float foam = clamp((shore * 1.2 + lap * 0.5 + crest) * smoothstep(0.35, 0.75, fnoise + shore * 0.3), 0.0, 1.0) * foam_amount;

	ALBEDO = mix(vec3(0.0), vec3(0.9), foam);
	EMISSION = water * (1.0 - foam);
	ROUGHNESS = mix(0.03, 0.7, foam);
	METALLIC = 0.0;
	SPECULAR = 0.5;
	// Soft edge where the water meets the shore.
	ALPHA = clamp(thickness * 4.0, 0.0, 1.0);
}
