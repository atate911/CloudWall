# CloudWall developer tasks. `make help` lists them.
VENV := .venv
BIN  := $(VENV)/bin
UNIT := $(HOME)/.config/systemd/user/cloudwall.service

.PHONY: help install run demo test config service service-remove logs clean

help:
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 18

install: $(BIN)/cloudwall ## Create .venv and install CloudWall in editable mode

$(BIN)/cloudwall: pyproject.toml
	python3 -m venv $(VENV)
	$(BIN)/pip install --quiet --editable .

run: install ## Run against live traffic on port 5050
	$(BIN)/cloudwall

demo: install ## Run with simulated traffic (no network needed)
	$(BIN)/cloudwall --demo

test: ## Run the test suite
	python3 -m unittest discover -s tests

config: install ## Write a starter config to ~/.config/cloudwall/config.toml
	$(BIN)/cloudwall --init-config

service: install ## Install and start a systemd user service (survives logout and reboot)
	mkdir -p $(dir $(UNIT))
	sed 's|@DIR@|$(CURDIR)|g' deploy/cloudwall.service > $(UNIT)
	systemctl --user daemon-reload
	systemctl --user enable --now cloudwall
	-loginctl enable-linger $(USER)
	@echo "CloudWall is running on port 5050. Logs: make logs"

service-remove: ## Stop and remove the systemd user service
	-systemctl --user disable --now cloudwall
	rm -f $(UNIT)
	systemctl --user daemon-reload

logs: ## Follow the service logs
	journalctl --user -u cloudwall -f

clean: ## Remove the virtualenv and build leftovers
	rm -rf $(VENV) build dist *.egg-info
