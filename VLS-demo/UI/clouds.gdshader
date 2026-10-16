shader_type canvas_item;

uniform vec4 sky_top : source_color = vec4(0.043, 0.055, 0.086, 1.0);
uniform vec4 sky_bottom : source_color = vec4(0.11, 0.14, 0.2, 1.0);
uniform vec4 cloud_color : source_color = vec4(0.82, 0.87, 0.94, 1.0);
uniform float speed : hint_range(0.0, 1.0) = 0.05;
uniform float scale = 3.0;
uniform float coverage : hint_range(0.0, 1.0) = 0.52;
uniform float darkness : hint_range(0.0, 1.0) = 0.45;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Поворот октав — решётка шума не выстраивается в точки.
const mat2 ROT = mat2(vec2(0.80, 0.60), vec2(-0.60, 0.80));

// Billow: |2n-1| даёт округлые пучки вместо рваного фрактального шума.
float billow4(vec2 p) {
	float v = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 4; i++) {
		float n = noise(p);
		v += amp * (1.0 - abs(n * 2.0 - 1.0));
		p = ROT * p * 2.03 + vec2(17.3, 9.1);
		amp *= 0.5;
	}
	return v * 1.0666;
}

float billow3(vec2 p) {
	float v = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 3; i++) {
		float n = noise(p);
		v += amp * (1.0 - abs(n * 2.0 - 1.0));
		p = ROT * p * 2.03 + vec2(17.3, 9.1);
		amp *= 0.5;
	}
	return v * 1.1428;
}

vec2 warp_at(vec2 p, float t) {
	return vec2(
			billow3(p * 0.4 + vec2(3.7, 1.2 - t)) - 0.5,
			billow3(p * 0.4 + vec2(8.1, 4.6 - t * 0.8)) - 0.5);
}

// Линейная карта экрана: без перспективного сдвига по X (он резал облака
// по диагонали — «мрамор»). Рост пучков к верху — сменой слоёв.
vec2 map_uv(vec2 uv, float aspect) {
	return vec2(uv.x * aspect * scale, uv.y * scale);
}

// Слой: cl — маска, f — поле до порога (градиент света внутри пучка),
// tex — фактура куполов. cov_boost — рост плотности к верху.
float layer_mask(vec2 q, float cov_boost, float edge_w, out float f, out float tex) {
	f = billow4(q);
	float cov = coverage + cov_boost;
	float cl = smoothstep(1.0 - cov, 1.0 - cov + edge_w, f);
	float det = billow3(q * 2.6 + vec2(TIME * speed * 0.7, -TIME * speed * 1.1));
	cl = clamp(cl + (det - 0.5) * 0.45 * cl * (1.0 - cl) * 4.0, 0.0, 1.0);
	tex = billow3(q * 4.5 + vec2(-TIME * speed * 0.9, TIME * speed * 0.6));
	return cl;
}

// Вычисленное в одной точке поля: ближний слой (клетки ~240px) и дальний
// (крупный, клетки ~530px) — каждый со своим полем для освещения.
struct Layers {
	vec4 near_l;	// (cl, f, tex, -)
	vec4 far_l;		// (cl2, f2, tex2, -)
};

Layers sample_layers(vec2 uv, float aspect, float t) {
	vec2 p = map_uv(uv, aspect);
	vec2 q = p + warp_at(p, t) * 0.5;
	Layers L;
	float fn;
	float tn;
	L.near_l = vec4(layer_mask(q, 0.10 * (1.0 - uv.y), 0.15, fn, tn), fn, tn, 0.0);
	float ff;
	float tf;
	// Крупный слой: плотность заметно выше у верха — пучки «разрастаются».
	float cl2 = layer_mask(q * 0.45 + vec2(-t * 0.5, t * 0.2) + vec2(23.0),
			0.16 * (1.0 - uv.y), 0.26, ff, tf);
	L.far_l = vec4(cl2, ff, tf, 0.0);
	return L;
}

void fragment() {
	float aspect = SCREEN_PIXEL_SIZE.x / SCREEN_PIXEL_SIZE.y;
	float t = TIME * speed;

	Layers lay = sample_layers(UV, aspect, t);
	Layers up = sample_layers(UV - vec2(0.0, 0.07), aspect, t);

	// Освещение от маски и поля, снятых на 7% экрана выше:
	// rim — светлая верхняя кромка (направление не переворачивается),
	// body — градиент поля внутри пучка (верх светлее низа).
	float shade_n = clamp(
			smoothstep(-0.5, 0.5, lay.near_l.x - up.near_l.x) * 0.5
			+ smoothstep(-0.3, 0.3, lay.near_l.y - up.near_l.y) * 0.5
			+ (lay.near_l.z - 0.5) * 0.4
			+ (lay.far_l.z - 0.5) * 0.22, 0.0, 1.0);
	float shade_f = clamp(
			smoothstep(-0.5, 0.5, lay.far_l.x - up.far_l.x) * 0.35
			+ smoothstep(-0.3, 0.3, lay.far_l.y - up.far_l.y) * 0.5 + 0.15
			+ (lay.far_l.z - 0.5) * 0.3, 0.0, 1.0);

	vec3 sky = mix(sky_top.rgb, sky_bottom.rgb, clamp(UV.y, 0.0, 1.0));

	// Каждый слой — полностью непрозрачное «небо с облаками»;
	// к верху экрана кроссфейд уводит в крупный дальний слой.
	vec3 col_n = mix(sky,
			mix(cloud_color.rgb * (1.0 - darkness), cloud_color.rgb, shade_n),
			lay.near_l.x);
	vec3 col_f = mix(sky,
			mix(cloud_color.rgb * (1.0 - darkness * 1.15), cloud_color.rgb,
					clamp(0.35 + shade_f * 0.6, 0.0, 1.0)),
			lay.far_l.x);
	float w_far = smoothstep(0.55, 0.05, UV.y);
	COLOR = vec4(mix(col_n, col_f, w_far), 1.0);
}
