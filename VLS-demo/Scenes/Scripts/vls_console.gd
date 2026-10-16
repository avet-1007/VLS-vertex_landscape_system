class_name VLSConsole
extends CanvasLayer

## Игровая консоль в духе id Software Quake: шторка сверху с полупрозрачным
## тёмным фоном, строка меню (Continue/Quit), лог и строка ввода «]».
## Esc или тильда — открыть/закрыть, при открытии мир ставится на паузу.
## Tab — автодополнение, ↑/↓ — история, PgUp/PgDn — прокрутка лога.
## Команда map <имя> вместо кнопочного селектора уровней.
## Все подсказки/сообщения — на английском (консоль всегда EN).

static var _open := false

const SLIDE_TIME := 0.18
const PANEL_RATIO := 0.6  # высота шторки — доля от окна

var _catcher: ColorRect = null   # блок кликов по миру под шторкой
var _panel: Panel = null
var _log: RichTextLabel = null
var _input_line: LineEdit = null
var _tween: Tween = null
var _history: PackedStringArray = PackedStringArray()
var _hist_pos := -1
var _draft := ""
var _pause_owner := false  # паузу поставили именно мы (а не степпер лифта)
var _cmds: Dictionary = {}  # имя -> [Callable, подсказка]


static func is_open() -> bool:
	return _open


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	layer = 110
	_register_cmds()
	_build_ui()
	var cb := Callable(self, "_on_log_line")
	if not VLSLog.sinks.has(cb):
		VLSLog.sinks.append(cb)
	for e in VLSLog.entries:
		_on_log_line(str(e.get("m", "")), int(e.get("l", 0)))
	set_open(false, true)


func _exit_tree() -> void:
	var cb := Callable(self, "_on_log_line")
	if VLSLog.sinks.has(cb):
		VLSLog.sinks.erase(cb)


func _input(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var k := event as InputEventKey
	if not k.pressed or k.echo:
		return
	var pc := k.physical_keycode
	if not VLSConsole._open:
		if pc == KEY_QUOTELEFT or pc == KEY_ESCAPE:
			VLSConsole.set_open_static(true)
			get_viewport().set_input_as_handled()
		return
	# Открыта: служебные клавиши перехватываем до LineEdit/игры.
	if pc == KEY_ESCAPE or pc == KEY_QUOTELEFT:
		set_open(false)
		get_viewport().set_input_as_handled()
	elif pc == KEY_TAB:
		_complete()
		get_viewport().set_input_as_handled()
	elif pc == KEY_UP:
		_hist_move(-1)
		get_viewport().set_input_as_handled()
	elif pc == KEY_DOWN:
		_hist_move(1)
		get_viewport().set_input_as_handled()
	elif pc == KEY_PAGEUP:
		_log_scroll(-10)
		get_viewport().set_input_as_handled()
	elif pc == KEY_PAGEDOWN:
		_log_scroll(10)
		get_viewport().set_input_as_handled()


## Открыть/закрыть шторку статически (для вызовов без инстанса).
static func set_open_static(v: bool) -> void:
	if _static_ref != null and is_instance_valid(_static_ref):
		_static_ref.set_open(v)


static var _static_ref: VLSConsole = null


func set_open(v: bool, instant: bool = false) -> void:
	if VLSConsole._open == v and not instant:
		return
	VLSConsole._open = v
	var vp_size := get_viewport().get_visible_rect().size
	var h := maxf(120.0, vp_size.y * PANEL_RATIO)
	if _tween != null:
		_tween.kill()
	if instant:
		_apply_slide(h, 1.0 if v else 0.0)
	else:
		var from := 0.0 if v else 1.0
		var to := 1.0 if v else 0.0
		var tw := create_tween()
		tw.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
		tw.tween_method(func(t: float): _apply_slide(h, t), from, to, SLIDE_TIME)
		_tween = tw
	_catcher.visible = v
	if v:
		# Паузу ставим, только если мир жил: степпер лифта мог держать паузу сам.
		_pause_owner = not get_tree().paused
		get_tree().paused = true
		_input_line.grab_focus()
		_hist_pos = -1
	else:
		if _pause_owner:
			get_tree().paused = false
		_pause_owner = false
		if _input_line != null:
			_input_line.release_focus()


func _apply_slide(h: float, t: float) -> void:
	# t = 0 — закрыта (шторка ушла вверх), t = 1 — полностью открыта.
	_panel.offset_top = lerpf(-h, 0.0, t)
	_panel.offset_bottom = lerpf(0.0, h, t)


func _on_log_line(m: String, lvl: int) -> void:
	if _log == null:
		return
	var col := Color(0.88, 0.87, 0.82)
	if lvl == 1:
		col = Color(1.0, 0.83, 0.35)
	elif lvl == 2:
		col = Color(1.0, 0.45, 0.45)
	_log.push_color(col)
	_log.add_text(m + "\n")
	_log.pop()


func _log_scroll(lines: int) -> void:
	var sb := _log.get_v_scroll_bar()
	var target := int(sb.value) + lines * 16
	sb.value = clampf(float(target), 0.0, sb.max_value)
	_log.scroll_following = float(target) + 8.0 >= sb.max_value - sb.page


func _hist_move(dir: int) -> void:
	if _history.is_empty():
		return
	if _hist_pos == -1:
		if dir < 0:
			_draft = _input_line.text
			_hist_pos = _history.size() - 1
			_set_input_text(str(_history[_hist_pos]))
		return
	_hist_pos += dir
	if _hist_pos < 0:
		_hist_pos = -1
		_set_input_text(_draft)
		return
	if _hist_pos >= _history.size():
		_hist_pos = _history.size()
		_set_input_text(_draft)
		return
	_set_input_text(str(_history[_hist_pos]))


func _set_input_text(t: String) -> void:
	_input_line.text = t
	_input_line.caret_column = t.length()


func _on_submit(txt: String) -> void:
	var t := txt.strip_edges()
	_input_line.text = ""
	_hist_pos = -1
	_draft = ""
	if t.is_empty():
		return
	if _history.is_empty() or str(_history[_history.size() - 1]) != t:
		_history.append(t)
	_on_log_line("]" + t, 0)   # эхо набранного, как в Quake
	_execute(t)
	_input_line.grab_focus()


func _execute(cmdline: String) -> void:
	var words := PackedStringArray()
	for w in cmdline.split(" ", false):
		words.append(w)
	if words.is_empty():
		return
	var cmd := str(words[0]).to_lower()
	var args := PackedStringArray()
	for i in range(1, words.size()):
		args.append(str(words[i]))
	if not _cmds.has(cmd):
		VLSLog.info("unknown command: ", words[0], "  (help for list)")
		return
	var entry: Array = _cmds[cmd]
	var fn := entry[0] as Callable
	fn.call(args)


# --- UI ---------------------------------------------------------------------

func _build_ui() -> void:
	var mono := SystemFont.new()
	mono.font_names = PackedStringArray(["Consolas", "Courier New", "DejaVu Sans Mono"])

	_catcher = ColorRect.new()
	_catcher.color = Color(0, 0, 0, 0)
	_catcher.mouse_filter = Control.MOUSE_FILTER_STOP
	_catcher.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_catcher.visible = false
	add_child(_catcher)

	_panel = Panel.new()
	_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	_panel.offset_top = -100.0
	_panel.offset_bottom = 0.0
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.11, 0.07, 0.05, 0.95)
	sb.border_color = Color(0, 0, 0, 1)
	sb.border_width_bottom = 1
	sb.border_width_left = 1
	sb.border_width_right = 1
	sb.content_margin_left = 8.0
	sb.content_margin_right = 8.0
	sb.content_margin_top = 5.0
	sb.content_margin_bottom = 8.0
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.add_theme_font_override("font", mono)
	add_child(_panel)

	# Верхняя светлая полоска-бевел, как у рамки консоли Quake.
	var bevel := ColorRect.new()
	bevel.color = Color(0.52, 0.52, 0.58, 0.9)
	bevel.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	bevel.offset_bottom = 2.0
	bevel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel.add_child(bevel)

	# Тёмный «шум» фона — имитация ржавого conback.
	var noise := TextureRect.new()
	noise.texture = _make_noise()
	noise.stretch_mode = TextureRect.STRETCH_SCALE
	noise.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	noise.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	noise.mouse_filter = Control.MOUSE_FILTER_IGNORE
	noise.modulate = Color(1, 1, 1, 0.22)
	_panel.add_child(noise)

	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 8)
	margin.add_theme_constant_override("margin_right", 8)
	margin.add_theme_constant_override("margin_top", 6)
	margin.add_theme_constant_override("margin_bottom", 2)
	_panel.add_child(margin)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	margin.add_child(box)

	# Строка меню: Continue / Quit + подсказка.
	var menu := HBoxContainer.new()
	menu.add_theme_constant_override("separation", 8)
	box.add_child(menu)
	var btn_cont := Button.new()
	btn_cont.text = "Continue"
	btn_cont.pressed.connect(func(): set_open(false))
	menu.add_child(btn_cont)
	var btn_quit := Button.new()
	btn_quit.text = "Quit"
	btn_quit.pressed.connect(func(): get_tree().quit())
	menu.add_child(btn_quit)
	var lbl_hint := Label.new()
	lbl_hint.text = "Esc / ~ — close · Tab — complete · ↑↓ — history · PgUp/PgDn — log"
	lbl_hint.add_theme_font_size_override("font_size", 12)
	lbl_hint.add_theme_color_override("font_color", Color(0.62, 0.62, 0.68))
	lbl_hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lbl_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	menu.add_child(lbl_hint)

	_log = RichTextLabel.new()
	_log.scroll_following = true
	_log.selection_enabled = true
	_log.fit_content = false
	_log.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_log.add_theme_font_size_override("normal_font_size", 14)
	_log.add_theme_font_size_override("bold_font_size", 14)
	_log.add_theme_color_override("default_color", Color(0.88, 0.87, 0.82))
	_log.mouse_filter = Control.MOUSE_FILTER_STOP
	box.add_child(_log)

	# Тонкая полная полоса-разделитель над строкой ввода, как в Quake.
	var sep := ColorRect.new()
	sep.color = Color(0.45, 0.45, 0.5, 0.7)
	sep.custom_minimum_size = Vector2(0, 1)
	sep.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sep.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(sep)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	box.add_child(row)
	var prompt := Label.new()
	prompt.text = "]"
	prompt.add_theme_font_size_override("font_size", 16)
	prompt.add_theme_color_override("font_color", Color(0.92, 0.92, 0.95))
	row.add_child(prompt)
	_input_line = LineEdit.new()
	_input_line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input_line.placeholder_text = "type a command and Enter (help for list)"
	_input_line.caret_blink = true
	_input_line.caret_blink_interval = 0.4
	_input_line.text_submitted.connect(_on_submit)
	_input_line.add_theme_font_size_override("font_size", 14)
	_input_line.add_theme_color_override("font_color", Color(0.95, 0.95, 0.95))
	_input_line.add_theme_color_override("placeholder_color", Color(0.5, 0.5, 0.5, 0.7))
	# Как в Quake: без рамки поля, голый текст на фоне консоли.
	var es := StyleBoxEmpty.new()
	_input_line.add_theme_stylebox_override("normal", es)
	_input_line.add_theme_stylebox_override("focus", es)
	row.add_child(_input_line)

	# Версия справа внизу, оранжевая — как «(GL 0.98) 1.09».
	var ver := Label.new()
	ver.text = "(VLS 0.1)"
	ver.add_theme_font_size_override("font_size", 12)
	ver.add_theme_color_override("font_color", Color(1.0, 0.62, 0.25))
	row.add_child(ver)

	VLSConsole._static_ref = self


func _make_noise() -> ImageTexture:
	var img := Image.create(96, 96, false, Image.FORMAT_RGBA8)
	for y in range(96):
		for x in range(96):
			var v := randf_range(26.0, 48.0)
			img.set_pixel(x, y, Color(v / 255.0, v / 255.0 * 0.9, v / 255.0 * 0.75))
	return ImageTexture.create_from_image(img)


# --- commands ----------------------------------------------------------------

func _register_cmds() -> void:
	_cmds = {
		"help": [Callable(self, "_cmd_help"), "help [cmd] — list commands / command help"],
		"map": [Callable(self, "_cmd_map"), "map <name> — load a map from maps-data"],
		"maps": [Callable(self, "_cmd_maps"), "maps — list maps in the folder"],
		"god": [Callable(self, "_cmd_god"), "god [0/1] — infinite jumps/dashes (no damage)"],
		"noclip": [Callable(self, "_cmd_noclip"), "noclip [0/1] — fly through walls (WASD + up/down)"],
		"kill": [Callable(self, "_cmd_kill"), "kill — respawn at the spawn point"],
		"give": [Callable(self, "_cmd_give"), "give keys — grant all level keys"],
		"timescale": [Callable(self, "_cmd_timescale"), "timescale <0.1..10> — game speed"],
		"fps": [Callable(self, "_cmd_fps"), "fps — current FPS"],
		"fullscreen": [Callable(self, "_cmd_fullscreen"), "fullscreen [0/1] — toggle fullscreen"],
		"hitboxes": [Callable(self, "_cmd_hitboxes"), "hitboxes [0/1] — show collision shapes"],
		"volume": [Callable(self, "_cmd_volume"), "volume <master|music|sfx> <0..1> — bus volume"],
		"getpos": [Callable(self, "_cmd_getpos"), "getpos — player position"],
		"clear": [Callable(self, "_cmd_clear"), "clear — clear console output"],
		"screenshot": [Callable(self, "_cmd_screenshot"), "screenshot — save a PNG to user://"],
		"copytex": [Callable(self, "_cmd_copytex"), "copytex <from> <to> — copy sector textures"],
		"editor": [Callable(self, "_cmd_editor"), "editor [0/1] — wireframe view: vertices, edges, connects (map textures hidden)"],
		"quit": [Callable(self, "_cmd_quit"), "quit — quit the game"],
	}


func _cmd_help(args: PackedStringArray) -> void:
	if args.size() >= 1 and _cmds.has(str(args[0]).to_lower()):
		var e: Array = _cmds[str(args[0]).to_lower()]
		VLSLog.info(str(e[1]))
		return
	var names := _cmds.keys()
	names.sort()
	var out := PackedStringArray()
	for n in names:
		out.append(str((_cmds[n] as Array)[1]))
	VLSLog.info("Commands:\n" + "\n".join(out))


func _map_data() -> VLSMapData:
	return get_tree().get_first_node_in_group("vls_map_data") as VLSMapData


func _player() -> CharacterBody2D:
	# В группе player лежат и корень-сцена, и само тело — ищем именно тело.
	for n in get_tree().get_nodes_in_group("player"):
		if n is CharacterBody2D:
			return n
	return null


func _cmd_map(args: PackedStringArray) -> void:
	var md := _map_data()
	if md == null:
		VLSLog.error("map: no map_data node in the scene.")
		return
	if args.is_empty():
		VLSLog.info("usage: map <name>  (map01, map01.vls or a path; see maps)")
		return
	var full := _resolve_map(md, str(args[0]))
	if full == "":
		VLSLog.warn("map: not found: ", args[0], "  (see maps)")
		return
	VLSLog.info("map: loading ", full)
	var ok := md.load_map(full)
	if not ok:
		VLSLog.error("map: failed to load ", full)


func _resolve_map(md: VLSMapData, what: String) -> String:
	var n := what.replace("res://", "")
	if FileAccess.file_exists(n):
		return n
	var dir_path := md.vls_path.get_base_dir()
	var direct := dir_path.path_join(n)
	var with_ext := direct if n.to_lower().ends_with(".vls") else direct + ".vls"
	if FileAccess.file_exists(with_ext):
		return with_ext
	# регистронезависимый поиск по папке
	var dir := DirAccess.open(dir_path)
	if dir != null:
		var want := with_ext.get_file().to_lower()
		var f := ""
		dir.list_dir_begin()
		f = dir.get_next()
		while f != "":
			if not dir.current_is_dir() and f.to_lower() == want:
				return dir_path.path_join(f)
			f = dir.get_next()
	return ""


func _cmd_maps(_args: PackedStringArray) -> void:
	var md := _map_data()
	var dir_path := md.vls_path.get_base_dir() if md != null else "res://Data/maps-data"
	var dir := DirAccess.open(dir_path)
	if dir == null:
		VLSLog.error("maps: cannot open folder: ", dir_path)
		return
	var files := PackedStringArray()
	var f := ""
	dir.list_dir_begin()
	f = dir.get_next()
	while f != "":
		if not dir.current_is_dir() and f.to_lower().ends_with(".vls"):
			files.append(f)
		f = dir.get_next()
	files.sort()
	VLSLog.info("Maps (", dir_path, "):\n" + "\n".join(files))


func _cmd_god(args: PackedStringArray) -> void:
	var p := _player()
	if p == null:
		VLSLog.warn("god: no player on the map.")
		return
	var v := _toggle_arg(args, bool(p.get("god_mode")))
	p.set("god_mode", v)
	VLSLog.info("god: ", "on" if v else "off")


func _cmd_noclip(args: PackedStringArray) -> void:
	var p := _player()
	if p == null:
		VLSLog.warn("noclip: no player on the map.")
		return
	var v := _toggle_arg(args, bool(p.get("noclip_mode")))
	p.set("noclip_mode", v)
	p.velocity = Vector2.ZERO
	VLSLog.info("noclip: ", "on" if v else "off")


func _toggle_arg(args: PackedStringArray, cur: bool) -> bool:
	if args.is_empty():
		return not cur
	var a := str(args[0]).to_lower()
	return a == "1" or a == "on" or a == "true" or a == "yes"


func _cmd_kill(_args: PackedStringArray) -> void:
	var md := _map_data()
	if md == null:
		return
	md.respawn_player()
	VLSLog.info("kill: respawned at the spawn point.")


func _cmd_give(_args: PackedStringArray) -> void:
	var md := _map_data()
	if md == null:
		return
	md.grant_all_keys()
	VLSLog.info("give: keys 0 and 1 granted.")


func _cmd_timescale(args: PackedStringArray) -> void:
	if args.is_empty():
		VLSLog.info("timescale: ", Engine.time_scale)
		return
	if not str(args[0]).is_valid_float():
		VLSLog.warn("timescale: number expected.")
		return
	var v := float(str(args[0]))
	if v <= 0.0:
		VLSLog.warn("timescale: number > 0 expected.")
		return
	Engine.time_scale = clampf(v, 0.1, 10.0)
	VLSLog.info("timescale: ", Engine.time_scale)


func _cmd_fps(_args: PackedStringArray) -> void:
	VLSLog.info("FPS: ", Engine.get_frames_per_second())


func _cmd_fullscreen(args: PackedStringArray) -> void:
	var win := get_window()
	var v := _toggle_arg(args, win.mode == Window.MODE_FULLSCREEN)
	win.mode = Window.MODE_FULLSCREEN if v else Window.MODE_WINDOWED
	VLSLog.info("fullscreen: ", "on" if v else "off")


func _cmd_hitboxes(args: PackedStringArray) -> void:
	var v := _toggle_arg(args, get_tree().debug_collisions_hint)
	get_tree().debug_collisions_hint = v
	VLSLog.info("hitboxes: ", "on" if v else "off")


func _cmd_volume(args: PackedStringArray) -> void:
	var buses := {"master": "Master", "music": "Music", "sfx": "SFX"}
	if args.size() < 2:
		var out := PackedStringArray()
		for key in ["master", "music", "sfx"]:
			var bidx := AudioServer.get_bus_index(str(buses[key]))
			var lin := db_to_linear(AudioServer.get_bus_volume_db(bidx))
			out.append("%s=%.2f" % [key, lin])
		VLSLog.info("volume: ", "  ".join(out), "  (usage: volume <bus> <0..1>)")
		return
	var bus_key := str(args[0]).to_lower()
	if not buses.has(bus_key):
		VLSLog.warn("volume: unknown bus: ", args[0], " (master|music|sfx)")
		return
	if not str(args[1]).is_valid_float():
		VLSLog.warn("volume: value must be 0..1.")
		return
	var v := clampf(float(str(args[1])), 0.0, 1.0)
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index(str(buses[bus_key])), linear_to_db(v))
	VLSLog.info("volume ", bus_key, " = ", v)


func _cmd_getpos(_args: PackedStringArray) -> void:
	var p := _player()
	if p == null:
		return
	VLSLog.info("getpos: ", p.global_position)


func _cmd_clear(_args: PackedStringArray) -> void:
	VLSLog.clear()
	_log.clear()


func _cmd_screenshot(_args: PackedStringArray) -> void:
	var img := get_viewport().get_texture().get_image()
	var fname := "user://shot_" + Time.get_datetime_string_from_system().replace(":", "-").replace("T", "_") + ".png"
	if img.save_png(fname) == OK:
		VLSLog.info("screenshot: ", ProjectSettings.globalize_path(fname))
	else:
		VLSLog.error("screenshot: save failed: ", fname)


func _cmd_copytex(args: PackedStringArray) -> void:
	var md := _map_data()
	if md == null:
		return
	if args.size() < 2:
		VLSLog.info("usage: copytex <from> <to>   e.g.: copytex 3 7  (sector ids)")
		return
	if not str(args[0]).is_valid_int() or not str(args[1]).is_valid_int():
		VLSLog.warn("copytex: sector ids must be integers.")
		return
	var err := md.copy_sector_textures(str(args[0]).to_int(), str(args[1]).to_int())
	if err != "":
		VLSLog.warn("copytex: ", err)
		return
	md.rebuild_map()
	VLSLog.info("copytex: textures S", args[0], " -> S", args[1], " copied, map rebuilt in memory (not written to .vls).")


func _cmd_editor(args: PackedStringArray) -> void:
	var ev := get_tree().get_first_node_in_group("vls_editor_view")
	if ev == null:
		VLSLog.warn("editor: no map loaded.")
		return
	var v := _toggle_arg(args, bool(ev.call("is_active")))
	ev.call("set_view", v)
	VLSLog.info("editor: ", "on" if v else "off")


func _cmd_quit(_args: PackedStringArray) -> void:
	get_tree().quit()


# --- Tab-автодополнение -----------------------------------------------------

func _complete() -> void:
	var cur := _input_line.text
	var ends_space := cur.ends_with(" ")
	var words := PackedStringArray()
	for w in cur.split(" ", false):
		words.append(w)
	var fragment := ""
	var ctx := ""
	if ends_space:
		if words.size() >= 1:
			ctx = str(words[words.size() - 1]).to_lower()
	elif not words.is_empty():
		fragment = str(words[words.size() - 1])
		if words.size() >= 2:
			ctx = str(words[words.size() - 2]).to_lower()
	var base := cur.substr(0, cur.length() - fragment.length())
	var cands := PackedStringArray()
	if ctx == "":
		for n in _cmds.keys():
			if str(n).begins_with(fragment.to_lower()):
				cands.append(str(n))
	elif ctx == "map":
		for s in _map_stems():
			if s.begins_with(fragment.to_lower()):
				cands.append(s)
	elif ctx == "copytex":
		for s in _sector_ids():
			if s.begins_with(fragment):
				cands.append(s)
	if cands.is_empty():
		return
	if cands.size() == 1:
		var add_space := ctx == ""
		_input_line.text = base + str(cands[0]) + (" " if add_space else "")
		_input_line.caret_column = _input_line.text.length()
	else:
		cands.sort()
		VLSLog.info("  ".join(cands))


func _map_stems() -> PackedStringArray:
	var out := PackedStringArray()
	var md := _map_data()
	var dir_path := md.vls_path.get_base_dir() if md != null else "res://Data/maps-data"
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return out
	var f := ""
	dir.list_dir_begin()
	f = dir.get_next()
	while f != "":
		if not dir.current_is_dir() and f.to_lower().ends_with(".vls"):
			var stem := f.get_basename().to_lower()
			if not out.has(stem):
				out.append(stem)
		f = dir.get_next()
	return out


func _sector_ids() -> PackedStringArray:
	var out := PackedStringArray()
	var md := _map_data()
	if md == null:
		return out
	var tex: Dictionary = md.map_raw.get("textures", {})
	var by_sec: Dictionary = tex.get("sectors", {})
	for k in by_sec.keys():
		out.append(str(k))
	return out
