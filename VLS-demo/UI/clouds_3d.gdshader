shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never;

uniform vec4 sky_top : source_color = vec4(0.035, 0.05, 0.09, 1.0);
uniform vec4 sky_bottom : source_color = vec4(0.11, 0.14, 0.2, 1.0);
uniform vec4 cloud_light : source_color = vec4(0.9, 0.94, 1.0, 1.0);
uniform vec4 cloud_shadow : source_color = vec4(0.3, 0.35, 0.45, 1.0);
uniform float speed = 0.04;
uniform float coverage : hint_range(0.0, 1.0) = 0.5;
uniform float layer_bottom = 30.0;
uniform float layer_top = 95.0;
uniform vec3 sun_dir = vec3(0.45, 0.7, 0.55);
// Лимит цветов камеры: ступени на канал (16 = 4 бита, не больше 4096 цветов).
uniform int color_levels : hint_range(2, 64, 1) = 16;

varying vec3 v_world;

// Ординарный дизеринг Bayer 2x2 -> 4x4 -> 8x8 (значения в [0, 1), 64 ступени).
float bayer2(vec2 a) {
	a = floor(a);
	return fract(a.x * 0.5 + a.y * a.y * 0.75);
}

float bayer4(vec2 a) {
	return bayer2(a * 0.5) * 0.25 + bayer2(a);
}

float bayer8(vec2 a) {
	return bayer4(a * 0.5) * 0.25 + bayer2(a);
}

float hash(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Квинтическая интерполяция — убирает квадратную «сетку» у градиентов.
float noise3(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float n000 = hash(i);
	float n100 = hash(i + vec3(1.0, 0.0, 0.0));
	float n010 = hash(i + vec3(0.0, 1.0, 0.0));
	float n110 = hash(i + vec3(1.0, 1.0, 0.0));
	float n001 = hash(i + vec3(0.0, 0.0, 1.0));
	float n101 = hash(i + vec3(1.0, 0.0, 1.0));
	float n011 = hash(i + vec3(0.0, 1.0, 1.0));
	float n111 = hash(i + vec3(1.0, 1.0, 1.0));
	return mix(
		mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
		mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
		f.z);
}

// Поворот каждой октавы — оси решётки не совпадают, «точки» не складываются.
float fbm4(vec3 p) {
	float v = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 4; i++) {
		v += amp * noise3(p);
		p = mat3(vec3(0.00, 0.80, 0.60), vec3(-0.80, 0.36, -0.48), vec3(-0.60, -0.48, 0.64)) * p * 2.02
				+ vec3(11.3, 7.9, 5.1);
		amp *= 0.5;
	}
	return v * 1.0666;
}

float fbm3(vec3 p) {
	float v = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 3; i++) {
		v += amp * noise3(p);
		p = mat3(vec3(0.00, 0.80, 0.60), vec3(-0.80, 0.36, -0.48), vec3(-0.60, -0.48, 0.64)) * p * 2.02
				+ vec3(11.3, 7.9, 5.1);
		amp *= 0.5;
	}
	return v * 1.1428;
}

float remap(float v, float a, float b, float c, float d) {
	return c + (v - a) / max(b - a, 0.00001) * (d - c);
}

// soft — сглаживание порога для далёких точек (меньше пикселей у горизонта).
// det_amt: LOD ???? ??????? - ??? ???? ??????? ??? ???? ??????? ?????.
float density(vec3 p, float soft, float det_amt) {
	vec3 q = p + vec3(TIME * speed * 6.0, 0.0, TIME * speed * 2.5);
	float h = clamp((p.y - layer_bottom) / (layer_top - layer_bottom), 0.0, 1.0);
	// Пучки крупнее с высотой: частота клеток падает к вершине слоя.
	float grow = mix(1.0, 0.5, h);
	// Крупные «погодные» массивы — где облака вообще могут быть.
	float weather = fbm3(q * 0.010);
	float cov = coverage * mix(0.55, 1.3, weather);
	// Кучевый профиль: плоское основание, округлая верхушка.
	float prof = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.5, 1.0, h));
	// Основная масса облака.
	float base = fbm4(vec3(q.x * 0.042 * grow, q.y * 0.024, q.z * 0.042 * grow));
	float d = smoothstep(1.0 - cov, 1.0 - cov + 0.24 + soft, base);
	// Эрозия краёв мелочью: ядро остаётся гладким, рваность только по границе.
	float det = fbm3(q * vec3(0.13, 0.09, 0.13) + vec3(7.0));
	// Вдали эрозия ослабевает — тонкие островки не крошатся в зерно.
	d = clamp(remap(d, det * 0.38 * (1.0 - clamp(soft, 0.0, 0.8)) * det_amt, 1.0, 0.0, 1.0), 0.0, 1.0);
	return d * prof;
}

void vertex() {
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 ro = INV_VIEW_MATRIX[3].xyz;
	vec3 rd = normalize(v_world - ro);
	float sky_h = clamp(rd.y * 1.4 + 0.45, 0.0, 1.0);
	vec3 sky = mix(sky_bottom.rgb, sky_top.rgb, sky_h);

	float t0 = 0.0;
	float t1 = 0.0;
	if (abs(rd.y) < 0.0005) {
		if (ro.y > layer_bottom && ro.y < layer_top) {
			t1 = 4000.0;
		}
	} else {
		float ta = (layer_bottom - ro.y) / rd.y;
		float tb = (layer_top - ro.y) / rd.y;
		t0 = max(min(ta, tb), 0.0);
		t1 = max(ta, tb);
	}

	vec3 acc = vec3(0.0);
	float trans = 1.0;
	float far = 0.0;
	if (t1 > t0 && t0 < 1500.0) {
		far = min(t1 - t0, 1600.0);
		const int N = 40;
		float dt = far / float(N);
		// ??? ??????? ?? ????: ???? ??????? ???? ??? ???? ???????
		// ??????? (Nyquist) ? ???? ???? ??????? ????.
		float det_amt = 1.0 - smoothstep(3.0, 14.0, dt);
		// Псевдослучайное смещение старта луча: полосы сглаживания
		// превращаются в незаметный шум вместо пикселей.
		float dither = fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715))));
		vec3 sun_n = normalize(sun_dir);
		for (int i = 0; i < N; i++) {
			float t = t0 + (float(i) + dither) * dt;
			if (t >= t1) {
				break;
			}
			vec3 p = ro + rd * t;
			float soft = smoothstep(200.0, 1200.0, t) * 0.6 + smoothstep(300.0, 900.0, far) * 0.7;
			float den = density(p, soft, det_amt);
			if (den > 0.012) {
				float lt = density(p + sun_n * 9.0, soft, det_amt)
						+ density(p + sun_n * 20.0, soft, det_amt)
						+ density(p + sun_n * 36.0, soft, det_amt);
				float light = exp(-lt * 1.05);
				float hh = clamp((p.y - layer_bottom) / (layer_top - layer_bottom), 0.0, 1.0);
				light *= mix(0.85, 1.15, hh);
				vec3 col = mix(cloud_shadow.rgb, cloud_light.rgb, light);
				float a = clamp(den * dt * 0.055, 0.0, 1.0);
				acc += col * a * trans;
				trans *= 1.0 - a;
				if (trans < 0.02) {
					break;
				}
			}
		}
	}
	// Дальние и низкие над горизонтом облака растворяются в дымке — без зерна.
	float haze = max(smoothstep(350.0, 1200.0, t0 + far * 0.5), 1.0 - smoothstep(0.03, 0.10, rd.y));
	vec3 out_col = mix(sky * trans + acc, sky, haze);
	// Ограничение цветов камеры: квантование в гамма-пространстве,
	// смещение ступени — дизеринг Bayer 8x8 (полосы превращаются в точечный рисунок).
	float b = bayer8(FRAGCOORD.xy);
	float lv = float(max(color_levels, 2)) - 1.0;
	vec3 g = pow(clamp(out_col, 0.0, 1.0), vec3(1.0 / 2.2));
	g = floor(g * lv + b) / lv;
	ALBEDO = pow(clamp(g, 0.0, 1.0), vec3(2.2));
}
