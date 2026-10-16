extends Button

func _pressed():
	var lv = get_tree().get_first_node_in_group("level_view")
	if lv:
		lv.enable_line_tool()
	else:
		VLSLog.info("LEVEL_VIEW NOT FOUND")
