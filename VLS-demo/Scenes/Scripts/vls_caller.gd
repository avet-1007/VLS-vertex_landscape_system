class_name VLSCaller
extends Area2D

## Временный чёрный квадратик — терминал лифта из редактора.
## Привязан к лифту: floor_index >= 0 — вызывалка этажа, -1 — ключ нулевого этажа.
## Интерфейс: встань вплотную и нажми E (vls_use) — платформа поедет на этот этаж.
## Визуал (квадрат + подпись) строит VLSMapBuilder, здесь только логика.

var lift: VLSLift = null
var floor_index := 0

# Дистанция действия квадратика: с другого края экрана не достать.
# 150 — впритык всегда проходит (квадрат 30 + капсула + зазор), кросс-карта нет.
const USE_RANGE := 150.0


func _ready() -> void:
	input_event.connect(_on_input_event)


# Дистанция от точки UsePoint игрока до квадратика — меряем СТРОГО в момент
# нажатия (клик или E), каждый раз заново. Постоянного опроса нет.
# Другая формула: квадрат дистанции + корень (эквивалент distance_to).
# Возвращает [есть_ли, позиция_точки, дистанция].
func _use_measure() -> Array:
	var best_p := Vector2.ZERO
	var best := -1.0
	var found := false
	for n in get_tree().get_nodes_in_group("player"):
		var p := n as Node2D
		if p == null or not is_instance_valid(p):
			continue
		var pt := p.get_node_or_null("UsePoint") as Node2D
		var pp: Vector2 = pt.global_position if pt != null else p.global_position
		var diff := global_position - pp
		var d := sqrt(diff.x * diff.x + diff.y * diff.y)
		if not found or d < best:
			best = d
			best_p = pp
			found = true
	return [found, best_p, best]


# Стрелка направления к цели (мир Y вниз: +y = низ).
func _dir_arrow(to_pos: Vector2, from_pos: Vector2) -> String:
	var to := to_pos - from_pos
	if absf(to.x) >= absf(to.y):
		return "→" if to.x > 0.0 else "←"
	return "↓" if to.y > 0.0 else "↑"


func _try_activate() -> void:
	if lift == null or not is_instance_valid(lift):
		return
	var m := _use_measure()
	if not m[0]:
		VLSLog.info("[VLS] Caller: no player on the map.")
		return
	if float(m[2]) > USE_RANGE:
		var pp: Vector2 = m[1]
		VLSLog.info("[VLS] Too far (", int(float(m[2])), "u), I am at (", int(pp.x), ",", int(pp.y), ") — go ", _dir_arrow(global_position, pp), ".")
		return
	# Ключик нулевого этажа — только снаружи: им вызывают лифт с этажа,
	# спускаться на нём изнутри кабины странно.
	if floor_index == -1 and lift.player_inside():
		VLSLog.info("[VLS] The key does not work from inside the cabin — step out and call from the floor.")
		return
	lift.go_to_floor(floor_index)


# Клик/тап прямо по квадратику — активация без клавиши E.
func _on_input_event(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	if lift == null:
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			_try_activate()
	elif event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			_try_activate()


func _process(_delta: float) -> void:
	if Input.is_action_just_pressed("vls_use"):
		_try_activate()
	# Z рядом с квадратиком — то же, что E/клик.
	if Input.is_action_just_pressed("grab"):
		_try_activate()
