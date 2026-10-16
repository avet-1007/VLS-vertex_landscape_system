# res://hotkeys_manager.gd  (Godot 4.5)
extends Node

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var is_f3: bool  = (event.keycode == KEY_F3)  or (event.physical_keycode == KEY_F3)
		var is_f11: bool = (event.keycode == KEY_F11) or (event.physical_keycode == KEY_F11)

		if is_f3:
			var new_state := not get_tree().debug_collisions_hint
			get_tree().debug_collisions_hint = new_state
			VLSLog.info("[F3] hitboxes -> ", new_state)
			get_viewport().set_input_as_handled()
			

		if is_f11:
			var win := get_window()
			win.mode = (Window.MODE_WINDOWED if win.mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN)
			VLSLog.info("[F11] fullscreen -> ", win.mode == Window.MODE_FULLSCREEN)
			get_viewport().set_input_as_handled()
			
