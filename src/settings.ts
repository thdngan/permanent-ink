import { App, PluginSettingTab, Setting } from "obsidian";
import type OmnidianPlugin from "./main";

export class OmnidianSettingTab extends PluginSettingTab {
	plugin: OmnidianPlugin;

	constructor(app: App, plugin: OmnidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Expand selection")
			.setDesc(
				document.createRange().createContextualFragment(
					"Expand the text selection boundary to highlight complete words. This avoids selections that can break markdown rendering. Hold <kbd>Alt</kbd> while selecting to override this setting."
				)
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.expandSelection)
					.onChange(async (value) => {
						this.plugin.settings.expandSelection = value;
						await this.plugin.saveSettings();
					})
			);

		const descFragment = document.createDocumentFragment();
		descFragment.append("Add comma separated list of ");
		const colorLink = document.createElement("a");
		colorLink.href = "https://147colors.com";
		colorLink.textContent = "Color names";
		descFragment.append(colorLink, ". Requires app reload.");

		new Setting(containerEl)
			.setName("Highlighting color options")
			.setDesc(descFragment) // Using the safe DOM fragment here
			.setClass("[&_textarea]:w-full")
			.addTextArea((toggle) =>
				toggle
					.setValue(this.plugin.settings.colors.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.colors = value
							.split(",")
							.map((c) => c.trim());
						await this.plugin.saveSettings();
					})
			);
	}
}
