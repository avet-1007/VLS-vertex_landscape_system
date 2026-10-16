class_name VLSPauseMenu
extends CanvasLayer

## Временная менюшка паузы (оформление потом): Esc — показать/скрыть,
## Backspace — выйти из игры. Живёт и на паузе (PROCESS_MODE_ALWAYS).

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	($UI as Control).visible = false
	(%ExitBtn as Button).pressed.connect(_on_exit)


func _input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		toggle()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey:
		var k := event as InputEventKey
		if k.pressed and not k.echo and k.physical_keycode == KEY_BACKSPACE:
			get_tree().quit()


func toggle() -> void:
	var ui := $UI as Control
	var show := not ui.visible
	ui.visible = show
	get_tree().paused = show


func _on_exit() -> void:
	get_tree().quit()
