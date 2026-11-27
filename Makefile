# CloudWall developer and admin tasks. `make help` lists them.
# Setting a machine up for good is `sudo python3 -m cloudwall install` (see README.md, Install):
# these targets are shortcuts to it and to running CloudWall from this checkout while working on it.
VENV := .venv
BIN  := $(VENV)/bin

.PHONY: help install run demo test config private-link system update doctor backup logs restart migrate service clean

# whichever way CloudWall runs here: the system install, or an older per-user service (`make service`)
SYSTEM := $(wildcard /etc/systemd/system/cloudwall.service)

help:
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 18

install: $(BIN)/cloudwall ## Create .venv and install CloudWall in editable mode (for working on it)

$(BIN)/cloudwall: pyproject.toml
	python3 -m venv $(VENV)
	$(BIN)/pip install --quiet --editable .

run: install ## Run from this checkout against live traffic on port 5050
	$(BIN)/cloudwall

demo: install ## Run from this checkout with simulated traffic (no network needed)
	$(BIN)/cloudwall --demo

test: ## Run the test suite
	python3 -m unittest discover -s tests

config: install ## Write a starter config to ~/.config/cloudwall/config.toml (for `make run`)
	$(BIN)/cloudwall --init-config

private-link: ## Set up a private link (to reach CloudWall from outside the house) and print it
	sudo cloudwall --private-link

system: ## Install CloudWall on this machine as a service (sudo cloudwall install)
	sudo python3 -m cloudwall install

update: ## After `git pull`: back up, put the new code in place, restart, check (`sudo cloudwall rollback` undoes)
	sudo python3 -m cloudwall upgrade

doctor: ## Check every part of CloudWall on this machine, and say what to do about anything wrong
	python3 -m cloudwall doctor

backup: ## Back up the settings and logbooks
	sudo cloudwall backup

logs: ## Follow the service's log
ifneq ($(SYSTEM),)
	journalctl -u cloudwall -f
else
	journalctl --user -u cloudwall -f
endif

restart: ## Restart the service (after `git pull`, on an older per-user setup)
ifneq ($(SYSTEM),)
	sudo systemctl restart cloudwall
else
	systemctl --user restart cloudwall
endif

service: ## (old) Now `make system`: says so, and how to move an existing per-user service
	@echo "CloudWall now installs as a system service: make system   (sudo cloudwall install)"
	@echo "Already running it with the old 'make service'? make migrate   moves it, logbooks and all."

migrate: ## Move an old `make service` setup onto the system install (MIGRATION.md)
	sudo python3 -m cloudwall upgrade

clean: ## Remove the virtualenv and build leftovers
	rm -rf $(VENV) build dist *.egg-info
