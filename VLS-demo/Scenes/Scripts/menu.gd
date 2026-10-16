extends Control

const GAME_SCENE := "res://Scenes/Scenes/map_data.tscn"
const PREVIEW_SCENE := "res://Scenes/Scenes/clouds_preview.tscn"
const BAND_MAX_HALF := 300.0
const BAND_SCREEN_SHARE := 0.42
# Камера рисует небо в это раз мельче экрана (пиксель шейдера = SKY_DIV экрана).
const SKY_DIV := 4
const TITLE_SIZE := 150.0

@onready var start_page: VBoxContainer = $Center/Margin/Menu/StartPage
@onready var settings_page: VBoxContainer = $Center/Margin/Menu/SettingsPage
@onready var title: Label = $Center/Margin/Menu/StartPage/Title
@onready var band_fill: ColorRect = $Band/Fill
@onready var band_grad_l: TextureRect = $Band/GradL
@onready var band_grad_r: TextureRect = $Band/GradR
@onready var sky: SubViewport = $SkyView/Sky
@onready var sky_cam: Camera3D = $SkyView/Sky/Camera3D
@onready var sky_rect: TextureRect = $SkyView
@onready var lang_sel: OptionButton = $Center/Margin/Menu/SettingsPage/RowLang/LangSel

func _ready() -> void:
	start_page.visible = true
	settings_page.visible = false
	sky_rect.texture = sky.get_texture()
	_sync_sky_camera()
	get_viewport().size_changed.connect(_fit_layout)
	_fit_layout()
	lang_sel.clear()
	lang_sel.add_item("English", 0)
	lang_sel.add_item("Русский", 1)
	lang_sel.select(0 if VLSLang.lang() == "en" else 1)
	lang_sel.item_selected.connect(_on_lang_selected)
	_apply_lang()

# Меню берёт наклон у 3D-камеры из clouds_preview: как повернёшь её
# вручную в инспекторе, такой же угол и появится в меню.
func _sync_sky_camera() -> void:
	var packed := load(PREVIEW_SCENE) as PackedScene
	if packed == null:
		return
	var prev := packed.instantiate()
	var src := prev.get_node_or_null("Camera3D") as Camera3D
	if src != null:
		sky_cam.rotation = src.rotation
	prev.free()

func _fit_layout() -> void:
	var vp := get_viewport().get_visible_rect().size
	if vp.x < 1.0:
		return
	# Низкое разрешение вывода камеры: шейдер рисует в SKY_DIV раз мельче,
	# растягивается без сглаживания (nearest) — крупный пиксель шейдера.
	var sky_w := maxi(1, int(vp.x) / SKY_DIV)
	var sky_h := maxi(1, int(vp.y) / SKY_DIV)
	sky.size = Vector2i(sky_w, sky_h)
	var w := minf(BAND_MAX_HALF * 2.0, vp.x * BAND_SCREEN_SHARE * 2.0)
	# Градиент у чёрной полосы шириной ровно в один пиксель шейдера.
	var g := minf(vp.x / float(sky_w), vp.x * 0.25)
	var left := (vp.x - w) * 0.5
	band_fill.position = Vector2(left, 0.0)
	band_fill.size = Vector2(w, vp.y)
	band_grad_l.position = Vector2(left - g, 0.0)
	band_grad_l.size = Vector2(g, vp.y)
	band_grad_r.position = Vector2(left + w, 0.0)
	band_grad_r.size = Vector2(g, vp.y)
	var size := TITLE_SIZE
	if vp.x < 760.0:
		size = clampf(vp.x * 0.2, 64.0, TITLE_SIZE)
	title.add_theme_font_size_override("font_size", int(size))

func _show_settings(on: bool) -> void:
	settings_page.visible = on
	start_page.visible = not on

func _on_lang_selected(idx: int) -> void:
	VLSLang.set_lang("en" if idx == 0 else "ru")
	_apply_lang()


## Перевод текстов меню: en / ru (пока только эти два языка).
func _apply_lang() -> void:
	var en := VLSLang.lang() == "en"
	var texts := {
		"Center/Margin/Menu/StartPage/Play": ["Play", "Играть"],
		"Center/Margin/Menu/StartPage/Settings": ["Settings", "Настройки"],
		"Center/Margin/Menu/StartPage/Quit": ["Quit", "Выход"],
		"Center/Margin/Menu/SettingsPage/Heading": ["Settings", "Настройки"],
		"Center/Margin/Menu/SettingsPage/RowLang/Label": ["Language", "Язык"],
		"Center/Margin/Menu/SettingsPage/Fullscreen": ["Fullscreen", "Полный экран"],
		"Center/Margin/Menu/SettingsPage/Back": ["Back", "Назад"],
	}
	for p in texts:
		var n := get_node_or_null(p)
		if n != null:
			n.text = texts[p][0] if en else texts[p][1]


func _on_play_pressed() -> void:
	get_tree().change_scene_to_file(GAME_SCENE)

func _on_settings_pressed() -> void:
	_show_settings(true)

func _on_back_pressed() -> void:
	_show_settings(false)

func _on_quit_pressed() -> void:
	get_tree().quit()

func _toggle_fullscreen() -> void:
	if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)

func _input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_F11:
			_toggle_fullscreen()
		KEY_ESCAPE:
			if settings_page.visible:
				_show_settings(false)
			else:
				get_tree().quit()
