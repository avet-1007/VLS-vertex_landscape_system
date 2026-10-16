class_name VLSLog
extends RefCounted

## Кольцевой буфер логов для игровой консоли (static — без автолоада и инстанса).
## info дублирует вывод в stdout (как прежние print), warn/error — в push_*.
## Печать в консоль идёт через вариативные аргументы, как у print: любое
## количество любых типов, склейка без разделителя (str(args...)).
## sinks: Callable(msg: String, level: int) — консоль подписывается на живой вывод.

static var entries: Array = []  # [{m: String, l: int}] — l: 0 инфо, 1 предупр., 2 ошибка
static var sinks: Array = []
const MAX_LINES := 500


static func info(a = null, b = null, c = null, d = null, e = null, f = null, g = null, h = null, i = null, j = null, k = null, l = null) -> void:
	var m := _join([a, b, c, d, e, f, g, h, i, j, k, l])
	_emit(m, 0)
	if a != null:
		print(m)


static func warn(a = null, b = null, c = null, d = null, e = null, f = null, g = null, h = null, i = null, j = null, k = null, l = null) -> void:
	var m := _join([a, b, c, d, e, f, g, h, i, j, k, l])
	if a == null:
		return
	_emit("[!] " + m, 1)
	push_warning(m)


static func error(a = null, b = null, c = null, d = null, e = null, f = null, g = null, h = null, i = null, j = null, k = null, l = null) -> void:
	var m := _join([a, b, c, d, e, f, g, h, i, j, k, l])
	if a == null:
		return
	_emit("[x] " + m, 2)
	push_error(m)


static func clear() -> void:
	entries.clear()


static func _join(args: Array) -> String:
	var parts := PackedStringArray()
	for v in args:
		if v == null:
			break
		parts.append(str(v))
	return "".join(parts)


static func _emit(m: String, lvl: int) -> void:
	entries.append({"m": m, "l": lvl})
	if entries.size() > MAX_LINES:
		entries = entries.slice(entries.size() - MAX_LINES)
	for s in sinks:
		var cb := s as Callable
		if cb.is_valid():
			cb.call(m, lvl)
