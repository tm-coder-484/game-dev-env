// Dynamic sky: single-scattering atmosphere (Rayleigh + Mie, half resolution), a drifting cloud layer
// lit by the sun or moon, a moon disk, and stars at night. Driven by day_night.gd through the uniforms
// below (the directional lights use "light only" sky mode, so twilight works with the sun light off).
shader_type sky;
render_mode use_half_res_pass;

uniform sampler2D cloud_noise : filter_linear_mipmap, repeat_enable;
uniform float cloud_coverage : hint_range(0.0, 1.0) = 0.45;
uniform float cloud_darkness : hint_range(0.0, 1.0) = 0.0; // storms
uniform vec2 cloud_offset = vec2(0.0);                     // advanced by day_night.gd with the wind
uniform float night = 0.0;                                 // 0 day .. 1 full night
uniform float star_rotation = 0.0;
uniform vec3 sun_direction = vec3(0.0, 0.7, -0.7);  // toward the sun
uniform vec3 moon_direction = vec3(0.0, 0.5, -0.8); // toward the moon
uniform float exposure = 1.0;
uniform bool use_subpasses = true; // false on the Compatibility renderer (Web), which has no half-res pass

const float PLANET_R = 6371e3;
const float ATMO_R = 6471e3;
const vec3 RAYLEIGH = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float MIE = 21e-6;
const float RAYLEIGH_H = 8e3;
const float MIE_H = 1.2e3;
const float MIE_G = 0.76;

vec2 ray_sphere(vec3 o, vec3 d, float r) {
	float b = dot(o, d);
	float c = dot(o, o) - r * r;
	float disc = b * b - c;
	if (disc < 0.0) {
		return vec2(1e9, -1e9);
	}
	float s = sqrt(disc);
	return vec2(-b - s, -b + s);
}

// Light scattered toward the eye along `dir` for a light from `l` (unit intensity).
vec3 atmosphere(vec3 dir, vec3 l) {
	vec3 o = vec3(0.0, PLANET_R + 2.0, 0.0);
	vec2 hit = ray_sphere(o, dir, ATMO_R);
	float len = hit.y;
	vec2 ground = ray_sphere(o, dir, PLANET_R);
	if (ground.x > 0.0) {
		len = ground.x;
	}
	const int STEPS = 12;
	const int LSTEPS = 4;
	float ds = len / float(STEPS);
	vec3 sum_r = vec3(0.0);
	vec3 sum_m = vec3(0.0);
	float od_r = 0.0;
	float od_m = 0.0;
	for (int i = 0; i < STEPS; i++) {
		vec3 p = o + dir * (ds * (float(i) + 0.5));
		float h = length(p) - PLANET_R;
		float hr = exp(-h / RAYLEIGH_H) * ds;
		float hm = exp(-h / MIE_H) * ds;
		od_r += hr;
		od_m += hm;
		float ll = ray_sphere(p, l, ATMO_R).y;
		float lds = ll / float(LSTEPS);
		float lr = 0.0;
		float lm = 0.0;
		for (int j = 0; j < LSTEPS; j++) {
			vec3 q = p + l * (lds * (float(j) + 0.5));
			float qh = max(length(q) - PLANET_R, 0.0);
			lr += exp(-qh / RAYLEIGH_H) * lds;
			lm += exp(-qh / MIE_H) * lds;
		}
		vec3 att = exp(-(RAYLEIGH * (od_r + lr) + MIE * 1.1 * (od_m + lm)));
		sum_r += att * hr;
		sum_m += att * hm;
	}
	float mu = dot(dir, l);
	float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
	float g2 = MIE_G * MIE_G;
	float pm = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));
	return 22.0 * (sum_r * RAYLEIGH * pr + sum_m * MIE * pm);
}

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

vec3 stars(vec3 dir) {
	float c = cos(star_rotation);
	float s = sin(star_rotation);
	dir = vec3(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
	vec3 col = vec3(0.0);
	for (int layer = 0; layer < 2; layer++) {
		float res = layer == 0 ? 180.0 : 420.0;
		vec3 p = dir * res;
		vec3 cell = floor(p);
		float h = hash13(cell + float(layer) * 71.0);
		if (h > 0.985 - float(layer) * 0.01) {
			vec3 center = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1)) - 0.5) * 0.7;
			float d = length(p - center);
			float b = smoothstep(0.45, 0.0, d) * (h - 0.97) * 60.0;
			vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 9.0));
			col += tint * b * (layer == 0 ? 1.0 : 0.5);
		}
	}
	// Milky way: a faint noisy band across the sky.
	float band = exp(-pow(dot(dir, normalize(vec3(0.3, 0.2, 1.0))) * 3.2, 2.0));
	float n = texture(cloud_noise, dir.xz * 1.5 + dir.y).r;
	col += vec3(0.55, 0.6, 0.8) * band * n * n * 0.18;
	return col;
}

// Returns rgb = cloud colour, a = opacity.
vec4 clouds(vec3 dir, vec3 sun_dir, vec3 sun_col, vec3 sky_col) {
	if (dir.y < 0.01) {
		return vec4(0.0);
	}
	vec2 uv = dir.xz / (dir.y + 0.12) * 0.55 + cloud_offset;
	float n = texture(cloud_noise, uv * 0.35).r * 0.6 + texture(cloud_noise, uv * 0.9 + 3.1).r * 0.28
			+ texture(cloud_noise, uv * 2.3 - 1.7).r * 0.12;
	float cov = mix(0.72, 0.28, cloud_coverage);
	float density = smoothstep(cov, cov + 0.28, n);
	// Fake self shadowing: sample toward the sun.
	vec2 su = normalize(sun_dir.xz + vec2(1e-4)) * 0.06;
	float ns = texture(cloud_noise, (uv + su) * 0.35).r * 0.6 + texture(cloud_noise, (uv + su) * 0.9 + 3.1).r * 0.28
			+ texture(cloud_noise, (uv + su) * 2.3 - 1.7).r * 0.12;
	float shadow = smoothstep(cov, cov + 0.4, ns);
	float lit = mix(1.0, 0.35, shadow) * mix(1.0, 0.35, cloud_darkness);
	float mu = max(dot(dir, sun_dir), 0.0);
	float silver = pow(mu, 12.0) * (1.0 - density) * 3.0;
	vec3 col = sun_col * (lit + silver) + sky_col * 0.6;
	float fade = smoothstep(0.01, 0.2, dir.y);
	return vec4(col, density * fade);
}

// Atmosphere + clouds for one direction: rgb = colour, a = cloud cover (hides stars and moon).
vec4 base_sky(vec3 dir, vec3 sun_dir) {
	// Sample a touch above the horizon: exactly horizontal rays pass through so much air they turn dark.
	vec3 up_dir = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.97 + 0.03, dir.z));
	vec3 sky_sun = atmosphere(up_dir, sun_dir);
	vec3 sky_moon = atmosphere(up_dir, moon_direction) * 0.012 * vec3(0.75, 0.85, 1.1);
	vec3 col = sky_sun + sky_moon + vec3(0.004, 0.006, 0.012) * night;
	// Below the horizon: fade to a dim, sea-coloured haze.
	col = mix(col, col * vec3(0.7, 0.76, 0.82), smoothstep(0.0, -0.3, dir.y));
	// Clouds lit by whichever light is up.
	float sun_up = smoothstep(-0.12, 0.08, sun_dir.y);
	vec3 horizon_tint = atmosphere(normalize(vec3(sun_dir.x, 0.05, sun_dir.z)), sun_dir);
	vec3 light_col = mix(vec3(0.03, 0.04, 0.07), normalize(horizon_tint + 1e-4) * 1.7 * sun_up + 0.4 * sun_up, sun_up);
	vec3 light_dir = sun_up > 0.01 ? sun_dir : moon_direction;
	vec4 cl = clouds(dir, light_dir, light_col, col);
	col = mix(col, cl.rgb * (0.35 + 0.65 * sun_up) * (1.0 - cloud_darkness * 0.5), cl.a);
	return vec4(col, cl.a);
}

void sky() {
	vec3 dir = EYEDIR;
	vec3 sun_dir = normalize(sun_direction);
	if (AT_CUBEMAP_PASS) {
		COLOR = base_sky(dir, sun_dir).rgb * exposure;
	} else if (AT_HALF_RES_PASS) {
		vec4 b = base_sky(dir, sun_dir);
		COLOR = b.rgb;
		ALPHA = b.a;
	} else {
		vec4 b = use_subpasses ? HALF_RES_COLOR : base_sky(dir, sun_dir);
		vec3 col = b.rgb;
		float cloud = b.a;
		// Sun disk (full res for a crisp edge).
		float sd = dot(dir, sun_dir);
		if (dir.y > -0.02) {
			float disk = smoothstep(0.99985, 0.99992, sd);
			vec3 trans = exp(-(RAYLEIGH * 8e3 + MIE * 1.2e3) / max(sun_dir.y + 0.03, 0.03) * 1.5);
			col += disk * trans * 400.0 * (1.0 - cloud);
		}
		// Moon.
		float md = dot(dir, moon_direction);
		if (md > 0.9995) {
			float r = sqrt(max(0.0, 1.0 - (1.0 - md) / (1.0 - 0.9995)));
			float phase = 0.55 + 0.45 * dot(normalize(dir - moon_direction), normalize(sun_dir - moon_direction * dot(sun_dir, moon_direction)));
			float crater = texture(cloud_noise, dir.xy * 90.0).r;
			col += vec3(0.9, 0.93, 1.0) * r * clamp(phase, 0.1, 1.0) * mix(0.75, 1.0, crater) * 3.0 * (1.0 - cloud) * night;
		}
		col += vec3(0.6, 0.7, 1.0) * pow(max(md, 0.0), 800.0) * 0.4 * night * (1.0 - cloud);
		// Stars.
		if (night > 0.0 && dir.y > 0.0) {
			col += stars(dir) * night * (1.0 - cloud) * smoothstep(0.0, 0.15, dir.y);
		}
		COLOR = col * exposure;
	}
}
