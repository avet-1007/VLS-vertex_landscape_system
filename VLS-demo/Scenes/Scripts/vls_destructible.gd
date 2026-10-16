class_name VLSDestructible
extends StaticBody2D

## ВРЕМЕННО: хрупкий объект (деревянный ящик из редактора, fragile).
## Клик/тап по нему — исчезнуть. Уберём после добавления оружия.
## Метод destroy() — та же смерть: сюда потом будут прилетать пули,
## т.е. оружию достаточно вызвать destroy() вместо клика.
## Каменные (stone) сектора — не хрупкие, их тут нет специально.

var sector_id := -1
# Порог тарана: какая горизонтальная скорость его ломает. Ставит построитель
# по размеру ящика (большие — тяжелее). Обычный бег (400) мелочь берёт только с бонусом.
var break_speed := 430.0


func _ready() -> void:
	input_event.connect(_on_input_event)


func _on_input_event(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			destroy()
	elif event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			destroy()


func destroy() -> void:
	VLSLog.info("[VLS] Fragile sector S", sector_id, " destroyed.")
	for n in get_tree().get_nodes_in_group("vls_map_data"):
		if n.has_method("unregister_solid"):
			n.unregister_solid(sector_id)
	queue_free()
