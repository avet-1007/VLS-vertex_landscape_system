class_name VLSLift
extends AnimatableBody2D

## Платформа лифта: полигон сектора кабины, ездит между нулевой точкой (сам сектор)
## и точками этажей из .vls. AnimatableBody2D — везёт стоящего игрока физикой.
## Интерфейс внутри лифта: стой на платформе и жми цифры 1..9 (0 — нулевой этаж).

var zero_pos := Vector2.ZERO
var floor_pos: Array = []          # [Vector2] абсолютные точки этажей
var floor_names: Array = []        # [String] подписи (оставлено для будущего)
var sec := 3.0
var trans := Tween.TRANS_SINE
var current := -1                  # -1 нулевой, иначе индекс этажа

# Направления: упорядоченные остановки (ноль + этажи) вдоль главной оси.
# Вертикальный лифт: вверх = к началу списка; горизонтальный: влево = к началу.
var destinations: Array = []       # [{idx:int, pos:Vector2}], idx -1 = ноль
var horizontal := false

var stepper: Node2D = null
var step_a_btn: Button = null      # вверх / влево
var step_b_btn: Button = null      # вниз / вправо

var _tween: Tween = null
var _detect: Area2D = null
var _key_state := {}


func go_to_floor(i: int) -> void:
	var target := zero_pos
	if i >= 0:
		if i >= floor_pos.size():
			return
		target = floor_pos[i]
	elif i != -1:
		return
	if position.distance_to(target) < 0.5:
		current = i
		refresh_stepper()
		VLSLog.info("[VLS] Lift already there (", _floor_label(i), ").")
		return
	VLSLog.info("[VLS] Lift moving: ", _floor_label(current), " -> ", _floor_label(i), ".")
	current = i
	if _tween != null and _tween.is_valid():
		_tween.kill()
	_tween = create_tween().set_trans(trans).set_ease(Tween.EASE_IN_OUT)
	_tween.tween_property(self, "position", target, maxf(sec, 0.05))
	refresh_stepper()


func _floor_label(i: int) -> String:
	if i == -1:
		return "0"
	if i >= 0 and i < floor_names.size() and str(floor_names[i]) != "":
		return str(floor_names[i])
	return str(i + 1)


## Построить упорядоченные остановки и понять ориентацию (вертикаль/горизонталь).
func build_destinations() -> void:
	destinations = [{"idx": -1, "pos": zero_pos}]
	for fi in range(floor_pos.size()):
		destinations.append({"idx": fi, "pos": floor_pos[fi]})
	var dx := 0.0
	var dy := 0.0
	for d in destinations:
		var pp: Vector2 = d["pos"]
		dx = maxf(dx, absf(pp.x - zero_pos.x))
		dy = maxf(dy, absf(pp.y - zero_pos.y))
	horizontal = dx > dy
	destinations.sort_custom(func(a, b):
		var pa: Vector2 = a["pos"]
		var pb: Vector2 = b["pos"]
		if horizontal:
			return pa.x < pb.x
		return pa.y < pb.y)


## Шаг на соседнюю остановку: dir -1 = вверх/влево, +1 = вниз/вправо.
## На краю — false, никуда не едем.
func step_floor(dir: int) -> bool:
	var pos := -1
	for i in range(destinations.size()):
		if int(destinations[i].get("idx", -999)) == current:
			pos = i
			break
	if pos < 0:
		return false
	var np := pos + dir
	if np < 0 or np >= destinations.size():
		return false
	go_to_floor(int(destinations[np].get("idx", -1)))
	return true


## Чёрный квадрат-степпер в кабине (едет вместе с ней; позиция — A001/свободное A/центр).
## Клик — показать/спрятать две стрелки; стрелка — шаг на этаж (на краю гаснет).
func build_stepper(at: Vector2 = Vector2.ZERO) -> void:
	var root := Node2D.new()
	root.name = "Stepper"
	root.position = at
	# Степпер живёт и при паузе мира (иначе по стрелкам нельзя кликнуть).
	root.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(root)
	var sq := Polygon2D.new()
	sq.polygon = PackedVector2Array([
		Vector2(-15, -15), Vector2(15, -15),
		Vector2(15, 15), Vector2(-15, 15)])
	sq.color = Color.BLACK
	root.add_child(sq)
	var frame := Line2D.new()
	frame.points = PackedVector2Array([
		Vector2(-15, -15), Vector2(15, -15),
		Vector2(15, 15), Vector2(-15, 15),
		Vector2(-15, -15)])
	frame.width = 2.0
	frame.default_color = Color(1.0, 0.85, 0.4)
	root.add_child(frame)
	var area := Area2D.new()
	var cs := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(34.0, 34.0)
	cs.shape = rect
	area.add_child(cs)
	root.add_child(area)
	area.input_event.connect(_on_stepper_input)
	step_a_btn = _make_step_btn(true)
	step_b_btn = _make_step_btn(false)
	root.add_child(step_a_btn)
	root.add_child(step_b_btn)
	stepper = root
	refresh_stepper()


func _make_step_btn(first: bool) -> Button:
	var b := Button.new()
	if horizontal:
		b.text = "<" if first else ">"
		b.position = Vector2(-49.0, -11.0) if first else Vector2(19.0, -11.0)
	else:
		b.text = "^" if first else "v"
		b.position = Vector2(-15.0, -42.0) if first else Vector2(-15.0, 20.0)
	b.size = Vector2(30.0, 22.0)
	b.visible = false
	var d := -1 if first else 1
	b.pressed.connect(func(): step_floor(d); get_tree().paused = false)
	return b


# Стрелки открыты?
func _arrows_open() -> bool:
	return step_a_btn != null and step_a_btn.visible


# Закрыть свои стрелки (без трогания паузы — ею владеет открывающий).
func close_stepper() -> void:
	if step_a_btn != null:
		step_a_btn.visible = false
		step_b_btn.visible = false


func _on_stepper_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	var hit := false
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		hit = mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed
	elif event is InputEventScreenTouch:
		hit = (event as InputEventScreenTouch).pressed
	if hit:
		toggle_stepper()


# Тоггл степпера: открыт — закрыть и оживить мир, закрыт — открыть (рядом!) и на паузу.
func toggle_stepper() -> void:
	if step_a_btn == null:
		return
	# Открытая консоль — пауза её, лифт не вмешивается.
	if VLSConsole.is_open():
		return
	if step_a_btn.visible:
		step_a_btn.visible = false
		step_b_btn.visible = false
		get_tree().paused = false
		VLSLog.info("[VLS] Unpaused.")
		return
	# открыть: игрок должен быть рядом с кабиной, чужие степперы закрыть
	var mm := _use_measure()
	if not mm[0]:
		VLSLog.info("[VLS] Stepper: no player on the map.")
		return
	if float(mm[2]) > STEP_RANGE:
		var pw: Vector2 = mm[1]
		VLSLog.info("[VLS] Too far from the lift (", int(float(mm[2])), "u), I am at (", int(pw.x), ",", int(pw.y), ") — go ", _dir_arrow(global_position, pw), ".")
		return
	for n in get_tree().get_nodes_in_group("vls_lifts"):
		var o := n as VLSLift
		if o != null and o != self:
			o.close_stepper()
	step_a_btn.visible = true
	step_b_btn.visible = true
	get_tree().paused = true
	VLSLog.info("[VLS] Paused — pick a floor (moving will unpause).")


# Кнопка Z внутри кабины — то же, что клик по квадрату.
# Стрелки при открытых стрелках — шаг на этаж (вверх/влево −1, вниз/вправо +1).
func _floor_key_pressed() -> bool:
	var d := 0
	if horizontal:
		if Input.is_action_just_pressed("ui_left"):
			d = -1
		elif Input.is_action_just_pressed("ui_right"):
			d = 1
	else:
		if Input.is_action_just_pressed("ui_up"):
			d = -1
		elif Input.is_action_just_pressed("ui_down"):
			d = 1
	if d == 0:
		return false
	if step_floor(d):
		get_tree().paused = false
		return true
	return false


# Нажато ли движение/прыжок прямо сейчас (для снятия паузы).
	return false


# Дистанция от точки UsePoint игрока до кабины — только в момент клика.
const STEP_RANGE := 150.0


# Замер до точки UsePoint игрока в момент клика: [есть_ли, позиция, дистанция].
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


func refresh_stepper() -> void:
	if step_a_btn == null or step_b_btn == null:
		return
	var pos := -1
	for i in range(destinations.size()):
		if int(destinations[i].get("idx", -999)) == current:
			pos = i
			break
	step_a_btn.disabled = (pos <= 0)
	step_b_btn.disabled = (pos < 0 or pos >= destinations.size() - 1)


# Нажато ли движение/прыжок прямо сейчас (для снятия паузы).
func _move_pressed() -> bool:
	return Input.is_action_just_pressed("ui_left") or Input.is_action_just_pressed("ui_right") or Input.is_action_just_pressed("ui_up") or Input.is_action_just_pressed("ui_down") or Input.is_action_just_pressed("ui_accept")


func player_inside() -> bool:
	if _detect == null:
		return false
	for b in _detect.get_overlapping_bodies():
		if b.is_in_group("player"):
			return true
	return false


## Антизастревание: лифт едет, игрок внутри барахтается (жмёт движение/прыжок),
## но почти не сдвигается ~0.8 с — значит, кабиной прижало. Вытаскиваем
## к ближайшей вызывалке этажа (не ключу), иначе над нулевой точкой.
const STUCK_TIME := 0.8
const STUCK_DIST := 8.0

var _stuck_t := 0.0
var _stuck_anchor := Vector2.ZERO
var _stuck_armed := false


func _stuck_check(delta: float) -> void:
	var p: CharacterBody2D = null
	for pn in get_tree().get_nodes_in_group("player"):
		p = VLSMapBuilder.player_body(pn)
		if p != null:
			break
	if p == null:
		return
	var moving := _tween != null and _tween.is_valid() and _tween.is_running()
	if not moving:
		_stuck_t = 0.0
		_stuck_armed = false
		return
	var want := Input.get_axis("ui_left", "ui_right") != 0.0 or Input.is_action_pressed("ui_accept")
	if not want:
		_stuck_t = 0.0
		_stuck_armed = false
		return
	if not _stuck_armed:
		_stuck_armed = true
		_stuck_anchor = p.global_position
		_stuck_t = 0.0
		return
	if p.global_position.distance_to(_stuck_anchor) > STUCK_DIST:
		_stuck_anchor = p.global_position
		_stuck_t = 0.0
		return
	_stuck_t += delta
	if _stuck_t >= STUCK_TIME:
		_stuck_t = 0.0
		_stuck_armed = false
		_rescue(p)


func _rescue(p: CharacterBody2D) -> void:
	var best: VLSCaller = null
	var best_d := INF
	for n in get_tree().get_nodes_in_group("vls_callers"):
		var c := n as VLSCaller
		if c == null or c.floor_index < 0:
			continue
		var d := c.global_position.distance_to(p.global_position)
		if d < best_d:
			best_d = d
			best = c
	if best != null:
		p.global_position = best.global_position + Vector2(0, -20)
	else:
		p.global_position = zero_pos + Vector2(0, -40)
	p.velocity = Vector2.ZERO
	VLSLog.info("[VLS] Stuck in the lift — pulled out to the caller.")


func _ready() -> void:
	# Лифт следит и на паузе (снятие паузы движением), остальное гейтится внутри.
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(_delta: float) -> void:
	# Открытая консоль держит паузу: Z/стрелки/движение её не трогают.
	if VLSConsole.is_open():
		return
	if get_tree().paused:
		# на паузе: Z — закрыть, стрелки этажей — шаг, остальное движение — снять паузу
		if _arrows_open():
			if Input.is_action_just_pressed("grab"):
				toggle_stepper()
				return
			if _floor_key_pressed():
				return
			if _move_pressed():
				close_stepper()
				get_tree().paused = false
				VLSLog.info("[VLS] Unpaused — moving.")
		return
	var inside := player_inside()
	if _arrows_open() and not inside:
		# вышел из сектора — стрелки закрываются (повторный вход: опять через квадрат/Z)
		close_stepper()
		get_tree().paused = false
		return
	if not inside:
		return
	# Z внутри кабины — то же, что клик по квадрату (открыть/закрыть стрелки)
	if Input.is_action_just_pressed("grab"):
		toggle_stepper()
		return
	# Стрелки при открытых стрелках — повторный выбор этажа (1-й -> 3-й без закрытия).
	if _arrows_open() and _floor_key_pressed():
		return
	_stuck_check(_delta)
	_digit(KEY_0, -1)
	_digit(KEY_1, 0)
	_digit(KEY_2, 1)
	_digit(KEY_3, 2)
	_digit(KEY_4, 3)
	_digit(KEY_5, 4)
	_digit(KEY_6, 5)
	_digit(KEY_7, 6)
	_digit(KEY_8, 7)
	_digit(KEY_9, 8)


func _digit(keycode: int, idx: int) -> void:
	var down := Input.is_physical_key_pressed(keycode)
	var was := bool(_key_state.get(keycode, false))
	_key_state[keycode] = down
	if down and not was:
		go_to_floor(idx)
