class_name PauseMenu
extends GameScreen
## [Esc] Resume, settings (graphics quality, mouse, field of view, volume), save and quit.

var _main: VBoxContainer
var _settings: VBoxContainer


func _init() -> void:
	super()
	pauses_game = true
	GameScreen.dim_background(self, 0.55)
	var panel := GameScreen.centered_panel(self, Vector2(460, 520))
	var stack := VBoxContainer.new()
	panel.add_child(stack)
	stack.add_child(UITheme.title("Paused", 40))
	_main = VBoxContainer.new()
	_main.add_theme_constant_override("separation", 10)
	stack.add_child(_main)
	for b: Array in [["Resume", close], ["Settings", _show_settings], ["Save game", _save], ["Save and quit to title", _quit_title], ["Quit to desktop", _quit]]:
		var btn := Button.new()
		btn.text = b[0]
		btn.custom_minimum_size = Vector2(0, 48)
		btn.pressed.connect(b[1])
		_main.add_child(btn)
	_settings = SettingsPanel.build(func() -> void:
		_settings.visible = false
		_main.visible = true)
	_settings.visible = false
	stack.add_child(_settings)


func _on_open() -> void:
	_main.visible = true
	_settings.visible = false


func _show_settings() -> void:
	_main.visible = false
	_settings.visible = true


func _save() -> void:
	Game.save_game()
	Game.notify("Game saved.")
	close()


func _quit_title() -> void:
	Game.save_game()
	get_tree().paused = false
	Game.ui_open = false
	get_tree().reload_current_scene()


func _quit() -> void:
	Game.save_game()
	get_tree().quit()
