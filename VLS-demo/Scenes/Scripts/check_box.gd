extends CheckBox

func _ready() -> void:
	# Устанавливаем начальное состояние кнопки по текущему режиму окна
	button_pressed = DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
	
	# Подключаем сигнал, если он не подключен вручную
	if not toggled.is_connected(_on_toggled):
		toggled.connect(_on_toggled)

func _on_toggled(toggled_on: bool) -> void:
	if toggled_on:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
