class_name VLSMapData
extends Node2D

## Контейнер уровня («Map-Data»): хранит построенную из .vls карту ТЕКУЩЕГО уровня.
## Задумка: load_map() чистит всё внутри и строит уровень заново,
## clear_map() освобождает уровень (потом грузим следующий — и так до бесконечности).
##
## Как пользоваться:
##   1. Положи map01.vls из редактора в папку рядом (сейчас: scens/maps-data/).
##   2. Добавь инстанс map_data.tscn в свою сцену (или открой map_data.tscn напрямую).
##   3. При старте карта построится сама (autoload_on_ready), игрок заспавнится на A000.
##   4. Смена уровня: map_data.load_map("res://Data/maps-data/map02.vls").

@export var vls_path: String = "res://Data/maps-data/map01.vls"
@export var player_scene: PackedScene = preload("res://Scenes/Scenes/pleer.tscn")
@export var autoload_on_ready := true

# Паспорт сборки: меняю при каждом изменении переходника.
# Если в консоли BUILD старый — игра запущена не с этими скриптами.
const BUILD_TAG := "2026-09-22-keys"

var map_name := ""
var lifts: Array = []
var triggers: Array = []
var connects: Array = []
var player_node: Node = null
var has_player := false
var spawn_pos := Vector2.ZERO
var solid_sectors: Array = []
var void_points := PackedVector2Array()
var _inside_t := 0.0

# Ключи уровня: индекс (0/1/...) -> true. Аннулируются при загрузке нового уровня
# (clear_map), т.е. живут от подбора до перехода на следующий уровень.
var keys := {}
# Подбираемые ключи из построителя: [{idx, pos, node}].
var key_pickups: Array = []
# Количество построенных дверей и финиш-зон уровня (для печати при загрузке).
var doors := 0
var finish_sectors: Array = []

# Переход на следующий уровень: управление игрока заморожено (frozen()).
var _transitioning := false
var _fade_layer: CanvasLayer = null
var _fade_rect: ColorRect = null
var _key_layer: CanvasLayer = null
var _key_label: Label = null
# Распарсенная карта текущего уровня — для rebuild_map/copytex без чтения файла.
var map_raw: Dictionary = {}

# Подбор ключа: дистанция до существа, FADE_TIME — длительность затемнения.
const KEY_PICKUP_RADIUS := 18.0
const FADE_TIME := 0.6

# Антизастревание: глубина мгновенного выталкивания и время удержания внутри.
const EJECT_DEPTH := 12.0
const EJECT_HOLD := 0.5
const EJECT_MARGIN := 24.0
# Пустота: дальше этого от ближайшей точки карты — упал за мир, респавн на спавн.
const VOID_DIST := 10000.0


func _ready() -> void:
	VLSMapBuilder.ensure_use_action()
	add_to_group("vls_map_data")
	# Консоль Quake: пауза/карты/читы, переживает перезагрузки уровня.
	var console := VLSConsole.new()
	console.add_to_group("vls_persist")
	add_child(console)
	_ensure_overlays()
	if autoload_on_ready:
		load_map(vls_path)


## Вычеркнуть твердь уничтоженного ящика из списка (самоликвидация записи,
## чтобы выталкиватель о нём забыл навсегда — не полагаемся только на is_instance).
func unregister_solid(sector_id: int) -> void:
	var kept := []
	for e in solid_sectors:
		if int(e.get("id", -999)) != sector_id:
			kept.append(e)
	solid_sectors = kept


func _physics_process(delta: float) -> void:
	_solid_check(delta)
	_void_check()
	_key_check()
	_finish_check()


## Пустота: дальше VOID_DIST от ближайшей точки карты — провалился за мир.
func _void_check() -> void:
	if void_points.is_empty():
		return
	var lim := VOID_DIST * VOID_DIST
	for pn in VLSMapBuilder.player_bodies(self):
		var p := pn as CharacterBody2D
		if p == null:
			continue
		var pp: Vector2 = p.global_position
		var best := INF
		for q in void_points:
			var dd := pp.distance_squared_to(q)
			if dd < best:
				best = dd
				if best < lim:
					break
		if best >= lim:
			p.global_position = spawn_pos
			p.velocity = Vector2.ZERO
			VLSLog.info("[VLS] Fell into the void — respawned at spawn.")


## Антизастревание: игрок origin-ом внутри камня/ящика (лифт задвинул, заспавнился криво).
## Глубоко (>EJECT_DEPTH) — наружу сразу; мелко, но держится (EJECT_HOLD) — тоже наружу.
## Наружу = за ближайшую грань с запасом; некуда — респавн на спавн.
func _solid_check(delta: float) -> void:
	var any_inside := false
	for pn in VLSMapBuilder.player_bodies(self):
		var p := pn as CharacterBody2D
		if p == null:
			continue
		var pp: Vector2 = p.global_position
		var hit := _solid_best(pp)
		if not hit[0]:
			continue
		any_inside = true
		var depth: float = hit[1]
		var q: Vector2 = hit[2]
		var culprit: int = hit[3]
		if depth > EJECT_DEPTH or _inside_t >= EJECT_HOLD:
			_eject(p, q, pp, culprit)
			_inside_t = 0.0
			return
	if any_inside:
		_inside_t += delta
	else:
		_inside_t = 0.0


## Ближайшая грань тверди к точке: [внутри, глубина, точка_грани, id_сектора].
func _solid_best(pp: Vector2) -> Array:
	var best_d := -1.0
	var best_q := Vector2.ZERO
	var best_id := -1
	for e in solid_sectors:
		var b = e.get("body", null)
		if b != null and not is_instance_valid(b):
			continue
		var poly: PackedVector2Array = e.get("poly", PackedVector2Array())
		if poly.size() < 3:
			continue
		if not Geometry2D.is_point_in_polygon(pp, poly):
			continue
		for i in range(poly.size()):
			var q := Geometry2D.get_closest_point_to_segment(pp, poly[i], poly[(i + 1) % poly.size()])
			var dd := pp.distance_squared_to(q)
			if best_d < 0.0 or dd < best_d:
				best_d = dd
				best_q = q
				best_id = int(e.get("id", -1))
	if best_d < 0.0:
		return [false, 0.0, Vector2.ZERO, -1]
	return [true, sqrt(best_d), best_q, best_id]


func _point_in_any_solid(pt: Vector2) -> bool:
	for e in solid_sectors:
		var b = e.get("body", null)
		if b != null and not is_instance_valid(b):
			continue
		var poly: PackedVector2Array = e.get("poly", PackedVector2Array())
		if poly.size() >= 3 and Geometry2D.is_point_in_polygon(pt, poly):
			return true
	return false


func _eject(p: CharacterBody2D, q: Vector2, from: Vector2, culprit: int = -1) -> void:
	var dir := q - from
	if dir.length() < 0.001:
		dir = Vector2(0, -1)
	var target := q + dir.normalized() * EJECT_MARGIN
	if _point_in_any_solid(target):
		p.global_position = spawn_pos
		VLSLog.info("[VLS] Inside S", culprit, " — no room nearby, respawned at spawn.")
	else:
		p.global_position = target
		VLSLog.info("[VLS] Ejected from S", culprit, " outward.")
	p.velocity = Vector2.ZERO


func clear_map() -> void:
	# Открытая консоль держит паузу — не снимаем её перезагрузкой уровня.
	if not VLSConsole.is_open():
		get_tree().paused = false
	for c in get_children():
		if c.is_in_group("vls_persist"):
			continue
		remove_child(c)
		c.queue_free()
	lifts = []
	triggers = []
	connects = []
	player_node = null
	has_player = false
	map_name = ""
	spawn_pos = Vector2.ZERO
	solid_sectors = []
	void_points = PackedVector2Array()
	_inside_t = 0.0
	# Ключи аннулируются на каждом новом уровне (подборы тоже схлопываются).
	keys = {}
	key_pickups = []
	doors = 0
	finish_sectors = []
	_update_key_hud()


func load_map(path: String) -> bool:
	VLSLog.info("[VLS] BUILD=", BUILD_TAG, " node=", get_path())
	clear_map()
	if path.strip_edges() == "":
		VLSLog.error("[VLS] load_map: empty path.")
		return false
	if not FileAccess.file_exists(path):
		VLSLog.error("[VLS] load_map: file not found: " + path)
		return false
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		VLSLog.error("[VLS] load_map: cannot open: " + path)
		return false
	map_raw = VLSParser.parse_text(f.get_as_text())
	f.close()
	_build_current()
	return true


## Пересобрать уровень из map_raw без чтения файла (после copytex).
func rebuild_map() -> void:
	if map_raw.is_empty():
		return
	clear_map()
	_build_current()


## Собрать уровень из уже распарсенного map_raw (общее для load_map/rebuild_map).
func _build_current() -> void:
	var data := map_raw
	map_name = str(data.get("name", ""))
	var res := VLSMapBuilder.build(self, data, player_scene)
	lifts = res.get("lifts", [])
	triggers = res.get("triggers", [])
	connects = res.get("connects", [])
	player_node = res.get("player", null)
	has_player = bool(res.get("has_player", false))
	solid_sectors = res.get("solid_sectors", [])
	spawn_pos = res.get("spawn_pos", Vector2.ZERO)
	void_points = res.get("void_points", PackedVector2Array())
	key_pickups = res.get("keys", [])
	finish_sectors = res.get("finish_sectors", [])
	doors = res.get("doors", 0)
	_update_key_hud()
	VLSLog.info(str("[VLS] Map '", map_name, "' built: walls ", res.get("walls", 0), ", portals ", res.get("portals", 0), ", free lines ", res.get("free_lines", 0), ", sectors ", res.get("sectors", 0), ", player: ", ("yes" if has_player else "NO (A000 missing!)"), ", other creatures: ", res.get("other_things", {}), ", lifts built: ", res.get("lifts_built", 0), ", callers: ", res.get("callers", 0), ", fragile: ", res.get("fragile", 0), ", doors: ", doors, ", keys on map: ", key_pickups.size(), ", finish zones: ", finish_sectors.size(), ", solid: ", solid_sectors.size(), ", triggers: ", triggers.size(), " (data only for now)"))
	for e in data.get("errors", []):
		VLSLog.warn("[VLS] " + str(e))
	if not has_player:
		VLSLog.warn("[VLS] No player A000 on the map — cannot spawn. Place A000 in the editor.")


## Респавн игрока на точке спавна (команда kill в консоли).
func respawn_player() -> void:
	var p := player_node as CharacterBody2D
	if p == null or not is_instance_valid(p):
		return
	p.global_position = spawn_pos
	p.velocity = Vector2.ZERO
	VLSLog.info("[VLS] Respawned at spawn.")


## Выдать все ключи уровня (команда give): гасим подбираемые объекты.
func grant_all_keys() -> void:
	for i in range(0, 2):
		keys[i] = true
	for k in key_pickups:
		var n = k.get("node", null)
		if n != null and is_instance_valid(n):
			n.queue_free()
		k["node"] = null
	_update_key_hud()


## Копия ВСЕХ текстур сектора from → to: слои дублируются, спрайты сдвигаются
## на дельту центроидов секторов с поправкой на их offset (координаты спрайтов
## в .vls зависят от offset). "" — успех, иначе текст ошибки; пересборку
## делает вызывающий через rebuild_map(). В .vls не записывается (writer нет).
func copy_sector_textures(from_id: int, to_id: int) -> String:
	if map_raw.is_empty():
		return "карта не загружена"
	var tex: Dictionary = map_raw.get("textures", {})
	var by_sec: Dictionary = tex.get("sectors", {})
	var src_key := str(from_id)
	var dst_key := str(to_id)
	if not by_sec.has(src_key):
		return "у сектора S%d нет текстур" % from_id
	var have := {}
	for s in map_raw.get("sectors", []):
		var sid := int(s.get("id", -1))
		if sid == from_id or sid == to_id:
			have[sid] = s
	if not have.has(from_id):
		return "сектора S%d нет на карте" % from_id
	if not have.has(to_id):
		return "сектора S%d нет на карте" % to_id
	var cs := _sec_centroid(from_id)
	var cd := _sec_centroid(to_id)
	var off_s: Vector2 = have[from_id].get("offset", Vector2.ZERO)
	var off_d: Vector2 = have[to_id].get("offset", Vector2.ZERO)
	var t := (off_s - off_d) + (cd - cs)
	var new_layers := []
	for L in by_sec[src_key]:
		if not (L is Dictionary):
			continue
		var L2: Dictionary = L.duplicate(true)
		var items = L2.get("items", [])
		if items is Array:
			for it in items:
				if it is Dictionary:
					it["x"] = float(it.get("x", 0.0)) + t.x
					it["y"] = float(it.get("y", 0.0)) + t.y
		new_layers.append(L2)
	by_sec[dst_key] = new_layers
	return ""


## Центроид сектора (вершины + offset) в мировых координатах.
func _sec_centroid(sid: int) -> Vector2:
	var verts: Dictionary = map_raw.get("vertices", {})
	for s in map_raw.get("sectors", []):
		if int(s.get("id", -1)) != sid:
			continue
		var off: Vector2 = s.get("offset", Vector2.ZERO)
		var acc := Vector2.ZERO
		var n := 0
		for vid in s.get("verts", []):
			if verts.has(vid):
				acc += verts[vid] + off
				n += 1
		if n == 0:
			return Vector2.ZERO
		return acc / float(n)
	return Vector2.ZERO


## Управление игрока заморожено? (переход на следующий уровень; консоль держит
## паузу дерева сама — frozen() её не касается).
func frozen() -> bool:
	return _transitioning


func has_key(i: int) -> bool:
	return bool(keys.get(i, false))


func _update_key_hud() -> void:
	if _key_label == null:
		return
	var parts := []
	parts.append("Ключи: 0 " + ("✔" if keys.get(0, false) else "·"))
	parts.append("1 " + ("✔" if keys.get(1, false) else "·"))
	_key_label.text = "  ".join(parts)


## Слои интерфейса в группе vls_persist — переживают clear_map (затемнение, HUD).
func _ensure_overlays() -> void:
	if _fade_layer == null:
		_fade_layer = CanvasLayer.new()
		_fade_layer.layer = 100
		_fade_rect = ColorRect.new()
		_fade_rect.color = Color(0, 0, 0, 0)
		_fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_fade_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
		_fade_layer.add_child(_fade_rect)
		_fade_layer.add_to_group("vls_persist")
		add_child(_fade_layer)
	if _key_layer == null:
		_key_layer = CanvasLayer.new()
		_key_layer.layer = 90
		_key_label = Label.new()
		_key_label.add_theme_font_size_override("font_size", 18)
		_key_label.add_theme_color_override("font_color", Color(1.0, 0.9, 0.5))
		_key_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
		_key_label.add_theme_constant_override("outline_size", 4)
		_key_label.position = Vector2(12, 10)
		_key_layer.add_child(_key_label)
		_key_layer.add_to_group("vls_persist")
		add_child(_key_layer)
		_update_key_hud()


## Подбор ключей: игрок коснулся существа — прячем, гасим ключ до конца уровня.
func _key_check() -> void:
	if key_pickups.is_empty() or not has_player:
		return
	var bodies := VLSMapBuilder.player_bodies(self)
	if bodies.is_empty():
		return
	var pp: Vector2 = (bodies[0] as CharacterBody2D).global_position
	var r2 := KEY_PICKUP_RADIUS * KEY_PICKUP_RADIUS
	for k in key_pickups:
		var n = k.get("node", null)
		if n == null or not is_instance_valid(n):
			continue
		if pp.distance_squared_to(k.get("pos", Vector2.ZERO)) > r2:
			continue
		var idx: int = k.get("idx", 0)
		keys[idx] = true
		n.queue_free()
		k["node"] = null
		_update_key_hud()
		VLSLog.info("[VLS] Picked up key ", idx)


## Финиш-зона: игрок внутри сектора с модификатором finish → переход на следующий уровень
## (затемнение, заморозка управления, номер уровня из конца имени файла).
func _finish_check() -> void:
	if _transitioning or finish_sectors.is_empty() or not has_player:
		return
	var bodies := VLSMapBuilder.player_bodies(self)
	if bodies.is_empty():
		return
	var pp: Vector2 = (bodies[0] as CharacterBody2D).global_position
	for f in finish_sectors:
		var poly: PackedVector2Array = f.get("poly", PackedVector2Array())
		if poly.size() >= 3 and Geometry2D.is_point_in_polygon(pp, poly):
			_start_transition()
			return


func _start_transition() -> void:
	if _transitioning:
		return
	# Следующего уровня нет — финиш проигнорирован (остаёмся, где были).
	var next := _next_level_path()
	if next == "":
		VLSLog.warn("[VLS] Finish: next level not found for " + vls_path + " — transition skipped (number at the end of the map name?).")
		return
	_transitioning = true
	VLSLog.info("[VLS] Finish: fading out and loading ", next)
	_fade_rect.color.a = 0.0
	var tw := create_tween()
	tw.tween_property(_fade_rect, "color:a", 1.0, FADE_TIME)
	tw.tween_callback(func():
		load_map(next)
	)
	await tw.finished
	tw = create_tween()
	tw.tween_property(_fade_rect, "color:a", 0.0, FADE_TIME)
	await tw.finished
	_transitioning = false


## Следующая карта: имя файла levels/…/XXXNN.vls, берём хвостовые цифры,
## +1 с сохранением длины («Map 01 → Map 02», «Super Galaxy Level 01 → …Level 02»).
func _next_level_path() -> String:
	var d := vls_path.get_base_dir()
	var base := vls_path.get_file()
	var stem := base.get_basename()
	var n := stem.length()
	while n > 0 and stem[n - 1] in "0123456789":
		n -= 1
	var prefix := stem.substr(0, n)
	var num_str := stem.substr(n)
	if num_str == "" or not num_str.is_valid_int():
		return ""
	var pad := num_str.length()
	var cand := d.path_join(prefix + str(int(num_str) + 1).pad_zeros(pad) + ".vls")
	if FileAccess.file_exists(cand):
		return cand
	return ""
