class_name VLSMapBuilder
extends RefCounted

## Строит узлы уровня Godot из разобранных VLS-данных.
## Масштаб 1:1 с редактором (обе системы Y вниз), флип не нужен.
##
## Стены: каждая линия, кроме порталов (flags == "2"), получает StaticBody2D
## с SegmentShape2D — игрок на CharacterBody2D ходит/прыгает по ним сразу.
## Порталы — только тонкая визуализация без коллизии.
## Сектора — Polygon2D-подложка. Существо-игрок (A000 / legacy) — инстанс сцены игрока.

const COLOR_WALL := Color(0.62, 0.65, 0.72)
const COLOR_FREE := Color(0.85, 0.70, 0.30)
const COLOR_STEP := Color(0.30, 0.85, 0.75)
const COLOR_PORTAL := Color(0.45, 0.85, 0.55, 0.35)
const COLOR_SECTOR_FILL := Color(0.55, 0.60, 0.75, 0.10)
const COLOR_FINISH_FILL := Color(0.35, 0.80, 0.45, 0.28)
const COLOR_DOOR_FILL := Color(0.85, 0.45, 0.15, 0.45)
const WALL_WIDTH := 4.0
const CALLER_HALF := 13.0
# Обводка секторов: чёрная почти полупрозрачная линия (r0 g0 b0 a70), 2 пикселя карты.
# Вместо прежних многопиксельных линий под секторами: сплошные границы обводятся,
# проходимые линии (portals/free, пары [connects]) остаются «чистыми».
const OUTLINE_COLOR := Color(0.0, 0.0, 0.0, 70.0 / 255.0)
# Ширина обводки — в ПИКСЕЛЯХ КАРТЫ: один пиксель карты = tex_px мировых
# юнитов (столько же, сколько у запечённых текстур секторов), поэтому
# обводка ровно 2 «картовых» пикселя, а не 2 экранных.
const OUTLINE_WIDTH_MAP_PX := 2.0
# Прочность ящиков: база + пол-единицы за пиксель габарита, потолок — почти кап скорости.
const BREAK_BASE := 430.0
const BREAK_PER_PX := 0.5
const BREAK_MAX := 580.0

# --- текстуры из редактора (секция [textures] файла .vls) --------------------
# Сектор, в котором разложены спрайты, получает подложку из запечённой картинки:
# клип по полигону делает сам Polygon2D — ровно так, как канва в редакторе, —
# а его граница рисуется тонкой чёрной полупрозрачной линией, потому что цветная
# стена только мешает разглядеть край картинки. Сектор без текстур — как раньше.
const TEX_ATLAS_PATH := "res://Data/SectorData/t-map.png"
const TEX_EDGE_WIDTH := 2.0
const TEX_EDGE_COLOR := Color(0.0, 0.0, 0.0, 0.5)
# потолок запечённой картинки сектора, пикселей по стороне
const TEX_BAKE_LIMIT := 4096
# true — uv в пикселях текстуры (запекание 1:1), false — uv нормализован в [0,1].
# Проверяется скриншот-тестом tests/tex_visual.gd.
const TEX_UV_PIXEL_SPACE := true


static func ensure_use_action() -> void:
	# Кнопка взаимодействия с вызывалками (E). Создаём в рантайме,
	# чтобы не править project.godot руками (потом можно перенести в настройки).
	if not InputMap.has_action("vls_use"):
		InputMap.add_action("vls_use")
	for e in InputMap.action_get_events("vls_use"):
		if e is InputEventKey and e.physical_keycode == KEY_E:
			return
	var ev := InputEventKey.new()
	ev.physical_keycode = KEY_E
	InputMap.action_add_event("vls_use", ev)


static func is_player_thing(t: Dictionary) -> bool:
	var id := str(t.get("id", "")).strip_edges().to_upper()
	if id == "A000":
		return true
	if id == "1":
		return true
	# legacy: type/name вида 1, 01, player, player01...
	for k in ["type", "name"]:
		var v := str(t.get(k, "")).strip_edges().to_lower().replace(" ", "")
		while v.length() > 1 and v.begins_with("0") and v.substr(1, 1).is_valid_int():
			v = v.substr(1)
		if v == "1" or v == "player" or v == "player1" or v == "player01" or v == "игрок" or v == "igrok":
			return true
	return false


static func build(parent: Node2D, data: Dictionary, player_scene: PackedScene) -> Dictionary:
	var res := {
		"walls": 0, "portals": 0, "free_lines": 0, "sectors": 0,
		"outlines": 0,
		"player": null, "spawn_pos": Vector2.ZERO, "has_player": false,
		# сколько не-игроков по буквам категорий (A/B/C/...) — для отладки баланса карты
		"other_things": {},
		# сырые данные для будущих систем (лифты, триггеры, связи)
		"lifts": data.get("lifts", []),
		"triggers": data.get("triggers", []),
		"connects": data.get("connects", []),
		"lifts_built": 0, "callers": 0,
		# Твердь для выталкивателя: [{poly, body}] — камень (тело null, вечный),
		# ящики (тело VLSDestructible; снесли — запись мёртвая и пропускается).
		"solid_sectors": [],
		# Ключи (существа B+цифры): [{idx, pos, node}] — подбираются, живут до конца уровня.
		"keys": [],
		# Финиш-зоны (секторы с модификатором finish): [{id, poly}].
		"finish_sectors": [],
		# Сколько секторов получили запечённые текстуры и сколько мировых прямоугольников.
		"tex_sectors": 0,
		"tex_world": 0,
	}
	var verts: Dictionary = data.get("vertices", {})
	# Топология лифтов: их сектора и рёбра НЕ строим статикой —
	# вся комната целиком едет на платформе (иначе сектор остаётся, а едет голограмма).
	var topo := _lift_topology(data)
	var lift_sec: Dictionary = topo[0]
	var lift_edge: Dictionary = topo[1]
	# Линии хрупких секторов живут групповым телом VLSDestructible, а не статикой.
	var fragile_edge := _fragile_edges(data)
	# Линии закрытых дверей — телом VLSDoor (барьер + сила), статика их не строит.
	var door_edge := _door_edges(data)
	# Текстуры из редактора: без атласа рисовать нечего — и границы оставляем обычными.
	var tex_px := _tex_px(data)
	var atlas := _load_atlas(data)
	var tex_edge := {} if atlas == null else _textured_edges(data)
	# Запекаем подложки всех секторов сразу: обычные лягут в свой корень,
	# хрупкие/двери/лифты заберут свои — они исчезают или едут, им нельзя статику.
	var baked := {} if atlas == null else _bake_all(data, atlas, tex_px)

	# Мировые прямоугольники (фон) — самый низ, сектора их перекрывают.
	# Служебное для обводок: полный набор рёбер секторов (под ними прежние
	# линии стен не рисуем).
	var sec_edges := _all_sector_edges(data)
	if atlas != null:
		res["tex_world"] = _build_world_textures(parent, data, atlas, tex_px)

	var sec_root := Node2D.new()
	sec_root.name = "Sectors"
	parent.add_child(sec_root)
	for s in data.get("sectors", []):
		if lift_sec.has(int(s.get("id", -1))):
			continue
		if bool(s.get("fragile", false)):
			continue
		if str(s.get("close", "")) != "":  # дверь живёт на своём теле VLSDoor
			continue
		var off: Vector2 = s.get("offset", Vector2.ZERO)
		var pts := PackedVector2Array()
		for vid in s.get("verts", []):
			if verts.has(vid):
				pts.append(verts[vid] + off)
		if pts.size() >= 3:
			var pg := Polygon2D.new()
			pg.color = COLOR_FINISH_FILL if bool(s.get("finish", false)) else COLOR_SECTOR_FILL
			pg.polygon = pts
			sec_root.add_child(pg)
			res["sectors"] = int(res["sectors"]) + 1
			if bool(s.get("stone", false)):
				res["solid_sectors"].append({"id": int(s.get("id", -1)), "poly": pts, "body": null})

	# Подложки со спрайтами — поверх заливок секторов, под стенами.
	# Хрупкие/двери/лифты получают свои внутри _build_* (они исчезают или едут).
	if not baked.is_empty():
		res["tex_sectors"] = baked.size()
		_add_sector_textures(parent, data, baked, lift_sec, tex_px)

	var wall_root := Node2D.new()
	wall_root.name = "Walls"
	parent.add_child(wall_root)
	for ln in data.get("lines", []):
		if not verts.has(ln.get("a", -1)) or not verts.has(ln.get("b", -1)):
			continue
		# рёбра секторов-лифтов живут на платформе, хрупких — групповым телом,
		# дверей — телом VLSDoor (барьер с силой), статика их не дублирует
		var ekey := _edge_key(int(ln.get("a", 0)), int(ln.get("b", 0)))
		if lift_edge.has(ekey) or fragile_edge.has(ekey) or door_edge.has(ekey):
			continue
		var a: Vector2 = verts[ln["a"]]
		var b: Vector2 = verts[ln["b"]]
		# Под секторами многопиксельные линии стен не рисуем — там работает
		# система обводок (см. _outline_polylines): связанные рёбра остаются
		# чистыми, остальные получают обводку 2 пикселя карты. Вне секторов — как раньше.
		if not sec_edges.has(ekey):
			var vis := Line2D.new()
			vis.points = PackedVector2Array([a, b])
			var wstyle := _wall_style(ln, tex_edge)
			vis.width = wstyle[0]
			vis.default_color = wstyle[1]
			wall_root.add_child(vis)
		# без коллизии: порталы (проходимые) и свободные линии (модификатор free)
		if str(ln.get("flags", "0")) == "2":
			res["portals"] = int(res["portals"]) + 1
			continue
		if not _line_solid(ln):
			res["free_lines"] = int(res["free_lines"]) + 1
			continue
		var body := StaticBody2D.new()
		var cs := CollisionShape2D.new()
		var seg := SegmentShape2D.new()
		seg.a = a
		seg.b = b
		cs.shape = seg
		body.add_child(cs)
		wall_root.add_child(body)
		res["walls"] = int(res["walls"]) + 1

	# Обводки статичных секторов (2 пикселя карты, чёрный a=70): каждое ребро
	# ровно один раз — внешние и общие границы (этажи/полы читаются даже без
	# текстур), включая шахты лифтов: след платформы остаётся на месте.
	# Проходимые линии (portals/free, пары [connects]) — соединения секторов,
	# без обводки. Совпадающие куски не дублируются.
	# Хрупкие/двери — динамические тела: обводят себя и исчезают при
	# разрушении (под ней обводка пола уже на месте).
	var outline_root := Node2D.new()
	outline_root.name = "SectorOutlines"
	parent.add_child(outline_root)
	var skip_lines: Dictionary = _connected_lines(data)
	for ln in data.get("lines", []):
		if not _line_solid(ln):
			skip_lines[int(ln.get("id", -1))] = true
	var static_out: Dictionary = _static_outline_polylines(data, verts,
			skip_lines, _line_ids_by_edge(data), lift_sec)
	for poly in static_out.get("polylines", []):
		var ol := Line2D.new()
		ol.points = poly
		ol.width = _outline_width(data)
		ol.default_color = OUTLINE_COLOR
		outline_root.add_child(ol)
		res["outlines"] = int(res["outlines"]) + 1

	_build_fragile(parent, data, verts, tex_edge, baked, tex_px, res,
			static_out.get("seg_keys", {}), static_out.get("points", []))

	var th_root := Node2D.new()
	th_root.name = "Things"
	# Существа/игрок — ВСЕГДА поверх карты (линии, текстуры, лифты, двери).
	th_root.z_index = 10
	parent.add_child(th_root)
	# Редакторные маркеры (ромбик + подпись, вроде «Character» у A001) в игру
	# не спавнятся — это визуал редактора. Вызывалки/ключи строятся сами.
	var bound_ids := {}
	for L in data.get("lifts", []):
		if str(L.get("zero_id", "")) != "":
			bound_ids[str(L["zero_id"])] = true
		for fl in L.get("floors", []):
			if str(fl.get("caller_id", "")) != "":
				bound_ids[str(fl["caller_id"])] = true
	# Степперы кабин строятся сами (по одному на кабину).
	var things_by_id := {}
	for t in data.get("things", []):
		things_by_id[str(t.get("id", ""))] = t
		if is_player_thing(t):
			res["has_player"] = true
			res["spawn_pos"] = Vector2(float(t.get("x", 0.0)), float(t.get("y", 0.0)))
			if player_scene != null and res["player"] == null:
				var p := player_scene.instantiate() as Node2D
				if p == null:
					VLSLog.error("[VLS] player_scene is not a Node2D: " + str(player_scene))
					continue
				p.position = res["spawn_pos"]
				p.name = "Player"
				p.add_to_group("player")
				th_root.add_child(p)
				res["player"] = p
		else:
			var code := str(t.get("id", "?"))
			var letter := code.left(1).to_upper() if code.length() > 0 else "?"
			res["other_things"][letter] = int(res["other_things"].get(letter, 0)) + 1
			if not bound_ids.has(code):
				var kidx := _key_index(code)
				if kidx >= 0:
					var k := _spawn_key(th_root, t, kidx)
					res["keys"].append({
						"idx": kidx,
						"pos": Vector2(float(t.get("x", 0.0)), float(t.get("y", 0.0))),
						"node": k,
					})

	_build_doors(parent, data, verts, tex_edge, baked, tex_px, res)

	# Финиш-зоны: полигоны секторов с модификатором finish (детект входа — map_data).
	for s in data.get("sectors", []):
		if not bool(s.get("finish", false)):
			continue
		var poly := _sector_poly(data, int(s.get("id", -1)))
		if poly.size() >= 3:
			res["finish_sectors"].append({"id": int(s.get("id", -1)), "poly": poly})

	_build_lifts(parent, data, things_by_id, bound_ids, tex_edge, baked, tex_px, res)
	# Точки геометрии для детекта пустоты (вершины + середины рёбер).
	var vp := PackedVector2Array()
	for vid in verts:
		vp.append(verts[vid])
	for ln in data.get("lines", []):
		if verts.has(ln.get("a", -1)) and verts.has(ln.get("b", -1)):
			vp.append((verts[ln["a"]] + verts[ln["b"]]) * 0.5)
	res["void_points"] = vp

	# Каркас карты как в редакторе (точки/линии/соединения) — слой скрыт;
	# консольная команда editor 1/0 прячет текстуры/обводки карты и показывает
	# этот каркас, editor 0 возвращает всё на место.
	var ed := EditorView.new()
	ed.name = "EditorView"
	ed.setup(data)
	ed.add_to_group("vls_editor_view")
	parent.add_child(ed)
	res["editor_view"] = ed
	return res


## Мировой полигон сектора по данным (вершины + offset). Пустой — нет такого сектора.
static func _sector_poly(data: Dictionary, sector_id: int) -> PackedVector2Array:
	var verts: Dictionary = data.get("vertices", {})
	for s in data.get("sectors", []):
		if int(s.get("id", -1)) != sector_id:
			continue
		var off: Vector2 = s.get("offset", Vector2.ZERO)
		var poly := PackedVector2Array()
		for vid in s.get("verts", []):
			if verts.has(vid):
				poly.append(verts[vid] + off)
		return poly
	return PackedVector2Array()


static func _edge_key(a: int, b: int) -> String:
	return str(mini(a, b)) + "_" + str(maxi(a, b))

## Линии из [connects] — соединены с линией другого сектора (обводки нет).
static func _connected_lines(data: Dictionary) -> Dictionary:
	var out := {}
	for c in data.get("connects", []):
		out[int(c.get("line", -1))] = true
		out[int(c.get("line2", -1))] = true
	return out

## edge_key -> id линии: граница сектора ищется по тем же вершинам.
static func _line_ids_by_edge(data: Dictionary) -> Dictionary:
	var out := {}
	for ln in data.get("lines", []):
		out[_edge_key(int(ln.get("a", -1)), int(ln.get("b", -1)))] = int(ln.get("id", -1))
	return out

## «Ломающаяся коробка»/«камень»/«дверь»: обводка всегда — такие сектора
## чисто технически нельзя соединить с другими.
static func _always_outline(s: Dictionary) -> bool:
	return bool(s.get("fragile", false)) or bool(s.get("stone", false)) \
			or str(s.get("close", "")) != ""

## Нужна ли обводка на ребре (a, b) сектора s: всегда — для модификаторных
## секторов, шахт лифтов (lift_sec) и рёбер без линии; иначе — если линия
## сплошная (проходимые portals/free и пары [connects] — соединения секторов).
static func _edge_outline(s: Dictionary, a: int, b: int, skip: Dictionary, line_ids: Dictionary, lift_sec: Dictionary = {}) -> bool:
	if _always_outline(s) or lift_sec.has(int(s.get("id", -1))):
		return true
	var lid := int(line_ids.get(_edge_key(a, b), -1))
	if lid < 0:
		return true
	return not skip.has(lid)

## Все рёбра всех секторов {edge_key}: под ними линии стен не рисуются.
static func _all_sector_edges(data: Dictionary) -> Dictionary:
	var out := {}
	for s in data.get("sectors", []):
		var vv: Array = s.get("verts", [])
		for i in range(vv.size()):
			out[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = true
	return out

## Рёбра, снятые с обводки по просьбе сектора (поле outline = "0"):
## {edge_key: true}. Снимаем ВСЕ рёбра сектора, включая общие с соседом —
## иначе сосед всё равно обведёт контур «невидимого» сектора.
static func _no_outline_edges(data: Dictionary) -> Dictionary:
	var out := {}
	for s in data.get("sectors", []):
		if bool(s.get("outline", true)):
			continue
		var vv: Array = s.get("verts", [])
		for i in range(vv.size()):
			out[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = true
	return out


## Индекс точки в общем реестре (ключ — округлённые координаты).
static func _pt_index(p: Vector2, pidx: Dictionary, pcoords: Array) -> int:
	var k := str(snappedf(p.x, 0.01)) + "," + str(snappedf(p.y, 0.01))
	if pidx.has(k):
		return int(pidx[k])
	var i := pcoords.size()
	pcoords.append(p)
	pidx[k] = i
	return i


static func _first_unused(arr: Array, used: Dictionary) -> String:
	for k in arr:
		if not used.has(k):
			return k
	return ""


static func _unused_deg(arr: Array, used: Dictionary) -> int:
	var n := 0
	for k in arr:
		if not used.has(k):
			n += 1
	return n


## Ключ точки (округлённые координаты) — тот же формат, что у тестов.
static func _pk(p: Vector2) -> String:
	return str(snappedf(p.x, 0.01)) + "," + str(snappedf(p.y, 0.01))


## Есть ли отрезок (мировые координаты) в наборе статичных рёбер seg_keys.
static func _seg_in_static(static_segs: Dictionary, a: Vector2, b: Vector2) -> bool:
	var k0 := _pk(a)
	var k1 := _pk(b)
	var lo := k0 if k0 <= k1 else k1
	var hi := k1 if k0 <= k1 else k0
	return static_segs.has(lo + "|" + hi)


## Расстояние точки до прямой AB.
static func _dist_line(a: Vector2, b: Vector2, p: Vector2) -> float:
	var d := b - a
	var l := d.length()
	if l < 0.0001:
		return a.distance_to(p)
	return absf((p - a).x * d.y - (p - a).y * d.x) / l


## Ключ отрезка в мировых координатах (порядок концов не важен).
static func _sk(a: Vector2, b: Vector2) -> String:
	var k0 := _pk(a)
	var k1 := _pk(b)
	return (k0 + "|" + k1) if k0 <= k1 else (k1 + "|" + k0)


## Атомы (нарезанные куски) лежащие на отрезке pa-pb, в порядке от pa к pb.
static func _atoms_on_segment(atoms: Dictionary, pa: Vector2, pb: Vector2) -> Array:
	var d := pb - pa
	var l2 := d.length_squared()
	if l2 < 0.000001:
		return []
	var cand := []
	for k in atoms:
		var pr: Array = atoms[k]
		var t0: float = (pr[0] - pa).dot(d) / l2
		var t1: float = (pr[1] - pa).dot(d) / l2
		var lo: float = minf(t0, t1)
		var hi: float = maxf(t0, t1)
		if hi < -0.001 or lo > 1.001:
			continue
		if _dist_line(pa, pb, pr[0]) > 0.05 or _dist_line(pa, pb, pr[1]) > 0.05:
			continue
		cand.append([maxf(lo, 0.0), pr])
	cand.sort_custom(func(x, y): return x[0] < y[0])
	var out := []
	for c in cand:
		out.append(c[1])
	return out


## Режет отрезки по точкам, лежащим строго внутри (допуск 0.01): частичные
## перекрытия двух секторов становятся одинаковыми атомарными кусками,
## и дедуп по ключу их находит.
static func _split_segments(segs: Array, points: Array) -> Dictionary:
	var out := {}
	for sg in segs:
		var a: Vector2 = sg[0]
		var b: Vector2 = sg[1]
		var dx := b.x - a.x
		var dy := b.y - a.y
		var l2 := dx * dx + dy * dy
		if l2 < 0.000001:
			continue
		var cuts := [0.0, 1.0]
		for p in points:
			var t: float = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
			if t <= 0.0 or t >= 1.0:
				continue
			if _dist_line(a, b, p) < 0.01:
				cuts.append(t)
		cuts.sort()
		for i in range(cuts.size() - 1):
			var p0: Vector2 = a.lerp(b, cuts[i])
			var p1: Vector2 = a.lerp(b, cuts[i + 1])
			var k0 := _pk(p0)
			var k1 := _pk(p1)
			if k0 == k1:
				continue
			var k := k0 + "|" + k1
			var kq := k1 + "|" + k0
			out[k if k <= kq else kq] = [p0, p1]
	return out


## Обводка статичных секторов (включая шахты лифтов — «след» платформы
## остаётся на месте): каждое атомарное ребро (после нарезки по общим точкам)
## рисуется ровно один раз — внешние и общие границы секторов (этажи видны).
## Проходимые линии (portals/free, пары [connects]) пропускаются — это
## соединения секторов; «камень» и шахты лифтов обводятся всегда
## (см. _edge_outline); рёбра секторов с полем outline = "0" снимаются
## по запросу (см. _no_outline_edges). Хрупкие/двери — динамические тела,
## их рёбра не собираются здесь (рисуют себя сами).
## Возвращает {"polylines": Array, "seg_keys": Dictionary, "points": Array} —
## seg_keys и общий реестр точек (вершины ВСЕХ секторов, включая хрупкие/
## двери/лифты) нужны ящикам: их обводка режется теми же точками и ложится
## вровень со статикой — без удвоения альфы на стыках.
static func _static_outline_polylines(data: Dictionary, verts: Dictionary, skip: Dictionary, line_ids: Dictionary, lift_sec: Dictionary) -> Dictionary:
	# 0) общий реестр точек — вершины всех секторов, даже если их ребро не
	# собирается: статичные рёбра режутся и по «чужим» углам, чтобы атом
	# ящика/двери совпадал со статичным куском (иначе — двойная обводка).
	var points := []
	for s in data.get("sectors", []):
		var off0: Vector2 = s.get("offset", Vector2.ZERO)
		for vid in s.get("verts", []):
			if verts.has(vid):
				points.append(verts[vid] + off0)
	# 1) рёбра статичных секторов (мировые координаты); секторы с полем
	# outline = "0" («не используй обводку») сняты сразу, см. _no_outline_edges
	var noedge := _no_outline_edges(data)
	var edges_by_sid := {}
	for s in data.get("sectors", []):
		var sid := int(s.get("id", -1))
		if bool(s.get("fragile", false)) or str(s.get("close", "")) != "":
			continue  # хрупкий/дверь — динамические тела, не часть статичного контура
		var off: Vector2 = s.get("offset", Vector2.ZERO)
		var vv: Array = s.get("verts", [])
		var mysegs := []
		for i in range(vv.size()):
			var a := int(vv[i])
			var b := int(vv[(i + 1) % vv.size()])
			if not verts.has(a) or not verts.has(b):
				continue
			if noedge.has(_edge_key(a, b)):
				continue  # сектор просил «не используй обводку» (outline = "0")
			if not _edge_outline(s, a, b, skip, line_ids, lift_sec):
				continue  # соединение (проходимая линия) — без обводки
			var pa: Vector2 = verts[a] + off
			var pb: Vector2 = verts[b] + off
			if _pk(pa) == _pk(pb):
				continue
			mysegs.append([pa, pb])
		if not mysegs.is_empty():
			edges_by_sid[sid] = mysegs
	# 2) нарезка по общим точкам: атомарный кусок дедуплицируется между
	# секторами — совпадающее ребро рисуется один раз, без удвоения альфы
	var owners := {}  # atom key -> { sid: true }
	var atoms := {}   # atom key -> [pa, pb]
	for sid in edges_by_sid:
		var sp: Dictionary = _split_segments(edges_by_sid[sid], points)
		for k in sp:
			if not owners.has(k):
				owners[k] = {}
				atoms[k] = sp[k]
			owners[k][sid] = true
	# Дедуп по ключу уже сделан при сборе owners: каждый атомарный кусок
	# попадает в обводку один раз, сколько бы секторов его ни делили.
	var kept := atoms.duplicate()
	var seg_keys := {}
	for k in kept:
		var pr: Array = kept[k]
		var k0 := _pk(pr[0])
		var k1 := _pk(pr[1])
		var lo := k0 if k0 <= k1 else k1
		var hi := k1 if k0 <= k1 else k0
		seg_keys[lo + "|" + hi] = true
	if kept.is_empty():
		return {"polylines": [], "seg_keys": seg_keys, "points": points}
	# 3) реестр точек и смежность для сборки ломаных
	var pidx := {}
	var pcoords := []  # Vector2 по индексу точки
	var seg_pair := {}  # seg_key -> [idx_a, idx_b]
	for k in kept:
		var pr: Array = kept[k]
		var ia := _pt_index(pr[0], pidx, pcoords)
		var ib := _pt_index(pr[1], pidx, pcoords)
		if ia == ib:
			continue
		var sk := str(mini(ia, ib)) + "_" + str(maxi(ia, ib))
		seg_pair[sk] = [ia, ib]
	if seg_pair.is_empty():
		return {"polylines": [], "seg_keys": seg_keys, "points": points}
	var adj := {}
	for sk in seg_pair:
		for e in seg_pair[sk]:
			if not adj.has(e):
				adj[e] = []
			adj[e].append(sk)
	var used := {}
	var out := []
	# открытые цепочки — от точек со свободной степенью 1
	for idx0 in adj.keys():
		if _unused_deg(adj[idx0], used) != 1:
			continue
		var sk0 := _first_unused(adj[idx0], used)
		if sk0 == "":
			continue
		var pts := PackedVector2Array()
		var cur: int = idx0
		while sk0 != "":
			used[sk0] = true
			var pr: Array = seg_pair[sk0]
			var other: int = int(pr[1]) if int(pr[0]) == cur else int(pr[0])
			if pts.is_empty():
				pts.append(pcoords[cur])
			pts.append(pcoords[other])
			cur = other
			sk0 = _first_unused(adj[cur], used)
		if pts.size() >= 2:
			out.append(pts)
	# остатки — замкнутые кольца и ветви при точках слияния
	for sk in seg_pair:
		if used.has(sk):
			continue
		var pts := PackedVector2Array()
		var cur := int(seg_pair[sk][0])
		var s2: String = sk
		while s2 != "":
			used[s2] = true
			var pr: Array = seg_pair[s2]
			var other: int = int(pr[1]) if int(pr[0]) == cur else int(pr[0])
			if pts.is_empty():
				pts.append(pcoords[cur])
			pts.append(pcoords[other])
			cur = other
			s2 = _first_unused(adj[cur], used)
		if pts.size() >= 2:
			out.append(pts)
	return {"polylines": out, "seg_keys": seg_keys, "points": points}


## Какие сектора — лифты и какие рёбра им принадлежат.
## Возвращает [sec_ids:Dictionary, edge_keys:Dictionary].
static func _lift_topology(data: Dictionary) -> Array:
	var sec_ids := {}
	var edge_keys := {}
	var lift_sectors := {}
	for L in data.get("lifts", []):
		lift_sectors[int(L.get("sector", -1))] = true
	for s in data.get("sectors", []):
		var sid := int(s.get("id", -1))
		if not lift_sectors.has(sid):
			continue
		sec_ids[sid] = true
		var vv: Array = s.get("verts", [])
		for i in range(vv.size()):
			edge_keys[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = true
	return [sec_ids, edge_keys]


## Цвет визуала линии по её типу.
static func _line_color(ln: Dictionary) -> Color:
	if str(ln.get("flags", "0")) == "2":
		return COLOR_PORTAL
	if bool(ln.get("step", false)):
		return COLOR_STEP
	if bool(ln.get("free", false)):
		return COLOR_FREE
	return COLOR_WALL


## Есть ли у линии коллизия: нет у порталов и свободных.
static func _line_solid(ln: Dictionary) -> bool:
	return str(ln.get("flags", "0")) != "2" and not bool(ln.get("free", false))


## Рёбра хрупких секторов {edge_key -> sector_id}: всё совпадающее
## (свои линии и наложенные соседские) строит групповое тело VLSDestructible,
## статика их не дублирует — иначе после взрыва оставалась бы невидимая стена.
static func _fragile_edges(data: Dictionary) -> Dictionary:
	var out := {}
	for s in data.get("sectors", []):
		if not bool(s.get("fragile", false)):
			continue
		var sid := int(s.get("id", -1))
		var vv: Array = s.get("verts", [])
		for i in range(vv.size()):
			out[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = sid
	return out


## Рёбра закрытых дверей {edge_key -> sector_id}: статика их не строит,
## барьер (стены + коллизия) собирает тело VLSDoor для этого сектора.
static func _door_edges(data: Dictionary) -> Dictionary:
	var out := {}
	for s in data.get("sectors", []):
		if str(s.get("close", "")) == "":
			continue
		var sid := int(s.get("id", -1))
		var vv: Array = s.get("verts", [])
		for i in range(vv.size()):
			out[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = sid
	return out


static func _lift_trans(curve: String) -> int:
	match curve.strip_edges().to_lower():
		"lin":
			return Tween.TRANS_LINEAR
		"cus":
			return Tween.TRANS_CUBIC
	return Tween.TRANS_SINE


## Точка степпера в координатах кабины: A001 внутри → строго туда,
## иначе первое свободное (непривязанное, не игрок) A внутри, иначе центр.
static func _stepper_spot(things_by_id: Dictionary, bound_ids: Dictionary, poly: PackedVector2Array, base: Vector2) -> Vector2:
	if things_by_id.has("A001"):
		var a: Dictionary = things_by_id["A001"]
		if not bound_ids.has("A001") and not is_player_thing(a) and Geometry2D.is_point_in_polygon(Vector2(float(a.get("x", 0.0)), float(a.get("y", 0.0))), poly):
			return Vector2(float(a.get("x", 0.0)), float(a.get("y", 0.0))) - base
	for tid in things_by_id:
		var t: Dictionary = things_by_id[tid]
		if bound_ids.has(tid) or is_player_thing(t):
			continue
		if str(t.get("id", "")).left(1).to_upper() != "A":
			continue
		if Geometry2D.is_point_in_polygon(Vector2(float(t.get("x", 0.0)), float(t.get("y", 0.0))), poly):
			return Vector2(float(t.get("x", 0.0)), float(t.get("y", 0.0))) - base
	return Vector2.ZERO


static func _bbox_of(poly: PackedVector2Array) -> Rect2:
	var bb := Rect2(poly[0], Vector2.ZERO)
	for p in poly:
		bb = bb.expand(p)
	return bb


## Физическое тело игрока по любому ноду из группы player:
## корень сцены Node2D или сам CharacterBody2D (ищем вглубь).
## Нужно, т.к. pleer.tscn — Node2D-корень, а движок и velocity на ребёнке.
static func player_body(n: Node) -> CharacterBody2D:
	if n == null or not is_instance_valid(n):
		return null
	if n is CharacterBody2D:
		return n
	var b := n.get_node_or_null("CharacterBody2D") as CharacterBody2D
	if b != null:
		return b
	for c in n.get_children():
		var r := player_body(c)
		if r != null:
			return r
	return null


## Все живые тела игроков из группы (обычно одно).
static func player_bodies(root: Node) -> Array:
	var out := []
	var tree := root.get_tree()
	if tree == null:
		return out
	for n in tree.get_nodes_in_group("player"):
		var b := player_body(n)
		if b != null and is_instance_valid(b) and not out.has(b):
			out.append(b)
	return out


## Код «B + цифры» = ключ с таким номером (B000 → 0, B001 → 1). Не B или не цифры — -1.
static func _key_index(code: String) -> int:
	var c := code.strip_edges().to_upper()
	if not c.begins_with("B") or c.length() < 2:
		return -1
	var digits := c.substr(1)
	if digits == "" or not digits.is_valid_int():
		return -1
	return digits.to_int()


## Ключ в мире: ромб побольше стандартного маркера + подпись «ключ N».
## Коллизии нет — подбор по дистанции в map_data.
static func _spawn_key(th_root: Node2D, t: Dictionary, idx: int) -> Node2D:
	var k := VLSKey.new()
	k.key_index = idx
	k.position = Vector2(float(t.get("x", 0.0)), float(t.get("y", 0.0)))
	k.name = "Key_" + str(t.get("id", "B" + str(idx)))
	var col := Color(1.0, 0.85, 0.3)
	var r := 9.0
	var dia := Polygon2D.new()
	dia.polygon = PackedVector2Array([
		Vector2(0, -r), Vector2(r * 0.6, -r * 0.4), Vector2(r, 0),
		Vector2(r * 0.6, r * 0.4), Vector2(0, r), Vector2(-r * 0.6, r * 0.4),
		Vector2(-r, 0), Vector2(-r * 0.6, -r * 0.4),
	])
	dia.color = col
	k.add_child(dia)
	var lab := Label.new()
	lab.text = "ключ " + str(idx)
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.size = Vector2(64, 18)
	lab.position = Vector2(-32, -26)
	lab.add_theme_font_size_override("font_size", 12)
	lab.add_theme_color_override("font_color", col)
	k.add_child(lab)
	th_root.add_child(k)
	return k


## Хрупкие сектора: каждый — одно тело VLSDestructible (все его стены + заливка).
## Клик/тап — исчезнуть целиком. Соседние сектора свои стены оставляют себе.
static func _build_fragile(parent: Node2D, data: Dictionary, verts: Dictionary, tex_edge: Dictionary, baked: Dictionary, tex_px: float, res: Dictionary, static_segs: Dictionary, reg_points: Array) -> void:
	var frag_root := Node2D.new()
	frag_root.name = "Fragile"
	parent.add_child(frag_root)
	# Фаза 1: атомы периметров всех ящиков — той же нарезкой, что и статика
	# (общий реестр точек), чтобы обводки ящиков не налезали на статичные
	# линии и друг на друга (двойная альфа даёт грязную почти чёрную).
	var crate_atoms := {}
	for s in data.get("sectors", []):
		if not bool(s.get("fragile", false)):
			continue
		var ca_off: Vector2 = s.get("offset", Vector2.ZERO)
		var ca_vv: Array = s.get("verts", [])
		var ca_segs := []
		for i in range(ca_vv.size()):
			var ca: int = ca_vv[i]
			var cb: int = ca_vv[(i + 1) % ca_vv.size()]
			if not verts.has(ca) or not verts.has(cb):
				continue
			var cpa: Vector2 = verts[ca] + ca_off
			var cpb: Vector2 = verts[cb] + ca_off
			if _pk(cpa) == _pk(cpb):
				continue
			ca_segs.append([cpa, cpb])
		crate_atoms[int(s.get("id", -1))] = _split_segments(ca_segs, reg_points)
	var used_atom := {}  # ключ атома, уже нарисованного соседним ящиком
	for s in data.get("sectors", []):
		if not bool(s.get("fragile", false)):
			continue
		var sid := int(s.get("id", -1))
		var off: Vector2 = s.get("offset", Vector2.ZERO)
		var body := VLSDestructible.new()
		body.sector_id = sid
		var pts := PackedVector2Array()
		for vid in s.get("verts", []):
			if verts.has(vid):
				pts.append(verts[vid] + off)
		if pts.size() >= 3:
			var pg := Polygon2D.new()
			pg.polygon = pts
			pg.color = Color(0.60, 0.42, 0.22, 0.45)
			body.add_child(pg)
		# Спрайты сектора — на теле ящика: вместе с ним исчезнут при разрушении.
		var tpg := _tex_polygon(s, baked, verts, tex_px, Vector2.ZERO)
		if tpg != null:
			body.add_child(tpg)
		# Обводка ящика со всех сторон: атомы периметра, не покрытые статичной
		# обводкой и не нарисованные уже соседним ящиком (дублировать нельзя —
		# темнеет линия). Уходит с телом при разрушении; под ней статичная
		# обводка пола уже на месте.
		if pts.size() >= 3 and bool(s.get("outline", true)):
			var npts := pts.size()
			var runs := []
			var cur := PackedVector2Array()
			for i in range(npts):
				var pa: Vector2 = pts[i]
				var pb: Vector2 = pts[(i + 1) % npts]
				for piece in _atoms_on_segment(crate_atoms[sid], pa, pb):
					var pc: Array = piece
					var k := _sk(pc[0], pc[1])
					if _seg_in_static(static_segs, pc[0], pc[1]) or used_atom.has(k):
						if cur.size() >= 2:
							runs.append(cur)
						cur = PackedVector2Array()
						continue
					used_atom[k] = true
					if cur.is_empty():
						cur.append(pc[0])
					cur.append(pc[1])
			if cur.size() >= 2:
				runs.append(cur)
			for r in runs:
				var ol := Line2D.new()
				ol.points = r
				ol.width = _outline_width(data)
				ol.default_color = OUTLINE_COLOR
				body.add_child(ol)
				res["outlines"] = int(res.get("outlines", 0)) + 1
		# чем больше габарит — тем выше порог тарана
		if pts.size() >= 1:
			var bb := Rect2(pts[0], Vector2.ZERO)
			for p in pts:
				bb = bb.expand(p)
			body.break_speed = minf(BREAK_BASE + maxf(bb.size.x, bb.size.y) * BREAK_PER_PX, BREAK_MAX)
		var vv: Array = s.get("verts", [])
		var edges := {}
		for i in range(vv.size()):
			edges[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = true
		for ln in data.get("lines", []):
			if not edges.has(_edge_key(int(ln.get("a", -1)), int(ln.get("b", -1)))):
				continue
			if not verts.has(ln.get("a", -1)) or not verts.has(ln.get("b", -1)):
				continue
			if not _line_solid(ln):
				continue
			var a: Vector2 = verts[ln["a"]] + off
			var b: Vector2 = verts[ln["b"]] + off
			var cs := CollisionShape2D.new()
			var seg := SegmentShape2D.new()
			seg.a = a
			seg.b = b
			cs.shape = seg
			body.add_child(cs)
		frag_root.add_child(body)
		res["fragile"] = int(res.get("fragile", 0)) + 1
		if pts.size() >= 3:
			res["solid_sectors"].append({"id": sid, "poly": pts, "body": body})


## Закрытые двери: один узел VLSDoor на сектор с модификатором close.
## Все стены/коллизия сектора — на теле двери, как у хрупких ящиков;
## centre/poly — для силы (отталкивание/притяжение) из character_body_2d.
static func _build_doors(parent: Node2D, data: Dictionary, verts: Dictionary, tex_edge: Dictionary, baked: Dictionary, tex_px: float, res: Dictionary) -> void:
	var door_root := Node2D.new()
	door_root.name = "Doors"
	parent.add_child(door_root)
	for s in data.get("sectors", []):
		var cl := str(s.get("close", ""))
		if cl == "":
			continue
		var sid := int(s.get("id", -1))
		var off: Vector2 = s.get("offset", Vector2.ZERO)
		var pts := PackedVector2Array()
		for vid in s.get("verts", []):
			if verts.has(vid):
				pts.append(verts[vid] + off)
		if pts.size() < 3:
			VLSLog.warn("[VLS] Door S" + str(sid) + ": degenerate sector — door skipped.")
			continue
		var body := VLSDoor.new()
		body.sector_id = sid
		body.key_index = cl.to_int() if cl.is_valid_int() else 0
		body.poly = pts
		var pg := Polygon2D.new()
		pg.polygon = pts
		pg.color = COLOR_DOOR_FILL
		body.add_child(pg)
		# Спрайты сектора — на теле двери: она ездит/исчезает вместе с ними.
		var tpg := _tex_polygon(s, baked, verts, tex_px, Vector2.ZERO)
		if tpg != null:
			body.add_child(tpg)
		var vv: Array = s.get("verts", [])
		var edges := {}
		for i in range(vv.size()):
			edges[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = true
		for ln in data.get("lines", []):
			if not edges.has(_edge_key(int(ln.get("a", -1)), int(ln.get("b", -1)))):
				continue
			if not verts.has(ln.get("a", -1)) or not verts.has(ln.get("b", -1)):
				continue
			if not _line_solid(ln):
				continue
			var a: Vector2 = verts[ln["a"]] + off
			var b: Vector2 = verts[ln["b"]] + off
			var cs := CollisionShape2D.new()
			var seg := SegmentShape2D.new()
			seg.a = a
			seg.b = b
			cs.shape = seg
			body.add_child(cs)
		body.add_to_group("vls_doors")
		door_root.add_child(body)
		res["doors"] = int(res.get("doors", 0)) + 1
		if pts.size() >= 3:
			res["solid_sectors"].append({"id": sid, "poly": pts, "body": body})


static func _build_lifts(parent: Node2D, data: Dictionary, things_by_id: Dictionary, bound_ids: Dictionary, tex_edge: Dictionary, baked: Dictionary, tex_px: float, res: Dictionary) -> void:
	var verts: Dictionary = data.get("vertices", {})
	var sectors_by_id := {}
	for s in data.get("sectors", []):
		sectors_by_id[int(s.get("id", -1))] = s
	var lift_root := Node2D.new()
	lift_root.name = "Lifts"
	parent.add_child(lift_root)
	var call_root := Node2D.new()
	call_root.name = "Callers"
	parent.add_child(call_root)
	for L in data.get("lifts", []):
		if not sectors_by_id.has(int(L.get("sector", -1))):
			VLSLog.warn("[VLS] Lift " + str(L.get("id", "?")) + ": sector S" + str(L.get("sector", "?")) + " not found — lift skipped (delete it in the editor and export the map again).")
			continue
		var sec: Dictionary = sectors_by_id[int(L.get("sector", -1))]
		var off: Vector2 = sec.get("offset", Vector2.ZERO)
		var poly := _sector_poly(data, int(L.get("sector", -1)))
		if poly.size() < 3:
			VLSLog.warn("[VLS] Lift " + str(L.get("id", "?")) + ": sector S" + str(L.get("sector", "?")) + " is degenerate — skipped.")
			continue
		var base := Vector2.ZERO
		for p in poly:
			base += p
		base /= float(poly.size())
		var rel := PackedVector2Array()
		for p in poly:
			rel.append(p - base)
		var lift := VLSLift.new()
		lift.position = base
		lift.zero_pos = base
		# Платформу двигает твин покадрово — интерполяцию ей выключаем,
		# иначе будет мазаться (игроку и остальным она нужна, см. project.godot).
		lift.physics_interpolation_mode = Node2D.PHYSICS_INTERPOLATION_MODE_OFF
		lift.sec = float(L.get("sec", 3.0))
		lift.trans = _lift_trans(str(L.get("curve", "sin")))
		for fl in L.get("floors", []):
			lift.floor_pos.append(Vector2(float(fl.get("x", base.x)), float(fl.get("y", base.y))))
			lift.floor_names.append(str(fl.get("name", "")))
		# Заливка и спрайты — под стенами (порядок редактора: заливка → текстура
		# → линии), всё это едет вместе с платформой как единое тело.
		var pg := Polygon2D.new()
		pg.polygon = rel
		pg.color = Color(0.35, 0.50, 0.85, 0.7)
		lift.add_child(pg)
		var tpg := _tex_polygon(sec, baked, verts, tex_px, -base)
		if tpg != null:
			lift.add_child(tpg)
		# Стены комнаты: собственные линии сектора едут вместе с платформой.
		# Внутренность полая — игрок заходит через проём (free) и едет внутри.
		# free/порталы — только визуал без коллизии (дверные проёмы).
		var my_edges := {}
		var vv: Array = sec.get("verts", [])
		for i in range(vv.size()):
			my_edges[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = true
		for ln in data.get("lines", []):
			var la := int(ln.get("a", -1))
			var lb := int(ln.get("b", -1))
			if not my_edges.has(_edge_key(la, lb)):
				continue
			if not verts.has(la) or not verts.has(lb):
				continue
			if not _line_solid(ln):
				continue
			var ra: Vector2 = verts[la] + off - base
			var rb: Vector2 = verts[lb] + off - base
			var lcs := CollisionShape2D.new()
			var lsg := SegmentShape2D.new()
			lsg.a = ra
			lsg.b = rb
			lcs.shape = lsg
			lift.add_child(lcs)
		# Обводка шахты — статичная (корень SectorOutlines): след платформы
		# остаётся на месте, когда лифт уезжает. Платформа своей обводки не
		# несёт — иначе двойная линия поверх шахты в исходной позиции.
		var area := Area2D.new()
		# детект «внутри лифта» — рамка кабины с запасом: игрок, стоящий
		# НА верхней поверхности, origin-ом уже вне полигона, а цифры должны работать
		var bb := _bbox_of(rel).grow(28.0)
		var apoly := CollisionShape2D.new()
		var abox := RectangleShape2D.new()
		abox.size = bb.size
		apoly.shape = abox
		apoly.position = bb.get_center()
		area.add_child(apoly)
		lift.add_child(area)
		lift._detect = area
		lift.add_to_group("vls_lifts")
		lift_root.add_child(lift)
		res["lifts_built"] = int(res["lifts_built"]) + 1
		# ключ нулевого этажа
		if str(L.get("zero_id", "")) != "":
			if _spawn_caller(call_root, things_by_id, str(L["zero_id"]), lift, -1, "0"):
				res["callers"] = int(res["callers"]) + 1
		# вызывалки этажей
		var floors: Array = L.get("floors", [])
		for fi in range(floors.size()):
			var cid := str(floors[fi].get("caller_id", ""))
			if cid == "":
				continue
			var nm := str(floors[fi].get("name", ""))
			if nm == "":
				nm = str(fi + 1)
			if _spawn_caller(call_root, things_by_id, cid, lift, fi, nm):
				res["callers"] = int(res["callers"]) + 1
		# Степпер кабины: чёрный квадрат + две стрелки (едет вместе с ней).
		# Стоит на A001, если тот внутри кабины; иначе на первом свободном A внутри;
		# иначе в центре кабины.
		lift.build_destinations()
		lift.build_stepper(_stepper_spot(things_by_id, bound_ids, poly, base))


static func _spawn_caller(call_root: Node2D, things_by_id: Dictionary, thing_id: String, lift: VLSLift, floor_idx: int, label_text: String) -> bool:
	if not things_by_id.has(thing_id):
		VLSLog.warn("[VLS] Caller " + thing_id + " not found among things — square skipped.")
		return false
	var t: Dictionary = things_by_id[thing_id]
	var a := VLSCaller.new()
	a.position = Vector2(float(t.get("x", 0.0)), float(t.get("y", 0.0)))
	a.lift = lift
	a.floor_index = floor_idx
	a.add_to_group("vls_callers")
	var cs := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(CALLER_HALF * 2.0 + 4.0, CALLER_HALF * 2.0 + 4.0)
	cs.shape = rect
	a.add_child(cs)
	var sq := Polygon2D.new()
	sq.polygon = PackedVector2Array([
		Vector2(-CALLER_HALF, -CALLER_HALF), Vector2(CALLER_HALF, -CALLER_HALF),
		Vector2(CALLER_HALF, CALLER_HALF), Vector2(-CALLER_HALF, CALLER_HALF)])
	sq.color = Color.BLACK
	a.add_child(sq)
	var frame := Line2D.new()
	frame.points = PackedVector2Array([
		Vector2(-CALLER_HALF, -CALLER_HALF), Vector2(CALLER_HALF, -CALLER_HALF),
		Vector2(CALLER_HALF, CALLER_HALF), Vector2(-CALLER_HALF, CALLER_HALF),
		Vector2(-CALLER_HALF, -CALLER_HALF)])
	frame.width = 2.0
	frame.default_color = Color(0.45, 0.45, 0.45)
	a.add_child(frame)
	var lab := Label.new()
	lab.text = label_text
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.size = Vector2(56, 20)
	lab.position = Vector2(-28, -CALLER_HALF - 24.0)
	lab.add_theme_font_size_override("font_size", 14)
	lab.add_theme_color_override("font_color", Color(1.0, 0.85, 0.4))
	a.add_child(lab)
	call_root.add_child(a)
	VLSLog.info("[VLS] Caller: ", thing_id, " -> ", a.position)
	return true


# --- текстуры из редактора: запечённые подложки секторов и мировые прямоугольники ---

## Пикселей атласа на мировой юнит — ровно TEX_PX = GRID_SIZE / 16 в редакторе.
static func _tex_px(data: Dictionary) -> float:
	var upc := float(data.get("units_per_cell", 40))
	if upc <= 0.0:
		upc = 40.0
	return upc / 16.0


## Ширина обводки в мировых юнитах: OUTLINE_WIDTH_MAP_PX пикселей карты.
static func _outline_width(data: Dictionary) -> float:
	return OUTLINE_WIDTH_MAP_PX * _tex_px(data)


## Есть ли в [textures] вообще что-нибудь видимое (ради этого одного грузим атлас).
static func _has_tex_data(tex: Dictionary) -> bool:
	for sid in tex.get("sectors", {}):
		var layers = tex["sectors"][sid]
		if layers is Array and _sector_has_textures(layers):
			return true
	for r in tex.get("world", []):
		if r is Dictionary and bool(r.get("visible", true)) \
				and float(r.get("rw", 0)) > 0.0 and float(r.get("rh", 0)) > 0.0 \
				and float(r.get("w", 0)) > 0.0 and float(r.get("h", 0)) > 0.0:
			return true
	return false


## Атлас секторов — тот же t-map.png, что у редактора. null — рисовать нечего.
static func _load_atlas(data: Dictionary) -> Image:
	var tex: Dictionary = data.get("textures", {})
	if not _has_tex_data(tex):
		return null
	var res_tex := load(TEX_ATLAS_PATH) as Texture2D
	if res_tex != null:
		var img := res_tex.get_image()
		if img != null and not img.is_empty():
			# blend_rect требует одинаковых форматов у атласа и запеканки (RGBA8)
			if img.get_format() != Image.FORMAT_RGBA8:
				img.convert(Image.FORMAT_RGBA8)
			var want: Vector2i = tex.get("atlas", Vector2i.ZERO)
			if want != Vector2i.ZERO and (want.x != img.get_width() or want.y != img.get_height()):
				VLSLog.warn("[VLS] Editor atlas %dx%d does not match t-map.png (%dx%d) — regions will be offset." % [want.x, want.y, img.get_width(), img.get_height()])
			return img
	VLSLog.warn("[VLS] Atlas " + TEX_ATLAS_PATH + " failed to load — sector textures skipped.")
	return null


## Виден ли в слоях сектора хотя бы один спрайт.
static func _sector_has_textures(layers: Array) -> bool:
	for L in layers:
		if L is Dictionary and bool(L.get("visible", true)):
			var items = L.get("items", [])
			if items is Array and not items.is_empty():
				return true
	return false


## Рёбра текстурированных секторов {edge_key -> true}: их границы — чёрные.
static func _textured_edges(data: Dictionary) -> Dictionary:
	var out := {}
	var tex: Dictionary = data.get("textures", {})
	var by_sec: Dictionary = tex.get("sectors", {})
	for s in data.get("sectors", []):
		var layers = by_sec.get(str(int(s.get("id", -1))), [])
		if not (layers is Array) or not _sector_has_textures(layers):
			continue
		var vv: Array = s.get("verts", [])
		for i in range(vv.size()):
			out[_edge_key(int(vv[i]), int(vv[(i + 1) % vv.size()]))] = true
	return out


## Стиль визуала линии: тонкая чёрная граница у текстурированного сектора
## (цветная стена только мешает разглядеть край картинки), иначе — как всегда.
static func _wall_style(ln: Dictionary, tex_edge: Dictionary) -> Array:
	if not tex_edge.is_empty() and tex_edge.has(_edge_key(int(ln.get("a", 0)), int(ln.get("b", 0)))):
		return [TEX_EDGE_WIDTH, TEX_EDGE_COLOR]
	return [WALL_WIDTH, _line_color(ln)]


## uv точки внутри запечённой картинки (см. TEX_UV_PIXEL_SPACE).
static func _tex_uv(local_world: Vector2, tex_px: float, tex_size: Vector2) -> Vector2:
	var px := local_world / tex_px
	if TEX_UV_PIXEL_SPACE:
		return px
	return Vector2(px.x / maxf(1.0, tex_size.x), px.y / maxf(1.0, tex_size.y))


## blend_rect с обрезкой и по источнику, и по приёмнику: всё, что выпадает
## за картинки, остаётся прозрачным — как и в редакторе. Альфа-смешивание,
## а не замена: полупрозрачный верхний слой накладывается поверх нижних
## (иначе прозрачные пиксели затирали бы то, что под ними).
static func _blit_tile(dst: Image, src: Image, sx: int, sy: int, dx: int, dy: int, w: int, h: int) -> void:
	var sxs := maxi(sx, 0)
	var sys := maxi(sy, 0)
	var dxs := maxi(dx, 0)
	var dys := maxi(dy, 0)
	sxs += dxs - dx
	sys += dys - dy
	var bw := w - (dxs - dx)
	var bh := h - (dys - dy)
	bw = mini(bw, dst.get_width() - dxs)
	bh = mini(bh, dst.get_height() - dys)
	bw = mini(bw, src.get_width() - sxs)
	bh = mini(bh, src.get_height() - sys)
	if bw <= 0 or bh <= 0:
		return
	dst.blend_rect(src, Rect2i(sxs, sys, bw, bh), Vector2i(dxs, dys))


## Запекает спрайты сектора в картинку размером с его габарит: пиксель картинки =
## пиксель атласа (1 юнит мира = 1/tex_px пикселя), так что повторы внутри окна
## pw×ph и прозрачность выходят ровно как на канве редактора. Клип по полигону
## делает сам Polygon2D. Возвращает [Image, Rect2(габарит в мире)] либо [].
static func _bake_sector(sector: Dictionary, layers: Array, verts: Dictionary, atlas: Image, tex_px: float) -> Array:
	var off: Vector2 = sector.get("offset", Vector2.ZERO)
	var poly := PackedVector2Array()
	for vid in sector.get("verts", []):
		if verts.has(vid):
			poly.append(verts[vid] + off)
	if poly.size() < 3:
		return []
	var min_p := Vector2(INF, INF)
	var max_p := Vector2(-INF, -INF)
	for p in poly:
		min_p = Vector2(minf(min_p.x, p.x), minf(min_p.y, p.y))
		max_p = Vector2(maxf(max_p.x, p.x), maxf(max_p.y, p.y))
	var k := 1.0 / tex_px  # пикселей атласа на юнит мира
	var w := int(ceil((max_p.x - min_p.x) * k))
	var h := int(ceil((max_p.y - min_p.y) * k))
	if w < 1 or h < 1:
		return []
	if w > TEX_BAKE_LIMIT or h > TEX_BAKE_LIMIT:
		VLSLog.warn("[VLS] Sector %s: size %dx%d pixels exceeds the bake limit — textures skipped." % [sector.get("id", "?"), w, h])
		return []
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	for L in layers:
		if not (L is Dictionary) or not bool(L.get("visible", true)):
			continue
		var items = L.get("items", [])
		if not (items is Array):
			continue
		for it in items:
			if not (it is Dictionary):
				continue
			var rw := int(roundf(float(it.get("rw", 0))))
			var rh := int(roundf(float(it.get("rh", 0))))
			if rw < 1 or rh < 1:
				continue
			var pw := int(roundf(float(it.get("pw", 0))))
			var ph := int(roundf(float(it.get("ph", 0))))
			if pw < 1:
				pw = rw
			if ph < 1:
				ph = rh
			var tiles_x := int(ceil(float(pw) / float(rw)))
			var tiles_y := int(ceil(float(ph) / float(rh)))
			if tiles_x * tiles_y > 1000000:
				VLSLog.warn("[VLS] Sector %s: sprite window %dx%d pixels for region %dx%d — sprite skipped." % [sector.get("id", "?"), pw, ph, rw, rh])
				continue
			var ox := int(roundf((float(it.get("x", 0.0)) + off.x - min_p.x) * k))
			var oy := int(roundf((float(it.get("y", 0.0)) + off.y - min_p.y) * k))
			var sx := int(roundf(float(it.get("rx", 0))))
			var sy := int(roundf(float(it.get("ry", 0))))
			for ty in range(tiles_y):
				for tx in range(tiles_x):
					var tw := mini(rw, pw - tx * rw)
					var th := mini(rh, ph - ty * rh)
					_blit_tile(img, atlas, sx, sy, ox + tx * rw, oy + ty * rh, tw, th)
	return [img, Rect2(min_p, max_p - min_p)]


## Запекает подложки всех секторов, у которых видимые спрайты: {sid: [Image, Rect2]}.
## Одна запеканка на сектор — её забирает либо корень SectorTextures, либо своё тело
## (хрупкий ящик, дверь, лифт), если сектор движется или исчезает.
static func _bake_all(data: Dictionary, atlas: Image, tex_px: float) -> Dictionary:
	var verts: Dictionary = data.get("vertices", {})
	var tex: Dictionary = data.get("textures", {})
	var by_sec: Dictionary = tex.get("sectors", {})
	var out := {}
	for s in data.get("sectors", []):
		var sid := str(int(s.get("id", -1)))
		var layers = by_sec.get(sid, [])
		if not (layers is Array) or not _sector_has_textures(layers):
			continue
		var one := _bake_sector(s, layers, verts, atlas, tex_px)
		if not one.is_empty():
			out[sid] = one
	return out


## Polygon2D со спрайтами сектора из уже запечённой картинки. shift — сдвиг вершин
## (для лифта: его дети живут относительно центра платформы), uv всегда по миру.
## null — нечего рисовать.
static func _tex_polygon(sector: Dictionary, baked: Dictionary, verts: Dictionary, tex_px: float, shift: Vector2) -> Polygon2D:
	var sid := str(int(sector.get("id", -1)))
	if not baked.has(sid):
		return null
	var entry: Array = baked[sid]
	var img: Image = entry[0]
	var box: Rect2 = entry[1]
	var off: Vector2 = sector.get("offset", Vector2.ZERO)
	var poly := PackedVector2Array()
	var uvs := PackedVector2Array()
	for vid in sector.get("verts", []):
		if not verts.has(vid):
			continue
		var world: Vector2 = verts[vid] + off
		poly.append(world + shift)
		uvs.append(_tex_uv(world - box.position, tex_px, Vector2(img.get_width(), img.get_height())))
	if poly.size() < 3:
		return null
	var pg := Polygon2D.new()
	pg.name = "SectorTex_" + sid
	pg.polygon = poly
	pg.uv = uvs
	pg.texture = ImageTexture.create_from_image(img)
	pg.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	pg.color = Color.WHITE
	return pg


## Подложки обычных секторов — поверх их заливок, под стенами (чёрная граница
## должна лежать сверху). Хрупкие/двери/лифты получают свои внутри _build_*.
static func _add_sector_textures(parent: Node2D, data: Dictionary, baked: Dictionary, lift_sec: Dictionary, tex_px: float) -> void:
	var verts: Dictionary = data.get("vertices", {})
	var root := Node2D.new()
	root.name = "SectorTextures"
	var n := 0
	for s in data.get("sectors", []):
		var sid := str(int(s.get("id", -1)))
		if not baked.has(sid):
			continue
		if lift_sec.has(int(s.get("id", -1))) or bool(s.get("fragile", false)) or str(s.get("close", "")) != "":
			continue  # подложку нарисует тело лифта/ящика/двери
		var pg := _tex_polygon(s, baked, verts, tex_px, Vector2.ZERO)
		if pg == null:
			continue
		root.add_child(pg)
		n += 1
	if n == 0:
		root.free()
		return
	parent.add_child(root)


## Мировые прямоугольники: окно из атласа, повторяющееся по прямоугольнику
## (в редакторе — CanvasPattern, начало повтора в углу rect'а, 1 пиксель = tex_px юнитов).
static func _build_world_textures(parent: Node2D, data: Dictionary, atlas: Image, tex_px: float) -> int:
	var tex: Dictionary = data.get("textures", {})
	var world = tex.get("world", [])
	if not (world is Array):
		return 0
	var root := Node2D.new()
	root.name = "WorldTextures"
	var n := 0
	for r in world:
		if not (r is Dictionary) or not bool(r.get("visible", true)):
			continue
		var rw := int(roundf(float(r.get("rw", 0))))
		var rh := int(roundf(float(r.get("rh", 0))))
		var w := float(r.get("w", 0))
		var h := float(r.get("h", 0))
		if rw < 1 or rh < 1 or w <= 0.0 or h <= 0.0:
			continue
		# окно источника целиком (как regionCanvas в редакторе)
		var src := Image.create(rw, rh, false, Image.FORMAT_RGBA8)
		src.fill(Color(0, 0, 0, 0))
		_blit_tile(src, atlas, int(roundf(float(r.get("rx", 0)))), int(roundf(float(r.get("ry", 0)))), 0, 0, rw, rh)
		var x := float(r.get("x", 0))
		var y := float(r.get("y", 0))
		var corners := PackedVector2Array([
			Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h)])
		var uvs := PackedVector2Array()
		for c in corners:
			uvs.append(_tex_uv(c - Vector2(x, y), tex_px, Vector2(rw, rh)))
		var pg := Polygon2D.new()
		pg.name = "WorldTex_" + str(int(r.get("id", n)))
		pg.polygon = corners
		pg.uv = uvs
		pg.texture = ImageTexture.create_from_image(src)
		pg.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		# повтор окна за границами rect'а (в пиксельном uv) и по всем четырём сторонам
		pg.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
		pg.color = Color.WHITE
		root.add_child(pg)
		n += 1
	if n == 0:
		root.free()
		return 0
	parent.add_child(root)
	return n


## Каркас карты как в редакторе: точки вершин, линии рёбер, соединения
## [connects] акцентным цветом, свободные линии — серым. Слой скрыт по
## умолчанию; консольная команда editor 1/0 прячет текстуры/обводки карты
## и показывает этот каркас, editor 0 возвращает всё на место.
class EditorView extends Node2D:
	const HIDDEN_ROOTS := ["WorldTextures", "SectorTextures", "Sectors", "Walls",
			"SectorOutlines", "Fragile", "Doors", "Lifts", "Things"]
	const COL_BG := Color(0.12, 0.12, 0.14)
	const COL_EDGE := Color(0.93, 0.95, 1.0)
	const COL_FREE := Color(0.55, 0.57, 0.62)
	const COL_CONN := Color(0.29, 0.49, 0.83)
	const COL_DOT := Color(1.0, 0.72, 0.15)

	var _data: Dictionary = {}
	var _sec_edges: Dictionary = {}  # edge_key -> true (границы секторов)
	var _saved: Dictionary = {}      # узел -> прежняя visible (для отката)

	func setup(data: Dictionary) -> void:
		_data = data
		for s in data.get("sectors", []):
			var vv: Array = s.get("verts", [])
			for i in range(vv.size()):
				var a := int(vv[i])
				var b := int(vv[(i + 1) % vv.size()])
				_sec_edges[_ek(a, b)] = true
		z_index = 100
		visible = false
		queue_redraw()

	static func _ek(a: int, b: int) -> String:
		return str(mini(a, b)) + "_" + str(maxi(a, b))

	func is_active() -> bool:
		return visible

	## on=true: прячет корни визуала карты (текстуры/заливки/обводки/Things,
	## кроме игрока) и включает каркас; on=0: возвращает прежнюю видимость.
	func set_view(on: bool) -> void:
		var par := get_parent()
		if par == null or on == visible:
			return
		if on:
			_saved = {}
			for c in par.get_children():
				if c == self:
					continue
				var n := str(c.name)
				if n == "Things":
					# игрок остаётся виден — его положение нужно при осмотре
					for ch in c.get_children():
						if str(ch.name) == "Player":
							continue
						_saved[ch] = ch.visible
						ch.visible = false
				elif HIDDEN_ROOTS.has(n):
					_saved[c] = c.visible
					c.visible = false
			visible = true
		else:
			for c in _saved:
				if is_instance_valid(c):
					c.visible = _saved[c]
			_saved = {}
			visible = false

	func _draw() -> void:
		if _data.is_empty():
			return
		# полотно-фон редактора поверх всего мира
		draw_rect(Rect2(-200000, -200000, 400000, 400000), COL_BG)
		var verts: Dictionary = _data.get("vertices", {})
		# рёбра секторов
		for s in _data.get("sectors", []):
			var off: Vector2 = s.get("offset", Vector2.ZERO)
			var vv: Array = s.get("verts", [])
			for i in range(vv.size()):
				var a := int(vv[i])
				var b := int(vv[(i + 1) % vv.size()])
				if verts.has(a) and verts.has(b):
					draw_line(verts[a] + off, verts[b] + off, COL_EDGE, 1.0)
		# линии вне границ секторов — серым
		for ln in _data.get("lines", []):
			var a := int(ln.get("a", -1))
			var b := int(ln.get("b", -1))
			if not (verts.has(a) and verts.has(b)):
				continue
			if _sec_edges.has(_ek(a, b)):
				continue
			draw_line(verts[a], verts[b], COL_FREE, 1.0)
		# соединения [connects] — акцентным цветом поверх
		var conn := {}
		for c in _data.get("connects", []):
			conn[int(c.get("line", -1))] = true
			conn[int(c.get("line2", -1))] = true
		for ln in _data.get("lines", []):
			if not conn.has(int(ln.get("id", -1))):
				continue
			var a := int(ln.get("a", -1))
			var b := int(ln.get("b", -1))
			if verts.has(a) and verts.has(b):
				draw_line(verts[a], verts[b], COL_CONN, 2.0)
		# точки вершин
		for vid in verts:
			draw_circle(verts[vid], 2.5, COL_DOT)
