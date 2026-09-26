// Shell fur for the wolf: the skinned body is drawn once as skin (shell = 0) and several more times,
// each shell pushed out along the normal and cut down to fewer, thinner strands. Darker saddle on the
// back, pale belly and chest, lighter tips, soft rim light.
shader_type spatial;
render_mode cull_back;

uniform float shell = 0.0; // 0 = skin, (0, 1] = shell height
uniform float fur_length = 0.05;
uniform float density = 38.0;
uniform sampler2D strands : filter_linear_mipmap, repeat_enable;
uniform vec3 back_color : source_color = vec3(0.2, 0.18, 0.16);
uniform vec3 side_color : source_color = vec3(0.42, 0.38, 0.33);
uniform vec3 belly_color : source_color = vec3(0.72, 0.68, 0.6);
uniform float hurt = 0.0; // red flash when hit

varying float v_up;

void vertex() {
	v_up = NORMAL.y;
	VERTEX += NORMAL * fur_length * shell;
	VERTEX.y -= fur_length * shell * shell * 0.35; // fur droops a little
}

void fragment() {
	float n = texture(strands, UV * density).r;
	float n2 = texture(strands, UV * density * 0.23 + 0.5).r;
	if (shell > 0.0) {
		// Strands thin out toward their tips; clumping from a coarser noise.
		if (n * (0.75 + n2 * 0.5) < shell * 0.85 + 0.12) {
			discard;
		}
	}
	vec3 col = mix(belly_color, side_color, smoothstep(-0.55, -0.05, v_up));
	col = mix(col, back_color, smoothstep(0.25, 0.8, v_up));
	col *= 0.78 + n2 * 0.35;
	col *= mix(0.45, 1.15, shell); // dark roots, lighter tips
	ALBEDO = mix(col, vec3(0.6, 0.05, 0.03), hurt * 0.6);
	ROUGHNESS = 0.92;
	SPECULAR = 0.25;
	RIM = 0.45;
	RIM_TINT = 0.6;
	BACKLIGHT = col * 0.25;
}
