extends Node2D

enum Tool {
	NONE,
	LINE,
	SECTOR,
	SEL
}

var current_tool = Tool.NONE

const GRID_SIZE := 16

var zoom := 1.0
var zoom_min := 0.3
var zoom_max := 3.0

var dragging_world = false

# LINE
var has_first_point = false
var first_point = Vector2.ZERO
var preview_point = Vector2.ZERO

# ERASE
var erase_mode = false
var erase_start = Vector2.ZERO
var erase_end = Vector2.ZERO

# SECTOR
var sector_preview_pos = Vector2.ZERO
var sector_radius := 25   # 🔥 уменьшили

# SELECT / MOVE
var selected_sector = null
var dragging_sector = false
var drag_start_mouse = Vector2.ZERO
var drag_start_offset = Vector2.ZERO

# HISTORY
var move_history = []

# DATA
var lines = []
var sector_groups = []


# ================= INIT =================

func _ready():
	add_to_group("level_view")
	VLSLog.info("LEVEL_VIEW READY:", self)

	# 🔥 кнопка выбора инструмента
	var sel_btn = get_node_or_null("Camera2D/ui/tool_buton/Sprite2D/sel")
	if sel_btn:
		sel_btn.gui_input.connect(_on_sel_pressed)


func _on_sel_pressed(event):
	if event is InputEventMouseButton and event.pressed:
		enable_select_tool()


# ================= TOOLS =================

func enable_line_tool():
	current_tool = Tool.LINE
	has_first_point = false


func enable_sector_tool():
	current_tool = Tool.SECTOR
	has_first_point = false


func enable_select_tool():
	current_tool = Tool.SEL
	selected_sector = null
	VLSLog.info("SELECT TOOL ENABLED")


# ================= INPUT =================

func _input(event):

	# HOTKEYS
	if Input.is_action_just_pressed("1"):
		enable_line_tool()

	if Input.is_action_just_pressed("2"):
		enable_sector_tool()

	if Input.is_action_just_pressed("3"):
		enable_select_tool()

	var raw_mouse = to_local(get_global_mouse_position())
	var mouse_pos = snap_to_grid(raw_mouse)

	# движение камеры
	if event is InputEventMouseMotion:

		if dragging_world:
			position += event.relative

		if current_tool == Tool.LINE and has_first_point:
			preview_point = mouse_pos

		if erase_mode:
			erase_end = raw_mouse

		if current_tool == Tool.SECTOR:
			sector_preview_pos = raw_mouse

		# 🔥 ДВИЖЕНИЕ СЕКТОРА
		if current_tool == Tool.SEL and dragging_sector and selected_sector != null:
			var delta = raw_mouse - drag_start_mouse
			selected_sector["offset"] = drag_start_offset + delta

		queue_redraw()


	# zoom
	if event is InputEventMouseButton:

		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			set_zoom(zoom / 1.1)

		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			set_zoom(zoom * 1.1)


	# drag камеры
	if event is InputEventMouseButton \
	and event.button_index == MOUSE_BUTTON_MIDDLE:

		dragging_world = event.pressed


	# ЛКМ
	if event is InputEventMouseButton \
	and event.button_index == MOUSE_BUTTON_LEFT:

		if event.pressed:

			match current_tool:

				Tool.LINE:
					if !has_first_point:
						first_point = mouse_pos
						has_first_point = true
					else:
						lines.append([first_point, mouse_pos])
						has_first_point = false
						current_tool = Tool.NONE

				Tool.SECTOR:
					try_create_sector(raw_mouse)
					current_tool = Tool.NONE

				Tool.SEL:
					selected_sector = pick_sector(raw_mouse)

					if selected_sector != null:
						dragging_sector = true
						drag_start_mouse = raw_mouse
						drag_start_offset = selected_sector["offset"]

		else:
			# отпускание
			if dragging_sector and selected_sector != null:

				move_history.append({
					"sector": selected_sector,
					"from": drag_start_offset,
					"to": selected_sector["offset"]
				})

				VLSLog.info("MOVED:", drag_start_offset, "->", selected_sector["offset"])

			dragging_sector = false

		queue_redraw()


	# ПКМ (стирание)
	if event is InputEventMouseButton \
	and event.button_index == MOUSE_BUTTON_RIGHT:

		if event.pressed:
			erase_mode = true
			erase_start = raw_mouse
			erase_end = raw_mouse
		else:
			erase_mode = false
			check_erase()

		queue_redraw()



# ================= ZOOM =================

func set_zoom(new_zoom):

	var mouse = get_global_mouse_position()
	var before = to_local(mouse)

	zoom = clamp(new_zoom, zoom_min, zoom_max)
	scale = Vector2(zoom, zoom)

	var after = to_local(mouse)
	position += (after - before) * scale



# ================= SECTOR =================

func try_create_sector(pos):

	var groups = get_line_groups()

	for group in groups:
		if is_group_closed(group) and point_inside_group(pos, group):

			sector_groups.append({
				"lines": group,
				"offset": Vector2.ZERO
			})

			VLSLog.info("SECTOR CREATED")
			return



func pick_sector(pos):

	for sector in sector_groups:

		var polygon = build_polygon(sector["lines"])
		if polygon.size() < 3:
			continue

		var shifted = []
		for p in polygon:
			shifted.append(p + sector["offset"])

		if Geometry2D.is_point_in_polygon(pos, shifted):
			return sector

	return null



func point_inside_group(point, group):

	var polygon = build_polygon(group)

	if polygon.size() < 3:
		return false

	return Geometry2D.is_point_in_polygon(point, polygon)



func build_polygon(group):

	var points = []
	var used = []

	var first = group[0]
	points.append(first[0])
	points.append(first[1])

	var current = first[1]
	used.append(first)

	while true:

		var found = false

		for l in group:
			if l in used:
				continue

			if l[0] == current:
				points.append(l[1])
				current = l[1]
				used.append(l)
				found = true
				break

			elif l[1] == current:
				points.append(l[0])
				current = l[0]
				used.append(l)
				found = true
				break

		if not found:
			break

		if current == points[0]:
			break

	if points.size() >= 3 and points[0] == points[-1]:
		points.pop_back()
		return points

	return []



# ================= DRAW =================

func _draw():

	draw_grid()

	var groups = get_line_groups()

	for group in groups:

		var closed = is_group_closed(group)
		var is_sector = is_same_group(group)

		var offset = Vector2.ZERO

		if is_sector:
			for s in sector_groups:
				if s["lines"] == group:
					offset = s["offset"]
					break

		for l in group:
			draw_surface(l[0] + offset, l[1] + offset, false, closed, is_sector)

	if current_tool == Tool.LINE and has_first_point:
		draw_surface(first_point, preview_point, true, false, false)

	if erase_mode:
		draw_gradient_line(erase_start, erase_end)

	if current_tool == Tool.SECTOR:
		draw_circle(sector_preview_pos, sector_radius, Color(0.7, 0.7, 0.7, 0.2))  # 🔥 серый



# ================= DRAW LINE =================

func draw_surface(a,b,preview,closed,is_sector):

	var color = Color.WHITE

	if preview:
		color.a = 0.4

	draw_line(a,b,color,4)
	draw_circle(a,2,color)
	draw_circle(b,2,color)

	draw_perpendicular(a,b,preview,closed,is_sector)



func draw_perpendicular(a,b,preview,closed,is_sector):

	var mid = (a+b)/2
	var dir = (b-a).normalized()
	var perp = Vector2(-dir.y,dir.x)

	var size = 6

	var color = Color(0.647, 0.365, 0.055)

	if closed:
		color = Color(0.502, 0.694, 0.502)

	if is_sector:
		color = Color(0.479, 0.494, 0.587)

	if preview:
		color.a = 0.4

	draw_line(mid - perp*size, mid + perp*size, color, 2)



# ================= GROUPS =================

func get_line_groups():

	var groups = []
	var unused = lines.duplicate()

	while unused.size() > 0:

		var group = []
		var stack = [unused.pop_back()]

		while stack.size() > 0:

			var current = stack.pop_back()
			group.append(current)

			var to_add = []

			for l in unused:
				if shares_point(current, l):
					to_add.append(l)

			for l in to_add:
				stack.append(l)
				unused.erase(l)

		groups.append(group)

	return groups



func shares_point(a,b):

	return a[0] == b[0] or a[0] == b[1] \
	or a[1] == b[0] or a[1] == b[1]



func is_same_group(group):

	for g in sector_groups:
		if g["lines"] == group:
			return true
	return false



# ================= CLOSED =================

func is_group_closed(group):

	if group.size() < 3:
		return false

	var counts = {}

	for l in group:
		counts[l[0]] = counts.get(l[0],0)+1
		counts[l[1]] = counts.get(l[1],0)+1

	for k in counts:
		if counts[k] != 2:
			return false

	return true



# ================= GRID =================

func snap_to_grid(p):
	return Vector2(round(p.x/GRID_SIZE)*GRID_SIZE, round(p.y/GRID_SIZE)*GRID_SIZE)



func draw_grid():

	var col = Color(0,0,0,0.25)

	for x in range(-2000,2000,GRID_SIZE):
		draw_line(Vector2(x,-2000),Vector2(x,2000),col)

	for y in range(-2000,2000,GRID_SIZE):
		draw_line(Vector2(-2000,y),Vector2(2000,y),col)



# ================= ERASE =================

func draw_gradient_line(a,b):

	var steps = 20

	for i in range(steps):
		var t1 = float(i)/steps
		var t2 = float(i+1)/steps

		var p1 = a.lerp(b,t1)
		var p2 = a.lerp(b,t2)

		var color = Color(1-t1,1-t1,1-t1)
		draw_line(p1,p2,color,6)



func check_erase():

	var new_lines = []

	for l in lines:
		if !segments_intersect(l[0],l[1],erase_start,erase_end):
			new_lines.append(l)

	lines = new_lines
	queue_redraw()



func segments_intersect(a,b,c,d):

	return ccw(a,c,d) != ccw(b,c,d) \
	and ccw(a,b,c) != ccw(a,b,d)



func ccw(a,b,c):

	return (c.y-a.y)*(b.x-a.x) > (b.y-a.y)*(c.x-a.x)
