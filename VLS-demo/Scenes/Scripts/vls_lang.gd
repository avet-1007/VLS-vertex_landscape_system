class_name VLSLang
extends Object

## Выбор языка интерфейса меню: "en" / "ru".
## Хранится в user://settings.cfg, читается лениво.


static var _lang := ""


static func lang() -> String:
	if _lang == "":
		var cfg := ConfigFile.new()
		var v := "en"
		if cfg.load("user://settings.cfg") == OK:
			v = str(cfg.get_value("ui", "lang", "en"))
		_lang = "ru" if v == "ru" else "en"
	return _lang


static func set_lang(code: String) -> void:
	_lang = "ru" if code == "ru" else "en"
	var cfg := ConfigFile.new()
	cfg.load("user://settings.cfg")  # сохраняем прочие настройки
	cfg.set_value("ui", "lang", _lang)
	cfg.save("user://settings.cfg")
