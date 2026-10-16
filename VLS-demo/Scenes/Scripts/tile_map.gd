extends TileMap

#################################
# НАСТРОЙКИ

@export var camera_path: NodePath
@export var shift_value := 500.0
@export var duration := 0.19
@export var trans := Tween.TRANS_SINE
@export var ease := Tween.EASE_IN_OUT

@export var zoom_near := Vector2(1.4, 1.4)   # зум, когда TileMap внизу
@export var zoom_far  := Vector2(1.3, 1.3)   # зум, когда TileMap наверху
@export var move_camera_with_tilemap := false

# --- АУДИО (оглушение музыки) ---
@export var music_bus_name := "Music"  # имя шины в микшере
@export var music_db_normal := -6.0    # обычный уровень (дБ), подстрой под свой проект
@export var music_db_duck   := -14.0   # «оглушённый» уровень (дБ)

#################################

var _base_y: float
var _is_up := false
var _tween: Tween
var _cam: Camera2D

# audio
var _music_bus := -1

func _ready() -> void:
	_base_y = position.y

	# камера
	if camera_path != NodePath():
		_cam = get_node_or_null(camera_path) as Camera2D
	if _cam == null:
		_cam = get_viewport().get_camera_2d()
	if _cam and !_cam.is_current():
		_cam.make_current()
	if _cam == null:
		VLSLog.warn("Camera2D not found: zoom will not change.")

	# шина музыки
	_music_bus = AudioServer.get_bus_index(music_bus_name)
	if _music_bus == -1:
		VLSLog.warn("Bus '%s' not found. Check the name in the mixer." % music_bus_name)
	else:
		# зафиксируем стартовый уровень (на всякий)
		AudioServer.set_bus_volume_db(_music_bus, music_db_normal)

func _process(_delta: float) -> void:
	if Input.is_action_just_pressed("ui_focus_next"): # Tab
		_toggle_move()

func _toggle_move() -> void:
	# гасим предыдущий твин
	if is_instance_valid(_tween):
		_tween.kill()

	var next_up := !_is_up
	var target_y := _base_y - shift_value if next_up else _base_y
	var target_zoom := zoom_far if next_up else zoom_near

	_tween = create_tween()
	_tween.set_trans(trans).set_ease(ease)

	# Двигаем TileMap
	_tween.tween_property(self, "position", Vector2(position.x, target_y), duration)

	# Зум камеры
	if _cam:
		_tween.parallel().tween_property(_cam, "zoom", target_zoom, duration)

		# (опционально) смещать камеру вместе с тайлмапом
		if move_camera_with_tilemap:
			var cam_target_pos := _cam.position
			cam_target_pos.y = _cam.position.y - shift_value if next_up else _cam.position.y + shift_value
			_tween.parallel().tween_property(_cam, "position", cam_target_pos, duration)

	# Оглушение музыки (плавно меняем громкость шины Music)
	if _music_bus != -1:
		var from_db := AudioServer.get_bus_volume_db(_music_bus)
		var to_db := music_db_duck if next_up else music_db_normal
		_tween.parallel().tween_method(_set_music_db, from_db, to_db, duration)

	_is_up = next_up

# коллбек для tween_method
func _set_music_db(db: float) -> void:
	if _music_bus != -1:
		AudioServer.set_bus_volume_db(_music_bus, db)
