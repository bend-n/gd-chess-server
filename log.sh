#!/usr/bin/env bash

heroku logs --tail --app=gd-chess-server | while read -r LINE; do
    echo -ne "\e[0;36m$(date -d "$(echo "$LINE" | cut -d ' ' -f 1)" +%X): \e[0m"
    echo "$LINE" | cut -d ' ' -f 3-
done
