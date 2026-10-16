extends Control

@onready var p_start: Panel = $Panel/start
@onready var sedinks: Panel = $Panel/sedinks

func _process(_delta):
	if Input.is_action_just_pressed("ui_cancel"): # по умолчанию Esc
		get_tree().quit() #loading
		
func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_F11:
			_toggle_fullscreen()

func _toggle_fullscreen() -> void:
	if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	p_start.visible = true
	sedinks.visible = false
	call_deferred("_frame_menu_camera")
	get_viewport().size_changed.connect(_frame_menu_camera)


# Центрирует камеру меню на всём интерфейсе (арт TileMap + панели кнопок)
# и подбирает зум, чтобы всё было видно целиком. На ресайз — пересчёт.
func _frame_menu_camera() -> void:
	var cam := get_node_or_null("Camera2D") as Camera2D
	if cam == null:
		return
	var box := Rect2(Vector2.ZERO, Vector2.ZERO)
	var has := false
	for tp in ["Panel/start/TileMap", "Panel/start/TileMap2", "Panel/sedinks/TileMap"]:
		var tm := get_node_or_null(tp) as TileMap
		if tm == null or tm.tile_set == null:
			continue
		var used := tm.get_used_rect()
		if used.size.x <= 0 or used.size.y <= 0:
			continue
		var ts: Vector2 = tm.tile_set.tile_size
		var wr := Rect2(tm.position + Vector2(used.position) * ts, Vector2(used.size) * ts)
		box = wr if not has else box.merge(wr)
		has = true
	for pp in ["Panel/start", "Panel/sedinks"]:
		var pn := get_node_or_null(pp) as Control
		if pn == null:
			continue
		var gr := pn.get_global_rect()
		box = gr if not has else box.merge(gr)
		has = true
	if not has or box.size.x < 1.0 or box.size.y < 1.0:
		return
	var vp := get_viewport().get_visible_rect().size
	cam.position = box.get_center()
	# Точное вписывание без запасов: вид ровно по границам интерфейса,
	# никаких краёв снаружи. Зум больше = вид уже = ничего лишнего.
	var z := minf(vp.x / box.size.x, vp.y / box.size.y)
	z = clampf(z, 0.3, 4.0)
	cam.zoom = Vector2(z, z)

func anti_ready() -> void:
	p_start.visible = false
	sedinks.visible = true

func _on_start_game_pressed() -> void:
	get_tree().change_scene_to_file("res://Scenes/Scenes/map_data.tscn")


func _on_quit_pressed() -> void:
	get_tree().quit()

func _on_back_pressed() -> void:
	_ready()

func _on_settings_pressed() -> void:
	anti_ready()



func _on_create_pressed() -> void:
	get_tree().change_scene_to_file("res://Scenes/Scenes/create_level.tscn")
