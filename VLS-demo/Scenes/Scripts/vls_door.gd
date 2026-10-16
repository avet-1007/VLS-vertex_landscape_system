class_name VLSDoor
extends StaticBody2D

## Закрытая дверь (модификатор сектора «close door»).
## Строится на секторе с модификатором close = "0"/"1" (индекс нужного ключа):
## рёбра сектора — коллизия + стены (барьер), сам сектор — магнит силы:
## без ключа отталкивает игрока (сильнее при приближении), с ключом
## притягивает к себе и исчезает, когда игрок достиг двери (как деревянные ящики).
## Силу накладывает character_body_2d перед move_and_slide; destroy() снимает
## запись из solid_sectors и удаляет тело (проём становится проходимым).

var sector_id := -1
var key_index := 0          # индекс ключа (0/1), открывающего дверь
var center := Vector2.ZERO  # центр сектора — направление силы от/к двери
var poly := PackedVector2Array()

# Калибровка силы (пользователь может подвинуться) — константы на класс,
# чтобы подтягивать из character_body_2d статикой.
const RANGE := 200.0        # радиус действия силы, px
const REACH := 18.0         # ближе этого (к полигону) с ключом — дверь открывается
const PUSH_K := 30000.0     # толчок без ключа: K / max(dist, 4)
const PUSH_MAX := 720.0     # потолок толчка (обычный бег 400)
const PULL_K := 22000.0     # притяжение с ключом: K / max(dist, 4)
const PULL_MAX := 620.0
const ACCEL := 3400.0       # с какой скоростью добираемся до желаемой силы


func _ready() -> void:
	if poly.size() < 3:
		return
	var cx := 0.0
	var cy := 0.0
	for p in poly:
		cx += p.x
		cy += p.y
	center = Vector2(cx / float(poly.size()), cy / float(poly.size()))


## Расстояние до полигона двери (0 внутри): ближайшая точка границы.
static func poly_dist(p: Vector2, poly: PackedVector2Array) -> float:
	if poly.size() < 3:
		return INF
	if Geometry2D.is_point_in_polygon(p, poly):
		return 0.0
	var best := INF
	for i in range(poly.size()):
		var q := Geometry2D.get_closest_point_to_segment(p, poly[i], poly[(i + 1) % poly.size()])
		var dd := p.distance_squared_to(q)
		if dd < best:
			best = dd
	return sqrt(best)


func destroy() -> void:
	VLSLog.info("[VLS] Door S", sector_id, " opened (key ", key_index, ") — doorway is clear.")
	for n in get_tree().get_nodes_in_group("vls_map_data"):
		if n.has_method("unregister_solid"):
			n.unregister_solid(sector_id)
	queue_free()