class_name VLSParser
extends RefCounted

## Парсер текстового формата .vls из VLS-редактора (VLS MAP v1).
## Читает то, что пишет кнопка «Выгрузить карту»: секции
## [vertices] [lines] [sectors] [connects] [things] [triggers] [lifts] [textures] [summary].
##
## Использование:
##   var f := FileAccess.open("res://Data/maps-data/map01.vls", FileAccess.READ)
##   var data := VLSParser.parse_text(f.get_as_text())
##
## Возвращает Dictionary:
##   name, version, units_per_cell,
##   vertices: {id:int -> Vector2},
##   lines: [{id,a,b,tex,flags,free,step}], flags "0"/"1"/"2" ("2" = портал, проходимая),
##   sectors: [{id,verts, floor_tex,wall_tex,height,flags,offset:Vector2,stone,fragile,close:"0"/"1",finish:bool,outline:bool}],
##   connects: [{id,line,line2}], things: [{id,type,name,x,y,slot,sector}],
##   triggers: [{id,tid,type,ticks,x1,y1,x2,y2}],
##   lifts: [{id,sector,curve,sec,zero_id,zero_type,floors:[{x,y,name,caller_id,caller_type}]}],
##   textures: {atlas:Vector2i, sectors:{"<id>":[{index,id,name,color,visible,items:[{id,x,y,rx,ry,rw,rh,pw,ph}]}]},
##              world:[{id,x,y,w,h,rx,ry,rw,rh,name,visible}]},   // секция [textures]
##   errors: [String] — битые строки (не роняют разбор).
## id существ и привязок — всегда String (коды A000/B012...), остальное — int/float.
## Система координат 1:1 с редактором (обе Y вниз), флип не нужен.

static func parse_text(text: String) -> Dictionary:
	var m := {
		"name": "map01", "version": "VLS.1", "units_per_cell": 40,
		"vertices": {}, "lines": [], "sectors": [], "connects": [],
		"things": [], "triggers": [], "lifts": [], "errors": [],
		"textures": {"atlas": Vector2i.ZERO, "sectors": {}, "world": []},
	}
	var section := ""
	for raw in text.split("\n"):
		var line := raw.strip_edges()
		if line == "" or line.begins_with("//") or line.begins_with("#"):
			continue
		if line.begins_with("[") and line.ends_with("]"):
			section = line.substr(1, line.length() - 2).strip_edges()
			continue
		if section == "":
			var eq := line.find("=")
			if eq >= 0:
				var k := line.substr(0, eq).strip_edges()
				var v := line.substr(eq + 1).strip_edges()
				if k == "name":
					m["name"] = v
				elif k == "version":
					m["version"] = v
				elif k == "units_per_cell" and v.is_valid_int():
					m["units_per_cell"] = v.to_int()
			continue
		if section == "vertices":
			_parse_vertices(m, line)
		elif section == "lines":
			_parse_lines(m, line)
		elif section == "sectors":
			_parse_sectors(m, line)
		elif section == "connects":
			_parse_connects(m, line)
		elif section == "things":
			_parse_things(m, line)
		elif section == "triggers":
			_parse_triggers(m, line)
		elif section == "lifts":
			_parse_lifts(m, line)
		elif section == "textures":
			_parse_textures(m, line)
		# [summary] и неизвестные секции — пропускаем (информативные)
	return m


static func _num(s: String) -> float:
	var t := s.strip_edges()
	if t.is_valid_float():
		return t.to_float()
	return 0.0


static func _int(s: String, fallback: int = 0) -> int:
	var t := s.strip_edges()
	if t.is_valid_int():
		return t.to_int()
	return fallback


static func _parse_vertices(m: Dictionary, line: String) -> void:
	var p := line.split(",")
	if p.size() < 3:
		m["errors"].append("bad vertex: " + line)
		return
	if not p[0].strip_edges().is_valid_int():
		m["errors"].append("bad vertex id: " + line)
		return
	m["vertices"][p[0].strip_edges().to_int()] = Vector2(_num(p[1]), _num(p[2]))


static func _parse_lines(m: Dictionary, line: String) -> void:
	var p := line.split(",")
	if p.size() < 5 or not p[0].strip_edges().is_valid_int():
		m["errors"].append("bad line: " + line)
		return
	var ln := {
		"id": p[0].strip_edges().to_int(),
		"a": _int(p[1]), "b": _int(p[2]),
		"tex": p[3].strip_edges(), "flags": p[4].strip_edges(),
		"free": false, "step": false,
	}
	for i in range(5, p.size()):
		var tok := p[i].strip_edges()
		if tok == "free":
			ln["free"] = true
		elif tok == "step":
			ln["step"] = true
	m["lines"].append(ln)


static func _thing_from_fields(f: PackedStringArray, sector_id: int) -> Dictionary:
	# поля id:type:x:y:slot:name (имя без разделителей по контракту экспорта;
	# хвост склеиваем обратно на случай ручной правки файла)
	var nm := ""
	if f.size() > 5:
		nm = ":".join(f.slice(5)).strip_edges()
	return {
		"id": f[0].strip_edges(),
		"type": f[1].strip_edges() if f.size() > 1 else "",
		"x": _num(f[2]) if f.size() > 2 else 0.0,
		"y": _num(f[3]) if f.size() > 3 else 0.0,
		"slot": _int(f[4], 1) if f.size() > 4 else 1,
		"name": nm,
		"sector": sector_id,
	}


static func _upsert_thing(m: Dictionary, t: Dictionary) -> void:
	# [things] перекрывает inline-списки секторов: последний выигрывает
	for i in range(m["things"].size()):
		if str(m["things"][i].get("id", "")) == str(t.get("id", "")):
			m["things"][i] = t
			return
	m["things"].append(t)


static func _parse_sectors(m: Dictionary, line: String) -> void:
	var p := line.split(",")
	if p.size() < 10 or not p[0].strip_edges().is_valid_int():
		m["errors"].append("bad sector: " + line)
		return
	var s := {
		"id": p[0].strip_edges().to_int(),
		"verts": [],
		"floor_tex": p[2].strip_edges(), "wall_tex": p[3].strip_edges(),
		"height": _num(p[4]) if p[4].strip_edges() != "" else 128.0,
		"flags": _int(p[5]),
		"offset": Vector2(_num(p[6]), _num(p[7])),
		"stone": p[8].strip_edges() == "1",
		"fragile": p[9].strip_edges() == "1",
		# модификаторы сектора (после fragile): close — «закрытая дверь» ("0"/"1" = ключ),
		# finish — финиш уровня (переход по числу в конце имени карты)
		"close": "",
		"finish": false,
	}
	# Поле outline (после things, индекс 12+): "0" — сектор просит обводку не
	# рисовать (включая рёбра, общие с соседом). Старые карты поля не имеют —
	# обводка включена; «0» ищем среди хвостовых полей с 12-го индекса
	# (things пишется словом «things...» и в «0» не бывает).
	s["outline"] = true
	for i2 in range(12, p.size()):
		if p[i2].strip_edges() == "0":
			s["outline"] = false
	var vs := p[1].strip_edges()
	if vs.begins_with("v:"):
		for vtok in vs.substr(2).split(":"):
			if vtok.strip_edges().is_valid_int():
				s["verts"].append(vtok.strip_edges().to_int())
	m["sectors"].append(s)
	# Поля 10/11/12: close, finish, things. Старые карты (без дверей и финиша)
	# писали things прямо на 10-ю позицию — читаем по префиксу «things».
	var tik := ""
	if p.size() > 10:
		var cl := p[10].strip_edges()
		if cl.begins_with("things"):
			tik = cl  # legacy
		else:
			s["close"] = cl
			if p.size() > 11:
				if p[11].strip_edges() == "1":
					s["finish"] = true
				tik = p[12].strip_edges() if p.size() > 12 else ""
	if tik.begins_with("things"):
		var body := tik.substr(6).strip_edges()
		if body != "":
			for one in body.split(";"):
				var f := one.split(":")
				if f.size() < 6 or f[0].strip_edges() == "":
					continue
				_upsert_thing(m, _thing_from_fields(f, s["id"]))


static func _parse_connects(m: Dictionary, line: String) -> void:
	var p := line.split(",")
	if p.size() < 3 or not p[0].strip_edges().is_valid_int():
		m["errors"].append("bad connect: " + line)
		return
	m["connects"].append({
		"id": p[0].strip_edges().to_int(),
		"line": _int(p[1]), "line2": _int(p[2]),
	})


static func _parse_things(m: Dictionary, line: String) -> void:
	var p := line.split(",")
	if p.size() < 7 or p[0].strip_edges() == "":
		m["errors"].append("bad thing: " + line)
		return
	_upsert_thing(m, {
		"id": p[0].strip_edges(),
		"type": p[1].strip_edges(),
		"name": p[2].strip_edges(),
		"x": _num(p[3]), "y": _num(p[4]),
		"slot": _int(p[5], 1),
		"sector": _int(p[6]),
	})


static func _parse_triggers(m: Dictionary, line: String) -> void:
	var p := line.split(",")
	if p.size() < 8 or not p[0].strip_edges().is_valid_int():
		m["errors"].append("bad trigger: " + line)
		return
	m["triggers"].append({
		"id": p[0].strip_edges().to_int(),
		"tid": p[1].strip_edges(), "type": p[2].strip_edges(),
		"ticks": _int(p[3], 5),
		"x1": _num(p[4]), "y1": _num(p[5]),
		"x2": _num(p[6]), "y2": _num(p[7]),
	})


static func _parse_lifts(m: Dictionary, line: String) -> void:
	var p := line.split(",")
	if p.size() < 5 or not p[0].strip_edges().is_valid_int():
		m["errors"].append("bad lift: " + line)
		return
	var curve := p[2].strip_edges()
	var L := {
		"id": p[0].strip_edges().to_int(),
		"sector": _int(p[1]),
		"curve": curve if curve != "" else "sin",
		"sec": _num(p[3]) if p[3].strip_edges() != "" else 3.0,
		"zero_id": "", "zero_type": "",
		"floors": [],
	}
	var zk := p[4].strip_edges()
	if zk.begins_with("zero:"):
		var zf := zk.substr(5).split(":")
		if zf.size() > 0 and zf[0].strip_edges() != "":
			L["zero_id"] = zf[0].strip_edges()
		if zf.size() > 1:
			L["zero_type"] = zf[1].strip_edges()
	if p.size() > 5:
		# в полях этажей запятых не бывает (контракт экспорта), но склеим на всякий
		var floor_str := ",".join(p.slice(5))
		for one in floor_str.split("|"):
			if one.strip_edges() == "":
				continue
			var f := one.split(":")
			if f.size() < 3:
				continue
			var fl := {
				"x": _num(f[0]), "y": _num(f[1]),
				"name": f[2].strip_edges(),
				"caller_id": "", "caller_type": "",
			}
			if f.size() > 3 and f[3].strip_edges() != "":
				fl["caller_id"] = f[3].strip_edges()
			if f.size() > 4:
				fl["caller_type"] = f[4].strip_edges()
			L["floors"].append(fl)
	m["lifts"].append(L)


## [textures] — раскладка спрайтов из веб-редактора.
##   atlas = 968x692                        — атлас, из которого брались регионы
##   sec, sector_id, layer_index, layer_id, name, color, visible, items
##   world, id, x, y, w, h, rx, ry, rw, rh, name, visible
## item = id|x|y|rx|ry|rw|rh|pw|ph: окно pw×ph пикселей, внутри которого повторяется
## источник rx,ry,rw,rh — ровно так же, как это рисует редактор.
static func _parse_textures(m: Dictionary, line: String) -> void:
	var tex: Dictionary = m["textures"]
	# заголовок вида «atlas = 968x692» — размер атласа редактора для сверки
	var eq := line.find("=")
	if eq > 0 and line.substr(0, eq).strip_edges() == "atlas":
		var wh := line.substr(eq + 1).strip_edges().split("x")
		if wh.size() == 2 and wh[0].strip_edges().is_valid_int() and wh[1].strip_edges().is_valid_int():
			tex["atlas"] = Vector2i(wh[0].strip_edges().to_int(), wh[1].strip_edges().to_int())
		return
	var p := line.split(",")
	var kind := p[0].strip_edges()
	if kind == "sec":
		if p.size() < 2:
			m["errors"].append("bad texture row: " + line)
			return
		var items: Array = []
		if p.size() > 7:
			var body := ",".join(p.slice(7)).strip_edges()
			for one in body.split(";"):
				var f := one.split("|")
				if f.size() < 7:
					continue
				var rw := _num(f[5])
				var rh := _num(f[6])
				var pw := _num(f[7]) if f.size() > 7 and _num(f[7]) > 0.0 else rw
				var ph := _num(f[8]) if f.size() > 8 and _num(f[8]) > 0.0 else rh
				items.append({
					"id": _int(f[0]),
					"x": _num(f[1]), "y": _num(f[2]),
					"rx": _num(f[3]), "ry": _num(f[4]),
					"rw": rw, "rh": rh, "pw": pw, "ph": ph,
				})
		var layer := {
			"index": _int(p[2]) if p.size() > 2 else 0,
			"id": _int(p[3]) if p.size() > 3 else 0,
			"name": p[4].strip_edges() if p.size() > 4 else "",
			"color": p[5].strip_edges() if p.size() > 5 else "#4a7fd4",
			"visible": not (p.size() > 6 and p[6].strip_edges() == "0"),
			"items": items,
		}
		var sid := str(_int(p[1]))
		var arr: Array = tex["sectors"].get(sid, [])
		arr.append(layer)  # строки в файле идут в порядке слоёв
		tex["sectors"][sid] = arr
	elif kind == "world":
		if p.size() < 11:
			m["errors"].append("bad world texture row: " + line)
			return
		tex["world"].append({
			"id": _int(p[1]),
			"x": _num(p[2]), "y": _num(p[3]),
			"w": _num(p[4]), "h": _num(p[5]),
			"rx": _num(p[6]), "ry": _num(p[7]),
			"rw": _num(p[8]), "rh": _num(p[9]),
			"name": p[10].strip_edges(),
			"visible": not (p.size() > 11 and p[11].strip_edges() == "0"),
		})
	else:
		m["errors"].append("bad texture row: " + line)
