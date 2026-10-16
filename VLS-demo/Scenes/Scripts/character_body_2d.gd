extends CharacterBody2D

## Celeste-контроллер для 2D + Quake-баннихоп:
## бег всегда, прыжок с земли копит бонус (потолок +50%), в воздухе трения нет,
## удар об стену гасит бонус, Shift — крадучка (чуть медленнее + не падает с края).
## Прыжок — C (и Space/Enter), взгляд вверх — Up, присед — Down,
## рывок — X (8 сторон), карабканье — Z (держа + в стену).
## TODO-АРТ: нет кадров взгляда вверх / приседа / карабканья — места помечены,
## временные приёмы: сплющивание приседа, медленный бег на стене.

const SPEED = 400.0
const JUMP_VELOCITY = -600.0

const MAX_BONUS_RATIO := 0.5   # потолок бонуса: +50% к базе
const BONUS_PER_HOP := SPEED * 0.08  # +8% за прыжок с земли на ходу
const GROUND_ACCEL := 2200.0
const TURN_ACCEL := 3200.0      # разворот: резкая смена направления быстрее
const AIR_ACCEL := 900.0
const GROUND_FRICTION := 2000.0
const APEX_WINDOW := 70.0       # окно вершины прыжка: гравитация слабее
const APEX_MULT := 0.55
const WALL_SLIDE_MAX := 140.0   # слайд по стене: предел падения
const WALL_JUMP_VY := -460.0    # воллджамп: вверх
const WALL_JUMP_VX := 300.0     # воллджамп: от стены (удержание скорости — отдельно)
const CLIMB_HOP_VY := -520.0    # кlimb-хоп: вверх (в счёт усталости)
const CLIMB_HOP_VX := 150.0     # climb-hop: чуть от стены
const DASH_ATTACK_TIME := 0.18  # окно «только что рывок» для объектов
const END_UP_MULT := 0.75       # конец рывка вверх: срез вертикали
const CROUCH_SPEED := 90.0      # ползком в приседе
const CRAWL_ACCEL := 1600.0
const SNEAK_SPEED := 200.0      # шифт на земле: чуть медленнее
const CRASH_WINDOW := 0.5       # окно возврата скорости после удара
const CRASH_MIN_SPEED := 150.0  # удар слабее — не считается
const LEDGE_AHEAD := 16.0       # зонд края: вперёд по курсу...
const LEDGE_DOWN := 30.0        # ...и вниз: пола нет — стоп
const COYOTE_TIME := 0.1        # прыжок после схода с края
const BUFFER_TIME := 0.1        # нажатие до приземления дожимается само
const JUMP_CUT := 0.45          # срез скорости при раннем отпускании (тап = низкий прыжок)
const MAX_AIR_JUMPS := 1        # воздушных прыжков за полёт (дабл-джамп)
const AIR_JUMP_POWER := 0.5     # второй прыжок — вполсилы от первого
const BREAK_MIN_SPEED := 150.0  # (оставлено) порог удара выше; таран ящиков — ниже
const SMASH_KEEP := 0.8         # после тарана остаётся 80% скорости

const DASH_TIME := 0.15         # рывок: длительность
const DASH_SPEED := 560.0       # рывок: скорость (8 сторон)
const CLIMB_MAX := 170.0        # карабканье: стартовая скорость вверх
const CLIMB_TAU := 1.1          # карабканье: экспонента затухания (потом выгоднее рывок)
const CLIMB_SLIDE := 240.0      # карабканье: быстрый спуск вниз
const CLIMB_PUSH := 30.0        # карабканье: прижим к стене (трение-контакт)
const CLIMB_ART_X := 0.0        # спрайт карабканья: арт юзера по центру кадра (16px) = хитбокс (8px)
const SLOPE_BOOST := 260.0      # прыжок со склона: толчок вдоль спуска

var bonus_speed := 0.0
var air_jumps := MAX_AIR_JUMPS
var facing := 1.0
var looking_up := false
var crouched := false
var climbing := false
var dashing := false
var dash_ready := true
var dash_t := 0.0
var dash_dir := Vector2.RIGHT
var climb_up_time := 0.0
var _run_sprite: AnimatedSprite2D = null
var _idle_sprite: AnimatedSprite2D = null
var _jump_sprite: AnimatedSprite2D = null
var _crouch_sprite: AnimatedSprite2D = null
var _climb_sprite: AnimatedSprite2D = null
var _stand_shape: CollisionShape2D = null
var _crouch_shape: CollisionShape2D = null
var _stored_bonus := 0.0
var _crash_timer := 0.0
var _prev_vx := 0.0
var _coyote := 0.0
var _buffer := 0.0
var _attack_t := 0.0
var _spawn_pos := Vector2.ZERO
var _moved_logged := false
# Читы из консоли (команды god/noclip): см. VLSConsole.
var god_mode := false
var noclip_mode := false

const NOCLIP_SPEED := 700.0  # noclip: скорость свободного полёта


## Состояние «только что рывок» — для объектов (таран ящиков и будущих).
func is_dashing() -> bool:
	return dashing or _attack_t > 0.0


func _ready() -> void:
	# держать контакт с уходящей вниз платформой лифта (на прыжки не влияет)
	floor_snap_length = 6.0
	_ensure_keys()
	# спрайты из pleer.tscn: бегущий (6 кадров) и стоячий (1 кадр)
	_run_sprite = get_node_or_null("AnimatedSprite2D") as AnimatedSprite2D
	_idle_sprite = get_node_or_null("AnimatedSprite2D2") as AnimatedSprite2D
	_jump_sprite = get_node_or_null("JumpSprite") as AnimatedSprite2D
	_crouch_sprite = get_node_or_null("CrouchSprite") as AnimatedSprite2D
	_climb_sprite = get_node_or_null("ClimbSprite") as AnimatedSprite2D
	# два хитбокса из сцены: стойка и присед — скрипт только переключает их
	_stand_shape = get_node_or_null("StandShape") as CollisionShape2D
	_crouch_shape = get_node_or_null("CrouchShape") as CollisionShape2D
	_spawn_pos = global_position
	add_to_group("player")


func max_bonus() -> float:
	return SPEED * MAX_BONUS_RATIO


static func _bind_key(action: StringName, code: Key) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	if _has_key(action, code):
		return
	var ev := InputEventKey.new()
	ev.physical_keycode = code
	InputMap.action_add_event(action, ev)


static func _has_key(action: StringName, code: Key) -> bool:
	if not InputMap.has_action(action):
		return false
	for e in InputMap.action_get_events(action):
		if e is InputEventKey:
			var k := e as InputEventKey
			# Дефолтные события Godot хранят keycode (physical там 0!),
			# наши — physical_keycode. Смотрим оба поля, иначе мимо.
			if k.physical_keycode == code or k.keycode == code:
				return true
	return false


static func _unbind_key(action: StringName, code: Key) -> void:
	if not InputMap.has_action(action):
		return
	for e in InputMap.action_get_events(action):
		if e is InputEventKey:
			var k := e as InputEventKey
			if k.physical_keycode == code or k.keycode == code:
				InputMap.action_erase_event(action, e)


func _ensure_keys() -> void:
	# ходьба: стрелки + WASD
	_bind_key("ui_left", KEY_LEFT)
	_bind_key("ui_left", KEY_A)
	_bind_key("ui_right", KEY_RIGHT)
	_bind_key("ui_right", KEY_D)
	_bind_key("ui_up", KEY_UP)
	_bind_key("ui_up", KEY_W)
	_bind_key("ui_down", KEY_DOWN)
	_bind_key("ui_down", KEY_S)
	# прыжок: только C (пробел/Enter убраны — работают C, X, Z и стрелки).
	# W/Up освобождены под взгляд — иначе взгляд прыгал бы.
	_bind_key("ui_accept", KEY_C)
	_unbind_key("ui_accept", KEY_SPACE)
	_unbind_key("ui_accept", KEY_ENTER)
	_unbind_key("ui_accept", KEY_W)
	_unbind_key("ui_accept", KEY_UP)
	# рывок и хват
	_bind_key("dash", KEY_X)
	_bind_key("grab", KEY_Z)


func _do_ground_jump(direction: float, sneaking: bool) -> void:
	velocity.y = JUMP_VELOCITY
	# буст склона: толчок вдоль спуска, сила от крутизны
	if is_on_floor():
		var n := get_floor_normal()
		var steep := 1.0 - absf(n.y)
		if steep > 0.05:
			var d := Vector2(n.y, -n.x)
			if d.y < 0.0:
				d = -d
			velocity.x += d.x * steep * SLOPE_BOOST
	if direction != 0.0 and not sneaking:
		bonus_speed = minf(bonus_speed + BONUS_PER_HOP, max_bonus())


func _do_air_jump(power: float = 1.0) -> void:
	velocity.y = JUMP_VELOCITY * power


func _apply_hitbox(is_crouch: bool) -> void:
	# размеры заданы в сцене (визуальный контроль) — здесь только переключение
	if _stand_shape != null:
		_stand_shape.disabled = is_crouch
	if _crouch_shape != null:
		_crouch_shape.disabled = not is_crouch


func _can_stand() -> bool:
	if _stand_shape == null or _stand_shape.shape == null:
		return true
	var stand_rect := _stand_shape.shape as RectangleShape2D
	if stand_rect == null:
		return true
	var q := PhysicsShapeQueryParameters2D.new()
	var rect := RectangleShape2D.new()
	rect.size = stand_rect.size - Vector2(0.5, 0.5)
	q.shape = rect
	q.transform = global_transform * Transform2D(0, _stand_shape.position)
	q.exclude = [get_rid()]
	q.collision_mask = 1
	q.collide_with_areas = false
	q.collide_with_bodies = true
	return get_world_2d().direct_space_state.intersect_shape(q, 1).is_empty()


func _physics_process(delta: float) -> void:
	# При переходе уровня управление заморожено —
	# позицию не трогаем (map_data сам следит за прилипаниями).
	var md = _map_data()
	if md != null and md.has_method("frozen") and md.frozen():
		return
	# Noclip: сквозь стены — свободный полёт (move_and_slide не вызываем).
	if noclip_mode:
		var nv := Vector2(Input.get_axis("ui_left", "ui_right"), Input.get_axis("ui_up", "ui_down"))
		if Input.is_physical_key_pressed(KEY_W):
			nv.y -= 1.0
		if Input.is_physical_key_pressed(KEY_S):
			nv.y += 1.0
		nv.y = clampf(nv.y, -1.0, 1.0)
		global_position += nv * NOCLIP_SPEED * delta
		velocity = Vector2.ZERO
		_update_anim()
		global_position = global_position.round()
		return
	# God: бесконечные даблы и мгновенный рывок (урона в игре нет).
	if god_mode:
		air_jumps = MAX_AIR_JUMPS
		dash_ready = true
	var sneaking := Input.is_physical_key_pressed(KEY_SHIFT)
	var direction := Input.get_axis("ui_left", "ui_right")
	var up_held := Input.is_action_pressed("ui_up")
	var down_held := Input.is_action_pressed("ui_down")
	var grab_held := Input.is_action_pressed("grab")
	var grounded := is_on_floor()
	looking_up = up_held and not down_held

	# Таймеры чувства управления.
	if grounded:
		_coyote = COYOTE_TIME
	else:
		_coyote = maxf(_coyote - delta, 0.0)
	if _buffer > 0.0:
		_buffer -= delta

	# Присед — только на земле; встаём лишь при наличии места над головой.
	if down_held and grounded and not crouched:
		crouched = true
		_apply_hitbox(true)
	if crouched and not down_held and _can_stand():
		crouched = false
		_apply_hitbox(false)

	# Карабканье: держать Z + касаться вертикальной стены (трение-контакт).
	# Горизонталь жать НЕ надо: встал к стене, зажал Z, жмёшь вверх/вниз.
	# Вверх — экспоненциально медленнее, вниз — быстрый слайд, висеть — бесплатно.
	# on_vert_wall/wall_n ниже переиспользуют слайд и воллджамп.
	climbing = false
	var wall_n := Vector2.ZERO
	var on_vert_wall := false
	if not grounded and not crouched and is_on_wall():
		var wn := get_wall_normal()
		if absf(wn.x) > 0.7:
			on_vert_wall = true
			wall_n = wn
	if on_vert_wall and grab_held:
		climbing = true
		facing = -signf(wall_n.x)
	if direction != 0.0 and not climbing:
		facing = signf(direction)

	# Прыжок: с земли/койота — земной (копит бонус); из карабканья — climb-hop
	# (вверх + чуть от стены, в счёт усталости, дабл не ест); от стены —
	# воллджамп (нейтральный без ввода — строго вверх и ест дабл против лесенки);
	# в воздухе — один дабл вполсилы. Пустое нажатие — в буфер.
	# Прыжок в окно после удара — отмена возврата, копишь заново с нуля.
	if Input.is_action_just_pressed("ui_accept"):
		if _crash_timer > 0.0:
			_crash_timer = 0.0
			_stored_bonus = 0.0
		if grounded or _coyote > 0.0:
			_coyote = 0.0
			_buffer = 0.0
			air_jumps = MAX_AIR_JUMPS
			_do_ground_jump(direction, sneaking)
		elif climbing:
			climb_up_time += 0.6
			velocity.y = CLIMB_HOP_VY
			velocity.x = -signf(wall_n.x) * CLIMB_HOP_VX
			facing = -signf(wall_n.x)
		elif on_vert_wall:
			_coyote = 0.0
			_buffer = 0.0
			if direction == 0.0:
				if air_jumps > 0:
					air_jumps -= 1
					velocity.y = WALL_JUMP_VY
					velocity.x = 0.0
				else:
					_buffer = BUFFER_TIME
			else:
				var away := signf(wall_n.x)
				velocity.y = WALL_JUMP_VY
				var push := away * WALL_JUMP_VX
				if signf(velocity.x) == away:
					push = away * maxf(WALL_JUMP_VX, absf(velocity.x))
				velocity.x = push
				facing = away
		elif air_jumps > 0:
			air_jumps -= 1
			_do_air_jump(AIR_JUMP_POWER)
			_buffer = BUFFER_TIME
		else:
			_buffer = BUFFER_TIME

	# Рывок X: 8 сторон (нейтраль — по курсу); из приседа — никак (встань сначала).
	if Input.is_action_just_pressed("dash") and dash_ready and not crouched:
		var dvec := Vector2(Input.get_axis("ui_left", "ui_right"), Input.get_axis("ui_up", "ui_down"))
		if dvec.length() < 0.1:
			dvec = Vector2(facing, 0.0)
		dash_dir = dvec.normalized()
		dash_t = DASH_TIME
		dash_ready = false
		dashing = true

	# Переменная высота: отпустил рано на взлёте — срез (тап = низкий прыжок).
	if Input.is_action_just_released("ui_accept") and velocity.y < 0.0:
		velocity.y *= JUMP_CUT

	var target := direction * (SPEED + bonus_speed)
	if sneaking and grounded:
		target = direction * SNEAK_SPEED

	if climbing or dashing:
		pass  # гравитации нет, скорость задаётся ниже
	elif not grounded:
		velocity += get_gravity() * delta

	if dashing:
		velocity = dash_dir * DASH_SPEED
		dash_t -= delta
		if dash_t <= 0.0:
			dashing = false
	elif climbing:
		var vy_in := Input.get_axis("ui_up", "ui_down")
		var cvy := 0.0
		if vy_in < 0.0:
			climb_up_time += delta
			cvy = -CLIMB_MAX * exp(-climb_up_time / CLIMB_TAU)
		elif vy_in > 0.0:
			cvy = CLIMB_SLIDE
		velocity = Vector2(-signf(wall_n.x) * CLIMB_PUSH, cvy)
	elif grounded:
		if crouched:
			velocity.x = move_toward(velocity.x, 0.0, GROUND_FRICTION * delta)
		elif sneaking and direction != 0.0 and _ledge_blocked(direction):
			velocity.x = 0.0
		elif direction != 0.0:
			velocity.x = move_toward(velocity.x, target, GROUND_ACCEL * delta)
		else:
			velocity.x = move_toward(velocity.x, 0.0, GROUND_FRICTION * delta)
	else:
		if direction != 0.0:
			velocity.x = move_toward(velocity.x, target, AIR_ACCEL * delta)
		# без ввода — скорость сохраняется (воздушного трения нет)

	var pre_vx := velocity.x
	var pre_vy := velocity.y
	# Силы закрытых дверей: отталкивание (нет ключа) / притяжение и открытие (с ключом).
	# Накладываем ДО move_and_slide — скорость уже с учётом силы попадает в физику.
	_apply_door_forces(md, delta)
	move_and_slide()

	# Таран хрупкого ящика: по горизонтали хватает его break_speed
	# (обычный бег 400 его не берёт — только разгон с бонусом), а сверху/снизу
	# нужно ВДВОЕ больше — упасть надо очень сильно, прямо на ящик.
	# Ящик в щепки, себе оставляем 80%. Бонус при этом не замораживается.
	var smashed := false
	for i in range(get_slide_collision_count()):
		var collider := get_slide_collision(i).get_collider()
		if collider is VLSDestructible:
			var need: float = collider.break_speed
			if absf(pre_vx) > need or absf(pre_vy) > need * 2.0:
				collider.destroy()
				velocity *= SMASH_KEEP
				smashed = true
				break

	# Касание пола: дабл и рывок восстанавливаются, таймер карабканья тоже;
	# свежее нажатие — дожимаем земной прыжок сами.
	if is_on_floor():
		air_jumps = MAX_AIR_JUMPS
		dash_ready = true
		climb_up_time = 0.0
		if _buffer > 0.0:
			_buffer = 0.0
			_do_ground_jump(direction, sneaking)

	# Удар об угол/стену: резкая потеря горизонтали → бонус в заморозку на 0.5 с.
	# Не прыгаешь это время — бонус возвращается; прыгнул — копишь заново с нуля.
	# Таран ящика выше не считается ударом.
	if not smashed and is_on_wall() and _crash_timer <= 0.0 and absf(_prev_vx) > CRASH_MIN_SPEED and absf(velocity.x) < absf(_prev_vx) * 0.5:
		_stored_bonus = bonus_speed
		bonus_speed = 0.0
		_crash_timer = CRASH_WINDOW
	if _crash_timer > 0.0:
		_crash_timer -= delta
		if _crash_timer <= 0.0 and _stored_bonus > 0.0:
			bonus_speed = _stored_bonus
			_stored_bonus = 0.0
	_prev_vx = velocity.x
	if not _moved_logged and global_position.distance_to(_spawn_pos) > 100.0:
		_moved_logged = true
		VLSLog.info("[VLS] Player moving: ", global_position)
	_update_anim()
	# Пиксель-арт: держим тело на целых мировых пикселях. Иначе дробная фаза
	# камеры (ребёнок тела) гоняет границы пикселей карты по экрану — вибрация.
	global_position = global_position.round()


func _ledge_blocked(direction: float) -> bool:
	# впереди по курсу нет пола в пределах шага — дальше идти нельзя
	var from := global_position + Vector2(direction * LEDGE_AHEAD, -4.0)
	var query := PhysicsRayQueryParameters2D.create(from, from + Vector2(0, LEDGE_DOWN))
	query.exclude = [get_rid()]
	var hit := get_world_2d().direct_space_state.intersect_ray(query)
	return hit.is_empty()


## Первый узел из группы vls_map_data (обычно один) — для силы дверей и frozen().
func _map_data() -> Node:
	for n in get_tree().get_nodes_in_group("vls_map_data"):
		return n
	return null


## Силы закрытых дверей (см. VLSDoor): нет ключа — дверь отталкивает (чем ближе,
## тем сильнее); с ключом — притягивает к себе, а на достижении исчезает.
func _apply_door_forces(md, delta: float) -> void:
	if md == null or not md.has_method("has_key"):
		return
	var doors := get_tree().get_nodes_in_group("vls_doors")
	if doors.is_empty():
		return
	for d in doors:
		if not is_instance_valid(d) or not (d is VLSDoor):
			continue
		var door: VLSDoor = d
		var dist := VLSDoor.poly_dist(global_position, door.poly)
		if dist > VLSDoor.RANGE:
			continue
		var dir := Vector2(1.0, 0.0)
		if global_position.distance_squared_to(door.center) > 0.001:
			dir = (global_position - door.center).normalized()
		if md.has_key(door.key_index):
			if dist <= VLSDoor.REACH:
				door.destroy()
				continue
			var want := minf(VLSDoor.PULL_K / maxf(dist, 4.0), VLSDoor.PULL_MAX)
			var along := velocity.dot(dir)
			velocity -= dir * clampf(want - along, -VLSDoor.ACCEL * delta, VLSDoor.ACCEL * delta)
		else:
			var want := minf(VLSDoor.PUSH_K / maxf(dist, 4.0), VLSDoor.PUSH_MAX)
			var along := velocity.dot(dir)
			velocity += dir * clampf(want - along, -VLSDoor.ACCEL * delta, VLSDoor.ACCEL * delta)


## Анимация: присед — кадр приседа / ползком — цикл (на животе); в воздухе — прыжок;
## карабканье — цикл (арт юзера);
## TODO-АРТ: кадр взгляда вверх — ветвить здесь (сейчас взгляд без смены картинки).
## Иначе: на ходу — бег (темп от скорости), стоим — стоячий кадр; flip по курсу.
func _show_only(sprite: AnimatedSprite2D) -> void:
	for s in [_run_sprite, _idle_sprite, _jump_sprite, _crouch_sprite, _climb_sprite]:
		if s == null:
			continue
		var on: bool = s == sprite
		s.visible = on
		if on and not s.is_playing():
			s.play()
		if not on:
			s.stop()


func _update_anim() -> void:
	if _run_sprite == null or _idle_sprite == null:
		return
	for s in [_run_sprite, _idle_sprite, _jump_sprite, _crouch_sprite, _climb_sprite]:
		if s != null:
			s.flip_h = facing < 0.0
	if crouched and _crouch_sprite != null:
		if absf(velocity.x) > 20.0:
			_show_only(_crouch_sprite)
			_crouch_sprite.play("crawl")
		else:
			_show_only(_crouch_sprite)
			_crouch_sprite.play("crouch")
		return
	elif climbing:
		if _climb_sprite != null:
			_show_only(_climb_sprite)
			_climb_sprite.play("climb")
			_climb_sprite.position.x = -facing * CLIMB_ART_X
		else:
			_show_only(_run_sprite)
			_run_sprite.speed_scale = 0.5
		return
	elif not is_on_floor():
		if _jump_sprite != null:
			_show_only(_jump_sprite)
			_jump_sprite.play("jump")
			return
	elif absf(velocity.x) > 20.0:
		_show_only(_run_sprite)
		_run_sprite.speed_scale = clampf(absf(velocity.x) / SPEED, 0.7, 1.6)
	else:
		_show_only(_idle_sprite)
